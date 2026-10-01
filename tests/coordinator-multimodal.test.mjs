import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hash, readJSON } from '../scripts/shared/io.mjs';
import { CoordinatorModel } from '../scripts/cloud/coordinator-model.mjs';
import { CoordinatorService, CoordinatorConversations, CoordinatorMapIntake, coordinatorCompactBoundary } from '../scripts/cloud/coordinator-service.mjs';

const actor = { kind: 'human', source: 'slack', teamId: 'T_SYNTHETIC', userId: 'U_SYNTHETIC' };
const done = text => ({ content: [{ type: 'text', text }], stop: 'end_turn', usage: {} });
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-multimodal-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('synthetic image bytes');
  const image = { id: 'attachment-image', filename: 'screenshot.png', mimeType: 'image/png', size: bytes.length, hash: hash(bytes) };
  const resolutions = [];
  const resolveAttachment = async (id, context) => {
    resolutions.push({ id, context });
    assert.equal(id, image.id);
    return { ...image, ...(!context.metadataOnly ? { base64: bytes.toString('base64') } : {}) };
  };
  return { directory, image, resolutions, options: { directory, system: 'Coordinator', tools: [], execute: async () => {},
    retryDelayMs: 0, resolveAttachment, ...options } };
}

test('Image turns use a pinned Coordinator vision model and text follow-ups receive only evidenced observations and references', async t => {
  const calls = [];
  const text = { model: 'original-text', next: async input => { calls.push({ route: 'text', input }); return done('继续讨论'); } };
  const vision = { model: 'GLM-5.3-Flash', next: async input => {
    calls.push({ route: 'vision', input });
    return done(calls.filter(call => call.route === 'vision').length === 1 ? '附件 attachment-image 中显示 token 刷新错误。' : '可以修复刷新逻辑。');
  } };
  const { options, directory, image, resolutions } = await fixture(t, { model: text, visionModel: vision });
  const service = new CoordinatorService(options);
  await service.submit({ id: 'image-turn', text: '看截图', attachments: [{ id: image.id }] }, { source: 'slack', actor });
  await service.close();
  assert.deepEqual(calls.map(call => call.route), ['vision', 'vision']);
  assert.ok(calls[0].input.messages[0].content.some(block => block.type === 'image'));
  const persisted = await fs.readFile(path.join(directory, 'conversation.json'), 'utf8');
  assert.ok(!persisted.includes(Buffer.from('synthetic image bytes').toString('base64')));
  const firstState = await service.state();
  assert.deepEqual(firstState.modelRoute, { kind: 'vision', model: 'GLM-5.3-Flash' });
  assert.deepEqual(firstState.messages[0].actor, actor);
  assert.deepEqual(firstState.messages[0].attachments, [image]);
  assert.equal(firstState.messages[0].requestId, 'image-turn');
  assert.match(firstState.messages[0].visualSummary.text, /刷新错误/);
  assert.deepEqual(firstState.messages[0].visualSummary.attachments, [{ id: image.id, hash: image.hash }]);
  await service.submit({ id: 'text-followup', text: '下一步怎么改？' }); await service.close();
  const followup = calls.at(-1);
  assert.equal(followup.route, 'text');
  assert.match(JSON.stringify(followup.input.messages), /刷新错误/);
  assert.match(JSON.stringify(followup.input.messages), new RegExp(image.hash));
  assert.ok(!JSON.stringify(followup.input).includes('base64'));
  assert.ok(!JSON.stringify(followup.input).includes('"type":"image"'));
  assert.equal(resolutions.filter(call => !call.context.metadataOnly).length, 4, 'admission, preflight, visual observation and active image turn are protected reads');
  assert.equal((await service.state()).messages[0].id, firstState.messages[0].id);
});

