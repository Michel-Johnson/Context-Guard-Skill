import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, scrypt as cryptoScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { applyOperations, entries, validate, MapError } from '../../prototype/map-model.mjs';
import { atomicWrite } from '../workbench/io.mjs';
import { commitSessionMap, createMemoryHandler, readMemoryProject } from './memory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const htmlPath = path.join(root, 'prototype/workbench.html');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const now = () => new Date().toISOString();
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const versionOf = document => digest(JSON.stringify(document));
const newToken = () => randomBytes(32).toString('base64url');
const scrypt = promisify(cryptoScrypt);
const passwordHashPattern = /^scrypt\$([A-Za-z0-9_-]{20,})\$([A-Za-z0-9_-]{80,})$/;
const workbenchCookieMaxAge = 30 * 24 * 60 * 60;

export async function createWorkbenchPasswordHash(password) {
  const value = String(password || '');
  if (!value || Buffer.byteLength(value) > 1024) throw new MapError('INVALID_PASSWORD', 'Password must contain 1–1024 bytes');
  const salt = randomBytes(16);
  const key = await scrypt(value, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(key).toString('base64url')}`;
}

async function verifyWorkbenchPassword(password, encoded) {
  const match = String(encoded || '').match(passwordHashPattern);
  if (!match || Buffer.byteLength(String(password || '')) > 1024) return false;
  const expected = Buffer.from(match[2], 'base64url');
  const actual = Buffer.from(await scrypt(String(password || ''), Buffer.from(match[1], 'base64url'), expected.length));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const validNext = value => {
  const next = String(value || '/');
  if (!next.startsWith('/') || next.startsWith('//')) throw new MapError('INVALID_REDIRECT', 'Invalid redirect');
  return next;
};
const canonicalOrigin = value => {
  try { return new URL(String(value || '')).origin; }
  catch { return ''; }
};

function loginPage({ next = '/', error = '' } = {}) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>登录 · Context Guard</title><style>
:root{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#2d2b28;background:#f7f2e8}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background-image:radial-gradient(#ded4c3 1px,transparent 1px);background-size:22px 22px}
main{width:min(420px,100%);padding:34px;background:#fffdf8;border:3px solid #302f2d;border-radius:18px;box-shadow:7px 7px 0 #302f2d}
h1{margin:0 0 8px;font-size:28px}p{margin:0 0 24px;color:#746d63}label{display:block;margin-bottom:8px;font-weight:700}
input{width:100%;height:48px;padding:0 14px;border:2px solid #302f2d;border-radius:10px;font:inherit;background:#fff}input:focus{outline:3px solid #f1cc58;outline-offset:2px}
button{width:100%;height:48px;margin-top:18px;border:2px solid #302f2d;border-radius:10px;background:#f7cf55;font:inherit;font-weight:800;cursor:pointer;box-shadow:3px 3px 0 #302f2d}
.error{color:#b42318;margin:-10px 0 16px;font-weight:700}
</style></head><body><main><h1>Context Guard</h1><p>输入密码进入项目地图</p>${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ''}
<form method="post" action="/auth/login"><input type="hidden" name="next" value="${escapeHtml(next)}"><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">登录</button></form></main></body></html>`;
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function readJsonLines(file) {
  const text = await fs.readFile(file, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error));
  const lines = text.split('\n').filter(Boolean), values = [];
  for (let index = 0; index < lines.length; index++) {
    try { values.push(JSON.parse(lines[index])); }
    catch (error) {
      if (index !== lines.length - 1) throw error;
      // A crash can leave only the last append incomplete. Repair that tail from
      // the already validated prefix before transaction recovery appends again.
      await atomicWrite(file, values.length ? `${values.map(value => JSON.stringify(value)).join('\n')}\n` : '');
    }
  }
  return values;
}

async function appendJsonLine(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'a', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}

