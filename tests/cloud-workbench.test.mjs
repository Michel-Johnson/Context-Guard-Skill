import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startCloudServer } from '../scripts/cloud/server.mjs';

async function fixture() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-cloud-'));
  const service = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir, adminToken: 'test-token' });
  return { ...service, dataDir, async dispose() { await service.close(); await fs.rm(dataDir, { recursive: true, force: true }); } };
}

async function request(base, route, options = {}) {
  const response = await fetch(base + route, options);
  return { response, body: await response.json() };
}

async function openEventStream(url, headers = {}) {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  await reader.read();
  return { controller, reader };
}

test('cloud shutdown closes live SSE clients promptly and can restart on the same data', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-cloud-shutdown-'));
  let service = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir, adminToken: 'test-token' });
  t.after(async () => { await service.close().catch(() => {}); await fs.rm(dataDir, { recursive: true, force: true }); });
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  const saved = await request(service.url, '/api/projects/context-guard/commits', {
    method: 'POST', headers,
    body: JSON.stringify({ baseVersion: null, operationId: 'shutdown-seed', operations: [{ type: 'initialize', project: 'Context Guard', node: { id: 'T0', title: 'Survives restart', kind: 'module', state: 'dirty', children: [] } }] }),
  });
  assert.equal(saved.response.status, 200);
  const stream = await openEventStream(service.url + '/api/events');
  const projectStream = await openEventStream(service.url + '/api/projects/context-guard/events', { Authorization: 'Bearer test-token' });
  const started = Date.now();
  await service.close();
  assert.ok(Date.now() - started < 2_000, 'shutdown must not wait for the process-manager timeout');
  stream.controller.abort(); projectStream.controller.abort();
  await stream.reader.cancel().catch(() => {}); await projectStream.reader.cancel().catch(() => {});
  service = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir, adminToken: 'test-token' });
  const restored = await request(service.url, '/api/projects/context-guard/map', { headers });
  assert.equal(restored.body.document.root.title, 'Survives restart');
});

test('cloud workbench exposes a multi-project registry and guarded writes', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const health = await request(f.url, '/api/health');
  assert.equal(health.response.status, 200); assert.equal(health.body.projects, 1);
  const initial = await request(f.url, '/api/projects');
  assert.deepEqual(initial.body.projects.map(project => project.id), ['context-guard']);
  const projectPage = await fetch(f.url + '/projects/context-guard');
  assert.equal(projectPage.status, 200); assert.match(await projectPage.text(), /Context Guard · 工作台原型/);
  const overview = await fetch(f.url + '/.codex/context/map.json', { headers: { Referer: f.url + '/' } }).then(response => response.json());
  assert.equal(overview.root.title, '项目地图'); assert.deepEqual(overview.root.children.map(node => node.title), ['Context Guard']);
  assert.equal(overview.root.children[0].cloudProjectId, 'context-guard');
  const projectMap = await fetch(f.url + '/.codex/context/map.json', { headers: { Referer: f.url + '/projects/context-guard' } }).then(response => response.json());
  assert.equal(projectMap.root.title, 'Context Guard');
  const denied = await request(f.url, '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'second', name: 'Second' }) });
  assert.equal(denied.response.status, 401);
  const created = await request(f.url, '/api/projects', { method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'second', name: 'Second' }) });
  assert.equal(created.response.status, 201); assert.equal(created.body.project.id, 'second');
});

test('private mode protects reads and uses secure cookies without leaking project count', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-private-cloud-'));
  const service = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir, adminToken: 'admin-test', browserToken: 'browser-test', privateAccess: true, secureCookies: true, publicOrigin: 'https://map.example.test' });
  t.after(async () => { await service.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const health = await request(service.url, '/api/health');
  assert.equal(health.response.status, 200); assert.equal(health.body.projects, undefined);
  for (const route of ['/api/projects', '/.codex/context/map.json', '/', '/prototype/workbench-sync.mjs']) {
    assert.equal((await fetch(service.url + route)).status, 401, route);
  }
  const login = await fetch(service.url + '/auth?token=browser-test&next=/', { redirect: 'manual' });
  assert.equal(login.status, 302); assert.match(login.headers.get('set-cookie'), /HttpOnly/); assert.match(login.headers.get('set-cookie'), /Secure/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(service.url + '/api/projects', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(service.url + '/api/projects', { headers: { Cookie: cookie, Origin: 'https://evil.example' } })).status, 403);
});

