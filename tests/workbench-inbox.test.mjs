import '../.github/scripts/test-environment.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { AgentInbox, describeChanges } from '../scripts/workbench/inbox.mjs';
import { MapStore } from '../scripts/workbench/store.mjs';
import { startServer } from '../scripts/workbench/server.mjs';
import { request } from '../scripts/workbench/cli.mjs';
import { atomicWrite, encode, hash, pause } from '../scripts/workbench/io.mjs';

const human = { kind: 'human', sessionId: 'workbench' };
const agent = { kind: 'agent', sessionId: 'inbox-test' };
const fixtureRoots = [];
after(async () => {
  const temporary = await fs.realpath(os.tmpdir());
  for (const root of fixtureRoots) {
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), temporary);
    assert.ok(path.basename(resolved).startsWith('cg-inbox-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-inbox-'));
  fixtureRoots.push(root);
  const ctx = path.join(root, '.codex/context');
  await fs.mkdir(path.join(ctx, 'sessions'), { recursive: true });
  const doc = { v: 1, project: 'test', root: { id: 'T0', title: '测试图', children: [{ id: 'N1', title: '测试节点', purpose: '原文', memories: [], children: [] }] } };
  await fs.writeFile(path.join(ctx, 'map.json'), encode(doc));
  await fs.writeFile(path.join(ctx, 'sessions.jsonl'), JSON.stringify({ session_id: agent.sessionId }) + '\n');
  const store = await new MapStore(root).init();
  const call = async route => { assert.match(route, /^\/api\/changes/); await store.serial(() => store.refresh()); return store.changes(new URL(route, 'http://local').searchParams.get('cursor')); };
  const inbox = new AgentInbox(root, agent.sessionId, call);
  const edit = (fields, actor = human) => store.commit({ baseVersion: store.version, operationId: randomUUID(), operations: [{ type: 'update', id: 'N1', fields }] }, actor, ['N1']);
  return { root, ctx, store, call, inbox, edit };
}

test('explicit baseline does not replay historical edits or mutate the map', async t => {
  const f = await fixture(); t.after(() => f.store.close());
  await f.edit({ title: '已存在的内容' });
  const before = hash(await fs.readFile(f.store.file));
  await assert.rejects(f.inbox.read(), { code: 'INBOX_NOT_STARTED' });
  assert.equal((await f.inbox.read({ start: true })).initialized, true);
  assert.equal((await f.inbox.read()).pending, false);
  assert.equal(hash(await fs.readFile(f.store.file)), before);
});

test('pending batch survives adapter restart; exact ack is idempotent and later changes remain queued', async t => {
  const f = await fixture(); t.after(() => f.store.close());
  await f.inbox.read({ start: true });
  await f.edit({ purpose: '人类第一处修改' });
  const first = await f.inbox.read();
  assert.equal(first.pending, true);
  assert.equal(first.changes[0].fields.purpose.after.value, '人类第一处修改');
  await f.edit({ title: '随后修改' });
  const restarted = new AgentInbox(f.root, agent.sessionId, f.call);
  assert.equal((await restarted.read()).receipt, first.receipt);
  await assert.rejects(restarted.acknowledge('wrong'), { code: 'RECEIPT_MISMATCH' });
  await restarted.acknowledge(first.receipt);
  assert.equal((await restarted.acknowledge(first.receipt)).duplicate, true);
  const second = await restarted.read();
  assert.notEqual(second.receipt, first.receipt);
  assert.equal(second.changes[0].fields.title.after.value, '随后修改');
  await restarted.acknowledge(second.receipt);
  assert.equal((await restarted.read()).pending, false);
});

test('own writes do not wake a loop; human and other-session changes do', async t => {
  const f = await fixture(); t.after(() => f.store.close());
  await f.inbox.read({ start: true });
  await f.edit({ title: 'Agent自己的修改' }, agent);
  assert.equal((await f.inbox.read()).pending, false);
  await f.edit({ purpose: '另一个会话' }, { kind: 'agent', sessionId: 'another' });
  const other = await f.inbox.read(); assert.equal(other.events[0].actor.sessionId, 'another');
  await f.inbox.acknowledge(other.receipt);
  await f.edit({ title: '自己的修改2' }, agent);
  await f.edit({ purpose: '人工修改' });
  const mixed = await f.inbox.read();
  assert.equal(mixed.events.length, 1); assert.equal(mixed.events[0].actor.kind, 'human');
  assert.equal(mixed.changes.find(c => c.id === 'N1').fields.purpose.after.value, '人工修改');
});

test('offline edits and journal truncation are reported as gaps, never silently acknowledged', async t => {
  const f = await fixture(); t.after(() => f.store.close());
  await f.inbox.read({ start: true });
  await f.edit({ title: 'own' }, agent);
  const offline = structuredClone(f.store.doc); offline.root.children[0].purpose = '服务关闭期间的改动';
  await f.store.close(); await fs.writeFile(f.store.file, encode(offline));
  f.store = await new MapStore(f.root).init();
  const call = async route => f.store.changes(new URL(route, 'http://local').searchParams.get('cursor'));
  const restarted = new AgentInbox(f.root, agent.sessionId, call);
  const batch = await restarted.read();
  assert.equal(batch.journalGap, true); assert.equal(batch.changes[0].fields.purpose.after.value, '服务关闭期间的改动');
  await restarted.acknowledge(batch.receipt);
  f.store.events = []; f.store.cursor = null;
  assert.equal((await restarted.read()).journalGap, true);
});

