import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const execute = promisify(execFile);
const sha = /^[a-f0-9]{40}$/;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const digest = data => createHash('sha256').update(data).digest('hex');
const blocked = part => ['.git', '.codex', '.ssh', '.npmrc', '.netrc'].includes(part) || /^\.env(?:\.|$)/.test(part);
export const cursorCiSourcePath = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
  !path.posix.isAbsolute(value) && !value.includes('\\') && !/[\u0000-\u001f\u007f]/.test(value) &&
  value.split('/').every(part => part && part !== '.' && part !== '..' && !blocked(part));
const relativePath = cursorCiSourcePath;

async function privateDirectory(directory) {
  if (!path.isAbsolute(directory || '') || path.resolve(directory) !== directory) {
    fail('CI_SOURCE_INVALID', 'Use an absolute canonical private snapshot parent');
  }
  let current = path.parse(directory).root;
  for (const component of path.relative(current, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('CI_SOURCE_INVALID', 'Snapshot parents must be real directories');
  }
  const info = await fs.stat(directory);
  if (process.platform !== 'win32' && info.mode & 0o077) fail('CI_SOURCE_INVALID', 'Snapshot parent must be private');
  return fs.realpath(directory);
}

const gitEnvironment = () => ({ PATH: process.env.PATH, LANG: 'C',
  ...(process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' });
async function git(root, args, maxBuffer = 2 * 1024 * 1024) {
  try {
    return (await execute('git', ['--no-replace-objects', ...args], { cwd: root, env: gitEnvironment(),
      encoding: 'buffer', windowsHide: true, timeout: 30000, maxBuffer })).stdout;
  } catch { fail('CI_SOURCE_GIT_FAILED', 'Cannot read the assigned Git source'); }
}

// The caller authenticates the active task and owns this fresh private directory.
// Never copy a live checkout, untracked files, hooks or Git's common directory.
export async function exportCursorCiSource({ root, sourceSha, paths, directory, maxFiles = 512,
  maxFileBytes = 2 * 1024 * 1024, maxTotalBytes = 16 * 1024 * 1024 } = {}) {
  if (!path.isAbsolute(root || '') || !sha.test(sourceSha || '') || !Array.isArray(paths) ||
      !paths.length || paths.length > 128 || new Set(paths).size !== paths.length || !paths.every(relativePath) ||
      ![maxFiles, maxFileBytes, maxTotalBytes].every(value => Number.isSafeInteger(value) && value > 0) ||
      maxFiles > 512 || maxFileBytes > 2 * 1024 * 1024 || maxTotalBytes > 16 * 1024 * 1024) {
    fail('CI_SOURCE_INVALID', 'Use bounded approved paths and the exact assigned commit');
  }
  root = await fs.realpath(root);
  directory = await privateDirectory(directory);
  const committed = (await git(root, ['rev-parse', '--verify', `${sourceSha}^{commit}`])).toString('utf8').trim();
  if (committed !== sourceSha) fail('CI_SOURCE_INVALID', 'Assigned source must identify an exact commit');
  const tree = await git(root, ['ls-tree', '-r', '-z', '--full-tree', sourceSha]);
  let treeText;
  try { treeText = new TextDecoder('utf-8', { fatal: true }).decode(tree); }
  catch { fail('CI_SOURCE_UNSAFE', 'Git source paths must use valid UTF-8'); }
  const selected = [], covered = new Set();
  for (const row of treeText.split('\0').filter(Boolean)) {
    const tab = row.indexOf('\t'), header = row.slice(0, tab).split(' '), file = row.slice(tab + 1);
    const accepted = paths.filter(scope => file === scope || file.startsWith(scope + '/'));
    if (!accepted.length) continue;
    if (tab < 0 || !relativePath(file) || !['100644', '100755'].includes(header[0]) || header[1] !== 'blob' || !sha.test(header[2])) {
      fail('CI_SOURCE_UNSAFE', 'Approved source contains an unsupported path, link or submodule');
    }
    for (const scope of accepted) covered.add(scope);
    selected.push({ path: file, mode: header[0], blobSha: header[2] });
    if (selected.length > maxFiles) fail('CI_SOURCE_LIMIT', 'Approved source exceeds the file budget');
  }
  if (covered.size !== paths.length || !selected.length) fail('CI_SOURCE_MISSING', 'Every approved path must exist in the assigned commit');
  // Read and bound every blob before creating a snapshot. Partial exports cannot
  // accidentally become executable input when a later blob exceeds its budget.
  const contents = [], files = Object.create(null), directories = new Set();
  let bytes = 0;
  for (const entry of selected) {
    const size = Number((await git(root, ['cat-file', '-s', entry.blobSha])).toString('utf8').trim());
    if (!Number.isSafeInteger(size) || size < 0 || size > maxFileBytes || bytes + size > maxTotalBytes) {
      fail('CI_SOURCE_LIMIT', 'Approved source exceeds the byte budget');
    }
    const content = await git(root, ['cat-file', 'blob', entry.blobSha], maxFileBytes + 1);
    bytes += content.length;
    if (content.length !== size || content.length > maxFileBytes || bytes > maxTotalBytes) fail('CI_SOURCE_LIMIT', 'Approved source exceeds the byte budget');
    const blobSha = createHash('sha1').update(Buffer.from(`blob ${size}\0`)).update(content).digest('hex');
    if (blobSha !== entry.blobSha) fail('CI_SOURCE_CHANGED', 'Source blob content does not match the assigned Git tree');
    files[entry.path] = { blobSha: entry.blobSha, sha256: digest(content), bytes: content.length, mode: entry.mode };
    contents.push({ ...entry, content });
  }
  const snapshot = await fs.mkdtemp(path.join(directory, 'source-'));
  await fs.chmod(snapshot, 0o700);
  directories.add(snapshot);
  for (const entry of contents) {
    const target = path.join(snapshot, ...entry.path.split('/'));
    const parent = path.dirname(target);
    await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    for (let current = parent; current !== snapshot; current = path.dirname(current)) directories.add(current);
    await fs.writeFile(target, entry.content, { flag: 'wx', mode: entry.mode === '100755' ? 0o500 : 0o400 });
  }
  for (const dir of [...directories].sort((a, b) => b.length - a.length)) await fs.chmod(dir, 0o500);
  const directoryPaths = [...directories].map(dir => path.relative(snapshot, dir).split(path.sep).join('/')).sort();
  const manifest = { sourceSha, files, directories: directoryPaths, fileCount: selected.length, bytes };
  // Manifest/evidence lives outside the test mount. It is not taken from scratch.
  return { snapshot, manifest, manifestSha256: digest(JSON.stringify(manifest)) };
}

export async function verifyCursorCiSource({ snapshot, manifest, manifestSha256 } = {}) {
  if (!path.isAbsolute(snapshot || '') || !manifest || !sha.test(manifest.sourceSha || '') ||
      !Array.isArray(manifest.directories) || !manifest.directories.includes('') ||
      !/^[a-f0-9]{64}$/.test(manifestSha256 || '') || digest(JSON.stringify(manifest)) !== manifestSha256) {
    fail('CI_SOURCE_CHANGED', 'Snapshot manifest does not match its host observation');
  }
  const found = [], foundDirectories = new Set();
  async function visit(directory, prefix = '') {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !manifest.directories.includes(prefix) ||
        process.platform !== 'win32' && (stat.mode & 0o777) !== 0o500) {
      fail('CI_SOURCE_CHANGED', 'Snapshot directory set or permissions changed');
    }
    foundDirectories.add(prefix);
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = prefix ? prefix + '/' + entry.name : entry.name, target = path.join(directory, entry.name);
      if (!relativePath(file) || entry.isSymbolicLink()) fail('CI_SOURCE_CHANGED', 'Snapshot contains an unexpected path or link');
      if (entry.isDirectory()) await visit(target, file);
      else if (entry.isFile()) {
        const stat = await fs.lstat(target), expected = Object.hasOwn(manifest.files, file) && manifest.files[file];
        if (!expected || !stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o222 ||
            process.platform !== 'win32' && (stat.mode & 0o777) !== (expected.mode === '100755' ? 0o500 : 0o400) ||
            stat.size !== expected.bytes || digest(await fs.readFile(target)) !== expected.sha256) {
          fail('CI_SOURCE_CHANGED', 'Snapshot content changed');
        }
        found.push(file);
      } else fail('CI_SOURCE_CHANGED', 'Snapshot contains a special file');
    }
  }
  await visit(snapshot);
  if (found.length !== manifest.fileCount || found.length !== Object.keys(manifest.files).length ||
      foundDirectories.size !== manifest.directories.length || new Set(manifest.directories).size !== manifest.directories.length) {
    fail('CI_SOURCE_CHANGED', 'Snapshot file set changed');
  }
  return { sourceSha: manifest.sourceSha, manifestSha256, verified: true };
}
