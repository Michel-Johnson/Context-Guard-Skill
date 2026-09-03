import fs from 'node:fs/promises';
import path from 'node:path';
import { MapStore } from './store.mjs';
import { atomicWrite, encode, hash, readJSON } from './io.mjs';
import { MapError, validate, same, diffTrees } from '../../prototype/map-model.mjs';

export const isolationFile = root => path.join(root, '.codex/context/private/map-scopes.json');
export const sessionContext = (root, sessionId) => {
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 200) throw new MapError('SESSION_REQUIRED', 'Use a real Session identity');
  return path.join(root, '.codex/context/private/session-maps', hash(sessionId));
};

// Three-way merge: preserve unrelated human changes; never select a winner for
// conflicting edits. ID-bearing arrays (nodes, TODOs, Bugs) merge entry by entry.
export function mergeMaps(base, main, session) {
  const conflicts = [];
  const copy = value => value === undefined ? undefined : structuredClone(value);
  function merge(a, b, c, location) {
    if (same(b, c) || same(a, c)) return copy(b);
    if (same(a, b)) return copy(c);
    if ([a, b, c].every(v => v && !Array.isArray(v) && typeof v === 'object')) {
      const result = {};
      for (const key of new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(c)])) {
        const value = merge(a[key], b[key], c[key], `${location}/${key}`);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    if ([a, b, c].every(Array.isArray) && [...a, ...b, ...c].every(v => v && typeof v.id === 'string')) {
      const indexes = [a, b, c].map(values => new Map(values.map(v => [v.id, v])));
      const result = [];
      for (const id of new Set([...b.map(v => v.id), ...c.map(v => v.id), ...a.map(v => v.id)])) {
        const value = merge(...indexes.map(index => index.get(id)), `${location}/${id}`);
        if (value !== undefined) result.push(value);
      }
      return result;
    }
    conflicts.push(location); return copy(b);
  }
  const document = merge(base, main, session, '');
  if (conflicts.length) throw new MapError('MAP_MERGE_CONFLICT', 'Review conflicting Map fields before publishing', 409, { conflicts });
  validate(document); return document;
}

export class MapScopes {
  constructor(root, main, options = {}) {
    this.root = root; this.main = main; this.options = options; this.stores = new Map(); this.tail = Promise.resolve();
  }
  serial(fn) { const job = this.tail.then(fn); this.tail = job.catch(() => {}); return job; }
  async enabled() { return (await readJSON(isolationFile(this.root), null))?.mode === 'session-maps'; }
  async enable(expectedVersion) {
    return this.serial(async () => {
      if (await this.enabled()) return { enabled: true, duplicate: true };
      return this.main.serial(async () => {
        await this.main.refresh();
        if (this.main.error || this.main.blocked) throw new MapError('RECOVERY_REQUIRED', 'Resolve existing Map recovery first', 409);
        if (expectedVersion !== this.main.version) throw new MapError('VERSION_CONFLICT', 'Read the existing Map before migration', 409);
        const file = path.join(this.main.runtime, `before-isolation-${expectedVersion}.json`);
        await atomicWrite(file, encode(this.main.doc));
        await atomicWrite(isolationFile(this.root), encode({ mode: 'session-maps', v: 1, baselineStatus: 'legacy-unverified', legacyVersion: expectedVersion, enabledAt: new Date().toISOString() }));
        return { enabled: true, baselineStatus: 'legacy-unverified', backup: file };
      });
    });
  }
  async forSession(sessionId) {
    if (!await this.enabled() || !sessionId) return this.main;
    return this.serial(async () => {
      if (this.stores.has(sessionId)) return this.stores.get(sessionId);
      const ctx = sessionContext(this.root, sessionId);
      const seedFile = path.join(ctx, 'base.json');
      let seed = await readJSON(seedFile, null);
      if (!seed) {
        await this.main.serial(() => this.main.refresh());
        if (this.main.error || this.main.blocked) throw new MapError('RECOVERY_REQUIRED', 'Main Map is unavailable', 409);
        seed = { sessionId, baseVersion: this.main.version, document: this.main.doc, createdAt: new Date().toISOString() };
        await atomicWrite(seedFile, encode(seed));
      }
      if (seed.sessionId !== sessionId) throw new MapError('SESSION_MISMATCH', 'Session binding mismatch', 409);
      const file = path.join(ctx, 'map.json');
      if (!await readJSON(file, null)) await atomicWrite(file, encode(seed.document));
      const store = await new MapStore(this.root, { ...this.options, contextDir: ctx }).init();
      store.scope = sessionId; this.stores.set(sessionId, store);
      return store;
    });
  }
  async close() { await this.tail; await Promise.all([...this.stores.values()].map(store => store.close())); }

  async publish(input, verifyCommit) {
    const session = await this.forSession(input.sessionId);
    if (session === this.main) throw new MapError('ISOLATION_REQUIRED', 'Enable Session Maps before publication', 409);
    return this.serial(async () => {
      if (!/^[\w:.-]{8,120}$/.test(input.operationId || '')) throw new MapError('INVALID_OPERATION_ID', 'Provide a stable publication ID');
      const receiptFile = path.join(this.main.runtime, 'publications', hash(input.operationId) + '.json');
      const digest = hash(encode(input));
      let record = await readJSON(receiptFile, null);
      if (record && record.digest !== digest) throw new MapError('ID_REUSED', 'Publication ID belongs to another request', 409);
      if (record?.result) return { ...record.result, duplicate: true };
      if (!record) {
        if (typeof verifyCommit !== 'function') throw new MapError('MAIN_VERIFICATION_REQUIRED', 'Configure the authoritative Git repository before publication', 409);
        const source = await verifyCommit(input.commit);
        await session.serial(() => session.refresh()); await this.main.serial(() => this.main.refresh());
        if (session.error || session.blocked || this.main.error || this.main.blocked) throw new MapError('RECOVERY_REQUIRED', 'Resolve Map recovery before publication', 409);
        if (input.baseVersion !== this.main.version || input.sessionVersion !== session.version) throw new MapError('VERSION_CONFLICT', 'Review current Main and Session versions', 409);
        const seed = await readJSON(path.join(session.ctx, 'base.json'), null);
        const next = mergeMaps(seed.document, this.main.doc, session.doc);
        const operations = diffTrees(this.main.doc.root, next.root);
        if (!same(this.main.doc.flows, next.flows)) operations.push({ type: 'document', fields: { flows: next.flows || [] } });
        record = { digest, source, request: { operationId: 'publish:' + input.operationId, baseVersion: input.baseVersion, operations } };
        await atomicWrite(receiptFile, encode(record));
      }
      const result = record.request.operations.length
        ? await this.main.commit(record.request, { kind: 'human', sessionId: 'main-publication' })
        : { committed: false, unchanged: true, operationId: record.request.operationId, version: this.main.version, resultIds: [] };
      const metadata = await readJSON(isolationFile(this.root), {});
      await atomicWrite(isolationFile(this.root), encode({ ...metadata, baselineStatus: 'published', source: record.source, publishedVersion: result.version }));
      record.result = { ...result, source: record.source };
      await atomicWrite(receiptFile, encode(record));
      return record.result;
    });
  }
}
