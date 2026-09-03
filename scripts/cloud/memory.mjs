// Private memory API. It can run alone or be mounted by the Cloud service.
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomicWrite, encode, hash, readJSON, withFileLock } from '../workbench/io.mjs';
import { applyOperations, MapError, validate } from '../../prototype/map-model.mjs';
import { validateMemory } from '../workbench/memory-schema.mjs';
const exec = promisify(execFile);
const equal = (a, b) => { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x, y); };
const validSessionId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\/\u0000-\u001f\u007f]/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
function validateOptions({ dataDir, adminToken }) {
  if (!dataDir || !adminToken) throw new Error('Explicit private data directory and admin token required');
  if (!path.isAbsolute(dataDir)) throw new Error('Private data directory must be absolute and outside source control');
}

const initialMemoryState = () => ({ revision: 0, main: null, preferences: null, sessions: {}, receipts: {} });
const memoryFile = (dataDir, projectId) => path.join(dataDir, hash(projectId), 'memory.json');

export async function readMemoryProject({ dataDir, adminToken, projects = {} }, projectId) {
  validateOptions({ dataDir, adminToken });
  if (!projects[projectId]) throw new MapError('NOT_FOUND', 'Memory project is not configured', 404);
  return readJSON(memoryFile(dataDir, projectId), initialMemoryState());
}

export async function commitSessionMap(configuration, projectId, sessionId, input, actor = { kind: 'human', sessionId: 'cloud-workbench' }) {
  if (!validSessionId(sessionId)) throw new MapError('INVALID_SESSION', 'Invalid Session', 400);
  const file = memoryFile(configuration.dataDir, projectId);
  return withFileLock(file + '.lock', async () => {
    const state = await readMemoryProject(configuration, projectId);
    const current = state.sessions[sessionId];
    if (!current) throw new MapError('NOT_FOUND', 'Session memory is not available', 404);
    if ((input.baseVersion ?? null) !== current.version) throw new MapError('VERSION_CONFLICT', 'Session Map changed; reload before committing', 409, { currentVersion: current.version });
    if (typeof input.operationId !== 'string' || !input.operationId || input.operationId.length > 200) throw new MapError('INVALID_OPERATION', 'Stable operationId required');
    const receiptKey = hash(`workbench:${sessionId}:${input.operationId}`);
    const fingerprint = hash(encode({ baseVersion: input.baseVersion ?? null, operations: input.operations, actor }));
    if (state.receipts[receiptKey]) {
      if (state.receipts[receiptKey].fingerprint !== fingerprint) throw new MapError('ID_REUSED', 'Operation ID reused for different content', 409);
      return state.receipts[receiptKey].result;
    }
    const applied = applyOperations(current.memory.map, input.operations, actor);
    validate(applied.doc);
    const updatedAt = new Date().toISOString();
    const snapshot = { ...current, version: hash(encode({ previous: current.version, operationId: input.operationId, map: applied.doc, updatedAt })), memory: { ...current.memory, map: applied.doc }, updatedAt };
    state.sessions[sessionId] = snapshot;
    state.revision++;
    const result = { committed: true, projectId, sessionId, version: snapshot.version, revision: state.revision, nodeIds: applied.resultIds, persistedAt: updatedAt };
    state.receipts[receiptKey] = { fingerprint, result };
    await atomicWrite(file, encode(state));
    return result;
  });
}

