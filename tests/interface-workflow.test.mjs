import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProtocolStore } from '../scripts/shared/protocol-store.mjs';
import { verifyTaskClose } from '../scripts/cloud/completion.mjs';
import { reduceWorkflow } from '../scripts/shared/protocol-workflow.mjs';

test('four approved Session tasks finish in durable FIFO order across success, failure and cancellation', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-session-fifo-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let store = new ProtocolStore(directory);
  const session = { id: 'test-session', generation: 1 };
  const device = { repositoryId: 'repo', deviceId: 'local', agentId: 'device', role: 'device' };
  const human = { ...device, agentId: 'human', role: 'human' };
  await store.handle(device, { v: 2, id: 'bind', type: 'session.bind', payload: {
    sessionId: session.id, worktreeId: 'wt', agentId: 'executor', expectedBindingVersion: '',
  } }, { verifyBinding: () => true });
  const tasks = ['z-bug', 'a-bug', 'z-todo', 'a-todo'];
  for (const taskId of tasks) {
    const result = await store.submitApprovedTask(human, { operationId: taskId, session }, async () => ({
      taskId, text: taskId, nodeIds: ['node'], mainVersion: 'main', mode: 'session',
    }), { verifyRouting: () => true });
    assert.equal(result.state, taskId === tasks[0] ? 'cloud_queued' : 'queued');
    if (taskId === tasks[1]) assert.deepEqual((await store.taskStatus(human, session, taskId)).queue,
      { reason: 'executor-busy', blockedByTaskId: tasks[0] });
  }
  const messages = () => store.transaction(state => Object.values(state.tasks));
  for (const [index, taskId] of tasks.entries()) {
    store = new ProtocolStore(directory);
    const saved = await messages(), active = saved.find(task => task.id === taskId);
    assert.deepEqual(saved.filter(task => task.busy).map(task => task.id), [taskId]);
    const deliveryId = active.assignmentNotification.id;
    const report = (stage, data) => ({ v: 2, id: `${taskId}-${stage}`, type: 'task.report', session,
      payload: { taskId, stage, data: { deliveryId, ...data } } });
    const start = report('started', {});
    await assert.rejects(store.handle(device, { ...start, payload: { ...start.payload, data: { deliveryId: 'another-delivery' } } }), { code: 'CONFLICT' });
    await store.handle(device, start);
    assert.equal((await store.taskStatus(human, session, taskId)).state, 'executing');
    const outcome = ['success', 'failed', 'cancelled', 'success'][index];
    const finished = report('finished', { outcome, summary: `Actual ${outcome} result` });
    await assert.rejects(store.handle(human, finished), { code: 'FORBIDDEN' });
    const result = await store.handle(device, finished);
    assert.equal(result.data.activatedTaskId, tasks[index + 1]);
    assert.deepEqual(await store.handle(device, finished), result);
    assert.equal((await store.taskStatus(human, session, taskId)).state, outcome === 'success' ? 'completed' : outcome);
  }
  assert.equal((await messages()).some(task => task.busy), false);
});

