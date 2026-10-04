import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startCloudServer } from '../scripts/cloud/server.mjs';
import { readMemoryView } from '../scripts/cloud/memory.mjs';
import { legacyProjectMemoryFile } from '../scripts/cloud/memory-filesystem.mjs';
import { hash, readJSON } from '../scripts/shared/io.mjs';
import { CoordinatorMapIntake } from '../scripts/cloud/coordinator-service.mjs';
import { coordinatorTools, selectCoordinatorTools } from '../scripts/cloud/coordinator-tools.mjs';
import { filterManualTools } from '../scripts/cloud/coordinator-manual.mjs';
import { coordinatorStep } from '../scripts/cloud/coordinator-model.mjs';
import { publicMessages, CoordinatorConversations } from '../scripts/cloud/coordinator-service.mjs';
import { createCoordinatorExecutor } from '../scripts/cloud/coordinator-tools.mjs';
import { SlackPlugin } from '../plugins/slack/src/plugin.mjs';
import { Store, threadKey } from '../plugins/slack/src/store.mjs';

// These exercise real Cloud and loopback HTTP with isolated persistence. Only
// the paid model provider is replaced; no Slack SDK/account/network is involved.
const projectId = 'context-guard', otherProjectId = 'fixture-other';
const teamId = 'TTESTWORKSPACE', userId = 'UTESTUSER';
const integrationCredential = 'fixture-independent-integration-credential';
const browserCredential = 'fixture-browser-credential';
const headers = { Authorization: `Bearer ${browserCredential}`, 'Content-Type': 'application/json' };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN5kAAAAASUVORK5CYII=';

// Projection regression: real Coordinator execution/public messages and plugin,
// with in-memory provider/state and fake Slack IO; not a real Slack E2E case.
test('Native Coordinator read_map projection produces no empty Slack reply before the actual answer', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-native-read-mirror-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = await new Store(directory).open(), key = threadKey(teamId, 'CTESTCHANNEL', '100.001');
  await store.bind(key, { channel: 'CTESTCHANNEL', threadTs: '100.001', projectId, conversationId: 'chat-native-read', userId,
    ownRequests: ['native-read-turn'] });
  const posts = [], raw = { status: 'running', activeTurnId: 'native-read-turn', activeInput: { id: 'native-read-turn' },
    messages: [{ role: 'user', requestId: 'native-read-turn', content: '只读分析这个模块' }], toolReceipts: {} };
  const execute = createCoordinatorExecutor({ readMap: async () => ({ version: 'main-native-read', node: { id: 'T0', title: 'Fixture' } }) });
  let modelStep = 0;
  const model = { next: async () => ++modelStep === 1
    ? { stop: 'tool_use', content: [{ type: 'tool_use', id: 'native-read-tool', name: 'read_map', input: { nodeId: 'T0' } }] }
    : { stop: 'end_turn', content: [{ type: 'text', text: '已读取真实模块信息，本轮只读。' }] } };
  const step = () => coordinatorStep({ turnId: 'native-read-turn', state: raw, model, system: 'native read projection test',
    tools: filterManualTools(coordinatorTools), execute, save: async () => {} });
  const plugin = new SlackPlugin({ store, teamId, cloudOrigin: 'https://map.example.com', botUserId: 'UBOTTEST',
    gateway: { command: async () => ({ status: raw.status, activeTurnId: raw.activeTurnId,
      messages: publicMessages(raw), approvals: [], acceptedRequestIds: ['native-read-turn'] }) },
    io: { post: async input => { posts.push(input); return '101.001'; }, update: async () => assert.fail('No retained stream in this case') },
    logger: { error(){}, warn(){} } });
  await step();
  const readMessage = publicMessages(raw).find(message => message.role === 'assistant');
  assert.equal(readMessage.actions[0].kind, 'node-read', 'Use the actual public projection, not a renamed fixture action');
  assert.equal(readMessage.text, '');
  assert.equal(Object.keys(raw.toolReceipts).length, 1);
  assert.equal(raw.messages.at(-1).content[0].type, 'tool_result');
  await plugin.mirror(key);
  assert.equal(posts.length, 0, 'The real native read projection must not create a blank Slack message');
  await step(); raw.activeTurnId = null;
  await plugin.mirror(key); await plugin.mirror(key);
  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /已读取真实模块信息/);
  assert.ok(raw.messages.some(message => Array.isArray(message.content) && message.content.some(block => block.type === 'tool_result')),
    'Cloud tool provenance remains complete');
});

