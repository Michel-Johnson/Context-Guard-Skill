import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startCloudServer, createWorkbenchPasswordHash } from '../scripts/cloud/server.mjs';
import { DeviceConnection } from '../scripts/workbench/protocol-device.mjs';
import { sendMessage } from '../scripts/workbench/protocol-client.mjs';
import { createHash } from 'node:crypto';
import { ProtocolStore } from '../scripts/shared/protocol-store.mjs';

const execFileAsync = promisify(execFile);

test('developer Main CLI reads and applies an allowlisted structural change without a Session binding', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-developer-main-cli-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, 'project'); await fs.mkdir(project);
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: project, windowsHide: true });
  await execFileAsync('git', ['remote', 'add', 'origin', 'https://github.com/example/repo.git'], { cwd: project, windowsHide: true });
  const shared = path.join(project, '.git', 'context-guard'), interfaceDir = path.join(shared, 'interface-v2');
  const memoryDir = path.join(directory, 'memory'), projectId = 'context-guard';
  const memoryProjectDir = path.join(memoryDir, createHash('sha256').update(projectId).digest('hex'));
  await fs.mkdir(memoryProjectDir, { recursive: true });
  await fs.writeFile(path.join(memoryProjectDir, 'memory.json'), JSON.stringify({ revision: 1, preferences: null,
    main: { version: 'main-v1', memory: { map: { v: 1, project: 'Blog', bootstrap: 'ready', flows: [], root: {
      id: 'T0', title: 'Blog', kind: 'module', state: 'dirty', children: [],
    } }, records: {} } }, sessions: {}, closedSessions: {}, receipts: {}, history: [], events: [], eventCursors: {} }));
  const cloud = await startCloudServer({ dataDir: path.join(directory, 'cloud'), port: 0, browserToken: 'test-browser',
    browserPasswordHash: await createWorkbenchPasswordHash('test-only'), memoryConfig: {
      dataDir: memoryDir, adminToken: 'memory-admin', projects: { [projectId]: { token: 'project-token' } },
    }, protocolConfig: { repositories: [{ slug: 'example/repo', repositoryId: '123', projectId,
      developerMainWriteClientIds: ['developer-client'] }] } });
  t.after(() => cloud.close());
  await fs.mkdir(interfaceDir, { recursive: true });
  await fs.writeFile(path.join(interfaceDir, 'device-identity.json'), JSON.stringify({ clientId: 'developer-client' }));
  const device = new DeviceConnection({ directory: interfaceDir, origin: cloud.url, allowLoopback: true });
  await device.connect({ v: 2, id: 'connect', type: 'auth.open', payload: {
    repository: 'https://github.com/example/repo', password: 'test-only', clientId: 'ignored-by-device-identity',
  } }, { repositoryId: '123' });
  await fs.writeFile(path.join(shared, 'memory-client.json'), JSON.stringify({ url: cloud.url, projectId }));
  const cli = new URL('../scripts/workbench/cli.mjs', import.meta.url);
  const read = JSON.parse((await execFileAsync(process.execPath, [cli.pathname, 'map', 'main', 'read', '--root', project], { windowsHide: true })).stdout);
  assert.equal(read.version, 'main-v1'); assert.equal(read.doc.root.title, 'Blog');
  const requestFile = path.join(directory, 'request.json');
  await fs.writeFile(requestFile, JSON.stringify({ operationId: 'cli-create-content', baseVersion: read.version, changes: [{
    op: 'create', kind: 'node', id: 'content', fields: { parentId: 'T0', title: '内容', purpose: '内容', kind: 'module', state: 'untested', owns: ['source/'] },
  }] }));
  const applied = JSON.parse((await execFileAsync(process.execPath, [cli.pathname, 'map', 'main', 'apply', '--root', project, '--input', requestFile], { windowsHide: true })).stdout);
  assert.equal(applied.committed, true);
  const after = JSON.parse((await execFileAsync(process.execPath, [cli.pathname, 'map', 'main', 'read', '--root', project], { windowsHide: true })).stdout);
  assert.equal(after.doc.root.children[0].title, '内容');
});

