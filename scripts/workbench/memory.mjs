import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, encode, hash, readJSON, withFileLock } from './io.mjs';
import { bindingStatus, resolveProject } from './project.mjs';
import { MapError } from '../../prototype/map-model.mjs';
import { validateMemory } from './memory-schema.mjs';
export const sessionMemoryDir = (project, sessionId) => path.join(project.sharedDir, 'session-memory', hash(`${sessionId}\0${project.worktreeId}`));
export const memoryConfigPath = project => path.join(project.sharedDir, 'memory-client.json');
const sessionRecordName = sessionId => String(sessionId || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 120) || 'session';
export async function memoryRequest(project, scope, input, configuration) {
  const config = configuration || await readJSON(memoryConfigPath(project), null);
  if (!config) throw new MapError('MEMORY_NOT_CONFIGURED', 'Private memory server is not configured', 503);
  const base = new URL(config.url);
  if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))) throw new MapError('INSECURE_MEMORY_URL', 'Use HTTPS, or an explicit loopback tunnel', 400);
  if (!/^[a-z0-9-]+$/.test(config.projectId || '') || !config.token) throw new MapError('INVALID_MEMORY_CONFIG', 'Project ID and scoped token required');
  const response = await fetch(new URL(`/v1/projects/${config.projectId}/${scope}`, base), { method: input ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${config.token}`, ...(input ? { 'Content-Type': 'application/json' } : {}) }, body: input ? JSON.stringify(input) : undefined });
  const result = await response.json();
  if (!response.ok) throw new MapError(result.error?.code || 'MEMORY_FAILED', result.error?.message || 'Memory request failed', response.status);
  if (result.projectId !== config.projectId) throw new MapError('PROJECT_MISMATCH', 'Server returned another project', 409);
  return result;
}
export async function memoryStatus(project, sessionId) {
  if (!await readJSON(memoryConfigPath(project), null)) return { status: 'not-configured', current: false };
  const [main, session] = await Promise.all([memoryRequest(project, 'main'), sessionId ? memoryRequest(project, `sessions/${encodeURIComponent(sessionId)}`) : null]);
  return { status: 'ready', current: true, main: main.snapshot, session: session?.snapshot || null };
}
export async function prepareMemory(project, sessionId) {
  const status = await memoryStatus(project, sessionId);
  if (!status.current) return status;
  const dir = sessionMemoryDir(project, sessionId);
  const baseFile = path.join(dir, 'base-main.json');
  const baseline = await readJSON(baseFile, null);
  const previous = await readJSON(path.join(dir, 'server-receipt.json'), null);
  const local = await readJSON(path.join(dir, 'map.json'), null);
  const remote = status.session;
  if (!baseline) await atomicWrite(baseFile, encode({ version: remote?.baseMainVersion || null }));
  const localVersion = local ? hash(encode(local)) : null;
  const remoteMapVersion = remote?.memory?.map ? hash(encode(remote.memory.map)) : null;
  const previousMapVersion = previous?.snapshot?.memory?.map ? hash(encode(previous.snapshot.memory.map)) : null;
  if (remote && previous?.snapshot?.version !== remote.version && local && localVersion !== remoteMapVersion && (!previousMapVersion || localVersion !== previousMapVersion)) {
    throw new MapError('MEMORY_CONFLICT', 'Server Session changed while local edits exist; preserve both and reconcile', 409);
  }
  if (remote && (!previous || previous.snapshot?.version !== remote.version)) {
    validateMemory(remote.memory);
    await atomicWrite(path.join(dir, 'map.json'), encode(remote.memory.map));
    await atomicWrite(path.join(dir, 'server-receipt.json'), encode({ snapshot: remote }));
  }
  await atomicWrite(path.join(dir, 'server-read.json'), encode({ ...status, checkedAt: new Date().toISOString() }));
  return { status: 'ready', current: true, sessionVersion: remote?.version || null, mainVersion: status.main?.version || null, cache: path.join(dir, 'server-read.json') };
}
export function mergeMemory(base, local, remote, at = 'map') {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (same(local, remote) || same(base, local)) return remote;
  if (same(base, remote)) return local;
  if ([base, local, remote].every(value => value && typeof value === 'object' && !Array.isArray(value))) {
    const value = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const merged = mergeMemory(base[key], local[key], remote[key], `${at}.${key}`);
      if (merged !== undefined) value[key] = merged;
    }
    return value;
  }
  throw new MapError('MEMORY_CONFLICT', `Both Session and main changed ${at}; preserve drafts and reconcile explicitly`, 409);
}
export async function rebaseMemory(project, sessionId, { adoptMain = false } = {}) {
  const dir = sessionMemoryDir(project, sessionId);
  const status = await memoryStatus(project, sessionId), main = status.main;
  if (!main) return { rebased: false, reason: 'no-published-main' };
  return withFileLock(path.join(dir, 'pending-upload.json.lock'), async () => {
    if (await readJSON(path.join(dir, 'pending-upload.json'), null)) throw new MapError('UPLOAD_PENDING', 'Replay the pending upload before rebasing', 409);
    const remoteSync = path.join(dir, 'remote-sync');
    if (await readJSON(path.join(remoteSync, 'outbox.json'), null)) throw new MapError('UPLOAD_PENDING', 'Replay the workbench upload before rebasing', 409);
    if (await readJSON(path.join(remoteSync, 'conflict.json'), null)) throw new MapError('MEMORY_CONFLICT', 'Review the preserved workbench conflict before rebasing', 409);
    const base = await readJSON(path.join(dir, 'base-main.json'), { version: null });
    const local = await readJSON(path.join(dir, 'map.json'));
    if (!base.map && !adoptMain) {
      throw new MapError('SESSION_BASELINE_REQUIRED', 'Session has no confirmed main ancestor; rerun with --adopt-main only after reviewing the preserved Session draft', 409);
    }
    if (base.map && adoptMain) {
      const entries = await fs.readdir(dir).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
      const interrupted = entries.some(name => name.startsWith('before-main-adoption-'))
        && !await readJSON(path.join(dir, 'main-adoption-receipt.json'), null);
      if (!interrupted) throw new MapError('BASELINE_ALREADY_CONFIRMED', 'Use ordinary memory rebase after a Session main ancestor is confirmed', 409);
    }
    const merged = adoptMain ? main.memory.map : mergeMemory(base.map, local, main.memory.map);
    validateMemory({ map: merged, records: {} });
    const backup = path.join(dir, `${adoptMain ? 'before-main-adoption' : 'before-rebase'}-${randomUUID()}.json`);
    await atomicWrite(backup, encode(local));
    let adopted = null;
    if (adoptMain) {
      adopted = await memoryRequest(project, `sessions/${encodeURIComponent(sessionId)}`, {
        operationId: `baseline-adopt:${sessionId}:${randomUUID()}`,
        baseVersion: status.session?.version || null,
        baseMainVersion: main.version,
        sourceCommit: project.head,
        memory: { map: merged, records: status.session?.memory?.records || {} },
      });
    }
    await atomicWrite(path.join(dir, 'map.json'), encode(merged));
    await atomicWrite(path.join(dir, 'base-main.json'), encode({ version: main.version, map: main.memory.map }));
    if (adopted) {
      await atomicWrite(path.join(dir, 'server-receipt.json'), encode(adopted));
      await atomicWrite(path.join(remoteSync, 'server-base.json'), encode(merged));
      const previousState = await readJSON(path.join(remoteSync, 'state.json'), {});
      await atomicWrite(path.join(remoteSync, 'state.json'), encode({ ...previousState, configured: true, status: 'synced', pending: 0, serverVersion: adopted.snapshot.version, error: null, conflict: null, lastSyncedAt: adopted.snapshot.updatedAt }));
      await atomicWrite(path.join(dir, 'main-adoption-receipt.json'), encode({ mainVersion: main.version, sessionVersion: adopted.snapshot.version, backup, at: new Date().toISOString() }));
    }
    return { rebased: true, strategy: adoptMain ? 'adopt-main' : 'merge', mainVersion: main.version, sessionVersion: adopted?.snapshot?.version || status.session?.version || null, backup };
  });
}
export async function synchronizeMemory(root, sessionId, client = {}) {
  const project = await resolveProject(root);
  if (!(await bindingStatus(project, sessionId)).session.bound) throw new MapError('SESSION_BINDING_REQUIRED', 'Bind the actual Session before synchronization', 409);
  const dir = sessionMemoryDir(project, sessionId), queue = path.join(dir, 'pending-upload.json');
  return withFileLock(queue + '.lock', async () => {
    const scope = `sessions/${encodeURIComponent(sessionId)}`;
    // Retry an uncertain operation byte-for-byte before constructing a newer upload.
    const pending = await readJSON(queue, null);
    if (pending) { await memoryRequest(project, scope, pending); await fs.unlink(queue); }
    const current = await memoryStatus(project, sessionId);
    if (!current.current) throw new MapError('MEMORY_NOT_CONFIGURED', 'Configure private memory before syncing', 503);
    const map = await readJSON(path.join(dir, 'map.json'));
    const ctx = path.join(root, '.codex/context'), records = {};
    for (const folder of ['', 'sessions', 'bugs', 'fixes', 'tasks', 'cards']) {
      for (const entry of await fs.readdir(path.join(ctx, folder), { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
        if (!entry.isFile()) continue;
        const file = folder ? `${folder}/${entry.name}` : entry.name;
        if (folder === 'sessions' && entry.name !== `${sessionRecordName(sessionId)}.md`) continue;
        if (!folder && entry.name === 'user-messages.md') continue;
        try { validateMemory({ map, records: { [file]: '' } }); } catch { continue; }
        let content = await fs.readFile(path.join(ctx, file), 'utf8');
        if (file === 'sessions.jsonl') content = content.split('\n').filter(line => { try { return JSON.parse(line).session_id === sessionId; } catch { return false; } }).join('\n');
        records[file] = content;
      }
    }
    const baseline = await readJSON(path.join(dir, 'base-main.json'), { version: null });
    const syncContext = {
      sessionId,
      hookEvent: String(client.hookEvent || '').slice(0, 80),
      eventId: String(client.eventId || '').slice(0, 200),
      occurredAt: String(client.occurredAt || new Date().toISOString()),
      cursor: Number.isFinite(Number(client.cursor)) ? Number(client.cursor) : null,
    };
    const input = { operationId: randomUUID(), baseVersion: current.session?.version || null, baseMainVersion: baseline.version, sourceCommit: project.head, memory: { map, records }, client: syncContext };
    validateMemory(input.memory);
    const unchanged = current.session
      && current.session.sourceCommit === input.sourceCommit
      && current.session.baseMainVersion === input.baseMainVersion
      && encode(current.session.memory) === encode(input.memory);
    if (unchanged) return { committed: true, synchronized: true, changed: false, projectId: current.session.projectId || null, snapshot: current.session };
    await atomicWrite(queue, encode(input));
    const result = await memoryRequest(project, scope, input);
    await atomicWrite(path.join(dir, 'server-receipt.json'), encode(result));
    await fs.unlink(queue);
    return result;
  });
}
