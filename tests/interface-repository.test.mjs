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
import { sendMessage } from '../scripts/workbench/protocol-client.mjs';

test('host evidence transport keeps the original result body and requires both immutable authorization ACKs', async () => {
  const tuple = { taskId: 'task', planRef: 'plan', planVersion: 'pv', planSourceSha: 'a'.repeat(40),
    approvalReceiptId: 'approval', sourceSha: 'b'.repeat(40), ciTodoRef: 'todo', ciTodoVersion: 'tv' };
  const proof = [{ ref: 'ci:tester:host:observed', version: 'ev', contentHash: 'c'.repeat(64) }];
  const message = { v: 2, id: 'original-result', type: 'ci.result', session: { id: 'executor', generation: 1 }, payload: {
    taskId: tuple.taskId, sourceSha: tuple.sourceSha, verdict: 'passed', checks: [{ testId: 'test-1', todoId: 'CI-1', status: 'passed', evidenceRef: proof[0].ref }] } };
  const seen = [], data = { taskId: tuple.taskId, stage: 'awaiting-merge', ref: 'result', version: 'rv' };
  const call = evidenceAck => sendMessage('https://original.invalid', 'synthetic', message, {
    ciSessionId: 'tester', ciTaskExpectation: tuple, ciHostEvidence: structuredClone(proof), fetcher: async (_url, options) => {
      seen.push(options); return new Response(JSON.stringify({ id: message.id, ok: true, data }), { headers: {
        'content-type': 'application/json', 'X-Context-Guard-CI-Task-Authorized': hash(Buffer.from(options.headers['X-Context-Guard-CI-Task'], 'base64url')),
        ...(evidenceAck === null ? {} : { 'X-Context-Guard-CI-Evidence-Authorized': evidenceAck === 'correct'
          ? hash(Buffer.from(options.headers['X-Context-Guard-CI-Evidence'], 'base64url')) : evidenceAck }),
      } });
    },
  });
  for (const ack of [null, 'd'.repeat(64), 'd'.repeat(64) + ', ' + 'd'.repeat(64)]) {
    await assert.rejects(call(ack), error => error.code === 'UNAVAILABLE' && error.confirmedRejection !== true);
  }
  assert.deepEqual(await call('correct'), data);
  await assert.rejects(sendMessage('https://original.invalid', 'synthetic', message, {
    ciSessionId: 'tester', ciTaskExpectation: tuple, ciHostEvidence: proof, fetcher: async (_url, options) =>
      new Response(JSON.stringify({ id: message.id, ok: true, data }), { headers: { 'content-type': 'application/json',
        'X-Context-Guard-CI-Evidence-Authorized': hash(Buffer.from(options.headers['X-Context-Guard-CI-Evidence'], 'base64url')) } }),
  }), error => error.code === 'UNAVAILABLE' && error.confirmedRejection !== true, 'a proof ACK cannot substitute for the Task ACK');
  for (const options of seen) {
    assert.deepEqual(JSON.parse(options.body), message);
    assert.deepEqual(JSON.parse(Buffer.from(options.headers['X-Context-Guard-CI-Evidence'], 'base64url')), proof);
  }
  const mutable = structuredClone(proof);
  assert.deepEqual(await sendMessage('https://original.invalid', 'synthetic', message, {
    ciSessionId: 'tester', ciTaskExpectation: tuple, ciHostEvidence: mutable, fetcher: async (_url, options) => {
      const ack = hash(Buffer.from(options.headers['X-Context-Guard-CI-Evidence'], 'base64url'));
      mutable[0].contentHash = 'e'.repeat(64);
      return new Response(JSON.stringify({ id: message.id, ok: true, data }), { headers: { 'content-type': 'application/json',
        'X-Context-Guard-CI-Task-Authorized': hash(Buffer.from(options.headers['X-Context-Guard-CI-Task'], 'base64url')),
        'X-Context-Guard-CI-Evidence-Authorized': ack } });
    },
  }), data, 'a caller mutation cannot change the proof actually acknowledged');
});

