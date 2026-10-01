import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store, threadKey } from '../src/store.mjs';
import { SlackPlugin, envelopeId } from '../src/plugin.mjs';
import { SlackIO, UncertainDelivery } from '../src/slack-io.mjs';
import { Gateway } from '../src/gateway.mjs';
import { homeView, formValues, messageBlocks, approvalBlocks } from '../src/views.mjs';

const teamId = 'T0BRW7G4Q6P', user = 'U000001', channel = 'C000001', bot = 'U000BOT';

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
    if (type === 'attachment.upload') return { id: 'attachment-1' };
    if (type === 'prompt.read') return { text: 'execute login', filename: 'prompt.md' };
    return { accepted: true };
  } };
  const io = { async post(input) { sent.push(input); return String(100 + sent.length) + '.001'; }, async update(...args) { sent.push({ update: args }); }, async call(method, input) { sent.push({ method, input }); if (method === 'conversations.info') return { channel: { user, id: input.channel } }; if (method === 'conversations.members') return { members: [user] }; return {}; },
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
test('tracked replies reuse conversation, new roots have independent conversations', async t => {
  const f = await fixture(t); await f.store.update(state => { state.channels[channel] = 'lab'; });
  await f.plugin.message('E1', event()); await f.plugin.message('E2', event({ ts: '123.002', thread_ts: '123.001', text: 'reply' }));
  await f.plugin.message('E3', event({ ts: '124.001' }));
  assert.equal(f.calls.filter(call => call.type === 'conversation.create').length, 2);
  const submits = f.calls.filter(call => call.type === 'conversation.submit'); assert.equal(submits[0].conversationId, submits[1].conversationId); assert.notEqual(submits[1].conversationId, submits[2].conversationId);
});
test('DM requires explicit project selection and immutable thread cannot be rebound', async t => {
  const f = await fixture(t); await f.plugin.message('E1', event({ channel: 'D000001', text: 'hello' })); assert.equal(f.calls.length, 0); assert.match(f.sent[0].text, /选择项目/);
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
test('real waiting-for-user state finalizes streamed reply in place after restart', async t => {
  const f = await fixture(t), key = threadKey(teamId, channel, '123.001'); await f.store.bind(key, { channel, threadTs: '123.001', projectId: 'lab', conversationId: 'chat-one', userId: user, ownRequests: ['request-one'] });
  f.gateway.command = async () => ({ status: 'running', activeTurnId: 'request-one', streamingText: 'partial', messages: [{ id: 'u1', role: 'user', requestId: 'request-one', text: 'question' }], approvals: [] });
  await f.plugin.mirror(key); assert.equal(f.sent.filter(call => call.channel).length, 1);
  f.plugin.store = await new Store(f.directory).open();
  f.gateway.command = async () => ({ status: 'waiting-for-user', activeTurnId: null, streamingText: '', messages: [{ id: 'u1', role: 'user', requestId: 'request-one', text: 'question' }, { id: 'a1', role: 'assistant', text: 'complete answer' }], approvals: [] });
  await f.plugin.mirror(key); assert.equal(f.sent.filter(call => call.channel).length, 1); assert.equal(f.sent.filter(call => call.update).length, 1); assert.equal(f.plugin.store.data.threads[key].liveStream, undefined);
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
test('Block Kit escapes user markup and emits versioned brief and question controls', () => {
  const blocks = messageBlocks({ text: '<@everyone>', questions: [{ id: 'q', text: 'Choose', options: ['one'] }] }, 'thread'); assert.match(JSON.stringify(blocks), /&lt;@everyone&gt;/);
  assert.equal(JSON.parse(approvalBlocks({ id: 'a', brief: { version: 'v' } }, 'thread')[1].elements[0].value).version, 'v');
  assert.deepEqual(formValues({ state: { values: { p: { v: { selected_option: { value: 'lab' } } } } } }), { p: 'lab' });
});
