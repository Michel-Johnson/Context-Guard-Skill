import { digest, threadKey } from './store.mjs';
import { MAX_TOTAL_IMAGE_BYTES } from './slack-io.mjs';
import { homeView, nodesOf, modal, formValues, messageBlocks, approvalBlocks, section, escape } from './views.mjs';

const operationId = (id, suffix) => `slack-${digest(`${id}:${suffix}`)}`;
const isMessage = event => ['message', 'app_mention'].includes(event?.type) && !event.bot_id && !event.bot_profile && !event.hidden && (!event.subtype || event.subtype === 'file_share');
export function envelopeId(type, body, fallback) {
  if (isMessage(body.event)) return `message:${body.team_id}:${body.event.channel}:${body.event.ts}`;
  return `${type}:${body.event_id || digest([body.team?.id || body.team_id, body.trigger_id || body.view?.id || fallback, body.view?.hash, body.view?.state?.values, body.actions?.map(action => [action.action_id, action.action_ts, action.value, action.selected_option?.value])])}`;
}
function safeEnvelope(type, body) {
  const copy = structuredClone(body);
  delete copy.token; delete copy.response_url;
  if (copy.response_urls) delete copy.response_urls;
  return { type, body: copy };
}
function contextFrom(binding, userId, id) { return { id, userId, projectId: binding.projectId, conversationId: binding.conversationId }; }

