import './test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { Access } from '../../scripts/workbench/access.mjs';
import { resolveProject } from '../../scripts/workbench/project.mjs';
import { startServer } from '../../scripts/workbench/server.mjs';

const cli = path.resolve('bin/context-guard-skill.js');

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

async function repository() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-codex-exec-'));
  const root = path.join(sandbox, 'main');
  await fs.mkdir(root);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Context Guard Test');
  git(root, 'config', 'user.email', 'context-guard@example.invalid');
  git(root, 'remote', 'add', 'origin', 'git@github.com:example/context-guard.git');
  await fs.writeFile(path.join(root, 'README.md'), '# fixture\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'fixture');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  const nested = path.join(root, 'nested', 'project');
  await fs.mkdir(nested, { recursive: true });
  return { sandbox, root, nested, async dispose() { await fs.rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}

async function seedCodexThread({ codexHome, sessionId, cwd, name = 'exec-thread' }) {
  const database = path.join(codexHome, 'state.sqlite');
  const rollout = path.join(codexHome, 'rollout.jsonl');
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(rollout, `${JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', type: 'event_msg', payload: { type: 'task_started' } })}\n`);
  execFileSync('python3', ['-c', [
    'import sqlite3, sys',
    'db = sqlite3.connect(sys.argv[1])',
    "db.execute('CREATE TABLE threads (id TEXT, name TEXT, title TEXT, created_at INTEGER, updated_at INTEGER, rollout_path TEXT, cwd TEXT, thread_source TEXT, archived INTEGER)')",
    "db.execute('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', (sys.argv[2], sys.argv[5], sys.argv[5], 1, 2, sys.argv[3], sys.argv[4], 'user', 0))",
    'db.commit(); db.close()',
  ].join(';'), database, sessionId, rollout, cwd, name], { encoding: 'utf8', windowsHide: true });
  return { database, rollout };
}

async function initProject(root) {
  const result = spawnSync(process.execPath, [cli, 'init', '--root', root], {
    encoding: 'utf8',
    env: { ...process.env, CONTEXT_GUARD_HEADLESS: '1' },
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('Codex exec thread IDs register without a lifecycle hook in a standalone folder project', async t => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-codex-folder-'));
  t.after(() => fs.rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const root = path.join(sandbox, 'project');
  const codexHome = path.join(sandbox, 'codex-home');
  const sessionId = 'folder-exec-session';
  await fs.mkdir(root, { recursive: true });
  await initProject(root);
  await seedCodexThread({ codexHome, sessionId, cwd: root });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  t.after(() => { process.env.CODEX_HOME = previousCodexHome; });
  const access = await new Access(root, { codexHome }).init();
  assert.deepEqual(await access.knownSessions(root), [sessionId]);
  let running;
  t.after(async () => { await running?.close(); });
  running = await startServer({ root, port: 0 });
  const response = await fetch(new URL('/api/session', running.state.url), {
    method: 'POST',
    headers: { Authorization: `Bearer ${running.state.adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, worktreeRoot: root }),
  });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
});

test('Codex exec thread IDs register from a nested opened root inside a Git project', async t => {
  const fixture = await repository();
  t.after(() => fixture.dispose());
  const codexHome = path.join(fixture.sandbox, 'codex-home');
  const sessionId = 'nested-exec-session';
  const context = path.join(fixture.nested, '.codex/context');
  await fs.mkdir(path.join(context, 'private'), { recursive: true });
  await fs.writeFile(path.join(context, 'map.json'), JSON.stringify({
    v: 1, project: 'fixture', bootstrap: 'ready', flows: [],
    root: { id: 'T0', title: 'nested feature', kind: 'module', children: [] },
  }, null, 2) + '\n');
  const mainContext = path.join(fixture.root, '.codex/context');
  await fs.mkdir(path.join(mainContext, 'private'), { recursive: true });
  await fs.writeFile(path.join(mainContext, 'map.json'), JSON.stringify({
    v: 1, project: 'fixture', bootstrap: 'ready', flows: [],
    root: { id: 'T0', title: 'main map', kind: 'module', children: [] },
  }, null, 2) + '\n');
  git(fixture.root, 'add', 'nested/project/.codex/context/map.json', '.codex/context/map.json');
  git(fixture.root, 'commit', '-m', 'map: nested and main');
  await seedCodexThread({ codexHome, sessionId, cwd: fixture.nested, name: 'nested-exec' });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  t.after(() => { process.env.CODEX_HOME = previousCodexHome; });
  const project = await resolveProject(fixture.nested);
  assert.notEqual(project.openedRoot, project.worktreeRoot);
  const access = await new Access(fixture.root, { codexHome }).init();
  assert.deepEqual(await access.knownSessions([project.openedRoot, project.worktreeRoot]), [sessionId]);
  let running;
  t.after(async () => { await running?.close(); });
  running = await startServer({ root: fixture.nested, port: 0 });
  const response = await fetch(new URL('/api/session', running.state.url), {
    method: 'POST',
    headers: { Authorization: `Bearer ${running.state.adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, worktreeRoot: fixture.nested }),
  });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
});

test('Codex exec thread IDs bind through the CLI workbench command without sessions.jsonl', async t => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-codex-cli-'));
  t.after(() => fs.rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const root = path.join(sandbox, 'project');
  const codexHome = path.join(sandbox, 'codex-home');
  const sessionId = 'cli-exec-session';
  await fs.mkdir(root, { recursive: true });
  await initProject(root);
  await seedCodexThread({ codexHome, sessionId, cwd: root });
  const port = 19001 + Math.floor(Math.random() * 1000);
  const result = spawnSync(process.execPath, [cli, 'workbench', '--root', root, '--session', sessionId, '--port', String(port)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CONTEXT_GUARD_HEADLESS: '1',
      CONTEXT_GUARD_NAMED_WORKBENCH: '0',
    },
    windowsHide: true,
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.binding?.bound, true);
  assert.match(payload.url, /session=cli-exec-session/);
});
