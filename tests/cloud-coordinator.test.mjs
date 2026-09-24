import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CoordinatorModel, coordinatorInputTokens, coordinatorModelMessages, coordinatorStep } from '../scripts/cloud/coordinator-model.mjs';
import { buildCoordinatorContext } from '../scripts/cloud/coordinator-context.mjs';
import { CoordinatorService, CoordinatorInbox, CoordinatorMapIntake, CoordinatorConversations, coordinatorCanAutoResume,
  coordinatorCompactBoundary, COORDINATOR_COMPACT_AT_TOKENS } from '../scripts/cloud/coordinator-service.mjs';
import { createCoordinatorExecutor, coordinatorReferences, coordinatorTools } from '../scripts/cloud/coordinator-tools.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startCloudServer, createWorkbenchPasswordHash, authorizeCiReceiver, coordinatorStructureOperations, coordinatorTaskOwnerRequired } from '../scripts/cloud/server.mjs';
import { ProtocolStore } from '../scripts/shared/protocol-store.mjs';
import { verifyTaskCompletion, verifyTaskClose } from '../scripts/cloud/completion.mjs';
import { readMemoryView } from '../scripts/cloud/memory.mjs';

test('Project requirements survive restart, reserve capacity atomically and dispatch only the approved fresh Session', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-project-task-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let store = new ProtocolStore(directory);
  const human = { repositoryId: 'repo', deviceId: 'browser', agentId: 'human', role: 'human' };
  const coordinator = { ...human, role: 'coordinator', agentId: 'scheduler', bindings: {} };
  const input = { taskId: 'TD1', text: 'Publish blog', acceptance: 'URL works', nodeIds: ['N1'], mainVersion: 'main-1' };
  const first = await store.prepareProjectTask(coordinator, input, 'prepare-1', 'chat-1');
  assert.deepEqual(await store.prepareProjectTask(coordinator, input, 'prepare-1', 'chat-1'), first);
  await assert.rejects(store.prepareProjectTask(coordinator, { ...input, text: 'different' }, 'prepare-2', 'chat-1'), { code: 'CONFLICT' });
  const review = { id: 'human-review', decision: 'approved', reason: 'Confirmed' };
  await store.reviewProjectTask(human, input.taskId, first.brief, review);
  await store.reviewProjectTask(human, input.taskId, first.brief, review);
  const second = await store.prepareProjectTask(coordinator, { ...input, taskId: 'TD2' }, 'prepare-2', 'chat-2');
  await store.reviewProjectTask(human, 'TD2', second.brief, { ...review, id: 'human-review-2' });
  await Promise.all(['TD1', 'TD2'].map(taskId => store.updateProjectTask(coordinator, taskId, { stage: 'creating' }, { reserveLimit: 1 })));
  store = new ProtocolStore(directory);
  const records = await store.projectTasks(human);
  assert.equal(records.filter(task => task.stage === 'creating').length, 1);
  assert.equal(records.filter(task => task.stage === 'queued').length, 1);
  const selected = records.find(task => task.stage === 'creating');
  const queued = records.find(task => task.stage === 'queued');
  await store.updateProjectTask(coordinator, selected.taskId, { stage: 'starting', sessionId: 'fresh' });
  // Use the same canonical key as the production store.
  const { canonical } = await import('../scripts/shared/protocol.mjs');
  const key = createHash('sha256').update(canonical(['repo', 'fresh'])).digest('hex');
  await store.transaction(state => { state.bindings[key] = { sessionId: 'fresh', generation: 1, worktreeId: 'fresh-tree', deviceId: 'local', agentId: 'executor' }; });
  coordinator.bindings.fresh = 'fresh-tree';
  const selectedInput = { ...input, taskId: selected.taskId };
  const request = { operationId: 'dispatch-1', projectTaskId: selected.taskId, session: { id: 'fresh', generation: 1 } };
  const resolve = async () => ({ ...selectedInput, text: JSON.stringify({ v: 1, ...selectedInput }) });
  await assert.rejects(store.submitApprovedTask(coordinator, { ...request, projectTaskId: queued.taskId }, resolve, { verifyRouting: async () => true }), { code: 'FORBIDDEN' });
  await assert.rejects(store.submitApprovedTask(coordinator, request, async () => ({ ...await resolve(), nodeIds: ['other'] }), { verifyRouting: async () => true }), { code: 'CONFLICT' });
  const dispatched = await store.submitApprovedTask(coordinator, request, resolve, { verifyRouting: async () => true });
  assert.equal(dispatched.sessionId, 'fresh');
  assert.deepEqual(await store.submitApprovedTask(coordinator, request, resolve, { verifyRouting: async () => true }), dispatched);
  assert.equal((await store.workflowTasks(human, request.session)).length, 1);
  const create = { operationId: 'create-fresh', templateSessionId: 'fresh', name: 'New task' };
  await assert.rejects(store.requestSessionCreation(coordinator, create), { code: 'FORBIDDEN' });
  coordinator.creationTemplates = ['fresh'];
  const creation = await store.requestSessionCreation(coordinator, create);
  assert.deepEqual(await new ProtocolStore(directory).requestSessionCreation(coordinator, create), creation);
  assert.notEqual(creation.sessionId, 'fresh');
});

test('Human task status projects the execution stage onto a Main item without rewriting Main', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-project-task-status-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProtocolStore(directory);
  const human = { repositoryId: 'repo', deviceId: 'browser', agentId: 'human', role: 'human' };
  const coordinator = { ...human, agentId: 'coordinator', role: 'coordinator' };
  const item = { taskId: 'map-todo-1', itemId: 'TD1', nodeId: 'N1', kind: 'todo', text: 'Add regression coverage',
    acceptance: 'Tests pass', nodeIds: ['N1'], mainVersion: 'main-1' };
  await store.prepareProjectTask(coordinator, item, 'prepare-status', 'conversation-1');
  assert.deepEqual((await store.projectTaskStatuses(human)).map(({ itemId, nodeId, state }) => [itemId, nodeId, state]), [['TD1', 'N1', 'brief']]);
  await store.transaction(state => {
    const projectTask = Object.values(state.projectTasks)[0];
    projectTask.stage = 'dispatched'; projectTask.sessionId = 'fresh-session';
    state.tasks.execution = { id: item.taskId, repositoryId: 'repo', session: { id: 'fresh-session', generation: 1 }, stage: 'accepted' };
  });
  const [status] = await store.projectTaskStatuses(human);
  assert.deepEqual({ taskId: status.taskId, itemId: status.itemId, nodeId: status.nodeId, sessionId: status.sessionId,
    state: status.state, projectStage: status.projectStage },
  { taskId: item.taskId, itemId: item.itemId, nodeId: item.nodeId, sessionId: 'fresh-session', state: 'accepted', projectStage: 'dispatched' });
  assert.equal((await store.projectTasks(human))[0].stage, 'dispatched', 'status projection does not mutate task or Main data');
  await assert.rejects(store.projectTaskStatuses({ ...human, role: 'executor' }), { code: 'FORBIDDEN' });
});

