import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store, threadKey, digest } from '../src/store.mjs';
import { SlackPlugin, envelopeId } from '../src/plugin.mjs';
import { SlackIO, UncertainDelivery } from '../src/slack-io.mjs';
import { Gateway } from '../src/gateway.mjs';
import { homeView, formValues, messageBlocks, approvalBlocks } from '../src/views.mjs';
import { plainText } from '../src/plain-text.mjs';

const teamId = 'T0BRW7G4Q6P', user = 'U000001', channel = 'C000001', bot = 'U000BOT';

test('Coordinator prose is plain text while links code and identifiers remain readable', () => {
  const source = '# 首页\n\n**定位**：`BLOG-READ-HOME`，_公开首页_。\n\n- [完整 Map](https://map.example.com/a?q=1&x=2)\n- ~~旧描述~~\n\n```js\nconst value = 2 ** 3; // _literal_\n```\n\n| 字段 | 值 |\n| --- | --- |\n| 状态 | 正常 |';
  const value = plainText(source);
  assert.match(value, /首页\n\n定位：BLOG-READ-HOME，公开首页/);
  assert.match(value, /完整 Map（https:\/\/map.example.com\/a\?q=1&x=2）/);
  assert.match(value, /const value = 2 \*\* 3; \/\/ _literal_/);
  assert.match(value, /字段：状态；值：正常/);
  assert.doesNotMatch(value, /```|\*\*定位|~~|\[完整 Map\]|^#/m);
  assert.equal(plainText('[不要打开](javascript:alert(1))'), '不要打开');
  assert.equal(plainText('<https://map.example.com/a|查看 Map>'), '查看 Map（https://map.example.com/a）');
  assert.equal(plainText('目录 foo_bar 和 2 * 3 保留'), '目录 foo_bar 和 2 * 3 保留');
  assert.equal(plainText('[接口规范](docs/interface.md)'), '接口规范（docs/interface.md）');
  assert.equal(plainText('[日志](file:///tmp/run.log)'), '日志（file:///tmp/run.log）');
  assert.equal(plainText('[邮箱](mailto:test@example.com)'), '邮箱（mailto:test@example.com）');
  assert.equal(plainText('`&lt;div&gt; &amp;`'), '&lt;div&gt; &amp;');
  const code = '{"link":"<https://example.com|标题>"}\npayload="""a\n\n\nb"""';
  assert.equal(plainText('```python\n' + code + '\n```'), code);
  assert.equal(plainText('`<https://example.com|标题>`'), '<https://example.com|标题>');
  assert.equal(plainText('| `字段` | 值 |\n| --- | --- |\n| a | 1 |\n| b | 2 |'), '字段：a；值：1\n字段：b；值：2');
  assert.equal(plainText('[不要打开](java&#x09;script:alert(1))'), '不要打开');
  const blocks = messageBlocks({ text: source }, 'thread');
  assert.ok(blocks.every(block => block.type !== 'section' || block.text.type === 'plain_text'));
  assert.equal(blocks.map(block => block.text?.text || '').join(''), value);
});

test('Slack post and update disable markdown in fallback text and streamed output', async t => {
  const f = await fixture(t), calls = [];
  const io = new SlackIO({ store: f.store, botUserId: bot, wait: async () => {}, client: { async apiCall(method, args) { calls.push({ method, args }); return { ts: '1.0' }; } } });
  await io.post({ id: 'plain-message', channel, text: '**首页**：`BLOG-READ-HOME`' });
  await io.update(channel, '1.0', '**首页**：`BLOG-READ-HOME`');
  for (const call of calls) { assert.equal(call.args.mrkdwn, false); assert.equal(call.args.text, '首页：BLOG-READ-HOME'); }
  await io.update(channel, '1.0', '<@U000001> & 普通文字');
  assert.equal(calls.at(-1).args.text, '&lt;@U000001&gt; &amp; 普通文字');
  assert.equal(calls.at(-1).args.parse, 'none'); assert.equal(calls.at(-1).args.link_names, false);
});

test('Completed node presentations render plain Slack links from the trusted project binding', () => {
  const context = { cloudOrigin: 'https://map.example.com', projectId: 'test-project' };
  const blocks = messageBlocks({ text: '首页负责入口，文章页负责正文。', actions: [
    { kind: 'node-references', nodes: [{ id: 'HOME', title: '**首页**', url: 'https://attacker.example/' }] },
    { kind: 'node-navigation', node: { id: 'POST & 阅读', title: '文章页' } },
    { kind: 'node-tour', nodes: [{ id: 'HOME', title: '重复首页' }, { id: 'LOGIN', title: '<@U000001>' }] },
    { kind: 'node-read', node: { id: 'OTHER', title: '仅读取不展示' } },
  ] }, 'thread', context);
  assert.equal(blocks[0].text.type, 'plain_text');
  const buttons = blocks.filter(block => block.type === 'actions').flatMap(block => block.elements);
  assert.deepEqual(buttons.map(button => button.text.text), ['首页', '文章页', '<@U000001>']);
  assert.equal(new Set(buttons.map(button => button.action_id)).size, 3);
  assert.deepEqual(buttons.map(button => new URL(button.url).searchParams.get('relation')), ['HOME', 'POST & 阅读', 'LOGIN']);
  for (const button of buttons) {
    const url = new URL(button.url);
    assert.equal(url.origin, context.cloudOrigin); assert.equal(url.pathname, '/projects/test-project');
    assert.equal(button.text.type, 'plain_text'); assert.equal(button.value, undefined);
  }
  assert.doesNotMatch(JSON.stringify(blocks), /attacker/);
  const message = { text: '入口', actions: [{ kind: 'node-navigation', node: { id: 'HOME', title: '首页' } }] };
  for (const invalid of [undefined, { ...context, cloudOrigin: 'javascript:alert(1)' },
    { ...context, cloudOrigin: 'https://secret@map.example.com' }, { ...context, projectId: '..' }]) {
    assert.equal(messageBlocks(message, 'thread', invalid).some(block => block.type === 'actions'), false);
  }
  const many = messageBlocks({ text: '入口', actions: [{ kind: 'node-tour', nodes: Array.from({ length: 30 }, (_, index) => ({ id: `N${index}`, title: '标题'.repeat(100) })) }] }, 'thread', context);
  const links = many.filter(block => block.type === 'actions');
  assert.equal(links.flatMap(block => block.elements).length, 30, 'Do not silently omit valid nodes from a multi-tool presentation');
  assert.ok(links.every(block => block.elements.length <= 5));
  assert.ok(links.flatMap(block => block.elements).every(button => button.text.text.length <= 75));
  const overflow = messageBlocks({ text: '段'.repeat(110000), actions: [{ kind: 'node-tour', nodes: Array.from({ length: 70 }, (_, index) => ({ id: `N${index}`, title: `节点${index}` })) }] }, 'thread', context);
  assert.ok(overflow.length <= 49);
  assert.equal(overflow.filter(block => block.type === 'actions').flatMap(block => block.elements).filter(button => button.url.includes('relation=')).length, 60);
  assert.ok(overflow.some(block => block.elements?.some(element => element.type === 'plain_text' && element.text.includes('还有 10 个'))));
  assert.equal(overflow.find(block => block.type === 'actions' && block.elements[0].action_id === 'map_all').elements[0].url, 'https://map.example.com/projects/test-project');
});

test('plugin lockfile is portable outside the developer registry', async () => {
  const lock = JSON.parse(await fs.readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.deepEqual(lock.packages[''].engines, manifest.engines);
  assert.equal(manifest.engines.node, '>=22.19.0');
  assert.equal(manifest.engines.npm, '>=9.6.4');
  const dependencies = Object.entries(lock.packages).filter(([name]) => name);
  assert.ok(dependencies.length > 0);
  for (const [name, entry] of dependencies) {
    const url = new URL(entry.resolved);
    assert.equal(url.protocol, 'https:', name);
    assert.equal(url.hostname, 'registry.npmjs.org', name);
    assert.equal(url.username + url.password + url.search + url.hash, '', name);
    assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+=*$/, name);
  }
});
const project = { id: 'lab', name: 'Lab', version: 'v1', map: { id: 'T0', title: 'Root', children: [{ id: 'login', title: '登录', todos: [{ id: 'TD1', title: 'refresh', status: 'pending' }], bugs: [], memories: [{ text: '现有记忆' }], children: [] }] }, sessions: [{ id: 'session-1', status: 'running' }] };
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-slack-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = await new Store(directory).open(), calls = [], sent = [];
  const gateway = { async command(type, args) {
    calls.push({ type, ...args });
    if (type === 'project.list') return { projects: [{ id: 'lab', name: 'Lab' }] };
    if (type === 'project.read') return structuredClone(project);
    if (type === 'conversation.create') return { conversationId: `chat-${args.payload.operationId}` };
    if (type === 'conversation.bind') return { conversationId: args.payload.conversationId };
    if (type === 'conversation.state') return { status: 'idle', messages: [], approvals: [] };
    if (type === 'conversation.relevance') return { respond: true, reason: 'Controlled relevant message', mainVersion: 'v1' };
    if (type === 'attachment.upload') return { id: 'attachment-1' };
    if (type === 'prompt.read') return { text: 'execute login', filename: 'prompt.md' };
    return { accepted: true };
  } };
  const io = { async post(input) { sent.push(input); return String(100 + sent.length) + '.001'; }, async update(...args) { sent.push({ update: args }); }, async call(method, input) { sent.push({ method, input }); if (method === 'conversations.open') return { channel: { id: 'D000001' } }; if (method === 'conversations.info') return { channel: { user, id: input.channel } }; if (method === 'conversations.members') return { members: [user] }; return {}; },
    async download() { return { filename: 'screen.png', mimeType: 'image/png', base64: 'aGVsbG8=' }; }, async uploadPrompt(input) { sent.push({ export: input }); } };
  const plugin = new SlackPlugin({ store, gateway, io, teamId, cloudOrigin: 'https://map.example.com', botUserId: bot, logger: { warn() {}, error() {} } });
  return { plugin, store, gateway, io, calls, sent, directory };
}
function event(overrides = {}) { return { type: 'message', user, channel, ts: '123.001', text: `<@${bot}> hello`, ...overrides }; }
function formBody(draftId, values) { return { type: 'view_submission', user: { id: user }, view: { private_metadata: draftId, state: { values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value: { value } }])) } } }; }

