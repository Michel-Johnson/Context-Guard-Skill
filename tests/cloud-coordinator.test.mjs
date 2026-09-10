import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CoordinatorModel, coordinatorStep } from '../scripts/cloud/coordinator-model.mjs';
import { CoordinatorService, CoordinatorInbox, CoordinatorMapIntake, CoordinatorConversations } from '../scripts/cloud/coordinator-service.mjs';
import { createCoordinatorExecutor, coordinatorReferences, coordinatorTools } from '../scripts/cloud/coordinator-tools.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startCloudServer, authorizeCiReceiver } from '../scripts/cloud/server.mjs';
import { ProtocolStore } from '../scripts/shared/protocol-store.mjs';
import { verifyTaskCompletion, verifyTaskClose } from '../scripts/cloud/completion.mjs';
import { readMemoryView } from '../scripts/cloud/memory.mjs';

test('Coordinator routing prompt assigns node discovery to the agent while preserving human approval', async () => {
  const prompt = await fs.readFile(new URL('../Coordinator.md', import.meta.url), 'utf8');
  const mount = await fs.readFile(new URL('../references/map-mount.md', import.meta.url), 'utf8');
  const read = await fs.readFile(new URL('../references/map-read.md', import.meta.url), 'utf8');
  assert.match(prompt, /节点定位由你负责/);
  assert.match(prompt, /意图必须保真/);
  assert.match(prompt, /部署、发布、启动服务/);
  assert.match(prompt, /不得用源码路径或 CI 通过替代部署结果/);
  assert.match(prompt, /每个问题都必须调用一次 `ask_user`/);
  assert.match(prompt, /完整节点标题/);
  assert.match(prompt, /不要求用户提供节点名称、ID 或路径/);
  assert.match(prompt, /推荐不等于批准或派单/);
  assert.match(mount, /只问缺失的业务信息/);
  assert.match(mount, /没有匹配节点时说明已查范围并提出新节点建议/);
  assert.match(mount, /不要求用户找出正确节点/);
  assert.match(read, /不自动等于最终执行节点/);
  assert.doesNotMatch(prompt + mount, /没有对应节点就问用户|问清正确节点后改挂/);
});

test('Prompt upgrades apply at new turns and recover a pre-model rejection without replaying history', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-prompt-upgrade-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const options = { directory, tools: [], execute: async () => {}, model: { next: async ({ system }) => {
    calls.push(system); return { stop: 'end_turn', content: [{ type: 'text', text: 'Done' }] };
  } } };
  let service = new CoordinatorService({ ...options, system: 'old' });
  await service.submit({ id: 'first', text: 'First' }); await service.close();
  service = new CoordinatorService({ ...options, system: 'new' });
  await service.submit({ id: 'second', text: 'Second' }); await service.close();
  assert.deepEqual(calls, ['old', 'new']);
  let saved = JSON.parse(await fs.readFile(service.file, 'utf8'));
  assert.equal(saved.promptChanges.length, 1);
  saved.requests.third = createHash('sha256').update('Third').digest('hex');
  saved.messages.push({ role: 'user', content: 'Third' });
  Object.assign(saved, { status: 'error', error: { code: 'PROMPT_CHANGED' }, activeTurnId: 'third', activeInput: { id: 'third', text: 'Third' }, steps: 1, pending: null });
  await fs.writeFile(service.file, JSON.stringify(saved));
  service = new CoordinatorService({ ...options, system: 'latest' });
  await service.submit({ id: 'third', text: 'Third', retry: true }); await service.close();
  assert.deepEqual(calls, ['old', 'new', 'latest']);
  saved = JSON.parse(await fs.readFile(service.file, 'utf8'));
  assert.equal(saved.messages.filter(m => m.role === 'user').length, 3);
  assert.equal(saved.promptChanges.length, 2);
  // A paused tool turn must still retain its original prompt, even on retry.
  Object.assign(saved, { status: 'error', error: { code: 'PROMPT_CHANGED' }, activeTurnId: 'third', steps: 2,
    pending: { stop: 'tool_use', content: [{ type: 'tool_use', id: 'pending', name: 'shell', input: {} }] } });
  await fs.writeFile(service.file, JSON.stringify(saved));
  service = new CoordinatorService({ ...options, system: 'must-not-adopt' });
  await service.submit({ id: 'third', text: 'Third', retry: true }); await service.close();
  assert.equal((await service.state()).error.code, 'PROMPT_CHANGED');
  assert.equal(calls.length, 3);
});

test('Item conversations preserve identity, task ownership and legacy history across restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-conversations-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const registry = new CoordinatorConversations(directory);
  const a = await registry.ensure({ nodeId: 'T0', kind: 'todo', item: { id: '1', title: 'First' } });
  const b = await registry.ensure({ nodeId: 'T0', kind: 'bug', item: { id: '1', title: 'Second' } });
  assert.notEqual(a, b);
  assert.equal(await registry.ensure({ nodeId: 'T0', kind: 'todo', item: { id: '1', title: 'Renamed' } }), a);
  await registry.bind(a, 'session', 'task');
  await assert.rejects(registry.bind(b, 'session', 'task'), { code: 'FORBIDDEN' });
  const restored = new CoordinatorConversations(directory);
  assert.equal(await restored.owner('session', 'task'), a);
  assert.equal(await restored.owner('other-session', 'task'), 'legacy');
  assert.equal((await restored.list())[0].id, 'legacy');
  await assert.rejects(restored.get('../conversation'), { code: 'NOT_FOUND' });
  const recreated = await restored.ensure({ nodeId: 'T0', kind: 'todo', item: { id: '1', instanceId: 'new-instance', title: 'Recreated' } });
  assert.notEqual(recreated, a, 'recreated display IDs must not reuse the old conversation');
});

test('Identical request and tool IDs in different conversations cannot share effect receipts', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-conversation-effects-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const identities = [];
  for (const namespace of ['a', 'b']) {
    let calls = 0;
    const service = new CoordinatorService({ directory: path.join(directory, namespace), namespace, system: 'Coordinator', tools: [{ name: 'ask_user' }],
      execute: async (_, __, identity) => { identities.push(identity.operationId); return { question: 'Confirm?' }; },
      model: { next: async () => ++calls === 1 ? { stop: 'tool_use', content: [{ type: 'tool_use', id: 'same-tool', name: 'ask_user', input: { question: 'Confirm?' } }] } : { stop: 'end_turn', content: [] } },
    });
    await service.submit({ id: 'same-request', text: 'Discuss' }); await service.close();
  }
  assert.equal(identities.length, 2); assert.notEqual(identities[0], identities[1]);
});