test('Cloud project approval dispatches once as soon as the fresh Session is registered', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-fresh-http-'));
  let server;
  t.after(async () => { await server?.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const providerFile = path.join(directory, 'provider.json');
  await fs.writeFile(providerFile, JSON.stringify({ baseUrl: 'https://provider.example', model: 'test', token: 'synthetic' }));
  const memoryConfig = { dataDir: path.join(directory, 'memory'), adminToken: 'synthetic', projects: {
    'context-guard': { root: directory, token: 'synthetic', ref: 'refs/heads/main', coordinator: {
      enabled: true, providerFile, bindings: { template: 'template-tree' }, sessionTemplates: ['template'], maxConcurrentTasks: 1,
    } },
  } };
  const memoryFile = path.join(memoryConfig.dataDir, createHash('sha256').update('context-guard').digest('hex'), 'memory.json');
  await fs.mkdir(path.dirname(memoryFile), { recursive: true });
  await fs.writeFile(memoryFile, JSON.stringify({ revision: 1, main: { version: 'main-1', memory: { records: {}, map: {
    v: 1, bootstrap: 'ready', root: { id: 'T0', title: 'Blog', kind: 'module', state: 'dirty', owns: [], children: [] },
  } } }, sessions: {}, receipts: {}, history: [], events: [], eventCursors: {}, closedSessions: {} }));
  let modelCalls = 0;
  server = await startCloudServer({ dataDir: directory, port: 0, memoryConfig, browserToken: 'synthetic-browser',
    browserPasswordHash: await createWorkbenchPasswordHash('synthetic-password'),
    protocolConfig: { repositories: [{ repositoryId: '123', projectId: 'context-guard', slug: 'example/repo' }] },
    coordinatorModelFactory: () => ({ next: async () => ++modelCalls === 1 ? { stop: 'tool_use', content: [{ type: 'tool_use', id: 'prepare', name: 'prepare_task',
      input: { taskId: 'TD-fresh', text: 'Publish blog', acceptance: 'URL works', nodeIds: ['T0'], mainVersion: 'main-1' } }] }
      : { stop: 'end_turn', content: [{ type: 'text', text: '已准备需求。' }] } }),
  });
  const headers = { Authorization: 'Bearer synthetic-browser', 'Content-Type': 'application/json' };
  const endpoint = `${server.url}/api/workbench/projects/context-guard/api/coordinator`;
  const post = async (url, value, authorization = headers) => {
    const response = await fetch(url, { method: 'POST', headers: authorization, body: JSON.stringify(value) });
    const result = await response.json(); assert.equal(response.status < 300, true, JSON.stringify(result)); return result;
  };
  const login = await fetch(`${server.url}/api/v2/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', clientId: 'device', password: 'synthetic-password' },
  }) });
  assert.equal(login.status, 200);
  const deviceHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.headers.get('x-context-guard-credential')}` };
  const message = value => post(`${server.url}/api/v2/messages`, { v: 2, ...value }, deviceHeaders);
  await message({ id: 'bind-template', type: 'session.bind', payload: { sessionId: 'template', worktreeId: 'template-tree', agentId: 'template-agent', expectedBindingVersion: '' } });
  await message({ id: 'heartbeat-template', type: 'sync.heartbeat', payload: { sessions: [{ id: 'template', generation: 1, ackedSeq: 0, execution: { status: 'stopped', at: new Date().toISOString() } }] } });
  await post(endpoint, { id: 'request', text: 'Publish blog' });
  const poll = async predicate => {
    for (let i = 0; i < 160; i++) { const state = await (await fetch(endpoint, { headers })).json(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.fail('Coordinator state did not advance');
  };
  const ready = await poll(state => state.approvals?.some(item => item.projectTask));
  const proposal = ready.approvals.find(item => item.projectTask);
  assert.equal(proposal.sessionId, undefined);
  const approve = { id: 'approve', proposalId: proposal.id, decision: 'approved', reason: 'Confirmed' };
  await post(endpoint + '/approval', approve);
  const creating = await poll(state => state.sessionCreations?.length === 1);
  const creation = creating.sessionCreations[0];
  assert.notEqual(creation.sessionId, 'template');
  await message({ id: 'bind-fresh', type: 'session.bind', payload: { sessionId: creation.sessionId, worktreeId: 'fresh-tree', agentId: creation.sessionId, expectedBindingVersion: '' } });
  const advancedMain = JSON.parse(await fs.readFile(memoryFile, 'utf8'));
  advancedMain.main.version = 'main-2';
  await fs.writeFile(memoryFile, JSON.stringify(advancedMain));
  const dispatched = await poll(state => state.projectTasks?.some(task => task.stage === 'dispatched'));
  assert.equal(dispatched.projectTasks[0].sessionId, creation.sessionId);
  assert.equal(dispatched.projectTasks[0].mainVersion, 'main-2');
  await post(endpoint + '/approval', approve);
  const queue = await message({ id: 'read-queue', type: 'sync.read', session: { id: creation.sessionId, generation: 1 }, payload: { afterSeq: 0, limit: 100 } });
  assert.equal(queue.data.messages.filter(item => item.message.type === 'task.assign').length, 1);
});

test('Coordinator routing prompt assigns node discovery to the agent while preserving human approval', async () => {
  const prompt = await fs.readFile(new URL('../Coordinator.md', import.meta.url), 'utf8');
  const mount = await fs.readFile(new URL('../references/map-mount.md', import.meta.url), 'utf8');
  const read = await fs.readFile(new URL('../references/map-read.md', import.meta.url), 'utf8');
  assert.match(prompt, /节点定位由你负责/);
  assert.match(prompt, /意图必须保真/);
  assert.match(prompt, /回复语言要足够精简/);
  assert.match(prompt, /默认目标为 3 句、约 120 个汉字/);
  assert.match(prompt, /服务端不得按字符裁切/);
  assert.match(prompt, /默认 1 个、最多 3 个/);
  assert.match(prompt, /不要复述用户原话、重复已知上下文/);
  assert.match(prompt, /部署、发布、启动服务/);
  assert.match(prompt, /不得用源码路径或 CI 通过替代部署结果/);
  assert.match(prompt, /每个问题都必须调用一次 `ask_user`/);
  assert.match(prompt, /完整节点标题/);
  assert.match(prompt, /`conversationId` 与 `executionSessionId` 是两类身份/);
  assert.match(prompt, /必须逐字复制自本轮 `list_sessions` 返回值/);
  assert.match(prompt, /用户问“你能否创建 Session”或同义问题时，明确回答“可以”/);
  assert.match(prompt, /人批准 brief 后后台为任务自动创建执行 Session/);
  assert.match(prompt, /不要求用户提供节点名称、ID 或路径/);
  assert.match(prompt, /推荐不等于批准或派单/);
  assert.match(mount, /只问缺失的业务信息/);
  assert.match(mount, /没有匹配节点时说明已查范围并提出新节点建议/);
  assert.match(mount, /不要求用户找出正确节点/);
  assert.match(read, /不自动等于最终执行节点/);
  assert.doesNotMatch(prompt + mount, /没有对应节点就问用户|问清正确节点后改挂/);
});

test('Mount handoff ends the source turn and stale requirements expose a static correction hint', async () => {
  const mount = { type: 'tool_use', id: 'mount', name: 'mount_conversation', input: {} };
  let later = 0;
  const mounted = await coordinatorStep({ turnId: 'mount-turn', state: { messages: [], toolReceipts: {} },
    model: { next: async () => ({ stop: 'tool_use', content: [mount, { type: 'tool_use', id: 'later', name: 'prepare_task', input: {} }] }) },
    system: 'test', tools: coordinatorTools, save: async () => {}, execute: async name => {
      if(name === 'mount_conversation') return { kind: 'conversation-mounted', conversationId: 'item-test' };
      later++; return {};
    } });
  assert.equal(mounted.status, 'waiting-for-user'); assert.equal(later, 0);
  const execute = createCoordinatorExecutor({ readMap: async () => ({ version: 'new-main' }) });
  const result = await coordinatorStep({ turnId: 'stale-turn', state: { messages: [], toolReceipts: {} },
    model: { next: async () => ({ stop: 'tool_use', content: [{ type: 'tool_use', id: 'prepare', name: 'prepare_task',
      input: { taskId: 'TD-test', text: 'task', acceptance: 'works', nodeIds: ['N1'], mainVersion: 'old-main' } }] }) },
    system: 'test', tools: coordinatorTools, save: async () => {}, execute });
  assert.match(result.messages.at(-1).content[0].content, /Main changed/);
});

test('Coordinator public replies preserve complete direct, tool, question and streaming content', async t => {
  const long = '这是结论。'.repeat(40);

  for (const scenario of [
    { name: 'direct', first: { stop: 'end_turn', content: [{ type: 'text', text: long }] } },
    { name: 'after-tool', first: { stop: 'tool_use', content: [{ type: 'tool_use', id: 'read', name: 'read_map', input: {} }] },
      second: { stop: 'end_turn', content: [{ type: 'text', text: long }] } },
  ]) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `cg-reply-${scenario.name}-`));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    let calls = 0;
    const service = new CoordinatorService({ directory, system: 'Coordinator', tools: [{ name: 'read_map' }], execute: async () => ({ ok: true }),
      model: { next: async () => ++calls === 1 ? scenario.first : scenario.second } });
    await service.submit({ id: scenario.name, text: '简短一点' }); await service.close();
    const state = await service.state(), answer = state.messages.findLast(message => message.role === 'assistant');
    assert.equal(answer.text, long, `${scenario.name} answer remains complete`);
    assert.equal(state.status, 'waiting-for-user');
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-reply-stream-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'conversation.json'), JSON.stringify({ messages: [{ role: 'user', content: '简短一点' }],
    activeInput: { text: '简短一点' }, streaming: { text: long }, status: 'running', requests: {}, toolReceipts: {} }));
  const streaming = await new CoordinatorService({ directory, system: 'Coordinator', tools: [], execute: async () => {}, model: {} }).state();
  assert.equal(streaming.streamingText, long);

  const questionDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-reply-question-'));
  t.after(() => fs.rm(questionDirectory, { recursive: true, force: true }));
  let questionCalls = 0;
  const question = new CoordinatorService({ directory: questionDirectory, system: 'Coordinator', tools: [{ name: 'ask_user' }],
    execute: async () => ({ question: long }), model: { next: async () => ++questionCalls === 1 ? { stop: 'tool_use', content: [
      { type: 'tool_use', id: 'question', name: 'ask_user', input: { question: long } },
    ] } : { stop: 'end_turn', content: [] } } });
  await question.submit({ id: 'question', text: '简短提问' }); await question.close();
  const questionState = await question.state();
  assert.equal(questionState.messages.at(-1).questions[0].text, long);
});