test('Vision retries across restart preserve model identity, summary and exact attachment hash', async t => {
  let attempts = 0;
  const vision = { model: 'GLM-5.3-Flash', next: async () => {
    attempts++;
    if (attempts === 1) return done('附件中有一个登录按钮。');
    if (attempts === 2) throw Object.assign(new Error('synthetic outage'), { code: 'MODEL_UNAVAILABLE' });
    return done('已看过截图。');
  } };
  const { options, image } = await fixture(t, { model: { model: 'original', next: async () => assert.fail('text route must not replace vision') }, visionModel: vision, maxModelRetries: 0 });
  let service = new CoordinatorService(options);
  const input = { id: 'retry-image', text: '看图', attachments: [{ id: image.id }] };
  await service.submit(input, { source: 'slack', actor }); await service.close();
  assert.equal((await service.state()).status, 'error');
  const changed = new CoordinatorService({ ...options, visionModel: { model: 'other-model', next: async () => assert.fail('must reject changed provider') } });
  await changed.submit({ ...input, retry: true }, { source: 'slack', actor }); await changed.close();
  assert.equal((await changed.state()).error.code, 'MODEL_ROUTE_CHANGED');
  service = new CoordinatorService(options);
  await service.submit({ ...input, retry: true }, { source: 'slack', actor }); await service.close();
  assert.equal((await service.state()).status, 'waiting-for-user');
  assert.equal(attempts, 3, 'the persisted visual observation is not regenerated on retry');
  assert.equal((await service.state()).messages.filter(message => message.role === 'user').length, 1);
  await assert.rejects(service.submit({ ...input, text: 'different' }, { source: 'slack', actor }), { code: 'ID_REUSED' });
});

test('Unavailable vision and unauthorized or changed attachments never silently fall back to text', async t => {
  const text = { model: 'original', next: async () => assert.fail('unverified image must not invoke any model') };
  const { options, image } = await fixture(t, { model: text });
  const unavailable = new CoordinatorService(options);
  await assert.rejects(unavailable.submit({ id: 'missing-vision', attachments: [{ id: image.id }] }), { code: 'VISION_UNAVAILABLE' });
  assert.equal((await unavailable.state()).messages.length, 0);
  const denied = new CoordinatorService({ ...options, visionModel: text, resolveAttachment: async () => { throw Object.assign(new Error('denied'), { code: 'FORBIDDEN' }); } });
  await assert.rejects(denied.submit({ id: 'denied', attachments: [{ id: image.id }] }), { code: 'FORBIDDEN' });
  const corrupt = new CoordinatorService({ ...options, visionModel: text,
    resolveAttachment: async () => ({ ...image, base64: Buffer.from('changed').toString('base64') }) });
  await assert.rejects(corrupt.submit({ id: 'changed-bytes', attachments: [{ id: image.id }] }), { code: 'ATTACHMENT_CHANGED' });
  assert.equal((await corrupt.state()).messages.length, 0);
  await assert.rejects(unavailable.submit({ id: 'actor', text: 'hello' }, { source: 'slack' }), { code: 'INVALID_INPUT' });
});

test('Re-reading an old image is explicit and uses a new vision turn; tool pairs remain intact', async t => {
  let calls = 0;
  const vision = { model: 'GLM-5.3-Flash', next: async ({ tools }) => {
    calls++;
    if (!tools.length) return done('可见一个菜单。');
    if (calls === 2) return { content: [{ type: 'tool_use', id: 'read-node', name: 'read_map', input: { nodeId: 'N1' } }], stop: 'tool_use', usage: {} };
    return done('菜单对应 N1。');
  } };
  const { options, image, directory } = await fixture(t, { model: { model: 'original', next: async () => done('hello') }, visionModel: vision,
    tools: [{ name: 'read_map' }], execute: async () => ({ kind: 'map-read', node: { id: 'N1', title: 'Menu' } }) });
  const service = new CoordinatorService(options);
  await service.submit({ id: 'first-image', text: '读菜单', attachments: [{ id: image.id }] }); await service.close();
  await service.submit({ id: 'reread-image', text: '重新看原图', attachments: [{ id: image.id }] }); await service.close();
  const transcript = await readJSON(path.join(directory, 'conversation.json'));
  const toolIndex = transcript.messages.findIndex(message => message.content?.some?.(block => block.type === 'tool_use'));
  assert.equal(transcript.messages[toolIndex + 1].content[0].type, 'tool_result');
  assert.equal(transcript.messages[toolIndex + 1].content[0].tool_use_id, 'read-node');
  assert.equal(transcript.messages.filter(message => message.visualSummary).length, 2);
  assert.equal(coordinatorCompactBoundary(transcript.messages), transcript.messages.findIndex(message => message.requestId === 'reread-image'));
});

