import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProtocolMap, nodeProjection, relationProjection, translateChanges, operationGrants } from '../scripts/workbench/protocol-map.mjs';
import { MapStore } from '../scripts/workbench/store.mjs';
import { applyOperations, filterNodeAccess } from '../prototype/map-model.mjs';
import { documentOperations } from '../scripts/workbench/sync-coordinator.mjs';

test('IF-036: v2 Map mutations keep legacy records, atomic receipts and stable record targets', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-map-adapter-'));
  const file = path.join(root, '.codex/context/map.json'); await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ v: 1, project: 'test', root: { id: 'R', title: 'root', memories: [{ text: 'first', custom: 'keep' }, { text: 'second' }], children: [] } }));
  const store = await new MapStore(root, { project: async () => true }).init();
  t.after(async () => { await store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const adapter = new ProtocolMap(path.join(root, 'intents')), principal = { repositoryId: 'r', agentId: 's' };
  const options = { store, actor: { kind: 'agent', sessionId: 's' }, grants: () => ['R'], authorize: async () => {}, prepare: async input => ({ input, actor: { kind: 'agent', sessionId: 's' } }) };
  const originalVersion = store.version;
  const records = nodeProjection(store.doc.root, store.version).memories;
  const make = (id, changes) => ({ v: 2, id, type: 'workbench.patch', session: { id: 's', generation: 1 }, payload: { baseVersion: originalVersion, changes } });
  const invalid = make('bad', [{ op: 'delete', kind: 'memory', id: records[0].id }, { op: 'update', kind: 'memory', id: records[0].id, fields: { text: 'must not target second' } }]);
  await assert.rejects(adapter.patch(principal, invalid, options), { code: 'NOT_FOUND' });
  assert.equal(store.version, originalVersion);
  const good = make('good', [{ op: 'update', kind: 'memory', id: records[0].id, fields: { text: 'updated' } }]);
  const saved = await adapter.patch(principal, good, options);
  assert.equal(store.doc.root.memories[0].custom, 'keep'); assert.equal(store.doc.root.memories[0].id, records[0].id);
  assert.equal(store.doc.root.memories[1].text, 'second');
  assert.deepEqual(await new ProtocolMap(path.join(root, 'intents')).patch(principal, good, options), saved);
  await assert.rejects(adapter.patch(principal, good, { ...options, grants: () => [] }), { code: 'FORBIDDEN' });
  await assert.rejects(adapter.patch(principal, { ...good, payload: invalid.payload }, options), { code: 'ID_REUSED' });
});

test('IF-038: positional node edits remain ordered through the existing synchronization adapter', () => {
  const before = { v: 1, project: 'test', root: { id: 'R', title: 'root', children: ['A', 'B', 'C'].map(id => ({ id, title: id, children: [] })) } };
  const after = structuredClone(before);
  after.root.children = [{ id: 'N', title: 'new', children: [] }, after.root.children[2], after.root.children[0], after.root.children[1]];
  const operations = documentOperations(before, after);
  const result = applyOperations(before, operations, { kind: 'human', sessionId: 'sync' }).doc;
  assert.deepEqual(result.root.children.map(node => node.id), ['N', 'C', 'A', 'B']);
  assert.deepEqual(documentOperations(after, after), []);
});

test('IF-047: relation receipts retain old and new endpoint grants after deletion or retargeting', () => {
  const doc = { flows: [{ id: 'relation', from: 'A', to: 'B' }] };
  assert.deepEqual(operationGrants(doc, [
    { type: 'relation', action: 'update', id: 'relation', fields: { to: 'C' } },
    { type: 'relation', action: 'delete', id: 'relation' },
  ], ['A', 'B', 'C']).sort(), ['A', 'B', 'C']);
  assert.deepEqual(operationGrants(doc, [{ type: 'relation', action: 'delete', id: 'relation' }], ['A', 'B']), ['A', 'B']);
});