test('Live Coordinator provider completes direct and tool-call turns under the public reply contract', {
  skip: !process.env.CONTEXT_GUARD_COORDINATOR_PROVIDER_FILE,
}, async t => {
  const provider = JSON.parse(await fs.readFile(process.env.CONTEXT_GUARD_COORDINATOR_PROVIDER_FILE, 'utf8'));
  const model = new CoordinatorModel(provider);
  const tools = [{ name: 'probe', description: 'Return a fixed connectivity probe result.', input_schema: {
    type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false,
  } }];
  const system = '你是 Coordinator 调用测试器。默认只回复一句。用户要求调用 probe 时必须先调用该工具，收到结果后再简短回答。';

  const directDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-live-direct-'));
  t.after(() => fs.rm(directDirectory, { recursive: true, force: true }));
  const direct = new CoordinatorService({ directory: directDirectory, system, tools, execute: async () => ({ ok: true }), model });
  await direct.submit({ id: 'live-direct', text: '一句话回复：连接正常' }); await direct.close();
  let state = await direct.state();
  assert.equal(state.status, 'waiting-for-user');
  assert.ok(state.messages.findLast(message => message.role === 'assistant')?.text);

  const toolDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-live-tool-'));
  t.after(() => fs.rm(toolDirectory, { recursive: true, force: true }));
  let executions = 0;
  const tool = new CoordinatorService({ directory: toolDirectory, system, tools, model,
    execute: async (name, input) => { assert.equal(name, 'probe'); assert.equal(typeof input.value, 'string'); executions++; return { ok: true }; } });
  await tool.submit({ id: 'live-tool', text: '调用 probe 检查连接，然后一句话告诉我结果' }); await tool.close();
  state = await tool.state();
  assert.equal(state.status, 'waiting-for-user');
  assert.equal(executions, 1);
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

test('Main, Coordinator Session, execution Session and item conversations preserve independent identities across restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-conversations-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const registry = new CoordinatorConversations(directory);
  const chat = await registry.createChat('new-chat-request');
  assert.equal(await registry.createChat('new-chat-request'), chat, 'conversation creation is idempotent');
  assert.equal((await registry.get(chat)).scope, 'chat');
  const scoped = await registry.ensureSession('session-one', 'First Session');
  assert.equal(scoped, 'session:session-one');
  assert.equal((await registry.get(scoped)).sessionId, 'session-one');
  assert.notEqual(registry.conversationFile('main'), registry.conversationFile('legacy'));
  assert.notEqual(registry.conversationFile(chat), registry.conversationFile('main'));
  assert.notEqual(registry.conversationFile(scoped), registry.conversationFile('main'));
  const a = await registry.ensure({ nodeId: 'T0', kind: 'todo', item: { id: '1', title: 'First' } });
  const b = await registry.ensure({ nodeId: 'T0', kind: 'bug', item: { id: '1', title: 'Second' } });
  assert.notEqual(a, b);
  assert.equal(await registry.ensure({ nodeId: 'T0', kind: 'todo', item: { id: '1', title: 'Renamed' } }), a);
  await registry.bind(a, 'session', 'task');
  await assert.rejects(registry.bind(b, 'session', 'task'), { code: 'FORBIDDEN' });
  const restored = new CoordinatorConversations(directory);
  assert.equal(await restored.owner('session', 'task'), a);
  assert.equal(await restored.owner('other-session', 'task'), 'legacy');
  assert.deepEqual((await restored.list()).slice(0, 4).map(item => item.id), ['main', 'legacy', chat, scoped]);
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
    [projectId]: { root: directory, token: 'synthetic', ref: 'refs/heads/main', coordinator: {
      enabled: true, providerFile, bindings: { template: 'template-tree' }, sessionTemplates: ['template'],
    } },
  } };
  const memoryFile = path.join(memoryConfig.dataDir, createHash('sha256').update(projectId).digest('hex'), 'memory.json');
  await fs.mkdir(path.dirname(memoryFile), { recursive: true });
  await fs.writeFile(memoryFile, JSON.stringify({ revision: 1, main: { version: 'v1', memory: { map: { root: {
    id: 'T0', title: 'Lab', children: [], todos: [{ id: 'TD1', title: 'First' }], bugs: [{ id: 'B1', title: 'Second' }],
  } }, records: {} } }, sessions: {}, closedSessions: {}, receipts: {}, history: [], events: [], eventCursors: {} }));
  const options = { dataDir: directory, port: 0, browserToken: 'test-browser', memoryConfig,
    browserPasswordHash: await createWorkbenchPasswordHash('synthetic-password'),
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
  const login = await fetch(`${server.url}/api/v2/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/lab', clientId: 'device', password: 'synthetic-password' },
  }) });
  assert.equal(login.status, 200);
  const bound = await fetch(`${server.url}/api/v2/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.headers.get('x-context-guard-credential')}` }, body: JSON.stringify({
    v: 2, id: 'bind-template', type: 'session.bind', payload: { sessionId: 'template', worktreeId: 'template-tree', agentId: 'template-agent', expectedBindingVersion: '' },
  }) });
  assert.equal(bound.status, 200, await bound.clone().text());
  const a = (await call('/conversations', { nodeId: 'T0', kind: 'todo', itemId: 'TD1' })).id;
  const b = (await call('/conversations', { nodeId: 'T0', kind: 'bug', itemId: 'B1' })).id;
  const mounted = await readMemoryView(memoryConfig, projectId);
  assert.deepEqual(mounted.main.memory.map.root.todos[0].sessions || [], []);
  assert.deepEqual(mounted.main.memory.map.root.bugs[0].sessions || [], []);
  await call('?conversation=legacy', { id: 'legacy', text: 'Old project discussion' });
  await call('?conversation=' + a, { id: 'same-id', text: 'Only first item' });
  await call('?conversation=' + b, { id: 'same-id', text: 'Only second item' });
  await server.close(); server = await startCloudServer(options);
  const first = await call('?conversation=' + a), second = await call('?conversation=' + b);
  assert.match(JSON.stringify(first.messages), /Only first item/);
  assert.doesNotMatch(JSON.stringify(first.messages), /Only second item|Old project discussion/);
  assert.match(JSON.stringify(second.messages), /Only second item/);
  assert.doesNotMatch(JSON.stringify(second.messages), /Only first item|Old project discussion/);
  assert.doesNotMatch(JSON.stringify((await call('?conversation=main')).messages), /Old project discussion/);
  assert.match(JSON.stringify((await call('?conversation=legacy')).messages), /Old project discussion/);
  assert.equal(first.conversations.length, 4);
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
  assert.equal(state.messages.find(message => message.questions?.length)?.questionOnly,true,'tool-only questions retain their card title');
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
    return { stop: 'tool_use', content: [{ type: 'text', text: '我已整理好背景，请选择下一步。' }, { type: 'tool_use', id: 'choice', name: 'ask_user', input: { question: '要上传什么？', options: ['网站构建产物', '其他文件'] } }] };
  } } };
  const service = new CoordinatorService(options);
  await service.submit({ id: 'question', text: 'Upload' }); await service.close();
  assert.equal(calls, 1);
  const state = await service.state();
  assert.equal(state.status, 'waiting-for-user');
  assert.equal(state.approvals.length, 0);
  assert.deepEqual(state.messages.at(-1).questions[0].options, ['网站构建产物', '其他文件']);
  assert.equal(state.messages.at(-1).text, '我已整理好背景，请选择下一步。','successful question cards preserve streamed assistant text');
  assert.equal(state.activity, null,'completed question clears its transient status');
  assert.deepEqual((await new CoordinatorService(options).state()).messages, state.messages);
  const questionId = state.messages.at(-1).questions[0].id;
  await assert.rejects(service.submit({ id: 'unknown', text: 'Answer', answerTo: 'other-conversation-question' }), { code: 'NOT_FOUND' });
  await service.submit({ id: 'answer', text: '网站构建产物', answerTo: questionId }); await service.close();
  await service.submit({ id: 'answer', text: '网站构建产物', answerTo: questionId }); await service.close();
  assert.equal(calls, 2, 'a repeated answer request does not run the model twice');
  const restored = await new CoordinatorService(options).state();
  assert.deepEqual(restored.messages.flatMap(message => message.questions || []).find(question => question.id === questionId).answer, { text: '网站构建产物', requestId: 'answer' });
  const answeredAt = restored.messages.findIndex(message => message.answerTo === questionId);
  assert.ok(answeredAt > state.messages.length - 1, 'the answer follows its question in durable conversation order');
  assert.deepEqual({ text: restored.messages[answeredAt].text, requestId: restored.messages[answeredAt].requestId },
    { text: '网站构建产物', requestId: 'answer' }, 'the public answer is user-readable and matches its optimistic request');
  assert.equal(restored.approvals.length, 0);
  await assert.rejects(service.submit({ id: 'second-answer', text: 'Changed', answerTo: questionId }), { code: 'ALREADY_ANSWERED' });
});

test('ask_user activity appears while arguments are pending and clears when the card commits', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-question-activity-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let release, signal, finishTool, toolStarted;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { signal = resolve; });
  const toolGate = new Promise(resolve => { finishTool = resolve; });
  const executing = new Promise(resolve => { toolStarted = resolve; });
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: [{ name: 'ask_user' }],
    execute: async () => { toolStarted(); await toolGate; return {}; }, model: { next: async ({ onText, onToolStart }) => {
      await onText('我正在梳理候选项。');
      await onToolStart('ask_user'); signal();
      await gate;
      return { stop: 'tool_use', content: [{ type: 'text', text: '我正在梳理候选项。' },
        { type: 'tool_use', id: 'choice', name: 'ask_user', input: { question: '选择哪项？', options: ['第一项'] } }] };
    } } });
  await service.submit({ id: 'request', text: '请给我选项' });
  await started;
  assert.equal((await service.state()).activity, 'preparing-question');
  release(); await executing;
  const pending = await service.state();
  assert.equal(pending.messages.filter(message => message.role === 'assistant').length, 0,'pending tool block does not duplicate the live stream');
  assert.equal(pending.streamingText, '我正在梳理候选项。');
  finishTool(); await service.close();
  const state = await service.state();
  assert.equal(state.status, 'waiting-for-user');
  assert.equal(state.activity, null);
  assert.equal(state.messages.at(-1).text, '我正在梳理候选项。');
  assert.equal(state.messages.at(-1).questions[0].text, '选择哪项？');
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
  const verificationTask = { ...task, verificationOnly: true, ci: { ref: 'ci:verification', verdict: 'passed' } };
  const verification = await verifyTaskCompletion({ ...options, task: verificationTask,
    receipts: { gitReceiptRef: 'verification-only', archiveReceiptRef: 'ci:verification' } });
  assert.deepEqual(verification, { verificationOnly: true, sourceSha, ciRef: 'ci:verification' });
  assert.equal(verifyTaskClose(null, { ...verificationTask, control: { id: 'verification-control' },
    completion: { proof: verification, closeReceiptId: 'verification-control' } },
  { controlId: 'verification-control', closeReceiptId: 'verification-control' }), true);
});

test('Explicit temporary billing waiver accepts only GitHub jobs that never started', async () => {
  const sourceSha = 'a'.repeat(40), mergeSha = 'b'.repeat(40);
  const project = { repository: 'example/lab', ref: 'refs/heads/main', completion: {
    requiredChecks: [], checksWaiver: { reason: 'github-actions-billing', expiresAt: '2100-01-01T00:00:00Z' },
  } };
  const task = { stage: 'accepted', session: { id: 'developer' }, sourceSha,
    ci: { verdict: 'passed' }, acceptanceReview: { decision: 'approved' }, acceptanceAt: '2026-09-08T01:00:00Z' };
  const memory = { closedSessions: { developer: { publications: [{ sessionVersion: 'session-v2', sourceCommit: sourceSha,
    mainSha: mergeSha, mainVersion: 'main-v2', publishedAt: '2026-09-08T01:02:00Z' }] } } };
  const receipts = { gitReceiptRef: 'github-pr:7', archiveReceiptRef: 'session-v2' };
  const pr = { merged: true, merged_at: '2026-09-08T01:01:00Z', merge_commit_sha: mergeSha,
    base: { ref: 'main', repo: { id: 123 } }, head: { sha: sourceSha, repo: { id: 123 } } };
  const checks = { total_count: 1, check_runs: [{ id: 17, name: 'test', app: { id: 15368 }, head_sha: sourceSha,
    status: 'completed', conclusion: 'failure', completed_at: '2026-09-08T01:00:30Z' }] };
  let annotation = 'The job was not started because recent account payments have failed or your spending limit needs to be increased.';
  let contexts = { statuses: [] };
  const options = { project, repositoryId: '123', task, memory, receipts, fetch: async url => Response.json(
    url.includes('/pulls/') ? pr : url.includes('/annotations') ? [{ message: annotation }] :
      url.endsWith('/status') ? contexts : checks) };
  const proof = await verifyTaskCompletion(options);
  assert.equal(proof.mergeSha, mergeSha);
  assert.equal(proof.githubChecksWaiver.reason, 'github-actions-billing');
  contexts = { statuses: [{ state: 'failure' }] };
  assert.equal(await verifyTaskCompletion(options), false);
  contexts = { statuses: [] };
  annotation = 'A test assertion failed';
  assert.equal(await verifyTaskCompletion(options), false);
  assert.equal(await verifyTaskCompletion({ ...options, project: { ...project, completion: {
    ...project.completion, checksWaiver: { ...project.completion.checksWaiver, expiresAt: '2020-01-01T00:00:00Z' },
  } } }), false);
  assert.equal(await verifyTaskCompletion({ ...options, task: { ...task, ci: { verdict: 'failed' } } }), false);
});

const text = { model: 'test-model', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ready' }] };
const config = { baseUrl: 'https://provider.example/api/anthropic', model: 'test-model', token: 'synthetic-private-value' };
test('Coordinator context carries the full static directory and only the mounted ancestry memories', () => {
  const snapshot = { version: 'main-v2', memory: { map: { root: { id: 'T0', title: 'Root', purpose: 'Whole project', memories: [{ text: 'root memory' }], children: [
    { id: 'N1', title: 'Reader', purpose: 'Public reading', memories: [{ text: 'reader memory' }], children: [
      { id: 'N2', title: 'Article', purpose: 'Article page', memories: [{ text: 'article memory' }],
        todos: [{ id: 'TD1', title: 'Improve article', desc: 'Make the published article readable', status: 'pending' }], children: [] },
    ] },
    { id: 'N3', title: 'Admin', purpose: 'Private admin', memories: [{ text: 'private unrelated memory' }], children: [] },
  ] } } } };
  const conversation = { id: 'item-x', nodeId: 'N2', itemId: 'TD1', kind: 'todo', title: 'Improve article' };
  const context = buildCoordinatorContext(snapshot, { conversation });
  const payload = JSON.parse(context.text.slice(context.text.indexOf('{')));
  assert.equal(context.version, 'main-v2');
  assert.deepEqual(payload.staticDirectory.map(node => node.id), ['T0', 'N1', 'N2', 'N3']);
  assert.deepEqual(payload.mountedChain.map(node => node.id), ['T0', 'N1', 'N2']);
  assert.deepEqual(payload.currentTask, { nodeId: 'N2', itemId: 'TD1', kind: 'todo', title: 'Improve article',
    summary: 'Make the published article readable', status: 'pending' });
  assert.doesNotMatch(JSON.stringify(payload.mountedChain), /private unrelated memory/);
  snapshot.memory.map.root.children[0].children[0].todos[0].status = 'processing';
  const refreshed = buildCoordinatorContext(snapshot, { conversation });
  assert.equal(JSON.parse(refreshed.text.slice(refreshed.text.indexOf('{'))).currentTask.status, 'processing', 'a new turn reads the latest Main item');
  const missing = buildCoordinatorContext(snapshot, { conversation: { ...conversation, itemId: 'TD-missing' } });
  assert.equal(JSON.parse(missing.text.slice(missing.text.indexOf('{'))).currentTask.unavailable, true, 'a deleted item cannot inherit stale conversation text');
  const scoped = buildCoordinatorContext(snapshot, { nodeIds: ['N2'], conversation: { id: 'item-x', nodeId: 'N2' } });
  assert.deepEqual(JSON.parse(scoped.text.slice(scoped.text.indexOf('{'))).staticDirectory.map(node => node.id), ['T0', 'N1', 'N2']);
});

test('Coordinator streams text deltas while retaining one complete assistant message', async () => {
  const events = [
    { type: 'message_start', message: { model: config.model, usage: { input_tokens: 3 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '先说' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '结论' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ].map(value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`).join('');
  const deltas = [];
  const model = new CoordinatorModel({ ...config, fetch: async () => new Response(events, { headers: { 'Content-Type': 'text/event-stream' } }) });
  const result = await model.next({ system: 'role', messages: [], onText: text => deltas.push(text) });
  assert.deepEqual(deltas, ['先说', '先说结论']);
  assert.deepEqual(result.content, [{ type: 'text', text: '先说结论' }]);
  assert.equal(result.stop, 'end_turn');
});

