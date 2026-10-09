import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProtocolStore } from '../scripts/shared/protocol-store.mjs';
import { scopedObjectKey } from '../scripts/shared/protocol-workflow.mjs';

const baseline = 'a'.repeat(40), finalSource = 'b'.repeat(40), revisedBaseline = 'c'.repeat(40);
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-plan-baseline-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProtocolStore(directory), session = { id: 'synthetic-executor', generation: 1 };
  const executor = { repositoryId: 'synthetic-repository', deviceId: 'synthetic-device', agentId: session.id, role: 'executor' };
  const coordinator = { ...executor, role: 'coordinator' }, human = { ...executor, role: 'human' };
  const ci = { ...executor, agentId: 'synthetic-independent-tester', role: 'ci', bindings: { [session.id]: 'executor-tree' } };
  const message = (type, payload, id = randomUUID()) => ({ v: 2, id, type, session, payload });
  const send = async (actor, type, payload) => (await store.handle(actor, message(type, payload), {
    workflow: { verifyRouting: async () => true }, // External Main/node policy is synthetic, not human authorization.
  })).data;
  await store.handle(executor, { v: 2, id: 'synthetic-bind', type: 'session.bind', payload: {
    sessionId: session.id, agentId: executor.agentId, worktreeId: 'executor-tree', expectedBindingVersion: '',
  } }, { verifyBinding: () => true });
  const taskId = 'synthetic-task', brief = await send(coordinator, 'brief.submit', { taskId, text: 'Synthetic lifecycle fixture' });
  await send(coordinator, 'review.request', { kind: 'brief', taskId, ref: brief.ref, version: brief.version });
  await send(human, 'review.result', { kind: 'brief', ref: brief.ref, version: brief.version, decision: 'approved', reason: 'Synthetic human role' });
  await send(coordinator, 'task.assign', { taskId, briefRef: brief.ref, briefVersion: brief.version,
    sessionId: session.id, nodeIds: ['synthetic-node'], mainVersion: 'synthetic-main' });
  const task = () => store.taskRecord(coordinator, session, taskId);
  const prepare = async (sourceSha = baseline, ref = 'synthetic-plan') => {
    const plan = await send(executor, 'object.put', { ref, kind: 'plan', baseVersion: '', content: { paths: ['src'], steps: ['Synthetic step'] } });
    const report = message('task.report', { taskId, stage: 'planReady', data: { planRef: ref, planVersion: plan.version, sourceSha } });
    return { plan, report };
  };
  const approve = async (plan, decision = 'approved') => {
    await send(coordinator, 'review.request', { kind: 'plan', taskId, ref: plan.ref, version: plan.version,
      requirementsRef: brief.ref, requirementsVersion: brief.version, rulesVersion: 'synthetic-rules' });
    return send(coordinator, 'review.result', { kind: 'plan', ref: plan.ref, version: plan.version, decision, reason: 'Synthetic review' });
  };
  const handoff = async () => {
    const todo = await send(executor, 'object.put', { ref: 'synthetic-todo', kind: 'ciTodo', baseVersion: '', content: { items: [{ id: 'one' }] } });
    await send(executor, 'task.report', { taskId, stage: 'handoff', data: { sourceSha: finalSource,
      ciTodoRef: todo.ref, unitTestRefs: [], experienceRefs: [] } });
    return todo;
  };
  return { directory, store, session, executor, coordinator, human, ci, taskId, message, send, task, prepare, approve, handoff };
}

test('Plan baseline survives approved handoff, exact receipt replay and reopening the original Core', async t => {
  const f = await fixture(t), prepared = await f.prepare();
  assert.equal(Object.hasOwn(await f.task(), 'planSourceSha'), false, 'assignment alone supplies no Plan baseline');
  const receipt = await f.store.handle(f.executor, prepared.report);
  let task = await f.task();
  assert.equal(task.stage, 'plan-ready'); assert.equal(task.planSourceSha, baseline); assert.equal(task.sourceSha, baseline);
  assert.deepEqual(task.plan, { ref: prepared.plan.ref, version: prepared.plan.version }, 'Plan identity shape stays compatible');
  assert.equal(task.planReview, undefined, 'a submitted baseline is not approval');
  const approval = await f.approve(prepared.plan);
  task = await f.task(); assert.equal(task.stage, 'executing'); assert.equal(task.planReview.ref, approval.receiptId);
  await f.handoff();
  task = await f.task(); assert.equal(task.stage, 'awaiting-ci'); assert.equal(task.sourceSha, finalSource);
  assert.equal(task.planSourceSha, baseline); assert.deepEqual(task.plan, prepared.plan);
  assert.deepEqual(await f.store.handle(f.executor, prepared.report), receipt);
  assert.deepEqual(await f.task(), task, 'old Plan report replay cannot rewind the final handoff');
  const reopened = new ProtocolStore(f.directory);
  assert.deepEqual(await reopened.taskRecord(f.coordinator, f.session, f.taskId), task);
  const saved = JSON.parse(await fs.readFile(reopened.file, 'utf8'));
  assert.deepEqual(saved.tasks[scopedObjectKey(f.coordinator, f.session, `task:${f.taskId}`)], task);
});

