import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { hash } from '../scripts/workbench/io.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { DeviceConnection } from '../scripts/workbench/protocol-device.mjs';
import { ProtocolStore } from '../scripts/workbench/protocol-store.mjs';
import { readEvents } from '../scripts/workbench/protocol-events.mjs';
import { sendMessage } from '../scripts/workbench/protocol-client.mjs';
import { startCloudServer, createWorkbenchPasswordHash } from '../scripts/cloud/server.mjs';
import { commitSessionMap, memoryHeads } from '../scripts/cloud/memory.mjs';
import { MapStore } from '../scripts/workbench/store.mjs';
import { MemorySyncCoordinator } from '../scripts/workbench/sync-coordinator.mjs';
import { startServer } from '../scripts/workbench/server.mjs';
import { resolveProject } from '../scripts/workbench/project.mjs';
import { request } from '../scripts/workbench/cli.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('IF-032: a stalled SSE cannot hide Cloud changes; durable local inbox survives restart without completing tasks', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-event-chain-'));
  const cloud = await startCloudServer({ dataDir: path.join(directory, 'cloud'), port: 0, browserToken: 'test-browser',
    browserPasswordHash: await createWorkbenchPasswordHash('test-only'), protocolConfig: { repositories: [{ slug: 'example/repo', repositoryId: '123',
      clients: { planner: { deviceId: 'cloud', agentId: 'planner', role: 'coordinator', bindings: { s: 'wt' } } } }] } });
  const options = { directory: path.join(directory, 'device'), origin: cloud.url, allowLoopback: true };
  let device = new DeviceConnection(options);
  t.after(async () => { await device.close(); await cloud.close(); await fs.rm(directory, { recursive: true, force: true }); });
  await device.connect({ v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', password: 'test-only', clientId: 'ignored' } });
  const binding = { v: 2, id: 'bind', type: 'session.bind', payload: { sessionId: 's', worktreeId: 'wt', agentId: 'agent', expectedBindingVersion: '' } };
  const { session } = await device.send(binding);
  const local = new ProtocolStore(path.join(directory, 'local'));
  const executor = { repositoryId: 'local-repo', deviceId: 'local-device', agentId: 'agent', role: 'executor' };
  const backend = { ...executor, agentId: 'backend', role: 'device' };
  await local.handle(executor, binding, { verifyBinding: () => true });
  let plannerCredential;
  await sendMessage(cloud.url, '', { v: 2, id: 'planner-login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', password: 'test-only', clientId: 'planner' } }, { allowLoopback: true, receiveCredential: v => { plannerCredential = v; } });
  const errors = [];
  const runtime = { heartbeatMs: 25, sessions: async () => [{ ...session, ackedSeq: 0 }],
    apply: async message => (await local.receiveNotification(backend, message)).data,
    onError: error => errors.push(error.code),
    eventReader: async (_origin, _credential, { signal }) => new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })) };
  device.start(runtime); device.start(runtime);
  await sendMessage(cloud.url, plannerCredential, { v: 2, id: 'brief', type: 'brief.submit', session, payload: { taskId: 'task', text: 'Human must review this first' } }, { allowLoopback: true });
  const until = Date.now() + 5000;
  while ((await local.queueHeads(backend))[0].latestSeq < 1 && Date.now() < until) await delay(20);
  assert.equal((await local.queueHeads(backend))[0].latestSeq, 1);
  const read = () => local.handle(executor, { v: 2, id: 'read', type: 'sync.read', session, payload: { afterSeq: 0, limit: 50 } });
  const received = await read();
  assert.equal(received.data.messages[0].message.type, 'brief.submit');
  assert.equal(Object.keys((await local.immutableState()).tasks).length, 0, 'transport receipt is not approval or execution');
  await device.close(); device = new DeviceConnection(options); device.start(runtime);
  await delay(100); await device.close();
  assert.deepEqual(await read(), received);
  assert.deepEqual(errors, []);

  const credential = JSON.parse(await fs.readFile(device.file, 'utf8')).credential;
  const controller = new AbortController(); let hint;
  const timeout = setTimeout(() => controller.abort(), 3000);
  try { await readEvents(cloud.url, credential, { allowLoopback: true, signal: controller.signal, onEvent: event => { hint = event; controller.abort(); } }); }
  finally { clearTimeout(timeout); }
  assert.equal(hint.type, 'sync.event'); assert.equal(hint.payload.latestSeq, 1);

  const bytes = Buffer.from('cloud binary through local backend');
  const blob = await device.send({ v: 2, id: 'blob', type: 'blob.put', session, payload: { name: 'proof.txt', size: bytes.length, sha256: hash(bytes), mediaType: 'text/plain' } });
  const proxy = http.createServer((req, res) => device.proxyBlob(req, res, session, blob.blobId).catch(() => { if (!res.headersSent) res.writeHead(503); res.end(); }));
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${proxy.address().port}`;
    const upload = () => fetch(url, { method: 'PUT', headers: { 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` }, body: bytes });
    assert.equal((await (await upload()).json()).complete, true);
    assert.equal((await (await upload()).json()).complete, true);
    const download = await fetch(url, { headers: { Range: 'bytes=0-4' } });
    assert.equal(download.status, 206); assert.equal(await download.text(), 'cloud');
    assert.equal(download.headers.has('set-cookie'), false);
    assert.equal(download.headers.has('x-context-guard-credential'), false);
    const meta = await device.send({ v: 2, id: 'blob-read', type: 'blob.get', session, payload: { blobId: blob.blobId } });
    assert.equal(meta.sha256, hash(bytes));
  } finally { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
});

