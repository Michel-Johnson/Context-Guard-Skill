#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { startServer, statePath, projectStatePath, projectLockPath, health, skillRoot } from './server.mjs';
import { resolveProject, ensureProjectBinding, saveMainBinding, bindingStatus, listWorktrees, projectPreferences } from './project.mjs';
import { readJSON, pause } from './io.mjs';
import { MapError } from '../../prototype/map-model.mjs';
import { AgentInbox } from './inbox.mjs';
import { buildArchiveReconciliation } from './reconcile.mjs';
import { memoryRequest, memoryStatus, prepareMemory, rebaseMemory, synchronizeMemory, memoryConfigPath, sessionMemoryDir } from './memory.mjs';
import { atomicWrite, encode } from './io.mjs';
import { resolveProjectRoot, bindProject } from './project.mjs';
import { namedWorkbench } from './named.mjs';
const ownFile = fileURLToPath(import.meta.url);
function options(args) {
  const opts = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { const key = args[i].slice(2); opts[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true; }
    else opts._.push(args[i]);
  }
  return opts;
}
async function initialize(root) {
  try { await fs.access(path.join(root, '.codex/context/map.json')); return; } catch {}
  const commands = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  for (const command of commands) {
    const result = spawnSync(command, [path.join(skillRoot, 'scripts/context_guard.py'), 'init', '--root', root], { encoding: 'utf8', windowsHide: true });
    if (result.error?.code === 'ENOENT') continue;
    if (result.status === 0) return;
    throw new Error(result.stderr || 'Project initialization failed');
  }
  throw new Error('Python is still required for project initialization');
}
export async function ensureServer(root, port = 8877) {
  root = await resolveProjectRoot(root);
  await initialize(root);
  root = await fs.realpath(root);
  const project = await ensureProjectBinding(await resolveProject(root));
  const sharedState = projectStatePath(project);
  const sameProject = async live => live?.projectId
    ? live.projectId === project.projectId
    : !!live?.root && await fs.realpath(live.root).catch(() => null) === root;
  const worktreeRoots = await listWorktrees(project);
  const stateFiles = [...new Set([sharedState, ...worktreeRoots.map(statePath)])];
  let state = null, live = null;
  for (const file of stateFiles) {
    const candidate = await readJSON(file, null);
    const candidateLive = candidate && await health(candidate);
    if (!candidateLive) continue;
    if (candidateLive.projectId === project.projectId) { state = candidate; live = candidateLive; break; }
    if (!candidateLive.projectId && candidateLive.root && worktreeRoots.includes(await fs.realpath(candidateLive.root).catch(() => ''))) {
      throw new MapError('LEGACY_SERVICE', 'An older worktree-scoped service is active. Export its cache and stop it before starting the project workbench.', 409, { root: candidateLive.root });
    }
  }
  if (await sameProject(live)) {
    if (live.protocol !== 2 || !state.adminToken) throw new MapError('LEGACY_SERVICE', 'Old read-only service is active. Export its cache before stopping it and starting the Node workbench.', 409);
    if (sharedState !== statePath(root)) await fs.mkdir(path.dirname(statePath(root)), { recursive: true }).then(() => fs.writeFile(statePath(root), JSON.stringify(state, null, 2) + '\n'));
    return state;
  }
  await fs.mkdir(path.join(root, '.codex/context/private'), { recursive: true, mode: 0o700 });
  const log = await fs.open(path.join(root, '.codex/context/private/node-workbench.log'), 'a', 0o600);
  const child = spawn(process.execPath, [ownFile, 'serve', '--root', root, '--port', String(port)], { detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
  child.unref(); await log.close();
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    await pause(60); state = await readJSON(sharedState, null).catch(() => null) || await readJSON(statePath(root), null).catch(() => null); live = state && await health(state);
    if (live?.protocol === 2 && await sameProject(live)) return state;
  }
  throw new MapError('START_FAILED', 'Node workbench did not become healthy; inspect private/node-workbench.log', 503);
}
export async function request(state, route, { token = state.adminToken, method = 'GET', body } = {}) {
  const response = await fetch(new URL(route, state.url), { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new MapError(result.error?.code || 'HTTP_ERROR', result.error?.message || response.statusText, response.status, result.error || {});
  return result;
}
export async function stopServer(root) {
  root = await fs.realpath(root);
  const project = await resolveProject(root);
  const sharedState = projectStatePath(project);
  const state = await readJSON(sharedState, null) || await readJSON(statePath(root), null);
  if (!state || !await health(state)) return { stopped: false };
  if (state.protocol !== 2) throw new MapError('LEGACY_SERVICE', 'Stop the old service with its original CLI after exporting cache');
  await request(state, '/api/stop', { method: 'POST', body: {} });
  const deadline = Date.now() + 12000;
  // A stop acknowledgement is not a released project lock. Do not let the next
  // command race the old process while it flushes writes and closes sockets.
  for (;;) {
    const current = await readJSON(sharedState, null);
    const lock = await readJSON(projectLockPath(project), null);
    if (current?.instance !== state.instance && lock?.instance !== state.instance) return { stopped: true };
    if (Date.now() >= deadline) throw new MapError('STOP_FAILED', 'Workbench has not finished shutting down; project lock preserved', 503);
    await pause(25);
  }
}
async function inputJSON(file) {
  if (file && file !== '-') return JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
  let text = ''; for await (const chunk of process.stdin) text += chunk; return JSON.parse(text);
}
async function main(args) {
  const [command, ...rest] = args, opt = options(rest), root = path.resolve(opt.root || process.cwd());
  if (command === 'workbench' && opt._[0] === 'bind') {
    if (typeof opt['project-root'] !== 'string') throw new MapError('USAGE', 'workbench bind requires --project-root');
    return bindProject(root, path.resolve(opt['project-root']), { keepLocal: !!opt['keep-local'] });
  }
  if (command === 'preferences') return projectPreferences(await resolveProject(root), opt.language);
  if (command === 'memory') {
    const project = await resolveProject(root), session = String(opt.session || process.env.CODEX_THREAD_ID || '');
    if (opt._[0] === 'configure') {
      const config = await inputJSON(opt.input);
      if (!config.url || !config.token || !config.projectId) throw new MapError('INVALID_MEMORY_CONFIG', 'Provide url, projectId, and token in the private input file');
      await memoryRequest(project, 'main', undefined, config);
      await atomicWrite(memoryConfigPath(project), encode(config));
      return { configured: true, verified: (await memoryStatus(project, session)).current };
    }
    if (opt._[0] === 'sync') return synchronizeMemory(root, session);
    if (opt._[0] === 'prepare') return prepareMemory(project, session);
    if (opt._[0] === 'rebase') return rebaseMemory(project, session);
    if (opt._[0] === 'publish') return memoryRequest(project, 'publish', await inputJSON(opt.input));
    return memoryStatus(project, session);
  }
  if (command === 'serve') {
    const running = await startServer({ root, port: Number(opt.port ?? 8877), host: opt.host || '127.0.0.1' });
    process.on('SIGTERM', () => running.close()); process.on('SIGINT', () => running.close());
    console.log(JSON.stringify({ url: running.state.url, protocol: 2 })); return;
  }
  if (command === 'workbench' && opt.stop) {
    return stopServer(root);
  }
  if (command === 'workbench' && opt['binding-status']) {
    return bindingStatus(await resolveProject(root), String(opt.session || ''));
  }
  if (command === 'workbench' && (opt['bind-main'] || opt['local-main'])) {
    const project = await saveMainBinding(root, {
      mode: opt['local-main'] ? 'local' : 'remote',
      remote: String(opt.remote || 'origin'),
      branch: String(opt['local-main'] || opt['bind-main']),
    });
    return { saved: true, ...(await bindingStatus(project, String(opt.session || ''))) };
  }
  const project = await ensureProjectBinding(await resolveProject(root));
  if (command === 'workbench' && opt.session && project.bindingRequired) {
    throw new MapError('BINDING_REQUIRED', 'Choose the project main branch before binding this Session', 409, { projectId: project.projectId });
  }
  let sessionId = opt.session || process.env.CODEX_THREAD_ID || process.env.CLAUDE_SESSION_ID || process.env.CURSOR_SESSION_ID;
  const isMaintenance = ['attach-bug', 'update-bug'].includes(command) && !opt.session || command === 'map' && opt._[0] === 'projections' && !opt.session;
  if (command !== 'workbench' && !isMaintenance && (!sessionId || !(await bindingStatus(project, sessionId)).session.bound)) {
    throw new MapError('SESSION_BINDING_REQUIRED', 'Ask which workbench to bind to; confirm with workbench --session. No service or map was created.', 409);
  }
  const state = await ensureServer(root, Number(opt.port ?? 8877));
  if (command === 'workbench') {
    if (opt.session) await request(state, '/api/session', { method: 'POST', body: { sessionId: opt.session, worktreeRoot: root, allowRebind: !!opt.rebind } });
    const refreshed = await request(state, '/api/project-refresh', { method: 'POST', body: {} });
    const result = opt.direct || process.env.CONTEXT_GUARD_NAMED_WORKBENCH === '0'
      ? { url: state.url, projectRoot: state.root }
      : await namedWorkbench(state, request, { name: opt.name });
    const claim = opt['claim-open'] ? await request(state, '/api/open-claim', { method: 'POST', body: {} }) : {};
    return { ...result, ...claim, root, projectId: state.projectId, source: refreshed.source, protocol: 2 };
  }
  let maintenance = false;
  if (['attach-bug', 'update-bug'].includes(command) && !opt.session || command === 'map' && opt._[0] === 'projections' && !opt.session) {
    sessionId = `maintenance-${process.pid}-${randomUUID()}`;
    maintenance = true;
    await fs.appendFile(path.join(root, '.codex/context/sessions.jsonl'), JSON.stringify({ at: new Date().toISOString(), event: 'maintenance', session_id: sessionId, platform: 'cli' }) + '\n');
  }
  if (!sessionId) throw new MapError('SESSION_REQUIRED', 'Pass the real lifecycle --session ID (or CODEX_THREAD_ID)');
  if (!maintenance && !(await bindingStatus(project, sessionId)).session.bound) {
    throw new MapError('SESSION_BINDING_REQUIRED', 'Ask the user to confirm this Session binding, then run workbench --session before Map actions', 409, { projectId: project.projectId, sessionId });
  }
  const registered = await request(state, '/api/session', { method: 'POST', body: { sessionId, worktreeRoot: root, allowRebind: false } });
  const call = (route, params = {}) => request(state, route, { ...params, token: registered.token });
  const action = command === 'map' ? opt._[0] || 'status' : command;
  if (['inbox', 'ack', 'watch'].includes(action)) {
    const dir = sessionMemoryDir(project, sessionId);
    const inbox = new AgentInbox(root, sessionId, call, project.kind === 'git' ? { ctx: dir, pendingFile: path.join(dir, 'sync/pending.json'), eventsDir: dir } : {});
    if (action === 'ack') return inbox.acknowledge(opt.receipt);
    if (action === 'watch') return inbox.wait(Number(opt['wait-ms'] ?? 40000));
    return inbox.read({ start: !!opt.start });
  }
  if (action === 'read' || action === 'status') {
    const result = await call('/api/state' + (opt.node ? '?node=' + encodeURIComponent(opt.node) : ''));
    if (result.error || result.recovery) throw new MapError(result.error?.code || 'RECOVERY_REQUIRED', result.error?.message || 'Resolve pending commit recovery before acting', 503, { version: result.version, recovery: result.recovery });
    if (action === 'status') { delete result.doc; delete result.node; }
    return result;
  }
  if (action === 'changes') return call('/api/changes' + (opt.cursor ? '?cursor=' + encodeURIComponent(opt.cursor) : ''));
  if (action === 'operation') return call('/api/operation?id=' + encodeURIComponent(opt.id || ''));
  if (action === 'apply') return call('/api/commit', { method: 'POST', body: await inputJSON(opt.input) });
  if (action === 'reconcile') {
    const input = await inputJSON(opt.input), snapshot = await call('/api/state');
    const reconciliation = buildArchiveReconciliation(snapshot.doc, sessionId, input);
    if (!reconciliation.operations.length) return { committed: true, duplicate: !!reconciliation.key, version: snapshot.version, reconciliation };
    const result = await call('/api/commit', { method: 'POST', body: { operationId: reconciliation.operationId, baseVersion: snapshot.version, operations: reconciliation.operations } });
    return { ...result, reconciliation: { ...reconciliation, operations: reconciliation.operations.map(operation => operation.type) } };
  }
  if (action === 'projections') return call('/api/projections', { method: 'POST', body: { wait: !!opt.wait } });
  if (action === 'record-todo') {
    const input = await inputJSON(opt.input);
    const nodeId = typeof input.node === 'string' ? input.node.trim() : '';
    const signalId = typeof input.signalId === 'string' ? input.signalId.trim() : '';
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!nodeId || !signalId || !title) throw new MapError('INVALID_TODO', 'record-todo needs node, signalId, and title');
    const snapshot = await call('/api/state?node=' + encodeURIComponent(nodeId));
    if (!snapshot.node) throw new MapError('NOT_FOUND', `Node ${nodeId} is missing`, 404);
    const id = typeof input.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(input.id)
      ? input.id
      : `TD-${createHash('sha256').update(`${sessionId}\0${signalId}`).digest('hex').slice(0, 16)}`;
    const existing = (snapshot.node.todos || []).find(item => item?.id === id || item?.source_signal === signalId);
    if (existing) return { committed: true, duplicate: true, version: snapshot.version, todo: existing };
    const at = typeof input.at === 'string' && input.at ? input.at : new Date().toISOString();
    const todo = {
      id,
      title,
      desc: typeof input.description === 'string' ? input.description.trim() : '',
      status: 'processing',
      sessions: [sessionId],
      target_session: sessionId,
      source_signal: signalId,
      created_at: at,
      updated_at: at,
    };
    const result = await call('/api/commit', {
      method: 'POST',
      body: {
        operationId: `todo:${sessionId}:${signalId}`,
        baseVersion: snapshot.version,
        operations: [{ type: 'update', id: nodeId, fields: { todos: [...(snapshot.node.todos || []), todo] } }],
      },
    });
    return { ...result, todo };
  }
  if (action === 'attach-bug') {
    const input = await inputJSON(opt.input), snapshot = await call('/api/state');
    return call('/api/commit', { method: 'POST', body: { operationId: `bug:${sessionId}:${input.bug.id}`, baseVersion: snapshot.version, operations: [{ type: 'attach-bug', id: input.node, bug: input.bug }] } });
  }
  if (action === 'update-bug') {
    const input = await inputJSON(opt.input), snapshot = await call('/api/state');
    const result = await call('/api/commit', { method: 'POST', body: { operationId: `bug-status:${sessionId}:${input.bug.id}:${input.bug.status}`, baseVersion: snapshot.version, operations: [{ type: 'update-bug', bug: input.bug }] } });
    // The command updates both the live map and its generated indexes as one observable operation.
    await call('/api/projections', { method: 'POST', body: { wait: true } });
    return result;
  }
  throw new MapError('USAGE', 'Use workbench, attach-bug, update-bug, record-todo, or map status|read|changes|inbox|ack|watch|apply|operation|projections|reconcile');
}
if (process.argv[1] && await fs.realpath(process.argv[1]).catch(() => '') === await fs.realpath(ownFile)) {
  try { const result = await main(process.argv.slice(2)); if (result !== undefined) console.log(JSON.stringify(result)); }
  catch (e) { console.log(JSON.stringify({ error: { code: e.code || 'ERROR', message: e.message, ...e.details } })); process.exitCode = 1; }
}
