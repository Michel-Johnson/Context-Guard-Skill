import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { validateMessage, payloadRules, canonical, errorReply } from '../scripts/workbench/protocol.mjs';

const catalog = JSON.parse(await fs.readFile(new URL('../docs/interface-contract-v2.json', import.meta.url), 'utf8'));
const noSession = ['auth.open', 'auth.close', 'sync.heartbeat', 'session.bind'];
const message = item => ({ v: 2, id: 'request-1', type: item.type, ...(!noSession.includes(item.type) ? { session: { id: 'session-1', generation: 1 } } : {}), payload: structuredClone(item.payload) });
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
