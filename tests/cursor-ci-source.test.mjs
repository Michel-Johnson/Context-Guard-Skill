import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import assert from 'node:assert/strict';
import { exportCursorCiSource, verifyCursorCiSource } from '../scripts/workbench/cursor-ci-source.mjs';

const execute = promisify(execFile);
async function fixture() {
  // Preserve this task's synthetic local evidence; no user workspace is reused.
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-ci-source-test-')));
  await fs.chmod(parent, 0o700);
  const root = path.join(parent, 'repo'), snapshots = path.join(parent, 'snapshots');
  await fs.mkdir(root); await fs.mkdir(snapshots, { mode: 0o700 });
  const git = async (...args) => (await execute('git', args, { cwd: root,
    env: { PATH: process.env.PATH, HOME: parent, GIT_CONFIG_NOSYSTEM: '1',
      ...(process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) }, windowsHide: true })).stdout.trim();
  await git('init'); await git('config', 'user.name', 'Synthetic Tester');
  await git('config', 'user.email', 'tester@example.invalid');
  await fs.mkdir(path.join(root, 'lib'));
  await fs.writeFile(path.join(root, 'lib', 'source.mjs'), 'export const value = 1;\n');
  await fs.writeFile(path.join(root, '.env'), 'SYNTHETIC_PRIVATE_ONLY=1\n');
  await git('add', 'lib/source.mjs', '.env'); await git('commit', '-m', 'synthetic approved source');
  const sourceSha = await git('rev-parse', 'HEAD');
  return { root, directory: snapshots, sourceSha, paths: ['lib'], git };
}

test('CI snapshot exports the assigned commit, not dirty or untracked host files', async () => {
  const options = await fixture();
  await fs.writeFile(path.join(options.root, 'lib', 'source.mjs'), 'DIRTY_HOST_CONTENT');
  await fs.writeFile(path.join(options.root, 'lib', 'untracked.txt'), 'HOST_ONLY');
  const result = await exportCursorCiSource(options);
  assert.equal(await fs.readFile(path.join(result.snapshot, 'lib/source.mjs'), 'utf8'), 'export const value = 1;\n');
  assert.deepEqual(Object.keys(result.manifest.files), ['lib/source.mjs']);
  assert.equal(result.manifest.sourceSha, options.sourceSha);
  assert.equal(result.manifest.fileCount, 1);
  assert.equal((await verifyCursorCiSource(result)).verified, true);
  await assert.rejects(fs.stat(path.join(result.snapshot, '.env')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(options.root, 'lib/source.mjs'), 'utf8'), 'DIRTY_HOST_CONTENT');
});

test('CI snapshot rejects credential paths, traversal, missing paths and mutable refs', async () => {
  const options = await fixture();
  for (const value of ['.env', '.env.local', '.git', '.codex/context', '../lib', '/lib', 'lib\\source', 'lib//source']) {
    await assert.rejects(exportCursorCiSource({ ...options, paths: [value] }), { code: 'CI_SOURCE_INVALID' });
  }
  await assert.rejects(exportCursorCiSource({ ...options, sourceSha: 'HEAD' }), { code: 'CI_SOURCE_INVALID' });
  await assert.rejects(exportCursorCiSource({ ...options, paths: ['missing'] }), { code: 'CI_SOURCE_MISSING' });
  assert.deepEqual(await fs.readdir(options.directory), []);
});

test('CI snapshot rejects committed symlinks before exporting any source', { skip: process.platform === 'win32' ? 'Native symlink creation needs Windows privileges' : false }, async () => {
  const options = await fixture();
  await fs.symlink('../.env', path.join(options.root, 'lib', 'link'));
  await options.git('add', 'lib/link'); await options.git('commit', '-m', 'synthetic unsafe link');
  options.sourceSha = await options.git('rev-parse', 'HEAD');
  await assert.rejects(exportCursorCiSource(options), { code: 'CI_SOURCE_UNSAFE' });
  assert.deepEqual(await fs.readdir(options.directory), []);
});

test('CI snapshot budgets reject the full export instead of executing a partial file set', async () => {
  const options = await fixture();
  await assert.rejects(exportCursorCiSource({ ...options, maxTotalBytes: 1 }), { code: 'CI_SOURCE_LIMIT' });
  await assert.rejects(exportCursorCiSource({ ...options, maxFileBytes: 1 }), { code: 'CI_SOURCE_LIMIT' });
  assert.deepEqual(await fs.readdir(options.directory), []);
  await assert.rejects(exportCursorCiSource({ ...options, maxFiles: 513 }), { code: 'CI_SOURCE_INVALID' });
});

test('CI snapshot rejects submodules and linked destination parents', { skip: process.platform === 'win32' ? 'Native symlink creation needs Windows privileges' : false }, async () => {
  const options = await fixture();
  await options.git('update-index', '--add', '--cacheinfo', `160000,${options.sourceSha},lib/module`);
  await options.git('commit', '-m', 'synthetic submodule entry');
  options.sourceSha = await options.git('rev-parse', 'HEAD');
  await assert.rejects(exportCursorCiSource(options), { code: 'CI_SOURCE_UNSAFE' });
  const alias = path.join(path.dirname(options.directory), 'linked-snapshots');
  await fs.symlink(options.directory, alias);
  await assert.rejects(exportCursorCiSource({ ...options, directory: alias }), { code: 'CI_SOURCE_INVALID' });
  assert.deepEqual(await fs.readdir(options.directory), []);
});