test('Coordinator compacts at actual input-token usage without changing the saved conversation', async t => {
  assert.equal(COORDINATOR_COMPACT_AT_TOKENS, 500_000);
  assert.equal(coordinatorInputTokens({ input_tokens: 499_000, cache_read_input_tokens: 1_000 }), 500_000);
  assert.equal(coordinatorInputTokens({ prompt_tokens: 500_000 }), 500_000);
  assert.equal(coordinatorInputTokens({ input_tokens: '500000' }), null);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-compact-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sent = []; let summaries = 0;
  const model = { next: async ({ system, messages, tools, maxTokens }) => {
    if (system.includes('历史对话')) {
      summaries++;
      assert.deepEqual(tools, []);
      assert.equal(maxTokens, 4096);
      assert.match(messages[0].content, /第 1 轮/);
      return { stop: 'end_turn', content: [{ type: 'text', text: '第 1 轮已完成；后续以实时 Map 为准。' }] };
    }
    sent.push(messages);
    return { stop: 'end_turn', content: [{ type: 'text', text: `回复 ${sent.length}` }],
      usage: { input_tokens: sent.length === 5 ? 500_000 : 10 } };
  } };
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: [], execute: async () => {}, model });
  for (let number = 1; number <= 5; number++) {
    await service.submit({ id: `turn-${number}`, text: `第 ${number} 轮` });
    await service.close();
  }
  assert.equal(summaries, 1);
  let saved = JSON.parse(await fs.readFile(service.file, 'utf8'));
  assert.equal(saved.compaction.through, 2, 'four recent human turns remain verbatim');
  assert.equal(saved.compaction.triggerInputTokens, 500_000);
  assert.equal(saved.messages.length, 10, 'the original transcript remains intact');
  const publicState = await service.state();
  assert.equal(publicState.messages.length, 10, 'the user still sees the full conversation');
  assert.equal(publicState.compaction.compactedThrough, 2);
  assert.equal(publicState.compaction.thresholdTokens, 500_000);
  assert.ok(!JSON.stringify(publicState).includes('后续以实时 Map 为准'), 'summary internals stay server-side');
  await new CoordinatorConversations(directory).continueIn('legacy', 'main');
  const continued = JSON.parse(await fs.readFile(path.join(directory, 'main', 'conversation.json'), 'utf8'));
  assert.equal(continued.compaction.sourceHash, saved.compaction.sourceHash, 'a continued conversation keeps the validated checkpoint');
  assert.equal(coordinatorModelMessages(continued).length, 9);
  await service.submit({ id: 'turn-6', text: '第 6 轮' });
  await service.close();
  assert.match(sent.at(-1)[0].content, /历史对话摘要/);
  assert.deepEqual(sent.at(-1).slice(1), saved.messages.slice(2).map(({ role, content }) => ({ role, content })).concat({ role: 'user', content: '第 6 轮' }));
  saved = JSON.parse(await fs.readFile(service.file, 'utf8'));
  assert.equal(saved.messages.length, 12);
  assert.deepEqual(coordinatorModelMessages(saved), sent.at(-1).slice(0, -1).concat({ role: 'user', content: '第 6 轮' }, { role: 'assistant', content: [{ type: 'text', text: '回复 6' }] }));
});

test('Coordinator keeps tool pairs and raw history when compaction fails', async t => {
  const messages = [
    { role: 'user', content: '开始' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'read', name: 'read_map', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read', content: '{}' }] },
    { role: 'assistant', content: [{ type: 'text', text: '已读取' }] },
    { role: 'user', content: '继续' },
    { role: 'assistant', content: [{ type: 'text', text: '好的' }] },
  ];
  assert.equal(coordinatorCompactBoundary(messages), 4, 'tool result is never the compact boundary');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-compact-failure-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: [], execute: async () => {}, compactAtTokens: 100,
    model: { next: async ({ system }) => system.includes('历史对话')
      ? { stop: 'tool_use', content: [{ type: 'tool_use', id: 'bad', name: 'read_map', input: {} }] }
      : { stop: 'end_turn', content: [{ type: 'text', text: `回复 ${++calls}` }], usage: { input_tokens: 100 } } } });
  await service.submit({ id: 'first', text: '第一轮' }); await service.close();
  await service.submit({ id: 'second', text: '第二轮' }); await service.close();
  const saved = JSON.parse(await fs.readFile(service.file, 'utf8'));
  assert.equal(saved.status, 'waiting-for-user');
  assert.equal(saved.compaction, undefined);
  assert.equal(saved.compactionError.code, 'COMPACTION_FAILED');
  assert.equal(saved.messages.length, 4);
});

test('A background summary cannot overwrite a newer Coordinator turn', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-compact-race-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let release, started;
  const summarizing = new Promise(resolve => { started = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  let replies = 0;
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: [], execute: async () => {}, compactAtTokens: 100,
    model: { next: async ({ system }) => {
      if (system.includes('历史对话')) { started(); await held; return { stop: 'end_turn', content: [{ type: 'text', text: '旧摘要' }] }; }
      replies++;
      return { stop: 'end_turn', content: [{ type: 'text', text: '好的' }], usage: { input_tokens: replies === 3 ? 10 : 100 } };
    } } });
  await service.submit({ id: 'one', text: '第一轮' }); await service.close();
  await service.submit({ id: 'two', text: '第二轮' });
  await summarizing;
  await service.submit({ id: 'three', text: '第三轮' });
  while ((await service.state()).status === 'running') await new Promise(resolve => setTimeout(resolve, 5));
  release(); await service.close();
  const saved = JSON.parse(await fs.readFile(service.file, 'utf8'));
  assert.equal(saved.messages.length, 6);
  assert.equal(saved.compaction, undefined, 'a summary from an older snapshot is discarded');
  assert.equal(saved.status, 'waiting-for-user');
});

test('Coordinator rejects a corrupted compact checkpoint instead of silently dropping history', () => {
  const state = { messages: [{ role: 'user', content: '原文' }, { role: 'assistant', content: [{ type: 'text', text: '回复' }] }],
    compaction: { through: 1, sourceHash: 'wrong', summary: '篡改后的摘要' } };
  assert.throws(() => coordinatorModelMessages(state), { code: 'INVALID_COMPACTION' });
});

test('Structured node tools expose stable buttons without leaking tool-only map data', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-node-actions-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const execute = createCoordinatorExecutor({ resolveNodes: async ids => ids.map(id => ({ id, title: id === 'N1' ? '阅读' : '管理' })) });
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: coordinatorTools, execute, model: { next: async () => ++calls === 1 ? {
    stop: 'tool_use', content: [
      { type: 'tool_use', id: 'show', name: 'show_nodes', input: { message: '建议放这里', nodeIds: ['N1'] } },
      { type: 'tool_use', id: 'ask', name: 'ask_user', input: { question: '选择节点', nodeIds: ['N1', 'N2'] } },
    ],
  } : { stop: 'end_turn', content: [] } } });
  await service.submit({ id: 'turn', text: '定位节点' }); await service.close();
  const state = await service.state(), assistant = state.messages.find(message => message.role === 'assistant');
  assert.deepEqual(assistant.actions[0].nodes, [{ id: 'N1', title: '阅读' }]);
  assert.deepEqual(assistant.questions[0].nodes, [{ id: 'N1', title: '阅读' }, { id: 'N2', title: '管理' }]);
  assert.doesNotMatch(assistant.text, /N1|N2/);
  await assert.rejects(execute('show_nodes', { message: '太多节点', nodeIds: ['N1', 'N2', 'N3', 'N4'] }, { operationId: 'too-many' }), { code: 'INVALID_ARGUMENT' });
});

