import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { validateMessage, payloadRules, canonical, errorReply } from '../scripts/shared/protocol.mjs';

const catalog = JSON.parse(await fs.readFile(new URL('../docs/interface-contract-v2.json', import.meta.url), 'utf8'));
const noSession = ['auth.open', 'auth.close', 'sync.heartbeat', 'session.bind'];
const message = item => ({ v: 2, id: 'request-1', type: item.type, ...(!noSession.includes(item.type) ? { session: { id: 'session-1', generation: 1 } } : {}), payload: structuredClone(item.payload) });
test('shared contracts have no dependency on either service and install excludes demos', async () => {
  for (const file of await fs.readdir(new URL('../scripts/shared/', import.meta.url))) {
    const source = await fs.readFile(new URL('../scripts/shared/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()['"][^'"]*(?:workbench|cloud|prototype)\//, file);
  }
  for (const file of ['server.mjs', 'memory.mjs', 'memory-read-view.mjs', 'protocol-auth.mjs', 'task-review.mjs']) {
    const source = await fs.readFile(new URL('../scripts/cloud/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s*['"]\.\.\/workbench\//, file);
  }
  const { installedFiles, packedFiles } = await import('../.github/scripts/package-contract.mjs');
  assert.equal(new Set(installedFiles).size, installedFiles.length);
  assert.equal(new Set(packedFiles).size, packedFiles.length);
  for (const file of packedFiles) assert.doesNotMatch(file, /fixtures|^site\/|^docs\/design\//);
  const legacy = await import('../scripts/sync/client.mjs');
  const implementation = await import('../scripts/legacy/map-sync.mjs');
  assert.equal(legacy.connectSync, implementation.connectSync, 'old entry must not duplicate implementation');
  const server = await fs.readFile(new URL('../scripts/workbench/server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /from\s*['"][^'"]*(?:legacy|sync\/client)/);
  const { runtimeIdentity, compatibleRuntime, upgradeableRuntime } = await import('../scripts/workbench/runtime.mjs');
  const current = runtimeIdentity();
  const previous = { ...current, buildId: 'project-workbench-v17', capabilities: current.capabilities.filter(c => c !== 'production-data-isolation') };
  assert.equal(compatibleRuntime(previous), false, 'old asset router must restart before adopting the new install');
  assert.equal(upgradeableRuntime(previous), true);
});
test('IF-001: all 25 documented messages have executable validators', () => {
  assert.deepEqual(Object.keys(payloadRules).sort(), catalog.interfaces.map(i => i.type).sort());
  for (const item of catalog.interfaces) assert.equal(validateMessage(message(item)).type, item.type);
});
test('IF-002: reject missing required fields and caller role claims', () => {
  for (const item of catalog.interfaces) {
    const input = message(item);
    assert.throws(() => validateMessage({ ...input, role: 'human' }), { code: 'INVALID_ARGUMENT' });
    assert.throws(() => validateMessage({ ...input, payload: { ...input.payload, unexpected: true } }), { code: 'INVALID_ARGUMENT' });
    for (const field of ['v', 'id', 'type', 'payload']) {
      const broken = structuredClone(input); delete broken[field];
      assert.throws(() => validateMessage(broken), { code: 'INVALID_ARGUMENT' });
    }
  }
});
test('IF-003: distinguish Session and generations, reject invalid queue cursors', () => {
  const read = message(catalog.interfaces.find(i => i.type === 'sync.read'));
  for (const generation of [0, -1, 1.2, '1', null]) assert.throws(() => validateMessage({ ...read, session: { id: 's', generation } }));
  for (const afterSeq of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '0', null]) assert.throws(() => validateMessage({ ...read, payload: { afterSeq, limit: 50 } }));
  assert.throws(() => validateMessage({ ...read, session: undefined }));
  const assign = message(catalog.interfaces.find(i => i.type === 'task.assign'));
  assign.payload.sessionId = 'another-session'; assert.throws(() => validateMessage(assign));
});
test('IF-056: heartbeat accepts bounded Session display metadata for Cloud presence', () => {
  const heartbeat = message(catalog.interfaces.find(i => i.type === 'sync.heartbeat'));
  heartbeat.payload.sessions[0] = { ...heartbeat.payload.sessions[0], name: 'online', platform: 'codex' };
  assert.equal(validateMessage(heartbeat).payload.sessions[0].name, 'online');
  heartbeat.payload.sessions[0].name = 'x'.repeat(241);
  assert.throws(() => validateMessage(heartbeat), { code: 'INVALID_ARGUMENT' });
  for (const status of ['interrupted', 'failed']) {
    const messageValue = message(catalog.interfaces.find(i => i.type === 'sync.heartbeat'));
    messageValue.payload.sessions[0].execution = { status, at: '2026-09-09T14:58:34.370Z' };
    assert.equal(validateMessage(messageValue).payload.sessions[0].execution.status, status);
  }
});
test('IF-004: bounded requests, failed test evidence, atomic change shapes', () => {
  const input = message(catalog.interfaces.find(i => i.type === 'object.put'));
  input.payload.content = { text: 'x'.repeat(256 * 1024) };
  assert.throws(() => validateMessage(input), { code: 'TOO_LARGE' });
  const ci = message(catalog.interfaces.find(i => i.type === 'ci.result'));
  delete ci.payload.checks[0].reproductionRef; assert.throws(() => validateMessage(ci));
  const patch = message(catalog.interfaces.find(i => i.type === 'workbench.patch'));
  patch.payload.changes[0].fields.role = 'human'; assert.throws(() => validateMessage(patch));
  patch.payload.changes = [{ op: 'create', kind: 'node', id: 'n', fields: { title: 'Missing kind/state' } }];
  assert.throws(() => validateMessage(patch));
});
test('IF-005: canonical hashing ignores key order; unknown exceptions never expose secrets', () => {
  assert.equal(canonical({ b: 1, a: { c: 2, d: 3 } }), canonical({ a: { d: 3, c: 2 }, b: 1 }));
  assert.equal(errorReply('r', new Error('private diagnostic')).error.message, 'Operation temporarily unavailable');
});
