import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchSnapshots } from '../scripts/workbench/protocol-snapshots.mjs';
import { ProtocolStore } from '../scripts/workbench/protocol-store.mjs';

test('IF-034: fixed-version pages survive edits and restart, but never bypass Session or node grants', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-pages-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let snapshots = new WorkbenchSnapshots(directory);
  const principal = { repositoryId: 'repo', deviceId: 'device', agentId: 'agent' };
  const message = { v: 2, id: 'read', type: 'workbench.read', session: { id: 's', generation: 1 }, payload: { scope: 'session', cursor: '', limit: 1 } };
  let permitted = ['R', 'A'], version = 'v1';
  const doc = { v: 1, project: 'test', root: { id: 'R', title: 'root', children: [{ id: 'A', title: 'original', custom: 'preserve' }, { id: 'B', title: 'private' }] } };
  const options = { grants: async () => permitted, load: async () => ({ doc, version }) };
  const first = await snapshots.read(principal, message, options);
  assert.equal(first.items[0].node.id, 'A'); assert.equal(first.items[0].node.custom, 'preserve');
  doc.root.children[0].title = 'updated'; version = 'v2';
  snapshots = new WorkbenchSnapshots(directory);
  const second = await snapshots.read(principal, { ...message, payload: { ...message.payload, version: first.version, cursor: first.nextCursor } }, options);
  assert.equal(second.version, 'v1'); assert.equal(second.nextCursor, ''); assert.equal(second.items[0].node.children, undefined);
  assert.equal((await snapshots.read(principal, { ...message, payload: { ...message.payload, version: 'v1' } }, options)).items[0].node.title, 'original');
  const continuation = { ...message, payload: { ...message.payload, version: first.version, cursor: first.nextCursor } };
  await assert.rejects(snapshots.read({ ...principal, agentId: 'stranger' }, continuation, options), { code: 'FORBIDDEN' });
  await assert.rejects(snapshots.read(principal, { ...continuation, session: { id: 'other', generation: 1 } }, options), { code: 'FORBIDDEN' });
  permitted = ['A'];
  await assert.rejects(snapshots.read(principal, continuation, options), { code: 'FORBIDDEN' });
  await assert.rejects(snapshots.read(principal, { ...message, payload: { ...message.payload, nodeIds: ['B'] } }, options), { code: 'FORBIDDEN' });
});

test('IF-042: recovery pages pin Map and pending messages to one durable barrier without acknowledging execution', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-recovery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const principal = { repositoryId: 'repo', deviceId: 'device', agentId: 'agent' }, session = { id: 's', generation: 1 };
  const store = new ProtocolStore(path.join(directory, 'queue'));
  const msg = (id, type, payload) => ({ v: 2, id, type, session, payload });
  await store.handle(principal, { v: 2, id: 'bind', type: 'session.bind', payload: { sessionId: 's', worktreeId: 'wt', agentId: 'agent', expectedBindingVersion: '' } }, { verifyBinding: () => true });
  const emit = id => store.execute(principal, msg(`write-${id}`, 'object.put', { kind: 'plan', ref: id, baseVersion: '', content: {} }), (_state, _p, _input, enqueue) => {
    enqueue(msg(id, 'task.report', { taskId: 't', stage: 'progress', data: { seq: 1, summary: id } })); return {};
  });
  await emit('first'); await emit('second');
  await store.handle(principal, msg('ack-second', 'sync.ack', { items: [{ seq: 2, outcome: 'applied' }] }));
  let version = 'map-v1';
  const doc = { v: 1, project: 'test', root: { id: 'R', title: 'original' } };
  const load = async () => ({ doc: structuredClone(doc), version });
  const options = { load, grants: () => ['R'], capture: () => store.recoverySnapshot(principal, session, load) };
  const read = msg('read', 'workbench.read', { scope: 'session', recovery: true, cursor: '', limit: 1 });
  const pages = new WorkbenchSnapshots(path.join(directory, 'pages'));
  const first = await pages.read(principal, read, options);
  assert.equal(first.items[0].node.title, 'original'); assert.equal(first.mapVersion, 'map-v1');
  assert.equal(first.recovery.resumeAfterSeq, 2); assert.deepEqual(first.recovery.pendingMessages, []);
  await emit('third'); doc.root.title = 'changed'; version = 'map-v2';
  const second = await new WorkbenchSnapshots(path.join(directory, 'pages')).read(principal,
    { ...read, payload: { ...read.payload, cursor: first.nextCursor, version: first.version } }, options);
  assert.equal(second.recovery.resumeAfterSeq, 2);
  assert.deepEqual(second.recovery.pendingMessages.map(item => [item.seq, item.message.id]), [[1, 'first']]);
  assert.equal(second.nextCursor, '');
  const beat = await store.handle(principal, { v: 2, id: 'beat', type: 'sync.heartbeat', payload: { sessions: [{ ...session, ackedSeq: 0 }] } });
  assert.equal(beat.data.sessions[0].ackedSeq, 0); assert.equal(beat.data.sessions[0].latestSeq, 3);
});
