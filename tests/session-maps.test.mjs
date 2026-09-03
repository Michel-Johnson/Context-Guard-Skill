import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../scripts/workbench/server.mjs';
import { startCloudServer } from '../scripts/cloud/server.mjs';
import { mergeMaps } from '../scripts/workbench/scopes.mjs';
const exec = promisify(execFile);

const document = () => ({ v: 1, project: 'Fixture', bootstrap: 'ready', flows: [], root: {
  id: 'T0', title: 'Root', kind: 'module', state: 'dirty', owns: [], children: [], memories: [], ideas: [], todos: [], bugs: [], dormant: [], files: [],
} });
test('three-way publication preserves independent human tasks and detects conflicting edits', () => {
  const base = document(), main = structuredClone(base), session = structuredClone(base);
  main.root.todos.push({ id: 'human-todo', title: 'Keep this', status: 'pending' });
  session.root.title = 'Implemented';
  assert.equal(mergeMaps(base, main, session).root.todos[0].id, 'human-todo');
  assert.equal(mergeMaps(base, main, session).root.title, 'Implemented');
  main.root.title = 'Human rename';
  assert.throws(() => mergeMaps(base, main, session), error => error.code === 'MAP_MERGE_CONFLICT');
  const b = document(); b.root.todos = [{ id: 'todo', title: 'Base' }];
  const a = structuredClone(b), c = structuredClone(b); a.root.todos = []; c.root.todos[0].title = 'Changed';
  assert.throws(() => mergeMaps(b, a, c), error => error.code === 'MAP_MERGE_CONFLICT');
});