test('Manual chat identity and focus survive restart without automatic downgrade', async t => {
  const { directory } = await fixture(t);
  let registry = new CoordinatorConversations(directory);
  const id = await registry.createChat('slack-thread-1', { executionMode: 'manual' });
  await registry.setFocus(id, { nodeId: 'N1', kind: 'todo', itemId: 'TD1', title: 'Current task' });
  registry = new CoordinatorConversations(directory);
  assert.deepEqual(await registry.get(id), { id, scope: 'chat', title: 'Current task', createdAt: (await registry.get(id)).createdAt,
    executionMode: 'manual', nodeId: 'N1', kind: 'todo', itemId: 'TD1' });
  assert.equal(await registry.createChat('slack-thread-1', { executionMode: 'manual' }), id);
  await assert.rejects(registry.createChat('slack-thread-1'), { code: 'CONFLICT' });
  await assert.rejects(registry.setExecutionMode(id, 'automatic'), { code: 'INVALID_ARGUMENT' });
  const intake = new CoordinatorMapIntake({ directory });
  assert.deepEqual(intake.items({ id: 'N1', todos: [{ id: 'TD1', executionMode: 'manual' }, { id: 'TD2' }], bugs: [{ id: 'B1', executionMode: 'manual' }] })
    .map(entry => entry.item.id), ['TD2']);
});

test('Completed image history compaction uses only summaries and refs and retains the raw transcript', async t => {
  let regular = 0, compressed = 0;
  const text = { model: 'original', next: async input => {
    if (input.system.includes('历史对话')) {
      compressed++;
      const transcript = JSON.stringify(input.messages);
      assert.match(transcript, /attachment-image/);
      assert.match(transcript, /已观察/);
      assert.ok(!transcript.includes('base64'));
      assert.ok(!transcript.includes('"type":"image"'));
      return done('截图已读取，attachment-image 的可见登录按钮需调整。');
    }
    regular++;
    return { ...done('后续讨论'.repeat(30)), usage: { input_tokens: regular === 4 ? 200 : 10 } };
  } };
  const { options, image, directory } = await fixture(t, { model: text, compactAtTokens: 100,
    visionModel: { model: 'GLM-5.3-Flash', next: async () => done('已观察到截图里的登录按钮。'.repeat(15)) } });
  const service = new CoordinatorService(options);
  await service.submit({ id: 'image-for-compact', text: '截图', attachments: [{ id: image.id }] }); await service.close();
  for (let index = 1; index <= 4; index++) { await service.submit({ id: `text-${index}`, text: '讨论'.repeat(40) }); await service.close(); }
  assert.equal(compressed, 1);
  const state = await readJSON(path.join(directory, 'conversation.json'));
  assert.equal(state.compaction.through, 2);
  assert.deepEqual(state.messages[0].attachments, [image]);
  assert.match(state.messages[0].visualSummary.text, /登录按钮/);
});

test('UTF-8 attachments materialize through protected reads without persisting raw bytes', async t => {
  const bytes = Buffer.from('文档里确认 token 有效期为 30 分钟。');
  const reference = { id: 'attachment-text', filename: 'brief.md', mimeType: 'text/markdown', size: bytes.length, hash: hash(bytes) };
  let sent;
  const { options, directory } = await fixture(t, { model: { model: 'original', next: async input => { sent = input; return done(input.system.includes('附件阅读轮次') ? '附件确认 token 有效期为 30 分钟。' : '已读取文档。'); } },
    resolveAttachment: async () => ({ ...reference, base64: bytes.toString('base64') }) });
  const service = new CoordinatorService(options);
  await service.submit({ id: 'text-file', attachments: [{ id: reference.id }] }); await service.close();
  assert.match(JSON.stringify(sent.messages), /30 分钟/);
  const saved = await fs.readFile(path.join(directory, 'conversation.json'), 'utf8');
  assert.equal(JSON.parse(saved).messages[0].content, '');
  assert.match(JSON.parse(saved).messages[0].documentSummary.text, /30 分钟/);
  assert.ok(!saved.includes(bytes.toString('base64')));
  assert.equal((await service.state()).messages[0].attachments[0].id, reference.id);
  await service.submit({ id: 'file-followup', text: '时长是多少？' }); await service.close();
  assert.match(JSON.stringify(sent.messages), /30 分钟/);
  assert.ok(!JSON.stringify(sent.messages).includes('文档里确认 token'));
});

