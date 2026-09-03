#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { diffTrees, same, validate, MapError } from '../../prototype/map-model.mjs';

const ownFile = fileURLToPath(import.meta.url);
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
const hashDoc = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseOptions(args) {
  const result = { _: [] };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) result._.push(arg);
    else {
      const key = arg.slice(2);
      result[key] = args[index + 1] && !args[index + 1].startsWith('--') ? args[++index] : true;
    }
  }
  return result;
}

export function syncPaths(root) {
  const dir = path.join(root, '.codex/context/private/cloud-sync');
  return {
    dir,
    config: path.join(dir, 'config.json'),
    state: path.join(dir, 'state.json'),
    base: path.join(dir, 'base-map.json'),
    inbox: path.join(dir, 'inbox.jsonl'),
    service: path.join(dir, 'service.json'),
    serviceLog: path.join(dir, 'service.log'),
    works: path.join(dir, 'works'),
    lock: path.join(dir, 'transaction.lock'),
    map: path.join(root, '.codex/context/map.json'),
  };
}

async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, value, { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function withLock(root, task) {
  const target = syncPaths(root).lock;
  await fs.mkdir(path.dirname(target), { recursive: true });
  const deadline = Date.now() + 5000;
  while (true) {
    try { await fs.mkdir(target); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new MapError('SYNC_BUSY', 'Another cloud sync operation is still running', 409);
      await pause(25);
    }
  }
  try { return await task(); }
  finally { await fs.rm(target, { recursive: true, force: true }); }
}

async function appendInbox(root, event) {
  const file = syncPaths(root).inbox;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'a', 0o600);
  try { await handle.writeFile(`${JSON.stringify(event)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}

async function loadConfig(root) {
  const config = await readJson(syncPaths(root).config);
  if (!config?.url || !config?.projectId || !config?.token) throw new MapError('SYNC_NOT_CONFIGURED', 'Run context-guard sync connect first', 404);
  return config;
}

async function cloudRequest(config, route, { method = 'GET', body, timeout = 15000 } = {}) {
  const response = await fetch(new URL(route, config.url), {
    method,
    headers: { Authorization: `Bearer ${config.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const result = await response.json();
  if (!response.ok) throw new MapError(result.error?.code || 'CLOUD_HTTP_ERROR', result.error?.message || response.statusText, response.status, result.error || {});
  return result;
}

async function readLocalMap(root) {
  const document = JSON.parse((await fs.readFile(syncPaths(root).map, 'utf8')).replace(/^\uFEFF/, ''));
  validate(document);
  return document;
}

async function writeLocalMap(root, document, label = 'cloud') {
  validate(document);
  const paths = syncPaths(root);
  const backup = path.join(paths.dir, `backup-${label}-${Date.now()}.json`);
  const current = await fs.readFile(paths.map, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (current !== null) await atomicWrite(backup, current.endsWith('\n') ? current : `${current}\n`);
  await atomicWrite(paths.map, encode(document));
  return backup;
}

function documentOperations(before, after) {
  if (!before?.root && after?.root) {
    const node = structuredClone(after.root);
    const flows = structuredClone(after.flows || []);
    const operations = [{ type: 'initialize', project: after.project, node }];
    if (flows.length) operations.push({ type: 'document', fields: { flows } });
    return operations;
  }
  const operations = diffTrees(before.root, after.root);
  if (!same(before.flows || [], after.flows || [])) operations.push({ type: 'document', fields: { flows: structuredClone(after.flows || []) } });
  return operations;
}

async function workFiles(root) {
  const directory = syncPaths(root).works;
  const names = await fs.readdir(directory).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  const values = [];
  for (const name of names.filter(name => name.endsWith('.json'))) {
    const value = await readJson(path.join(directory, name));
    if (value) values.push(value);
  }
  return values;
}

function workPath(root, sessionId) {
  return path.join(syncPaths(root).works, `${createHash('sha256').update(sessionId).digest('hex')}.json`);
}

async function saveSyncState(root, state, baseDocument) {
  const paths = syncPaths(root);
  await atomicWrite(paths.state, encode(state));
  if (baseDocument) await atomicWrite(paths.base, encode(baseDocument));
}

async function receiveSnapshot(root, config, { allowDirty = false } = {}) {
  const paths = syncPaths(root);
  const remote = await cloudRequest(config, `/api/projects/${encodeURIComponent(config.projectId)}/map`);
  const state = await readJson(paths.state, { cursor: 0, version: null, status: 'connected' });
  if (!remote.document) return { remote, state, changed: false };
  const local = await readLocalMap(root);
  const base = await readJson(paths.base, null);
  const dirty = base && hashDoc(local) !== hashDoc(base);
  if (dirty && !allowDirty) {
    const next = { ...state, status: 'conflict', conflict: 'LOCAL_DIRTY', remoteVersion: remote.version, receivedCursor: remote.seq, updatedAt: new Date().toISOString() };
    await atomicWrite(paths.state, encode(next));
    return { remote, state: next, changed: false, dirty: true };
  }
  const changed = hashDoc(local) !== hashDoc(remote.document);
  if (changed) await writeLocalMap(root, remote.document, 'pull');
  const next = { ...state, cursor: remote.seq, receivedCursor: remote.seq, version: remote.version, status: 'synced', conflict: null, updatedAt: new Date().toISOString() };
  await saveSyncState(root, next, remote.document);
  return { remote, state: next, changed };
}

export async function connectSync({ root, url, projectId, token, mode = 'safe', startService = true }) {
  root = await fs.realpath(path.resolve(root));
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new MapError('INVALID_CLOUD_URL', 'Cloud URL must use http or https');
  const config = { protocol: 1, url: parsed.origin, projectId, token, connectedAt: new Date().toISOString() };
  const paths = syncPaths(root);
  await fs.mkdir(paths.dir, { recursive: true });
  const local = await readLocalMap(root);
  const remote = await cloudRequest(config, `/api/projects/${encodeURIComponent(projectId)}/map`);
  if (!remote.document) {
    const result = await cloudRequest(config, `/api/projects/${encodeURIComponent(projectId)}/snapshot`, {
      method: 'POST',
      body: { baseVersion: null, operationId: `connect:${randomUUID()}`, document: local },
    });
    await atomicWrite(paths.config, encode(config));
    await saveSyncState(root, { cursor: result.seq, receivedCursor: result.seq, version: result.version, status: 'synced', updatedAt: new Date().toISOString() }, local);
  } else if (hashDoc(remote.document) === hashDoc(local)) {
    await atomicWrite(paths.config, encode(config));
    await saveSyncState(root, { cursor: remote.seq, receivedCursor: remote.seq, version: remote.version, status: 'synced', updatedAt: new Date().toISOString() }, local);
  } else if (mode === 'pull') {
    await atomicWrite(paths.config, encode(config)); await writeLocalMap(root, remote.document, 'connect-pull');
    await saveSyncState(root, { cursor: remote.seq, receivedCursor: remote.seq, version: remote.version, status: 'synced', updatedAt: new Date().toISOString() }, remote.document);
  } else if (mode === 'push') {
    const result = await cloudRequest(config, `/api/projects/${encodeURIComponent(projectId)}/snapshot`, {
      method: 'POST',
      body: { baseVersion: remote.version, operationId: `connect-push:${randomUUID()}`, document: local },
    });
    await atomicWrite(paths.config, encode(config));
    await saveSyncState(root, { cursor: result.seq, receivedCursor: result.seq, version: result.version, status: 'synced', updatedAt: new Date().toISOString() }, local);
  } else throw new MapError('INITIAL_SYNC_CONFLICT', 'Cloud and local maps differ; reconnect with --pull or --push explicitly', 409, { cloudVersion: remote.version });
  if (startService) await ensureService(root);
  return { connected: true, url: config.url, projectId, mode, tokenStored: paths.config };
}

export async function pullSync(root) {
  root = await fs.realpath(path.resolve(root));
  return withLock(root, async () => {
    const config = await loadConfig(root), paths = syncPaths(root);
    const state = await readJson(paths.state, { cursor: 0 });
    const changes = await cloudRequest(config, `/api/projects/${encodeURIComponent(config.projectId)}/changes?after=${state.receivedCursor || state.cursor || 0}`);
    for (const event of changes.events) await appendInbox(root, event);
    if ((await workFiles(root)).some(work => work.status === 'working' || work.status === 'conflict')) {
      const next = { ...state, receivedCursor: changes.cursor, status: changes.events.length ? 'pending' : state.status, updatedAt: new Date().toISOString() };
      await atomicWrite(paths.state, encode(next));
      return { received: changes.events.length, applied: false, cursor: changes.cursor, activeWork: true };
    }
    if (!changes.events.length) return { received: 0, applied: false, cursor: state.cursor || 0 };
    const result = await receiveSnapshot(root, config);
    return { received: changes.events.length, applied: result.changed, cursor: result.state.cursor, conflict: result.state.conflict || null };
  });
}

export async function prepareSync({ root, sessionId, nodeIds = [], paths = [], workId = `work:${sessionId}:${randomUUID()}` }) {
  root = await fs.realpath(path.resolve(root));
  return withLock(root, async () => {
    const config = await loadConfig(root), localPaths = syncPaths(root);
    const existing = await readJson(workPath(root, sessionId));
    if (existing && ['working', 'conflict'].includes(existing.status)) return existing;
    const remote = await cloudRequest(config, `/api/projects/${encodeURIComponent(config.projectId)}/map`);
    const state = await readJson(localPaths.state, { cursor: 0, version: null });
    const local = await readLocalMap(root), base = await readJson(localPaths.base, null);
    if (base && hashDoc(local) !== hashDoc(base)) throw new MapError('LOCAL_DIRTY', 'Local Map changed before prepare; finish or reconcile it first', 409);
    if (remote.document && hashDoc(local) !== hashDoc(remote.document)) await writeLocalMap(root, remote.document, 'prepare');
    const current = remote.document || local;
    await saveSyncState(root, { ...state, cursor: remote.seq, receivedCursor: remote.seq, version: remote.version, status: 'synced', updatedAt: new Date().toISOString() }, current);
    const prepared = await cloudRequest(config, `/api/projects/${encodeURIComponent(config.projectId)}/work/prepare`, {
      method: 'POST', body: { workId, sessionId, scope: { nodeIds, paths } },
    });
    const work = { ...prepared, nodeIds, paths, baseDocument: current };
    await atomicWrite(workPath(root, sessionId), encode(work));
    return { ...prepared, scope: prepared.scope };
  });
}

export async function trackSync({ root, sessionId, paths = [] }) {
  root = await fs.realpath(path.resolve(root));
  return withLock(root, async () => {
    const file = workPath(root, sessionId), work = await readJson(file);
    if (!work || !['working', 'conflict'].includes(work.status)) return { tracked: false, reason: 'NO_ACTIVE_WORK' };
    work.paths = [...new Set([...(work.paths || []), ...paths.map(item => String(item).replace(/^\.\//, '')).filter(Boolean)])].sort();
    await atomicWrite(file, encode(work));
    return { tracked: true, workId: work.workId, paths: work.paths };
  });
}

export async function checkpointSync({ root, sessionId }) {
  root = await fs.realpath(path.resolve(root));
  return withLock(root, async () => {
    const config = await loadConfig(root), file = workPath(root, sessionId), work = await readJson(file);
    if (!work || !['working', 'conflict'].includes(work.status)) return { active: false };
    const local = await readLocalMap(root);
    const operations = documentOperations(work.baseDocument, local);
    const result = await cloudRequest(config, `/api/projects/${encodeURIComponent(config.projectId)}/work/checkpoint`, {
      method: 'POST', body: { workId: work.workId, operations, scope: { nodeIds: work.nodeIds || [], paths: work.paths || [] } },
    });
    work.status = result.status; work.impacts = result.impacts; work.checkedAt = new Date().toISOString(); await atomicWrite(file, encode(work));
    return { active: true, ...result };
  });
}

export async function finishSync({ root, sessionId }) {
  root = await fs.realpath(path.resolve(root));
  return withLock(root, async () => {
    const config = await loadConfig(root), localPaths = syncPaths(root), file = workPath(root, sessionId), work = await readJson(file);
    if (!work || !['working', 'conflict'].includes(work.status)) return { active: false };
    const local = await readLocalMap(root);
    const operations = documentOperations(work.baseDocument, local);
    try {
      const result = await cloudRequest(config, `/api/projects/${encodeURIComponent(config.projectId)}/work/finish`, {
        method: 'POST',
        body: { workId: work.workId, operationId: `finish:${work.workId}`, operations, scope: { nodeIds: work.nodeIds || [], paths: work.paths || [] } },
      });
      const remote = await cloudRequest(config, `/api/projects/${encodeURIComponent(config.projectId)}/map`);
      if (remote.document && hashDoc(local) !== hashDoc(remote.document)) await writeLocalMap(root, remote.document, 'finish');
      await saveSyncState(root, { cursor: remote.seq, receivedCursor: remote.seq, version: remote.version, status: 'synced', conflict: null, updatedAt: new Date().toISOString() }, remote.document || local);
      work.status = 'completed'; work.result = result; work.completedAt = new Date().toISOString(); delete work.baseDocument; await atomicWrite(file, encode(work));
      return { active: true, ...result };
    } catch (error) {
      if (error.code === 'WORK_IMPACT') {
        work.status = 'conflict'; work.impacts = error.details.impacts || []; work.checkedAt = new Date().toISOString(); await atomicWrite(file, encode(work));
      }
      throw error;
    }
  });
}

export async function syncStatus(root) {
  root = await fs.realpath(path.resolve(root));
  const paths = syncPaths(root), config = await readJson(paths.config), state = await readJson(paths.state), service = await readJson(paths.service);
  let serviceAlive = false;
  if (service?.pid) try { process.kill(service.pid, 0); serviceAlive = true; } catch {}
  return {
    configured: !!config,
    ...(config ? { url: config.url, projectId: config.projectId } : {}),
    state,
    service: { alive: serviceAlive, pid: serviceAlive ? service.pid : null },
    works: (await workFiles(root)).map(({ baseDocument: _baseDocument, ...work }) => work),
  };
}

export async function ensureService(root) {
  root = await fs.realpath(path.resolve(root));
  const paths = syncPaths(root), current = await readJson(paths.service);
  if (current?.pid) {
    try { process.kill(current.pid, 0); return { started: false, pid: current.pid }; } catch {}
  }
  const log = await fs.open(paths.serviceLog, 'a');
  const child = spawn(process.execPath, [ownFile, 'serve', '--root', root], { detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
  child.unref(); await log.close();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const service = await readJson(paths.service);
    if (service?.pid) {
      try { process.kill(service.pid, 0); return { started: true, pid: service.pid }; } catch {}
    }
    await pause(30);
  }
  throw new MapError('SYNC_SERVICE_FAILED', 'Cloud sync listener did not start; inspect private/cloud-sync/service.log', 503);
}

async function serve(root) {
  root = await fs.realpath(path.resolve(root));
  const paths = syncPaths(root), config = await loadConfig(root);
  const previous = await readJson(paths.service);
  if (previous?.pid && previous.pid !== process.pid) try { process.kill(previous.pid, 0); throw new MapError('SYNC_SERVICE_RUNNING', 'Cloud sync listener is already running', 409); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await atomicWrite(paths.service, encode({ pid: process.pid, startedAt: new Date().toISOString() }));
  let closing = false, queued = Promise.resolve();
  const consume = event => {
    queued = queued.then(() => withLock(root, async () => {
      const state = await readJson(paths.state, { cursor: 0 });
      if (event.seq <= (state.receivedCursor || 0)) return;
      await appendInbox(root, event);
      const active = (await workFiles(root)).some(work => work.status === 'working' || work.status === 'conflict');
      if (active) {
        await atomicWrite(paths.state, encode({ ...state, receivedCursor: event.seq, status: 'pending', updatedAt: new Date().toISOString() }));
        return;
      }
      await receiveSnapshot(root, config);
    })).catch(async error => {
      const state = await readJson(paths.state, {});
      await atomicWrite(paths.state, encode({ ...state, status: 'error', error: error.code || error.message, updatedAt: new Date().toISOString() }));
    });
  };
  const watcher = watch(paths.map, () => {
    clearTimeout(watcher.timer);
    watcher.timer = setTimeout(() => {
      queued = queued.then(async () => {
        if ((await workFiles(root)).some(work => work.status === 'working' || work.status === 'conflict')) return;
        await withLock(root, async () => {
          const state = await readJson(paths.state, {}), base = await readJson(paths.base), local = await readLocalMap(root);
          if (!base || hashDoc(base) === hashDoc(local)) return;
          const remote = await cloudRequest(config, `/api/projects/${encodeURIComponent(config.projectId)}/map`);
          if (remote.version !== state.version) {
            await atomicWrite(paths.state, encode({ ...state, status: 'conflict', conflict: 'REMOTE_AND_LOCAL_CHANGED', remoteVersion: remote.version, updatedAt: new Date().toISOString() }));
            return;
          }
          const operations = documentOperations(base, local);
          if (!operations.length) return;
          const result = await cloudRequest(config, `/api/projects/${encodeURIComponent(config.projectId)}/commits`, {
            method: 'POST', body: { baseVersion: state.version, operationId: `local:${randomUUID()}`, sessionId: 'workbench', operations },
          });
          await saveSyncState(root, { ...state, cursor: result.seq, receivedCursor: result.seq, version: result.version, status: 'synced', conflict: null, updatedAt: new Date().toISOString() }, local);
        });
      }).catch(() => {});
    }, 80);
  });
  const stop = () => { closing = true; watcher.close(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    while (!closing) {
      const state = await readJson(paths.state, { receivedCursor: 0 });
      try {
        const response = await fetch(new URL(`/api/projects/${encodeURIComponent(config.projectId)}/events?after=${state.receivedCursor || 0}`, config.url), {
          headers: { Authorization: `Bearer ${config.token}` },
          signal: AbortSignal.timeout(60000),
        });
        if (!response.ok) throw new Error(`SSE failed: ${response.status}`);
        const decoder = new TextDecoder(); let buffer = '';
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
            if (data) consume(JSON.parse(data));
          }
          if (closing) break;
        }
      } catch {
        if (!closing) await pause(1000);
      }
    }
  } finally {
    clearTimeout(watcher.timer); watcher.close(); await queued;
    if ((await readJson(paths.service))?.pid === process.pid) await fs.unlink(paths.service).catch(() => {});
  }
}

async function main(args) {
  const [action = 'status', ...rest] = args, options = parseOptions(rest);
  const root = path.resolve(options.root || process.cwd());
  const { resolveProjectRoot } = await import('../workbench/project.mjs');
  if (await resolveProjectRoot(root) !== await fs.realpath(root)) throw new MapError('BOUND_SYNC_UNSUPPORTED', 'Linked-worktree binding currently supports the local Map only. Cloud synchronization needs explicit worktree-aware support; no local or remote Map was changed');
  const sessionId = String(options.session || process.env.CODEX_THREAD_ID || process.env.CLAUDE_SESSION_ID || process.env.CURSOR_SESSION_ID || '');
  if (action === 'connect') {
    let inputToken = options.token;
    if (options['token-stdin']) {
      inputToken = ''; for await (const chunk of process.stdin) inputToken += chunk;
      inputToken = inputToken.trim();
    }
    if (!options.url || !options.project || !inputToken) throw new MapError('USAGE', 'sync connect requires --url, --project, and --token or --token-stdin');
    return connectSync({ root, url: options.url, projectId: options.project, token: inputToken, mode: options.pull ? 'pull' : options.push ? 'push' : 'safe' });
  }
  if (action === 'serve') return serve(root);
  if (action === 'ensure') return ensureService(root);
  if (action === 'status') return syncStatus(root);
  if (action === 'pull') return pullSync(root);
  if (!sessionId) throw new MapError('SESSION_REQUIRED', 'Pass --session or a lifecycle session environment variable');
  const split = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  if (action === 'prepare') return prepareSync({ root, sessionId, nodeIds: split(options.nodes || options.node), paths: split(options.paths) });
  if (action === 'track') return trackSync({ root, sessionId, paths: split(options.paths) });
  if (action === 'checkpoint') return checkpointSync({ root, sessionId });
  if (action === 'finish') return finishSync({ root, sessionId });
  throw new MapError('USAGE', 'Use sync connect|ensure|status|pull|prepare|track|checkpoint|finish');
}

if (process.argv[1] && await fs.realpath(process.argv[1]).catch(() => '') === await fs.realpath(ownFile)) {
  try {
    const result = await main(process.argv.slice(2));
    if (result !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: { code: error.code || 'ERROR', message: error.message, ...(error.details || {}) } })}\n`);
    process.exitCode = 1;
  }
}
