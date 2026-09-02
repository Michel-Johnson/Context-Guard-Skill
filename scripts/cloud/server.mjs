import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyOperations, validate, MapError } from '../../prototype/map-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const htmlPath = path.join(root, 'prototype/workbench.html');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

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

function versionOf(document) {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex');
}

function compactProject(input) {
  const id = String(input?.id || '').trim().toLowerCase();
  const name = String(input?.name || '').trim();
  if (!idPattern.test(id)) throw new MapError('INVALID_PROJECT', 'Project ID must use lowercase letters, numbers, and hyphens');
  if (!name || name.length > 120) throw new MapError('INVALID_PROJECT', 'Project name is required');
  return {
    id,
    name,
    description: String(input?.description || '').trim().slice(0, 500),
    status: ['connected', 'pending', 'error'].includes(input?.status) ? input.status : 'pending',
    updatedAt: new Date().toISOString(),
  };
}

function mapNode({ id, title, purpose = '', state = 'dirty', children = [] }) {
  return { id, title, purpose, kind: 'module', state, proposal: 'accepted', memories: [], ideas: [], todos: [], bugs: [], dormant: [], files: [], owns: [], children };
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
      children: projects.map((project, index) => mapNode({
        id: `P${index + 1}`,
        title: project.name,
        purpose: project.description || `项目 ID：${project.id}`,
        state: project.status === 'connected' ? 'success' : project.status === 'error' ? 'failed' : 'dirty',
      })),
    }),
  };
}

function emptyProjectDocument(project) {
  return {
    v: 1,
    project: project.name,
    bootstrap: 'ready',
    flows: [],
    root: mapNode({ id: 'T0', title: project.name, purpose: project.description || '等待本地 Map 首次同步' }),
  };
}

