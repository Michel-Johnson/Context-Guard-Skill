import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, encode, hash, readJSON, withFileLock } from '../shared/io.mjs';
import { MapError } from '../shared/map-model.mjs';

export const FILE_WRITE_MAX_BYTES = 64 * 1024;
const fail = (code, message, status = 400) => { throw new MapError(code, message, status); };

// One repository-relative text file. Dot segments keep .git, .codex, .env and
// other hidden paths out of this lane; code changes still go through a brief.
export function assertProjectFilePath(relative) {
  if (typeof relative !== 'string' || !relative || relative.length > 240 || relative !== relative.trim()) fail('INVALID_ARGUMENT', 'Provide one repository-relative file path');
  if (relative.startsWith('/') || relative.includes('\\') || relative.includes('\0') || relative.includes('//')) fail('INVALID_ARGUMENT', 'File path must be a single relative repository path');
  const parts = relative.split('/');
  if (parts.length > 16 || parts[0] === 'node_modules' || parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.') || part.length > 180)) fail('INVALID_ARGUMENT', 'That path is not available for a Coordinator file write');
  return parts;
}

const insideRoot = (rootReal, candidate) => candidate === rootReal || candidate.startsWith(rootReal + path.sep);

async function resolveProjectFile(root, parts) {
  const rootReal = await fs.realpath(root).catch(error => {
    if (error.code === 'ENOENT') fail('NOT_FOUND', 'Project repository checkout is unavailable', 404);
    throw error;
  });
  const rootStat = await fs.lstat(rootReal);
  if (!rootStat.isDirectory()) fail('NOT_FOUND', 'Project repository checkout is unavailable', 404);
  let cursor = rootReal;
  let pending = parts.length - 1;
  for (let index = 0; index < parts.length - 1; index++) {
    const next = path.join(cursor, parts[index]);
    let info;
    try { info = await fs.lstat(next); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      pending = index;
      break;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) fail('INVALID_ARGUMENT', 'Coordinator can write one regular file inside the repository');
    const real = await fs.realpath(next);
    if (!insideRoot(rootReal, real)) fail('INVALID_ARGUMENT', 'File path escapes the repository');
    cursor = real;
  }
  const target = path.resolve(cursor, ...parts.slice(pending));
  if (!insideRoot(rootReal, target)) fail('INVALID_ARGUMENT', 'File path escapes the repository');
  return target;
}

export async function writeProjectFile({ root, receiptFile, operationId, relativePath, content, expectedSha, enabled = false }) {
  if (enabled !== true) fail('FORBIDDEN', 'Coordinator file writing is not enabled for this project', 403);
  if (typeof operationId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(operationId)) fail('INVALID_ARGUMENT', 'Provide a stable operationId');
  if (typeof content !== 'string' || !content.trim() || content.includes('\0') || Buffer.byteLength(content) > FILE_WRITE_MAX_BYTES) fail('INVALID_ARGUMENT', 'Provide one UTF-8 text file within 64 KiB');
  if (expectedSha !== undefined && (typeof expectedSha !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha))) fail('INVALID_ARGUMENT', 'expectedSha must be the current file SHA-256');
  if (!path.isAbsolute(root || '') || !path.isAbsolute(receiptFile || '')) fail('UNAVAILABLE', 'Configure the project repository checkout before writing a file', 503);
  const parts = assertProjectFilePath(relativePath);
  const fingerprint = hash(JSON.stringify({ path: relativePath, content, expectedSha: expectedSha || null }));
  return withFileLock(`${receiptFile}.lock`, async () => {
    const state = await readJSON(receiptFile, { operations: {} });
    state.operations ||= {};
    const previous = state.operations[operationId];
    if (previous && previous.fingerprint !== fingerprint) fail('ID_REUSED', 'Operation ID belongs to a different file write', 409);
    if (previous?.committed) return previous.result;
    const target = await resolveProjectFile(root, parts);
    let current = null;
    try {
      const info = await fs.lstat(target);
      if (info.isSymbolicLink() || !info.isFile()) fail('INVALID_ARGUMENT', 'Coordinator can replace one regular file');
      current = await fs.readFile(target);
    } catch (error) {
      if (error instanceof MapError || error.code !== 'ENOENT') throw error;
    }
    const currentSha = current === null ? null : hash(current);
    const sha256 = hash(content);
    // A pending receipt proves the request, not ownership of the current file.
    // Only the original base or our exact unacknowledged output may be replayed.
    if ((expectedSha || null) !== currentSha && (!previous || currentSha !== sha256)) {
      fail('VERSION_CONFLICT', 'File changed; read it again before writing', 409);
    }
    if (!previous) {
      state.operations[operationId] = { fingerprint, committed: false, result: null };
      await atomicWrite(receiptFile, encode(state));
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    const parentReal = await fs.realpath(path.dirname(target));
    const rootReal = await fs.realpath(root);
    if (!insideRoot(rootReal, parentReal) || !insideRoot(rootReal, path.resolve(parentReal, path.basename(target)))) fail('INVALID_ARGUMENT', 'File path escapes the repository');
    if (current === null || hash(current) !== sha256) await atomicWrite(target, content);
    const written = await fs.readFile(target);
    if (hash(written) !== sha256) fail('UNAVAILABLE', 'File write did not persist', 503);
    const saved = await readJSON(receiptFile, { operations: {} });
    const result = { kind: 'file-write', path: relativePath, sha256, created: expectedSha === undefined, bytes: Buffer.byteLength(content), committedToGit: false };
    saved.operations[operationId] = { fingerprint, committed: true, result };
    await atomicWrite(receiptFile, encode(saved));
    return result;
  });
}
