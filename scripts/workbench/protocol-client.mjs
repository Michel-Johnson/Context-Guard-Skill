import { randomUUID } from 'node:crypto';
import { errorReply, fail, MAX_MESSAGE_BYTES, ProtocolError, validateMessage } from './protocol.mjs';

// Never interpret a legacy HTML/JSON response as successful v2 delivery.
export async function sendMessage(origin, credential, message, { fetcher = fetch, timeoutMs = 10000, allowLoopback = false, receiveCredential } = {}) {
  validateMessage(message);
  const base = new URL(origin);
  if (base.protocol !== 'https:' && !(allowLoopback && base.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname))) fail('FORBIDDEN', 'Cloud transport requires HTTPS');
  if (base.username || base.password) fail('INVALID_ARGUMENT', 'Credentials must not be part of the URL');
  let response;
  try {
    response = await fetcher(new URL('/api/v2/messages', base), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` }, body: JSON.stringify(message),
    });
  } catch { fail('UNAVAILABLE', 'Connection failed; keep the pending message and retry with the same ID'); }
  const possibleLegacy = [404, 405, 426].includes(response.status);
  const invalidReceipt = message => fail(possibleLegacy ? 'INVALID_ARGUMENT' : 'UNAVAILABLE', possibleLegacy ? 'Server does not support this protocol; upgrade is required' : message);
  // Authentication can fail before the server reads an ID. This is not a
  // definitive rejection of a previously uncertain business operation.
  if ([401, 403].includes(response.status)) fail(response.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', 'Connection is not authorized');
  if (!response.headers.get('content-type')?.includes('application/json')) invalidReceipt('Expected a v2 JSON receipt');
  let result;
  try {
    let size = 0; const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_MESSAGE_BYTES) fail('TOO_LARGE', 'Reply exceeds 256 KiB');
      chunks.push(chunk);
    }
    result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error instanceof ProtocolError) throw error; invalidReceipt('Incomplete protocol receipt'); }
  if (result?.id !== message.id || typeof result.ok !== 'boolean' || (result.ok && (!response.ok || !Object.hasOwn(result, 'data')))) invalidReceipt('Receipt does not match this request');
  if (!result.ok) {
    if (typeof result.error?.code !== 'string' || typeof result.error?.message !== 'string') fail('UNAVAILABLE', 'Malformed error receipt');
    const error = new ProtocolError(result.error.code, result.error.message, result.error.details);
    error.confirmedRejection = result.error.retryable === false && !['UNAUTHORIZED', 'FORBIDDEN', 'UNAVAILABLE'].includes(error.code);
    throw error;
  }
  if (message.type === 'auth.open' && receiveCredential) {
    const issued = response.headers.get('x-context-guard-credential');
    if (!issued || issued.length < 32) fail('UNAVAILABLE', 'Login did not return a connection credential');
    await receiveCredential(issued);
  }
  return result.data;
}

// Hosts supply a verified principal. This boundary never trusts a role in JSON.
export function messageHandler({ authenticate, handle, allowedOrigin }) {
  return async (req, res) => {
    let id = '', reply, status = 200;
    try {
      if (req.method !== 'POST') fail('INVALID_ARGUMENT', 'Use POST');
      if (req.headers.origin && req.headers.origin !== allowedOrigin) fail('FORBIDDEN', 'Untrusted browser origin');
      const principal = await authenticate(req);
      if (!principal) fail('UNAUTHORIZED', 'Authentication required');
      if (!req.headers['content-type']?.startsWith('application/json')) fail('INVALID_ARGUMENT', 'Expected application/json');
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_MESSAGE_BYTES) fail('TOO_LARGE', 'Message exceeds 256 KiB');
        chunks.push(chunk);
      }
      let message;
      try { message = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { fail('INVALID_ARGUMENT', 'Invalid JSON'); }
      if (typeof message?.id === 'string' && message.id.length <= 128) id = message.id;
      validateMessage(message);
      reply = await handle(principal, message);
    } catch (error) {
      reply = errorReply(id, error);
      status = error instanceof ProtocolError ? error.status : 503;
    }
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(reply));
  };
}

// One scheduler per project, not one timer per Session. Persist/apply/ack are host
// callbacks so both online and offline backends can retain their own storage.
export class ProjectMessagePump {
  constructor({ send, sessions, apply, heartbeatMs = 10000, onError = () => {}, onSession = async () => {} }) {
    this.send = send; this.sessions = sessions; this.apply = apply; this.heartbeatMs = heartbeatMs; this.onError = onError;
    this.running = null; this.timer = null; this.closed = false;
    this.onSession = onSession;
  }
  request(type, payload, session) { return { v: 2, id: randomUUID(), type, ...(session ? { session } : {}), payload }; }
  async poll() {
    if (this.closed) return;
    if (this.running) return this.running;
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }
  async drain() {
    const sessions = await this.sessions();
    if (!sessions.length) return;
    const beat = await this.send(this.request('sync.heartbeat', { sessions }));
    const pending = [...beat.sessions], errors = [];
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (pending.length && !this.closed) {
        const remote = pending.shift();
        try { await this.drainSession(sessions, remote); }
        catch (error) { errors.push(error); }
      }
    }));
    if (errors.length) throw new AggregateError(errors, 'Some Sessions could not synchronize');
  }
  async drainSession(sessions, remote) {
      const local = sessions.find(s => s.id === remote.id && s.generation === remote.generation);
      if (!local) fail('STALE_SESSION', 'Heartbeat returned an unknown binding');
      await this.onSession(remote);
      const session = { id: local.id, generation: local.generation };
      let cursor = remote.ackedSeq;
      // Bound a pass so one large Session cannot monopolize the project worker.
      for (let page = 0; page < 10 && cursor < remote.latestSeq && !this.closed; page++) {
        const data = await this.send(this.request('sync.read', { afterSeq: cursor, limit: 50 }, session));
        if (!data.messages?.length || data.nextSeq <= cursor) fail('UNAVAILABLE', 'Queue did not advance');
        const items = [];
        for (const item of data.messages) {
          validateMessage(item.message);
          if (item.seq !== cursor + 1 || item.message.session?.id !== session.id || item.message.session.generation !== session.generation) fail('UNAVAILABLE', 'Queue sequence or Session mismatch');
          // apply must persist the effect AND its ID receipt together before returning.
          const result = await this.apply(item.message);
          items.push({ ...result, seq: item.seq }); cursor = item.seq;
        }
        if (cursor !== data.nextSeq) fail('UNAVAILABLE', 'Read cursor mismatch');
        const ack = this.request('sync.ack', { items }, session);
        validateMessage(ack);
        await this.send(ack);
      }
  }
  start() {
    if (this.timer || this.closed) return;
    const tick = () => this.poll().catch(this.onError);
    this.timer = setInterval(tick, this.heartbeatMs); this.timer.unref?.(); tick();
  }
  wake() { return this.poll(); }
  async close() { this.closed = true; clearInterval(this.timer); this.timer = null; await this.running?.catch(() => {}); }
}
