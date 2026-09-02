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
  const projectMap = await fetch(f.url + '/.codex/context/map.json', { headers: { Referer: f.url + '/projects/context-guard' } }).then(response => response.json());
  assert.equal(projectMap.root.title, 'Context Guard');
  const denied = await request(f.url, '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'second', name: 'Second' }) });
  assert.equal(denied.response.status, 401);
  const created = await request(f.url, '/api/projects', { method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'second', name: 'Second' }) });
  assert.equal(created.response.status, 201); assert.equal(created.body.project.id, 'second');
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