test('IF-033: event transport rejects wrong origins, malformed hints and idle streams', async () => {
  await assert.rejects(readEvents('http://example.test', 'secret', {}), { code: 'FORBIDDEN' });
  const options = { onEvent: () => assert.fail('must not deliver invalid hint'), fetcher: async () => new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }) };
  await assert.rejects(readEvents('https://example.test', 'test', options), { code: 'INVALID_ARGUMENT' });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(readEvents('https://example.test', 'test', { ...options, idleMs: 20,
      fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('idle')), { once: true })) }), /idle/);
  } finally { clearTimeout(keepAlive); }
});

test('IF-046: real local backend shares Cloud sync across Sessions, delivers reviewed work and reports interruptions', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-full-interface-')), root = path.join(directory, 'repo');
  await fs.mkdir(root);
  let local, cloud;
  t.after(async () => { await local?.close(); await cloud?.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 }); });
  const exec = promisify(execFile);
  const git = async (...args) => (await exec('git', args, { cwd: root, windowsHide: true })).stdout.trim();
  await git('init', '-b', 'main'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.invalid');
  await fs.writeFile(path.join(root, 'README.md'), 'fixture'); await git('add', 'README.md'); await git('commit', '-m', 'fixture');
  const sha = await git('rev-parse', 'HEAD');
  await git('remote', 'add', 'origin', 'git@github.com:example/repo.git');
  await git('update-ref', 'refs/remotes/origin/main', sha); await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  const project = await resolveProject(root), doc = { v: 1, project: 'test', root: { id: 'R', title: 'root', children: [
    { id: 'private', title: 'private', access: [{ id: 'denied', agentId: 's', allow: 'none' }] },
  ] } };
  const ctx = path.join(root, '.codex/context'); await fs.mkdir(ctx, { recursive: true });
  await fs.writeFile(path.join(ctx, 'sessions.jsonl'), ['s', 's2'].map(id => JSON.stringify({ session_id: id, event: 'session-start', platform: 'codex' })).join('\n') + '\n');
  const memory = { dataDir: path.join(directory, 'memory'), adminToken: 'test-admin', projects: { test: { token: 'test-project' } } };
  const memoryFile = path.join(memory.dataDir, hash('test'), 'memory.json'); await fs.mkdir(path.dirname(memoryFile), { recursive: true });
  await fs.writeFile(memoryFile, JSON.stringify({ revision: 1, main: { version: 'main-v1', mainSha: sha, memory: { map: doc, records: {} } },
    sessions: Object.fromEntries(['s', 's2'].map(id => [id, { version: 'initial', baseMainVersion: 'main-v1', memory: { map: doc, records: {} } }])), receipts: {}, history: [], events: [], eventCursors: {} }));
  const protocolConfig = { repositories: [{ slug: 'example/repo', repositoryId: '123', projectId: 'test', clients: {
    coordinator: { deviceId: 'cloud-coordinator', agentId: 'coordinator', role: 'coordinator', bindings: { s: project.worktreeId, s2: project.worktreeId } },
  } }] };
  cloud = await startCloudServer({ dataDir: path.join(directory, 'cloud'), memoryConfig: memory, protocolConfig, port: 0, browserToken: 'test-browser', browserPasswordHash: await createWorkbenchPasswordHash('test-only') });
  await fs.mkdir(project.sharedDir, { recursive: true });
  await fs.writeFile(path.join(project.sharedDir, 'memory-client.json'), JSON.stringify({ url: cloud.url, projectId: 'test', token: 'test-project' }));
  const delivered = [];
  local = await startServer({ root, port: 0, messageQueue: async input => delivered.push(input), repositoryLookup: async () => ({ repositoryId: '123', slug: 'example/repo' }) });
  let seq = 0;
  const message = (type, payload, scoped = true) => ({ v: 2, id: `e2e-${++seq}`, type, ...(scoped ? { session: { id: 's', generation: 1 } } : {}), payload });
  await sendMessage(local.state.url, local.humanToken, message('auth.open', { repository: 'auto', clientId: 'ignored', password: 'test-only' }, false), { allowLoopback: true });
  const first = await request(local.state, '/api/session', { method: 'POST', body: { sessionId: 's', worktreeRoot: root } });
  const second = await request(local.state, '/api/session', { method: 'POST', body: { sessionId: 's2', worktreeRoot: root } });
  assert.equal(first.cloudBinding.status, 'ready'); assert.equal(second.cloudBinding.status, 'ready');
  const waitFor = async predicate => { const deadline = Date.now() + 15000; while (!await predicate() && Date.now() < deadline) await delay(30); assert.ok(await predicate(), 'condition did not become true'); };
  await commitSessionMap(memory, 'test', 's2', { operationId: 's2-edit', baseVersion: 'initial', operations: [{ type: 'update', id: 'R', fields: { purpose: 's2 only' } }] });
  await waitFor(() => local.stores.get('session:s2').doc.root.purpose === 's2 only');
  assert.notEqual(local.stores.get('session:s').doc.root.purpose, 's2 only');
  let credential;
  await sendMessage(cloud.url, '', message('auth.open', { repository: 'https://github.com/example/repo', clientId: 'coordinator', password: 'test-only' }, false), { allowLoopback: true, receiveCredential: value => { credential = value; } });
  const send = (type, payload) => sendMessage(cloud.url, credential, message(type, payload), { allowLoopback: true });
  const brief = await send('brief.submit', { taskId: 'task', text: 'Approved integration task' });
  await send('review.request', { taskId: 'task', kind: 'brief', ref: brief.ref, version: brief.version });
  const approved = await fetch(`${cloud.url}/api/v2/messages?project=test`, { method: 'POST', headers: { Cookie: 'cg_workbench=test-browser', 'Content-Type': 'application/json' },
    body: JSON.stringify(message('review.result', { kind: 'brief', ref: brief.ref, version: brief.version, decision: 'approved', reason: 'approved' })) });
  assert.equal(approved.status, 200, await approved.text());
  const assignment = message('task.assign', { taskId: 'task', briefRef: brief.ref, briefVersion: brief.version, sessionId: 's', nodeIds: ['R'], mainVersion: 'main-v1' });
  await assert.rejects(sendMessage(cloud.url, credential, { ...assignment, id: 'denied-assignment', payload: { ...assignment.payload, nodeIds: ['private'] } }, { allowLoopback: true }), { code: 'FORBIDDEN' });
  await sendMessage(cloud.url, credential, assignment, { allowLoopback: true });
  await waitFor(() => delivered.length === 1);
  assert.equal(delivered[0].sessionId, 's'); assert.match(delivered[0].message, /Approved integration task/);
  await sendMessage(cloud.url, credential, assignment, { allowLoopback: true });
  const interrupt = { id: 'interrupt-1', occurredAt: new Date().toISOString(), reason: 'local interruption' };
  const reported = await request(local.state, '/api/v2/interrupt', { token: first.token, method: 'POST', body: interrupt });
  assert.equal(reported.synchronized, true); assert.equal(reported.receipt.stage, 'interrupted');
  assert.deepEqual(await request(local.state, '/api/v2/interrupt', { token: first.token, method: 'POST', body: interrupt }), reported);
  assert.equal(delivered.length, 1);
  const main = await sendMessage(local.state.url, first.token, message('workbench.read', { scope: 'main', cursor: '', limit: 10 }), { allowLoopback: true });
  assert.equal(main.version, 'main-v1'); assert.equal(main.items[0].node.id, 'R');
});