test('Cloud item conversations have separate messages and survive restart without cloning legacy history', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-item-http-'));
  let server;
  t.after(async () => { await server?.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const projectId = 'context-guard', providerFile = path.join(directory, 'provider.json');
  await fs.writeFile(providerFile, JSON.stringify({ baseUrl: 'https://provider.example', model: 'test', token: 'synthetic' }));
  const memoryConfig = { dataDir: path.join(directory, 'memory'), adminToken: 'synthetic', projects: {
    [projectId]: { root: directory, token: 'synthetic', ref: 'refs/heads/main', coordinator: { enabled: true, providerFile, bindings: {} } },
  } };
  const memoryFile = path.join(memoryConfig.dataDir, createHash('sha256').update(projectId).digest('hex'), 'memory.json');
  await fs.mkdir(path.dirname(memoryFile), { recursive: true });
  await fs.writeFile(memoryFile, JSON.stringify({ revision: 1, main: { version: 'v1', memory: { map: { root: {
    id: 'T0', title: 'Lab', children: [], todos: [{ id: 'TD1', title: 'First' }], bugs: [{ id: 'B1', title: 'Second' }],
  } }, records: {} } }, sessions: {}, closedSessions: {}, receipts: {}, history: [], events: [], eventCursors: {} }));
  const options = { dataDir: directory, port: 0, browserToken: 'test-browser', memoryConfig,
    protocolConfig: { repositories: [{ repositoryId: '123', projectId, slug: 'example/lab' }] },
    coordinatorModelFactory: () => ({ next: async () => ({ stop: 'end_turn', content: [{ type: 'text', text: 'Response' }] }) }),
  };
  const headers = { Authorization: 'Bearer test-browser', 'Content-Type': 'application/json' };
  const call = async (suffix, body) => {
    const response = await fetch(`${server.url}/api/workbench/projects/${projectId}/api/coordinator${suffix}`, {
      headers, method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  };
  server = await startCloudServer(options);
  const a = (await call('/conversations', { nodeId: 'T0', kind: 'todo', itemId: 'TD1' })).id;
  const b = (await call('/conversations', { nodeId: 'T0', kind: 'bug', itemId: 'B1' })).id;
  await call('', { id: 'legacy', text: 'Old project discussion' });
  await call('?conversation=' + a, { id: 'same-id', text: 'Only first item' });
  await call('?conversation=' + b, { id: 'same-id', text: 'Only second item' });
  await server.close(); server = await startCloudServer(options);
  const first = await call('?conversation=' + a), second = await call('?conversation=' + b);
  assert.match(JSON.stringify(first.messages), /Only first item/);
  assert.doesNotMatch(JSON.stringify(first.messages), /Only second item|Old project discussion/);
  assert.match(JSON.stringify(second.messages), /Only second item/);
  assert.doesNotMatch(JSON.stringify(second.messages), /Only first item|Old project discussion/);
  assert.match(JSON.stringify((await call('')).messages), /Old project discussion/);
  assert.equal(first.conversations.length, 3);
  assert.deepEqual(first.nodeReferences, [{ id: 'T0', title: 'Lab' }]);
});

test('Successful ask_user questions appear in public chat without exposing other tool inputs', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-question-chat-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const options = { directory, system: 'Coordinator', tools: coordinatorTools, execute: createCoordinatorExecutor({
    readMap: async () => ({ privateMarker: 'not-public' }),
  }), model: { next: async () => ++calls === 1 ? { stop: 'tool_use', content: [
    { type: 'tool_use', id: 'read', name: 'read_map', input: { nodeId: 'internal-node' } },
    { type: 'tool_use', id: 'question', name: 'ask_user', input: { question: '**预期行为**是什么？\n\n请提供复现步骤。' } },
    { type: 'tool_use', id: 'invalid', name: 'ask_user', input: { question: 'Invalid question', extra: true } },
  ] } : { stop: 'end_turn', content: [{ type: 'text', text: '等待你的回复。' }] } } };
  const service = new CoordinatorService(options);
  await service.submit({ id: 'request', text: '讨论新 Bug' }); await service.close();
  const state = await service.state(), chat = JSON.stringify(state.messages);
  assert.match(chat, /预期行为/);
  assert.doesNotMatch(chat, /not-public|internal-node|Invalid question/);
  assert.equal(state.approvals.length, 0, 'asking is never human approval');
  const restored = new CoordinatorService(options);
  assert.deepEqual((await restored.state()).messages, state.messages);
});

test('Choice questions persist and stop before a redundant model summary; answers grant no approval', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-choice-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const execute = createCoordinatorExecutor({});
  await assert.rejects(execute('ask_user', { question: 'Which?', options: ['same', 'same'] }, { operationId: 'bad' }));
  let calls = 0;
  const options = { directory, system: 'Coordinator', tools: coordinatorTools, execute, model: { next: async () => {
    calls++;
    return { stop: 'tool_use', content: [{ type: 'text', text: 'Internal preamble' }, { type: 'tool_use', id: 'choice', name: 'ask_user', input: { question: '要上传什么？', options: ['网站构建产物', '其他文件'] } }] };
  } } };
  const service = new CoordinatorService(options);
  await service.submit({ id: 'question', text: 'Upload' }); await service.close();
  assert.equal(calls, 1);
  const state = await service.state();
  assert.equal(state.status, 'waiting-for-user');
  assert.equal(state.approvals.length, 0);
  assert.deepEqual(state.messages.at(-1).questions[0].options, ['网站构建产物', '其他文件']);
  assert.doesNotMatch(JSON.stringify(state.messages), /Internal preamble/);
  assert.deepEqual((await new CoordinatorService(options).state()).messages, state.messages);
  const questionId = state.messages.at(-1).questions[0].id;
  await assert.rejects(service.submit({ id: 'unknown', text: 'Answer', answerTo: 'other-conversation-question' }), { code: 'NOT_FOUND' });
  await service.submit({ id: 'answer', text: '网站构建产物', answerTo: questionId }); await service.close();
  await service.submit({ id: 'answer', text: '网站构建产物', answerTo: questionId }); await service.close();
  assert.equal(calls, 2, 'a repeated answer request does not run the model twice');
  const restored = await new CoordinatorService(options).state();
  assert.deepEqual(restored.messages.flatMap(message => message.questions || []).find(question => question.id === questionId).answer, { text: '网站构建产物', requestId: 'answer' });
  assert.equal(restored.approvals.length, 0);
  await assert.rejects(service.submit({ id: 'second-answer', text: 'Changed', answerTo: questionId }), { code: 'ALREADY_ANSWERED' });
});

test('Main intake preserves first edits, skips history, and replays lost replies without duplicate turns', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-map-intake-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const snapshot = { eventCursors: { main: 5 }, main: { memory: { map: { root: { id: 'T0', todos: [{ id: 'old', title: 'existing' }] } } } }, events: [] };
  let turns = 0, loseReply = true;
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: [], execute: async () => {},
    model: { next: async () => { turns++; return { stop: 'end_turn', content: [{ type: 'text', text: 'What is the expected result?' }] }; } } });
  const submit = service.submit.bind(service);
  service.submit = async (...args) => { const result = await submit(...args); if (loseReply) { loseReply = false; throw new Error('lost reply'); } return result; };
  const options = { directory, read: async () => structuredClone(snapshot), service, nodeIds: ['T0'] };
  let intake = new CoordinatorMapIntake(options);
  await intake.initialize();
  snapshot.events.push({ scope: 'main', cursor: 6, version: 'v6', actor: { kind: 'human' }, operations: [
    { type: 'update', id: 'T0', fields: { todos: [{ id: 'old', title: 'existing' }, { id: 'new', title: 'new request' }, { id: 'draft', draft: true }] } },
    { type: 'update', id: 'outside', fields: { bugs: [{ id: 'secret', title: 'outside scope' }] } },
  ] });
  snapshot.main.memory.map.root.todos = snapshot.events[0].operations[0].fields.todos;
  await assert.rejects(intake.consume(), /lost reply/);
  await service.close();
  intake = new CoordinatorMapIntake(options);
  await intake.initialize();
  assert.equal(await intake.consume(), true);
  await service.close();
  assert.equal(await intake.consume(), false);
  assert.equal(turns, 1);
  const state = await service.state();
  assert.equal(state.messages.filter(message => message.role === 'user').length, 1);
  assert.match(state.messages[0].text, /human.work-item-created/);
  assert.match(state.messages[0].text, /不要直接派单/);
  assert.doesNotMatch(state.messages[0].text, /outside scope/);
  snapshot.events.push({ scope: 'main', cursor: 7, version: 'v7', actor: { kind: 'human' }, operations: [
    { type: 'update', id: 'T0', fields: { todos: [{ id: 'draft', title: 'finished typing' }] } },
  ] });
  snapshot.main.memory.map.root.todos = snapshot.events[1].operations[0].fields.todos;
  assert.equal(await intake.consume(), true);
  await service.close();
  assert.equal(turns, 2);
  snapshot.events.push({ scope: 'main', cursor: 8, version: 'v8', actor: { kind: 'human' }, operations: [
    { type: 'update', id: 'T0', fields: { bugs: [
      { id: 'deleted', title: 'removed while busy' }, { id: 'resolved', title: 'finished while busy' },
      { id: 'assigned', title: 'assigned while busy' },
    ] } },
  ] });
  snapshot.main.memory.map.root.bugs = [
    { id: 'resolved', title: 'finished while busy', status: 'resolved' },
    { id: 'assigned', title: 'assigned while busy', dispatch: { task_id: 'existing-task' } },
  ];
  assert.equal(await intake.consume(), false);
  assert.equal(turns, 2, 'deleted, completed and already assigned work must not start a stale clarification');
});