test('one cloud process serves the private Main and Session memory API', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-unified-cloud-'));
  const service = await startCloudServer({
    host: '127.0.0.1', port: 0, dataDir, adminToken: 'cloud-admin',
    memoryConfig: {
      dataDir: path.join(dataDir, 'memory'),
      adminToken: 'memory-admin',
      projects: { 'context-guard': { token: 'project-memory-token' } },
    },
  });
  t.after(async () => { await service.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const memoryHeaders = { Authorization: 'Bearer project-memory-token', 'Content-Type': 'application/json' };
  const initial = await request(service.url, '/v1/projects/context-guard/main', { headers: memoryHeaders });
  assert.equal(initial.response.status, 200); assert.equal(initial.body.snapshot, null);
  const map = { v: 1, project: 'Context Guard', bootstrap: 'ready', flows: [], root: { id: 'T0', title: 'Session map', kind: 'module', state: 'dirty', children: [] } };
  const saved = await request(service.url, '/v1/projects/context-guard/sessions/session-one', {
    method: 'POST', headers: memoryHeaders,
    body: JSON.stringify({ operationId: 'session-write-one', baseVersion: null, baseMainVersion: null, sourceCommit: 'a'.repeat(40), memory: { map, records: {} } }),
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.snapshot.sessionId, 'session-one');
  assert.equal(saved.body.snapshot.updatedAt, new Date(saved.body.snapshot.updatedAt).toISOString());
  const read = await request(service.url, '/v1/projects/context-guard/sessions/session-one', { headers: memoryHeaders });
  assert.equal(read.body.snapshot.memory.map.root.title, 'Session map');
  const browserHeaders = { Authorization: 'Bearer cloud-admin', 'Content-Type': 'application/json' };
  const access = await request(service.url, '/api/workbench/projects/context-guard/api/access', { headers: browserHeaders });
  assert.deepEqual(access.body.sessions.map(session => session.id), ['session-one']);
  assert.equal(access.body.project.kind, 'git');
  const sessionState = await request(service.url, '/api/workbench/projects/context-guard/api/state?view=session%3Asession-one', { headers: browserHeaders });
  assert.equal(sessionState.body.viewId, 'session:session-one');
  assert.equal(sessionState.body.doc.root.title, 'Session map');
  const edited = await request(service.url, '/api/workbench/projects/context-guard/api/commit?view=session%3Asession-one', {
    method: 'POST', headers: browserHeaders,
    body: JSON.stringify({ baseVersion: sessionState.body.version, operationId: 'browser-session-edit', operations: [{ type: 'update', id: 'T0', fields: { purpose: 'edited in cloud workbench' } }] }),
  });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.body.persistedAt, new Date(edited.body.persistedAt).toISOString());
  const stale = await request(service.url, '/api/workbench/projects/context-guard/api/commit?view=session%3Asession-one', {
    method: 'POST', headers: browserHeaders,
    body: JSON.stringify({ baseVersion: sessionState.body.version, operationId: 'stale-browser-edit', operations: [{ type: 'update', id: 'T0', fields: { purpose: 'must not overwrite' } }] }),
  });
  assert.equal(stale.response.status, 409); assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
  const editedRead = await request(service.url, '/v1/projects/context-guard/sessions/session-one', { headers: memoryHeaders });
  assert.equal(editedRead.body.snapshot.memory.map.root.purpose, 'edited in cloud workbench');
  const cloudMap = await request(service.url, '/api/projects/context-guard/map');
  assert.equal(cloudMap.body.document, null, 'private Session memory must not overwrite the public/Main map');
});

test('private Session history is timestamped, restorable, durable, and CAS protected', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-memory-history-'));
  const memoryConfig = {
    dataDir: path.join(dataDir, 'memory'),
    adminToken: 'memory-admin',
    projects: { 'context-guard': { token: 'project-memory-token' } },
  };
  let service = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir, adminToken: 'cloud-admin', memoryConfig });
  t.after(async () => { await service.close().catch(() => {}); await fs.rm(dataDir, { recursive: true, force: true }); });
  const headers = { Authorization: 'Bearer project-memory-token', 'Content-Type': 'application/json' };
  const map = title => ({ v: 1, project: 'Context Guard', bootstrap: 'ready', flows: [], root: { id: 'T0', title, kind: 'module', state: 'dirty', children: [] } });
  const first = await request(service.url, '/v1/projects/context-guard/sessions/session-history', {
    method: 'POST', headers,
    body: JSON.stringify({ operationId: 'history-one', baseVersion: null, baseMainVersion: null, sourceCommit: 'a'.repeat(40), memory: { map: map('First version'), records: {} } }),
  });
  const second = await request(service.url, '/v1/projects/context-guard/sessions/session-history', {
    method: 'POST', headers,
    body: JSON.stringify({ operationId: 'history-two', baseVersion: first.body.snapshot.version, baseMainVersion: null, sourceCommit: 'b'.repeat(40), memory: { map: map('Second version'), records: {} } }),
  });
  const history = await request(service.url, '/v1/projects/context-guard/history?scope=session%3Asession-history', { headers });
  assert.equal(history.response.status, 200);
  assert.deepEqual(history.body.history.map(entry => entry.snapshot.memory.map.root.title), ['First version', 'Second version']);
  for (const entry of history.body.history) assert.equal(entry.at, new Date(entry.at).toISOString());
  const restored = await request(service.url, '/v1/projects/context-guard/restore', {
    method: 'POST', headers,
    body: JSON.stringify({ operationId: 'restore-first', scope: 'session:session-history', baseVersion: second.body.snapshot.version, targetVersion: first.body.snapshot.version }),
  });
  assert.equal(restored.response.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.snapshot.memory.map.root.title, 'First version');
  assert.equal(restored.body.snapshot.restoredFrom, first.body.snapshot.version);
  assert.notEqual(restored.body.snapshot.version, first.body.snapshot.version);
  const stale = await request(service.url, '/v1/projects/context-guard/restore', {
    method: 'POST', headers,
    body: JSON.stringify({ operationId: 'stale-restore', scope: 'session:session-history', baseVersion: second.body.snapshot.version, targetVersion: first.body.snapshot.version }),
  });
  assert.equal(stale.response.status, 409); assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
  await service.close();
  service = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir, adminToken: 'cloud-admin', memoryConfig });
  const reloaded = await request(service.url, '/v1/projects/context-guard/sessions/session-history', { headers });
  assert.equal(reloaded.body.snapshot.version, restored.body.snapshot.version);
  assert.equal(reloaded.body.snapshot.memory.map.root.title, 'First version');
  const reloadedHistory = await request(service.url, '/v1/projects/context-guard/history?scope=session%3Asession-history', { headers });
  assert.deepEqual(reloadedHistory.body.history.map(entry => entry.action), ['write', 'write', 'restore']);
});

