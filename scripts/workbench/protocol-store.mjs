import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { atomicWrite, encode, hash, readJSON, withFileLock } from './io.mjs';
import { canonical, fail, validateMessage, MAX_MESSAGE_BYTES } from './protocol.mjs';
import { reduceWorkflow, scopedObjectKey, workflowTypes } from './protocol-workflow.mjs';

const fresh = () => ({ format: 1, bindings: {}, receipts: {}, queues: {}, objects: {}, tasks: {} });
const observations = new Set(['sync.heartbeat', 'sync.read', 'object.read', 'workbench.read', 'blob.get']);
const key = value => hash(canonical(value));
const queueKey = (principal, session) => key([principal.repositoryId, session.id, session.generation]);
const principalKey = p => [p.repositoryId, p.deviceId, p.agentId];
const requireIdentity = p => {
  if (!p || ['repositoryId', 'deviceId', 'agentId'].some(k => typeof p[k] !== 'string' || !p[k])) fail('UNAUTHORIZED', 'Authenticated identity required');
};
const bindingKey = (p, id) => key([p.repositoryId, id]);
const requireBinding = (state, p, session) => {
  const binding = state.bindings[bindingKey(p, session.id)];
  const delegated = binding && ['coordinator', 'ci'].includes(p.role) && p.bindings?.[session.id] === binding.worktreeId;
  if (!binding || !delegated && p.role !== 'human' && (binding.deviceId !== p.deviceId || (p.role !== 'device' && binding.agentId !== p.agentId))) fail('FORBIDDEN', 'Session is not assigned to this identity');
  if (binding.generation !== session.generation) fail('STALE_SESSION', 'Session binding changed', { currentGeneration: binding.generation });
  return binding;
};
const queueFor = (state, p, session) => state.queues[queueKey(p, session)] ||= { latestSeq: 0, ackedSeq: 0, items: [], outcomes: {} };
const consumerFor = (queue, p, create = false) => {
  const id = key(principalKey(p));
  if (create) { queue.consumers ||= {}; queue.consumers[id] ||= { ackedSeq: 0, outcomes: {} }; }
  return queue.consumers?.[id] || { ackedSeq: 0, outcomes: {} };
};