test('A busy item does not block another intake or advance past its unconsumed event', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-intake-busy-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const snapshot = { eventCursors: {}, main: { memory: { map: { root: { id: 'T0' } } } }, events: [] };
  let busy = true; const received = [];
  const intake = new CoordinatorMapIntake({ directory, read: async () => snapshot, service: { submit: async request => {
    const item = JSON.parse(request.text);
    if (item.itemId === 'a' && busy) throw Object.assign(new Error('Busy'), { code: 'COORDINATOR_BUSY' });
    received.push(item.itemId);
  } } });
  await intake.initialize();
  const todos = [{ id: 'a', title: 'First' }, { id: 'b', title: 'Second' }];
  snapshot.main.memory.map.root.todos = todos;
  snapshot.events.push({ scope: 'main', cursor: 1, version: 'v1', actor: { kind: 'human' }, operations: [{ type: 'update', id: 'T0', fields: { todos } }] });
  await intake.consume(); assert.deepEqual(received, ['b']);
  busy = false;
  await intake.consume(); await intake.consume();
  assert.deepEqual(received, ['b', 'a']);
});

test('Mount review batches persist, replay a lost Main reply, and notify the existing conversation once', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-mount-review-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const proposals = ['a', 'b', 'c'].map(id => [id, { result: { kind: 'mount-proposal', mainVersion: 'main-v1', parentId: 'T0', title: id, owns: [`${id}/`], requiresHumanApproval: true } }]);
  await fs.writeFile(path.join(directory, 'conversation.json'), JSON.stringify({ messages: [], requests: {}, status: 'idle', toolReceipts: Object.fromEntries(proposals) }));
  let modelCalls = 0, effects = 0, loseReply = true;
  const committed = new Map();
  const commit = async (items, operationId) => {
    assert.deepEqual(items.map(item => item.id), ['a', 'b']);
    if (!committed.has(operationId)) { effects++; committed.set(operationId, { version: 'main-v2', nodeIds: ['A', 'B'] }); }
    if (loseReply) { loseReply = false; throw new Error('lost Main reply'); }
    return committed.get(operationId);
  };
  const options = { directory, system: 'Coordinator', tools: [], execute: async () => {}, simulated: true,
    model: { next: async () => { modelCalls++; return { stop: 'end_turn', content: [{ type: 'text', text: 'read updated Main' }] }; } } };
  let service = new CoordinatorService(options);
  const input = { id: 'review', proposalIds: ['b', 'a'], decision: 'approved', reason: 'confirmed paths' };
  await assert.rejects(service.reviewMount(input, commit), /lost Main reply/);
  service = new CoordinatorService(options);
  const result = await service.reviewMount(input, commit);
  assert.equal(effects, 1); assert.equal(result.simulated, true);
  assert.deepEqual(await service.reviewMount({ ...input, id: 'retry-after-reload' }, commit), result);
  await assert.rejects(service.reviewMount({ ...input, decision: 'rejected' }, commit), { code: 'ID_REUSED' });
  await assert.rejects(service.reviewMount({ ...input, id: 'other', proposalIds: ['a'] }, commit), { code: 'CONFLICT' });
  await assert.rejects(service.reviewMount({ ...input, role: 'human' }, commit), { code: 'INVALID_INPUT' });
  await service.notifyMountReview(); await service.close();
  const saved = JSON.parse(await fs.readFile(service.mountFile, 'utf8'));
  for (const receipt of Object.values(saved.receipts)) receipt.notified = false;
  await fs.writeFile(service.mountFile, JSON.stringify(saved));
  service = new CoordinatorService(options);
  await service.notifyMountReview(); await service.close();
  assert.equal(modelCalls, 1, 'lost notification acknowledgement does not replay the model turn');
  assert.equal((await service.state()).approvals.find(item => item.id === 'a').pending, false);
  const rejected = await service.reviewMount({ id: 'reject-c', proposalIds: ['c'], decision: 'rejected', reason: 'wrong node' }, () => { throw new Error('must not write Main'); });
  assert.equal(rejected.committed, null);
});

test('Coordinator shutdown finishes its current durable step and restart resumes without repeating tools', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-coordinator-stop-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let release, entered, calls = 0, effects = 0;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const options = { directory, system: 'Coordinator', tools: [{ name: 'read_map' }], execute: async () => { effects++; return { version: 'v1' }; },
    model: { next: async () => {
      calls++;
      if (calls === 1) { entered(); await gate; return { stop: 'tool_use', content: [{ type: 'tool_use', id: 'read', name: 'read_map', input: {} }] }; }
      return { stop: 'end_turn', content: [{ type: 'text', text: 'done' }] };
    } } };
  const service = new CoordinatorService(options);
  await service.submit({ id: 'original', text: 'Read the map' }); await waiting;
  const closing = service.close({ stop: true }); release(); await closing;
  assert.equal(calls, 1); assert.equal(effects, 1);
  assert.equal((await service.state()).activeTurnId, 'original');
  await assert.rejects(service.submit({ id: 'new', text: 'new' }), { code: 'UNAVAILABLE' });
  const restarted = new CoordinatorService(options); restarted.kick(); await restarted.close();
  assert.equal((await restarted.state()).status, 'waiting-for-user');
  assert.equal(calls, 2); assert.equal(effects, 1);
});

