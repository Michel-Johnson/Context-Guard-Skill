// Private memory API. It can run alone or be mounted by the Cloud service.
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
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

const initialMemoryState = () => ({ revision: 0, main: null, preferences: null, sessions: {}, closedSessions: {}, receipts: {}, history: [], events: [], eventCursors: {} });
const memoryFile = (dataDir, projectId) => path.join(dataDir, hash(projectId), 'memory.json');
const memoryHubs = new WeakMap();
function memoryHub(configuration) {
  let hub = memoryHubs.get(configuration);
  if (!hub) { hub = new EventEmitter(); hub.setMaxListeners(0); memoryHubs.set(configuration, hub); }
  return hub;
}

function appendMemoryEvent(state, { projectId, scope, type, operationId, baseVersion = null, version = null, operations = null, actor, at }) {
  state.events ||= [];
  state.eventCursors ||= {};
  const previousCursor = state.eventCursors[scope] || state.events.reduce((maximum, event) => (
    event.scope === scope ? Math.max(maximum, event.cursor ?? 0) : maximum
  ), 0);
  const cursor = previousCursor + 1;
  state.eventCursors[scope] = cursor;
  const event = {
    seq: state.revision,
    cursor,
    projectId,
    eventId: hash(encode({ revision: state.revision, scope, type, operationId, version, at })),
    scope,
    type,
    operationId,
    baseVersion,
    version,
    ...(operations ? { operations: structuredClone(operations) } : {}),
    actor,
    at,
  };
  state.events.push(event);
  return event;
}

function appendHistory(state, { scope, action, snapshot, previousVersion = null, actor = { kind: 'agent' }, at = new Date().toISOString() }) {
  state.history ||= [];
  const entry = {
    id: hash(encode({ revision: state.revision, scope, action, version: snapshot?.version || null, at })),
    revision: state.revision,
    scope,
    action,
    version: snapshot?.version || null,
    previousVersion,
    at,
    actor,
    snapshot: structuredClone(snapshot),
  };
  state.history.push(entry);
  return entry;
}

function scopeValue(state, scope) {
  if (scope === 'main') return state.main;
  if (scope === 'preferences') return state.preferences;
  if (scope.startsWith('session:')) return state.sessions[scope.slice('session:'.length)] || null;
  throw new MapError('INVALID_SCOPE', 'Use main, preferences, or session:<id>', 400);
}

function setScopeValue(state, scope, snapshot) {
  if (scope === 'main') state.main = snapshot;
  else if (scope === 'preferences') state.preferences = snapshot;
  else if (scope.startsWith('session:')) state.sessions[scope.slice('session:'.length)] = snapshot;
  else throw new MapError('INVALID_SCOPE', 'Use main, preferences, or session:<id>', 400);
}

export async function readMemoryProject({ dataDir, adminToken, projects = {} }, projectId) {
  validateOptions({ dataDir, adminToken });
  if (!projects[projectId]) throw new MapError('NOT_FOUND', 'Memory project is not configured', 404);
  return readJSON(memoryFile(dataDir, projectId), initialMemoryState());
}

const gitCommand = async (root, args) => (await exec('git', args, { cwd: root, windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 })).stdout.trim();
async function mergedIntoMain(project, sourceCommit, targetCommit) {
  try { await gitCommand(project.root, ['merge-base', '--is-ancestor', sourceCommit, targetCommit]); return true; }
  catch (error) { if (error?.code === 1) return false; throw error; }
}

