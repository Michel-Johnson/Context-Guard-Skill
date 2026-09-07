import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { applyOperations, diffTrees, MapError, same, validate } from '../../prototype/map-model.mjs';
import { atomicWrite, encode, hash, readJSON } from './io.mjs';
import { memoryConfigPath, memoryRequest } from './memory.mjs';

const equalDocument = (a, b) => !!a && !!b && hash(encode(a)) === hash(encode(b));

export function documentOperations(before, after) {
  if (!before?.root && after?.root) {
    const operations = [{ type: 'initialize', project: after.project, node: structuredClone(after.root) }];
    if ((after.flows || []).length) operations.push({ type: 'document', fields: { flows: structuredClone(after.flows) } });
    return operations;
  }
  if (!before?.root || !after?.root) return [];
  const operations = diffTrees(before.root, after.root);
  if (!same(before.flows || [], after.flows || [])) operations.push({ type: 'document', fields: { flows: structuredClone(after.flows || []) } });
  return operations;
}

function scopes(operations) {
  const values = new Set();
  for (const operation of operations || []) {
    if (operation.type === 'document') for (const field of Object.keys(operation.fields || {})) values.add(`document:${field}`);
    else if (operation.type === 'initialize') values.add('*');
    else {
      const id = operation.id || operation.node?.id || '';
      if (!id) { values.add('*'); continue; }
      if (operation.type === 'update') for (const field of Object.keys(operation.fields || {})) values.add(`${id}:${field}`);
      else if (operation.type === 'attach-bug' || operation.type === 'update-bug') values.add(`${id}:bugs`);
      else values.add(`${id}:*`);
    }
  }
  return values;
}

export function operationsOverlap(left, right) {
  const a = scopes(left), b = scopes(right);
  if (a.has('*') || b.has('*')) return true;
  for (const value of a) {
    if (b.has(value)) return true;
    const [node] = value.split(':');
    if (b.has(`${node}:*`) || value.endsWith(':*') && [...b].some(item => item.startsWith(`${node}:`))) return true;
  }
  return false;
}

