export class GatewayError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}
export class Gateway {
  constructor({ url, token, teamId, fetchImpl = fetch }) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)) throw new Error('Plugin gateway must be loopback HTTP');
    this.url = parsed.origin; this.token = token; this.teamId = teamId; this.fetch = fetchImpl;
  }
  async command(type, { id, userId, projectId, conversationId, payload = {} }) {
    if (!id || !userId) throw new Error('Stable operation ID and real Slack user are required');
    const response = await this.fetch(`${this.url}/v1/command`, { method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id, teamId: this.teamId, userId, ...(projectId ? { projectId } : {}), ...(conversationId ? { conversationId } : {}), type, payload }) });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new GatewayError(body.error?.code || 'GATEWAY_ERROR', body.error?.message || 'Gateway unavailable', response.status);
    return body.data;
  }
  async *events({ userId, projectId, conversationId, signal }) {
    if (!userId || !projectId || !conversationId) throw new Error('A scoped linked conversation is required');
    const query = new URLSearchParams({ teamId: this.teamId, userId, projectId, conversationId });
    const response = await this.fetch(`${this.url}/v1/events?${query}`, {
      headers: { authorization: `Bearer ${this.token}`, accept: 'text/event-stream' }, redirect: 'error', signal,
    });
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (!response.ok || mediaType !== 'text/event-stream' || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new GatewayError('GATEWAY_STREAM', 'Event subscription is unavailable', response.status);
    }
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    const limit = 8 * 1024 * 1024;
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          if (Buffer.byteLength(frame) > limit) throw new GatewayError('GATEWAY_EVENT_TOO_LARGE', 'Event frame exceeds the size limit');
          const lines = frame.split(/\r?\n/);
          if (lines.find(line => line.startsWith('event:'))?.slice(6).trim() !== 'state') continue;
          let message;
          try { message = JSON.parse(lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')); }
          catch { throw new GatewayError('GATEWAY_EVENT_INVALID', 'Event frame is invalid'); }
          if (message?.type !== 'state' || !message.data || typeof message.data !== 'object' || Array.isArray(message.data) || message.data.conversationId !== conversationId) {
            throw new GatewayError('GATEWAY_EVENT_INVALID', 'Event does not belong to the linked conversation');
          }
          yield message.data;
        }
        if (Buffer.byteLength(buffer) > limit) throw new GatewayError('GATEWAY_EVENT_TOO_LARGE', 'Event frame exceeds the size limit');
      }
      buffer += decoder.decode();
      if (buffer.trim()) throw new GatewayError('GATEWAY_EVENT_INVALID', 'Event stream ended with an incomplete frame');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
