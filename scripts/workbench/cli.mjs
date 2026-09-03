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
import { namedWorkbench, verifyWorkbenchUrl } from './named.mjs';
import { compatibleRuntime, runtimeIdentity } from './runtime.mjs';
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
export async function serviceInventory(project) {
  const worktreeRoots = await listWorktrees(project);
  const stateFiles = [...new Set([projectStatePath(project), ...worktreeRoots.map(statePath)])];
  const records = [];
  for (const file of stateFiles) {
    const state = await readJSON(file, null);
    if (!state) continue;
    const live = await health(state);
    const liveRoot = live?.root ? await fs.realpath(live.root).catch(() => live.root) : null;
    const belongs = live?.projectId === project.projectId || (!live?.projectId && liveRoot && worktreeRoots.includes(liveRoot));
    records.push({
      file,
      state,
      live,
      belongs,
      status: !live ? 'dead' : !belongs ? 'foreign' : compatibleRuntime(live) ? 'ready' : 'legacy',
    });
  }
  const unique = [];
  for (const record of records) {
    const identity = record.live?.instance || `${record.state?.pid || ''}:${record.state?.url || record.file}`;
    if (!unique.some(item => item.identity === identity)) unique.push({ ...record, identity });
  }
  return { worktreeRoots, records: unique };
}

function publicService(record) {
  return {
    stateFile: record.file,
    status: record.status,
    pid: record.live?.pid || record.state?.pid || null,
    url: record.state?.url || null,
    root: record.live?.root || record.state?.root || null,
    projectId: record.live?.projectId || null,
    worktreeRoot: record.live?.worktreeRoot || null,
    instance: record.live?.instance || record.state?.instance || null,
    protocol: record.live?.protocol || record.state?.protocol || null,
    runtimeSchema: record.live?.runtimeSchema || null,
    buildId: record.live?.buildId || null,
    capabilities: Array.isArray(record.live?.capabilities) ? record.live.capabilities : [],
    retireKey: record.live?.pid && record.live?.instance ? `${record.live.pid}:${record.live.instance}` : null,
  };
}

export async function diagnoseWorkbench(root, sessionId = '') {
  const openedRoot = await fs.realpath(path.resolve(root));
  const project = await resolveProject(openedRoot);
  const binding = await bindingStatus(project, sessionId);
  const inventory = await serviceInventory(project);
  const projectServices = inventory.records.filter(item => item.belongs && item.live);
  const ready = projectServices.filter(item => item.status === 'ready');
  const legacy = projectServices.filter(item => item.status === 'legacy');
  const duplicates = ready.length > 1;
  let named = { status: 'not-configured', url: null };
  const namedFile = project.kind === 'git' ? path.join(project.sharedDir, 'named-entry.json') : path.join(openedRoot, '.codex/context/private/named-entry.json');
  const namedEntry = await readJSON(namedFile, null);
  if (namedEntry?.origin) {
    const expected = ready[0]?.live;
    if (!expected) named = { status: legacy.length ? 'legacy-runtime' : 'backend-unavailable', url: namedEntry.origin + '/prototype/workbench.html' };
    else {
      try { await verifyWorkbenchUrl(namedEntry.origin + '/prototype/workbench.html', expected); named = { status: 'ready', url: namedEntry.origin + '/prototype/workbench.html' }; }
      catch (error) { named = { status: 'mismatch', url: namedEntry.origin + '/prototype/workbench.html', error: error.message }; }
    }
  }
  const runtimeStatus = legacy.length ? 'legacy' : duplicates ? 'duplicate' : ready.length === 1 ? (named.status === 'mismatch' ? 'named-mismatch' : 'ready') : 'stopped';
  return {
    expectedRuntime: runtimeIdentity(),
    project: { id: project.projectId, kind: project.kind, root: openedRoot, worktreeRoot: project.worktreeRoot, worktreeId: project.worktreeId, sharedDir: project.sharedDir, main: project.binding?.main || null, bindingRequired: project.bindingRequired },
    runtime: { status: runtimeStatus, services: inventory.records.map(publicService), named },
    ...binding,
    session: { ...binding.session, verified: binding.session.bound && runtimeStatus === 'ready' && (!namedEntry || named.status === 'ready') },
    migrationRequired: legacy.length > 0 || duplicates || named.status === 'mismatch',
    migrationPlan: [...legacy, ...(duplicates ? ready.slice(1) : [])].map(item => ({
      retireKey: publicService(item).retireKey,
      root: item.live?.root || item.state?.root || null,
      reason: item.status === 'legacy' ? 'incompatible-runtime' : 'duplicate-project-owner',
    })),
  };
}

