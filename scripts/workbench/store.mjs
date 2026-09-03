import fs from 'node:fs/promises';
import path from 'node:path';
import { watch } from 'node:fs';
import { EventEmitter } from 'node:events';
import { MapError, validate, applyOperations, diffTrees } from '../../prototype/map-model.mjs';
import { hash, encode, atomicWrite, readJSON } from './io.mjs';

export class MapStore extends EventEmitter {
  constructor(root, { fault = async () => {}, project = async () => {}, contextDir } = {}) {
    super(); this.root = root; this.ctx = contextDir || path.join(root, '.codex/context');
    this.file = path.join(this.ctx, 'map.json'); this.runtime = path.join(this.ctx, 'private/sync');
    this.pendingFile = path.join(this.runtime, 'pending.json');
    this.eventsFile = path.join(this.ctx, 'sessions/workbench-changes.jsonl');
    this.tail = Promise.resolve(); this.fault = fault; this.project = project;
    this.version = null; this.doc = null; this.error = null; this.blocked = null; this.projection = { status: 'pending' };
  }
  serial(fn) { const promise = this.tail.then(fn); this.tail = promise.catch(() => {}); return promise; }
  async init() {
    await fs.mkdir(path.join(this.runtime, 'operations'), { recursive: true });
    await fs.mkdir(path.dirname(this.eventsFile), { recursive: true });
    this.events = (await fs.readFile(this.eventsFile, 'utf8').catch(e => e.code === 'ENOENT' ? '' : Promise.reject(e))).split('\n').filter(Boolean).map(JSON.parse);
    this.cursor = this.events.at(-1)?.cursor || null;
    await this.recover(); await this.refresh();
    // libuv must receive the long, canonical path on Windows (TEMP may be 8.3).
    this.watcher = watch(await fs.realpath(this.ctx), (_event, filename) => {
      // Generated indexes live in the same directory. Their events must neither
      // postpone map detection nor trigger repeated reads of a large map.
      if (filename && String(filename) !== 'map.json') return;
      clearTimeout(this.watchTimer); this.watchTimer = setTimeout(() => this.serial(() => this.refresh()).catch(e => this.setError(e)), 12);
    });
    this.poll = setInterval(() => this.serial(() => this.refresh()).catch(e => this.setError(e)), 1000);
    this.poll.unref(); return this;
  }
  setError(error) { this.error = { code: error.code || 'INVALID_FILE', message: error.message }; this.emit('change', this.state(false)); }
  state(full = true) { return { version: this.version, cursor: this.cursor, ...(full ? { doc: this.doc } : {}), error: this.error, recovery: this.blocked, projection: this.projection }; }
  async disk() {
    const raw = await fs.readFile(this.file, 'utf8');
    if (Buffer.byteLength(raw) > 16 * 1024 * 1024) throw new MapError('INVALID_MAP', 'Map exceeds 16 MiB');
    const doc = JSON.parse(raw.replace(/^\uFEFF/, '')); validate(doc); return { raw, doc, version: hash(raw) };
  }
  async refresh() {
    let disk;
    try { disk = await this.disk(); }
    catch (e) { this.setError(e); return this.state(); }
    if (disk.version !== this.version) {
      const previous = this.version, before = this.doc;
      this.doc = disk.doc; this.version = disk.version; this.error = null;
      if (previous) {
        const changed = before?.root && disk.doc.root ? diffTrees(before.root, disk.doc.root) : [];
        await this.recordEvent({ operationId: `external:${disk.version}`, fromVersion: previous, version: disk.version, actor: { kind: 'external', sessionId: null }, actions: ['external-file'], nodeIds: [...new Set(changed.map(op => op.id || op.node?.id).filter(Boolean))], fields: [...new Set(changed.flatMap(op => Object.keys(op.fields || {})))] });
      }
      this.scheduleProjection(); this.emit('change', this.state(false));
    } else if (this.error) { this.error = null; this.emit('change', this.state(false)); }
    return this.state();
  }
  scheduleProjection() {
    clearTimeout(this.projectionTimer); this.projection = { status: 'pending', sourceVersion: this.version };
    this.projectionTimer = setTimeout(async () => {
      const version = this.version, doc = this.doc;
      try { await this.fault('projection'); const ready = await this.project(doc, version); if (this.version !== version || ready === false) return; this.projection = { status: 'ready', sourceVersion: version }; }
      catch (e) { this.projection = { status: 'failed', sourceVersion: version, message: e.message }; }
      this.emit('change', this.state(false));
    }, 180);
  }
  operationPath(id) { return path.join(this.runtime, 'operations', hash(id) + '.json'); }
  async operation(id) { return readJSON(this.operationPath(id), null); }
  async recordEvent(record) {
    if (this.events.some(e => e.operationId === record.operationId && e.version === record.version)) return;
    const event = { ...record, cursor: hash(`${this.cursor || ''}:${encode(record)}`), at: new Date().toISOString() };
    const handle = await fs.open(this.eventsFile, 'a', 0o600);
    try { await handle.writeFile(JSON.stringify(event) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    this.events.push(event); this.cursor = event.cursor;
  }
  changes(cursor) {
    const i = cursor ? this.events.findIndex(e => e.cursor === cursor) : -1;
    return { version: this.version, cursor: this.cursor, reset: !cursor || i < 0, changes: this.events.slice(i >= 0 ? i + 1 : -100), ...(!cursor || i < 0 ? { readCurrent: true } : {}) };
  }
  async finish(record) {
    await this.recordEvent(record.event);
    await this.fault('after-event');
    await atomicWrite(this.operationPath(record.operationId), encode(record));
    await this.fault('after-result');
    await atomicWrite(this.pendingFile, 'null\n');
  }
  async recover() {
    const pending = await readJSON(this.pendingFile, null);
    if (!pending) return;
    const existing = await this.operation(pending.operationId);
    if (existing) { await atomicWrite(this.pendingFile, 'null\n'); return; }
    let disk;
    try { disk = await this.disk(); } catch (e) { this.blocked = { code: 'RECOVERY_REQUIRED', operationId: pending.operationId, message: e.message }; return; }
    if (disk.version === pending.version) {
      pending.result.recovered = true; await this.finish(pending);
    } else if (disk.version === pending.baseVersion) {
      pending.result = { committed: false, code: 'NOT_COMMITTED', operationId: pending.operationId, version: disk.version };
      await atomicWrite(this.operationPath(pending.operationId), encode(pending)); await atomicWrite(this.pendingFile, 'null\n');
    } else this.blocked = { code: 'RECOVERY_REQUIRED', operationId: pending.operationId, message: 'Map differs from both pending versions. Preserve files and reconcile; no automatic replay.' };
  }
  async commit(request, actor, grants = [], fence = async () => {}) {
    return this.serial(async () => {
      const { operationId, baseVersion, operations } = request;
      if (typeof operationId !== 'string' || !/^[\w:.-]{8,160}$/.test(operationId)) throw new MapError('INVALID_OPERATION_ID', 'Use a stable unique operationId (8–160 characters)');
      const digest = hash(encode({ baseVersion, operations, actor }));
      const previous = await this.operation(operationId);
      if (previous) {
        if (previous.digest !== digest) throw new MapError('ID_REUSED', 'operationId belongs to a different request', 409);
        return { ...previous.result, duplicate: true };
      }
      if (this.blocked) throw new MapError('RECOVERY_REQUIRED', 'Commit outcome requires recovery; do not create a new operationId', 503, this.blocked);
      await fence();
      const disk = await this.disk();
      if (disk.version !== this.version) await this.refresh();
      if (!baseVersion || baseVersion !== disk.version) throw new MapError('VERSION_CONFLICT', 'Read current state before editing again', 409, this.changes(request.cursor));
      const { doc, resultIds } = applyOperations(disk.doc, operations, actor, typeof grants === 'function' ? grants() : grants);
      const raw = encode(doc), version = hash(raw);
      const result = { committed: true, operationId, version, resultIds, projection: 'pending' };
      const record = { operationId, digest, baseVersion, version, result, event: { operationId, fromVersion: baseVersion, version, actor, actions: operations.map(op => op.type), nodeIds: resultIds, fields: [...new Set(operations.flatMap(op => Object.keys(op.fields || {})))] } };
      await atomicWrite(this.pendingFile, encode(record));
      let replaced = false;
      try {
        await this.fault('after-pending');
        await atomicWrite(this.file, raw, { beforeReplace: async () => {
          if (hash(await fs.readFile(this.file)) !== baseVersion) throw new MapError('VERSION_CONFLICT', 'External save occurred before replacement', 409);
        } });
        replaced = true; await this.fault('after-map');
        await this.finish(record);
      } catch (e) {
        const current = await fs.readFile(this.file).then(hash).catch(() => null);
        if (!replaced && current === baseVersion) {
          await atomicWrite(this.pendingFile, 'null\n'); throw e;
        }
        this.blocked = { code: 'RECOVERY_REQUIRED', operationId, persisted: current === version, message: e.message };
        this.setError(new MapError('RECOVERY_REQUIRED', 'Save may have committed. Query this operationId after recovery; do not retry as a new operation.'));
        throw new MapError('RECOVERY_REQUIRED', this.error.message, 503, this.blocked);
      }
      this.doc = doc; this.version = version; this.error = null;
      this.scheduleProjection(); this.emit('change', { ...this.state(false), operationId });
      return { ...result, cursor: this.cursor };
    });
  }
  async close() {
    clearInterval(this.poll); clearTimeout(this.watchTimer); clearTimeout(this.projectionTimer); this.watcher?.close(); await this.tail;
  }
}
