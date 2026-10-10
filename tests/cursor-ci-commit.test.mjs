import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonical } from '../scripts/shared/protocol.mjs';
import { atomicWrite, encode, hash, readJSON } from '../scripts/shared/io.mjs';
import { DeviceConnection } from '../scripts/workbench/protocol-device.mjs';
import { sendMessage } from '../scripts/workbench/protocol-client.mjs';
import { createCursorCiHostCommit } from '../scripts/workbench/cursor-ci-commit.mjs';

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cg-ci-host-commit-')));
  const tuple = { taskId: 'task', planRef: 'plan', planVersion: 'pv', planSourceSha: 'a'.repeat(40),
    approvalReceiptId: 'approval', sourceSha: 'b'.repeat(40), ciTodoRef: 'todo', ciTodoVersion: 'tv' };
  const context = { mode: 'ci', session: { id: 'executor', generation: 1 }, taskId: tuple.taskId, sourceSha: tuple.sourceSha,
    ciTodoRef: tuple.ciTodoRef, references: { todo: tuple.ciTodoVersion }, commands: ['test'],
    tester: { sessionId: 'tester', nativeSessionId: 'native', deliveryId: 'delivery', workerPid: process.pid } };
  const state = { binding: { epoch: 'original', version: 'original' }, acknowledge: false, seen: [] };
  const transport = (origin, credential, wire, options) => sendMessage(origin, credential, wire, { ...options,
    ciSessionId: context.tester.sessionId, ciTaskExpectation: tuple, fetcher: async (_url, input) => {
      const proof = input.headers['X-Context-Guard-CI-Evidence'];
      state.seen.push({ body: input.body, proof });
      if (wire.type === 'ci.result') {
        const saved = await readJSON(path.join(directory, 'host-results', hash(wire.id) + '.json'));
        assert.equal(saved.messageHash, hash(canonical(wire)), 'proof intent must already be durable before HTTP');
        assert.equal(proof, Buffer.from(canonical(saved.expectedEvidence)).toString('base64url'));
      }
      return new Response(JSON.stringify({ id: wire.id, ok: true, data: wire.type === 'ci.result'
        ? { taskId: 'task', stage: 'awaiting-merge', ref: 'accepted-result', version: 'rv', verdict: 'passed' }
        : { ref: wire.payload.ref, version: 'ev' } }), { headers: { 'content-type': 'application/json',
        'X-Context-Guard-CI-Task-Authorized': hash(Buffer.from(input.headers['X-Context-Guard-CI-Task'], 'base64url')),
        ...(proof && state.acknowledge ? { 'X-Context-Guard-CI-Evidence-Authorized': hash(Buffer.from(proof, 'base64url')) } : {}),
      } });
    },
  });
  const connections = [];
  const open = async () => {
    const connection = new DeviceConnection({ directory, origin: 'https://original.invalid', revalidateOutcomes: true, transport });
    connections.push(connection);
    const commit = await createCursorCiHostCommit({ connection, context, taskExpectation: tuple,
      readBinding: async () => structuredClone(state.binding) });
    return { connection, commit };
  };
  t.after(async () => { for (const connection of connections) await connection.close(); });
  const initial = await open();
  await atomicWrite(initial.connection.file, encode({ origin: initial.connection.origin, credential: 'synthetic-device-only' }));
  const evidence = { v: 2, id: 'host-observation', type: 'object.put', session: context.session,
    payload: { ref: 'ci:tester:host:observation', baseVersion: '', kind: 'evidence', content: { taskId: 'task', sourceSha: tuple.sourceSha, observation: 'synthetic' } } };
  const proof = [{ ref: evidence.payload.ref, version: 'ev', contentHash: hash(canonical(evidence.payload.content)) }];
  const result = { v: 2, id: 'original-result', type: 'ci.result', session: context.session, payload: {
    taskId: 'task', sourceSha: tuple.sourceSha, verdict: 'passed', checks: [{ testId: 'test', todoId: 'CI-1', status: 'passed', evidenceRef: evidence.payload.ref }] } };
  return { ...initial, directory, tuple, context, state, evidence, proof, result, open,
    recordFile: path.join(directory, 'host-results', hash(result.id) + '.json') };
}