async function migrateServices(root, retireKeys) {
  const project = await resolveProject(root);
  if (project.kind !== 'git') throw new MapError('MIGRATION_UNSUPPORTED', 'Legacy multi-worktree migration requires a Git project', 409);
  const inventory = await serviceInventory(project);
  const requested = new Set(String(retireKeys || '').split(',').map(value => value.trim()).filter(Boolean));
  if (!requested.size) throw new MapError('MIGRATION_CONFIRMATION_REQUIRED', 'Pass the exact comma-separated pid:instance retire keys from workbench --diagnose', 409);
  const candidates = inventory.records.filter(item => item.belongs && item.live && requested.has(`${item.live.pid}:${item.live.instance}`));
  if (candidates.length !== requested.size) throw new MapError('MIGRATION_TARGET_CHANGED', 'A requested service identity is missing or changed; diagnose again', 409);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(project.sharedDir, 'migration-backups', timestamp);
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  const manifest = [];
  for (const item of candidates) {
    const serviceRoot = await fs.realpath(item.live.root || item.state.root);
    const source = path.join(serviceRoot, '.codex/context');
    const target = path.join(backupDir, createHash('sha256').update(serviceRoot).digest('hex').slice(0, 16));
    await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false });
    manifest.push({ retireKey: `${item.live.pid}:${item.live.instance}`, source, target, status: item.status });
  }
  await atomicWrite(path.join(backupDir, 'manifest.json'), encode({ projectId: project.projectId, createdAt: new Date().toISOString(), services: manifest }));
  for (const item of candidates) {
    const current = await health(item.state);
    if (!current || current.pid !== item.live.pid || current.instance !== item.live.instance) throw new MapError('MIGRATION_TARGET_CHANGED', 'Service identity changed after backup; nothing further was signalled', 409, { backupDir });
  }
  for (const item of candidates) process.kill(item.live.pid, 'SIGTERM');
  const deadline = Date.now() + 12000;
  for (const item of candidates) {
    while (Date.now() < deadline && await health(item.state)) await pause(50);
    if (await health(item.state)) throw new MapError('MIGRATION_STOP_TIMEOUT', 'A backed-up service did not stop after SIGTERM; it was not force-killed', 503, { backupDir, retireKey: `${item.live.pid}:${item.live.instance}` });
  }
  return { migrated: true, backupDir, retired: manifest.map(item => item.retireKey), restartRequired: false, next: 'Run workbench with the intended Session; one compatible project service will be created if needed.' };
}

async function stateForWorkbenchUrl(project, value) {
  let target;
  try { target = new URL(String(value)); } catch { throw new MapError('INVALID_WORKBENCH_URL', 'Provide the complete project workbench URL', 400); }
  if (target.protocol !== 'http:' || !(target.hostname === '127.0.0.1' || target.hostname === 'localhost' || target.hostname.endsWith('.localhost'))) {
    throw new MapError('INVALID_WORKBENCH_URL', 'A local workbench URL must use http and localhost', 400);
  }
  let response, advertised;
  try {
    response = await fetch(new URL('/__context_guard/health', target), { signal: AbortSignal.timeout(1500), redirect: 'error' });
    advertised = await response.json();
  } catch (cause) { throw new MapError('WORKBENCH_UNAVAILABLE', `The supplied workbench URL is unavailable: ${cause.message}`, 503); }
  if (!response.ok || !compatibleRuntime(advertised)) throw new MapError('LEGACY_SERVICE', 'The supplied URL is not a compatible Context Guard workbench', 409);
  if (advertised.projectId !== project.projectId) throw new MapError('PROJECT_MISMATCH', 'The supplied URL belongs to a different Git project', 409, { expectedProjectId: project.projectId, actualProjectId: advertised.projectId });
  const state = await readJSON(projectStatePath(project), null);
  const stateHealth = state && await health(state);
  if (!stateHealth || stateHealth.instance !== advertised.instance) throw new MapError('WORKBENCH_IDENTITY_MISMATCH', 'The URL is not the service registered for this Git project', 409);
  return state;
}

