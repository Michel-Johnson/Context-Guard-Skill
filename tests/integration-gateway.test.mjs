import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startIntegrationGateway, validateIntegrationConfig, classifyIntegrationMessage } from '../scripts/cloud/integration-gateway.mjs';
import { IntegrationAttachmentStore } from '../scripts/cloud/integration-attachments.mjs';
import { CoordinatorManualBriefs, filterManualTools, coordinatorRolePrompt } from '../scripts/cloud/coordinator-manual.mjs';
import { coordinatorTools } from '../scripts/cloud/coordinator-tools.mjs';
import { applyOperations, MapError } from '../scripts/shared/map-model.mjs';
import { hash, readJSON } from '../scripts/shared/io.mjs';
import { Gateway } from '../plugins/slack/src/gateway.mjs';
import { Store, threadKey } from '../plugins/slack/src/store.mjs';
import { SlackPlugin } from '../plugins/slack/src/plugin.mjs';
import { CoordinatorService } from '../scripts/cloud/coordinator-service.mjs';

const teamId = 'TTESTWORKSPACE', userId = 'UTESTUSER', projectId = 'fixture-project';
const token = 'integration-test-credential-not-an-admin-token';
const config = { host: '127.0.0.1', port: 0, token, teamId, projectIds: [projectId] };
const actor = { kind: 'human', sessionId: `slack:${teamId}:${userId}`, integration: 'slack', teamId, userId };

test('Committed Coordinator progress wakes only its scoped event subscription without waiting for fallback polling', async t => {
  const directory = await temporary(t), notifications = [];
  let gateway, otherReads = 0;
  const service = new CoordinatorService({ directory: path.join(directory, 'chat'), system: 'Coordinator', tools: [], execute: async () => {},
    onStateChange: () => { notifications.push(true); gateway.notify({ projectId, conversationId: 'chat-live' }); },
    model: { next: async ({ onText }) => {
      await onText('这是第一段真实内容。');
      return { stop: 'end_turn', content: [{ type: 'text', text: '这是完整答复。' }] };
    } } });
  gateway = await startIntegrationGateway({ config, stateDir: directory, pollIntervalMs: 60000,
    command: async () => ({}), state: async scope => scope.conversationId === 'chat-live'
      ? { ...(await service.state()), conversationId: scope.conversationId }
      : { conversationId: scope.conversationId, marker: 'unrelated', reads: ++otherReads } });
  t.after(async () => { await gateway.close(); await service.close({ stop: true }); });
  const client = new Gateway({ url: gateway.url, token, teamId });
  const abort = new AbortController(); t.after(() => abort.abort());
  const states = client.events({ userId, projectId, conversationId: 'chat-live', signal: abort.signal });
  assert.equal((await states.next()).value.status, 'idle');
  const other = client.events({ userId, projectId, conversationId: 'chat-other', signal: abort.signal });
  assert.equal((await other.next()).value.marker, 'unrelated');
  assert.equal(gateway.subscriberCount(), 2);
  await service.submit({ id: 'first-turn', text: '请回答' });
  await service.close();
  let timer;
  try {
    const final = await Promise.race([(async () => {
      for await (const state of states) if (state.status === 'waiting-for-user') return state;
      throw new Error('Subscription ended before final response');
    })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Waiting for the 60-second fallback is not an immediate notification')), 1500); })]);
    assert.equal(final.messages.at(-1).text, '这是完整答复。');
    assert.ok(notifications.length > 0);
    assert.equal(otherReads, 1, 'Unrelated conversation is not awakened');
  } finally { clearTimeout(timer); abort.abort(); }
});

test('Coordinator state observers cannot hold or fail the model run and observe only persisted state', async t => {
  const directory = await temporary(t), observed = [];
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: [], execute: async () => {},
    onStateChange: () => {
      observed.push(fs.readFile(path.join(directory, 'conversation.json'), 'utf8').then(JSON.parse));
      return observed.length % 2 ? Promise.reject(new Error('Disconnected optional observer')) : new Promise(() => {});
    }, model: { next: async ({ onText }) => { await onText('正文'); return { stop: 'end_turn', content: [{ type: 'text', text: '完成' }] }; } } });
  await service.submit({ id: 'observer-turn', text: '请回答' }); await service.close();
  const states = await Promise.all(observed);
  assert.ok(states.length > 0);
  assert.equal((await service.state()).status, 'waiting-for-user');
  assert.equal((await service.state()).messages.at(-1).text, '完成');
  assert.ok(states.every(state => state.requests['observer-turn']), 'No event can precede the durable accepted request');
});

