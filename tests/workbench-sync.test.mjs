import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { ensureServer } from '../scripts/workbench/cli.mjs';
import { MapStore } from '../scripts/workbench/store.mjs';
import { startServer } from '../scripts/workbench/server.mjs';
import { generateProjections } from '../scripts/workbench/projections.mjs';
import { applyOperations, diffTrees, validate } from '../prototype/map-model.mjs';
import { encode, hash, pause } from '../scripts/workbench/io.mjs';
const human = { kind: 'human', sessionId: 'workbench' }, agent = { kind: 'agent', sessionId: 'test-session' };
const fixtureRoots = [];
after(async () => {
  const temporary = await fs.realpath(os.tmpdir());
  for (const root of fixtureRoots) {
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), temporary);
    assert.ok(path.basename(resolved).startsWith('cg-sync-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-sync-'));
  fixtureRoots.push(root);
  const ctx = path.join(root, '.codex/context'); await fs.mkdir(path.join(ctx, 'sessions'), { recursive: true });
  const doc = { v: 1, project: 'test-project', unknownTop: { preserve: true }, root: { id: 'T0', title: '项目', kind: 'module', unknownNode: 42, children: [{ id: 'N1', title: '原始标题', kind: 'work', proposal: 'accepted', memories: [], bugs: [], children: [] }] } };
  await fs.writeFile(path.join(ctx, 'map.json'), encode(doc));
  await fs.writeFile(path.join(ctx, 'sessions.jsonl'), JSON.stringify({ session_id: agent.sessionId, event: 'session-start' }) + '\n');
  return { root, ctx, doc };
}
function edit(store, title, extras = {}) { return { baseVersion: store.version, operationId: randomUUID(), operations: [{ type: 'update', id: 'N1', fields: { title } }], ...extras }; }
async function until(fn, timeout = 4000) { const end = Date.now() + timeout; while (!await fn()) { assert.ok(Date.now() < end, 'condition timed out'); await pause(25); } }

test('write, preserve unknown data, reject stale update, persist idempotency across restart', async () => {
  const f = await fixture(); let store = await new MapStore(f.root).init();
  try {
    const stale = edit(store, '不应覆盖'), request = { baseVersion: store.version, operationId: randomUUID(), operations: [{ type: 'create', parentId: 'T0', node: { id: 'N2', title: '新增' } }] };
    const result = await store.commit(request, human); assert.equal(result.committed, true);
    await assert.rejects(store.commit(stale, human), { code: 'VERSION_CONFLICT' });
    await store.close(); store = await new MapStore(f.root).init();
    assert.equal((await store.commit(request, human)).duplicate, true);
    assert.equal(store.doc.root.children.length, 2); assert.equal(store.doc.root.unknownNode, 42); assert.deepEqual(store.doc.unknownTop, { preserve: true });
    assert.equal(hash(await fs.readFile(store.file)), result.version);
    await assert.rejects(store.commit({ ...request, operations: [] }, human), { code: 'ID_REUSED' });
  } finally { await store.close(); }
});

for (const point of ['after-pending', 'after-map', 'after-event', 'after-result']) {
  test(`restart recovery at ${point} does not duplicate create`, async () => {
    const f = await fixture(); let fail = true;
    let store = await new MapStore(f.root, { fault: async p => { if (p === point && fail) { fail = false; throw new Error('injected crash'); } } }).init();
    const request = { baseVersion: store.version, operationId: randomUUID(), operations: [{ type: 'create', parentId: 'T0', node: { id: 'N2', title: '崩溃恢复' } }] };
    try { await assert.rejects(store.commit(request, human)); await store.close(); store = await new MapStore(f.root).init();
      const result = await store.commit(request, human); assert.equal(result.committed, true); assert.equal(store.doc.root.children.filter(x => x.id === 'N2').length, 1);
    } finally { await store.close(); }
  });
}

test('concurrent submissions serialize, invalid JSON and external replacement recover', async () => {
  const f = await fixture(), store = await new MapStore(f.root).init();
  try {
    const results = await Promise.allSettled([store.commit(edit(store, '甲'), human), store.commit(edit(store, '乙'), human)]);
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    await fs.writeFile(store.file, '{'); await until(() => store.error); assert.ok(store.doc.root.children[0].title);
    const next = structuredClone(store.doc); next.root.children[0].title = '外部保存';
    await fs.writeFile(store.file + '.replace', encode(next)); await fs.rename(store.file + '.replace', store.file);
    await until(() => store.doc.root.children[0].title === '外部保存' && !store.error);
    assert.ok(store.events.at(-1).nodeIds.includes('N1')); assert.ok(store.events.at(-1).fields.includes('title'));
    assert.equal(store.changes('lost-cursor').reset, true); assert.equal(store.changes(store.cursor).changes.length, 0);
  } finally { await store.close(); }
});

