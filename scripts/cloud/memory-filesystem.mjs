import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { atomicWrite, encode, hash, readJSON, withFileLock } from '../shared/io.mjs';
import { buildFilesystemV2 } from '../shared/filesystem-v2.mjs';

const FORMAT = 'context-guard-memory-filesystem-v2';

export function projectMemoryDirectory(dataDir, projectId) {
  return path.join(dataDir, hash(projectId));
}

export function legacyProjectMemoryFile(dataDir, projectId) {
  return path.join(projectMemoryDirectory(dataDir, projectId), 'memory.json');
}

export function filesystemProjectDirectory(dataDir, projectId) {
  return path.join(projectMemoryDirectory(dataDir, projectId), 'filesystem-v2');
}

export function projectMemoryLockFile(dataDir, projectId) {
  return path.join(projectMemoryDirectory(dataDir, projectId), 'memory.lock');
}

export function projectMemoryFile(dataDir, projectId) {
  const directory = filesystemProjectDirectory(dataDir, projectId);
  return fsSync.existsSync(path.join(directory, 'FORMAT'))
    ? path.join(directory, 'runtime-state.json')
    : legacyProjectMemoryFile(dataDir, projectId);
}

function safeRecordPath(root, name) {
  const value = String(name || '');
  if (value.includes('\\')) throw new Error(`Unsafe memory record path: ${name}`);
  const normalized = path.posix.normalize(value);
  if (!normalized || normalized.startsWith('../') || normalized.includes('/../') || path.posix.isAbsolute(normalized)) {
    throw new Error(`Unsafe memory record path: ${name}`);
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...normalized.split('/'));
  const relative = path.relative(resolvedRoot, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Unsafe memory record path: ${name}`);
  }
  return target;
}

async function writeFiles(root, files) {
  for (const [name, content] of files) {
    const target = safeRecordPath(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, { encoding: 'utf8', mode: 0o600 });
  }
}

async function writeScope(root, snapshot, scope) {
  const memory = snapshot?.memory;
  if (!memory?.map?.root) return;
  const generated = buildFilesystemV2({
    version: snapshot.version,
    mainSha: snapshot.mainSha || null,
    publishedAt: snapshot.publishedAt || snapshot.updatedAt || null,
    memory,
  });
  await writeFiles(root, generated.files);
  const recordsRoot = path.join(root, 'legacy-records');
  for (const [name, content] of Object.entries(memory.records || {})) {
    const target = safeRecordPath(recordsRoot, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, { encoding: 'utf8', mode: 0o600 });
  }
  await atomicWrite(path.join(root, 'scope.json'), encode({
    scope,
    version: snapshot.version,
    sourceCommit: snapshot.sourceCommit || null,
    baseMainVersion: snapshot.baseMainVersion ?? null,
    mainSha: snapshot.mainSha || null,
    updatedAt: snapshot.updatedAt || snapshot.publishedAt || null,
  }));
}

async function replaceContent(directory, state) {
  const content = path.join(directory, 'content');
  const next = path.join(directory, `.content-${randomUUID()}`);
  const previous = path.join(directory, '.content-previous');
  await fs.mkdir(next, { recursive: true });
  try {
    if (state.main) await writeScope(path.join(next, 'main'), state.main, 'main');
    for (const [sessionId, snapshot] of Object.entries(state.sessions || {})) {
      const sessionRoot = path.join(next, 'sessions', hash(sessionId));
      await writeScope(sessionRoot, snapshot, `session:${sessionId}`);
      await atomicWrite(path.join(sessionRoot, 'session.json'), encode({ sessionId }));
    }
    await atomicWrite(path.join(next, 'storage.json'), encode({
      format: FORMAT,
      revision: state.revision || 0,
      mainVersion: state.main?.version || null,
      sessions: Object.fromEntries(Object.entries(state.sessions || {}).map(([id, value]) => [id, {
        directory: hash(id),
        version: value.version,
      }])),
    }));

    await fs.rm(previous, { recursive: true, force: true });
    try { await fs.rename(content, previous); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await fs.rename(next, content); }
    catch (error) {
      try { await fs.rename(previous, content); } catch {}
      throw error;
    }
    await fs.rm(previous, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(next, { recursive: true, force: true });
    throw error;
  }
}

export async function writeFilesystemProjection(dataDir, projectId, state) {
  const directory = filesystemProjectDirectory(dataDir, projectId);
  await fs.mkdir(directory, { recursive: true });
  await withFileLock(path.join(directory, '.projection.lock'), async () => {
    await replaceContent(directory, state);
  });
}

export async function ensureFilesystemProjection(dataDir, projectId, state) {
  const directory = filesystemProjectDirectory(dataDir, projectId);
  if (!fsSync.existsSync(path.join(directory, 'FORMAT'))) return;
  const storage = await readJSON(path.join(directory, 'content', 'storage.json'), null);
  if (storage?.revision === (state.revision || 0) && storage?.mainVersion === (state.main?.version || null)) return;
  await writeFilesystemProjection(dataDir, projectId, state);
}

export async function writeProjectMemory(memoryReadViews, dataDir, projectId, state) {
  const file = projectMemoryFile(dataDir, projectId);
  await memoryReadViews.write(file, state);
  if (file === legacyProjectMemoryFile(dataDir, projectId)) return;
  await writeFilesystemProjection(dataDir, projectId, state);
}

export async function migrateProjectMemoryToFilesystemV2(dataDir, projectId) {
  const directory = filesystemProjectDirectory(dataDir, projectId);
  const marker = path.join(directory, 'FORMAT');
  const legacy = legacyProjectMemoryFile(dataDir, projectId);
  return withFileLock(projectMemoryLockFile(dataDir, projectId), async () => {
    if (fsSync.existsSync(marker)) throw new Error('Filesystem v2 is already active for this project');
    const state = await readJSON(legacy);
    const backupDir = path.join(projectMemoryDirectory(dataDir, projectId), 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    const backup = path.join(backupDir, `memory-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await fs.copyFile(legacy, backup, fsSync.constants.COPYFILE_EXCL);
    await fs.mkdir(directory, { recursive: true });
    await atomicWrite(path.join(directory, 'runtime-state.json'), encode(state));
    await writeFilesystemProjection(dataDir, projectId, state);
    await atomicWrite(marker, `${FORMAT}\n`);
    return {
      format: FORMAT,
      projectId,
      activeFile: path.join(directory, 'runtime-state.json'),
      content: path.join(directory, 'content'),
      backup,
      revision: state.revision || 0,
      mainVersion: state.main?.version || null,
      sessions: Object.keys(state.sessions || {}).length,
    };
  });
}