export async function memoryPublicationStatus(configuration, projectId, sessionId, { refresh = false } = {}) {
  validateOptions(configuration);
  if (!validSessionId(sessionId)) throw new MapError('INVALID_SESSION', 'Invalid Session', 400);
  const project = configuration.projects?.[projectId];
  if (!project) throw new MapError('NOT_FOUND', 'Memory project is not configured', 404);
  const state = await readMemoryProject(configuration, projectId);
  const closed = state.closedSessions?.[sessionId];
  if (closed) return { projectId, sessionId, status: 'published', ...closed };
  const session = state.sessions?.[sessionId];
  if (!session) return { projectId, sessionId, status: 'missing' };
  if (!project.root || !project.ref) return { projectId, sessionId, status: 'unavailable', reason: 'MAIN_BINDING_REQUIRED', sessionVersion: session.version };
  if (refresh && project.remote) await gitCommand(project.root, ['fetch', '--quiet', project.remote]);
  const mainSha = await gitCommand(project.root, ['rev-parse', '--verify', `${project.ref}^{commit}`]);
  const baseVersion = state.main?.version || null;
  const common = { projectId, sessionId, sessionVersion: session.version, baseVersion, baseMainVersion: session.baseMainVersion ?? null, sourceCommit: session.sourceCommit, mainSha };
  if (session.baseMainVersion !== baseVersion) return { ...common, status: 'conflict', reason: 'MAIN_MEMORY_ADVANCED' };
  return { ...common, status: await mergedIntoMain(project, session.sourceCommit, mainSha) ? 'ready' : 'waiting', reason: null };
}

export async function publishSessionMemory(configuration, projectId, input, actor = { kind: 'agent', sessionId: input?.sessionId || '' }) {
  validateOptions(configuration);
  const project = configuration.projects?.[projectId];
  if (!project) throw new MapError('NOT_FOUND', 'Memory project is not configured', 404);
  if (typeof input?.operationId !== 'string' || !input.operationId || input.operationId.length > 200) throw new MapError('INVALID_OPERATION', 'Stable operationId required');
  const file = memoryFile(configuration.dataDir, projectId);
  const committed = await withFileLock(file + '.lock', async () => {
    const state = await readJSON(file, initialMemoryState());
    state.closedSessions ||= {};
    const key = hash(`publish:${input.operationId}`), fingerprint = hash(encode(input));
    if (state.receipts[key]) {
      if (state.receipts[key].fingerprint !== fingerprint) throw new MapError('ID_REUSED', 'Operation ID reused for different content', 409);
      return { result: state.receipts[key].result, event: null };
    }
    if (!validSessionId(input.sessionId) || typeof input.sessionVersion !== 'string' || !/^[a-f0-9]{40,64}$/.test(input.expectedMainSha || '')) throw new MapError('INVALID_PUBLICATION', 'Valid Session version and expected main commit are required', 400);
    if (!project.root || !project.ref) throw new MapError('MAIN_BINDING_REQUIRED', 'Configure the server repository mirror and authoritative ref', 409);
    const session = state.sessions[input.sessionId];
    if (!session || session.version !== input.sessionVersion) throw new MapError('VERSION_CONFLICT', 'Session version changed', 409);
    if ((state.main?.version || null) !== input.baseVersion || session.baseMainVersion !== input.baseVersion) throw new MapError('VERSION_CONFLICT', 'Reconcile Session against the published main baseline first', 409);
    if (project.remote) await gitCommand(project.root, ['fetch', '--quiet', project.remote]);
    const mainSha = await gitCommand(project.root, ['rev-parse', '--verify', `${project.ref}^{commit}`]);
    if (mainSha !== input.expectedMainSha) throw new MapError('MAIN_ADVANCED', 'Main changed; review the new commit before publication', 409);
    if (!await mergedIntoMain(project, session.sourceCommit, mainSha)) throw new MapError('NOT_MERGED', 'Session source has not been merged into the authoritative branch', 409);
    const previousVersion = state.main?.version || null;
    const publishedAt = new Date().toISOString();
    const snapshot = {
      ...session,
      version: hash(encode(input)),
      memory: { map: session.memory.map, records: { ...(state.main?.memory?.records || {}), ...session.memory.records } },
      mainSha,
      ref: project.ref,
      repository: project.repository || projectId,
      publishedAt,
    };
    state.main = snapshot;
    state.closedSessions[input.sessionId] = { sessionId: input.sessionId, sessionVersion: session.version, sourceCommit: session.sourceCommit, mainSha, mainVersion: snapshot.version, publishedAt };
    delete state.sessions[input.sessionId];
    state.revision++;
    const history = appendHistory(state, { scope: 'main', action: 'publish', snapshot, previousVersion, actor, at: publishedAt });
    const result = { committed: true, projectId, snapshot, revision: state.revision, history, closedSession: state.closedSessions[input.sessionId] };
    state.receipts[key] = { fingerprint, result };
    const event = appendMemoryEvent(state, { projectId, scope: 'main', type: 'main.published', operationId: input.operationId, baseVersion: previousVersion, version: snapshot.version, actor, at: publishedAt });
    await atomicWrite(file, encode(state));
    return { result, event };
  });
  if (committed.event) memoryHub(configuration).emit('event', committed.event);
  return committed.result;
}