export class SlackPlugin {
  constructor({ store, gateway, io, teamId, cloudOrigin, botUserId, pollMs = 2000, logger = console }) {
    this.store = store; this.gateway = gateway; this.io = io; this.teamId = teamId; this.cloudOrigin = new URL(cloudOrigin).origin; this.botUserId = botUserId;
    this.pollMs = Math.max(1000, pollMs); this.logger = logger; this.projects = new Map(); this.maps = new Map(); this.stopped = true; this.active = null; this.cursor = 0;
    this.processing = new Map();
  }
  async receive({ type, body, envelope_id, ack }) {
    const team = body.team_id || body.team?.id || body.event?.team;
    if (team !== this.teamId) { await ack(); return; }
    const id = envelopeId(type, body, envelope_id);
    if (Object.keys(this.store.data.inbox).length > 50000 && !this.store.data.inbox[id]) throw new Error('Slack journal capacity exceeded');
    const fresh = await this.store.receive(id, safeEnvelope(type, body));
    await ack(type === 'slash_commands' ? { text: '已收到，正在处理。' } : undefined);
    // Modal trigger IDs expire quickly. Do not place them behind model polling
    // or attachment downloads; the journal is still durable before execution.
    if (fresh && !this.stopped && (type === 'slash_commands' || type === 'interactive')) {
      this.processing.set(id, this.runEntry(id, this.store.data.inbox[id]).finally(() => this.processing.delete(id)));
    }
    this.kick();
  }
  start() { this.stopped = false; this.kick(); }
  async stop() { this.stopped = true; clearTimeout(this.timer); if (this.active) await this.active; await Promise.allSettled([...this.processing.values()]); await this.store.tail; }
  kick() {
    if (this.stopped || this.active) return;
    clearTimeout(this.timer);
    this.active = this.tick().catch(error => this.logger.error('Slack plugin cycle failed', { code: error.code || 'PLUGIN_ERROR' })).finally(() => {
      this.active = null;
      if (!this.stopped) this.timer = setTimeout(() => this.kick(), this.pollMs);
    });
  }
  async tick() {
    for (const [id, entry] of Object.entries(this.store.data.inbox).filter(([id, item]) => item.status === 'pending' && item.next <= Date.now() && !this.processing.has(id)).slice(0, 8)) {
      if (this.stopped) return;
      const running = this.runEntry(id, entry).finally(() => this.processing.delete(id)); this.processing.set(id, running); await running;
    }
    const bindings = Object.entries(this.store.data.threads);
    if (!bindings.length || this.stopped) return;
    // At most four linked conversations per cycle; dormant links are polled at
    // most once a minute. No unlinked project conversation is ever broadcast.
    for (let count = 0; count < Math.min(4, bindings.length); count++) {
      const [key, binding] = bindings[(this.cursor++) % bindings.length];
      if ((binding.nextPoll || 0) > Date.now()) continue;
      try { await this.mirror(key); }
      catch (error) { this.logger.warn('Slack mirror failed', { code: error.code || 'MIRROR_ERROR' }); await this.store.update(state => { state.threads[key].nextPoll = Date.now() + 30000; state.threads[key].error = error.code || 'MIRROR_ERROR'; }); }
    }
  }
  async runEntry(id, entry) {
    try {
      await this.process(id, entry.envelope);
      await this.store.update(state => { state.inbox[id].status = 'done'; state.inbox[id].doneAt = Date.now(); });
    } catch (error) {
      const transient = ['BUSY', 'COORDINATOR_BUSY', 'GATEWAY_ERROR', 'DELIVERY_UNCERTAIN', 'SLACK_UPLOAD_UNAVAILABLE', 'slack_webapi_http_error', 'slack_webapi_rate_limited_error', 'slack_webapi_request_error'].includes(error.code) || error.name === 'TimeoutError' || error instanceof TypeError;
      const retryAfter = Number(error.retryAfter ?? error.data?.retry_after ?? 0);
      const validDelay = Number.isFinite(retryAfter) && retryAfter >= 0 && retryAfter <= 86400;
      await this.store.update(state => {
        const item = state.inbox[id]; item.attempts++; item.error = error.code || 'PLUGIN_ERROR';
        item.status = transient && validDelay && item.attempts < 8 ? 'pending' : 'attention';
        item.next = Date.now() + Math.max(Math.min(60000, 1000 * 2 ** item.attempts), validDelay ? retryAfter * 1000 : 0);
      });
      this.logger.warn('Slack operation failed', { id: digest(id).slice(0, 12), code: error.code || 'PLUGIN_ERROR' });
      if (!transient) await this.reportError(id, entry.envelope.body, error).catch(() => {});
    }
  }
  async command(type, binding, userId, id, payload = {}) { return this.gateway.command(type, { ...contextFrom(binding, userId, id), payload }); }
  async process(id, { type, body }) {
    const userId = body.user?.id || body.user_id || body.event?.user;
    if (type === 'events_api') {
      if (body.event?.type === 'app_home_opened') return this.publishHome(userId, id);
      if (body.event?.type === 'link_shared') return this.unfurl(id, body.event);
      if (isMessage(body.event) && body.event.user !== this.botUserId) return this.message(id, body.event);
      return;
    }
    if (type === 'slash_commands') {
      if (body.command !== '/cg') return;
      const projectId = this.store.data.channels[body.channel_id] || this.store.data.preferences[userId];
      const binding = { channel: body.channel_id, threadTs: null, projectId };
      if (body.text?.trim().startsWith('ask ')) return this.message(id, { type: 'app_mention', user: userId, channel: body.channel_id, ts: `command-${digest(id).slice(0, 12)}`, text: body.text.trim().slice(4) });
      if (!this.projects.has(userId)) await this.loadProjects(userId, id);
      return this.openForm(body.trigger_id, userId, id, 'binding', binding);
    }
    if (type !== 'interactive') return;
    if (body.type === 'view_submission') return this.submitForm(id, body, userId);
    if (body.type === 'shortcut' || body.type === 'message_action') {
      if (!this.projects.has(userId)) await this.loadProjects(userId, id);
      const projectId = this.store.data.channels[body.channel?.id] || this.store.data.preferences[userId];
      return this.openForm(body.trigger_id, userId, id, 'item', { projectId, channel: body.channel?.id, threadTs: body.message?.thread_ts || body.message?.ts, kind: body.callback_id?.startsWith('cg_bug') ? 'bug' : 'todo', initialText: body.message?.text || '' });
    }
    for (const action of body.actions || []) {
      if (action.action_id === 'form_project') { await this.selectFormProject(id, body, userId, action.selected_option?.value); continue; }
      if (action.action_id === 'select_project') {
        const projectId = action.selected_option?.value;
        const projects = this.projects.get(userId) || await this.loadProjects(userId, id);
        if (!projects.some(project => project.id === projectId)) throw new Error('Project is not available');
        await this.store.update(state => { state.preferences[userId] = projectId; });
        await this.publishHome(userId, id); continue;
      }
      let value; try { value = JSON.parse(action.value || '{}'); } catch { throw new Error('Invalid interaction'); }
      if (action.action_id === 'open_item') await this.openForm(body.trigger_id, userId, id, 'item', value);
      else if (action.action_id === 'open_memory') await this.openForm(body.trigger_id, userId, id, 'memory', value);
      else if (action.action_id === 'open_binding') await this.openForm(body.trigger_id, userId, id, 'binding', value);
      else if (action.action_id === 'open_answer') await this.openForm(body.trigger_id, userId, id, 'answer', value);
      else if (action.action_id === 'reject_brief') await this.openForm(body.trigger_id, userId, id, 'reject', value);
      else if (action.action_id === 'answer_question') await this.answer(id, userId, value);
      else if (action.action_id === 'approve_brief') await this.review(id, userId, value, 'approved', '用户在 Slack 中确认 brief');
      else if (action.action_id === 'export_prompt') await this.exportPrompt(id, userId, value);
    }
  }
  async loadProjects(userId, id) { const result = await this.gateway.command('project.list', { id: operationId(id, 'projects'), userId }); this.projects.set(userId, result.projects || []); return result.projects || []; }
  async readProject(projectId, userId, id) { const result = await this.gateway.command('project.read', { id: operationId(id, 'read'), userId, projectId }); this.maps.set(projectId, result); return result; }
  async publishHome(userId, id) {
    const projects = await this.loadProjects(userId, id), projectId = this.store.data.preferences[userId];
    const project = projectId && projects.some(item => item.id === projectId) ? await this.readProject(projectId, userId, id) : null;
    return this.io.call('views.publish', { user_id: userId, view: homeView({ projects, project, cloudOrigin: this.cloudOrigin, userId }) });
  }
  async ensureBinding(id, event) {
    const rootTs = event.thread_ts || event.ts;
    let key = threadKey(this.teamId, event.channel, rootTs), existing = this.store.data.threads[key];
    if (existing) return [key, existing];
    const direct = event.channel_type === 'im' || event.channel?.startsWith('D');
    if (!direct && event.type !== 'app_mention' && !String(event.text || '').includes(`<@${this.botUserId}>`)) return [];
    const projectId = direct ? this.store.data.preferences[event.user] : this.store.data.channels[event.channel];
    if (!projectId) {
      await this.io.post({ id: operationId(id, 'choose'), channel: event.channel, threadTs: event.ts?.startsWith('command-') ? undefined : rootTs, text: '请先在 App Home 选择项目；频道请使用 /cg 关联项目。' });
      return [];
    }
    // Slash command has no message timestamp. Create a real root message first.
    const threadTs = rootTs?.startsWith('command-') ? await this.io.post({ id: operationId(id, 'root'), channel: event.channel, text: `Coordinator · ${projectId}` }) : rootTs;
    key = threadKey(this.teamId, event.channel, threadTs);
    const created = await this.gateway.command('conversation.create', { id: operationId(id, 'create'), userId: event.user, projectId, payload: { operationId: operationId(id, 'create') } });
    const binding = await this.store.bind(key, { channel: event.channel, threadTs, projectId, conversationId: created.conversationId, userId: event.user, ownRequests: [] });
    return [key, binding];
  }
  async message(id, event) {
    if ((event.files || []).length > 6) throw new Error('每条消息最多 6 个附件');
    const [key, binding] = await this.ensureBinding(id, event);
    if (!binding) return;
    const attachments = [], inputs = []; let imageBytes = 0;
    for (const file of event.files || []) {
      const input = await this.io.download(file);
      if (input.mimeType.startsWith('image/')) imageBytes += Buffer.byteLength(input.base64, 'base64');
      if (imageBytes > MAX_TOTAL_IMAGE_BYTES) throw Object.assign(new Error('同一条消息的图片总计不得超过 5 MiB'), { code: 'ATTACHMENT_TOO_LARGE' });
      inputs.push({ file, input });
    }
    // Validate the complete turn before persisting any attachment into Cloud.
    for (const { file, input } of inputs) {
      const uploaded = await this.command('attachment.upload', binding, event.user, operationId(id, `file:${file.id}`), input);
      attachments.push({ id: uploaded.id });
    }
    const text = String(event.text || '').replaceAll(`<@${this.botUserId}>`, '').trim();
    if (!text && !attachments.length) return;
    const requestId = operationId(id, 'submit');
    await this.store.update(state => { const item = state.threads[key]; if (!item.ownRequests.includes(requestId)) item.ownRequests.push(requestId); item.nextPoll = 0; });
    await this.command('conversation.submit', binding, event.user, requestId, { text: text || '请阅读附件。', ...(attachments.length ? { attachments } : {}) });
    if (!event.ts?.startsWith('command-')) await this.io.call('reactions.add', { channel: event.channel, timestamp: event.ts, name: 'eyes' }).catch(() => {});
  }
  async openForm(triggerId, userId, id, kind, context) {
    const draftId = `draft-${digest(id)}`, binding = context.key && this.store.data.threads[context.key];
    const projectId = binding?.projectId || context.projectId || this.store.data.preferences[userId];
    const projects = this.projects.get(userId) || [];
    let project = projectId && this.maps.get(projectId);
    if (['item', 'memory'].includes(kind) && projectId) project ||= await this.readProject(projectId, userId, id);
    const node = project && nodesOf(project.map).find(item => item.id === context.nodeId);
    const item = node && (node[context.kind === 'bug' ? 'bugs' : 'todos'] || []).find(item => item.id === context.itemId);
    const draft = { userId, kind, context: { ...context, projectId }, project, createdAt: Date.now() };
    await this.store.update(state => { state.drafts[draftId] = draft; });
    let fields, initial = {}, title;
    const projectField = { id: 'project', label: '项目', options: projects.map(item => ({ label: item.name || item.id, value: item.id })) };
    if (kind === 'binding') {
      fields = [projectField, { id: 'channel', label: '关联频道 ID（D 私聊无需填）', optional: true }, { id: 'conversation', label: '关联已有 Cloud 对话 ID（可留空）', optional: true }, { id: 'thread', label: '已有线程时间戳（关联对话时填写）', optional: true }]; title = '关联项目 / Cloud 对话';
      initial = { project: projectId, channel: context.channel || '', thread: context.threadTs || '' };
    } else if (kind === 'answer' || kind === 'reject') {
      fields = [{ id: 'text', label: kind === 'answer' ? '回答' : '退回原因', multiline: true }]; title = kind === 'answer' ? '回答 Coordinator' : '退回 brief';
    } else if (kind === 'memory') {
      if ((node?.memoryDocument || '').length > 2900) throw new Error('记忆超过 Slack 表单长度，请在工作台编辑完整文档；不会截断原文');
      fields = [projectField, { id: 'node', label: '节点 ID（见 Home 导航）' }, { id: 'text', label: '节点 memory.md（替换全文，保留六部分标题）', multiline: true }]; title = '编辑节点记忆'; initial = { project: projectId, node: context.nodeId || '', text: node?.memoryDocument || '' };
    } else {
      const statuses = context.kind === 'bug' ? ['open', 'fixed', 'resolved', 'unfixable'] : ['pending', 'processing', 'done'];
      const itemText = context.kind === 'bug' ? item?.phenomenon || item?.description || item?.desc || item?.text : item?.description || item?.desc || item?.text;
      if ((itemText || '').length > 2900) throw new Error('事项正文超过 Slack 表单长度，请在工作台编辑；不会截断原文');
      fields = [projectField, { id: 'node', label: '节点 ID（见 Home 导航）' }, { id: 'title', label: '标题' }, { id: 'text', label: '需求 / 现象及验收要求', multiline: true, optional: true }, { id: 'status', label: '状态', options: statuses.map(value => ({ label: value, value })) }]; title = context.kind === 'bug' ? 'Bug' : 'TODO';
      initial = { project: projectId, node: context.nodeId || '', title: item?.title || '', text: itemText || context.initialText?.slice(0, 2900) || '', status: statuses.includes(item?.status) ? item.status : statuses[0] };
    }
    if (fields.some(field => field.options && !field.options.length)) throw new Error('请先打开 App Home 加载可用项目');
    await this.io.call('views.open', { trigger_id: triggerId, view: modal({ callback: `cg_${kind}`, draftId, title, fields, initial }) });
  }
  async submitForm(id, body, userId) {
    const draftId = body.view.private_metadata, draft = this.store.data.drafts[draftId];
    if (!draft || draft.userId !== userId || Date.now() - draft.createdAt > 86400000) throw new Error('表单已失效，请重新打开');
    const values = formValues(body.view), context = draft.context;
    if (draft.kind === 'answer') return this.answer(id, userId, { ...context, text: values.text });
    if (draft.kind === 'reject') return this.review(id, userId, context, 'rejected', values.text);
    const projectId = values.project;
    const projects = this.projects.get(userId) || await this.loadProjects(userId, id);
    if (!projects.some(item => item.id === projectId)) throw new Error('项目不在开放列表');
    if (draft.kind === 'binding') {
      if (values.channel && !/^[CGD][A-Z0-9]{6,}$/.test(values.channel)) throw new Error('请输入 Slack 频道 ID');
      if (values.channel) {
        // Only a channel the bot and submitting user can see can be bound.
        const info = await this.io.call('conversations.info', { channel: values.channel });
        if (values.channel.startsWith('D')) {
          if (info.channel?.user !== userId) throw new Error('只能关联自己的私聊');
        } else {
          const members = await this.channelMembers(values.channel);
          if (!members.includes(userId)) throw new Error('只能关联自己所在的频道');
        }
        await this.store.update(state => { state.channels[values.channel] = projectId; });
      }
      await this.store.update(state => { state.preferences[userId] = projectId; });
      if (values.conversation) {
        if (!values.channel || !/^\d+\.\d+$/.test(values.thread)) throw new Error('关联已有对话需要频道和有效线程时间戳');
        const bound = await this.gateway.command('conversation.bind', { id: operationId(id, 'bind'), userId, projectId, payload: { conversationId: values.conversation } });
        await this.store.bind(threadKey(this.teamId, values.channel, values.thread), { channel: values.channel, threadTs: values.thread, projectId, conversationId: bound.conversationId, userId, ownRequests: [] });
      }
      await this.publishHome(userId, id); return;
    }
    if (draft.project?.id !== projectId) throw new Error('项目已改变，请先选择项目并重新打开表单');
    const node = nodesOf(draft.project.map).find(node => node.id === values.node);
    if (!node) throw new Error('节点不存在，请刷新 Home');
    let fields;
    if (draft.kind === 'memory') {
      fields = { memoryDocument: values.text };
    } else {
      const field = context.kind === 'bug' ? 'bugs' : 'todos', items = structuredClone(node[field] || []);
      const index = items.findIndex(item => item.id === context.itemId);
      if (context.itemId && index < 0) throw new Error('事项不存在，请刷新 Home');
      const item = { ...(index >= 0 ? items[index] : { executionMode: 'manual' }), id: context.itemId || `${context.kind === 'bug' ? 'B' : 'TD'}-slack-${digest(id).slice(0, 20)}`, title: values.title, text: values.text, status: values.status };
      item.description = values.text;
      if (context.kind === 'bug') item.phenomenon = values.text;
      if (Object.hasOwn(item, 'desc')) item.desc = values.text;
      if (index >= 0) items[index] = item; else items.push(item);
      fields = { [field]: items };
    }
    await this.gateway.command('map.write', { id: operationId(id, 'write'), userId, projectId, payload: { baseVersion: draft.project.version, operations: [{ type: 'update', id: node.id, fields }] } });
    await this.store.update(state => { delete state.drafts[draftId]; });
    await this.publishHome(userId, id);
  }
  async selectFormProject(id, body, userId, projectId) {
    const draftId = body.view?.private_metadata, draft = this.store.data.drafts[draftId];
    if (!draft || draft.userId !== userId) throw new Error('表单已失效');
    const projects = this.projects.get(userId) || await this.loadProjects(userId, id);
    if (!projects.some(project => project.id === projectId)) throw new Error('项目不在开放列表');
    if (draft.context.itemId && draft.context.projectId !== projectId) throw new Error('编辑已有事项不能跨项目移动');
    const project = await this.readProject(projectId, userId, id);
    await this.store.update(state => { state.drafts[draftId].project = project; state.drafts[draftId].context.projectId = projectId; });
    // A project switch pins a fresh server version and retains typed prose.
    const view = { type: 'modal', callback_id: body.view.callback_id, private_metadata: draftId, title: body.view.title, submit: body.view.submit, close: body.view.close, blocks: structuredClone(body.view.blocks) };
    const values = formValues(body.view);
    for (const block of view.blocks) {
      if (block.block_id === 'project') block.element.initial_option = block.element.options.find(option => option.value === projectId);
      else if (block.element?.type === 'plain_text_input' && values[block.block_id]) block.element.initial_value = values[block.block_id];
    }
    await this.io.call('views.update', { view_id: body.view.id, hash: body.view.hash, view });
  }
  async channelMembers(channel) {
    let cursor; const members = [];
    for (let page = 0; page < 20; page++) { const result = await this.io.call('conversations.members', { channel, limit: 200, ...(cursor ? { cursor } : {}) }); members.push(...(result.members || [])); cursor = result.response_metadata?.next_cursor; if (!cursor) return members; }
    throw new Error('无法核对频道成员，请使用更小的频道');
  }
  async answer(id, userId, value) {
    const binding = this.store.data.threads[value.key]; if (!binding) throw new Error('Unknown Slack thread');
    const requestId = operationId(id, 'answer');
    await this.store.update(state => { if (!state.threads[value.key].ownRequests.includes(requestId)) state.threads[value.key].ownRequests.push(requestId); state.threads[value.key].nextPoll = 0; });
    await this.command('conversation.submit', binding, userId, requestId, { text: value.text, answerTo: value.questionId });
  }
  async review(id, userId, value, decision, reason) {
    const binding = this.store.data.threads[value.key]; if (!binding) throw new Error('Unknown Slack thread');
    const result = await this.command('brief.review', binding, userId, operationId(id, 'review'), { proposalId: value.proposalId, decision, reason, version: value.version });
    await this.io.post({ id: operationId(id, 'review-result'), channel: binding.channel, threadTs: binding.threadTs, text: decision === 'approved' ? 'brief 已确认，Main 事项已保存。执行提示可直接粘贴到 Codex / Cursor / Claude。' : 'brief 已退回。',
      ...(decision === 'approved' ? { blocks: [section('brief 已确认。由厂商 Agent 执行，结果通过 hooks 写回 Session。'), { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '导出执行提示' }, action_id: 'export_prompt', value: JSON.stringify({ key: value.key, proposalId: value.proposalId }) }] }] } : {}) });
    await this.store.update(state => { state.threads[value.key].nextPoll = 0; });
    if (decision === 'approved' && result.itemId && result.nodeId) await this.store.update(state => {
      const thread = state.threads[value.key]; thread.watchedItems ||= {};
      thread.watchedItems[result.itemId] ||= { nodeId: result.nodeId, kind: result.kind || 'todo', status: null }; thread.nextItemPoll = 0;
    });
    return result;
  }
  async exportPrompt(id, userId, value) {
    const binding = this.store.data.threads[value.key]; if (!binding) throw new Error('Unknown Slack thread');
    const prompt = await this.command('prompt.read', binding, userId, operationId(id, 'prompt'), { proposalId: value.proposalId });
    await this.io.uploadPrompt({ id: operationId(id, 'file-export'), channel: binding.channel, threadTs: binding.threadTs, ...prompt });
  }
  async mirror(key) {
    const binding = this.store.data.threads[key];
    const state = await this.command('conversation.state', binding, binding.userId, operationId(`${key}:${Date.now()}`, 'state'));
    const messages = state.messages || [], lastAssistant = messages.findLastIndex(message => message.role === 'assistant');
    let currentRequest = null;
    for (const [index, message] of messages.entries()) {
      if (message.role === 'user') currentRequest = message.requestId;
      const requestId = message.requestId || (message.role === 'assistant' ? currentRequest : null);
      const id = message.id || digest(message);
      if (!message.text && !message.questions?.length && !message.attachments?.length) continue;
      if (message.role === 'user' && (message.source === 'workflow' || String(message.text || '').trimStart().startsWith('[服务器工作流事件'))) continue;
      if (message.role === 'user' && this.store.data.threads[key].ownRequests.includes(message.requestId)) continue;
      if (state.status === 'running' && state.streamingText && index === lastAssistant && requestId === state.activeTurnId) continue;
      const stream = this.store.data.threads[key].liveStream;
      const settled = !state.activeTurnId && ['waiting-for-user', 'idle'].includes(state.status);
      // A model step can save waiting-for-user before the service clears the
      // turn ID. Keep the existing partial message until that durable boundary
      // settles, rather than posting a second final and later updating both.
      if (stream && index === lastAssistant && stream.turnId === requestId && !settled) continue;
      const content = digest(message), prior = this.store.data.threads[key].mirrored[id];
      if (prior?.hash === content) continue;
      const text = `${message.role === 'user' ? '工作台用户' : 'Coordinator'}：${message.text || '附件'}`, blocks = messageBlocks(message, key);
      const replaceStream = !!stream && index === lastAssistant && settled && stream.turnId === requestId;
      const existingTs = prior?.ts || (replaceStream ? stream.ts : null);
      const ts = existingTs ? (await this.io.update(binding.channel, existingTs, text, blocks), existingTs) : await this.io.post({ id: operationId(`${key}:${id}`, 'mirror'), channel: binding.channel, threadTs: binding.threadTs, text, blocks });
      await this.store.update(data => { data.threads[key].mirrored[id] = { ts, hash: content }; if (replaceStream) delete data.threads[key].liveStream; });
    }
    if (state.streamingText && state.status === 'running') {
      const streamId = `stream:${state.activeTurnId}`, prior = this.store.data.threads[key].mirrored[streamId], content = digest(state.streamingText);
      if (prior?.hash !== content) {
        const text = `Coordinator：${state.streamingText}`;
        const ts = prior?.ts ? (await this.io.update(binding.channel, prior.ts, text), prior.ts) : await this.io.post({ id: operationId(`${key}:${streamId}`, 'stream'), channel: binding.channel, threadTs: binding.threadTs, text });
        await this.store.update(data => { data.threads[key].mirrored[streamId] = { ts, hash: content }; data.threads[key].liveStream = { ts, turnId: state.activeTurnId }; });
      }
    }
    for (const approval of state.approvals || []) {
      if (approval.manual !== true) continue;
      const id = `approval:${approval.id}`, hash = digest(approval), prior = this.store.data.threads[key].mirrored[id];
      if (prior?.hash === hash) continue;
      if (approval.pending === false && !prior) continue;
      const resolved = approval.pending === false;
      const text = resolved ? `brief 已${approval.decision === 'approved' ? '确认' : '退回'}` : 'Coordinator：等待人工确认 brief';
      const blocks = resolved ? [section(text), ...(approval.decision === 'approved' ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '导出执行提示' }, action_id: 'export_prompt', value: JSON.stringify({ key, proposalId: approval.id }) }] }] : [])] : approvalBlocks(approval, key);
      const ts = prior?.ts ? (await this.io.update(binding.channel, prior.ts, text, blocks), prior.ts) : await this.io.post({ id: operationId(`${key}:${id}`, 'card'), channel: binding.channel, threadTs: binding.threadTs, text, blocks });
      await this.store.update(data => { data.threads[key].mirrored[id] = { ts, hash }; });
      if (resolved && approval.decision === 'approved' && approval.itemId && approval.nodeId) await this.store.update(data => {
        const thread = data.threads[key]; thread.watchedItems ||= {}; thread.watchedItems[approval.itemId] ||= { nodeId: approval.nodeId, kind: approval.kind || 'todo', status: null };
      });
    }
    if (Object.keys(this.store.data.threads[key].watchedItems || {}).length && (this.store.data.threads[key].nextItemPoll || 0) <= Date.now()) await this.notifyItemChanges(key);
    if (state.status === 'error') await this.io.post({ id: operationId(`${key}:${state.activeTurnId}:${state.error?.code}`, 'error'), channel: binding.channel, threadTs: binding.threadTs, text: `Coordinator 当前失败：${state.error?.code || 'UNKNOWN'}。请在工作台查看并重试；不会显示假成功。` });
    await this.store.update(data => { data.threads[key].nextPoll = Date.now() + (state.status === 'running' || state.activeTurnId ? this.pollMs : 15000); data.threads[key].error = null; });
  }
  async notifyItemChanges(key) {
    const thread = this.store.data.threads[key], project = await this.readProject(thread.projectId, thread.userId, `${key}:${Date.now()}`);
    const nodes = nodesOf(project.map);
    for (const [itemId, watch] of Object.entries(thread.watchedItems || {})) {
      const node = nodes.find(node => node.id === watch.nodeId), item = node?.[watch.kind === 'bug' ? 'bugs' : 'todos']?.find(item => item.id === itemId);
      const status = item ? item.status || (watch.kind === 'bug' ? 'open' : 'pending') : 'removed';
      if (watch.status && watch.status !== status) await this.io.post({ id: operationId(`${key}:${itemId}:${project.version}:${status}`, 'item-status'), channel: thread.channel, threadTs: thread.threadTs,
        text: `Main ${watch.kind.toUpperCase()} ${itemId}：${watch.status} → ${status}${item?.title ? `\n${item.title}` : ''}` });
      await this.store.update(data => { data.threads[key].watchedItems[itemId].status = status; });
    }
    await this.store.update(data => { data.threads[key].nextItemPoll = Date.now() + 30000; });
  }
  async unfurl(id, event) {
    const projectId = this.store.data.channels[event.channel] || this.store.data.preferences[event.user];
    if (!projectId) return;
    const unfurls = {};
    for (const link of (event.links || []).slice(0, 5)) {
      let url; try { url = new URL(link.url); } catch { continue; }
      if (url.origin !== this.cloudOrigin || url.pathname !== `/projects/${encodeURIComponent(projectId)}`) continue;
      const project = await this.readProject(projectId, event.user, id);
      unfurls[link.url] = { blocks: [section(`*${escape(project.name || projectId)}*\n${nodesOf(project.map).length} 个 Map 节点 · Main ${escape(project.version)}`)] };
    }
    if (Object.keys(unfurls).length) await this.io.call('chat.unfurl', { channel: event.channel, ts: event.message_ts, unfurls });
  }
  async reportError(id, body, error) {
    const channel = body.channel?.id || body.channel_id || body.event?.channel || body.container?.channel_id;
    const threadTs = body.event?.thread_ts || body.event?.ts || body.message?.thread_ts || body.message?.ts;
    const user = body.user?.id || body.user_id || body.event?.user;
    if (channel) await this.io.call('chat.postEphemeral', { channel, user, ...(threadTs ? { thread_ts: threadTs } : {}), text: `操作失败（${error.code || 'INVALID_OPERATION'}）：${error.message}. 未提交的表单保留，请刷新后重开。` });
    else {
      const dm = await this.io.call('conversations.open', { users: user });
      await this.io.post({ id: operationId(id, 'report'), channel: dm.channel.id, text: `操作失败（${error.code || 'INVALID_OPERATION'}）：${error.message}` });
    }
  }
}