// One transaction persists business state, emitted messages and the retry receipt.
// Reducers must only mutate this transaction, never perform external side effects.
export class ProtocolStore extends EventEmitter {
  constructor(directory, { beforeCommit = async () => {} } = {}) { super(); this.file = path.join(directory, 'protocol-v2.json'); this.beforeCommit = beforeCommit; }
  async immutableState() {
    const stamp = async () => {
      try { const value = await fs.stat(this.file, { bigint: true }); return `${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}`; }
      catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await stamp();
      if (this.cached?.stamp === before) return this.cached.state;
      const state = await readJSON(this.file, fresh());
      if (state.format !== 1) fail('UNAVAILABLE', 'Unsupported stored protocol version');
      if (before !== await stamp()) continue;
      const pending = [state];
      while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) continue;
        for (const child of Object.values(value)) pending.push(child);
        Object.freeze(value);
      }
      this.cached = { stamp: before, state };
      return state;
    }
    fail('UNAVAILABLE', 'Protocol storage changed during the read');
  }
  async transaction(action, { readOnly = false } = {}) {
    if (readOnly) return structuredClone(await action(await this.immutableState()));
    const perform = async () => {
      const state = await readJSON(this.file, fresh());
      if (state.format !== 1) fail('UNAVAILABLE', 'Unsupported stored protocol version');
      const before = encode(state);
      const result = await action(state);
      const after = encode(state);
      if (after !== before) {
        await this.beforeCommit(); await atomicWrite(this.file, after);
        this.cached = null;
      }
      return structuredClone(result);
    };
    return withFileLock(`${this.file}.lock`, perform);
  }
  async execute(principal, input, reduce, authorize = () => {}) {
    requireIdentity(principal); validateMessage(input);
    if (input.type.startsWith('auth.')) fail('FORBIDDEN', 'Credentials must not enter the message journal');
    const reply = await this.transaction(async state => {
      if (input.session) requireBinding(state, principal, input.session);
      await authorize(state, principal, input);
      const receiptKey = key([...principalKey(principal), input.id]);
      const fingerprint = hash(canonical(input));
      const receipt = observations.has(input.type) ? null : state.receipts[receiptKey];
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) fail('ID_REUSED', 'Request ID already has different content');
        return receipt.reply;
      }
      const emit = message => {
        validateMessage(message);
        if (!message.session || !state.bindings[bindingKey(principal, message.session.id)]) fail('NOT_FOUND', 'Notification Session does not exist');
        const binding = state.bindings[bindingKey(principal, message.session.id)];
        if (binding.generation !== message.session.generation) fail('STALE_SESSION', 'Notification targets an old binding');
        const queue = queueFor(state, principal, message.session);
        const previous = queue.items.find(i => i.message.id === message.id);
        if (previous) {
          if (canonical(previous.message) !== canonical(message)) fail('ID_REUSED', 'Notification ID already has different content');
          return previous.seq;
        }
        // Reserve space for the enclosing read response: a legal message must fit a page.
        if (Buffer.byteLength(canonical(message)) > MAX_MESSAGE_BYTES - 1024) fail('TOO_LARGE', 'Notification exceeds the page budget; use an object reference');
        const seq = ++queue.latestSeq;
        queue.items.push({ seq, message: structuredClone(message) });
        return seq;
      };
      const data = await reduce(state, principal, input, emit);
      const reply = { id: input.id, ok: true, data };
      if (Buffer.byteLength(JSON.stringify(reply)) > MAX_MESSAGE_BYTES) fail('TOO_LARGE', 'Reply exceeds the page budget');
      if (!observations.has(input.type)) state.receipts[receiptKey] = { fingerprint, reply };
      return reply;
    }, { readOnly: observations.has(input.type) });
    if (!observations.has(input.type)) this.emit('change');
    return reply;
  }
  async receiveNotification(principal, message) {
    if (principal.role !== 'device' || !message.session || !workflowTypes.has(message.type)) fail('FORBIDDEN', 'Unsupported downstream notification');
    // Persist transport receipt and inbox entry together; this is NOT task completion.
    return this.execute(principal, message, (state, p, input, emit) => {
      state.localExecutions ||= {};
      const key = queueKey(p, input.session), current = state.localExecutions[key];
      if (input.type === 'task.assign') state.localExecutions[key] = { taskId: input.payload.taskId, assignedAt: new Date().toISOString(), closed: false };
      if (input.type === 'task.report' && input.payload.stage === 'closed' && current?.taskId === input.payload.taskId) current.closed = true;
      emit(input); return { outcome: 'applied' };
    });
  }
  async handle(principal, input, options = {}) {
    return this.execute(principal, input, async (state, p, message, emit) => {
      const payload = message.payload;
      if (message.type === 'workbench.read' && options.workbenchRead) return options.workbenchRead(p, message);
      if (workflowTypes.has(message.type)) return reduceWorkflow(state, p, message, emit, options.workflow);
      if (message.type === 'blob.put' && options.blobs) return options.blobs.register(p, message.session, payload);
      if (message.type === 'blob.get' && options.blobs) return options.blobs.metadata(p, message.session, payload.blobId);
      if (message.type === 'session.bind') {
        if (!await options.verifyBinding?.(p, payload)) fail('FORBIDDEN', 'Binding requires a verified local registration');
        const id = bindingKey(p, payload.sessionId), previous = state.bindings[id];
        const same = previous && previous.deviceId === p.deviceId && previous.agentId === payload.agentId && previous.worktreeId === payload.worktreeId;
        if (p.role !== 'device' && payload.agentId !== p.agentId) fail('FORBIDDEN', 'Agent identity differs from credential');
        if (same) {
          if (payload.expectedBindingVersion && payload.expectedBindingVersion !== previous.version) fail('CONFLICT', 'Binding changed', { currentVersion: previous.version });
          previous.sessionId = payload.sessionId;
          return { session: { id: payload.sessionId, generation: previous.generation }, bindingVersion: previous.version };
        }
        if (previous && (!options.allowMigration || previous.deviceId !== p.deviceId || payload.expectedBindingVersion !== previous.version)) fail('CONFLICT', 'Migration requires the owning device and current binding version', { currentVersion: previous.version });
        if (!previous && payload.expectedBindingVersion) fail('CONFLICT', 'Binding does not exist', { currentVersion: '' });
        const binding = { sessionId: payload.sessionId, deviceId: p.deviceId, agentId: payload.agentId, worktreeId: payload.worktreeId, generation: (previous?.generation || 0) + 1, version: randomUUID() };
        state.bindings[id] = binding;
        queueFor(state, p, { id: payload.sessionId, generation: binding.generation });
        return { session: { id: payload.sessionId, generation: binding.generation }, bindingVersion: binding.version };
      }
      if (message.type === 'sync.heartbeat') {
        return { sessions: payload.sessions.map(s => {
          requireBinding(state, p, s);
          const queue = queueFor(state, p, s);
          const consumer = consumerFor(queue, p);
          if (s.ackedSeq > consumer.ackedSeq) fail('CONFLICT', 'Client acknowledgement is ahead of durable server state');
          return { id: s.id, generation: s.generation, latestSeq: queue.latestSeq, ackedSeq: consumer.ackedSeq };
        }) };
      }
      if (message.type === 'sync.read') {
        const queue = queueFor(state, p, message.session);
        if (payload.afterSeq > queue.latestSeq) fail('INVALID_ARGUMENT', 'Read cursor is ahead of the queue');
        const messages = []; let size = 512;
        for (const item of queue.items) {
          if (item.seq <= payload.afterSeq) continue;
          const bytes = Buffer.byteLength(JSON.stringify(item)) + 1;
          if (messages.length >= payload.limit || size + bytes > MAX_MESSAGE_BYTES) break;
          messages.push(item); size += bytes;
        }
        const nextSeq = messages.at(-1)?.seq ?? payload.afterSeq;
        return { messages, nextSeq, hasMore: nextSeq < queue.latestSeq };
      }
      if (message.type === 'sync.ack') {
        const queue = queueFor(state, p, message.session);
        const consumer = consumerFor(queue, p, true);
        for (const item of payload.items) {
          if (item.seq > queue.latestSeq) fail('INVALID_ARGUMENT', 'Cannot acknowledge an unsent sequence');
          const prior = consumer.outcomes[item.seq];
          if (prior && canonical(prior) !== canonical(item)) fail('CONFLICT', 'Acknowledged outcome is immutable');
          consumer.outcomes[item.seq] = item;
        }
        while (consumer.outcomes[consumer.ackedSeq + 1]) consumer.ackedSeq++;
        return { ackedSeq: consumer.ackedSeq };
      }
      if (message.type === 'object.put' || message.type === 'object.read') {
        const objectKey = scopedObjectKey(p, message.session, payload.ref);
        const record = state.objects[objectKey];
        if (message.type === 'object.read') {
          const saved = record?.versions[payload.version];
          if (!saved) fail('NOT_FOUND', 'Object version does not exist in this Session');
          return { ref: payload.ref, version: payload.version, kind: saved.kind, content: saved.content };
        }
        if ((record?.latest || '') !== payload.baseVersion) fail('CONFLICT', 'Object changed', { currentVersion: record?.latest || '' });
        if (record && record.versions[record.latest].kind !== payload.kind) fail('CONFLICT', 'Object kind cannot change');
        const version = randomUUID(), target = record || { latest: '', versions: {} };
        target.versions[version] = { kind: payload.kind, content: structuredClone(payload.content) };
        target.latest = version; state.objects[objectKey] = target;
        return { ref: payload.ref, version };
      }
      fail('INVALID_ARGUMENT', 'This message is not implemented by this endpoint yet');
    }, options.authorize);
  }
  async authorizeSession(principal, session) {
    requireIdentity(principal);
    return this.transaction(state => requireBinding(state, principal, session), { readOnly: true });
  }
  async recoverySnapshot(principal, session, load) {
    requireIdentity(principal);
    return this.transaction(async state => {
      requireBinding(state, principal, session);
      // Writers cannot append or acknowledge tasks while the Map snapshot is
      // captured. Later writes stay beyond this barrier and are read normally.
      const source = await load();
      const queue = queueFor(state, principal, session), consumer = consumerFor(queue, principal);
      const pendingMessages = queue.items.filter(item => !consumer.outcomes[item.seq]);
      const recovery = { resumeAfterSeq: queue.latestSeq, pendingMessages };
      return { ...source, mapVersion: source.version, version: hash(canonical([source.version, recovery])), recovery };
    });
  }
  async activeExecution(principal, session) {
    await this.authorizeSession(principal, session);
    return this.transaction(state => {
      requireBinding(state, principal, session);
      const current = state.localExecutions?.[queueKey(principal, session)];
      return current && !current.closed ? current : null;
    }, { readOnly: true });
  }
  async registeredBinding(principal, sessionId) {
    requireIdentity(principal);
    return this.transaction(state => {
      const binding = state.bindings[bindingKey(principal, sessionId)];
      if (!binding) return null;
      requireBinding(state, principal, { id: sessionId, generation: binding.generation });
      return binding;
    }, { readOnly: true });
  }
  async queueHeads(principal) {
    requireIdentity(principal);
    return this.transaction(state => Object.entries(state.bindings).flatMap(([id, binding]) => {
      // Queue keys are opaque, so find the Session ID persisted on its binding.
      if (!binding.sessionId || id !== bindingKey(principal, binding.sessionId)) return [];
      const session = { id: binding.sessionId, generation: binding.generation };
      try { requireBinding(state, principal, session); } catch { return []; }
      return [{ session, latestSeq: state.queues[queueKey(principal, session)]?.latestSeq || 0 }];
    }), { readOnly: true });
  }
}