test('Rejected or reworked Plan gets a new baseline without an old successful report rolling it back', async t => {
  const f = await fixture(t), old = await f.prepare();
  await f.store.handle(f.executor, old.report); await f.approve(old.plan, 'rejected');
  assert.equal((await f.task()).stage, 'plan-rejected');
  const revised = await f.prepare(revisedBaseline, 'synthetic-revised-plan');
  await f.store.handle(f.executor, revised.report); await f.approve(revised.plan);
  const todo = await f.handoff();
  await f.send(f.coordinator, 'ci.request', { taskId: f.taskId, sourceSha: finalSource, ciTodoRef: todo.ref, unitTestRefs: [] });
  const evidence = await f.send(f.ci, 'object.put', { ref: 'synthetic-failed-evidence', baseVersion: '', kind: 'evidence', content: { observed: 'synthetic failure' } });
  const result = await f.send(f.ci, 'ci.result', { taskId: f.taskId, sourceSha: finalSource, verdict: 'failed',
    checks: [{ testId: 'synthetic-check', todoId: 'one', status: 'failed', evidenceRef: evidence.ref, reproductionRef: evidence.ref }] });
  assert.equal((await f.task()).stage, 'ci-failed');
  await f.send(f.coordinator, 'task.rework', { taskId: f.taskId, sourceSha: finalSource, ciResultRef: result.ref, failedTestIds: ['synthetic-check'] });
  assert.equal((await f.task()).stage, 'rework');
  const next = await f.prepare('d'.repeat(40), 'synthetic-rework-plan');
  await f.store.handle(f.executor, next.report);
  const task = await f.task(); assert.equal(task.stage, 'plan-ready'); assert.equal(task.planSourceSha, 'd'.repeat(40));
  assert.equal(task.sourceSha, 'd'.repeat(40)); assert.deepEqual(task.plan, next.plan);
  await f.store.handle(f.executor, old.report); await f.store.handle(f.executor, revised.report);
  assert.deepEqual(await f.task(), task, 'successful old IDs return history, not permission to restore the old Plan');
  await assert.rejects(f.store.handle(f.executor, { ...old.report, payload: { ...old.report.payload,
    data: { ...old.report.payload.data, sourceSha: finalSource } } }), { code: 'ID_REUSED' });
  assert.deepEqual(await f.task(), task);
});

test('Failed, foreign or forged Plan reports cannot set a baseline or change the current task', async t => {
  const f = await fixture(t), prepared = await f.prepare(), before = await f.task();
  for (const [request, actor, code] of [
    [{ ...prepared.report, id: randomUUID(), payload: { ...prepared.report.payload, data: { ...prepared.report.payload.data, planVersion: 'foreign' } } }, f.executor, 'NOT_FOUND'],
    [{ ...prepared.report, id: randomUUID(), session: { ...f.session, generation: 2 } }, f.executor, 'STALE_SESSION'],
    [{ ...prepared.report, id: randomUUID() }, f.human, 'FORBIDDEN'],
    [{ ...prepared.report, id: randomUUID(), payload: { ...prepared.report.payload, data: { ...prepared.report.payload.data, sourceSha: 'not-a-sha' } } }, f.executor, 'INVALID_ARGUMENT'],
    [{ ...prepared.report, id: randomUUID(), payload: { ...prepared.report.payload, data: { ...prepared.report.payload.data, planSourceSha: revisedBaseline } } }, f.executor, 'INVALID_ARGUMENT'],
  ]) {
    await assert.rejects(f.store.handle(actor, request), { code }); assert.deepEqual(await f.task(), before);
  }
  await f.store.handle(f.executor, prepared.report); await f.approve(prepared.plan); await f.handoff();
  const handedOff = await f.task();
  await assert.rejects(f.store.handle(f.executor, { ...prepared.report, id: randomUUID() }), { code: 'CONFLICT' });
  assert.deepEqual(await f.task(), handedOff);
});

test('Plan baseline, notification and retry receipt commit atomically without a partial failed write', async t => {
  const f = await fixture(t), prepared = await f.prepare(), before = await fs.readFile(f.store.file);
  const failed = new ProtocolStore(f.directory, { beforeCommit: async () => {
    throw Object.assign(new Error('Synthetic storage failure'), { code: 'SYNTHETIC_STORAGE_FAILURE' });
  } });
  await assert.rejects(failed.handle(f.executor, prepared.report), { code: 'SYNTHETIC_STORAGE_FAILURE' });
  assert.deepEqual(await fs.readFile(f.store.file), before, 'no task, notification or successful receipt from the failed transaction persists');
  const reopened = new ProtocolStore(f.directory);
  assert.equal(Object.hasOwn(await reopened.taskRecord(f.coordinator, f.session, f.taskId), 'planSourceSha'), false);
  const receipt = await reopened.handle(f.executor, prepared.report);
  assert.equal(receipt.data.stage, 'plan-ready');
  assert.equal((await reopened.taskRecord(f.coordinator, f.session, f.taskId)).planSourceSha, baseline);
  assert.deepEqual(await reopened.handle(f.executor, prepared.report), receipt);
});

test('Reading or replaying a legacy task never guesses its Plan baseline from the final source SHA', async t => {
  const f = await fixture(t), prepared = await f.prepare();
  await f.store.handle(f.executor, prepared.report); await f.approve(prepared.plan); await f.handoff();
  // Explicit legacy fixture: an older Core did not persist this independent field.
  await f.store.transaction(state => { delete state.tasks[scopedObjectKey(f.coordinator, f.session, `task:${f.taskId}`)].planSourceSha; });
  const before = await fs.readFile(f.store.file), reopened = new ProtocolStore(f.directory);
  const task = await reopened.taskRecord(f.coordinator, f.session, f.taskId);
  assert.equal(task.sourceSha, finalSource); assert.equal(Object.hasOwn(task, 'planSourceSha'), false);
  assert.equal(Object.hasOwn((await reopened.workflowTasks(f.coordinator, f.session))[0], 'planSourceSha'), false);
  await reopened.handle(f.executor, prepared.report);
  assert.equal(Object.hasOwn(await reopened.taskRecord(f.coordinator, f.session, f.taskId), 'planSourceSha'), false);
  assert.deepEqual(await fs.readFile(f.store.file), before, 'no read/replay migration or replacement of old records');
});
