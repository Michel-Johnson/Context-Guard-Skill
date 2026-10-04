import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { atomicWrite, encode } from '../scripts/shared/io.mjs';
import { memoryConfigPath, sessionMemoryDir } from '../scripts/workbench/memory.mjs';
import { resolveProject } from '../scripts/workbench/project.mjs';
import { inspectRetiredSync, sessionSync, syncStatus } from '../scripts/workbench/sync.mjs';
import { startServer } from '../scripts/workbench/server.mjs';

const node = (id, title) => ({ id, title, kind: 'work', state: 'dirty', purpose: '', memories: [], ideas: [], todos: [], bugs: [], dormant: [], files: [], owns: [], children: [] });
const document = () => ({ v: 1, project: 'Sync Fixture', bootstrap: 'ready', flows: [], root: { ...node('T0', 'Sync Fixture'), kind: 'module', children: [node('N1', 'One'), node('N2', 'Two')] } });
async function fixture(t, git = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-session-sync-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  if (git) {
    for (const args of [['init', '-b', 'main'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'fixture']]) {
      execFileSync('git', args, { cwd: root, stdio: 'pipe', windowsHide: true });
    }
  }
  const project = await resolveProject(root);
  return { root, project, retired: path.join(root, '.codex/context/private/cloud-sync') };
}
const write = (file, value) => atomicWrite(file, encode(value));
const upgrade = reason => error => error.code === 'UPGRADE_REQUIRED' && error.details.reason === reason;

test('sync status reports workbench-managed Session state without exposing its token', async t => {
  const { root, project } = await fixture(t);
  await write(memoryConfigPath(project), { url: 'https://map.example.test', projectId: 'managed-project', token: 'do-not-print' });
  await write(path.join(sessionMemoryDir(project, 'managed-session'), 'remote-sync/state.json'), { configured: true, status: 'offline', pending: 1, cursor: 7 });
  const status = await syncStatus(root, 'managed-session');
  assert.equal(status.managedBy, 'workbench');
  assert.equal(status.state.status, 'offline');
  assert.equal(status.state.pending, 1);
  assert.equal(status.state.cursor, 7);
  assert.equal(JSON.stringify(status).includes('do-not-print'), false);
});

for (const [file, value] of [
  ['state.json', { status: 'conflict', conflict: 'LOCAL_DIRTY' }],
  ['state.json', { status: 'synced', cursor: 3, receivedCursor: 4 }],
  ['outbox.json', { operationId: 'uncertain-request' }],
  ['works/s.json', { status: 'working', operationId: 'old-work' }],
  ['works/s.json', { status: 'conflict' }],
  ['conflict.json', { local: document() }],
  ['service.json', { pid: process.pid }],
]) test(`retirement preserves and rejects unconfirmed ${file}: ${JSON.stringify(value).slice(0, 50)}`, async t => {
  const { root, project, retired } = await fixture(t);
  const target = path.join(retired, file);
  await write(target, value);
  await write(memoryConfigPath(project), { url: 'https://map.example.test', projectId: 'project', token: 'private' });
  const before = await fs.readFile(target, 'utf8');
  await assert.rejects(syncStatus(root, 's'), upgrade('legacy-sync-state-pending'));
  assert.equal(await fs.readFile(target, 'utf8'), before);
});

test('retirement preserves dirty Maps and unreadable state instead of inferring a migration', async t => {
  const { root, project, retired } = await fixture(t);
  const base = document(), local = document(); local.root.title = 'Unsent edit';
  await write(path.join(retired, 'base-map.json'), base);
  await write(path.join(root, '.codex/context/map.json'), local);
  await assert.rejects(inspectRetiredSync(project), upgrade('legacy-sync-state-pending'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, '.codex/context/map.json'))), local);
  await fs.writeFile(path.join(retired, 'base-map.json'), '{broken');
  await assert.rejects(inspectRetiredSync(project), upgrade('legacy-sync-state-pending'));
});

test('only retired configuration requests reconnect; it never blocks an established current connection', async t => {
  const { root, project, retired } = await fixture(t, true);
  const file = path.join(project.sharedDir, 'cloud-sync/config.json');
  await write(file, { url: 'https://old.example.test', projectId: 'old', token: 'old-secret' });
  const before = await fs.readFile(file, 'utf8');
  await assert.rejects(syncStatus(root), upgrade('legacy-sync-reconnect'));
  await write(memoryConfigPath(project), { url: 'https://current.example.test', projectId: 'current', token: 'current-secret' });
  const map = document();
  await write(path.join(retired, 'base-map.json'), map);
  await write(path.join(root, '.codex/context/map.json'), map);
  await write(path.join(retired, 'works/done.json'), { status: 'completed' });
  assert.equal((await syncStatus(root)).projectId, 'current');
  assert.equal(await fs.readFile(file, 'utf8'), before);
});

test('public CLI sync uses the workbench entry and preserves old pending data', async t => {
  const { root, retired } = await fixture(t);
  const launcher = new URL('../bin/context-guard-skill.js', import.meta.url);
  const run = () => spawnSync(process.execPath, [fileURLToPath(launcher), 'sync', 'status', '--root', root], { encoding: 'utf8', windowsHide: true });
  const clean = run();
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(JSON.parse(clean.stdout).managedBy, 'workbench');
  const file = path.join(retired, 'outbox.json');
  await write(file, { operationId: 'do-not-discard' });
  const blocked = run();
  assert.equal(blocked.status, 1);
  assert.equal(JSON.parse(blocked.stdout).error.code, 'UPGRADE_REQUIRED');
  assert.equal(JSON.parse(await fs.readFile(file)).operationId, 'do-not-discard');
});

test('retired commands report an explicit upgrade error and never create another daemon', async t => {
  const { root } = await fixture(t);
  for (const action of ['connect', 'serve', 'track']) {
    await assert.rejects(sessionSync(root, '', action), upgrade('legacy-sync-command'));
  }
  await assert.rejects(fs.access(path.join(root, '.codex')), { code: 'ENOENT' });
});

test('backend startup cannot bypass the retired pending-data guard', async t => {
  const { root, retired } = await fixture(t);
  const file = path.join(retired, 'outbox.json');
  await write(file, { operationId: 'unsent-before-upgrade' });
  await assert.rejects(startServer({ root, port: 0 }), upgrade('legacy-sync-state-pending'));
  assert.equal(JSON.parse(await fs.readFile(file)).operationId, 'unsent-before-upgrade');
  await assert.rejects(fs.access(path.join(root, '.codex/context/private/node-workbench.lock')), { code: 'ENOENT' });
});