test('private host commit persists immutable proof and recovers unknown original wire across connection restart and cache replay', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.commit(f.evidence), { ref: f.evidence.payload.ref, version: 'ev' });
  await assert.rejects(f.commit(f.result, { expectedEvidence: f.proof }), { code: 'UNAVAILABLE' });
  const pending = await readJSON(path.join(f.connection.outbox, hash(f.result.id) + '.json'));
  assert.equal(pending.uncertain, true); assert.deepEqual(pending.wire, f.result);
  const originalProof = await fs.readFile(f.recordFile, 'utf8'); assert.equal(originalProof.includes('synthetic-device-only'), false);
  await f.connection.close(); const reopened = await f.open(); f.state.acknowledge = true;
  const receipt = await reopened.commit(f.result, { expectedEvidence: f.proof }); assert.equal(receipt.stage, 'awaiting-merge');
  assert.equal(await fs.readFile(f.recordFile, 'utf8'), originalProof);
  assert.deepEqual(f.state.seen[1], f.state.seen[2], 'unknown ACK recovers identical ID/body/proof, not a new result');
  const outcome = path.join(f.directory, 'outcomes', hash(f.result.id) + '.json'), saved = await fs.readFile(outcome, 'utf8');
  assert.deepEqual(await reopened.commit(f.result, { expectedEvidence: f.proof }), receipt);
  assert.deepEqual(f.state.seen[2], f.state.seen[3], 'cached success is revalidated with the original durable proof');
  f.state.acknowledge = false;
  await assert.rejects(reopened.commit(f.result, { expectedEvidence: f.proof }), { code: 'UNAVAILABLE' });
  assert.equal(await fs.readFile(outcome, 'utf8'), saved);
});

test('private host commit refuses missing proof, unrelated writes and same-ID proof replacement before HTTP', async t => {
  const f = await fixture(t);
  await assert.rejects(f.commit(f.result), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(f.commit(f.evidence, { expectedEvidence: f.proof }), { code: 'CI_MESSAGE_FORBIDDEN' });
  await assert.rejects(f.commit({ ...f.evidence, payload: { ...f.evidence.payload, ref: 'ci:tester:ordinary' } }), { code: 'CI_MESSAGE_FORBIDDEN' });
  await assert.rejects(f.commit({ ...f.evidence, payload: { ...f.evidence.payload, content: { ...f.evidence.payload.content, sourceSha: 'c'.repeat(40) } } }), { code: 'CI_MESSAGE_FORBIDDEN' });
  assert.equal(f.state.seen.length, 0);
  await assert.rejects(f.commit(f.result, { expectedEvidence: f.proof }), { code: 'UNAVAILABLE' });
  const saved = await fs.readFile(f.recordFile, 'utf8');
  const results = await Promise.allSettled([f.commit(f.result, { expectedEvidence: f.proof }),
    f.commit(f.result, { expectedEvidence: [{ ...f.proof[0], contentHash: 'd'.repeat(64) }] })]);
  assert.equal(results[1].reason.code, 'ID_REUSED'); assert.equal(results[0].reason.code, 'UNAVAILABLE');
  assert.equal(f.state.seen.length, 2, 'the changed proof cannot create a second HTTP proposal');
  assert.equal(await fs.readFile(f.recordFile, 'utf8'), saved);
});

test('private host commit cannot repair missing, corrupt or foreign-scope metadata from an old durable result', async t => {
  for (const fault of ['missing', 'corrupt', 'scope']) {
    const f = await fixture(t);
    await assert.rejects(f.commit(f.result, { expectedEvidence: f.proof }), { code: 'UNAVAILABLE' });
    if (fault === 'missing') await fs.rename(f.recordFile, f.recordFile + '.preserved');
    else if (fault === 'corrupt') await fs.writeFile(f.recordFile, '{', { mode: 0o600 });
    else {
      const record = await readJSON(f.recordFile); record.scopeHash = 'e'.repeat(64);
      const { digest, ...body } = record; record.digest = hash(canonical(body)); await atomicWrite(f.recordFile, encode(record));
    }
    await assert.rejects(f.commit(f.result, { expectedEvidence: f.proof }), { code: 'CI_HOST_COMMIT_RECORD_INVALID' });
    assert.equal(f.state.seen.length, 1, 'unrecoverable proof metadata cannot reach the transport');
  }
});

test('private host commit rejects changed owning binding and failed metadata persistence without transmitting a result', async t => {
  const revoked = await fixture(t); revoked.state.binding.epoch = 'replacement';
  await assert.rejects(revoked.commit(revoked.result, { expectedEvidence: revoked.proof }), { code: 'CI_TASK_CHANGED' });
  assert.equal(revoked.state.seen.length, 0);
  const blocked = await fixture(t);
  await fs.mkdir(path.join(blocked.directory, 'host-results'), { mode: 0o700 });
  await fs.mkdir(blocked.recordFile, { mode: 0o700 });
  await assert.rejects(blocked.commit(blocked.result, { expectedEvidence: blocked.proof }), { code: 'CI_HOST_COMMIT_RECORD_INVALID' });
  assert.equal(blocked.state.seen.length, 0);
});