test('Event notifications during an initial snapshot or in-flight read are not lost and never create concurrent reads', async t => {
  const directory = await temporary(t);
  let release, reading, captured, reads = 0, concurrent = 0, maximum = 0, version = 0;
  const gate = () => { reading = new Promise(resolve => { captured = resolve; }); return new Promise(resolve => { release = resolve; }); };
  let barrier = gate();
  const gateway = await startIntegrationGateway({ config, stateDir: directory, pollIntervalMs: 60000, command: async () => ({}),
    state: async scope => {
      ++reads; maximum = Math.max(maximum, ++concurrent);
      const snapshot = { conversationId: scope.conversationId, version };
      if (barrier) { const waiting = barrier; captured(); await waiting; }
      --concurrent; return snapshot;
    } });
  t.after(() => gateway.close());
  const client = new Gateway({ url: gateway.url, token, teamId }), abort = new AbortController(); t.after(() => abort.abort());
  const states = client.events({ userId, projectId, conversationId: 'chat-race', signal: abort.signal });
  const first = states.next(); await reading;
  version = 1; gateway.notify({ projectId, conversationId: 'chat-race' }); barrier = null; release();
  assert.equal((await first).value.version, 0);
  let timer;
  const nextVersion = expected => Promise.race([(async () => {
    for (;;) { const result = await states.next(); if (result.done) throw new Error('Stream closed'); if (result.value.version === expected) return result.value; }
  })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Notification was lost')), 1500); })]).finally(() => clearTimeout(timer));
  await nextVersion(1);
  barrier = gate(); version = 2; gateway.notify({ projectId, conversationId: 'chat-race' }); await reading;
  version = 3;
  for (let i = 0; i < 50; i++) gateway.notify({ projectId, conversationId: 'chat-race' });
  barrier = null; release();
  await nextVersion(3);
  assert.equal(maximum, 1, 'Only one state read is active per subscription');
  assert.equal(reads, 4, 'The burst coalesces into one fresh follow-up read');
  abort.abort();
});

test('A failed Coordinator persistence never notifies optional observers', async t => {
  const directory = await temporary(t); let notifications = 0;
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: [], execute: async () => {}, model: {},
    onStateChange: () => { notifications++; } });
  await fs.mkdir(service.file);
  await assert.rejects(service.saveState({ status: 'running' }));
  assert.equal(notifications, 0);
});