test('journal is durable before ack; duplicate envelopes remain one pending entry', async t => {
  const f = await fixture(t), body = { team_id: teamId, event_id: 'E1', event: event() }; let acknowledged = 0;
  const ack = async () => { const disk = JSON.parse(await fs.readFile(f.store.file, 'utf8')); assert.equal(Object.keys(disk.inbox).length, 1); acknowledged++; };
  await f.plugin.receive({ type: 'events_api', body, envelope_id: 'one', ack });
  await f.plugin.receive({ type: 'events_api', body, envelope_id: 'retry', ack });
  assert.equal(acknowledged, 2); assert.equal(Object.keys(f.store.data.inbox).length, 1);
  const reopened = await new Store(f.directory).open(); assert.equal(Object.values(reopened.data.inbox)[0].status, 'pending');
});
test('wrong workspace is acknowledged but never recorded or processed', async t => {
  const f = await fixture(t); await f.plugin.receive({ type: 'events_api', body: { team_id: 'OTHER', event: event() }, ack: async () => {} });
  assert.deepEqual(f.store.data.inbox, {}); assert.equal(f.calls.length, 0);
});
test('app_mention/message duplicate and action retries have stable IDs', () => {
  const body = { team_id: teamId, event: event() };
  assert.equal(envelopeId('events_api', body, 'one'), envelopeId('events_api', { ...body, event: { ...body.event, type: 'app_mention' } }, 'two'));
  const action = { team: { id: teamId }, trigger_id: 'trigger1', actions: [{ action_id: 'approve', action_ts: '9', value: 'x' }] };
  assert.equal(envelopeId('interactive', action, 'one'), envelopeId('interactive', action, 'two'));
});
test('ordinary message with bot mention creates same binding before app_mention arrives', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  await f.plugin.message('E1', event()); await f.plugin.message('E1', event({ type: 'app_mention' }));
  assert.equal(f.calls.filter(call => call.type === 'conversation.create').length, 1);
  const submits = f.calls.filter(call => call.type === 'conversation.submit'); assert.equal(submits[0].id, submits[1].id);
  assert.match(submits[0].id, /^[a-zA-Z0-9_-]+$/); assert.equal(submits[0].userId, user);
});
test('untracked channel messages and bots cannot start model turns', async t => {
  const f = await fixture(t); await f.plugin.process('E1', { type: 'events_api', body: { event: event({ text: 'normal message' }) } });
  await f.plugin.process('E2', { type: 'events_api', body: { event: event({ bot_id: 'B', user: bot }) } }); assert.equal(f.calls.length, 0);
});
function projectChoice(f, requestId, projectId = 'lab') {
  const original = f.store.data.inbox[requestId];
  return { type: 'block_actions', user: { id: user }, channel: { id: original.projectPromptEvent.channel },
    message: { ts: original.projectPromptTs }, actions: [{ action_id: 'connect_project:0', value: JSON.stringify({ requestId, projectId }) }] };
}
async function runPluginCycle(plugin) {
  plugin.stopped = false;
  try { await plugin.tick(); await Promise.all([...plugin.processing.values()]); }
  finally { await plugin.stop(); }
}
test('unbound explicit message offers clickable projects and resumes its original query', async t => {
  const f = await fixture(t), original = event({ text: `<@${bot}> 登录刷新有 Bug，请分析` });
  await f.store.receive('onboard', { type: 'events_api', body: { team_id: teamId, event: original } });
  await f.plugin.runEntry('onboard', f.store.data.inbox.onboard);
  const prompt = f.sent.find(input => input.blocks);
  assert.equal(prompt.threadTs, original.ts);
  const button = prompt.blocks.flatMap(block => block.elements || []).find(element => element.action_id === 'connect_project:0');
  assert.equal(button.text.text, 'Lab');
  assert.deepEqual(JSON.parse(button.value), { requestId: 'onboard', projectId: 'lab' });
  assert.equal(f.calls.some(call => call.type.startsWith('conversation.')), false);
  await f.plugin.process('choice', { type: 'interactive', body: projectChoice(f, 'onboard') });
  await runPluginCycle(f.plugin);
  assert.equal(f.store.data.channels[channel], 'lab');
  const submitted = f.calls.find(call => call.type === 'conversation.submit');
  assert.equal(submitted.userId, user); assert.equal(submitted.payload.text, '登录刷新有 Bug，请分析');
  assert.equal(Object.values(f.store.data.threads)[0].threadTs, original.ts);
  assert.ok(f.sent.some(input => input.update?.[2].includes('已关联 Lab')));
  assert.ok(f.sent.some(input => input.method === 'views.publish'));
});
test('project choice duplicate clicks and restart preserve original conversation and submit ID', async t => {
  const f = await fixture(t); await f.plugin.message('onboard', event());
  const body = projectChoice(f, 'onboard');
  await f.plugin.process('choice-1', { type: 'interactive', body });
  await runPluginCycle(f.plugin);
  const restartedStore = await new Store(f.directory).open();
  const restarted = new SlackPlugin({ store: restartedStore, gateway: f.gateway, io: f.io, teamId, cloudOrigin: 'https://map.example.com', botUserId: bot });
  await restarted.process('choice-2', { type: 'interactive', body });
  await runPluginCycle(restarted);
  assert.equal(f.calls.filter(call => call.type === 'conversation.create').length, 1);
  const submitted = f.calls.filter(call => call.type === 'conversation.submit');
  assert.equal(submitted.length, 1);
  assert.equal(restartedStore.data.inbox.onboard.status, 'done');
  assert.equal(Object.keys(restartedStore.data.threads).length, 1);
});
test('unbound DM offers projects and selects only the requesting users preference', async t => {
  const f = await fixture(t); await f.plugin.message('dm-choice', event({ channel: 'D000001', channel_type: 'im', text: '看看登录模块' }));
  await f.plugin.process('dm-select', { type: 'interactive', body: projectChoice(f, 'dm-choice') });
  await runPluginCycle(f.plugin);
  assert.equal(f.store.data.preferences[user], 'lab'); assert.deepEqual(f.store.data.channels, {});
  assert.equal(f.calls.find(call => call.type === 'conversation.submit').payload.text, '看看登录模块');
});
test('project choice rejects another user, channel, message or unoffered project without binding', async t => {
  const f = await fixture(t); await f.plugin.message('onboard', event());
  const body = projectChoice(f, 'onboard');
  for (const changed of [{ ...body, user: { id: 'UOTHER' } }, { ...body, channel: { id: 'COTHER' } },
    { ...body, message: { ts: '999.001' } }, projectChoice(f, 'onboard', 'other')]) {
    await assert.rejects(f.plugin.process('invalid-choice', { type: 'interactive', body: changed }), error => error.code === 'CONFLICT');
  }
  assert.deepEqual(f.store.data.channels, {}); assert.equal(Object.keys(f.store.data.threads).length, 0);
  assert.equal(f.calls.some(call => call.type.startsWith('conversation.')), false);
});
test('stale project buttons cannot overwrite a changed channel or revoked project', async t => {
  const f = await fixture(t); await f.plugin.message('onboard', event());
  await f.store.update(state => { state.channels[channel] = 'other'; });
  await assert.rejects(f.plugin.process('stale-choice', { type: 'interactive', body: projectChoice(f, 'onboard') }), error => error.code === 'CONFLICT');
  assert.equal(f.store.data.channels[channel], 'other');
  await f.store.update(state => { delete state.channels[channel]; });
  f.gateway.command = async type => type === 'project.list' ? { projects: [] } : assert.fail('No conversation should start');
  await assert.rejects(f.plugin.process('revoked-choice', { type: 'interactive', body: projectChoice(f, 'onboard') }), error => error.code === 'CONFLICT');
  assert.deepEqual(f.store.data.channels, {}); assert.equal(Object.keys(f.store.data.threads).length, 0);
});
test('project choice verifies channel membership before changing binding', async t => {
  const f = await fixture(t); await f.plugin.message('onboard', event());
  f.io.call = async method => method === 'conversations.members' ? { members: ['UOTHER'] } : { channel: {} };
  await assert.rejects(f.plugin.process('nonmember-choice', { type: 'interactive', body: projectChoice(f, 'onboard') }), error => error.code === 'CONFLICT');
  assert.deepEqual(f.store.data.channels, {}); assert.equal(Object.keys(f.store.data.threads).length, 0);
});
test('unbound explicit message with no open projects explains unavailable setup without empty actions', async t => {
  const f = await fixture(t); f.gateway.command = async () => ({ projects: [] });
  await f.plugin.message('empty-projects', event());
  assert.ok(f.sent[0].text.includes('没有开放的项目'));
  assert.equal(f.sent[0].blocks.some(block => block.type === 'actions'), false);
  assert.equal(Object.keys(f.store.data.threads).length, 0);
});
test('onboarding continuation uses the normal FIFO lane through held create and BUSY backoff', async t => {
  const f = await fixture(t);
  await f.store.receive('original', { type: 'events_api', body: { event: event({ text: `<@${bot}> 原需求` }) } });
  await f.plugin.runEntry('original', f.store.data.inbox.original);
  await f.plugin.process('select', { type: 'interactive', body: projectChoice(f, 'original') });
  await f.store.receive('correction', { type: 'events_api', body: { event: event({ ts: '123.002', thread_ts: '123.001', text: `<@${bot}> 后续修正` }) } });
  const gateway = f.gateway.command;
  let release, started; const held = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  let busy = true;
  f.gateway.command = async (type, input) => {
    if (type === 'conversation.create') { started(); await held; }
    if (type === 'conversation.submit' && busy) { busy = false; throw Object.assign(new Error('Controlled busy'), { code: 'BUSY' }); }
    return gateway(type, input);
  };
  f.plugin.stopped = false;
  try {
    const first = f.plugin.tick(); await entered; await f.plugin.tick();
    assert.equal(f.store.data.inbox.correction.status, 'pending'); assert.equal(Object.keys(f.store.data.threads).length, 0);
    release(); await first;
    assert.equal(f.store.data.inbox.original.status, 'pending');
    assert.equal(f.store.data.inbox.original.error, 'BUSY');
    await f.plugin.tick(); assert.equal(f.calls.some(call => call.type === 'conversation.submit'), false);
    await f.store.update(state => { state.inbox.original.next = 0; });
    await f.plugin.tick(); await f.plugin.tick();
    assert.deepEqual(f.calls.filter(call => call.type === 'conversation.submit').map(call => call.payload.text), ['原需求', '后续修正']);
    assert.equal(f.calls.filter(call => call.type === 'conversation.create').length, 1);
  } finally { release(); await f.plugin.stop(); }
  assert.equal(f.plugin.messageLanes.size, 0);
});
test('project selection survives restart before execution and repeated clicks preserve backoff', async t => {
  const f = await fixture(t); await f.plugin.message('original', event());
  const body = projectChoice(f, 'original');
  await f.plugin.process('select', { type: 'interactive', body });
  assert.equal(f.store.data.inbox.original.status, 'pending');
  await f.store.update(state => { state.inbox.original.next = 9999999999999; });
  const store = await new Store(f.directory).open();
  const plugin = new SlackPlugin({ store, gateway: f.gateway, io: f.io, teamId, cloudOrigin: 'https://map.example.com', botUserId: bot });
  await plugin.process('duplicate-select', { type: 'interactive', body });
  assert.equal(store.data.inbox.original.next, 9999999999999);
  await store.update(state => { state.inbox.original.next = 0; });
  await runPluginCycle(plugin);
  assert.equal(store.data.inbox.original.status, 'done');
  assert.equal(f.calls.filter(call => call.type === 'conversation.create').length, 1);
  assert.equal(f.calls.filter(call => call.type === 'conversation.submit').length, 1);
});
test('unbound slash ask resumes in the project-choice root instead of opening a second thread', async t => {
  const f = await fixture(t), body = { command: '/cg', text: 'ask 原问题', user_id: user, channel_id: channel, trigger_id: 'fixture-trigger' };
  await f.store.receive('ask', { type: 'slash_commands', body }); await f.plugin.runEntry('ask', f.store.data.inbox.ask);
  const promptTs = f.store.data.inbox.ask.projectPromptTs;
  await f.plugin.process('ask-select', { type: 'interactive', body: projectChoice(f, 'ask') });
  await runPluginCycle(f.plugin);
  assert.equal(Object.values(f.store.data.threads)[0].threadTs, promptTs);
  assert.equal(f.sent.filter(input => input.text?.startsWith('Coordinator ·')).length, 0);
  assert.equal(f.calls.find(call => call.type === 'conversation.submit').payload.text, '原问题');
  await f.store.receive('follow-up', { type: 'events_api', body: { event: event({ ts: '124.001', thread_ts: promptTs, text: `<@${bot}> 继续` }) } });
  await runPluginCycle(f.plugin);
  assert.equal(f.calls.filter(call => call.type === 'conversation.create').length, 1);
  const submitted = f.calls.filter(call => call.type === 'conversation.submit');
  assert.equal(submitted[0].conversationId, submitted[1].conversationId);
});
test('project choice menu stays stable on retry and its buttons have distinct Slack action IDs', async t => {
  const f = await fixture(t), gateway = f.gateway.command;
  f.gateway.command = async (type, input) => type === 'project.list' ? { projects: [{ id: 'lab', name: 'Lab' }, { id: 'other', name: 'Other' }] } : gateway(type, input);
  await f.plugin.message('menu', event()); const original = f.sent.find(input => input.blocks);
  const actions = original.blocks.flatMap(block => block.elements || []);
  assert.equal(new Set(actions.map(action => action.action_id)).size, 2);
  f.gateway.command = async () => ({ projects: [{ id: 'new', name: 'New' }] });
  await f.plugin.message('menu', event());
  const retried = f.sent.filter(input => input.blocks).at(-1);
  assert.deepEqual(retried.blocks, original.blocks);
});
test('stale tick snapshot cannot overwrite a project-choice lane or overtake a requeued request', async t => {
  const f = await fixture(t); await f.plugin.message('original', event({ text: `<@${bot}> 原需求` }));
  await f.store.receive('home', { type: 'events_api', body: { event: { type: 'app_home_opened', user } } });
  await f.store.receive('correction', { type: 'events_api', body: { event: event({ ts: '123.002', thread_ts: '123.001', text: `<@${bot}> 后续修正` }) } });
  let releaseHome, enteredHome, releaseChoice, enteredChoice, holdHome = true;
  const homeHeld = new Promise(resolve => { releaseHome = resolve; }), homeEntered = new Promise(resolve => { enteredHome = resolve; });
  const choiceHeld = new Promise(resolve => { releaseChoice = resolve; }), choiceEntered = new Promise(resolve => { enteredChoice = resolve; });
  const call = f.io.call;
  f.io.call = async (method, input) => {
    if (method === 'views.publish' && holdHome) { holdHome = false; enteredHome(); await homeHeld; }
    return call(method, input);
  };
  f.io.update = async () => { enteredChoice(); await choiceHeld; };
  f.plugin.stopped = false;
  try {
    const tick = f.plugin.tick(); await homeEntered;
    const select = f.plugin.process('choice', { type: 'interactive', body: projectChoice(f, 'original') });
    await choiceEntered; releaseHome(); await tick;
    assert.equal(f.plugin.messageLanes.get(`${channel}:123.001`), 'choice');
    assert.equal(f.store.data.inbox.original.status, 'pending');
    assert.equal(f.calls.some(input => input.type === 'conversation.submit'), false);
    f.plugin.stopped = true; releaseChoice(); await select; f.plugin.stopped = false;
    await f.plugin.tick(); await f.plugin.tick();
    assert.deepEqual(f.calls.filter(input => input.type === 'conversation.submit').map(input => input.payload.text), ['原需求', '后续修正']);
  } finally { releaseHome(); releaseChoice(); await f.plugin.stop(); }
});
test('tracked replies reuse conversation, new roots have independent conversations', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  await f.plugin.message('E1', event()); await f.plugin.message('E2', event({ ts: '123.002', thread_ts: '123.001', text: 'reply' }));
  await f.plugin.message('E3', event({ ts: '124.001' }));
  assert.equal(f.calls.filter(call => call.type === 'conversation.create').length, 2);
  const submits = f.calls.filter(call => call.type === 'conversation.submit'); assert.equal(submits[0].conversationId, submits[1].conversationId); assert.notEqual(submits[1].conversationId, submits[2].conversationId);
});
test('related unmentioned message is classified before creating its conversation', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  await f.plugin.message('related-root', event({ text: '登录模块刷新 token 有 Bug，请分析。' }));
  assert.deepEqual(f.calls.map(call => call.type), ['conversation.relevance', 'conversation.create', 'conversation.submit']);
  const decision = f.store.data.inbox['related-root'].relevance;
  assert.equal(decision.respond, true); assert.equal(decision.mainVersion, 'v1'); assert.equal(decision.projectId, 'lab');
  assert.equal(f.calls[0].conversationId, undefined);
});
test('unrelated roots and replies to other people are silent, with no attachment upload or business writes', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  await f.plugin.message('seed', event()); f.calls.length = 0; f.sent.length = 0;
  const original = f.gateway.command;
  f.gateway.command = async (type, input) => {
    if (type === 'conversation.relevance') { f.calls.push({ type, ...input }); return { respond: false, reason: 'Addressed to another person', mainVersion: 'v1' }; }
    return original(type, input);
  };
  f.io.download = async () => { assert.fail('An unrelated attachment must not be downloaded'); };
  await f.plugin.message('unrelated-root', event({ ts: '999.001', text: '午饭去哪吃？', files: [{ name: 'food.png', mimetype: 'image/png' }] }));
  await f.plugin.message('unrelated-reply', event({ ts: '123.002', thread_ts: '123.001', text: '<@UOTHER> 中午去哪吃饭？' }));
  assert.deepEqual(f.calls.map(call => call.type), ['conversation.relevance', 'conversation.relevance']);
  assert.equal(f.sent.some(call => !call.method || call.method !== 'conversations.replies'), false);
  assert.equal(Object.keys(f.store.data.threads).length, 1);
});
test('relevance failure is recorded privately and cannot start a turn or spam a channel', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  f.gateway.command = async () => { throw Object.assign(new Error('Controlled classification failure'), { code: 'MODEL_TIMEOUT' }); };
  const envelope = { type: 'events_api', body: { event: event({ text: '相关吗？' }) } };
  await f.store.receive('failed-relevance', envelope);
  await f.plugin.runEntry('failed-relevance', f.store.data.inbox['failed-relevance']);
  assert.equal(f.store.data.inbox['failed-relevance'].status, 'attention');
  assert.equal(f.store.data.inbox['failed-relevance'].error, 'MODEL_TIMEOUT');
  assert.equal(f.sent.length, 0); assert.equal(Object.keys(f.store.data.threads).length, 0);
});
test('relevance request is durable before calling the gateway and replays unchanged after thread edits', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  const original = f.gateway.command; let unavailable = true, contextReads = 0;
  f.io.call = async method => method === 'conversations.replies' ? { messages: [{ ts: '122.001', user, text: `Original context ${++contextReads}` }] } : {};
  f.gateway.command = async (type, input) => {
    if (type === 'conversation.relevance' && unavailable) {
      unavailable = false;
      const disk = JSON.parse(await fs.readFile(f.store.file, 'utf8'));
      assert.deepEqual(disk.inbox.replay.relevanceRequest, input);
      f.calls.push({ type, ...input }); throw Object.assign(new Error('Unavailable'), { code: 'BUSY' });
    }
    return original(type, input);
  };
  const message = event({ thread_ts: '122.001', text: '登录 Bug 怎么办？' });
  await f.store.receive('replay', { type: 'events_api', body: { event: message } });
  await f.plugin.runEntry('replay', f.store.data.inbox.replay);
  assert.equal(f.store.data.inbox.replay.status, 'pending');
  await f.plugin.runEntry('replay', f.store.data.inbox.replay);
  assert.equal(contextReads, 1);
  const judgments = f.calls.filter(call => call.type === 'conversation.relevance');
  assert.deepEqual(judgments[0], judgments[1]);
  assert.equal(f.calls.filter(call => call.type === 'conversation.submit').length, 1);
});
test('restart after relevant decision reuses it and does not classify or create twice', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  const original = f.gateway.command; let busy = true;
  f.gateway.command = async (type, input) => {
    if (type === 'conversation.submit' && busy) { busy = false; throw Object.assign(new Error('Busy'), { code: 'BUSY' }); }
    return original(type, input);
  };
  await f.store.receive('restart', { type: 'events_api', body: { event: event({ text: '登录刷新失败，需要分析。' }) } });
  await f.plugin.runEntry('restart', f.store.data.inbox.restart);
  const reopened = await new Store(f.directory).open();
  const restarted = new SlackPlugin({ store: reopened, gateway: f.gateway, io: f.io, teamId, botUserId: bot,
    cloudOrigin: 'https://map.example.com', logger: { warn() {}, error() {} } });
  await restarted.runEntry('restart', reopened.data.inbox.restart);
  assert.equal(reopened.data.inbox.restart.status, 'done');
  assert.equal(f.calls.filter(call => call.type === 'conversation.relevance').length, 1);
  assert.equal(f.calls.filter(call => call.type === 'conversation.create').length, 1);
});
test('channel rebind cannot redirect a saved relevance request to another project', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  f.gateway.command = async () => { throw Object.assign(new Error('Busy'), { code: 'BUSY' }); };
  await f.store.receive('rebind', { type: 'events_api', body: { event: event({ text: '登录刷新失败' }) } });
  await f.plugin.runEntry('rebind', f.store.data.inbox.rebind);
  await f.store.update(state => { state.channels[channel] = 'other'; });
  await f.plugin.runEntry('rebind', f.store.data.inbox.rebind);
  assert.equal(f.store.data.inbox.rebind.error, 'CONFLICT'); assert.equal(f.sent.length, 0);
  assert.equal(Object.keys(f.store.data.threads).length, 0);
});
test('channel rebind during the relevance model call cannot create or submit in the new project', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  const original = f.gateway.command; let release, entered;
  const began = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  f.gateway.command = async (type, input) => {
    if (type === 'conversation.relevance') { entered(); await held; }
    return original(type, input);
  };
  const pending = f.plugin.message('inflight-rebind', event({ text: '登录 Bug 需要分析。' }));
  await began;
  await f.store.update(state => { state.channels[channel] = 'other'; });
  release();
  await assert.rejects(pending, error => error.code === 'CONFLICT' && error.silent === true);
  assert.deepEqual(f.calls.map(call => call.type), ['conversation.relevance']);
  assert.equal(Object.keys(f.store.data.threads).length, 0); assert.equal(f.sent.length, 0);
});
test('long thread relevance reads the latest six preceding messages, not the earliest page', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  const reads = [];
  f.io.call = async (method, input) => {
    if (method !== 'conversations.replies') return {};
    reads.push(input); assert.equal(input.latest, '300.001'); assert.equal(input.inclusive, false);
    return !input.cursor ? { has_more: true, response_metadata: { next_cursor: 'page-2' },
      messages: Array.from({ length: 100 }, (_, index) => ({ ts: `${100 + index}.001`, user, text: `Earlier ${index}` })) }
      : { messages: [...Array.from({ length: 6 }, (_, index) => ({ ts: `${200 + index}.001`, user, text: `Recent ${index}` })),
        { ts: '300.001', user, text: 'Current message' }, { ts: '350.001', user, text: 'Future message' }] };
  };
  await f.plugin.message('long-thread', event({ ts: '300.001', thread_ts: '100.001', text: '接着讨论登录 Bug。' }));
  assert.equal(reads.length, 2); assert.equal(reads[1].cursor, 'page-2');
  assert.deepEqual(f.calls.find(call => call.type === 'conversation.relevance').payload.context.map(item => item.text),
    Array.from({ length: 6 }, (_, index) => `Recent ${index}`));
});
test('incomplete or looping thread pagination cannot feed stale context to the model', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  let count = 0;
  f.io.call = async () => { count++; return { has_more: true, response_metadata: { next_cursor: 'same-cursor' }, messages: [{ ts: '120.001', user, text: 'Stale context' }] }; };
  await f.store.receive('incomplete-context', { type: 'events_api', body: { event: event({ thread_ts: '120.001', text: '这个怎么办？' }) } });
  await f.plugin.runEntry('incomplete-context', f.store.data.inbox['incomplete-context']);
  assert.equal(count, 2); assert.equal(f.store.data.inbox['incomplete-context'].error, 'RELEVANCE_CONTEXT_INCOMPLETE');
  assert.equal(f.calls.length, 0); assert.equal(f.sent.length, 0); assert.equal(Object.keys(f.store.data.threads).length, 0);
});
test('slow overheard classifiers cannot block explicit messages or conversation mirroring', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  const original = f.gateway.command; let release, classifications = 0;
  const held = new Promise(resolve => { release = resolve; });
  f.gateway.command = async (type, input) => {
    if (type === 'conversation.relevance') { classifications++; await held; }
    return original(type, input);
  };
  for (let index = 0; index < 3; index++) await f.store.receive(`indirect-${index}`, { type: 'events_api', body: {
    event: event({ ts: `150.00${index}`, text: '登录 Bug 请分析。' }) } });
  await f.store.receive('explicit-priority', { type: 'events_api', body: { event: event({ ts: '160.001', text: `<@${bot}> direct` }) } });
  f.plugin.stopped = false;
  try {
    await f.plugin.tick();
    assert.equal(classifications, 2); assert.equal(f.plugin.classifying.size, 2);
    assert.equal(f.store.data.inbox['explicit-priority'].status, 'done');
    assert.equal(f.store.data.inbox['indirect-2'].status, 'pending');
    assert.ok(f.calls.some(call => call.type === 'conversation.submit' && call.payload.text === 'direct'));
    assert.ok(f.calls.some(call => call.type === 'conversation.state'));
  } finally {
    const stopping = f.plugin.stop(); release(); await stopping;
  }
  assert.equal(f.plugin.classifying.size, 0); assert.equal(f.plugin.processing.size, 0);
});
test('dormant thread slots cannot postpone an already-due live conversation', async t => {
  const f = await fixture(t), now = Date.now();
  for (let index = 0; index < 20; index++) {
    const key = threadKey(teamId, channel, `idle-${index}`);
    await f.store.bind(key, { channel, threadTs: `idle-${index}`, projectId: 'lab', conversationId: `chat-idle-${index}`, userId: user, ownRequests: [] });
    await f.store.update(state => { state.threads[key].nextPoll = now + 60000; });
  }
  const key = threadKey(teamId, channel, 'live');
  await f.store.bind(key, { channel, threadTs: 'live', projectId: 'lab', conversationId: 'chat-live', userId: user, ownRequests: [] });
  f.gateway.command = async (type, args) => {
    f.calls.push({ type, ...args });
    assert.equal(args.conversationId, 'chat-live', 'Dormant links must not consume a state request');
    return { status: 'waiting-for-user', activeTurnId: null, messages: [{ id: 'answer-live', role: 'assistant', text: '已经生成的正文' }], approvals: [] };
  };
  f.plugin.stopped = false;
  try {
    await f.plugin.tick();
    assert.equal(f.sent.filter(item => item.channel).length, 1);
    assert.equal(f.calls.length, 1);
    assert.match(f.sent.find(item => item.channel).text, /已经生成的正文/);
  } finally { await f.plugin.stop(); }
});
test('an unrelated slow read-reaction cannot block a ready Coordinator answer', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  const originalCommand = f.gateway.command, originalCall = f.io.call;
  let release, entered;
  const held = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
  f.io.call = async (method, input) => {
    if (method === 'reactions.add') { entered(); await held; return {}; }
    return originalCall(method, input);
  };
  f.gateway.command = async (type, args) => {
    if (type === 'conversation.state') {
      const submit = f.calls.find(call => call.type === 'conversation.submit');
      return { status: 'waiting-for-user', activeTurnId: null, acceptedRequestIds: [submit.id],
        messages: [{ id: 'ready-reply', requestId: submit.id, role: 'assistant', text: '准备好的实际答案' }], approvals: [] };
    }
    return originalCommand(type, args);
  };
  await f.store.receive('slow-reaction', { type: 'events_api', body: { event: event({ text: `<@${bot}> 当前问题` }) } });
  f.plugin.stopped = false;
  const tick = f.plugin.tick();
  let timer;
  try {
    await began;
    const finished = await Promise.race([tick.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 1000); })]);
    assert.equal(finished, true, 'Message cycle must finish while the reaction remains held');
    assert.match(f.sent.find(item => item.channel).text, /准备好的实际答案/);
  } finally { clearTimeout(timer); release(); await tick; await f.plugin.stop(); }
});
test('live replies are prioritized with bounded state reads and fair dormant progress', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 6; index++) await f.store.bind(`idle-${index}`, { channel, threadTs: `idle-${index}`, projectId: 'lab', conversationId: `chat-idle-${index}`, userId: user, ownRequests: [] });
  for (let index = 0; index < 12; index++) {
    const key = `hot-${index}`;
    await f.store.bind(key, { channel, threadTs: key, projectId: 'lab', conversationId: `chat-hot-${index}`, userId: user, ownRequests: [] });
    await f.store.update(state => { state.threads[key].awaitingReplyId = `pending-${index}`; });
  }
  const observed = [];
  f.gateway.command = async (type, args) => {
    observed.push(args.conversationId);
    return { status: args.conversationId.includes('hot') ? 'running' : 'idle', messages: [], approvals: [] };
  };
  f.plugin.stopped = false;
  try {
    await f.plugin.tick();
    assert.deepEqual(observed, ['chat-hot-0', 'chat-hot-1', 'chat-hot-2', 'chat-idle-0']);
    for (let index = 0; index < 6; index++) {
      const before = observed.length; await f.plugin.tick();
      assert.ok(observed.length - before <= 4, 'The four-state-read budget is not enlarged');
    }
    assert.equal(new Set(observed).size, 18, 'Both hot and dormant links make progress');
  } finally { await f.plugin.stop(); }
});
test('pending-reply priority survives restart and clears only after the accepted request settles', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, 'priority');
  await f.store.bind(key, { channel, threadTs: 'priority', projectId: 'lab', conversationId: 'chat-priority', userId: user, ownRequests: ['new-request'] });
  await f.store.update(state => { state.threads[key].awaitingReplyId = 'new-request'; });
  f.plugin.store = await new Store(f.directory).open();
  f.gateway.command = async () => ({ status: 'waiting-for-user', activeTurnId: null, acceptedRequestIds: ['older-request'], messages: [], approvals: [] });
  await f.plugin.mirror(key); assert.equal(f.plugin.store.data.threads[key].awaitingReplyId, 'new-request');
  f.gateway.command = async () => ({ status: 'running', activeTurnId: 'new-request', acceptedRequestIds: ['new-request'], messages: [], approvals: [] });
  await f.plugin.mirror(key); assert.equal(f.plugin.store.data.threads[key].live, true);
  assert.equal(f.plugin.store.data.threads[key].awaitingReplyId, 'new-request');
  f.gateway.command = async () => ({ status: 'waiting-for-user', activeTurnId: null, acceptedRequestIds: ['new-request'],
    messages: [{ id: 'answered', requestId: 'new-request', role: 'assistant', text: '已完整回答' }], approvals: [] });
  await f.plugin.mirror(key); assert.equal(f.plugin.store.data.threads[key].live, false);
  assert.equal(f.plugin.store.data.threads[key].awaitingReplyId, undefined);
  assert.ok(f.plugin.store.data.threads[key].nextPoll > Date.now() + 14000);
});
test('read reactions are bounded and stop waits for in-flight reactions without starting new ones', async t => {
  const f = await fixture(t); let release, calls = 0;
  const held = new Promise(resolve => { release = resolve; });
  f.io.call = async method => { assert.equal(method, 'reactions.add'); calls++; await held; };
  f.plugin.stopped = false;
  for (let index = 0; index < 20; index++) f.plugin.readReaction(event({ ts: `${index}.001` }));
  await Promise.resolve();
  assert.equal(calls, 8); assert.equal(f.plugin.reactions.size, 8);
  let stopped = false; const stop = f.plugin.stop().then(() => { stopped = true; });
  f.plugin.readReaction(event({ ts: '21.001' }));
  await Promise.resolve(); assert.equal(stopped, false); assert.equal(calls, 8);
  release(); await stop; assert.equal(f.plugin.reactions.size, 0);
});
test('a submit ACK racing an older mirror snapshot resets its next poll atomically', async t => {
  for (const mode of ['message', 'answer']) {
    const f = await fixture(t), key = threadKey(teamId, channel, '120.001');
    await f.store.update(state => { state.channels[channel] = 'lab'; });
    await f.store.bind(key, { channel, threadTs: '120.001', projectId: 'lab', conversationId: 'chat-race', userId: user, ownRequests: [] });
    const original = f.gateway.command; let release, entered, requestId, accepted = false, reads = 0;
    const held = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
    f.gateway.command = async (type, args) => {
      if (type === 'conversation.submit') { requestId = args.id; entered(); await held; accepted = true; return { accepted: true }; }
      if (type === 'conversation.state') { reads++; return { status: 'waiting-for-user', activeTurnId: null,
        acceptedRequestIds: accepted ? [requestId] : ['old-request'], messages: accepted
          ? [{ id: 'new-answer', requestId, role: 'assistant', text: '新轮次答案' }] : [], approvals: [] }; }
      return original(type, args);
    };
    f.plugin.stopped = false;
    const submitting = mode === 'message' ? f.plugin.message('ack-race', event({ thread_ts: '120.001', text: '登录问题，请继续分析。' }))
      : f.plugin.answer('ack-race', user, { key, text: '自然语言回答', questionId: 'question' });
    try {
      await began; await f.plugin.mirror(key);
      assert.ok(f.store.data.threads[key].nextPoll > Date.now() + 14000);
      release(); await submitting;
      assert.equal(f.store.data.threads[key].nextPoll, 0, 'ACK must undo the older idle snapshot deadline');
      assert.equal(f.store.data.threads[key].awaitingReplyId, requestId);
      await f.plugin.tick();
      assert.equal(reads, 2); assert.match(f.sent.find(item => item.channel).text, /新轮次答案/);
    } finally { release(); await submitting; await f.plugin.stop(); }
  }
});
test('same-thread corrections and explicit replies cannot overtake an earlier classification or BUSY retry', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  await f.plugin.message('seed', event());
  const original = f.gateway.command; let release, busy = true, judgments = 0;
  const held = new Promise(resolve => { release = resolve; }), submitted = [];
  f.gateway.command = async (type, input) => {
    if (type === 'conversation.relevance') { judgments++; if (input.payload.text === '原需求') await held; }
    if (type === 'conversation.submit') {
      if (input.payload.text === '原需求' && busy) { busy = false; throw Object.assign(new Error('Busy'), { code: 'BUSY' }); }
      submitted.push(input.payload.text);
    }
    return original(type, input);
  };
  for (const [id, ts, text] of [['first', '123.002', '原需求'], ['correction', '123.003', '修正'], ['explicit', '123.004', `<@${bot}> 最后确认`]]) {
    await f.store.receive(id, { type: 'events_api', body: { event: event({ ts, text, thread_ts: '123.001' }) } });
  }
  // Manually advance cycles while retaining the real journal and runEntry.
  f.plugin.kick = () => {}; f.plugin.stopped = false;
  try {
    await f.plugin.tick(); const first = f.plugin.processing.get('first');
    assert.equal(judgments, 1); assert.deepEqual(submitted, []);
    release(); await first;
    assert.equal(f.store.data.inbox.first.status, 'pending');
    await f.plugin.tick(); assert.equal(judgments, 1); assert.deepEqual(submitted, []);
    await f.store.update(state => { state.inbox.first.next = 0; });
    await f.plugin.tick(); await Promise.all([...f.plugin.processing.values()]);
    assert.deepEqual(submitted, ['原需求']);
    await f.plugin.tick(); await Promise.all([...f.plugin.processing.values()]);
    assert.deepEqual(submitted, ['原需求', '修正']);
    await f.plugin.tick(); assert.deepEqual(submitted, ['原需求', '修正', '最后确认']);
  } finally { release(); await f.plugin.stop(); }
  assert.equal(f.plugin.messageLanes.size, 0);
});
test('DM requires explicit project selection and immutable thread cannot be rebound', async t => {
  const f = await fixture(t); await f.plugin.message('E1', event({ channel: 'D000001', text: 'hello' }));
  assert.deepEqual(f.calls.map(call => call.type), ['project.list']); assert.match(f.sent[0].text, /请选择/);
  await f.store.update(state => { state.preferences[user] = 'lab'; }); await f.plugin.message('E2', event({ channel: 'D000001', text: 'hello' }));
  const key = threadKey(teamId, 'D000001', '123.001'); await assert.rejects(f.store.bind(key, { projectId: 'other', conversationId: 'different' }), /immutable/);
});
test('BUSY replay preserves original gateway operation ID and received record', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  const original = f.gateway.command; let busy = true;
  f.gateway.command = async (type, args) => { if (type === 'conversation.submit' && busy) { busy = false; f.calls.push({ type, ...args }); throw Object.assign(new Error('busy'), { code: 'BUSY' }); } return original(type, args); };
  const envelope = { type: 'events_api', body: { event: event() } }; await f.store.receive('E1', envelope);
  await f.plugin.runEntry('E1', f.store.data.inbox.E1); assert.equal(f.store.data.inbox.E1.status, 'pending');
  await f.plugin.runEntry('E1', f.store.data.inbox.E1); assert.equal(f.store.data.inbox.E1.status, 'done');
  const submits = f.calls.filter(call => call.type === 'conversation.submit'); assert.equal(submits[0].id, submits[1].id);
});
test('attachments are uploaded before turn submission with only protected references', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; }); await f.plugin.message('E1', event({ files: [{ id: 'F1' }] }));
  assert.deepEqual(f.calls.find(call => call.type === 'conversation.submit').payload.attachments, [{ id: 'attachment-1' }]);
  assert.ok(f.calls.findIndex(call => call.type === 'attachment.upload') < f.calls.findIndex(call => call.type === 'conversation.submit'));
});
test('total images over 5MiB and more than 6 files reject before uploading or submitting', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  f.io.download = async () => ({ filename: 'screen.png', mimeType: 'image/png', base64: Buffer.alloc(3 * 1024 * 1024).toString('base64') });
  await assert.rejects(f.plugin.message('E1', event({ files: [{ id: 'F1' }, { id: 'F2' }] })), /总计/);
  await assert.rejects(f.plugin.message('E2', event({ files: Array.from({ length: 7 }, (_, index) => ({ id: `F${index}` })) })), /最多 6/);
  assert.equal(f.calls.some(call => ['attachment.upload', 'conversation.submit'].includes(call.type)), false);
});
test('Home renders Map, work items and public session status using free native blocks', async t => {
  const f = await fixture(t); await f.store.update(state => { state.preferences[user] = 'lab'; }); await f.plugin.publishHome(user, 'E1');
  const view = f.sent.find(call => call.method === 'views.publish').input.view;
  assert.equal(view.type, 'home'); assert.match(JSON.stringify(view), /登录/); assert.match(JSON.stringify(view), /session-1/); assert.ok(view.blocks.length < 100);
  for (const block of view.blocks) {
    const ids = [...(block.elements || []), ...(block.accessory ? [block.accessory] : [])].map(element => element.action_id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, 'Slack rejects duplicate action_id values in a block');
  }
});
test('Home TODO Bug memory and existing-item entrypoints start natural conversations without forms or Map writes', async t => {
  for (const [action, value] of [['open_item:todo', { projectId: 'lab', kind: 'todo' }], ['open_item:bug', { projectId: 'lab', kind: 'bug' }], ['open_item', { projectId: 'lab', kind: 'bug', nodeId: 'login', itemId: 'B1' }],
    ['open_memory', { projectId: 'lab' }], ['start_chat', { projectId: 'lab', text: '一起讨论项目' }]]) {
    const f = await fixture(t), body = { type: 'block_actions', user: { id: user }, actions: [{ action_id: action, value: JSON.stringify(value) }] };
    await f.store.update(state => { state.drafts.existing = { text: 'Existing unsent draft' }; });
    await f.store.receive('home-action', { type: 'interactive', body }); await f.plugin.runEntry('home-action', f.store.data.inbox['home-action']);
    await runPluginCycle(f.plugin);
    assert.equal(f.sent.some(input => input.method === 'views.open'), false);
    assert.equal(f.calls.some(input => input.type === 'map.write'), false);
    assert.ok(f.calls.find(input => input.type === 'conversation.submit').payload.text.includes('讨论'));
    assert.equal(f.store.data.drafts.existing.text, 'Existing unsent draft');
    assert.equal(Object.keys(f.store.data.threads).length, 1);
  }
});
test('global TODO shortcut prompts project choice then continues as a DM conversation', async t => {
  const f = await fixture(t), body = { type: 'shortcut', callback_id: 'cg_todo', user: { id: user } };
  await f.store.receive('shortcut', { type: 'interactive', body }); await f.plugin.runEntry('shortcut', f.store.data.inbox.shortcut);
  await runPluginCycle(f.plugin);
  const originalId = Object.keys(f.store.data.inbox).find(id => id.startsWith('chat-'));
  assert.equal(f.sent.some(input => input.method === 'views.open'), false);
  assert.equal(f.calls.some(input => input.type === 'conversation.submit'), false);
  await f.plugin.process('project-selection', { type: 'interactive', body: projectChoice(f, originalId) });
  await runPluginCycle(f.plugin);
  assert.equal(f.calls.find(input => input.type === 'conversation.submit').payload.text, '我想和你讨论一条 TODO。');
  assert.equal(Object.values(f.store.data.threads)[0].channel, 'D000001');
});
test('plain cg command opens project choice rather than an ID binding form', async t => {
  const f = await fixture(t), body = { command: '/cg', text: '', user_id: user, channel_id: channel };
  await f.store.receive('cg', { type: 'slash_commands', body }); await f.plugin.runEntry('cg', f.store.data.inbox.cg); await runPluginCycle(f.plugin);
  assert.equal(f.sent.some(input => input.method === 'views.open'), false);
  assert.ok(f.sent.some(input => input.blocks?.some(block => block.elements?.some(element => element.action_id.startsWith('connect_project:')))));
});
test('natural thread reply answers the pending question with a pinned identity, never a modal', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.001');
  await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'question-chat', userId: user, ownRequests: [] });
  const gateway = f.gateway.command;
  f.gateway.command = async (type, input) => type === 'conversation.state' ? { status: 'waiting-for-user', messages: [{ id: 'q-message', role: 'assistant', questions: [{ id: 'q1', text: '期望是什么？' }] }] } : gateway(type, input);
  await f.plugin.mirror(key);
  await f.plugin.message('answer', event({ ts: '123.002', thread_ts: '123.001', text: `<@${bot}> 先修复刷新逻辑` }));
  assert.equal(f.calls.find(input => input.type === 'conversation.submit').payload.answerTo, 'q1');
  assert.equal(f.calls.find(input => input.type === 'conversation.submit').payload.text, '先修复刷新逻辑');
  assert.equal(f.sent.some(input => input.method === 'views.open'), false);
  assert.equal(messageBlocks({ questions: [{ id: 'q1', text: '问你', options: ['a', 'b'] }] }, key).some(block => block.type === 'actions'), false);
  assert.match(JSON.stringify(messageBlocks({ questions: [{ id: 'q1', text: '问你', options: ['只改刷新', '完整登录'] }] }, key)), /只改刷新/);
});
test('BUSY retry without an initial question cannot become the answer to a later question', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  const gateway = f.gateway.command; let busy = true;
  f.gateway.command = async (type, input) => {
    if (type === 'conversation.submit' && busy) { busy = false; f.calls.push({ type, ...input }); throw Object.assign(new Error('Busy'), { code: 'BUSY' }); }
    if (type === 'conversation.state') return { messages: [{ role: 'assistant', questions: [{ id: 'later-question', text: 'later' }] }] };
    return gateway(type, input);
  };
  await assert.rejects(f.plugin.message('original', event()), error => error.code === 'BUSY');
  assert.deepEqual(f.store.data.inbox.original.replyContext, { answerTo: null });
  const key = threadKey(teamId, channel, '123.001');
  await f.store.update(state => { state.threads[key].pendingQuestionId = 'later-question'; });
  await f.plugin.message('original', event());
  const submits = f.calls.filter(input => input.type === 'conversation.submit');
  assert.deepEqual(submits[0].payload, submits[1].payload); assert.equal(submits[0].id, submits[1].id);
});
test('message shortcut retains its original thread project after the channel mapping changes', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.001');
  await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'original-chat', userId: user, ownRequests: [] });
  await f.store.update(state => { state.channels[channel] = 'other'; });
  const body = { type: 'message_action', callback_id: 'cg_bug_message', user: { id: user }, channel: { id: channel }, message: { ts: '123.002', thread_ts: '123.001', text: '原项目登录有 Bug' } };
  await f.store.receive('shortcut', { type: 'interactive', body }); await f.plugin.runEntry('shortcut', f.store.data.inbox.shortcut); await runPluginCycle(f.plugin);
  const submit = f.calls.find(input => input.type === 'conversation.submit');
  assert.equal(submit.projectId, 'lab'); assert.equal(submit.conversationId, 'original-chat');
  assert.equal(f.store.data.channels[channel], 'other');
  assert.equal(f.calls.some(input => input.type === 'conversation.create'), false);
  assert.equal(Object.keys(f.store.data.threads).length, 1);
});
test('item forms use original CAS version, update existing ID and never invoke dispatch', async t => {
  const f = await fixture(t); await f.plugin.publishHome(user, 'E0');
  await f.plugin.openForm('trigger', user, 'E1', 'item', { projectId: 'lab', nodeId: 'login', itemId: 'TD1', kind: 'todo' });
  const draftId = f.sent.find(call => call.method === 'views.open').input.view.private_metadata;
  await f.plugin.submitForm('E2', formBody(draftId, { project: 'lab', node: 'login', title: 'new refresh', text: 'requirement', status: 'pending' }), user);
  const write = f.calls.find(call => call.type === 'map.write'); assert.equal(write.payload.baseVersion, 'v1'); assert.equal(write.payload.operations[0].fields.todos[0].id, 'TD1');
  assert.equal(f.calls.some(call => call.type.includes('dispatch')), false);
});
test('version conflict preserves draft and does not claim success', async t => {
  const f = await fixture(t); await f.plugin.publishHome(user, 'E0'); await f.plugin.openForm('trigger', user, 'E1', 'memory', { projectId: 'lab', nodeId: 'login' });
  const draftId = f.sent.find(call => call.method === 'views.open').input.view.private_metadata;
  const original = f.gateway.command; f.gateway.command = async (type, args) => { if (type === 'map.write') throw Object.assign(new Error('Changed Main'), { code: 'VERSION_CONFLICT' }); return original(type, args); };
  await assert.rejects(f.plugin.submitForm('E2', formBody(draftId, { project: 'lab', node: 'login', text: 'new memory' }), user), /Changed Main/);
  assert.ok(f.store.data.drafts[draftId]);
});
test('form actor is bound to original user and cannot be reused by someone else', async t => {
  const f = await fixture(t); await f.plugin.publishHome(user, 'E0'); await f.plugin.openForm('trigger', user, 'E1', 'memory', { projectId: 'lab', nodeId: 'login' });
  const draftId = f.sent.find(call => call.method === 'views.open').input.view.private_metadata;
  await assert.rejects(f.plugin.submitForm('E2', formBody(draftId, {}), 'UOTHER'), /失效/);
});
test('global form can explicitly select project before first Home preference', async t => {
  const f = await fixture(t); await f.plugin.loadProjects(user, 'E0'); await f.plugin.openForm('trigger', user, 'E1', 'item', { kind: 'todo' });
  const opened = f.sent.find(call => call.method === 'views.open').input.view, draftId = opened.private_metadata;
  await f.plugin.selectFormProject('E2', { view: { ...opened, id: 'V1', hash: 'H1', state: { values: { project: { form_project: { selected_option: { value: 'lab' } } } } } } }, user, 'lab');
  await f.plugin.submitForm('E3', formBody(draftId, { project: 'lab', node: 'login', title: 'new', text: 'description', status: 'pending' }), user);
  assert.equal(f.calls.find(call => call.type === 'map.write').payload.baseVersion, 'v1'); assert.ok(f.sent.some(call => call.method === 'views.update'));
});
test('brief approval carries original version and prompt export uses shared gateway', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.001'); await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'chat-one', userId: user, ownRequests: [] });
  await f.plugin.review('E1', user, { key, proposalId: 'approval-1', version: 'brief-version' }, 'approved', 'approved by user');
  assert.equal(f.calls.find(call => call.type === 'brief.review').payload.version, 'brief-version');
  await f.plugin.exportPrompt('E2', user, { key, proposalId: 'approval-1' }); assert.equal(f.sent.find(call => call.export).export.text, 'execute login');
});
test('mirror sends browser user and coordinator once, omits original Slack user to avoid loop', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.001'); await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'chat-one', userId: user, ownRequests: ['slack-request'] });
  f.gateway.command = async () => ({ status: 'idle', messages: [{ id: 'm1', role: 'user', requestId: 'slack-request', text: 'Slack origin' }, { id: 'm2', role: 'user', text: 'Browser user' }, { id: 'm3', role: 'assistant', text: 'Hello' }], approvals: [] });
  await f.plugin.mirror(key); await f.plugin.mirror(key); assert.equal(f.sent.filter(call => call.channel).length, 2); assert.equal(f.sent.some(call => call.text?.includes('Slack origin')), false);
});
test('mirror finalizes one complete answer with node links and keeps it stable after restart', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.links');
  await f.store.bind(key, { channel, threadTs: '123.links', projectId: 'lab', conversationId: 'chat-links', userId: user, ownRequests: ['request-links'] });
  let complete = false;
  const userMessage = { id: 'u1', role: 'user', requestId: 'request-links', text: '介绍并展示登录入口' };
  const answer = { id: 'a1', role: 'assistant', requestId: 'request-links', text: '登录负责身份验证。',
    actions: [{ kind: 'node-references', nodes: [{ id: 'login', title: '登录' }] }] };
  f.gateway.command = async () => complete ? { status: 'waiting-for-user', activeTurnId: null, messages: [userMessage, answer], approvals: [] }
    : { status: 'running', activeTurnId: 'request-links', streamingText: '登录负责身份验证。', messages: [userMessage], approvals: [] };
  await f.plugin.mirror(key); complete = true;
  f.plugin.store = await new Store(f.directory).open();
  await f.plugin.mirror(key); await f.plugin.mirror(key);
  assert.equal(f.sent.filter(call => call.channel).length, 1, 'Complete answer reuses the stream, not another message');
  const updates = f.sent.filter(call => call.update);
  assert.equal(updates.length, 1);
  const button = updates[0].update[3].find(block => block.type === 'actions').elements[0];
  assert.equal(button.url, 'https://map.example.com/projects/lab?relation=login');
  f.plugin.store = await new Store(f.directory).open();
  await f.plugin.mirror(key); assert.equal(f.sent.length, 2, 'Restart does not duplicate or update unchanged answer');
});
test('mirror adds links to existing presentation replies in place without resending ordinary history', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.upgrade');
  await f.store.bind(key, { channel, threadTs: '123.upgrade', projectId: 'lab', conversationId: 'chat-upgrade', userId: user, ownRequests: [] });
  const messages = [{ id: 'old', role: 'assistant', text: '旧答复' },
    { id: 'link', role: 'assistant', text: '登录入口', actions: [{ kind: 'node-navigation', node: { id: 'login', title: '登录' } }] },
    { id: 'only-actions', role: 'assistant', text: '', actions: [{ kind: 'node-tour', nodes: [{ id: 'login', title: '登录' }] }] }];
  await f.store.update(state => { for (const [index, message] of messages.slice(0, 2).entries())
    state.threads[key].mirrored[message.id] = { ts: `${index + 1}.0`, hash: digest({ format: 'plain-text-v2', message }) }; });
  f.gateway.command = async () => ({ status: 'idle', messages, approvals: [] });
  await f.plugin.mirror(key); await f.plugin.mirror(key);
  assert.equal(f.sent.filter(call => call.update).length, 1);
  assert.equal(f.sent.find(call => call.update).update[1], '2.0');
  assert.equal(f.sent.filter(call => call.channel).length, 1, 'Action-only presentation is visible too');
  assert.ok(f.sent.find(call => call.channel).blocks.some(block => block.type === 'actions'));
});
test('real waiting-for-user state finalizes streamed reply in place after restart', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.001'); await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'chat-one', userId: user, ownRequests: ['request-one'] });
  f.gateway.command = async () => ({ status: 'running', activeTurnId: 'request-one', streamingText: 'partial', messages: [{ id: 'u1', role: 'user', requestId: 'request-one', text: 'question' }], approvals: [] });
  await f.plugin.mirror(key); assert.equal(f.sent.filter(call => call.channel).length, 1);
  f.plugin.store = await new Store(f.directory).open();
  f.gateway.command = async () => ({ status: 'waiting-for-user', activeTurnId: null, streamingText: '', messages: [{ id: 'u1', role: 'user', requestId: 'request-one', text: 'question' }, { id: 'a1', role: 'assistant', text: 'complete answer' }], approvals: [] });
  await f.plugin.mirror(key); assert.equal(f.sent.filter(call => call.channel).length, 1); assert.equal(f.sent.filter(call => call.update).length, 1); assert.equal(f.plugin.store.data.threads[key].liveStream, undefined);
});
test('a retained stream finalizes the first pending reply so multiple model steps remain chronological', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.ordered');
  await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'chat-one', userId: user, ownRequests: ['request-one'] });
  await f.store.update(state => { state.threads[key].liveStream = { ts: '5.0', turnId: 'request-one' }; });
  const messages = [
    { id: 'u1', role: 'user', requestId: 'request-one', text: 'question' },
    { id: 'a1', role: 'assistant', requestId: 'request-one', text: 'First: module introduction' },
    { id: 'a2', role: 'assistant', requestId: 'request-one', text: 'Second: follow-up invitation' },
  ];
  f.gateway.command = async () => ({ status: 'waiting-for-user', activeTurnId: 'request-one', messages, approvals: [] });
  await f.plugin.mirror(key);
  assert.equal(f.sent.length, 0, 'intermediate snapshot cannot post a final before the retained stream');
  f.plugin.store = await new Store(f.directory).open();
  f.gateway.command = async () => ({ status: 'waiting-for-user', activeTurnId: null, messages, approvals: [] });
  await f.plugin.mirror(key); await f.plugin.mirror(key);
  assert.equal(f.sent.length, 2);
  assert.match(f.sent[0].update[2], /First: module introduction/);
  assert.equal(f.sent[0].update[1], '5.0');
  assert.match(f.sent[1].text, /Second: follow-up invitation/);
  assert.equal(f.plugin.store.data.threads[key].liveStream, undefined);
});
test('legacy reply slots before or after a stream retain chronology without duplicate posts', async t => {
  for (const priorTs of ['4.0', '6.0']) {
    const f = await fixture(t), key = threadKey(teamId, channel, `123.legacy-${priorTs}`);
    await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'chat-one', userId: user, ownRequests: ['request-one'] });
    const first = { id: 'a1', role: 'assistant', requestId: 'request-one', text: 'First introduction' };
    await f.store.update(state => {
      state.threads[key].liveStream = { ts: '5.0', turnId: 'request-one' };
      state.threads[key].mirrored.a1 = { ts: priorTs, hash: digest({ format: 'plain-text-v2', message: first }) };
    });
    f.gateway.command = async () => ({ status: 'waiting-for-user', activeTurnId: null, messages: [
      { id: 'u1', role: 'user', requestId: 'request-one', text: 'question' }, first,
      { id: 'a2', role: 'assistant', requestId: 'request-one', text: 'Second invitation' },
    ], approvals: [] });
    await f.plugin.mirror(key);
    f.plugin.store = await new Store(f.directory).open();
    await f.plugin.mirror(key);
    const thread = f.plugin.store.data.threads[key];
    assert.ok(Number(thread.mirrored.a1.ts) < Number(thread.mirrored.a2.ts));
    assert.equal(f.sent.filter(x => x.channel).length, 0, 'existing slots are updated, not duplicated');
    assert.equal(f.sent.filter(x => x.update).length, priorTs === '4.0' ? 1 : 2);
    assert.equal(thread.liveStream, undefined);
  }
});
test('interrupted legacy stream slot rotation resumes in order without affecting earlier turns', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.rotate-restart');
  await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'chat-one', userId: user, ownRequests: ['previous', 'request-one'] });
  const old = { id: 'old', role: 'assistant', requestId: 'previous', text: 'Previous turn' };
  const first = { id: 'a1', role: 'assistant', requestId: 'request-one', text: 'First' };
  const second = { id: 'a2', role: 'assistant', requestId: 'request-one', text: 'Second' };
  await f.store.update(state => {
    state.threads[key].liveStream = { ts: '5.0', turnId: 'request-one' };
    for (const [message, ts] of [[old, '3.0'], [first, '6.0'], [second, '7.0']]) {
      state.threads[key].mirrored[message.id] = { ts, hash: digest({ format: 'plain-text-v2', message }) };
    }
  });
  f.gateway.command = async () => ({ status: 'waiting-for-user', activeTurnId: null, messages: [old,
    { id: 'u1', role: 'user', requestId: 'request-one', text: 'question' }, first, second,
    { id: 'a3', role: 'assistant', requestId: 'request-one', text: 'Third' },
  ], approvals: [] });
  const update = f.io.update;
  let count = 0;
  f.io.update = async (...args) => { if (++count === 2) throw new Error('Interrupted second slot'); return update(...args); };
  await assert.rejects(f.plugin.mirror(key), /Interrupted second slot/);
  f.plugin.store = await new Store(f.directory).open();
  f.io.update = update;
  await f.plugin.mirror(key); await f.plugin.mirror(key);
  const thread = f.plugin.store.data.threads[key];
  assert.deepEqual(['old', 'a1', 'a2', 'a3'].map(id => thread.mirrored[id].ts), ['3.0', '5.0', '6.0', '7.0']);
  assert.equal(f.sent.filter(x => x.channel).length, 0);
  assert.equal(f.sent.filter(x => x.update).length, 3);
  assert.equal(thread.liveStream, undefined);
});
test('active or different turn cannot overwrite a retained stream as a finalized reply', async t => {
  for (const [suffix, activeTurnId, requestId] of [['active', 'request-one', 'request-one'], ['different', null, 'request-two']]) {
    const f = await fixture(t), key = threadKey(teamId, channel, `123.${suffix}`);
    await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'chat-one', userId: user, ownRequests: [requestId] });
    await f.store.update(state => { state.threads[key].liveStream = { ts: '5.0', turnId: 'request-one' }; });
    f.gateway.command = async () => ({ status: 'waiting-for-user', activeTurnId, messages: [{ id: 'u1', role: 'user', requestId, text: 'question' }, { id: 'a1', role: 'assistant', text: 'new answer' }], approvals: [] });
    await f.plugin.mirror(key); assert.equal(f.sent.some(item => item.update), false); assert.equal(f.store.data.threads[key].liveStream.ts, '5.0');
  }
});
test('waiting-for-user intermediate snapshot with active turn delays final then updates once', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.001');
  await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'chat-one', userId: user, ownRequests: ['request-one'] });
  let active = true;
  await f.store.update(state => { state.threads[key].liveStream = { ts: '5.0', turnId: 'request-one' }; });
  f.gateway.command = async () => ({ status: 'waiting-for-user', activeTurnId: active ? 'request-one' : null, messages: [{ id: 'u1', role: 'user', requestId: 'request-one', text: 'question' }, { id: 'a1', role: 'assistant', text: 'final answer' }], approvals: [] });
  await f.plugin.mirror(key); assert.equal(f.sent.length, 0); assert.ok(f.store.data.threads[key].nextPoll <= Date.now() + 2500);
  active = false; await f.plugin.mirror(key); await f.plugin.mirror(key);
  assert.equal(f.sent.filter(item => item.channel).length, 0); assert.equal(f.sent.filter(item => item.update).length, 1); assert.equal(f.sent[0].update[1], '5.0');
});
test('workflow source and legacy prefix are hidden while human, Coordinator and brief remain visible', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.001');
  await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'chat-one', userId: user, ownRequests: [] });
  f.gateway.command = async () => ({ status: 'waiting-for-user', activeTurnId: null, messages: [
    { id: 'event-1', role: 'user', requestId: 'workflow-1', source: 'workflow', text: 'private workflow event marker' },
    { id: 'reply-1', role: 'assistant', text: 'brief 已保存，可导出提示。' },
    { id: 'event-legacy', role: 'user', requestId: 'workflow-legacy', text: '[服务器工作流事件，不是新的用户授权]\nprivate legacy marker' },
    { id: 'human', role: 'user', source: 'human', requestId: 'browser-user', text: '继续讨论：文中提到了 [服务器工作流事件] 这个标记。' },
    { id: 'reply-2', role: 'assistant', source: 'workflow', text: '这里是正常的 Coordinator 回复。' }
  ], approvals: [{ id: 'proposal', version: 'b1', manual: true, pending: true, text: 'approved requirements', acceptance: 'criteria' }] });
  await f.plugin.mirror(key); await f.plugin.mirror(key);
  const posts = f.sent.filter(item => item.channel);
  assert.equal(posts.length, 4); assert.equal(posts.some(item => /private workflow|private legacy/.test(item.text || '')), false);
  assert.ok(posts.some(item => item.text?.startsWith('工作台用户：继续讨论'))); assert.ok(posts.some(item => item.text?.includes('正常的 Coordinator 回复')));
  assert.ok(posts.some(item => JSON.stringify(item.blocks).includes('approve_brief')));
});
for (const readKind of ['map-read', 'node-read']) for (const streaming of [false, true]) test(`map-read-only steps do not post placeholders or consume the final stream slot (${readKind}/${streaming ? 'stream' : 'direct'})`, async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.001');
  await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'chat-one', userId: user, ownRequests: ['request-one'] });
  if (streaming) await f.store.update(state => { state.threads[key].liveStream = { ts: '5.0', turnId: 'request-one' }; });
  const state = { status: 'waiting-for-user', activeTurnId: null, messages: [
    { id: 'user', role: 'user', requestId: 'request-one', text: '只读分析 Bug' },
    { id: 'read-only', role: 'assistant', requestId: 'request-one', tools: ['read_map'], actions: [{ kind: readKind, node: { id: 'login', title: '登录' } }] },
    { id: 'answer', role: 'assistant', requestId: 'request-one', text: '登录模块的刷新逻辑有问题，本轮只读。' },
  ], approvals: [] };
  const original = structuredClone(state);
  f.gateway.command = async () => state;
  await f.plugin.mirror(key);
  assert.equal(f.sent.length, 1, 'Only the actual answer is sent/updated');
  assert.equal(f.store.data.threads[key].mirrored['read-only'], undefined);
  assert.ok(f.store.data.threads[key].mirrored.answer);
  if (streaming) {
    assert.equal(f.sent[0].update[1], '5.0');
    assert.match(f.sent[0].update[2], /登录模块/);
    assert.equal(f.store.data.threads[key].liveStream, undefined);
  } else assert.match(f.sent[0].text, /登录模块/);
  assert.deepEqual(state, original, 'Do not remove Cloud tool pairs or their public read actions');
  f.plugin.store = await new Store(f.directory).open();
  await f.plugin.mirror(key);
  assert.equal(f.sent.length, 1, 'Restart preserves deduplication without replaying the hidden read step');
});
test('map-read metadata does not hide accompanying text, clarification, attachment or visible node links', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.001');
  await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'chat-one', userId: user, ownRequests: [] });
  const read = { kind: 'node-read', node: { id: 'login', title: '登录' } };
  f.gateway.command = async () => ({ status: 'waiting-for-user', activeTurnId: null, messages: [
    { id: 'text', role: 'assistant', text: '这是实际说明。', actions: [read] },
    { id: 'question', role: 'assistant', questions: [{ id: 'q', text: '是否只影响旧 token？' }], actions: [read] },
    { id: 'attachment', role: 'assistant', attachments: [{ id: 'file', filename: 'result.txt' }], actions: [read] },
    { id: 'links', role: 'assistant', actions: [read, { kind: 'node-navigation', node: { id: 'login', title: '登录' } }] },
  ], approvals: [] });
  await f.plugin.mirror(key);
  assert.equal(f.sent.length, 4);
  assert.ok(JSON.stringify(f.sent[1].blocks).includes('是否只影响旧 token'));
  assert.ok(JSON.stringify(f.sent[2].blocks).includes('result.txt'));
  assert.equal(f.sent[3].blocks.find(block => block.type === 'actions').elements[0].url, 'https://map.example.com/projects/lab?relation=login');
});
test('new Bug uses native status and manual mode, memory writes preserve legacy memories', async t => {
  const f = await fixture(t); await f.plugin.publishHome(user, 'E0'); await f.plugin.openForm('trigger', user, 'E1', 'item', { projectId: 'lab', nodeId: 'login', kind: 'bug' });
  const draftId = f.sent.find(call => call.method === 'views.open').input.view.private_metadata;
  await f.plugin.submitForm('E2', formBody(draftId, { project: 'lab', node: 'login', title: 'Bug', text: 'broken refresh', status: 'open' }), user);
  const bug = f.calls.find(call => call.type === 'map.write').payload.operations[0].fields.bugs[0]; assert.equal(bug.executionMode, 'manual'); assert.equal(bug.status, 'open');
  await f.plugin.openForm('trigger', user, 'E3', 'memory', { projectId: 'lab', nodeId: 'login' });
  const memoryDraft = f.sent.filter(call => call.method === 'views.open').at(-1).input.view.private_metadata;
  await f.plugin.submitForm('E4', formBody(memoryDraft, { project: 'lab', node: 'login', text: '# 登录\n\n记忆' }), user);
  assert.deepEqual(f.calls.filter(call => call.type === 'map.write').at(-1).payload.operations[0].fields, { memoryDocument: '# 登录\n\n记忆' });
});
test('approved cards lose approval buttons and tracked Main status updates only linked thread', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.001'); await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'chat-one', userId: user, ownRequests: [] });
  let pending = true; const original = f.gateway.command;
  f.gateway.command = async (type, args) => type === 'conversation.state' ? { status: 'idle', messages: [], approvals: [{ id: 'proposal', version: 'b1', manual: true, pending, decision: pending ? undefined : 'approved', itemId: 'TD1', nodeId: 'login', kind: 'todo', text: 'fix', acceptance: 'works' }] } : original(type, args);
  await f.plugin.mirror(key); pending = false; await f.plugin.mirror(key);
  const update = f.sent.find(item => item.update).update; assert.equal(JSON.stringify(update).includes('approve_brief'), false); assert.match(JSON.stringify(update), /export_prompt/);
  await f.store.update(state => { state.threads[key].nextItemPoll = 0; });
  f.gateway.command = async (type, args) => type === 'project.read' ? { ...structuredClone(project), version: 'v2', map: { ...project.map, children: [{ ...project.map.children[0], todos: [{ id: 'TD1', title: 'refresh', status: 'done' }] }] } } : original(type, args);
  await f.plugin.notifyItemChanges(key); const notification = f.sent.find(item => item.text?.includes('pending → done')); assert.equal(notification.threadTs, '123.001'); assert.equal(notification.channel, channel);
});
test('only configured-origin and selected-project links are unfolded', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  await f.plugin.unfurl('E1', { user, channel, message_ts: '1.0', links: [{ url: 'https://evil.example/projects/lab' }, { url: 'https://map.example.com/projects/private' }, { url: 'https://map.example.com/projects/lab' }] });
  assert.deepEqual(Object.keys(f.sent.find(call => call.method === 'chat.unfurl').input.unfurls), ['https://map.example.com/projects/lab']);
});
test('linked thread unfurls retain their immutable project after channel or user selection changes', async t => {
  const f = await fixture(t), root = '120.001';
  await f.store.bind(threadKey(teamId, channel, root), { channel, threadTs: root, projectId: 'lab', conversationId: 'original-chat', userId: user });
  await f.store.update(state => { state.channels[channel] = 'other-project'; state.preferences[user] = 'other-project'; });
  const saved = structuredClone(f.store.data);
  const original = 'https://map.example.com/projects/lab?relation=login';
  await f.store.receive('unfurl-bound-thread', { type: 'events_api', body: { team_id: teamId, event: {
    type: 'link_shared', user, channel, thread_ts: root, message_ts: '130.001', links: [
      { url: original }, { url: 'https://map.example.com/projects/other-project' },
      { url: 'https://evil.example/projects/lab' },
    ],
  } } });
  await f.plugin.runEntry('unfurl-bound-thread', f.store.data.inbox['unfurl-bound-thread']);
  const unfurl = f.sent.find(call => call.method === 'chat.unfurl');
  assert.ok(unfurl, 'the original linked project still has a preview');
  assert.equal(unfurl.input.channel, channel); assert.equal(unfurl.input.ts, '130.001');
  assert.deepEqual(Object.keys(unfurl.input.unfurls), [original]);
  assert.deepEqual(f.calls.map(call => [call.type, call.projectId, call.userId]), [['project.read', 'lab', user]]);
  assert.deepEqual(f.store.data.threads, saved.threads);
  assert.deepEqual(f.store.data.channels, saved.channels); assert.deepEqual(f.store.data.preferences, saved.preferences);
  assert.equal(f.store.data.inbox['unfurl-bound-thread'].status, 'done');
});
test('linked root and direct-message previews do not require a new project preference', async t => {
  for (const channelId of [channel, 'D000001']) {
    const f = await fixture(t), root = '140.001';
    await f.store.bind(threadKey(teamId, channelId, root), { channel: channelId, threadTs: root, projectId: 'lab', conversationId: 'original-chat', userId: user });
    await f.plugin.unfurl('bound-root', { user, channel: channelId, message_ts: root, links: [{ url: 'https://map.example.com/projects/lab' }] });
    assert.equal(f.sent.filter(call => call.method === 'chat.unfurl').length, 1);
    assert.deepEqual(f.calls.map(call => [call.type, call.projectId]), [['project.read', 'lab']]);
    assert.deepEqual(f.store.data.channels, {}); assert.deepEqual(f.store.data.preferences, {});
  }
});
test('unlinked preview keeps current selection and never borrows a binding from another thread or channel', async t => {
  const f = await fixture(t);
  await f.store.bind(threadKey(teamId, channel, '150.001'), { channel, threadTs: '150.001', projectId: 'private', conversationId: 'unrelated-chat', userId: user });
  await f.store.bind(threadKey(teamId, 'COTHER', '160.001'), { channel: 'COTHER', threadTs: '160.001', projectId: 'private', conversationId: 'other-channel-chat', userId: user });
  await f.store.update(state => { state.channels[channel] = 'lab'; });
  await f.plugin.unfurl('unlinked', { user, channel, thread_ts: '160.001', message_ts: '170.001', links: [
    { url: 'https://map.example.com/projects/private' }, { url: 'https://map.example.com/projects/lab' },
  ] });
  assert.deepEqual(f.calls.map(call => [call.type, call.projectId]), [['project.read', 'lab']]);
  assert.deepEqual(Object.keys(f.sent.find(call => call.method === 'chat.unfurl').input.unfurls), ['https://map.example.com/projects/lab']);
  f.calls.length = 0; f.sent.length = 0;
  await f.store.update(state => { delete state.channels[channel]; });
  await f.plugin.unfurl('not-selected', { user, channel, message_ts: '180.001', links: [{ url: 'https://map.example.com/projects/private' }] });
  assert.deepEqual(f.calls, []); assert.deepEqual(f.sent, []);
});
test('gateway forbids remote hosts and passes actor without role escalation', async () => {
  assert.throws(() => new Gateway({ url: 'https://example.com', token: 'test', teamId }), /loopback/);
  let payload; const gateway = new Gateway({ url: 'http://127.0.0.1:8790', token: 'test-only', teamId, fetchImpl: async (_, options) => { payload = JSON.parse(options.body); return { ok: true, async json() { return { ok: true, data: { accepted: true } }; } }; } });
  await gateway.command('conversation.submit', { id: 'op', userId: user, projectId: 'lab', payload: { text: 'Hello' } }); assert.equal(payload.userId, user); assert.equal(payload.role, undefined);
});
test('unknown send is reconciled through own bot metadata instead of sent twice', async t => {
  const f = await fixture(t); let sends = 0;
  const client = { async apiCall(method, args) { if (method === 'chat.postMessage') { sends++; throw new Error('network timeout'); } if (method === 'conversations.replies') return { messages: [{ user: bot, ts: '2.0', metadata: { event_type: 'context_guard', event_payload: { id: 'send-1' } } }] }; return {}; } };
  const io = new SlackIO({ client, store: f.store, botUserId: bot, wait: async () => {} });
  const input = { id: 'send-1', channel, threadTs: '1.0', text: 'Hi' }; assert.equal(await io.post(input), '2.0'); assert.equal(await io.post(input), '2.0'); assert.equal(sends, 1);
});
test('unknown send missing from history is held for attention, never blindly retried', async t => {
  const f = await fixture(t); let sends = 0;
  const io = new SlackIO({ client: { async apiCall(method) { if (method === 'chat.postMessage') { sends++; throw new Error('network'); } return { messages: [] }; } }, store: f.store, botUserId: bot, wait: async () => {} });
  const input = { id: 'send-1', channel, threadTs: '1.0', text: 'Hi' }; await assert.rejects(io.post(input), UncertainDelivery); await assert.rejects(io.post(input), UncertainDelivery); assert.equal(sends, 1);
});
test('unknown top-level send reconciles channel history instead of invalid replies timestamp', async t => {
  const f = await fixture(t), methods = [];
  const io = new SlackIO({ client: { async apiCall(method) { methods.push(method); if (method === 'chat.postMessage') throw new Error('timeout'); return { messages: [{ user: bot, ts: '4.0', metadata: { event_type: 'context_guard', event_payload: { id: 'root' } } }] }; } }, store: f.store, botUserId: bot, wait: async () => {} });
  assert.equal(await io.post({ id: 'root', channel, text: 'root' }), '4.0'); assert.deepEqual(methods, ['chat.postMessage', 'conversations.history']);
});
test('Slack rate limits are bounded and honor Retry-After', async t => {
  const f = await fixture(t), waits = []; let calls = 0;
  const io = new SlackIO({ client: { async apiCall() { calls++; throw Object.assign(new Error('rate'), { code: 'slack_webapi_rate_limited_error', retryAfter: 3 }); } }, store: f.store, wait: async ms => waits.push(ms) });
  await assert.rejects(io.call('views.publish', {}), /rate/); assert.equal(calls, 3); assert.deepEqual(waits, [3000, 3000]);
});
test('long Retry-After is persisted without blocking or retrying earlier', async t => {
  const f = await fixture(t), envelope = { type: 'events_api', body: { event: { type: 'app_home_opened', user } } };
  f.gateway.command = async () => { throw Object.assign(new Error('rate'), { code: 'slack_webapi_rate_limited_error', retryAfter: 120 }); };
  await f.store.receive('E1', envelope); const before = Date.now(); await f.plugin.runEntry('E1', f.store.data.inbox.E1);
  assert.equal(f.store.data.inbox.E1.status, 'pending'); assert.ok(f.store.data.inbox.E1.next >= before + 120000);
});
test('file export persists stages, honors upload Retry-After and publishes same file once', async t => {
  const f = await fixture(t), calls = [], waits = []; let uploads = 0;
  const io = new SlackIO({ store: f.store, botUserId: bot, wait: async ms => waits.push(ms), client: { async apiCall(method, args) { calls.push({ method, args }); if (method === 'files.getUploadURLExternal') return { file_id: 'F1', upload_url: 'https://files.slack.com/upload/F1' }; return { files: [{ id: 'F1' }] }; } }, fetchImpl: async () => { uploads++; return uploads === 1 ? new Response(null, { status: 429, headers: { 'retry-after': '2' } }) : new Response('ok', { status: 200 }); } });
  const input = { id: 'export', channel, threadTs: '1.0', text: 'prompt', filename: 'prompt.md' };
  await io.uploadPrompt(input); await io.uploadPrompt(input);
  assert.deepEqual(waits, [2000]); assert.equal(uploads, 2); assert.equal(calls.filter(call => call.method === 'files.getUploadURLExternal').length, 1);
  assert.equal(calls.filter(call => call.method === 'files.completeUploadExternal').length, 1); assert.equal(f.store.data.outgoing.export.status, 'sent'); assert.equal(f.store.data.outgoing.export.uploadUrl, undefined);
  await assert.rejects(io.uploadPrompt({ ...input, text: 'different' }), /already used/);
});
test('known file completion rejection retries original file without another upload or allocation', async t => {
  const f = await fixture(t), calls = []; let completes = 0, uploads = 0;
  const io = new SlackIO({ store: f.store, botUserId: bot, wait: async () => {}, client: { async apiCall(method, args) { calls.push({ method, args }); if (method === 'files.getUploadURLExternal') return { file_id: 'F1', upload_url: 'https://files.slack.com/upload/F1' }; if (method === 'files.completeUploadExternal' && ++completes === 1) throw Object.assign(new Error('known platform rejection'), { code: 'slack_webapi_platform_error' }); return { files: [{ id: 'F1' }] }; } }, fetchImpl: async () => { uploads++; return new Response('ok'); } });
  const input = { id: 'export', channel, threadTs: '1.0', text: 'prompt', filename: 'prompt.md' };
  await assert.rejects(io.uploadPrompt(input), /known platform/); assert.equal(f.store.data.outgoing.export.status, 'failed'); assert.equal(f.store.data.outgoing.export.phase, 'complete');
  await io.uploadPrompt(input); assert.equal(uploads, 1); assert.equal(calls.filter(call => call.method === 'files.getUploadURLExternal').length, 1); assert.equal(completes, 2);
});
test('unknown file completion reconciles exact original file ID after restart without publishing twice', async t => {
  const f = await fixture(t); let allocated = 0, completed = 0;
  const client = { async apiCall(method) { if (method === 'files.getUploadURLExternal') { allocated++; return { file_id: 'F1', upload_url: 'https://files.slack.com/upload/F1' }; } if (method === 'files.completeUploadExternal') { completed++; throw new Error('connection lost'); } if (method === 'conversations.replies') return { messages: [{ user: bot, ts: '3.0', files: [{ id: 'F1', name: 'server-renamed-file.md' }] }] }; return {}; } };
  const io = new SlackIO({ client, store: f.store, botUserId: bot, wait: async () => {}, fetchImpl: async () => new Response('ok') });
  const input = { id: 'export', channel, threadTs: '1.0', text: 'prompt', filename: 'prompt.md' };
  await io.uploadPrompt(input); io.store = await new Store(f.directory).open(); await io.uploadPrompt(input);
  assert.equal(allocated, 1); assert.equal(completed, 1); assert.equal(io.store.data.outgoing.export.status, 'sent');
});
test('unknown file completion absent from Slack remains unknown and never reallocates', async t => {
  const f = await fixture(t); let allocated = 0, completed = 0;
  const client = { async apiCall(method) { if (method === 'files.getUploadURLExternal') { allocated++; return { file_id: 'F1', upload_url: 'https://files.slack.com/upload/F1' }; } if (method === 'files.completeUploadExternal') { completed++; throw new Error('network'); } return { messages: [] }; } };
  const io = new SlackIO({ client, store: f.store, botUserId: bot, wait: async () => {}, fetchImpl: async () => new Response('ok') });
  const input = { id: 'export', channel, threadTs: '1.0', text: 'prompt', filename: 'prompt.md' };
  await assert.rejects(io.uploadPrompt(input), UncertainDelivery); await assert.rejects(io.uploadPrompt(input), UncertainDelivery);
  assert.equal(allocated, 1); assert.equal(completed, 1); assert.equal(f.store.data.outgoing.export.status, 'unknown');
});
test('unsupported attachment and redirects to a non-Slack host never forward bot token', async t => {
  const f = await fixture(t); let requests = 0;
  const io = new SlackIO({ client: {}, store: f.store, botToken: 'test-only', fetchImpl: async () => { requests++; return new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }); } });
  await assert.rejects(io.download({ name: 'screen.png', mimetype: 'image/png', url_private: 'https://files.slack.com/file' }), /Untrusted/); assert.equal(requests, 1);
  await assert.rejects(io.download({ name: 'huge.txt', mimetype: 'text/plain', size: 300000, url_private: 'https://files.slack.com/file' }), /太大/);
});
test('Block Kit shows literal user text without mentions and emits versioned brief controls', () => {
  const blocks = messageBlocks({ text: '<@everyone>', questions: [{ id: 'q', text: 'Choose', options: ['one'] }] }, 'thread');
  assert.equal(blocks[0].text.type, 'plain_text');
  assert.equal(blocks[0].text.text, '<@everyone>');
  assert.equal(JSON.parse(approvalBlocks({ id: 'a', brief: { version: 'v' } }, 'thread')[1].elements[0].value).version, 'v');
  assert.deepEqual(formValues({ state: { values: { p: { v: { selected_option: { value: 'lab' } } } } } }), { p: 'lab' });
});