test('Cloud mount confirmation is browser-only, commits a versioned batch atomically, and preserves replay after restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-mount-http-'));
  let server;
  t.after(async () => { await server?.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const projectId = 'context-guard', providerFile = path.join(directory, 'provider.json');
  await fs.writeFile(providerFile, JSON.stringify({ baseUrl: 'https://provider.example', model: 'test', token: 'synthetic-private' }));
  const memoryConfig = { dataDir: path.join(directory, 'memory'), adminToken: 'synthetic-admin', projects: {
    [projectId]: { root: directory, token: 'synthetic-agent', ref: 'refs/heads/main', coordinator: { enabled: true, providerFile, bindings: {}, simulated: true } },
  } };
  const memoryFile = path.join(memoryConfig.dataDir, createHash('sha256').update(projectId).digest('hex'), 'memory.json');
  await fs.mkdir(path.dirname(memoryFile), { recursive: true });
  await fs.writeFile(memoryFile, JSON.stringify({ revision: 1, main: { version: 'v1', memory: { map: { root: { id: 'T0', title: 'Lab', children: [] } }, records: {} } }, sessions: {}, closedSessions: {}, receipts: {}, history: [], events: [], eventCursors: {} }));
  const conversation = path.join(directory, 'coordinators', projectId);
  await fs.mkdir(conversation, { recursive: true });
  await fs.writeFile(path.join(conversation, 'conversation.json'), JSON.stringify({ messages: [], requests: {}, status: 'idle', toolReceipts: Object.fromEntries(['a', 'b', 'stale'].map(id => [id, { result: {
    kind: 'mount-proposal', mainVersion: id === 'stale' ? 'old' : 'v1', parentId: 'T0', title: id, purpose: 'Independent lab responsibility', owns: [`${id}/`], requiresHumanApproval: true,
  } }])) }));
  const options = { dataDir: directory, port: 0, browserToken: 'test-browser', memoryConfig,
    protocolConfig: { repositories: [{ repositoryId: '123', projectId, slug: 'example/lab' }] },
    coordinatorModelFactory: () => ({ next: async () => ({ stop: 'end_turn', content: [{ type: 'text', text: 'Review received' }] }) }),
  };
  server = await startCloudServer(options);
  const input = { id: 'human-mount', proposalIds: ['a', 'b'], decision: 'approved', reason: 'Confirmed both responsibilities' };
  const send = (body, token = 'test-browser') => fetch(`${server.url}/api/workbench/projects/${projectId}/api/coordinator/mount-review`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await send(input, 'synthetic-agent')).status, 401);
  assert.notEqual((await send({ ...input, role: 'human' })).status, 200);
  assert.equal((await send({ ...input, id: 'stale-review', proposalIds: ['stale'] })).status, 409);
  assert.equal((await readMemoryView(memoryConfig, projectId)).main.memory.map.root.children.length, 0);
  const response = await send(input); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.committed.nodeIds.length, 2);
  assert.notEqual(result.committed.version, 'v1');
  await server.close(); server = await startCloudServer(options);
  assert.deepEqual(await (await send(input)).json(), result);
  assert.deepEqual(await (await send({ ...input, id: 'after-reload' })).json(), result);
  const main = (await readMemoryView(memoryConfig, projectId)).main;
  assert.equal(main.memory.map.root.children.length, 2);
  assert.ok(main.memory.map.root.children.every(node => node.proposal === 'accepted' && node.origin === 'human'));
});

test('Completion verifies GitHub repository, tested SHA, required check issuer and server publication in order', async () => {
  const sourceSha = 'a'.repeat(40), mergeSha = 'b'.repeat(40);
  const project = { repository: 'example/lab', ref: 'refs/heads/main', completion: { requiredChecks: [{ name: 'Required', appId: 15368 }] } };
  const task = { stage: 'accepted', session: { id: 'developer', generation: 1 }, sourceSha,
    ci: { verdict: 'passed' }, acceptanceReview: { decision: 'approved' }, acceptanceAt: '2026-09-08T01:00:00Z' };
  const publication = { sessionVersion: 'published-session', sourceCommit: sourceSha, mainSha: mergeSha, mainVersion: 'published-main', publishedAt: '2026-09-08T01:02:00Z' };
  const memory = { closedSessions: { developer: { publications: [publication] } } };
  const receipts = { gitReceiptRef: 'github-pr:7', archiveReceiptRef: 'published-session' };
  const pr = { merged: true, merged_at: '2026-09-08T01:01:00Z', merge_commit_sha: mergeSha,
    base: { ref: 'main', repo: { id: 123 } }, head: { sha: sourceSha, repo: { id: 123 } } };
  const checks = { total_count: 1, check_runs: [{ name: 'Required', app: { id: 15368 }, head_sha: sourceSha, status: 'completed', conclusion: 'success', completed_at: '2026-09-08T01:00:30Z' }] };
  let currentPr = pr, currentChecks = checks, calls = 0;
  const options = { project, repositoryId: '123', task, memory, receipts, fetch: async (url, init) => {
    assert.ok(url.startsWith('https://api.github.com/repos/example/lab/'));
    assert.equal(init.redirect, 'error'); calls++;
    return Response.json(url.includes('/pulls/') ? currentPr : currentChecks);
  } };
  assert.equal((await verifyTaskCompletion(options)).mergeSha, mergeSha);
  for (const changed of [{ merged: false }, { head: { ...pr.head, sha: 'c'.repeat(40) } }, { base: { ...pr.base, ref: 'other' } },
    { base: { ...pr.base, repo: { id: 999 } } }, { merged_at: '2026-09-08T00:59:00Z' }, { merge_commit_sha: 'c'.repeat(40) }]) {
    currentPr = { ...pr, ...changed }; assert.equal(await verifyTaskCompletion(options), false);
  }
  currentPr = pr;
  for (const changed of [{ conclusion: 'failure' }, { status: 'in_progress' }, { app: { id: 999 } }, { head_sha: 'c'.repeat(40) }, { completed_at: '2026-09-08T01:03:00Z' }]) {
    currentChecks = { ...checks, check_runs: [{ ...checks.check_runs[0], ...changed }] };
    assert.equal(await verifyTaskCompletion(options), false);
  }
  currentChecks = { ...checks, total_count: 101 };
  assert.equal(await verifyTaskCompletion(options), false);
  const before = calls;
  assert.equal(await verifyTaskCompletion({ ...options, receipts: { ...receipts, archiveReceiptRef: 'agent-claim' } }), false);
  assert.equal(await verifyTaskCompletion({ ...options, task: { ...task, stage: 'awaiting-merge' } }), false);
  assert.equal(calls, before);
  await assert.rejects(verifyTaskCompletion({ ...options, fetch: async () => new Response('private error', { status: 503 }) }),
    error => error.code === 'UNAVAILABLE' && !error.message.includes('private error'));
  const closing = { ...task, control: { id: 'control' }, completion: { proof: { sourceSha, mergeSha }, closeReceiptId: 'control' } };
  assert.equal(verifyTaskClose(null, closing, { controlId: 'control', closeReceiptId: 'control' }), true);
  assert.equal(verifyTaskClose(null, closing, { controlId: 'other', closeReceiptId: 'control' }), false);
  assert.equal(verifyTaskClose(null, closing, { controlId: 'control', closeReceiptId: 'invented' }), false);
  assert.equal(verifyTaskClose(null, { ...closing, sourceSha: 'changed' }, { controlId: 'control', closeReceiptId: 'control' }), false);
});

const text = { model: 'test-model', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ready' }] };
const config = { baseUrl: 'https://provider.example/api/anthropic', model: 'test-model', token: 'synthetic-private-value' };
test('Coordinator advertises reference names and accepts existing extensionless calls without allowing other paths', async () => {
  const names = [];
  const execute = createCoordinatorExecutor({ readReference: async name => { names.push(name); return { name }; } });
  assert.deepEqual(coordinatorTools.find(tool => tool.name === 'read_reference').input_schema.properties.name.enum, coordinatorReferences);
  for (const name of ['agent-handoff', 'agent-handoff.md', 'references/agent-handoff.md']) {
    assert.deepEqual(await execute('read_reference', { name }, { operationId: 'reference' }), { name: 'agent-handoff.md' });
  }
  for (const name of ['../agent-handoff.md', 'references/../agent-handoff.md', '/etc/passwd', 'server-memory.md']) {
    await assert.rejects(execute('read_reference', { name }, { operationId: 'denied' }), { code: 'INVALID_ARGUMENT' });
  }
  assert.equal(names.length, 3);
});
test('Coordinator transport pins the provider/model and never retries or echoes provider secrets', async () => {
  let calls = 0;
  const model = new CoordinatorModel({ ...config, fetch: async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://provider.example/api/anthropic/v1/messages');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${config.token}`);
    assert.equal(JSON.parse(options.body).model, config.model);
    return Response.json(text);
  } });
  assert.equal((await model.next({ system: 'role', messages: [{ role: 'user', content: 'hello' }] })).stop, 'end_turn');
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(model).includes(config.token));
  model.fetch = async () => { calls++; return new Response(config.token, { status: 401 }); };
  await assert.rejects(model.next({ system: 'role', messages: [] }), error => error.code === 'MODEL_HTTP_401' && !error.message.includes(config.token));
  assert.equal(calls, 2);
});