test('cloud commit is idempotent and rejects stale map versions', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  const commit = { baseVersion: null, operationId: 'op-1', operations: [{ type: 'initialize', project: 'context-guard', node: { id: 'T0', title: 'Context Guard', kind: 'module', state: 'dirty', children: [] } }] };
  const first = await request(f.url, '/api/projects/context-guard/commits', { method: 'POST', headers, body: JSON.stringify(commit) });
  assert.equal(first.response.status, 200); assert.ok(first.body.version);
  const duplicate = await request(f.url, '/api/projects/context-guard/commits', { method: 'POST', headers, body: JSON.stringify(commit) });
  assert.deepEqual(duplicate.body, first.body);
  const stale = await request(f.url, '/api/projects/context-guard/commits', { method: 'POST', headers, body: JSON.stringify({ ...commit, operationId: 'op-2' }) });
  assert.equal(stale.response.status, 409); assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
  const map = await request(f.url, '/api/projects/context-guard/map');
  assert.equal(map.body.document.root.title, 'Context Guard');
});

test('the reused workbench can edit and persist the project overview map', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  const state = await request(f.url, '/api/workbench/overview/api/state', { headers: { Authorization: 'Bearer test-token' } });
  assert.equal(state.response.status, 200); assert.equal(state.body.doc.root.title, '项目地图');
  const commit = await request(f.url, '/api/workbench/overview/api/commit', {
    method: 'POST', headers,
    body: JSON.stringify({ baseVersion: state.body.version, operationId: 'overview-op-1', operations: [{ type: 'update', id: 'T0', fields: { purpose: '已在线编辑' } }] }),
  });
  assert.equal(commit.response.status, 200); assert.equal(commit.body.committed, true);
  const saved = await request(f.url, '/api/workbench/overview/api/state', { headers: { Authorization: 'Bearer test-token' } });
  assert.equal(saved.body.doc.root.purpose, '已在线编辑');
  const access = await request(f.url, '/api/workbench/overview/api/access', { headers: { Authorization: 'Bearer test-token' } });
  assert.deepEqual(access.body, { sessions: [], grants: {}, currentSessionId: null });
});

