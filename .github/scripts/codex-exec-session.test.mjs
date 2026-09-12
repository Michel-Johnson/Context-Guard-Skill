import './test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { Access, recordHostAttestedSession } from '../../scripts/workbench/access.mjs';
import { startServer } from '../../scripts/workbench/server.mjs';
import { pythonCommand } from './python-command.mjs';

const cli = path.resolve('bin/context-guard-skill.js');

async function seedCodexThread({ codexHome, sessionId, cwd, name = 'exec-thread', nestedSqlite = true }) {
  const database = nestedSqlite
    ? path.join(codexHome, 'sqlite', 'state_5.sqlite')
    : path.join(codexHome, 'state.sqlite');
  const rollout = path.join(codexHome, 'rollout.jsonl');
  await fs.mkdir(path.dirname(database), { recursive: true });
  await fs.writeFile(rollout, `${JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', type: 'event_msg', payload: { type: 'task_started' } })}\n`);
  execFileSync(pythonCommand(), ['-c', [
    'import sqlite3, sys',
    'db = sqlite3.connect(sys.argv[1])',
    "db.execute('CREATE TABLE threads (id TEXT, name TEXT, title TEXT, created_at INTEGER, updated_at INTEGER, rollout_path TEXT, cwd TEXT, thread_source TEXT, archived INTEGER)')",
    "db.execute('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', (sys.argv[2], sys.argv[5], sys.argv[5], 1, 2, sys.argv[3], sys.argv[4], 'user', 0))",
    'db.commit(); db.close()',
  ].join(';'), database, sessionId, rollout, cwd, name], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
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

test('Issue #55: Codex sqlite threads under ~/.codex/sqlite register without SessionStart', async t => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-codex-exec-'));
  t.after(() => fs.rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const root = path.join(sandbox, 'project');
  const codexHome = path.join(sandbox, 'codex-home');
  const sessionId = '01a0827b-f285-7a62-8c85-68aaa972f153';
  await fs.mkdir(root, { recursive: true });
  await initProject(root);
  await seedCodexThread({ codexHome, sessionId, cwd: root, nestedSqlite: true });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  t.after(() => { process.env.CODEX_HOME = previousCodexHome; });
  const access = await new Access(root, { codexHome }).init();
  assert.equal(await access.sessionExists(sessionId, root), true);
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

test('Issue #55: host-attested CODEX_THREAD_ID binds workbench without sessions.jsonl', async t => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-codex-host-'));
  t.after(() => fs.rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const root = path.join(sandbox, 'project');
  const sessionId = '01a08275-host-attested';
  await fs.mkdir(root, { recursive: true });
  await initProject(root);
  const sessionsFile = path.join(root, '.codex/context/sessions.jsonl');
  const before = await fs.readFile(sessionsFile, 'utf8').catch(() => '');
  assert.ok(!before.includes(sessionId), 'fixture must not pre-record the exec session');
  assert.equal(await recordHostAttestedSession(root, sessionId, { CODEX_THREAD_ID: sessionId }), true);
  const result = spawnSync(process.execPath, [cli, 'workbench', '--root', root, '--session', sessionId, '--direct'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_THREAD_ID: sessionId,
      CONTEXT_GUARD_HEADLESS: '1',
      CONTEXT_GUARD_NAMED_WORKBENCH: '0',
    },
    windowsHide: true,
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.binding?.bound, true);
  assert.match(await fs.readFile(sessionsFile, 'utf8'), /host-environment/);
});