test('Coordinator rejects model substitution, partial output, duplicate calls, and oversized responses', async () => {
  for (const body of [
    { ...text, model: 'other-model' }, { ...text, stop_reason: 'max_tokens' },
    { ...text, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'same', name: 'read_map', input: {} }, { type: 'tool_use', id: 'same', name: 'read_map', input: {} }] },
  ]) {
    const model = new CoordinatorModel({ ...config, fetch: async () => Response.json(body) });
    await assert.rejects(model.next({ system: '', messages: [] }), { code: 'MODEL_INVALID_RESPONSE' });
  }
  const large = new CoordinatorModel({ ...config, fetch: async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)) });
  await assert.rejects(large.next({ system: '', messages: [] }), { code: 'MODEL_RESPONSE_TOO_LARGE' });
});

test('Coordinator deadline aborts the request and exposes a stable timeout error', async () => {
  const model = new CoordinatorModel({ ...config, timeoutMs: 5, fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error(config.token)), { once: true });
  }) });
  await assert.rejects(model.next({ system: '', messages: [] }), { code: 'MODEL_TIMEOUT' });
});

test('Coordinator restarts from a saved tool intent with the same operation identity', async () => {
  const tools = [{ name: 'read_map', input_schema: { type: 'object' } }];
  let disk = { messages: [{ role: 'user', content: 'Read Main' }] }, requests = 0, effects = 0;
  const receipts = new Map(); let failAfterEffect = true;
  const options = { turnId: 'turn-1', system: 'Coordinator prompt v1', tools,
    model: { next: async () => { requests++; return { stop: 'tool_use', content: [{ type: 'tool_use', id: 'call-1', name: 'read_map', input: { node: 'T0' } }] }; } },
    save: async state => { disk = structuredClone(state); },
    execute: async (_name, _input, { operationId }) => {
      if (!receipts.has(operationId)) { effects++; receipts.set(operationId, { version: 'main-v1' }); }
      if (failAfterEffect) { failAfterEffect = false; throw new Error('lost protocol reply'); }
      return receipts.get(operationId);
    },
  };
  await assert.rejects(coordinatorStep({ ...options, state: structuredClone(disk) }), /lost protocol reply/);
  assert.equal(disk.pending.stop, 'tool_use');
  await coordinatorStep({ ...options, state: structuredClone(disk) });
  assert.equal(effects, 1); assert.equal(requests, 1);
  assert.equal(disk.messages.at(-1).content[0].type, 'tool_result');
  await assert.rejects(coordinatorStep({ ...options, state: structuredClone(disk), system: 'changed prompt' }), { code: 'PROMPT_CHANGED' });
});

test('Coordinator cannot call an unregistered tool such as shell or human approval', async () => {
  let executed = false;
  for (const name of ['shell', 'human_approve']) {
    await assert.rejects(coordinatorStep({ turnId: 'turn-1', system: 'Coordinator', state: { pending: { stop: 'tool_use', content: [{ type: 'tool_use', id: 'call-1', name, input: {} }] } },
      tools: [{ name: 'read_map' }], save: async () => {}, execute: async () => { executed = true; } }), { code: 'TOOL_FORBIDDEN' });
  }
  assert.equal(executed, false);
});

test('Definite tool rejection is returned to the model; later effects are skipped and replayed without execution', async () => {
  let state = { pending: { stop: 'tool_use', content: [
    { type: 'tool_use', id: 'wrong-id', name: 'read_task', input: {} },
    { type: 'tool_use', id: 'later-write', name: 'dispatch_task', input: {} },
  ] } }, calls = 0;
  const options = { turnId: 'turn', system: 'Coordinator', tools: [{ name: 'read_task' }, { name: 'dispatch_task' }],
    save: async value => { state = structuredClone(value); }, execute: async () => { calls++; throw Object.assign(new Error('private diagnostic'), { code: 'NOT_FOUND' }); } };
  const original = structuredClone(state.pending);
  await coordinatorStep({ ...options, state });
  assert.equal(calls, 1);
  assert.deepEqual(state.messages.at(-1).content.map(x => [x.is_error, JSON.parse(x.content).error.code]), [[true, 'NOT_FOUND'], [true, 'NOT_EXECUTED']]);
  assert.ok(!JSON.stringify(state).includes('private diagnostic'));
  await coordinatorStep({ ...options, state: { ...state, pending: original } });
  assert.equal(calls, 1, 'receipts preserve the rejected and unexecuted outcomes');
});

test('Human feedback can correct a legacy rejected call but cannot discard an unknown transport outcome', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-coordinator-correct-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'conversation.json');
  const failed = { messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'bad', name: 'review_plan', input: { taskId: 'mistyped' } }] }],
    requests: { original: 'saved' }, toolReceipts: {}, status: 'error', error: { code: 'NOT_FOUND' }, activeTurnId: 'original',
    pending: { stop: 'tool_use', content: [{ type: 'tool_use', id: 'bad', name: 'review_plan', input: { taskId: 'mistyped' } }] } };
  await fs.writeFile(file, JSON.stringify(failed));
  let executions = 0;
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: [{ name: 'review_plan' }],
    execute: async () => { executions++; }, model: { next: async ({ messages }) => {
      assert.equal(messages.at(-1).content, 'Reject the unsafe Plan and request a corrected version');
      assert.equal(messages.at(-2).content[0].is_error, true);
      return { stop: 'end_turn', content: [{ type: 'text', text: 'Correction received' }] };
    } } });
  assert.equal((await service.state()).canCorrect, true);
  await service.submit({ id: 'correction', text: 'Reject the unsafe Plan and request a corrected version' }); await service.close();
  assert.equal(executions, 0, 'the formerly rejected approval is never executed');
  assert.equal((await service.state()).status, 'waiting-for-user');
  for (const code of ['UNAVAILABLE', 'MODEL_TIMEOUT', 'TOOL_ID_REUSED']) {
    await fs.writeFile(file, JSON.stringify({ ...failed, error: { code } }));
    assert.equal((await service.state()).canCorrect, false);
    await assert.rejects(service.submit({ id: 'correction', text: 'Do not drop the original intent' }), { code: 'COORDINATOR_BUSY' });
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).activeTurnId, 'original');
  }
});