test('CI snapshot preserves prototype-like filenames as ordinary manifest entries', async () => {
  const options = await fixture();
  await fs.writeFile(path.join(options.root, '__proto__'), 'SYNTHETIC_FILE');
  await options.git('add', '__proto__'); await options.git('commit', '-m', 'synthetic prototype-like filename');
  options.sourceSha = await options.git('rev-parse', 'HEAD'); options.paths = ['__proto__'];
  const result = await exportCursorCiSource(options);
  assert.equal(Object.hasOwn(result.manifest.files, '__proto__'), true);
  assert.equal((await verifyCursorCiSource(result)).verified, true);
});

test('CI snapshot rejects a link followed by parent traversal before creating any output', { skip: process.platform === 'win32' ? 'Native symlink creation needs Windows privileges' : false }, async () => {
  const options = await fixture(), parent = path.dirname(options.directory);
  const outside = path.join(parent, 'outside'), actual = path.join(outside, 'snapshots');
  await fs.mkdir(outside, { mode: 0o700 }); await fs.mkdir(path.join(outside, 'child'));
  await fs.mkdir(actual, { mode: 0o700 });
  const alias = path.join(parent, 'alias'); await fs.symlink(path.join(outside, 'child'), alias);
  // Do not use path.join: its normalization would erase the tested traversal.
  await assert.rejects(exportCursorCiSource({ ...options, directory: alias + '/../snapshots' }), { code: 'CI_SOURCE_INVALID' });
  assert.deepEqual(await fs.readdir(options.directory), []);
  assert.deepEqual(await fs.readdir(actual), []);
});

test('CI snapshot verification rejects a newly writable file even when its bytes match', async () => {
  const result = await exportCursorCiSource(await fixture());
  await fs.chmod(path.join(result.snapshot, 'lib/source.mjs'), 0o600);
  await assert.rejects(verifyCursorCiSource(result), { code: 'CI_SOURCE_CHANGED' });
});

test('CI snapshot verification rejects added empty directories', async () => {
  const result = await exportCursorCiSource(await fixture());
  await fs.chmod(result.snapshot, 0o700);
  await fs.mkdir(path.join(result.snapshot, 'unexpected-empty'), { mode: 0o500 });
  await fs.chmod(result.snapshot, 0o500);
  await assert.rejects(verifyCursorCiSource(result), { code: 'CI_SOURCE_CHANGED' });
});

test('CI snapshot verification rejects changed Unix directory permissions', { skip: process.platform === 'win32' ? 'Unix directory permissions require an ACL-specific Windows implementation' : false }, async () => {
  const result = await exportCursorCiSource(await fixture());
  await fs.chmod(path.join(result.snapshot, 'lib'), 0o700);
  await assert.rejects(verifyCursorCiSource(result), { code: 'CI_SOURCE_CHANGED' });
});

test('CI snapshot verification preserves and checks the Git executable bit on Unix', { skip: process.platform === 'win32' ? 'Windows chmod does not represent the Unix executable bit' : false }, async () => {
  const options = await fixture();
  await options.git('update-index', '--chmod=+x', 'lib/source.mjs');
  await options.git('commit', '-m', 'synthetic executable source');
  options.sourceSha = await options.git('rev-parse', 'HEAD');
  const result = await exportCursorCiSource(options), file = path.join(result.snapshot, 'lib/source.mjs');
  assert.equal(result.manifest.files['lib/source.mjs'].mode, '100755');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o500);
  assert.equal((await verifyCursorCiSource(result)).verified, true);
  await fs.chmod(file, 0o400);
  await assert.rejects(verifyCursorCiSource(result), { code: 'CI_SOURCE_CHANGED' });
});

test('CI snapshot verification detects changed content, missing files and forged manifest', async () => {
  const options = await fixture(), result = await exportCursorCiSource(options);
  await assert.rejects(verifyCursorCiSource({ ...result, manifest: { ...result.manifest, sourceSha: 'a'.repeat(40) } }), { code: 'CI_SOURCE_CHANGED' });
  const file = path.join(result.snapshot, 'lib/source.mjs');
  await fs.chmod(file, 0o600); await fs.writeFile(file, 'export const value = 2;\n');
  await fs.chmod(file, 0o400);
  assert.equal((await fs.stat(file)).size, result.manifest.files['lib/source.mjs'].bytes);
  await assert.rejects(verifyCursorCiSource(result), { code: 'CI_SOURCE_CHANGED' });
  await fs.chmod(path.dirname(file), 0o700);
  await fs.rename(file, path.join(options.directory, 'preserved-altered-source.mjs'));
  await fs.chmod(path.dirname(file), 0o500);
  await assert.rejects(verifyCursorCiSource(result), { code: 'CI_SOURCE_CHANGED' });
});