export async function commitSessionMap(configuration, projectId, sessionId, input, actor = { kind: 'human', sessionId: 'cloud-workbench' }) {
  if (!validSessionId(sessionId)) throw new MapError('INVALID_SESSION', 'Invalid Session', 400);
  const file = memoryFile(configuration.dataDir, projectId);
  const committed = await withFileLock(file + '.lock', async () => {
    const state = await readMemoryProject(configuration, projectId);
    state.closedSessions ||= {};
    if (state.closedSessions[sessionId]) throw new MapError('SESSION_CLOSED', 'This Session Map was published and closed; start a new Session from the latest main baseline', 410);
    const current = state.sessions[sessionId];
    if (!current) throw new MapError('NOT_FOUND', 'Session memory is not available', 404);
    if (typeof input.operationId !== 'string' || !input.operationId || input.operationId.length > 200) throw new MapError('INVALID_OPERATION', 'Stable operationId required');
    const receiptKey = hash(`workbench:${sessionId}:${input.operationId}`);
    const fingerprint = hash(encode({ baseVersion: input.baseVersion ?? null, operations: input.operations, actor }));
    if (state.receipts[receiptKey]) {
      if (state.receipts[receiptKey].fingerprint !== fingerprint) throw new MapError('ID_REUSED', 'Operation ID reused for different content', 409);
      return { result: state.receipts[receiptKey].result, event: null };
    }
    if ((input.baseVersion ?? null) !== current.version) throw new MapError('VERSION_CONFLICT', 'Session Map changed; reload before committing', 409, { currentVersion: current.version });
    // The project credential already authorizes this private Session scope. Keep
    // the real actor in history, but do not reapply local node grants on Cloud.
    const applied = applyOperations(current.memory.map, input.operations, actor.kind === 'agent' ? { kind: 'human', sessionId: actor.sessionId } : actor);
    validate(applied.doc);
    const updatedAt = new Date().toISOString();
    const snapshot = { ...current, version: hash(encode({ previous: current.version, operationId: input.operationId, map: applied.doc, updatedAt })), memory: { ...current.memory, map: applied.doc }, updatedAt };
    state.sessions[sessionId] = snapshot;
    state.revision++;
    appendHistory(state, { scope: `session:${sessionId}`, action: 'workbench.commit', snapshot, previousVersion: current.version, actor, at: updatedAt });
    const result = { committed: true, projectId, sessionId, version: snapshot.version, revision: state.revision, nodeIds: applied.resultIds, persistedAt: updatedAt };
    state.receipts[receiptKey] = { fingerprint, result };
    const event = appendMemoryEvent(state, { projectId, scope: `session:${sessionId}`, type: 'session.map.committed', operationId: input.operationId, baseVersion: current.version, version: snapshot.version, operations: input.operations, actor, at: updatedAt });
    result.cursor = event.cursor;
    await atomicWrite(file, encode(state));
    return { result, event };
  });
  if (committed.event) memoryHub(configuration).emit('event', committed.event);
  return committed.result;
}