export function createMemoryHandler({ dataDir, adminToken, projects = {} } = {}) {
  validateOptions({ dataDir, adminToken });
  const git = async (root, args) => (await exec('git', args, { cwd: root, windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 })).stdout.trim();
  return async (req, res) => {
    const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); return true; };
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname.match(/^\/v1\/projects\/([a-z0-9-]+)\/(main|preferences|sessions\/([^/]+)|publish)$/);
    if (!route) return false;
    try {
      const [, projectId, scope, rawSession] = route;
      const sessionId = rawSession ? decodeURIComponent(rawSession) : '';
      if (rawSession && !validSessionId(sessionId)) {
        throw new MapError('INVALID_SESSION', 'Invalid Session', 400);
      }
      const project = projects[projectId];
      const credential = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const admin = equal(credential, adminToken);
      if (!project || (!admin && (!project.token || !equal(credential, project.token)))) throw new MapError('UNAUTHORIZED', 'Project-scoped authorization required', 401);
      const file = memoryFile(dataDir, projectId);
      const initial = initialMemoryState();
      if (req.method === 'GET') {
        const state = await readJSON(file, initial);
        if (scope === 'main') return send(200, { projectId, snapshot: state.main });
        if (scope === 'preferences') return send(200, { projectId, preferences: state.preferences });
        if (rawSession) return send(200, { projectId, snapshot: state.sessions[sessionId] || null });
        throw new MapError('METHOD', 'Unsupported method', 405);
      }
      if (req.method !== 'POST') throw new MapError('METHOD', 'POST required', 405);
      if (!String(req.headers['content-type']).startsWith('application/json')) throw new MapError('CONTENT_TYPE', 'JSON required', 415);
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new MapError('BODY_TOO_LARGE', 'Memory batch exceeds 16 MiB', 413); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks));
      if (typeof input.operationId !== 'string' || !input.operationId || input.operationId.length > 200) throw new MapError('INVALID_OPERATION', 'Stable operationId required');
      const result = await withFileLock(file + '.lock', async () => {
        const state = await readJSON(file, initial), key = hash(scope + ':' + input.operationId), fingerprint = hash(encode(input));
        if (scope === 'publish' && !admin) throw new MapError('FORBIDDEN', 'Main publication requires publisher/admin authorization', 403);
        if (state.receipts[key]) {
          if (state.receipts[key].fingerprint !== fingerprint) throw new MapError('ID_REUSED', 'Operation ID reused for different content', 409);
          return state.receipts[key].result;
        }
        let snapshot;
        if (scope === 'preferences') {
          if (!['zh', 'en'].includes(input.language)) throw new MapError('INVALID_LANGUAGE', 'Use zh or en');
          if ((state.preferences?.version || null) !== input.baseVersion) throw new MapError('VERSION_CONFLICT', 'Preferences changed', 409);
          snapshot = { language: input.language, version: hash(encode(input)) }; state.preferences = snapshot;
        } else if (rawSession) {
          const id = sessionId;
          if ((state.sessions[id]?.version || null) !== input.baseVersion) throw new MapError('VERSION_CONFLICT', 'Session memory changed', 409);
          validateMemory(input.memory);
          if (!/^[a-f0-9]{40,64}$/.test(input.sourceCommit || '')) throw new MapError('INVALID_COMMIT', 'Source commit required');
          snapshot = { sessionId: id, version: hash(encode(input)), sourceCommit: input.sourceCommit, baseMainVersion: input.baseMainVersion ?? null, memory: input.memory, updatedAt: new Date().toISOString() };
          state.sessions[id] = snapshot;
        } else if (scope === 'publish') {
          if (!validSessionId(input.sessionId) || typeof input.sessionVersion !== 'string' || !/^[a-f0-9]{40,64}$/.test(input.expectedMainSha || '')) throw new MapError('INVALID_PUBLICATION', 'Valid Session version and expected main commit are required', 400);
          if (!project.root || !project.ref) throw new MapError('MAIN_BINDING_REQUIRED', 'Configure the server repository mirror and authoritative ref', 409);
          const session = state.sessions[input.sessionId];
          if (!session || session.version !== input.sessionVersion) throw new MapError('VERSION_CONFLICT', 'Session version changed', 409);
          if ((state.main?.version || null) !== input.baseVersion || session.baseMainVersion !== input.baseVersion) throw new MapError('VERSION_CONFLICT', 'Reconcile Session against the published main baseline first', 409);
          if (project.remote) await git(project.root, ['fetch', '--quiet', project.remote]);
          const mainSha = await git(project.root, ['rev-parse', '--verify', `${project.ref}^{commit}`]);
          if (mainSha !== input.expectedMainSha) throw new MapError('MAIN_ADVANCED', 'Main changed; review the new commit before publication', 409);
          try { await git(project.root, ['merge-base', '--is-ancestor', session.sourceCommit, mainSha]); }
          catch { throw new MapError('NOT_MERGED', 'Session source has not been merged into the authoritative branch', 409); }
          snapshot = {
            ...session,
            version: hash(encode(input)),
            memory: { map: session.memory.map, records: { ...(state.main?.memory?.records || {}), ...session.memory.records } },
            mainSha,
            ref: project.ref,
            repository: project.repository || projectId,
            publishedAt: new Date().toISOString(),
          };
          state.main = snapshot;
        } else throw new MapError('READ_ONLY_MAIN', 'Publish a verified Session; main cannot be written directly', 403);
        state.revision++;
        const result = { committed: true, projectId, snapshot, revision: state.revision };
        state.receipts[key] = { fingerprint, result };
        // Snapshot and receipt share one durable replace: a retry after a crash cannot duplicate the write.
        await atomicWrite(file, encode(state));
        return result;
      });
      send(200, result);
    } catch (error) { send(error.status || 500, { error: { code: error.code || 'MEMORY_ERROR', message: error instanceof MapError ? error.message : 'Memory request failed; data preserved' } }); }
    return true;
  };
}

export async function startMemoryServer({ dataDir, adminToken, projects = {}, host = '127.0.0.1', port = 0 } = {}) {
  validateOptions({ dataDir, adminToken });
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Private memory service must listen on loopback behind an authenticated TLS endpoint');
  const handler = createMemoryHandler({ dataDir, adminToken, projects });
  const server = http.createServer(async (req, res) => {
    if (!await handler(req, res)) {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Unknown memory endpoint' } }));
    }
  });
  server.requestTimeout = 20000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, url: `http://${host}:${server.address().port}`, close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections?.(); }) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = await readJSON(process.env.CONTEXT_GUARD_MEMORY_CONFIG);
  const running = await startMemoryServer(config);
  console.log(`Private memory service listening on ${running.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await running.close(); process.exit(0); });
}
