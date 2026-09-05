import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startCloudServer } from '../scripts/cloud/server.mjs';
import { checkpointSync, connectSync, ensureService, finishSync, prepareSync, pullSync, syncStatus, trackSync } from '../scripts/sync/client.mjs';
import { atomicWrite, encode } from '../scripts/workbench/io.mjs';
import { memoryConfigPath, sessionMemoryDir } from '../scripts/workbench/memory.mjs';
import { resolveProject } from '../scripts/workbench/project.mjs';

const node = (id, title) => ({ id, title, kind: 'work', state: 'dirty', purpose: '', memories: [], ideas: [], todos: [], bugs: [], dormant: [], files: [], owns: [], children: [] });
const document = () => ({
  v: 1, project: 'Sync Fixture', bootstrap: 'ready', flows: [],
  root: { ...node('T0', 'Sync Fixture'), kind: 'module', children: [node('N1', 'One'), node('N2', 'Two')] },
});

async function fixture() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-sync-cloud-'));
  const roots = [];
  const cloud = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir, adminToken: 'admin', browserToken: 'browser' });
  const create = await fetch(cloud.url + '/api/projects', {
    method: 'POST',
    headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'sync-fixture', name: 'Sync Fixture' }),
  }).then(response => response.json());
  async function local() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-sync-local-')); roots.push(root);
    await fs.mkdir(path.join(root, '.codex/context'), { recursive: true });
    await fs.writeFile(path.join(root, '.codex/context/map.json'), JSON.stringify(document(), null, 2) + '\n');
    return root;
  }
  return {
    cloud, token: create.syncToken, local,
    async dispose() {
      await cloud.close();
      await Promise.all([fs.rm(dataDir, { recursive: true, force: true }), ...roots.map(root => fs.rm(root, { recursive: true, force: true }))]);
    },
  };
}

async function edit(root, nodeId, purpose) {
  const file = path.join(root, '.codex/context/map.json');
  const doc = JSON.parse(await fs.readFile(file, 'utf8'));
  const target = doc.root.children.find(item => item.id === nodeId);
  target.purpose = purpose;
  await fs.writeFile(file, JSON.stringify(doc, null, 2) + '\n');
}

async function waitFor(check, message, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await check(); if (last) return last; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.fail(`${message}${last instanceof Error ? `: ${last.message}` : ''}`);
}

async function stopService(root) {
  const status = await syncStatus(root).catch(() => null);
  if (!status?.service?.pid) return;
  try { process.kill(status.service.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await waitFor(async () => !(await syncStatus(root)).service.alive, 'sync service did not stop');
}

test('local clients connect and pull event-driven cloud state', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const a = await f.local(), b = await f.local();
  const options = root => ({ root, url: f.cloud.url, projectId: 'sync-fixture', token: f.token, startService: false });
  await connectSync(options(a));
  await connectSync(options(b));
  await prepareSync({ root: a, sessionId: 'session-a', nodeIds: ['N1'] });
  await edit(a, 'N1', 'from A');
  await finishSync({ root: a, sessionId: 'session-a' });
  const pulled = await pullSync(b);
  assert.equal(pulled.received > 0, true);
  const bMap = JSON.parse(await fs.readFile(path.join(b, '.codex/context/map.json'), 'utf8'));
  assert.equal(bMap.root.children.find(item => item.id === 'N1').purpose, 'from A');
  const status = await syncStatus(b);
  assert.equal(status.state.status, 'synced');
  assert.equal(status.configured, true);
  assert.equal(JSON.stringify(status).includes(f.token), false);
});

test('sync status reports workbench-managed Session state without exposing its token', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-managed-sync-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = await resolveProject(root);
  await atomicWrite(memoryConfigPath(project), encode({ url: 'https://map.example.test', projectId: 'managed-project', token: 'do-not-print' }));
  const sessionDir = sessionMemoryDir(project, 'managed-session');
  await atomicWrite(path.join(sessionDir, 'remote-sync/state.json'), encode({ configured: true, status: 'offline', pending: 1, cursor: 7 }));

  const status = await syncStatus(root, 'managed-session');
  assert.equal(status.managedBy, 'workbench');
  assert.equal(status.state.status, 'offline');
  assert.equal(status.state.pending, 1);
  assert.equal(status.state.cursor, 7);
  assert.equal(JSON.stringify(status).includes('do-not-print'), false);
});

test('prepare and finish rebase disjoint clients and preserve both edits', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const a = await f.local(), b = await f.local();
  const options = root => ({ root, url: f.cloud.url, projectId: 'sync-fixture', token: f.token, startService: false });
  await connectSync(options(a)); await connectSync(options(b));
  await prepareSync({ root: a, sessionId: 'session-a', nodeIds: ['N1'] });
  await prepareSync({ root: b, sessionId: 'session-b', nodeIds: ['N2'] });
  await edit(a, 'N1', 'from A'); await edit(b, 'N2', 'from B');
  await trackSync({ root: a, sessionId: 'session-a', paths: ['src/a.js'] });
  await trackSync({ root: b, sessionId: 'session-b', paths: ['src/b.js'] });
  await finishSync({ root: b, sessionId: 'session-b' });
  const result = await finishSync({ root: a, sessionId: 'session-a' });
  assert.equal(result.rebased, true);
  const remote = await fetch(f.cloud.url + '/api/projects/sync-fixture/map').then(response => response.json());
  assert.equal(remote.document.root.children.find(item => item.id === 'N1').purpose, 'from A');
  assert.equal(remote.document.root.children.find(item => item.id === 'N2').purpose, 'from B');
});

