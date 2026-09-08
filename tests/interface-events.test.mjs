import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { hash } from '../scripts/shared/io.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { DeviceConnection } from '../scripts/workbench/protocol-device.mjs';
import { ProtocolStore } from '../scripts/shared/protocol-store.mjs';
import { readEvents } from '../scripts/workbench/protocol-events.mjs';
import { sendMessage } from '../scripts/workbench/protocol-client.mjs';
import { startCloudServer, createWorkbenchPasswordHash } from '../scripts/cloud/server.mjs';
import { commitSessionMap, commitMainMemoryMap, memoryHeads } from '../scripts/cloud/memory.mjs';
import { MapStore } from '../scripts/workbench/store.mjs';
import { MemorySyncCoordinator } from '../scripts/workbench/sync-coordinator.mjs';
import { startServer } from '../scripts/workbench/server.mjs';
import { ClaudeRuntime } from '../scripts/workbench/claude-runtime.mjs';
import { resolveProject } from '../scripts/workbench/project.mjs';
import { request, connectCloudProject } from '../scripts/workbench/cli.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { reviewInput, reviewOperations, pendingReviewFeedback } from '../scripts/cloud/task-review.mjs';
import { applyOperations } from '../scripts/shared/map-model.mjs';

test('human review binds the result, preserves feedback and never publishes failed work', () => {
  const input = reviewInput({ operationId: 'r1', sessionId: 's1', taskId: 't1', resultVersion: 'v1', nodeId: 'R', itemId: 'TD1', kind: 'todo', decision: 'rejected', reason: 'needs correction' });
  const task = { taskId: 't1', sessionId: 's1', version: 'v1', result: { outcome: 'failed', summary: 'Evidence of failure' } };
  const document = { v: 1, root: { id: 'R', title: 'Root', todos: [{ id: 'TD1', title: 'Verify task', dispatch: { task_id: 't1', session_id: 's1' } }], memories: [{ id: 'existing', text: 'Preserve this memory' }], children: [] } };
  assert.throws(() => reviewInput({ ...input, reason: 'x'.repeat(2001) }), /required/);
  assert.throws(() => reviewOperations(document, { ...input, decision: 'approved' }, task), /success/);
  assert.throws(() => reviewOperations(document, input, { ...task, version: 'v2' }), /changed/);
  const rejected = applyOperations(document, reviewOperations(document, input, task).operations, { kind: 'human' }).doc;
  assert.deepEqual(rejected.root.memories, document.root.memories);
  assert.equal(pendingReviewFeedback(rejected).length, 1);
  assert.deepEqual(reviewOperations(rejected, input, task).operations, []);
  // A new execution or reassignment must not lose previously pending feedback.
  rejected.root.todos[0].dispatch = { task_id: 't2', session_id: 's2' };
  const next = { ...input, operationId: 'r2', taskId: 't2', sessionId: 's2', resultVersion: 'v2', decision: 'approved' };
  const nextTask = { taskId: 't2', sessionId: 's2', version: 'v2', result: { outcome: 'success', summary: 'Verified correction' } };
  const accepted = applyOperations(rejected, reviewOperations(rejected, next, nextTask).operations, { kind: 'human' }).doc;
  assert.equal(accepted.root.todos[0].status, 'done');
  assert.equal(accepted.root.memories.length, 2);
  assert.equal(pendingReviewFeedback(accepted)[0].sessionId, 's1');
  assert.throws(() => reviewOperations(accepted, input, task), /changed/);
});

async function heartbeatDevice(device) {
  const { origin, ...input } = await device.runtime.prepare();
  const response = await fetch(new URL('/api/v2/heartbeat', origin), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([input]) });
  assert.equal(response.status, 200);
  device.runtime.accept((await response.json())[0]);
}

