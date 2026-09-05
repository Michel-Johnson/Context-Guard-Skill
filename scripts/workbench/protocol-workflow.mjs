import { randomUUID } from 'node:crypto';
import { canonical, fail } from './protocol.mjs';
import { hash } from './io.mjs';

export const workflowTypes = new Set(['brief.submit', 'review.request', 'review.result', 'task.assign', 'task.report', 'task.rework', 'ci.request', 'ci.result', 'executor.state', 'task.control']);
export const scopedObjectKey = (p, session, ref) => hash(canonical([p.repositoryId, session.id, session.generation, ref]));

// All effects stay inside ProtocolStore's transaction. Model calls and GitHub
// polling belong to authenticated adapters, never to this state machine.
export async function reduceWorkflow(state, principal, message, emit, policy = {}) {
  const { payload: p, session } = message;
  const belongs = value => value.repositoryId === principal.repositoryId && canonical(value.session) === canonical(session);
  const role = (...roles) => { if (!roles.includes(principal.role)) fail('FORBIDDEN', 'This operation requires a different registered role'); };
  const taskKey = id => scopedObjectKey(principal, session, `task:${id}`);
  const read = (ref, version, kind) => {
    const object = state.objects[scopedObjectKey(principal, session, ref)];
    const saved = object?.versions[version || object.latest];
    if (!saved || kind && saved.kind !== kind) fail('NOT_FOUND', 'Referenced object or version is missing');
    return { ...saved, version: version || object.latest };
  };
  const put = (ref, kind, content, version = randomUUID()) => {
    const key = scopedObjectKey(principal, session, ref);
    const object = state.objects[key] ||= { latest: '', versions: {} };
    object.versions[version] = { kind, content: structuredClone(content) }; object.latest = version;
    return { ref, version };
  };
  const changed = task => { task.version = randomUUID(); return { taskId: task.id, version: task.version, stage: task.stage }; };
  const notify = () => emit({ ...message, id: randomUUID() });
  if (message.type === 'brief.submit') {
    role('coordinator');
    const key = taskKey(p.taskId), previous = state.tasks[key];
    if (previous && !['brief', 'brief-rejected'].includes(previous.stage)) fail('CONFLICT', 'The approved task cannot be rewritten');
    const brief = put(`brief:${p.taskId}`, 'brief', { text: p.text, taskId: p.taskId });
    const task = state.tasks[key] = { id: p.taskId, repositoryId: principal.repositoryId, session, brief, stage: 'brief', busy: false };
    notify();
    return { ...changed(task), ...brief };
  }
  let task = p.taskId ? state.tasks[taskKey(p.taskId)] : null;
  if (message.type === 'review.result') {
    task = Object.values(state.tasks).find(value => belongs(value) &&
      value.review?.ref === p.ref && value.review?.version === p.version && value.review?.kind === p.kind);
  }
  if (message.type === 'executor.state') {
    const executorId = principal.role === 'device'
      ? Object.values(state.bindings).find(binding => binding.sessionId === session.id && binding.deviceId === principal.deviceId)?.agentId
      : principal.agentId;
    if (p.agentId !== executorId) fail('FORBIDDEN', 'Executor identity differs');
    const tasks = Object.values(state.tasks).filter(value => belongs(value) && value.busy);
    if (p.state === 'idle' && tasks.length || p.state === 'busy' && !tasks.some(value => value.id === p.taskId)) fail('CONFLICT', 'Executor state is determined by the task lifecycle');
    return { state: tasks.length ? 'busy' : 'idle', ...(tasks.length ? { taskId: tasks[0].id } : {}) };
  }
  if (!task) fail('NOT_FOUND', 'Task is not registered in this Session');
  const at = (...stages) => { if (!stages.includes(task.stage)) fail('CONFLICT', 'Task is at a different stage', { currentVersion: task.version }); };
  if (message.type === 'review.request') {
    role('coordinator');
    if (p.kind === 'brief') {
      at('brief');
      if (p.ref !== task.brief.ref || p.version !== task.brief.version) fail('CONFLICT', 'Brief version differs');
    } else {
      at('plan-ready');
      if (p.ref !== task.plan.ref || p.version !== task.plan.version || p.requirementsRef !== task.brief.ref || p.requirementsVersion !== task.brief.version) fail('CONFLICT', 'Plan or approved requirements differ');
    }
    task.review = structuredClone(p); notify(); return changed(task);
  }
  if (message.type === 'review.result') {
    role(p.kind === 'brief' ? 'human' : 'coordinator');
    if (p.receiptId) fail('FORBIDDEN', 'Review receipts are issued by the backend');
    at(p.kind === 'brief' ? 'brief' : 'plan-ready');
    const receiptId = randomUUID();
    const receipt = put(receiptId, 'reviewReceipt', { ...p, receiptId, issuer: principal.agentId }, receiptId);
    task[`${p.kind}Review`] = { ...receipt, decision: p.decision };
    task.stage = p.decision === 'approved' ? (p.kind === 'brief' ? 'approved' : 'executing') : `${p.kind}-rejected`;
    delete task.review;
    emit({ ...message, id: randomUUID(), payload: { ...p, receiptId } });
    const status = changed(task);
    return { ...status, taskVersion: status.version, receiptId, version: receipt.version };
  }
  if (message.type === 'task.assign') {
    role('coordinator'); at('approved');
    if (p.briefRef !== task.brief.ref || p.briefVersion !== task.brief.version || task.briefReview?.decision !== 'approved') fail('CONFLICT', 'Human approval does not match this brief');
    if (Object.values(state.tasks).some(value => belongs(value) && value.busy)) fail('CONFLICT', 'Executor is already busy');
    if (!await policy.verifyRouting?.(principal, message)) fail('FORBIDDEN', 'Main version and node access could not be verified');
    task.assignment = structuredClone(p); task.busy = true; task.stage = 'assigned'; notify(); return changed(task);
  }
  if (message.type === 'task.report') {
    role('executor', 'device');
    if (!task.busy) fail('CONFLICT', 'Task is not active');
    if (p.stage === 'planReady') {
      at('assigned', 'plan-rejected', 'rework'); read(p.data.planRef, p.data.planVersion, 'plan');
      task.plan = { ref: p.data.planRef, version: p.data.planVersion }; task.sourceSha = p.data.sourceSha; task.stage = 'plan-ready';
    } else if (p.stage === 'progress') {
      at('executing');
      if (p.data.seq <= (task.progress?.seq ?? -1)) fail('CONFLICT', 'Progress sequence did not advance');
      task.progress = structuredClone(p.data);
    } else if (p.stage === 'interrupted') {
      if (task.interrupted && Date.parse(p.data.occurredAt) <= Date.parse(task.interrupted.occurredAt)) fail('CONFLICT', 'Interruption observation did not advance');
      task.interrupted = structuredClone(p.data);
      if (task.stage !== 'interrupted') task.previousStage = task.stage;
      task.stage = 'interrupted';
    } else if (p.stage === 'handoff') {
      at('executing');
      const refs = [p.data.ciTodoRef, ...p.data.unitTestRefs, ...p.data.experienceRefs];
      task.references = Object.fromEntries(refs.map(ref => [ref, read(ref).version]));
      read(p.data.ciTodoRef, task.references[p.data.ciTodoRef], 'ciTodo');
      for (const ref of p.data.unitTestRefs) read(ref, task.references[ref], 'evidence');
      for (const ref of p.data.experienceRefs) read(ref, task.references[ref], 'experience');
      task.handoff = structuredClone(p.data); task.sourceSha = p.data.sourceSha; task.stage = 'awaiting-ci';
    } else {
      if (!task.control || p.data.controlId !== task.control.id) fail('CONFLICT', 'Control receipt differs');
      if (p.stage === 'cancelled') { at('cancelling'); task.stage = 'cancelled'; }
      else if (p.stage === 'resumed') { at('resuming'); task.stage = task.previousStage; }
      else {
        at('closing');
        if (!await policy.verifyClose?.(principal, task, p.data)) fail('FORBIDDEN', 'Close receipt is not verified');
        task.stage = 'closed'; task.busy = false;
      }
    }
    notify(); return changed(task);
  }
  if (message.type === 'ci.request') {
    role('coordinator', 'ci'); at('awaiting-ci');
    if (p.sourceSha !== task.sourceSha || p.ciTodoRef !== task.handoff.ciTodoRef || canonical(p.unitTestRefs) !== canonical(task.handoff.unitTestRefs)) fail('CONFLICT', 'CI request differs from the handoff');
    task.stage = 'testing'; notify(); return changed(task);
  }
  if (message.type === 'ci.result') {
    role('ci'); at('testing');
    if (p.sourceSha !== task.sourceSha) fail('CONFLICT', 'CI tested a different source commit');
    if (p.verdict === 'passed' && p.checks.some(check => check.status !== 'passed')) fail('CONFLICT', 'CI checks do not support the verdict');
    if (new Set(p.checks.map(check => check.testId)).size !== p.checks.length) fail('INVALID_ARGUMENT', 'Duplicate test ID');
    const todoRef = task.handoff.ciTodoRef, todoVersion = task.references[todoRef];
    const todo = read(todoRef, todoVersion, 'ciTodo');
    if (read(todoRef).version !== todoVersion) fail('CONFLICT', 'CI TODO changed after handoff');
    const items = todo.content.items;
    if (!Array.isArray(items) || !items.length || items.some(item => typeof item?.id !== 'string' || !item.id || item.id.length > 128) || new Set(items.map(item => item.id)).size !== items.length) fail('INVALID_ARGUMENT', 'CI TODO requires uniquely numbered items');
    if (p.checks.some(check => !items.some(item => item.id === check.todoId))) fail('CONFLICT', 'CI result references an unknown TODO');
    if (p.verdict === 'passed' && items.some(item => !p.checks.some(check => check.todoId === item.id && check.status === 'passed'))) fail('CONFLICT', 'CI did not cover every handed-off TODO');
    const references = {};
    for (const check of p.checks) {
      references[check.evidenceRef] = read(check.evidenceRef, undefined, 'evidence').version;
      if (check.reproductionRef) references[check.reproductionRef] = read(check.reproductionRef, undefined, 'evidence').version;
    }
    task.ci = { ...put(`ci:${p.taskId}:${randomUUID()}`, 'ciResult', { ...p, references }), verdict: p.verdict };
    const annotated = items.map(item => {
      const checks = p.checks.filter(check => check.todoId === item.id);
      return { ...item, status: checks.length && checks.every(check => check.status === 'passed') ? 'done' : 'pending', testIds: checks.map(check => check.testId) };
    });
    task.ciTodoResult = put(todoRef, 'ciTodo', { ...todo.content, items: annotated, ciResultRef: task.ci.ref });
    task.stage = p.verdict === 'passed' ? 'awaiting-merge' : 'ci-failed';
    notify();
    return { ...changed(task), ...task.ci, ciTodo: task.ciTodoResult };
  }
  if (message.type === 'task.rework') {
    role('coordinator'); at('ci-failed');
    if (p.sourceSha !== task.sourceSha || p.ciResultRef !== task.ci.ref) fail('CONFLICT', 'Rework does not reference the failed revision');
    const result = read(task.ci.ref, task.ci.version, 'ciResult');
    if (p.failedTestIds.some(id => !result.content.checks.some(check => check.testId === id && check.status !== 'passed'))) fail('CONFLICT', 'Rework test IDs differ from CI evidence');
    task.stage = 'rework'; notify(); return changed(task);
  }
  if (message.type === 'task.control') {
    role('coordinator');
    if (p.expectedVersion !== task.version) fail('CONFLICT', 'Task changed', { currentVersion: task.version });
    if (!task.busy) fail('CONFLICT', 'Task has no execution slot');
    if (p.action === 'complete') {
      at('awaiting-merge', 'cancelled');
      if (!await policy.verifyCompletion?.(principal, task, p.data)) fail('FORBIDDEN', 'Merge and archive receipts are not verified');
      task.stage = 'closing';
    } else if (p.action === 'resume') { at('interrupted', 'cancelled'); task.stage = 'resuming'; }
    else { if (['closing', 'closed', 'cancelling'].includes(task.stage)) fail('CONFLICT', 'Control already pending'); task.previousStage = task.stage; task.stage = 'cancelling'; }
    task.control = { id: message.id, action: p.action }; emit(structuredClone(message)); return changed(task);
  }
  fail('INVALID_ARGUMENT', 'Unsupported task operation');
}