async function durableUnlink(file) {
  await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (process.platform === 'win32') return;
  const directory = await fs.open(path.dirname(file), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
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
  const savedChildren = Array.isArray(stored.document.root.children) ? stored.document.root.children : [];
  const byProject = new Map(savedChildren.map(node => [node?.cloudProjectId || (String(node?.id || '').startsWith('P_') ? String(node.id).slice(2) : ''), node]).filter(([id]) => id));
  const managedIds = new Set(projects.map(project => project.id));
  const projectChildren = generated.root.children.map(generatedNode => {
    const saved = byProject.get(generatedNode.cloudProjectId);
    if (!saved) return generatedNode;
    return {
      ...generatedNode,
      ...saved,
      id: generatedNode.id,
      cloudProjectId: generatedNode.cloudProjectId,
      // Connection state belongs to the registry. Human-authored fields remain.
      state: generatedNode.state,
      children: Array.isArray(saved.children) ? saved.children : [],
    };
  });
  const customChildren = savedChildren.filter(node => {
    const id = node?.cloudProjectId || (String(node?.id || '').startsWith('P_') ? String(node.id).slice(2) : '');
    return !id || !managedIds.has(id);
  });
  return {
    ...stored.document,
    project: '项目地图',
    bootstrap: 'ready',
    root: { ...stored.document.root, id: 'T0', children: [...projectChildren, ...customChildren] },
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
  browserPasswordHash = process.env.CONTEXT_GUARD_CLOUD_PASSWORD_HASH || '',
  privateAccess = process.env.CONTEXT_GUARD_CLOUD_PRIVATE === '1',
  secureCookies = process.env.CONTEXT_GUARD_CLOUD_SECURE_COOKIES === '1',
  publicOrigin = process.env.CONTEXT_GUARD_CLOUD_ORIGIN || '',
  memoryConfig,
  faultInjector = async () => {},
} = {}) {
  const registryFile = path.join(dataDir, 'projects.json');
  const mapsDir = path.join(dataDir, 'maps');
  const eventsDir = path.join(dataDir, 'events');
  const operationsDir = path.join(dataDir, 'operations');
  const worksDir = path.join(dataDir, 'works');
  const transactionsDir = path.join(dataDir, 'transactions');
  const overviewFile = path.join(mapsDir, 'project-overview.json');
  const directoryClients = new Set();
  const workbenchClients = new Set();
  const projectClients = new Map();
  const sockets = new Set();
  const tails = new Map();
  const loginFailures = new Map();
  let registryTail = Promise.resolve();
  const allowedOrigin = canonicalOrigin(publicOrigin);
  if (publicOrigin && !allowedOrigin) throw new MapError('INVALID_ORIGIN', 'CONTEXT_GUARD_CLOUD_ORIGIN must be an absolute HTTP(S) origin');
  if (browserPasswordHash && !passwordHashPattern.test(browserPasswordHash)) throw new MapError('INVALID_PASSWORD_HASH', 'Use a Context Guard scrypt password hash');
  if (browserPasswordHash && !browserToken) throw new MapError('WORKBENCH_TOKEN_REQUIRED', 'Password login requires an independent workbench cookie token');
  const configuredMemory = memoryConfig || (process.env.CONTEXT_GUARD_MEMORY_CONFIG
    ? await readJson(path.resolve(process.env.CONTEXT_GUARD_MEMORY_CONFIG), null)
    : null);
  const memoryHandler = configuredMemory ? createMemoryHandler(configuredMemory) : null;
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
  const transactionFile = (scope, operationId) => path.join(transactionsDir, `${digest(`${scope}:${operationId}`)}.json`);
  const serial = (id, task) => {
    const next = (tails.get(id) || Promise.resolve()).then(task);
    tails.set(id, next.catch(() => {}));
    return next;
  };
  const mutateRegistry = task => {
    const next = registryTail.then(async () => {
      const result = await task();
      await atomicWrite(registryFile, json(registry));
      return result;
    });
    registryTail = next.catch(() => {});
    return next;
  };
  const updateRegistryProject = patch => mutateRegistry(() => {
    const project = projectById(patch.id);
    if (!project) throw new MapError('RECOVERY_REQUIRED', 'Transaction project is missing from the registry', 503);
    Object.assign(project, patch);
    return project;
  });
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(JSON.stringify(body));
  };
  const sendHtml = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', ...headers });
    res.end(body);
  };
  const redirect = (res, location, headers = {}) => { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers }); res.end(); };
  const workbenchCookie = () => ({ 'Set-Cookie': `cg_workbench=${encodeURIComponent(browserToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${workbenchCookieMaxAge}${secureCookies ? '; Secure' : ''}` });
  const clearWorkbenchCookie = () => ({ 'Set-Cookie': `cg_workbench=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies ? '; Secure' : ''}` });
  const requestBody = async req => {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new MapError('CONTENT_TYPE', 'Use application/json', 415);
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new MapError('BODY_TOO_LARGE', 'Request exceeds 16 MiB', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks)); } catch { throw new MapError('INVALID_JSON', 'Malformed JSON', 400); }
  };
  const requestForm = async req => {
    if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) throw new MapError('CONTENT_TYPE', 'Use a form submission', 415);
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024) throw new MapError('BODY_TOO_LARGE', 'Login request is too large', 413); chunks.push(chunk); }
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  };
  const bearer = req => req.headers.authorization?.replace(/^Bearer /, '') || '';
  const requireAdmin = req => {
    if (!adminToken || !safeEqual(bearer(req), adminToken)) throw new MapError('UNAUTHORIZED', 'An admin token is required', 401);
  };
  const requireProject = (req, _url, project) => {
    const credential = bearer(req);
    if (adminToken && safeEqual(credential, adminToken)) return;
    if (!project.tokenHash || !safeEqual(digest(credential), project.tokenHash)) throw new MapError('UNAUTHORIZED', 'A project sync token is required', 401);
  };
  const cookieValue = req => String(req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith('cg_workbench='))?.slice('cg_workbench='.length) || '';
  const decodedCookieValue = req => { try { return decodeURIComponent(cookieValue(req)); } catch { return ''; } };
  const hasWorkbenchAccess = req => {
    const credential = bearer(req) || decodedCookieValue(req);
    return !!browserToken && (safeEqual(credential, browserToken) || adminToken && safeEqual(credential, adminToken));
  };
  const requireWorkbench = (req, url) => {
    if (!hasWorkbenchAccess(req, url)) throw new MapError('UNAUTHORIZED', browserPasswordHash ? 'Sign in before editing the cloud workbench' : 'Open /auth?token=... before editing the cloud workbench', 401);
  };
  const loginKey = req => String(req.socket.remoteAddress || 'unknown');
  const loginBlocked = req => {
    const entry = loginFailures.get(loginKey(req));
    if (!entry) return false;
    if (entry.resetAt <= Date.now()) { loginFailures.delete(loginKey(req)); return false; }
    return entry.count >= 5;
  };
  const recordLoginFailure = req => {
    const key = loginKey(req), previous = loginFailures.get(key), current = previous?.resetAt > Date.now() ? previous : { count: 0, resetAt: Date.now() + 5 * 60_000 };
    current.count += 1; loginFailures.set(key, current);
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
  const createEvent = async (id, input) => ({
    ...input,
    projectId: id,
    seq: (await currentSeq(id)) + 1,
    eventId: input.eventId || randomUUID(),
    at: input.at || now(),
  });
  const appendEventRecord = async event => {
    const events = await readEvents(event.projectId);
    const previous = events.find(item => item.eventId === event.eventId);
    if (previous) {
      if (digest(JSON.stringify(previous)) !== digest(JSON.stringify(event))) throw new MapError('RECOVERY_REQUIRED', 'Event identity has conflicting content', 503, { eventId: event.eventId });
      return previous;
    }
    const lastSeq = events.at(-1)?.seq || 0;
    if (lastSeq + 1 !== event.seq) throw new MapError('RECOVERY_REQUIRED', 'Event sequence cannot be recovered automatically', 503, { expectedSeq: lastSeq + 1, eventSeq: event.seq });
    await appendJsonLine(eventsFile(event.projectId), event);
    return event;
  };
  const broadcastEvent = event => {
    broadcastProject(event);
    broadcastDirectory('map', { projectId: event.projectId, seq: event.seq, version: event.version, type: event.type, at: event.at });
  };
  const recoverTransaction = async transaction => {
    if (transaction?.v !== 1 || !transaction.scope || !transaction.operationId || !transaction.event) {
      throw new MapError('RECOVERY_REQUIRED', 'Cloud transaction record is invalid', 503);
    }
    const file = transactionFile(transaction.scope, transaction.operationId);
    await appendEventRecord(transaction.event);
    await faultInjector('event-persisted', transaction);
    if (transaction.map) {
      const target = transaction.map.target === 'overview' ? overviewFile : mapFile(transaction.map.projectId);
      const stored = await readJson(target, null);
      if (stored?.version !== transaction.map.next.version) {
        if ((stored?.version ?? null) !== (transaction.map.previousVersion ?? null)) {
          throw new MapError('RECOVERY_REQUIRED', 'Map changed while a durable transaction was pending', 503, { projectId: transaction.event.projectId });
        }
        await atomicWrite(target, json(transaction.map.next));
      }
    }
    await faultInjector('map-persisted', transaction);
    if (transaction.registryProject) {
      await updateRegistryProject(transaction.registryProject);
    }
    if (transaction.work) {
      const target = workFile(transaction.work.projectId, transaction.work.workId);
      const stored = await readJson(target, null);
      const storedDigest = stored === null ? null : digest(JSON.stringify(stored));
      const nextDigest = digest(JSON.stringify(transaction.work.next));
      if (storedDigest !== nextDigest) {
        if (storedDigest !== (transaction.work.previousDigest ?? null)) {
          throw new MapError('RECOVERY_REQUIRED', 'Development window changed while a durable transaction was pending', 503, { workId: transaction.work.workId });
        }
        await atomicWrite(target, json(transaction.work.next));
      }
    }
    await faultInjector('work-persisted', transaction);
    if (transaction.receipt) {
      const target = operationFile(transaction.receipt.scope, transaction.operationId);
      const stored = await readJson(target, null);
      if (stored && stored.requestDigest !== transaction.receipt.value.requestDigest) {
        throw new MapError('RECOVERY_REQUIRED', 'Operation receipt conflicts with a pending transaction', 503);
      }
      if (!stored) await atomicWrite(target, json(transaction.receipt.value));
    }
    await faultInjector('receipt-persisted', transaction);
    await durableUnlink(file);
  };
  const recoverTransactions = async projectId => {
    const names = await fs.readdir(transactionsDir).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
    for (const name of names.filter(name => name.endsWith('.json')).sort()) {
      const file = path.join(transactionsDir, name), transaction = await readJson(file, null);
      if (!transaction || projectId && transaction.event?.projectId !== projectId) continue;
      await recoverTransaction(transaction);
    }
  };
  const persistTransaction = async transaction => {
    await atomicWrite(transactionFile(transaction.scope, transaction.operationId), json(transaction));
    await faultInjector('transaction-prepared', transaction);
    await recoverTransaction(transaction);
  };
  await recoverTransactions();
  const projectSnapshot = async project => {
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
  const sessionSnapshot = async (project, viewId) => {
    if (!configuredMemory?.projects?.[project.id]) throw new MapError('UNKNOWN_VIEW', 'Private Session memory is not configured for this project', 404);
    const sessionId = viewId.slice('session:'.length);
    const snapshot = (await readMemoryProject(configuredMemory, project.id)).sessions[sessionId];
    if (!snapshot) throw new MapError('UNKNOWN_VIEW', 'Session memory is not available', 404);
    return { version: snapshot.version, document: snapshot.memory.map, source: { status: 'session', sessionId, sourceCommit: snapshot.sourceCommit, baseMainVersion: snapshot.baseMainVersion, updatedAt: snapshot.updatedAt || null } };
  };
  const scopedWorkbenchState = async (scope, project, viewId = 'main') => {
    const snapshot = viewId.startsWith('session:') ? await sessionSnapshot(project, viewId) : await workbenchSnapshot(scope, project);
    return { version: snapshot.version, doc: snapshot.document, viewId, source: snapshot.source || null, projection: { status: 'ready', sourceVersion: snapshot.version }, recovery: false, error: null };
  };
  const memorySessions = async project => {
    if (!configuredMemory?.projects?.[project.id]) return [];
    const state = await readMemoryProject(configuredMemory, project.id);
    const names = await fs.readdir(path.join(worksDir, project.id)).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
    const works = [];
    for (const name of names.filter(name => name.endsWith('.json'))) {
      const work = await readJson(path.join(worksDir, project.id, name), null);
      if (work?.sessionId) works.push(work);
    }
    return Object.values(state.sessions).map(snapshot => {
      const latest = works.filter(work => work.sessionId === snapshot.sessionId).sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))[0];
      return { id: snapshot.sessionId, name: '', platform: 'agent', status: latest?.status === 'working' ? 'active' : 'completed', lastSeen: snapshot.updatedAt || latest?.startedAt || '' };
    }).sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
  };
  const broadcastWorkbench = async (scope, project, viewId = 'main') => {
    const state = await scopedWorkbenchState(scope, project, viewId);
    for (const client of workbenchClients) {
      if (client.res.destroyed) { workbenchClients.delete(client); continue; }
      if (client.scope === `${scope}|${viewId}`) client.res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    }
  };
  const validateOperationId = input => {
    const operationId = String(input.operationId || '');
    if (!operationId || operationId.length > 160) throw new MapError('INVALID_OPERATION', 'operationId is required');
    return operationId;
  };
  const commitProject = (project, input, actor = { kind: 'human', sessionId: 'cloud-sync' }) => serial(project.id, async () => {
    const operationId = validateOperationId(input);
    await recoverTransactions(project.id);
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
    const event = await createEvent(project.id, {
      type: 'map.committed', operationId, actor, baseVersion: current.version, version,
      operations: input.operations, scope: scopeOfOperations(input.operations, input.scope),
    });
    const next = { projectId: project.id, version, seq: event.seq, document: applied.doc, updatedAt: event.at };
    const result = { committed: true, operationId, projectId: project.id, version, seq: event.seq, nodeIds: applied.resultIds, persistedAt: event.at };
    await persistTransaction({
      v: 1, scope: project.id, operationId, event,
      map: { target: 'project', projectId: project.id, previousVersion: current.version, next },
      registryProject: { id: project.id, status: 'connected', updatedAt: event.at },
      receipt: { scope: project.id, value: { requestDigest, result } },
    });
    broadcastEvent(event);
    await broadcastWorkbench(`project:${project.id}`, project);
    return result;
  });
  const saveSnapshot = (project, input) => serial(project.id, async () => {
    const operationId = validateOperationId(input);
    await recoverTransactions(project.id);
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
    const event = await createEvent(project.id, { type: 'map.snapshot', operationId, actor: { kind: 'sync', sessionId: String(input.sessionId || '') }, baseVersion: current.version, version, operations: [], scope: normalizeScope({ wildcard: true }) });
    const next = { projectId: project.id, version, seq: event.seq, document: input.document, updatedAt: event.at };
    const result = { committed: true, operationId, projectId: project.id, version, seq: event.seq, snapshot: true, persistedAt: event.at };
    await persistTransaction({
      v: 1, scope: `${project.id}:snapshot`, operationId, event,
      map: { target: 'project', projectId: project.id, previousVersion: current.version, next },
      registryProject: { id: project.id, status: 'connected', updatedAt: event.at },
      receipt: { scope: `${project.id}:snapshot`, value: { requestDigest, result } },
    });
    broadcastEvent(event);
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
      const passwordLoginRequest = route === '/auth/login' && req.method === 'POST';
      if (!passwordLoginRequest && allowedOrigin && req.headers.origin && canonicalOrigin(req.headers.origin) !== allowedOrigin) throw new MapError('ORIGIN_REJECTED', 'Cross-origin request rejected', 403);
      if (memoryHandler && await memoryHandler(req, res)) return;
      if (route === '/login' && req.method === 'GET') {
        if (!browserPasswordHash) throw new MapError('NOT_FOUND', 'Password login is not configured', 404);
        const next = validNext(url.searchParams.get('next') || '/');
        if (hasWorkbenchAccess(req, url)) return redirect(res, next);
        return sendHtml(res, 200, loginPage({ next }));
      }
      if (route === '/auth/login' && req.method === 'POST') {
        if (!browserPasswordHash) throw new MapError('NOT_FOUND', 'Password login is not configured', 404);
        const input = await requestForm(req), next = validNext(input.get('next') || '/');
        if (loginBlocked(req)) return sendHtml(res, 429, loginPage({ next, error: '尝试次数过多，请五分钟后再试' }), { 'Retry-After': '300' });
        if (!await verifyWorkbenchPassword(input.get('password'), browserPasswordHash)) {
          recordLoginFailure(req);
          return sendHtml(res, 401, loginPage({ next, error: '密码错误' }));
        }
        loginFailures.delete(loginKey(req));
        return redirect(res, next, workbenchCookie());
      }
      if (route === '/auth/logout' && req.method === 'POST') return redirect(res, '/login', clearWorkbenchCookie());
      if (route === '/auth' && req.method === 'GET') {
        if (!browserToken || !safeEqual(url.searchParams.get('token'), browserToken)) throw new MapError('UNAUTHORIZED', 'Invalid workbench token', 401);
        const next = validNext(url.searchParams.get('next') || '/');
        return redirect(res, next, workbenchCookie());
      }
      const workbench = route.match(/^\/api\/workbench\/(overview|projects\/([^/]+))(\/.*)$/);
      if (workbench) {
        const scope = workbench[1] === 'overview' ? 'overview' : `project:${decodeURIComponent(workbench[2])}`;
        const project = workbench[2] ? projectById(decodeURIComponent(workbench[2])) : null;
        if (workbench[2] && !project) throw new MapError('NOT_FOUND', 'Project is missing', 404);
        const viewId = String(url.searchParams.get('view') || 'main');
        if (viewId !== 'main' && (!project || !viewId.startsWith('session:'))) throw new MapError('UNKNOWN_VIEW', 'Select Main or a project Session', 404);
        const action = workbench[3];
        if (action === '/bootstrap' && req.method === 'GET') { requirePrivateRead(req, url); return send(res, 200, { root: `cloud:${scope}`, protocol: 3, apiBase: route.slice(0, -'/bootstrap'.length), authenticated: !!cookieValue(req) }); }
        requireWorkbench(req, url);
        if (action === '/api/state' && req.method === 'GET') {
          const state = await scopedWorkbenchState(scope, project, viewId);
          return send(res, 200, { ...state, actor: { kind: 'human', sessionId: 'cloud-workbench' }, grants: state.doc?.root ? [...entries(state.doc.root).keys()] : [] }, workbenchCookie());
        }
        if (action === '/api/events' && req.method === 'GET') {
          const client = { scope: `${scope}|${viewId}`, res }; workbenchClients.add(client);
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...workbenchCookie() });
          res.write(`retry: 1000\nevent: state\ndata: ${JSON.stringify(await scopedWorkbenchState(scope, project, viewId))}\n\n`);
          req.on('close', () => workbenchClients.delete(client)); return;
        }
        if (action === '/api/access' && req.method === 'GET') {
          if (!project) return send(res, 200, { sessions: [], grants: {}, currentSessionId: null });
          const sessions = await memorySessions(project), grants = {};
          const memory = configuredMemory?.projects?.[project.id] ? await readMemoryProject(configuredMemory, project.id) : null;
          for (const session of sessions) grants[session.id] = { nodes: [...entries(memory.sessions[session.id].memory.map.root).keys()] };
          return send(res, 200, { sessions, grants, currentSessionId: null, project: { id: project.id, kind: 'git', main: { status: 'ready' } } });
        }
        if (action === '/api/presence' && req.method === 'POST') {
          const input = await requestBody(req), state = await scopedWorkbenchState(scope, project, viewId);
          return send(res, 200, { version: state.version, synchronized: input.version === state.version && !input.dirty, error: null, recovery: false });
        }
        if (action === '/api/commit' && req.method === 'POST') {
          const input = await requestBody(req);
          if (viewId.startsWith('session:')) {
            const result = await commitSessionMap(configuredMemory, project.id, viewId.slice('session:'.length), input);
            await broadcastWorkbench(scope, project, viewId);
            return send(res, 200, result);
          }
          if (project) return send(res, 200, await commitProject(project, input, { kind: 'human', sessionId: 'cloud-workbench' }));
          const result = await serial('overview', async () => {
            await recoverTransactions('overview');
            const operationId = validateOperationId(input), receiptPath = operationFile('overview', operationId);
            const requestDigest = digest(JSON.stringify({ baseVersion: input.baseVersion, operations: input.operations }));
            const previous = await readJson(receiptPath, null);
            if (previous) { if (previous.requestDigest !== requestDigest) throw new MapError('ID_REUSED', 'operationId belongs to another request', 409); return previous.result; }
            const current = await workbenchSnapshot('overview', null);
            if (input.baseVersion !== current.version) throw new MapError('VERSION_CONFLICT', 'Map changed; reload before committing', 409, { currentVersion: current.version });
            const applied = applyOperations(current.document, input.operations, { kind: 'human', sessionId: 'cloud-workbench' }); validate(applied.doc);
            const stored = await readJson(overviewFile, null), version = versionOf(applied.doc);
            const event = await createEvent('overview', {
              type: 'map.committed', operationId, actor: { kind: 'human', sessionId: 'cloud-workbench' },
              baseVersion: current.version, version, operations: input.operations,
              scope: scopeOfOperations(input.operations),
            });
            const next = { projectId: 'overview', version, seq: event.seq, document: applied.doc, updatedAt: event.at };
            const saved = { committed: true, operationId, version, seq: event.seq, nodeIds: applied.resultIds, persistedAt: event.at };
            await persistTransaction({
              v: 1, scope: 'overview', operationId, event,
              map: { target: 'overview', previousVersion: stored?.version ?? null, next },
              receipt: { scope: 'overview', value: { requestDigest, result: saved } },
            });
            broadcastEvent(event);
            return saved;
          });
          await broadcastWorkbench('overview', null); return send(res, 200, result);
        }
        if (action === '/api/projections' && req.method === 'POST') return send(res, 200, { status: 'ready', sourceVersion: (await scopedWorkbenchState(scope, project, viewId)).version });
        throw new MapError('NOT_FOUND', 'Unsupported cloud workbench route', 404);
      }
      if (route === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, service: 'context-guard-cloud', protocol: 3, ...(privateAccess ? {} : { projects: registry.projects.length }) });
      if (route === '/.codex/context/preferences.json' && req.method === 'GET') { requirePrivateRead(req, url); return send(res, 200, { display_language: 'zh' }); }
      if (route === '/.codex/context/map.json' && req.method === 'GET') {
        requirePrivateRead(req, url);
        const page = String(req.headers.referer || '').match(/\/projects\/([^/?#]+)/);
        if (!page) return send(res, 200, (await workbenchSnapshot('overview', null)).document);
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
        await mutateRegistry(() => {
          if (projectById(project.id)) throw new MapError('PROJECT_EXISTS', 'Project already exists', 409);
          registry.projects.push(project);
        });
        broadcastDirectory('projects', { projectId: project.id });
        return send(res, 201, { project: publicProject(project), syncToken: rawToken });
      }
      const projectRoute = route.match(/^\/api\/projects\/([^/]+)(?:\/(map|snapshot|commits|events|changes|enrollments|work\/prepare|work\/finish|work\/checkpoint))?$/);
      if (projectRoute) {
        const project = projectById(decodeURIComponent(projectRoute[1]));
        if (!project) throw new MapError('NOT_FOUND', 'Project is missing', 404);
        const action = projectRoute[2];
        if (!action && req.method === 'GET') { requirePrivateRead(req, url); return send(res, 200, { project: publicProject(project) }); }
        if (action === 'enrollments' && req.method === 'POST') {
          requireAdmin(req, url); const syncToken = newToken();
          await updateRegistryProject({ id: project.id, tokenHash: digest(syncToken), updatedAt: now() });
          return send(res, 201, { projectId: project.id, syncToken });
        }
        if (action === 'map' && req.method === 'GET') { if (privateAccess) { const credential = bearer(req); if (!(adminToken && safeEqual(credential, adminToken)) && !(project.tokenHash && safeEqual(digest(credential), project.tokenHash))) requirePrivateRead(req, url); } return send(res, 200, await projectSnapshot(project)); }
        requireProject(req, url, project);
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
            await recoverTransactions(project.id);
            const workId = String(input.workId || randomUUID());
            if (!/^[\w:.-]{8,160}$/.test(workId)) throw new MapError('INVALID_WORK_ID', 'Use a stable workId (8–160 characters)');
            const existing = await readJson(workFile(project.id, workId), null);
            if (existing) return existing;
            const snapshot = await projectSnapshot(project);
            const scope = normalizeScope(input.scope);
            if (!scope.nodeIds.length && !scope.paths.length) scope.wildcard = true;
            const event = await createEvent(project.id, { type: 'work.started', workId, actor: { kind: 'agent', sessionId: String(input.sessionId || '') }, version: snapshot.version, scope });
            const work = { workId, projectId: project.id, sessionId: String(input.sessionId || ''), status: 'working', baseSeq: event.seq, baseVersion: snapshot.version, scope, startedAt: event.at };
            await persistTransaction({
              v: 1, scope: `work:${project.id}`, operationId: workId, event,
              work: { projectId: project.id, workId, previousDigest: null, next: work },
            });
            broadcastEvent(event);
            return work;
          });
          return send(res, 200, result);
        }
        if ((action === 'work/checkpoint' || action === 'work/finish') && req.method === 'POST') {
          const input = await requestBody(req), workId = String(input.workId || '');
          const result = await serial(project.id, async () => {
            await recoverTransactions(project.id);
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
            const event = await createEvent(project.id, { type: 'work.completed', workId, operationId: input.operationId || `finish:${workId}`, actor: { kind: 'agent', sessionId: work.sessionId }, baseVersion: current.version, version, operations: input.operations || [], scope });
            const completed = { workId, projectId: project.id, status: 'completed', version, seq: event.seq, nodeIds, completedAt: event.at, rebased: current.version !== work.baseVersion };
            const nextWork = { ...work, status: 'completed', result: completed, completedAt: event.at };
            await persistTransaction({
              v: 1, scope: `work:${project.id}`, operationId: `finish:${workId}`, event,
              ...(document ? { map: { target: 'project', projectId: project.id, previousVersion: current.version, next: { projectId: project.id, version, seq: event.seq, document, updatedAt: event.at } } } : {}),
              work: { projectId: project.id, workId, previousDigest: digest(JSON.stringify(work)), next: nextWork },
              registryProject: { id: project.id, status: 'connected', updatedAt: event.at },
            });
            broadcastEvent(event);
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
        if (privateAccess && browserPasswordHash && !hasWorkbenchAccess(req, url)) return redirect(res, `/login?next=${encodeURIComponent(`${route}${url.search}`)}`);
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
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.requestTimeout = 15_000;
  const heartbeat = setInterval(() => {
    for (const set of projectClients.values()) for (const res of set) if (!res.destroyed) res.write(': heartbeat\n\n');
    for (const res of directoryClients) if (!res.destroyed) res.write(': heartbeat\n\n');
  }, 15_000); heartbeat.unref();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  let closing;
  const close = () => closing ||= new Promise((resolve, reject) => {
    clearInterval(heartbeat);
    for (const res of directoryClients) res.end();
    for (const client of workbenchClients) client.res.end();
    for (const set of projectClients.values()) for (const res of set) res.end();
    server.close(error => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    });
    server.closeIdleConnections?.();
    const forceClose = setTimeout(() => {
      server.closeAllConnections?.();
      for (const socket of sockets) socket.destroy();
    }, 250);
    forceClose.unref();
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