test('Coordinator persists a human conversation and only retries a failed turn explicitly', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-coordinator-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const options = { directory, system: 'Coordinator', tools: [], simulated: true,
    execute: async () => { throw new Error('No tools allowed'); },
    model: { next: async () => { calls++; if (calls === 1) throw Object.assign(new Error('provider timeout'), { code: 'MODEL_TIMEOUT' }); return { stop: 'end_turn', content: [{ type: 'text', text: '请确认需求。' }] }; } },
  };
  const service = new CoordinatorService(options);
  const input = { id: 'human-1', text: '查看地图' };
  await service.submit(input); await service.close();
  assert.equal((await service.state()).error.code, 'MODEL_TIMEOUT');
  const restarted = new CoordinatorService(options);
  await restarted.submit(input); await restarted.close();
  assert.equal(calls, 1);
  await restarted.submit({ ...input, retry: true }); await restarted.close();
  const state = await restarted.state();
  assert.equal(calls, 2); assert.equal(state.status, 'waiting-for-user');
  assert.equal(state.messages.filter(x => x.role === 'user').length, 1);
  assert.match(state.messages[0].text, /模拟人工输入/);
  assert.equal(state.messages.at(-1).text, '请确认需求。');
  await assert.rejects(restarted.submit({ ...input, text: '另一个请求' }), { code: 'ID_REUSED' });
});

test('Coordinator tools pin approved routing and refuse stale Plan approval or human impersonation', async () => {
  const calls = [], current = { brief: { ref: 'brief', version: 'b1' }, plan: { ref: 'plan', version: 'p2' } };
  const execute = createCoordinatorExecutor({
    readTask: async () => current,
    readReference: async () => ({ version: 'rules-v1' }),
    exchange: async (sessionId, id, type, payload) => {
      calls.push({ sessionId, id, type, payload });
      return type === 'object.read' ? { content: { text: JSON.stringify({ v: 1, taskId: 'task-1', nodeIds: ['M1'], mainVersion: 'main-v1' }) } } : { ok: true };
    },
  });
  const identity = { sessionId: 'session-1', taskId: 'task-1' };
  await execute('dispatch_task', { ...identity, briefRef: 'brief', briefVersion: 'b1' }, { operationId: 'op-1' });
  assert.deepEqual(calls.at(-1).payload.nodeIds, ['M1']);
  assert.equal(calls.at(-1).payload.mode, 'reviewed');
  assert.equal(calls.at(-1).payload.mainVersion, 'main-v1');
  await assert.rejects(execute('dispatch_task', { ...identity, briefRef: 'brief', briefVersion: 'b1', mode: 'session' }, { operationId: 'op-2' }), { code: 'INVALID_ARGUMENT' });
  const before = calls.length;
  await assert.rejects(execute('review_plan', { ...identity, planRef: 'plan', planVersion: 'p1', decision: 'approved', reason: 'reviewed old version' }, { operationId: 'op-3' }), /Plan changed/);
  assert.equal(calls.length, before);
  await assert.rejects(execute('human_approve', identity, { operationId: 'op-4' }), /not registered/);
});

test('Coordinator can resume an interrupted task only with the current version and explicit reason', async () => {
  const calls = [], current = { version: 'v7', stage: 'interrupted' };
  const execute = createCoordinatorExecutor({
    readTask: async () => current,
    exchange: async (sessionId, id, type, payload) => { calls.push({ sessionId, id, type, payload }); return { ok: true }; },
  });
  const result = await execute('resume_task', { sessionId: 'session-1', taskId: 'task-1', reason: '用户明确要求继续' }, { operationId: 'resume-op' });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{ sessionId: 'session-1', id: 'resume-op', type: 'task.control', payload: {
    taskId: 'task-1', action: 'resume', expectedVersion: 'v7', data: { reason: '用户明确要求继续' },
  } }]);
});

test('Coordinator inbox automatically resumes an interrupted notification without a user turn', async () => {
  const session = { id: 'session-1', generation: 1 }, interruption = { v: 2, id: 'interrupt-1', type: 'task.report', session,
    payload: { taskId: 'task-1', stage: 'interrupted', data: { reason: 'timeout', occurredAt: '2026-09-10T00:00:00Z' } } };
  let resumed = 0, submitted = 0, acknowledged = 0;
  const store = { on() {}, off() {}, registeredBinding: async () => ({ worktreeId: 'worktree', generation: 1 }), handle: async (_principal, message) => {
    if (message.type === 'sync.heartbeat') return { data: { sessions: [{ ...session, latestSeq: 1, ackedSeq: 0 }] } };
    if (message.type === 'sync.read') return { data: { messages: [{ seq: 1, message: interruption }], nextSeq: 1 } };
    if (message.type === 'sync.ack') { acknowledged++; return { data: {} }; }
    throw new Error(`unexpected ${message.type}`);
  } };
  const service = { state: async () => ({ status: 'idle' }), submit: async request => { submitted++; assert.match(request.text, /自动提交恢复控制/); } };
  const inbox = new CoordinatorInbox({ store, principal: {}, sessionIds: [session.id], service, intervalMs: 60000,
    autoResume: async input => { resumed++; assert.deepEqual(input.session, session); assert.equal(input.taskId, 'task-1'); return { ok: true }; } });
  await inbox.pump(); await inbox.close();
  assert.equal(resumed, 1); assert.equal(submitted, 1); assert.equal(acknowledged, 1);
});

test('Coordinator inbox resumes durable interrupted tasks after a Cloud restart', async () => {
  const session = { id: 'session-restarted', generation: 2 };
  const task = { id: 'task-restarted', stage: 'interrupted', busy: true, version: 'v9',
    interrupted: { reason: 'process exited', occurredAt: '2026-09-10T00:00:00Z' } };
  const resumed = [];
  const store = { on() {}, off() {}, registeredBinding: async () => ({ worktreeId: 'worktree', generation: session.generation }),
    workflowTasks: async (_principal, current) => { assert.deepEqual(current, session); return [task]; },
    handle: async (_principal, message) => {
      if (message.type === 'sync.heartbeat') return { data: { sessions: [{ ...session, latestSeq: 0, ackedSeq: 0 }] } };
      throw new Error(`unexpected ${message.type}`);
    } };
  const service = { state: async () => ({ status: 'idle' }) };
  const inbox = new CoordinatorInbox({ store, principal: {}, sessionIds: [session.id], service, intake: { consume: async () => true }, intervalMs: 60000,
    autoResume: async input => { resumed.push(input); } });
  await inbox.pump(); await inbox.close();
  assert.deepEqual(resumed, [{ session, taskId: task.id,
    messageId: 'auto-resume:3ffd748bbe5a661f78dd767b01d3b1580688aa3bdc522407ebcac142604520b1', reason: 'process exited', occurredAt: '2026-09-10T00:00:00Z' }]);
});

test('Coordinator discovers only server-assigned Sessions and can read the Main root without guessing IDs', async () => {
  const sessions = [{ id: 'assigned-session', generation: 3, worktreeId: 'assigned-worktree' }];
  const execute = createCoordinatorExecutor({
    listSessions: async () => ({ sessions }),
    readMap: async nodeId => { assert.equal(nodeId, undefined); return { node: { id: 'root' }, version: 'v1' }; },
  });
  assert.deepEqual(await execute('list_sessions', {}, { operationId: 'list' }), { sessions });
  assert.equal((await execute('read_map', {}, { operationId: 'root' })).node.id, 'root');
  await assert.rejects(execute('list_sessions', { repositoryId: 'other' }, { operationId: 'other' }), { code: 'INVALID_ARGUMENT' });
});