test('Attachment admission accepts six bounded UTF-8 files and rejects oversized, invalid or excessive inputs before persistence', async t => {
  const data = Buffer.alloc(256 * 1024, 'x');
  const ref = index => ({ id: `attachment-${index}`, filename: `text-${index}.txt`, mimeType: 'text/plain', size: data.length, hash: hash(data) });
  const { options } = await fixture(t, { model: { model: 'original', next: async () => done('文档有效。') },
    resolveAttachment: async (id, context) => ({ ...ref(id.split('-').at(-1)), ...(!context.metadataOnly ? { base64: data.toString('base64') } : {}) }) });
  const service = new CoordinatorService(options);
  const attachments = Array.from({ length: 6 }, (_, index) => ({ id: ref(index).id }));
  await service.submit({ id: 'six-files', text: '读取这些文件', attachments }); await service.close();
  assert.equal((await service.state()).messages[0].attachments.length, 6);
  await assert.rejects(service.submit({ id: 'seven-files', attachments: [...attachments, { id: 'attachment-7' }] }), { code: 'INVALID_INPUT' });
  const tooLarge = new CoordinatorService({ ...options, resolveAttachment: async id => ({ ...ref(0), id, size: data.length + 1 }) });
  await assert.rejects(tooLarge.submit({ id: 'large-text', attachments: [{ id: 'attachment-0' }] }), { code: 'ATTACHMENT_TOO_LARGE' });
  const invalidBytes = Buffer.from([0xff, 0xfe, 0xfd]);
  const invalid = new CoordinatorService({ ...options, resolveAttachment: async id => ({ ...ref(0), id, size: invalidBytes.length, hash: hash(invalidBytes), base64: invalidBytes.toString('base64') }) });
  await assert.rejects(invalid.submit({ id: 'invalid-utf8', attachments: [{ id: 'attachment-0' }] }), { code: 'INVALID_ATTACHMENT' });
  assert.ok(!(await service.state()).acceptedRequestIds.includes('invalid-utf8'));
});

test('Aggregate image and full provider payload limits reject attachment turns synchronously', async t => {
  const data = Buffer.alloc(3 * 1024 * 1024, 1);
  const image = id => ({ id, filename: 'image.png', mimeType: 'image/png', size: data.length, hash: hash(data), base64: data.toString('base64') });
  const { options } = await fixture(t, { model: { model: 'original', next: async () => assert.fail('reject before model call') },
    visionModel: { model: 'GLM-5.3-Flash', next: async () => assert.fail('reject before model call') }, resolveAttachment: async id => image(id) });
  const service = new CoordinatorService(options);
  await assert.rejects(service.submit({ id: 'image-total', attachments: [{ id: 'img1' }, { id: 'img2' }] }), { code: 'ATTACHMENT_TOO_LARGE' });
  assert.equal((await service.state()).messages.length, 0);
  const textBytes = Buffer.alloc(256 * 1024, 'x');
  const requestModel = new CoordinatorModel({ model: 'original', baseUrl: 'https://provider.invalid', token: 'synthetic', fetch: async () => assert.fail('preflight cannot call network') });
  const tooMuchContext = new CoordinatorService({ ...options, context: async () => ({ text: 'history'.repeat(2 * 1024 * 1024) }), model: requestModel,
    resolveAttachment: async id => ({ id, filename: 'large.txt', mimeType: 'text/plain', size: textBytes.length, hash: hash(textBytes), base64: textBytes.toString('base64') }) });
  await assert.rejects(tooMuchContext.submit({ id: 'body-total', attachments: [{ id: 'text1' }] }), { code: 'CONTEXT_TOO_LARGE' });
  assert.equal((await tooMuchContext.state()).messages.length, 0);
});

test('Provider protocols preserve image blocks and tool call pairs while default text providers reject image payloads', async () => {
  let request;
  const provider = { baseUrl: 'https://provider.invalid/api/v4', model: 'GLM-5.3-Flash', token: 'synthetic', protocol: 'openai', supportsImages: true,
    fetch: async (url, options) => {
      request = { url: url.href, body: JSON.parse(options.body) };
      return Response.json({ model: 'GLM-5.3-Flash', choices: [{ finish_reason: 'stop', message: { content: '可见按钮' } }], usage: { prompt_tokens: 20 } });
    } };
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'c3ludGhldGlj' } };
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'look' }, image] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tool1', name: 'read_map', input: { nodeId: 'N1' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool1', content: '{"ok":true}' }] }];
  const result = await new CoordinatorModel(provider).next({ system: 'Coordinator', messages });
  assert.equal(request.url, 'https://provider.invalid/api/v4/chat/completions');
  assert.equal(request.body.messages[1].content[1].image_url.url, 'data:image/png;base64,c3ludGhldGlj');
  assert.equal(request.body.messages[2].tool_calls[0].id, 'tool1');
  assert.equal(request.body.messages[3].tool_call_id, 'tool1');
  assert.equal(result.stop, 'end_turn');
  await assert.rejects(new CoordinatorModel({ ...provider, supportsImages: false }).next({ system: '', messages }), { code: 'MODEL_IMAGE_UNSUPPORTED' });
});