test('Creation failures survive local restart and are acknowledged through the device heartbeat', async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cg-creation-feedback-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const cloudDir=path.join(directory,'cloud');
  const cloud=await startCloudServer({dataDir:cloudDir,port:0,browserToken:'test-browser',browserPasswordHash:await createWorkbenchPasswordHash('test-only'),protocolConfig:{repositories:[{slug:'example/repo',repositoryId:'123'}]}});
  t.after(()=>cloud.close());
  const options={directory:path.join(directory,'local'),origin:cloud.url,allowLoopback:true};
  let device=new DeviceConnection(options);
  await device.connect({v:2,id:'connect',type:'auth.open',payload:{repository:'https://github.com/example/repo',password:'test-only',clientId:'device'}});
  const bound=await device.send({v:2,id:'bind',type:'session.bind',payload:{sessionId:'s',worktreeId:'wt',agentId:'s',expectedBindingVersion:''}});
  const store=new ProtocolStore(path.join(cloudDir,'interface-v2',createHash('sha256').update('123').digest('hex')));
  const human={repositoryId:'123',deviceId:'browser',agentId:'human',role:'human'};
  const created=await store.requestSessionCreation(human,{operationId:'create',templateSessionId:'s',name:'New developer'});
  await device.recordCreationFailure(created.id,'SETTINGS_REQUIRED');
  await device.close();device=new DeviceConnection(options);
  device.start({sessions:async()=>[{...bound.session,ackedSeq:0}],apply:async()=>({outcome:'applied'})});
  const prepared=await device.runtime.prepare();
  assert.deepEqual(prepared.message.payload.creationResults,[{id:created.id,error:'SETTINGS_REQUIRED'}]);
  const response=await fetch(cloud.url+'/api/v2/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([{credential:prepared.credential,message:prepared.message}])});
  const [reply]=await response.json();
  assert.equal(reply.ok,true);
  assert.equal(reply.data.creationResults[0].accepted,true);
  assert.equal((await store.sessionCreations(human))[0].state,'failed');
  device.runtime.accept(reply);await device.close();
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(options.directory,'creation-results.json'),'utf8')),{});
});