test('IF-048: legacy relations acquire stable IDs only when edited, retaining custom fields', () => {
  const doc = { v: 1, project: 'test', root: { id: 'A', title: 'A', children: [{ id: 'B', title: 'B' }] }, flows: [{ from: 'A', to: 'B', label: 'old', custom: true }] };
  const id = relationProjection(doc.flows, 'v1')[0].id, actor = { kind: 'agent', sessionId: 's' };
  const operations = translateChanges(doc, [{ op: 'update', kind: 'relation', id, fields: { label: 'new' } }], actor, ['A', 'B'], 'v1');
  const saved = applyOperations(doc, operations, actor, ['A', 'B']).doc;
  assert.deepEqual(saved.flows[0], { from: 'A', to: 'B', label: 'new', custom: true, id });
  assert.equal(relationProjection(saved.flows, 'v2')[0].id, id);
  assert.throws(() => applyOperations(doc, operations, actor, ['A']), { code: 'FORBIDDEN' });
  const two = { ...doc, flows: [...doc.flows, { from: 'B', to: 'A', label: 'second' }] };
  const ids = relationProjection(two.flows, 'v1').map(flow => flow.id);
  const edits = translateChanges(two, [{ op: 'delete', kind: 'relation', id: ids[0] }, { op: 'update', kind: 'relation', id: ids[1], fields: { label: 'remaining' } }], actor, ['A', 'B'], 'v1');
  assert.equal(applyOperations(two, edits, actor, ['A', 'B']).doc.flows[0].id, ids[1]);
  assert.throws(() => translateChanges(two, [{ op: 'delete', kind: 'relation', id: ids[0] }, { op: 'delete', kind: 'relation', id: ids[0] }], actor, ['A', 'B'], 'v1'), { code: 'VERSION_CONFLICT' });
});

test('IF-041: messages, relations and human-only access round trip through the shared Map model', () => {
  const doc = { v: 1, project: 'test', root: { id: 'R', title: 'root', children: [{ id: 'A', title: 'a' }] } };
  const human = { kind: 'human', sessionId: 's' }, agent = { kind: 'agent', sessionId: 's' };
  assert.throws(() => translateChanges(doc, [{ op: 'delete', kind: 'node', id: 'R' }], human, ['R', 'A'], 'v1'), { code: 'CONFLICT' });
  const changes = [
    { op: 'create', kind: 'message', id: 'm', fields: { text: 'question' } },
    { op: 'create', kind: 'relation', id: 'r', fields: { from: 'R', to: 'A', label: 'depends' } },
    { op: 'create', kind: 'access', id: 'a', fields: { nodeId: 'A', agentId: 's', allow: 'read' } },
  ];
  const operations = translateChanges(doc, changes, human, ['R', 'A'], 'v1');
  const saved = applyOperations(doc, operations, human).doc;
  assert.equal(saved.root.messages[0].text, 'question');
  assert.deepEqual(saved.flows, [{ from: 'R', to: 'A', label: 'depends', id: 'r' }]);
  assert.deepEqual(filterNodeAccess(saved, ['R', 'A'], 's'), ['R']);
  assert.deepEqual(filterNodeAccess(saved, ['R', 'A'], 's', 'read'), ['R', 'A']);
  assert.deepEqual(applyOperations(doc, documentOperations(doc, saved), human).doc, saved);
  assert.throws(() => translateChanges(saved, [{ op: 'update', kind: 'access', id: 'a', fields: { allow: 'write' } }], agent, ['R'], 'v2'), { code: 'FORBIDDEN' });
  assert.throws(() => translateChanges(saved, [{ op: 'update', kind: 'relation', id: 'r', fields: { label: 'not allowed' } }], agent, ['R'], 'v2'), { code: 'FORBIDDEN' });
  const revoked = applyOperations(saved, translateChanges(saved, [{ op: 'update', kind: 'access', id: 'a', fields: { allow: 'none' } }], human, ['R', 'A'], 'v2'), human).doc;
  assert.deepEqual(filterNodeAccess(revoked, ['R', 'A'], 's', 'read'), ['R']);
});