async function fixture(t, { enabled = true, visionProvider, nodeIds, childNodes = [], prepareInput, initialMap } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-slack-cloud-'));
  let cloud;
  const held = new Set();
  const releaseHeld = () => { for (const release of held) release(); held.clear(); };
  t.after(async () => { releaseHeld(); await cloud?.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const providerFile = path.join(directory, 'provider.json');
  await fs.writeFile(providerFile, JSON.stringify({ model: 'fixture-model', token: 'synthetic', baseUrl: 'https://fixture.invalid' }));
  const visionProviderFile = path.join(directory, 'vision-provider.json');
  if (visionProvider) await fs.writeFile(visionProviderFile, JSON.stringify({ token: 'synthetic', baseUrl: 'https://fixture.invalid', ...visionProvider }));
  const projects = Object.fromEntries([projectId, otherProjectId].map(id => [id, { root: directory, ref: 'refs/heads/main',
    coordinator: { enabled: true, providerFile, bindings: {}, mapWrite: true, ...(nodeIds ? { nodeIds } : {}) } }]));
  const memoryConfig = { dataDir: path.join(directory, 'memory'), adminToken: 'fixture-memory-credential', projects };
  await fs.writeFile(path.join(directory, 'projects.json'), JSON.stringify({ v: 2, projects: [projectId, otherProjectId].map(id => ({ id, name: id, description: 'Isolated synthetic project' })) }));
  for (const id of Object.keys(projects)) {
    const file = legacyProjectMemoryFile(memoryConfig.dataDir, id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ revision: 1, main: { version: 'main-initial', memory: { records: {}, map: initialMap || {
      project: 'Fixture', root: { id: 'T0', title: 'Fixture', kind: 'module', state: 'dirty', owns: ['src/'], memoryDocument: 'Current project facts', children: childNodes,
        todos: [{ id: 'TD-old', title: 'Existing original TODO', status: 'pending', createdAt: 'original-todo' }],
        bugs: [{ id: 'B1', title: 'Existing original Bug', status: 'open', createdAt: 'original-bug', attempts: [{ status: 'Confirmed', cause: 'Token expired' }] }] },
    } } }, sessions: {}, closedSessions: {}, receipts: {}, history: [], events: [], eventCursors: {} }));
  }
  const modelCalls = [], failedTurns = new Set();
  const options = { dataDir: directory, host: '127.0.0.1', port: 0, adminToken: 'fixture-server-admin', browserToken: browserCredential, privateAccess: true,
    memoryConfig, protocolConfig: { repositories: [{ repositoryId: '123', projectId, slug: 'example/fixture' },
      { repositoryId: '124', projectId: otherProjectId, slug: 'example/other' }] },
    ...(enabled ? { integrationConfig: { host: '127.0.0.1', port: 0, token: integrationCredential, teamId, projectIds: [projectId, otherProjectId],
      ...(visionProvider ? { visionProviderFile } : {}) } } : {}),
    coordinatorModelFactory: () => ({ model: 'fixture-model', next: async request => {
      modelCalls.push({ system: request.system, messages: request.messages, tools: request.tools, maxTokens: request.maxTokens });
      if (request.system?.startsWith('你仅判断 Slack 消息')) {
        const input = JSON.parse(request.messages[0].content);
        if (input.message.text === 'relevance-tool') return { stop: 'tool_use', content: [{ type: 'tool_use', name: 'edit_map', id: 'forbidden-relevance-tool', input: {} }] };
        return { stop: 'end_turn', content: [{ type: 'text', text: input.message.text === 'invalid-relevance'
          ? 'not a decision' : JSON.stringify({ respond: input.message.text === '登录刷新 Bug，请分析。', reason: 'Controlled decision' }) }] };
      }
      const message = request.messages.at(-1), text = typeof message?.content === 'string' ? message.content : '';
      if (text === 'show-node-complete') return { stop: 'tool_use', content: [
        { type: 'text', text: 'This is the complete read-only answer.' },
        { type: 'tool_use', id: 'tool-show-complete', name: 'show_nodes', input: { message: 'Project entry', nodeIds: ['T0'], replyComplete: true } },
      ] };
      if (text === 'list-scoped-tasks') return { stop: 'tool_use', content: [{ type: 'tool_use', id: 'list-scoped', name: 'list_tasks', input: {} }] };
      if (message?.role === 'user' && text === 'failure-then-browser-retry' && !failedTurns.has(text)) {
        failedTurns.add(text); throw Object.assign(new Error('Controlled provider failure'), { code: 'FIXTURE_PROVIDER_FAILURE' });
      }
      if (message?.role === 'user' && text === 'hold-busy-turn') await new Promise(resolve => held.add(resolve));
      if (message?.role === 'user' && ['mount-bug', 'mount-todo'].includes(text)) {
        const version = (await readMemoryView(memoryConfig, projectId)).main.version;
        return { stop: 'tool_use', content: [{ type: 'tool_use', id: 'tool-mount-bug', name: 'mount_conversation', input: {
          mainVersion: version, nodeId: 'T0', kind: text === 'mount-bug' ? 'bug' : 'todo', title: 'Mounted refresh failure', description: 'Expired tokens produce a reproducible renewal failure',
        } }] };
      }
      if (message?.role === 'user' && text === 'prepare-explicit-routing' && prepareInput) {
        const version = (await readMemoryView(memoryConfig, projectId)).main.version;
        return { stop:'tool_use',content:[{type:'tool_use',id:'tool-explicit-routing',name:'prepare_task',input:{
          text:'Fix existing B1 only',acceptance:'Keep the requested item identity',nodeIds:['T0'],mainVersion:version,...prepareInput,
        }}] };
      }
      if (message?.role === 'user' && /^prepare-(new|bug|stale)$/.test(text)) {
        const version = (await readMemoryView(memoryConfig, projectId)).main.version;
        return { stop: 'tool_use', content: [{ type: 'tool_use', id: `tool-${text}`, name: 'prepare_task', input: {
          taskId: text === 'prepare-bug' ? 'B1' : 'new-item', text: text === 'prepare-bug' ? 'Fix token refresh' : 'Add token refresh guidance',
          acceptance: 'Verified expired token handling', nodeIds: ['T0'], mainVersion: version,
          ...(text === 'prepare-bug' ? { nodeId: 'T0', kind: 'bug', itemId: 'B1' } : {}),
        } }] };
      }
      return { stop: 'end_turn', content: [{ type: 'text', text: `Fixture response${text ? ': ' + text : ''}` }] };
    } }),
  };
  // Default-off is evaluated without an ambient user's integration configuration.
  const previousIntegrationConfig = process.env.CONTEXT_GUARD_INTEGRATIONS_CONFIG;
  delete process.env.CONTEXT_GUARD_INTEGRATIONS_CONFIG;
  try { cloud = await startCloudServer(options); }
  finally { if (previousIntegrationConfig === undefined) delete process.env.CONTEXT_GUARD_INTEGRATIONS_CONFIG; else process.env.CONTEXT_GUARD_INTEGRATIONS_CONFIG = previousIntegrationConfig; }
  const gateway = async (type, payload = {}, { id = `request-${hash(JSON.stringify([type, payload])).slice(0, 32)}`, conversationId,
    project = projectId, user = userId, credential = integrationCredential } = {}) => {
    const response = await fetch(cloud.integrationUrl + '/v1/command', { method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type, teamId, userId: user, projectId: project, ...(conversationId ? { conversationId } : {}), payload }) });
    return { status: response.status, body: await response.json() };
  };
  const browser = async (conversationId, { suffix = '', body, authorization = browserCredential, project = projectId } = {}) => {
    const response = await fetch(`${cloud.url}/api/workbench/projects/${project}/api/coordinator${suffix}?conversation=${encodeURIComponent(conversationId || 'main')}`, {
      method: body ? 'POST' : 'GET', headers: { ...headers, Authorization: `Bearer ${authorization}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const wait = async (conversationId, predicate, label = 'Coordinator final state') => {
    const deadline = Date.now() + 4000; let last;
    while (Date.now() < deadline) {
      last = await browser(conversationId);
      assert.equal(last.status, 200, JSON.stringify(last.body));
      if (predicate(last.body)) return last.body;
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    assert.fail(`${label} timed out: ${JSON.stringify(last?.body)}`);
  };
  return { directory, memoryConfig, options, modelCalls, gateway, browser, wait, get cloud() { return cloud; },
    main: () => readMemoryView(memoryConfig, projectId),
    async restart() { releaseHeld(); await cloud.close(); cloud = await startCloudServer(options); },
    async newConversation(id) {
      const result = await gateway('conversation.create', { operationId: id }, { id });
      assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.data.conversationId;
    } };
}

test('Cloud integration listener is disabled by default and plugin credentials cannot impersonate browser access', async t => {
  const disabled = await fixture(t, { enabled: false });
  assert.equal(disabled.cloud.integrationUrl, null);
  assert.equal((await disabled.browser('main')).status, 200);
  const enabled = await fixture(t);
  assert.equal((await enabled.gateway('project.list', {}, { credential: browserCredential })).status, 401);
  assert.equal((await enabled.browser('main', { authorization: integrationCredential })).status, 401);
  const projects = await enabled.gateway('project.list');
  assert.equal(projects.status, 200); assert.deepEqual(projects.body.data.projects.map(item => item.id).sort(), [projectId, otherProjectId].sort());
});

test('list_tasks uses the same exact node scope as reads, not inherited access to children', async t => {
  const f = await fixture(t, { nodeIds: ['T0'], childNodes: [{ id: 'N-private', title: 'Unassigned child', children: [],
    todos: [{ id: 'TD-private', title: 'Unassigned child TODO', status: 'pending' }],
    bugs: [{ id: 'B-private', title: 'Unassigned child Bug', status: 'open' }] }] });
  const conversation = await f.newConversation('scope-list-chat');
  assert.equal((await f.gateway('conversation.submit', { text: 'list-scoped-tasks' }, { id: 'scope-list-turn', conversationId: conversation })).status, 200);
  await f.wait(conversation, value => value.status === 'waiting-for-user' && !value.activeTurnId);
  const reply = f.modelCalls.at(-1).messages.at(-1).content.find(block => block.type === 'tool_result');
  const result = JSON.parse(reply.content);
  assert.ok(JSON.stringify(result).includes('Existing original TODO'));
  assert.ok(JSON.stringify(result).includes('Existing original Bug'));
  assert.doesNotMatch(JSON.stringify(result), /TD-private|B-private|Unassigned child/);
});

test('relevance endpoint reads current Main but never creates conversations, work items or execution state', async t => {
  const f = await fixture(t), before = await f.main();
  const originalFiles = await fs.readdir(path.join(f.directory, 'coordinators'), { recursive: true }).catch(error => {
    if (error.code !== 'ENOENT') throw error; return [];
  });
  const conversationFiles = files => files.filter(file => /(?:conversations|conversation|state\.json|chat-)/.test(file)).sort();
  const result = await f.gateway('conversation.relevance', { text: '登录刷新 Bug，请分析。' }, { id: 'relevance-related' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, { respond: true, reason: 'Controlled decision', mainVersion: before.main.version });
  const request = f.modelCalls.at(-1);
  assert.deepEqual(request.tools, []); assert.equal(request.maxTokens, 160);
  assert.equal(JSON.parse(request.messages[0].content).overview.memory, 'Current project facts');
  assert.deepEqual(await f.main(), before);
  assert.deepEqual(conversationFiles(await fs.readdir(path.join(f.directory, 'coordinators'), { recursive: true }).catch(error => {
    if (error.code !== 'ENOENT') throw error; return [];
  })), conversationFiles(originalFiles));
  const calls = f.modelCalls.length;
  await f.restart();
  assert.deepEqual((await f.gateway('conversation.relevance', { text: '登录刷新 Bug，请分析。' }, { id: 'relevance-related' })).body.data, result.body.data);
  assert.equal(f.modelCalls.length, calls);
  assert.equal((await f.gateway('conversation.relevance', { text: 'changed text' }, { id: 'relevance-related' })).status, 409);
});

test('unrelated and invalid relevance decisions cannot become submitted turns', async t => {
  const f = await fixture(t), before = await f.main();
  const unrelated = await f.gateway('conversation.relevance', { text: '<@UOTHER> 中午吃什么？' }, { id: 'relevance-unrelated' });
  assert.equal(unrelated.status, 200); assert.equal(unrelated.body.data.respond, false);
  const invalid = await f.gateway('conversation.relevance', { text: 'invalid-relevance' }, { id: 'relevance-malformed' });
  assert.equal(invalid.status, 502); assert.equal(invalid.body.error.code, 'RELEVANCE_INVALID_RESPONSE');
  const forbiddenTool = await f.gateway('conversation.relevance', { text: 'relevance-tool' }, { id: 'relevance-tool' });
  assert.equal(forbiddenTool.status, 502); assert.equal(forbiddenTool.body.error.code, 'RELEVANCE_INVALID_RESPONSE');
  assert.equal(invalid.body.data, undefined); assert.deepEqual(await f.main(), before);
});

test('relevance input, workspace, project and conversation boundaries are checked before the model', async t => {
  const f = await fixture(t), calls = f.modelCalls.length;
  for (const payload of [{ text: '' }, { text: 'x', tool: 'map.write' }, { text: 'x', context: [{ speaker: userId, text: 'x'.repeat(801) }] },
    { text: 'x', files: [{ name: 'x', mimeType: 'image/png', path: '/private' }] }, { text: 'x'.repeat(10001) }]) {
    assert.equal((await f.gateway('conversation.relevance', payload)).status, 400);
  }
  assert.equal((await f.gateway('conversation.relevance', { text: 'x' }, { project: 'unavailable-project' })).status, 403);
  assert.equal((await f.gateway('conversation.relevance', { text: 'x' }, { user: 'fake-device' })).status, 403);
  assert.equal((await f.gateway('conversation.relevance', { text: 'x' }, { credential: browserCredential })).status, 401);
  assert.equal((await f.gateway('conversation.relevance', { text: 'x' }, { conversationId: 'legacy' })).status, 403);
  assert.equal(f.modelCalls.length, calls);
});

test('Slack vision configuration cannot silently select a different model', async t => {
  const invalid = await fixture(t, { visionProvider: { model: 'wrong-image-model' } });
  const rejected = await invalid.gateway('conversation.create', { operationId: 'create-wrong-model' }, { id: 'create-wrong-model' });
  assert.equal(rejected.status, 503); assert.equal(rejected.body.error.code, 'INVALID_VISION_PROVIDER');
  assert.equal(invalid.modelCalls.length, 0);
  const valid = await fixture(t, { visionProvider: { model: 'glm-5.3-flash' } });
  const id = await valid.newConversation('create-fixed-vision');
  assert.equal((await valid.browser(id)).body.executionMode, 'manual');
});

test('Slack-created and browser-bound conversations retain manual mode and shared history across restart', async t => {
  const f = await fixture(t), conversation = await f.newConversation('create-shared');
  assert.equal((await f.browser(conversation)).body.executionMode, 'manual');
  assert.equal((await f.browser(conversation)).body.compaction.thresholdTokens, 8192, 'Manual chat uses the early compact profile');
  assert.equal((await f.browser('main')).body.compaction.thresholdTokens, 500000, 'Normal execution profile remains unchanged');
  const created = await f.browser('main', { suffix: '/conversations/new', body: { id: 'browser-original-chat' } });
  assert.equal(created.status, 201); const boundId = created.body.id;
  const bind = await f.gateway('conversation.bind', { conversationId: boundId }, { id: 'bind-original-chat' });
  assert.equal(bind.status, 200, JSON.stringify(bind.body));
  const submit = await f.gateway('conversation.submit', { text: 'Slack first message' }, { id: 'slack-first', conversationId: conversation });
  assert.equal(submit.status, 200, JSON.stringify(submit.body)); assert.equal(submit.body.data.accepted, true);
  const state = await f.wait(conversation, value => value.status === 'waiting-for-user' && !value.activeTurnId);
  const slackMessage = state.messages.find(message => message.requestId === 'slack-first' && message.role === 'user');
  assert.equal(slackMessage.text, 'Slack first message'); assert.equal(slackMessage.source, 'slack');
  assert.equal(slackMessage.actor.userId, userId); assert.equal(slackMessage.actor.teamId, teamId); assert.ok(slackMessage.id);
  assert.equal((await f.browser(conversation, { body: { id: 'browser-second', text: 'Browser continues the same thread' } })).status, 202);
  await f.wait(conversation, value => value.status === 'waiting-for-user' && value.acceptedRequestIds.includes('browser-second'));
  const pluginView = await f.gateway('conversation.state', {}, { conversationId: conversation });
  assert.ok(pluginView.body.data.messages.some(message => message.requestId === 'browser-second' && message.text === 'Browser continues the same thread'));
  await f.restart();
  assert.equal((await f.browser(boundId)).body.executionMode, 'manual');
  const after = (await f.browser(conversation)).body;
  assert.equal(after.executionMode, 'manual'); assert.equal(after.messages.filter(message => message.role === 'user').length, 2);
  assert.ok(after.messages.some(message => message.id === slackMessage.id));
  const repeated = await f.newConversation('create-shared'); assert.equal(repeated, conversation);
  assert.ok(f.modelCalls.length >= 2, 'Requests actually exercised the controlled model provider');
});

test('Public manual conversation uses lean role and unchanged native schemas without weakening normal execution', async t => {
  const f = await fixture(t), conversation = await f.newConversation('role-manual');
  assert.equal((await f.gateway('conversation.submit', { text: 'role-first' }, { id: 'role-first', conversationId: conversation })).status, 200);
  await f.wait(conversation, value => value.status === 'waiting-for-user' && !value.activeTurnId);
  const manualCall = f.modelCalls.at(-1);
  assert.match(manualCall.system, /不创建、派发或恢复执行 Session/);
  assert.doesNotMatch(manualCall.system, /系统为新任务创建独立执行 Session|自动发起中断恢复/);
  assert.match(manualCall.system, /Current project facts/);
  assert.match(manualCall.system, /本轮答复发往 Slack/);
  assert.deepEqual(manualCall.tools, selectCoordinatorTools(filterManualTools(coordinatorTools), { fileWrite: false }),
    'Retain enabled manual native definitions, not a text-only substitute');
  const callsBefore = f.modelCalls.length;
  assert.equal((await f.gateway('conversation.submit', { text: 'show-node-complete' }, { id: 'role-show', conversationId: conversation })).status, 200);
  const shown = await f.wait(conversation, value => value.status === 'waiting-for-user' && !value.activeTurnId && value.acceptedRequestIds.includes('role-show'));
  assert.equal(f.modelCalls.length, callsBefore + 1, 'Successful presentation of an existing answer needs no second model round');
  const replies = shown.messages.filter(m => m.role === 'assistant' && m.requestId === 'role-show');
  assert.equal(replies.length, 1); assert.equal(replies[0].text, 'This is the complete read-only answer.');
  assert.equal(replies[0].actions[0].kind, 'node-references');
  assert.equal((await f.browser('main', { body: { id: 'role-automatic', text: 'role-automatic' } })).status, 202);
  await f.wait('main', value => value.status === 'waiting-for-user' && !value.activeTurnId);
  const automaticCall = f.modelCalls.at(-1);
  assert.match(automaticCall.system, /系统为新任务创建独立执行 Session/);
  assert.doesNotMatch(automaticCall.system, /本轮答复发往 Slack|以下仅用于宿主已声明的人工执行对话/);
  assert.deepEqual(automaticCall.tools, selectCoordinatorTools(coordinatorTools, { fileWrite: false }));
  await f.restart();
  assert.equal((await f.gateway('conversation.submit', { text: 'role-after-restart' }, { id: 'role-after-restart', conversationId: conversation })).status, 200);
  await f.wait(conversation, value => value.status === 'waiting-for-user' && !value.activeTurnId);
  assert.doesNotMatch(f.modelCalls.at(-1).system, /系统为新任务创建独立执行 Session/);
  assert.deepEqual(f.modelCalls.at(-1).tools, manualCall.tools);
});

test('Browser retries of a failed Slack turn retain verified Slack actor/source and reject caller-forged identity', async t => {
  const f = await fixture(t), conversation = await f.newConversation('create-retry');
  const payload = { text: 'failure-then-browser-retry' };
  assert.equal((await f.gateway('conversation.submit', payload, { id: 'failed-slack-turn', conversationId: conversation })).status, 200);
  const failed = await f.wait(conversation, value => value.status === 'error');
  assert.equal(failed.error.code, 'FIXTURE_PROVIDER_FAILURE'); assert.equal(failed.retryInput.source, 'slack');
  assert.equal((await f.browser(conversation, { body: { id: 'failed-slack-turn', ...payload, retry: true, source: 'workflow' } })).status, 400);
  const retry = await f.browser(conversation, { body: { id: 'failed-slack-turn', ...payload, retry: true } });
  assert.equal(retry.status, 202, JSON.stringify(retry.body));
  const done = await f.wait(conversation, value => value.status === 'waiting-for-user' && !value.activeTurnId);
  const users = done.messages.filter(message => message.role === 'user' && message.requestId === 'failed-slack-turn');
  assert.equal(users.length, 1); assert.equal(users[0].source, 'slack'); assert.equal(users[0].actor.userId, userId);
});

async function prepared(f, conversation, name, id) {
  const result = await f.gateway('conversation.submit', { text: name }, { id, conversationId: conversation });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const state = await f.wait(conversation, value => value.status === 'waiting-for-user' && !value.activeTurnId &&
    value.approvals.some(proposal => proposal.manual && proposal.pending));
  return state.approvals.find(proposal => proposal.manual && proposal.pending);
}
async function assertNoDispatch(f) {
  const state = await f.main(); assert.deepEqual(Object.keys(state.sessions), []);
  for (const repositoryId of ['123', '124']) {
    const state = await readJSON(path.join(f.directory, 'interface-v2', hash(repositoryId), 'protocol-v2.json'), {});
    assert.equal(Object.keys(state.sessionCreations || {}).length, 0);
    assert.equal(Object.keys(state.projectTasks || {}).length, 0);
    assert.equal(Object.keys(state.tasks || {}).length, 0);
    assert.equal(Object.keys(state.bindings || {}).length, 0);
  }
}

test('Slack brief approval and browser approval use shared Main CAS, receipts and manual work-item identities', async t => {
  const f = await fixture(t), conversation = await f.newConversation('create-approval');
  const proposal = await prepared(f, conversation, 'prepare-new', 'prepare-new-message');
  assert.equal((await f.main()).main.memory.map.root.todos.length, 1, 'Proposal preparation cannot create a Main TODO');
  const review = { proposalId: proposal.id, version: proposal.version, decision: 'approved', reason: 'Exact brief accepted' };
  const approved = await f.gateway('brief.review', review, { id: 'slack-approval', conversationId: conversation });
  assert.equal(approved.status, 200, JSON.stringify(approved.body)); assert.match(approved.body.data.prompt, /执行需求/);
  assert.match(approved.body.data.prompt, /Current project facts/, 'Root Map memory uses the root-level fs-v2.1 memory.md path');
  const todo = (await f.main()).main.memory.map.root.todos.find(item => item.id === proposal.itemId);
  assert.equal(todo.executionMode, 'manual'); assert.equal(todo.status, 'pending'); assert.equal(todo.approvedBrief.actor.userId, userId);
  await assertNoDispatch(f);
  const revision = (await f.main()).revision;
  assert.deepEqual((await f.gateway('brief.review', review, { id: 'slack-approval', conversationId: conversation })).body, approved.body);
  assert.equal((await f.main()).revision, revision);
  await f.wait(conversation, value => value.status === 'waiting-for-user' && !value.activeTurnId);
  const browserView = (await f.browser(conversation)).body;
  assert.equal(browserView.approvals.find(item => item.id === proposal.id).pending, false);
  const exported = await f.gateway('prompt.read', { proposalId: proposal.id }, { conversationId: conversation });
  assert.equal(exported.body.data.text, approved.body.data.prompt);
  const bugProposal = await prepared(f, conversation, 'prepare-bug', 'prepare-bug-message');
  const browserApproved = await f.browser(conversation, { suffix: '/approval', body: { id: 'browser-approval', proposalId: bugProposal.id,
    version: bugProposal.version, decision: 'approved', reason: 'Original Bug accepted from workbench' } });
  assert.equal(browserApproved.status, 200, JSON.stringify(browserApproved.body));
  const bug = (await f.main()).main.memory.map.root.bugs[0];
  assert.equal(bug.id, 'B1'); assert.equal(bug.createdAt, 'original-bug'); assert.equal(bug.attempts[0].cause, 'Token expired');
  assert.equal(bug.executionMode, 'manual'); assert.equal(bug.status, 'open');
  assert.equal(bug.approvedBrief.actor.sessionId, 'browser-human'); await assertNoDispatch(f);
  const afterBrowser = (await f.main()).revision;
  assert.equal((await f.browser(conversation, { suffix: '/approval', body: { id: 'browser-approval', proposalId: bugProposal.id,
    version: bugProposal.version, decision: 'approved', reason: 'Original Bug accepted from workbench' } })).status, 200);
  assert.equal((await f.main()).revision, afterBrowser);
  assert.ok(f.modelCalls.filter(call => call.tools?.length).every(call => !call.tools.some(tool => ['dispatch_task', 'request_ci', 'complete_task'].includes(tool.name))),
    'Manual conversation model calls cannot receive automatic Agent tools');
});

test('Stale brief confirmation fails without Main or Agent mutations after a concurrent map update', async t => {
  const f = await fixture(t), conversation = await f.newConversation('create-stale');
  const proposal = await prepared(f, conversation, 'prepare-stale', 'prepare-stale-message');
  const before = await f.main();
  assert.equal((await f.gateway('map.write', { baseVersion: before.main.version,
    operations: [{ type: 'update', id: 'T0', fields: { memoryDocument: 'Concurrent verified update' } }] }, { id: 'concurrent-map' })).status, 200);
  const changed = await f.main();
  const rejected = await f.gateway('brief.review', { proposalId: proposal.id, version: proposal.version, decision: 'approved', reason: 'Stale confirmation' },
    { id: 'stale-approval', conversationId: conversation });
  assert.equal(rejected.status, 409); assert.equal(rejected.body.error.code, 'VERSION_CONFLICT');
  const after = await f.main(); assert.equal(after.revision, changed.revision); assert.deepEqual(after.main.memory.map, changed.main.memory.map);
  await assertNoDispatch(f);
});

for (const scenario of [
  { name:'explicit Bug intent in a TODO-focused conversation', mount:'mount-todo', input:{taskId:'B1',kind:'bug'} },
  { name:'explicit Bug intent in another Bug-focused conversation', mount:'mount-bug', input:{taskId:'B1',kind:'bug'} },
  { name:'explicit other node in a Bug-focused conversation', mount:'mount-bug', input:{taskId:'B1',nodeId:'OTHER'} },
  { name:'explicit TODO intent in a Bug-focused conversation', mount:'mount-bug', input:{taskId:'new-todo',kind:'todo'} },
]) test(`Manual focus cannot replace ${scenario.name} when item identity is incomplete`, async t => {
  const f = await fixture(t,{prepareInput:scenario.input}),conversation=await f.newConversation('partial-identity');
  assert.equal((await f.gateway('conversation.submit',{text:scenario.mount},{id:'mount-focus',conversationId:conversation})).status,200);
  const mounted=await f.wait(conversation,value=>value.status==='waiting-for-user'&&!value.activeTurnId&&value.acceptedRequestIds.includes('mount-focus'));
  assert.equal(mounted.conversations.find(item=>item.id===conversation).itemId, undefined,
    'Mounting focuses a node without creating a Main work item');
  // Existing item conversations still need the routing protection after the
  // mount-only flow stopped creating items. Seed a persisted legacy focus.
  const registry=new CoordinatorConversations(path.join(f.directory,'coordinators',projectId));
  await registry.setFocus(conversation, { nodeId:'T0', kind:scenario.mount==='mount-bug'?'bug':'todo',
    itemId:scenario.mount==='mount-bug'?'B1':'TD-old' });
  await f.restart();
  const before=await f.main();
  assert.equal((await f.gateway('conversation.submit',{text:'prepare-explicit-routing'},{id:'partial-prepare',conversationId:conversation})).status,200);
  const settled=await f.wait(conversation,value=>value.status==='waiting-for-user'&&!value.activeTurnId&&value.acceptedRequestIds.includes('partial-prepare'));
  assert.equal(settled.approvals.filter(x=>x.manual).length,0,'No brief may silently adopt the focus instead of the explicit routing');
  const raw=await readJSON(registry.conversationFile(conversation));
  const reply=raw.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).find(b=>b.type==='tool_result'&&b.tool_use_id==='tool-explicit-routing');
  assert.equal(reply?.is_error,true);
  assert.equal(JSON.parse(reply.content).error.code,'INVALID_ARGUMENT');
  assert.deepEqual(await f.main(),before,'A failed proposal must not mutate any Main item');
  await assertNoDispatch(f);
});

test('Manual mount does not write Main and keeps node focus without an execution Session', async t => {
  const f = await fixture(t), conversation = await f.newConversation('create-mounted-bug');
  const before = await f.main();
  const mounted = await f.gateway('conversation.submit', { text: 'mount-bug' }, { id: 'mount-bug-message', conversationId: conversation });
  assert.equal(mounted.status, 200, JSON.stringify(mounted.body));
  const settled = await f.wait(conversation, value => value.status === 'waiting-for-user' && !value.activeTurnId);
  assert.equal(settled.conversationId, conversation); assert.equal(settled.executionMode, 'manual');
  const main = await f.main();
  assert.equal(main.revision, before.revision);
  assert.equal(main.main.memory.map.root.bugs.length, 1);
  assert.equal(main.main.memory.map.root.bugs[0].id, 'B1');
  assert.equal(main.main.memory.map.root.todos.length, 1);
  const focus = settled.conversations.find(item => item.id === conversation);
  assert.equal(focus.nodeId, 'T0'); assert.equal(focus.kind, 'bug'); assert.equal(focus.itemId, undefined);
  await assertNoDispatch(f);
  await f.restart();
  const restored = (await f.browser(conversation)).body.conversations.find(item => item.id === conversation);
  assert.equal(restored.itemId, undefined); assert.equal(restored.kind, 'bug'); assert.equal(restored.nodeId, 'T0'); assert.equal(restored.executionMode, 'manual');
  const proposal = await prepared(f, conversation, 'prepare-new', 'prepare-mounted-bug-message');
  assert.equal(proposal.kind, 'todo'); assert.equal(proposal.nodeId, 'T0'); assert.notEqual(proposal.itemId, 'B1');
  const approved = await f.gateway('brief.review', { proposalId: proposal.id, version: proposal.version,
    decision: 'approved', reason: 'Approve the brief after mount' }, { id: 'approve-mounted-bug', conversationId: conversation });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.data.itemId, proposal.itemId); assert.equal(approved.body.data.kind, 'todo');
  const after = (await f.main()).main.memory.map.root;
  assert.equal(after.bugs.length, 1); assert.equal(after.bugs[0].id, 'B1'); assert.equal(after.bugs[0].createdAt, 'original-bug');
  assert.equal(after.todos.find(item => item.id === proposal.itemId).executionMode, 'manual');
  await assertNoDispatch(f);
});

test('Brief confirmation while Coordinator is busy survives restart and notifies exactly once with a persisted acknowledgement', async t => {
  const f = await fixture(t), conversation = await f.newConversation('create-busy-review');
  const proposal = await prepared(f, conversation, 'prepare-new', 'prepare-busy-review');
  const started = await f.gateway('conversation.submit', { text: 'hold-busy-turn' }, { id: 'held-turn', conversationId: conversation });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  await f.wait(conversation, value => value.activeTurnId === 'held-turn' && value.status === 'running');
  const approved = await f.gateway('brief.review', { proposalId: proposal.id, version: proposal.version, decision: 'approved', reason: 'Approve while another turn is in progress' },
    { id: 'approve-while-busy', conversationId: conversation });
  assert.equal(approved.status, 200, JSON.stringify(approved.body)); assert.equal(approved.body.data.notification.pending, true);
  const reviewFile = path.join(f.directory, 'manual-briefs', projectId, 'manual-briefs.json');
  assert.equal((await readJSON(reviewFile)).proposals[proposal.id].review.notified, undefined, 'Pending notification must remain recoverable');
  assert.ok((await f.main()).main.memory.map.root.todos.find(item => item.id === proposal.itemId), 'Approval commits Main even when Coordinator is busy');
  await f.restart();
  const notified = await f.wait(conversation, value => value.status === 'waiting-for-user' && !value.activeTurnId &&
    value.approvals.find(item => item.id === proposal.id)?.review?.notified === true);
  const receiptMessages = notified.messages.filter(message => message.role === 'user' && message.source === 'workflow' && message.text.includes(proposal.id));
  assert.equal(receiptMessages.length, 1); assert.ok(receiptMessages[0].requestId.startsWith('manual-review-'));
  assert.equal((await readJSON(reviewFile)).proposals[proposal.id].review.notified, true);
  const revision = (await f.main()).revision;
  await f.restart();
  const after = await f.wait(conversation, value => value.status === 'waiting-for-user' && !value.activeTurnId);
  const replayMessages = after.messages.filter(message => message.role === 'user' && message.source === 'workflow' && message.text.includes(proposal.id));
  assert.equal(replayMessages.length, 1); assert.equal(replayMessages[0].requestId, receiptMessages[0].requestId);
  assert.equal((await f.main()).revision, revision); await assertNoDispatch(f);
});

test('Long exported execution prompt does not exceed workflow input limits or leak into every approval snapshot', async t => {
  const f = await fixture(t), conversation = await f.newConversation('create-long-prompt');
  const initial = await f.main(), sentinel = 'LONG-MEMORY-CONTENT-FOR-EXPORT';
  const memoryDocument = `${sentinel}\n${'Precise module knowledge. '.repeat(420)}`;
  assert.ok(memoryDocument.length > 8000 && memoryDocument.length < 12000);
  const changed = await f.gateway('map.write', { baseVersion: initial.main.version,
    operations: [{ type: 'update', id: 'T0', fields: { purpose: memoryDocument } }] }, { id: 'write-long-node-context' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  const proposal = await prepared(f, conversation, 'prepare-new', 'prepare-long-prompt');
  const approved = await f.gateway('brief.review', { proposalId: proposal.id, version: proposal.version, decision: 'approved', reason: 'Approve the exact long-context task' },
    { id: 'approve-long-prompt', conversationId: conversation });
  assert.equal(approved.status, 200, JSON.stringify(approved.body)); assert.ok(approved.body.data.prompt.length > 8000);
  assert.match(approved.body.data.prompt, new RegExp(sentinel)); assert.equal(approved.body.data.notification.pending, false);
  const state = await f.wait(conversation, value => value.status === 'waiting-for-user' && !value.activeTurnId &&
    value.approvals.find(item => item.id === proposal.id)?.review?.notified === true);
  const approval = state.approvals.find(item => item.id === proposal.id);
  assert.equal(approval.review.result.prompt, undefined); assert.doesNotMatch(JSON.stringify(approval), new RegExp(sentinel));
  const workflow = state.messages.filter(message => message.role === 'user' && message.source === 'workflow' && message.text.includes(proposal.id));
  assert.equal(workflow.length, 1); assert.ok(workflow[0].text.length < 8000); assert.doesNotMatch(workflow[0].text, new RegExp(sentinel));
  const exported = await f.gateway('prompt.read', { proposalId: proposal.id }, { conversationId: conversation });
  assert.equal(exported.status, 200); assert.equal(exported.body.data.text, approved.body.data.prompt); await assertNoDispatch(f);
});

test('Slack map array writes require explicit manual mode for new items, preserve old items and replay idempotently', async t => {
  const f = await fixture(t), before = await f.main(), old = before.main.memory.map.root.todos[0];
  const missingMode = await f.gateway('map.write', { baseVersion: before.main.version,
    operations: [{ type: 'update', id: 'T0', fields: { todos: [old, { id: 'TD-missing-mode', title: 'Missing manual marker', status: 'pending' }] } }] }, { id: 'missing-mode-map-write' });
  assert.equal(missingMode.status, 400, JSON.stringify(missingMode.body)); assert.equal(missingMode.body.error.code, 'INVALID_ARGUMENT');
  assert.deepEqual((await f.main()).main.memory.map, before.main.memory.map); assert.equal((await f.main()).revision, before.revision);
  const payload = { baseVersion: before.main.version,
    operations: [{ type: 'update', id: 'T0', fields: { todos: [old, { id: 'TD-new-slack', title: 'New Slack requirement', status: 'pending', executionMode: 'manual' }] } }] };
  const result = await f.gateway('map.write', payload, { id: 'array-map-write' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const after = await f.main(), todos = after.main.memory.map.root.todos;
  assert.deepEqual(todos.find(item => item.id === old.id), old, 'Sending a whole editor array cannot take over unrelated preexisting items');
  assert.equal(todos.find(item => item.id === 'TD-new-slack').executionMode, 'manual');
  assert.deepEqual((await f.gateway('map.write', payload, { id: 'array-map-write' })).body, result.body);
  assert.equal((await f.main()).revision, after.revision); assert.equal((await f.main()).main.memory.map.root.todos.length, 2);
  assert.equal((await f.gateway('map.write', { baseVersion: before.main.version,
    operations: [{ type: 'update', id: 'T0', fields: { todos: [] } }] }, { id: 'stale-array-map-write' })).body.error.code, 'VERSION_CONFLICT');
});

test('Slack validates direct Bug operations and retains manual markers before committing Main', async t => {
  const f = await fixture(t), before = await f.main();
  const bug = { id: 'B99999', title: 'Slack Bug', status: 'open' };
  const invalid = [
    { type: 'attach-bug', id: 'T0', bug },
    { type: 'attach-bug', id: 'T0', bug: { ...bug, executionMode: 'automatic' } },
    { type: 'attach-bug', bug },
    { type: 'recover-bug', id: 'T0', bug },
    { type: 'document', fields: { unassigned_bugs: [bug] } },
    { type: 'create', parentId: 'T0', node: { id: 'N1', title: 'New node', kind: 'module', state: 'dirty', owns: [], bugs: [bug] } },
  ];
  for (const [index, operation] of invalid.entries()) {
    const result = await f.gateway('map.write', { baseVersion: before.main.version, operations: [operation] }, { id: `invalid-direct-bug-${index}` });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(result.body.error.code, 'INVALID_ARGUMENT');
    assert.deepEqual(await f.main(), before, 'Rejected operations must not change Main, receipts or events');
  }
  const manualBug = { ...bug, executionMode: 'manual' };
  const payload = { baseVersion: before.main.version, operations: [{ type: 'attach-bug', id: 'T0', bug: manualBug }] };
  const attached = await f.gateway('map.write', payload, { id: 'manual-direct-bug' });
  assert.equal(attached.status, 200, JSON.stringify(attached.body));
  const after = await f.main();
  assert.deepEqual(after.main.memory.map.root.bugs.find(item => item.id === bug.id), manualBug);
  assert.deepEqual((await f.gateway('map.write', payload, { id: 'manual-direct-bug' })).body, attached.body);
  assert.deepEqual(await f.main(), after);
  const intake = new CoordinatorMapIntake({ directory: path.join(f.directory, 'manual-bug-intake'), read: f.main,
    service: { submit: async () => assert.fail('Slack work must not enter automatic intake') } });
  assert.equal(intake.items(after.main.memory.map.root).some(entry => entry.item.id === bug.id), false);
  for (const executionMode of [undefined, 'automatic']) {
    const bugs = after.main.memory.map.root.bugs.map(item => item.id === bug.id ? { ...item, executionMode } : item);
    const result = await f.gateway('map.write', { baseVersion: after.main.version,
      operations: [{ type: 'update', id: 'T0', fields: { bugs } }] }, { id: `strip-marker-${executionMode || 'missing'}` });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.deepEqual(await f.main(), after);
  }
  const recovery = await f.gateway('map.write', { baseVersion: after.main.version,
    operations: [{ type: 'recover-bug', id: 'T0', bug: manualBug }] }, { id: 'manual-recovery-still-forbidden' });
  assert.equal(recovery.status, 403);
  assert.equal(recovery.body.error.code, 'FORBIDDEN_RECOVERY');
});

test('A legacy unassigned Bug cannot bypass the marker check on a node without a Bug array', async t => {
  const bug = { id: 'B7777', title: 'Existing unassigned Bug', status: 'open' };
  const f = await fixture(t, { initialMap: { project: 'Fixture', root: {
    id: 'T0', title: 'Legacy node', kind: 'module', state: 'dirty', owns: [], children: [],
  }, unassigned_bugs: [bug] } });
  const before = await f.main();
  const rejected = await f.gateway('map.write', { baseVersion: before.main.version,
    operations: [{ type: 'attach-bug', id: 'T0', bug }] }, { id: 'shadow-unassigned-bug' });
  assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
  assert.deepEqual(await f.main(), before);
  const unchanged = await f.gateway('map.write', { baseVersion: before.main.version,
    operations: [{ type: 'attach-bug', bug }] }, { id: 'unchanged-unassigned-bug' });
  assert.equal(unchanged.status, 200, JSON.stringify(unchanged.body));
  assert.deepEqual((await f.main()).main.memory.map.unassigned_bugs, [bug]);
});

test('Coordinator attachments are shared with authenticated browser and isolated by project without Quark', async t => {
  const f = await fixture(t), uploaded = await f.gateway('attachment.upload', { filename: 'screenshot.png', mimeType: 'image/png', base64: png }, { id: 'upload-screenshot' });
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body)); const attachment = uploaded.body.data;
  assert.equal(attachment.hash, hash(Buffer.from(png, 'base64'))); assert.equal(attachment.base64, undefined);
  const pathFor = id => `${f.cloud.url}/api/workbench/projects/${id}/api/coordinator/attachments/${attachment.id}`;
  const unauthorized = await fetch(pathFor(projectId)); assert.equal(unauthorized.status, 401);
  const response = await fetch(pathFor(projectId), { headers });
  assert.equal(response.status, 200, await response.clone().text()); assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(png, 'base64'));
  const wrongProject = await fetch(pathFor(otherProjectId), { headers }); assert.equal(wrongProject.status, 404);
  assert.equal((await f.gateway('attachment.read', { id: attachment.id }, { project: otherProjectId })).status, 404);
  assert.equal((await f.gateway('attachment.read', { id: attachment.id })).body.data.base64, png);
});

test('Closing Cloud closes integration subscriptions and listener with no surviving HTTP endpoint', async t => {
  const f = await fixture(t), conversation = await f.newConversation('create-close');
  const listener = f.cloud.integrationUrl;
  const query = new URLSearchParams({ teamId, userId, projectId, conversationId: conversation });
  const events = await fetch(`${listener}/v1/events?${query}`, { headers: { Authorization: `Bearer ${integrationCredential}` } });
  assert.equal(events.status, 200); const reader = events.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: state/);
  await f.cloud.close();
  assert.equal((await reader.read()).done, true);
  await assert.rejects(fetch(listener + '/v1/command'), /fetch failed/);
});