test('IF-037: the project heartbeat reconciles actual private Cloud Map edits without a per-Session event connection', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-map-feed-'));
  const doc = { v: 1, project: 'test', root: { id: 'R', title: 'root', purpose: 'initial', children: [] } };
  const memory = { dataDir: path.join(root, 'memory'), adminToken: 'test-admin', projects: { test: { token: 'test-project' } } };
  const memoryFile = path.join(memory.dataDir, hash('test'), 'memory.json');
  await fs.mkdir(path.dirname(memoryFile), { recursive: true });
  await fs.writeFile(memoryFile, JSON.stringify({ revision: 1, sessions: { s: { version: 'v1', memory: { map: doc, records: {} } } }, receipts: {}, history: [], events: [], eventCursors: {} }));
  const cloud = await startCloudServer({ dataDir: path.join(root, 'cloud'), memoryConfig: memory, port: 0, browserToken: 'browser-test',
    browserPasswordHash: await createWorkbenchPasswordHash('test-only'), protocolConfig: { repositories: [{ slug: 'example/repo', repositoryId: '123', projectId: 'test' }] } });
  const localFile = path.join(root, '.codex/context/map.json'); await fs.mkdir(path.dirname(localFile), { recursive: true }); await fs.writeFile(localFile, JSON.stringify(doc));
  const store = await new MapStore(root, { project: async () => true }).init();
  const device = new DeviceConnection({ directory: path.join(root, 'device'), origin: cloud.url, allowLoopback: true });
  const coordinator = new MemorySyncCoordinator({ project: { sharedDir: path.join(root, 'shared') }, sessionId: 's', store, directory: path.join(root, 'session'),
    request: async (_project, scope) => {
      const response = await fetch(`${cloud.url}/v1/projects/test/${scope}`, { headers: { Authorization: 'Bearer test-project' } });
      assert.equal(response.status, 200); return response.json();
    } });
  t.after(async () => { await device.close(); await coordinator.close(); await store.close(); await cloud.close(); await fs.rm(root, { recursive: true, force: true }); });
  await fs.mkdir(path.dirname(coordinator.baseFile), { recursive: true }); await fs.writeFile(coordinator.baseFile, JSON.stringify(doc));
  coordinator.status.serverVersion = 'v1';
  await device.connect({ v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', clientId: 'ignored', password: 'test-only' } });
  const { session } = await device.send({ v: 2, id: 'bind', type: 'session.bind', payload: { sessionId: 's', agentId: 'agent', worktreeId: 'wt', expectedBindingVersion: '' } });
  const errors = [];
  device.start({ heartbeatMs: 25, sessions: async () => [{ ...session, ackedSeq: 0 }], apply: async () => assert.fail('Map hints are not task messages'),
    onSession: head => coordinator.projectHeartbeat(head), onError: error => errors.push(error.message) });
  const committed = await commitSessionMap(memory, 'test', 's', { operationId: 'cloud-edit', baseVersion: 'v1', operations: [{ type: 'update', id: 'R', fields: { purpose: 'from cloud' } }] });
  const until = Date.now() + 5000;
  while ((store.doc.root.purpose !== 'from cloud' || coordinator.status.serverVersion !== committed.version) && Date.now() < until) await delay(20);
  assert.equal(store.doc.root.purpose, 'from cloud'); assert.equal(coordinator.managed, true); assert.equal(coordinator.abort, null);
  assert.equal((await memoryHeads(memory, 'test')).s.mapVersion, coordinator.status.serverVersion);
  const page = await device.send({ v: 2, id: 'cloud-read', type: 'workbench.read', session, payload: { scope: 'session', cursor: '', limit: 10 } });
  assert.equal(page.version, coordinator.status.serverVersion);
  assert.equal(page.items[0].node.purpose, 'from cloud');
  const patch = { v: 2, id: 'cloud-v2-patch', type: 'workbench.patch', session,
    payload: { baseVersion: page.version, changes: [{ op: 'update', kind: 'node', id: 'R', fields: { purpose: 'v2 transaction' } }] } };
  const written = await device.send(patch);
  assert.equal(written.committed, true);
  assert.deepEqual(await device.send(patch), written);
  const changed = await device.send({ v: 2, id: 'read-v2-patch', type: 'workbench.read', session, payload: { scope: 'session', cursor: '', limit: 10 } });
  assert.equal(changed.items[0].node.purpose, 'v2 transaction');
  await assert.rejects(device.send({ ...patch, id: 'cannot-confirm', payload: { baseVersion: changed.version,
    changes: [{ op: 'update', kind: 'node', id: 'R', fields: { proposal: 'accepted' } }] } }), { code: 'FORBIDDEN' });
  await assert.rejects(device.send({ v: 2, id: 'main-missing', type: 'workbench.read', session, payload: { scope: 'main', cursor: '', limit: 10 } }), { code: 'NOT_FOUND' });
  assert.deepEqual(errors, []);
});
