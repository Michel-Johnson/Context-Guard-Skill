import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProtocolStore } from '../scripts/workbench/protocol-store.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { withFileLock, pause } from '../scripts/workbench/io.mjs';

const principal = { repositoryId: 'repo-1', deviceId: 'device-1', agentId: 'agent-1' };
test('IF-040: concurrent stale-owner recovery never removes a new live lock', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-lock-recovery-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true });
  await once(child, 'exit');
  const file = path.join(dir, 'state.lock');
  await fs.writeFile(file, JSON.stringify({ pid: child.pid, host: os.hostname() }));
  let active = 0, peak = 0, completed = 0;
  await Promise.all(Array.from({ length: 16 }, () => withFileLock(file, async () => {
    active++; peak = Math.max(peak, active);
    await pause(5); completed++; active--;
  })));
  assert.equal(peak, 1); assert.equal(completed, 16);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});
const session = { id: 'session-1', generation: 1 };
const msg = (id, type, payload, scoped = true) => ({ v: 2, id, type, ...(scoped ? { session } : {}), payload });
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-protocol-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new ProtocolStore(dir);
  const bind = msg('bind', 'session.bind', { sessionId: session.id, worktreeId: 'wt-1', agentId: principal.agentId, expectedBindingVersion: '' }, false);
  await store.handle(principal, bind, { verifyBinding: () => true });
  return { dir, store, bind };
}
test('IF-006: concurrent retries persist one mutation, one notification and one receipt', async t => {
  const { store, dir } = await fixture(t);
  const input = msg('operation', 'object.put', { kind: 'plan', ref: 'p', baseVersion: '', content: {} });
  let calls = 0;
  const reduce = (state, p, m, emit) => { calls++; state.objects.p = { saved: true }; emit(msg('notification', 'sync.event', { latestSeq: 1 })); return { version: 'v1' }; };
  const replies = await Promise.all(Array.from({ length: 8 }, () => store.execute(principal, input, reduce)));
  assert.equal(calls, 1); replies.forEach(r => assert.deepEqual(r, replies[0]));
  assert.deepEqual(await new ProtocolStore(dir).execute(principal, input, () => assert.fail('replayed reducer')), replies[0]);
  await assert.rejects(store.execute(principal, { ...input, payload: { ...input.payload, ref: 'different' } }, reduce), { code: 'ID_REUSED' });
  const read = await store.handle(principal, msg('read', 'sync.read', { afterSeq: 0, limit: 50 }));
  assert.equal(read.data.messages.length, 1);
});
test('IF-007: failure before commit rolls back state, queue and receipt together', async t => {
  const { store, dir } = await fixture(t);
  const input = msg('operation', 'object.put', { kind: 'plan', ref: 'p', baseVersion: '', content: {} });
  const broken = new ProtocolStore(dir, { beforeCommit: () => { throw new Error('injected disk failure'); } });
  const reduce = (state, p, m, emit) => { state.objects.p = true; emit(msg('n', 'sync.event', { latestSeq: 1 })); return {}; };
  await assert.rejects(broken.execute(principal, input, reduce));
  const before = await store.handle(principal, msg('read-before', 'sync.read', { afterSeq: 0, limit: 50 }));
  assert.deepEqual(before.data.messages, []);
  await store.execute(principal, input, reduce);
  const after = await store.handle(principal, msg('read-after', 'sync.read', { afterSeq: 0, limit: 50 }));
  assert.equal(after.data.messages.length, 1);
});
test('IF-008: out-of-order acknowledgements do not skip unprocessed messages', async t => {
  const { store } = await fixture(t);
  await store.execute(principal, msg('produce', 'object.put', { kind: 'plan', ref: 'p', baseVersion: '', content: {} }), (state, p, m, emit) => {
    for (let i = 1; i <= 3; i++) emit(msg(`n${i}`, 'sync.event', { latestSeq: i })); return {};
  });
  const ack = (id, seq) => store.handle(principal, msg(id, 'sync.ack', { items: [{ seq, outcome: 'applied' }] }));
  assert.equal((await ack('ack-2', 2)).data.ackedSeq, 0);
  assert.equal((await ack('ack-1', 1)).data.ackedSeq, 2);
  await assert.rejects(ack('future', 4), { code: 'INVALID_ARGUMENT' });
  const read = await store.handle(principal, msg('read', 'sync.read', { afterSeq: 0, limit: 1 }));
  assert.equal(read.data.nextSeq, 1); assert.equal(read.data.hasMore, true);
  const beat = await store.handle(principal, msg('beat', 'sync.heartbeat', { sessions: [{ ...session, ackedSeq: 0 }] }, false));
  assert.deepEqual(beat.data.sessions, [{ ...session, ackedSeq: 2, latestSeq: 3 }]);
});