test('Coordinator can issue one durable direct Map navigation action', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-node-navigation-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const execute = createCoordinatorExecutor({ resolveNodes: async ids => ids.map(id => ({ id, title: '管理', purpose: '后台管理' })) });
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: coordinatorTools, execute, model: { next: async () => ++calls === 1 ? {
    stop: 'tool_use', content: [{ type: 'tool_use', id: 'open', name: 'open_node', input: { nodeId: 'N2' } }],
  } : { stop: 'end_turn', content: [{ type: 'text', text: '已打开管理模块。' }] } } });
  await service.submit({ id: 'turn', text: '帮我打开管理模块' }); await service.close();
  const assistant = (await service.state()).messages.find(message => message.role === 'assistant');
  assert.equal(assistant.text, '已打开管理模块。');
  assert.equal(assistant.actions[0].kind, 'node-navigation');
  assert.match(assistant.actions[0].actionId, /^coordinator:/);
  assert.deepEqual(assistant.actions[0].node, { id: 'N2', title: '管理', purpose: '后台管理' });
});

test('Coordinator can issue one ordered Map tour without node buttons', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-node-tour-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const execute = createCoordinatorExecutor({ resolveNodes: async ids => ids.map(id => ({ id, title: id === 'N1' ? '首页' : '管理' })) });
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: coordinatorTools, execute, model: { next: async () => ++calls === 1 ? {
    stop: 'tool_use', content: [{ type: 'tool_use', id: 'tour', name: 'tour_nodes', input: { nodeIds: ['N1', 'N2'] } }],
  } : { stop: 'end_turn', content: [{ type: 'text', text: '已展示 Map 节点游览。' }] } } });
  await service.submit({ id: 'turn', text: '展示一下你操作 Map 的功能' }); await service.close();
  const assistant = (await service.state()).messages.find(message => message.role === 'assistant');
  assert.equal(assistant.actions[0].kind, 'node-tour');
  assert.deepEqual(assistant.actions[0].nodes.map(node => node.id), ['N1', 'N2']);
});

test('Successful read_map exposes only a visible node-read action', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-map-read-action-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const execute = createCoordinatorExecutor({ readMap: async () => ({ version: 'v1', node: { id: 'N1', title: '管理', memories: [{ text: 'private' }] } }) });
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: coordinatorTools, execute, model: { next: async () => ++calls === 1 ? {
    stop: 'tool_use', content: [{ type: 'tool_use', id: 'read', name: 'read_map', input: { nodeId: 'N1' } }],
  } : { stop: 'end_turn', content: [{ type: 'text', text: '读取完成。' }] } } });
  await service.submit({ id: 'turn', text: '读取管理节点' }); await service.close();
  const action = (await service.state()).messages.find(message => message.role === 'assistant').actions[0];
  assert.deepEqual(action.node, { id: 'N1', title: '管理' });
  assert.equal(action.kind, 'node-read');
  assert.doesNotMatch(JSON.stringify(action), /private|memories|v1/);
});

test('Completed tool turns expose one final answer with the structured action', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-concise-actions-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const execute = createCoordinatorExecutor({ resolveNodes: async () => [{ id: 'N1', title: '阅读' }] });
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: coordinatorTools, execute, model: { next: async () => ++calls === 1 ? {
    stop: 'tool_use', content: [{ type: 'text', text: '我先找到了节点。' },
      { type: 'tool_use', id: 'show', name: 'show_nodes', input: { message: '推荐节点', nodeIds: ['N1'] } }],
  } : { stop: 'end_turn', content: [{ type: 'text', text: '推荐阅读节点。' }] } } });
  await service.submit({ id: 'turn', text: '推荐一个节点' }); await service.close();
  const assistant = (await service.state()).messages.filter(message => message.role === 'assistant');
  assert.equal(assistant.length, 1);
  assert.equal(assistant[0].text, '推荐阅读节点。');
  assert.deepEqual(assistant[0].actions[0].nodes, [{ id: 'N1', title: '阅读' }]);
});

test('Coordinator Map actions compile structural and destructive Main changes', () => {
  const operations = coordinatorStructureOperations([
    { op: 'create', parentId: 'T0', title: '内容', purpose: '文章内容', owns: ['source/'] },
    { op: 'update', id: 'N1', title: '阅读' },
    { op: 'move', id: 'N1', parentId: 'T0', order: 0 },
  ], 'turn:tool');
  assert.equal(operations[0].type, 'create');
  assert.match(operations[0].node.id, /^NCC[a-f0-9]{20}$/);
  assert.deepEqual(operations[1], { type: 'update', id: 'N1', fields: { title: '阅读' } });
  assert.deepEqual(operations[2], { type: 'move', id: 'N1', parentId: 'T0', order: 0 });
  assert.deepEqual(coordinatorStructureOperations([{ op: 'delete', id: 'N1', kind: 'node' }], 'turn:delete'), [{ type: 'delete', id: 'N1' }]);
  assert.deepEqual(coordinatorStructureOperations([{ op: 'delete', id: 'TD1', kind: 'todo', nodeId: 'N1' }], 'turn:todo'), [{ type: 'delete-work-item', nodeId: 'N1', kind: 'todo', itemId: 'TD1' }]);
  assert.deepEqual(coordinatorStructureOperations([{ op: 'delete', id: 'TD1', kind: 'todo' }], 'turn:todo-global'), [{ type: 'delete-work-item', kind: 'todo', itemId: 'TD1' }]);
  assert.throws(() => coordinatorStructureOperations([{ op: 'delete', id: 'TD1', kind: 'memory' }], 'turn:invalid-kind'), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => coordinatorStructureOperations([{ op: 'update', id: 'N1', todos: [] }], 'turn:records'), { code: 'FORBIDDEN' });
});