export async function ensureServer(root, port = 8877) {
  root = await resolveProjectRoot(root);
  await initialize(root);
  root = await fs.realpath(root);
  const project = await ensureProjectBinding(await resolveProject(root));
  const sharedState = projectStatePath(project);
  const inventory = await serviceInventory(project);
  const liveProject = inventory.records.filter(item => item.belongs && item.live);
  const legacy = liveProject.filter(item => item.status === 'legacy');
  if (legacy.length) throw new MapError('LEGACY_SERVICE', 'An incompatible worktree service is active. Run workbench --diagnose, export its cache, then use the explicit migration command.', 409, { services: legacy.map(publicService) });
  const ready = liveProject.filter(item => item.status === 'ready');
  if (ready.length > 1) throw new MapError('DUPLICATE_SERVICE', 'More than one compatible service owns this Git project. Run workbench --diagnose and migrate exact instances; no process was stopped.', 409, { services: ready.map(publicService) });
  let state = ready[0]?.state || null, live = ready[0]?.live || null;
  if (state && live) {
    if (!state.adminToken) throw new MapError('LEGACY_SERVICE', 'Workbench state lacks its local CLI capability; migrate it explicitly', 409);
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
    if (compatibleRuntime(live) && live.projectId === project.projectId) return state;
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
  if (!compatibleRuntime(await health(state))) throw new MapError('LEGACY_SERVICE', 'Export and migrate the old service with its original identity before stopping it');
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
  if (command === 'workbench' && (opt.migrate || opt._[0] === 'migrate')) {
    return migrateServices(root, opt.retire);
  }
  if (command === 'workbench' && opt['binding-status']) {
    return diagnoseWorkbench(root, String(opt.session || ''));
  }
  if (command === 'workbench' && (opt.diagnose || opt._[0] === 'status')) {
    return diagnoseWorkbench(root, String(opt.session || process.env.CODEX_THREAD_ID || ''));
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
  const state = opt['workbench-url']
    ? await stateForWorkbenchUrl(project, opt['workbench-url'])
    : await ensureServer(root, Number(opt.port ?? 8877));
  if (command === 'workbench') {
    const bindInput = opt.session ? { sessionId: opt.session, worktreeRoot: root, allowRebind: !!opt.rebind } : null;
    if (bindInput) await request(state, '/api/session-prepare', { method: 'POST', body: bindInput });
    const refreshed = await request(state, '/api/project-refresh', { method: 'POST', body: {} });
    const result = opt['workbench-url']
      ? { url: String(opt['workbench-url']), projectRoot: state.root }
      : opt.direct || process.env.CONTEXT_GUARD_NAMED_WORKBENCH === '0'
        ? { url: state.url, projectRoot: state.root }
        : await namedWorkbench(state, request, { name: opt.name });
    await verifyWorkbenchUrl(result.url, { projectId: state.projectId, instance: state.instance });
    if (bindInput) await request(state, '/api/session', { method: 'POST', body: bindInput });
    const claim = opt['claim-open'] ? await request(state, '/api/open-claim', { method: 'POST', body: {} }) : {};
    const url = new URL(result.url);
    if (opt.session) url.searchParams.set('session', String(opt.session));
    const receipt = opt.session ? await diagnoseWorkbench(root, String(opt.session)) : null;
    return { ...result, url: url.href, ...claim, root, projectId: state.projectId, source: refreshed.source, ...runtimeIdentity(), ...(receipt ? { binding: receipt.session, runtime: receipt.runtime } : {}) };
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
if (process.argv[1] && path.resolve(process.argv[1]) === ownFile) {
  try { const result = await main(process.argv.slice(2)); if (result !== undefined) console.log(JSON.stringify(result)); }
  catch (e) { console.log(JSON.stringify({ error: { code: e.code || 'ERROR', message: e.message, ...e.details } })); process.exitCode = 1; }
}
