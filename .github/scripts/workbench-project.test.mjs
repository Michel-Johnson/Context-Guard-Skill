import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveProject, saveMainBinding, bindingStatus, sameProject, listWorktrees, mainWorktree, sessionBinding } from '../../scripts/workbench/project.mjs';
import { startServer } from '../../scripts/workbench/server.mjs';
import { ensureServer } from '../../scripts/workbench/cli.mjs';
import { syncPaths } from '../../scripts/sync/client.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

async function repository({ remote = 'git@github.com:example/context-guard.git', mainBranch = 'main' } = {}) {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-project-'));
  const root = path.join(sandbox, 'main');
  await fs.mkdir(root);
  git(root, 'init', '-b', mainBranch);
  git(root, 'config', 'user.name', 'Context Guard Test');
  git(root, 'config', 'user.email', 'context-guard@example.invalid');
  await fs.writeFile(path.join(root, 'README.md'), '# fixture\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'fixture');
  if (remote) {
    git(root, 'remote', 'add', 'origin', remote);
    git(root, 'update-ref', `refs/remotes/origin/${mainBranch}`, 'HEAD');
    git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${mainBranch}`);
  }
  const worktree = path.join(sandbox, 'feature');
  git(root, 'worktree', 'add', '-b', 'feature', worktree);
  return { sandbox, root, worktree, async dispose() { await fs.rm(sandbox, { recursive: true, force: true }); } };
}

async function commitMainMap(fixture, title) {
  const context = path.join(fixture.root, '.codex/context');
  await fs.mkdir(path.join(context, 'private'), { recursive: true });
  await fs.writeFile(path.join(context, 'map.json'), JSON.stringify({ v: 1, project: 'fixture', bootstrap: 'ready', flows: [], root: { id: 'T0', title, kind: 'module', state: 'dirty', children: [] } }, null, 2) + '\n');
  git(fixture.root, 'add', '.codex/context/map.json');
  git(fixture.root, 'commit', '-m', `map: ${title}`);
  const branch = git(fixture.root, 'branch', '--show-current');
  try { git(fixture.root, 'remote', 'get-url', 'origin'); git(fixture.root, 'update-ref', `refs/remotes/origin/${branch}`, 'HEAD'); } catch {}
}

test('linked worktrees resolve to one project and one shared workbench directory', async t => {
  const fixture = await repository(); t.after(() => fixture.dispose());
  const [main, feature] = await Promise.all([resolveProject(fixture.root), resolveProject(fixture.worktree)]);
  assert.equal(main.projectId, feature.projectId);
  assert.equal(main.sharedDir, feature.sharedDir);
  assert.notEqual(main.worktreeId, feature.worktreeId);
  assert.deepEqual(main.github, { owner: 'example', repo: 'context-guard', slug: 'example/context-guard' });
  assert.equal(main.mainBranch, 'main');
  assert.equal(feature.branch, 'feature');
  assert.equal(await sameProject(fixture.root, fixture.worktree), true);
  assert.deepEqual(new Set(await listWorktrees(feature)), new Set([await fs.realpath(fixture.root), await fs.realpath(fixture.worktree)]));
  assert.equal(await mainWorktree(feature), await fs.realpath(fixture.root));
  const binding = await sessionBinding(feature, 'session-1');
  assert.equal(binding.worktreeRoot, await fs.realpath(fixture.worktree));
  assert.equal(binding.baseMainSha, main.mainSha);
});

test('a git project without a GitHub main requires an explicit binding', async t => {
  const fixture = await repository({ remote: '' }); t.after(() => fixture.dispose());
  const project = await resolveProject(fixture.worktree);
  assert.equal(project.kind, 'git');
  assert.equal(project.github, null);
  assert.equal(project.bindingRequired, true);
});

test('a user-selected local main branch is validated and persisted for all worktrees', async t => {
  const fixture = await repository({ remote: '', mainBranch: 'stable' }); t.after(() => fixture.dispose());
  assert.equal((await resolveProject(fixture.worktree)).bindingRequired, true);
  const selected = await saveMainBinding(fixture.worktree, { mode: 'local', branch: 'stable' });
  assert.equal(selected.bindingRequired, false);
  assert.equal(selected.mainRef, 'refs/heads/stable');
  const fromMain = await resolveProject(fixture.root);
  assert.deepEqual(fromMain.binding.main, { mode: 'local', remote: '', branch: 'stable', ref: 'refs/heads/stable' });
});

test('ordinary folders retain one-folder-one-workbench compatibility', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-folder-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = await resolveProject(root);
  assert.equal(project.kind, 'folder');
  assert.equal(project.worktreeRoot, await fs.realpath(root));
  assert.match(project.sharedDir, /project-workbench$/);
  assert.equal(project.bindingRequired, false);
});

test('linked worktrees share one Cloud project binding but retain temporary sync state', async t => {
  const fixture = await repository(); t.after(() => fixture.dispose());
  const main = syncPaths(fixture.root), feature = syncPaths(fixture.worktree);
  assert.equal(main.config, feature.config);
  assert.notEqual(main.state, feature.state);
  assert.notEqual(main.works, feature.works);
});

test('linked worktrees reuse one running workbench instance', async t => {
  const fixture = await repository(); t.after(() => fixture.dispose());
  await commitMainMap(fixture, 'main map');
  for (const [root, title] of [[fixture.worktree, 'feature map']]) {
    const context = path.join(root, '.codex/context');
    await fs.mkdir(path.join(context, 'private'), { recursive: true });
    await fs.writeFile(path.join(context, 'map.json'), JSON.stringify({ v: 1, project: 'fixture', bootstrap: 'ready', flows: [], root: { id: 'T0', title, kind: 'module', state: 'dirty', children: [] } }, null, 2) + '\n');
  }
  const running = await startServer({ root: fixture.root, port: 0 }); t.after(() => running.close());
  const reused = await ensureServer(fixture.worktree, 0);
  assert.equal(reused.projectId, running.project.projectId);
  assert.equal(reused.instance, running.state.instance);
  assert.equal(reused.pid, process.pid);
  assert.equal(reused.url, running.state.url);
  const persisted = JSON.parse(await fs.readFile(path.join(running.project.sharedDir, 'project-binding.json'), 'utf8'));
  assert.equal(persisted.main.branch, 'main');
});

test('binding status stays unbound until a Session explicitly registers', async t => {
  const fixture = await repository(); t.after(() => fixture.dispose());
  const context = path.join(fixture.worktree, '.codex/context');
  await fs.mkdir(path.join(context, 'private'), { recursive: true });
  await fs.writeFile(path.join(context, 'map.json'), JSON.stringify({ v: 1, project: 'fixture', bootstrap: 'ready', flows: [], root: { id: 'T0', title: 'feature', kind: 'module', children: [] } }, null, 2) + '\n');
  await fs.writeFile(path.join(context, 'sessions.jsonl'), JSON.stringify({ at: new Date().toISOString(), event: 'session-start', platform: 'codex', session_id: 'session-feature' }) + '\n');
  await commitMainMap(fixture, 'main');
  const project = await resolveProject(fixture.worktree);
  assert.equal((await bindingStatus(project, 'session-feature')).session.bound, false);
  const running = await startServer({ root: fixture.root, port: 0 }); t.after(() => running.close());
  const response = await fetch(new URL('/api/session', running.state.url), { method: 'POST', headers: { Authorization: `Bearer ${running.state.adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'session-feature', worktreeRoot: fixture.worktree }) });
  assert.equal(response.status, 200);
  assert.equal((await bindingStatus(project, 'session-feature')).session.bound, true);
});