test('Cloud Coordinator edits Main and mounts a durable item through configured tools', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-coordinator-map-tools-'));
  let server;
  t.after(async () => { await server?.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const projectId = 'context-guard', providerFile = path.join(directory, 'provider.json');
  await fs.writeFile(providerFile, JSON.stringify({ baseUrl: 'https://provider.example', model: 'test', token: 'synthetic' }));
  const memoryConfig = { dataDir: path.join(directory, 'memory'), adminToken: 'synthetic', projects: {
    [projectId]: { root: directory, token: 'synthetic', ref: 'refs/heads/main', coordinator: {
      enabled: true, mapWrite: true, providerFile, bindings: { template: 'template-tree' }, sessionTemplates: ['template'],
    } },
  } };
  const memoryFile = path.join(memoryConfig.dataDir, createHash('sha256').update(projectId).digest('hex'), 'memory.json');
  await fs.mkdir(path.dirname(memoryFile), { recursive: true });
  await fs.writeFile(memoryFile, JSON.stringify({ revision: 1, main: { version: 'v1', memory: { map: { v: 1, bootstrap: 'ready', project: 'Lab', flows: [], root: {
    id: 'T0', title: 'Lab', kind: 'module', state: 'dirty', purpose: '', memories: [], ideas: [], todos: [], bugs: [], dormant: [], files: [], owns: [], children: [], proposal: 'accepted',
  } }, records: {} } }, sessions: {}, closedSessions: {}, receipts: {}, history: [], events: [], eventCursors: {} }));
  let phase = 'edit', step = 0, latestVersion = 'v1', todoId = '', childId = '';
  server = await startCloudServer({ dataDir: directory, port: 0, browserToken: 'test-browser', memoryConfig,
    browserPasswordHash: await createWorkbenchPasswordHash('synthetic-password'),
    protocolConfig: { repositories: [{ repositoryId: '123', projectId, slug: 'example/lab' }] },
    coordinatorModelFactory: () => ({ next: async () => {
      step++;
      if (step % 2 === 0) return { stop: 'end_turn', content: [{ type: 'text', text: '完成' }] };
      if (phase === 'edit') return { stop: 'tool_use', content: [{ type: 'tool_use', id: 'edit', name: 'edit_map', input: {
        mainVersion: latestVersion, actions: [{ op: 'create', parentId: 'T0', title: '阅读', purpose: '读者体验', owns: ['frontend/'] }],
      } }] };
      if (phase === 'mount') return { stop: 'tool_use', content: [{ type: 'tool_use', id: 'mount', name: 'mount_conversation', input: {
        mainVersion: latestVersion, nodeId: 'T0', kind: 'todo', title: '提升阅读体验', description: '页面更快且更清楚',
      } }] };
      return { stop: 'tool_use', content: [{ type: 'tool_use', id: 'cleanup', name: 'edit_map', input: {
        mainVersion: latestVersion, actions: [
          { op: 'delete', kind: 'todo', id: todoId, nodeId: 'T0' },
          { op: 'delete', kind: 'node', id: childId },
        ],
      } }] };
    } }),
  });
  const call = async (method, body) => {
    const response = await fetch(`${server.url}/api/workbench/projects/${projectId}/api/coordinator`, {
      method, headers: { Authorization: 'Bearer test-browser', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  };
  const submit = async body => {
    for (let i = 0; i < 100; i++) {
      const response = await fetch(`${server.url}/api/workbench/projects/${projectId}/api/coordinator`, {
        method: 'POST', headers: { Authorization: 'Bearer test-browser', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (response.ok) return response.json();
      const result = await response.json();
      if (result.error?.code !== 'COORDINATOR_BUSY') assert.fail(JSON.stringify(result));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Coordinator remained busy');
  };
  const wait = async () => { for (let i = 0; i < 100; i++) { const state = await call('GET'); if (state.status === 'waiting-for-user') return state; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Coordinator did not finish'); };
  const login = await fetch(`${server.url}/api/v2/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/lab', clientId: 'device', password: 'synthetic-password' },
  }) });
  assert.equal(login.status, 200);
  const deviceHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.headers.get('x-context-guard-credential')}` };
  const bindTemplate = await fetch(`${server.url}/api/v2/messages`, { method: 'POST', headers: deviceHeaders, body: JSON.stringify({
    v: 2, id: 'bind-template', type: 'session.bind', payload: { sessionId: 'template', worktreeId: 'template-tree', agentId: 'template-agent', expectedBindingVersion: '' },
  }) });
  assert.equal(bindTemplate.status, 200, await bindTemplate.clone().text());
  await submit({ id: 'edit-turn', text: '新增阅读节点' });
  let state = await wait(), memory = await readMemoryView(memoryConfig, projectId);
  assert.equal(memory.main.memory.map.root.children[0].title, '阅读');
  assert.equal(memory.main.memory.map.root.children[0].origin, 'coordinator');
  assert.equal(state.messages.find(message => message.actions)?.actions[0].kind, 'map-action');
  latestVersion = memory.main.version; phase = 'mount';
  await submit({ id: 'mount-turn', text: '挂载这个需求' }); state = await wait(); memory = await readMemoryView(memoryConfig, projectId);
  assert.equal(memory.main.memory.map.root.todos[0].title, '提升阅读体验');
  assert.deepEqual(memory.main.memory.map.root.todos[0].sessions, []);
  const mounted = state.messages.findLast(message => message.actions)?.actions[0];
  assert.equal(mounted.kind, 'conversation-mounted');
  assert.equal(mounted.executionSessionId, undefined);
  assert.match(mounted.conversationId, /^item-/);
  assert.equal((await call('GET')).projectTasks.length, 0);
  assert.equal((await call('GET')).sessionCreations.length, 0);
  const continuedResponse = await fetch(`${server.url}/api/workbench/projects/${projectId}/api/coordinator?conversation=${mounted.conversationId}`, {
    headers: { Authorization: 'Bearer test-browser' },
  });
  assert.ok(continuedResponse.ok);
  assert.match(JSON.stringify((await continuedResponse.json()).messages), /挂载这个需求/);
  todoId = memory.main.memory.map.root.todos[0].id;
  childId = memory.main.memory.map.root.children[0].id;
  latestVersion = memory.main.version; phase = 'cleanup';
  await submit({ id: 'cleanup-turn', text: '删除这个 TODO 和阅读模块' }); state = await wait(); memory = await readMemoryView(memoryConfig, projectId);
  assert.deepEqual(memory.main.memory.map.root.todos, []);
  assert.deepEqual(memory.main.memory.map.root.children, []);
  assert.equal(state.messages.findLast(message => message.actions)?.actions[0].kind, 'map-action');
});

test('Mounting a TODO or Bug creates no execution Session before brief approval', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-mount-session-'));
  let server;
  t.after(async () => { await server?.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const projectId = 'context-guard', providerFile = path.join(directory, 'provider.json');
  await fs.writeFile(providerFile, JSON.stringify({ baseUrl: 'https://provider.example', model: 'test', token: 'synthetic' }));
  const memoryConfig = { dataDir: path.join(directory, 'memory'), adminToken: 'synthetic', projects: {
    [projectId]: { root: directory, token: 'synthetic', ref: 'refs/heads/main', coordinator: {
      enabled: true, mapWrite: true, providerFile, bindings: { template: 'template-tree' }, sessionTemplates: ['template'],
    } },
  } };
  const memoryFile = path.join(memoryConfig.dataDir, createHash('sha256').update(projectId).digest('hex'), 'memory.json');
  await fs.mkdir(path.dirname(memoryFile), { recursive: true });
  const root = { id: 'T0', title: 'Lab', kind: 'module', state: 'dirty', purpose: '', memories: [], ideas: [], todos: [
    { id: 'TD-local', title: '本地事项', desc: '从工作台挂上 Coordinator', status: 'pending', sessions: [] },
    { id: 'TD-legacy', title: '旧派单', desc: '需要先核对原任务', status: 'pending', sessions: ['legacy-session'],
      dispatch: { task_id: 'legacy-task', session_id: 'legacy-session', status: 'received' } },
    { id: 'TD-done', title: '已完成', desc: '不再开工', status: 'done', sessions: [] },
  ], bugs: [
    { id: 'B900', title: '暂缓缺陷', desc: '延期记录仍在', status: 'deferred', sessions: [] },
  ], dormant: [], files: [], owns: [], children: [], proposal: 'accepted' };
  await fs.writeFile(memoryFile, JSON.stringify({ revision: 1, main: { version: 'v1', memory: { map: {
    v: 1, bootstrap: 'ready', project: 'Lab', flows: [], root,
  }, records: {} } }, sessions: {}, closedSessions: {}, receipts: {}, history: [], events: [], eventCursors: {} }));
  let mode = 'idle', mainVersion = 'v1', bugItemId = '', bugTaskId = '';
  const taskId = `map-todo-${createHash('sha256').update(`${projectId}:T0:todo:TD-local`).digest('hex').slice(0, 24)}`;
  const scoped = (request = {}) => {
    const system = String(request.system || ''), marker = '本对话仅负责这一 Map 事项：';
    const at = system.indexOf(marker);
    if (at < 0) return { itemId: null, unscoped: true };
    try { return { itemId: JSON.parse((system.slice(at + marker.length).match(/\{[\s\S]*?\}/) || ['null'])[0])?.itemId || null, unscoped: false }; }
    catch { return { itemId: null, unscoped: false }; }
  };
  server = await startCloudServer({ dataDir: directory, port: 0, browserToken: 'test-browser', memoryConfig,
    browserPasswordHash: await createWorkbenchPasswordHash('synthetic-password'),
    protocolConfig: { repositories: [{ repositoryId: '123', projectId, slug: 'example/repo' }] },
    coordinatorModelFactory: () => ({ next: async (request = {}) => {
      const { itemId, unscoped } = scoped(request);
      const current = mode;
      // Leftover item-conversation review.result turns must not consume idea/bug mounts.
      const consume = (current === 'prepare' && itemId === 'TD-local')
        || (current === 'prepare-bug' && itemId === bugItemId)
        || (current === 'prepare-legacy' && itemId === 'TD-legacy')
        || ((current === 'idea' || current === 'bug') && unscoped);
      if (consume) mode = 'idle';
      const used = consume ? current : 'idle';
      if (used === 'prepare') return { stop: 'tool_use', content: [{ type: 'tool_use', id: 'prepare', name: 'prepare_task', input: {
        taskId, text: '从工作台挂上 Coordinator', acceptance: '事项上能看到绑定的 Session', nodeIds: ['T0'], mainVersion,
      } }] };
      if (used === 'prepare-bug') return { stop: 'tool_use', content: [{ type: 'tool_use', id: 'prepare-bug', name: 'prepare_task', input: {
        taskId: bugTaskId, text: '修复审批后绑定的缺陷', acceptance: '修复完成并通过测试', nodeIds: ['T0'], mainVersion,
      } }] };
      if (used === 'prepare-legacy') return { stop: 'tool_use', content: [{ type: 'tool_use', id: 'prepare-legacy', name: 'prepare_task', input: {
        taskId: `map-todo-${createHash('sha256').update(`${projectId}:T0:todo:TD-legacy`).digest('hex').slice(0, 24)}`,
        text: '不要重复派发旧任务', acceptance: '原任务状态已核对', nodeIds: ['T0'], mainVersion,
      } }] };
      if (used === 'idea') return { stop: 'tool_use', content: [{ type: 'tool_use', id: 'mount-idea', name: 'mount_conversation', input: {
        mainVersion, nodeId: 'T0', kind: 'idea', title: '先记一笔', description: '想法不需要执行 Session',
      } }] };
      if (used === 'bug') return { stop: 'tool_use', content: [{ type: 'tool_use', id: 'mount-bug', name: 'mount_conversation', input: {
        mainVersion, nodeId: 'T0', kind: 'bug', title: '审批后绑定', description: '缺陷批准后才有执行 Session',
      } }] };
      return { stop: 'end_turn', content: [{ type: 'text', text: '好' }] };
    } }),
  });
  const headers = { Authorization: 'Bearer test-browser', 'Content-Type': 'application/json' };
  const post = async (url, value) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(value) });
      const result = await response.json();
      if (response.status < 300) return result;
      if (result.error?.code !== 'COORDINATOR_BUSY') assert.fail(JSON.stringify(result));
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('Coordinator remained busy');
  };
  const login = await fetch(`${server.url}/api/v2/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', clientId: 'device', password: 'synthetic-password' },
  }) });
  assert.equal(login.status, 200);
  const deviceHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.headers.get('x-context-guard-credential')}` };
  const deviceMessage = async value => {
    const response = await fetch(`${server.url}/api/v2/messages`, { method: 'POST', headers: deviceHeaders, body: JSON.stringify({ v: 2, ...value }) });
    const result = await response.json();
    assert.equal(response.status < 300, true, JSON.stringify(result));
    return result;
  };
  await deviceMessage({ id: 'bind-template', type: 'session.bind', payload: { sessionId: 'template', worktreeId: 'template-tree', agentId: 'template-agent', expectedBindingVersion: '' } });
  await deviceMessage({ id: 'heartbeat-template', type: 'sync.heartbeat', payload: { sessions: [{ id: 'template', generation: 1, ackedSeq: 0, execution: { status: 'stopped', at: new Date().toISOString() } }] } });
  const workbench = `${server.url}/api/workbench/projects/${projectId}`;
  const opened = await post(`${workbench}/api/coordinator/conversations`, { nodeId: 'T0', kind: 'todo', itemId: 'TD-local' });
  const again = await post(`${workbench}/api/coordinator/conversations`, { nodeId: 'T0', kind: 'todo', itemId: 'TD-local' });
  assert.equal(again.id, opened.id);
  await post(`${workbench}/api/coordinator/conversations`, { nodeId: 'T0', kind: 'todo', itemId: 'TD-done' });
  await post(`${workbench}/api/coordinator/conversations`, { nodeId: 'T0', kind: 'bug', itemId: 'B900' });
  let memory = await readMemoryView(memoryConfig, projectId);
  const local = memory.main.memory.map.root.todos.find(item => item.id === 'TD-local');
  const done = memory.main.memory.map.root.todos.find(item => item.id === 'TD-done');
  const deferred = memory.main.memory.map.root.bugs.find(item => item.id === 'B900');
  assert.deepEqual(local.sessions, []);
  assert.deepEqual(done.sessions, []);
  assert.equal(deferred.status, 'deferred');
  assert.deepEqual(deferred.sessions, []);
  const itemEndpoint = `${workbench}/api/coordinator?conversation=${encodeURIComponent(opened.id)}`;
  const itemState = async () => (await fetch(itemEndpoint, { headers })).json();
  const beforeApproval = await itemState();
  assert.equal(beforeApproval.projectTasks.length, 0);
  assert.equal(beforeApproval.sessionCreations.length, 0);
  mainVersion = memory.main.version;
  mode = 'prepare';
  await post(itemEndpoint, { id: 'prepare-local', text: '准备这个事项' });
  const poll = async (predicate, load = itemState) => {
    for (let i = 0; i < 300; i++) { const state = await load(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.fail('Coordinator state did not advance');
  };
  const ready = await poll(state => state.approvals?.some(item => item.projectTask && item.taskId === taskId));
  assert.equal(ready.sessionCreations.length, 0);
  assert.equal(ready.projectTasks[0].stage, 'brief');
  assert.equal(ready.projectTasks[0].sessionId, undefined);
  const approve = { id: 'approve-local', proposalId: ready.approvals.find(item => item.taskId === taskId).id, decision: 'approved', reason: '可以做' };
  await post(`${workbench}/api/coordinator/approval?conversation=${encodeURIComponent(opened.id)}`, approve);
  const creating = await poll(state => state.sessionCreations.length === 1);
  const executionSessionId = creating.sessionCreations[0].sessionId;
  assert.notEqual(executionSessionId, 'template');
  assert.notEqual(executionSessionId, 'legacy-session');
  await deviceMessage({ id: 'bind-fresh', type: 'session.bind', payload: { sessionId: executionSessionId, worktreeId: 'fresh-tree', agentId: executionSessionId, expectedBindingVersion: '' } });
  const dispatched = await poll(state => state.projectTasks?.some(task => task.stage === 'dispatched'));
  assert.equal(dispatched.projectTasks[0].sessionId, executionSessionId);
  assert.equal(dispatched.sessionCreations.length, 1);
  await post(`${workbench}/api/coordinator/approval?conversation=${encodeURIComponent(opened.id)}`, approve);
  assert.equal((await itemState()).sessionCreations.length, 1, 'replaying brief approval must not create another Session');
  memory = await readMemoryView(memoryConfig, projectId);
  assert.deepEqual(memory.main.memory.map.root.todos.find(item => item.id === 'TD-local').sessions, [executionSessionId]);
  mainVersion = memory.main.version;
  const legacy = `${workbench}/api/coordinator`;
  const waitMounted = async predicate => {
    for (let i = 0; i < 100; i++) {
      const state = await (await fetch(legacy, { headers })).json();
      if (state.status === 'error') assert.fail(JSON.stringify(state.error));
      const current = await readMemoryView(memoryConfig, projectId);
      if (predicate(current) && state.status === 'waiting-for-user' && !state.activeTurnId) return current;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('mount did not land');
  };
  mode = 'idea';
  await post(legacy, { id: 'mount-idea', text: '记一个想法' });
  memory = await waitMounted(current => current.main.memory.map.root.ideas?.[0]?.text === '先记一笔');
  assert.equal(memory.main.memory.map.root.ideas[0].sessions, undefined);
  assert.equal((await itemState()).sessionCreations.length, 1);
  mainVersion = memory.main.version;
  mode = 'bug';
  await post(legacy, { id: 'mount-bug', text: '挂一个缺陷' });
  memory = await waitMounted(current => current.main.memory.map.root.bugs?.some(item => item.title === '审批后绑定'));
  const mountedBug = memory.main.memory.map.root.bugs.find(item => item.title === '审批后绑定');
  assert.deepEqual(mountedBug.sessions, []);
  assert.equal(memory.main.memory.map.root.bugs.find(item => item.id === 'B900').status, 'deferred');
  const afterBug = await itemState();
  assert.equal(afterBug.sessionCreations.length, 1);
  assert.equal(afterBug.sessionCreations[0].sessionId, executionSessionId);
  bugItemId = mountedBug.id;
  bugTaskId = `map-bug-${createHash('sha256').update(`${projectId}:T0:bug:${bugItemId}`).digest('hex').slice(0, 24)}`;
  const bugConversation = await post(`${workbench}/api/coordinator/conversations`, { nodeId: 'T0', kind: 'bug', itemId: bugItemId });
  const bugEndpoint = `${workbench}/api/coordinator?conversation=${encodeURIComponent(bugConversation.id)}`;
  mainVersion = memory.main.version; mode = 'prepare-bug';
  await post(bugEndpoint, { id: 'prepare-bug', text: '准备修复缺陷' });
  const bugState = async () => (await fetch(bugEndpoint, { headers })).json();
  const bugReady = await poll(state => state.approvals?.some(item => item.projectTask && item.taskId === bugTaskId), bugState);
  const bugApproval = bugReady.approvals.find(item => item.taskId === bugTaskId);
  await post(`${workbench}/api/coordinator/approval?conversation=${encodeURIComponent(bugConversation.id)}`,
    { id: 'approve-bug', proposalId: bugApproval.id, decision: 'approved', reason: '可以修复' });
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await bugState()).sessionCreations.length === 2) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const failureCreation = (await bugState()).sessionCreations.find(item => item.sessionId !== executionSessionId);
  assert.ok(failureCreation);
  await deviceMessage({ id: 'fail-bug-creation', type: 'sync.heartbeat', payload: {
    sessions: [], creationResults: [{ id: failureCreation.id, error: 'NATIVE_START_FAILED' }],
  } });
  const retrying = await poll(state => state.sessionCreations.some(item => item.id === failureCreation.id &&
    item.state === 'pending' && item.retryCount === 1), bugState);
  assert.equal(retrying.sessionCreations.length, 2, 'creation retry must retain the first Session identity');
  assert.equal(retrying.projectTasks.find(task => task.taskId === bugTaskId).sessionId, failureCreation.sessionId);
  await deviceMessage({ id: 'bind-retried-bug', type: 'session.bind', payload: {
    sessionId: failureCreation.sessionId, worktreeId: 'recovered-bug-tree', agentId: failureCreation.sessionId, expectedBindingVersion: '',
  } });
  const recovered = await poll(state => state.projectTasks.some(task => task.taskId === bugTaskId && task.stage === 'dispatched'), bugState);
  assert.equal(recovered.sessionCreations.length, 2);
  assert.equal(recovered.projectTasks.find(task => task.taskId === bugTaskId).sessionId, failureCreation.sessionId);
  const legacyConversation = await post(`${workbench}/api/coordinator/conversations`, { nodeId: 'T0', kind: 'todo', itemId: 'TD-legacy' });
  const legacyEndpoint = `${workbench}/api/coordinator?conversation=${encodeURIComponent(legacyConversation.id)}`;
  mode = 'prepare-legacy'; mainVersion = (await readMemoryView(memoryConfig, projectId)).main.version;
  await post(legacyEndpoint, { id: 'prepare-legacy', text: '继续这个旧事项' });
  const legacyState = await poll(state => state.status === 'waiting-for-user' && !state.activeTurnId,
    async () => (await fetch(legacyEndpoint, { headers })).json());
  assert.equal(legacyState.projectTasks.length, 0, 'a pre-existing legacy dispatch cannot silently become a new task');
  assert.equal(legacyState.sessionCreations.length, 2);
});

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
  const model = new CoordinatorModel({ ...config, maxTokens: 1024, thinking: { type: 'disabled' }, fetch: async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://provider.example/api/anthropic/v1/messages');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${config.token}`);
    const body = JSON.parse(options.body);
    assert.equal(body.model, config.model);
    assert.equal(body.max_tokens, 1024);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    return Response.json(text);
  } });
  assert.equal((await model.next({ system: 'role', messages: [{ role: 'user', content: 'hello' }] })).stop, 'end_turn');
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(model).includes(config.token));
  model.fetch = async () => { calls++; return new Response(config.token, { status: 401 }); };
  await assert.rejects(model.next({ system: 'role', messages: [] }), error => error.code === 'MODEL_HTTP_401' && !error.message.includes(config.token));
  assert.equal(calls, 2);
  assert.throws(() => new CoordinatorModel({ ...config, thinking: { type: 'fast' } }), { code: 'INVALID_PROVIDER' });
  assert.throws(() => new CoordinatorModel({ ...config, thinking: { type: 'disabled', budget_tokens: 1 } }), { code: 'INVALID_PROVIDER' });
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

test('Coordinator request transport permits token-window growth but retains an independent byte guard', async () => {
  let sentBytes = 0;
  const model = new CoordinatorModel({ ...config, fetch: async (_url, options) => {
    sentBytes = Buffer.byteLength(options.body);
    return Response.json(text);
  } });
  await model.next({ system: '', messages: [{ role: 'user', content: 'x'.repeat(513 * 1024) }] });
  assert.ok(sentBytes > 512 * 1024);
  await assert.rejects(model.next({ system: '', messages: [{ role: 'user', content: 'x'.repeat(8 * 1024 * 1024) }] }),
    { code: 'CONTEXT_TOO_LARGE' });
});

test('Coordinator deadline aborts the request and exposes a stable timeout error', async () => {
  const model = new CoordinatorModel({ ...config, timeoutMs: 5, fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error(config.token)), { once: true });
  }) });
  await assert.rejects(model.next({ system: '', messages: [] }), { code: 'MODEL_TIMEOUT' });
});

test('Coordinator deadline escapes a response stream that stalls after partial text', async () => {
  const encoder = new TextEncoder();
  const model = new CoordinatorModel({ ...config, timeoutMs: 20, fetch: async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"message_start","message":{"model":"deepseek-v4-flash"}}\n\n'));
      controller.enqueue(encoder.encode('data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"卡"}}\n\n'));
    },
  }), { headers: { 'content-type': 'text/event-stream' } }) });
  const started = Date.now();
  await assert.rejects(model.next({ system: '', messages: [] }), { code: 'MODEL_TIMEOUT' });
  assert.ok(Date.now() - started < 500, 'the reader deadline must not wait for the stalled socket');
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

