import '../.github/scripts/test-environment.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { connectSync, finishSync, syncStatus } from '../scripts/sync/client.mjs';
import { resolveProject, sessionBinding, sessionBindingsPath } from '../scripts/workbench/project.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hookScript = path.join(repository, 'scripts/context_guard_hook.py');
const contextScript = path.join(repository, 'scripts/context_guard.py');
const workbenchCli = path.join(repository, 'scripts/workbench/cli.mjs');
const cloudServer = path.join(repository, 'scripts/cloud/server.mjs');
const python = process.platform === 'win32' ? 'python' : 'python3';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repository,
    encoding: 'utf8',
    input: options.input,
    env: { ...process.env, CONTEXT_GUARD_NAMED_WORKBENCH: '0', CONTEXT_GUARD_DISABLE_WORKBENCH: '1', CONTEXT_GUARD_HEADLESS: '1', ...options.env },
    timeout: options.timeout || 30_000,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}

function hook(event, project, sessionId, extra = {}) {
  const { platform = 'codex', ...hookExtra } = extra;
  const payload = {
    session_id: sessionId,
    cwd: project,
    hook_event_name: event,
    turn_id: hookExtra.turn_id || 'turn-one',
    ...hookExtra,
  };
  const result = run(python, [hookScript, event.replaceAll(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, ''), '--platform', platform], {
    cwd: project,
    input: JSON.stringify(payload),
  });
  return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : {} };
}

async function fixture() {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-hooks-'));
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  return project;
}
async function confirmBinding(root, session) {
  const project = await resolveProject(root);
  const file = sessionBindingsPath(project);
  const existing = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{"sessions":{}}'));
  existing.sessions[session] = await sessionBinding(project, session);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(existing));
}

async function dispose(project) {
  if (await fs.access(path.join(project, '.codex/context/private/workbench.json')).then(() => true, () => false)) {
    spawnSync(process.execPath, [workbenchCli, 'workbench', '--root', project, '--stop'], {
      encoding: 'utf8', timeout: 15_000, windowsHide: true,
    });
  }
  await fs.rm(project, { recursive: true, force: true, maxRetries: 3 });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForHealth(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/api/health', url));
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`cloud server did not start: ${url}`);
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessExit(pid, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`workbench process ${pid} did not exit within ${timeout} ms`);
}

