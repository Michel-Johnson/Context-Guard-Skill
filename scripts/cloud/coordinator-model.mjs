import { hash } from '../shared/io.mjs';

const problem = (code, message) => Object.assign(new Error(message), { code });

// Provider transport only. Project authorization and workflow decisions belong
// to the server's existing protocol, never to model-supplied role fields.
export class CoordinatorModel {
  #token;
  constructor({ baseUrl, model, token, timeoutMs = 90000, maxTokens = 4096, fetch: fetchImpl = fetch }) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw problem('INVALID_PROVIDER', 'Coordinator requires a configured HTTPS provider');
    if (!model || !token) throw problem('INVALID_PROVIDER', 'Coordinator model and credential are required');
    this.endpoint = new URL(url.href.replace(/\/$/, '') + '/v1/messages');
    this.model = model; this.#token = token; this.timeoutMs = timeoutMs;
    this.maxTokens = maxTokens; this.fetch = fetchImpl;
  }

  async next({ system, messages, tools = [] }) {
    const body = JSON.stringify({ model: this.model, max_tokens: this.maxTokens, system, messages, ...(tools.length ? { tools } : {}) });
    if (Buffer.byteLength(body) > 512 * 1024) throw problem('CONTEXT_TOO_LARGE', 'Coordinator context needs explicit compaction');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(this.endpoint, {
        method: 'POST', redirect: 'error', signal: abort.signal,
        headers: { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
        body,
      });
      if (!response.ok) {
        await response.body?.cancel();
        // Provider error bodies may echo credentials or private prompt data.
        throw problem(`MODEL_HTTP_${response.status}`, `Coordinator provider returned HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 4 * 1024 * 1024) { await reader.cancel(); throw problem('MODEL_RESPONSE_TOO_LARGE', 'Coordinator response exceeds 4 MiB'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      let result;
      try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw problem('MODEL_INVALID_RESPONSE', 'Coordinator returned invalid JSON'); }
      if (result.model !== this.model || !Array.isArray(result.content) || !['end_turn', 'tool_use'].includes(result.stop_reason)) {
        throw problem('MODEL_INVALID_RESPONSE', 'Coordinator returned a different model or an incomplete turn');
      }
      const calls = result.content.filter(block => block.type === 'tool_use');
      if (new Set(calls.map(call => call.id)).size !== calls.length || calls.some(call => typeof call.id !== 'string' || !call.id || typeof call.name !== 'string' || !call.input || typeof call.input !== 'object' || Array.isArray(call.input))) {
        throw problem('MODEL_INVALID_RESPONSE', 'Coordinator returned malformed tool calls');
      }
      if ((result.stop_reason === 'tool_use') !== Boolean(calls.length)) throw problem('MODEL_INVALID_RESPONSE', 'Coordinator stop reason does not match its tool calls');
      return { content: result.content, stop: result.stop_reason, usage: result.usage || {}, model: result.model, requestId: response.headers.get('request-id') || '' };
    } catch (error) {
      if (abort.signal.aborted) throw problem('MODEL_TIMEOUT', 'Coordinator model timed out; no automatic retry was made');
      if (String(error.code || '').startsWith('MODEL_') || error.code === 'CONTEXT_TOO_LARGE') throw error;
      throw problem('MODEL_UNAVAILABLE', 'Coordinator model connection failed; no automatic retry was made');
    } finally { clearTimeout(timer); }
  }
}

// Persist every assistant response and tool receipt through the caller. Stable
// operation IDs let protocol-backed tools replay a lost response idempotently.
export async function coordinatorStep({ turnId, state, model, system, tools, save, execute }) {
  const promptVersion = hash(system);
  if (state.promptVersion && state.promptVersion !== promptVersion) throw problem('PROMPT_CHANGED', 'Resume with the same Coordinator prompt version');
  state.promptVersion = promptVersion;
  state.messages ||= []; state.toolReceipts ||= {};
  if (!state.pending) {
    const next = await model.next({ system, messages: state.messages, tools });
    state.messages.push({ role: 'assistant', content: next.content });
    state.pending = next;
    await save(state);
  }
  const next = state.pending;
  if (next.stop === 'end_turn') {
    state.status = 'waiting-for-user'; state.pending = null;
    await save(state);
    return state;
  }
  const responses = [];
  for (const call of next.content.filter(block => block.type === 'tool_use')) {
    if (!tools.some(tool => tool.name === call.name)) throw problem('TOOL_FORBIDDEN', 'Coordinator requested an unavailable tool');
    const operationId = `coordinator:${hash(`${turnId}:${call.id}`)}`;
    const fingerprint = hash(JSON.stringify({ name: call.name, input: call.input }));
    let receipt = state.toolReceipts[operationId];
    if (receipt && receipt.fingerprint !== fingerprint) throw problem('TOOL_ID_REUSED', 'Coordinator reused a tool identifier with different input');
    if (!receipt) {
      receipt = { fingerprint, result: await execute(call.name, call.input, { operationId }) };
      state.toolReceipts[operationId] = receipt;
      await save(state);
    }
    responses.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(receipt.result) });
  }
  state.messages.push({ role: 'user', content: responses });
  state.pending = null; state.status = 'running';
  await save(state);
  return state;
}
