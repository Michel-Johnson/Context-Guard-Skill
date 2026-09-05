import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { atomicWrite, encode, hash, readJSON, withFileLock } from './io.mjs';
import { canonical, fail, validateMessage, ProtocolError } from './protocol.mjs';
import { sendMessage, ProjectMessagePump } from './protocol-client.mjs';
import { readEvents } from './protocol-events.mjs';

const readTypes = new Set(['sync.heartbeat', 'sync.read', 'workbench.read', 'object.read', 'blob.get']);
const messageScope = message => message.session?.id || message.payload.sessionId || 'project';
// A single project host owns this connection. Agents never receive its credential.
export class DeviceConnection {
  constructor({ directory, origin, transport = sendMessage, allowLoopback = false }) {
    this.directory = directory; this.origin = origin; this.transport = transport; this.allowLoopback = allowLoopback;
    this.file = path.join(directory, 'device-connection.json'); this.outbox = path.join(directory, 'outbox'); this.inflight = new Map();
  }
  async connect(message, { repositoryId } = {}) {
    validateMessage(message);
    if (message.type !== 'auth.open') fail('INVALID_ARGUMENT', 'Expected auth.open');
    const identityFile = path.join(this.directory, 'device-identity.json');
    const identity = await withFileLock(`${identityFile}.lock`, async () => {
      const prior = await readJSON(identityFile, null);
      if (prior) return prior;
      const created = { clientId: randomUUID() };
      await atomicWrite(identityFile, encode(created));
      return created;
    });
    message = { ...message, payload: { ...message.payload, clientId: identity.clientId } };
    let credential;
    const result = await this.transport(this.origin, '', message, { allowLoopback: this.allowLoopback, receiveCredential: value => { credential = value; } });
    if (!credential) fail('UNAVAILABLE', 'Missing backend connection credential');
    if (repositoryId && result.repositoryId !== repositoryId) {
      await this.transport(this.origin, credential, { v: 2, id: randomUUID(), type: 'auth.close', payload: {} }, { allowLoopback: this.allowLoopback }).catch(() => {});
      fail('FORBIDDEN', 'Cloud project does not match the verified GitHub repository');
    }
    const previous = await readJSON(this.file, null);
    if (previous?.repositoryId && previous.repositoryId !== result.repositoryId) {
      await this.transport(this.origin, credential, { v: 2, id: randomUUID(), type: 'auth.close', payload: {} }, { allowLoopback: this.allowLoopback }).catch(() => {});
      fail('FORBIDDEN', 'Repository changed; preserve queues and migrate the project binding explicitly');
    }
    await atomicWrite(this.file, encode({ origin: this.origin, credential, ...result }));
    return result;
  }
  async transmit(message) {
    const connection = await readJSON(this.file, null);
    if (!connection?.credential || connection.origin !== this.origin) fail('UNAUTHORIZED', 'Local backend must connect first');
    return this.transport(connection.origin, connection.credential, message, { allowLoopback: this.allowLoopback });
  }
  async connected() { const value = await readJSON(this.file, null); return value?.origin === this.origin && !!value.credential; }
  async supports(capability) {
    const value = await readJSON(this.file, null);
    return value?.origin === this.origin && !!value.credential && value.capabilities?.includes(capability) === true;
  }
  async proxyBlob(req, res, session, blobId) {
    if (!['GET', 'PUT'].includes(req.method) || !/^[a-f0-9]{64}$/.test(blobId)) fail('INVALID_ARGUMENT', 'Invalid binary request');
    const connection = await readJSON(this.file, null), base = new URL(this.origin);
    if (!connection?.credential || connection.origin !== this.origin) fail('UNAUTHORIZED', 'Backend is disconnected');
    if (base.username || base.password || base.protocol !== 'https:' && !(this.allowLoopback && base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) fail('FORBIDDEN', 'Invalid binary transport origin');
    let body;
    if (req.method === 'PUT') {
      const chunks = []; let size = 0;
      for await (const bytes of req) { size += bytes.length; if (size > 1024 * 1024) fail('TOO_LARGE', 'Chunk exceeds 1 MiB'); chunks.push(bytes); }
      body = Buffer.concat(chunks);
    }
    const headers = { Authorization: `Bearer ${connection.credential}`, 'X-Context-Guard-Session': session.id, 'X-Context-Guard-Generation': String(session.generation) };
    for (const key of ['range', 'content-range']) if (req.headers[key]) headers[key] = req.headers[key];
    const response = await fetch(new URL(`/api/v2/blobs/${blobId}`, base), { method: req.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(30000) });
    const expectedType = response.ok && req.method === 'GET' ? 'application/octet-stream' : 'application/json';
    if (!response.headers.get('content-type')?.startsWith(expectedType)) {
      await response.body?.cancel(); fail('UNAVAILABLE', 'Unexpected binary endpoint response; keep the upload for retry');
    }
    const returnedHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) if (response.headers.has(key)) returnedHeaders[key] = response.headers.get(key);
    // Never forward cookies/credentials. Range retries use the registered digest,
    // so an unknown upload result can be safely retried with the same bytes.
    res.writeHead(response.status, returnedHeaders);
    let received = 0;
    const bound = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > (response.ok && req.method === 'GET' ? 64 * 1024 * 1024 : 256 * 1024)) callback(new Error('Binary response exceeds limit'));
      else callback(null, chunk);
    } });
    if (!response.body) { res.end(); return; }
    await pipeline(Readable.fromWeb(response.body), bound, res);
  }
  start({ sessions, apply, onError = () => {}, onSession, heartbeatMs = 10000, eventReader = readEvents }) {
    if (this.runtime) return;
    const controller = new AbortController();
    const pump = new ProjectMessagePump({ sessions, apply, heartbeatMs, onError: error => onError(error, 'heartbeat'), onSession, send: message => this.send(message) });
    let retrying;
    const retry = () => {
      if (retrying) return retrying;
      retrying = this.retryPending().catch(onError).finally(() => { retrying = null; });
      return retrying;
    };
    const timer = setInterval(retry, heartbeatMs); timer.unref?.();
    const wait = milliseconds => new Promise(resolve => {
      const done = () => { clearTimeout(timeout); controller.signal.removeEventListener('abort', done); resolve(); };
      const timeout = setTimeout(done, milliseconds); timeout.unref?.();
      controller.signal.addEventListener('abort', done, { once: true });
      if (controller.signal.aborted) done();
    });
    const events = (async () => {
      let failures = 0;
      while (!controller.signal.aborted) {
        try {
          const connection = await readJSON(this.file, null);
          if (!connection?.credential || connection.origin !== this.origin) fail('UNAUTHORIZED', 'Backend is disconnected');
          await eventReader(this.origin, connection.credential, { signal: controller.signal, allowLoopback: this.allowLoopback,
            onEvent: async () => { failures = 0; await pump.wake(); } });
        } catch (error) { if (!controller.signal.aborted) onError(error, 'events'); }
        if (!controller.signal.aborted) await wait(Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)));
      }
    })();
    this.runtime = { close: async () => {
      controller.abort(); clearInterval(timer); await pump.close(); await events; await retrying;
    } };
    retry(); pump.start();
  }
  async close() { const runtime = this.runtime; this.runtime = null; await runtime?.close(); await Promise.all([...(this.enrolling?.values() || [])]); }
  async disconnect(message) {
    const result = await this.transmit(message);
    await this.close();
    await atomicWrite(this.file, encode({ origin: this.origin, disconnected: true }));
    return result;
  }
  async bind(message, localBinding) {
    const file = path.join(this.directory, 'bindings', `${hash(message.payload.sessionId)}.json`);
    return withFileLock(`${file}.lock`, async () => {
      const versions = await readJSON(file, {});
      const remote = await this.send(message, wire => ({ ...wire, payload: { ...wire.payload,
        expectedBindingVersion: versions[wire.payload.expectedBindingVersion] || '',
      } }));
      if (remote.session.id !== localBinding.session.id || remote.session.generation !== localBinding.session.generation) {
        fail('STALE_SESSION', 'Cloud and local binding generations differ');
      }
      versions[localBinding.bindingVersion] = remote.bindingVersion;
      await atomicWrite(file, encode(versions));
      return localBinding;
    });
  }
  async ensureBinding(binding) {
    const versions = await readJSON(path.join(this.directory, 'bindings', `${hash(binding.sessionId)}.json`), {});
    if (versions[binding.version]) return;
    await this.bind({ v: 2, id: `bind:${hash(binding.version)}`, type: 'session.bind', payload: {
      sessionId: binding.sessionId, worktreeId: binding.worktreeId, agentId: binding.agentId,
      expectedBindingVersion: binding.version,
    } }, { session: { id: binding.sessionId, generation: binding.generation }, bindingVersion: binding.version });
  }
  async bindingReady(binding) {
    const versions = await readJSON(path.join(this.directory, 'bindings', `${hash(binding.sessionId)}.json`), {});
    if (versions[binding.version]) return true;
    this.enrolling ||= new Map();
    if (!this.enrolling.has(binding.sessionId) && this.enrolling.size < 4) {
      const job = this.ensureBinding(binding).catch(error => { this.lastError = error.code || 'UNAVAILABLE'; })
        .finally(() => this.enrolling.delete(binding.sessionId));
      this.enrolling.set(binding.sessionId, job);
    }
    return false;
  }
  async send(message, prepare = value => value) {
    validateMessage(message);
    if (message.type.startsWith('auth.')) fail('FORBIDDEN', 'Password and credential operations cannot enter the outbox');
    if (readTypes.has(message.type)) return this.transmit(message);
    const id = hash(message.id);
    if (this.inflight.has(id)) {
      if (this.inflight.get(id).fingerprint !== canonical(message)) fail('ID_REUSED', 'Concurrent request ID differs');
      return this.inflight.get(id).promise;
    }
    const promise = this.deliver(message, prepare).finally(() => this.inflight.delete(id));
    this.inflight.set(id, { fingerprint: canonical(message), promise });
    return promise;
  }
  async savedMessage(id) {
    return ((await readJSON(path.join(this.directory, 'outcomes', `${hash(id)}.json`), null)) || await readJSON(path.join(this.outbox, `${hash(id)}.json`), null))?.message || null;
  }
  async deliver(message, prepare) {
    const file = path.join(this.outbox, `${hash(message.id)}.json`), fingerprint = canonical(message);
    const outcomeFile = path.join(this.directory, 'outcomes', `${hash(message.id)}.json`);
    const outcome = record => {
      if (record.state === 'rejected') throw new ProtocolError(record.error.code, record.error.message, record.error.details);
      return record.result;
    };
    const prior = await withFileLock(`${file}.lock`, async () => {
      const completed = await readJSON(outcomeFile, null);
      if (completed) {
        if (canonical(completed.message) !== fingerprint) fail('ID_REUSED', 'Request ID differs from durable outcome');
        await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
        return completed;
      }
      const existing = await readJSON(file, null);
      if (existing && canonical(existing.message) !== fingerprint) fail('ID_REUSED', 'Request ID differs from durable outbox');
      if (existing) return existing;
      const pending = { message, wire: prepare(structuredClone(message)), state: 'pending' };
      validateMessage(pending.wire);
      const sequenceFile = path.join(this.directory, 'outbox-sequence.json');
      pending.sequence = await withFileLock(`${sequenceFile}.lock`, async () => {
        const next = (await readJSON(sequenceFile, { value: 0 })).value + 1;
        if (!Number.isSafeInteger(next)) fail('UNAVAILABLE', 'Outbox sequence is exhausted');
        await atomicWrite(sequenceFile, encode({ value: next }));
        return next;
      });
      await atomicWrite(file, encode(pending));
      return pending;
    });
    if (['done', 'rejected'].includes(prior?.state)) return outcome(prior);
    const scope = messageScope(message);
    return withFileLock(path.join(this.directory, 'lanes', `${hash(scope)}.lock`), async () => {
      const completed = await readJSON(outcomeFile, null);
      if (completed) return outcome(completed);
      const current = await readJSON(file);
      if (current.state === 'done') return current.result;
      // A fresh write must not overtake an older uncertain write in this Session.
      for (const name of await fs.readdir(this.outbox)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        const record = await readJSON(path.join(this.outbox, name), null);
        if (!record) continue;
        if (record.state === 'pending' && messageScope(record.message) === scope && (record.sequence || 0) < (current.sequence || 0)) fail('UNAVAILABLE', 'An earlier Session write must be recovered first');
      }
      const save = record => withFileLock(`${file}.lock`, async () => {
        // Persist the retry receipt before removing the pending index entry.
        await atomicWrite(outcomeFile, encode(record));
        await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
      });
      try {
        const result = await this.transmit(current.wire || message);
        await save({ ...current, state: 'done', result });
        return result;
      } catch (error) {
        if (error.confirmedRejection && !current.uncertain) await save({ ...current, state: 'rejected', error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
        else if (!current.uncertain) await withFileLock(`${file}.lock`, () => atomicWrite(file, encode({ ...current, uncertain: true })));
        throw error;
      }
    });
  }
  async retryPending() {
    const files = await fs.readdir(this.outbox).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const groups = new Map();
    for (const name of files.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const record = await readJSON(path.join(this.outbox, name), null);
      if (!record) continue;
      if (record.state !== 'pending') continue;
      const scope = messageScope(record.message);
      if (!groups.has(scope)) groups.set(scope, []);
      groups.get(scope).push(record);
    }
    const queue = [...groups.values()], results = [];
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const records = queue.shift().sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
        for (const record of records) {
          try { await this.send(record.message); results.push({ id: record.message.id, sent: true }); }
          catch (error) {
            results.push({ id: record.message.id, sent: false, code: error.code || 'UNAVAILABLE' });
            break; // Keep dependent writes behind the failed operation, not behind other Sessions.
          }
        }
      }
    }));
    return results;
  }
}