test('Cloud requirement confirmation uses browser authority, exact prepared version and durable replay', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-coordinator-http-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const providerFile = path.join(directory, 'provider.json');
  await fs.writeFile(providerFile, JSON.stringify(config));
  const repositoryId = '123', projectId = 'context-guard';
  const store = new ProtocolStore(path.join(directory, 'interface-v2', createHash('sha256').update(repositoryId).digest('hex')));
  const device = { repositoryId, deviceId: 'local', agentId: 'device', role: 'device' };
  const coordinator = { repositoryId, deviceId: 'cloud-coordinator', agentId: 'coordinator:context-guard', role: 'coordinator', bindings: { session: 'worktree' } };
  const session = { id: 'session', generation: 1 };
  await store.handle(device, { v: 2, id: 'bind', type: 'session.bind', payload: { sessionId: session.id, worktreeId: 'worktree', agentId: 'executor', expectedBindingVersion: '' } }, { verifyBinding: () => true });
  const brief = (await store.handle(coordinator, { v: 2, id: 'brief', type: 'brief.submit', session, payload: { taskId: 'task', text: 'Simulated requirement' } })).data;
  await store.handle(coordinator, { v: 2, id: 'request', type: 'review.request', session, payload: { taskId: 'task', kind: 'brief', ref: brief.ref, version: brief.version } });
  const conversation = path.join(directory, 'coordinators', projectId);
  await fs.mkdir(conversation, { recursive: true });
  await fs.writeFile(path.join(conversation, 'conversation.json'), JSON.stringify({ messages: [], status: 'idle', toolReceipts: {
    proposal: { result: { sessionId: session.id, taskId: 'task', brief, requiresHumanApproval: true } },
  } }));
  const server = await startCloudServer({ dataDir: directory, port: 0, browserToken: 'test-browser',
    coordinatorModelFactory: () => ({ next: async () => ({ stop: 'end_turn', content: [{ type: 'text', text: 'Workflow event received' }] }) }),
    protocolConfig: { repositories: [{ repositoryId, projectId, slug: 'example/lab' }] },
    memoryConfig: { dataDir: path.join(directory, 'memory'), adminToken: 'synthetic-admin', projects: {
      [projectId]: { root: directory, ref: 'refs/heads/main', token: 'synthetic-memory', coordinator: { enabled: true, providerFile, bindings: { session: 'worktree' }, simulated: true } },
    } },
  });
  t.after(() => server.close());
  const endpoint = `${server.url}/api/workbench/projects/${projectId}/api/coordinator`;
  const headers = { Authorization: 'Bearer test-browser', 'Content-Type': 'application/json' };
  const input = { id: 'approve-proposal', proposalId: 'proposal', decision: 'approved', reason: 'verified' };
  const send = (body, auth = headers) => fetch(endpoint + '/approval', { method: 'POST', headers: auth, body: JSON.stringify(body) });
  assert.equal((await send(input, { 'Content-Type': 'application/json' })).status, 401);
  assert.notEqual((await send({ ...input, role: 'human' })).status, 200);
  const before = await (await fetch(endpoint, { headers })).json();
  assert.equal(before.approvals[0].pending, true);
  const response = await send(input); assert.equal(response.status, 200);
  const result = await response.json(); assert.ok(result.receiptId);
  assert.deepEqual(await (await send(input)).json(), result);
  assert.notEqual((await send({ ...input, id: 'reject-later', decision: 'rejected' })).status, 200);
  const after = await (await fetch(endpoint, { headers })).json();
  assert.equal(after.approvals[0].pending, false);
  assert.equal((await store.taskRecord(coordinator, session, 'task')).stage, 'approved');
  let sequence = 0;
  const protocol = async (actor, type, payload, options) => (await store.handle(actor, { v: 2, id: `acceptance-fixture-${++sequence}`, type, session, payload }, options)).data;
  const sourceSha = 'a'.repeat(40);
  await protocol(coordinator, 'task.assign', { taskId: 'task', sessionId: session.id, briefRef: brief.ref, briefVersion: brief.version, nodeIds: ['T0'], mainVersion: 'main', mode: 'reviewed' }, { workflow: { verifyRouting: () => true } });
  const plan = await protocol(device, 'object.put', { kind: 'plan', ref: 'plan', baseVersion: '', content: { paths: ['frontend/'], steps: ['test'] } });
  await protocol(device, 'task.report', { taskId: 'task', stage: 'planReady', data: { planRef: plan.ref, planVersion: plan.version, sourceSha } });
  await protocol(coordinator, 'review.request', { kind: 'plan', taskId: 'task', ref: plan.ref, version: plan.version, requirementsRef: brief.ref, requirementsVersion: brief.version, rulesVersion: 'rules' });
  await protocol(coordinator, 'review.result', { kind: 'plan', ref: plan.ref, version: plan.version, decision: 'approved', reason: 'Reviewed exact Plan' });
  await protocol(device, 'object.put', { kind: 'ciTodo', ref: 'ci-todo', baseVersion: '', content: { items: [{ id: 'check', title: 'Test' }] } });
  await protocol(device, 'object.put', { kind: 'evidence', ref: 'test-evidence', baseVersion: '', content: { exitCode: 0 } });
  await protocol(device, 'task.report', { taskId: 'task', stage: 'handoff', data: { sourceSha, ciTodoRef: 'ci-todo', unitTestRefs: ['test-evidence'], experienceRefs: [] } });
  await protocol(coordinator, 'ci.request', { taskId: 'task', sourceSha, ciTodoRef: 'ci-todo', unitTestRefs: ['test-evidence'] });
  await protocol({ ...coordinator, role: 'ci', agentId: 'ci' }, 'ci.result', { taskId: 'task', sourceSha, verdict: 'passed', checks: [{ testId: 'test', todoId: 'check', status: 'passed', evidenceRef: 'test-evidence' }] });
  const pending = (await (await fetch(endpoint, { headers })).json()).acceptances[0];
  assert.equal(pending.sourceSha, sourceSha);
  const review = { id: 'human-reject', sessionId: session.id, taskId: 'task', ref: pending.ci.ref, version: pending.ci.version, decision: 'rejected', reason: 'The requested interaction is still wrong' };
  const accept = body => fetch(endpoint + '/acceptance', { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await accept({ ...review, version: 'stale' })).status, 409);
  const rejection = await accept(review); assert.equal(rejection.status, 200);
  assert.deepEqual(await (await accept(review)).json(), await rejection.json());
  const rejected = await store.taskRecord(coordinator, session, 'task');
  assert.equal(rejected.stage, 'acceptance-rejected');
  assert.match(rejected.acceptanceReview.reason, /模拟人工验收/);
  await assert.rejects(protocol(coordinator, 'task.rework', { taskId: 'task', sourceSha, ciResultRef: rejected.ci.ref, failedTestIds: [], reason: 'invented feedback' }), { code: 'CONFLICT' });
  await protocol(coordinator, 'task.rework', { taskId: 'task', sourceSha, ciResultRef: rejected.ci.ref, failedTestIds: [], reason: rejected.acceptanceReview.reason });
  assert.equal((await store.taskRecord(coordinator, session, 'task')).stage, 'rework');
});

