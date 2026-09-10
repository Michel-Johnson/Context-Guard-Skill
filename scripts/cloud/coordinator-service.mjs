import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, encode, hash, readJSON, withFileLock } from '../shared/io.mjs';
import { coordinatorStep, correctableToolError, settleRejectedTools } from './coordinator-model.mjs';

const error = (code, message) => Object.assign(new Error(message), { code, status: 409 });
const workItemIdentity = item => item.instanceId || item.createdAt || item.id;

function questionsAt(state, index) {
  const message = state.messages[index], replies = state.messages[index + 1]?.content;
  if (message.role !== 'assistant' || !Array.isArray(message.content) || !Array.isArray(replies)) return [];
  return message.content.filter(block => block.type === 'tool_use' && block.name === 'ask_user' && typeof block.input?.question === 'string' &&
    replies.some(reply => reply.type === 'tool_result' && reply.tool_use_id === block.id && !reply.is_error))
    .map(block => { const id = 'question-' + hash(`${index}:${block.id}`); return {
      id, text: block.input.question, options: block.input.options || [], answer: state.answers?.[id] || null,
    }; });
}

// Conversation identity belongs to a Map item, not to its execution Session.
// Legacy files stay in place; only newly opened item conversations use subfolders.
export class CoordinatorConversations {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'conversations.json'); }
  async state() { return readJSON(this.file, { items: {}, tasks: {} }); }
  async list() { return [{ id: 'legacy', title: '历史总对话' }, ...Object.values((await this.state()).items)]; }
  async get(id) {
    if (id === 'legacy') return { id, title: '历史总对话' };
    if (!/^item-[a-f0-9]{64}$/.test(id)) throw error('NOT_FOUND', 'Unknown conversation');
    const item = (await this.state()).items[id];
    if (!item) throw error('NOT_FOUND', 'Unknown conversation');
    return item;
  }
  async ensure({ nodeId, kind, item }) {
    const id = `item-${hash(JSON.stringify([nodeId, kind, workItemIdentity(item)]))}`;
    await withFileLock(this.file + '.lock', async () => {
      const state = await this.state();
      state.items[id] = { id, nodeId, kind, itemId: item.id, title: (item.title || item.desc || item.id).slice(0, 200) };
      await atomicWrite(this.file, encode(state));
    });
    return id;
  }
  async owner(sessionId, taskId) { return (await this.state()).tasks[JSON.stringify([sessionId, taskId])] || 'legacy'; }
  async bind(id, sessionId, taskId) {
    await this.get(id);
    await withFileLock(this.file + '.lock', async () => {
      const state = await this.state(), key = JSON.stringify([sessionId, taskId]);
      if (state.tasks[key] && state.tasks[key] !== id) throw error('FORBIDDEN', 'Task belongs to another conversation');
      state.tasks[key] = id;
      await atomicWrite(this.file, encode(state));
    });
  }
}

