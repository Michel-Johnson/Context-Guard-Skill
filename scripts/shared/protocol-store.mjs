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
export function hasCiReceiver(state, principal, session, config = {}) {
  const executor = state.bindings[bindingKey(principal, session.id)];
  if (!executor || executor.generation !== session.generation) return false;
  const creation = Object.values(state.sessionCreations || {}).find(item =>
    item.repositoryId === principal.repositoryId && item.deviceId === executor.deviceId &&
    item.result?.sessionId === session.id && item.result.state === 'registered' && item.result.generation === session.generation);
  return Object.entries(config.ciReceivers || {}).filter(([id, receiver]) => {
    if (receiver.executorSessionId !== session.id && !(config.sessionTemplates?.includes(receiver.executorSessionId) &&
        creation?.result.templateSessionId === receiver.executorSessionId)) return false;
    const ci = state.bindings[bindingKey(principal, id)];
    return ci && ci.deviceId === executor.deviceId && ci.worktreeId === receiver.worktreeId && ci.worktreeId !== executor.worktreeId;
  }).length === 1;
}
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
      if (input.type === 'task.assign') state.localExecutions[key] = { taskId: input.payload.taskId, mode: input.payload.mode || 'reviewed', nodeIds: input.payload.nodeIds, assignedAt: new Date().toISOString(), closed: false };
      if (input.type === 'task.report' && current?.taskId === input.payload.taskId) {
        if (['closed', 'finished'].includes(input.payload.stage)) current.closed = true;
        if (input.payload.stage === 'planReady') { current.plan = { ref: input.payload.data.planRef, version: input.payload.data.planVersion, sourceSha: input.payload.data.sourceSha }; current.approval = null; }
      }
      if (input.type === 'review.result' && input.payload.kind === 'plan' && current?.plan?.ref === input.payload.ref && current.plan.version === input.payload.version) current.approval = input.payload.decision === 'approved' ? input.payload.receiptId : null;
      if (input.type === 'task.rework' && current?.taskId === input.payload.taskId) { current.plan = null; current.approval = null; }
      emit(input); return { outcome: 'applied' };
    });
  }
  async resumeControlApplied(principal, message) {
    if (principal.role !== 'device') fail('FORBIDDEN', 'Only the receiving device can inspect delivery receipts');
    if (message.type !== 'task.control' || message.payload.action !== 'resume') return false;
    await this.authorizeSession(principal, message.session);
    return this.transaction(state => {
      requireBinding(state, principal, message.session);
      // Reuse the durable downlink journal, including receipts written before
      // this guard existed. Do not require a second index or a data migration.
      return queueFor(state, principal, message.session).items.some(({ message: received }) =>
        received.type === 'task.report' && received.payload.stage === 'resumed' &&
        received.payload.taskId === message.payload.taskId && received.payload.data.controlId === message.id);
    }, { readOnly: true });
  }
  async requestSessionCreation(principal, input) {
    requireIdentity(principal);
    if (principal.role !== 'human' && !(principal.role === 'coordinator' && principal.creationTemplates?.includes(input?.templateSessionId))) fail('FORBIDDEN', 'Session creation requires an authorized project template');
    if (!input || Object.keys(input).some(k => !['operationId', 'templateSessionId', 'name'].includes(k)) ||
        ['operationId', 'templateSessionId', 'name'].some(k => typeof input[k] !== 'string' || !input[k].trim() || input[k].length > (k === 'name' ? 200 : 128))) fail('INVALID_ARGUMENT', 'Provide a stable request, configured template Session and name');
    const result = await this.transaction(state => {
      const template = state.bindings[bindingKey(principal, input.templateSessionId)];
      if (!template) fail('NOT_FOUND', 'Template Session is not registered in this project');
      state.sessionCreations ||= {};
      const id = key([...principalKey(principal), 'session-create', input.operationId]);
      const fingerprint = hash(canonical(input)), previous = state.sessionCreations[id];
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail('ID_REUSED', 'Session creation request differs');
        return previous.result;
      }
      const result = { id, operationId: input.operationId, sessionId: randomUUID(), templateSessionId: input.templateSessionId,
        name: input.name.trim(), state: 'pending', createdAt: new Date().toISOString() };
      state.sessionCreations[id] = { repositoryId: principal.repositoryId, deviceId: template.deviceId,
        templateWorktreeId: template.worktreeId, fingerprint, result, requestedBy: { role: principal.role, agentId: principal.agentId } };
      return result;
    });
    this.emit('change');
    return result;
  }
  async retrySessionCreation(principal, id) {
    requireIdentity(principal);
    if (principal.role !== 'coordinator' || typeof id !== 'string' || !id) fail('FORBIDDEN', 'Coordinator creation retry required');
    const result = await this.transaction(state => {
      const creation = state.sessionCreations?.[id];
      if (!creation || creation.repositoryId !== principal.repositoryId) fail('NOT_FOUND', 'Session creation is unavailable');
      if (creation.requestedBy?.role !== 'coordinator' || creation.requestedBy.agentId !== principal.agentId ||
          !principal.creationTemplates?.includes(creation.result.templateSessionId)) fail('FORBIDDEN', 'Creation belongs to another coordinator or template');
      if (creation.result.state !== 'failed') return creation.result;
      const { error, completedAt, ...rest } = creation.result;
      creation.result = { ...rest, state: 'pending', retryCount: (rest.retryCount || 0) + 1,
        lastError: error || 'SESSION_CREATION_FAILED', lastFailedAt: completedAt || null,
        retryRequestedAt: new Date().toISOString() };
      return creation.result;
    });
    this.emit('change');
    return result;
  }
  async prepareProjectTask(principal, input, operationId, conversationId) {
    requireIdentity(principal);
    if (principal.role !== 'coordinator') fail('FORBIDDEN', 'Coordinator identity required');
    return this.transaction(state => {
      state.projectTasks ||= {};
      const id = key([principal.repositoryId, input.taskId]);
      const fingerprint = hash(canonical(input));
      const previous = state.projectTasks[id];
      if (previous) {
        if (previous.conversationId !== conversationId) fail('CONFLICT', 'Project task belongs to another conversation');
        if (previous.fingerprint === fingerprint) return previous;
        if (previous.stage !== 'brief-rejected' || previous.operationId === operationId) fail('CONFLICT', 'Project task already has different requirements');
      }
      return state.projectTasks[id] = { ...structuredClone(input), repositoryId: principal.repositoryId,
        conversationId, fingerprint, operationId, stage: 'brief', createdAt: new Date().toISOString(),
        brief: { ref: `project-brief:${input.taskId}`, version: randomUUID() } };
    });
  }
  async projectTasks(principal) {
    requireIdentity(principal);
    if (!['human', 'coordinator'].includes(principal.role)) fail('FORBIDDEN', 'Project task access required');
    return this.transaction(state => Object.values(state.projectTasks || {}).filter(item => item.repositoryId === principal.repositoryId), { readOnly: true });
  }
  async projectTaskStatuses(principal) {
    requireIdentity(principal);
    if (!['human', 'coordinator'].includes(principal.role)) fail('FORBIDDEN', 'Project task access required');
    return this.transaction(state => {
      const executions = new Map(Object.values(state.tasks || {}).filter(task => task.repositoryId === principal.repositoryId)
        .map(task => [key([task.id, task.session?.id]), task]));
      return Object.values(state.projectTasks || {}).filter(item =>
        item.repositoryId === principal.repositoryId && item.itemId && item.nodeId && ['todo', 'bug'].includes(item.kind))
        .map(item => {
          const execution = executions.get(key([item.taskId, item.sessionId]));
          return { taskId: item.taskId, itemId: item.itemId, nodeId: item.nodeId, kind: item.kind,
            sessionId: item.sessionId || null, state: execution?.stage || item.stage, projectStage: item.stage,
            updatedAt: item.updatedAt || item.createdAt, ...(item.error ? { error: item.error } : {}) };
        });
    }, { readOnly: true });
  }
  async reviewProjectTask(principal, taskId, brief, input) {
    requireIdentity(principal);
    if (principal.role !== 'human' || !['approved', 'rejected'].includes(input.decision) || typeof input.id !== 'string' || !input.id) fail('FORBIDDEN', 'A human decision and stable receipt are required');
    return this.transaction(state => {
      const task = state.projectTasks?.[key([principal.repositoryId, taskId])];
      if (!task || canonical(task.brief) !== canonical(brief)) fail('CONFLICT', 'Project requirements changed');
      const review = { id: input.id, decision: input.decision, reason: input.reason || '' };
      if (task.review) {
        if (canonical(task.review) !== canonical(review)) fail('CONFLICT', 'Requirements already reviewed');
        return task;
      }
      task.review = review; task.reviewIssuer = structuredClone(principal); task.stage = input.decision === 'approved' ? 'queued' : 'brief-rejected';
      return task;
    });
  }
  async updateProjectTask(principal, taskId, changes, { reserveLimit } = {}) {
    requireIdentity(principal);
    if (principal.role !== 'coordinator') fail('FORBIDDEN', 'Coordinator scheduler required');
    return this.transaction(state => {
      const task = state.projectTasks?.[key([principal.repositoryId, taskId])];
      if (!task) fail('NOT_FOUND', 'Project task missing');
      const transitions = { queued: ['creating'], creating: ['starting', 'failed'], starting: ['dispatched', 'queued', 'failed'], dispatched: ['completed'] };
      if (changes.stage && changes.stage !== task.stage && !transitions[task.stage]?.includes(changes.stage)) return task;
      if (reserveLimit !== undefined) {
        if (task.stage !== 'queued') return task;
        const active = Object.values(state.projectTasks).filter(item => item.repositoryId === principal.repositoryId && ['creating', 'starting', 'dispatched'].includes(item.stage)).length;
        if (active >= reserveLimit) {
          task.error = 'WAITING_CAPACITY'; task.updatedAt = new Date().toISOString(); return task;
        }
      }
      Object.assign(task, structuredClone(changes), { updatedAt: new Date().toISOString() });
      return task;
    });
  }
  async pendingSessionCreations(principal) {
    requireIdentity(principal);
    if (principal.role !== 'device') fail('FORBIDDEN', 'Only the owning device can receive creation requests');
    return this.transaction(state => Object.values(state.sessionCreations || {})
      .filter(item => item.repositoryId === principal.repositoryId && item.deviceId === principal.deviceId && item.result.state === 'pending')
      .slice(0, 20).map(item => item.result), { readOnly: true });
  }
  async sessionCreations(principal) {
    requireIdentity(principal);
    if (principal.role !== 'human') fail('FORBIDDEN', 'Only the project human can inspect creation records');
    return this.transaction(state => Object.values(state.sessionCreations || {})
      .filter(item => item.repositoryId === principal.repositoryId).map(item => item.result), { readOnly: true });
  }
  async creationTemplate(principal, sessionId) {
    requireIdentity(principal);
    if (principal.role !== 'device') fail('FORBIDDEN', 'Device identity required');
    return this.transaction(state => {
      const item = Object.values(state.sessionCreations || {}).find(item => item.repositoryId === principal.repositoryId &&
        item.deviceId === principal.deviceId && item.result.sessionId === sessionId && item.result.state === 'registered');
      if (!item) return null;
      const binding = requireBinding(state, principal, { id: sessionId, generation: item.result.generation });
      return binding.worktreeId === item.result.worktreeId ? item.result.templateSessionId : null;
    }, { readOnly: true });
  }
  async finishSessionCreation(principal, input) {
    requireIdentity(principal);
    if (principal.role !== 'device') fail('FORBIDDEN', 'Only the owning device can report creation');
    if (!input || Object.keys(input).some(k => !['id', 'error'].includes(k)) || typeof input.id !== 'string' ||
        input.error !== undefined && (typeof input.error !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(input.error))) fail('INVALID_ARGUMENT', 'Provide the original creation ID and optional error code');
    return this.transaction(state => {
      const item = state.sessionCreations?.[input.id];
      if (!item || item.repositoryId !== principal.repositoryId || item.deviceId !== principal.deviceId) fail('FORBIDDEN', 'Creation is not assigned to this device');
      if (item.result.state !== 'pending') {
        if (item.result.error !== input.error) fail('ID_REUSED', 'Creation outcome differs');
        return item.result;
      }
      const binding = state.bindings[bindingKey(principal, item.result.sessionId)];
      if (!input.error && (!binding || binding.deviceId !== principal.deviceId || binding.worktreeId === item.templateWorktreeId)) fail('CONFLICT', 'Register the new Session in an independent worktree before acknowledging');
      item.result = { ...item.result, state: input.error ? 'failed' : 'registered',
        ...(input.error ? { error: input.error } : { worktreeId: binding.worktreeId, generation: binding.generation }),
        completedAt: new Date().toISOString() };
      return item.result;
    });
  }
  async submitApprovedTask(principal, request, resolveTask, workflow = {}) {
    requireIdentity(principal);
    if (!['human', 'coordinator'].includes(principal.role)) fail('FORBIDDEN', 'Human approval or approved project requirements required');
    if (!request || typeof request.operationId !== 'string' || !request.operationId.trim() || request.operationId.length > 128) fail('INVALID_ARGUMENT', 'A stable operationId is required');
    if (!request.session || typeof request.session.id !== 'string' || !Number.isSafeInteger(request.session.generation)) fail('INVALID_ARGUMENT', 'A bound Session is required');
    return this.transaction(async state => {
      const binding = requireBinding(state, principal, request.session);
      const projectTask = request.projectTaskId && state.projectTasks?.[key([principal.repositoryId, request.projectTaskId])];
      if (principal.role === 'coordinator' && (!projectTask || projectTask.review?.decision !== 'approved' || projectTask.sessionId !== request.session.id)) fail('FORBIDDEN', 'Project approval does not authorize this execution Session');
      state.taskDispatches ||= {};
      const dispatchKey = key([...principalKey(principal), 'task-dispatch', request.operationId]);
      const fingerprint = hash(canonical(request));
      const prior = state.taskDispatches[dispatchKey];
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('ID_REUSED', 'Task dispatch ID already has different content');
        return prior.result;
      }
      const resolved = await resolveTask();
      if (projectTask && (resolved.taskId !== projectTask.taskId || canonical(resolved.nodeIds) !== canonical(projectTask.nodeIds) || resolved.mainVersion !== projectTask.mainVersion || resolved.mode && resolved.mode !== 'reviewed' || resolved.text !== JSON.stringify({ v: 1, taskId: projectTask.taskId, text: projectTask.text, acceptance: projectTask.acceptance, nodeIds: projectTask.nodeIds, mainVersion: projectTask.mainVersion }))) fail('CONFLICT', 'Dispatch differs from approved project requirements');
      const taskId = resolved.taskId;
      const coordinator = { ...principal, deviceId: 'cloud-service', agentId: 'cloud-coordinator', role: 'coordinator', bindings: { [request.session.id]: binding.worktreeId } };
      const prefix = `dispatch:${hash(canonical([principal.repositoryId, request.operationId])).slice(0, 32)}`;
      const emitted = message => {
        validateMessage(message);
        const queue = queueFor(state, principal, request.session);
        const previous = queue.items.find(item => item.message.id === message.id);
        if (previous) return previous.seq;
        const seq = ++queue.latestSeq;
        queue.items.push({ seq, message: structuredClone(message) });
        return seq;
      };
      const brief = await reduceWorkflow(state, coordinator, { v: 2, id: `${prefix}:brief`, type: 'brief.submit', session: request.session, payload: { taskId, text: resolved.text } }, emitted, workflow);
      await reduceWorkflow(state, coordinator, { v: 2, id: `${prefix}:brief-review`, type: 'review.request', session: request.session, payload: { kind: 'brief', ref: brief.ref, version: brief.version, taskId } }, emitted, workflow);
      await reduceWorkflow(state, projectTask?.reviewIssuer || principal, { v: 2, id: `${prefix}:approved`, type: 'review.result', session: request.session, payload: { kind: 'brief', ref: brief.ref, version: brief.version, decision: 'approved', reason: projectTask?.review.reason || '用户在 Cloud 工作台确认分配' } }, emitted, workflow);
      const assigned = await reduceWorkflow(state, coordinator, { v: 2, id: `${prefix}:assign`, type: 'task.assign', session: request.session, payload: { taskId, briefRef: brief.ref, briefVersion: brief.version, sessionId: request.session.id, nodeIds: resolved.nodeIds, mainVersion: resolved.mainVersion, ...(resolved.mode ? { mode: resolved.mode } : {}) } }, emitted, workflow);
      const result = { deliveryId: request.operationId, taskId, sessionId: request.session.id, state: assigned.stage === 'queued' ? 'queued' : 'cloud_queued', taskVersion: assigned.version };
      state.taskDispatches[dispatchKey] = { fingerprint, result };
      return result;
    }).then(result => { this.emit('change'); return result; });
  }
  async taskStatus(principal, session, taskId) {
    requireIdentity(principal);
    return this.transaction(state => {
      requireBinding(state, principal, session);
      let task = state.tasks[scopedObjectKey(principal, session, `task:${taskId}`)];
      if (!task && principal.role === 'human') {
        const older = Object.values(state.tasks).filter(value => value.repositoryId === principal.repositoryId && value.session.id === session.id && value.id === taskId && value.stage === 'finished');
        if (older.length === 1) task = older[0];
      }
      if (!task) fail('NOT_FOUND', 'Task is not registered in this Session');
      const queue = queueFor(state, principal, task.session);
      const outcomes = task.assignmentSeq
        ? Object.values(queue.consumers || {}).map(consumer => consumer.outcomes?.[task.assignmentSeq]).filter(Boolean)
        : [];
      const delivered = outcomes.find(item => item.deliveryState === 'received') || outcomes.find(item => item.deliveryState) || outcomes[0];
      const blockingTask = task.stage === 'queued'
        ? Object.values(state.tasks).find(value => value.repositoryId === principal.repositoryId && canonical(value.session) === canonical(task.session) && value.id !== task.id && value.busy)
        : null;
      const stateName = task.stage === 'finished' ? (task.result?.outcome === 'success' ? 'completed' : task.result?.outcome || 'unknown') : task.stage === 'queued' ? 'queued'
        : ['plan-ready', 'plan-rejected'].includes(task.stage) ? 'waiting_review'
          : task.stage === 'executing' ? 'executing'
            : task.stage !== 'assigned' ? task.stage
              : delivered?.deliveryState === 'received' ? 'codex_received'
                : delivered?.deliveryState === 'uncertain' ? 'uncertain'
                  : delivered ? 'local_received' : 'cloud_queued';
      return { taskId: task.id, sessionId: session.id, state: stateName, stage: task.stage, version: task.version,
        ...(blockingTask ? { queue: { reason: 'executor-busy', blockedByTaskId: blockingTask.id } } : {}),
        ...(task.result ? { result: { outcome: task.result.outcome, summary: task.result.summary, finishedAt: task.result.finishedAt } } : {}) };
    }, { readOnly: true });
  }
  async taskRecord(principal, session, taskId) {
    requireIdentity(principal);
    return this.transaction(state => {
      requireBinding(state, principal, session);
      const task = state.tasks[scopedObjectKey(principal, session, `task:${taskId}`)];
      if (!task) fail('NOT_FOUND', 'Task is not registered in this Session');
      return structuredClone(task);
    }, { readOnly: true });
  }
  async workflowTasks(principal, session) {
    requireIdentity(principal);
    return this.transaction(state => {
      requireBinding(state, principal, session);
      return Object.values(state.tasks).filter(task => task.repositoryId === principal.repositoryId && canonical(task.session) === canonical(session));
    }, { readOnly: true });
  }
  async humanTaskResult(principal, sessionId, taskId) {
    requireIdentity(principal);
    if (principal.role !== 'human') fail('FORBIDDEN', 'Human review requires browser authority');
    return this.transaction(state => {
      const tasks = Object.values(state.tasks).filter(task => task.repositoryId === principal.repositoryId && task.session.id === sessionId && task.id === taskId);
      if (tasks.length !== 1) fail('NOT_FOUND', 'Task result is missing or ambiguous');
      const task = tasks[0];
      if (task.stage !== 'finished' || !task.result) fail('CONFLICT', 'Agent has not submitted a final result');
      return { taskId, sessionId, version: task.version, result: structuredClone(task.result) };
    }, { readOnly: true });
  }
  async handle(principal, input, options = {}) {
    return this.execute(principal, input, async (state, p, message, emit) => {
      const payload = message.payload;
      if (message.type === 'workbench.read' && options.workbenchRead) return options.workbenchRead(p, message);
      if (workflowTypes.has(message.type)) {
        const taskId = payload?.taskId;
        if (taskId) {
          const task = state.tasks[scopedObjectKey(p, message.session, `task:${taskId}`)];
          const projectTask = Object.values(state.projectTasks || {}).find(item => item.taskId === taskId);
          if (task && projectTask) {
            const brief = task.brief && state.objects[scopedObjectKey(p, message.session, task.brief.ref)]?.versions?.[task.brief.version]?.content;
            const text = `${projectTask.text || ''} ${projectTask.acceptance || ''} ${brief?.text || ''}`;
            task.verificationOnly = projectTask.verificationOnly === true || /链路验证|只读|不修改(?:业务)?(?:文件|代码)|无业务(?:文件|代码)|不改(?:动)?业务/.test(text);
          }
        }
        return reduceWorkflow(state, p, message, emit, options.workflow);
      }
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
        for (const creation of Object.values(state.sessionCreations || {})) {
          if (creation.repositoryId !== p.repositoryId || creation.result.sessionId !== payload.sessionId || creation.result.state !== 'pending') continue;
          if (creation.deviceId !== p.deviceId || creation.templateWorktreeId === binding.worktreeId) fail('FORBIDDEN', 'Create this Session only on its assigned device and an independent worktree');
          creation.result = { ...creation.result, state: 'registered', worktreeId: binding.worktreeId,
            generation: binding.generation, completedAt: new Date().toISOString() };
        }
        state.bindings[id] = binding;
        queueFor(state, p, { id: payload.sessionId, generation: binding.generation });
        return { session: { id: payload.sessionId, generation: binding.generation }, bindingVersion: binding.version };
      }
      if (message.type === 'sync.heartbeat') {
        const sessions = [], rejected = [];
        let firstError;
        for (const s of payload.sessions) {
          try {
            requireBinding(state, p, s);
            const queue = queueFor(state, p, s);
            const consumer = consumerFor(queue, p);
            if (s.ackedSeq > consumer.ackedSeq) fail('CONFLICT', 'Client acknowledgement is ahead of durable server state');
            sessions.push({ id: s.id, generation: s.generation, latestSeq: queue.latestSeq, ackedSeq: consumer.ackedSeq });
          } catch (error) {
            if (!['FORBIDDEN', 'STALE_SESSION', 'CONFLICT'].includes(error.code)) throw error;
            firstError ||= error;
            rejected.push({ id: s.id, generation: s.generation, code: error.code });
          }
        }
        if (!sessions.length && firstError) throw firstError;
        return { sessions, ...(rejected.length ? { rejected } : {}) };
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
  async executionReport(principal, session, { deliveryId, stage, summary, outcome = 'success' }) {
    return this.transaction(state => {
      requireBinding(state, principal, session);
      const message = queueFor(state, principal, session).items.find(item => item.message.id === deliveryId)?.message;
      if (!message || message.type !== 'task.assign' || message.payload.mode !== 'session') fail('NOT_FOUND', 'No Session task matches this delivery');
      if (!['started', 'finished'].includes(stage)) fail('INVALID_ARGUMENT', 'Expected start or finish');
      return validateMessage({ v: 2, id: `${deliveryId}:${stage}`, type: 'task.report', session,
        payload: { taskId: message.payload.taskId, stage, data: { deliveryId, ...(stage === 'finished' ? { outcome, summary } : {}) } } });
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
  async rememberSessionNames(principal, sessions) {
    requireIdentity(principal);
    const update = state => {
      for (const session of sessions) {
        const binding = requireBinding(state, principal, session);
        if (session.name) binding.name = session.name;
        if (session.platform) binding.platform = session.platform;
      }
    };
    const state = await this.immutableState();
    if (!sessions.some(session => {
      const binding = requireBinding(state, principal, session);
      return session.name && session.name !== binding.name || session.platform && session.platform !== binding.platform;
    })) return;
    await this.transaction(update);
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