test('overview project edits survive reconciliation and a server restart', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-overview-restart-'));
  let service = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir, adminToken: 'test-token' });
  t.after(async () => { await service.close().catch(() => {}); await fs.rm(dataDir, { recursive: true, force: true }); });
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  const state = await request(service.url, '/api/workbench/overview/api/state', { headers });
  const todo = { id: 'TD-human', title: 'Human todo', status: 'pending' };
  const saved = await request(service.url, '/api/workbench/overview/api/commit', {
    method: 'POST', headers,
    body: JSON.stringify({
      baseVersion: state.body.version,
      operationId: 'overview-project-edit',
      operations: [{ type: 'update', id: 'P_context-guard', fields: { purpose: 'human description', todos: [todo] } }],
    }),
  });
  assert.equal(saved.response.status, 200);
  await service.close();
  service = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir, adminToken: 'test-token' });
  const reloaded = await request(service.url, '/api/workbench/overview/api/state', { headers });
  const projectNode = reloaded.body.doc.root.children.find(node => node.cloudProjectId === 'context-guard');
  assert.equal(projectNode.purpose, 'human description');
  assert.deepEqual(projectNode.todos, [todo]);
});

test('acknowledged map edits are file-backed after restart and events carry server time', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-durable-map-'));
  let service = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir, adminToken: 'test-token' });
  t.after(async () => { await service.close().catch(() => {}); await fs.rm(dataDir, { recursive: true, force: true }); });
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  const commit = { baseVersion: null, operationId: 'durable-edit', operations: [{ type: 'initialize', project: 'Context Guard', node: { id: 'T0', title: 'Durable edit', kind: 'module', state: 'dirty', children: [] } }] };
  const saved = await request(service.url, '/api/projects/context-guard/commits', { method: 'POST', headers, body: JSON.stringify(commit) });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.persistedAt, new Date(saved.body.persistedAt).toISOString());
  const disk = JSON.parse(await fs.readFile(path.join(dataDir, 'maps/context-guard.json'), 'utf8'));
  assert.equal(disk.document.root.title, 'Durable edit');
  assert.equal(disk.updatedAt, saved.body.persistedAt);
  const changes = await request(service.url, '/api/projects/context-guard/changes?after=0', { headers });
  assert.equal(changes.body.events[0].at, saved.body.persistedAt);
  await service.close();
  service = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir, adminToken: 'test-token' });
  const reloaded = await request(service.url, '/api/projects/context-guard/map', { headers });
  assert.equal(reloaded.body.document.root.title, 'Durable edit');
  assert.equal(reloaded.body.version, saved.body.version);
});