test('permissions, field validation, cycles and missing references', async () => {
  const f = await fixture(), store = await new MapStore(f.root).init();
  try {
    await assert.rejects(store.commit(edit(store, '越权'), agent), { code: 'FORBIDDEN' });
    await store.commit(edit(store, '授权修改'), agent, ['N1']);
    await assert.rejects(store.commit(edit(store, '自确认', { operations: [{ type: 'update', id: 'N1', fields: { proposal: 'accepted' } }] }), agent, ['N1']), { code: 'FORBIDDEN' });
    await assert.rejects(store.commit(edit(store, '非法字段', { operations: [{ type: 'update', id: 'N1', fields: { origin: 'human' } }] }), agent, ['N1']), { code: 'INVALID_FIELDS' });
    assert.throws(() => applyOperations(store.doc, [{ type: 'move', id: 'T0', parentId: 'N1' }], human), { code: 'INVALID_MOVE' });
    assert.throws(() => applyOperations(store.doc, [{ type: 'update', id: 'N1', fields: { memories: [{ text: 'x', also: ['missing'] }] } }], human), { code: 'INVALID_REFERENCE' });
    const result = applyOperations(store.doc, [{ type: 'create', parentId: 'T0', node: { id: 'N2', title: '提议', proposal: 'accepted' } }], agent);
    assert.equal(result.doc.root.children[1].proposal, 'proposed');
  } finally { await store.close(); }
});

test('projection retains legacy/manual content, includes state and bugs, detects pending versions', async () => {
  const f = await fixture(); await fs.mkdir(path.join(f.ctx, 'cards')); await fs.writeFile(path.join(f.ctx, 'cards/N1.md'), '人工笔记不能丢失\n');
  f.doc.root.children[0].bugs.push({ id: 'B32', title: '回归坏例', status: 'open' });
  await generateProjections(f.root, f.doc, 'version-one');
  let card = await fs.readFile(path.join(f.ctx, 'cards/N1.md'), 'utf8'); assert.match(card, /人工笔记不能丢失/); assert.match(card, /B32/); assert.match(card, /sourceVersion: version-one/);
  await fs.appendFile(path.join(f.ctx, 'cards/N1.md'), '\n后续人工补充\n'); await generateProjections(f.root, f.doc, 'version-two');
  card = await fs.readFile(path.join(f.ctx, 'cards/N1.md'), 'utf8'); assert.match(card, /后续人工补充/); assert.equal(card.split('人工笔记不能丢失').length, 2); assert.doesNotMatch(card, /version-one/);
});

test('HTTP rejects forged role, origin, path access; sessions/scopes/revocation and migration preview', async () => {
  const f = await fixture(), running = await startServer({ root: f.root, port: 0 });
  const base = new URL(running.state.url).origin;
  const call = async (route, credential, data, headers = {}) => {
    const response = await fetch(base + route, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', ...headers }, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, data: await response.json() };
  };
  try {
    await fs.writeFile(path.join(f.ctx, 'l1-candidates.json'), '{"lenses":[]}');
    assert.equal((await call('/.codex/context/l1-candidates.json', running.humanToken)).status, 200);
    const registration = await call('/api/session', running.state.adminToken, { sessionId: agent.sessionId }); assert.equal(registration.status, 200);
    const credential = registration.data.token;
    assert.equal((await call('/api/session', running.state.adminToken, { sessionId: 'fake-session' })).status, 403);
    assert.equal((await call('/api/state', credential, null, { Origin: 'https://evil.invalid' })).status, 403);
    assert.equal((await call('/package.json', credential)).status, 404);
    assert.equal((await call('/api/access', credential, { sessionId: agent.sessionId, nodes: ['N1'], actor: 'human' })).status, 403);
    assert.equal((await call('/api/access', running.humanToken, { sessionId: agent.sessionId, nodes: ['N1'] })).status, 200);
    assert.equal((await call('/api/commit', credential, edit(running.store, 'CLI权限'))).status, 200);
    await call('/api/access', running.humanToken, { sessionId: agent.sessionId, nodes: [] });
    assert.equal((await call('/api/commit', credential, edit(running.store, '已撤权'))).status, 403);
    const cache = structuredClone(running.store.doc); cache.root.children[0].title = '旧缓存';
    const preview = await call('/api/migration-preview', running.humanToken, { doc: cache }); assert.equal(preview.status, 200); assert.equal(preview.data.operations.length, 1);
    assert.equal(running.store.doc.root.children[0].title, 'CLI权限'); assert.equal((await fs.stat(preview.data.backup)).isFile(), true);
  } finally { await running.close(); }
});

test('canvas inbox expansion and absent empty arrays do not create edits', async () => {
  const f = await fixture(), a = f.doc.root, b = structuredClone(a); b._inbox = b.children; b.children = []; b.files = [];
  assert.deepEqual(diffTrees(a, b), []); validate(f.doc);
});

for (const point of ['after-pending', 'after-map', 'after-event', 'after-result']) {
  test(`real process exit at ${point} reconciles the on-disk journal`, async () => {
    const f = await fixture(), baseVersion = hash(await fs.readFile(path.join(f.ctx, 'map.json')));
    const request = { baseVersion, operationId: randomUUID(), operations: [{ type: 'create', parentId: 'T0', node: { id: 'N2', title: '真实进程退出' } }] };
    const input = path.join(f.root, 'request.json'); await fs.writeFile(input, encode(request));
    const code = await new Promise((resolve, reject) => { const child = spawn(process.execPath, ['tests/crash-worker.mjs', f.root, point, input], { windowsHide: true, stdio: 'ignore' }); child.on('exit', resolve); child.on('error', reject); });
    assert.equal(code, 71);
    const store = await new MapStore(f.root).init();
    try {
      const result = await store.commit(request, human);
      if (point === 'after-pending') {
        assert.equal(result.committed, false); assert.equal(store.doc.root.children.length, 1);
        await store.commit({ ...request, operationId: randomUUID() }, human);
      } else assert.equal(result.committed, true);
      assert.equal(store.doc.root.children.filter(n => n.id === 'N2').length, 1);
    } finally { await store.close(); }
  });
}

test('actual Windows file lock: brief lock recovers; long lock respects wall-clock deadline', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture(), store = await new MapStore(f.root).init();
  async function lock(seconds) {
    const child = spawn('python', ['tests/win-file-lock.py', store.file, String(seconds)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error('lock helper failed')); }); });
    return child;
  }
  try {
    await lock(0.15); const begin = performance.now(); await store.commit(edit(store, '短暂占用后保存'), human); assert.ok(performance.now() - begin < 900);
    const old = hash(await fs.readFile(store.file)); const child = await lock(2); const started = performance.now();
    await assert.rejects(store.commit(edit(store, '不能替换'), human)); const elapsed = performance.now() - started;
    assert.ok(elapsed >= 300 && elapsed < 900, `bounded deadline, observed ${elapsed}ms`); assert.equal(hash(await fs.readFile(store.file)), old);
    await new Promise(resolve => child.once('exit', resolve));
  } finally { await store.close(); }
});

