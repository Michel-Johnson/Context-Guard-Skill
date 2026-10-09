import { randomUUID } from 'node:crypto';
import { canonical, errorReply, fail, MAX_MESSAGE_BYTES, ProtocolError, validateMessage } from '../shared/protocol.mjs';
import { hash } from '../shared/io.mjs';

// Host transport option only. Never read task expectations from model JSON.
export function encodeCiTaskExpectation(tuple) {
  const fields = ['taskId', 'planRef', 'planVersion', 'planSourceSha', 'approvalReceiptId', 'sourceSha', 'ciTodoRef', 'ciTodoVersion'];
  if (!tuple || typeof tuple !== 'object' || Array.isArray(tuple) || Object.keys(tuple).length !== fields.length ||
      fields.some(field => !Object.hasOwn(tuple, field) || typeof tuple[field] !== 'string' || !tuple[field].length ||
        tuple[field].length > (field.endsWith('Version') ? 4096 : 128) || /[\x00-\x1f\x7f]/.test(tuple[field])) ||
      !['sourceSha', 'planSourceSha'].every(field => /^[a-f0-9]{40}$/.test(tuple[field]))) fail('INVALID_ARGUMENT', 'Invalid CI task expectation');
  const encoded = Buffer.from(canonical(tuple)).toString('base64url');
  if (encoded.length > 8192) fail('INVALID_ARGUMENT', 'CI task expectation is too large');
  return encoded;
}

// This is supplied by the owning proof publisher, not the model message.
export function encodeCiHostEvidence(expectations, message, ciSessionId) {
  const fields = ['ref', 'version', 'contentHash'];
  const checks = message.payload.checks;
  if (!Array.isArray(expectations) || !expectations.length || expectations.length > 20 ||
      expectations.length !== checks.length || new Set(expectations.map(entry => entry?.ref)).size !== expectations.length ||
      expectations.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).length !== fields.length || fields.some(field => !Object.hasOwn(entry, field)) ||
        typeof entry.ref !== 'string' || entry.ref.length > 128 || !entry.ref.startsWith(`ci:${ciSessionId}:host:`) ||
        typeof entry.version !== 'string' || !entry.version || entry.version.length > 4096 ||
        /[\x00-\x1f\x7f]/.test(entry.ref + entry.version) || typeof entry.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.contentHash)) ||
      new Set(checks.map(check => check.evidenceRef)).size !== checks.length ||
      checks.some(check => !expectations.some(entry => entry.ref === check.evidenceRef) ||
        (check.status === 'failed' ? check.reproductionRef !== check.evidenceRef : check.reproductionRef !== undefined))) {
    fail('INVALID_ARGUMENT', 'Invalid CI host evidence expectation');
  }
  const encoded = Buffer.from(canonical(expectations)).toString('base64url');
  if (encoded.length > 8192) fail('INVALID_ARGUMENT', 'CI host evidence expectation is too large');
  return encoded;
}

