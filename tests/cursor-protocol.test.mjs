import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProtocolStore } from '../scripts/shared/protocol-store.mjs';
import { scopedObjectKey } from '../scripts/shared/protocol-workflow.mjs';

const owner = { repositoryId: 'cursor-project', deviceId: 'paired-device', agentId: 'cursor-session', role: 'device' };
const human = { ...owner, agentId: 'workbench-human', role: 'human' };
const session = { id: 'cursor-session', generation: 1 };
const message = (id, type, payload) => ({ v: 2, id, type, session, payload });
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-protocol-'));
  const store = new ProtocolStore(directory);
  await store.handle(owner, { v: 2, id: 'bind', type: 'session.bind', payload: { sessionId: session.id, worktreeId: 'native-worktree', agentId: owner.agentId, expectedBindingVersion: '' } }, { verifyBinding: () => true });
  return { directory, store }; // User requested local evidence preservation; no files are removed.
}

test('Cursor native messages use the paired Session queue and return the same durable two-way conversation', async () => {
  const { directory, store } = await fixture();
  const prompt = message('first', 'native.prompt', { text: 'Complete a small task' });
  const first = await store.handle(human, prompt);
  assert.equal(first.data.state, 'queued');
  assert.deepEqual(await new ProtocolStore(directory).handle(human, prompt), first);
  const pending = await store.nativeConversation(human, session);
  assert.equal(pending.pending, true); assert.deepEqual(pending.messages, [{ id: 'first:user', role: 'user', text: prompt.payload.text }]);
  const read = await store.handle(owner, message('read', 'sync.read', { afterSeq: 0, limit: 10 }));
  assert.equal(read.data.messages.length, 1); assert.deepEqual(read.data.messages[0].message, prompt);
  const result = message('result', 'native.result', { requestId: 'first', status: 'finished', text: 'Task output, not acceptance', truncated: false });
  assert.equal((await store.handle(owner, result)).data.recorded, true);
  const view = await new ProtocolStore(directory).nativeConversation(human, session);
  assert.equal(view.pending, false); assert.equal(view.messages[1].text, result.payload.text);
  assert.equal(view.messages[1].status, 'finished');
  await store.handle(owner, { ...result, id: 'same-result-new-id' });
  assert.deepEqual(await store.nativeConversation(human, session), view);
  await assert.rejects(store.handle(owner, { ...result, id: 'contradictory-result', payload: { ...result.payload, status: 'failed' } }), { code: 'CONFLICT' });
  await store.handle(human, message('follow-up', 'native.prompt', { text: 'Explain your change' }));
  assert.equal((await store.nativeConversation(human, session)).messages.length, 3);
  const state = await store.transaction(state => state, { readOnly: true });
  assert.deepEqual(state.tasks, {}, 'Native output cannot manufacture a workflow approval or completion');
});

test('Cursor native conversation rejects cross-project/device/generation access and unmatched results', async () => {
  const { store } = await fixture();
  const prompt = message('first', 'native.prompt', { text: 'Inspect only' });
  await assert.rejects(store.handle(owner, prompt), { code: 'FORBIDDEN' });
  await store.handle(human, prompt);
  for (const principal of [{ ...owner, deviceId: 'foreign' }, { ...human, repositoryId: 'foreign' }, { ...owner, role: 'executor' }]) {
    await assert.rejects(store.nativeConversation(principal, session), { code: 'FORBIDDEN' });
  }
  await assert.rejects(store.nativeConversation(human, { ...session, generation: 2 }), { code: 'STALE_SESSION' });
  const result = message('result', 'native.result', { requestId: 'missing', status: 'failed', text: '', error: 'CURSOR_FAILED', truncated: false });
  await assert.rejects(store.handle(owner, result), { code: 'NOT_FOUND' });
  await assert.rejects(store.handle(human, { ...result, payload: { ...result.payload, requestId: 'first' } }), { code: 'FORBIDDEN' });
  await assert.rejects(store.handle({ ...owner, deviceId: 'foreign' }, result), { code: 'FORBIDDEN' });
  assert.equal((await store.nativeConversation(human, session)).messages.length, 1);
});

test('Cursor direct prompts cannot bypass an active approved workflow task', async () => {
  const { store } = await fixture();
  const prior = message('accepted-before-assignment', 'native.prompt', { text: 'Previously accepted, not yet delivered' });
  const accepted = await store.handle(human, prior);
  await store.transaction(state => { state.tasks[scopedObjectKey(owner, session, 'task:assigned')] = { id: 'assigned', repositoryId: owner.repositoryId, session, stage: 'executing' }; });
  await assert.rejects(store.handle(human, prior), { code: 'CONFLICT' });
  await assert.rejects(store.handle(human, message('bypass', 'native.prompt', { text: 'Unrelated new task' })), { code: 'CONFLICT' });
  assert.deepEqual((await store.nativeConversation(human, session)).messages, [{ id: prior.id + ':user', role: 'user', text: prior.payload.text }]);
  await store.transaction(state => { state.tasks[scopedObjectKey(owner, session, 'task:assigned')].stage = 'closed'; });
  assert.deepEqual(await store.handle(human, prior), accepted, 'the original receipt is retained, not replaced by a later gate failure');
  assert.equal((await store.handle(human, message('idle', 'native.prompt', { text: 'Now follow up' }))).data.state, 'queued');
});

test('Cursor local direct chat also respects a task assigned through the paired-device inbox', async () => {
  const { store } = await fixture();
  await store.receiveNotification(owner, message('assigned', 'task.assign', { taskId: 'remote-task', briefRef: 'brief', briefVersion: 'version', sessionId: session.id, nodeIds: ['N1'], mainVersion: 'main', mode: 'reviewed' }));
  await assert.rejects(store.handle(human, message('local-bypass', 'native.prompt', { text: 'Unrelated work' })), { code: 'CONFLICT' });
  await store.receiveNotification(owner, message('remote-finished', 'task.report', { taskId: 'remote-task', stage: 'finished', data: { deliveryId: 'assigned', outcome: 'success', summary: 'Real remote result' } }));
  assert.equal((await store.handle(human, message('local-follow-up', 'native.prompt', { text: 'Explain this result' }))).data.state, 'queued');
});
