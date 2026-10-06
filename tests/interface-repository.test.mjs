import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lookupRepository } from '../scripts/workbench/protocol-repository.mjs';
import { DeviceConnection } from '../scripts/workbench/protocol-device.mjs';
import { atomicWrite, encode, hash, readJSON } from '../scripts/shared/io.mjs';
import { ProtocolError } from '../scripts/shared/protocol.mjs';

test('IF-039: GitHub supplies repository identity, follows only GitHub redirects and rejects mismatched Cloud identity', async t => {
  const requests = [];
  const actual = await lookupRepository('example/old', { token: '', tokenProvider: async () => '', fetcher: async url => {
    requests.push(String(url));
    return requests.length === 1 ? new Response('', { status: 301, headers: { location: 'https://api.github.com/repositories/123' } })
      : new Response(JSON.stringify({ id: 123, full_name: 'example/renamed' }));
  } });
  assert.deepEqual(actual, { repositoryId: '123', slug: 'example/renamed' });
  await assert.rejects(lookupRepository('example/repo', { token: '', tokenProvider: async () => '', fetcher: async () => new Response('', { status: 302, headers: { location: 'https://untrusted.example/steal' } }) }), { code: 'FORBIDDEN' });
  await assert.rejects(lookupRepository('example/repo', { token: '', tokenProvider: async () => '', fetcher: async () => new Response('{}') }), { code: 'UNAVAILABLE' });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-repository-id-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const device = new DeviceConnection({ directory, origin: 'https://cloud.example', transport: async (_origin, _credential, message, options) => {
    calls.push(message.type);
    if (message.type === 'auth.open') { options.receiveCredential('synthetic-credential'); return { repositoryId: '456' }; }
    return {};
  } });
  await assert.rejects(device.connect({ v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', clientId: 'ignored', password: 'test-only' } }, actual), { code: 'FORBIDDEN' });
  assert.equal(await device.connected(), false); assert.deepEqual(calls, ['auth.open', 'auth.close']);
});

test('IF-039: private GitHub repository identity uses the authenticated gh keychain before its first request', async () => {
  const authorizations = []; let tokenRequests = 0;
  const actual = await lookupRepository('example/private', {
    token: '',
    tokenProvider: async () => { tokenRequests += 1; return 'keychain-token'; },
    fetcher: async (_url, options) => {
      authorizations.push(options.headers.Authorization || '');
      return new Response(JSON.stringify({ id: 789, full_name: 'example/private' }));
    },
  });
  assert.deepEqual(actual, { repositoryId: '789', slug: 'example/private' });
  assert.deepEqual(authorizations, ['Bearer keychain-token']);
  assert.equal(tokenRequests, 1);
});

test('GitHub lookup retries transient reads with one identity and a bounded shared budget', async () => {
  let now = 0, calls = 0;
  const sleeps = [], authorizations = [];
  const result = await lookupRepository('example/repo', { token: 'fixture-token', tokenProvider: () => assert.fail('explicit token takes priority'),
    clock: () => now, sleep: async ms => { sleeps.push(ms); now += ms; }, fetcher: async (_url, options) => {
      authorizations.push(options.headers.Authorization);
      if (++calls === 1) throw new Error('synthetic temporary connection failure');
      if (calls === 2) return new Response('', { status: 503 });
      return new Response(JSON.stringify({ id: 123, full_name: 'example/repo' }));
    } });
  assert.deepEqual(result, { repositoryId: '123', slug: 'example/repo' });
  assert.deepEqual(sleeps, [250, 500]);
  assert.deepEqual(authorizations, Array(3).fill('Bearer fixture-token'));
  calls = 0;
  await assert.rejects(lookupRepository('example/repo', { token: '', tokenProvider: async () => { now += 39000; return ''; },
    clock: () => now, sleep: async ms => { now += ms; }, fetcher: async () => { calls++; now += 1000; throw new Error('synthetic outage'); },
  }), { code: 'UNAVAILABLE' });
  assert.equal(calls, 1, 'token lookup time consumes the same forty-second budget');
});

test('GitHub lookup stops after three transient attempts and never retries identity or authorization failures', async () => {
  for (const response of [null, 502, 401, 403, 404, 'invalid']) {
    let calls = 0, now = 0;
    await assert.rejects(lookupRepository('example/repo', { token: '', tokenProvider: async () => '', clock: () => now,
      sleep: async ms => { now += ms; }, fetcher: async () => {
        calls++;
        if (response === null) throw new Error('synthetic network outage');
        if (response === 'invalid') return new Response(JSON.stringify({ id: 0, full_name: 'example/repo' }));
        return new Response('', { status: response });
      } }));
    assert.equal(calls, response === null || response === 502 ? 3 : 1);
  }
});

for (const legacy of [false, true]) test(`confirmed Session binding rejection survives restart without retrying or borrowing a new Session${legacy ? ' (legacy)' : ''}`, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-binding-rejected-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const binding = { sessionId: 'old-host-session', worktreeId: 'worktree', agentId: 'old-host-session', generation: 1, version: 'local-v1' };
  const reason = legacy ? 'binding-conflict' : 'session-bound-elsewhere';
  let sends = 0;
  const transport = async (_origin, _credential, message) => {
    sends++;
    if (message.payload.sessionId === binding.sessionId) {
      const error = new ProtocolError('CONFLICT', legacy ? 'Migration requires the owning device and current binding version' : 'Owned by another device',
        legacy ? { currentVersion: 'private-binding-version' } : { reason: 'session-bound-elsewhere' });
      error.confirmedRejection = true; throw error;
    }
    return { session: { id: message.payload.sessionId, generation: 1 }, bindingVersion: 'remote-new-v1' };
  };
  const device = new DeviceConnection({ directory, origin: 'https://cloud.example.invalid', transport });
  await atomicWrite(device.file, encode({ origin: device.origin, credential: 'fixture-only' }));
  // An existing unconfirmed task is not consumed by binding conflict recovery.
  const taskFile = path.join(device.outbox, `${hash('old-task-request')}.json`);
  const oldTask = { message: { v: 2, id: 'old-task-request', type: 'task.report', session: { id: binding.sessionId, generation: 1 }, payload: { taskId: 'task', stage: 'progress', data: { seq: 1, summary: 'preserved' } } }, state: 'pending', sequence: 100 };
  await atomicWrite(taskFile, encode(oldTask));
  const requestId = legacy ? `bind:${hash(binding.version)}` : 'first-host-registration';
  if (legacy) await assert.rejects(device.ensureBinding(binding), { code: 'CONFLICT' });
  else await assert.rejects(device.bind({ v: 2, id: requestId, type: 'session.bind', payload: { sessionId: binding.sessionId,
    worktreeId: binding.worktreeId, agentId: binding.agentId, expectedBindingVersion: '' } },
    { session: { id: binding.sessionId, generation: 1 }, bindingVersion: binding.version }), { code: 'CONFLICT' });
  const outcomeFile = path.join(directory, 'outcomes', `${hash(requestId)}.json`);
  const receipt = await fs.readFile(outcomeFile, 'utf8');
  const restarted = new DeviceConnection({ directory, origin: device.origin, transport });
  assert.deepEqual(await restarted.bindingStatus(binding), { status: 'conflict', code: 'CONFLICT', reason });
  for (let round = 0; round < 3; round++) {
    assert.equal(await restarted.bindingReady(binding), false);
    await assert.rejects(restarted.ensureBinding(binding), { code: 'CONFLICT', details: { reason } });
  }
  assert.equal(sends, 1);
  assert.equal(restarted.enrolling, undefined);
  assert.equal(await fs.readFile(outcomeFile, 'utf8'), receipt);
  assert.deepEqual(await readJSON(taskFile), oldTask);
  const newBinding = { ...binding, sessionId: 'new-host-session', agentId: 'new-host-session', version: 'new-local-v1' };
  await restarted.ensureBinding(newBinding);
  assert.deepEqual(await restarted.bindingStatus(newBinding), { status: 'ready' });
  assert.equal(sends, 2);
  assert.deepEqual(await readJSON(taskFile), oldTask, 'new real host scope does not inherit an old task');
  assert.equal(await fs.readFile(outcomeFile, 'utf8'), receipt);
});

test('generic business conflict and uncertain binding outcomes cannot become an old-device classification', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-binding-classifier-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const device = new DeviceConnection({ directory, origin: 'https://cloud.example.invalid' });
  const binding = { sessionId: 'host-session', version: 'local-v1' };
  const message = { v: 2, id: `bind:${hash(binding.version)}`, type: 'session.bind', payload: { sessionId: binding.sessionId } };
  const file = path.join(directory, 'outcomes', `${hash(message.id)}.json`);
  for (const record of [
    { state: 'pending', message, error: { code: 'CONFLICT', details: { reason: 'session-bound-elsewhere' } } },
    { state: 'rejected', message: { ...message, type: 'workbench.patch' }, error: { code: 'CONFLICT', details: { reason: 'session-bound-elsewhere' } } },
    { state: 'rejected', message, error: { code: 'CONFLICT', message: 'A concurrent edit happened', details: { currentVersion: 'private-version' } } },
  ]) {
    await atomicWrite(file, encode(record));
    assert.deepEqual(await device.bindingStatus(binding), { status: 'pending' });
  }
});
