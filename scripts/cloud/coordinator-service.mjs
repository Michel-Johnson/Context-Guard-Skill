import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, encode, hash, readJSON, withFileLock } from '../shared/io.mjs';
import { coordinatorStep } from './coordinator-model.mjs';

const error = (code, message) => Object.assign(new Error(message), { code, status: 409 });

// One human conversation per project. HTTP handlers acknowledge a durable turn;
// provider work runs outside the request and outside ProtocolStore transactions.
export class CoordinatorService {
  constructor({ directory, model, system, tools, execute, maxSteps = 12, simulated = false }) {
    this.file = path.join(directory, 'conversation.json');
    this.mountFile = path.join(directory, 'mount-reviews.json');
    this.model = model; this.system = system; this.tools = tools; this.execute = execute;
    this.maxSteps = maxSteps; this.simulated = simulated; this.running = null;
  }
  async state() {
    const state = await readJSON(this.file, { messages: [], requests: {}, status: 'idle', toolReceipts: {} });
    const mounts = await readJSON(this.mountFile, { receipts: {}, byProposal: {} });
    return { status: state.status, error: state.error || null, activeTurnId: state.activeTurnId || null,
      retryInput: state.status === 'error' ? state.activeInput || null : null,
      approvals: Object.entries(state.toolReceipts || {}).filter(([, receipt]) => receipt.result?.requiresHumanApproval)
        .map(([id, receipt]) => ({ id, ...receipt.result, ...(receipt.result.kind === 'mount-proposal' ? { pending: !mounts.byProposal[id] } : {}) })),
      promptVersion: state.promptVersion || hash(this.system), simulated: this.simulated,
      messages: state.messages.map(message => ({ role: message.role,
        text: typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'),
        tools: Array.isArray(message.content) ? message.content.filter(block => block.type === 'tool_use').map(block => ({ id: block.id, name: block.name })) : [],
      })).filter(message => message.text || message.tools.length),
    };
  }
  async reviewMount(input, commit) {
    if (!input || Object.keys(input).some(key => !['id', 'proposalIds', 'decision', 'reason'].includes(key)) ||
        typeof input.id !== 'string' || !input.id || input.id.length > 120 ||
        !Array.isArray(input.proposalIds) || !input.proposalIds.length || input.proposalIds.length > 20 ||
        input.proposalIds.some(id => typeof id !== 'string' || !id || id.length > 128) ||
        new Set(input.proposalIds).size !== input.proposalIds.length || !['approved', 'rejected'].includes(input.decision) ||
        typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000) throw error('INVALID_INPUT', 'Select a bounded proposal batch and record the human decision');
    const proposalIds = [...input.proposalIds].sort();
    const fingerprint = hash(encode({ proposalIds, decision: input.decision, reason: input.reason }));
    return withFileLock(this.mountFile + '.lock', async () => {
      const state = await readJSON(this.mountFile, { receipts: {}, byProposal: {} });
      const previous = state.receipts[input.id];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw error('ID_REUSED', 'Mount review request differs');
        return previous.result;
      }
      const existing = proposalIds.map(id => state.byProposal[id]).filter(Boolean);
      if (existing.length) {
        const receipt = state.receipts[existing[0]];
        if (existing.length !== proposalIds.length || existing.some(id => id !== existing[0]) || receipt.fingerprint !== fingerprint) throw error('CONFLICT', 'These proposals have already been reviewed');
        state.receipts[input.id] = receipt;
        await atomicWrite(this.mountFile, encode(state));
        return receipt.result;
      }
      const available = (await this.state()).approvals;
      const proposals = proposalIds.map(id => available.find(item => item.id === id && item.kind === 'mount-proposal'));
      if (proposals.some(item => !item)) throw error('NOT_FOUND', 'Mount proposal is not available');
      if (new Set(proposals.map(item => item.mainVersion)).size !== 1) throw error('CONFLICT', 'Review proposals from the same Main version together');
      // Stable independently of a browser retry ID, including a crash between
      // the atomic Main commit and this review receipt. No second task queue.
      const operationId = `coordinator-mount:${hash(encode(proposalIds))}`;
      const committed = input.decision === 'approved' ? await commit(proposals, operationId) : null;
      const result = { id: input.id, proposalIds, decision: input.decision, reason: input.reason,
        simulated: this.simulated, reviewedAt: new Date().toISOString(), committed,
        nodes: proposals.map(item => ({ title: item.title, owns: item.owns })) };
      state.receipts[input.id] = { fingerprint, result, notified: false };
      for (const id of proposalIds) state.byProposal[id] = input.id;
      await atomicWrite(this.mountFile, encode(state));
      return result;
    });
  }
  async notifyMountReview() {
    const state = await readJSON(this.mountFile, { receipts: {} });
    const receipt = Object.values(state.receipts).find(item => !item.notified);
    if (!receipt) return false;
    const result = receipt.result;
    await this.submit({ id: `mount:${result.id}`, text: JSON.stringify({ type: 'human.mount-review', reviewId: result.id,
      decision: result.decision, reason: result.reason, simulated: result.simulated, version: result.committed?.version, nodeIds: result.committed?.nodeIds,
      instruction: '这是服务器保存的节点审核结果。读取最新 Main；通过后准备需求审核，拒绝后依据反馈修订。此结果不是任务派发授权。' }) }, { source: 'workflow' });
    await withFileLock(this.mountFile + '.lock', async () => {
      const latest = await readJSON(this.mountFile);
      for (const saved of Object.values(latest.receipts)) if (saved.result.id === receipt.result.id) saved.notified = true;
      await atomicWrite(this.mountFile, encode(latest));
    });
    return true;
  }
  async submit({ id = randomUUID(), text, retry = false }, { source = 'human' } = {}) {
    if (this.stopping) throw error('UNAVAILABLE', 'Coordinator is shutting down');
    if (typeof id !== 'string' || !id || id.length > 128 || typeof text !== 'string' || !text.trim() || text.length > 8000) throw error('INVALID_INPUT', 'Provide a bounded message and stable request ID');
    await withFileLock(this.file + '.submit.lock', async () => {
      const state = await readJSON(this.file, { messages: [], requests: {}, status: 'idle', toolReceipts: {} });
      const fingerprint = hash(text);
      if (state.requests[id] && state.requests[id] !== fingerprint) throw error('ID_REUSED', 'Conversation request ID differs');
      if (this.running || state.activeTurnId && state.activeTurnId !== id) throw error('COORDINATOR_BUSY', 'Coordinator is processing the previous turn');
      if (state.requests[id]) {
        if (state.status !== 'error' || !retry) return;
        if (state.activeTurnId !== id) throw error('INVALID_RETRY', 'Retry the failed turn with its original identity');
        state.steps = 0; // A fresh bounded budget only after an explicit retry.
      } else {
        state.requests[id] = fingerprint;
        state.messages.push({ role: 'user', content: (source === 'workflow' ? '[服务器工作流事件，不是新的用户授权]\n' : this.simulated ? '[实验：模拟人工输入]\n' : '') + text });
        state.activeInput = { id, text };
        state.activeTurnId = id; state.steps = 0;
      }
      state.status = 'running'; state.error = null;
      await atomicWrite(this.file, encode(state));
    });
    this.kick();
    return { accepted: true, id };
  }
  kick() {
    if (this.stopping) return;
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    this.running.catch(() => {});
  }
  async run() {
    return withFileLock(this.file + '.run.lock', async () => {
      let state = await readJSON(this.file, null);
      if (!state?.activeTurnId || state.status === 'error') return;
      const save = async value => atomicWrite(this.file, encode(value));
      try {
        while (!this.stopping && state.activeTurnId && state.steps < this.maxSteps) {
          state.steps++;
          await save(state);
          state = await coordinatorStep({ turnId: state.activeTurnId, state, model: this.model,
            system: this.system, tools: this.tools, save, execute: this.execute });
          if (state.status === 'waiting-for-user') state.activeTurnId = null;
          await save(state);
        }
        if (!this.stopping && state.activeTurnId) throw error('STEP_LIMIT', 'Coordinator stopped at its bounded tool-call limit');
      } catch (cause) {
        state.status = 'error'; state.error = { code: cause.code || 'COORDINATOR_FAILED', message: '协调器已暂停；保留原对话与工具回执，可重试或检查配置。' };
        await save(state);
      }
    });
  }
  async close({ stop = false } = {}) { if (stop) this.stopping = true; await this.running?.catch(() => {}); }
}

