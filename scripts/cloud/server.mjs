import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyOperations, assignmentScope, entries, validate, MapError } from '../../prototype/map-model.mjs';
import { CloudSessionMaps } from './session-maps.mjs';
import { verifyMainCommit } from '../workbench/main-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const htmlPath = path.join(root, 'prototype/workbench.html');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const now = () => new Date().toISOString();
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const versionOf = document => digest(JSON.stringify(document));
const newToken = () => randomBytes(32).toString('base64url');
function repositoryConfig(raw = '') {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== 'object' || Object.values(value).some(item => typeof item !== 'string' || !path.isAbsolute(item))) throw new Error('invalid');
    return value;
  } catch { throw new MapError('INVALID_REPOSITORIES', 'CONTEXT_GUARD_CLOUD_REPOSITORIES must map project IDs to absolute repository paths'); }
}

async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, value, { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function readJsonLines(file) {
  const text = await fs.readFile(file, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error));
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function appendJsonLine(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'a', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicProject(project) {
  const { tokenHash: _tokenHash, ...visible } = project;
  return visible;
}

function compactProject(input, tokenHash = '') {
  const id = String(input?.id || '').trim().toLowerCase();
  const name = String(input?.name || '').trim();
  if (!idPattern.test(id)) throw new MapError('INVALID_PROJECT', 'Project ID must use lowercase letters, numbers, and hyphens');
  if (!name || name.length > 120) throw new MapError('INVALID_PROJECT', 'Project name is required');
  return {
    id,
    name,
    description: String(input?.description || '').trim().slice(0, 500),
    status: ['connected', 'pending', 'error'].includes(input?.status) ? input.status : 'pending',
    updatedAt: now(),
    ...(tokenHash ? { tokenHash } : {}),
  };
}

function mapNode({ id, title, purpose = '', state = 'dirty', children = [] }) {
  return { id, title, purpose, kind: 'module', state, proposal: 'accepted', memories: [], ideas: [], todos: [], bugs: [], dormant: [], files: [], owns: [], children };
}

function overviewChildren(projects) {
  return projects.map(project => ({ ...mapNode({
    id: `P_${project.id}`,
    title: project.name,
    purpose: project.description || `项目 ID：${project.id}`,
    state: project.status === 'connected' ? 'success' : project.status === 'error' ? 'failed' : 'dirty',
  }), cloudProjectId: project.id }));
}

function overviewDocument(projects) {
  return {
    v: 1,
    project: '项目地图',
    bootstrap: 'ready',
    flows: [],
    root: mapNode({
      id: 'T0',
      title: '项目地图',
      purpose: '线上所有 Context Guard 项目的统一入口',
      state: projects.some(project => project.status === 'error') ? 'failed' : 'success',
      children: overviewChildren(projects),
    }),
  };
}

function reconcileOverview(stored, projects) {
  const generated = overviewDocument(projects);
  if (!stored?.document?.root) return generated;
  return {
    ...stored.document,
    project: '项目地图',
    bootstrap: 'ready',
    root: { ...stored.document.root, id: 'T0', children: generated.root.children },
  };
}

function emptyProjectDocument(project) {
  return { v: 1, project: project.name, bootstrap: 'pending', flows: [], root: null };
}

function placeholderProjectDocument(project) {
  return { v: 1, project: project.name, bootstrap: 'pending', flows: [], root: mapNode({ id: 'T0', title: project.name, purpose: project.description || '等待本地 Map 首次同步' }) };
}

function normalizeScope(input = {}) {
  const list = value => [...new Set((Array.isArray(value) ? value : []).map(item => String(item || '').trim()).filter(Boolean))].sort();
  return { nodeIds: list(input.nodeIds), fields: list(input.fields), paths: list(input.paths), wildcard: !!input.wildcard };
}

function scopeOfOperations(operations = [], extra = {}) {
  const nodeIds = [], fields = [];
  let wildcard = false;
  for (const operation of operations || []) {
    if (operation.id) nodeIds.push(operation.id);
    if (operation.parentId) nodeIds.push(operation.parentId);
    if (operation.node?.id) nodeIds.push(operation.node.id);
    fields.push(...Object.keys(operation.fields || {}));
    if (operation.type === 'document' || operation.type === 'initialize' || operation.type === 'snapshot') wildcard = true;
  }
  return normalizeScope({
    nodeIds: [...nodeIds, ...(extra.nodeIds || [])],
    fields: [...fields, ...(extra.fields || [])],
    paths: extra.paths || [],
    wildcard: wildcard || extra.wildcard,
  });
}

function pathOverlap(a, b) {
  const left = a.replace(/^\.\//, '').replace(/\/$/, '');
  const right = b.replace(/^\.\//, '').replace(/\/$/, '');
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function scopesOverlap(left, right) {
  if (left?.wildcard || right?.wildcard) return true;
  const nodes = new Set(left?.nodeIds || []);
  const sameNode = (right?.nodeIds || []).some(id => nodes.has(id));
  if (sameNode) {
    const a = left?.fields || [], b = right?.fields || [];
    if (!a.length || !b.length || b.some(field => a.includes(field))) return true;
  }
  return (left?.paths || []).some(a => (right?.paths || []).some(b => pathOverlap(a, b)));
}

export async function startCloudServer({
  host = process.env.CONTEXT_GUARD_CLOUD_HOST || '127.0.0.1',
  port = Number(process.env.CONTEXT_GUARD_CLOUD_PORT || 8787),
  dataDir = process.env.CONTEXT_GUARD_CLOUD_DATA || path.join(root, '.cloud-data'),
  adminToken = process.env.CONTEXT_GUARD_CLOUD_TOKEN || '',
  browserToken = process.env.CONTEXT_GUARD_CLOUD_WORKBENCH_TOKEN || adminToken,
  sourceRepositories = repositoryConfig(process.env.CONTEXT_GUARD_CLOUD_REPOSITORIES),
  privateAccess = process.env.CONTEXT_GUARD_CLOUD_PRIVATE === '1',
  secureCookies = process.env.CONTEXT_GUARD_CLOUD_SECURE_COOKIES === '1',
  publicOrigin = process.env.CONTEXT_GUARD_CLOUD_ORIGIN || '',
} = {}) {
  const sessionMaps = new CloudSessionMaps(dataDir);
  const registryFile = path.join(dataDir, 'projects.json');
  const mapsDir = path.join(dataDir, 'maps');
  const eventsDir = path.join(dataDir, 'events');
  const operationsDir = path.join(dataDir, 'operations');
  const worksDir = path.join(dataDir, 'works');
  const overviewFile = path.join(mapsDir, 'project-overview.json');
  const directoryClients = new Set();
  const workbenchClients = new Set();
  const projectClients = new Map();
  const tails = new Map();
  let registry = await readJson(registryFile, null);
  if (!registry) {
    registry = { v: 2, projects: [compactProject({ id: 'context-guard', name: 'Context Guard', description: 'Context Guard 项目地图' })] };
    await atomicWrite(registryFile, json(registry));
  }

  const projectById = id => registry.projects.find(project => project.id === id);
  const mapFile = id => path.join(mapsDir, `${id}.json`);
  const eventsFile = id => path.join(eventsDir, `${id}.jsonl`);
  const workFile = (id, workId) => path.join(worksDir, id, `${digest(workId)}.json`);
  const operationFile = (scope, operationId) => path.join(operationsDir, `${digest(`${scope}:${operationId}`)}.json`);
  const serial = (id, task) => {
    const next = (tails.get(id) || Promise.resolve()).then(task);
    tails.set(id, next.catch(() => {}));
    return next;
  };
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(JSON.stringify(body));
  };
  const redirect = (res, location, headers = {}) => { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers }); res.end(); };
  const workbenchCookie = () => ({ 'Set-Cookie': `cg_workbench=${encodeURIComponent(browserToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secureCookies ? '; Secure' : ''}` });
  const requestBody = async req => {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new MapError('CONTENT_TYPE', 'Use application/json', 415);
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new MapError('BODY_TOO_LARGE', 'Request exceeds 16 MiB', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks)); } catch { throw new MapError('INVALID_JSON', 'Malformed JSON', 400); }
  };
  const bearer = (req, url) => req.headers.authorization?.replace(/^Bearer /, '') || url.searchParams.get('token') || '';
  const requireAdmin = (req, url) => {
    if (!adminToken || !safeEqual(bearer(req, url), adminToken)) throw new MapError('UNAUTHORIZED', 'An admin token is required', 401);
  };
  const requireProject = (req, url, project) => {
    const credential = bearer(req, url);
    if (adminToken && safeEqual(credential, adminToken)) return;
    if (!project.tokenHash || !safeEqual(digest(credential), project.tokenHash)) throw new MapError('UNAUTHORIZED', 'A project sync token is required', 401);
  };
  const requireSession = async (req, url, project, sessionId) => {
    if (adminToken && safeEqual(bearer(req, url), adminToken)) return;
    if (!await sessionMaps.authorize(project.id, sessionId, bearer(req, url))) throw new MapError('UNAUTHORIZED', 'A Session-scoped token is required', 401);
  };
  const cookieValue = req => String(req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith('cg_workbench='))?.slice('cg_workbench='.length) || '';
  const requireWorkbench = (req, url) => {
    const credential = bearer(req, url) || decodeURIComponent(cookieValue(req));
    if (!browserToken || !(safeEqual(credential, browserToken) || adminToken && safeEqual(credential, adminToken))) throw new MapError('UNAUTHORIZED', 'Open /auth?token=... before editing the cloud workbench', 401);
  };
  const requirePrivateRead = (req, url) => { if (privateAccess) requireWorkbench(req, url); };
  const readEvents = id => readJsonLines(eventsFile(id));
  const currentSeq = async id => (await readEvents(id)).at(-1)?.seq || 0;
  const broadcastDirectory = (event, body) => {
    for (const res of directoryClients) {
      if (res.destroyed) { directoryClients.delete(res); continue; }
      res.write(`event: ${event}\ndata: ${JSON.stringify(body)}\n\n`);
    }
  };
  const broadcastProject = event => {
    for (const res of projectClients.get(event.projectId) || []) {
      if (res.destroyed) { projectClients.get(event.projectId)?.delete(res); continue; }
      res.write(`id: ${event.seq}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`);
    }
  };
  const appendEvent = async (id, input) => {
    const event = { ...input, projectId: id, seq: (await currentSeq(id)) + 1, eventId: input.eventId || randomUUID(), at: now() };
    await appendJsonLine(eventsFile(id), event);
    broadcastProject(event);
    broadcastDirectory('map', { projectId: id, seq: event.seq, version: event.version, type: event.type });
    return event;
  };
  const projectSnapshot = async project => {
    if (await sessionMaps.enabled(project.id)) {
      const state = await sessionMaps.state(project.id, null);
      return { projectId: project.id, version: state.version, document: state.doc, isolated: true, baselineStatus: state.baselineStatus, seq: 0 };
    }
    const events = await readEvents(project.id);
    const stored = await readJson(mapFile(project.id), null);
    return stored
      ? { ...stored, projectId: project.id, seq: events.at(-1)?.seq || stored.seq || 0, snapshotSeq: stored.seq || 0 }
      : { projectId: project.id, version: null, document: null, seq: events.at(-1)?.seq || 0, snapshotSeq: 0 };
  };
  const workbenchSnapshot = async (scope, project) => {
    if (scope === 'overview') {
      const stored = await readJson(overviewFile, null);
      const document = reconcileOverview(stored, registry.projects);
      return { projectId: 'overview', version: versionOf(document), document };
    }
    const snapshot = await projectSnapshot(project);
    const document = snapshot.document || emptyProjectDocument(project);
    return { projectId: project.id, version: snapshot.version || versionOf(document), document };
  };
  const workbenchState = async (scope, project, sessionId = null) => {
    if (project && await sessionMaps.enabled(project.id)) return sessionMaps.state(project.id, sessionId);
    const snapshot = await workbenchSnapshot(scope, project);
    return { version: snapshot.version, doc: snapshot.document, projection: { status: 'ready', sourceVersion: snapshot.version }, recovery: false, error: null };
  };
  const broadcastWorkbench = async (scope, project) => {
    const state = await workbenchState(scope, project);
    for (const client of workbenchClients) {
      if (client.res.destroyed) { workbenchClients.delete(client); continue; }
      if (!client.scoped && client.scope === scope) client.res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    }
  };
  const validateOperationId = input => {
    const operationId = String(input.operationId || '');
    if (!operationId || operationId.length > 160) throw new MapError('INVALID_OPERATION', 'operationId is required');
    return operationId;
  };
  const commitProject = (project, input, actor = { kind: 'human', sessionId: 'cloud-sync' }) => serial(project.id, async () => {
    const operationId = validateOperationId(input);
    const receiptPath = operationFile(project.id, operationId);
    const requestDigest = digest(JSON.stringify({ baseVersion: input.baseVersion ?? null, operations: input.operations, actor }));
    const receipt = await readJson(receiptPath, null);
    if (receipt) {
      if (receipt.requestDigest !== requestDigest) throw new MapError('ID_REUSED', 'operationId belongs to another request', 409);
      return receipt.result;
    }
    const current = await projectSnapshot(project);
    if ((input.baseVersion ?? null) !== current.version) throw new MapError('VERSION_CONFLICT', 'Map changed; reload before committing', 409, { currentVersion: current.version, currentSeq: current.seq });
    const applied = applyOperations(current.document || emptyProjectDocument(project), input.operations, actor);
    validate(applied.doc);
    const version = versionOf(applied.doc);
    const event = await appendEvent(project.id, {
      type: 'map.committed', operationId, actor, baseVersion: current.version, version,
      operations: input.operations, scope: scopeOfOperations(input.operations, input.scope),
    });
    const next = { projectId: project.id, version, seq: event.seq, document: applied.doc, updatedAt: event.at };
    await atomicWrite(mapFile(project.id), json(next));
    Object.assign(project, { status: 'connected', updatedAt: event.at }); await atomicWrite(registryFile, json(registry));
    const result = { committed: true, operationId, projectId: project.id, version, seq: event.seq, nodeIds: applied.resultIds };
    await atomicWrite(receiptPath, json({ requestDigest, result }));
    await broadcastWorkbench(`project:${project.id}`, project);
    return result;
  });
  const saveSnapshot = (project, input) => serial(project.id, async () => {
    const operationId = validateOperationId(input);
    const receiptPath = operationFile(`${project.id}:snapshot`, operationId);
    const requestDigest = digest(JSON.stringify({ baseVersion: input.baseVersion ?? null, document: input.document }));
    const receipt = await readJson(receiptPath, null);
    if (receipt) {
      if (receipt.requestDigest !== requestDigest) throw new MapError('ID_REUSED', 'operationId belongs to another request', 409);
      return receipt.result;
    }
    validate(input.document);
    const current = await projectSnapshot(project);
    if ((input.baseVersion ?? null) !== current.version) throw new MapError('VERSION_CONFLICT', 'Map changed; choose pull or push explicitly', 409, { currentVersion: current.version, currentSeq: current.seq });
    const version = versionOf(input.document);
    const event = await appendEvent(project.id, { type: 'map.snapshot', operationId, actor: { kind: 'sync', sessionId: String(input.sessionId || '') }, baseVersion: current.version, version, operations: [], scope: normalizeScope({ wildcard: true }) });
    const next = { projectId: project.id, version, seq: event.seq, document: input.document, updatedAt: event.at };
    await atomicWrite(mapFile(project.id), json(next));
    Object.assign(project, { status: 'connected', updatedAt: event.at }); await atomicWrite(registryFile, json(registry));
    const result = { committed: true, operationId, projectId: project.id, version, seq: event.seq, snapshot: true };
    await atomicWrite(receiptPath, json({ requestDigest, result }));
    await broadcastWorkbench(`project:${project.id}`, project);
    return result;
  });
  const impactsSince = async (project, baseSeq, scope, workId) => (await readEvents(project.id))
    .filter(event => event.seq > baseSeq && ['map.committed', 'map.snapshot', 'work.completed'].includes(event.type) && event.workId !== workId && scopesOverlap(scope, event.scope))
    .map(event => ({ seq: event.seq, eventId: event.eventId, type: event.type, actor: event.actor, scope: event.scope, version: event.version }));

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const route = url.pathname;
      if (publicOrigin && req.headers.origin && req.headers.origin !== publicOrigin) throw new MapError('ORIGIN_REJECTED', 'Cross-origin request rejected', 403);
      const scopedRoute = route.match(/^\/api\/projects\/([^/]+)\/scopes\/(enable|session|state|commit|refresh|publish)$/);
      if (scopedRoute) {
        const project = projectById(decodeURIComponent(scopedRoute[1]));
        if (!project) throw new MapError('NOT_FOUND', 'Project is missing', 404);
        const action = scopedRoute[2], sessionId = url.searchParams.get('session');
        if (action === 'state' && req.method === 'GET') {
          if (sessionId) await requireSession(req, url, project, sessionId); else requireProject(req, url, project);
          return send(res, 200, await sessionMaps.state(project.id, sessionId));
        }
        if (req.method !== 'POST') throw new MapError('METHOD', 'POST required', 405);
        const input = await requestBody(req);
        if (action === 'enable') {
          requireAdmin(req, url);
          return send(res, 200, await serial(project.id, async () => {
            const current = await projectSnapshot(project);
            if (input.baseVersion !== current.version) throw new MapError('VERSION_CONFLICT', 'Review the existing Map before migration', 409);
            return sessionMaps.enable(project.id, current.document);
          }));
        }
        if (action === 'session') { requireProject(req, url, project); return send(res, 200, await sessionMaps.session(project.id, input)); }
        if (action === 'publish') {
          requireProject(req, url, project);
          const scopes = await sessionMaps.open(project.id);
          const result = await scopes.publish(input, commit => verifyMainCommit(sourceRepositories[project.id], commit));
          if (!result.duplicate && result.committed) await serial(project.id, () => appendEvent(project.id, { type: 'map.committed', actor: { kind: 'publication', sessionId: input.sessionId }, scope: { wildcard: true }, version: result.version }));
          return send(res, 200, result);
        }
        if (action === 'commit' && !sessionId) {
          requireProject(req, url, project);
          const scopes = await sessionMaps.open(project.id);
          const result = await scopes.main.commit(input, { kind: 'human', sessionId: 'main-sync' });
          if (!result.duplicate && result.committed) await serial(project.id, () => appendEvent(project.id, { type: 'map.committed', actor: { kind: 'human', sessionId: 'main-sync' }, scope: { wildcard: true }, version: result.version }));
          return send(res, 200, result);
        }
        if (!sessionId) throw new MapError('SESSION_REQUIRED', 'Agent writes must name a Session; Main requires publication', 403);
        await requireSession(req, url, project, sessionId);
        if (action === 'refresh') return send(res, 200, await sessionMaps.refreshMain(project.id, sessionId, input.baseVersion));
        if (action === 'commit') {
          const store = await sessionMaps.store(project.id, sessionId);
          const nodes = (await sessionMaps.sessions(project.id)).grants?.[sessionId]?.nodes || [];
          return send(res, 200, await store.commit(input, { kind: 'agent', sessionId }, nodes));
        }
      }
      if (route === '/auth' && req.method === 'GET') {
        if (!browserToken || !safeEqual(url.searchParams.get('token'), browserToken)) throw new MapError('UNAUTHORIZED', 'Invalid workbench token', 401);
        const next = url.searchParams.get('next') || '/';
        if (!next.startsWith('/') || next.startsWith('//')) throw new MapError('INVALID_REDIRECT', 'Invalid redirect');
        return redirect(res, next, workbenchCookie());
      }
      const workbench = route.match(/^\/api\/workbench\/(overview|projects\/([^/]+))(\/.*)$/);
      if (workbench) {
        const scope = workbench[1] === 'overview' ? 'overview' : `project:${decodeURIComponent(workbench[2])}`;
        const project = workbench[2] ? projectById(decodeURIComponent(workbench[2])) : null;
        if (workbench[2] && !project) throw new MapError('NOT_FOUND', 'Project is missing', 404);
        const action = workbench[3];
        if (action === '/bootstrap' && req.method === 'GET') { requirePrivateRead(req, url); return send(res, 200, { root: `cloud:${scope}`, protocol: 3, apiBase: route.slice(0, -'/bootstrap'.length), authenticated: !!cookieValue(req) }); }
        requireWorkbench(req, url);
        const sessionId = url.searchParams.get('session');
        if (action === '/api/state' && req.method === 'GET') return send(res, 200, { ...(await workbenchState(scope, project, sessionId)), actor: { kind: 'human', sessionId: 'cloud-workbench' }, grants: [] }, workbenchCookie());
        if (action === '/api/events' && req.method === 'GET') {
          const client = { scope, res }; workbenchClients.add(client);
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...workbenchCookie() });
          res.write(`retry: 1000\nevent: state\ndata: ${JSON.stringify(await workbenchState(scope, project, sessionId))}\n\n`);
          if (project && await sessionMaps.enabled(project.id)) {
            client.scoped = true;
            const store = await sessionMaps.store(project.id, sessionId);
            const update = state => res.write(`event: state\ndata: ${JSON.stringify({ ...state, scope: sessionId })}\n\n`);
            store.on('change', update); req.on('close', () => store.off('change', update));
          }
          req.on('close', () => workbenchClients.delete(client)); return;
        }
        if (action === '/api/access' && req.method === 'GET') return send(res, 200, project && await sessionMaps.enabled(project.id) ? await sessionMaps.sessions(project.id) : { sessions: [], grants: {}, currentSessionId: null });
        if (action === '/api/access-plan' && req.method === 'POST') {
          const input = await requestBody(req);
          if (!project || !await sessionMaps.enabled(project.id)) throw new MapError('ISOLATION_REQUIRED', 'Session Maps are not enabled', 409);
          const state = await sessionMaps.state(project.id, input.sessionId);
          const nodes = assignmentScope(state.doc, String(input.nodeId || '').trim());
          const current = (await sessionMaps.sessions(project.id)).grants?.[input.sessionId]?.nodes || [];
          return send(res, 200, { sessionId: input.sessionId, nodeId: input.nodeId, nodes, missing: nodes.filter(node => !current.includes(node)) });
        }
        if (action === '/api/access' && req.method === 'POST') {
          const input = await requestBody(req);
          if (!project || !await sessionMaps.enabled(project.id)) throw new MapError('ISOLATION_REQUIRED', 'Session Maps are not enabled', 409);
          const state = await sessionMaps.state(project.id, input.sessionId), known = entries(state.doc.root);
          const current = (await sessionMaps.sessions(project.id)).grants?.[input.sessionId]?.nodes || [];
          const nodes = Array.isArray(input.addNodes) ? [...new Set([...current, ...input.addNodes])] : input.nodes;
          if (!Array.isArray(nodes) || nodes.some(node => !known.has(node))) throw new MapError('INVALID_SCOPE', 'Unknown node in scope');
          await sessionMaps.session(project.id, { sessionId: input.sessionId, nodes });
          return send(res, 200, { saved: true });
        }
        if (action === '/api/presence' && req.method === 'POST') {
          const input = await requestBody(req), state = await workbenchState(scope, project, sessionId);
          return send(res, 200, { version: state.version, synchronized: input.version === state.version && !input.dirty, error: null, recovery: false });
        }
        if (action === '/api/commit' && req.method === 'POST') {
          const input = await requestBody(req);
          if (project && await sessionMaps.enabled(project.id)) return send(res, 200, await (await sessionMaps.store(project.id, sessionId)).commit(input, { kind: 'human', sessionId: 'cloud-workbench' }));
          if (project) return send(res, 200, await commitProject(project, input, { kind: 'human', sessionId: 'cloud-workbench' }));
          const result = await serial('overview', async () => {
            const operationId = validateOperationId(input), receiptPath = operationFile('overview', operationId);
            const requestDigest = digest(JSON.stringify({ baseVersion: input.baseVersion, operations: input.operations }));
            const previous = await readJson(receiptPath, null);
            if (previous) { if (previous.requestDigest !== requestDigest) throw new MapError('ID_REUSED', 'operationId belongs to another request', 409); return previous.result; }
            const current = await workbenchSnapshot('overview', null);
            if (input.baseVersion !== current.version) throw new MapError('VERSION_CONFLICT', 'Map changed; reload before committing', 409, { currentVersion: current.version });
            const applied = applyOperations(current.document, input.operations, { kind: 'human', sessionId: 'cloud-workbench' }); validate(applied.doc);
            const next = { projectId: 'overview', version: versionOf(applied.doc), document: applied.doc, updatedAt: now() };
            const saved = { committed: true, operationId, version: next.version, nodeIds: applied.resultIds };
            await atomicWrite(overviewFile, json(next)); await atomicWrite(receiptPath, json({ requestDigest, result: saved }));
            return saved;
          });
          await broadcastWorkbench('overview', null); return send(res, 200, result);
        }
        if (action === '/api/projections' && req.method === 'POST') return send(res, 200, { status: 'ready', sourceVersion: (await workbenchState(scope, project)).version });
        throw new MapError('NOT_FOUND', 'Unsupported cloud workbench route', 404);
      }
      if (route === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, service: 'context-guard-cloud', protocol: 3, ...(privateAccess ? {} : { projects: registry.projects.length }) });
      if (route === '/.codex/context/preferences.json' && req.method === 'GET') { requirePrivateRead(req, url); return send(res, 200, { display_language: 'zh' }); }
      if (route === '/.codex/context/map.json' && req.method === 'GET') {
        requirePrivateRead(req, url);
        const page = String(req.headers.referer || '').match(/\/projects\/([^/?#]+)/);
        if (!page) return send(res, 200, overviewDocument(registry.projects));
        const project = projectById(decodeURIComponent(page[1]));
        if (!project) throw new MapError('NOT_FOUND', 'Project is missing', 404);
        const snapshot = await projectSnapshot(project);
        return send(res, 200, snapshot.document || placeholderProjectDocument(project));
      }
      if (route === '/api/events' && req.method === 'GET') {
        requirePrivateRead(req, url);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        directoryClients.add(res); res.write('retry: 1000\nevent: ready\ndata: {}\n\n'); req.on('close', () => directoryClients.delete(res)); return;
      }
      if (route === '/api/projects' && req.method === 'GET') { requirePrivateRead(req, url); return send(res, 200, { projects: registry.projects.map(publicProject) }); }
      if (route === '/api/projects' && req.method === 'POST') {
        requireAdmin(req, url);
        const rawToken = newToken(), project = compactProject(await requestBody(req), digest(rawToken));
        if (projectById(project.id)) throw new MapError('PROJECT_EXISTS', 'Project already exists', 409);
        registry.projects.push(project); await atomicWrite(registryFile, json(registry)); broadcastDirectory('projects', { projectId: project.id });
        return send(res, 201, { project: publicProject(project), syncToken: rawToken });
      }
      const projectRoute = route.match(/^\/api\/projects\/([^/]+)(?:\/(map|snapshot|commits|events|changes|enrollments|work\/prepare|work\/finish|work\/checkpoint))?$/);
      if (projectRoute) {
        const project = projectById(decodeURIComponent(projectRoute[1]));
        if (!project) throw new MapError('NOT_FOUND', 'Project is missing', 404);
        const action = projectRoute[2];
        if (!action && req.method === 'GET') { requirePrivateRead(req, url); return send(res, 200, { project: publicProject(project) }); }
        if (action === 'enrollments' && req.method === 'POST') {
          requireAdmin(req, url); const syncToken = newToken(); project.tokenHash = digest(syncToken); project.updatedAt = now(); await atomicWrite(registryFile, json(registry));
          return send(res, 201, { projectId: project.id, syncToken });
        }
        if (action === 'map' && req.method === 'GET') { if (privateAccess) { const credential = bearer(req, url); if (!(adminToken && safeEqual(credential, adminToken)) && !(project.tokenHash && safeEqual(digest(credential), project.tokenHash))) requirePrivateRead(req, url); } return send(res, 200, await projectSnapshot(project)); }
        requireProject(req, url, project);
        if (req.method !== 'GET' && await sessionMaps.enabled(project.id)) throw new MapError('SESSION_REQUIRED', 'This project uses Session Maps; upgrade the client and use the scopes API', 409);
        if (action === 'snapshot' && req.method === 'POST') return send(res, 200, await saveSnapshot(project, await requestBody(req)));
        if (action === 'commits' && req.method === 'POST') {
          const input = await requestBody(req);
          return send(res, 200, await commitProject(project, input, { kind: 'sync', sessionId: String(input.sessionId || '') }));
        }
        if (action === 'changes' && req.method === 'GET') {
          const after = Math.max(0, Number(url.searchParams.get('after') || 0));
          const events = (await readEvents(project.id)).filter(event => event.seq > after);
          return send(res, 200, { projectId: project.id, after, cursor: events.at(-1)?.seq || after, events });
        }
        if (action === 'events' && req.method === 'GET') {
          const after = Math.max(0, Number(url.searchParams.get('after') || req.headers['last-event-id'] || 0));
          const events = (await readEvents(project.id)).filter(event => event.seq > after);
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write('retry: 1000\n'); for (const event of events) res.write(`id: ${event.seq}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`);
          const clients = projectClients.get(project.id) || new Set(); clients.add(res); projectClients.set(project.id, clients);
          req.on('close', () => clients.delete(res)); return;
        }
        if (action === 'work/prepare' && req.method === 'POST') {
          const input = await requestBody(req);
          const result = await serial(project.id, async () => {
            const workId = String(input.workId || randomUUID());
            if (!/^[\w:.-]{8,160}$/.test(workId)) throw new MapError('INVALID_WORK_ID', 'Use a stable workId (8–160 characters)');
            const existing = await readJson(workFile(project.id, workId), null);
            if (existing) return existing;
            const snapshot = await projectSnapshot(project);
            const scope = normalizeScope(input.scope);
            if (!scope.nodeIds.length && !scope.paths.length) scope.wildcard = true;
            const event = await appendEvent(project.id, { type: 'work.started', workId, actor: { kind: 'agent', sessionId: String(input.sessionId || '') }, version: snapshot.version, scope });
            const work = { workId, projectId: project.id, sessionId: String(input.sessionId || ''), status: 'working', baseSeq: event.seq, baseVersion: snapshot.version, scope, startedAt: event.at };
            await atomicWrite(workFile(project.id, workId), json(work)); return work;
          });
          return send(res, 200, result);
        }
        if ((action === 'work/checkpoint' || action === 'work/finish') && req.method === 'POST') {
          const input = await requestBody(req), workId = String(input.workId || '');
          const result = await serial(project.id, async () => {
            const work = await readJson(workFile(project.id, workId), null);
            if (!work) throw new MapError('WORK_NOT_FOUND', 'Prepare this development window first', 404);
            if (work.status === 'completed') return work.result;
            const requestedScope = normalizeScope(input.scope);
            const scope = scopeOfOperations(input.operations || [], {
              nodeIds: [...work.scope.nodeIds, ...requestedScope.nodeIds],
              fields: requestedScope.fields,
              paths: [...work.scope.paths, ...requestedScope.paths],
              wildcard: work.scope.wildcard || requestedScope.wildcard,
            });
            const impacts = await impactsSince(project, work.baseSeq, scope, workId);
            if (action === 'work/checkpoint') return { workId, status: impacts.length ? 'conflict' : 'working', impacts, cursor: await currentSeq(project.id) };
            if (impacts.length) {
              work.status = 'conflict'; work.impacts = impacts; work.checkedAt = now(); await atomicWrite(workFile(project.id, workId), json(work));
              throw new MapError('WORK_IMPACT', 'Remote changes overlap this development window', 409, { workId, impacts });
            }
            const current = await projectSnapshot(project);
            let document = current.document, version = current.version, nodeIds = [];
            if (input.operations?.length) {
              const applied = applyOperations(current.document || emptyProjectDocument(project), input.operations, { kind: 'human', sessionId: work.sessionId });
              validate(applied.doc); document = applied.doc; version = versionOf(document); nodeIds = applied.resultIds;
            }
            const event = await appendEvent(project.id, { type: 'work.completed', workId, operationId: input.operationId || `finish:${workId}`, actor: { kind: 'agent', sessionId: work.sessionId }, baseVersion: current.version, version, operations: input.operations || [], scope });
            if (document) await atomicWrite(mapFile(project.id), json({ projectId: project.id, version, seq: event.seq, document, updatedAt: event.at }));
            const completed = { workId, projectId: project.id, status: 'completed', version, seq: event.seq, nodeIds, completedAt: event.at, rebased: current.version !== work.baseVersion };
            work.status = 'completed'; work.result = completed; work.completedAt = event.at; await atomicWrite(workFile(project.id, workId), json(work));
            Object.assign(project, { status: 'connected', updatedAt: event.at }); await atomicWrite(registryFile, json(registry));
            await broadcastWorkbench(`project:${project.id}`, project); return completed;
          });
          return send(res, 200, result);
        }
      }
      if (req.method === 'GET' && /\/(map-model|workbench-sync)\.mjs$/.test(route)) {
        requirePrivateRead(req, url);
        const source = await fs.readFile(path.join(root, 'prototype', path.basename(route)));
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(source);
      }
      if (req.method === 'GET' && (route === '/' || route === '/prototype/' || route === '/workbench.html' || /^\/projects\/[^/]+$/.test(route))) {
        requirePrivateRead(req, url);
        if (/^\/projects\//.test(route) && !projectById(decodeURIComponent(route.slice('/projects/'.length)))) throw new MapError('NOT_FOUND', 'Project is missing', 404);
        const projectId = /^\/projects\//.test(route) ? decodeURIComponent(route.slice('/projects/'.length)) : null;
        const scope = projectId ? `projects/${encodeURIComponent(projectId)}` : 'overview';
        const config = JSON.stringify({ root: `cloud:${projectId || 'overview'}`, protocol: 3, apiBase: `/api/workbench/${scope}` }).replace(/</g, '\\u003c');
        const marker = `<script>window.__CG_SERVER=${config};</script>`;
        const html = (await fs.readFile(htmlPath, 'utf8')).replace('<!-- CG_SERVER_BOOT -->', marker);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
        return res.end(html);
      }
      throw new MapError('NOT_FOUND', 'Unknown route', 404);
    } catch (error) {
      if (!res.headersSent) send(res, error.status || 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error.message, ...(error.details || {}) } }); else res.end();
    }
  });
  server.requestTimeout = 15_000;
  const heartbeat = setInterval(() => {
    for (const set of projectClients.values()) for (const res of set) if (!res.destroyed) res.write(': heartbeat\n\n');
    for (const res of directoryClients) if (!res.destroyed) res.write(': heartbeat\n\n');
  }, 15_000); heartbeat.unref();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const close = () => new Promise((resolve, reject) => {
    clearInterval(heartbeat);
    for (const res of directoryClients) res.end(); for (const client of workbenchClients) client.res.end(); for (const set of projectClients.values()) for (const res of set) res.end();
    server.close(error => error ? reject(error) : sessionMaps.close().then(resolve, reject));
  });
  return { server, close, url: `http://${host}:${server.address().port}` };
}

async function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url)); }
  catch { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); }
}

if (await invokedDirectly()) {
  const instance = await startCloudServer();
  process.stdout.write(`Context Guard Cloud listening on ${instance.url}\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await instance.close(); process.exit(0); });
}