test('Manual role is selected explicitly without changing legacy execution instructions', async () => {
  const document = await fs.readFile(new URL('../Coordinator.md', import.meta.url), 'utf8');
  const automatic = coordinatorRolePrompt(document), manual = coordinatorRolePrompt(document, { manual: true });
  assert.equal(automatic, document.slice(0, document.indexOf('\n## 人工对话模式\n')));
  assert.match(automatic, /系统为新任务创建独立执行 Session/);
  assert.doesNotMatch(manual, /系统为新任务创建独立执行 Session|审核 Plan|自动发起中断恢复/);
  assert.match(manual, /不创建、派发或恢复执行 Session/);
  for (const invariant of ['Main', 'Map', 'ask_user', 'prepare_task', '指定版本确认', 'memory-definition.md', '执行提示', '历史摘要不是当前事实或授权']) {
    assert.ok(manual.includes(invariant), `Manual role preserves ${invariant}`);
  }
  assert.ok(manual.length < automatic.length / 2, 'Profile excludes unrelated lifecycle text rather than appending overrides');
  const windows = document.replace(/\n/g, '\r\n');
  assert.equal(coordinatorRolePrompt(windows, { manual: true }).replace(/\r\n/g, '\n'), manual);
  assert.equal(coordinatorRolePrompt('custom legacy guide'), 'custom legacy guide');
  assert.match(coordinatorRolePrompt('custom legacy guide', { manual: true }), /人工执行模式/);
  for (const malformed of ['guide\n## 人工对话模式\n', '## 人工对话模式\n', 'guide\n## 人工对话模式',
    'guide\n## 人工对话模式\n## 人工对话模式\ncontent', 'guide\n## 人工对话模式\nfirst\n## 人工对话模式\nsecond']) {
    assert.throws(() => coordinatorRolePrompt(malformed, { manual: true }), { code: 'INVALID_COORDINATOR_PROFILE' });
  }
});
test('Manual brief native tool identifies the stored title field without changing validation or automatic tools', () => {
  const before = structuredClone(coordinatorTools);
  const tools = filterManualTools(coordinatorTools);
  const prepared = tools.find(tool => tool.name === 'prepare_task');
  const original = before.find(tool => tool.name === 'prepare_task');
  assert.match(prepared.input_schema.properties.text.description || '', /first line.*Main.*title/i);
  assert.match(prepared.input_schema.properties.text.description || '', /user.*requested title/i);
  assert.match(prepared.input_schema.properties.text.description || '', /new TODO/);
  assert.match(prepared.input_schema.properties.text.description || '', /existing TODO\/Bug keeps its current title/i);
  assert.match(prepared.input_schema.properties.taskId.description || '', /not.*title/i);
  assert.deepEqual(coordinatorTools, before, 'Manual descriptions cannot mutate automatic tools');
  const stripDescriptions = value => Array.isArray(value) ? value.map(stripDescriptions) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description').map(([key, entry]) => [key, stripDescriptions(entry)])) : value;
  assert.deepEqual(stripDescriptions(prepared.input_schema), stripDescriptions(original.input_schema), 'Native validation contract stays identical');
  for (const tool of tools.filter(tool => !['prepare_task', 'edit_map'].includes(tool.name))) assert.deepEqual(tool, before.find(item => item.name === tool.name));
  assert.deepEqual(filterManualTools(coordinatorTools), tools, 'Repeated compilation keeps the same definitions');
  const partial = [{ name: 'prepare_task' }, { name: 'prepare_task', input_schema: { type: 'object', properties: { acceptance: { type: 'string' } } } }];
  const projected = filterManualTools(partial);
  assert.equal(projected[0].input_schema, undefined, 'Name-only inventories remain supported');
  assert.deepEqual(projected[1].input_schema, partial[1].input_schema, 'Do not invent missing native fields');
});
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-integration-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
test('Manual native brief explains the complete existing-item identity rather than taskId alone', () => {
  const before = structuredClone(coordinatorTools);
  const fields = filterManualTools(coordinatorTools).find(tool => tool.name === 'prepare_task').input_schema.properties;
  assert.match(fields.taskId.description || '', /does not associate.*existing.*TODO\/Bug/i);
  assert.match(fields.itemId.description || '', /existing.*exact.*item ID/i);
  assert.match(fields.itemId.description || '', /nodeId.*kind/i);
  assert.match(fields.nodeId.description || '', /existing.*owning Main node/i);
  assert.match(fields.kind.description || '', /bug.*requires.*itemId/i);
  assert.deepEqual(coordinatorTools, before, 'Automatic tools remain unchanged');
});
test('Manual memory tool describes read-before-write and scoped full-document replacement without changing the schema', () => {
  const before = structuredClone(coordinatorTools);
  const tools = filterManualTools(coordinatorTools);
  const tool = tools.find(x => x.name === 'edit_map'), original = before.find(x => x.name === 'edit_map');
  assert.match(tool.description, /Create, update, move or delete.*TODO\/Bug/);
  assert.match(tool.description, /For a memory update on an existing node/);
  assert.match(tool.description, /read_map.*target.*before.*edit/i);
  const memory = tool.input_schema.properties.actions.items.properties.memoryDocument;
  assert.match(memory.description || '', /only.*requested.*sections/i);
  assert.match(memory.description || '', /preserve.*other.*sections/i);
  assert.match(memory.description || '', /no.*memory.*only.*applicable.*sections/i);
  assert.match(memory.description || '', /memoryDocument.*not.*filename/i);
  const stripDescriptions = x => Array.isArray(x) ? x.map(stripDescriptions) : x && typeof x === 'object'
    ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'description').map(([k,v]) => [k,stripDescriptions(v)])) : x;
  assert.deepEqual(stripDescriptions(tool.input_schema), stripDescriptions(original.input_schema));
  assert.deepEqual(coordinatorTools, before, 'No mutation of automatic native tools');
  assert.deepEqual(filterManualTools(coordinatorTools), tools, 'Repeated compilation is stable');
  for (const name of ['read_map','list_tasks','ask_user']) assert.deepEqual(tools.find(x=>x.name===name), before.find(x=>x.name===name));
  for (const partial of [{name:'edit_map'}, {name:'edit_map',input_schema:{type:'object',properties:{mainVersion:{type:'string'}}}}]) {
    assert.deepEqual(filterManualTools([partial])[0].input_schema, partial.input_schema, 'Do not invent absent native properties');
  }
});
test('Manual role limits memory editing to requested sections and reads the target first', async () => {
  const document = await fs.readFile(new URL('../Coordinator.md', import.meta.url), 'utf8');
  const manual = coordinatorRolePrompt(document, {manual:true});
  assert.match(manual, /先用 read_map 读取目标节点/);
  assert.match(manual, /只修改用户指定的部分/);
  assert.match(manual, /没有记忆文档时.*只写适用且已确认的章节/);
  assert.match(manual, /不为凑齐六部分补写/);
  assert.match(manual, /其他章节保持原文/);
  assert.doesNotMatch(coordinatorRolePrompt(document), /先用 read_map 读取目标节点/);
});
const input = (id, type, payload = {}, extra = {}) => ({ id, type, teamId, userId, projectId, conversationId: 'chat-fixture', payload, ...extra });
async function call(gateway, body, credential = token) {
  const response = await fetch(gateway.url + '/v1/command', { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('Relevance parses visible JSON independently of provider thinking metadata', async () => {
  const decision = { respond: true, reason: 'Related module follow-up' };
  const options = { overview: { version: 'main-v1' }, input: { text: '那文章列表呢？' } };
  for (const metadata of [
    { type: 'thinking', thinking: '', signature: '' },
    { type: 'thinking', thinking: 'Untrusted private reasoning: {"respond":false}', signature: 'opaque' },
    { type: 'redacted_thinking', data: 'opaque' },
  ]) {
    const model = { next: async request => {
      assert.match(request.system, /不得把内容相似当成重复投递/);
      return { stop: 'end_turn', content: [metadata, { type: 'text', text: JSON.stringify(decision) }] };
    } };
    assert.deepEqual(await classifyIntegrationMessage(model, options), { ...decision, mainVersion: 'main-v1' });
  }
  for (const content of [
    [{ type: 'thinking', thinking: JSON.stringify(decision) }],
    [{ type: 'text', text: 'not JSON' }],
    [{ type: 'text', text: JSON.stringify(decision) }, { type: 'tool_use', name: 'map_write', input: {} }],
    [{ type: 'text', text: JSON.stringify({ ...decision, actor: 'forged' }) }],
    [{ type: 'text', text: JSON.stringify({ respond: 'true', reason: 'Invalid type' }) }],
    [{ type: 'text', text: null }],
    [{ type: 'image', source: {} }],
  ]) {
    await assert.rejects(classifyIntegrationMessage({ next: async () => ({ stop: 'end_turn', content }) }, options),
      error => error.code === 'RELEVANCE_INVALID_RESPONSE');
  }
});

test('Integration listener is opt-in and rejects non-loopback or weak credentials', async () => {
  assert.equal(await startIntegrationGateway(), null);
  assert.throws(() => validateIntegrationConfig({ ...config, host: '0.0.0.0' }), error => error.code === 'INVALID_INTEGRATION_CONFIG');
  assert.throws(() => validateIntegrationConfig({ ...config, token: 'weak' }), error => error.code === 'INVALID_INTEGRATION_CONFIG');
  assert.throws(() => validateIntegrationConfig({ ...config, actions: ['task.assign'] }), error => error.code === 'INVALID_INTEGRATION_CONFIG');
});

test('Gateway assigns human identity and enforces workspace/project/action scopes before callbacks', async t => {
  const stateDir = await temporary(t), calls = [];
  const gateway = await startIntegrationGateway({ config: { ...config, actions: ['project.read', 'map.write'] }, stateDir,
    state: async () => ({}), command: async (command, context) => { calls.push({ command, context }); return { version: 'main-v1' }; } });
  t.after(() => gateway.close());
  assert.equal((await call(gateway, input('unauth', 'map.write'), 'wrong')).status, 401);
  assert.equal((await call(gateway, input('wrong-team', 'map.write', {}, { teamId: 'TOTHER' }))).status, 403);
  assert.equal((await call(gateway, input('wrong-user', 'map.write', {}, { userId: 'system' }))).status, 403);
  assert.equal((await call(gateway, input('wrong-project', 'map.write', {}, { projectId: 'private-project' }))).status, 403);
  assert.equal((await call(gateway, input('forged', 'map.write', { actor: { kind: 'coordinator' } }))).status, 400);
  assert.equal((await call(gateway, input('forged-role', 'map.write', { role: 'coordinator' }))).status, 400);
  assert.equal((await call(gateway, input('not-enabled', 'conversation.submit'))).status, 403);
  assert.equal((await call(gateway, input('unknown', 'task.assign'))).status, 400);
  const result = await call(gateway, input('map-transaction', 'map.write', { baseVersion: 'main-v0', operations: [] }));
  assert.equal(result.body.ok, true); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].context, { actor, operationId: 'map-transaction' });
});

test('Gateway persists operation receipts and rejects ID reuse across identities or requests', async t => {
  const stateDir = await temporary(t); let count = 0;
  const options = { config, stateDir, state: async () => ({}), command: async () => ({ committed: true, count: ++count }) };
  let gateway = await startIntegrationGateway(options);
  const body = input('durable-operation', 'map.write', { baseVersion: 'v0', operations: [] });
  const simultaneous = await Promise.all([call(gateway, body), call(gateway, body)]);
  assert.deepEqual(simultaneous[0].body.data, simultaneous[1].body.data); assert.equal(count, 1);
  await gateway.close(); gateway = await startIntegrationGateway(options); t.after(() => gateway.close());
  assert.equal((await call(gateway, body)).body.data.count, 1); assert.equal(count, 1);
  assert.equal((await call(gateway, { ...body, userId: 'UOTHER' })).body.error.code, 'ID_REUSED');
  assert.equal((await call(gateway, { ...body, payload: { baseVersion: 'v1', operations: [] } })).body.error.code, 'ID_REUSED');
  const names = await fs.readdir(path.join(stateDir, 'receipts'));
  assert.equal(names.length, 1); assert.deepEqual((await readJSON(path.join(stateDir, 'receipts', names[0]))).actor, actor);
});

test('Gateway BUSY failure preserves the same operation for a later successful retry', async t => {
  const stateDir = await temporary(t); let count = 0;
  const gateway = await startIntegrationGateway({ config, stateDir, state: async () => ({}), command: async () => {
    if (++count === 1) throw new MapError('BUSY', 'Coordinator is processing a turn', 409);
    return { accepted: true };
  } });
  t.after(() => gateway.close());
  const body = input('retry-original-operation', 'conversation.submit', { text: 'A real retry preserves its request identity' });
  assert.equal((await call(gateway, body)).body.error.code, 'BUSY');
  assert.equal((await call(gateway, body)).body.data.accepted, true); assert.equal(count, 2);
});

test('SSE subscription sends public snapshot and stops polling when disconnected', async t => {
  const stateDir = await temporary(t); let calls = 0;
  const gateway = await startIntegrationGateway({ config, stateDir, pollIntervalMs: 250, command: async () => ({}),
    state: async (_scope, context) => { assert.deepEqual(context.actor, actor); calls++; return { conversationId: 'chat-fixture', status: 'waiting-for-user' }; } });
  t.after(() => gateway.close());
  const controller = new AbortController();
  const query = new URLSearchParams({ teamId, userId, projectId, conversationId: 'chat-fixture' });
  const response = await fetch(`${gateway.url}/v1/events?${query}`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: state/); assert.match(first, /waiting-for-user/); assert.equal(gateway.subscriberCount(), 1);
  controller.abort(); await reader.cancel().catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(gateway.subscriberCount(), 0); const stoppedAt = calls;
  await new Promise(resolve => setTimeout(resolve, 280)); assert.equal(calls, stoppedAt);
});

test('SSE backpressure drains a long conversation and delivers its next snapshot without disconnecting', { timeout: 10000 }, async t => {
  const stateDir = await temporary(t); let generation = 1;
  const gateway = await startIntegrationGateway({ config, stateDir, pollIntervalMs: 250, command: async () => ({}),
    state: async () => ({ conversationId: 'chat-fixture', status: 'running', generation,
      messages: [{ id: 'long-history', role: 'assistant', text: '长对话'.repeat(50000) }] }) });
  t.after(() => gateway.close());
  const controller = new AbortController(); t.after(() => controller.abort());
  const client = new Gateway({ url: gateway.url, token, teamId });
  const iterator = client.events({ userId, projectId, conversationId: 'chat-fixture', signal: controller.signal });
  try {
    const first = await iterator.next();
    assert.equal(first.done, false); assert.equal(first.value.generation, 1);
    assert.ok(Buffer.byteLength(first.value.messages[0].text) > 256 * 1024);
    generation = 2;
    const next = await iterator.next();
    assert.equal(next.done, false, 'Ordinary writable backpressure is not a broken connection');
    assert.equal(next.value.generation, 2); assert.equal(gateway.subscriberCount(), 1);
  } finally { controller.abort(); await iterator.return().catch(() => {}); }
});

test('Gateway shutdown closes an in-progress SSE handshake without waiting for its snapshot or admitting a late subscriber', { timeout: 10000 }, async t => {
  const stateDir = await temporary(t); let started, release;
  const entered = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const gateway = await startIntegrationGateway({ config, stateDir, command: async () => ({}),
    state: async () => { started(); await blocked; return { conversationId: 'chat-fixture', status: 'running' }; } });
  const controller = new AbortController(); let stopping, timer;
  t.after(async () => { release(); controller.abort(); await (stopping || gateway.close()); });
  const query = new URLSearchParams({ teamId, userId, projectId, conversationId: 'chat-fixture' });
  const response = fetch(`${gateway.url}/v1/events?${query}`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
  // Keep an explicit rejection handler until the pending request is observed.
  response.catch(() => {});
  await entered; assert.equal(gateway.subscriberCount(), 0);
  stopping = gateway.close();
  try {
    await Promise.race([stopping, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SSE handshake blocked gateway shutdown')), 1000); })]);
    const stopped = await response; assert.equal(stopped.status, 503);
    assert.equal((await stopped.json()).error.code, 'STOPPING');
  } finally { clearTimeout(timer); release(); }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(gateway.subscriberCount(), 0, 'A snapshot released after shutdown cannot register a new client');
});

test('SSE capacity includes pending handshakes before any snapshot is available', { timeout: 10000 }, async t => {
  const stateDir = await temporary(t); let started, release, reads = 0;
  const entered = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const gateway = await startIntegrationGateway({ config, stateDir, maxSubscribers: 1, command: async () => ({}),
    state: async () => { reads++; started(); await blocked; return { conversationId: 'chat-fixture', status: 'running' }; } });
  const controller = new AbortController();
  t.after(async () => { release(); controller.abort(); await gateway.close(); });
  const query = new URLSearchParams({ teamId, userId, projectId, conversationId: 'chat-fixture' });
  const first = fetch(`${gateway.url}/v1/events?${query}`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
  first.catch(() => {}); await entered;
  const second = await fetch(`${gateway.url}/v1/events?${query}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) });
  assert.equal(second.status, 503); assert.equal((await second.json()).error.code, 'BUSY'); assert.equal(reads, 1);
  release(); await first;
});

test('Slack mirrors actual Coordinator append order when an earlier received request finishes context last', { timeout: 10000 }, async t => {
  const directory = await temporary(t); let entered, release, contextCalls = 0, modelCalls = 0, contextStartedAt;
  const firstContext = new Promise(resolve => { entered = resolve; });
  const contextGate = new Promise(resolve => { release = resolve; });
  const service = new CoordinatorService({ directory: path.join(directory, 'coordinator'), system: 'Controlled model fixture', tools: [],
    context: async () => { if (++contextCalls === 1) { contextStartedAt = Date.now(); entered(); await contextGate; } return null; },
    model: { async next() { modelCalls++; return { stop: 'end_turn', content: [{ type: 'text', text: modelCalls === 1 ? 'DONE B' : 'DONE A late context' }] }; } },
    execute: async () => { throw new Error('No tool call is allowed in this fixture'); } });
  const store = await new Store(path.join(directory, 'plugin')).open(), sent = [];
  const key = threadKey(teamId, 'CFIXTURE', '1.0');
  await store.bind(key, { projectId, conversationId: 'chat-fixture', userId, channel: 'CFIXTURE', threadTs: '1.0', ownRequests: ['A', 'B'] });
  const plugin = new SlackPlugin({ store, teamId, botUserId: 'BTEST', cloudOrigin: 'https://example.invalid',
    gateway: { command: async () => ({ ...await service.state(), conversationId: 'chat-fixture' }) },
    io: { async post(input) { sent.push(input); return `${100 + sent.length}.0`; }, async update(...args) { sent.push({ update: args }); } } });
  t.after(async () => { release(); await service.close({ stop: true }); await plugin.stop(); });
  const delayed = service.submit({ id: 'A', text: 'First received, context waits' }); delayed.catch(() => {});
  await firstContext;
  const deadline = Date.now() + 1000;
  while (Date.now() <= contextStartedAt) { assert.ok(Date.now() < deadline); await new Promise(resolve => setImmediate(resolve)); }
  await service.submit({ id: 'B', text: 'Accepted before the delayed request' }); await service.close();
  const before = await service.state(); await plugin.mirror(key); assert.match(sent.at(-1).text, /DONE B/);
  release(); await delayed; await service.close();
  const after = await service.state();
  assert.deepEqual(after.acceptedRequestIds, ['B', 'A']);
  assert.ok(Date.parse(after.timing.receivedAt) < Date.parse(before.timing.receivedAt), 'Producer timing and append order genuinely differ');
  await plugin.mirror(key);
  assert.equal(modelCalls, 2); assert.equal(sent.length, 2); assert.match(sent.at(-1).text, /DONE A late context/);
});

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN5kAAAAASUVORK5CYII=';
test('Protected attachment storage validates bytes and preserves project isolation and integrity', async t => {
  const directory = await temporary(t), store = new IntegrationAttachmentStore({ directory });
  const upload = { teamId, projectId, actor, filename: 'screenshot.png', mimeType: 'image/png', base64: png };
  const result = await store.upload(upload);
  assert.equal(result.hash, hash(Buffer.from(png, 'base64'))); assert.equal(result.base64, undefined); assert.equal(result.path, undefined);
  assert.deepEqual(await store.upload(upload), result);
  assert.equal((await store.resolve({ teamId, projectId, id: result.id })).base64, png);
  await assert.rejects(store.read({ teamId, projectId: 'another-project', id: result.id }), error => error.code === 'NOT_FOUND');
  await assert.rejects(store.read({ teamId: 'TOTHER', projectId, id: result.id }), error => error.code === 'NOT_FOUND');
  await assert.rejects(store.upload({ ...upload, filename: '../../escape' }), error => error.code === 'INVALID_ATTACHMENT');
  await assert.rejects(store.upload({ ...upload, mimeType: 'text/html' }), error => error.code === 'UNSUPPORTED_ATTACHMENT');
  await assert.rejects(store.upload({ ...upload, base64: '!!!!' }), error => error.code === 'INVALID_ATTACHMENT');
  await assert.rejects(store.upload({ ...upload, base64: Buffer.from('not PNG').toString('base64') }), error => error.code === 'INVALID_ATTACHMENT');
  await assert.rejects(store.upload({ ...upload, filename: 'text.txt', mimeType: 'text/plain', base64: Buffer.from([255]).toString('base64') }), error => error.code === 'INVALID_ATTACHMENT');
  const boundedText = { ...upload, filename: 'bounded.txt', mimeType: 'text/plain', base64: Buffer.alloc(256 * 1024, 65).toString('base64') };
  assert.equal((await store.upload(boundedText)).size, 256 * 1024);
  await assert.rejects(store.upload({ ...boundedText, base64: Buffer.alloc(256 * 1024 + 1, 65).toString('base64') }), error => error.code === 'ATTACHMENT_TOO_LARGE');
  await fs.writeFile(store.file(result.id), Buffer.from('tampered'));
  await assert.rejects(store.read({ teamId, projectId, id: result.id }), error => error.code === 'ATTACHMENT_CORRUPTED');
});

async function manualFixture(t) {
  const directory = await temporary(t);
  let document = { project: 'Fixture', root: { id: 'T0', title: 'Fixture', kind: 'module', memoryDocument: 'Project memory',
    children: [{ id: 'LOGIN', title: 'Login', kind: 'module', purpose: 'Token renewal', owns: ['src/login/'], todos: [],
      bugs: [{ id: 'B1', title: 'Refresh fails', status: 'open', createdAt: 'original-item', attempts: [{ status: 'Confirmed', cause: 'Expired token' }] }], children: [] }] } };
  let version = hash(JSON.stringify(document)), commits = 0, throwAfterCommit = false;
  const receipts = new Map();
  const readMain = async () => ({ document: structuredClone(document), version });
  const commitMain = async (request, actualActor) => {
    if (receipts.has(request.operationId)) return receipts.get(request.operationId);
    if (request.baseVersion !== version) throw new MapError('VERSION_CONFLICT', 'Main changed', 409);
    document = applyOperations(document, request.operations, actualActor).doc; version = hash(JSON.stringify(document)); commits++;
    const receipt = { committed: true, version }; receipts.set(request.operationId, receipt);
    if (throwAfterCommit) { throwAfterCommit = false; throw new Error('Process interrupted after Main commit'); }
    return receipt;
  };
  const options = { directory, projectId, readMain, commitMain }, service = new CoordinatorManualBriefs(options);
  return { service, options, readMain, get commits() { return commits; }, interrupt() { throwAfterCommit = true; },
    change() { document.root.memoryDocument = 'Updated project memory'; version = hash(JSON.stringify(document)); } };
}
const brief = version => ({ text: 'Correct token renewal', acceptance: 'Expired tokens are refreshed once', nodeIds: ['LOGIN'], mainVersion: version });
const review = (proposal, decision = 'approved') => ({ proposalId: proposal.id, version: proposal.version, decision, reason: 'Human reviewed this exact brief' });
const context = (operationId = 'review-first') => ({ operationId, conversationId: 'chat-fixture', actor });

test('Manual Bug intent without item identity is rejected instead of silently proposing a new TODO', async t => {
  const fixture = await manualFixture(t), { service } = fixture;
  const before = await fixture.readMain();
  for (const [index, fields] of [
    { taskId: 'B1', kind: 'bug' },
    { taskId: 'B1', kind: 'bug', nodeId: 'LOGIN' },
    { taskId: 'B1', kind: 'bug', itemId: 'B1' },
  ].entries()) {
    await assert.rejects(service.prepare({ ...brief(before.version), ...fields }, context(`invalid-bug-${index}`)),
      error => error.code === 'INVALID_ARGUMENT');
    assert.equal((await service.approvals('chat-fixture')).length, 0, 'No misleading pending card is persisted');
    assert.deepEqual(await fixture.readMain(), before, 'Main and the original Bug remain unchanged');
    assert.equal(fixture.commits, 0);
  }
  const valid = await service.prepare({ ...brief(before.version), taskId:'B1',itemId:'B1',nodeId:'LOGIN',kind:'bug' }, context('valid-bug'));
  assert.equal(valid.itemId, 'B1'); assert.equal(valid.kind, 'bug'); assert.equal(fixture.commits, 0);
});

test('Manual brief creates one Main TODO and pasteable fs-v2.1 prompt without any execution Session', async t => {
  const fixture = await manualFixture(t), { service } = fixture;
  const proposal = await service.prepare(brief((await fixture.readMain()).version), context('prepare-first'));
  assert.equal(proposal.requiresHumanApproval, true); assert.equal(proposal.manual, true); assert.equal(fixture.commits, 0);
  assert.equal((await service.approvals('chat-fixture'))[0].pending, true);
  await assert.rejects(service.prompt(proposal.id, 'chat-fixture'), error => error.code === 'APPROVAL_REQUIRED');
  const result = await service.review(review(proposal), context());
  assert.equal(fixture.commits, 1); assert.equal(result.executionMode, 'manual'); assert.equal(result.executionSessionId, undefined);
  const todo = (await fixture.readMain()).document.root.children[0].todos[0];
  assert.equal(todo.id, proposal.itemId); assert.equal(todo.status, 'pending'); assert.equal(todo.executionMode, 'manual');
  assert.deepEqual(todo.approvedBrief.actor, actor);
  assert.match(result.prompt, /nodes\/Fixture-module\/Login-module\/index\.md/);
  assert.match(result.prompt, new RegExp(`${proposal.itemId}\\.md`)); assert.match(result.prompt, /自己的 Session/); assert.doesNotMatch(result.prompt, /\/Users\//);
  assert.equal((await service.prompt(proposal.id, 'chat-fixture')).text, result.prompt);
  const replay = await service.review(review(proposal), context('review-second'));
  assert.deepEqual(replay, result); assert.equal(fixture.commits, 1);
  await assert.rejects(service.review(review(proposal, 'rejected'), context('review-third')), error => error.code === 'CONFLICT');
  assert.equal((await service.approvals('chat-fixture'))[0].pending, false);
});

test('Manual brief preserves the explicitly requested first-line title through approval and export, not taskId', async t => {
  const fixture = await manualFixture(t), { service } = fixture;
  const title = 'SLACK-NL-TITLE：文章列表空态提示';
  const text = `${title}\n无文章时显示“暂无文章”，aria-live=polite，不抢焦点；有文章时保持原样。`;
  const proposal = await service.prepare({ ...brief((await fixture.readMain()).version), taskId: 'operation-id-not-a-title', text }, context('prepare-title'));
  assert.equal(fixture.commits, 0);
  assert.equal(proposal.text.split('\n')[0], title);
  assert.equal((await service.approvals('chat-fixture'))[0].text, text);
  const approved = await service.review(review(proposal), context('approve-title'));
  const todo = (await fixture.readMain()).document.root.children[0].todos[0];
  assert.equal(todo.title, title);
  assert.equal(todo.description, text);
  assert.equal(todo.executionMode, 'manual');
  assert.notEqual(todo.id, 'operation-id-not-a-title');
  assert.match((await service.prompt(proposal.id, 'chat-fixture')).text, /SLACK-NL-TITLE：文章列表空态提示/);
  assert.equal(approved.executionSessionId, undefined);
});

test('A new brief for an existing Bug preserves its original title and records the new requirements only in its approval', async t => {
  const fixture = await manualFixture(t), { service } = fixture;
  const text = 'Not a rename of the existing Bug\nRefresh an expired token once.';
  const proposal = await service.prepare({ ...brief((await fixture.readMain()).version), text,
    nodeId: 'LOGIN', itemId: 'B1', kind: 'bug' }, context('prepare-existing-title'));
  await service.review(review(proposal), context('approve-existing-title'));
  const bug = (await fixture.readMain()).document.root.children[0].bugs[0];
  assert.equal(bug.id, 'B1'); assert.equal(bug.title, 'Refresh fails');
  assert.equal(bug.createdAt, 'original-item');
  assert.equal(bug.approvedBrief.text, text);
});

test('Manual brief preserves original Bug/attempt identity and requires exact Main and proposal versions', async t => {
  const fixture = await manualFixture(t), { service } = fixture;
  const proposal = await service.prepare({ ...brief((await fixture.readMain()).version), nodeId: 'LOGIN', kind: 'bug', itemId: 'B1' }, context('prepare-bug'));
  await assert.rejects(service.review({ ...review(proposal), version: 'old-version' }, context()), error => error.code === 'VERSION_CONFLICT');
  await assert.rejects(service.review(review(proposal), { ...context(), conversationId: 'chat-other' }), error => error.code === 'NOT_FOUND');
  await service.review(review(proposal), context());
  const node = (await fixture.readMain()).document.root.children[0];
  assert.equal(node.bugs.length, 1); assert.equal(node.todos.length, 0); assert.equal(node.bugs[0].createdAt, 'original-item');
  assert.equal(node.bugs[0].attempts[0].cause, 'Expired token'); assert.equal(node.bugs[0].status, 'open'); assert.equal(node.bugs[0].executionMode, 'manual');
  const second = await service.prepare(brief((await fixture.readMain()).version), context('prepare-after'));
  fixture.change();
  await assert.rejects(service.review(review(second), context('review-after')), error => error.code === 'VERSION_CONFLICT');
  assert.equal(fixture.commits, 1);
});

test('Interrupted manual approval replays exact Main transaction after restart without duplicate TODO', async t => {
  const fixture = await manualFixture(t);
  const proposal = await fixture.service.prepare(brief((await fixture.readMain()).version), context('prepare-interrupt'));
  fixture.interrupt();
  await assert.rejects(fixture.service.review(review(proposal), context()), /interrupted after Main commit/);
  assert.equal(fixture.commits, 1);
  const restarted = new CoordinatorManualBriefs(fixture.options);
  const result = await restarted.review(review(proposal), context());
  assert.equal(result.decision, 'approved'); assert.equal(fixture.commits, 1); assert.equal((await fixture.readMain()).document.root.children[0].todos.length, 1);
});

test('Manual rejection does not mutate Main and manual tools cannot dispatch or control Agents', async t => {
  const fixture = await manualFixture(t);
  const proposal = await fixture.service.prepare(brief((await fixture.readMain()).version), context('prepare-reject'));
  const result = await fixture.service.review(review(proposal, 'rejected'), context());
  assert.equal(result.decision, 'rejected'); assert.equal(result.prompt, undefined); assert.equal(fixture.commits, 0);
  const tools = filterManualTools(['dispatch_task', 'request_ci', 'prepare_task', 'read_map', 'complete_task'].map(name => ({ name, description: 'old' })));
  assert.deepEqual(tools.map(tool => tool.name), ['prepare_task', 'read_map']); assert.match(tools[0].description, /manual/);
});