test('IF-028: coordinator acknowledgement cannot consume the executor delivery', async t => {
  const { store } = await fixture(t);
  const coordinator = { ...principal, deviceId: 'cloud', agentId: 'coordinator', role: 'coordinator', bindings: { [session.id]: 'wt-1' } };
  await store.execute(principal, msg('produce', 'object.put', { kind: 'plan', ref: 'p', baseVersion: '', content: {} }), (_state, _p, _m, emit) => { emit(msg('notice', 'sync.event', { latestSeq: 1 })); return {}; });
  await store.handle(coordinator, msg('coordinator-ack', 'sync.ack', { items: [{ seq: 1, outcome: 'applied' }] }));
  const beat = await store.handle(principal, msg('executor-beat', 'sync.heartbeat', { sessions: [{ ...session, ackedSeq: 0 }] }, false));
  assert.equal(beat.data.sessions[0].ackedSeq, 0);
  assert.equal(beat.data.sessions[0].latestSeq, 1);
  const denied = { ...coordinator, bindings: {} };
  await assert.rejects(store.handle(denied, msg('coordinator-read', 'sync.read', { afterSeq: 0, limit: 50 })), { code: 'FORBIDDEN' });
});

test('IF-031: immutable read cache observes another writer and cannot mutate stored state', async t => {
  const { store, dir } = await fixture(t);
  const initial = await store.immutableState();
  assert.equal(await store.immutableState(), initial);
  await assert.rejects(store.transaction(state => { state.format = 2; }, { readOnly: true }), TypeError);
  const writer = new ProtocolStore(dir);
  const saved = await writer.handle(principal, msg('external-write', 'object.put', { kind: 'plan', ref: 'new-plan', baseVersion: '', content: { text: 'updated' } }));
  const read = await store.handle(principal, msg('read-new', 'object.read', { ref: 'new-plan', version: saved.data.version }));
  assert.equal(read.data.content.text, 'updated');
  assert.notEqual(await store.immutableState(), initial);
  await fs.writeFile(store.file, 'corrupt fixture');
  await assert.rejects(store.immutableState());
});
test('IF-009: identities, generations and revoked authorization remain checked on replay', async t => {
  const { store } = await fixture(t);
  const input = msg('read', 'sync.read', { afterSeq: 0, limit: 50 });
  await store.handle(principal, input);
  await assert.rejects(store.handle({ ...principal, agentId: 'other' }, input), { code: 'FORBIDDEN' });
  await assert.rejects(store.handle({ ...principal, repositoryId: 'other' }, input), { code: 'FORBIDDEN' });
  await assert.rejects(store.handle(principal, { ...input, session: { ...session, generation: 2 } }), { code: 'STALE_SESSION' });
  await assert.rejects(store.handle(principal, input, { authorize: () => { throw new Error('access revoked'); } }));
  const bind = msg('bad-bind', 'session.bind', { sessionId: 'another', worktreeId: 'wt', agentId: principal.agentId, expectedBindingVersion: '' }, false);
  await assert.rejects(store.handle(principal, bind, { verifyBinding: async () => false }), { code: 'FORBIDDEN' });
});
test('IF-015: objects retain immutable versions and reject stale writes and forged review objects', async t => {
  const { store, dir } = await fixture(t);
  const put = (id, baseVersion, content) => store.handle(principal, msg(id, 'object.put', { kind: 'plan', ref: 'plan-1', baseVersion, content }));
  const first = await put('put-1', '', { text: 'first' });
  const second = await put('put-2', first.data.version, { text: 'second' });
  await assert.rejects(put('stale', first.data.version, { text: 'lost update' }), { code: 'CONFLICT' });
  const restarted = new ProtocolStore(dir);
  const read = version => restarted.handle(principal, msg(`read-${version}`, 'object.read', { ref: 'plan-1', version }));
  assert.deepEqual((await read(first.data.version)).data.content, { text: 'first' });
  assert.deepEqual((await read(second.data.version)).data.content, { text: 'second' });
  await assert.rejects(read('not-a-version'), { code: 'NOT_FOUND' });
  await assert.rejects(store.handle(principal, msg('forged', 'object.put', { kind: 'reviewReceipt', ref: 'approval', baseVersion: '', content: { decision: 'approved' } })), { code: 'INVALID_ARGUMENT' });
});
test('IF-017: idle heartbeats for 1/10/50 Sessions do not write data or accumulate receipts', async t => {
  const { dir, store } = await fixture(t);
  const sessions = [];
  for (let i = 0; i < 50; i++) {
    const id = `load-${i}`;
    await store.handle(principal, msg(`bind-${i}`, 'session.bind', { sessionId: id, worktreeId: 'wt', agentId: principal.agentId, expectedBindingVersion: '' }, false), { verifyBinding: () => true });
    sessions.push({ id, generation: 1, ackedSeq: 0 });
  }
  const before = await fs.readFile(store.file, 'utf8');
  const readOnly = new ProtocolStore(dir, { beforeCommit: () => assert.fail('heartbeat wrote storage') });
  for (const count of [1, 10, 50]) {
    const cpu = process.cpuUsage(), start = performance.now(); let bytes = 0;
    for (let i = 0; i < 3; i++) {
      const reply = await readOnly.handle(principal, msg(`beat-${count}-${i}`, 'sync.heartbeat', { sessions: sessions.slice(0, count) }, false));
      bytes += Buffer.byteLength(JSON.stringify(reply));
    }
    t.diagnostic(JSON.stringify({ sessions: count, heartbeatRepliesBytes: bytes, elapsedMs: performance.now() - start, cpu: process.cpuUsage(cpu), rssBytes: process.memoryUsage().rss }));
  }
  assert.equal(await fs.readFile(store.file, 'utf8'), before);
});