test('file event wakes a waiting Agent with actual local text', async t => {
  const f = await fixture(); t.after(() => f.store.close());
  await f.inbox.read({ start: true });
  const waiting = f.inbox.wait(4000);
  await pause(50);
  const next = structuredClone(f.store.doc); next.root.children[0].memories = [{ text: '来自磁盘的即时文本' }];
  const started = performance.now();
  await atomicWrite(f.store.file, encode(next));
  const batch = await waiting;
  const elapsedMs = performance.now() - started;
  assert.equal(batch.pending, true); assert.ok(elapsedMs < 2500);
  assert.equal(batch.events[0].actor.kind, 'external');
  assert.equal(batch.changes[0].fields.memories.after.value[0].text, '来自磁盘的即时文本');
  console.log(JSON.stringify({ check: 'file-to-waiting-agent', elapsedMs: Math.round(elapsedMs) }));
});

test('no-change timeout removes watchers and session inboxes remain independent', async t => {
  const f = await fixture(); t.after(() => f.store.close());
  await f.inbox.read({ start: true });
  const other = new AgentInbox(f.root, 'second-session', f.call); await other.read({ start: true });
  assert.equal((await f.inbox.wait(20)).pending, false);
  await f.edit({ purpose: '两个订阅者' });
  const a = await f.inbox.read(), b = await other.read();
  await f.inbox.acknowledge(a.receipt);
  assert.equal((await other.read()).receipt, b.receipt);
});

test('concurrent same-session readers do not overwrite receipts', async t => {
  const f = await fixture(); t.after(() => f.store.close());
  await f.inbox.read({ start: true }); await f.edit({ purpose: '并发读取' });
  const slow = new AgentInbox(f.root, agent.sessionId, async route => { await pause(60); return f.call(route); });
  const results = await Promise.allSettled([slow.read(), slow.read()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'INBOX_BUSY');
  assert.equal((await f.inbox.read()).receipt, results.find(r => r.status === 'fulfilled').value.receipt);
});

test('actual consumer crash releases a dead process lock without losing the pending batch', async t => {
  const f = await fixture(); t.after(() => f.store.close());
  await f.inbox.read({ start: true }); await f.edit({ purpose: '重启后仍需送达' });
  const batch = await f.inbox.read();
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e',
      'import fs from "node:fs";fs.writeFileSync(process.argv[1],JSON.stringify({pid:process.pid}),{flag:"wx"});process.exit(71);', f.inbox.lock], { windowsHide: true, stdio: 'ignore' });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.equal(code, 71);
  const restarted = new AgentInbox(f.root, agent.sessionId, f.call);
  assert.equal((await restarted.read()).receipt, batch.receipt);
  await restarted.acknowledge(batch.receipt);
  assert.equal((await restarted.read()).pending, false);
});

test('invalid file and unfinished commit preserve the last acknowledged baseline', async t => {
  const f = await fixture(); t.after(() => f.store.close());
  await f.inbox.read({ start: true });
  const state = await fs.readFile(f.inbox.file, 'utf8'), raw = await fs.readFile(f.store.file);
  await fs.writeFile(f.store.file, '{'); await assert.rejects(f.inbox.read());
  assert.equal(await fs.readFile(f.inbox.file, 'utf8'), state);
  await fs.writeFile(f.store.file, raw);
  await fs.writeFile(f.store.pendingFile, encode({ operationId: 'pending' }));
  await assert.rejects(f.inbox.read(), { code: 'INBOX_UNSTABLE' });
  assert.equal(await fs.readFile(f.inbox.file, 'utf8'), state);
  await fs.writeFile(f.store.pendingFile, 'null\n');
});

test('node removal, field removal, moves and document metadata are summarized', () => {
  const before = { project: 'a', root: { id: 'T0', title: 'root', children: [{ id: 'N1', title: 'old', purpose: 'remove', children: [] }, { id: 'N2', title: 'delete', children: [] }] } };
  const after = { project: 'b', root: { id: 'T0', title: 'root', children: [{ id: 'N3', title: 'new', children: [{ id: 'N1', title: 'old', children: [] }] }] } };
  const changes = describeChanges(before, after);
  assert.equal(changes.find(c => c.id === 'N1').type, 'moved');
  assert.equal(changes.find(c => c.id === 'N1').fields.purpose.after.present, false);
  assert.equal(changes.find(c => c.id === 'N2').type, 'deleted');
  assert.equal(changes.find(c => c.id === 'N3').type, 'created');
  assert.equal(changes.find(c => c.type === 'document').fields.project.after.value, 'b');
});

test('HTTP integration uses Agent identity and never requests a browser checkpoint', async t => {
  const f = await fixture(); await f.store.close();
  const server = await startServer({ root: f.root, port: 0 }); t.after(() => server.close());
  const { token } = await request(server.state, '/api/session', { method: 'POST', body: { sessionId: agent.sessionId } });
  const inbox = new AgentInbox(f.root, agent.sessionId, (route, params = {}) => request(server.state, route, { ...params, token }));
  // A connected but unresponsive page would make /api/state fail with UI_PENDING.
  const abort = new AbortController();
  const stream = await fetch(new URL('/api/events?clientId=unresponsive', server.state.url), { headers: { Authorization: `Bearer ${server.humanToken}` }, signal: abort.signal });
  try {
    await inbox.read({ start: true });
    await server.store.commit({ baseVersion: server.store.version, operationId: randomUUID(), operations: [{ type: 'update', id: 'N1', fields: { purpose: 'HTTP通知' } }] }, human);
    const batch = await inbox.read(); assert.equal(batch.pending, true);
    await assert.rejects(request(server.state, '/api/state', { token }), { code: 'UI_PENDING' });
    await inbox.acknowledge(batch.receipt);
  } finally { abort.abort(); await stream.body.cancel().catch(() => {}); }
});