test('host evidence transport rejects ambiguous coverage, reproduction and oversized headers before HTTP', async () => {
  const tuple = { taskId: 'task', planRef: 'plan', planVersion: 'pv', planSourceSha: 'a'.repeat(40),
    approvalReceiptId: 'approval', sourceSha: 'b'.repeat(40), ciTodoRef: 'todo', ciTodoVersion: 'tv' };
  const entry = { ref: 'ci:tester:host:observed', version: 'ev', contentHash: 'c'.repeat(64) };
  const message = { v: 2, id: 'result', type: 'ci.result', session: { id: 'executor', generation: 1 }, payload: {
    taskId: tuple.taskId, sourceSha: tuple.sourceSha, verdict: 'passed', checks: [{ testId: 'test', todoId: 'CI-1', status: 'passed', evidenceRef: entry.ref }] } };
  const options = { ciSessionId: 'tester', ciTaskExpectation: tuple,
    fetcher: () => assert.fail('invalid host expectations must not reach HTTP') };
  for (const proof of [[], [entry, entry], [{ ...entry, verified: true }], [{ ...entry, version: '' }],
    [{ ...entry, ref: 'ci:foreign:host:observed' }], [{ ...entry, version: 'v\n1' }], [{ ...entry, contentHash: 'short' }], [{ ...entry, contentHash: [entry.contentHash] }]]) {
    await assert.rejects(sendMessage('https://original.invalid', 'synthetic', message, { ...options, ciHostEvidence: proof }), { code: 'INVALID_ARGUMENT' });
  }
  await assert.rejects(sendMessage('https://original.invalid', 'synthetic', message, { ...options, ciTaskExpectation: undefined, ciHostEvidence: [entry] }), { code: 'INVALID_ARGUMENT' });
  const failed = { ...message, payload: { ...message.payload, verdict: 'failed', checks: [{ ...message.payload.checks[0], status: 'failed', reproductionRef: 'ci:tester:other' }] } };
  await assert.rejects(sendMessage('https://original.invalid', 'synthetic', failed, { ...options, ciHostEvidence: [entry] }), { code: 'INVALID_ARGUMENT' });
  const oversized = [{ ...entry, version: 'v'.repeat(4000) }, { ...entry, ref: 'ci:tester:host:second', version: 'v'.repeat(4000) }];
  const twoChecks = { ...message, payload: { ...message.payload, checks: [message.payload.checks[0], { ...message.payload.checks[0], testId: 'second', evidenceRef: oversized[1].ref }] } };
  await assert.rejects(sendMessage('https://original.invalid', 'synthetic', twoChecks, { ...options, ciHostEvidence: oversized }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(sendMessage('https://original.invalid', 'synthetic', message, { ...options,
    ciTaskExpectation: { ...tuple, planVersion: 'p'.repeat(3000), ciTodoVersion: 't'.repeat(2000) },
    ciHostEvidence: [{ ...entry, version: 'e'.repeat(4000) }],
  }), { code: 'INVALID_ARGUMENT' }, 'two individually bounded headers must also fit the shared encoded budget');
});

test('missing host evidence ACK preserves an unknown result and replays its original durable ID/body', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-ci-host-ack-'));
  const tuple = { taskId: 'task', planRef: 'plan', planVersion: 'pv', planSourceSha: 'a'.repeat(40),
    approvalReceiptId: 'approval', sourceSha: 'b'.repeat(40), ciTodoRef: 'todo', ciTodoVersion: 'tv' };
  const proof = [{ ref: 'ci:tester:host:observed', version: 'ev', contentHash: 'c'.repeat(64) }];
  const message = { v: 2, id: 'original-result', type: 'ci.result', session: { id: 'executor', generation: 1 }, payload: {
    taskId: tuple.taskId, sourceSha: tuple.sourceSha, verdict: 'passed', checks: [{ testId: 'test', todoId: 'CI-1', status: 'passed', evidenceRef: proof[0].ref }] } };
  let acknowledge = false; const seen = [];
  const device = new DeviceConnection({ directory, origin: 'https://original.invalid', revalidateOutcomes: true,
    transport: (origin, credential, wire, options) => sendMessage(origin, credential, wire, { ...options,
      ciSessionId: 'tester', ciTaskExpectation: tuple, ciHostEvidence: proof, fetcher: async (_url, input) => {
        seen.push({ body: input.body, proof: input.headers['X-Context-Guard-CI-Evidence'] });
        return new Response(JSON.stringify({ id: wire.id, ok: true, data: { taskId: 'task', stage: 'awaiting-merge', ref: 'result', version: 'rv' } }), {
          headers: { 'content-type': 'application/json', 'X-Context-Guard-CI-Task-Authorized': hash(Buffer.from(input.headers['X-Context-Guard-CI-Task'], 'base64url')),
            ...(acknowledge ? { 'X-Context-Guard-CI-Evidence-Authorized': hash(Buffer.from(input.headers['X-Context-Guard-CI-Evidence'], 'base64url')) } : {}) } });
      },
    }) });
  t.after(() => device.close());
  await atomicWrite(device.file, encode({ origin: device.origin, credential: 'synthetic-only' }));
  await assert.rejects(device.send(message), { code: 'UNAVAILABLE' });
  const pendingFile = path.join(device.outbox, hash(message.id) + '.json'), outcomeFile = path.join(directory, 'outcomes', hash(message.id) + '.json');
  const pending = await readJSON(pendingFile); assert.equal(pending.uncertain, true); assert.deepEqual(pending.wire, message);
  await assert.rejects(fs.stat(outcomeFile), { code: 'ENOENT' });
  acknowledge = true; const receipt = await device.send(message, () => assert.fail('original unknown wire must not be rebuilt'));
  assert.equal(receipt.stage, 'awaiting-merge'); assert.deepEqual(seen[0], seen[1]);
  const saved = await fs.readFile(outcomeFile, 'utf8'); acknowledge = false;
  await assert.rejects(device.send(message), { code: 'UNAVAILABLE' });
  assert.equal(await fs.readFile(outcomeFile, 'utf8'), saved, 'loss of proof ACK cannot replace the historical outcome');
});

test('host CI transport encodes a fixed task expectation without accepting model claims or expanding methods', async () => {
  const tuple = { taskId: 'original', planRef: 'plan', planVersion: 'pv', planSourceSha: 'a'.repeat(40),
    approvalReceiptId: 'approval', sourceSha: 'b'.repeat(40), ciTodoRef: 'checks', ciTodoVersion: 'tv' };
  const message = { v: 2, id: 'read', type: 'object.read', session: { id: 'executor', generation: 1 }, payload: { ref: 'checks', version: 'tv' } };
  const seen = [], fetcher = async (url, options) => {
    seen.push({ url: String(url), options });
    return new Response(JSON.stringify({ id: message.id, ok: true, data: { ref: 'checks', version: 'tv' } }), { headers: {
      'content-type': 'application/json', 'X-Context-Guard-CI-Task-Authorized': hash(Buffer.from(options.headers['X-Context-Guard-CI-Task'], 'base64url')) } });
  };
  await sendMessage('https://original.invalid', 'synthetic-host-credential', message, { fetcher, ciSessionId: 'tester', ciTaskExpectation: tuple });
  assert.equal(seen.length, 1); assert.equal(seen[0].url, 'https://original.invalid/api/v2/messages');
  assert.deepEqual(JSON.parse(seen[0].options.body), message);
  assert.deepEqual(JSON.parse(Buffer.from(seen[0].options.headers['X-Context-Guard-CI-Task'], 'base64url')), tuple);
  assert.equal(seen[0].options.headers['X-Context-Guard-CI-Session'], 'tester');
  for (const expectation of [{ ...tuple, verified: true }, { ...tuple, taskId: '' }, { ...tuple, sourceSha: 'main' }]) {
    await assert.rejects(sendMessage('https://original.invalid', 'synthetic', message, { fetcher, ciSessionId: 'tester', ciTaskExpectation: expectation }), { code: 'INVALID_ARGUMENT' });
  }
  await assert.rejects(sendMessage('https://original.invalid', 'synthetic', message, { fetcher, ciTaskExpectation: tuple }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(sendMessage('https://original.invalid', 'synthetic', { ...message, ciTaskExpectation: tuple }, { fetcher }), { code: 'INVALID_ARGUMENT' });
  assert.equal(seen.length, 1, 'all invalid host/model input is rejected before network access');
});

test('scoped host transport rejects legacy success or wrong task authorization ACK without changing ordinary CI receipts', async () => {
  const tuple = { taskId: 'original', planRef: 'plan', planVersion: 'pv', planSourceSha: 'a'.repeat(40),
    approvalReceiptId: 'approval', sourceSha: 'b'.repeat(40), ciTodoRef: 'checks', ciTodoVersion: 'tv' };
  const message = { v: 2, id: 'read', type: 'object.read', session: { id: 'executor', generation: 1 }, payload: { ref: 'checks', version: 'tv' } };
  const response = ack => new Response(JSON.stringify({ id: message.id, ok: true, data: { ref: 'checks', version: 'tv' } }),
    { headers: { 'content-type': 'application/json', ...(ack ? { 'X-Context-Guard-CI-Task-Authorized': ack } : {}) } });
  for (const ack of [null, 'c'.repeat(64), 'c'.repeat(64) + ', ' + 'c'.repeat(64)]) {
    await assert.rejects(sendMessage('https://original.invalid', 'synthetic', message, {
      ciSessionId: 'tester', ciTaskExpectation: tuple, fetcher: async () => response(ack) }), error => {
      assert.equal(error.code, 'UNAVAILABLE'); assert.notEqual(error.confirmedRejection, true); return true;
    });
  }
  assert.deepEqual(await sendMessage('https://original.invalid', 'synthetic', message, { ciSessionId: 'tester', fetcher: async () => response(null) }), { ref: 'checks', version: 'tv' });
  const fixed = { ...tuple };
  assert.deepEqual(await sendMessage('https://original.invalid', 'synthetic', message, { ciSessionId: 'tester', ciTaskExpectation: fixed,
    fetcher: async (_url, options) => {
      const ack = hash(Buffer.from(options.headers['X-Context-Guard-CI-Task'], 'base64url'));
      fixed.taskId = 'later-mutable-caller-input'; return response(ack);
    } }), { ref: 'checks', version: 'tv' }, 'ACK matches immutable transmitted scope, not a caller object mutated during await');
});

test('missing task ACK preserves an uncertain original write and same-ID recovery never rebuilds its durable wire', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-ci-missing-ack-'));
  const tuple = { taskId: 'original', planRef: 'plan', planVersion: 'pv', planSourceSha: 'a'.repeat(40),
    approvalReceiptId: 'approval', sourceSha: 'b'.repeat(40), ciTodoRef: 'checks', ciTodoVersion: 'tv' };
  let acknowledge = false;
  const seen = [], device = new DeviceConnection({ directory, origin: 'https://original.invalid', revalidateOutcomes: true,
    transport: (origin, credential, message, options) => sendMessage(origin, credential, message, { ...options,
      ciSessionId: 'tester', ciTaskExpectation: tuple, fetcher: async (_url, input) => {
        const wire = JSON.parse(input.body); seen.push(wire);
        return new Response(JSON.stringify({ id: wire.id, ok: true, data: { ref: wire.payload.ref, version: 'original-server-receipt' } }), {
          headers: { 'content-type': 'application/json', ...(acknowledge ? {
            'X-Context-Guard-CI-Task-Authorized': hash(Buffer.from(input.headers['X-Context-Guard-CI-Task'], 'base64url')) } : {}) } });
      } }) });
  t.after(() => device.close());
  await atomicWrite(device.file, encode({ origin: device.origin, credential: 'synthetic-only' }));
  const message = { v: 2, id: 'fixed-write', type: 'object.put', session: { id: 'executor', generation: 1 },
    payload: { ref: 'ci:tester:result', kind: 'evidence', baseVersion: '', content: { synthetic: true } } };
  await assert.rejects(device.send(message), { code: 'UNAVAILABLE' });
  const pendingFile = path.join(device.outbox, `${hash(message.id)}.json`), outcomeFile = path.join(directory, 'outcomes', `${hash(message.id)}.json`);
  const pending = await readJSON(pendingFile);
  assert.equal(pending.state, 'pending'); assert.equal(pending.uncertain, true); assert.deepEqual(pending.wire, message);
  await assert.rejects(fs.stat(outcomeFile), { code: 'ENOENT' });
  acknowledge = true;
  assert.deepEqual(await device.send(message, () => assert.fail('same-ID recovery keeps original wire')), { ref: message.payload.ref, version: 'original-server-receipt' });
  assert.equal(seen.length, 2); assert.deepEqual(seen[0], seen[1]);
  const accepted = await fs.readFile(outcomeFile, 'utf8');
  acknowledge = false;
  await assert.rejects(device.send(message), { code: 'UNAVAILABLE' });
  assert.equal(await fs.readFile(outcomeFile, 'utf8'), accepted, 'a cache replay missing ACK cannot overwrite the original historical receipt');
});

test('host-scoped DeviceConnection revalidates a cached success using its original durable wire before returning it', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-ci-cached-scope-'));
  const seen = [], message = { v: 2, id: 'original-write', type: 'object.put', session: { id: 'executor', generation: 1 },
    payload: { ref: 'ci:tester:observation', kind: 'evidence', baseVersion: '', content: { observation: 'original' } } };
  let denied = false, different = false;
  const device = new DeviceConnection({ directory, origin: 'https://original.invalid', revalidateOutcomes: true,
    transport: async (_origin, _credential, wire) => {
      seen.push(structuredClone(wire));
      if (denied) throw new ProtocolError('FORBIDDEN', 'Current task revoked');
      return { ref: wire.payload.ref, version: different ? 'different-receipt' : 'fixed-receipt' };
    } });
  t.after(() => device.close());
  await atomicWrite(device.file, encode({ origin: device.origin, credential: 'synthetic-only' }));
  const prepare = value => ({ ...value, payload: { ...value.payload, content: { observation: 'host-fixed-wire' } } });
  const result = await device.send(message, prepare);
  const receiptFile = path.join(directory, 'outcomes', `${hash(message.id)}.json`), receipt = await fs.readFile(receiptFile, 'utf8');
  assert.deepEqual(await device.send(message, () => assert.fail('cached wire must not be rebuilt')), result);
  assert.equal(seen.length, 2); assert.deepEqual(seen[0], seen[1]); assert.equal(seen[1].payload.content.observation, 'host-fixed-wire');
  denied = true; await assert.rejects(device.send(message), { code: 'FORBIDDEN' });
  assert.equal(seen.length, 3); assert.equal(await fs.readFile(receiptFile, 'utf8'), receipt);
  denied = false; different = true; await assert.rejects(device.send(message), { code: 'UNAVAILABLE' });
  assert.equal(await fs.readFile(receiptFile, 'utf8'), receipt, 'changed authority cannot overwrite historical success');
  await assert.rejects(device.send({ ...message, payload: { ...message.payload, content: { changed: true } } }), { code: 'ID_REUSED' });
  assert.equal(seen.length, 4);
});

test('host-scoped cache does not retransmit a definitive rejection or change ordinary device cache behavior', async t => {
  for (const revalidateOutcomes of [false, true]) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-ci-rejected-cache-'));
    let sends = 0, reject = true;
    const device = new DeviceConnection({ directory, origin: 'https://original.invalid', revalidateOutcomes,
      transport: async () => { sends++; if (reject) { const error = new ProtocolError('CONFLICT', 'Definitive rejection'); error.confirmedRejection = true; throw error; }
        return { ref: 'ci:tester:result', version: 'original' }; } });
    t.after(() => device.close());
    await atomicWrite(device.file, encode({ origin: device.origin, credential: 'synthetic-only' }));
    const message = { v: 2, id: 'rejected', type: 'object.put', session: { id: 'executor', generation: 1 },
      payload: { ref: 'ci:tester:result', kind: 'evidence', baseVersion: '', content: {} } };
    await assert.rejects(device.send(message), { code: 'CONFLICT' }); reject = false;
    await assert.rejects(device.send(message), { code: 'CONFLICT' }); assert.equal(sends, 1, 'a known rejection must never be upgraded by a fresh write');
    if (!revalidateOutcomes) {
      const accepted = { ...message, id: 'accepted' }; await device.send(accepted); await device.send(accepted);
      assert.equal(sends, 2, 'the existing ordinary device success cache is unchanged');
    }
  }
});

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
