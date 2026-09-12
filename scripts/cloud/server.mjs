import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, scrypt as cryptoScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { applyOperations, assignmentScope, entries, validate, MapError, scopeDocumentToSession, filterNodeAccess } from '../shared/map-model.mjs';
import { atomicWrite } from '../shared/io.mjs';
import { commitMainMemoryMap, commitSessionMap, createMemoryHandler, memoryPublicationStatus, publishSessionMemory, readMemoryView as readMemoryProject, memoryHeads, memoryHub } from './memory.mjs';
import { WorkbenchSnapshots } from '../shared/protocol-snapshots.mjs';
import { verifyChangeReferences } from '../shared/protocol-map.mjs';
import { ProtocolAuth } from './protocol-auth.mjs';
import { ProtocolStore } from '../shared/protocol-store.mjs';
import { reviewInput, reviewOperations, pendingReviewFeedback } from './task-review.mjs';
import { ProtocolBlobs, serveBlob } from '../shared/protocol-blobs.mjs';
import { validateMessage, errorReply, fail as protocolFail, MAX_MESSAGE_BYTES } from '../shared/protocol.mjs';
import { CoordinatorModel } from './coordinator-model.mjs';
import { CoordinatorService, CoordinatorInbox, CoordinatorMapIntake, CoordinatorConversations } from './coordinator-service.mjs';
import { coordinatorTools, coordinatorReferences, createCoordinatorExecutor } from './coordinator-tools.mjs';
import { verifyTaskCompletion, verifyTaskClose } from './completion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const htmlPath = path.join(root, 'prototype/workbench.html');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const now = () => new Date().toISOString();
const digest = value => createHash('sha256').update(String(value)).digest('hex');
export function applyCoordinatorAssignments(document, assignments) {
  if (!document?.root || !assignments?.size) return document;
  const projectItems = node => ({ ...node,
    // The map snapshot can contain the dispatch receipt from before the
    // Coordinator advanced the task.  Always overlay the current assignment
    // so a stale `pending` receipt cannot mask an executing/awaiting-merge
    // task in the workbench.  This is a read-only projection; the source map
    // remains unchanged.
    todos: (node.todos || []).map(item => assignments.has(`${node.id}:todo:${item.id}`)
      ? { ...item, dispatch: { ...(item.dispatch || {}), ...assignments.get(`${node.id}:todo:${item.id}`) } } : item),
    bugs: (node.bugs || []).map(item => assignments.has(`${node.id}:bug:${item.id}`)
      ? { ...item, dispatch: { ...(item.dispatch || {}), ...assignments.get(`${node.id}:bug:${item.id}`) } } : item),
    children: (node.children || []).map(projectItems),
  });
  return { ...document, root: projectItems(document.root) };
}
const versionOf = document => digest(JSON.stringify(document));
const newToken = () => randomBytes(32).toString('base64url');
const scrypt = promisify(cryptoScrypt);
const passwordHashPattern = /^scrypt\$([A-Za-z0-9_-]{20,})\$([A-Za-z0-9_-]{80,})$/;
const workbenchCookieMaxAge = 30 * 24 * 60 * 60;
const sessionActivityTtlMs = 2 * 60 * 1000;
const sessionHeartbeatTtlMs = 30 * 1000;
const compactText = (value, limit = 2000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);