test('IF-032: device-driven heartbeat receives Cloud changes without SSE; durable inbox survives restart without completing tasks', async t => {
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
  const runtime = { sessions: async () => [{ ...session, ackedSeq: 0 }],
    apply: async message => (await local.receiveNotification(backend, message)).data,
    onError: error => errors.push(error.code) };
  device.start(runtime); device.start(runtime);
  await sendMessage(cloud.url, plannerCredential, { v: 2, id: 'brief', type: 'brief.submit', session, payload: { taskId: 'task', text: 'Human must review this first' } }, { allowLoopback: true });
  const until = Date.now() + 5000;
  while ((await local.queueHeads(backend))[0].latestSeq < 1 && Date.now() < until) { await heartbeatDevice(device); await delay(20); }
  assert.equal((await local.queueHeads(backend))[0].latestSeq, 1);
  const read = () => local.handle(executor, { v: 2, id: 'read', type: 'sync.read', session, payload: { afterSeq: 0, limit: 50 } });
  const received = await read();
  assert.equal(received.data.messages[0].message.type, 'brief.submit');
  assert.equal(Object.keys((await local.immutableState()).tasks).length, 0, 'transport receipt is not approval or execution');
  await device.close(); device = new DeviceConnection(options); device.start(runtime);
  await heartbeatDevice(device); await device.close();
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
  let local, cloud, heartbeatOnlyDevice, cloudEventController, cloudEventReader;
  t.after(async () => { cloudEventController?.abort(); await cloudEventReader?.cancel().catch(() => {}); await heartbeatOnlyDevice?.close(); await local?.close(); await cloud?.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 }); });
  const exec = promisify(execFile);
  const git = async (...args) => (await exec('git', args, { cwd: root, windowsHide: true })).stdout.trim();
  await git('init', '-b', 'main'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.invalid');
  await fs.writeFile(path.join(root, 'README.md'), 'fixture'); await git('add', 'README.md'); await git('commit', '-m', 'fixture');
  const sha = await git('rev-parse', 'HEAD');
  await git('remote', 'add', 'origin', 'git@github.com:example/repo.git');
  await git('update-ref', 'refs/remotes/origin/main', sha); await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  const project = await resolveProject(root), doc = { v: 1, project: 'test', root: { id: 'R', title: 'root', todos: [
    { id: 'TD1', title: 'Approved integration task', status: 'pending' },
    { id: 'TD2', title: 'Queued integration task', status: 'pending' },
  ], bugs: [{ id: 'B40', title: 'Old record', status: 'open' }, { id: 'B40', title: 'Colliding record', status: 'open' },
    { id: 'B41', title: 'Fixed problem', status: 'fixed', sessions: ['s2'] }], children: [
    { id: 'private', title: 'private', todos: [{ id: 'TD3', title: 'Denied task', status: 'pending' }], access: [{ id: 'denied', agentId: 's', allow: 'none' }] },
  ] } };
  const ctx = path.join(root, '.codex/context'); await fs.mkdir(ctx, { recursive: true });
  await fs.writeFile(path.join(ctx, 'sessions.jsonl'), [['s', 'session-one'], ['s2', 'session-two']].map(([id, thread_name]) => JSON.stringify({
    session_id: id, event: 'session-start', platform: 'codex', thread_name,
  })).join('\n') + '\n');
  const memory = { dataDir: path.join(directory, 'memory'), adminToken: 'test-admin', projects: { 'context-guard': { token: 'test-project' } } };
  const memoryFile = path.join(memory.dataDir, hash('context-guard'), 'memory.json'); await fs.mkdir(path.dirname(memoryFile), { recursive: true });
  await fs.writeFile(memoryFile, JSON.stringify({ revision: 1, main: { version: 'main-v1', mainSha: sha, memory: { map: doc, records: {} } },
    sessions: Object.fromEntries(['s', 's2'].map(id => [id, { version: 'initial', baseMainVersion: 'main-v1', memory: { map: doc, records: {} } }])), receipts: {}, history: [], events: [], eventCursors: {} }));
  const protocolConfig = { repositories: [{ slug: 'example/repo', repositoryId: '123', projectId: 'context-guard', clients: {
    coordinator: { deviceId: 'cloud-coordinator', agentId: 'coordinator', role: 'coordinator', bindings: { s: project.worktreeId, s2: project.worktreeId } },
  } }] };
  cloud = await startCloudServer({ dataDir: path.join(directory, 'cloud'), memoryConfig: memory, protocolConfig, port: 0, browserToken: 'test-browser', browserPasswordHash: await createWorkbenchPasswordHash('test-only') });
  const cloudHeaders = { Cookie: 'cg_workbench=test-browser', 'Content-Type': 'application/json' };
  const cloudAccess = async () => (await fetch(`${cloud.url}/api/workbench/projects/context-guard/api/access?view=main`, { headers: cloudHeaders })).json();
  assert.deepEqual((await cloudAccess()).sessions.map(item => [item.id, item.status]), [['s', 'offline'], ['s2', 'offline']]);
  cloudEventController = new AbortController();
  const cloudEvents = await fetch(`${cloud.url}/api/workbench/projects/context-guard/api/events?view=main`, { headers: cloudHeaders, signal: cloudEventController.signal });
  assert.equal(cloudEvents.status, 200);
  cloudEventReader = cloudEvents.body.getReader();
  await cloudEventReader.read();
  heartbeatOnlyDevice = new DeviceConnection({ directory: path.join(directory, 'heartbeat-only-device'), origin: cloud.url, allowLoopback: true });
  await heartbeatOnlyDevice.connect({ v: 2, id: 'heartbeat-login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', password: 'test-only', clientId: 'ignored' } });
  const heartbeatOnlyBinding = await heartbeatOnlyDevice.send({ v: 2, id: 'heartbeat-bind', type: 'session.bind', payload: {
    sessionId: 'heartbeat-only', worktreeId: 'heartbeat-worktree', agentId: 'heartbeat-agent', expectedBindingVersion: '',
  } });
  await heartbeatOnlyDevice.send({ v: 2, id: 'heartbeat-presence', type: 'sync.heartbeat', payload: { sessions: [{
    ...heartbeatOnlyBinding.session, ackedSeq: 0, name: 'live-task', platform: 'codex',
    execution: { status: 'active', at: '2026-09-08T00:00:00Z' },
  }] } });
  const accessEvent = await Promise.race([
    cloudEventReader.read().then(part => new TextDecoder().decode(part.value || new Uint8Array())),
    delay(2000).then(() => assert.fail('Cloud workbench did not receive the heartbeat access event')),
  ]);
  assert.match(accessEvent, /event: access/);
  const heartbeatAccess = await cloudAccess();
  assert.deepEqual(
    Object.fromEntries(['name', 'platform', 'status'].map(key => [key, heartbeatAccess.sessions.find(item => item.id === 'heartbeat-only')?.[key]])),
    { name: 'live-task', platform: 'codex', status: 'online' },
  );
  assert.deepEqual(heartbeatAccess.grants['heartbeat-only'].nodes, ['R', 'private']);
  assert.deepEqual(heartbeatAccess.sessions.find(item => item.id === 'heartbeat-only').execution,
    { status: 'active', at: '2026-09-08T00:00:00Z' });
  const mixedBeat = await heartbeatOnlyDevice.send({ v: 2, id: 'heartbeat-stopped', type: 'sync.heartbeat', payload: { sessions: [
    { ...heartbeatOnlyBinding.session, ackedSeq: 0, execution: { status: 'stopped', at: '2026-09-08T00:01:00Z' } },
    { id: 'not-owned', generation: 1, ackedSeq: 0, name: 'must-not-appear' },
  ] } });
  assert.deepEqual(mixedBeat.rejected, [{ id: 'not-owned', generation: 1, code: 'FORBIDDEN' }]);
  const stoppedAccess = await cloudAccess();
  assert.equal(stoppedAccess.sessions.some(item => item.id === 'not-owned'), false);
  assert.deepEqual(stoppedAccess.sessions.find(item => item.id === 'heartbeat-only').execution,
    { status: 'stopped', at: '2026-09-08T00:01:00Z' });
  await fs.mkdir(project.sharedDir, { recursive: true });
  await fs.writeFile(path.join(project.sharedDir, 'memory-client.json'), JSON.stringify({ url: cloud.url, projectId: 'context-guard', token: 'test-project' }));
  const delivered = [];
  local = await startServer({ root, port: 0, messageQueue: async input => delivered.push(input), repositoryLookup: async () => ({ repositoryId: '123', slug: 'example/repo' }) });
  let seq = 0;
  const message = (type, payload, scoped = true) => ({ v: 2, id: `e2e-${++seq}`, type, ...(scoped ? { session: { id: 's', generation: 1 } } : {}), payload });
  const login = await connectCloudProject(root, { url: cloud.url, password: 'test-only', repositoryLookup: async () => ({ repositoryId: '123', slug: 'example/repo' }) });
  assert.deepEqual(login, { connected: true, projectId: 'context-guard', url: cloud.url });
  // The same project login authorizes memory. New Sessions need neither a
  // project token nor Hooks, and cannot read a different device's Session.
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(project.sharedDir, 'memory-client.json'), 'utf8')), { url: cloud.url, projectId: 'context-guard' });
  assert.equal(JSON.parse(await fs.readFile(path.join(project.sharedDir, 'memory-client.json.before-device-login'), 'utf8')).token, 'test-project');
  const connection = JSON.parse(await fs.readFile(path.join(project.sharedDir, 'interface-v2/device-connection.json'), 'utf8'));
  assert.equal(connection.projectId, 'context-guard');
  assert.ok(connection.capabilities.includes('device-memory'));
  const memoryRead = resource => fetch(`${cloud.url}/v1/projects/context-guard/${resource}`, { headers: { Authorization: `Bearer ${connection.credential}` } });
  assert.equal((await memoryRead('main')).status, 200);
  assert.equal((await memoryRead('sessions/heartbeat-only')).status, 403);
  assert.equal((await memoryRead('history')).status, 401);
  const first = await request(local.state, '/api/session', { method: 'POST', body: { sessionId: 's', worktreeRoot: root } });
  const second = await request(local.state, '/api/session', { method: 'POST', body: { sessionId: 's2', worktreeRoot: root } });
  assert.equal(first.cloudBinding.status, 'ready'); assert.equal(second.cloudBinding.status, 'ready');
  const protocolFile = path.join(project.sharedDir, 'interface-v2/protocol-v2.json');
  const registeredState = await fs.readFile(protocolFile, 'utf8');
  const again = await request(local.state, '/api/session', { method: 'POST', body: { sessionId: 's', worktreeRoot: root } });
  assert.deepEqual(again.protocolBinding, first.protocolBinding);
  assert.equal(await fs.readFile(protocolFile, 'utf8'), registeredState, 'ordinary Map calls must not append repeated binding receipts');
  assert.equal(local.stores.has('session:s'), false, 'Cloud binding must not download a Map');
  await request(local.state, '/api/state', { token: first.token });
  await request(local.state, '/api/state', { token: second.token });
  assert.equal((await memoryRead('sessions/s')).status, 200);
  const waitFor = async predicate => { const deadline = Date.now() + 15000; while (!await predicate() && Date.now() < deadline) await delay(30); assert.ok(await predicate(), 'condition did not become true'); };
  await waitFor(async () => (await cloudAccess()).sessions.filter(item => ['s', 's2'].includes(item.id)).every(item => item.status === 'online'));
  // Exercise the actual backend heartbeat callback, not provision() alone:
  // resolveProject exposes mainRef, not the CLI inventory's nested main.ref.
  const creationStore = new ProtocolStore(path.join(directory, 'cloud', 'interface-v2', hash('123')));
  const creationHuman = { repositoryId: '123', deviceId: 'browser', agentId: 'human', role: 'human' };
  const creationCalls = [];
  const creationProbe = t.mock.method(ClaudeRuntime.prototype, 'provision', async (input, options) => {
    creationCalls.push({ input, options });
    throw Object.assign(new Error('Preparation probe; no model launched'), { code: 'CREATION_PROBE' });
  });
  const creation = await creationStore.requestSessionCreation(creationHuman, { operationId: 'backend-main-ref', templateSessionId: 's', name: 'Creation probe' });
  await waitFor(async () => {
    const { origin, ...beat } = await request(local.state, '/api/device-heartbeat');
    const response = await fetch(new URL('/api/v2/heartbeat', origin), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([beat]) });
    const [reply] = await response.json();
    assert.equal(reply.ok, true);
    await request(local.state, '/api/device-heartbeat', { method: 'POST', body: reply });
    return (await creationStore.sessionCreations(creationHuman)).find(item => item.id === creation.id)?.state === 'failed';
  });
  assert.ok(creationCalls.length > 0);
  assert.ok(creationCalls.every(call => call.input.id === creation.id && call.options.baseRef === 'refs/remotes/origin/main'));
  creationProbe.mock.restore();
  await fs.appendFile(path.join(ctx, 'sessions.jsonl'), JSON.stringify({ session_id: 's3', event: 'session-start', platform: 'codex', thread_name: 'new-session' }) + '\n');
  const cli = path.resolve('scripts/workbench/cli.mjs');
  const { stdout } = await exec(process.execPath, [cli, 'map', 'status', '--root', root, '--session', 's3'], { env: process.env, timeout: 15000, windowsHide: true });
  assert.equal(JSON.parse(stdout).error, null);
  const opened = JSON.parse((await exec(process.execPath, [cli, 'workbench', '--root', root, '--session', 's3'], { env: process.env, timeout: 15000, windowsHide: true })).stdout);
  assert.equal(opened.url, `${cloud.url}/projects/context-guard?session=s3`);
  assert.equal(opened.cloudBinding.status, 'ready');
  assert.deepEqual((await cloudAccess()).sessions.filter(item => ['s', 's2'].includes(item.id)).map(item => [item.name, item.platform]), [
    ['session-one', 'codex'], ['session-two', 'codex'],
  ]);
  const s2Version = (await memoryHeads(memory, 'context-guard')).s2.mapVersion;
  await commitSessionMap(memory, 'context-guard', 's2', { operationId: 's2-edit', baseVersion: s2Version, operations: [{ type: 'update', id: 'R', fields: { purpose: 's2 only' } }] });
  await waitFor(() => local.stores.get('session:s2').doc.root.purpose === 's2 only');
  assert.notEqual(local.stores.get('session:s').doc.root.purpose, 's2 only');
  const cloudCall = (route, body) => fetch(`${cloud.url}/api/workbench/projects/context-guard${route}?view=main`, { method: 'POST', headers: cloudHeaders, body: JSON.stringify(body) });
  const ambiguous = await cloudCall('/api/session-message', { operationId: 'ambiguous-bug', sessionId: 's', nodeId: 'R', bugId: 'B40' });
  assert.equal(ambiguous.status, 409);
  assert.match((await ambiguous.json()).error.message, /duplicated/);
  assert.equal(delivered.length, 0);
  const plan = await cloudCall('/api/access-plan', { sessionId: 's', nodeId: 'R' });
  assert.equal(plan.status, 200); assert.deepEqual((await plan.json()).missing, []);
  const deniedPlan = await cloudCall('/api/access-plan', { sessionId: 's', nodeId: 'private' });
  assert.equal(deniedPlan.status, 200); assert.deepEqual((await deniedPlan.json()).missing, ['private']);
  const denied = await cloudCall('/api/session-message', { operationId: 'denied-task', sessionId: 's', nodeId: 'private', todoId: 'TD3' });
  assert.equal(denied.status, 403);
  const assignment = { operationId: 'approved-task', sessionId: 's', nodeId: 'R', todoId: 'TD1' };
  const assignedResponse = await cloudCall('/api/session-message', assignment);
  assert.equal(assignedResponse.status, 200);
  const assigned = await assignedResponse.json(); assert.equal(assigned.state, 'cloud_queued');
  const repeated = await cloudCall('/api/session-message', assignment);
  assert.deepEqual(await repeated.json(), assigned);
  await waitFor(() => delivered.length === 1);
  assert.equal(delivered[0].sessionId, 's'); assert.match(delivered[0].message, /Approved integration task/);
  await waitFor(async () => {
    const response = await cloudCall('/api/task-status', { tasks: [{ taskId: assigned.taskId, sessionId: 's' }] });
    return (await response.json()).tasks?.[0]?.state === 'codex_received';
  });
  const queuedResponse = await cloudCall('/api/session-message', { operationId: 'queued-task', sessionId: 's', nodeId: 'R', todoId: 'TD2' });
  assert.equal((await queuedResponse.json()).state, 'queued'); assert.equal(delivered.length, 1);
  const deliveryId = delivered[0].message.match(/map task start (\S+)/)[1];
  const reportTask = body => request(local.state, '/api/v2/task-report', { token: first.token, method: 'POST', body: { deliveryId, ...body } });
  await assert.rejects(reportTask({ deliveryId: 'unknown', stage: 'started' }));
  const startReceipt = await reportTask({ stage: 'started' });
  assert.deepEqual(await reportTask({ stage: 'started' }), startReceipt);
  const running = await cloudCall('/api/task-status', { tasks: [{ taskId: assigned.taskId, sessionId: 's' }] });
  assert.equal((await running.json()).tasks[0].state, 'executing');
  const finish = { stage: 'finished', outcome: 'success', summary: 'Isolated adapter execution completed' };
  const finishReceipt = await reportTask(finish);
  assert.deepEqual(await reportTask(finish), finishReceipt);
  await assert.rejects(reportTask({ ...finish, summary: 'changed retry' }));
  await waitFor(() => delivered.length === 2);
  const completed = await cloudCall('/api/task-status', { tasks: [{ taskId: assigned.taskId, sessionId: 's' }] });
  assert.equal((await completed.json()).tasks[0].state, 'completed');
  const interrupt = { id: 'interrupt-1', occurredAt: new Date().toISOString(), reason: 'local interruption' };
  const reported = await request(local.state, '/api/v2/interrupt', { token: first.token, method: 'POST', body: interrupt });
  assert.equal(reported.synchronized, true); assert.equal(reported.receipt.stage, 'interrupted');
  assert.deepEqual(await request(local.state, '/api/v2/interrupt', { token: first.token, method: 'POST', body: interrupt }), reported);
  assert.equal(delivered.length, 2);
  const main = await sendMessage(local.state.url, first.token, message('workbench.read', { scope: 'main', cursor: '', limit: 10 }), { allowLoopback: true });
  assert.equal(main.version, 'main-v1'); assert.equal(main.items[0].node.id, 'R');
  // Binding identity and name outlive the ephemeral presence cache. Restart
  // Cloud while the local process is stopped: registered Sessions stay listed,
  // but none can pretend that their heartbeat is still online.
  cloudEventController.abort(); await cloudEventReader.cancel().catch(() => {});
  await local.close(); local = null;
  const cloudPort = Number(new URL(cloud.url).port);
  await cloud.close();
  cloud = await startCloudServer({ dataDir: path.join(directory, 'cloud'), memoryConfig: memory, protocolConfig, port: cloudPort, browserToken: 'test-browser', browserPasswordHash: await createWorkbenchPasswordHash('test-only') });
  const restored = (await cloudAccess()).sessions;
  assert.equal(restored.find(item => item.id === 'heartbeat-only').name, 'live-task');
  assert.equal(restored.find(item => item.id === 'heartbeat-only').status, 'offline');
  assert.equal(restored.find(item => item.id === 's').name, 'session-one');
  local = await startServer({ root, port: 0, messageQueue: async input => delivered.push(input), repositoryLookup: async () => ({ repositoryId: '123', slug: 'example/repo' }) });
  await waitFor(async () => (await cloudAccess()).sessions.filter(item => ['s', 's2'].includes(item.id)).every(item => item.status === 'online'));
  assert.equal(delivered.length, 2, 'restart must not redeliver either accepted task');
  assert.equal((await cloudCall('/api/session-message', { operationId: 'old-summary', sessionId: 's2', nodeId: 'R', bugId: 'B41', purpose: 'summary' })).status, 409);
  const assignedBug = await (await cloudCall('/api/session-message', { operationId: 'bug-work', sessionId: 's2', nodeId: 'R', bugId: 'B41' })).json();
  const linkWork = async (field, id, sessionId, taskId) => {
    const snapshot = JSON.parse(await fs.readFile(memoryFile, 'utf8')).main;
    await commitMainMemoryMap(memory, 'context-guard', { operationId: `link-${id}`, baseVersion: snapshot.version,
      operations: [{ type: 'update', id: 'R', fields: { [field]: snapshot.memory.map.root[field].map(item => item.id === id ? { ...item, dispatch: { task_id: taskId, session_id: sessionId } } : item) } }] });
  };
  await linkWork('bugs', 'B41', 's2', assignedBug.taskId);
  await linkWork('todos', 'TD1', 's', assigned.taskId);
  const bugReview = { operationId: 'review-bug', sessionId: 's2', taskId: assignedBug.taskId, resultVersion: 'not-finished', nodeId: 'R', itemId: 'B41', kind: 'bug', decision: 'approved' };
  assert.equal((await cloudCall('/api/task-review', bugReview)).status, 409, 'unfinished task cannot be accepted');
  await waitFor(() => delivered.length === 3);
  assert.equal(delivered[2].sessionId, 's2'); assert.match(delivered[2].message, /完成时一并提交总结/);
  const summaryDelivery = delivered[2].message.match(/map task start (\S+)/)[1];
  const freshSecond = await request(local.state, '/api/session', { method: 'POST', body: { sessionId: 's2', worktreeRoot: root } });
  const summaryReport = body => request(local.state, '/api/v2/task-report', { token: freshSecond.token, method: 'POST', body: { deliveryId: summaryDelivery, ...body } });
  const cliStart = await exec(process.execPath, [fileURLToPath(new URL('../scripts/workbench/cli.mjs', import.meta.url)), 'map', 'task', 'start', summaryDelivery, '--root', root, '--session', 's2'], { windowsHide: true });
  assert.equal(JSON.parse(cliStart.stdout).data.stage, 'executing');
  const freshFirst = await request(local.state, '/api/session', { method: 'POST', body: { sessionId: 's', worktreeRoot: root } });
  await assert.rejects(request(local.state, '/api/v2/task-report', { token: freshFirst.token, method: 'POST', body: { deliveryId: summaryDelivery, stage: 'started' } }));
  const actualSummary = '原因：重复编号。修复：跳过已有编号。验证：实际派单成功。';
  await assert.rejects(summaryReport({ stage: 'finished', summary: '' }));
  const cliFinish = await exec(process.execPath, [fileURLToPath(new URL('../scripts/workbench/cli.mjs', import.meta.url)), 'map', 'task', 'finish', summaryDelivery, '--summary', actualSummary, '--root', root, '--session', 's2'], { windowsHide: true });
  assert.equal(JSON.parse(cliFinish.stdout).data.stage, 'finished');
  const summaryStatus = await cloudCall('/api/task-status', { tasks: [{ taskId: assignedBug.taskId, sessionId: 's2' }] });
  const summaryResult = (await summaryStatus.json()).tasks[0];
  assert.equal(summaryResult.state, 'completed'); assert.equal(summaryResult.result.summary, actualSummary);
  assert.equal((await cloudCall('/api/task-review', bugReview)).status, 409, 'stale result is rejected');
  bugReview.resultVersion = summaryResult.version;
  assert.equal((await fetch(`${cloud.url}/api/workbench/projects/context-guard/api/task-review?view=main`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bugReview) })).status, 401);
  assert.equal((await cloudCall('/api/task-review', { ...bugReview, sessionId: 's' })).status, 404);
  const reviewed = await Promise.all(Array.from({ length: 20 }, (_, index) => cloudCall('/api/task-review', { ...bugReview, operationId: `review-browser-${index}` })));
  assert.ok(reviewed.every(response => response.status === 200), 'concurrent human approvals are idempotent');
  const persisted = () => fs.readFile(memoryFile, 'utf8').then(text => JSON.parse(text).main.memory.map.root);
  const saved = await persisted();
  assert.equal(saved.bugs.find(bug => bug.id === 'B41').review.decision, 'approved');
  assert.equal(saved.bugs.find(bug => bug.id === 'B41').status, 'resolved');
  assert.equal(saved.memories.filter(item => item.taskId === assignedBug.taskId).length, 1);
  assert.equal(saved.memories.find(item => item.taskId === assignedBug.taskId).text, actualSummary);
  assert.equal((await cloudCall('/api/task-review', { ...bugReview, decision: 'rejected' })).status, 409, 'opposite decision cannot replace this version');
  const todoResult = (await (await cloudCall('/api/task-status', { tasks: [{ taskId: assigned.taskId, sessionId: 's' }] })).json()).tasks[0];
  const rejection = { operationId: 'reject-todo', sessionId: 's', taskId: assigned.taskId, resultVersion: todoResult.version, nodeId: 'R', itemId: 'TD1', kind: 'todo', decision: 'rejected', reason: '没有满足验收条件' };
  assert.equal((await cloudCall('/api/task-review', rejection)).status, 200);
  assert.equal((await cloudCall('/api/task-review', rejection)).status, 200);
  const feedback = await fetch(`${cloud.url}/api/workbench/projects/context-guard/api/review-feedback?view=main`, { headers: cloudHeaders }).then(response => response.json());
  assert.equal(feedback.items.length, 1); assert.equal(feedback.items[0].reason, rejection.reason);
  assert.equal(feedback.items[0].sessionId, 's');
  assert.equal((await persisted()).todos.find(todo => todo.id === 'TD1').status, 'pending');
  await cloud.close();
  cloud = await startCloudServer({ dataDir: path.join(directory, 'cloud'), memoryConfig: memory, protocolConfig, port: cloudPort, browserToken: 'test-browser', browserPasswordHash: await createWorkbenchPasswordHash('test-only') });
  assert.equal((await cloudCall('/api/task-review', rejection)).status, 200, 'restart preserves review idempotency');
  assert.equal((await persisted()).memories.length, saved.memories.length);
  assert.equal(delivered.length, 3, 'approval and rejection never dispatch a model task');
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
  device.start({ sessions: async () => [{ ...session, ackedSeq: 0 }], apply: async () => assert.fail('Map hints are not task messages'),
    onSession: head => coordinator.projectHeartbeat(head), onError: error => errors.push(error.message) });
  const committed = await commitSessionMap(memory, 'test', 's', { operationId: 'cloud-edit', baseVersion: 'v1', operations: [{ type: 'update', id: 'R', fields: { purpose: 'from cloud' } }] });
  const until = Date.now() + 5000;
  while ((store.doc.root.purpose !== 'from cloud' || coordinator.status.serverVersion !== committed.version) && Date.now() < until) { await heartbeatDevice(device); await delay(20); }
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