test('IF-027: acceptance releases execution while verified closure remains independent and cannot release another task', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-workflow-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let store = new ProtocolStore(directory), counter = 0;
  const session = { id: 's', generation: 1 }, sourceSha = 'a'.repeat(40);
  const executor = { repositoryId: 'repo', deviceId: 'local', agentId: 'executor', role: 'executor' };
  const coordinator = { ...executor, deviceId: 'cloud', agentId: 'coordinator', role: 'coordinator', bindings: { s: 'wt' } };
  const human = { ...executor, agentId: 'human', role: 'human' }, ci = { ...coordinator, agentId: 'ci', role: 'ci' };
  const send = async (principal, type, payload, options = {}) => (await store.handle(principal, { v: 2, id: `request-${++counter}`, type, session, payload }, options)).data;
  await store.handle(executor, { v: 2, id: 'bind', type: 'session.bind', payload: { sessionId: 's', worktreeId: 'wt', agentId: 'executor', expectedBindingVersion: '' } }, { verifyBinding: () => true });
  const brief = await send(coordinator, 'brief.submit', { taskId: 'task', text: 'Keep the workbench synchronized' });
  await send(coordinator, 'review.request', { taskId: 'task', kind: 'brief', ref: brief.ref, version: brief.version });
  const approval = { kind: 'brief', ref: brief.ref, version: brief.version, decision: 'approved', reason: 'Matches the requirement' };
  await assert.rejects(send(executor, 'review.result', approval), { code: 'FORBIDDEN' });
  await send(human, 'review.result', approval);
  const assignment = { taskId: 'task', briefRef: brief.ref, briefVersion: brief.version, sessionId: 's', nodeIds: ['node'], mainVersion: 'main-1' };
  await assert.rejects(send(coordinator, 'task.assign', assignment), { code: 'FORBIDDEN' });
  await send(coordinator, 'task.assign', assignment, { workflow: { verifyRouting: (_p, m) => m.payload.mainVersion === 'main-1' } });
  const secondBrief = await send(coordinator, 'brief.submit', { taskId: 'task-2', text: 'Queued follow-up' });
  await send(coordinator, 'review.request', { taskId: 'task-2', kind: 'brief', ref: secondBrief.ref, version: secondBrief.version });
  await send(human, 'review.result', { kind: 'brief', ref: secondBrief.ref, version: secondBrief.version, decision: 'approved', reason: 'Approved follow-up' });
  const queued = await send(coordinator, 'task.assign', { taskId: 'task-2', briefRef: secondBrief.ref, briefVersion: secondBrief.version, sessionId: 's', nodeIds: ['node'], mainVersion: 'main-1' }, { workflow: { verifyRouting: () => true } });
  assert.equal(queued.stage, 'queued');
  assert.equal((await store.taskStatus(human, session, 'task-2')).state, 'queued');
  const thirdBrief = await send(coordinator, 'brief.submit', { taskId: 'task-3', text: 'Third queued follow-up' });
  await send(coordinator, 'review.request', { taskId: 'task-3', kind: 'brief', ref: thirdBrief.ref, version: thirdBrief.version });
  await send(human, 'review.result', { kind: 'brief', ref: thirdBrief.ref, version: thirdBrief.version, decision: 'approved', reason: 'Third task approved' });
  await send(coordinator, 'task.assign', { taskId: 'task-3', briefRef: thirdBrief.ref, briefVersion: thirdBrief.version, sessionId: 's', nodeIds: ['node'], mainVersion: 'main-1' }, { workflow: { verifyRouting: () => true } });
  await assert.rejects(send(executor, 'executor.state', { agentId: 'executor', state: 'idle' }), { code: 'CONFLICT' });
  const plan = await send(executor, 'object.put', { kind: 'plan', ref: 'plan', baseVersion: '', content: { steps: ['Inspect', 'Implement', 'Test'] } });
  await send(executor, 'task.report', { taskId: 'task', stage: 'planReady', data: { planRef: plan.ref, planVersion: plan.version, sourceSha } });
  await send(coordinator, 'review.request', { taskId: 'task', kind: 'plan', ref: plan.ref, version: plan.version, requirementsRef: brief.ref, requirementsVersion: brief.version, rulesVersion: 'rules-1' });
  await assert.rejects(send(executor, 'task.report', { taskId: 'task', stage: 'progress', data: { seq: 1, summary: 'Started too early' } }), { code: 'CONFLICT' });
  await send(coordinator, 'review.result', { kind: 'plan', ref: plan.ref, version: plan.version, decision: 'approved', reason: 'Consistent with the brief and rules' });
  const progress = { taskId: 'task', stage: 'progress', data: { seq: 1, summary: 'Implemented' } };
  await send(executor, 'task.report', progress);
  await assert.rejects(send(executor, 'task.report', progress), { code: 'CONFLICT' });
  await send(executor, 'object.put', { kind: 'ciTodo', ref: 'ci-todo', baseVersion: '', content: { items: [{ id: 'todo-1', title: 'Cross-module regression' }, { id: 'todo-2', title: 'Recovery' }] } });
  await send(executor, 'object.put', { kind: 'evidence', ref: 'evidence', baseVersion: '', content: { command: 'node --test', exitCode: 0 } });
  await send(executor, 'task.report', { taskId: 'task', stage: 'handoff', data: { sourceSha, ciTodoRef: 'ci-todo', unitTestRefs: ['evidence'], experienceRefs: [] } });
  assert.equal((await send(executor, 'executor.state', { agentId: 'executor', state: 'busy', taskId: 'task' })).state, 'busy');
  await send(ci, 'ci.request', { taskId: 'task', sourceSha, ciTodoRef: 'ci-todo', unitTestRefs: ['evidence'] });
  await assert.rejects(send(ci, 'ci.result', { taskId: 'task', sourceSha, verdict: 'passed', checks: [{ testId: 'CI-1', todoId: 'unknown-todo', status: 'passed', evidenceRef: 'evidence' }] }), { code: 'CONFLICT' });
  const oneCheck = { testId: 'CI-1', todoId: 'todo-1', status: 'passed', evidenceRef: 'evidence' };
  await assert.rejects(send(ci, 'ci.result', { taskId: 'task', sourceSha, verdict: 'passed', checks: [oneCheck] }), { code: 'CONFLICT' });
  const ciResult = await send(ci, 'ci.result', { taskId: 'task', sourceSha, verdict: 'passed', checks: [oneCheck, { ...oneCheck, testId: 'CI-2', todoId: 'todo-2' }] });
  const annotated = await send(executor, 'object.read', ciResult.ciTodo);
  assert.deepEqual(annotated.content.items, [{ id: 'todo-1', title: 'Cross-module regression', status: 'done', testIds: ['CI-1'] }, { id: 'todo-2', title: 'Recovery', status: 'done', testIds: ['CI-2'] }]);
  store = new ProtocolStore(directory);
  const beforeAcceptance = await store.taskRecord(coordinator, session, 'task');
  await assert.rejects(send(coordinator, 'task.control', { taskId: 'task', action: 'complete', expectedVersion: beforeAcceptance.version, data: { archiveReceiptRef: 'archive' } }, { workflow: { verifyCompletion: () => true } }), { code: 'CONFLICT' });
  const acceptance = { kind: 'acceptance', ref: beforeAcceptance.ci.ref, version: beforeAcceptance.ci.version, decision: 'approved', reason: 'Human verified the tested SHA' };
  await assert.rejects(send(coordinator, 'review.result', acceptance), { code: 'FORBIDDEN' });
  const rejectedState = await store.transaction(state => structuredClone(state));
  await reduceWorkflow(rejectedState, human, { type: 'review.result', session, payload: { ...acceptance, decision: 'rejected', reason: 'Needs rework' } }, () => 0);
  assert.equal(Object.values(rejectedState.tasks).find(item => item.id === 'task').busy, true, 'rejection retains execution for rework');
  assert.equal(Object.values(rejectedState.tasks).find(item => item.id === 'task-2').stage, 'queued');
  const accepted = await send(human, 'review.result', acceptance);
  assert.equal(accepted.activatedTaskId, 'task-2');
  const replay = await store.handle(human, { v: 2, id: `request-${counter}`, type: 'review.result', session, payload: acceptance });
  assert.deepEqual(replay.data, accepted, 'lost acceptance responses replay without advancing again');
  store = new ProtocolStore(directory);
  assert.equal((await store.taskRecord(coordinator, session, 'task')).busy, false);
  assert.equal((await store.taskStatus(human, session, 'task-2')).state, 'cloud_queued');
  assert.equal((await store.taskStatus(human, session, 'task-3')).state, 'queued');
  await assert.rejects(send(executor, 'task.report', { taskId: 'task', stage: 'progress', data: { seq: 2, summary: 'Late execution cannot resume' } }), { code: 'CONFLICT' });
  const task = Object.values((await store.transaction(state => state)).tasks)[0];
  const complete = { taskId: 'task', action: 'complete', expectedVersion: task.version, data: { archiveReceiptRef: 'archive', gitReceiptRef: 'merge' } };
  await assert.rejects(send(coordinator, 'task.control', complete), { code: 'FORBIDDEN' });
  await send(coordinator, 'task.control', complete, { workflow: { verifyCompletion: (_p, current, receipts) => receipts.gitReceiptRef === 'merge' && receipts.archiveReceiptRef === 'archive' && { sourceSha: current.sourceSha, mergeSha: 'b'.repeat(40) } } });
  const controlId = `request-${counter}`;
  store = new ProtocolStore(directory);
  const savedTask = await store.taskRecord(coordinator, session, 'task');
  assert.equal(savedTask.completion.closeReceiptId, controlId);
  assert.equal(savedTask.completion.proof.sourceSha, savedTask.sourceSha);
  const closed = { taskId: 'task', stage: 'closed', data: { controlId, closeReceiptId: controlId } };
  await assert.rejects(send(executor, 'task.report', closed), { code: 'FORBIDDEN' });
  await assert.rejects(send(executor, 'task.report', { ...closed, data: { controlId, closeReceiptId: 'fabricated' } }, { workflow: { verifyClose: verifyTaskClose } }), { code: 'FORBIDDEN' });
  const closure = await send(executor, 'task.report', closed, { workflow: { verifyClose: verifyTaskClose } });
  assert.equal(closure.activatedTaskId, undefined);
  assert.equal((await store.taskStatus(human, session, 'task-3')).state, 'queued');
  assert.equal((await store.taskStatus(human, session, 'task-2')).state, 'cloud_queued');
  assert.equal((await send(executor, 'executor.state', { agentId: 'executor', state: 'busy', taskId: 'task-2' })).taskId, 'task-2');
});