test('Coordinator offers explicit retry after automatic model retries are exhausted', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-coordinator-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const options = { directory, system: 'Coordinator', tools: [], simulated: true,
    execute: async () => { throw new Error('No tools allowed'); },
    model: { next: async () => { calls++; if (calls === 1) throw Object.assign(new Error('provider timeout'), { code: 'MODEL_TIMEOUT' }); return { stop: 'end_turn', content: [{ type: 'text', text: '请确认需求。' }] }; } },
  };
  const service = new CoordinatorService({ ...options, maxModelRetries: 0 });
  const input = { id: 'human-1', text: '查看地图' };
  await service.submit(input); await service.close();
  assert.equal((await service.state()).error.code, 'MODEL_TIMEOUT');
  assert.deepEqual((await service.state()).acceptedRequestIds, [input.id]);
  const restarted = new CoordinatorService({ ...options, maxModelRetries: 0 });
  assert.deepEqual((await restarted.state()).acceptedRequestIds, [input.id], 'acceptance survives a lost response and restart');
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

test('Coordinator automatically retries a transient model timeout before any tool effect', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-coordinator-auto-retry-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: [], execute: async () => {}, retryDelayMs: 0,
    model: { next: async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('stalled stream'), { code: 'MODEL_TIMEOUT' });
      return { stop: 'end_turn', content: [{ type: 'text', text: '已继续' }] };
    } },
  });
  await service.submit({ id: 'auto-retry', text: '继续任务' }); await service.close();
  const state = await service.state();
  assert.equal(calls, 2);
  assert.equal(state.status, 'waiting-for-user');
  assert.equal(state.messages.at(-1).text, '已继续');
});

