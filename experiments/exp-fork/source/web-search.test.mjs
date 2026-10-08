import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createWebSearch } from './web-search.mjs';
import { Experiment } from './engine.mjs';
import { createLearningMapTools } from './map-tools.mjs';
import { codexMap } from './map.mjs';

const token = 'test-secret-never-display';
function fixture(result, { sse = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body); calls.push({ url, options, request });
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (status !== 200) return new Response('private provider error ' + token, { status });
    const envelope = { jsonrpc: '2.0', id: request.id, result: request.method === 'initialize' ? { protocolVersion: '2024-11-05' } : result };
    const body = sse ? 'event: message\r\ndata: ' + JSON.stringify(envelope) + '\r\n\r\n' : JSON.stringify(envelope);
    const bytes = new TextEncoder().encode(body);
    return new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    } }), { headers: { 'content-type': sse ? 'text/event-stream' : 'application/json', 'mcp-session-id': 'test-session' } });
  };
  return { calls, search: createWebSearch({ token, fetchImpl }) };
}
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false });

test('search handles streamed UTF-8, escaped provider JSON, bounded snippets and session reuse', async () => {
  const items = [{ title: '官方中文文档', link: 'https://example.com/docs', content: 'x'.repeat(2000) + token },
    { title: 'duplicate', link: 'https://example.com/docs' }, { title: 'bad', link: 'javascript:alert(1)' }];
  const escaped = JSON.stringify(JSON.stringify(items).replaceAll('"', '\\"'));
  const { calls, search } = fixture({ content: [{ type: 'text', text: escaped }] });
  const found = await search.call({ query: '公开查询', domain: 'example.com', recency: 'oneWeek' });
  assert.equal(found.results.length, 1); assert.equal(found.results[0].title, '官方中文文档');
  assert.equal(found.results[0].snippet.length, 1600); assert.equal(found.untrusted, true);
  assert.ok(!JSON.stringify(found).includes(token));
  await search.call({ query: 'again' });
  assert.deepEqual(calls.map(c => c.request.method), ['initialize', 'notifications/initialized', 'tools/call', 'tools/call']);
  assert.equal(calls.at(-1).request.params.name, 'web_search_prime');
  assert.equal(calls.at(-1).options.redirect, 'error');
});

test('invalid arguments and credential queries never reach network', async () => {
  const { search, calls } = fixture(result([]));
  for (const query of [{ query: '' }, { query: 'x'.repeat(71) }, { query: 'x', domain: 'http://localhost' }, { query: 'x', recency: 'never' }, { query: 'x', other: true }]) {
    await assert.rejects(search.call(query), { code: 'INVALID_ARGUMENT' });
  }
  await assert.rejects(search.call({ query: token }), { code: 'SENSITIVE_QUERY' });
  assert.equal(calls.length, 0);
});

test('domain filter and result budget are enforced even when upstream ignores them', async () => {
  const items = [{ link: 'https://other.test/', title: 'outside' }, ...Array.from({ length: 9 }, (_, i) => ({ title: 'inside', link: 'https://docs.example.com/' + i }))];
  const found = await fixture(result(items)).search.call({ query: 'x', domain: 'example.com' });
  assert.equal(found.results.length, 5);
  assert.ok(found.results.every(item => new URL(item.url).hostname === 'docs.example.com'));
  await assert.rejects(fixture(result([{ link: 'https://example.com', content: 'x'.repeat(270000) }])).search.call({ query: 'x' }), { code: 'SEARCH_RESPONSE_LIMIT' });
});

test('empty results, provider errors and HTTP failures are distinct and sanitized', async () => {
  assert.deepEqual((await fixture(result([]), { sse: false }).search.call({ query: 'nothing' })).results, []);
  await assert.rejects(fixture({ isError: true, content: [{ type: 'text', text: token }] }).search.call({ query: 'x' }), { code: 'SEARCH_PROVIDER_ERROR' });
  for (const [status, code] of [[401, 'SEARCH_AUTH'], [429, 'SEARCH_RATE_LIMIT'], [503, 'SEARCH_UNAVAILABLE']]) {
    await assert.rejects(fixture(result([]), { status }).search.call({ query: 'x' }), error => error.code === code && !error.message.includes(token));
  }
  await assert.rejects(fixture({ content: [{ type: 'text', text: 'not json' }] }).search.call({ query: 'x' }), { code: 'SEARCH_INVALID_RESPONSE' });
});

test('search cancellation and timeout abort the network request', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const keepAlive = setInterval(() => {}, 50);
  try {
    await assert.rejects(createWebSearch({ token, fetchImpl, timeoutMs: 10 }).call({ query: 'x' }), { code: 'SEARCH_TIMEOUT' });
    const controller = new AbortController();
    const pending = createWebSearch({ token, fetchImpl }).call({ query: 'x' }, { signal: controller.signal });
    controller.abort(); await assert.rejects(pending, { code: 'CANCELLED' });
  } finally { clearInterval(keepAlive); }
});

test('capability migration retains history, Map tools and exposes search to main and forks', async () => {
  const source = { commit: 'a'.repeat(40), map: codexMap('a'.repeat(40)), call: async () => ({}) };
  const mapTools = createLearningMapTools(async () => ({ version: 'v1', document: source.map }));
  const directory = fileURLToPath(new URL('./test-data/web-' + randomUUID(), import.meta.url));
  const answer = text => ({ stop: 'end_turn', content: [{ type: 'text', text }] });
  const use = (name, input) => ({ stop: 'tool_use', content: [{ type: 'tool_use', id: randomUUID(), name, input }] });
  const options = { directory, source, mapTools, provider: { model: 'test' }, phase: 'calibration' };
  const before = await new Experiment({ ...options, modelFactory: () => ({ next: async () => answer('old') }) }).init();
  await before.newTrial('t'); before.trial('t').arm = 'direct';
  await before.submit('t', { requestId: 'old', text: 'old' }); await before.drain();
  const fingerprint = before.db.fingerprint; await before.close();
  const webSearch = fixture(result([{ title: 'Source', link: 'https://example.com/docs', content: 'evidence' }])).search;
  let childChecked = false;
  const e = await new Experiment({ ...options, webSearch, modelFactory: () => ({ next: async ({ tools, messages, system }) => {
    assert.ok(tools.some(t => t.name === 'web_search')); assert.ok(!system.includes('不联网'));
    const child = system.includes('你负责分配给你的调查');
    assert.equal(tools.some(t => t.name === 'edit_map'), !child);
    if (child) childChecked = true;
    const last = messages.at(-1).content;
    if (last === 'delegate') return use('fork_task', { goal: 'Search public documentation' });
    if (last === 'search' || child && typeof last === 'string') return use('web_search', { query: 'public docs' });
    return answer('[Source](https://example.com/docs)');
  } }) }).init();
  try {
    assert.equal(e.trial('t').requests[0].fingerprint, fingerprint);
    assert.match(e.db.revisions.at(-1).reason, /web search/);
    await e.submit('t', { requestId: 'search', text: 'search' }); await e.drain();
    assert.equal(e.trial('t').requests.at(-1).toolCalls, 1);
    e.trial('t').arm = 'adaptive';
    await e.submit('t', { requestId: 'delegate', text: 'delegate' }); await e.drain();
    assert.equal(childChecked, true); assert.equal(e.trial('t').children[0].status, 'completed');
  } finally { await e.close(); }
});