async function stopFixtureWorkbench(project, pid) {
  const stopped = spawnSync(process.execPath, [workbenchCli, 'workbench', '--root', project, '--stop'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  assert.equal(stopped.status, 0, stopped.stderr || stopped.error?.message);
  assert.equal(JSON.parse(stopped.stdout).stopped, true);
  await waitForProcessExit(pid);
  const privateDir = path.join(project, '.codex/context/private');
  await assert.rejects(fs.access(path.join(privateDir, 'node-workbench.lock')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(privateDir, 'workbench.json')), { code: 'ENOENT' });
}

async function installMap(project) {
  const ctx = path.join(project, '.codex/context');
  const map = JSON.parse(await fs.readFile(path.join(ctx, 'map.json'), 'utf8'));
  map.root.children = [{
    id: 'N1', title: 'Runtime', kind: 'module', state: 'dirty', proposal: 'accepted', isNew: false,
    purpose: 'Own runtime code', memories: [], ideas: [], todos: [], bugs: [], dormant: [], files: [], owns: ['src/'], children: [],
  }];
  map.bootstrap = 'ready';
  await fs.writeFile(path.join(ctx, 'map.json'), `${JSON.stringify(map, null, 2)}\n`);
  return map;
}

async function startPlan(t, project, session, paths = ['src/']) {
  const ctx = path.join(project, '.codex/context');
  await fs.writeFile(path.join(ctx, 'sessions/workbench-access.json'), JSON.stringify({ sessions: { [session]: { nodes: ['N1'] } } }));
  run(process.execPath, [workbenchCli, 'workbench', '--root', project, '--port', String(await freePort())]);
  return JSON.parse(run('python3', [contextScript, 'plan-start', '--root', project, '--session', session, '--input', '-'], {
    input: JSON.stringify({ approved: true, summary: '实现并验证运行时', node_ids: ['N1'], paths }),
  }).stdout);
}

function archivePlan(project, session, files = 'src/scratch.txt', extra = {}) {
  return run('python3', [contextScript, 'archive-session', '--root', project, '--session', session,
    '--summary', '完成运行时开发', '--files', files, '--input', '-'], {
    input: JSON.stringify({ verification: 'hook-lifecycle fixture: verified output', assessment: { decision: 'reuse', reason: '属于现有运行时节点' }, ...extra }),
  });
}

function finishPlan(project, session) {
  return run('python3', [contextScript, 'plan-finish', '--root', project, '--session', session]);
}

test('Codex installs exactly the eleven supported Context Guard hooks except SessionEnd', async () => {
  const config = JSON.parse(await fs.readFile(path.join(repository, 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(config.hooks).sort(), [
    'Interrupt', 'PermissionRequest', 'PostCompact', 'PostToolUse', 'PreCompact', 'PreToolUse',
    'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit',
  ].sort());
  assert.equal(config.hooks.Interrupt[0].hooks[0].timeout, 3);
  assert.equal(config.hooks.SessionEnd, undefined);
});

test('an initialized Git source checkout can use its own real Map without enabling plain install folders', async t => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-self-source-'));
  const installed = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-self-installed-'));
  t.after(() => Promise.all([source, installed].map(root => fs.rm(root, { recursive: true, force: true }))));
  for (const root of [source, installed]) {
    await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
    await fs.copyFile(hookScript, path.join(root, 'scripts/context_guard_hook.py'));
    await fs.copyFile(contextScript, path.join(root, 'scripts/context_guard.py'));
  }
  await fs.writeFile(path.join(source, '.git'), 'gitdir: test\n');
  run(python, [path.join(source, 'scripts/context_guard.py'), 'init', '--root', source], { cwd: source });
  run(python, [path.join(installed, 'scripts/context_guard.py'), 'init', '--root', installed], { cwd: installed });

  const sourceHook = run(python, [path.join(source, 'scripts/context_guard_hook.py'), 'session-start', '--platform', 'codex'], {
    cwd: source, env: { PWD: source, CODEX_WORKSPACE_ROOT: source, CODEX_PROJECT_ROOT: source, CODEX_CWD: source, WORKSPACE_ROOT: source, PROJECT_ROOT: source },
    input: JSON.stringify({ session_id: 'source-session', cwd: source, source: 'startup', is_background_agent: true }),
  });
  assert.match(sourceHook.stdout, /binding could not be read/);

  const installedHook = run(python, [path.join(installed, 'scripts/context_guard_hook.py'), 'session-start', '--platform', 'codex'], {
    cwd: installed, env: { PWD: installed, CODEX_WORKSPACE_ROOT: installed, CODEX_PROJECT_ROOT: installed, CODEX_CWD: installed, WORKSPACE_ROOT: installed, PROJECT_ROOT: installed },
    input: JSON.stringify({ session_id: 'installed-session', cwd: installed, source: 'startup', is_background_agent: true }),
  });
  assert.doesNotMatch(installedHook.stdout, /Context Guard Map snapshot/);
  const installedSessions = await fs.readFile(path.join(installed, '.codex/context/sessions.jsonl'), 'utf8').catch(() => '');
  assert.doesNotMatch(installedSessions, /installed-session/);
});

test('hooks keep an auditable plan across prompt, tools, compaction, interrupt and stop', async t => {
  const project = await fixture();
  t.after(() => dispose(project));
  const session = 'hook-session-one';
  await confirmBinding(project, session);

  const started = hook('SessionStart', project, session, { source: 'startup', is_background_agent: true });
  assert.match(started.json.hookSpecificOutput.additionalContext, /Context Guard Map snapshot/);
  assert.match(started.json.hookSpecificOutput.additionalContext, /Keep the plan active through commit, PR, merge, and installed acceptance/);

  const prompted = hook('UserPromptSubmit', project, session, { prompt: '完成 Hook 生命周期开发' });
  const signalId = prompted.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)?.[1];
  assert.ok(signalId);
  run(python, [contextScript, 'resolve-signal', '--root', project, '--session', session, '--signal', signalId, '--kind', 'task']);
  await installMap(project);
  const noPlan = hook('PreToolUse', project, session, { tool_name: 'exec_command', tool_input: { cmd: 'python3 fix.py' } });
  assert.equal(noPlan.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(noPlan.json.hookSpecificOutput.permissionDecisionReason, /without asking them to confirm again/);
  const planInput = JSON.stringify({ approved: true, summary: 'explicit request is approval', node_ids: ['N1'], paths: ['src/'] });
  for (const command of [
    `printf %s ${JSON.stringify(planInput)} | node ${JSON.stringify(contextScript.replace(/context_guard\.py$/, '../bin/context-guard-skill.js'))} plan-start --input -`,
    `printf %s ${JSON.stringify(planInput)} | python3 ${JSON.stringify(contextScript)} plan-start --input -`,
  ]) {
    const bootstrap = hook('PreToolUse', project, session, { tool_name: 'exec_command', tool_input: { cmd: command } });
    assert.equal(bootstrap.json.hookSpecificOutput?.permissionDecision, undefined, command);
  }
  await startPlan(t, project, session);

  const prepared = hook('PreToolUse', project, session, {
    tool_name: 'apply_patch', tool_use_id: 'tool-one',
    tool_input: { command: `*** Update File: ${path.join(project, 'src/scratch.txt')}` },
  });
  assert.match(prepared.json.hookSpecificOutput.additionalContext, /plan-/);
  await fs.writeFile(path.join(project, 'src/scratch.txt'), 'changed\n');
  hook('PostToolUse', project, session, {
    tool_name: 'apply_patch', tool_use_id: 'tool-one', tool_input: { path: path.join(project, 'src/scratch.txt') },
  });
  hook('PreCompact', project, session, { trigger: 'auto' });
  const restored = hook('PostCompact', project, session, { trigger: 'auto' });
  assert.match(restored.json.hookSpecificOutput.additionalContext, /Restored plan:/);
  const subagent = hook('SubagentStart', project, session, { agent_id: 'agent-one', agent_type: 'explorer' });
  assert.match(subagent.json.hookSpecificOutput.additionalContext, /Subagent scope is limited/);
  const subagentStopped = hook('SubagentStop', project, session, { agent_id: 'agent-one', agent_type: 'explorer', last_assistant_message: 'done' });
  assert.match(subagentStopped.json.systemMessage, /subagent boundary/);
  const interrupted = hook('Interrupt', project, session);
  assert.match(interrupted.json.systemMessage, /interrupted plan state/);
  const blocked = hook('Stop', project, session, { stop_hook_active: false });
  assert.equal(blocked.json.decision, 'block');
  assert.equal(blocked.json.reason, 'Context Guard is finishing the current task. No user action is required.');
  assert.doesNotMatch(JSON.stringify(blocked.json), /SIG-|Classify pending|plan-[a-f0-9]+|plan-finish/);
  const repeatedBlock = hook('Stop', project, session, { stop_hook_active: true });
  assert.equal(repeatedBlock.json.systemMessage, 'Context Guard is still finishing the current task. No user action is required.');
  assert.doesNotMatch(JSON.stringify(repeatedBlock.json), /SIG-|Classify pending|plan-[a-f0-9]+|plan-finish/);
  assert.throws(() => archivePlan(project, session), /subagent_review/);
  archivePlan(project, session, 'src/scratch.txt', { subagent_review: { 'agent-one': 'Reviewed paths and test evidence; no additional changes' } });
  finishPlan(project, session);
  const stopped = hook('Stop', project, session, { stop_hook_active: true });
  assert.deepEqual(stopped.json, {});

  const events = (await fs.readFile(path.join(project, '.codex/context/sessions.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  for (const event of events) {
    assert.ok(event.event_id);
    assert.ok(event.occurred_at);
    assert.ok(event.recorded_at);
  }
  for (const name of ['session-start', 'user-prompt-submit', 'pre-tool-use', 'post-tool-use', 'pre-compact', 'post-compact', 'subagent-start', 'subagent-stop', 'interrupt', 'stop']) {
    assert.ok(events.some(event => event.event === name), `missing ${name}`);
  }
});

test('read-only inspection remains available without a plan while writes stay gated', async t => {
  const project = await fixture();
  t.after(() => dispose(project));
  const session = 'read-only-session';
  await confirmBinding(project, session);
  hook('SessionStart', project, session, { source: 'startup', is_background_agent: true });
  await installMap(project);
  await fs.writeFile(path.join(project, '.codex/context/sessions/workbench-access.json'), JSON.stringify({ sessions: { [session]: { nodes: ['N1'] } } }));

  const commands = [
    'sed -n \'1,20p\' RULE.md && cat CI_todo.md',
    'rg -n "plan-start" scripts tests | head -20',
    'git status --short && git diff --stat && git log -1 --oneline',
    'git branch --show-current && git worktree list',
    'ps aux | rg context-guard',
    'lsof -nP -iTCP:1355 -sTCP:LISTEN',
    'curl -fsS http://127.0.0.1:1355/api/health',
    `node ${path.join(repository, 'bin/context-guard-skill.js')} workbench --diagnose --root ${project}`,
    `node ${path.join(repository, 'bin/context-guard-skill.js')} workbench --binding-status --root ${project} --session ${session}`,
    `node ${path.join(repository, 'bin/context-guard-skill.js')} plan-status --root ${project} --session ${session}`,
  ];
  for (const command of commands) {
    const result = hook('PreToolUse', project, session, { tool_name: 'exec_command', tool_input: { cmd: command } });
    assert.equal(result.json.hookSpecificOutput?.permissionDecision, undefined, command);
  }

  for (const command of ['touch src/new.txt', 'sed -ni s/a/b/ src/a.txt', 'git branch new-feature', 'curl -XPOST http://127.0.0.1/api/reset', 'rm context-guard plan-start']) {
    const result = hook('PreToolUse', project, session, { tool_name: 'exec_command', tool_input: { cmd: command } });
    assert.equal(result.json.hookSpecificOutput.permissionDecision, 'deny', command);
    assert.match(result.json.hookSpecificOutput.permissionDecisionReason, /plan-start/);
  }

  const protectedTextOnly = hook('PreToolUse', project, session, {
    tool_name: 'apply_patch',
    tool_input: `*** Begin Patch\n*** Add File: src/note.txt\n+Do not write .codex/context/map.json directly.\n*** End Patch`,
  });
  assert.equal(protectedTextOnly.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(protectedTextOnly.json.hookSpecificOutput.permissionDecisionReason, /plan-start/);
  assert.doesNotMatch(protectedTextOnly.json.hookSpecificOutput.permissionDecisionReason, /Direct map/);
});

test('configured Cloud hooks prepare once, track paths, checkpoint and require finish', async t => {
  const project = await fixture();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-hook-cloud-'));
  const port = await freePort();
  const cloudUrl = `http://127.0.0.1:${port}`;
  const cloud = spawn(process.execPath, [cloudServer], {
    cwd: project,
    env: {
      ...process.env,
      CONTEXT_GUARD_CLOUD_HOST: '127.0.0.1', CONTEXT_GUARD_CLOUD_PORT: String(port),
      CONTEXT_GUARD_CLOUD_DATA: dataDir, CONTEXT_GUARD_CLOUD_TOKEN: 'hook-admin',
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  t.after(async () => {
    cloud.kill('SIGTERM');
    await new Promise(resolve => cloud.once('exit', resolve));
    await dispose(project);
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  await waitForHealth(cloudUrl);
  const created = await fetch(new URL('/api/projects', cloudUrl), {
    method: 'POST', headers: { Authorization: 'Bearer hook-admin', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'hook-cloud', name: 'Hook Cloud' }),
  }).then(response => response.json());

  const session = 'hook-cloud-session';
  await confirmBinding(project, session);
  hook('SessionStart', project, session, { source: 'startup', is_background_agent: true });
  await installMap(project);
  await connectSync({ root: project, url: cloudUrl, projectId: 'hook-cloud', token: created.syncToken, startService: false });
  const ctx = path.join(project, '.codex/context');
  await fs.writeFile(path.join(ctx, 'sessions/workbench-access.json'), `${JSON.stringify({ sessions: { [session]: { nodes: ['N1'], changedAt: new Date().toISOString() } } }, null, 2)}\n`);
  await startPlan(t, project, session);

  const prepared = hook('PreToolUse', project, session, {
    tool_name: 'Write', tool_use_id: 'cloud-write', tool_input: { path: path.join(project, 'src/cloud.mjs'), content: 'ok' },
  });
  assert.match(prepared.json.hookSpecificOutput.additionalContext, /plan-/);
  await fs.writeFile(path.join(project, 'src/cloud.mjs'), 'ok\n');
  hook('PostToolUse', project, session, {
    tool_name: 'Write', tool_use_id: 'cloud-write', tool_input: { path: path.join(project, 'src/cloud.mjs') },
  });
  const blocked = hook('Stop', project, session, { stop_hook_active: false });
  assert.equal(blocked.json.decision, 'block');
  assert.equal(blocked.json.reason, 'Context Guard is finishing the current task. No user action is required.');
  assert.doesNotMatch(JSON.stringify(blocked.json), /SIG-|Classify pending|plan-[a-f0-9]+|plan-finish/);
  const beforeFinish = await syncStatus(project);
  const active = beforeFinish.works.find(item => item.sessionId === session);
  assert.equal(active.status, 'working');
  assert.deepEqual(active.paths, ['src/']);
  archivePlan(project, session, 'src/cloud.mjs');
  const runtimeDirectory = path.join(ctx, 'private/hook-runtime');
  const runtimePath = path.join(runtimeDirectory, (await fs.readdir(runtimeDirectory)).find(file => file.endsWith('.json')));
  const beforeFlush = await fs.readFile(runtimePath, 'utf8');
  finishPlan(project, session);
  // Model a process crash after remote completion but before the local receipt.
  await fs.writeFile(runtimePath, beforeFlush);
  finishPlan(project, session);
  const stopped = hook('Stop', project, session, { stop_hook_active: true });
  assert.deepEqual(stopped.json, {});
  const afterFinish = await syncStatus(project);
  assert.equal(afterFinish.works.find(item => item.sessionId === session).status, 'completed');
});

test('fixture cleanup stops the detached workbench before removing its directory', async t => {
  const project = await fixture();
  let pid = null;
  t.after(async () => {
    if (pid && processIsAlive(pid)) {
      try { process.kill(pid); } catch {}
      await waitForProcessExit(pid).catch(() => {});
    }
    await fs.rm(project, { recursive: true, force: true });
  });

  const port = await freePort();
  run(process.execPath, [workbenchCli, 'workbench', '--root', project, '--port', String(port)]);
  const state = JSON.parse(await fs.readFile(path.join(project, '.codex/context/private/workbench.json'), 'utf8'));
  pid = state.pid;
  assert.equal(processIsAlive(pid), true);

  await stopFixtureWorkbench(project, pid);
  pid = null;
  await fs.rm(project, { recursive: true });
  await assert.rejects(fs.access(project), { code: 'ENOENT' });
});

test('detached workbench exits when its project state is removed', async t => {
  const project = await fixture();
  let pid = null;
  t.after(async () => {
    if (pid && processIsAlive(pid)) {
      try { process.kill(pid); } catch {}
      await waitForProcessExit(pid).catch(() => {});
    }
    await fs.rm(project, { recursive: true, force: true });
  });

  const port = await freePort();
  run(process.execPath, [workbenchCli, 'workbench', '--root', project, '--port', String(port)]);
  const state = JSON.parse(await fs.readFile(path.join(project, '.codex/context/private/workbench.json'), 'utf8'));
  pid = state.pid;
  assert.equal(processIsAlive(pid), true);

  await fs.unlink(path.join(project, '.codex/context/private/workbench.json'));
  await waitForProcessExit(pid);
  pid = null;
  await fs.rm(project, { recursive: true, force: true });
});

test('permission, TODO, bad-case and durable cross-session inbox use the real Map', async t => {
  const project = await fixture();
  let workbenchPid = null;
  t.after(async () => {
    if (workbenchPid) await stopFixtureWorkbench(project, workbenchPid);
    await fs.rm(project, { recursive: true, force: true });
  });
  const session = 'hook-session-two';
  await confirmBinding(project, session);
  hook('SessionStart', project, session, { source: 'startup', is_background_agent: true });
  await installMap(project);

  // New bindings start with dynamic full access. Model a deliberate human
  // restriction before exercising the deny path.
  const ctx = path.join(project, '.codex/context');
  await fs.writeFile(path.join(ctx, 'sessions/workbench-access.json'), JSON.stringify({
    sessions: { [session]: { mode: 'explicit', nodes: [], version: null } },
  }));

  const denied = hook('PermissionRequest', project, session, {
    tool_name: 'apply_patch', tool_input: { path: path.join(project, 'src/index.mjs') },
  });
  assert.equal(denied.json.hookSpecificOutput.decision.behavior, 'deny');
  assert.match(denied.json.hookSpecificOutput.decision.message, /N1/);

  const port = await freePort();
  run(process.execPath, [workbenchCli, 'workbench', '--root', project, '--port', String(port)]);
  const archiveDenied = spawnSync(python, [contextScript, 'archive-session', '--root', project, '--session', session,
    '--summary', '未授权归档', '--files', 'src/index.mjs'], { cwd: project, encoding: 'utf8', windowsHide: true });
  assert.notEqual(archiveDenied.status, 0);
  assert.match(archiveDenied.stderr, /archive-session failed/);
  assert.doesNotMatch(archiveDenied.stderr, /Traceback/);

  const initialState = JSON.parse(await fs.readFile(path.join(ctx, 'private/workbench.json'), 'utf8'));
  workbenchPid = initialState.pid;
  const initialBootstrap = await fetch(new URL('/__context_guard/bootstrap', initialState.url)).then(response => response.json());
  const initialGrant = await fetch(new URL('/api/access', initialState.url), {
    method: 'POST', headers: { Authorization: `Bearer ${initialBootstrap.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: session, nodes: ['N1'] }),
  });
  assert.equal(initialGrant.status, 200);
  run(process.execPath, [workbenchCli, 'map', 'inbox', '--root', project, '--session', session, '--start']);

  const prompt = hook('UserPromptSubmit', project, session, { turn_id: 'todo-turn', prompt: '后续开发通知模块' });
  const signalId = prompt.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)?.[1];
  assert.ok(signalId);
  const args = [contextScript, 'record-todo', '--root', project, '--session', session, '--signal', signalId, '--node', 'N1', '--title', '开发通知模块', '--description', '实现通知入口'];
  run(python, args);
  run(python, args);
  let map = JSON.parse(await fs.readFile(path.join(ctx, 'map.json'), 'utf8'));
  assert.equal(map.root.children[0].todos.length, 1);
  assert.equal(map.root.children[0].todos[0].target_session, session);
  assert.equal(map.root.children[0].todos[0].source_signal, signalId);
  assert.ok(map.root.children[0].todos[0].created_at);

  const badPrompt = hook('UserPromptSubmit', project, session, { turn_id: 'bad-turn', prompt: '刚才保存失败，必须记录坏例' });
  const badSignal = badPrompt.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)?.[1];
  assert.ok(badSignal);
  run(python, [contextScript, 'record-bad-case', '--root', project, '--session', session, '--signal', badSignal,
    '--node', 'N1', '--title', '保存失败', '--phenomenon', '提交未保存', '--trigger', '提交工作台',
    '--cause', '待确认', '--guard', '生命周期回归测试']);
  run(python, [contextScript, 'record-bad-case', '--root', project, '--session', session, '--signal', badSignal,
    '--node', 'N1', '--title', '保存失败', '--phenomenon', '提交未保存']);
  map = JSON.parse(await fs.readFile(path.join(ctx, 'map.json'), 'utf8'));
  assert.equal(map.root.children[0].bugs.length, 1);
  assert.equal(map.root.children[0].bugs[0].sessions[0], session);
  const badEvents = JSON.parse(await fs.readFile(path.join(ctx, 'bad-case-events.json'), 'utf8'));
  assert.equal(badEvents[0].signal_id, badSignal);

  const crashPrompt = hook('UserPromptSubmit', project, session, { turn_id: 'bad-crash-turn', prompt: '保存过程崩溃也必须恢复坏例' });
  const crashSignal = crashPrompt.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)?.[1];
  const crashArgs = [contextScript, 'record-bad-case', '--root', project, '--session', session, '--signal', crashSignal,
    '--node', 'N1', '--title', '坏例事务中断', '--phenomenon', '写到一半退出', '--trigger', '进程崩溃'];
  const crashedOccurrence = spawnSync(python, crashArgs, {
    cwd: project, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, CONTEXT_GUARD_TESTING: '1', CONTEXT_GUARD_BAD_CASE_FAILPOINT: 'after-map' },
  });
  assert.equal(crashedOccurrence.status, 91);
  run(python, crashArgs);
  const transactionDir = path.join(ctx, 'private/bad-case-transactions');
  assert.deepEqual(await fs.readdir(transactionDir), []);
  map = JSON.parse(await fs.readFile(path.join(ctx, 'map.json'), 'utf8'));
  const recovered = map.root.children[0].bugs.find(item => item.title === '坏例事务中断');
  assert.ok(recovered);
  let recoveredEvents = JSON.parse(await fs.readFile(path.join(ctx, 'bad-case-events.json'), 'utf8'));
  assert.equal(recoveredEvents.filter(item => item.case === recovered.id && item.event === 'occurrence').length, 1);
  const recoveredRuntime = JSON.parse(await fs.readFile(path.join(ctx, 'private/hook-runtime', `${createHash('sha256').update(session).digest('hex')}.json`), 'utf8'));
  assert.equal(recoveredRuntime.signals.find(item => item.id === crashSignal).status, 'resolved');

  const fixArgs = [contextScript, 'record-bad-case-fix', '--root', project, '--session', session, '--case', recovered.id,
    '--method', '重放持久事务', '--evidence', '崩溃测试通过', '--status', 'resolved'];
  const crashedFix = spawnSync(python, fixArgs, {
    cwd: project, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, CONTEXT_GUARD_TESTING: '1', CONTEXT_GUARD_BAD_CASE_FAILPOINT: 'after-map' },
  });
  assert.equal(crashedFix.status, 91);
  run(python, fixArgs);
  assert.deepEqual(await fs.readdir(transactionDir), []);
  map = JSON.parse(await fs.readFile(path.join(ctx, 'map.json'), 'utf8'));
  assert.equal(map.root.children[0].bugs.find(item => item.id === recovered.id).status, 'resolved');
  recoveredEvents = JSON.parse(await fs.readFile(path.join(ctx, 'bad-case-events.json'), 'utf8'));
  assert.equal(recoveredEvents.filter(item => item.case === recovered.id && item.event === 'fix').length, 1);

  const beforeConflict = await fs.readFile(path.join(ctx, 'map.json'), 'utf8');
  assert.throws(() => run('python3', [contextScript, 'record-todo', '--root', project, '--session', session,
    '--signal', badSignal, '--node', 'N1', '--title', 'must not write']), /already resolved as bad-case/);
  assert.equal(await fs.readFile(path.join(ctx, 'map.json'), 'utf8'), beforeConflict, 'classification conflict must fail before any Map write');

  const mixed = hook('UserPromptSubmit', project, session, { turn_id: 'mixed', prompt: '修复显示；以后加快捷键；保存失败记坏例' });
  const mixedId = mixed.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)[1];
  const splitArgs = [contextScript, 'split-signal', '--root', project, '--session', session, '--signal', mixedId, '--input', '-'];
  const splitInput = JSON.stringify({ items: ['修复显示', '以后加快捷键', '保存失败'] });
  const children = JSON.parse(run('python3', splitArgs, { input: splitInput }).stdout);
  assert.deepEqual(JSON.parse(run('python3', splitArgs, { input: splitInput }).stdout), children);
  const cursorBlocked = hook('Stop', project, session, { platform: 'cursor' });
  assert.equal(cursorBlocked.json.decision, 'block');
  assert.equal(cursorBlocked.json.reason, 'Context Guard is finishing the current task. No user action is required.');
  assert.doesNotMatch(cursorBlocked.stdout, /SIG-|Classify pending|plan-[a-f0-9]+|plan-finish/);
  const deferred = hook('Stop', project, session);
  assert.deepEqual(deferred.json, {});
  assert.doesNotMatch(deferred.stdout, /SIG-|Classify pending/);
  const reminded = hook('UserPromptSubmit', project, session, { turn_id: 'mixed-reminder', prompt: '继续处理当前任务' });
  for (const child of children) assert.match(reminded.json.hookSpecificOutput.additionalContext, new RegExp(child.id));
  const reminderId = reminded.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)[1];
  run('python3', [contextScript, 'resolve-signal', '--root', project, '--session', session, '--signal', reminderId, '--kind', 'task']);
  run('python3', [contextScript, 'resolve-signal', '--root', project, '--session', session, '--signal', children[0].id, '--kind', 'task']);
  run('python3', [contextScript, 'record-todo', '--root', project, '--session', session, '--signal', children[1].id, '--node', 'N1', '--title', '快捷键']);
  run('python3', [contextScript, 'record-bad-case', '--root', project, '--session', session, '--signal', children[2].id, '--node', 'N1', '--title', '保存失败', '--phenomenon', '提交失败']);
  assert.deepEqual(hook('Stop', project, session).json, {});

  const otherSession = 'hook-session-other';
  await confirmBinding(project, otherSession);
  hook('SessionStart', project, otherSession, { source: 'startup', is_background_agent: true });
  run(process.execPath, [workbenchCli, 'workbench', '--root', project, '--session', otherSession]);
  const workbenchState = JSON.parse(await fs.readFile(path.join(ctx, 'private/workbench.json'), 'utf8'));
  const bootstrap = await fetch(new URL('/__context_guard/bootstrap', workbenchState.url)).then(response => response.json());
  const grant = await fetch(new URL('/api/access', workbenchState.url), {
    method: 'POST', headers: { Authorization: `Bearer ${bootstrap.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: otherSession, nodes: ['N1'] }),
  });
  assert.equal(grant.status, 200);
  const otherPrompt = hook('UserPromptSubmit', project, otherSession, { turn_id: 'other-turn', prompt: '增加另一个会话的待办' });
  const otherSignal = otherPrompt.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)?.[1];
  run(python, [contextScript, 'record-todo', '--root', project, '--session', otherSession, '--signal', otherSignal,
    '--node', 'N1', '--title', '跨会话待办', '--description', '用于 inbox 测试']);
  const received = hook('PostCompact', project, session, { trigger: 'manual' });
  map = JSON.parse(await fs.readFile(path.join(ctx, 'map.json'), 'utf8'));
  assert.equal(map.root.children[0].todos.find(item => item.title === '跨会话待办')?.target_session, otherSession);
  assert.match(received.json.hookSpecificOutput.additionalContext, /Pending Map inbox receipt/);
  assert.match(received.json.hookSpecificOutput.additionalContext, /hook-session-other/);

  const allowed = hook('PermissionRequest', project, session, {
    tool_name: 'apply_patch', tool_input: { path: path.join(project, 'src/allowed.mjs') },
  });
  assert.equal(allowed.json.hookSpecificOutput, undefined);
  assert.match(allowed.json.systemMessage, /normal permission prompt/);

  const directTodo = hook('PreToolUse', project, session, {
    tool_name: 'apply_patch', tool_use_id: 'direct-todo',
    tool_input: { command: `*** Update File: ${path.join(project, 'TODO.md')}` },
  });
  assert.equal(directTodo.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(directTodo.json.hookSpecificOutput.permissionDecisionReason, /human-owned/);

  const directMap = hook('PreToolUse', project, session, {
    tool_name: 'Bash', tool_use_id: 'direct-map',
    tool_input: { command: `sed -i '' test ${path.join(project, '.codex/context/map.json')}` },
  });
  assert.equal(directMap.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(directMap.json.hookSpecificOutput.permissionDecisionReason, /map\.json/);

  const directMapWrite = hook('PreToolUse', project, session, {
    tool_name: 'Write', tool_use_id: 'direct-map-write',
    tool_input: { path: path.join(project, '.codex/context/map.json'), content: '{}' },
  });
  assert.equal(directMapWrite.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('completion receipts require evidence, scope review, all files and fresh content', async t => {
  const project = await fixture(), session = 'receipt-session';
  t.after(() => dispose(project));
  await confirmBinding(project, session);
  hook('SessionStart', project, session, { is_background_agent: true });
  await installMap(project);
  await fs.writeFile(path.join(project, 'src/dirty.txt'), 'already dirty');
  await startPlan(t, project, session);
  assert.throws(() => archivePlan(project, session, '', { verification: '' }), /verification evidence/);
  assert.throws(() => archivePlan(project, session, '', { assessment: {} }), /assessment/);
  const script = hook('PreToolUse', project, session, { tool_name: 'exec_command', tool_input: { cmd: 'python3 fix.py' } });
  assert.match(script.json.hookSpecificOutput.additionalContext, /scope unknown/);
  const outside = hook('PreToolUse', project, session, { tool_name: 'apply_patch', tool_input: '*** Add File: outside.txt\n+x' });
  assert.equal(outside.json.hookSpecificOutput.permissionDecision, 'deny');
  await fs.writeFile(path.join(project, 'src/dirty.txt'), 'modified again');
  hook('PostToolUse', project, session, { tool_name: 'exec_command', tool_input: { cmd: 'python3 fix.py' }, tool_response: { exit_code: 1 } });
  assert.throws(() => finishPlan(project, session), /Archive this plan/);
  assert.throws(() => archivePlan(project, session, 'src/dirty.txt'), /scope_review/);
  assert.throws(() => archivePlan(project, session, 'src/dirty.txt', { scope_review: 'checked src only' }), /failure_review/);
  assert.throws(() => archivePlan(project, session, '', { scope_review: 'checked', failure_review: 'retested' }), /omitted changed files/);
  archivePlan(project, session, 'src/dirty.txt', { scope_review: 'git diff verified src only', failure_review: 'fixed script; output verified' });
  await fs.writeFile(path.join(project, 'src/dirty.txt'), 'after receipt');
  assert.throws(() => finishPlan(project, session), /changed after archive/);
  archivePlan(project, session, 'src/dirty.txt', { scope_review: 'git diff verified src only', failure_review: 'fixed script; output verified' });
  finishPlan(project, session);
  const state = JSON.parse(run('python3', [contextScript, 'plan-status', '--root', project, '--session', session]).stdout);
  assert.equal(state.active_plan, null);
  assert.equal(state.last_plan.status, 'completed');
  assert.ok(state.last_plan.started_at && state.last_plan.completed_at && state.last_plan.archive.at);
  const map = JSON.parse(await fs.readFile(path.join(project, '.codex/context/map.json'), 'utf8'));
  assert.equal(map.root.children.length, 1, 'completion must not create a summary node');
  const memory = map.root.children[0].memories.at(-1);
  assert.equal(memory.assessment.decision, 'reuse');
  assert.ok(memory.plan_id && memory.verification && memory.recorded_at);
});

test('unclassified plan files fail before any Map write; explicit support assignments recover', async t => {
  const project = await fixture(), session = 'classification-session';
  t.after(() => dispose(project));
  await confirmBinding(project, session);
  hook('SessionStart', project, session, { is_background_agent: true });
  await installMap(project);
  await startPlan(t, project, session, ['src/', 'notes.md']);
  await fs.writeFile(path.join(project, 'src/a.txt'), 'implementation');
  await fs.writeFile(path.join(project, 'notes.md'), 'support notes');
  const mapFile = path.join(project, '.codex/context/map.json');
  const before = await fs.readFile(mapFile, 'utf8');
  assert.throws(() => archivePlan(project, session, 'src/a.txt,notes.md'), /unclassified files/);
  assert.equal(await fs.readFile(mapFile, 'utf8'), before);
  archivePlan(project, session, 'src/a.txt,notes.md', { assignments: [{ nodeId: 'N1', files: ['notes.md'], reason: 'Runtime support documentation' }] });
  finishPlan(project, session);
});

test('unresolved signals survive retention; empty or broken interfaces fail visibly', async () => {
  const result = run('python3', ['-c', `
import sys, json, tempfile
from pathlib import Path
from unittest.mock import patch
from subprocess import CompletedProcess
sys.path.insert(0, ${JSON.stringify(path.join(repository, 'scripts'))})
import context_guard as core
import context_guard_hook as hook
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    for n in range(110): core.add_prompt_signal(root, 's', str(n), 'request ' + str(n))
    assert len(hook.pending_signals(core.read_hook_runtime(root, 's'))) == 110
    ctx = core.context_dir(root)
    (ctx / 'private/workbench.json').parent.mkdir(parents=True, exist_ok=True)
    (ctx / 'private/workbench.json').write_text('{}')
    with patch.object(hook.subprocess, 'run', return_value=CompletedProcess([], 0, '', '')):
        assert hook.map_inbox(root, ctx, 's')['error']['code'] == 'INBOX_READ_FAILED'
        assert hook.sync_command(root, 'checkpoint')['error']['code'] == 'SYNC_TOOL_FAILED'
    with patch.object(hook, 'sync_command', return_value={'error': {'code': 'OFFLINE'}}):
        try: hook.checked_sync(root, 's', 'finish')
        except ValueError: pass
        else: raise AssertionError('failed sync accepted')
    with patch.object(hook, 'sync_command', return_value={'status': 'conflict'}):
        try: hook.checked_sync(root, 's', 'checkpoint')
        except ValueError: pass
        else: raise AssertionError('conflict accepted')
    assert hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'touch x'}})
    assert hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':'python3 fix.py'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'git status --short'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'sed -n "1,20p" RULE.md && rg -n hook scripts | head -5'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'context-guard workbench --diagnose --root .'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'context-guard workbench --root . --session session-1'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'printf %s JSON | context-guard plan-start --input -'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'printf %s JSON | node /tmp/context-guard-skill.js plan-start --input -'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'printf %s JSON | python3 /tmp/context_guard.py plan-start --input -'}})
    assert hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'python3 payload.py | context-guard plan-start --input -'}})
    assert hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'rg --pre ./writer pattern .'}})
    assert hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'find . -delete'}})
    assert hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'git diff --output=leak.patch'}})
    assert hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'curl --data x http://127.0.0.1/'}})
    assert hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'rm context-guard plan-start'}})
    assert hook.tool_paths({'tool_name':'apply_patch','tool_input':'*** Update File: src/a\\n*** Move to: src/b'}, root) == ['src/a', 'src/b']
print('verified')
`]);
  assert.match(result.stdout, /verified/);
});

test('CLI entrypoints work through filesystem aliases, including Windows path casing', async t => {
  const project = await fixture();
  t.after(() => dispose(project));
  for (const file of [workbenchCli, path.join(repository, 'scripts/sync/client.mjs')]) {
    let alias;
    if (process.platform === 'win32') {
      // Windows resolves directory components case-insensitively, but Node's
      // ESM loader still classifies the final extension textually. Keep `.mjs`
      // intact so this exercises path casing instead of an unrelated loader rule.
      alias = path.join(path.dirname(file).toUpperCase(), path.basename(file));
    }
    else {
      alias = path.join(project, `${path.basename(path.dirname(file))}-alias.mjs`);
      await fs.symlink(file, alias);
    }
    const probe = spawnSync(process.execPath, [alias, '--invalid-command'], { encoding: 'utf8', windowsHide: true });
    assert.notEqual(probe.status, 0);
    assert.ok(JSON.parse(probe.stdout).error, 'an invoked CLI must not silently exit without JSON');
  }
});
