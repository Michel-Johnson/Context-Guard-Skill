import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startCloudServer, createWorkbenchPasswordHash } from '../scripts/cloud/server.mjs';
import { DeviceConnection } from '../scripts/workbench/protocol-device.mjs';
import { sendMessage } from '../scripts/workbench/protocol-client.mjs';

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