test('an unconfigured project never seeds All Sessions from a feature worktree', async t => {
  const fixture = await repository({ remote: '', mainBranch: 'stable' }); t.after(() => fixture.dispose());
  const context = path.join(fixture.worktree, '.codex/context');
  await fs.mkdir(path.join(context, 'private'), { recursive: true });
  await fs.writeFile(path.join(context, 'map.json'), JSON.stringify({ v: 1, project: 'fixture', bootstrap: 'ready', flows: [], root: { id: 'T0', title: 'unmerged feature', kind: 'module', children: [] } }, null, 2) + '\n');
  const running = await startServer({ root: fixture.worktree, port: 0 }); t.after(() => running.close());
  const response = await fetch(new URL('/api/state', running.state.url), { headers: { Authorization: `Bearer ${running.humanToken}` } });
  const state = await response.json();
  assert.equal(state.doc.root, null);
  assert.equal(state.source.status, 'binding-required');
});

test('All Sessions keeps the main baseline while Session views read their bound worktree', async t => {
  const fixture = await repository(); t.after(() => fixture.dispose());
  await commitMainMap(fixture, 'main map');
  const maps = [[fixture.root, 'main map', 'session-main'], [fixture.worktree, 'feature map', 'session-feature']];
  for (const [root, title, sessionId] of maps) {
    const context = path.join(root, '.codex/context');
    await fs.mkdir(path.join(context, 'private'), { recursive: true });
    await fs.writeFile(path.join(context, 'map.json'), JSON.stringify({ v: 1, project: 'fixture', bootstrap: 'ready', flows: [], root: { id: 'T0', title, kind: 'module', state: 'dirty', children: [] } }, null, 2) + '\n');
    await fs.writeFile(path.join(context, 'sessions.jsonl'), JSON.stringify({ at: new Date().toISOString(), event: 'session-start', platform: 'codex', session_id: sessionId }) + '\n');
  }
  const running = await startServer({ root: fixture.root, port: 0 }); t.after(() => running.close());
  const origin = new URL(running.state.url).origin;
  const register = async (sessionId, worktreeRoot) => {
    const response = await fetch(origin + '/api/session', { method: 'POST', headers: { Authorization: `Bearer ${running.state.adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, worktreeRoot }) });
    assert.equal(response.status, 200); return response.json();
  };
  const mainActor = await register('session-main', fixture.root);
  const featureActor = await register('session-feature', fixture.worktree);
  const state = async (token, view = '') => fetch(origin + `/api/state${view ? `?view=${encodeURIComponent(view)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } }).then(async response => ({ status: response.status, body: await response.json() }));
  assert.equal((await state(mainActor.token)).body.doc.root.title, 'main map');
  assert.equal((await state(featureActor.token)).body.doc.root.title, 'feature map');
  assert.equal((await state(running.humanToken)).body.doc.root.title, 'main map');
  assert.equal((await state(running.humanToken, 'session:session-feature')).body.doc.root.title, 'feature map');
  const changed = JSON.parse(await fs.readFile(path.join(fixture.worktree, '.codex/context/map.json'), 'utf8'));
  changed.root.title = 'feature changed only';
  await fs.writeFile(path.join(fixture.worktree, '.codex/context/map.json'), JSON.stringify(changed, null, 2) + '\n');
  assert.equal((await state(featureActor.token)).body.doc.root.title, 'feature changed only');
  assert.equal((await state(running.humanToken)).body.doc.root.title, 'main map');
});

test('All Sessions ignores worktree edits and refreshes only after the configured main ref advances', async t => {
  const fixture = await repository(); t.after(() => fixture.dispose());
  await commitMainMap(fixture, 'main baseline');
  for (const [root, title] of [[fixture.root, 'uncommitted main edit'], [fixture.worktree, 'unmerged feature']]) {
    const context = path.join(root, '.codex/context');
    await fs.mkdir(path.join(context, 'private'), { recursive: true });
    await fs.writeFile(path.join(context, 'map.json'), JSON.stringify({ v: 1, project: 'fixture', bootstrap: 'ready', flows: [], root: { id: 'T0', title, kind: 'module', state: 'dirty', children: [] } }, null, 2) + '\n');
  }
  const running = await startServer({ root: fixture.worktree, port: 0 }); t.after(() => running.close());
  const response = await fetch(new URL('/api/state', running.state.url), { headers: { Authorization: `Bearer ${running.humanToken}` } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).doc.root.title, 'main baseline');
  await commitMainMap(fixture, 'merged update');
  const refreshed = await fetch(new URL('/api/project-refresh', running.state.url), { method: 'POST', headers: { Authorization: `Bearer ${running.state.adminToken}` } });
  assert.equal(refreshed.status, 200);
  const afterMerge = await fetch(new URL('/api/state', running.state.url), { headers: { Authorization: `Bearer ${running.humanToken}` } });
  assert.equal((await afterMerge.json()).doc.root.title, 'merged update');
  const rejected = await fetch(new URL('/api/commit', running.state.url), { method: 'POST', headers: { Authorization: `Bearer ${running.humanToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: 'main-write', baseVersion: running.store.version, operations: [] }) });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error.code, 'READ_ONLY_MAIN');
});
