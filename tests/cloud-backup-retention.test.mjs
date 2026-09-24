import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { listCloudBackups, pruneCloudBackups, verifyCloudBackup } from '../deploy/prune-cloud-backups.mjs';

const script = fileURLToPath(new URL('../deploy/prune-cloud-backups.mjs', import.meta.url));
const fixture = async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-backup-retention-'));
  await fs.mkdir(path.join(root, 'context-guard-cloud'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
};
const archiveName = number => `context-guard-cloud-pre-v${number}-20260924T00000${number}Z.tar`;
const nestedName = number => `pre-v${number}-20260924T00000${number}Z.tar.zst`;
const createCandidate = async (root, number, nested = false) => {
  const file = path.join(root, ...(nested ? ['context-guard-cloud', nestedName(number)] : [archiveName(number)]));
  await fs.writeFile(file, `backup ${number}`);
  const timestamp = new Date(Date.UTC(2026, 8, 23, 0, number));
  await fs.utimes(file, timestamp, timestamp);
  return file;
};

test('retention keeps five newest snapshots across both known directories and leaves other files untouched', async t => {
  const root = await fixture(t);
  const backups = [];
  for (let number = 1; number <= 7; number++) backups.push(await createCandidate(root, number, number % 2 === 0));
  const unrelated = path.join(root, 'dpkg.status.0');
  const diagnostic = path.join(root, 'context-guard-cloud', 'memory-before-lab.json');
  const partial = path.join(root, 'context-guard-cloud', 'pre-v8-20260924T000008Z.tar.zst.part');
  await fs.writeFile(unrelated, 'unrelated');
  await fs.writeFile(diagnostic, 'diagnostic');
  await fs.writeFile(partial, 'still writing');
  const dryRun = await pruneCloudBackups({ root, now: Date.UTC(2026, 8, 24), minQuietMs: 0, verify: async () => {} });
  assert.equal(dryRun.status, 'dry-run');
  assert.equal(dryRun.stale.length, 2);
  assert.equal((await listCloudBackups(root)).length, 7, 'dry-run deletes nothing');
  const result = await pruneCloudBackups({ root, apply: true, now: Date.UTC(2026, 8, 24), minQuietMs: 0, verify: async () => {} });
  assert.deepEqual(result.removed, backups.slice(0, 2).reverse());
  assert.deepEqual((await listCloudBackups(root)).map(item => item.path), backups.slice(2).reverse());
  assert.equal(await fs.readFile(unrelated, 'utf8'), 'unrelated');
  assert.equal(await fs.readFile(diagnostic, 'utf8'), 'diagnostic');
  assert.equal(await fs.readFile(partial, 'utf8'), 'still writing');
});

test('recent or invalid retained snapshots block every deletion', async t => {
  const root = await fixture(t);
  const backups = [];
  for (let number = 1; number <= 6; number++) backups.push(await createCandidate(root, number));
  const recent = await pruneCloudBackups({ root, apply: true, now: Date.UTC(2026, 8, 23, 0, 7), verify: async () => {} });
  assert.equal(recent.status, 'deferred-recent-backup');
  assert.equal((await listCloudBackups(root)).length, 6);
  await assert.rejects(pruneCloudBackups({ root, apply: true, now: Date.UTC(2026, 8, 24), minQuietMs: 0,
    verify: async item => { if (item.path === backups[5]) throw new Error('invalid archive'); } }), /invalid archive/);
  assert.equal((await listCloudBackups(root)).length, 6, 'validation fails before removing an old backup');
});

test('a changed backup invalidates the deletion plan', async t => {
  const root = await fixture(t);
  for (let number = 1; number <= 6; number++) await createCandidate(root, number);
  await assert.rejects(pruneCloudBackups({ root, apply: true, now: Date.UTC(2026, 8, 24), minQuietMs: 0,
    verify: async item => { if (item.path.endsWith(archiveName(6))) await fs.writeFile(item.path, 'changed'); } }), /changed during verification/);
  assert.equal((await listCloudBackups(root)).length, 6);
});

test('a backup-shaped entry with an unexpected type blocks pruning', async t => {
  const root = await fixture(t);
  for (let number = 1; number <= 6; number++) await createCandidate(root, number);
  await fs.mkdir(path.join(root, archiveName(7)));
  await assert.rejects(pruneCloudBackups({ root, apply: true, now: Date.UTC(2026, 8, 24), minQuietMs: 0,
    verify: async () => {} }), /Unexpected backup entry type/);
  assert.equal((await fs.readdir(root)).filter(name => name.endsWith('.tar')).length, 7);
});

test('legacy snapshot directories require data and config and can be pruned precisely', async t => {
  const root = await fixture(t);
  const legacy = path.join(root, 'context-guard-cloud', 'pre-v1-20260924');
  await fs.mkdir(path.join(legacy, 'data'), { recursive: true });
  await assert.rejects(verifyCloudBackup({ path: legacy, kind: 'directory' }), /ENOENT|Incomplete backup directory/);
  await fs.mkdir(path.join(legacy, 'config'));
  await verifyCloudBackup({ path: legacy, kind: 'directory' });
  const timestamp = new Date(Date.UTC(2026, 8, 23));
  await fs.utimes(legacy, timestamp, timestamp);
  for (let number = 2; number <= 6; number++) await createCandidate(root, number);
  const result = await pruneCloudBackups({ root, apply: true, now: Date.UTC(2026, 8, 24), minQuietMs: 0, verify: async () => {} });
  assert.deepEqual(result.removed, [legacy]);
  await assert.rejects(fs.stat(legacy), { code: 'ENOENT' });
});

test('CLI validates complete tar archives before applying retention', async t => {
  const root = await fixture(t);
  const payload = path.join(root, 'payload.txt');
  const valid = path.join(root, 'valid.tar');
  await fs.writeFile(payload, 'recoverable backup fixture');
  const tar = spawnSync('tar', ['-cf', valid, '-C', root, 'payload.txt'], { windowsHide: true });
  assert.equal(tar.status, 0, 'tar is a documented Cloud prerequisite');
  for (let number = 1; number <= 6; number++) {
    const target = path.join(root, archiveName(number));
    await fs.copyFile(valid, target);
    const timestamp = new Date(Date.UTC(2026, 8, 23, 0, number));
    await fs.utimes(target, timestamp, timestamp);
  }
  const run = spawnSync(process.execPath, [script, '--root', root, '--apply'], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).removed.length, 1);
  assert.equal((await listCloudBackups(root)).length, 5);
  await createCandidate(root, 7);
  await fs.writeFile(path.join(root, archiveName(7)), 'corrupt tar');
  const timestamp = new Date(Date.UTC(2026, 8, 23, 0, 7));
  await fs.utimes(path.join(root, archiveName(7)), timestamp, timestamp);
  const refused = spawnSync(process.execPath, [script, '--root', root, '--apply'], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Backup verification failed/);
  assert.equal((await listCloudBackups(root)).length, 6);
});
