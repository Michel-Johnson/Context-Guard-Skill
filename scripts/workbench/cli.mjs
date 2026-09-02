#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startServer, statePath, health, skillRoot } from './server.mjs';
import { readJSON, pause } from './io.mjs';
import { MapError } from '../../prototype/map-model.mjs';
import { AgentInbox } from './inbox.mjs';
import { buildArchiveReconciliation } from './reconcile.mjs';
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
  await initialize(root);
  root = await fs.realpath(root);
  const sameRoot = async live => live?.root && await fs.realpath(live.root).catch(() => null) === root;
  let state = await readJSON(statePath(root), null), live = state && await health(state);
  if (await sameRoot(live)) {
    if (live.protocol !== 2 || !state.adminToken) throw new MapError('LEGACY_SERVICE', 'Old read-only service is active. Export its cache before stopping it and starting the Node workbench.', 409);
    return state;
  }
  const log = await fs.open(path.join(root, '.codex/context/private/node-workbench.log'), 'a');
  const child = spawn(process.execPath, [ownFile, 'serve', '--root', root, '--port', String(port)], { detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
  child.unref(); await log.close();
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    await pause(60); state = await readJSON(statePath(root), null).catch(() => null); live = state && await health(state);
    if (live?.protocol === 2 && await sameRoot(live)) return state;
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
  const state = await readJSON(statePath(root), null);
  if (!state || !await health(state)) return { stopped: false };
  if (state.protocol !== 2) throw new MapError('LEGACY_SERVICE', 'Stop the old service with its original CLI after exporting cache');
  await request(state, '/api/stop', { method: 'POST', body: {} });
  const deadline = Date.now() + 12000;
  // A stop acknowledgement is not a released project lock. Do not let the next
  // command race the old process while it flushes writes and closes sockets.
  for (;;) {
    const current = await readJSON(statePath(root), null);
    const lock = await readJSON(path.join(root, '.codex/context/private/node-workbench.lock'), null);
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
  if (command === 'serve') {
    const running = await startServer({ root, port: Number(opt.port ?? 8877), host: opt.host || '127.0.0.1' });
    process.on('SIGTERM', () => running.close()); process.on('SIGINT', () => running.close());
    console.log(JSON.stringify({ url: running.state.url, protocol: 2 })); return;
  }
  if (command === 'workbench' && opt.stop) {
    return stopServer(root);
  }
  const state = await ensureServer(root, Number(opt.port ?? 8877));
  if (command === 'workbench') return { url: state.url, root, protocol: 2 };
  let sessionId = opt.session || process.env.CODEX_THREAD_ID || process.env.CLAUDE_SESSION_ID || process.env.CURSOR_SESSION_ID;
  if (['attach-bug', 'update-bug'].includes(command) && !opt.session || command === 'map' && opt._[0] === 'projections' && !opt.session) {
    sessionId = `maintenance-${process.pid}-${randomUUID()}`;
    await fs.appendFile(path.join(root, '.codex/context/sessions.jsonl'), JSON.stringify({ at: new Date().toISOString(), event: 'maintenance', session_id: sessionId, platform: 'cli' }) + '\n');
  }
  if (!sessionId) throw new MapError('SESSION_REQUIRED', 'Pass the real lifecycle --session ID (or CODEX_THREAD_ID)');
  const registered = await request(state, '/api/session', { method: 'POST', body: { sessionId } });
  const call = (route, params = {}) => request(state, route, { ...params, token: registered.token });
  const action = command === 'map' ? opt._[0] || 'status' : command;
  if (['inbox', 'ack', 'watch'].includes(action)) {
    const inbox = new AgentInbox(root, sessionId, call);
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
  throw new MapError('USAGE', 'Use workbench, attach-bug, update-bug, or map status|read|changes|inbox|ack|watch|apply|operation|projections|reconcile');
}
if (process.argv[1] && path.resolve(process.argv[1]) === ownFile) {
  try { const result = await main(process.argv.slice(2)); if (result !== undefined) console.log(JSON.stringify(result)); }
  catch (e) { console.log(JSON.stringify({ error: { code: e.code || 'ERROR', message: e.message, ...e.details } })); process.exitCode = 1; }
}
