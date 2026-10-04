import { digest, threadKey } from './store.mjs';
import { MAX_TOTAL_IMAGE_BYTES } from './slack-io.mjs';
import { homeView, nodesOf, modal, formValues, messageBlocks, approvalBlocks, projectChoiceBlocks, section, escape } from './views.mjs';

const operationId = (id, suffix) => `slack-${digest(`${id}:${suffix}`)}`;
// A read action is retained by Cloud for provenance/focus, but has no Slack UI.
// Preserve actual text, questions, attachments and other presentation actions.
const hasSlackContent = message => !!(message.text || message.questions?.length || message.attachments?.length ||
  message.actions?.some(action => action && !['map-read', 'node-read'].includes(action.kind)));
const isMessage = event => ['message', 'app_mention'].includes(event?.type) && !event.bot_id && !event.bot_profile && !event.hidden && (!event.subtype || event.subtype === 'file_share');
const indirectMessage = (event, botUserId) => isMessage(event) && event.user !== botUserId &&
  event.channel_type !== 'im' && !event.channel?.startsWith('D') && event.type !== 'app_mention' && !String(event.text || '').includes(`<@${botUserId}>`);
const messageLane = (envelope, resume) => {
  const event = resume || (envelope?.type === 'events_api' ? envelope.body?.event : null);
  return isMessage(event) ? `${event.channel}:${event.thread_ts || event.ts}` : null;
};
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
  constructor({ store, gateway, io, teamId, cloudOrigin, botUserId, pollMs = 1000, logger = console }) {
    this.store = store; this.gateway = gateway; this.io = io; this.teamId = teamId; this.cloudOrigin = new URL(cloudOrigin).origin; this.botUserId = botUserId;
    this.pollMs = Math.max(1000, pollMs); this.logger = logger; this.projects = new Map(); this.maps = new Map(); this.stopped = true; this.active = null;
    this.processing = new Map();
    this.classifying = new Set();
    this.messageLanes = new Map();
    this.reactions = new Set();
    this.eventStreams = new Map(); this.eventRetry = new Map(); this.eventTasks = new Set(); this.kickRequested = false;
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
  async stop() {
    this.stopped = true; clearTimeout(this.timer);
    const streams = [...this.eventStreams.values()];
    for (const stream of streams) stream.controller.abort();
    if (this.active) await this.active;
    await Promise.allSettled([...this.processing.values(), ...this.reactions, ...this.eventTasks]);
    await this.store.tail;
  }
  readReaction(event) {
    // The durable input/Cloud acknowledgement is the business receipt. An
    // optional Slack reaction must never hold up mirroring a ready answer.
    if (this.stopped || this.reactions.size >= 8) return;
    const pending = Promise.resolve().then(() => this.io.call('reactions.add', { channel: event.channel, timestamp: event.ts, name: 'eyes' }))
      .catch(() => {}).finally(() => this.reactions.delete(pending));
    this.reactions.add(pending);
  }
  kick() {
    if (this.stopped) return;
    if (this.active) { this.kickRequested = true; return; }
    clearTimeout(this.timer);
    this.active = this.tick().catch(error => this.logger.error('Slack plugin cycle failed', { code: error.code || 'PLUGIN_ERROR' })).finally(() => {
      this.active = null;
      if (!this.stopped) { const delay = this.kickRequested ? 0 : this.pollMs; this.kickRequested = false; this.timer = setTimeout(() => this.kick(), delay); }
    });
  }
  async tick() {
    const occupied = new Set(this.messageLanes.keys());
    const pending = Object.entries(this.store.data.inbox).filter(([id, item]) => {
      if (item.status !== 'pending' || this.processing.has(id)) return false;
      const lane = messageLane(item.envelope, item.projectResume?.event);
      if (lane && occupied.has(lane)) return false;
      if (lane) occupied.add(lane);
      // A later correction must not overtake this thread's earlier BUSY retry.
      return item.next <= Date.now();
    });
    const needsClassification = entry => entry.envelope?.type === 'events_api' && indirectMessage(entry.envelope.body.event, this.botUserId);
    const runnable = id => {
      const current = this.store.data.inbox[id];
      if (!current || current.status !== 'pending' || current.next > Date.now() || this.processing.has(id)) return false;
      const lane = messageLane(current.envelope, current.projectResume?.event);
      if (!lane) return true;
      if (this.messageLanes.has(lane)) return false;
      for (const [earlierId, earlier] of Object.entries(this.store.data.inbox)) {
        if (earlierId === id) break;
        if (earlier.status === 'pending' && messageLane(earlier.envelope, earlier.projectResume?.event) === lane) return false;
      }
      return true;
    };
    const run = (id, entry, classifying = false) => {
      // Interactive choices can requeue an earlier request while this cycle
      // awaits another operation. Never execute a stale pending snapshot.
      if (!runnable(id)) return Promise.resolve();
      entry = this.store.data.inbox[id];
      const lane = messageLane(entry.envelope, entry.projectResume?.event);
      if (lane) this.messageLanes.set(lane, id);
      if (classifying) this.classifying.add(id);
      const running = this.runEntry(id, entry).finally(() => {
        this.processing.delete(id); this.classifying.delete(id);
        if (lane && this.messageLanes.get(lane) === id) this.messageLanes.delete(lane);
        if (classifying) this.kick();
      });
      this.processing.set(id, running); return running;
    };
    // Overheard messages must not put model latency in front of explicit calls,
    // interactive actions or existing conversation mirroring.
    for (const [id, entry] of pending.filter(([, entry]) => needsClassification(entry)).slice(0, Math.max(0, 2 - this.classifying.size))) {
      if (this.stopped) return;
      run(id, entry, true);
    }
    for (const [id, entry] of pending.filter(([, entry]) => !needsClassification(entry)).slice(0, 8)) {
      if (this.stopped) return;
      await run(id, entry);
    }
    const bindings = Object.entries(this.store.data.threads);
    if (this.stopped) return;
    for (const [key, stream] of this.eventStreams) {
      const binding = this.store.data.threads[key];
      if (!binding || !(binding.live || binding.awaitingReplyId || stream.latest) || binding.conversationId !== stream.conversationId || binding.projectId !== stream.projectId) {
        stream.latest = null;
        stream.controller.abort();
        this.eventStreams.delete(key);
      }
    }
    if (!bindings.length) return;
    for (const [key, binding] of bindings) if (binding.live || binding.awaitingReplyId) this.watchEvents(key, binding);
    // Only due links consume the four-request budget. Keep live replies ahead
    // of dormant history, while reserving a slot for other due conversations.
    // Oldest due deadlines win within each group; a completed poll advances its
    // deadline, so sustained activity cannot starve another due thread.
    const due = bindings.filter(([key, binding]) => {
      const stream = this.eventStreams.get(key);
      return (binding.nextPoll || 0) <= Date.now() && (!stream?.lastEventAt || stream.latest || Date.now() - stream.lastFallbackAt >= 15000);
    })
      .sort(([, a], [, b]) => (a.nextPoll || 0) - (b.nextPoll || 0));
    const hot = due.filter(([, binding]) => binding.awaitingReplyId || binding.live);
    const idle = due.filter(([, binding]) => !binding.awaitingReplyId && !binding.live);
    const selected = hot.slice(0, idle.length ? 3 : 4);
    selected.push(...idle.slice(0, 4 - selected.length));
    for (const [key] of selected) {
      if (this.stopped) return;
      try { await this.mirror(key); }
      catch (error) { this.logger.warn('Slack mirror failed', { code: error.code || 'MIRROR_ERROR' }); await this.store.update(state => { state.threads[key].nextPoll = Date.now() + 30000; state.threads[key].error = error.code || 'MIRROR_ERROR'; }); }
    }
  }
  watchEvents(key, binding) {
    if (this.stopped || typeof this.gateway.events !== 'function' || this.eventStreams.has(key) || this.eventStreams.size >= 4 || (this.eventRetry.get(key) || 0) > Date.now()) return;
    const stream = { controller: new AbortController(), projectId: binding.projectId, conversationId: binding.conversationId, lastFallbackAt: Date.now(), latest: null };
    this.eventStreams.set(key, stream);
    stream.promise = (async () => {
      try {
        for await (const state of this.gateway.events({ userId: binding.userId, projectId: stream.projectId, conversationId: stream.conversationId, signal: stream.controller.signal })) {
          const current = this.store.data.threads[key];
          if (this.stopped || stream.controller.signal.aborted || current?.projectId !== stream.projectId || current?.conversationId !== stream.conversationId) break;
          if (state?.conversationId !== stream.conversationId) throw Object.assign(new Error('Event scope mismatch'), { code: 'GATEWAY_EVENT_INVALID' });
          stream.latest = state; stream.lastEventAt = Date.now();
          await this.store.update(data => {
            const thread = data.threads[key];
            if (thread?.projectId === stream.projectId && thread?.conversationId === stream.conversationId) thread.nextPoll = 0;
          });
          this.kick();
        }
      } catch (error) {
        if (!stream.controller.signal.aborted && !this.stopped) this.logger.warn('Slack event stream failed; polling retained', { code: error.code || 'GATEWAY_STREAM' });
      } finally {
        if (this.eventStreams.get(key) === stream) this.eventStreams.delete(key);
        if (!stream.controller.signal.aborted) this.eventRetry.set(key, Date.now() + 30000);
        if (!this.stopped) this.kick();
      }
    })();
    this.eventTasks.add(stream.promise);
    const released = () => this.eventTasks.delete(stream.promise);
    stream.promise.then(released, released);
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
      if (!transient && !error.silent) await this.reportError(id, entry.envelope.body, error).catch(() => {});
    }
  }
  async command(type, binding, userId, id, payload = {}) { return this.gateway.command(type, { ...contextFrom(binding, userId, id), payload }); }
  async process(id, { type, body }) {
    const resumed = this.store.data.inbox[id]?.projectResume;
    if (resumed) return this.message(id, resumed.event, resumed.projectId);
    const userId = body.user?.id || body.user_id || body.event?.user;
    if (type === 'events_api') {
      if (body.event?.type === 'app_home_opened') return this.publishHome(userId, id);
      if (body.event?.type === 'link_shared') return this.unfurl(id, body.event);
      if (isMessage(body.event) && body.event.user !== this.botUserId) return this.message(id, body.event, this.store.data.inbox[id]?.requestedProjectId || null);
      return;
    }
    if (type === 'slash_commands') {
      if (body.command !== '/cg') return;
      const projectId = this.store.data.channels[body.channel_id] || this.store.data.preferences[userId];
      const binding = { channel: body.channel_id, threadTs: null, projectId };
      if (body.text?.trim().startsWith('ask ')) return this.message(id, { type: 'app_mention', user: userId, channel: body.channel_id, ts: `command-${digest(id).slice(0, 12)}`, text: body.text.trim().slice(4) });
      return this.startChat(id, body, userId, { projectId, text: body.text?.trim() || '你好，我想和你讨论项目。' });
    }
    if (type !== 'interactive') return;
    if (body.type === 'view_submission') return this.submitForm(id, body, userId);
    if (body.type === 'shortcut' || body.type === 'message_action') {
      const originalThread = body.channel?.id && (body.message?.thread_ts || body.message?.ts);
      const prior = originalThread && this.store.data.threads[threadKey(this.teamId, body.channel.id, originalThread)];
      const projectId = prior?.projectId || this.store.data.channels[body.channel?.id] || this.store.data.preferences[userId];
      return this.startChat(id, body, userId, { projectId, kind: body.callback_id?.startsWith('cg_bug') ? 'bug' : 'todo', initialText: body.message?.text || '' });
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
      if (/^connect_project:\d{1,3}$/.test(action.action_id)) await this.connectProject(id, body, userId, value);
      else if (['open_item', 'open_item:todo', 'open_item:bug', 'start_chat'].includes(action.action_id)) await this.startChat(id, body, userId, value);
      else if (action.action_id === 'open_memory') await this.startChat(id, body, userId, { ...value, kind: 'memory' });
      else if (action.action_id === 'open_binding') await this.startChat(id, body, userId, { ...value, text: '你好，我想和你讨论项目。' });
      else if (action.action_id === 'open_answer') {
        const binding = this.store.data.threads[value.key];
        if (binding) await this.io.post({ id: operationId(id, 'answer-guide'), channel: binding.channel, threadTs: binding.threadTs, text: '直接在这个线程回复你的想法即可，不需要填写表单。' });
      }
      else if (action.action_id === 'reject_brief') await this.review(id, userId, value, 'rejected', '用户要求继续讨论并修改 brief');
      else if (action.action_id === 'answer_question') await this.answer(id, userId, value);
      else if (action.action_id === 'approve_brief') await this.review(id, userId, value, 'approved', '用户在 Slack 中确认 brief');
      else if (action.action_id === 'export_prompt') await this.exportPrompt(id, userId, value);
    }
  }
  async loadProjects(userId, id) { const result = await this.gateway.command('project.list', { id: operationId(id, 'projects'), userId }); this.projects.set(userId, result.projects || []); return result.projects || []; }
  async startChat(id, body, userId, context = {}) {
    let channel = body.channel?.id || body.channel_id;
    if (!channel) channel = (await this.io.call('conversations.open', { users: userId })).channel?.id;
    if (!/^[CGD][A-Z0-9]{6,}$/.test(channel || '')) throw new Error('无法打开对话，请直接私聊 Coordinator');
    const direct = channel.startsWith('D');
    const sourceThread = body.message?.thread_ts || body.message?.ts;
    const prior = sourceThread && this.store.data.threads[threadKey(this.teamId, channel, sourceThread)];
    if (prior && context.projectId && context.projectId !== prior.projectId) throw Object.assign(new Error('原线程不能切换项目'), { code: 'CONFLICT' });
    const projectId = prior?.projectId || context.projectId || (direct ? this.store.data.preferences[userId] : this.store.data.channels[channel]);
    if (projectId) {
      const projects = await this.loadProjects(userId, id);
      if (!projects.some(project => project.id === projectId)) throw new Error('项目已停止开放');
      await this.store.update(state => {
        if (prior) return;
        if (!direct && state.channels[channel] && state.channels[channel] !== projectId) throw Object.assign(new Error('频道已关联另一个项目'), { code: 'CONFLICT' });
        if (direct) state.preferences[userId] = projectId;
        else state.channels[channel] ||= projectId;
      });
    }
    let text = context.text || (context.kind === 'memory' ? '我想和你讨论修改项目记忆。' : context.kind === 'bug' ? '我想和你讨论一个 Bug。' : '我想和你讨论一条 TODO。');
    if (context.nodeId || context.itemId) text += `\n当前事项定位：${context.nodeId || ''} / ${context.itemId || ''}。请先从 Map 核对内容。`;
    if (context.initialText) text += `\n我选中的消息是：\n${context.initialText}`;
    const requestId = `chat-${digest(id)}`, event = { type: 'app_mention', user: userId, channel, ts: `command-${digest(id).slice(0, 12)}`, text,
      ...(prior ? { thread_ts: sourceThread } : {}), ...(direct ? { channel_type: 'im' } : {}), ...(body.message?.files?.length ? { files: body.message.files } : {}) };
    await this.store.update(state => {
      state.inbox[requestId] ||= { envelope: { type: 'events_api', body: { team_id: this.teamId, event } },
        ...(projectId ? { requestedProjectId: projectId } : {}), status: 'pending', attempts: 0, at: Date.now(), next: 0 };
    });
    this.kick();
  }
  async readProject(projectId, userId, id) { const result = await this.gateway.command('project.read', { id: operationId(id, 'read'), userId, projectId }); this.maps.set(projectId, result); return result; }
  async publishHome(userId, id) {
    const projects = await this.loadProjects(userId, id), projectId = this.store.data.preferences[userId];
    const project = projectId && projects.some(item => item.id === projectId) ? await this.readProject(projectId, userId, id) : null;
    return this.io.call('views.publish', { user_id: userId, view: homeView({ projects, project, cloudOrigin: this.cloudOrigin, userId }) });
  }
  async chooseProject(id, event) {
    const projects = await this.loadProjects(event.user, id), direct = event.channel_type === 'im' || event.channel?.startsWith('D');
    await this.store.update(state => {
      state.inbox[id] ||= { status: 'done', attempts: 0, at: Date.now(), next: 0 };
      state.inbox[id].envelope ||= { type: 'events_api', body: { team_id: this.teamId, event: structuredClone(event) } };
      state.inbox[id].projectPromptEvent ||= structuredClone(event);
      state.inbox[id].projectPromptProjects ||= projects.map(project => project.id);
      state.inbox[id].projectPromptChoices ||= projects.map(project => ({ id: project.id, name: project.name || project.id }));
    });
    const choices = this.store.data.inbox[id].projectPromptChoices;
    const ts = await this.io.post({ id: operationId(id, 'choose'), channel: event.channel,
      threadTs: event.ts?.startsWith('command-') ? undefined : event.thread_ts || event.ts,
      text: choices.length ? '请选择要讨论的项目，选好后我会继续处理刚才的问题。' : '目前没有开放的项目，请管理员在插件配置中开放项目。',
      blocks: projectChoiceBlocks(choices, id, direct) });
    await this.store.update(state => { state.inbox[id].projectPromptTs = ts; });
  }
  async connectProject(id, body, userId, value) {
    const conflict = message => Object.assign(new Error(message), { code: 'CONFLICT' });
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['requestId', 'projectId'].includes(key))) throw conflict('项目选择已失效，请重新提问');
    const entry = this.store.data.inbox[value.requestId], event = entry?.projectPromptEvent;
    if (!event || event.user !== userId || body.channel?.id !== event.channel || body.message?.ts !== entry.projectPromptTs) throw conflict('请由原提问者在原消息中选择项目');
    if (!entry.projectPromptProjects?.includes(value.projectId)) throw conflict('项目不在这条消息的选项中');
    const resumedEvent = event.ts?.startsWith('command-') ? { ...event, ts: entry.projectPromptTs } : event;
    const lane = messageLane(null, resumedEvent);
    if (this.messageLanes.has(lane)) throw Object.assign(new Error('正在处理这条线程，请保留原请求重试'), { code: 'BUSY' });
    this.messageLanes.set(lane, id);
    try {
      const projects = await this.loadProjects(userId, id), selected = projects.find(project => project.id === value.projectId);
      if (!selected) throw conflict('该项目已停止开放，请重新选择');
      const direct = event.channel_type === 'im' || event.channel?.startsWith('D');
      const info = await this.io.call('conversations.info', { channel: event.channel });
      if (direct ? info.channel?.user !== userId : !(await this.channelMembers(event.channel)).includes(userId)) throw conflict('只能关联自己所在的频道或自己的私聊');
      await this.store.update(state => {
        const original = state.inbox[value.requestId], current = direct ? state.preferences[userId] : state.channels[event.channel];
        if (original.selectedProjectId && original.selectedProjectId !== value.projectId || current && current !== value.projectId) throw conflict('关联已改变，请重新提问；旧选项不会覆盖当前项目');
        original.selectedProjectId = value.projectId;
        if (direct) state.preferences[userId] = value.projectId;
        else {
          state.channels[event.channel] = value.projectId;
          state.preferences[userId] ||= value.projectId;
        }
        // Requeue the original request through the normal durable FIFO lane.
        // A repeated click cannot reset its backoff or execute it a second time.
        if (!original.projectResume) {
          original.projectResume = { event: structuredClone(resumedEvent), projectId: value.projectId };
          original.status = 'pending'; original.next = 0; delete original.doneAt;
        }
      });
      await this.io.update(event.channel, entry.projectPromptTs, `已关联 ${selected.name || selected.id}，接下来继续处理刚才的问题。`,
        [section(`已关联 *${escape(selected.name || selected.id)}*。刚才的问题已排入当前线程，回复会出现在这里。`)]);
      await this.publishHome(userId, id);
    } finally {
      if (this.messageLanes.get(lane) === id) this.messageLanes.delete(lane);
      this.kick();
    }
  }
  async ensureBinding(id, event, expectedProjectId = null) {
    const rootTs = event.thread_ts || event.ts;
    let key = threadKey(this.teamId, event.channel, rootTs), existing = this.store.data.threads[key];
    if (existing) {
      if (expectedProjectId && existing.projectId !== expectedProjectId) throw Object.assign(new Error('Thread project changed after the relevance decision'), { code: 'CONFLICT', silent: true });
      return [key, existing];
    }
    const direct = event.channel_type === 'im' || event.channel?.startsWith('D');
    const explicit = event.type === 'app_mention' || String(event.text || '').includes(`<@${this.botUserId}>`);
    if (!direct && !explicit && !this.store.data.inbox[id]?.relevance?.respond) return [];
    const projectId = direct ? this.store.data.preferences[event.user] : this.store.data.channels[event.channel];
    if (expectedProjectId && projectId !== expectedProjectId) throw Object.assign(new Error('Channel project changed after the relevance decision'), { code: 'CONFLICT', silent: true });
    if (!projectId) {
      await this.chooseProject(id, event);
      return [];
    }
    // Slash command has no message timestamp. Create a real root message first.
    const threadTs = rootTs?.startsWith('command-') ? await this.io.post({ id: operationId(id, 'root'), channel: event.channel, text: `Coordinator · ${projectId}` }) : rootTs;
    key = threadKey(this.teamId, event.channel, threadTs);
    const created = await this.gateway.command('conversation.create', { id: operationId(id, 'create'), userId: event.user, projectId, payload: { operationId: operationId(id, 'create') } });
    const binding = await this.store.bind(key, { channel: event.channel, threadTs, projectId, conversationId: created.conversationId, userId: event.user, ownRequests: [] });
    return [key, binding];
  }
  async recentThreadContext(event) {
    if (!event.thread_ts) return [];
    const context = []; let cursor;
    const seen = new Set();
    for (let page = 0; page < 4; page++) {
      const thread = await this.io.call('conversations.replies', { channel: event.channel, ts: event.thread_ts,
        latest: event.ts, inclusive: false, limit: 100, ...(cursor ? { cursor } : {}) });
      for (const message of thread.messages || []) {
        if (!/^\d+\.\d+$/.test(message.ts || '') || Number(message.ts) >= Number(event.ts) || !message.text) continue;
        context.push({ ts: message.ts, speaker: String(message.user || message.bot_id || 'unknown').slice(0, 80), text: message.text.slice(0, 800) });
      }
      context.sort((a, b) => Number(a.ts) - Number(b.ts));
      context.splice(0, Math.max(0, context.length - 6));
      const next = thread.response_metadata?.next_cursor;
      if (!thread.has_more && !next) return context.map(({ speaker, text }) => ({ speaker, text }));
      if (!next || seen.has(next)) break;
      seen.add(next); cursor = next;
    }
    throw Object.assign(new Error('Recent thread context is unavailable within the bounded read; no relevance decision was made'), { code: 'RELEVANCE_CONTEXT_INCOMPLETE' });
  }
  async message(id, event, expectedProjectId = null) {
    const direct = event.channel_type === 'im' || event.channel?.startsWith('D');
    const explicit = event.type === 'app_mention' || String(event.text || '').includes(`<@${this.botUserId}>`);
    if ((event.files || []).length > 6) throw Object.assign(new Error('每条消息最多 6 个附件'), { silent: !direct && !explicit });
    if (!direct && !explicit) {
      const existing = this.store.data.threads[threadKey(this.teamId, event.channel, event.thread_ts || event.ts)];
      const projectId = existing?.projectId || this.store.data.channels[event.channel];
      if (!projectId) return;
      let decision = this.store.data.inbox[id]?.relevance;
      if (!decision) {
        try {
          let request = this.store.data.inbox[id]?.relevanceRequest;
          if (!request) {
            const context = await this.recentThreadContext(event);
            request = { id: operationId(id, 'relevance'), userId: event.user, projectId,
              ...(existing ? { conversationId: existing.conversationId } : {}),
              payload: { text: String(event.text || ''), context, files: (event.files || []).map(file => ({
                name: String(file.name || file.title || '').slice(0, 200), mimeType: String(file.mimetype || '').slice(0, 100) })) } };
            await this.store.update(state => {
              state.inbox[id] ||= { status: 'pending', attempts: 0, at: Date.now(), next: 0 };
              state.inbox[id].relevanceRequest = request;
            });
          }
          if (request.projectId !== projectId) throw Object.assign(new Error('Channel project changed before the relevance decision'), { code: 'CONFLICT' });
          decision = await this.gateway.command('conversation.relevance', request);
          if (typeof decision?.respond !== 'boolean' || typeof decision?.mainVersion !== 'string') {
            throw Object.assign(new Error('Message relevance could not be determined'), { code: 'RELEVANCE_INVALID_RESPONSE' });
          }
          decision = { ...decision, projectId };
          await this.store.update(state => {
            state.inbox[id] ||= { status: 'pending', attempts: 0, at: Date.now(), next: 0 };
            state.inbox[id].relevance = decision;
          });
        } catch (error) { error.silent = true; throw error; }
      }
      const currentBinding = this.store.data.threads[threadKey(this.teamId, event.channel, event.thread_ts || event.ts)];
      const currentProject = currentBinding?.projectId || this.store.data.channels[event.channel];
      if (decision.projectId !== currentProject) throw Object.assign(new Error('Channel project changed after the relevance decision'), { code: 'CONFLICT', silent: true });
      if (!decision.respond) return;
      expectedProjectId = decision.projectId;
    }
    const [key, binding] = await this.ensureBinding(id, event, expectedProjectId);
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
    let replyContext = this.store.data.inbox[id]?.replyContext;
    if (!replyContext) {
      let question;
      if (binding.pendingQuestionId) {
        const state = await this.command('conversation.state', binding, event.user, operationId(id, 'reply-context'));
        question = (state.messages || []).flatMap(message => message.questions || []).find(question => question.id === binding.pendingQuestionId && !question.answer);
      }
      replyContext = { answerTo: question?.id || null };
      await this.store.update(state => { state.inbox[id] ||= { status: 'done', attempts: 0, at: Date.now(), next: 0 }; state.inbox[id].replyContext = replyContext; });
    }
    await this.store.update(state => { const item = state.threads[key]; if (!item.ownRequests.includes(requestId)) item.ownRequests.push(requestId); item.nextPoll = 0; });
    await this.command('conversation.submit', binding, event.user, requestId, { text: text || '请阅读附件。', ...(attachments.length ? { attachments } : {}), ...(replyContext?.answerTo ? { answerTo: replyContext.answerTo } : {}) });
    await this.store.update(state => { state.threads[key].awaitingReplyId = requestId; state.threads[key].nextPoll = 0; });
    if (replyContext?.answerTo) await this.store.update(state => { if (state.threads[key].pendingQuestionId === replyContext.answerTo) delete state.threads[key].pendingQuestionId; });
    if (!event.ts?.startsWith('command-')) this.readReaction(event);
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
    await this.store.update(state => { state.threads[value.key].awaitingReplyId = requestId; state.threads[value.key].nextPoll = 0; });
  }
  async review(id, userId, value, decision, reason) {
    const binding = this.store.data.threads[value.key]; if (!binding) throw new Error('Unknown Slack thread');
    const result = await this.command('brief.review', binding, userId, operationId(id, 'review'), { proposalId: value.proposalId, decision, reason, version: value.version });
    await this.io.post({ id: operationId(id, 'review-result'), channel: binding.channel, threadTs: binding.threadTs, text: decision === 'approved' ? 'brief 已确认，Main 事项已保存。执行提示可直接粘贴到 Codex / Cursor / Claude。' : 'brief 已退回。直接在这个线程告诉我你想怎么修改。',
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
    if (!binding) return;
    const stream = this.eventStreams.get(key);
    const sameScope = stream && !stream.controller.signal.aborted && stream.projectId === binding.projectId && stream.conversationId === binding.conversationId;
    const cached = sameScope ? stream.latest : null;
    if (stream) { stream.latest = null; stream.lastFallbackAt = Date.now(); }
    const state = cached || await this.command('conversation.state', binding, binding.userId, operationId(`${key}:${Date.now()}`, 'state'));
    const messages = state.messages || [];
    const userRequestIds = messages.filter(message => message.role === 'user' && message.requestId).map(message => message.requestId);
    const accepted = state.acceptedRequestIds || [];
    const lastRequestId = userRequestIds.at(-1) || state.activeTurnId;
    // Context loading happens before submission takes the lock. receivedAt is
    // diagnostic wall time, not a revision; use the existing append history.
    // Legacy snapshots without visible user identities have no append-order
    // proof. Retain polling compatibility rather than guessing their order.
    if (binding.lastStateRequestId && userRequestIds.length && lastRequestId !== binding.lastStateRequestId &&
        !userRequestIds.includes(binding.lastStateRequestId) && !accepted.includes(binding.lastStateRequestId)) return;
    // Polling and event snapshots may complete out of order. A turn that was
    // durably settled cannot become a partial stream again (including restart).
    if (state.activeTurnId && binding.settledRequestIds?.includes(state.activeTurnId)) return;
    const lastAssistant = messages.findLastIndex(message => message.role === 'assistant');
    let currentRequest = null;
    const entries = messages.map((message, index) => {
      if (message.role === 'user') currentRequest = message.requestId;
      const requestId = message.requestId || (message.role === 'assistant' ? currentRequest : null);
      const id = message.id || digest(message);
      return { message, index, requestId, id };
    });
    for (const { message, index, requestId, id } of entries) {
      if (!hasSlackContent(message)) continue;
      if (message.role === 'user' && (message.source === 'workflow' || String(message.text || '').trimStart().startsWith('[服务器工作流事件'))) continue;
      if (message.role === 'user' && this.store.data.threads[key].ownRequests.includes(message.requestId)) continue;
      if (state.status === 'running' && state.streamingText && index === lastAssistant && requestId === state.activeTurnId) continue;
      const stream = this.store.data.threads[key].liveStream;
      const settled = !state.activeTurnId && ['waiting-for-user', 'idle'].includes(state.status);
      // A model step can save waiting-for-user before the service clears the
      // turn ID. Keep the existing partial message until that durable boundary
      // settles, rather than posting a second final and later updating both.
      if (stream && message.role === 'assistant' && stream.turnId === requestId && !settled) continue;
      const blocks = messageBlocks(message, key, { cloudOrigin: this.cloudOrigin, projectId: binding.projectId });
      const content = digest({ format: 'plain-text-v2', message,
        ...(blocks.some(block => block.type === 'actions') ? { nodeLinks: blocks.filter(block => block.type === 'actions') } : {}) }),
        prior = this.store.data.threads[key].mirrored[id];
      // Older versions could append an earlier model step after the stream.
      // Rotate those occupied slots forward until a pending reply consumes the
      // final slot, without deleting Slack history or duplicating the content.
      const moveEarlier = !!stream && settled && message.role === 'assistant' && stream.turnId === requestId &&
        !!prior && Number(prior.ts) > Number(stream.ts) && entries.some(entry =>
          entry.message.role === 'assistant' && entry.requestId === stream.turnId &&
          hasSlackContent(entry.message) &&
          !this.store.data.threads[key].mirrored[entry.id]);
      if (prior?.hash === content && !moveEarlier) continue;
      const text = `${message.role === 'user' ? '工作台用户' : 'Coordinator'}：${message.text || (message.actions?.length ? '节点入口' : '附件')}`;
      // The retained placeholder has the earliest Slack timestamp. Finalize
      // it with the first pending reply, then append later model steps in order.
      const replaceStream = !!stream && (!prior || moveEarlier) && message.role === 'assistant' && settled && stream.turnId === requestId;
      const existingTs = replaceStream ? stream.ts : prior?.ts;
      const ts = existingTs ? (await this.io.update(binding.channel, existingTs, text, blocks), existingTs) : await this.io.post({ id: operationId(`${key}:${id}`, 'mirror'), channel: binding.channel, threadTs: binding.threadTs, text, blocks });
      await this.store.update(data => {
        data.threads[key].mirrored[id] = { ts, hash: content };
        if (moveEarlier) data.threads[key].liveStream.ts = prior.ts;
        else if (replaceStream) delete data.threads[key].liveStream;
      });
    }
    if (state.streamingText && state.status === 'running') {
      const streamId = `stream:${state.activeTurnId}`, prior = this.store.data.threads[key].mirrored[streamId], content = digest({ format: 'plain-text-v2', text: state.streamingText });
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
    const openQuestions = messages.flatMap(message => message.questions || []).filter(question => !question.answer);
    await this.store.update(data => {
      const thread = data.threads[key];
      if (lastRequestId) thread.lastStateRequestId = lastRequestId;
      thread.live = state.status === 'running' || !!state.activeTurnId && state.status !== 'error';
      if (!state.activeTurnId && ['waiting-for-user', 'idle'].includes(state.status)) {
        const completed = state.acceptedRequestIds || [];
        thread.settledRequestIds = [...new Set([...(thread.settledRequestIds || []), ...completed])].slice(-100);
      }
      if (!thread.live && state.acceptedRequestIds?.includes(thread.awaitingReplyId)) delete thread.awaitingReplyId;
      const pending = this.eventStreams.get(key);
      thread.nextPoll = pending?.latest && !pending.controller.signal.aborted && pending.projectId === thread.projectId && pending.conversationId === thread.conversationId
        ? 0 : Date.now() + (thread.live || thread.awaitingReplyId ? this.pollMs : 15000); thread.error = null;
      thread.pendingQuestionId = openQuestions.length === 1 ? openQuestions[0].id : null;
    });
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
    const binding = this.store.data.threads[threadKey(this.teamId, event.channel, event.thread_ts || event.message_ts)];
    const projectId = binding?.projectId || this.store.data.channels[event.channel] || this.store.data.preferences[event.user];
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