test('projection failure is explicit and direct authoritative reads remain available', async () => {
  const f = await fixture(), store = await new MapStore(f.root, { project: async () => { throw new Error('index disk fault'); } }).init();
  try { const result = await store.commit(edit(store, '地图已经保存'), human); assert.equal(result.committed, true); await until(() => store.projection.status === 'failed'); assert.equal(store.doc.root.children[0].title, '地图已经保存'); }
  finally { await store.close(); }
});

test('a legacy null-root map can be explicitly initialized but existing roots cannot be replaced', async () => {
  const f = await fixture(); await fs.writeFile(path.join(f.ctx, 'map.json'), encode({ v: 1, bootstrap: 'pending', root: null, flows: [] }));
  const store = await new MapStore(f.root).init();
  try {
    const operations = [{ type: 'initialize', project: 'legacy', node: { id: 'T0', title: 'Legacy project', kind: 'module' } }];
    await store.commit({ baseVersion: store.version, operationId: randomUUID(), operations }, agent);
    assert.equal(store.doc.root.proposal, 'proposed');
    await assert.rejects(store.commit({ baseVersion: store.version, operationId: randomUUID(), operations }, human), { code: 'INVALID_INITIALIZATION' });
  } finally { await store.close(); }
});

test('unknown external modification after interrupted commit freezes further writes', async () => {
  const f = await fixture(), raw = await fs.readFile(path.join(f.ctx, 'map.json'));
  const request = { baseVersion: hash(raw), operationId: randomUUID(), operations: [{ type: 'update', id: 'N1', fields: { title: 'Interrupted' } }] };
  const input = path.join(f.root, 'request.json'); await fs.writeFile(input, encode(request));
  await new Promise(resolve => { spawn(process.execPath, ['tests/crash-worker.mjs', f.root, 'after-map', input], { windowsHide: true, stdio: 'ignore' }).once('exit', resolve); });
  f.doc.root.title = 'Unknown external save'; await fs.writeFile(path.join(f.ctx, 'map.json'), encode(f.doc));
  const store = await new MapStore(f.root).init();
  try { assert.equal(store.blocked.code, 'RECOVERY_REQUIRED'); await assert.rejects(store.commit(edit(store, 'Must not write'), human), { code: 'RECOVERY_REQUIRED' }); }
  finally { await store.close(); }
});

test('legacy GET-only service is identified and preserved; a second Node owner is rejected', async () => {
  const f = await fixture(); await fs.mkdir(path.join(f.ctx, 'private'), { recursive: true });
  const legacy = http.createServer((_req, res) => res.end(JSON.stringify({ ok: true, root: f.root, pid: process.pid })));
  await new Promise(resolve => legacy.listen(0, '127.0.0.1', resolve));
  await fs.writeFile(path.join(f.ctx, 'private/workbench.json'), encode({ url: `http://127.0.0.1:${legacy.address().port}/prototype/workbench.html` }));
  try { await assert.rejects(ensureServer(f.root), { code: 'LEGACY_SERVICE' }); assert.equal(legacy.listening, true); }
  finally { await new Promise(resolve => legacy.close(resolve)); }
  const running = await startServer({ root: f.root, port: 0 });
  try { await assert.rejects(startServer({ root: f.root, port: 0 }), { code: 'ALREADY_RUNNING' }); }
  finally { await running.close(); }
});