test('prepared cloud transactions recover idempotently after interruption', async t => {
  const stages = ['transaction-prepared', 'event-persisted', 'map-persisted', 'receipt-persisted'];
  for (const stage of stages) {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), `context-guard-recover-${stage}-`));
    let injected = false;
    let service = await startCloudServer({
      host: '127.0.0.1', port: 0, dataDir, adminToken: 'test-token',
      faultInjector(point) {
        if (!injected && point === stage) { injected = true; throw new Error(`interrupted at ${stage}`); }
      },
    });
    try {
      const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
      const commit = { baseVersion: null, operationId: `recover-${stage}`, operations: [{ type: 'initialize', project: 'Context Guard', node: { id: 'T0', title: stage, kind: 'module', state: 'dirty', children: [] } }] };
      const interrupted = await request(service.url, '/api/projects/context-guard/commits', { method: 'POST', headers, body: JSON.stringify(commit) });
      assert.equal(interrupted.response.status, 500, stage);
      await service.close();
      service = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir, adminToken: 'test-token' });
      const retried = await request(service.url, '/api/projects/context-guard/commits', { method: 'POST', headers, body: JSON.stringify(commit) });
      assert.equal(retried.response.status, 200, stage);
      const map = await request(service.url, '/api/projects/context-guard/map', { headers });
      assert.equal(map.body.document.root.title, stage);
      const events = await request(service.url, '/api/projects/context-guard/changes?after=0', { headers });
      assert.equal(events.body.events.length, 1, stage);
      assert.equal(events.body.events[0].at, retried.body.persistedAt, stage);
      assert.deepEqual(await fs.readdir(path.join(dataDir, 'transactions')), [], stage);
    } finally {
      await service.close().catch(() => {});
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  }
});

test('concurrent projects keep every registry update on disk', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  await request(f.url, '/api/projects', { method: 'POST', headers, body: JSON.stringify({ id: 'second', name: 'Second' }) });
  const initialize = (id, title) => request(f.url, `/api/projects/${id}/commits`, {
    method: 'POST', headers,
    body: JSON.stringify({ baseVersion: null, operationId: `initialize-${id}`, operations: [{ type: 'initialize', project: title, node: { id: 'T0', title, kind: 'module', state: 'dirty', children: [] } }] }),
  });
  const results = await Promise.all([initialize('context-guard', 'Context Guard'), initialize('second', 'Second')]);
  assert.deepEqual(results.map(result => result.response.status), [200, 200]);
  const registry = JSON.parse(await fs.readFile(path.join(f.dataDir, 'projects.json'), 'utf8'));
  assert.deepEqual(registry.projects.map(project => [project.id, project.status]), [['context-guard', 'connected'], ['second', 'connected']]);
});

test('cloud bootstrap never exposes an administrative credential', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const bootstrap = await request(f.url, '/api/workbench/overview/bootstrap');
  assert.equal(bootstrap.response.status, 200);
  assert.equal(bootstrap.body.token, undefined);
  const page = await fetch(f.url + '/').then(response => response.text());
  assert.doesNotMatch(page, /test-token/);
  const denied = await request(f.url, '/api/workbench/overview/api/state');
  assert.equal(denied.response.status, 401);
  const login = await fetch(f.url + '/auth?token=test-token&next=/', { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const authorized = await request(f.url, '/api/workbench/overview/api/state', { headers: { Cookie: cookie } });
  assert.equal(authorized.response.status, 200);
});

test('project commits are serialized so only one same-base writer wins', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  const seed = await request(f.url, '/api/projects/context-guard/commits', {
    method: 'POST', headers,
    body: JSON.stringify({ baseVersion: null, operationId: 'concurrent-seed', operations: [{ type: 'initialize', project: 'Context Guard', node: { id: 'T0', title: 'Context Guard', kind: 'module', state: 'dirty', children: [] } }] }),
  });
  const commit = operationId => request(f.url, '/api/projects/context-guard/commits', {
    method: 'POST', headers,
    body: JSON.stringify({ baseVersion: seed.body.version, operationId, operations: [{ type: 'update', id: 'T0', fields: { purpose: operationId } }] }),
  });
  const results = await Promise.all([commit('concurrent-a'), commit('concurrent-b')]);
  assert.deepEqual(results.map(item => item.response.status).sort(), [200, 409]);
});