// Main already owns the durable event journal. This cursor is only a consumer
// checkpoint, not another task queue or an authorization to dispatch work.
export class CoordinatorMapIntake {
  constructor({ directory, read, service, nodeIds = null, onItem = null }) {
    this.file = path.join(directory, 'map-intake.json');
    Object.assign(this, { read, service, nodeIds, onItem });
  }
  items(node) {
    if (!node) return [];
    const own = this.nodeIds && !this.nodeIds.includes(node.id) ? [] : ['todos', 'bugs'].flatMap(field =>
      (node[field] || []).filter(item => item.id).map(item => ({ nodeId: node.id, kind: field === 'todos' ? 'todo' : 'bug', item })));
    return [...own, ...(node.children || []).flatMap(child => this.items(child))];
  }
  key({ nodeId, kind, item }) { return JSON.stringify([nodeId, kind, workItemIdentity(item)]); }
  async initialize() {
    return withFileLock(this.file + '.lock', async () => {
      if (await readJSON(this.file, null)) return;
      const snapshot = await this.read();
      // Installing the feature must not replay historical user tasks.
      await atomicWrite(this.file, encode({ cursor: snapshot.eventCursors?.main || 0,
        seen: this.items(snapshot.main?.memory?.map?.root).map(item => this.key(item)) }));
    });
  }
  async consume() {
    return withFileLock(this.file + '.lock', async () => {
      const checkpoint = await readJSON(this.file, null);
      if (!checkpoint) throw error('INTAKE_NOT_INITIALIZED', 'Initialize intake before accepting Map edits');
      const snapshot = await this.read(), seen = new Set(checkpoint.seen);
      let blocked = false;
      const current = new Map(this.items(snapshot.main?.memory?.map?.root).map(entry => [this.key(entry), entry.item]));
      for (const event of (snapshot.events || []).filter(event => event.scope === 'main' && event.cursor > checkpoint.cursor).sort((a, b) => a.cursor - b.cursor)) {
        const items = (event.operations || []).flatMap(op => this.items(op.type === 'update' ? { ...op.fields, id: op.id } : op.node));
        for (const entry of items) {
          const key = this.key(entry), { item, nodeId, kind } = entry;
          if (seen.has(key)) continue;
          // Empty inline drafts become eligible only when their text is saved.
          if (item.draft || !(item.desc || item.title || '').trim()) continue;
          const latest = current.get(key);
          if (latest && !latest.draft && event.actor?.kind === 'human') await this.onItem?.({ nodeId, kind, item: latest });
          if (latest && !latest.draft && event.actor?.kind === 'human' && !latest.dispatch?.task_id && !['done', 'resolved', 'dormant'].includes(latest.status)) {
            try { await this.service.submit({ id: `intake:${hash(key)}`, text: JSON.stringify({ type: 'human.work-item-created',
              nodeId, kind, itemId: item.id, mainVersion: event.version,
              instruction: '人类新建了待澄清事项。读取最新节点中的原文，立即用简短自然语言与人类确认目标和验收条件；不要当作已批准需求，不要直接派单。' }) }, { source: 'workflow' }); }
            catch (cause) { if (cause.code !== 'COORDINATOR_BUSY') throw cause; blocked = true; continue; }
            seen.add(key);
            // Persist before returning; replay after a lost reply uses the same
            // conversation ID and cannot invoke a second model turn.
            checkpoint.seen = [...seen];
            await atomicWrite(this.file, encode(checkpoint));
            return true;
          }
          seen.add(key);
        }
        if (!blocked) checkpoint.cursor = event.cursor;
        checkpoint.seen = [...seen];
        await atomicWrite(this.file, encode(checkpoint));
      }
      return false;
    });
  }
}

