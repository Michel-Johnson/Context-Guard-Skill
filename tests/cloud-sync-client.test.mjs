import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startCloudServer } from '../scripts/cloud/server.mjs';
import { connectSync, finishSync, prepareSync, pullSync, syncStatus, trackSync } from '../scripts/sync/client.mjs';
import { MapStore } from '../scripts/workbench/store.mjs';
import { MapScopes, sessionContext } from '../scripts/workbench/scopes.mjs';

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

async function isolate(root) {
  const main = await new MapStore(root).init(), scopes = new MapScopes(root, main);
  await scopes.enable(main.version); await main.close();
}

async function editSession(root, sessionId, nodeId, purpose) {
  const file = path.join(sessionContext(root, sessionId), 'map.json');
  const doc = JSON.parse(await fs.readFile(file, 'utf8'));
  doc.root.children.find(item => item.id === nodeId).purpose = purpose;
  await fs.writeFile(file, JSON.stringify(doc, null, 2) + '\n');
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

test('isolated sync updates only each Session Map and reports lifecycle state', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const a = await f.local(), b = await f.local();
  const options = root => ({ root, url: f.cloud.url, projectId: 'sync-fixture', token: f.token, startService: false });
  await connectSync(options(a)); await connectSync(options(b));
  const main = await fetch(f.cloud.url + '/api/projects/sync-fixture/map').then(response => response.json());
  const enabled = await fetch(f.cloud.url + '/api/projects/sync-fixture/scopes/enable', { method: 'POST', headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' }, body: JSON.stringify({ baseVersion: main.version }) });
  assert.equal(enabled.status, 200);
  await isolate(a); await isolate(b);
  await prepareSync({ root: a, sessionId: 'session-a', nodeIds: ['N1'] });
  await prepareSync({ root: b, sessionId: 'session-b', nodeIds: ['N2'] });
  await editSession(a, 'session-a', 'N1', 'private A');
  await editSession(b, 'session-b', 'N2', 'private B');
  assert.equal((await finishSync({ root: a, sessionId: 'session-a' })).isolated, true);
  assert.equal((await finishSync({ root: b, sessionId: 'session-b' })).isolated, true);
  const configA = JSON.parse(await fs.readFile(path.join(a, '.codex/context/private/cloud-sync/config.json'), 'utf8'));
  const keyA = (await import('node:crypto')).createHash('sha256').update('session-a').digest('hex');
  const stateA = await fetch(f.cloud.url + '/api/projects/sync-fixture/scopes/state?session=session-a', { headers: { Authorization: `Bearer ${configA.sessionTokens[keyA]}` } }).then(response => response.json());
  assert.equal(stateA.doc.root.children.find(item => item.id === 'N1').purpose, 'private A');
  assert.equal(stateA.doc.root.children.find(item => item.id === 'N2').purpose, '');
  const cloudMain = await fetch(f.cloud.url + '/api/projects/sync-fixture/map').then(response => response.json());
  assert.equal(cloudMain.document.root.children.find(item => item.id === 'N1').purpose, '');
  const access = await fetch(f.cloud.url + '/api/workbench/projects/sync-fixture/api/access', { headers: { Authorization: 'Bearer admin' } }).then(response => response.json());
  assert.deepEqual(access.sessions.map(item => [item.id, item.status]).sort(), [['session-a', 'completed'], ['session-b', 'completed']]);
});
