import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { MapStore } from '../workbench/store.mjs';
import { MapScopes, isolationFile, mergeMaps } from '../workbench/scopes.mjs';
import { atomicWrite, encode, hash, readJSON } from '../workbench/io.mjs';
import { MapError, diffTrees, same } from '../../prototype/map-model.mjs';

export class CloudSessionMaps {
  constructor(dataDir) { this.dataDir = dataDir; this.projects = new Map(); this.tails = new Map(); }
  serial(id, task) { const next = (this.tails.get(id) || Promise.resolve()).then(task); this.tails.set(id, next.catch(() => {})); return next; }
  root(id) { return path.join(this.dataDir, 'session-projects', hash(id)); }
  async enabled(id) { return (await readJSON(isolationFile(this.root(id)), null))?.mode === 'session-maps'; }
  async open(id) {
    if (!await this.enabled(id)) throw new MapError('ISOLATION_REQUIRED', 'Enable Session Maps for this project first', 409);
    if (!this.projects.has(id)) this.projects.set(id, (async () => {
      const root = this.root(id), main = await new MapStore(root).init();
      return new MapScopes(root, main);
    })().catch(error => { this.projects.delete(id); throw error; }));
    return this.projects.get(id);
  }
  async enable(id, document) {
    if (await this.enabled(id)) return { enabled: true, duplicate: true };
    if (!document?.root) throw new MapError('MAIN_REQUIRED', 'Initialize a project Map before migration', 409);
    const root = this.root(id);
    await atomicWrite(path.join(root, '.codex/context/map.json'), encode(document));
    const main = await new MapStore(root).init(), scopes = new MapScopes(root, main);
    try { return await scopes.enable(main.version); }
    finally { await main.close(); }
  }
  async store(id, sessionId) { return (await this.open(id)).forSession(sessionId); }
  async state(id, sessionId) {
    const scopes = await this.open(id), store = await scopes.forSession(sessionId);
    await store.serial(() => store.refresh()); await scopes.main.serial(() => scopes.main.refresh());
    const metadata = await readJSON(isolationFile(scopes.root), {});
    const baselineStatus = metadata.baselineStatus === 'published' && metadata.publishedVersion !== scopes.main.version ? 'main-updated' : metadata.baselineStatus;
    return { ...store.state(), isolated: true, scope: sessionId || null, mainVersion: scopes.main.version, baselineStatus, source: metadata.source || null };
  }
  async session(id, input) {
    const scopes = await this.open(id), store = await scopes.forSession(input.sessionId);
    if (store === scopes.main) throw new MapError('SESSION_REQUIRED', 'Supply the target Session');
    return this.serial(id, async () => {
      const file = path.join(store.ctx, 'session.json'), previous = await readJSON(file, {});
      const sessionToken = previous.tokenHash ? null : randomBytes(32).toString('base64url');
      // Only view metadata and grants; never upload raw machine runtime or credentials.
      const nodes = Array.isArray(input.nodes)
        ? input.nodes.filter(v => typeof v === 'string')
        : Array.isArray(input.addNodes)
          ? [...new Set([...(previous.nodes || []), ...input.addNodes.filter(v => typeof v === 'string')])]
          : previous.nodes || [];
      const record = { id: input.sessionId, name: String(input.name || previous.name || '').slice(0, 200), platform: String(input.platform || previous.platform || 'unknown').slice(0, 30), status: ['active', 'completed', 'waiting'].includes(input.status) ? input.status : previous.status || 'waiting', nodes, lastSeen: new Date().toISOString(), tokenHash: previous.tokenHash || hash(sessionToken) };
      await atomicWrite(file, encode(record));
      const { tokenHash: _tokenHash, ...visible } = record;
      return { ...visible, ...(sessionToken ? { sessionToken } : {}) };
    });
  }
  async authorize(id, sessionId, credential) {
    if (!sessionId || !credential) return false;
    const store = await this.store(id, sessionId);
    const record = await readJSON(path.join(store.ctx, 'session.json'), null);
    const expected = Buffer.from(String(record?.tokenHash || '')), actual = Buffer.from(hash(credential));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  async sessions(id) {
    const dir = path.join(this.root(id), '.codex/context/private/session-maps');
    const names = await fs.readdir(dir).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
    const records = await Promise.all(names.map(name => readJSON(path.join(dir, name, 'session.json'), null)));
    const sessions = records.filter(Boolean).map(({ tokenHash: _tokenHash, ...record }) => record);
    return { sessions, grants: Object.fromEntries(sessions.map(s => [s.id, { nodes: s.nodes }])), currentSessionId: null };
  }
  async refreshMain(id, sessionId, expectedVersion) {
    const scopes = await this.open(id), store = await scopes.forSession(sessionId);
    await scopes.serial(async () => {
      if (store === scopes.main) throw new MapError('SESSION_REQUIRED', 'Choose a Session to refresh');
      const baseFile = path.join(store.ctx, 'base.json');
      const seed = await readJSON(baseFile, null);
      await scopes.main.serial(() => scopes.main.refresh()); await store.serial(() => store.refresh());
      if (store.version !== expectedVersion) throw new MapError('VERSION_CONFLICT', 'Session Map changed', 409);
      const mainVersion = scopes.main.version, mainDocument = structuredClone(scopes.main.doc);
      const merged = mergeMaps(seed.document, mainDocument, store.doc);
      const operations = diffTrees(store.doc.root, merged.root);
      if (!same(store.doc.flows, merged.flows)) operations.push({ type: 'document', fields: { flows: merged.flows || [] } });
      if (operations.length) await store.commit({ operationId: `refresh:${hash(expectedVersion + mainVersion)}`, baseVersion: expectedVersion, operations }, { kind: 'human', sessionId: 'main-refresh' });
      await atomicWrite(baseFile, encode({ ...seed, baseVersion: mainVersion, document: mainDocument }));
    });
    return this.state(id, sessionId);
  }
  async close() { for (const promise of this.projects.values()) { const scopes = await promise; await scopes.close(); await scopes.main.close(); } }
}