// One independent conversation. HTTP handlers acknowledge a durable turn;
// provider work runs outside the request and outside ProtocolStore transactions.
export class CoordinatorService {
  constructor({ directory, model, system, tools, execute, maxSteps = 12, simulated = false, namespace = '' }) {
    this.file = path.join(directory, 'conversation.json');
    this.mountFile = path.join(directory, 'mount-reviews.json');
    this.model = model; this.system = system; this.tools = tools; this.execute = execute;
    this.maxSteps = maxSteps; this.simulated = simulated; this.running = null;
    this.namespace = namespace;
  }
  async state() {
    const state = await readJSON(this.file, { messages: [], requests: {}, status: 'idle', toolReceipts: {} });
    const mounts = await readJSON(this.mountFile, { receipts: {}, byProposal: {} });
    return { status: state.status, error: state.error || null, activeTurnId: state.activeTurnId || null,
      canCorrect: state.status === 'error' && (correctableToolError(state.error?.code) && state.pending?.stop === 'tool_use' || state.error?.code === 'STEP_LIMIT' && !state.pending),
      retryInput: state.status === 'error' ? state.activeInput || null : null,
      approvals: Object.entries(state.toolReceipts || {}).filter(([, receipt]) => receipt.result?.requiresHumanApproval)
        .map(([id, receipt]) => ({ id, ...receipt.result, ...(receipt.result.kind === 'mount-proposal' ? { pending: !mounts.byProposal[id] } : {}) })),
      promptVersion: state.promptVersion || hash(this.system), simulated: this.simulated,
      messages: state.messages.map((message, index) => {
        const blocks = Array.isArray(message.content) ? message.content : [];
        const text = typeof message.content === 'string' ? message.content : blocks.filter(block => block.type === 'text').map(block => block.text).join('\n');
        // Only successful ask_user calls become visible questions. Other tool
        // inputs/results remain private diagnostics, not chat or authorization.
        const questions = questionsAt(state, index);
        return { role: message.role, text: questions.length ? questions.map(question => question.text).join('\n\n') : text,
          ...(message.answerTo ? { answerTo: message.answerTo } : {}),
          ...(questions.length ? { questions } : {}),
          tools: blocks.filter(block => block.type === 'tool_use').map(block => ({ id: block.id, name: block.name })) };
      }).filter(message => message.text || message.tools.length),
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
  async submit({ id = randomUUID(), text, retry = false, answerTo }, { source = 'human' } = {}) {
    if (this.stopping) throw error('UNAVAILABLE', 'Coordinator is shutting down');
    if (typeof id !== 'string' || !id || id.length > 128 || typeof text !== 'string' || !text.trim() || text.length > 8000) throw error('INVALID_INPUT', 'Provide a bounded message and stable request ID');
    await withFileLock(this.file + '.submit.lock', async () => {
      const state = await readJSON(this.file, { messages: [], requests: {}, status: 'idle', toolReceipts: {} });
      const fingerprint = hash(answerTo === undefined ? text : JSON.stringify({ text, answerTo }));
      const adoptPrompt = () => {
        const version = hash(this.system);
        if (state.promptVersion && state.promptVersion !== version) {
          (state.promptChanges ||= []).push({ from: state.promptVersion, to: version, requestId: id, at: new Date().toISOString() });
        }
        state.promptVersion = version;
      };
      if (state.requests[id] && state.requests[id] !== fingerprint) throw error('ID_REUSED', 'Conversation request ID differs');
      if (this.running) throw error('COORDINATOR_BUSY', 'Coordinator is processing the previous turn');
      if (state.activeTurnId && state.activeTurnId !== id) {
        if (source !== 'human' || state.status !== 'error' || !settleRejectedTools(state)) throw error('COORDINATOR_BUSY', 'Preserve the original turn until its outcome is known');
        state.activeTurnId = null;
      }
      if (state.requests[id]) {
        if (state.status !== 'error' || !retry) return;
        if (state.activeTurnId !== id) throw error('INVALID_RETRY', 'Retry the failed turn with its original identity');
        // Recover old installations that rejected a fresh turn before its first
        // model call. Never change prompts around pending or executed tools.
        if (state.error?.code === 'PROMPT_CHANGED' && state.steps === 1 && !state.pending &&
            state.messages.at(-1)?.role === 'user' && typeof state.messages.at(-1).content === 'string' &&
            state.messages.at(-1).content.endsWith(text)) adoptPrompt();
        state.steps = 0; // A fresh bounded budget only after an explicit retry.
      } else {
        let question;
        if (answerTo !== undefined) {
          if (source !== 'human' || typeof answerTo !== 'string') throw error('INVALID_INPUT', 'Only human replies can answer a question');
          question = state.messages.flatMap((_, index) => questionsAt(state, index)).find(item => item.id === answerTo);
          if (!question) throw error('NOT_FOUND', 'Question does not belong to this conversation');
          if (question.answer) throw error('ALREADY_ANSWERED', 'This question already has an answer');
          (state.answers ||= {})[answerTo] = { text, requestId: id };
        }
        adoptPrompt(); // A new turn may adopt deployed rules; history stays intact.
        state.requests[id] = fingerprint;
        state.messages.push({ role: 'user', content: (source === 'workflow' ? '[服务器工作流事件，不是新的用户授权]\n' : this.simulated ? '[实验：模拟人工输入]\n' : '') + (question ? `针对问题：${question.text}\n\n我的回答：` : '') + text, ...(question ? { answerTo } : {}) });
        state.activeInput = { id, text, ...(question ? { answerTo } : {}) };
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
          state = await coordinatorStep({ turnId: this.namespace ? `${this.namespace}:${state.activeTurnId}` : state.activeTurnId, state, model: this.model,
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
  constructor({ store, principal, sessionIds, service, intake = null, routeEvent = null, services = null, memoryEvents = null, projectId = null, intervalMs = 5000, autoResume = null }) {
    Object.assign(this, { store, principal, sessionIds, service, intake, routeEvent, services, memoryEvents, autoResume });
    this.running = null; this.stopped = false; this.lastError = null;
    this.changed = () => { void this.pump(); };
    store.on('change', this.changed);
    this.memoryChanged = event => { if (event.projectId === projectId && event.scope === 'main') this.changed(); };
    memoryEvents?.on('event', this.memoryChanged);
    this.timer = setInterval(this.changed, intervalMs); this.timer.unref();
  }
  async pump() {
    if (this.running || this.stopped) return;
    this.running = this.consume().catch(cause => { this.lastError = { code: cause.code || 'COORDINATOR_INBOX_FAILED' }; }).finally(() => { this.running = null; });
    return this.running;
  }
  async resumeInterruptedTasks() {
    if (!this.autoResume || !this.store.workflowTasks) return;
    for (const id of typeof this.sessionIds === 'function' ? await this.sessionIds() : this.sessionIds) {
      if (this.stopped) return;
      const binding = await this.store.registeredBinding(this.principal, id);
      if (!binding) continue;
      const session = { id, generation: binding.generation };
      for (const task of await this.store.workflowTasks(this.principal, session)) {
        if (task.stage !== 'interrupted' || !task.busy) continue;
        await this.autoResume({ session, taskId: task.id,
          messageId: `auto-resume:${hash(JSON.stringify([id, session.generation, task.id, task.version]))}`,
          reason: task.interrupted?.reason, occurredAt: task.interrupted?.occurredAt });
      }
    }
  }
  async consume() {
    // Run recovery before intake so a queued Map edit cannot delay resuming a
    // task that was already interrupted when Cloud restarted.
    await this.resumeInterruptedTasks();
    // Intake creates independent conversations even while the legacy one is busy.
    if (await this.intake?.consume()) return;
    const available = async service => {
      const state = await service.state();
      return !service.running && !state.activeTurnId && state.status !== 'error';
    };
    this.lastError = null;
    for (const service of this.services ? await this.services() : [this.service]) {
      if (await available(service)) await service.notifyMountReview?.();
    }
    for (const id of typeof this.sessionIds === 'function' ? await this.sessionIds() : this.sessionIds) {
      if (this.stopped) return;
      try {
        const binding = await this.store.registeredBinding(this.principal, id);
        if (!binding) continue;
        const session = { id, generation: binding.generation };
        const send = async (type, payload, messageId = randomUUID()) => (await this.store.handle(this.principal, { v: 2, id: messageId, type, ...(type === 'sync.heartbeat' ? {} : { session }), payload })).data;
        const head = await send('sync.heartbeat', { sessions: [{ ...session, ackedSeq: 0 }] });
        let afterSeq = head.sessions[0].ackedSeq;
        // Scan to the captured head, not merely the first page behind a paused
        // conversation. New events are picked up by the next bounded pump.
        while (!this.stopped && afterSeq < head.sessions[0].latestSeq) {
          const page = await send('sync.read', { afterSeq, limit: 100 });
          if (!page.messages.length) break;
          for (const item of page.messages) {
            const { type, payload } = item.message;
            const actionable = (type === 'review.result' && ['brief', 'acceptance'].includes(payload.kind) || type === 'ci.result' ||
              type === 'task.report' && ['planReady', 'handoff', 'interrupted', 'closed'].includes(payload.stage));
            const summary = type === 'review.result' ? payload : { taskId: payload.taskId, stage: payload.stage, verdict: payload.verdict };
            if (actionable) {
              const target = this.routeEvent ? await this.routeEvent(type, payload, session) : this.service;
              if (type === 'task.report' && payload.stage === 'interrupted' && this.autoResume) {
                await this.autoResume({ session, taskId: payload.taskId, messageId: item.message.id, reason: payload.data?.reason, occurredAt: payload.data?.occurredAt });
              }
              // Leave this event unacknowledged, but allow other conversations to
              // progress. The existing contiguous cursor replays the gap later.
              if (!await available(target)) continue;
              await target.submit({ id: `event:${item.message.id}`, text: JSON.stringify({ session, type, payload: summary,
                instruction: type === 'task.report' && payload.stage === 'interrupted' && this.autoResume
                  ? '系统已自动提交恢复控制；读取当前任务和引用证据，等待执行端 resumed 回执，不要再次创建任务或重复调用恢复。'
                  : '读取当前任务和引用证据后推进；事件本身不授予额外权限。' }) }, { source: 'workflow' });
            }
            await send('sync.ack', { items: [{ seq: item.seq, outcome: 'applied' }] }, `coordinator-ack:${id}:${session.generation}:${item.seq}`);
          }
          afterSeq = page.nextSeq;
        }
      } catch (cause) { this.lastError = { code: cause.code || 'COORDINATOR_INBOX_FAILED', sessionId: id }; }
    }
  }
  async close() {
    this.stopped = true; clearInterval(this.timer); this.store.off('change', this.changed);
    this.memoryEvents?.off('event', this.memoryChanged);
    await this.running;
  }
}