export async function startCloudServer({
  host = process.env.CONTEXT_GUARD_CLOUD_HOST || '127.0.0.1',
  port = Number(process.env.CONTEXT_GUARD_CLOUD_PORT || 8787),
  dataDir = process.env.CONTEXT_GUARD_CLOUD_DATA || path.join(root, '.cloud-data'),
  adminToken = process.env.CONTEXT_GUARD_CLOUD_TOKEN || '',
} = {}) {
  const registryFile = path.join(dataDir, 'projects.json');
  const mapsDir = path.join(dataDir, 'maps');
  const operationsDir = path.join(dataDir, 'operations');
  const clients = new Set();
  const workbenchClients = new Set();
  let registry = await readJson(registryFile, null);
  if (!registry) {
    registry = { v: 1, projects: [compactProject({ id: 'context-guard', name: 'Context Guard', description: 'Context Guard 项目地图' })] };
    await atomicWrite(registryFile, json(registry));
  }

  const send = (res, status, body) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(body));
  };
  const broadcast = (event, body) => {
    for (const res of clients) {
      if (res.destroyed) { clients.delete(res); continue; }
      res.write(`event: ${event}\ndata: ${JSON.stringify(body)}\n\n`);
    }
  };
  const requireWrite = req => {
    if (!adminToken || req.headers.authorization !== `Bearer ${adminToken}`) {
      throw new MapError('UNAUTHORIZED', 'A cloud write token is required', 401);
    }
  };
  const requestBody = async req => {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new MapError('CONTENT_TYPE', 'Use application/json', 415);
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) throw new MapError('BODY_TOO_LARGE', 'Request exceeds 16 MiB', 413);
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks)); }
    catch { throw new MapError('INVALID_JSON', 'Malformed JSON', 400); }
  };
  const projectById = id => registry.projects.find(project => project.id === id);
  const mapFile = id => path.join(mapsDir, `${id}.json`);
  const overviewFile = path.join(mapsDir, 'project-overview.json');
  const workbenchSnapshot = async (scope, project) => {
    const fallback = scope === 'overview'
      ? { projectId: 'overview', version: null, document: overviewDocument(registry.projects) }
      : { projectId: project.id, version: null, document: emptyProjectDocument(project) };
    const file = scope === 'overview' ? overviewFile : mapFile(project.id);
    const stored = await readJson(file, null);
    const snapshot = stored || fallback;
    if (!snapshot.version) snapshot.version = versionOf(snapshot.document);
    return snapshot;
  };
  const workbenchState = async (scope, project) => {
    const snapshot = await workbenchSnapshot(scope, project);
    return { version: snapshot.version, doc: snapshot.document, projection: { status: 'ready', sourceVersion: snapshot.version }, recovery: false, error: null };
  };
  const workbenchAuth = (req, url) => {
    const credential = req.headers.authorization?.replace(/^Bearer /, '') || url.searchParams.get('token');
    if (!adminToken || credential !== adminToken) throw new MapError('UNAUTHORIZED', 'A cloud write token is required', 401);
  };
  const broadcastWorkbench = async (scope, project) => {
    const state = await workbenchState(scope, project);
    for (const client of workbenchClients) {
      if (client.res.destroyed) { workbenchClients.delete(client); continue; }
      if (client.scope === scope) client.res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    }
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const route = url.pathname;
      const workbench = route.match(/^\/api\/workbench\/(overview|projects\/([^/]+))(\/.*)$/);
      if (workbench) {
        const scope = workbench[1] === 'overview' ? 'overview' : `project:${decodeURIComponent(workbench[2])}`;
        const project = workbench[2] ? projectById(decodeURIComponent(workbench[2])) : null;
        if (workbench[2] && !project) throw new MapError('NOT_FOUND', 'Project is missing', 404);
        const action = workbench[3];
        if (action === '/bootstrap' && req.method === 'GET') return send(res, 200, { token: adminToken, root: `cloud:${scope}`, protocol: 2, apiBase: route.slice(0, -'/bootstrap'.length) });
        workbenchAuth(req, url);
        if (action === '/api/state' && req.method === 'GET') return send(res, 200, { ...(await workbenchState(scope, project)), actor: { kind: 'human', sessionId: 'cloud-workbench' }, grants: [] });
        if (action === '/api/events' && req.method === 'GET') {
          const client = { scope, res }; workbenchClients.add(client);
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write(`retry: 1000\nevent: state\ndata: ${JSON.stringify(await workbenchState(scope, project))}\n\n`);
          req.on('close', () => workbenchClients.delete(client)); return;
        }
        if (action === '/api/access' && req.method === 'GET') return send(res, 200, { sessions: [], grants: {}, currentSessionId: null });
        if (action === '/api/presence' && req.method === 'POST') {
          const input = await requestBody(req), state = await workbenchState(scope, project);
          return send(res, 200, { version: state.version, synchronized: input.version === state.version && !input.dirty, error: null, recovery: false });
        }
        if (action === '/api/commit' && req.method === 'POST') {
          const input = await requestBody(req);
          const operationId = String(input.operationId || '');
          if (!operationId || operationId.length > 128) throw new MapError('INVALID_OPERATION', 'operationId is required');
          const receiptFile = path.join(operationsDir, `${createHash('sha256').update(`${scope}:${operationId}`).digest('hex')}.json`);
          const receipt = await readJson(receiptFile, null);
          if (receipt) return send(res, 200, receipt);
          const current = await workbenchSnapshot(scope, project);
          if (input.baseVersion !== current.version) throw new MapError('VERSION_CONFLICT', 'Map changed; reload before committing', 409, { currentVersion: current.version });
          const applied = applyOperations(current.document, input.operations, { kind: 'human', sessionId: 'cloud-workbench' });
          validate(applied.doc);
          const next = { projectId: scope, version: versionOf(applied.doc), document: applied.doc, updatedAt: new Date().toISOString() };
          const result = { committed: true, operationId, version: next.version, nodeIds: applied.resultIds };
          await atomicWrite(scope === 'overview' ? overviewFile : mapFile(project.id), json(next));
          await atomicWrite(receiptFile, json(result));
          if (project) { Object.assign(project, { status: 'connected', updatedAt: next.updatedAt }); await atomicWrite(registryFile, json(registry)); }
          await broadcastWorkbench(scope, project); broadcast('map', { projectId: project?.id || 'overview', version: next.version });
          return send(res, 200, result);
        }
        if (action === '/api/projections' && req.method === 'POST') return send(res, 200, { status: 'ready', sourceVersion: (await workbenchState(scope, project)).version });
        throw new MapError('NOT_FOUND', 'Unsupported cloud workbench route', 404);
      }
      if (route === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, service: 'context-guard-cloud', projects: registry.projects.length });
      if (route === '/.codex/context/preferences.json' && req.method === 'GET') return send(res, 200, { display_language: 'zh' });
      if (route === '/.codex/context/map.json' && req.method === 'GET') {
        const referer = String(req.headers.referer || '');
        const page = referer.match(/\/projects\/([^/?#]+)/);
        if (!page) return send(res, 200, overviewDocument(registry.projects));
        const id = decodeURIComponent(page[1]);
        const project = projectById(id);
        if (!project) throw new MapError('NOT_FOUND', 'Project is missing', 404);
        const snapshot = await readJson(mapFile(id), null);
        return send(res, 200, snapshot?.document || emptyProjectDocument(project));
      }
      if (route === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        clients.add(res); res.write('retry: 1000\nevent: ready\ndata: {}\n\n');
        req.on('close', () => clients.delete(res)); return;
      }
      if (route === '/api/projects' && req.method === 'GET') return send(res, 200, { projects: registry.projects });
      if (route === '/api/projects' && req.method === 'POST') {
        requireWrite(req);
        const project = compactProject(await requestBody(req));
        if (projectById(project.id)) throw new MapError('PROJECT_EXISTS', 'Project already exists', 409);
        registry.projects.push(project); await atomicWrite(registryFile, json(registry));
        broadcast('projects', { projectId: project.id }); return send(res, 201, { project });
      }
      const match = route.match(/^\/api\/projects\/([^/]+)(?:\/(map|commits))?$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const project = projectById(id);
        if (!project) throw new MapError('NOT_FOUND', 'Project is missing', 404);
        if (!match[2] && req.method === 'GET') return send(res, 200, { project });
        if (match[2] === 'map' && req.method === 'GET') {
          const snapshot = await readJson(mapFile(id), { projectId: id, version: null, document: null });
          return send(res, 200, snapshot);
        }
        if (match[2] === 'commits' && req.method === 'POST') {
          requireWrite(req);
          const input = await requestBody(req);
          const operationId = String(input.operationId || '');
          if (!operationId || operationId.length > 128) throw new MapError('INVALID_OPERATION', 'operationId is required');
          const receiptFile = path.join(operationsDir, `${createHash('sha256').update(operationId).digest('hex')}.json`);
          const receipt = await readJson(receiptFile, null);
          if (receipt) return send(res, 200, receipt);
          const current = await readJson(mapFile(id), { projectId: id, version: null, document: { v: 1, project: id, root: null, bootstrap: 'pending' } });
          if ((input.baseVersion ?? null) !== current.version) throw new MapError('VERSION_CONFLICT', 'Map changed; reload before committing', 409, { currentVersion: current.version });
          const applied = applyOperations(current.document, input.operations, { kind: 'human', sessionId: 'cloud-sync' });
          validate(applied.doc);
          const next = { projectId: id, version: versionOf(applied.doc), document: applied.doc, updatedAt: new Date().toISOString() };
          const result = { operationId, projectId: id, version: next.version, nodeIds: applied.resultIds };
          await atomicWrite(mapFile(id), json(next)); await atomicWrite(receiptFile, json(result));
          Object.assign(project, { status: 'connected', updatedAt: next.updatedAt }); await atomicWrite(registryFile, json(registry));
          broadcast('map', { projectId: id, version: next.version }); return send(res, 200, result);
        }
      }
      if (req.method === 'GET' && /\/(map-model|workbench-sync)\.mjs$/.test(route)) {
        const file = path.join(root, 'prototype', path.basename(route));
        const source = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(source);
      }
      if (req.method === 'GET' && (route === '/' || route === '/prototype/' || route === '/workbench.html' || /^\/projects\/[^/]+$/.test(route))) {
        if (/^\/projects\//.test(route) && !projectById(decodeURIComponent(route.slice('/projects/'.length)))) throw new MapError('NOT_FOUND', 'Project is missing', 404);
        const projectId = /^\/projects\//.test(route) ? decodeURIComponent(route.slice('/projects/'.length)) : null;
        const scope = projectId ? `projects/${encodeURIComponent(projectId)}` : 'overview';
        const config = JSON.stringify({ token: adminToken, root: `cloud:${projectId || 'overview'}`, protocol: 2, apiBase: `/api/workbench/${scope}` }).replace(/</g, '\\u003c');
        const marker = `<script>window.__CG_SERVER=${config};</script>`;
        const html = (await fs.readFile(htmlPath, 'utf8')).replace('<!-- CG_SERVER_BOOT -->', marker);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
          'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
        });
        return res.end(html);
      }
      throw new MapError('NOT_FOUND', 'Unknown route', 404);
    } catch (error) {
      if (!res.headersSent) send(res, error.status || 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error.message, ...(error.details || {}) } });
      else res.end();
    }
  });
  server.requestTimeout = 15_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const close = () => new Promise((resolve, reject) => { for (const res of clients) res.end(); for (const client of workbenchClients) client.res.end(); server.close(error => error ? reject(error) : resolve()); });
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