export function createMemoryHandler(configuration = {}) {
  const { dataDir, adminToken, projects = {} } = configuration;
  validateOptions({ dataDir, adminToken });
  const hub = memoryHub(configuration);
  const eventClients = new Set();
  const handler = async (req, res) => {
    const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); return true; };
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname.match(/^\/v1\/projects\/([a-z0-9-]+)\/(main|preferences|sessions\/([^/]+)(?:\/(map|changes|events))?|publish|history|restore)$/);
    if (!route) return false;
    try {
      const [, projectId, scope, rawSession, sessionAction] = route;
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
        if (rawSession && sessionAction === 'changes') {
          const after = Math.max(0, Number(url.searchParams.get('after') || 0));
          const scopeName = `session:${sessionId}`;
          const events = (state.events || []).filter(event => event.scope === scopeName && (event.cursor ?? event.seq) > after);
          return send(200, { projectId, sessionId, after, cursor: events.at(-1)?.cursor || after, highWater: state.eventCursors?.[scopeName] || 0, events });
        }
        if (rawSession && sessionAction === 'events') {
          const after = Math.max(0, Number(url.searchParams.get('after') || req.headers['last-event-id'] || 0));
          const scopeName = `session:${sessionId}`;
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          let delivered = after;
          const writeEvent = event => {
            const cursor = event.cursor ?? event.seq;
            if (event.scope !== scopeName || cursor <= delivered || res.destroyed) return;
            delivered = cursor;
            res.write(`id: ${cursor}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`);
          };
          hub.on('event', writeEvent);
          eventClients.add(res);
          // Subscribe before rereading the durable log. A concurrent commit is
          // either delivered live or replayed here; the cursor removes duplicates.
          const freshState = await readJSON(file, initial);
          for (const event of (freshState.events || [])) writeEvent(event);
          res.write(`retry: 1000\nevent: ready\ndata: ${JSON.stringify({ projectId, sessionId, cursor: delivered, highWater: freshState.eventCursors?.[scopeName] || 0 })}\n\n`);
          const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 15000);
          heartbeat.unref();
          req.on('close', () => { clearInterval(heartbeat); hub.off('event', writeEvent); eventClients.delete(res); });
          return true;
        }
        if (scope === 'history') {
          const historyScope = String(url.searchParams.get('scope') || 'main');
          scopeValue(state, historyScope);
          const after = Math.max(0, Number(url.searchParams.get('after') || 0));
          const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100)));
          const history = (state.history || []).filter(entry => entry.scope === historyScope && entry.revision > after).slice(-limit);
          return send(200, { projectId, scope: historyScope, revision: state.revision, history });
        }
        if (scope === 'main') return send(200, { projectId, snapshot: state.main });
        if (scope === 'preferences') return send(200, { projectId, preferences: state.preferences });
        if (rawSession && !sessionAction) return send(200, { projectId, snapshot: state.sessions[sessionId] || null, revision: state.revision });
        throw new MapError('METHOD', 'Unsupported method', 405);
      }
      if (req.method !== 'POST') throw new MapError('METHOD', 'POST required', 405);
      if (!String(req.headers['content-type']).startsWith('application/json')) throw new MapError('CONTENT_TYPE', 'JSON required', 415);
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new MapError('BODY_TOO_LARGE', 'Memory batch exceeds 16 MiB', 413); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks));
      if (typeof input.operationId !== 'string' || !input.operationId || input.operationId.length > 200) throw new MapError('INVALID_OPERATION', 'Stable operationId required');
      if (rawSession && sessionAction === 'map') {
        const result = await commitSessionMap(configuration, projectId, sessionId, input, { kind: admin ? 'admin' : 'agent', sessionId });
        return send(200, result);
      }
      if (sessionAction) throw new MapError('METHOD', 'GET required', 405);
      if (scope === 'publish') {
        const result = await publishSessionMemory(configuration, projectId, input, { kind: admin ? 'admin' : 'agent', sessionId: input.sessionId || '' });
        return send(200, result);
      }
      const committed = await withFileLock(file + '.lock', async () => {
        const state = await readJSON(file, initial), key = hash(scope + ':' + input.operationId), fingerprint = hash(encode(input));
        state.closedSessions ||= {};
        if (scope === 'restore' && ['main', 'preferences'].includes(input.scope) && !admin) throw new MapError('FORBIDDEN', 'Main and preference restoration require publisher/admin authorization', 403);
        if (state.receipts[key]) {
          if (state.receipts[key].fingerprint !== fingerprint) throw new MapError('ID_REUSED', 'Operation ID reused for different content', 409);
          return { result: state.receipts[key].result, event: null };
        }
        let snapshot;
        let historyScope = scope;
        let historyAction = 'write';
        let previousVersion = null;
        if (scope === 'preferences') {
          if (!['zh', 'en'].includes(input.language)) throw new MapError('INVALID_LANGUAGE', 'Use zh or en');
          if ((state.preferences?.version || null) !== input.baseVersion) throw new MapError('VERSION_CONFLICT', 'Preferences changed', 409);
          previousVersion = state.preferences?.version || null;
          snapshot = { language: input.language, version: hash(encode(input)) }; state.preferences = snapshot;
        } else if (rawSession) {
          const id = sessionId;
          if (state.closedSessions[id]) throw new MapError('SESSION_CLOSED', 'This Session Map was published and closed; start a new Session from the latest main baseline', 410);
          if ((state.sessions[id]?.version || null) !== input.baseVersion) throw new MapError('VERSION_CONFLICT', 'Session memory changed', 409);
          previousVersion = state.sessions[id]?.version || null;
          validateMemory(input.memory);
          if (!/^[a-f0-9]{40,64}$/.test(input.sourceCommit || '')) throw new MapError('INVALID_COMMIT', 'Source commit required');
          snapshot = { sessionId: id, version: hash(encode(input)), sourceCommit: input.sourceCommit, baseMainVersion: input.baseMainVersion ?? null, memory: input.memory, updatedAt: new Date().toISOString() };
          state.sessions[id] = snapshot;
          historyScope = `session:${id}`;
        } else if (scope === 'restore') {
          historyScope = String(input.scope || '');
          const current = scopeValue(state, historyScope);
          if (!current) throw new MapError('NOT_FOUND', 'Current memory scope is empty', 404);
          if (current.version !== input.baseVersion) throw new MapError('VERSION_CONFLICT', 'Memory changed; reload history before restoring', 409);
          const target = (state.history || []).find(entry => entry.scope === historyScope && entry.version === input.targetVersion);
          if (!target?.snapshot) throw new MapError('HISTORY_NOT_FOUND', 'Requested memory version is not available', 404);
          previousVersion = current.version;
          const restoredAt = new Date().toISOString();
          snapshot = {
            ...structuredClone(target.snapshot),
            version: hash(encode({ operationId: input.operationId, scope: historyScope, previousVersion, targetVersion: target.version, restoredAt })),
            updatedAt: restoredAt,
            restoredFrom: target.version,
          };
          setScopeValue(state, historyScope, snapshot);
          historyAction = 'restore';
        } else throw new MapError('READ_ONLY_MAIN', 'Publish a verified Session; main cannot be written directly', 403);
        state.revision++;
        const history = appendHistory(state, { scope: historyScope, action: historyAction, snapshot, previousVersion, actor: { kind: admin ? 'admin' : 'agent' }, at: snapshot.updatedAt || snapshot.publishedAt || new Date().toISOString() });
        const result = { committed: true, projectId, snapshot, revision: state.revision, history };
        state.receipts[key] = { fingerprint, result };
        const event = historyScope.startsWith('session:') ? appendMemoryEvent(state, {
          projectId,
          scope: historyScope,
          type: historyAction === 'restore' ? 'session.restored' : 'session.snapshot',
          operationId: input.operationId,
          baseVersion: previousVersion,
          version: snapshot.version,
          actor: { kind: admin ? 'admin' : 'agent' },
          at: snapshot.updatedAt || new Date().toISOString(),
        }) : null;
        // Snapshot and receipt share one durable replace: a retry after a crash cannot duplicate the write.
        await atomicWrite(file, encode(state));
        return { result, event };
      });
      if (committed.event) hub.emit('event', committed.event);
      send(200, committed.result);
    } catch (error) { send(error.status || 500, { error: { code: error.code || 'MEMORY_ERROR', message: error instanceof MapError ? error.message : 'Memory request failed; data preserved' } }); }
    return true;
  };
  handler.onEvent = listener => { hub.on('event', listener); return () => hub.off('event', listener); };
  handler.close = () => { for (const response of eventClients) response.end(); eventClients.clear(); };
  return handler;
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
  return { server, url: `http://${host}:${server.address().port}`, close: () => new Promise((resolve, reject) => { handler.close(); server.close(error => error ? reject(error) : resolve()); server.closeAllConnections?.(); }) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = await readJSON(process.env.CONTEXT_GUARD_MEMORY_CONFIG);
  const running = await startMemoryServer(config);
  console.log(`Private memory service listening on ${running.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await running.close(); process.exit(0); });
}
