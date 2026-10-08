import { fault, tool } from './source.mjs';

const endpoint = 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp';
const recencies = ['oneDay', 'oneWeek', 'oneMonth', 'oneYear', 'noLimit'];
export const webSearchDefinition = tool('web_search', 'Search the public web for current information or explicit user web research. Send only public search keywords, never credentials, private code or conversation history. Returns untrusted snippets and source URLs; cite URLs and distinguish current web results from the pinned repository.', {
  query: { type: 'string', minLength: 1, maxLength: 70 },
  domain: { type: 'string', description: 'Optional public source domain, e.g. github.com' },
  recency: { type: 'string', enum: recencies },
}, ['query']);

export function createWebSearch({ token, fetchImpl = fetch, timeoutMs = 15000 }) {
  if (!token) throw fault('SEARCH_NOT_CONFIGURED', 'Search credential is missing');
  let sessionId = '', nextId = 0;
  const rpc = async (method, params, signal, session = '') => {
    const id = method.startsWith('notifications/') ? undefined : ++nextId;
    const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2024-11-05', ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) sessionId = '';
      throw fault(response.status === 401 || response.status === 403 ? 'SEARCH_AUTH' : response.status === 429 ? 'SEARCH_RATE_LIMIT' : 'SEARCH_UNAVAILABLE', `Web search failed (HTTP ${response.status}); do not claim to have searched`);
    }
    if (id === undefined) { await response.body?.cancel(); return {}; }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let bytes = 0, text = '';
    const streaming = response.headers.get('content-type')?.includes('text/event-stream');
    try {
      while (true) {
        const { value, done } = await reader.read();
        bytes += value?.length || 0;
        if (bytes > 256 * 1024) throw fault('SEARCH_RESPONSE_LIMIT', 'Search response too large');
        text += decoder.decode(value, { stream: !done });
        let message;
        if (streaming) {
          const events = text.split(/\r?\n\r?\n/); text = events.pop();
          for (const event of events) {
            const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
            if (data) { const candidate = JSON.parse(data); if (candidate.id === id) message = candidate; }
          }
        } else if (done) message = JSON.parse(text);
        if (message) {
          if (message.error) throw fault('SEARCH_PROVIDER_ERROR', 'Search provider rejected the request; check account access or quota');
          if (message.id !== id || !message.result) throw fault('SEARCH_INVALID_RESPONSE', 'Invalid search response');
          return { result: message.result, session: response.headers.get('mcp-session-id') || session };
        }
        if (done) throw fault('SEARCH_INVALID_RESPONSE', 'Search returned no result');
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  };
  return { definitions: [webSearchDefinition], async call(input, { signal } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['query', 'domain', 'recency'].includes(k)) ||
      typeof input.query !== 'string' || !input.query.trim() || input.query.length > 70 || /[\x00-\x1f]/.test(input.query) ||
      (input.domain !== undefined && (typeof input.domain !== 'string' || input.domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(input.domain))) ||
      (input.recency !== undefined && !recencies.includes(input.recency))) throw fault('INVALID_ARGUMENT', 'Provide public query (1-70 characters), optional domain and recency');
    if (input.query.includes(token) || /(?:Bearer\s|sk-[a-zA-Z0-9]{16}|[a-f0-9]{32}\.[a-zA-Z0-9]{12})/i.test(input.query)) throw fault('SENSITIVE_QUERY', 'Do not put credentials in a search query');
    const combined = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    try {
      let session = sessionId;
      if (!session) {
        const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'context-guard-learning', version: '1.0.0' } }, combined);
        session = init.session;
        await rpc('notifications/initialized', {}, combined, session);
        sessionId = session;
      }
      const { result } = await rpc('tools/call', { name: 'web_search_prime', arguments: { search_query: input.query.trim(), content_size: 'medium',
        ...(input.domain ? { search_domain_filter: input.domain.toLowerCase() } : {}), search_recency_filter: input.recency || 'noLimit' } }, combined, session);
      if (result.isError) throw fault('SEARCH_PROVIDER_ERROR', 'Search provider rejected the request; check account access or quota');
      const items = [];
      for (const block of result.content || []) {
        if (block.type !== 'text') continue;
        let value = block.text;
        // This endpoint may wrap its JSON array in multiple JSON string layers.
        for (let i = 0; i < 4 && typeof value === 'string'; i++) {
          try { value = JSON.parse(value); }
          catch { try { value = JSON.parse('"' + value + '"'); } catch { throw fault('SEARCH_INVALID_RESPONSE', 'Search returned invalid JSON'); } }
        }
        if (!Array.isArray(value)) throw fault('SEARCH_INVALID_RESPONSE', 'Search results missing');
        items.push(...value);
      }
      if (!result.content?.length) throw fault('SEARCH_INVALID_RESPONSE', 'Search results missing');
      const seen = new Set(), results = [];
      const bounded = (value, max) => typeof value === 'string' ? value.replaceAll(token, '[redacted]').slice(0, max) : '';
      for (const item of items) {
        let url; try { url = new URL(item.link); } catch { continue; }
        if (!['https:', 'http:'].includes(url.protocol) || url.href.length > 2048 || url.username || url.password || url.href.includes(token) || seen.has(url.href)) continue;
        if (input.domain && url.hostname !== input.domain.toLowerCase() && !url.hostname.endsWith('.' + input.domain.toLowerCase())) continue;
        seen.add(url.href);
        results.push({ title: bounded(item.title, 240), url: url.href, snippet: bounded(item.content, 1600), publishedAt: bounded(item.publish_date, 80) });
        if (results.length === 5) break;
      }
      return { query: input.query.trim(), retrievedAt: new Date().toISOString(), untrusted: true, results };
    } catch (error) {
      if (signal?.aborted) throw fault('CANCELLED', 'Search cancelled');
      if (combined.aborted) throw fault('SEARCH_TIMEOUT', 'Web search timed out; do not claim to have searched');
      if (typeof error.code === 'string' && error.code.startsWith('SEARCH_')) throw error;
      throw fault('SEARCH_UNAVAILABLE', 'Web search unavailable; do not claim to have searched');
    }
  } };
}