test('real workbench separates Sessions, permissions, operation receipts, Main, and restart state', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-session-maps-'));
  const ctx = path.join(root, '.codex/context');
  await fs.mkdir(ctx, { recursive: true });
  await fs.writeFile(path.join(ctx, 'map.json'), JSON.stringify(document()));
  await fs.writeFile(path.join(ctx, 'sessions.jsonl'), ['a', 'b'].map(session_id => JSON.stringify({ session_id, event: 'session-start', platform: 'codex' })).join('\n') + '\n');
  let server = await startServer({ root, port: 0 });
  t.after(async () => { await server.close(); await fs.rm(root, { recursive: true, force: true }); });
  const call = async (route, token, body) => {
    const response = await fetch(new URL(route, server.state.url), { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  const original = await call('/api/state', server.humanToken);
  const migrated = await call('/api/isolation', server.state.adminToken, { baseVersion: original.version });
  assert.equal(migrated.baselineStatus, 'legacy-unverified');
  assert.deepEqual(JSON.parse(await fs.readFile(migrated.backup)), document());
  const a = await call('/api/session', server.state.adminToken, { sessionId: 'a' });
  const b = await call('/api/session', server.state.adminToken, { sessionId: 'b' });
  await call('/api/access', server.humanToken, { sessionId: 'a', nodes: ['T0'] });
  const before = await call('/api/state', a.token);
  const change = { operationId: 'isolation-change', baseVersion: before.version, operations: [{ type: 'update', id: 'T0', fields: { title: 'Session A only' } }] };
  assert.equal((await call('/api/commit', a.token, change)).committed, true);
  assert.equal((await call('/api/state', b.token)).doc.root.title, 'Root');
  assert.equal((await call('/api/state', server.humanToken)).doc.root.title, 'Root');
  assert.equal((await call('/api/state?session=a', server.humanToken)).doc.root.title, 'Session A only');
  assert.equal((await call('/api/state?session=a', b.token)).status, 403);
  assert.equal((await call('/api/commit', b.token, change)).status, 403);
  assert.equal((await call('/api/operation?id=isolation-change', b.token)).found, false);
  await server.close(); server = await startServer({ root, port: 0 });
  assert.equal((await call('/api/state?session=a', server.humanToken)).doc.root.title, 'Session A only');
  assert.equal((await call('/api/state?session=b', server.humanToken)).doc.root.title, 'Root');
});

test('Cloud isolates Session credentials and publishes only a verified main commit', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cloud-session-maps-'));
  const repository = path.join(temp, 'repository'), remote = path.join(temp, 'origin.git');
  await fs.mkdir(repository);
  await exec('git', ['init', '--bare', remote]);
  await exec('git', ['init', '-b', 'main'], { cwd: repository });
  await exec('git', ['config', 'user.name', 'CI'], { cwd: repository });
  await exec('git', ['config', 'user.email', 'ci@example.invalid'], { cwd: repository });
  await fs.writeFile(path.join(repository, 'README.md'), 'fixture\n');
  await exec('git', ['add', 'README.md'], { cwd: repository }); await exec('git', ['commit', '-m', 'fixture'], { cwd: repository });
  await exec('git', ['remote', 'add', 'origin', remote], { cwd: repository }); await exec('git', ['push', '-u', 'origin', 'main'], { cwd: repository });
  const commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim();
  const cloud = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir: path.join(temp, 'data'), adminToken: 'admin-token', sourceRepositories: { 'context-guard': repository } });
  t.after(async () => { await cloud.close(); await fs.rm(temp, { recursive: true, force: true }); });
  const call = async (route, token, body) => {
    const response = await fetch(new URL(route, cloud.url), { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  const seed = await call('/api/projects/context-guard/snapshot', 'admin-token', { baseVersion: null, operationId: 'cloud-session-seed', document: document() });
  assert.equal(seed.status, 200);
  assert.equal((await call('/api/projects/context-guard/scopes/enable', 'admin-token', { baseVersion: seed.version })).baselineStatus, 'legacy-unverified');
  const a = await call('/api/projects/context-guard/scopes/session', 'admin-token', { sessionId: 'a', name: 'codex-a', status: 'active' });
  const b = await call('/api/projects/context-guard/scopes/session', 'admin-token', { sessionId: 'b', name: 'codex-b', status: 'active' });
  assert.ok(a.sessionToken); assert.ok(b.sessionToken);
  const aBefore = await call('/api/projects/context-guard/scopes/state?session=a', a.sessionToken);
  const denied = await call('/api/projects/context-guard/scopes/commit?session=a', a.sessionToken, { baseVersion: aBefore.version, operationId: 'cloud-session-denied', operations: [{ type: 'update', id: 'T0', fields: { title: 'Must stay blocked' } }] });
  assert.equal(denied.status, 403); assert.equal(denied.error.code, 'FORBIDDEN');
  const plan = await call('/api/workbench/projects/context-guard/api/access-plan', 'admin-token', { sessionId: 'a', nodeId: 'T0' });
  assert.deepEqual(plan.missing, ['T0']);
  assert.equal((await call('/api/workbench/projects/context-guard/api/access', 'admin-token', { sessionId: 'a', addNodes: plan.nodes })).saved, true);
  const accessAfter = await call('/api/workbench/projects/context-guard/api/access', 'admin-token');
  assert.deepEqual(accessAfter.grants.a.nodes, ['T0']);
  const changed = await call('/api/projects/context-guard/scopes/commit?session=a', a.sessionToken, { baseVersion: aBefore.version, operationId: 'cloud-session-change', operations: [{ type: 'update', id: 'T0', fields: { title: 'Published feature' } }] });
  assert.equal(changed.committed, true);
  assert.equal((await call('/api/projects/context-guard/scopes/state?session=a', b.sessionToken)).status, 401);
  assert.equal((await call('/api/projects/context-guard/scopes/state?session=b', b.sessionToken)).doc.root.title, 'Root');
  assert.equal((await call('/api/projects/context-guard/scopes/state', 'admin-token')).doc.root.title, 'Root');
  const published = await call('/api/projects/context-guard/scopes/publish', 'admin-token', { sessionId: 'a', operationId: 'publish-cloud-session', baseVersion: aBefore.mainVersion, sessionVersion: changed.version, commit });
  assert.equal(published.committed, true); assert.equal(published.source.commit, commit);
  assert.equal((await call('/api/projects/context-guard/scopes/state', 'admin-token')).doc.root.title, 'Published feature');
  const bBefore = await call('/api/projects/context-guard/scopes/state?session=b', b.sessionToken);
  const refreshed = await call('/api/projects/context-guard/scopes/refresh?session=b', b.sessionToken, { baseVersion: bBefore.version });
  assert.equal(refreshed.doc.root.title, 'Published feature');
});