test('finish leaves overlapping development unverified with an impact list', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const a = await f.local(), b = await f.local();
  const options = root => ({ root, url: f.cloud.url, projectId: 'sync-fixture', token: f.token, startService: false });
  await connectSync(options(a)); await connectSync(options(b));
  await prepareSync({ root: a, sessionId: 'session-a', nodeIds: ['N1'] });
  await prepareSync({ root: b, sessionId: 'session-b', nodeIds: ['N1'] });
  await edit(a, 'N1', 'from A'); await edit(b, 'N1', 'from B');
  await finishSync({ root: b, sessionId: 'session-b' });
  await assert.rejects(() => finishSync({ root: a, sessionId: 'session-a' }), error => error.code === 'WORK_IMPACT' && error.details.impacts.length === 1);
  const status = await syncStatus(a);
  assert.equal(status.works.find(work => work.sessionId === 'session-a').status, 'conflict');
});

test('checkpoint reports conflicts without publishing the Session map', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const a = await f.local(), b = await f.local();
  const options = root => ({ root, url: f.cloud.url, projectId: 'sync-fixture', token: f.token, startService: false });
  await connectSync(options(a)); await connectSync(options(b));
  await prepareSync({ root: a, sessionId: 'session-a', nodeIds: ['N1'] });
  await prepareSync({ root: b, sessionId: 'session-b', nodeIds: ['N1'] });
  await edit(a, 'N1', 'draft from A');
  await edit(b, 'N1', 'published from B'); await finishSync({ root: b, sessionId: 'session-b' });

  const checked = await checkpointSync({ root: a, sessionId: 'session-a' });
  assert.equal(checked.status, 'conflict');
  assert.equal(checked.impacts.length, 1);
  const remote = await fetch(f.cloud.url + '/api/projects/sync-fixture/map').then(response => response.json());
  assert.equal(remote.document.root.children.find(item => item.id === 'N1').purpose, 'published from B');
  const local = JSON.parse(await fs.readFile(path.join(a, '.codex/context/map.json'), 'utf8'));
  assert.equal(local.root.children.find(item => item.id === 'N1').purpose, 'draft from A');
});

test('connect requires an explicit pull or push when local and Cloud maps differ', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const seed = await f.local();
  await connectSync({ root: seed, url: f.cloud.url, projectId: 'sync-fixture', token: f.token, startService: false });
  await prepareSync({ root: seed, sessionId: 'seed', nodeIds: ['N1'] });
  await edit(seed, 'N1', 'Cloud is authoritative');
  await finishSync({ root: seed, sessionId: 'seed' });

  const pulled = await f.local();
  await edit(pulled, 'N1', 'different local draft');
  const base = { root: pulled, url: f.cloud.url, projectId: 'sync-fixture', token: f.token, startService: false };
  await assert.rejects(() => connectSync(base), error => error.code === 'INITIAL_SYNC_CONFLICT');
  await connectSync({ ...base, mode: 'pull' });
  let local = JSON.parse(await fs.readFile(path.join(pulled, '.codex/context/map.json'), 'utf8'));
  assert.equal(local.root.children.find(item => item.id === 'N1').purpose, 'Cloud is authoritative');

  const pushed = await f.local();
  await edit(pushed, 'N2', 'explicit local replacement');
  await connectSync({ root: pushed, url: f.cloud.url, projectId: 'sync-fixture', token: f.token, startService: false, mode: 'push' });
  const remote = await fetch(f.cloud.url + '/api/projects/sync-fixture/map').then(response => response.json());
  assert.equal(remote.document.root.children.find(item => item.id === 'N2').purpose, 'explicit local replacement');
});

test('ensure service resumes SSE from its durable cursor after restart', async t => {
  const f = await fixture();
  const writer = await f.local(), listener = await f.local();
  const options = root => ({ root, url: f.cloud.url, projectId: 'sync-fixture', token: f.token, startService: false });
  await connectSync(options(writer)); await connectSync(options(listener));
  t.after(async () => { await stopService(listener); await f.dispose(); });

  const first = await ensureService(listener);
  assert.equal(first.started, true);
  const duplicate = await ensureService(listener);
  assert.deepEqual(duplicate, { started: false, pid: first.pid });

  await prepareSync({ root: writer, sessionId: 'writer-one', nodeIds: ['N1'] });
  await edit(writer, 'N1', 'received while online');
  await finishSync({ root: writer, sessionId: 'writer-one' });
  await waitFor(async () => {
    const map = JSON.parse(await fs.readFile(path.join(listener, '.codex/context/map.json'), 'utf8'));
    return map.root.children.find(item => item.id === 'N1').purpose === 'received while online';
  // This is a recovery test, not a latency benchmark. Allow the 15s HTTP
  // deadline plus process scheduling; still require the real received edit.
  }, 'listener did not receive the first SSE update', 20_000);

  await stopService(listener);
  await prepareSync({ root: writer, sessionId: 'writer-two', nodeIds: ['N2'] });
  await edit(writer, 'N2', 'received after restart');
  await finishSync({ root: writer, sessionId: 'writer-two' });

  const restarted = await ensureService(listener);
  assert.equal(restarted.started, true);
  await waitFor(async () => {
    const map = JSON.parse(await fs.readFile(path.join(listener, '.codex/context/map.json'), 'utf8'));
    return map.root.children.find(item => item.id === 'N2').purpose === 'received after restart';
  }, 'listener did not resume from the durable SSE cursor', 20_000);
  const status = await syncStatus(listener);
  assert.equal(status.state.status, 'synced');
  assert.equal(status.service.alive, true);
});