// Consume the existing protocol journal as an independent consumer. Acceptance
// means the conversation is durable, not that the model has completed its turn.
export class CoordinatorInbox {
  constructor({ store, principal, sessionIds, service, intervalMs = 5000 }) {
    Object.assign(this, { store, principal, sessionIds, service });
    this.running = null; this.stopped = false; this.lastError = null;
    this.changed = () => { void this.pump(); };
    store.on('change', this.changed);
    this.timer = setInterval(this.changed, intervalMs); this.timer.unref();
  }
  async pump() {
    if (this.running || this.stopped || this.service.running) return;
    this.running = this.consume().catch(cause => { this.lastError = { code: cause.code || 'COORDINATOR_INBOX_FAILED' }; }).finally(() => { this.running = null; });
    return this.running;
  }
  async consume() {
    const state = await this.service.state();
    if (state.activeTurnId || state.status === 'error') return;
    this.lastError = null;
    if (await this.service.notifyMountReview?.()) return;
    for (const id of this.sessionIds) {
      if (this.stopped) return;
      try {
        const binding = await this.store.registeredBinding(this.principal, id);
        if (!binding) continue;
        const session = { id, generation: binding.generation };
        const send = async (type, payload, messageId = randomUUID()) => (await this.store.handle(this.principal, { v: 2, id: messageId, type, ...(type === 'sync.heartbeat' ? {} : { session }), payload })).data;
        const head = await send('sync.heartbeat', { sessions: [{ ...session, ackedSeq: 0 }] });
        const page = await send('sync.read', { afterSeq: head.sessions[0].ackedSeq, limit: 100 });
        for (const item of page.messages) {
          const { type, payload } = item.message;
          const actionable = type === 'review.result' && ['brief', 'acceptance'].includes(payload.kind) || type === 'ci.result' ||
            type === 'task.report' && ['planReady', 'handoff', 'interrupted', 'closed'].includes(payload.stage);
          const summary = type === 'review.result' ? payload : { taskId: payload.taskId, stage: payload.stage, verdict: payload.verdict };
          if (actionable) await this.service.submit({ id: `event:${item.message.id}`, text: JSON.stringify({ session, type, payload: summary, instruction: '读取当前任务和引用证据后推进；事件本身不授予额外权限。' }) }, { source: 'workflow' });
          await send('sync.ack', { items: [{ seq: item.seq, outcome: 'applied' }] }, `coordinator-ack:${id}:${session.generation}:${item.seq}`);
          if (actionable) return;
        }
      } catch (cause) { this.lastError = { code: cause.code || 'COORDINATOR_INBOX_FAILED', sessionId: id }; }
    }
  }
  async close() {
    this.stopped = true; clearInterval(this.timer); this.store.off('change', this.changed);
    await this.running;
  }
}