function sequenceKey(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return `value:${encode(value)}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.id === 'string' && value.id) return `id:${value.id}`;
  if (typeof value.archiveKey === 'string' && value.archiveKey) return `archive:${value.archiveKey}`;
  if (typeof value.operationId === 'string' && value.operationId) return `operation:${value.operationId}`;
  if (typeof value.from === 'string' && typeof value.to === 'string') return `flow:${value.from}\0${value.to}\0${value.label || ''}`;
  // Old human-authored memories predate archiveKey. Their complete value is a
  // safe append-only identity: concurrent edits remain as two entries instead
  // of either version being discarded.
  return `value:${hash(encode(value))}`;
}

function keyedSequence(values, at) {
  const entries = new Map();
  for (const value of values) {
    const key = sequenceKey(value);
    if (!key || entries.has(key)) throw new MapError('MEMORY_CONFLICT', `Cannot safely merge ${at}; sequence identity is ambiguous`, 409);
    entries.set(key, value);
  }
  return entries;
}

function mergeSessionValue(base, local, remote, at) {
  if (same(local, remote) || same(base, local)) return structuredClone(remote);
  if (same(base, remote)) return structuredClone(local);
  const field = at.split('.').at(-1);
  // Main owns normalized provenance once a proposal has been accepted or
  // cancelled. Different actor labels from older clients are not user content
  // and must not prevent the Session generation from reopening.
  if (['origin', 'proposedBy', 'isNew'].includes(field)) return structuredClone(remote);
  if ((base === undefined || Array.isArray(base)) && Array.isArray(local) && Array.isArray(remote)) {
    const indexedBase = keyedSequence(base || [], at), indexedLocal = keyedSequence(local, at), indexedRemote = keyedSequence(remote, at);
    const order = [...indexedLocal.keys(), ...[...indexedRemote.keys()].filter(key => !indexedLocal.has(key))];
    const merged = [];
    for (const key of order) {
      const before = indexedBase.get(key), left = indexedLocal.get(key), right = indexedRemote.get(key);
      if (left === undefined && right === undefined) continue;
      if (left === undefined) {
        if (before === undefined) merged.push(structuredClone(right));
        else if (!same(before, right)) throw new MapError('MEMORY_CONFLICT', `Delete and edit overlap at ${at}`, 409);
        continue;
      }
      if (right === undefined) {
        if (before === undefined) merged.push(structuredClone(left));
        else if (!same(before, left)) throw new MapError('MEMORY_CONFLICT', `Edit and delete overlap at ${at}`, 409);
        continue;
      }
      merged.push(mergeSessionValue(before, left, right, `${at}[${key}]`));
    }
    return merged;
  }
  if ((base === undefined || base && typeof base === 'object' && !Array.isArray(base))
      && [local, remote].every(value => value && typeof value === 'object' && !Array.isArray(value))) {
    const merged = {};
    const before = base || {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeSessionValue(before[key], local[key], remote[key], `${at}.${key}`);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  throw new MapError('MEMORY_CONFLICT', `Both Session and Main changed ${at}`, 409);
}

export function mergeSessionDocuments(base, local, remote) {
  return mergeSessionValue(base, local, remote, 'map');
}

export function parseSseBlocks(buffer) {
  const normalized = buffer.replaceAll('\r\n', '\n');
  const blocks = normalized.split('\n\n');
  return { blocks: blocks.slice(0, -1), rest: blocks.at(-1) || '' };
}

export class MemorySyncCoordinator extends EventEmitter {
  constructor({ project, sessionId, store, directory, request = memoryRequest, display, retryMin = 250, retryMax = 5000, managed = false, heartbeatMs = 10000, streamIdleMs = 25000 } = {}) {
    super();
    this.project = project;
    this.sessionId = sessionId;
    this.store = store;
    this.sessionDirectory = directory;
    this.directory = path.join(directory, 'remote-sync');
    this.stateFile = path.join(this.directory, 'state.json');
    this.baseFile = path.join(this.directory, 'server-base.json');
    this.outboxFile = path.join(this.directory, 'outbox.json');
    this.conflictFile = path.join(this.directory, 'conflict.json');
    this.request = request;
    this.display = display;
    this.retryMin = retryMin;
    this.retryMax = retryMax;
    this.retryDelay = retryMin;
    this.heartbeatMs = heartbeatMs;
    this.streamIdleMs = streamIdleMs;
    this.serial = Promise.resolve();
    this.closed = false;
    this.initialized = false;
    this.managed = managed;
    this.abort = null;
    this.status = { configured: false, status: 'disabled', pending: 0, cursor: 0, serverVersion: null, error: null, conflict: null };
    this.onStoreEvent = event => {
      if (event.actor?.sessionId === 'cloud-sync') return;
      this.schedule(() => this.queueLocal()).catch(() => {});
    };
  }

  async knownBase() {
    let base = await readJSON(this.baseFile, null);
    if (!base) {
      const confirmed = await readJSON(path.join(this.sessionDirectory, 'base-main.json'), null);
      if (confirmed?.map) {
        validate(confirmed.map);
        base = confirmed.map;
        await atomicWrite(this.baseFile, encode(base));
      }
    }
    if (base && this.status.conflict?.code === 'SESSION_MAIN_BASELINE_REQUIRED') {
      await fs.unlink(this.conflictFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await this.persist({ status: 'connecting', conflict: null, error: null });
    }
    return base;
  }

  snapshot() { return { ...this.status }; }
  update(fields) {
    this.status = { ...this.status, ...fields };
    this.emit('change', this.snapshot());
  }
  schedule(action) {
    const next = this.serial.then(action);
    this.serial = next.catch(() => {});
    return next;
  }
  async persist(fields = {}) {
    this.update(fields);
    await atomicWrite(this.stateFile, encode(this.status));
  }

  async start() {
    await fs.mkdir(this.directory, { recursive: true });
    const configuration = await readJSON(memoryConfigPath(this.project), null);
    if (!configuration) return this.snapshot();
    this.configuration = configuration;
    this.status = { ...this.status, ...(await readJSON(this.stateFile, {})), configured: true, status: 'connecting' };
    this.store.on('event', this.onStoreEvent);
    this.update({ configured: true, status: 'connecting' });
    this.loopPromise = this.run();
    this.startLegacyHeartbeat();
    return this.snapshot();
  }

  async initialize() {
    const base = await this.knownBase();
    let remote = (await this.request(this.project, `sessions/${encodeURIComponent(this.sessionId)}`)).snapshot;
    if (!remote) remote = await this.createSessionGeneration();
    else remote = await this.ensureSessionDisplay(remote);
    if (!remote || this.status.conflict) return;
    validate(remote.memory.map);
    if (this.status.status === 'synced' && !this.status.pending && remote.version === this.status.serverVersion && equalDocument(base, remote.memory.map) && equalDocument(this.store.doc, base)) return;
    if (!base) {
      if (equalDocument(this.store.doc, remote.memory.map)) {
        await atomicWrite(this.baseFile, encode(remote.memory.map));
      } else {
        const main = (await this.request(this.project, 'main')).snapshot;
        if (main?.memory?.map && equalDocument(this.store.doc, main.memory.map)) {
          await this.applyRemoteDocument(remote.memory.map, `remote:init:${remote.version}`);
          await atomicWrite(this.baseFile, encode(remote.memory.map));
        } else {
          return this.saveConflict('INITIAL_SYNC_CONFLICT', null, this.store.doc, remote.memory.map);
        }
      }
    } else await this.reconcileRemote(remote, this.status.cursor || 0);
    if (this.status.conflict) return;
    await this.persist({ status: 'syncing', serverVersion: remote.version, error: null, conflict: null });
    await this.queueLocal();
  }

  async currentDisplay() {
    const display = await this.display?.();
    return display?.name ? { name: String(display.name).slice(0, 200), platform: String(display.platform || 'unknown').slice(0, 30) } : null;
  }

  async ensureSessionDisplay(remote) {
    const display = await this.currentDisplay();
    if (!display || same(remote.memory?.display, display)) return remote;
    return (await this.request(this.project, `sessions/${encodeURIComponent(this.sessionId)}`, {
      operationId: `session-display:${this.sessionId}:${hash(encode(display))}`,
      baseVersion: remote.version,
      baseMainVersion: remote.baseMainVersion || null,
      sourceCommit: remote.sourceCommit || this.project.head,
      memory: { ...remote.memory, display },
    })).snapshot;
  }

  async createSessionGeneration() {
    const scope = `sessions/${encodeURIComponent(this.sessionId)}`;
    const existing = (await this.request(this.project, scope)).snapshot;
    if (existing) return existing;
    const main = (await this.request(this.project, 'main')).snapshot;
    let base = await this.knownBase();
    if (main?.memory?.map) {
      if (!base) {
        if (!equalDocument(this.store.doc, main.memory.map)) {
          await this.saveConflict('SESSION_MAIN_BASELINE_REQUIRED', null, this.store.doc, main.memory.map);
          return null;
        }
        await atomicWrite(this.baseFile, encode(main.memory.map));
        base = main.memory.map;
      } else if (!equalDocument(base, main.memory.map)) {
        let merged;
        try { merged = mergeSessionDocuments(base, this.store.doc, main.memory.map); }
        catch (error) {
          if (error.code !== 'MEMORY_CONFLICT') throw error;
          await this.saveConflict('MAIN_ADVANCED_BEFORE_SESSION_REOPEN', base, this.store.doc, main.memory.map);
          return null;
        }
        if (!equalDocument(merged, this.store.doc)) await this.applyRemoteDocument(merged, `main-rebase:${main.version}`);
      }
    }
    const display = await this.currentDisplay();
    const input = {
      operationId: `session-init:${this.sessionId}:${randomUUID()}`,
      baseVersion: null,
      baseMainVersion: main?.version || null,
      sourceCommit: this.project.head,
      memory: { map: structuredClone(this.store.doc), records: {}, ...(display ? { display } : {}) },
    };
    let remote;
    try { remote = (await this.request(this.project, scope, input)).snapshot; }
    catch (error) {
      if (error.code !== 'VERSION_CONFLICT') throw error;
      remote = (await this.request(this.project, scope)).snapshot;
      if (!remote) throw error;
      await this.reconcileRemote(remote, this.status.cursor || 0);
      return remote;
    }
    await atomicWrite(this.baseFile, encode(remote.memory.map));
    await fs.unlink(this.outboxFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.unlink(this.conflictFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await this.persist({ status: 'synced', pending: 0, serverVersion: remote.version, error: null, conflict: null, lastSyncedAt: remote.updatedAt });
    return remote;
  }

  async queueLocal() {
    if (this.closed || !this.configuration || this.status.conflict) return;
    if (await readJSON(this.outboxFile, null)) { this.update({ status: 'syncing', pending: 1 }); return this.flush(); }
    const base = await readJSON(this.baseFile, null);
    if (!base || equalDocument(base, this.store.doc)) {
      await this.persist({ status: 'synced', pending: 0, error: null, lastSyncedAt: new Date().toISOString() });
      return;
    }
    const operations = documentOperations(base, this.store.doc);
    if (!operations.length) return;
    const body = {
      operationId: `session-map:${this.sessionId}:${randomUUID()}`,
      baseVersion: this.status.serverVersion,
      operations,
      localVersion: this.store.version,
      createdAt: new Date().toISOString(),
    };
    await atomicWrite(this.outboxFile, encode(body));
    await this.persist({ status: 'syncing', pending: 1, error: null });
    return this.flush();
  }

  async flush() {
    const pending = await readJSON(this.outboxFile, null);
    if (!pending || this.closed || this.status.conflict) return;
    try {
      const result = await this.request(this.project, `sessions/${encodeURIComponent(this.sessionId)}/map`, {
        operationId: pending.operationId,
        baseVersion: pending.baseVersion,
        operations: pending.operations,
      });
      const base = await readJSON(this.baseFile);
      const acknowledged = applyOperations(base, pending.operations, { kind: 'human', sessionId: 'cloud-sync' }).doc;
      await atomicWrite(this.baseFile, encode(acknowledged));
      await this.persist({ status: 'syncing', pending: 1, serverVersion: result.version, cursor: Math.max(this.status.cursor || 0, result.cursor || 0), error: null });
      await fs.unlink(this.outboxFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
      this.retryDelay = this.retryMin;
      await this.persist({ status: equalDocument(acknowledged, this.store.doc) ? 'synced' : 'syncing', pending: 0, lastSyncedAt: result.persistedAt || new Date().toISOString() });
      if (!equalDocument(acknowledged, this.store.doc)) await this.queueLocal();
    } catch (error) {
      if (error.code === 'SESSION_REOPEN_REQUIRED') {
        await this.createSessionGeneration();
        return;
      }
      if (error.code === 'VERSION_CONFLICT') {
        const remote = (await this.request(this.project, `sessions/${encodeURIComponent(this.sessionId)}`)).snapshot;
        await this.reconcileRemote(remote, this.status.cursor || 0);
        return;
      }
      await this.persist({ status: error.code === 'UNAUTHORIZED' ? 'error' : 'offline', pending: 1, error: error.code || error.message });
      this.retry();
    }
  }

  async reconcileRemote(remote, cursor) {
    if (!remote) return;
    validate(remote.memory.map);
    const base = await readJSON(this.baseFile, null);
    const local = this.store.doc;
    if (!base && !equalDocument(local, remote.memory.map)) return this.saveConflict('BASELINE_MISSING', null, local, remote.memory.map, { cursor, serverVersion: remote.version });
    if (equalDocument(local, remote.memory.map)) {
      await atomicWrite(this.baseFile, encode(remote.memory.map));
      await fs.unlink(this.outboxFile).catch(() => {});
      return this.persist({ serverVersion: remote.version, cursor, status: 'synced', pending: 0, error: null, conflict: null, lastSyncedAt: remote.updatedAt });
    }
    const localOperations = documentOperations(base, local);
    const remoteOperations = documentOperations(base, remote.memory.map);
    if (!remoteOperations.length) return this.persist({ serverVersion: remote.version, cursor, status: localOperations.length ? 'syncing' : 'synced', error: null });
    if (!localOperations.length) {
      await this.applyRemoteDocument(remote.memory.map, `remote:${remote.version}`);
      await atomicWrite(this.baseFile, encode(remote.memory.map));
      await fs.unlink(this.outboxFile).catch(() => {});
      return this.persist({ serverVersion: remote.version, cursor, status: 'synced', pending: 0, error: null, conflict: null, lastSyncedAt: remote.updatedAt });
    }
    if (operationsOverlap(localOperations, remoteOperations)) return this.saveConflict('REMOTE_AND_LOCAL_CHANGED', base, local, remote.memory.map, { cursor, serverVersion: remote.version });
    const merged = applyOperations(local, remoteOperations, { kind: 'human', sessionId: 'cloud-sync' }).doc;
    await this.applyRemoteDocument(merged, `remote-rebase:${remote.version}`);
    await atomicWrite(this.baseFile, encode(remote.memory.map));
    await fs.unlink(this.outboxFile).catch(() => {});
    await this.persist({ serverVersion: remote.version, cursor, status: 'syncing', pending: 0, error: null, conflict: null });
    return this.queueLocal();
  }

  async applyRemoteDocument(document, operationId) {
    const operations = documentOperations(this.store.doc, document);
    if (!operations.length) return;
    await this.store.commit({ operationId, baseVersion: this.store.version, operations }, { kind: 'human', sessionId: 'cloud-sync' });
  }

  async saveConflict(code, base, local, remote, extra = {}) {
    const conflict = { code, base, local, remote, at: new Date().toISOString(), ...extra };
    await atomicWrite(this.conflictFile, encode(conflict));
    await this.persist({ status: 'conflict', pending: (await readJSON(this.outboxFile, null)) ? 1 : 0, conflict: { code, at: conflict.at }, error: null });
    return this.snapshot();
  }

  retry() {
    if (this.closed || this.managed || this.retryTimer) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryMax, Math.max(this.retryMin, this.retryDelay * 2));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.schedule(() => this.flush()).catch(() => {});
    }, delay + Math.floor(Math.random() * Math.max(1, delay / 4)));
    this.retryTimer.unref();
  }

  healthyLegacyFallback() {
    // memoryRequest has a ten-second deadline. A successful polling channel is
    // sufficient for synchronization even while the optional SSE hint reconnects.
    return this.status.status === 'synced' && this.lastHeartbeatAt > Date.now() - this.heartbeatMs - 10000;
  }

  startLegacyHeartbeat() {
    if (this.closed || this.managed) return;
    this.heartbeatTimer = setTimeout(async () => {
      try {
        await this.schedule(async () => {
          if (this.closed || this.managed || !this.initialized || this.status.conflict || !this.status.serverVersion) return;
          const after = this.status.cursor || 0;
          const changes = await this.request(this.project, `sessions/${encodeURIComponent(this.sessionId)}/changes?after=${after}`);
          if (!Number.isSafeInteger(changes.cursor) || changes.cursor < after) throw new MapError('INVALID_SYNC_CURSOR', 'Invalid change cursor');
          if (changes.cursor > after) {
            const remote = (await this.request(this.project, `sessions/${encodeURIComponent(this.sessionId)}`)).snapshot;
            await this.reconcileRemote(remote, changes.cursor);
          }
          if (this.status.pending && !this.status.conflict) await this.flush();
          // An idle healthy connection must not rewrite the Map or state file.
          else if (!this.status.conflict && ['offline', 'error', 'connecting'].includes(this.status.status)) await this.persist({ status: 'synced', error: null });
          this.lastHeartbeatAt = Date.now();
        });
      } catch (error) {
        await this.schedule(async () => {
          this.lastHeartbeatAt = 0;
          if (!this.closed && !this.managed && !this.status.conflict) await this.persist({ status: error.code === 'UNAUTHORIZED' ? 'error' : 'offline', error: error.code || 'MEMORY_UNAVAILABLE' });
        }).catch(() => {});
      } finally {
        this.startLegacyHeartbeat();
      }
    }, this.heartbeatMs);
    this.heartbeatTimer.unref();
  }

  armStreamDeadline() {
    clearTimeout(this.streamTimer);
    const controller = this.abort;
    this.streamTimer = setTimeout(() => {
      controller.abort(new MapError('EVENT_STREAM_TIMEOUT', 'Memory event stream stopped responding'));
      this.streamReader?.cancel().catch(() => {});
    }, this.streamIdleMs);
    this.streamTimer.unref();
  }

  async consumeEvents(response) {
    if (!response.ok) throw new MapError(response.status === 401 ? 'UNAUTHORIZED' : 'MEMORY_EVENTS_FAILED', `Memory event stream failed: ${response.status}`, response.status);
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new MapError('MEMORY_EVENTS_FAILED', 'Memory service did not return an event stream');
    const decoder = new TextDecoder(); let buffer = '';
    const reader = response.body.getReader();
    this.streamReader = reader;
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        this.armStreamDeadline();
        this.retryDelay = this.retryMin;
        buffer += decoder.decode(chunk, { stream: true });
        const parsed = parseSseBlocks(buffer); buffer = parsed.rest;
        for (const block of parsed.blocks) {
          const lines = block.split('\n');
          const eventType = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
          const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
          if (!data) continue;
          const event = JSON.parse(data);
          if (eventType === 'change') await this.schedule(async () => {
            const cursor = event.cursor ?? Number(lines.find(line => line.startsWith('id:'))?.slice(3).trim() || 0);
            if (cursor <= (this.status.cursor || 0)) return;
            const remote = (await this.request(this.project, `sessions/${encodeURIComponent(this.sessionId)}`)).snapshot;
            await this.reconcileRemote(remote, cursor);
          });
        }
        if (this.closed) break;
      }
    } finally { this.streamReader = null; reader.releaseLock(); }
  }

  async run() {
    // A project-level device connection takes over steady-state heartbeats, but
    // every Session still needs one successful bootstrap. Without it, a Session
    // that was closed after publication can never reopen and therefore never
    // appears in the Cloud queue.
    while (!this.closed) {
      try {
        await this.schedule(async () => {
          await this.initialize();
          this.initialized = !this.status.conflict && !!this.status.serverVersion;
        });
        if (this.closed || this.managed) return;
        if (this.status.conflict) return;
        const base = new URL(this.configuration.url);
        this.abort = new AbortController();
        this.armStreamDeadline();
        const response = await fetch(new URL(`/v1/projects/${this.configuration.projectId}/sessions/${encodeURIComponent(this.sessionId)}/events?after=${this.status.cursor || 0}`, base), {
          headers: { Authorization: `Bearer ${this.configuration.token}`, 'Last-Event-ID': String(this.status.cursor || 0) },
          redirect: 'error', signal: this.abort.signal,
        });
        await this.consumeEvents(response);
        if (!this.closed) throw new MapError('EVENT_STREAM_CLOSED', 'Memory event stream closed');
        this.retryDelay = this.retryMin;
      } catch (error) {
        clearTimeout(this.streamTimer);
        if (this.closed || this.managed) break;
        if (this.abort?.signal.reason?.code === 'EVENT_STREAM_TIMEOUT') error = this.abort.signal.reason;
        await this.schedule(async () => {
          if (!this.closed && !this.status.conflict && (!this.managed || !this.initialized) && !this.healthyLegacyFallback()) await this.persist({ status: error.code === 'UNAUTHORIZED' ? 'error' : 'offline', error: error.code || error.message });
        });
        await this.waitForRetry(this.retryDelay + Math.floor(Math.random() * Math.max(1, this.retryDelay / 4)));
        this.retryDelay = Math.min(this.retryMax, Math.max(this.retryMin, this.retryDelay * 2));
      } finally {
        clearTimeout(this.streamTimer);
        this.abort?.abort();
        this.abort = null;
      }
    }
  }

  waitForRetry(milliseconds) {
    return new Promise(resolve => {
      this.retryWaitResolve = resolve;
      this.retryWaitTimer = setTimeout(() => { this.retryWaitTimer = null; this.retryWaitResolve = null; resolve(); }, milliseconds);
      this.retryWaitTimer.unref();
    });
  }

  async projectHeartbeat(head) {
    if (typeof head.mapVersion !== 'string' || !Number.isSafeInteger(head.mapCursor) || head.mapCursor < 0) return;
    if (!this.managed) {
      this.managed = true;
      clearTimeout(this.heartbeatTimer);
      clearTimeout(this.retryTimer); this.retryTimer = null;
      clearTimeout(this.retryWaitTimer); this.retryWaitResolve?.();
      this.streamReader?.cancel().catch(() => {});
      this.abort?.abort(); await this.loopPromise?.catch(() => {});
    }
    return this.schedule(async () => {
      if (this.closed || this.status.conflict) return;
      if (!this.status.serverVersion) await this.initialize();
      if (this.status.conflict) return;
      if (head.mapVersion !== this.status.serverVersion) {
        const remote = (await this.request(this.project, `sessions/${encodeURIComponent(this.sessionId)}`)).snapshot;
        // This cursor belongs to the observed version. A newer read will be
        // reconciled again on the next heartbeat, never skip unseen events.
        await this.reconcileRemote(remote, head.mapCursor);
      }
      if (this.status.pending) await this.flush();
      else if (['offline', 'error', 'connecting'].includes(this.status.status)) await this.persist({ status: 'synced', error: null });
    }).catch(async error => {
      if (!this.status.conflict) await this.persist({ status: error.code === 'UNAUTHORIZED' ? 'error' : 'offline', error: error.code || 'MEMORY_UNAVAILABLE' });
      throw error;
    });
  }

  async close() {
    this.closed = true;
    clearTimeout(this.heartbeatTimer);
    clearTimeout(this.streamTimer);
    clearTimeout(this.retryTimer);
    clearTimeout(this.retryWaitTimer);
    this.retryWaitResolve?.();
    this.store.off('event', this.onStoreEvent);
    this.streamReader?.cancel().catch(() => {});
    this.abort?.abort();
    await this.loopPromise?.catch(() => {});
    await this.serial;
  }
}