test('Coordinator consumes existing workflow notifications and lost acknowledgements do not repeat model turns', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-coordinator-inbox-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProtocolStore(path.join(directory, 'protocol'));
  const principal = { repositoryId: 'repo', deviceId: 'cloud', agentId: 'coordinator', role: 'coordinator', bindings: { s: 'wt' } };
  const executor = { repositoryId: 'repo', deviceId: 'device', agentId: 'executor', role: 'executor' };
  const human = { ...executor, role: 'human', agentId: 'human' }, session = { id: 's', generation: 1 };
  await store.handle(executor, { v: 2, id: 'bind', type: 'session.bind', payload: { sessionId: 's', worktreeId: 'wt', agentId: 'executor', expectedBindingVersion: '' } }, { verifyBinding: () => true });
  const send = async (actor, id, type, payload) => (await store.handle(actor, { v: 2, id, type, session, payload })).data;
  const brief = await send(principal, 'brief', 'brief.submit', { taskId: 'task', text: 'Explicit requirement' });
  await send(principal, 'review', 'review.request', { taskId: 'task', kind: 'brief', ref: brief.ref, version: brief.version });
  await send(human, 'decision', 'review.result', { kind: 'brief', ref: brief.ref, version: brief.version, decision: 'approved', reason: 'Explicit simulated human approval' });
  let turns = 0;
  const options = { directory: path.join(directory, 'conversation'), system: 'Coordinator', tools: [], execute: async () => {}, simulated: true,
    model: { next: async () => { turns++; return { stop: 'end_turn', content: [{ type: 'text', text: 'received' }] }; } } };
  let service = new CoordinatorService(options);
  const original = store.handle.bind(store); let loseAck = true;
  store.handle = async (actor, message, ...args) => {
    if (message.type === 'sync.ack' && message.payload.items[0].seq === 3 && loseAck) { loseAck = false; throw new Error('lost acknowledgement before persistence'); }
    return original(actor, message, ...args);
  };
  let inbox = new CoordinatorInbox({ store, principal, sessionIds: ['s'], service, intervalMs: 60000 });
  await inbox.pump(); await service.close(); await inbox.close();
  assert.equal(turns, 1);
  assert.match((await service.state()).messages[0].text, /服务器工作流事件/);
  assert.doesNotMatch((await service.state()).messages[0].text, /模拟人工输入/);
  service = new CoordinatorService(options);
  inbox = new CoordinatorInbox({ store, principal, sessionIds: ['s'], service, intervalMs: 60000 });
  await inbox.pump(); await service.close(); await inbox.pump(); await inbox.close();
  assert.equal(turns, 1);
  const head = await original(principal, { v: 2, id: 'head', type: 'sync.heartbeat', payload: { sessions: [{ ...session, ackedSeq: 0 }] } });
  assert.equal(head.data.sessions[0].ackedSeq, 3);
});

test('One inbox routes independent conversations past a paused task and restores the skipped event', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-routed-inbox-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProtocolStore(path.join(directory, 'protocol'));
  const principal = { repositoryId: 'repo', deviceId: 'cloud', agentId: 'coordinator', role: 'coordinator', bindings: { s: 'wt' } };
  const executor = { repositoryId: 'repo', deviceId: 'device', agentId: 'executor', role: 'executor' };
  const session = { id: 's', generation: 1 };
  await store.handle(executor, { v: 2, id: 'bind', type: 'session.bind', payload: { sessionId: 's', worktreeId: 'wt', agentId: 'executor', expectedBindingVersion: '' } }, { verifyBinding: () => true });
  const routes = new Map();
  let paused = true;
  const received = { a: [], b: [] };
  const services = Object.fromEntries(['a', 'b'].map(key => [key, {
    state: async () => ({ status: key === 'a' && paused ? 'error' : 'idle' }),
    submit: async request => { if (!received[key].some(item => item.id === request.id)) received[key].push(request); },
  }]));
  for (const id of ['a', 'b']) {
    const send = async (actor, type, payload) => (await store.handle(actor, { v: 2, id: id + type, type, session, payload })).data;
    const brief = await send(principal, 'brief.submit', { taskId: id, text: id });
    routes.set(brief.ref, services[id]);
    await send(principal, 'review.request', { taskId: id, kind: 'brief', ref: brief.ref, version: brief.version });
    await send({ ...executor, role: 'human' }, 'review.result', { kind: 'brief', ref: brief.ref, version: brief.version, decision: 'approved', reason: 'Confirmed' });
  }
  const options = { store, principal, sessionIds: ['s'], service: services.a, routeEvent: async (_, payload) => routes.get(payload.ref), intervalMs: 60000 };
  const handle = store.handle.bind(store);
  store.handle = (actor, message, ...args) => handle(actor, message.type === 'sync.read' ? { ...message, payload: { ...message.payload, limit: 2 } } : message, ...args);
  let inbox = new CoordinatorInbox(options);
  await inbox.pump(); await inbox.close();
  assert.equal(received.a.length, 0); assert.equal(received.b.length, 1);
  paused = false;
  inbox = new CoordinatorInbox(options);
  await inbox.pump(); await inbox.close();
  assert.equal(received.a.length, 1); assert.equal(received.b.length, 1);
  assert.doesNotMatch(received.a[0].text, /"taskId":"b"/);
});

test('CI delegation requires server registration, the owning device and an independent worktree', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-ci-delegation-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProtocolStore(directory), principal = { repositoryId: 'repo', deviceId: 'device', agentId: 'device', role: 'device' };
  for (const [sessionId, worktreeId] of [['developer', 'dev-worktree'], ['ci', 'ci-worktree']]) {
    await store.handle(principal, { v: 2, id: sessionId, type: 'session.bind', payload: { sessionId, worktreeId, agentId: sessionId, expectedBindingVersion: '' } }, { verifyBinding: () => true });
  }
  const receivers = { ci: { executorSessionId: 'developer', worktreeId: 'ci-worktree' } };
  const message = { v: 2, id: 'evidence', type: 'object.put', session: { id: 'developer', generation: 1 }, payload: { kind: 'evidence', ref: 'ci:ci:run', baseVersion: '', content: { exitCode: 0 } } };
  const options = { principal, ciSessionId: 'ci', message, receivers, store };
  const delegated = await authorizeCiReceiver(options);
  assert.equal(delegated.role, 'ci'); assert.deepEqual(delegated.bindings, { developer: 'dev-worktree' });
  assert.ok((await store.handle(delegated, message)).data.version);
  for (const changes of [
    { ciSessionId: 'unknown' }, { principal: { ...principal, deviceId: 'other' } },
    { principal: { ...principal, role: 'executor' } },
    { message: { ...message, session: { id: 'unassigned', generation: 1 } } },
    { message: { ...message, payload: { ...message.payload, kind: 'plan' } } },
    { message: { ...message, payload: { ...message.payload, ref: 'developer-evidence' } } },
    { receivers: { ci: { ...receivers.ci, worktreeId: 'dev-worktree' } } },
  ]) await assert.rejects(authorizeCiReceiver({ ...options, ...changes }), { code: 'FORBIDDEN' });
  const creation = await store.requestSessionCreation({ ...principal, role: 'human' }, { operationId: 'new-developer', templateSessionId: 'developer', name: 'New developer' });
  await store.handle(principal, { v: 2, id: 'created-bind', type: 'session.bind', payload: { sessionId: creation.sessionId, worktreeId: 'created-worktree', agentId: creation.sessionId, expectedBindingVersion: '' } }, { verifyBinding: () => true });
  const createdMessage = { ...message, id: 'created-evidence', session: { id: creation.sessionId, generation: 1 } };
  await assert.rejects(authorizeCiReceiver({ ...options, message: createdMessage }), { code: 'FORBIDDEN' });
  const createdPrincipal = await authorizeCiReceiver({ ...options, message: createdMessage, templates: ['developer'] });
  assert.deepEqual(createdPrincipal.bindings, { [creation.sessionId]: 'created-worktree' });
  assert.ok((await store.handle(createdPrincipal, createdMessage)).data.version);
  await assert.rejects(authorizeCiReceiver({ ...options, message: createdMessage, templates: ['developer'], principal: { ...principal, deviceId: 'other' } }), { code: 'FORBIDDEN' });
});
