import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startCloudServer } from '../../scripts/cloud/server.mjs';
import { createLearningMapTools } from './map-tools.mjs';
import { Experiment } from './engine.mjs';
import { codexMap } from './map.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const directory = () => path.join(here, 'test-data', 'map-' + randomUUID());
const answer = { stop: 'end_turn', content: [{ type: 'text', text: 'done' }] };

test('Map tools use persistent project commits, versions, idempotence and native navigation receipts', async () => {
  const dataDir = directory(), token = randomUUID();
  const server = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir, adminToken: token, privateAccess: true });
  try {
    const request = async (route, input) => {
      const response = await fetch(server.url + route, { method: input === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error?.message), { code: result.error?.code });
      return result;
    };
    await request('/api/projects', { id: 'codex-learning', name: 'test' });
    await request('/api/projects/codex-learning/snapshot', { baseVersion: null, operationId: 'seed', document: codexMap('a'.repeat(40)) });
    const tools = createLearningMapTools((route, input) => request('/api/projects/codex-learning' + route, input), { directory: path.join(dataDir, 'map-operations') });
    const first = await tools.call('read_map', { nodeId: 'policy' }, 'read');
    assert.equal(first.node.title, '配置与权限');
    assert.equal((await tools.call('open_node', { nodeId: 'policy' }, 'open')).kind, 'node-navigation');
    const tour = await tools.call('tour_nodes', { nodeIds: ['config', 'sandbox'] }, 'tour');
    assert.deepEqual(tour.nodes.map(n => n.id), ['config', 'sandbox']);
    await assert.rejects(tools.call('open_node', { nodeId: 'missing' }, 'bad'), { code: 'NOT_FOUND' });
    const edit = { mainVersion: first.version, actions: [{ op: 'update', id: 'policy', title: '配置与权限测试' }] };
    const receipt = await tools.call('edit_map', edit, 'edit');
    assert.equal(receipt.kind, 'map-action');
    assert.equal((await tools.call('read_map', { nodeId: 'policy' }, 'read2')).node.title, '配置与权限测试');
    assert.deepEqual(await tools.call('edit_map', edit, 'edit'), receipt);
    await assert.rejects(tools.call('edit_map', edit, 'stale'), { code: 'VERSION_CONFLICT' });
    await assert.rejects(tools.call('edit_map', { mainVersion: receipt.version, actions: [{ op: 'update', id: 'policy', secret: 'no' }] }, 'invalid'), { code: 'FORBIDDEN' });
  } finally { await server.close(); }
});

test('Capability upgrade preserves old trials and records UI actions before final response', async () => {
  const source = { commit: 'a'.repeat(40), map: codexMap('a'.repeat(40)), call: async () => ({}) };
  const options = { directory: directory(), source, provider: { model: 'test' }, phase: 'calibration', modelFactory: () => ({ next: async () => answer }) };
  const before = await new Experiment(options).init();
  await before.newTrial('t'); before.trial('t').arm = 'direct';
  await before.submit('t', { requestId: 'old', text: 'old' }); await before.drain();
  const oldFingerprint = before.db.fingerprint; await before.close();
  const mapTools = createLearningMapTools(async () => ({ version: 'v1', document: source.map }));
  let calls = 0;
  const e = await new Experiment({ ...options, mapTools, modelFactory: () => ({ next: async ({ tools }) => {
    assert.ok(tools.some(t => t.name === 'open_node'));
    return calls++ === 0 ? { stop: 'tool_use', content: [{ type: 'tool_use', id: 'navigate', name: 'open_node', input: { nodeId: 'policy' } }] } : answer;
  } }) }).init();
  try {
    assert.equal(e.trial('t').requests[0].fingerprint, oldFingerprint);
    assert.match(e.db.revisions.at(-1).reason, /not blinded/);
    await e.submit('t', { requestId: 'new', text: '打开配置与权限' }); await e.drain();
    assert.equal(e.state('t').actions[0].node.id, 'policy');
    assert.equal(e.state('t').fork.enabled, false);
    e.trial('t').arm = 'adaptive';
    e.trial('t').children.push({ status: 'running' }, { status: 'queued' });
    assert.deepEqual(e.state('t').fork, { assigned: true, enabled: true, running: 1, queued: 1, completed: 0, failed: 0 });
  } finally { await e.close(); }
});