test('IF-022: password authorizes a backend which enrolls Agents; lost replies replay after restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-device-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cloud = await startCloudServer({ dataDir: path.join(directory, 'cloud'), port: 0, browserToken: 'test-browser', browserPasswordHash: await createWorkbenchPasswordHash('test-only'), protocolConfig: { repositories: [{ slug: 'example/repo', repositoryId: '123' }] } });
  try {
    let lose = false, reply;
    const options = { directory: path.join(directory, 'local'), origin: cloud.url, allowLoopback: true,
      transport: async (...args) => { const result = await sendMessage(...args); if (lose) { lose = false; reply = result; throw new Error('lost reply'); } return result; } };
    const device = new DeviceConnection(options);
    await device.connect({ v: 2, id: 'connect', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', password: 'test-only', clientId: 'device-1' } });
    assert.equal((await fs.readFile(device.file, 'utf8')).includes('test-only'), false);
    const bind = await device.send({ v: 2, id: 'bind', type: 'session.bind', payload: { sessionId: 's', worktreeId: 'wt', agentId: 'agent-for-s', expectedBindingVersion: '' } });
    const input = { v: 2, id: 'write', type: 'object.put', session: bind.session, payload: { kind: 'plan', ref: 'plan', baseVersion: '', content: { text: 'keep original task' } } };
    lose = true; await assert.rejects(device.send(input));
    const restarted = new DeviceConnection(options);
    assert.deepEqual(await restarted.retryPending(), [{ id: 'write', sent: true }]);
    assert.deepEqual(await restarted.send(input), reply);
    const conflicting = { ...input, id: 'stale-write', payload: { ...input.payload, content: { text: 'stale' } } };
    await assert.rejects(restarted.send(conflicting), { code: 'CONFLICT' });
    const corrected = { ...input, id: 'corrected-write', payload: { ...input.payload, baseVersion: reply.version, content: { text: 'corrected' } } };
    await restarted.send(corrected);
    await assert.rejects(new DeviceConnection(options).send(conflicting), { code: 'CONFLICT' });
    assert.deepEqual((await fs.readdir(restarted.outbox)).filter(name => name.endsWith('.json')), [], 'completed and definitively rejected writes do not stay in the retry scan');
    const stranger = new DeviceConnection({ ...options, directory: path.join(directory, 'other') });
    await stranger.connect({ v: 2, id: 'connect-2', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', password: 'test-only', clientId: 'device-2' } });
    await assert.rejects(stranger.send({ v: 2, id: 'read', type: 'object.read', session: bind.session, payload: { ref: 'plan', version: reply.version } }), { code: 'FORBIDDEN' });
  } finally { await cloud.close(); }
});

test('IF-023: binding tokens are translated and an uncertain request keeps its original wire payload', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-bind-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const seen = [];
  let lose = false;
  const options = { directory, origin: 'https://example.test', transport: async (_origin, _credential, message, settings) => {
    if (message.type === 'auth.open') { settings.receiveCredential('test-credential'); return {}; }
    seen.push(structuredClone(message));
    if (lose) { lose = false; throw new Error('reply lost'); }
    return { session: { id: 's', generation: 1 }, bindingVersion: 'cloud-version' };
  } };
  const device = new DeviceConnection(options);
  await device.connect({ v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', password: 'test-only', clientId: 'device' } });
  const message = { v: 2, id: 'bind-1', type: 'session.bind', payload: { sessionId: 's', agentId: 's', worktreeId: 'wt', expectedBindingVersion: '' } };
  const local = { session: { id: 's', generation: 1 }, bindingVersion: 'local-version' };
  assert.deepEqual(await device.bind(message, local), local);
  const next = { ...message, id: 'bind-2', payload: { ...message.payload, expectedBindingVersion: 'local-version' } };
  lose = true;
  await assert.rejects(device.bind(next, local));
  const restarted = new DeviceConnection(options);
  assert.deepEqual(await restarted.retryPending(), [{ id: 'bind-2', sent: true }]);
  assert.equal(seen[1].payload.expectedBindingVersion, 'cloud-version');
  assert.deepEqual(seen[1], seen[2]);
  assert.deepEqual(await restarted.bind(next, local), local);
  assert.equal(seen.length, 3);
});

test('an explicitly rejected Cloud credential marks the local backend disconnected', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-device-expired-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const device = new DeviceConnection({ directory, origin: 'https://example.test', transport: async (_origin, _credential, message, settings) => {
    if (message.type === 'auth.open') { settings.receiveCredential('test-credential'); return { expiresAt: new Date(Date.now() + 1000).toISOString() }; }
    throw Object.assign(new Error('expired'), { code: 'UNAUTHORIZED' });
  } });
  await device.connect({ v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', password: 'test-only', clientId: 'device' } });
  await assert.rejects(device.transmit({ v: 2, id: 'beat', type: 'sync.heartbeat', payload: { sessions: [] } }), { code: 'UNAUTHORIZED' });
  assert.equal(await device.connected(), false);
  const state = JSON.parse(await fs.readFile(device.file, 'utf8'));
  assert.deepEqual({ disconnected: state.disconnected, error: state.error, hasCredential: !!state.credential }, { disconnected: true, error: 'UNAUTHORIZED', hasCredential: false });
});

test('IF-025: outbox recovery preserves Session order and isolates a failed Session', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-outbox-order-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let offline = true;
  const seen = [];
  const options = { directory, origin: 'https://example.test', transport: async (_origin, _credential, message, settings) => {
    if (message.type === 'auth.open') { settings.receiveCredential('test-credential'); return {}; }
    if (offline || message.session.id === 'failed') throw Object.assign(new Error('offline'), { code: 'UNAVAILABLE' });
    seen.push(message.id); return { version: message.id };
  } };
  const device = new DeviceConnection(options);
  await device.connect({ v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', password: 'test-only', clientId: 'device' } });
  for (const [id, sessionId] of [['z-first', 'healthy'], ['a-second', 'healthy'], ['blocked-first', 'failed'], ['blocked-second', 'failed']]) {
    await assert.rejects(device.send({ v: 2, id, type: 'object.put', session: { id: sessionId, generation: 1 }, payload: { kind: 'plan', ref: id, baseVersion: '', content: {} } }));
  }
  offline = false;
  const restarted = new DeviceConnection(options);
  const results = await restarted.retryPending();
  assert.deepEqual(seen, ['z-first', 'a-second']);
  assert.equal(results.find(r => r.id === 'blocked-first').sent, false);
  assert.equal(results.some(r => r.id === 'blocked-second'), false);
});

test('Confirmed rejection resolves an uncertain write, preserves its receipt and releases the Session lane', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-outbox-rejection-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let reply = 'unknown'; const calls = [];
  const options = { directory, origin: 'https://example.test', transport: async (_origin, _credential, message, settings) => {
    if (message.type === 'auth.open') { settings.receiveCredential('test-only'); return {}; }
    calls.push(message.id);
    if (message.id === 'first') throw Object.assign(new Error(reply), {
      code: reply === 'unknown' ? 'UNAVAILABLE' : 'CONFLICT', confirmedRejection: reply === 'rejected',
    });
    return { version: message.id };
  } };
  const device = new DeviceConnection(options);
  await device.connect({ v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', password: 'test-only', clientId: 'device' } });
  const make = id => ({ v: 2, id, type: 'object.put', session: { id: 's', generation: 1 }, payload: { kind: 'plan', ref: id, baseVersion: '', content: {} } });
  await assert.rejects(device.send(make('first')), { code: 'UNAVAILABLE' });
  await assert.rejects(device.send(make('second')), { code: 'UNAVAILABLE' });
  reply = 'rejected';
  await assert.rejects(new DeviceConnection(options).send(make('first')), { code: 'CONFLICT' });
  const restarted = new DeviceConnection(options);
  await assert.rejects(restarted.send(make('first')), { code: 'CONFLICT' });
  assert.deepEqual(await restarted.send(make('second')), { version: 'second' });
  assert.deepEqual(calls, ['first', 'first', 'second'], 'old rejection replays without another server write');
});

test('IF-035: a fresh write cannot overtake a prior uncertain write in the same Session', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-outbox-fence-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let failing = true; const calls = [];
  const device = new DeviceConnection({ directory, origin: 'https://example.test', transport: async (_origin, _credential, message, settings) => {
    if (message.type === 'auth.open') { settings.receiveCredential('test-only-credential'); return {}; }
    calls.push(message.id);
    if (failing && message.id === 'first') throw Object.assign(new Error('lost'), { code: 'UNAVAILABLE' });
    return { version: message.id };
  } });
  await device.connect({ v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', clientId: 'ignored', password: 'test-only' } });
  const make = (id, session = 's') => ({ v: 2, id, type: 'object.put', session: { id: session, generation: 1 }, payload: { kind: 'plan', ref: id, baseVersion: '', content: { text: id } } });
  await assert.rejects(device.send(make('first')));
  await assert.rejects(device.send(make('second')), { code: 'UNAVAILABLE' });
  await device.send(make('other', 'other-session'));
  assert.deepEqual(calls, ['first', 'other']);
  failing = false;
  await device.retryPending();
  assert.deepEqual(calls, ['first', 'other', 'first', 'second']);
});
