#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArchive = /^context-guard-cloud-pre-[a-z0-9-]+-20\d{6}(?:T\d{4,6}Z)?\.tar(?:\.zst)?$/i;
const nestedArchive = /^pre-[a-z0-9-]+-20\d{6}(?:T\d{4,6}Z)?\.tar\.zst$/i;
const nestedDirectory = /^pre-[a-z0-9-]+-20\d{6}(?:T\d{4,6}Z)?$/i;
const keepCount = 5;
const quietMs = 10 * 60 * 1000;

async function candidatesIn(directory, matches, optional = false) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (optional && error.code === 'ENOENT') return []; throw error; }
  const candidates = [];
  for (const entry of entries) {
    const kind = matches(entry.name);
    if (!kind) continue;
    const pathname = path.join(directory, entry.name);
    const info = await fs.lstat(pathname);
    if (info.isSymbolicLink() || kind === 'file' && !info.isFile() || kind === 'directory' && !info.isDirectory()) {
      throw new Error(`Unexpected backup entry type: ${pathname}`);
    }
    candidates.push({ path: pathname, kind, dev: info.dev, ino: info.ino, size: info.size, mtimeMs: info.mtimeMs });
  }
  return candidates;
}

export async function listCloudBackups(root = '/var/backups') {
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root) throw new Error('Backup root must not be a filesystem root');
  const info = await fs.lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Backup root must be a real directory');
  return [
    ...await candidatesIn(resolved, name => rootArchive.test(name) ? 'file' : null),
    ...await candidatesIn(path.join(resolved, 'context-guard-cloud'), name =>
      nestedArchive.test(name) ? 'file' : nestedDirectory.test(name) ? 'directory' : null, true),
  ].sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
}

export async function verifyCloudBackup(candidate) {
  if (candidate.kind === 'directory') {
    for (const child of ['data', 'config']) {
      const info = await fs.lstat(path.join(candidate.path, child));
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Incomplete backup directory: ${candidate.path}`);
    }
    return;
  }
  if (candidate.size === 0) throw new Error(`Empty backup archive: ${candidate.path}`);
  const compressed = candidate.path.endsWith('.zst');
  const result = spawnSync(compressed ? 'zstd' : 'tar', compressed ? ['-t', '--quiet', candidate.path] : ['-tf', candidate.path], {
    stdio: 'ignore', timeout: 120_000, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error(`Backup verification failed: ${candidate.path}`);
  if (compressed) {
    const archive = spawnSync('tar', ['-I', 'zstd', '-tf', candidate.path], { stdio: 'ignore', timeout: 120_000, windowsHide: true });
    if (archive.error || archive.status !== 0) throw new Error(`Backup tar verification failed: ${candidate.path}`);
  }
}

async function unchanged(candidate) {
  const info = await fs.lstat(candidate.path);
  return !info.isSymbolicLink() && info.dev === candidate.dev && info.ino === candidate.ino &&
    info.size === candidate.size && info.mtimeMs === candidate.mtimeMs &&
    (candidate.kind === 'directory' ? info.isDirectory() : info.isFile());
}

export async function pruneCloudBackups({ root = '/var/backups', apply = false, now = Date.now(), minQuietMs = quietMs,
  verify = verifyCloudBackup } = {}) {
  const candidates = await listCloudBackups(root);
  const retained = candidates.slice(0, keepCount);
  const stale = candidates.slice(keepCount);
  const result = { status: 'ok', retained: retained.map(item => item.path), removed: [], stale: stale.map(item => item.path) };
  if (!stale.length) return result;
  if (candidates.some(item => now - item.mtimeMs < minQuietMs)) return { ...result, status: 'deferred-recent-backup' };
  for (const item of retained) await verify(item);
  if (!apply) return { ...result, status: 'dry-run' };
  // A new backup or a changed target invalidates the ordered deletion plan.
  const current = await listCloudBackups(root);
  if (current.length !== candidates.length || current.some((item, index) => item.path !== candidates[index].path)) {
    throw new Error('Backup inventory changed during verification');
  }
  for (const item of candidates) if (!await unchanged(item)) throw new Error(`Backup changed during verification: ${item.path}`);
  for (const item of stale) {
    if (!await unchanged(item)) throw new Error(`Backup changed before deletion: ${item.path}`);
    await fs.rm(item.path, { recursive: item.kind === 'directory' });
    result.removed.push(item.path);
  }
  return result;
}

function argumentsFrom(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--root' && argv[index + 1]) options.root = argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await pruneCloudBackups(argumentsFrom(process.argv.slice(2)));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`Cloud backup retention stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
