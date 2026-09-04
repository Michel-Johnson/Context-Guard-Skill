import fs from 'node:fs/promises';
import path from 'node:path';
import { watch } from 'node:fs';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { MapError, validate, applyOperations, diffTrees } from '../../prototype/map-model.mjs';
import { hash, encode, atomicWrite, readJSON } from './io.mjs';
import { inspectJournal, backupJournal, replaceJournal } from './journal.mjs';

export class MapStore extends EventEmitter {
  constructor(root, { fault = async () => {}, project = async () => {}, file, runtime, eventsFile } = {}) {
    super(); this.root = root; this.ctx = path.join(root, '.codex/context');
    this.file = file || path.join(this.ctx, 'map.json'); this.runtime = runtime || path.join(this.ctx, 'private/sync');
    this.pendingFile = path.join(this.runtime, 'pending.json');
    this.eventsFile = eventsFile || path.join(this.ctx, 'sessions/workbench-changes.jsonl');
    this.journalStatusFile = path.join(this.runtime, 'journal-status.json');
    this.tail = Promise.resolve(); this.fault = fault; this.project = project;
    this.version = null; this.doc = null; this.error = null; this.blocked = null; this.projection = { status: 'pending' };
  }
  serial(fn) { const promise = this.tail.then(fn); this.tail = promise.catch(() => {}); return promise; }
  async init() {
    await fs.mkdir(path.join(this.runtime, 'operations'), { recursive: true });
    await fs.mkdir(path.dirname(this.eventsFile), { recursive: true });
    await this.loadJournal();
    if (!this.blocked) await this.recover();
    await this.refresh();
    // libuv must receive the long, canonical path on Windows (TEMP may be 8.3).
    this.watchRoot = await fs.realpath(path.dirname(this.file));
    this.watcher = watch(this.watchRoot, (_event, filename) => {
      // Generated indexes live in the same directory. Their events must neither
      // postpone map detection nor trigger repeated reads of a large map.
      if (filename && String(filename) !== 'map.json') return;
      clearTimeout(this.watchTimer); this.watchTimer = setTimeout(() => this.serial(() => this.refresh()).catch(e => this.setError(e)), 12);
    });
    this.poll = setInterval(() => this.serial(() => this.refresh()).catch(e => this.setError(e)), 1000);
    this.poll.unref(); return this;
  }
  setError(error) { this.error = { code: error.code || 'INVALID_FILE', message: error.message }; this.emit('change', this.state(false)); }
  state(full = true) { return { version: this.version, cursor: this.cursor, ...(full ? { doc: this.doc } : {}), error: this.error, recovery: this.blocked, readOnly: !!(this.blocked || this.error), journal: this.journal || null, projection: this.projection }; }
  async loadJournal() {
    const raw = await fs.readFile(this.eventsFile).catch(error => error.code === 'ENOENT' ? Buffer.alloc(0) : Promise.reject(error));
    const parsed = inspectJournal(raw);
    this.events = parsed.events;
    this.cursor = this.events.at(-1)?.cursor || null;
    try {
      this.journal = await readJSON(this.journalStatusFile, null);
    } catch {
      this.journal = { pending: true, code: 'JOURNAL_STATUS_INVALID', message: '恢复状态文件损坏，历史连续性需要重新核对' };
    }
    if (!parsed.problem && !parsed.needsNewline) return;
    const backup = await backupJournal(this.runtime, raw);
    this.journal = {
      code: parsed.problem ? 'JOURNAL_RECOVERED' : 'JOURNAL_NEWLINE_REPAIRED',
      backup,
      line: parsed.problem?.line,
      pending: !!parsed.problem,
      message: parsed.problem?.message || '已补齐日志末尾换行；原件已备份',
    };
    await atomicWrite(this.journalStatusFile, encode(this.journal));
    if (parsed.problem?.kind === 'corrupt') {
      this.blocked = { code: 'JOURNAL_CORRUPT', source: 'journal', backup, line: parsed.problem.line, message: '日志中间损坏或记录校验失败。地图可只读查看；在设置中确认保留当前地图并恢复日志。' };
      return;
    }
    await replaceJournal(this.eventsFile, raw, parsed.problem ? parsed.prefix : `${parsed.prefix}\n`);
  }
  async recordRecoveryGap() {
    if (!this.journal?.pending || this.blocked || this.error || !this.version) return;
    const event = await this.recordEvent({ operationId: `journal-recovery:${randomUUID()}`, fromVersion: this.events.at(-1)?.version || this.version, version: this.version, actor: { kind: 'system', sessionId: null }, actions: ['journal-recovery'], operations: [], nodeIds: [], fields: [], journalGap: true });
    if (event) this.emit('event', event);
    this.journal = { ...this.journal, pending: false, message: '日志已恢复，历史存在缺口；请以当前地图和可核实的字段差异为准。原日志已备份。' };
    await atomicWrite(this.journalStatusFile, encode(this.journal));
  }
  async repair({ baseVersion, acceptJournalGap = false } = {}) {
    return this.serial(async () => {
      const disk = await this.disk();
      if (disk.version !== baseVersion) throw new MapError('VERSION_CONFLICT', '恢复前请重新读取当前地图', 409);
      if (this.blocked?.source === 'journal') {
        if (!acceptJournalGap) throw new MapError('CONFIRM_JOURNAL_GAP', '请确认保留当前地图并接受无法还原的日志缺口', 409);
        const raw = await fs.readFile(this.eventsFile);
        const parsed = inspectJournal(raw);
        const backup = await backupJournal(this.runtime, raw);
        this.journal = { code: 'JOURNAL_RECOVERED', backup, pending: true, message: '人类确认保留当前地图并恢复日志' };
        await atomicWrite(this.journalStatusFile, encode(this.journal));
        await replaceJournal(this.eventsFile, raw, parsed.problem ? parsed.prefix : parsed.prefix + (parsed.needsNewline ? '\n' : ''));
        this.events = parsed.events;
        this.cursor = this.events.at(-1)?.cursor || null;
        this.blocked = null;
      }
      await this.recover();
      await this.refresh();
      this.emit('change', this.state(false));
      return this.state();
    });
  }
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
      if (previous && !this.blocked) {
        const changed = before?.root && disk.doc.root ? diffTrees(before.root, disk.doc.root) : [];
        const event = await this.recordEvent({ operationId: `external:${disk.version}`, fromVersion: previous, version: disk.version, actor: { kind: 'external', sessionId: null }, actions: ['external-file'], operations: changed, nodeIds: [...new Set(changed.map(op => op.id || op.node?.id).filter(Boolean))], fields: [...new Set(changed.flatMap(op => Object.keys(op.fields || {})))] });
        this.emit('event', event);
      }
      if (!previous && !this.blocked && this.events.length && this.events.at(-1).version !== disk.version) {
        const event = await this.recordEvent({ operationId: `offline:${randomUUID()}`, fromVersion: this.events.at(-1).version, version: disk.version, actor: { kind: 'external', sessionId: null }, actions: ['offline-file'], operations: [], nodeIds: [], fields: [], journalGap: true });
        if (event) this.emit('event', event);
      }
      await this.recordRecoveryGap();
      this.scheduleProjection(); this.emit('change', this.state(false));
    } else if (this.error) { this.error = null; await this.recordRecoveryGap(); this.emit('change', this.state(false)); }
    else await this.recordRecoveryGap();
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
    if (this.blocked?.source === 'journal') throw new MapError('RECOVERY_REQUIRED', this.blocked.message, 503);
    if (this.events.some(e => e.operationId === record.operationId && e.version === record.version)) return;
    const event = { ...record, cursor: hash(`${this.cursor || ''}:${encode(record)}`), at: new Date().toISOString() };
    let handle;
    try {
      handle = await fs.open(this.eventsFile, 'a', 0o600);
      await handle.writeFile(JSON.stringify(event) + '\n');
      await handle.sync();
    } catch (error) {
      this.blocked = { code: 'JOURNAL_WRITE_FAILED', source: 'journal', message: `日志写入未完成：${error.message}。地图保留，在设置中恢复日志后再写入。` };
      throw error;
    } finally {
      await handle?.close();
    }
    this.events.push(event); this.cursor = event.cursor;
    return event;
  }
  changes(cursor) {
    const i = cursor ? this.events.findIndex(e => e.cursor === cursor) : -1;
    const changes = this.events.slice(i >= 0 ? i + 1 : -100);
    const journalGap = changes.some(event => event.journalGap) || !!this.blocked;
    const reset = !cursor || i < 0 || journalGap;
    return { version: this.version, cursor: this.cursor, reset, changes, journalGap, recovery: this.blocked, error: this.error, ...(reset ? { readCurrent: true } : {}) };
  }
  async finish(record) {
    const event = await this.recordEvent(record.event);
    await this.fault('after-event');
    await atomicWrite(this.operationPath(record.operationId), encode(record));
    await this.fault('after-result');
    await atomicWrite(this.pendingFile, 'null\n');
    return event;
  }
  async recover() {
    try {
      await this.recoverPending();
    } catch (error) {
      this.blocked = { code: 'RECOVERY_REQUIRED', source: 'pending', message: `提交恢复失败：${error.message}。原地图与恢复记录保留，请修复后重试。` };
    }
  }
  async recoverPending() {
    if (this.blocked?.source === 'journal') return;
    let pending;
    try {
      pending = await readJSON(this.pendingFile, null);
      if (pending && (typeof pending.operationId !== 'string' || typeof pending.baseVersion !== 'string' || typeof pending.version !== 'string' || !pending.event || !pending.result)) throw new Error('提交恢复记录字段不完整');
    } catch (error) {
      this.blocked = { code: 'RECOVERY_REQUIRED', source: 'pending', message: `提交记录无法解析：${error.message}。保留 private/sync，恢复有效 pending.json 后重试。` };
      return;
    }
    this.blocked = null;
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
      const record = { operationId, digest, baseVersion, version, result, event: { operationId, fromVersion: baseVersion, version, actor, actions: operations.map(op => op.type), operations: structuredClone(operations), nodeIds: resultIds, fields: [...new Set(operations.flatMap(op => Object.keys(op.fields || {})))] } };
      await atomicWrite(this.pendingFile, encode(record));
      let replaced = false;
      try {
        await this.fault('after-pending');
        await atomicWrite(this.file, raw, { beforeReplace: async () => {
          if (hash(await fs.readFile(this.file)) !== baseVersion) throw new MapError('VERSION_CONFLICT', 'External save occurred before replacement', 409);
        } });
        replaced = true; await this.fault('after-map');
        record.persistedEvent = await this.finish(record);
      } catch (e) {
        const current = await fs.readFile(this.file).then(hash).catch(() => null);
        if (!replaced && current === baseVersion) {
          await atomicWrite(this.pendingFile, 'null\n'); throw e;
        }
        this.blocked = { ...(this.blocked?.source === 'journal' ? this.blocked : {}), code: 'RECOVERY_REQUIRED', operationId, persisted: current === version, message: e.message };
        this.setError(new MapError('RECOVERY_REQUIRED', 'Save may have committed. Query this operationId after recovery; do not retry as a new operation.'));
        throw new MapError('RECOVERY_REQUIRED', this.error.message, 503, this.blocked);
      }
      this.doc = doc; this.version = version; this.error = null;
      this.scheduleProjection(); this.emit('change', { ...this.state(false), operationId });
      this.emit('event', record.persistedEvent || record.event);
      return { ...result, cursor: this.cursor };
    });
  }
  async close() {
    clearInterval(this.poll); clearTimeout(this.watchTimer); clearTimeout(this.projectionTimer); this.watcher?.close(); await this.tail;
  }
}