test('Coordinator automatically resumes a durable transient model failure after restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-coordinator-restart-retry-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'conversation.json');
  const failed = { messages: [{ role: 'user', content: '继续任务' }], requests: { durable: 'fingerprint' }, toolReceipts: {},
    status: 'error', error: { code: 'MODEL_TIMEOUT' }, activeTurnId: 'durable', activeInput: { id: 'durable', text: '继续任务' }, steps: 1 };
  await fs.writeFile(file, JSON.stringify(failed));
  assert.equal(coordinatorCanAutoResume(failed), true);
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: [], execute: async () => {}, retryDelayMs: 0,
    model: { next: async () => ({ stop: 'end_turn', content: [{ type: 'text', text: '已从断点继续' }] }) } });
  service.kick(); await service.close();
  const state = await service.state();
  assert.equal(state.status, 'waiting-for-user');
  assert.equal(state.messages.at(-1).text, '已从断点继续');
});

test('Coordinator exposes only a bounded recent receipt list, not request content', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-coordinator-receipts-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const requests = Object.fromEntries(Array.from({ length: 105 }, (_, index) => [`request-${index}`, 'private-fingerprint']));
  await fs.writeFile(path.join(directory, 'conversation.json'), JSON.stringify({ messages: [], status: 'idle', requests }));
  const service = new CoordinatorService({ directory, system: 'Coordinator', tools: [], model: {}, execute: async () => {} });
  const state = await service.state();
  assert.equal(state.acceptedRequestIds.length, 100);
  assert.equal(state.acceptedRequestIds[0], 'request-5');
  assert.equal(state.acceptedRequestIds.at(-1), 'request-104');
  assert.doesNotMatch(JSON.stringify(state), /private-fingerprint/);
});

test('Coordinator task tools cannot mistake conversation IDs for execution Sessions', async () => {
  const prepare = coordinatorTools.find(tool => tool.name === 'prepare_task');
  const readObject = coordinatorTools.find(tool => tool.name === 'read_object');
  const sessions = coordinatorTools.find(tool => tool.name === 'list_sessions');
  const conversations = coordinatorTools.find(tool => tool.name === 'list_conversations');
  assert.equal(prepare.input_schema.properties.executionSessionId, undefined);
  assert.ok(prepare.input_schema.properties.itemId);
  assert.ok(prepare.input_schema.properties.nodeId);
  assert.ok(prepare.input_schema.properties.kind);
  assert.ok(readObject.input_schema.properties.executionSessionId);
  assert.equal(readObject.input_schema.properties.sessionId, undefined);
  assert.equal(prepare.input_schema.properties.sessionId, undefined);
  assert.match(prepare.description, /After approval the scheduler creates one fresh execution Session/);
  assert.match(prepare.description, /Never select or reuse a prior Session/);
  assert.match(sessions.description, /executionSessionId/);
  assert.match(conversations.description, /conversationId is never an executionSessionId/);

  let readSession = '';
  const exchanges = [];
  const execute = createCoordinatorExecutor({ readTask: async sessionId => { readSession = sessionId; return { id: 'task-1' }; },
    exchange: async (sessionId, id, type, payload) => { exchanges.push({ sessionId, id, type, payload }); return { ref: payload.ref, version: payload.version }; } });
  await assert.rejects(execute('read_task', { executionSessionId: 'item-aabb', taskId: 'task-1' }, { operationId: 'bad-item' }), /must be copied from list_sessions/);
  await assert.rejects(execute('read_task', { executionSessionId: 'session:actual', taskId: 'task-1' }, { operationId: 'bad-conversation' }), /must be copied from list_sessions/);
  await assert.rejects(execute('read_task', { sessionId: 'actual-session', taskId: 'task-1' }, { operationId: 'legacy-field' }), /fields differ/);
  await execute('read_task', { executionSessionId: 'actual-session', taskId: 'task-1' }, { operationId: 'valid' });
  assert.equal(readSession, 'actual-session');
  await execute('read_object', { executionSessionId: 'actual-session', ref: 'plan:task-1', version: 'plan-v1' }, { operationId: 'read-plan' });
  assert.deepEqual(exchanges, [{ sessionId: 'actual-session', id: 'read-plan', type: 'object.read', payload: { ref: 'plan:task-1', version: 'plan-v1' } }]);
});

test('Coordinator prepares a Map TODO with stable identity and no Session selector', async () => {
  const captured = [];
  const execute = createCoordinatorExecutor({
    readMap: async () => ({ version: 'main-1' }),
    prepareProjectTask: async (requirements, operationId) => { captured.push({ requirements, operationId }); return { projectTask: true, requiresHumanApproval: true, ...requirements }; },
  });
  const input = { taskId: 'map-todo-123', itemId: 'TD1', nodeId: 'N1', kind: 'todo', text: 'Run the task', acceptance: 'Report the result', nodeIds: ['N1'], mainVersion: 'main-1' };
  const result = await execute('prepare_task', input, { operationId: 'prepare-map-todo' });
  assert.equal(result.projectTask, true);
  assert.deepEqual(captured, [{ requirements: input, operationId: 'prepare-map-todo' }]);
  await assert.rejects(execute('prepare_task', { ...input, executionSessionId: 'session-old' }, { operationId: 'legacy-selector' }), /fields differ/);
});

test('Coordinator conversation ownership is routing metadata, not task authorization', async () => {
  assert.equal(coordinatorTaskOwnerRequired('brief.submit'), true);
  assert.equal(coordinatorTaskOwnerRequired('object.read'), false);
  assert.equal(coordinatorTaskOwnerRequired('task.control'), false);
  const calls = [], current = { version: 'v1', stage: 'interrupted' };
  const execute = createCoordinatorExecutor({
    readTask: async (sessionId, taskId) => {
      calls.push(['read', sessionId, taskId]);
      return current;
    },
    exchange: async (sessionId, _id, type, payload) => {
      calls.push([type, sessionId, payload.taskId]);
      return { ok: true };
    },
  });
  const identity = { executionSessionId: 'assigned-session', taskId: 'TD1' };
  await execute('read_task', identity, { operationId: 'read-from-main' });
  await execute('resume_task', { ...identity, reason: '继续未完成任务' }, { operationId: 'resume-from-main' });
  assert.deepEqual(calls, [
    ['read', 'assigned-session', 'TD1'],
    ['read', 'assigned-session', 'TD1'],
    ['task.control', 'assigned-session', 'TD1'],
  ]);
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
  const identity = { executionSessionId: 'session-1', taskId: 'task-1' };
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
  const result = await execute('resume_task', { executionSessionId: 'session-1', taskId: 'task-1', reason: '用户明确要求继续' }, { operationId: 'resume-op' });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{ sessionId: 'session-1', id: 'resume-op', type: 'task.control', payload: {
    taskId: 'task-1', action: 'resume', expectedVersion: 'v7', data: { reason: '用户明确要求继续' },
  } }]);
});

test('Coordinator guides the existing execution Session without changing its Plan', async () => {
  const calls = [], current = { version: 'v7', stage: 'executing', plan: { ref: 'plan-1', version: 'plan-v1' } };
  const execute = createCoordinatorExecutor({
    readTask: async () => current,
    exchange: async (sessionId, id, type, payload) => { calls.push({ sessionId, id, type, payload }); return { notificationId: 'note-1' }; },
  });
  const result = await execute('guide_task', { executionSessionId: 'session-1', taskId: 'task-1', message: 'Commit and hand off' }, { operationId: 'guide-op' });
  assert.deepEqual(result, { notificationId: 'note-1' });
  assert.deepEqual(calls, [{ sessionId: 'session-1', id: 'guide-op', type: 'task.message', payload: {
    taskId: 'task-1', text: 'Commit and hand off', planRef: 'plan-1', planVersion: 'plan-v1',
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

test('Coordinator acceptance event guides archive and PR before completion', async () => {
  const session = { id: 'session-1', generation: 1 }, acceptance = { v: 2, id: 'acceptance-1', type: 'review.result', session,
    payload: { kind: 'acceptance', ref: 'ci-1', version: 'v1', decision: 'approved', reason: 'Verified' } };
  const submitted = [], acknowledged = [];
  const store = { on() {}, off() {}, registeredBinding: async () => ({ worktreeId: 'worktree', generation: 1 }), handle: async (_principal, message) => {
    if (message.type === 'sync.heartbeat') return { data: { sessions: [{ ...session, latestSeq: 1, ackedSeq: 0 }] } };
    if (message.type === 'sync.read') return { data: { messages: [{ seq: 1, message: acceptance }], nextSeq: 1 } };
    if (message.type === 'sync.ack') { acknowledged.push(message.payload.items[0].seq); return { data: {} }; }
    throw new Error(`unexpected ${message.type}`);
  } };
  const service = { state: async () => ({ status: 'idle' }), submit: async request => { submitted.push(JSON.parse(request.text)); } };
  const inbox = new CoordinatorInbox({ store, principal: {}, sessionIds: [session.id], service, intervalMs: 60000 });
  await inbox.pump(); await inbox.close();
  assert.equal(submitted.length, 1);
  assert.match(submitted[0].instruction, /guide_task/);
  assert.match(submitted[0].instruction, /归档、结束计划并创建 PR/);
  assert.match(submitted[0].instruction, /发布后.*complete_task/);
  assert.deepEqual(acknowledged, [1]);
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
  const sessions = [{ executionSessionId: 'assigned-session', generation: 3, worktreeId: 'assigned-worktree' }];
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
  const scopedEndpoint = endpoint + '?conversation=' + encodeURIComponent('session:session');
  const scopedBefore = await (await fetch(scopedEndpoint, { headers })).json();
  assert.equal(scopedBefore.conversationId, 'session:session');
  assert.deepEqual(scopedBefore.messages, []);
  assert.equal((await fetch(endpoint + '?conversation=' + encodeURIComponent('session:missing'), { headers })).status, 404);
  const scopedSubmit = await fetch(scopedEndpoint, { method: 'POST', headers, body: JSON.stringify({ id: 'session-discussion', text: 'Session only' }) });
  assert.equal(scopedSubmit.status, 202, await scopedSubmit.text());
  let scopedAfter;
  for (let attempt = 0; attempt < 20; attempt++) {
    scopedAfter = await (await fetch(scopedEndpoint, { headers })).json();
    if (scopedAfter.messages.some(message => message.text === 'Workflow event received')) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.match(JSON.stringify(scopedAfter.messages), /Session only/);
  assert.doesNotMatch(JSON.stringify((await (await fetch(endpoint, { headers })).json()).messages), /Session only/);
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
  let rejected = await store.taskRecord(coordinator, session, 'task');
  for (let attempt = 0; rejected.stage !== 'rework' && attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    rejected = await store.taskRecord(coordinator, session, 'task');
  }
  assert.equal(rejected.stage, 'rework');
  assert.match(rejected.acceptanceReview.reason, /模拟人工验收/);
  assert.equal(rejected.rework.reason, rejected.acceptanceReview.reason);
  assert.deepEqual(rejected.rework.failedTestIds, []);
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
