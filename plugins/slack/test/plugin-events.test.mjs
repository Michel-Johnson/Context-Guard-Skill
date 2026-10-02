import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { Store, threadKey } from '../src/store.mjs';
import { SlackPlugin } from '../src/plugin.mjs';

// Real journal and mirror; gateway/model and Slack transport are controlled
// boundaries. These are lifecycle regressions, not real Slack latency tests.
const teamId = 'synthetic-team', userId = 'synthetic-user', channel = 'C-test';
const key = threadKey(teamId, channel, '1.0');
const snapshot = (conversationId = 'chat-1', extra = {}) => ({ conversationId,
  status: 'running', activeTurnId: 'request-1', messages: [], approvals: [], ...extra });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function until(condition) {
  const deadline = Date.now() + 2000;
  while (!condition()) { assert.ok(Date.now() < deadline, 'Expected asynchronous lifecycle condition'); await setImmediate(); }
}
function provider() {
  const subscriptions = [];
  return { subscriptions, events({ signal, ...scope }) {
    const subscription = { ...scope, signal, queue: [], waiting: null, closed: false,
      send(value) { this.queue.push(value); this.waiting?.resolve(); },
      fail(error) { this.error = error; this.waiting?.resolve(); },
    };
    subscriptions.push(subscription);
    return (async function* () {
      const wake = () => subscription.waiting?.resolve();
      signal.addEventListener('abort', wake, { once: true });
      try {
        while (!signal.aborted) {
          if (subscription.error) throw subscription.error;
          if (subscription.queue.length) { yield subscription.queue.shift(); continue; }
          subscription.waiting = deferred(); await subscription.waiting.promise; subscription.waiting = null;
        }
      } finally { signal.removeEventListener('abort', wake); if (subscription.release) await subscription.release.promise; subscription.closed = true; }
    })();
  } };
}
async function fixture(t, { automatic = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-slack-events-'));
  const store = await new Store(directory).open(), streamProvider = provider(), calls = [], posts = [], warnings = [];
  const gateway = { ...streamProvider, async command(type, args) {
    calls.push({ type, ...args });
    assert.equal(type, 'conversation.state');
    return snapshot(args.conversationId);
  } };
  const io = { async post(input) { posts.push(input); return `${posts.length + 100}.0`; }, async update(...args) { posts.push({ update: args }); } };
  const plugin = new SlackPlugin({ store, gateway, io, teamId, botUserId: 'BOT',
    cloudOrigin: 'https://example.invalid', logger: { warn(...args) { warnings.push(args); }, error(...args) { warnings.push(args); } } });
  if (!automatic) plugin.kick = () => {};
  t.after(async () => { await plugin.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  await store.bind(key, { userId, channel, threadTs: '1.0', projectId: 'project-1', conversationId: 'chat-1', ownRequests: ['request-1'], live: true, nextPoll: 0 });
  plugin.stopped = false;
  return { store, gateway, io, plugin, calls, posts, warnings, subscriptions: streamProvider.subscriptions, directory };
}

test('scoped event snapshot mirrors real prose once without an extra state command and survives restart', async t => {
  const f = await fixture(t); await f.plugin.tick(); assert.equal(f.calls.length, 1);
  const subscription = f.subscriptions[0];
  assert.equal(subscription.userId, userId); assert.equal(subscription.projectId, 'project-1'); assert.equal(subscription.conversationId, 'chat-1');
  const completed = snapshot('chat-1', { status: 'waiting-for-user', activeTurnId: null, acceptedRequestIds: ['request-1'],
    messages: [{ id: 'reply-1', role: 'assistant', requestId: 'request-1', text: '登录模块负责刷新 token。' }] });
  subscription.send(completed); await until(() => f.plugin.eventStreams.get(key)?.latest); await f.store.tail;
  await f.plugin.tick();
  assert.equal(f.calls.length, 1); assert.equal(f.posts.length, 1); assert.match(f.posts[0].text, /登录模块负责刷新 token/);
  assert.equal(f.store.data.threads[key].live, false);
  await f.plugin.tick(); await until(() => subscription.closed);
  await f.plugin.stop();
  const reopened = await new Store(f.directory).open(); f.plugin.store = reopened;
  f.gateway.command = async () => completed;
  await f.plugin.mirror(key); assert.equal(f.posts.length, 1, 'Journal keeps the completed mirror stable after restart');
  f.gateway.command = async () => snapshot('chat-1', { streamingText: '重启后迟到的旧片段' });
  await f.plugin.mirror(key); assert.equal(f.posts.length, 1); assert.equal(reopened.data.threads[key].live, false);
});

test('no pending snapshot means an active stream suppresses duplicate polls but retains due fallback', async t => {
  const f = await fixture(t); await f.plugin.tick();
  f.subscriptions[0].send(snapshot()); await until(() => f.plugin.eventStreams.get(key)?.latest); await f.store.tail; await f.plugin.tick();
  await f.store.update(data => { data.threads[key].nextPoll = 0; }); await f.plugin.tick(); assert.equal(f.calls.length, 1);
  f.plugin.eventStreams.get(key).lastFallbackAt = Date.now() - 15001;
  await f.plugin.tick(); assert.equal(f.calls.length, 2, 'Stalled subscription cannot disable periodic state reads');
});

test('failed and foreign event subscriptions fall back to polling without displaying the event', async t => {
  for (const failure of ['disconnect', 'foreign']) {
    const f = await fixture(t); await f.plugin.tick();
    if (failure === 'disconnect') f.subscriptions[0].fail(Object.assign(new Error('Synthetic disconnect'), { code: 'SOCKET_CLOSED' }));
    else f.subscriptions[0].send(snapshot('other-chat', { messages: [{ id: 'foreign', role: 'assistant', text: 'PRIVATE FOREIGN TEXT' }] }));
    await until(() => f.plugin.eventStreams.size === 0);
    assert.equal(f.posts.length, 0); assert.equal(f.warnings.length, 1);
    await f.store.update(data => { data.threads[key].nextPoll = 0; }); await f.plugin.tick();
    assert.equal(f.calls.length, 2); assert.equal(f.subscriptions.length, 1, 'Reconnect backoff avoids request storms');
  }
});

test('removing the last binding releases its active event subscription', async t => {
  const f = await fixture(t); await f.plugin.tick();
  await f.store.update(data => { delete data.threads[key]; }); await f.plugin.tick();
  assert.equal(f.subscriptions[0].signal.aborted, true);
  await until(() => f.subscriptions[0].closed); assert.equal(f.plugin.eventStreams.size, 0);
});

test('cached state from an aborted old scope never reaches a changed binding', async t => {
  const f = await fixture(t); await f.plugin.tick();
  f.subscriptions[0].send(snapshot('chat-1', { messages: [{ id: 'old-secret', role: 'assistant', text: 'OLD SCOPE SECRET' }] }));
  await until(() => f.plugin.eventStreams.get(key)?.latest); await f.store.tail;
  // Production binding is immutable. This recovery/corruption boundary still
  // must not consume an already queued snapshot from a different identity.
  await f.store.update(data => { data.threads[key].conversationId = 'chat-2'; data.threads[key].projectId = 'project-2'; data.threads[key].nextPoll = 0; });
  await f.plugin.tick();
  assert.equal(f.subscriptions[0].signal.aborted, true);
  assert.equal(f.posts.length, 0); assert.equal(f.calls.at(-1).conversationId, 'chat-2');
});

test('event arriving while Slack send is pending remains immediately due after older mirror finishes', async t => {
  const f = await fixture(t); await f.plugin.tick();
  const blocked = deferred(), entered = deferred();
  f.io.post = async input => { f.posts.push(input); entered.resolve(); await blocked.promise; return '101.0'; };
  f.subscriptions[0].send(snapshot('chat-1', { streamingText: '第一段' }));
  await until(() => f.plugin.eventStreams.get(key)?.latest); await f.store.tail;
  const mirroring = f.plugin.tick(); await entered.promise;
  f.subscriptions[0].send(snapshot('chat-1', { streamingText: '完整回答', status: 'waiting-for-user', activeTurnId: null,
    acceptedRequestIds: ['request-1'], messages: [{ id: 'reply-1', requestId: 'request-1', role: 'assistant', text: '完整回答' }] }));
  await until(() => f.plugin.eventStreams.get(key)?.latest); await f.store.tail;
  blocked.resolve(); await mirroring;
  assert.equal(f.store.data.threads[key].nextPoll, 0, 'An older mirror must not defer a newly arrived snapshot');
  await f.plugin.tick();
  assert.equal(f.posts.length, 2); assert.match(f.posts[1].update[2], /完整回答/); assert.equal(f.calls.length, 1);
});

test('event-stream capacity is bounded while all due threads retain polling access', async t => {
  const f = await fixture(t);
  for (let index = 2; index <= 6; index++) await f.store.bind(`thread-${index}`, { userId, channel, threadTs: `${index}.0`, projectId: 'project-1', conversationId: `chat-${index}`, ownRequests: [], live: true, nextPoll: 0 });
  await f.plugin.tick(); assert.equal(f.subscriptions.length, 4); assert.equal(f.calls.length, 4);
  await f.plugin.tick(); assert.equal(f.subscriptions.length, 4); assert.equal(f.calls.length, 6);
  assert.equal(new Set(f.calls.map(call => call.conversationId)).size, 6);
});

test('late running event cannot overwrite a finalized reply obtained by concurrent polling', async t => {
  const f = await fixture(t); await f.plugin.tick();
  f.subscriptions[0].send(snapshot('chat-1', { streamingText: '初始片段' }));
  await until(() => f.plugin.eventStreams.get(key)?.latest); await f.store.tail; await f.plugin.tick();
  const readStarted = deferred(), response = deferred();
  const completed = snapshot('chat-1', { status: 'waiting-for-user', activeTurnId: null, acceptedRequestIds: ['request-1'],
    messages: [{ id: 'reply-final', requestId: 'request-1', role: 'assistant', text: '已经完成的最终回答' }] });
  f.gateway.command = async () => { readStarted.resolve(); return response.promise; };
  const polling = f.plugin.mirror(key); await readStarted.promise;
  f.subscriptions[0].send(snapshot('chat-1', { streamingText: '过期的较早片段' }));
  await until(() => f.plugin.eventStreams.get(key)?.latest); await f.store.tail;
  response.resolve(completed); await polling;
  assert.match(f.posts.at(-1).update[2], /已经完成的最终回答/);
  await f.plugin.tick();
  assert.match(f.posts.at(-1).update[2], /已经完成的最终回答/, 'A delayed event cannot undo settled prose');
  assert.equal(f.store.data.threads[key].live, false); assert.equal(f.store.data.threads[key].liveStream, undefined);
  f.gateway.command = async () => completed; await f.plugin.mirror(key);
  assert.equal(f.posts.length, 2, 'Final replay is stable without duplicating the reply');
});

test('an older completed turn cannot stop a newer browser turn or hide its streaming reply', async t => {
  const f = await fixture(t); await f.plugin.tick();
  f.gateway.command = async () => snapshot('chat-1', { activeTurnId: 'request-2', streamingText: '当前浏览器轮次',
    acceptedRequestIds: ['request-1', 'request-2'], messages: [
      { role: 'user', requestId: 'request-1', text: '上一轮' }, { role: 'user', requestId: 'request-2', text: '当前轮' }],
    timing: { receivedAt: '2026-10-03T00:00:02.000Z' } });
  await f.plugin.mirror(key);
  assert.equal(f.store.data.threads[key].live, true);
  assert.equal(f.posts.length, 2, 'The browser user message and its stream both mirror');
  f.subscriptions[0].send(snapshot('chat-1', { status: 'waiting-for-user', activeTurnId: null,
    messages: [{ role: 'user', requestId: 'request-1', text: '上一轮' }],
    acceptedRequestIds: ['request-1'], timing: { receivedAt: '2026-10-03T00:00:01.000Z' } }));
  await until(() => f.plugin.eventStreams.get(key)?.latest); await f.store.tail; await f.plugin.tick();
  assert.equal(f.store.data.threads[key].live, true, 'Earlier history cannot downgrade the appended browser turn');
  assert.equal(f.posts.length, 2); assert.match(f.posts.at(-1).text, /当前浏览器轮次/);
  assert.equal(f.subscriptions[0].signal.aborted, false);
});

test('stop aborts and awaits active subscriptions and does not persist cached event payloads', async t => {
  const f = await fixture(t); await f.plugin.tick();
  f.subscriptions[0].send(snapshot('chat-1', { streamingText: 'in-memory-only' }));
  await until(() => f.plugin.eventStreams.get(key)?.latest); await f.store.tail;
  await f.plugin.stop();
  assert.ok(f.subscriptions.every(subscription => subscription.signal.aborted && subscription.closed));
  assert.equal(f.plugin.eventStreams.size, 0);
  assert.doesNotMatch(await fs.readFile(f.store.file, 'utf8'), /in-memory-only/);
});

test('stop also awaits cleanup of a subscription retired by a removed binding', async t => {
  const f = await fixture(t); await f.plugin.tick();
  const subscription = f.subscriptions[0], release = deferred(); subscription.release = release;
  await f.store.update(data => { delete data.threads[key]; }); await f.plugin.tick();
  assert.equal(subscription.signal.aborted, true);
  let stopped = false;
  const stopping = f.plugin.stop().then(() => { stopped = true; });
  try {
    await setImmediate(); await f.store.tail;
    assert.equal(stopped, false, 'Stopping waits for retired stream cleanup, not only current bindings');
  } finally { release.resolve(); await stopping; }
  assert.equal(subscription.closed, true);
});

test('kick during an active cycle schedules a follow-up instead of losing the notification', async t => {
  const f = await fixture(t, { automatic: true }), first = deferred(), second = deferred();
  let cycles = 0;
  f.plugin.tick = async () => { cycles++; if (cycles === 1) await first.promise; else second.resolve(); };
  f.plugin.kick(); f.plugin.kick(); first.resolve();
  let timer;
  try { await Promise.race([second.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Lost event wake-up')), 500); })]); }
  finally { clearTimeout(timer); }
  await f.plugin.stop(); assert.equal(cycles, 2);
});