test('project token can replay ordered events without crossing projects', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const admin = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  const enrollment = await request(f.url, '/api/projects/context-guard/enrollments', { method: 'POST', headers: admin, body: '{}' });
  assert.equal(enrollment.response.status, 201);
  const projectHeaders = { Authorization: `Bearer ${enrollment.body.syncToken}`, 'Content-Type': 'application/json' };
  const first = await request(f.url, '/api/projects/context-guard/commits', {
    method: 'POST', headers: projectHeaders,
    body: JSON.stringify({ baseVersion: null, operationId: 'events-seed', sessionId: 'session-a', operations: [{ type: 'initialize', project: 'Context Guard', node: { id: 'T0', title: 'Context Guard', kind: 'module', state: 'dirty', children: [] } }] }),
  });
  const second = await request(f.url, '/api/projects/context-guard/commits', {
    method: 'POST', headers: projectHeaders,
    body: JSON.stringify({ baseVersion: first.body.version, operationId: 'events-update', sessionId: 'session-a', operations: [{ type: 'update', id: 'T0', fields: { purpose: 'event stream' } }] }),
  });
  assert.equal(second.response.status, 200);
  const replay = await request(f.url, '/api/projects/context-guard/changes?after=1', { headers: { Authorization: `Bearer ${enrollment.body.syncToken}` } });
  assert.deepEqual(replay.body.events.map(event => event.seq), [2]);
  assert.equal(replay.body.events[0].operationId, 'events-update');
  const created = await request(f.url, '/api/projects', { method: 'POST', headers: admin, body: JSON.stringify({ id: 'other', name: 'Other' }) });
  const crossed = await request(f.url, '/api/projects/other/changes?after=0', { headers: { Authorization: `Bearer ${enrollment.body.syncToken}` } });
  assert.equal(crossed.response.status, 401);
  assert.ok(created.body.syncToken);
});

test('development windows rebase disjoint changes and block overlapping changes', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const admin = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  const enrollment = await request(f.url, '/api/projects/context-guard/enrollments', { method: 'POST', headers: admin, body: '{}' });
  const headers = { Authorization: `Bearer ${enrollment.body.syncToken}`, 'Content-Type': 'application/json' };
  const document = {
    v: 1, project: 'Context Guard', bootstrap: 'ready', flows: [],
    root: { id: 'T0', title: 'Context Guard', kind: 'module', state: 'dirty', children: [
      { id: 'N1', title: 'One', kind: 'work', state: 'dirty', children: [] },
      { id: 'N2', title: 'Two', kind: 'work', state: 'dirty', children: [] },
    ] },
  };
  await request(f.url, '/api/projects/context-guard/snapshot', { method: 'POST', headers, body: JSON.stringify({ baseVersion: null, operationId: 'work-seed', document }) });
  const prepare = (workId, nodeId) => request(f.url, '/api/projects/context-guard/work/prepare', { method: 'POST', headers, body: JSON.stringify({ workId, sessionId: workId, scope: { nodeIds: [nodeId] } }) });
  const finish = (workId, nodeId, purpose) => request(f.url, '/api/projects/context-guard/work/finish', { method: 'POST', headers, body: JSON.stringify({ workId, operationId: `finish-${workId}`, operations: [{ type: 'update', id: nodeId, fields: { purpose } }], scope: { nodeIds: [nodeId] } }) });
  await prepare('work-a-0001', 'N1');
  await prepare('work-b-0002', 'N2');
  assert.equal((await finish('work-b-0002', 'N2', 'changed by B')).response.status, 200);
  const rebased = await finish('work-a-0001', 'N1', 'changed by A');
  assert.equal(rebased.response.status, 200); assert.equal(rebased.body.rebased, true);
  await prepare('work-c-0003', 'N1');
  await prepare('work-d-0004', 'N1');
  assert.equal((await finish('work-d-0004', 'N1', 'changed by D')).response.status, 200);
  const conflict = await finish('work-c-0003', 'N1', 'changed by C');
  assert.equal(conflict.response.status, 409); assert.equal(conflict.body.error.code, 'WORK_IMPACT');
  assert.equal(conflict.body.error.impacts.length, 1);
});
