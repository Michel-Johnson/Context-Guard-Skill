import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setImmediate } from 'node:timers/promises';
import { Gateway, GatewayError } from '../src/gateway.mjs';

// Real loopback HTTP exercises fetch, headers, SSE decoding and cancellation.
// The provider is synthetic; these tests neither contact Slack nor run a model.
const scope = { userId: 'U001', projectId: 'lab-project', conversationId: 'chat-1' };
const teamId = 'T-SYNTHETIC', token = 'synthetic-private-gateway-token';
const maxFrame = 8 * 1024 * 1024;
const state = (data = {}) => ({ type: 'state', data: { conversationId: scope.conversationId, status: 'waiting-for-user', ...data } });
const frame = (value, newline = '\n') => `event: state${newline}data: ${JSON.stringify(value)}${newline}${newline}`;
const collect = async iterator => { const values = []; for await (const value of iterator) values.push(value); return values; };

async function fixture(t, respond, fetchImpl = fetch) {
  const requests = [], failures = [];
  let closed;
  const disconnected = new Promise(resolve => { closed = resolve; });
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    res.once('close', closed);
    Promise.resolve(respond(req, res)).catch(error => { failures.push(error); res.destroy(error); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.deepEqual(failures, [], 'Synthetic HTTP responder completed without an unobserved error');
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const gateway = new Gateway({ url, token, teamId, fetchImpl });
  const events = (signal = AbortSignal.timeout(5000)) => gateway.events({ ...scope, signal });
  return { gateway, events, requests, disconnected, url };
}
const sse = res => res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
const invalidEvent = error => error instanceof GatewayError && error.code === 'GATEWAY_EVENT_INVALID';

test('Gateway events scopes the existing GET endpoint and sends Bearer only in its header', { timeout: 10000 }, async t => {
  const value = state({ mainVersion: 'v1', messages: [{ id: 'm1', text: '登录模块' }] });
  const f = await fixture(t, (_req, res) => { sse(res); res.end(frame(value)); });
  assert.deepEqual(await collect(f.events()), [value.data]);
  assert.equal(f.requests.length, 1);
  const request = f.requests[0], url = new URL(request.url, f.url);
  assert.equal(url.pathname, '/v1/events');
  assert.deepEqual(Object.fromEntries(url.searchParams), { teamId, ...scope });
  assert.equal(request.headers.authorization, `Bearer ${token}`);
  assert.equal(request.headers.accept, 'text/event-stream');
  assert.equal(url.href.includes(token), false, 'The credential never enters a query or path');
});

test('Gateway events decodes UTF-8 split across HTTP writes, CRLF and ordered multiple frames', { timeout: 10000 }, async t => {
  const values = [state({ text: '登录刷新🙂' }), state({ text: '下一轮', sequence: 2 })];
  let writes = 0;
  const f = await fixture(t, async (_req, res) => {
    sse(res);
    const bytes = Buffer.from(': heartbeat\r\n\r\n' + frame(values[0], '\r\n') + frame(values[1]));
    for (let offset = 0; offset < bytes.length; offset++) { res.write(bytes.subarray(offset, offset + 1)); writes++; await setImmediate(); }
    res.end();
  });
  assert.deepEqual(await collect(f.events()), values.map(value => value.data));
  assert.ok(writes > 20, 'Wire data was sent in deliberately fragmented writes');
});

test('Gateway events joins multiline data and ignores heartbeat and non-state events', { timeout: 10000 }, async t => {
  const value = state({ text: '真正的正文', sequence: 3 });
  const multiline = JSON.stringify(value, null, 2).split('\n').map(line => `data: ${line}`).join('\n');
  const f = await fixture(t, (_req, res) => {
    sse(res);
    res.end(': ping\n\nevent: notice\ndata: not JSON; not a state\n\nevent: state\n' + multiline + '\n\n');
  });
  assert.deepEqual(await collect(f.events()), [value.data]);
});

for (const [name, value] of [
  ['another conversation', state({ conversationId: 'chat-other' })],
  ['invalid JSON', '{not-json'],
  ['wrong envelope type', { type: 'notice', data: { conversationId: scope.conversationId } }],
  ['missing data', { type: 'state' }],
  ['array data', { type: 'state', data: [] }],
  ['missing conversation identity', { type: 'state', data: { status: 'idle' } }],
]) test(`Gateway events rejects ${name} without yielding a foreign or malformed state`, { timeout: 10000 }, async t => {
  const f = await fixture(t, (_req, res) => {
    sse(res); res.end(name === 'invalid JSON' ? 'event: state\ndata: {not-json\n\n' : frame(value));
  });
  const received = [];
  await assert.rejects(async () => { for await (const value of f.events()) received.push(value); }, invalidEvent);
  assert.deepEqual(received, []);
});

for (const complete of [true, false]) test(`Gateway events rejects an oversized ${complete ? 'complete frame' : 'unfinished frame buffer'}`, { timeout: 10000 }, async t => {
  const f = await fixture(t, (_req, res) => {
    sse(res);
    const raw = frame(state({ text: 'x'.repeat(maxFrame + 1024) }));
    res.end(complete ? raw : raw.slice(0, -2));
  });
  const values = [];
  await assert.rejects(async () => { for await (const value of f.events()) values.push(value); }, error => error instanceof GatewayError && error.code === 'GATEWAY_EVENT_TOO_LARGE');
  assert.deepEqual(values, []);
});

test('Gateway events measures its 8MiB frame limit in UTF-8 bytes, not JavaScript characters', { timeout: 10000 }, async t => {
  const raw = frame(state({ text: '中'.repeat(Math.floor(maxFrame / 3) + 100) }));
  assert.ok(raw.length < maxFrame && Buffer.byteLength(raw) > maxFrame);
  const f = await fixture(t, (_req, res) => { sse(res); res.end(raw); });
  await assert.rejects(() => collect(f.events()), error => error instanceof GatewayError && error.code === 'GATEWAY_EVENT_TOO_LARGE');
});

test('Gateway events applies the limit per frame, not to two complete frames in one read chunk', { timeout: 10000 }, async t => {
  const values = [state({ text: 'a'.repeat(5 * 1024 * 1024) }), state({ text: 'b'.repeat(5 * 1024 * 1024) })];
  const raw = frame(values[0]) + frame(values[1]);
  assert.ok(Buffer.byteLength(raw) > maxFrame);
  // Fetch the real HTTP response, then coalesce its unchanged wire bytes into
  // one body chunk to deterministically challenge parser buffering boundaries.
  const coalescedFetch = async (...args) => {
    const response = await fetch(...args);
    return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
  };
  const f = await fixture(t, (_req, res) => { sse(res); res.end(raw); }, coalescedFetch);
  const received = await collect(f.events());
  assert.equal(received.length, 2);
  assert.equal(received[0].text, values[0].data.text); assert.equal(received[1].text, values[1].data.text);
});

test('Gateway events rejects an HTTP error without exposing the provider response body', { timeout: 10000 }, async t => {
  const privateBody = 'synthetic-secret-diagnostic-body';
  const f = await fixture(t, (_req, res) => { res.writeHead(503, { 'content-type': 'text/plain' }); res.end(privateBody); });
  await assert.rejects(() => collect(f.events()), error => error instanceof GatewayError && error.status === 503 && !error.message.includes(privateBody));
});

for (const contentType of ['application/json', 'application/x-text/event-stream', 'text/event-streamish']) test(`Gateway events rejects non-SSE media type ${contentType}`, { timeout: 10000 }, async t => {
  const f = await fixture(t, (_req, res) => { res.writeHead(200, { 'content-type': contentType }); res.end(frame(state())); });
  await assert.rejects(() => collect(f.events()), error => error instanceof GatewayError);
});

test('Gateway events accepts the SSE media type case-insensitively with charset parameters', { timeout: 10000 }, async t => {
  const f = await fixture(t, (_req, res) => { res.writeHead(200, { 'content-type': 'Text/Event-Stream; charset=utf-8' }); res.end(frame(state())); });
  assert.deepEqual(await collect(f.events()), [state().data]);
});

test('Gateway events refuses redirects so its Bearer cannot reach a redirected endpoint', { timeout: 10000 }, async t => {
  const trap = await fixture(t, (_req, res) => { sse(res); res.end(frame(state())); });
  const f = await fixture(t, (_req, res) => { res.writeHead(302, { location: `${trap.url}/trap` }); res.end(); });
  await assert.rejects(() => collect(f.events()));
  assert.equal(f.requests.length, 1, 'The error came from an actual redirect response, not a missing method');
  assert.equal(trap.requests.length, 0, 'No credential-bearing redirect request was sent');
});

test('Gateway events Abort closes a live SSE connection without another state or request', { timeout: 10000 }, async t => {
  const f = await fixture(t, (_req, res) => { sse(res); res.write(frame(state({ sequence: 1 }))); });
  const controller = new AbortController(), iterator = f.events(controller.signal);
  assert.deepEqual(await iterator.next(), { value: state({ sequence: 1 }).data, done: false });
  const next = iterator.next();
  controller.abort();
  try { assert.equal((await next).done, true); } catch (error) { assert.equal(error.name, 'AbortError'); }
  let timeout;
  t.after(() => clearTimeout(timeout));
  await Promise.race([f.disconnected, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Aborted HTTP stream remained open')), 2000); timeout.unref(); })]);
  assert.equal(f.requests.length, 1, 'Cancellation does not reconnect or create a conversation');
});
