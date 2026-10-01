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
}
