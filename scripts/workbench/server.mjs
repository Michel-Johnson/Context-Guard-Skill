import http from 'node:http';
import fs from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MapStore } from './store.mjs';
import { Access, token } from './access.mjs';
import { atomicWrite, encode, readJSON, pause, hash } from './io.mjs';
import { generateProjections } from './projections.mjs';
import { resolveProject, ensureProjectBinding, refreshMain, sessionBinding, sessionBindingsPath } from './project.mjs';
import { memoryRequest, sessionMemoryDir } from './memory.mjs';
import { MemorySyncCoordinator } from './sync-coordinator.mjs';
import { runtimeIdentity } from './runtime.mjs';
import { syncPaths } from '../sync/client.mjs';
import { MapError, assignmentScope, entries, validate, diffTrees, restoreSessionWorkItemOperations, scopeChangesToSession, scopeDocumentToSession } from '../../prototype/map-model.mjs';
export const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const statePath = root => path.join(root, '.codex/context/private/workbench.json');
export const projectStatePath = project => project.kind === 'git' ? path.join(project.sharedDir, 'workbench.json') : statePath(project.worktreeRoot);
export const projectLockPath = project => project.kind === 'git' ? path.join(project.sharedDir, 'node-workbench.lock') : path.join(project.worktreeRoot, '.codex/context/private/node-workbench.lock');
const execFileAsync = promisify(execFile);
const compactText = (value, limit = 2000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
export function bugSessionMessage(node, bug) {
  return [
    'Context Guard 工作台向你分配了一个 Bug。',
    `Bug: ${compactText(bug.id, 128)} · ${compactText(bug.title)}`,
    `节点: ${compactText(node.id, 128)} · ${compactText(node.title)}`,
    compactText(bug.desc) ? `描述: ${compactText(bug.desc)}` : '',
    compactText(bug.record, 500) ? `记录: ${compactText(bug.record, 500)}` : '',
    '请在当前项目中核对并处理；完成后更新 Context Guard 中的 Bug 状态和证据。',
  ].filter(Boolean).join('\n');
}
export function todoSessionMessage(node, todo) {
  return [
    'Context Guard 工作台向你分配了一个 TODO。',
    `TODO: ${compactText(todo.id, 128)} · ${compactText(todo.title)}`,
    `节点: ${compactText(node.id, 128)} · ${compactText(node.title)}`,
    compactText(todo.desc) ? `描述: ${compactText(todo.desc)}` : '',
    '请在当前项目中完成这个开发事项；完成后把 Context Guard 中的 TODO 标记为已完成。',
  ].filter(Boolean).join('\n');
}
async function queueCodexMessage({ sessionId, message, root }) {
  await execFileAsync(process.env.CONTEXT_GUARD_CODEX_COMMAND || 'codex', ['queue', '--thread', sessionId, '--message', message], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
}
function loopbackJSON(target, { method = 'GET', headers = {}, body, timeout = 600 } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    let req;
    try {
      req = http.request(target, { method, headers: { Connection: 'close', ...headers }, agent: false }, res => {
        const chunks = [];
        let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 1024 * 1024) { req.destroy(); finish(null); }
          else chunks.push(chunk);
        });
        res.on('end', () => {
          try { finish({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
          catch { finish(null); }
        });
        res.on('error', () => finish(null));
      });
      req.setTimeout(timeout, () => { req.destroy(); finish(null); });
      req.on('error', () => finish(null));
      if (body !== undefined) req.write(body);
      req.end();
    } catch { req?.destroy(); finish(null); }
  });
}
export async function health(state) {
  // A service may disappear between repeated migration probes. Node 24's
  // pooled fetch/undici path can throw setTypeOfService EINVAL outside the
  // request promise on macOS, so lifecycle control uses an unpooled socket.
  const result = await loopbackJSON(new URL('/__context_guard/health', state.url));
  return result?.ok ? result.value : null;
}
export { loopbackJSON };
export async function startServer({ root, port = 8877, host = '127.0.0.1', fault, messageQueue = queueCodexMessage } = {}) {
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new MapError('INVALID_HOST', 'Workbench only listens on loopback');
  root = await fs.realpath(path.resolve(root));
  let project = await ensureProjectBinding(await resolveProject(root));
  const ctx = path.join(root, '.codex/context'), lock = projectLockPath(project), sharedState = projectStatePath(project);
  const namedFile = project.kind === 'git' ? path.join(project.sharedDir, 'named-entry.json') : path.join(ctx, 'private/named-entry.json');
  let namedEntry = await readJSON(namedFile, null), openClaimAt = 0;
  const validNamedOrigin = value => /^http:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.localhost:[1-9][0-9]{0,4}$/.test(value || '') && Number(new URL(value).port) > 0 && Number(new URL(value).port) <= 65535;
  if (namedEntry && (!validNamedOrigin(namedEntry.origin) || typeof namedEntry.proxyToken !== 'string' || namedEntry.proxyToken.length < 32)) throw new MapError('INVALID_ORIGIN', 'Invalid saved named entry; configuration preserved');
  await fs.mkdir(path.dirname(lock), { recursive: true });
  const instance = token();
  for (let i = 0; i < 2; i++) {
    try { const h = await fs.open(lock, 'wx', 0o600); await h.writeFile(encode({ pid: process.pid, instance })); await h.close(); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const owner = await readJSON(lock, null);
      if (!owner?.pid) throw new MapError('STARTING', 'Another instance is starting; retry shortly', 409);
      let alive = true; try { process.kill(owner.pid, 0); } catch (err) { if (err.code === 'ESRCH') alive = false; }
      if (alive) throw new MapError('ALREADY_RUNNING', 'Project already has a Node service', 409);
      await fs.unlink(lock);
    }
  }
  const adminToken = token(), humanToken = token(), agentTokens = new Map(), peers = new Map();
  const access = await new Access(root, project.kind === 'git' ? {
    file: path.join(project.sharedDir, 'workbench-access.json'),
    bindingsFile: sessionBindingsPath(project),
  } : {}).init();
  let stopAccessWatch = () => {}, stopCloudWatch = () => {};
  const stores = new Map(), projectionQueues = new Map(), storeViews = new WeakMap(), syncCoordinators = new Map();
  let mainStore, mainSource = null;
  const sourceFile = path.join(project.sharedDir, 'main-source.json');
  let server, base;
  async function updateMainBaseline(source, { force = false } = {}) {
    if (project.kind !== 'git') return source;
    const mainDir = path.join(project.sharedDir, 'main');
    const mainFile = path.join(mainDir, 'map.json');
    await fs.mkdir(mainDir, { recursive: true });
    if (project.bindingRequired) {
      if (!await readJSON(mainFile, null)) await atomicWrite(mainFile, encode({ v: 1, project: path.basename(project.worktreeRoot), bootstrap: 'pending', flows: [], root: null }));
      return { ...source, status: 'binding-required', needsReconcile: true };
    }
    try {
      const { snapshot } = await memoryRequest(project, 'main');
      if (!snapshot) throw new MapError('BASELINE_PENDING', 'No main baseline has been published', 409);
      validate(snapshot.memory.map);
      await atomicWrite(mainFile, encode(snapshot.memory.map));
      return { ...source, status: snapshot.mainSha === source.sha ? 'ready' : 'stale', memoryVersion: snapshot.version, baselineSha: snapshot.mainSha, needsReconcile: snapshot.mainSha !== source.sha };
    } catch (error) {
      // Keep a previously verified baseline; never replace it with an empty map on disconnect.
      if (!await readJSON(mainFile, null)) await atomicWrite(mainFile, encode({ v: 1, project: path.basename(project.worktreeRoot), bootstrap: 'pending', flows: [], root: null }));
      return { ...source, status: error.code || 'memory-unavailable', needsReconcile: true };
    }
  }
  const send = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
  function broadcast(type, data, viewId = null) {
    for (const peer of peers.values()) if (peer.res && !peer.res.destroyed) {
      if (viewId && peer.viewId !== viewId) continue;
      if (peer.res.writableLength > 2 * 1024 * 1024) { peer.res.destroy(); continue; }
      peer.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }
  async function createStore(viewId, storeRoot, options = {}) {
    let target;
    const { syncDirectory, sessionId, ...storeOptions } = options;
    const projectionRoot = options.projectionRoot || storeRoot;
    const projectMap = project.kind === 'git' && viewId === 'main'
      ? async () => true
      : (doc, version) => {
          const previous = projectionQueues.get(viewId) || Promise.resolve();
          const projectionDoc = sessionId ? scopeDocumentToSession(doc, sessionId) : doc;
          const job = previous.then(() => target.version === version ? generateProjections(projectionRoot, projectionDoc, version, () => target.version === version, { sessionId }) : false);
          projectionQueues.set(viewId, job.catch(() => {})); return job;
        };
    target = new MapStore(storeRoot, { fault, project: projectMap, ...storeOptions });
    await target.init();
    storeViews.set(target, new Set([viewId]));
    target.on('change', state => {
      for (const targetView of storeViews.get(target) || []) broadcast('state', { ...state, viewId: targetView, source: sourceFor(targetView) }, targetView);
    });
    stores.set(viewId, target);
    if (sessionId && syncDirectory) {
      const sessionProject = await resolveProject(storeRoot);
      const coordinator = new MemorySyncCoordinator({ project: sessionProject, sessionId, store: target, directory: syncDirectory });
      coordinator.on('change', status => broadcast('cloud-sync', status, viewId));
      syncCoordinators.set(viewId, coordinator);
      await coordinator.start();
    }
    return target;
  }
  function viewFor(actor, url) {
    if (actor.kind === 'agent') return project.kind === 'git' ? `session:${actor.sessionId}` : 'main';
    const requested = String(url.searchParams.get('view') || 'main');
    if (requested === 'main') return requested;
    if (!requested.startsWith('session:') || !access.binding(requested.slice('session:'.length))) throw new MapError('UNKNOWN_VIEW', 'Select a registered Session view', 404);
    return requested;
  }
  async function ensureSessionMap(sessionProject, sessionId) {
    const dir = sessionMemoryDir(sessionProject, sessionId), file = path.join(dir, 'map.json');
    const baseFile = path.join(dir, 'base-main.json');
    const [existing, baseline] = await Promise.all([readJSON(file, null), readJSON(baseFile, null)]);
    let main = null, remoteSession = null;
    try {
      [main, remoteSession] = await Promise.all([
        memoryRequest(project, 'main').then(result => result.snapshot),
        memoryRequest(sessionProject, `sessions/${encodeURIComponent(sessionId)}`).then(result => result.snapshot),
      ]);
    }
    catch (error) { if (error.code !== 'MEMORY_NOT_CONFIGURED') throw error; }
    if (!existing) {
      const seed = remoteSession?.memory?.map || main?.memory?.map || await readJSON(path.join(sessionProject.worktreeRoot, '.codex/context/map.json'));
      if (main) await atomicWrite(baseFile, encode({ version: main.version, map: main.memory.map }));
      await atomicWrite(file, encode(seed));
    } else if (main && !baseline?.map) {
      const legacySeed = await readJSON(path.join(sessionProject.worktreeRoot, '.codex/context/map.json'), null);
      if (hash(encode(existing)) === hash(encode(main.memory.map))) {
        await atomicWrite(baseFile, encode({ version: main.version, map: main.memory.map }));
      } else if (legacySeed && hash(encode(existing)) === hash(encode(legacySeed))) {
        await atomicWrite(path.join(dir, 'before-main-baseline.json'), encode(existing));
        await atomicWrite(file, encode(main.memory.map));
        await atomicWrite(baseFile, encode({ version: main.version, map: main.memory.map }));
      } else {
        throw new MapError('SESSION_BASELINE_REQUIRED', 'Session cache predates the confirmed main baseline and contains changes; preserve it and reconcile explicitly', 409);
      }
    }
    return { dir, file };
  }
  async function storeFor(viewId) {
    if (viewId === 'main') return stores.get(viewId);
    const sessionId = viewId.startsWith('session:') ? viewId.slice('session:'.length) : '';
    const binding = access.binding(sessionId);
    if (!binding?.worktreeRoot) throw new MapError('UNKNOWN_SESSION', 'Session is not bound to a worktree', 404);
    const sessionProject = await resolveProject(binding.worktreeRoot);
    if (sessionProject.projectId !== project.projectId) throw new MapError('PROJECT_MISMATCH', 'Session worktree belongs to another project', 403);
    if (stores.has(viewId)) return stores.get(viewId);
    const { dir, file } = await ensureSessionMap(sessionProject, sessionId);
    return createStore(viewId, sessionProject.worktreeRoot, { file, runtime: path.join(dir, 'sync'), eventsFile: path.join(dir, 'changes.jsonl'), projectionRoot: dir, sessionId, syncDirectory: dir });
  }
  function sourceFor(viewId) {
    if (viewId === 'main') return mainSource;
    const binding = access.binding(viewId.slice('session:'.length));
    return binding ? { status: 'worktree', branch: binding.branch || '', sha: binding.head || '', worktreeRoot: binding.worktreeRoot, baseMainSha: binding.baseMainSha || '' } : null;
  }
  const stateFor = (viewId, target, full = true) => ({ ...target.state(full), viewId, source: sourceFor(viewId) });
  let refreshing = null;
  function refreshProject() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      project = await resolveProject(root);
      const refreshed = await refreshMain(project);
      mainSource = await updateMainBaseline({ ...mainSource, ...refreshed });
      await mainStore.serial(() => mainStore.refresh());
      await atomicWrite(sourceFile, encode(mainSource));
      broadcast('state', stateFor('main', mainStore, false), 'main');
      return { projectId: project.projectId, source: mainSource };
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function cloudSyncStatus(viewId = 'main') {
    if (syncCoordinators.has(viewId)) return syncCoordinators.get(viewId).snapshot();
    const paths = syncPaths(root);
    const config = await readJSON(paths.config, null) || await readJSON(paths.legacyConfig, null);
    const state = await readJSON(paths.state, null);
    const serviceState = await readJSON(paths.service, null);
    let serviceAlive = false;
    if (serviceState?.pid) try { process.kill(serviceState.pid, 0); serviceAlive = true; } catch {}
    return {
      configured: !!config,
      ...(config ? { projectId: config.projectId, url: config.url } : {}),
      status: !config ? 'disabled' : state?.status || 'connecting',
      cursor: state?.cursor || 0,
      receivedCursor: state?.receivedCursor || 0,
      conflict: state?.conflict || null,
      serviceAlive,
    };
  }
  function viewPeers(viewId) { return [...peers.values()].filter(peer => !viewId || peer.viewId === viewId); }
  function pendingPeers(viewId) { return viewPeers(viewId).filter(p => p.dirty || !p.res || p.res.destroyed).map(p => p.id); }
  async function fence(viewId) {
    const checkpoint = randomUUID();
    broadcast('checkpoint', { checkpoint }, viewId);
    const deadline = Date.now() + 1200;
    while (viewPeers(viewId).some(p => p.checkpoint !== checkpoint)) {
      if (Date.now() >= deadline) throw new MapError('UI_PENDING', 'A page has not acknowledged the synchronization checkpoint', 409, { peers: pendingPeers(viewId) });
      await pause(15);
    }
    if (pendingPeers(viewId).length) throw new MapError('UI_PENDING', 'A page has unsaved edits', 409, { peers: pendingPeers(viewId) });
  }
  async function body(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new MapError('CONTENT_TYPE', 'Use application/json', 415);
    let size = 0, chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new MapError('BODY_TOO_LARGE', 'Request exceeds 16 MiB', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks)); } catch { throw new MapError('INVALID_JSON', 'Malformed JSON'); }
  }
  function auth(req, url) {
    const credential = req.headers.authorization?.replace(/^Bearer /, '') || (url.pathname === '/api/events' ? url.searchParams.get('token') : null);
    if (credential === humanToken) return { kind: 'human', sessionId: 'workbench' };
    const actor = agentTokens.get(credential);
    if (!actor) throw new MapError('UNAUTHORIZED', 'Missing or expired capability', 401);
    return actor;
  }
  async function preparedSessionBinding(input) {
    const sessionId = typeof input?.sessionId === 'string' ? input.sessionId.trim() : '';
    if (!sessionId) throw new MapError('SESSION_REQUIRED', 'A real lifecycle Session ID is required', 400);
    const sessionProject = await resolveProject(input.worktreeRoot || root);
    if (sessionProject.projectId !== project.projectId) throw new MapError('PROJECT_MISMATCH', 'Session worktree belongs to another project', 403);
    const previous = access.binding(sessionId);
    const sameWorktree = previous && (previous.worktreeId === sessionProject.worktreeId
      || !previous.gitDir && previous.worktreeRoot === sessionProject.worktreeRoot);
    if (previous && !sameWorktree) {
      if (!input.allowRebind) throw new MapError('SESSION_ALREADY_BOUND', 'Session is already bound to another worktree; require explicit user confirmation and --rebind', 409, {
        worktreeRoot: previous.worktreeRoot,
        bindingState: await fs.realpath(previous.worktreeRoot || '').then(() => 'other-worktree').catch(() => 'stale'),
      });
    }
    let workbenchUrl = previous?.workbenchUrl || null;
    if (input.workbenchUrl) {
      const candidate = new URL(String(input.workbenchUrl));
      candidate.search = ''; candidate.hash = '';
      const allowedOrigin = candidate.origin === base || candidate.origin === namedEntry?.origin;
      if (!allowedOrigin || candidate.pathname !== '/prototype/workbench.html') throw new MapError('INVALID_WORKBENCH_URL', 'Binding URL must be this project workbench page', 400);
      workbenchUrl = candidate.href;
    }
    return { sessionId, sessionProject, previous, sameWorktree, binding: await sessionBinding(sessionProject, sessionId, { workbenchUrl }) };
  }
  const isHuman = actor => { if (actor.kind !== 'human') throw new MapError('FORBIDDEN', 'Requires the workbench capability', 403); };
  try {
    const previousSource = await readJSON(sourceFile, null);
    const baselineSha = previousSource?.baselineSha || previousSource?.sha || project.mainSha || '';
    mainSource = {
      status: project.bindingRequired ? 'binding-required' : project.kind === 'git' ? 'ready' : 'local-folder',
      branch: project.mainBranch || '', ref: project.mainRef || '', sha: project.mainSha || '', github: project.github,
      baselineSha,
      checkedAt: new Date().toISOString(),
      needsReconcile: !!(baselineSha && project.mainSha && baselineSha !== project.mainSha),
    };
    if (project.kind === 'git') {
      const mainDir = path.join(project.sharedDir, 'main');
      const mainFile = path.join(mainDir, 'map.json');
      mainSource = await updateMainBaseline(mainSource, { force: true });
      await atomicWrite(sourceFile, encode(mainSource));
      mainStore = await createStore('main', project.worktreeRoot, {
        file: mainFile,
        runtime: path.join(mainDir, 'sync'),
        eventsFile: path.join(mainDir, 'workbench-changes.jsonl'),
      });
    } else {
      await atomicWrite(sourceFile, encode(mainSource));
      mainStore = await createStore('main', root);
    }
    const cloudSyncDir = path.join(ctx, 'private/cloud-sync');
    await fs.mkdir(cloudSyncDir, { recursive: true });
    const cloudWatcher = watch(cloudSyncDir, () => {
      clearTimeout(cloudWatcher.timer);
      cloudWatcher.timer = setTimeout(() => cloudSyncStatus().then(status => broadcast('cloud-sync', status)).catch(() => {}), 30);
    });
    stopCloudWatch = () => { clearTimeout(cloudWatcher.timer); cloudWatcher.close(); };
    server = http.createServer(async (req, res) => {
      try {
        const direct = req.headers.host === new URL(base).host;
        const named = namedEntry && req.headers.host === new URL(namedEntry.origin).host && req.headers['x-context-guard-proxy'] === namedEntry.proxyToken;
        if (!direct && !named) throw new MapError('HOST_REJECTED', 'Invalid Host', 403);
        const requestOrigin = direct ? base : namedEntry.origin;
        if (req.headers.origin && req.headers.origin !== requestOrigin) throw new MapError('ORIGIN_REJECTED', 'Cross-origin requests are not allowed', 403);
        const url = new URL(req.url, base), route = url.pathname;
        if (route === '/__context_guard/health' && req.method === 'GET') return send(res, 200, { ok: true, ...runtimeIdentity(), root, projectId: project.projectId, worktreeRoot: project.worktreeRoot, worktreeId: project.worktreeId, pid: process.pid, instance, namedEntry: true, namedRoot: project.kind === 'git' ? project.sharedDir : root, recovery: mainStore.blocked, rss: process.memoryUsage().rss });
        if (route === '/__context_guard/bootstrap' && req.method === 'GET') return send(res, 200, { token: humanToken, root: `project:${project.projectId}`, projectId: project.projectId, bindingRequired: project.bindingRequired, instance, ...runtimeIdentity() });
        if (['/api/named-entry', '/api/open-claim'].includes(route) && req.method === 'POST') {
          if (!direct || req.headers.authorization !== `Bearer ${adminToken}`) throw new MapError('UNAUTHORIZED', 'Requires local CLI credential', 401);
          const input = await body(req);
          if (route === '/api/open-claim') {
            const shouldOpen = !peers.size && Date.now() - openClaimAt > 5000;
            if (shouldOpen) openClaimAt = Date.now();
            return send(res, 200, { shouldOpen });
          }
          if (!validNamedOrigin(input.origin) || typeof input.proxyToken !== 'string' || input.proxyToken.length < 32) throw new MapError('INVALID_ORIGIN', 'Expected an exact local project HTTP origin');
          namedEntry = { name: new URL(input.origin).hostname.slice(0, -10), origin: input.origin, proxyToken: namedEntry?.proxyToken || input.proxyToken };
          await atomicWrite(namedFile, encode(namedEntry));
          return send(res, 200, { proxyToken: namedEntry.proxyToken });
        }
        if (['/api/session-prepare', '/api/session'].includes(route) && req.method === 'POST') {
          if (req.headers.authorization !== `Bearer ${adminToken}`) throw new MapError('UNAUTHORIZED', 'Requires local CLI credential', 401);
          const input = await body(req);
          const prepared = await preparedSessionBinding(input);
          if (route === '/api/session-prepare') return send(res, 200, { prepared: true, binding: prepared.binding, previous: prepared.previous || null });
          if (prepared.previous && !prepared.sameWorktree) {
            const view = `session:${prepared.sessionId}`;
            await fence(view);
            for (const [credential, actor] of agentTokens) if (actor.sessionId === prepared.sessionId) agentTokens.delete(credential);
            if (syncCoordinators.has(view)) { await syncCoordinators.get(view).close(); syncCoordinators.delete(view); }
            if (stores.has(view)) { await stores.get(view).close(); stores.delete(view); }
            for (const peer of viewPeers(view)) peer.res?.end();
          }
          const sessionFiles = project.kind === 'git' ? await ensureSessionMap(prepared.sessionProject, prepared.sessionId) : null;
          const actor = await access.register(prepared.sessionId, prepared.binding);
          if (sessionFiles) {
            const sessionDocument = await readJSON(sessionFiles.file, null);
            await access.promoteLegacyFullGrant(prepared.sessionId, sessionDocument);
          }
          if (sessionFiles && !stores.has(`session:${prepared.sessionId}`)) {
            await createStore(`session:${prepared.sessionId}`, prepared.sessionProject.worktreeRoot, {
              file: sessionFiles.file,
              runtime: path.join(sessionFiles.dir, 'sync'),
              eventsFile: path.join(sessionFiles.dir, 'changes.jsonl'),
              projectionRoot: sessionFiles.dir,
              sessionId: prepared.sessionId,
              syncDirectory: sessionFiles.dir,
            });
          }
          const credential = token(); agentTokens.set(credential, actor);
          return send(res, 200, { token: credential, actor });
        }
        if (route === '/api/stop' && req.method === 'POST') {
          if (req.headers.authorization !== `Bearer ${adminToken}`) throw new MapError('UNAUTHORIZED', 'Requires local CLI credential', 401);
          for (const viewId of stores.keys()) await fence(viewId);
          send(res, 202, { stopping: true }); setImmediate(() => close()); return;
        }
        if (route === '/api/project-refresh' && req.method === 'POST') {
          if (req.headers.authorization !== `Bearer ${adminToken}`) throw new MapError('UNAUTHORIZED', 'Requires local CLI credential', 401);
          return send(res, 200, await refreshProject());
        }
        if (route.startsWith('/api/')) {
          const actor = auth(req, url);
          const viewId = viewFor(actor, url);
          const activeStore = await storeFor(viewId);
          if (route === '/api/cloud-sync' && req.method === 'GET') { isHuman(actor); return send(res, 200, await cloudSyncStatus(viewId)); }
          if (route === '/api/events' && req.method === 'GET') {
            isHuman(actor); const id = url.searchParams.get('clientId');
            if (!id || id.length > 100) throw new MapError('INVALID_CLIENT', 'Invalid clientId');
            const peerId = `${viewId}:${id}`;
            let peer = peers.get(peerId) || { id, viewId, dirty: false, version: null };
            peer.res?.end(); peer.res = res; peers.set(peerId, peer);
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
            res.write(`retry: 500\nevent: state\ndata: ${JSON.stringify(stateFor(viewId, activeStore, false))}\n\n`);
            req.on('close', () => {
              if (peer.res !== res) return;
              // The synchronization fence only represents live pages. Dirty browser
              // state is already captured by the page recovery layer; retaining a
              // disconnected peer would make a closed tab block every later Agent.
              peers.delete(peerId);
            }); return;
          }
          if (route === '/api/presence' && req.method === 'POST') {
            isHuman(actor); const input = await body(req), peerId = `${viewId}:${input.clientId}`, peer = peers.get(peerId);
            if (peer) { peer.dirty = !!input.dirty; peer.version = input.version; peer.checkpoint = input.checkpoint; if (input.closing && !peer.dirty) { peer.res?.end(); peers.delete(peerId); } }
            return send(res, 200, { version: activeStore.version, viewId, source: sourceFor(viewId), synchronized: input.version === activeStore.version && !input.dirty && !activeStore.error && !activeStore.blocked, error: activeStore.error, recovery: activeStore.blocked });
          }
          if (route === '/api/state' && req.method === 'GET') {
            if (actor.kind === 'agent') await fence(viewId);
            await activeStore.serial(() => activeStore.refresh());
            const sessionId = actor.kind === 'agent' ? actor.sessionId : viewId.startsWith('session:') ? viewId.slice('session:'.length) : '';
            const state = stateFor(viewId, activeStore);
            if (sessionId && state.doc) state.doc = scopeDocumentToSession(state.doc, sessionId);
            if (url.searchParams.has('node')) { const entry = state.doc && entries(state.doc.root).get(url.searchParams.get('node')); if (!entry) throw new MapError('NOT_FOUND', 'Node missing', 404); delete state.doc; state.node = entry.node; state.parentId = entry.parent?.id || null; }
            return send(res, 200, { ...state, viewId, actor, grants: access.grants(actor.sessionId, activeStore.doc), peers: viewPeers(viewId).map(({ id, dirty, version }) => ({ id, dirty, version })) });
          }
          if (route === '/api/changes' && req.method === 'GET') {
            await activeStore.serial(() => activeStore.refresh());
            const changes = activeStore.changes(url.searchParams.get('cursor'));
            const sessionId = actor.kind === 'agent' ? actor.sessionId : viewId.startsWith('session:') ? viewId.slice('session:'.length) : '';
            return send(res, 200, sessionId ? scopeChangesToSession(changes, activeStore.doc, sessionId) : changes);
          }
          if (route === '/api/operation' && req.method === 'GET') { const record = await activeStore.operation(url.searchParams.get('id') || ''); return send(res, 200, { found: !!record, result: record?.result, recovery: activeStore.blocked }); }
          if (route === '/api/commit' && req.method === 'POST') {
            const input = await body(req);
            if (project.kind === 'git' && viewId === 'main') throw new MapError('READ_ONLY_MAIN', 'All Sessions follows the committed main branch and is read-only', 403);
            if (actor.kind === 'agent') await fence(viewId);
            const sessionId = actor.kind === 'agent' ? actor.sessionId : viewId.startsWith('session:') ? viewId.slice('session:'.length) : '';
            const scopedInput = sessionId ? { ...input, operations: restoreSessionWorkItemOperations(activeStore.doc, input.operations, sessionId) } : input;
            const result = await activeStore.commit(scopedInput, actor, () => access.grants(actor.sessionId, activeStore.doc), async () => { if (actor.kind === 'agent' && pendingPeers(viewId).length) throw new MapError('UI_PENDING', 'Page edits are still pending', 409); });
            return send(res, 200, result);
          }
          if (route === '/api/access' && req.method === 'GET') {
            isHuman(actor);
            const currentSessionId = viewId.startsWith('session:') ? viewId.slice('session:'.length) : null;
            const snapshot = await access.snapshot(activeStore.doc, currentSessionId);
            const scopedSnapshot = currentSessionId ? {
              ...snapshot,
              sessions: snapshot.sessions.filter(item => item.id === currentSessionId),
              grants: snapshot.grants[currentSessionId] ? { [currentSessionId]: snapshot.grants[currentSessionId] } : {},
            } : snapshot;
            return send(res, 200, { ...scopedSnapshot, project: { id: project.projectId, kind: project.kind, github: project.github, bindingRequired: project.bindingRequired, main: mainSource } });
          }
          if (route === '/api/access-plan' && req.method === 'POST') {
            isHuman(actor); const input = await body(req);
            const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
            await access.register(sessionId);
            await activeStore.serial(() => activeStore.refresh());
            const nodes = assignmentScope(activeStore.doc, String(input.nodeId || '').trim());
            const granted = new Set(access.grants(sessionId, activeStore.doc));
            return send(res, 200, { sessionId, nodeId: input.nodeId, nodes, missing: nodes.filter(id => !granted.has(id)) });
          }
          if (route === '/api/access' && req.method === 'POST') {
            isHuman(actor); const input = await body(req);
            await activeStore.serial(async () => {
              await activeStore.refresh(); const ids = entries(activeStore.doc.root);
              const current = access.accessRecord(input.sessionId);
              const mode = input.mode === 'all' || Array.isArray(input.addNodes) && current?.mode === 'all' ? 'all' : 'explicit';
              const requested = mode === 'all' ? [] : Array.isArray(input.addNodes)
                ? [...new Set([...access.grants(input.sessionId, activeStore.doc), ...input.addNodes])]
                : input.nodes;
              if (!['all', undefined].includes(input.mode) || !Array.isArray(requested) || requested.some(id => !ids.has(id))) throw new MapError('INVALID_SCOPE', 'Unknown node or access mode in scope');
              await access.grant(input.sessionId, requested, activeStore.version, mode);
              const effective = access.grants(input.sessionId, activeStore.doc);
              await activeStore.recordEvent({ operationId: randomUUID(), fromVersion: activeStore.version, version: activeStore.version, actor, actions: ['grant'], nodeIds: effective, sessionId: input.sessionId, mode });
            });
            broadcast('access', {}); return send(res, 200, { saved: true });
          }
          if (route === '/api/session-message' && req.method === 'POST') {
            isHuman(actor); const input = await body(req);
            const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
            const nodeId = typeof input.nodeId === 'string' ? input.nodeId.trim() : '';
            const bugId = typeof input.bugId === 'string' ? input.bugId.trim() : '';
            const todoId = typeof input.todoId === 'string' ? input.todoId.trim() : '';
            const session = (await access.sessionRegistry()).find(item => item.id === sessionId);
            if (!session) throw new MapError('UNKNOWN_SESSION', 'Session is not part of this project', 403);
            if (session.platform !== 'codex') throw new MapError('UNSUPPORTED_PLATFORM', 'Automatic messages currently require a Codex session', 400);
            await activeStore.serial(() => activeStore.refresh());
            const node = activeStore.doc.root ? entries(activeStore.doc.root).get(nodeId)?.node : null;
            const bug = (node?.bugs || []).find(item => item?.id === bugId);
            const todo = (node?.todos || []).find(item => item?.id === todoId);
            if (!node || (!bug && !todo) || (bugId && todoId)) throw new MapError('NOT_FOUND', 'Work item or owner node is missing', 404);
            if (!access.grants(sessionId, activeStore.doc).includes(nodeId)) throw new MapError('SESSION_SCOPE_REQUIRED', 'Authorize this node for the session before assigning work', 403);
            if (bug && ['resolved', 'dormant', 'wontfix'].includes(bug.status)) throw new MapError('BUG_CLOSED', 'Closed bugs cannot be assigned', 409);
            if (todo?.status === 'done') throw new MapError('TODO_CLOSED', 'Completed TODOs cannot be assigned', 409);
            const message = bug ? bugSessionMessage(node, bug) : todoSessionMessage(node, todo);
            const payload = { sessionId, message, root: session.worktreeRoot || root, session, node: structuredClone(node) };
            if (bug) payload.bug = structuredClone(bug); else payload.todo = structuredClone(todo);
            try { await messageQueue(payload); }
            catch { throw new MapError('SESSION_MESSAGE_FAILED', 'Work item could not be delivered to the session', 502); }
            return send(res, 200, { sent: true, sessionId, ...(bug ? { bugId } : { todoId }) });
          }
          if (route === '/api/migration-preview' && req.method === 'POST') {
            isHuman(actor); const input = await body(req); validate(input.doc);
            if (input.doc.project !== activeStore.doc.project) throw new MapError('PROJECT_MISMATCH', 'Cache belongs to a different project');
            await activeStore.serial(() => activeStore.refresh());
            const backup = path.join(activeStore.runtime, 'migration-' + hash(encode(input.doc)) + '.json');
            await atomicWrite(backup, encode({ imported: input.doc, disk: activeStore.doc, baseVersion: activeStore.version }));
            return send(res, 200, { baseVersion: activeStore.version, operations: diffTrees(activeStore.doc.root, input.doc.root), backup, warning: 'Review every replacement and deletion; timestamps do not resolve conflicts.' });
          }
          if (route === '/api/projections' && req.method === 'POST') {
            const input = await body(req); await activeStore.serial(() => activeStore.refresh());
            if (input.wait) {
              const version = activeStore.version;
              const ready = await activeStore.project(activeStore.doc, version);
              if (!ready) throw new MapError('VERSION_CONFLICT', 'Map changed during index generation', 409);
              activeStore.projection = { status: 'ready', sourceVersion: version };
              return send(res, 200, activeStore.projection);
            }
            activeStore.scheduleProjection(); return send(res, 202, { status: 'pending' });
          }
          throw new MapError('NOT_FOUND', 'Unknown API route', 404);
        }
        if (req.method !== 'GET') throw new MapError('METHOD', 'GET required', 405);
        let file, contentType;
        if (route === '/' || route === '/prototype/workbench.html') {
          const html = await fs.readFile(path.join(skillRoot, 'prototype/workbench.html'), 'utf8');
          const boot = JSON.stringify({ token: humanToken, root: `project:${project.projectId}`, projectId: project.projectId, bindingRequired: project.bindingRequired, instance, ...runtimeIdentity() }).replace(/</g, '\\u003c');
          const nonce = token();
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': `default-src 'self'; script-src 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` });
          return res.end(html.replace('<!-- CG_SERVER_BOOT -->', `<script>window.__CG_SERVER=${boot};</script>`).replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`));
        }
        if (['/prototype/map-model.mjs', '/prototype/workbench-sync.mjs'].includes(route)) { file = path.join(skillRoot, route.slice(1)); contentType = 'text/javascript; charset=utf-8'; }
        else if (['/prototype/workbench-app.js', '/prototype/workbench-fixtures.js'].includes(route)) { file = path.join(skillRoot, route.slice(1)); contentType = 'text/javascript; charset=utf-8'; }
        else if (route === '/prototype/workbench.css') { file = path.join(skillRoot, route.slice(1)); contentType = 'text/css; charset=utf-8'; }
        else if (route === '/.codex/context/map.json') { file = mainStore.file; contentType = 'application/json; charset=utf-8'; }
        else if (['/.codex/context/preferences.json', '/.codex/context/candidates.json', '/.codex/context/l1-candidates.json'].includes(route)) { file = path.join(root, route.slice(1)); contentType = 'application/json; charset=utf-8'; }
        else throw new MapError('NOT_FOUND', 'File not exposed', 404);
        const content = await fs.readFile(file); res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(content);
      } catch (e) {
        if (!res.headersSent) send(res, e.status || (e.code === 'ENOENT' ? 404 : 500), { error: { code: e.code || 'INTERNAL_ERROR', message: e.message, ...e.details } });
        else res.end();
      }
    });
    server.requestTimeout = 10000; server.headersTimeout = 10000;
    for (let attempt = 0; ; attempt++) {
      try { await new Promise((resolve, reject) => { const onError = e => reject(e); server.once('error', onError); server.listen(port === 0 ? 0 : port + attempt, '127.0.0.1', () => { server.off('error', onError); resolve(); }); }); break; }
      catch (e) { if (e.code !== 'EADDRINUSE' || attempt >= 20 || port === 0) throw e; }
    }
    base = `http://127.0.0.1:${server.address().port}`;
    const state = { ...runtimeIdentity(), root, projectId: project.projectId, worktreeRoot: project.worktreeRoot, worktreeId: project.worktreeId, sharedDir: project.sharedDir, pid: process.pid, instance, url: base + '/prototype/workbench.html', adminToken };
    await atomicWrite(sharedState, encode(state));
    if (sharedState !== statePath(root)) await atomicWrite(statePath(root), encode(state));
    stopAccessWatch = access.watch(() => broadcast('access', {}));
    const heartbeat = setInterval(() => broadcast('ping', {}), 10000); heartbeat.unref();
    const mainRefresh = setInterval(() => { if (project.kind === 'git') refreshProject().catch(() => {}); }, 30000); mainRefresh.unref();
    let ownershipChecks = 0, ownershipCheckRunning = false;
    const ownershipWatch = setInterval(async () => {
      if (close.promise || ownershipCheckRunning) return;
      ownershipCheckRunning = true;
      try {
        const owner = await readJSON(sharedState, null);
        if (owner?.instance === instance) ownershipChecks = 0;
        else if (++ownershipChecks >= 2) await close();
      } catch {
        // A transient unreadable state file must not terminate a healthy server.
        ownershipChecks = 0;
      } finally { ownershipCheckRunning = false; }
    }, 500);
    ownershipWatch.unref();
    function close() {
      if (close.promise) return close.promise;
      close.promise = (async () => {
        clearInterval(heartbeat);
        clearInterval(mainRefresh);
        clearInterval(ownershipWatch);
        await refreshing?.catch(() => {});
        stopAccessWatch();
        stopCloudWatch();
        // Stop accepting reconnects before draining events or slow projections.
        const disconnected = new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
        });
        for (const p of peers.values()) p.res?.end();
        // A CLI stop owns this loopback server and must not leave undici/Node 24
        // keep-alive connections holding the project lock after the response.
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        await disconnected;
        await Promise.all([...syncCoordinators.values()].map(coordinator => coordinator.close()));
        await Promise.all([...new Set(stores.values())].map(store => store.close()));
        await Promise.all([...projectionQueues.values()]);
        if ((await readJSON(sharedState, null))?.instance === instance) await fs.unlink(sharedState);
        if (sharedState !== statePath(root) && (await readJSON(statePath(root), null))?.instance === instance) await fs.unlink(statePath(root));
        if ((await readJSON(lock, null))?.instance === instance) await fs.unlink(lock);
      })();
      return close.promise;
    }
    // Handler needs the shutdown closure after initialization.
    server.cgClose = close;
    return { state, project, store: mainStore, stores, access, server, close, humanToken };
  } catch (e) { stopAccessWatch(); stopCloudWatch(); await Promise.all([...syncCoordinators.values()].map(coordinator => coordinator.close())); await Promise.all([...new Set(stores.values())].map(store => store.close())); server?.close(); if ((await readJSON(lock, null))?.instance === instance) await fs.unlink(lock); throw e; }
}