function cloudWorkItemBrief(node, item, kind) {
  const label = kind === 'bug' ? 'Bug' : 'TODO';
  const title = compactText(item.title), description = compactText(item.desc || item.description);
  return [
    `${label} ${compactText(item.id, 128)}｜${compactText(node.title, 128)}`,
    description && description.startsWith(title) ? description : [title, description].filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n');
}

export function cloudSessionActivity({ lifecycleEvent = '', workStatus = '', lastSeen = '' } = {}, currentTime = Date.now(), ttlMs = sessionActivityTtlMs) {
  if (['stop', 'stop-blocked', 'interrupt'].includes(lifecycleEvent) || workStatus === 'completed') return 'stopped';
  const seen = Date.parse(lastSeen);
  if (['session-start', 'user-prompt-submit'].includes(lifecycleEvent) || workStatus === 'working') {
    return Number.isFinite(seen) && currentTime - seen <= ttlMs ? 'active' : 'unknown';
  }
  return 'unknown';
}

export function cloudSessionPresence(lastHeartbeatAt = '', currentTime = Date.now(), ttlMs = sessionHeartbeatTtlMs) {
  const seen = Date.parse(lastHeartbeatAt);
  return Number.isFinite(seen) && currentTime - seen <= ttlMs ? 'online' : 'offline';
}

// Presence is a transport fact, not a claim that the native worker is alive.
// Keep the reason alongside the state so clients do not have to infer a stale
// heartbeat from an old lifecycle/session record.
export function cloudSessionConnection(lastHeartbeatAt = '', currentTime = Date.now(), ttlMs = sessionHeartbeatTtlMs) {
  const state = cloudSessionPresence(lastHeartbeatAt, currentTime, ttlMs);
  return {
    state,
    lastHeartbeatAt: String(lastHeartbeatAt || ''),
    reason: state === 'online' ? 'heartbeat' : lastHeartbeatAt ? 'heartbeat-expired' : 'never-seen',
  };
}

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

export async function authorizeCiReceiver({ principal, ciSessionId, message, receivers, store, templates = [] }) {
  const receiver = receivers?.[ciSessionId];
  if (principal.role !== 'device' || !receiver || !message.session?.id) protocolFail('FORBIDDEN', 'CI receiver is not assigned to this task Session');
  const executorId = message.session.id;
  if (executorId !== receiver.executorSessionId && (!templates.includes(receiver.executorSessionId) ||
      await store.creationTemplate(principal, executorId) !== receiver.executorSessionId)) protocolFail('FORBIDDEN', 'CI receiver is not assigned to this task Session');
  if (!['object.read', 'object.put', 'ci.result'].includes(message.type) || message.type === 'object.put' &&
      (message.payload.kind !== 'evidence' || !message.payload.ref.startsWith(`ci:${ciSessionId}:`))) protocolFail('FORBIDDEN', 'CI may only read task references and write its own test evidence/result');
  const ciBinding = await store.registeredBinding(principal, ciSessionId);
  const executorBinding = await store.registeredBinding(principal, executorId);
  if (!ciBinding || ciBinding.worktreeId !== receiver.worktreeId || !executorBinding || executorBinding.worktreeId === ciBinding.worktreeId) protocolFail('FORBIDDEN', 'CI must use its registered independent worktree on the owning device');
  return { ...principal, agentId: ciSessionId, role: 'ci', bindings: { [executorId]: executorBinding.worktreeId } };
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
  protocolConfig,
  coordinatorModelFactory = config => new CoordinatorModel(config),
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
  const memoryHandler = configuredMemory ? createMemoryHandler(configuredMemory, { authorizeDevice: async ({ credential, projectId, sessionId, scope, method }) => {
    if (!interfaceAuth) return false;
    const principal = await interfaceAuth.authenticate(credential);
    const repository = interfaceConfig.repositories.find(item => item.repositoryId === principal.repositoryId);
    if (principal.role !== 'device' || repository?.projectId !== projectId) return false;
    if (sessionId) return !!await interfaceStorage(principal).store.registeredBinding(principal, sessionId);
    return ['GET', 'POST'].includes(method) && ['main', 'preferences'].includes(scope) &&
      (method === 'GET' || scope === 'preferences');
  } }) : null;
  const interfaceConfig = protocolConfig || configuredMemory?.interfaceV2;
  const interfaceStores = new Map();
  const interfaceStreams = new Set();
  const interfacePresence = new Map();
  const presenceKey = (repositoryId, sessionId) => `${repositoryId}\0${sessionId}`;
  const interfaceMapHeads = async principal => {
    const repository = interfaceConfig?.repositories?.find(item => item.repositoryId === principal.repositoryId);
    if (!repository?.projectId || !configuredMemory?.projects?.[repository.projectId]) return {};
    return memoryHeads(configuredMemory, repository.projectId);
  };
  const interfaceStorage = principal => {
    const directory = path.join(dataDir, 'interface-v2', digest(principal.repositoryId));
    if (!interfaceStores.has(principal.repositoryId)) interfaceStores.set(principal.repositoryId, {
      store: new ProtocolStore(directory), blobs: new ProtocolBlobs(path.join(directory, 'blobs')), snapshots: new WorkbenchSnapshots(path.join(directory, 'snapshots')),
    });
    return interfaceStores.get(principal.repositoryId);
  };
  const interfaceProject = project => {
    const repository = interfaceConfig?.repositories?.find(item => item.projectId === project?.id && /^\d+$/.test(item.repositoryId));
    if (!repository) protocolFail('UNAVAILABLE', 'Cloud task delivery is not configured for this project');
    const principal = { repositoryId: repository.repositoryId, deviceId: 'cloud-browser', agentId: 'cloud-human', role: 'human' };
    return { repository, principal, ...interfaceStorage(principal) };
  };
  const verifyInterfaceRouting = async (identity, message) => {
    const repository = interfaceConfig?.repositories?.find(item => item.repositoryId === identity.repositoryId);
    if (!repository?.projectId || !configuredMemory?.projects?.[repository.projectId]) return false;
    const memory = await readMemoryProject(configuredMemory, repository.projectId);
    if (!memory.main?.memory?.map?.root || memory.main.version !== message.payload.mainVersion) return false;
    const doc = memory.main.memory.map;
    const binding = await interfaceStorage(identity).store.registeredBinding(identity, message.session.id);
    const readable = filterNodeAccess(doc, [...entries(doc.root).keys()], binding.agentId, 'read');
    return message.payload.nodeIds.every(id => readable.includes(id));
  };
  const interfaceWorkflow = {
    verifyRouting: verifyInterfaceRouting,
    verifyCompletion: async (identity, task, receipts) => {
      const repository = interfaceConfig?.repositories?.find(item => item.repositoryId === identity.repositoryId);
      const project = configuredMemory?.projects?.[repository?.projectId];
      if (!project?.completion) return false;
      return verifyTaskCompletion({ project, repositoryId: identity.repositoryId, task, receipts,
        memory: await readMemoryProject(configuredMemory, repository.projectId) });
    },
    verifyClose: verifyTaskClose,
  };
  const interfaceAuth = interfaceConfig ? new ProtocolAuth({
    directory: path.join(dataDir, 'interface-v2'),
    verifyPassword: password => verifyWorkbenchPassword(password, browserPasswordHash),
    authorizeRepository: slug => {
      const repository = interfaceConfig.repositories?.find(item => item.slug === slug);
      return repository && /^\d+$/.test(repository.repositoryId) ? repository.repositoryId : null;
    },
    resolveIdentity: (slug, clientId) => {
      const repository = interfaceConfig.repositories?.find(item => item.slug === slug);
      const client = repository?.clients?.[clientId];
      if (!client || client.disabled || client.role === 'human' || !/^\d+$/.test(repository.repositoryId)) return null;
      return { repositoryId: repository.repositoryId, repositorySlug: slug, clientId, deviceId: client.deviceId, agentId: client.agentId, role: client.role || 'executor', bindings: client.bindings || {}, nodeIds: client.nodeIds || null };
    },
  }) : null;
  let registry = await readJson(registryFile, null);
  if (!registry) {
    registry = { v: 2, projects: [compactProject({ id: 'context-guard', name: 'Context Guard', description: 'Context Guard 项目地图' })] };
    await atomicWrite(registryFile, json(registry));
  }

  const projectById = id => registry.projects.find(project => project.id === id);
  const coordinators = new Map();
  const conversationsFor = project => new CoordinatorConversations(path.join(dataDir, 'coordinators', project.id));
  const itemConversation = async (project, { nodeId, kind, itemId }) => {
    const config = configuredMemory?.projects?.[project.id]?.coordinator;
    if (!config?.enabled) protocolFail('FORBIDDEN', 'Coordinator is not enabled');
    const snapshot = await readMemoryProject(configuredMemory, project.id);
    const node = entries(snapshot.main.memory.map.root).get(nodeId)?.node;
    const item = node?.[kind === 'todo' ? 'todos' : kind === 'bug' ? 'bugs' : '']?.find(item => item.id === itemId);
    if (!item || config.nodeIds && !config.nodeIds.includes(nodeId)) protocolFail('FORBIDDEN', 'Map item is not available');
    return conversationsFor(project).ensure({ nodeId, kind, item });
  };
  const mapIntakeFor = (project, service) => new CoordinatorMapIntake({
    directory: path.join(dataDir, 'coordinators', project.id), service,
    onItem: async entry => {
      const conversations = conversationsFor(project), id = await conversations.ensure(entry);
      const dispatch = entry.item.dispatch;
      if (dispatch?.session_id && dispatch.task_id) await conversations.bind(id, dispatch.session_id, dispatch.task_id);
    },
    read: () => readMemoryProject(configuredMemory, project.id),
    nodeIds: configuredMemory.projects[project.id].coordinator.nodeIds || null,
  });
  const coordinatorFor = async (project, conversationId = 'legacy') => {
    const config = configuredMemory?.projects?.[project.id]?.coordinator;
    if (!config?.enabled) throw new MapError('COORDINATOR_DISABLED', 'Coordinator is not enabled for this project', 404);
    const conversations = conversationsFor(project), conversation = await conversations.get(conversationId);
    const key = `${project.id}:${conversationId}`;
    if (!coordinators.has(key)) {
      const creating = (async () => {
        if (!path.isAbsolute(config.providerFile || '') || !config.bindings || typeof config.bindings !== 'object') throw new MapError('INVALID_COORDINATOR_CONFIG', 'Configure provider and explicit Session bindings', 503);
        const { repository, store, principal: human } = interfaceProject(project);
        const bindings = { ...config.bindings };
        const refreshBindings = async () => {
          const next = { ...config.bindings };
          for (const item of await store.sessionCreations(human)) {
            if (item.state !== 'registered' || !config.sessionTemplates?.includes(item.templateSessionId)) continue;
            const binding = await store.registeredBinding(human, item.sessionId);
            if (binding?.worktreeId === item.worktreeId && binding.generation === item.generation) next[item.sessionId] = item.worktreeId;
          }
          for (const id of Object.keys(bindings)) if (!Object.hasOwn(next, id)) delete bindings[id];
          Object.assign(bindings, next);
          return Object.keys(bindings);
        };
        const principal = { repositoryId: repository.repositoryId, deviceId: 'cloud-coordinator', agentId: conversationId === 'legacy' ? `coordinator:${project.id}` : `coordinator:${conversationId}`, role: 'coordinator', bindings, nodeIds: config.nodeIds || null };
        const assertTask = async (sessionId, taskId) => {
          if (await conversations.owner(sessionId, taskId) !== conversationId) protocolFail('FORBIDDEN', 'Task belongs to another conversation');
        };
        const sessionFor = async id => {
          await refreshBindings();
          if (!Object.hasOwn(bindings, id)) protocolFail('FORBIDDEN', 'This Session is not assigned to the Coordinator');
          const binding = await store.registeredBinding(principal, id);
          if (!binding) protocolFail('NOT_FOUND', 'Session is not registered');
          return { id, generation: binding.generation };
        };
        const references = new Set(coordinatorReferences);
        const execute = createCoordinatorExecutor({
          listSessions: async () => {
            const sessions = [];
            for (const id of await refreshBindings()) {
              const binding = await store.registeredBinding(principal, id);
              if (binding && binding.worktreeId === bindings[id]) sessions.push({ id, generation: binding.generation, worktreeId: binding.worktreeId, name: binding.name || '', platform: binding.platform || '' });
            }
            return { sessions };
          },
          readMap: async id => {
            const memory = await readMemoryProject(configuredMemory, project.id);
            const snapshot = memory.main;
            id ||= snapshot?.memory?.map?.root?.id;
            const node = snapshot?.memory?.map?.root && entries(snapshot.memory.map.root).get(id)?.node;
            if (!node || Array.isArray(config.nodeIds) && !config.nodeIds.includes(id)) protocolFail('FORBIDDEN', 'Requested Main node is not in the Coordinator scope');
            const { children = [], ...fields } = node;
            return { version: snapshot.version, mainSha: snapshot.mainSha, node: { ...fields, children: children.map(child => ({ id: child.id, title: child.title, purpose: child.purpose })) } };
          },
          readReference: async name => {
            if (!references.has(name)) protocolFail('FORBIDDEN', 'Reference is not available to the Coordinator');
            const text = await fs.readFile(path.join(root, 'references', name), 'utf8');
            return { name, version: digest(text), text };
          },
          readTask: async (id, taskId) => { await assertTask(id, taskId); return store.taskRecord(principal, await sessionFor(id), taskId); },
          exchange: async (sessionId, id, type, payload) => {
            const message = validateMessage({ v: 2, id, type, session: await sessionFor(sessionId), payload });
            if (type === 'brief.submit') {
              const existing = (await store.workflowTasks(principal, message.session)).find(task => task.id === payload.taskId);
              if (existing) await assertTask(sessionId, payload.taskId);
              await conversations.bind(conversationId, sessionId, payload.taskId);
            }
            if (payload.taskId) await assertTask(sessionId, payload.taskId);
            return (await store.handle(principal, message, { workflow: interfaceWorkflow })).data;
          },
        });
        const system = await fs.readFile(path.join(root, 'Coordinator.md'), 'utf8') + (conversationId === 'legacy' ? '' :
          `\n本对话仅负责这一 Map 事项：${JSON.stringify(conversation)}。先读取该节点的最新原文；不要处理其他事项。`);
        const directory = conversationId === 'legacy' ? conversations.directory : path.join(conversations.directory, 'items', conversationId);
        const service = new CoordinatorService({ directory, namespace: conversationId === 'legacy' ? '' : conversationId,
          model: coordinatorModelFactory(await readJson(config.providerFile)), system, tools: coordinatorTools, execute, simulated: config.simulated === true });
        const intake = conversationId === 'legacy' ? mapIntakeFor(project, { submit: async (request, options) => {
          const item = JSON.parse(request.text), id = await itemConversation(project, item);
          return (await coordinatorFor(project, id)).submit(request, options);
        } }) : null;
        await intake?.initialize();
        service.bindings = bindings; service.refreshBindings = refreshBindings;
        service.inbox = conversationId !== 'legacy' ? {
          lastError: null, close: async () => {}, pump: async () => (await coordinatorFor(project)).inbox.pump(),
        } : new CoordinatorInbox({ store, principal, sessionIds: refreshBindings, service,
          services: async () => Promise.all((await conversations.list()).map(item => coordinatorFor(project, item.id))),
          autoResume: async ({ session, taskId, messageId, reason }) => {
            const current = await store.taskRecord(principal, session, taskId);
            if (current.stage !== 'interrupted' || !current.busy) return { skipped: true, stage: current.stage };
            return (await store.handle(principal, { v: 2, id: `auto-resume:${messageId}`, type: 'task.control', session,
              payload: { taskId, action: 'resume', expectedVersion: current.version,
                data: { reason: `自动恢复中断任务${reason ? `：${reason}` : ''}` } } }, { workflow: interfaceWorkflow })).data;
          },
          routeEvent: async (type, payload, session) => {
            let taskId = payload.taskId;
            if (!taskId && type === 'review.result') {
              const object = await store.handle(principal, { v: 2, id: randomUUID(), type: 'object.read', session,
                payload: { ref: payload.ref, version: payload.version } });
              taskId = object.data.content.taskId;
            }
            return coordinatorFor(project, await conversations.owner(session.id, taskId));
          },
          intake, memoryEvents: memoryHub(configuredMemory), projectId: project.id });
        service.kick();
        return service;
      })();
      coordinators.set(key, creating);
      creating.catch(() => { if (coordinators.get(key) === creating) coordinators.delete(key); });
    }
    return coordinators.get(key);
  };
  const recoverInterruptedTasks = async project => {
    const config = configuredMemory?.projects?.[project.id]?.coordinator;
    if (!config?.enabled) return;
    const { store, principal } = interfaceProject(project);
    for (const id of Object.keys(config.bindings || {})) {
      const binding = await store.registeredBinding(principal, id);
      if (!binding) continue;
      const session = { id, generation: binding.generation };
      for (const task of await store.workflowTasks(principal, session)) {
        if (task.stage !== 'interrupted' || !task.busy) continue;
        const messageId = `auto-resume-startup:${digest(JSON.stringify([project.id, id, session.generation, task.id, task.version]))}`;
        await store.handle(principal, { v: 2, id: messageId, type: 'task.control', session,
          payload: { taskId: task.id, action: 'resume', expectedVersion: task.version,
            data: { reason: `Cloud 启动自动恢复中断任务：${task.interrupted?.reason || '未记录原因'}` } } }, { workflow: interfaceWorkflow });
      }
    }
  };
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
    // Coordinator assignments are a read-only projection shared by Main and
    // Session views.  Session memory is intentionally left untouched, but the
    // selected Session must still show the current dispatch/status for items
    // that the Coordinator assigned to it.
    const document = await coordinatorAssignmentProjection(project, snapshot.memory.map);
    return { version: snapshot.version, document, source: { status: 'session', sessionId, sourceCommit: snapshot.sourceCommit, baseMainVersion: snapshot.baseMainVersion, updatedAt: snapshot.updatedAt || null } };
  };
  const mainMemorySnapshot = async project => {
    if (!configuredMemory?.projects?.[project.id]) return null;
    const snapshot = (await readMemoryProject(configuredMemory, project.id)).main;
    if (!snapshot) {
      const document = emptyProjectDocument(project);
      return { version: versionOf(document), document, source: { status: 'baseline-pending', mainSha: null, publishedAt: null } };
    }
    const document = await coordinatorAssignmentProjection(project, snapshot.memory.map);
    return { version: snapshot.version, document, source: { status: 'main', mainSha: snapshot.mainSha || null, publishedAt: snapshot.publishedAt || null } };
  };
  const scopedWorkbenchState = async (scope, project, viewId = 'main') => {
    const snapshot = viewId.startsWith('session:')
      ? await sessionSnapshot(project, viewId)
      : project && viewId === 'main'
        ? await mainMemorySnapshot(project) || await workbenchSnapshot(scope, project)
        : await workbenchSnapshot(scope, project);
    return { version: snapshot.version, doc: snapshot.document, viewId, source: snapshot.source || null, projection: { status: 'ready', sourceVersion: snapshot.version }, recovery: false, error: null };
  };
  const coordinatorAssignmentProjection = async (project, document) => {
    const config = configuredMemory?.projects?.[project?.id]?.coordinator;
    if (!project || !config?.enabled || !document?.root) return document;
    const registry = await conversationsFor(project).state();
    const { store, principal } = interfaceProject(project);
    const assignments = new Map();
    for (const [rawKey, conversationId] of Object.entries(registry.tasks || {})) {
      let pair;
      try { pair = JSON.parse(rawKey); } catch { continue; }
      const [sessionId, taskId] = pair || [];
      const owner = registry.items?.[conversationId];
      if (!owner || !sessionId || !taskId) continue;
      const binding = await store.registeredBinding(principal, sessionId).catch(() => null);
      if (!binding) continue;
      const task = await store.taskRecord(principal, { id: sessionId, generation: binding.generation }, taskId).catch(() => null);
      if (!task) continue;
      const status = task.stage === 'finished' ? (task.result?.outcome === 'success' ? 'completed' : task.result?.outcome || 'failed')
        : task.stage === 'queued' ? 'queued' : task.stage;
      assignments.set(`${owner.nodeId}:${owner.kind}:${owner.itemId}`, { status, task_id: task.id, session_id: sessionId, at: task.updatedAt || task.startedAt || '' });
    }
    if (!assignments.size) return document;
    return applyCoordinatorAssignments(document, assignments);
  };
  const memorySessions = async project => {
    if (!configuredMemory?.projects?.[project.id]) return [];
    const state = await readMemoryProject(configuredMemory, project.id);
    const repository = interfaceConfig?.repositories?.find(item => item.projectId === project.id);
    const presence = new Map(repository ? [...interfacePresence.values()]
      .filter(item => item.repositoryId === repository.repositoryId)
      .map(item => [item.sessionId, item]) : []);
    const names = await fs.readdir(path.join(worksDir, project.id)).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
    const works = [];
    for (const name of names.filter(name => name.endsWith('.json'))) {
      const work = await readJson(path.join(worksDir, project.id, name), null);
      if (work?.sessionId) works.push(work);
    }
    const sessions = Object.entries(state.sessions).map(([storedSessionId, snapshot]) => {
      const sessionId = snapshot.sessionId || storedSessionId;
      const latest = works.filter(work => work.sessionId === sessionId).sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))[0];
      const events = String(snapshot.memory?.records?.['sessions.jsonl'] || '').split('\n').flatMap(line => {
        try { const event = JSON.parse(line); return event.session_id === sessionId ? [event] : []; } catch { return []; }
      }).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
      const named = events.filter(event => typeof event.thread_name === 'string' && event.thread_name.trim()).at(-1);
      const lifecycle = events.filter(event => ['session-start', 'user-prompt-submit', 'stop', 'stop-blocked', 'interrupt'].includes(event.event)).at(-1);
      const observed = presence.get(sessionId);
      const lastSeen = observed?.lastHeartbeatAt || snapshot.lastSync?.occurredAt || snapshot.updatedAt || latest?.startedAt || '';
      const connection = cloudSessionConnection(observed?.lastHeartbeatAt);
      const execution = connection.state === 'online' ? observed?.execution || { status: 'unknown', at: '' } : { status: 'unknown', at: '' };
      return { id: sessionId, name: observed?.name || snapshot.memory?.display?.name || named?.thread_name.trim().slice(0, 200) || '', platform: observed?.platform || snapshot.memory?.display?.platform || events.at(-1)?.platform || 'agent', status: connection.state, connection, lastSeen, lastHeartbeatAt: connection.lastHeartbeatAt, execution };
    });
    for (const observed of presence.values()) if (!state.sessions[observed.sessionId]) {
      const connection = cloudSessionConnection(observed.lastHeartbeatAt);
      sessions.push({
        id: observed.sessionId, name: observed.name || '', platform: observed.platform || 'agent', status: connection.state,
        connection, lastSeen: observed.lastHeartbeatAt, lastHeartbeatAt: observed.lastHeartbeatAt, bindingState: 'connected',
        execution: connection.state === 'online' ? observed.execution || { status: 'unknown', at: '' } : { status: 'unknown', at: '' },
      });
    }
    if (repository) {
      const principal = { repositoryId: repository.repositoryId, deviceId: 'cloud-browser', agentId: 'cloud-human', role: 'human' };
      const { store } = interfaceStorage(principal);
      for (const head of await store.queueHeads(principal)) {
        const binding = await store.registeredBinding(principal, head.session.id);
        const existing = sessions.find(item => item.id === head.session.id);
        if (existing) {
          existing.name ||= binding.name || '';
          existing.platform = binding.platform || existing.platform;
        } else sessions.push({ id: head.session.id, name: binding.name || '', platform: binding.platform || 'agent', status: 'offline', connection: cloudSessionConnection(''), lastSeen: '', lastHeartbeatAt: '', bindingState: 'bound' });
      }
    }
    return sessions.sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
  };
  const publicationState = async (project, viewId, options = {}) => {
    if (!project || !configuredMemory?.projects?.[project.id]) return { status: 'unavailable', reason: 'MEMORY_NOT_CONFIGURED' };
    if (viewId === 'main') {
      const state = await readMemoryProject(configuredMemory, project.id);
      return state.main
        ? { projectId: project.id, status: 'published', mainVersion: state.main.version, mainSha: state.main.mainSha || null, publishedAt: state.main.publishedAt || null }
        : { projectId: project.id, status: 'empty', mainVersion: null };
    }
    return memoryPublicationStatus(configuredMemory, project.id, viewId.slice('session:'.length), options);
  };
  const broadcastWorkbench = async (scope, project, viewId = 'main') => {
    const state = await scopedWorkbenchState(scope, project, viewId);
    for (const client of workbenchClients) {
      if (client.res.destroyed) { workbenchClients.delete(client); continue; }
      if (client.scope === `${scope}|${viewId}`) client.res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    }
  };
  const broadcastWorkbenchAccess = project => {
    const prefix = `project:${project.id}|`;
    const payload = JSON.stringify({ projectId: project.id, at: new Date().toISOString() });
    for (const client of workbenchClients) {
      if (client.res.destroyed) { workbenchClients.delete(client); continue; }
      if (client.scope.startsWith(prefix)) client.res.write(`event: access\ndata: ${payload}\n\n`);
    }
  };
  const stopMemoryEvents = memoryHandler?.onEvent(event => {
    const project = projectById(event.projectId);
    if (!project) return;
    broadcastWorkbenchAccess(project);
    if (event.scope === 'main') broadcastWorkbench(`project:${project.id}`, project, 'main').catch(() => {});
    else if (event.scope?.startsWith('session:')) broadcastWorkbench(`project:${project.id}`, project, event.scope).catch(() => {});
  }) || (() => {});
  let automaticPublicationRunning = null;
  let stopping = false;
  const publishMergedSessions = async ({ afterCurrent = false } = {}) => {
    if (stopping || !configuredMemory) return;
    if (automaticPublicationRunning) {
      await automaticPublicationRunning;
      if (stopping || !afterCurrent) return;
    }
    const run = (async () => {
      try {
        for (const project of registry.projects) {
          if (!configuredMemory.projects?.[project.id]) continue;
          const state = await readMemoryProject(configuredMemory, project.id);
          const sessions = Object.values(state.sessions || {})
            .sort((left, right) => String(left.updatedAt || '').localeCompare(String(right.updatedAt || '')));
          for (const session of sessions) {
            const status = await memoryPublicationStatus(configuredMemory, project.id, session.sessionId, { refresh: true });
            if (status.status !== 'ready') continue;
            await publishSessionMemory(configuredMemory, project.id, {
              operationId: `automatic-main:${status.sessionId}:${status.generation}:${status.mainSha}`,
              baseVersion: status.baseVersion,
              sessionId: status.sessionId,
              sessionVersion: status.sessionVersion,
              expectedMainSha: status.mainSha,
            }, { kind: 'automation', sessionId: status.sessionId });
            break;
          }
        }
      } catch (error) {
        console.error(`[context-guard] automatic Main publication deferred: ${error.message}`);
      }
    })();
    automaticPublicationRunning = run;
    try { await run; }
    finally { if (automaticPublicationRunning === run) automaticPublicationRunning = null; }
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

  const receiveHeartbeat = async (principal, input) => {
    const { store } = interfaceStorage(principal);
    const reply = await store.handle(principal, input);
    if (input.payload.creationResults?.length) {
      reply.data.creationResults = [];
      for (const result of input.payload.creationResults) {
        try { await store.finishSessionCreation(principal, result); reply.data.creationResults.push({ ...result, accepted: true }); }
        catch (error) {
          if (['FORBIDDEN', 'ID_REUSED', 'INVALID_ARGUMENT'].includes(error.code)) reply.data.creationResults.push({ ...result, accepted: false, code: error.code });
          // Unknown storage failures are retried from the same durable local result.
        }
      }
    }
    const accepted = input.payload.sessions.filter(item => reply.data.sessions.some(session => session.id === item.id && session.generation === item.generation && item.ackedSeq <= session.ackedSeq));
    await store.rememberSessionNames(principal, accepted);
    const repository = interfaceConfig.repositories.find(item => item.repositoryId === principal.repositoryId);
    const lastHeartbeatAt = new Date().toISOString();
    let accessChanged = false;
    for (const session of accepted) {
      const key = presenceKey(principal.repositoryId, session.id), previous = interfacePresence.get(key);
      const name = session.name || previous?.name || '', platform = session.platform || previous?.platform || '';
      const execution = session.execution || { status: 'unknown', at: '' };
      if (!previous?.online || previous.name !== name || previous.platform !== platform || previous.execution?.status !== execution.status || previous.execution?.at !== execution.at) accessChanged = true;
      interfacePresence.set(key, { repositoryId: principal.repositoryId, projectId: repository?.projectId || '', sessionId: session.id,
        generation: session.generation, name, platform, lastHeartbeatAt, online: true, execution });
    }
    if (accessChanged && repository?.projectId) {
      const project = projectById(repository.projectId);
      if (project) broadcastWorkbenchAccess(project);
    }
    const heads = await interfaceMapHeads(principal);
    reply.data.sessions = reply.data.sessions.map(session => ({ ...session, ...(heads[session.id] || {}) }));
    return reply;
  };
  const activeRequests = new Set();
  const handleRequest = async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const route = url.pathname;
      if (route === '/api/v2/heartbeat') {
        if (!interfaceAuth) protocolFail('INVALID_ARGUMENT', 'Interface v2 is not configured');
        if (req.method !== 'POST') protocolFail('INVALID_ARGUMENT', 'Use POST');
        if (req.headers.origin) protocolFail('FORBIDDEN', 'Device heartbeat is not a browser endpoint');
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) protocolFail('INVALID_ARGUMENT', 'Expected JSON');
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > MAX_MESSAGE_BYTES) protocolFail('TOO_LARGE', 'Heartbeat exceeds 256 KiB'); chunks.push(chunk); }
        let batch;
        try { batch = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { protocolFail('INVALID_ARGUMENT', 'Invalid JSON'); }
        if (!Array.isArray(batch) || !batch.length || batch.length > 100) protocolFail('INVALID_ARGUMENT', 'Expected 1–100 project heartbeats');
        let sessions = 0;
        const ids = new Set();
        for (const item of batch) {
          if (!item || typeof item.credential !== 'string' || item.credential.length > 4096 || Object.keys(item).some(key => !['credential', 'message'].includes(key))) protocolFail('INVALID_ARGUMENT', 'Invalid project heartbeat');
          validateMessage(item.message);
          if (item.message.type !== 'sync.heartbeat' || ids.has(item.message.id)) protocolFail('INVALID_ARGUMENT', 'Expected distinct heartbeat messages');
          ids.add(item.message.id); sessions += item.message.payload.sessions.length;
        }
        if (sessions > 100) protocolFail('TOO_LARGE', 'Device heartbeat exceeds 100 Sessions');
        // Each project retains its own authorization. An expired credential may
        // reject its entry, never prevent another project's liveness update.
        const replies = await Promise.all(batch.map(async ({ credential, message }) => {
          try {
            const principal = await interfaceAuth.authenticate(credential);
            if (principal.role !== 'device') protocolFail('FORBIDDEN', 'Device credential required');
            const reply = await receiveHeartbeat(principal, message);
            const creations = await interfaceStorage(principal).store.pendingSessionCreations(principal);
            if (creations.length) reply.data.sessionCreations = creations;
            return reply;
          } catch (error) { return errorReply(message.id, error); }
        }));
        // Keep optional creation work from overflowing a multi-project device
        // heartbeat. Omitted requests remain durable and return on later beats.
        const creations = replies.map(reply => {
          const items = reply.data?.sessionCreations || [];
          if (reply.data) delete reply.data.sessionCreations;
          return items;
        });
        let remaining = MAX_MESSAGE_BYTES - Buffer.byteLength(JSON.stringify(replies)) - 64;
        for (let i = 0; i < replies.length; i++) {
          const selected = []; let bytes = 32;
          for (const item of creations[i]) {
            const size = Buffer.byteLength(JSON.stringify(item)) + 1;
            if (bytes + size > remaining) break;
            selected.push(item); bytes += size;
          }
          if (selected.length) { replies[i].data.sessionCreations = selected; remaining -= bytes; }
        }
        return send(res, 200, replies);
      }
      if (route === '/api/v2/events') {
        if (!interfaceAuth) protocolFail('INVALID_ARGUMENT', 'Interface v2 is not configured');
        if (req.method !== 'GET') protocolFail('INVALID_ARGUMENT', 'Use GET');
        if (req.headers.origin && req.headers.origin !== allowedOrigin) protocolFail('FORBIDDEN', 'Untrusted browser origin');
        const credential = bearer(req), principal = await interfaceAuth.authenticate(credential);
        const { store } = interfaceStorage(principal);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        res.write(': connected\n\n');
        let pending = false, dirty = false, closed = false;
        const heads = new Map();
        const notify = async () => {
          dirty = true;
          if (pending || closed) return;
          pending = true;
          try {
            while (dirty && !closed) {
              dirty = false;
              const current = await interfaceAuth.authenticate(credential);
              const mapHeads = await interfaceMapHeads(current);
              for (const head of await store.queueHeads(current)) {
                const key = `${head.session.id}:${head.session.generation}`;
                const version = `${head.latestSeq}:${mapHeads[head.session.id]?.mapVersion || ''}`;
                if (heads.get(key) === version) continue;
                heads.set(key, version);
                const message = { v: 2, id: randomUUID(), type: 'sync.event', session: head.session, payload: { latestSeq: head.latestSeq } };
                if (!res.write(`event: sync.event\ndata: ${JSON.stringify(message)}\n\n`)) { res.end(); break; }
              }
            }
          } catch { res.end(); } finally { pending = false; }
        };
        const timer = setInterval(() => {
          interfaceAuth.authenticate(credential).then(() => { if (!res.write(': heartbeat\n\n')) res.end(); }).catch(() => res.end());
        }, 10000); timer.unref();
        interfaceStreams.add(res); store.on('change', notify);
        const memoryEvents = configuredMemory ? memoryHub(configuredMemory) : null;
        const repository = interfaceConfig.repositories.find(item => item.repositoryId === principal.repositoryId);
        const memoryChanged = event => { if (event.projectId === repository?.projectId) notify(); };
        memoryEvents?.on('event', memoryChanged);
        res.on('close', () => { closed = true; clearInterval(timer); store.off('change', notify); memoryEvents?.off('event', memoryChanged); interfaceStreams.delete(res); });
        await notify(); return;
      }
      const binaryRoute = route.match(/^\/api\/v2\/blobs\/([a-f0-9]{64})$/);
      if (binaryRoute) {
        try {
          if (!interfaceAuth) protocolFail('INVALID_ARGUMENT', 'Interface v2 is not configured');
          if (req.headers.origin && req.headers.origin !== allowedOrigin) protocolFail('FORBIDDEN', 'Untrusted browser origin');
          const principal = await interfaceAuth.authenticate(bearer(req));
          const session = { id: req.headers['x-context-guard-session'], generation: Number(req.headers['x-context-guard-generation']) };
          const { store, blobs } = interfaceStorage(principal);
          await store.authorizeSession(principal, session);
          return await serveBlob(req, res, { blobs, principal, session, blobId: binaryRoute[1] });
        } catch (error) { return send(res, error.status || 503, errorReply('', error)); }
      }
      if (route === '/api/v2/messages') {
        let id = '';
        try {
          if (!interfaceAuth) protocolFail('INVALID_ARGUMENT', 'Interface v2 requires configured repository and client registrations');
          if (req.method !== 'POST') protocolFail('INVALID_ARGUMENT', 'Use POST');
          if (req.headers.origin && req.headers.origin !== allowedOrigin) protocolFail('FORBIDDEN', 'Untrusted browser origin');
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) protocolFail('INVALID_ARGUMENT', 'Expected JSON');
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > MAX_MESSAGE_BYTES) protocolFail('TOO_LARGE', 'Message exceeds 256 KiB'); chunks.push(chunk); }
          let input;
          try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { protocolFail('INVALID_ARGUMENT', 'Invalid JSON'); }
          if (typeof input?.id === 'string' && input.id.length <= 128) id = input.id;
          validateMessage(input);
          if (input.type === 'auth.open') {
            const opened = await interfaceAuth.open(input, String(req.socket.remoteAddress));
            const repository = interfaceConfig.repositories.find(item => item.repositoryId === opened.data.repositoryId);
            opened.data.capabilities = repository?.projectId && configuredMemory?.projects?.[repository.projectId] ? ['private-map-heads'] : [];
            if (opened.data.capabilities.length) {
              opened.data.projectId = repository.projectId;
              opened.data.capabilities.push('device-memory');
            }
            return send(res, 200, { id, ok: true, data: opened.data }, { 'X-Context-Guard-Credential': opened.credential });
          }
          const credential = bearer(req);
          if (input.type === 'auth.close') return send(res, 200, { id, ok: true, data: await interfaceAuth.close(credential) });
          let principal;
          if (!credential && hasWorkbenchAccess(req, url)) {
            const repository = interfaceConfig.repositories?.find(item => item.projectId === url.searchParams.get('project'));
            if (!repository || !/^\d+$/.test(repository.repositoryId)) protocolFail('FORBIDDEN', 'Select an authorized project');
            principal = { repositoryId: repository.repositoryId, deviceId: 'cloud-browser', agentId: 'cloud-human', role: 'human' };
          } else principal = await interfaceAuth.authenticate(credential);
          if (req.headers['x-context-guard-ci-session']) {
            const repository = interfaceConfig.repositories.find(item => item.repositoryId === principal.repositoryId);
            principal = await authorizeCiReceiver({ principal, ciSessionId: req.headers['x-context-guard-ci-session'], message: input,
              templates: configuredMemory?.projects?.[repository?.projectId]?.coordinator?.sessionTemplates || [],
              receivers: configuredMemory?.projects?.[repository?.projectId]?.coordinator?.ciReceivers, store: interfaceStorage(principal).store });
          }
          if (input.type === 'sync.heartbeat') return send(res, 200, await receiveHeartbeat(principal, input));
          const { store, blobs, snapshots } = interfaceStorage(principal);
          if (input.type === 'workbench.patch') {
            await store.authorizeSession(principal, input.session);
            await verifyChangeReferences(input.payload.changes, {
              object: async (ref, version) => (await store.handle(principal, { v: 2, id: randomUUID(), type: 'object.read', session: input.session, payload: { ref, version } })).data,
              blob: blobId => blobs.metadata(principal, input.session, blobId),
            });
            const repository = interfaceConfig.repositories.find(item => item.repositoryId === principal.repositoryId);
            if (!repository?.projectId || !configuredMemory?.projects?.[repository.projectId]) protocolFail('NOT_FOUND', 'Private project memory is not configured');
            const actor = { kind: principal.role === 'human' ? 'human' : 'agent', sessionId: input.session.id };
            try {
              const data = await commitSessionMap(configuredMemory, repository.projectId, input.session.id,
                { operationId: `v2:${digest(JSON.stringify([principal.repositoryId, principal.deviceId, principal.agentId, input.session, input.id]))}`, baseVersion: input.payload.baseVersion, changes: input.payload.changes }, actor, {
                  authorize: async () => {
                    if (credential) principal = await interfaceAuth.authenticate(credential);
                    else if (!hasWorkbenchAccess(req, url)) protocolFail('UNAUTHORIZED', 'Workbench login expired');
                    await store.authorizeSession(principal, input.session);
                  },
                  grants: async doc => {
                    const all = doc?.root ? [...entries(doc.root).keys()] : [];
                    if (principal.role === 'human') return all;
                    const granted = Array.isArray(principal.nodeIds) ? all.filter(id => principal.nodeIds.includes(id)) : principal.role === 'device' ? all : [];
                    const binding = await store.registeredBinding(principal, input.session.id);
                    return filterNodeAccess(doc, granted, binding.agentId);
                  },
                });
              return send(res, 200, { id, ok: true, data });
            } catch (error) {
              if (error instanceof MapError) protocolFail(error.code === 'ID_REUSED' ? 'ID_REUSED' : ({ 400: 'INVALID_ARGUMENT', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' })[error.status] || 'UNAVAILABLE', error.message, error.details);
              throw error;
            }
          }
          const reply = await store.handle(principal, input, {
            blobs,
            allowMigration: principal.role === 'device',
            workbenchRead: async (identity, message) => {
              const repository = interfaceConfig.repositories.find(item => item.repositoryId === identity.repositoryId);
              if (!repository?.projectId || !configuredMemory?.projects?.[repository.projectId]) protocolFail('NOT_FOUND', 'Private project memory is not configured');
              let source;
              const load = async () => {
                if (!source) {
                  const memory = await readMemoryProject(configuredMemory, repository.projectId);
                  const snapshot = message.payload.scope === 'main' ? memory.main : memory.sessions[message.session.id];
                  if (!snapshot?.memory?.map) protocolFail('NOT_FOUND', 'Requested workbench is unavailable');
                  source = { version: snapshot.version, doc: scopeDocumentToSession(snapshot.memory.map, message.session.id) };
                }
                return source;
              };
              return snapshots.read(identity, message, { load, capture: () => store.recoverySnapshot(identity, message.session, load), grants: async () => {
                const doc = (await load()).doc;
                const all = doc.root ? [...entries(doc.root).keys()] : [];
                if (identity.role === 'human') return all;
                const granted = Array.isArray(identity.nodeIds) ? all.filter(id => identity.nodeIds.includes(id)) : identity.role === 'executor' ? [] : all;
                const binding = await store.registeredBinding(identity, message.session.id);
                return filterNodeAccess(doc, granted, binding.agentId, 'read');
              } });
            },
            verifyBinding: (identity, payload) => identity.role === 'device' || identity.bindings?.[payload.sessionId] === payload.worktreeId,
            workflow: interfaceWorkflow,
          });
          return send(res, 200, reply);
        } catch (error) { return send(res, error.status || 503, errorReply(id, error)); }
      }
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
        const conversationId = url.searchParams.get('conversation') || 'legacy';
        if (viewId !== 'main' && (!project || !viewId.startsWith('session:'))) throw new MapError('UNKNOWN_VIEW', 'Select Main or a project Session', 404);
        const action = workbench[3];
        if (action === '/bootstrap' && req.method === 'GET') { requirePrivateRead(req, url); return send(res, 200, { root: project ? `cloud:${project.id}` : 'cloud:overview', protocol: 3, apiBase: route.slice(0, -'/bootstrap'.length), authenticated: !!cookieValue(req), interfaceCapabilities: { taskDispatch: !!project && !!interfaceConfig, durableDelivery: !!project && !!interfaceConfig, humanReview: !!project && !!interfaceConfig, coordinator: !!configuredMemory?.projects?.[project?.id]?.coordinator?.enabled } }); }
        requireWorkbench(req, url);
        if (action === '/api/coordinator/sessions' && project && req.method === 'POST') {
          const config = configuredMemory?.projects?.[project.id]?.coordinator;
          const input = await requestBody(req);
          if (!config?.enabled || !Array.isArray(config.sessionTemplates) || !config.sessionTemplates.includes(input.templateSessionId) ||
              !Object.hasOwn(config.bindings || {}, input.templateSessionId) || config.ciReceivers?.[input.templateSessionId]) protocolFail('FORBIDDEN', 'Select an explicitly configured developer template');
          const { store, principal } = interfaceProject(project);
          return send(res, 202, await store.requestSessionCreation(principal, input));
        }
        if (action === '/api/coordinator/conversations' && project && req.method === 'POST') {
          const input = await requestBody(req);
          if (!input || Object.keys(input).some(key => !['nodeId', 'kind', 'itemId'].includes(key))) protocolFail('INVALID_ARGUMENT', 'Select a Map item');
          const id = await itemConversation(project, input);
          await coordinatorFor(project, id);
          return send(res, 200, { id });
        }
        if (action === '/api/coordinator' && project) {
          const coordinator = await coordinatorFor(project, conversationId);
          if (req.method === 'GET') {
            await coordinator.refreshBindings();
            const state = await coordinator.state();
            state.conversationId = conversationId;
            state.conversations = await conversationsFor(project).list();
            const memory = await readMemoryProject(configuredMemory, project.id);
            const allowedNodes = configuredMemory.projects[project.id].coordinator.nodeIds;
            state.nodeReferences = (memory.main?.memory?.map?.root ? [...entries(memory.main.memory.map.root).values()] : [])
              .map(entry => entry.node).filter(node => node.proposal !== 'cancelled' && (!allowedNodes || allowedNodes.includes(node.id)))
              .map(node => ({ id: node.id, title: node.title }));
            state.eventError = coordinator.inbox.lastError;
            const { store, principal } = interfaceProject(project);
            state.sessionCreations = (await store.sessionCreations(principal)).slice(-100);
            state.sessionTemplates = [];
            for (const id of configuredMemory.projects[project.id].coordinator.sessionTemplates || []) {
              if (!Object.hasOwn(coordinator.bindings, id)) continue;
              const binding = await store.registeredBinding(principal, id);
              if (binding) state.sessionTemplates.push({ id, name: binding.name || 'Claude 开发环境' });
            }
            state.acceptances = [];
            for (const sessionId of Object.keys(coordinator.bindings)) {
              const binding = await store.registeredBinding(principal, sessionId);
              if (!binding) continue;
              const session = { id: sessionId, generation: binding.generation };
              for (const task of await store.workflowTasks(principal, session)) {
                if (await conversationsFor(project).owner(sessionId, task.id) !== conversationId) continue;
                if (task.stage !== 'awaiting-merge' || task.ci?.verdict !== 'passed') continue;
                const read = async ref => (await store.handle(principal, { v: 2, id: randomUUID(), type: 'object.read', session, payload: ref })).data.content;
                state.acceptances.push({ taskId: task.id, sessionId, sourceSha: task.sourceSha, ci: task.ci,
                  brief: await read(task.brief), result: await read({ ref: task.ci.ref, version: task.ci.version }) });
              }
            }
            for (const approval of state.approvals) {
              if (!approval.brief) continue;
              const binding = await store.registeredBinding(principal, approval.sessionId);
              const task = binding && await store.taskRecord(principal, { id: approval.sessionId, generation: binding.generation }, approval.taskId);
              approval.pending = !!task && task.stage === 'brief' && task.brief.ref === approval.brief.ref && task.brief.version === approval.brief.version;
            }
            return send(res, 200, state);
          }
          if (req.method === 'POST') return send(res, 202, await coordinator.submit(await requestBody(req)));
        }
        if (action === '/api/coordinator/mount-review' && project && req.method === 'POST') {
          const coordinator = await coordinatorFor(project, conversationId), input = await requestBody(req);
          const result = await coordinator.reviewMount(input, (proposals, operationId) => commitMainMemoryMap(configuredMemory, project.id, {
            operationId, baseVersion: proposals[0].mainVersion,
            operations: proposals.map(proposal => ({ type: 'create', parentId: proposal.parentId,
              node: { id: `NCM${digest(proposal.id).slice(0, 20)}`, title: proposal.title, purpose: proposal.purpose,
                kind: 'module', state: 'untested', owns: proposal.owns, proposal: 'accepted' } })),
          }));
          void coordinator.inbox.pump();
          return send(res, 200, result);
        }
        if (action === '/api/coordinator/approval' && project && req.method === 'POST') {
          const input = await requestBody(req), coordinator = await coordinatorFor(project, conversationId);
          if (!input || Object.keys(input).some(key => !['id', 'proposalId', 'decision', 'reason'].includes(key))) protocolFail('INVALID_ARGUMENT', 'Unexpected approval fields');
          const proposal = (await coordinator.state()).approvals.find(value => value.id === input.proposalId && value.brief);
          if (!proposal) protocolFail('NOT_FOUND', 'Requirement approval is not available');
          const { store, principal } = interfaceProject(project);
          const binding = await store.registeredBinding(principal, proposal.sessionId);
          if (!binding) protocolFail('NOT_FOUND', 'Session is not registered');
          const message = validateMessage({ v: 2, id: input.id, type: 'review.result',
            session: { id: proposal.sessionId, generation: binding.generation },
            payload: { kind: 'brief', ref: proposal.brief.ref, version: proposal.brief.version, decision: input.decision,
              reason: (configuredMemory.projects[project.id].coordinator.simulated ? '[模拟人工确认] ' : '') + (input.reason || '') } });
          return send(res, 200, (await store.handle(principal, message)).data);
        }
        if (action === '/api/coordinator/acceptance' && project && req.method === 'POST') {
          const coordinator = await coordinatorFor(project, conversationId);
          await coordinator.refreshBindings();
          const input = await requestBody(req);
          if (!input || Object.keys(input).some(key => !['id', 'sessionId', 'taskId', 'ref', 'version', 'decision', 'reason'].includes(key)) ||
              !Object.hasOwn(coordinator.bindings, input.sessionId)) protocolFail('INVALID_ARGUMENT', 'Select an assigned task and exact CI result');
          const { store, principal } = interfaceProject(project), binding = await store.registeredBinding(principal, input.sessionId);
          if (!binding) protocolFail('NOT_FOUND', 'Session is not registered');
          const session = { id: input.sessionId, generation: binding.generation }, task = await store.taskRecord(principal, session, input.taskId);
          if (await conversationsFor(project).owner(input.sessionId, input.taskId) !== conversationId) protocolFail('FORBIDDEN', 'Task belongs to another conversation');
          if (task.ci?.ref !== input.ref || task.ci?.version !== input.version || task.ci?.verdict !== 'passed') protocolFail('CONFLICT', 'Acceptance must reference the current passed CI result');
          if (typeof input.reason !== 'string' || !input.reason.trim()) protocolFail('INVALID_ARGUMENT', 'Record the human acceptance result or rejection reason');
          const message = validateMessage({ v: 2, id: input.id, type: 'review.result', session, payload: { kind: 'acceptance', ref: input.ref, version: input.version,
            decision: input.decision, reason: (configuredMemory.projects[project.id].coordinator.simulated ? '[模拟人工验收] ' : '') + input.reason } });
          return send(res, 200, (await store.handle(principal, message)).data);
        }
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
          for (const session of sessions) {
            const map = memory.sessions[session.id]?.memory?.map || memory.main?.memory?.map;
            grants[session.id] = { nodes: map?.root ? [...entries(map.root).keys()] : [] };
          }
          return send(res, 200, { sessions, grants, currentSessionId: null, project: { id: project.id, kind: 'git', main: { status: 'ready' } } });
        }
        if (action === '/api/access-plan' && req.method === 'POST') {
          if (!project) throw new MapError('PROJECT_REQUIRED', 'Select a project before assigning work', 409);
          const input = await requestBody(req), sessionId = compactText(input.sessionId, 128), nodeId = compactText(input.nodeId, 128);
          const { principal, store } = interfaceProject(project);
          const binding = await store.registeredBinding(principal, sessionId);
          if (!binding) throw new MapError('SESSION_OFFLINE', 'This Session has not connected its local backend', 409);
          const main = await mainMemorySnapshot(project);
          if (!main?.document?.root) throw new MapError('MAIN_REQUIRED', 'Published Main memory is unavailable', 409);
          const nodes = assignmentScope(main.document, nodeId);
          const readable = filterNodeAccess(main.document, [...entries(main.document.root).keys()], binding.agentId, 'read');
          return send(res, 200, { sessionId, nodeId, nodes, missing: nodes.filter(id => !readable.includes(id)) });
        }
        if (action === '/api/access' && req.method === 'POST') {
          throw new MapError('ACCESS_EDIT_REQUIRED', 'Cloud permission changes must be made explicitly on the node; the Session is not auto-authorized', 409);
        }
        if (action === '/api/session-message' && req.method === 'POST') {
          if (!project) throw new MapError('PROJECT_REQUIRED', 'Select a project before assigning work', 409);
          const input = await requestBody(req);
          const operationId = compactText(input.operationId, 128), sessionId = compactText(input.sessionId, 128), nodeId = compactText(input.nodeId, 128);
          const bugId = compactText(input.bugId, 128), todoId = compactText(input.todoId, 128);
          if (input.purpose === 'summary') throw new MapError('ACTION_REPLACED', 'Use task review; human confirmation no longer dispatches summary tasks', 409);
          if (input.purpose) throw new MapError('INVALID_ARGUMENT', 'Unknown dispatch purpose', 400);
          if (!operationId || !sessionId || !nodeId || Boolean(bugId) === Boolean(todoId)) throw new MapError('INVALID_ARGUMENT', 'operationId, Session, node and exactly one work item are required', 400);
          const { principal, store } = interfaceProject(project);
          const binding = await store.registeredBinding(principal, sessionId);
          if (!binding) throw new MapError('SESSION_OFFLINE', 'This Session has not connected its local backend', 409);
          const session = { id: sessionId, generation: binding.generation };
          const result = await store.submitApprovedTask(principal, { operationId, session, nodeId, bugId, todoId }, async () => {
            const main = await mainMemorySnapshot(project);
            if (!main?.document?.root) protocolFail('NOT_FOUND', 'Published Main memory is unavailable');
            const node = entries(main.document.root).get(nodeId)?.node;
            const matches = (bugId ? node?.bugs : node?.todos)?.filter(value => value?.id === (bugId || todoId)) || [];
            if (matches.length > 1) protocolFail('CONFLICT', 'Work item ID is duplicated; repair its identity before assigning');
            const item = matches[0];
            if (!node || !item) protocolFail('NOT_FOUND', 'Work item or owner node is missing');
            if ((bugId && ['resolved', 'dormant', 'wontfix'].includes(item.status)) || (todoId && item.status === 'done')) protocolFail('CONFLICT', 'Closed work items cannot be assigned');
            const nodeIds = assignmentScope(main.document, nodeId);
            const readable = filterNodeAccess(main.document, [...entries(main.document.root).keys()], binding.agentId, 'read');
            if (nodeIds.some(id => !readable.includes(id))) protocolFail('FORBIDDEN', 'The target Session cannot read every routed node');
            return {
              taskId: `task-${digest(`${project.id}\0${operationId}`).slice(0, 40)}`,
              text: cloudWorkItemBrief(node, item, bugId ? 'bug' : 'todo'), nodeIds, mainVersion: main.version, mode: 'session',
            };
          }, { verifyRouting: verifyInterfaceRouting });
          return send(res, 200, { ...result, deliveryId: operationId });
        }
        if (action === '/api/task-review' && req.method === 'POST') {
          if (!project || viewId !== 'main') throw new MapError('MAIN_REQUIRED', 'Review the task in the Main workbench', 409);
          const input = reviewInput(await requestBody(req));
          const { principal, store } = interfaceProject(project);
          const task = await store.humanTaskResult(principal, input.sessionId, input.taskId);
          for (let attempt = 0; ; attempt++) {
            const snapshot = await mainMemorySnapshot(project);
            if (!snapshot?.document?.root) throw new MapError('NOT_FOUND', 'Main is unavailable', 404);
            const result = reviewOperations(snapshot.document, input, task);
            if (!result.operations.length) return send(res, 200, { operationId: input.operationId, review: result.review });
            try {
              await commitMainMemoryMap(configuredMemory, project.id, { operationId: `task-review:${input.operationId}`, baseVersion: snapshot.version, operations: result.operations });
              await broadcastWorkbench(scope, project, viewId);
              return send(res, 200, { operationId: input.operationId, review: result.review });
            } catch (error) { if (error.code !== 'VERSION_CONFLICT' || attempt >= 2) throw error; }
          }
        }
        if (action === '/api/review-feedback' && req.method === 'GET') {
          if (!project || viewId !== 'main') throw new MapError('MAIN_REQUIRED', 'Feedback belongs to the project Main', 409);
          const snapshot = await mainMemorySnapshot(project);
          if (!snapshot?.document?.root) throw new MapError('NOT_FOUND', 'Main is unavailable', 404);
          return send(res, 200, { version: snapshot.version, items: pendingReviewFeedback(snapshot.document) });
        }
        if (action === '/api/task-status' && req.method === 'POST') {
          if (!project) throw new MapError('PROJECT_REQUIRED', 'Select a project before reading tasks', 409);
          const input = await requestBody(req);
          if (!Array.isArray(input.tasks) || input.tasks.length > 100) throw new MapError('INVALID_ARGUMENT', 'tasks must be an array of at most 100 items', 400);
          const { principal, store } = interfaceProject(project), tasks = [];
          for (const item of input.tasks) {
            const sessionId = compactText(item?.sessionId, 128), taskId = compactText(item?.taskId, 128);
            const binding = sessionId && await store.registeredBinding(principal, sessionId);
            if (!binding || !taskId) continue;
            try { tasks.push(await store.taskStatus(principal, { id: sessionId, generation: binding.generation }, taskId)); }
            catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
          }
          return send(res, 200, { tasks });
        }
        if (action === '/api/publication' && req.method === 'GET') {
          if (!project) return send(res, 200, { status: 'unavailable', reason: 'PROJECT_REQUIRED' });
          return send(res, 200, await publicationState(project, viewId));
        }
        if (action === '/api/publication' && req.method === 'POST') {
          if (!project || !viewId.startsWith('session:')) throw new MapError('SESSION_REQUIRED', 'Automatic publication requires a Session Map', 409);
          const status = await publicationState(project, viewId, { refresh: true });
          if (status.status !== 'ready') throw new MapError(status.reason || 'PUBLICATION_UNAVAILABLE', 'Session is not ready for automatic Main publication', 409);
          return send(res, 200, await publishSessionMemory(configuredMemory, project.id, {
            operationId: `automatic-main:${status.sessionId}:${status.generation}:${status.mainSha}`,
            baseVersion: status.baseVersion,
            sessionId: status.sessionId,
            sessionVersion: status.sessionVersion,
            expectedMainSha: status.mainSha,
          }, { kind: 'automation', sessionId: status.sessionId }));
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
          if (project) {
            // Persist intake's initial cursor without starting the model: a
            // provider failure must not prevent the human from saving work.
            if (configuredMemory?.projects?.[project.id]?.coordinator?.enabled) await mapIntakeFor(project).initialize();
            const result = await commitMainMemoryMap(configuredMemory, project.id, input);
            await broadcastWorkbench(scope, project, viewId);
            return send(res, 200, result);
          }
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
          // Register under the same queue as commits: no event may fall between
          // the historical read and the live subscription.
          await serial(project.id, async () => {
            const events = (await readEvents(project.id)).filter(event => event.seq > after);
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
            res.write('retry: 1000\n\n'); for (const event of events) res.write(`id: ${event.seq}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`);
            const clients = projectClients.get(project.id) || new Set(); clients.add(res); projectClients.set(project.id, clients);
            res.on('close', () => clients.delete(res));
          });
          return;
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
      if (req.method === 'GET' && /\/(map-model|workbench-sync|attachments|coordinator-markdown|marked)\.mjs$/.test(route)) {
        requirePrivateRead(req, url);
        const source = await fs.readFile(path.join(root, path.basename(route) === 'map-model.mjs' ? 'scripts/shared' : path.basename(route) === 'marked.mjs' ? 'prototype/vendor' : 'prototype', path.basename(route)));
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(source);
      }
      if (req.method === 'GET' && /\/workbench-(?:app|data)\.js$/.test(route)) {
        requirePrivateRead(req, url);
        const source = await fs.readFile(path.join(root, 'prototype', path.basename(route)));
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(source);
      }
      if (req.method === 'GET' && /\/workbench\.css$/.test(route)) {
        requirePrivateRead(req, url);
        const source = await fs.readFile(path.join(root, 'prototype', path.basename(route)));
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(source);
      }
      if (req.method === 'GET' && (route === '/' || route === '/prototype/' || route === '/workbench.html' || /^\/projects\/[^/]+$/.test(route))) {
        if (privateAccess && browserPasswordHash && !hasWorkbenchAccess(req, url)) return redirect(res, `/login?next=${encodeURIComponent(`${route}${url.search}`)}`);
        requirePrivateRead(req, url);
        if (/^\/projects\//.test(route) && !projectById(decodeURIComponent(route.slice('/projects/'.length)))) throw new MapError('NOT_FOUND', 'Project is missing', 404);
        const projectId = /^\/projects\//.test(route) ? decodeURIComponent(route.slice('/projects/'.length)) : null;
        const scope = projectId ? `projects/${encodeURIComponent(projectId)}` : 'overview';
        const config = JSON.stringify({ root: `cloud:${projectId || 'overview'}`, protocol: 3, apiBase: `/api/workbench/${scope}`, interfaceCapabilities: { taskDispatch: !!projectId && !!interfaceConfig, durableDelivery: !!projectId && !!interfaceConfig, humanReview: !!projectId && !!interfaceConfig, coordinator: !!configuredMemory?.projects?.[projectId]?.coordinator?.enabled } }).replace(/</g, '\\u003c');
        const marker = `<script>window.__CG_SERVER=${config};</script>`;
        const html = (await fs.readFile(htmlPath, 'utf8')).replace('<!-- CG_SERVER_BOOT -->', marker);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
        return res.end(html);
      }
      throw new MapError('NOT_FOUND', 'Unknown route', 404);
    } catch (error) {
      if (!res.headersSent) send(res, error.status || 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error.message, ...(error.details || {}) } }); else res.end();
    }
  };
  const server = http.createServer((req, res) => {
    if (stopping) return send(res, 503, { error: { code: 'SERVER_CLOSING', message: 'Server is shutting down' } });
    const pending = handleRequest(req, res);
    activeRequests.add(pending);
    pending.finally(() => activeRequests.delete(pending)).catch(() => {});
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.requestTimeout = 15_000;
  const heartbeat = setInterval(() => {
    for (const client of workbenchClients) if (!client.res.destroyed) client.res.write(': heartbeat\n\n');
    for (const set of projectClients.values()) for (const res of set) if (!res.destroyed) res.write(': heartbeat\n\n');
    for (const res of directoryClients) if (!res.destroyed) res.write(': heartbeat\n\n');
  }, 15_000); heartbeat.unref();
  const presenceExpiry = setInterval(() => {
    const changedProjects = new Set(), currentTime = Date.now();
    for (const item of interfacePresence.values()) {
      if (item.online && cloudSessionPresence(item.lastHeartbeatAt, currentTime) === 'offline') {
        item.online = false;
        if (item.projectId) changedProjects.add(item.projectId);
      }
    }
    for (const projectId of changedProjects) {
      const project = projectById(projectId);
      if (project) broadcastWorkbenchAccess(project);
    }
  }, 5000); presenceExpiry.unref();
  const publicationTimer = setInterval(publishMergedSessions, 30_000); publicationTimer.unref();
  const initialPublication = setTimeout(publishMergedSessions, 0); initialPublication.unref();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  for (const project of registry.projects) {
    if (configuredMemory?.projects?.[project.id]?.coordinator?.enabled) {
      void recoverInterruptedTasks(project).catch(cause => console.error(`[context-guard] interrupted-task recovery deferred: ${cause.message}`));
      void conversationsFor(project).list().then(async items => {
      const services = await Promise.all(items.map(item => coordinatorFor(project, item.id)));
      // Start the first inbox pump immediately. This is what discovers durable
      // interrupted tasks after a Cloud restart; the interval remains as the
      // liveness fallback for later events.
      await Promise.all(services.map(service => service.inbox.pump()));
      }).catch(cause => console.error(`[context-guard] coordinator startup deferred: ${cause.message}`));
    }
  }
  let closing;
  const close = () => closing ||= new Promise((resolve, reject) => {
    stopping = true;
    clearInterval(heartbeat);
    clearInterval(presenceExpiry);
    clearInterval(publicationTimer);
    clearTimeout(initialPublication);
    const coordinatorShutdown = Promise.all([...coordinators.values()].map(async pending => {
      const service = await pending.catch(() => null);
      if (!service) return;
      await service.inbox.close(); await service.close({ stop: true });
    }));
    coordinatorShutdown.catch(() => {});
    stopMemoryEvents();
    for (const res of interfaceStreams) res.end();
    for (const res of directoryClients) res.end();
    for (const client of workbenchClients) client.res.end();
    for (const set of projectClients.values()) for (const res of set) res.end();
    server.close(error => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      // Closing sockets does not finish async handlers or their Git children.
      // Drain owned work before callers remove repositories and data files.
      else Promise.all([coordinatorShutdown, automaticPublicationRunning, ...activeRequests]).then(resolve, reject);
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
