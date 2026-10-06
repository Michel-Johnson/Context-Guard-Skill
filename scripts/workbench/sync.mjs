import fs from 'node:fs/promises';
import path from 'node:path';
import { encode, readJSON } from '../shared/io.mjs';
import { MapError } from '../shared/map-model.mjs';
import { bindingStatus, resolveProject } from './project.mjs';
import { memoryConfigPath, sessionMemoryDir, prepareMemory, synchronizeMemory } from './memory.mjs';

// Read-only retirement guard. Old drafts and receipts are never migrated by
// guessing that a project-wide Map belongs to the newly bound Session.
export async function inspectRetiredSync(project) {
  const local = path.join(project.worktreeRoot, '.codex/context/private/cloud-sync');
  const directories = [...new Set([local, path.join(project.sharedDir, 'cloud-sync')])];
  let configured = false;
  const pending = [];
  for (const directory of directories) {
    let names;
    try { names = await fs.readdir(directory); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    configured ||= names.includes('config.json');
    try {
      const state = await readJSON(path.join(directory, 'state.json'), null);
      if (state && (state.conflict || state.pending || !['synced', 'disabled'].includes(state.status)
        || Number(state.receivedCursor || 0) > Number(state.cursor || 0))) pending.push(directory);
      if (state && !names.includes('base-map.json')) pending.push(directory);
      const service = await readJSON(path.join(directory, 'service.json'), null);
      if (service?.pid) {
        try { process.kill(service.pid, 0); pending.push(path.join(directory, 'service.json')); }
        catch (error) { if (error.code !== 'ESRCH') pending.push(path.join(directory, 'service.json')); }
      }
      for (const name of ['outbox.json', 'pending-upload.json', 'conflict.json']) {
        if (names.includes(name) && await readJSON(path.join(directory, name), null)) pending.push(path.join(directory, name));
      }
      if (names.includes('works')) {
        for (const name of await fs.readdir(path.join(directory, 'works'))) {
          if (!name.endsWith('.json')) continue;
          const work = await readJSON(path.join(directory, 'works', name), null);
          if (!work || work.status !== 'completed') pending.push(path.join(directory, 'works', name));
        }
      }
      if (names.includes('base-map.json')) {
        const base = await readJSON(path.join(directory, 'base-map.json'), null);
        const map = await readJSON(path.join(project.worktreeRoot, '.codex/context/map.json'), null);
        if (!base || !map || encode(base) !== encode(map)) pending.push(path.join(directory, 'base-map.json'));
      }
    } catch (error) {
      if (error.code === 'EACCES' || error.code === 'EPERM') throw error;
      pending.push(directory);
    }
  }
  if (pending.length) throw new MapError('UPGRADE_REQUIRED', 'Retired Map-only sync has unconfirmed data; reconcile the preserved drafts before using Session sync', 409, {
    reason: 'legacy-sync-state-pending', paths: [...new Set(pending)],
  });
  return { configured };
}

export async function syncStatus(root, sessionId = '') {
  const project = await resolveProject(root);
  const retired = await inspectRetiredSync(project);
  const config = await readJSON(memoryConfigPath(project), null);
  if (!config) {
    if (retired.configured) throw new MapError('UPGRADE_REQUIRED', 'Reconnect with workbench connect; the retired configuration was preserved', 409, { reason: 'legacy-sync-reconnect' });
    return { configured: false, managedBy: 'workbench', sessionId: sessionId || null, state: { status: 'disabled', pending: 0 } };
  }
  const directory = sessionId ? sessionMemoryDir(project, sessionId) : null;
  const state = directory ? await readJSON(path.join(directory, 'remote-sync/state.json'), null) : null;
  return { configured: true, managedBy: 'workbench', url: config.url, projectId: config.projectId, sessionId: sessionId || null,
    state: state || { configured: true, status: 'connecting', pending: 0 } };
}

export async function sessionSync(root, sessionId, action) {
  if (!['status', 'prepare', 'pull', 'checkpoint', 'finish'].includes(action)) {
    throw new MapError('UPGRADE_REQUIRED', 'Use workbench connect and Session sync status|ensure|prepare|pull|checkpoint|finish; project-wide work windows were retired', 409, { reason: 'legacy-sync-command' });
  }
  const status = await syncStatus(root, sessionId);
  if (action === 'status') return status;
  if (!sessionId) throw new MapError('SESSION_REQUIRED', 'Pass the actual --session before synchronization');
  const project = await resolveProject(root);
  if (!(await bindingStatus(project, sessionId)).session.bound) throw new MapError('SESSION_BINDING_REQUIRED', 'Bind the actual Session before synchronization', 409);
  if (!status.configured) throw new MapError('MEMORY_NOT_CONFIGURED', 'Connect this project using workbench connect', 503);
  if (status.state?.status === 'conflict' && ['session-bound-elsewhere', 'binding-conflict'].includes(status.state.reason)) throw new MapError('CONFLICT', 'Session binding requires a new host Session', 409, { reason: status.state.reason });
  if (['prepare', 'pull', 'checkpoint'].includes(action)) return prepareMemory(project, sessionId);
  if (action === 'finish') {
    const receipt = await synchronizeMemory(root, sessionId);
    if (!receipt?.snapshot?.version) throw new MapError('MEMORY_UNAVAILABLE', 'Cloud did not confirm the Session snapshot; preserve pending data', 503);
    return { confirmed: true, sessionVersion: receipt.snapshot.version };
  }
}