// Never interpret a legacy HTML/JSON response as successful v2 delivery.
export async function sendMessage(origin, credential, message, { fetcher = fetch, timeoutMs = 10000, allowLoopback = false, receiveCredential, ciSessionId, ciTaskExpectation, ciHostEvidence } = {}) {
  validateMessage(message);
  if (ciSessionId && (typeof ciSessionId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(ciSessionId))) fail('INVALID_ARGUMENT', 'Invalid CI Session identity');
  if (ciTaskExpectation !== undefined && (!ciSessionId || !['object.read', 'object.put', 'ci.result'].includes(message.type))) fail('INVALID_ARGUMENT', 'Task expectation requires delegated CI');
  const ciTaskHeader = ciTaskExpectation === undefined ? undefined : encodeCiTaskExpectation(ciTaskExpectation);
  if (ciHostEvidence !== undefined && (!ciTaskHeader || message.type !== 'ci.result')) fail('INVALID_ARGUMENT', 'Host evidence requires a scoped CI result');
  const ciEvidenceHeader = ciHostEvidence === undefined ? undefined : encodeCiHostEvidence(ciHostEvidence, message, ciSessionId);
  if (ciEvidenceHeader && ciEvidenceHeader.length + ciTaskHeader.length > 12288) fail('INVALID_ARGUMENT', 'CI authorization headers are too large');
  const base = new URL(origin);
  if (base.protocol !== 'https:' && !(allowLoopback && base.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname))) fail('FORBIDDEN', 'Cloud transport requires HTTPS');
  if (base.username || base.password) fail('INVALID_ARGUMENT', 'Credentials must not be part of the URL');
  let response;
  try {
    response = await fetcher(new URL('/api/v2/messages', base), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}`, ...(ciSessionId ? { 'X-Context-Guard-CI-Session': ciSessionId } : {}),
        ...(ciTaskHeader ? { 'X-Context-Guard-CI-Task': ciTaskHeader } : {}),
        ...(ciEvidenceHeader ? { 'X-Context-Guard-CI-Evidence': ciEvidenceHeader } : {}) }, body: JSON.stringify(message),
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
  if (ciTaskHeader && response.headers.get('x-context-guard-ci-task-authorized') !== hash(Buffer.from(ciTaskHeader, 'base64url'))) {
    // Older servers ignore unknown headers. A valid generic receipt cannot
    // prove the new scope was authorized; preserve any uncertain original ID.
    fail('UNAVAILABLE', 'Server did not confirm current CI task authorization');
  }
  if (ciEvidenceHeader && response.headers.get('x-context-guard-ci-evidence-authorized') !== hash(Buffer.from(ciEvidenceHeader, 'base64url'))) {
    fail('UNAVAILABLE', 'Server did not confirm the original CI host evidence');
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
    this.running = null; this.observing = null; this.timer = null; this.closed = false;
    this.mapJobs = new Map(); this.deliveryJobs = new Map();
    this.onSession = onSession;
  }
  request(type, payload, session) { return { v: 2, id: randomUUID(), type, ...(session ? { session } : {}), payload }; }
  async poll(observation) {
    if (this.closed) return;
    if (observation) return this.drain(observation);
    if (this.running) return this.running;
    this.running = this.drain(observation).finally(() => { this.running = null; });
    return this.running;
  }
  async drain(observation = null) {
    observation ||= await this.observe();
    if (!observation) return;
    const { sessions, beat } = observation;
    const results = await Promise.allSettled(beat.sessions.map(remote => this.drainSession(sessions, remote)));
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Some Sessions could not synchronize');
  }
  // Liveness never waits for Map I/O, task delivery or an acknowledgement.
  // Coalesce only the heartbeat request itself, not the downstream work.
  observe() {
    if (this.closed) return Promise.resolve(null);
    if (!this.observing) this.observing = this.heartbeat().finally(() => { this.observing = null; });
    return this.observing;
  }
  async heartbeat() {
    const sessions = await this.sessions();
    if (!sessions.length) return;
    const beat = await this.send(this.request('sync.heartbeat', { sessions }));
    for (const rejected of beat.rejected || []) this.onError(new ProtocolError(rejected.code, 'Session heartbeat rejected', { sessionId: rejected.id, generation: rejected.generation }));
    return { sessions, beat };
  }
  async drainSession(sessions, remote) {
      const local = sessions.find(s => s.id === remote.id && s.generation === remote.generation);
      if (!local) fail('STALE_SESSION', 'Heartbeat returned an unknown binding');
      // Map reconciliation and durable notification delivery are independent.
      // A failed or stalled Map must not suppress receipt of queued tasks.
      const key = `${local.id}:${local.generation}`;
      const run = (jobs, operation) => {
        if (jobs.has(key)) return;
        const job = Promise.resolve().then(operation).finally(() => { jobs.delete(key); });
        jobs.set(key, job); return job;
      };
      const results = await Promise.allSettled([
        run(this.mapJobs, () => this.onSession(remote)),
        run(this.deliveryJobs, () => this.drainNotifications(local, remote)),
      ]);
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, 'Session synchronization failed');
  }
  async drainNotifications(local, remote) {
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
    const tick = () => this.observe().then(observation => observation && this.poll(observation)).catch(this.onError);
    this.timer = setInterval(tick, this.heartbeatMs); this.timer.unref?.(); tick();
  }
  wake() { return this.poll(); }
  async close() { this.closed = true; clearInterval(this.timer); this.timer = null; await Promise.allSettled([this.running, this.observing, ...this.mapJobs.values(), ...this.deliveryJobs.values()]); }
}
