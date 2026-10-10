import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonical } from '../shared/protocol.mjs';

const fail = () => { throw Object.assign(new Error('The original Cursor native distribution is unavailable'), { code: 'CI_NATIVE_CHANGED' }); };
const digest = value => createHash('sha256').update(value).digest('hex');
// Official downloaded 2026.10.01-e373342 darwin-arm64 distribution, verified
// by real ACP/MCP/Read/Task/fail-closed controls. A self-reported version alone
// is never a supported identity. Other distributions remain preparation-only.
const supported = Object.freeze({
  'darwin:arm64:ef38e1c0499391911e49fcdb2c4396f8302fe293f1ae2f064b26330ab606e5b6': '2026.10.01-e373342',
});
const statIdentity = info => ({ dev: String(info.dev), ino: String(info.ino), mode: info.mode,
  uid: info.uid, gid: info.gid, nlink: info.nlink, size: info.size, mtime: info.mtimeMs, ctime: info.ctimeMs });
const equalStat = (left, right) => canonical(statIdentity(left)) === canonical(statIdentity(right));
const lexical = (left, right) => left < right ? -1 : left > right ? 1 : 0;

// Snapshotting is only drift detection, not official provenance or permission.
// Full manifests stay in the original host closure, never in model/IPC JSON.
export async function captureCursorCiNativeDistribution(command) {
  if (!path.isAbsolute(command || '') || path.resolve(command) !== command) fail();
  const resolved = await fs.realpath(command), root = path.dirname(resolved);
  if (!['cursor-agent', 'cursor-agent-sea'].includes(path.basename(resolved))) fail();
  const parents = new Map();
  for (const start of [path.dirname(command), root]) {
    for (let directory = start;; directory = path.dirname(directory)) {
      const info = await fs.lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(directory) !== directory ||
          process.platform !== 'win32' && (info.uid !== 0 && info.uid !== process.getuid() ||
            info.mode & 0o022 && !(info.uid === 0 && info.mode & 0o1000))) fail();
      parents.set(directory, statIdentity(info));
      if (path.dirname(directory) === directory) break;
    }
  }
  const aliases = new Map();
  let alias = command;
  for (let count = 0;; count++) {
    if (count > 16) fail();
    const info = await fs.lstat(alias); aliases.set(alias, { stat: statIdentity(info),
      ...(info.isSymbolicLink() ? { target: await fs.readlink(alias) } : {}) });
    if (!info.isSymbolicLink()) { if (!info.isFile() || alias !== resolved) fail(); break; }
    alias = path.resolve(path.dirname(alias), await fs.readlink(alias));
  }
  const directories = new Map(), files = new Map();
  let total = 0;
  const scan = async (relative = '', depth = 0) => {
    if (depth > 16 || directories.size >= 512) fail();
    const directory = path.join(root, relative), before = await fs.lstat(directory);
    if (!before.isDirectory() || before.isSymbolicLink() || before.mode & 0o022 ||
        await fs.realpath(directory) !== directory) fail();
    const names = (await fs.readdir(directory)).sort();
    directories.set(relative, { stat: statIdentity(before), names });
    for (const name of names) {
      const child = relative ? `${relative}/${name}` : name, file = path.join(root, child);
      const initial = await fs.lstat(file);
      if (initial.isDirectory() && !initial.isSymbolicLink()) { await scan(child, depth + 1); continue; }
      if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1 || initial.mode & 0o022 ||
          initial.size > 256 * 1024 * 1024 || files.size >= 2048 || (total += initial.size) > 1024 * 1024 * 1024) fail();
      const fd = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        if (!equalStat(initial, await fd.stat())) fail();
        const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(65536);
        let read = 0;
        for (;;) { const { bytesRead } = await fd.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
          read += bytesRead; if (read > initial.size) fail(); hash.update(buffer.subarray(0, bytesRead)); }
        if (read !== initial.size || !equalStat(initial, await fd.stat()) || !equalStat(initial, await fs.lstat(file))) fail();
        files.set(child, { stat: statIdentity(initial), sha256: hash.digest('hex') });
      } finally { await fd.close(); }
    }
    if (!equalStat(before, await fs.lstat(directory)) || canonical((await fs.readdir(directory)).sort()) !== canonical(names)) fail();
  };
  await scan();
  const manifest = { directories: [...directories.keys()].sort(), files: [...files].sort(([a], [b]) => lexical(a, b))
    .map(([file, value]) => ({ path: file, bytes: value.stat.size, sha256: value.sha256 })) };
  // The official darwin SEA is unsigned and the OS kills it. Use the pinned
  // bundled Node/index.js route without launcher PATH lookups or compile cache.
  const distributionSha256 = digest(canonical(manifest)), nativeCommand = path.join(root, 'node');
  if (!files.has('node') || !files.has('index.js')) fail();
  const args = ['--use-system-ca', path.join(root, 'index.js')];
  const verify = async () => {
    if (await fs.realpath(command) !== resolved) fail();
    for (const [directory, expected] of parents) {
      const info = await fs.lstat(directory);
      // Ancestor contents may change due to unrelated work. Its actual inode,
      // kind and mode must not; artifact directory contents are checked below.
      if (!info.isDirectory() || info.isSymbolicLink() || String(info.dev) !== expected.dev ||
          String(info.ino) !== expected.ino || info.mode !== expected.mode || info.uid !== expected.uid ||
          info.gid !== expected.gid || await fs.realpath(directory) !== directory) fail();
    }
    for (const [file, expected] of aliases) {
      const info = await fs.lstat(file);
      if (canonical(statIdentity(info)) !== canonical(expected.stat) ||
          expected.target !== undefined && await fs.readlink(file) !== expected.target) fail();
    }
    for (const [relative, expected] of directories) {
      const directory = path.join(root, relative), info = await fs.lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || canonical(statIdentity(info)) !== canonical(expected.stat) ||
          canonical((await fs.readdir(directory)).sort()) !== canonical(expected.names)) fail();
    }
    for (const [relative, expected] of files) {
      const info = await fs.lstat(path.join(root, relative));
      if (!info.isFile() || info.isSymbolicLink() || canonical(statIdentity(info)) !== canonical(expected.stat)) fail();
    }
  };
  await verify();
  return { identity: { command: nativeCommand, args, distributionSha256 }, verify };
}

export async function prepareCursorCiNativeIdentity({ command, invoke, options }) {
  // Unknown executables and old synthetic fixtures retain preparation-only
  // compatibility. They cannot acquire a supported identity through JSON.
  const resolved = await fs.realpath(command);
  if (!['cursor-agent', 'cursor-agent-sea'].includes(path.basename(resolved))) return null;
  const pin = await captureCursorCiNativeDistribution(command);
  const version = supported[`${process.platform}:${process.arch}:${pin.identity.distributionSha256}`];
  if (!version) return null; // Never execute an unrecognized 'same version' program.
  const result = await invoke(pin.identity.command, [...pin.identity.args, '--version'], { ...options,
    env: { ...options?.env, NODE_DISABLE_COMPILE_CACHE: '1', CURSOR_INVOKED_AS: 'cursor-agent' },
    windowsHide: true, timeout: 10000, maxBuffer: 4096 });
  if (result?.stdout !== `${version}\n` || result.stderr !== '') fail();
  await pin.verify();
  return { identity: { ...pin.identity, version }, verify: pin.verify };
}
