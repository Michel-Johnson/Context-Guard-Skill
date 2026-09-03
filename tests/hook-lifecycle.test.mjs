import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
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
    env: { ...process.env, CONTEXT_GUARD_DISABLE_WORKBENCH: '1', CONTEXT_GUARD_HEADLESS: '1', ...options.env },
    timeout: options.timeout || 30_000,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}

function hook(event, project, sessionId, extra = {}) {
  const payload = {
    session_id: sessionId,
    cwd: project,
    hook_event_name: event,
    turn_id: extra.turn_id || 'turn-one',
    ...extra,
  };
  const result = run(python, [hookScript, event.replaceAll(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, ''), '--platform', 'codex'], {
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
  t.after(() => fs.rm(project, { recursive: true, force: true }));
  const session = 'hook-session-one';
  await confirmBinding(project, session);

  const started = hook('SessionStart', project, session, { source: 'startup', is_background_agent: true });
  assert.match(started.json.hookSpecificOutput.additionalContext, /Context Guard Map snapshot/);

  const prompted = hook('UserPromptSubmit', project, session, { prompt: '完成 Hook 生命周期开发' });
  const signalId = prompted.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)?.[1];
  assert.ok(signalId);
  run(python, [contextScript, 'resolve-signal', '--root', project, '--session', session, '--signal', signalId, '--kind', 'task']);

  const prepared = hook('PreToolUse', project, session, {
    tool_name: 'apply_patch', tool_use_id: 'tool-one',
    tool_input: { command: `*** Update File: ${path.join(project, 'scratch.txt')}` },
  });
  assert.match(prepared.json.hookSpecificOutput.additionalContext, /plan-/);
  await fs.writeFile(path.join(project, 'scratch.txt'), 'changed\n');
  hook('PostToolUse', project, session, {
    tool_name: 'apply_patch', tool_use_id: 'tool-one', tool_input: { path: path.join(project, 'scratch.txt') },
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
  const stopped = hook('Stop', project, session, { stop_hook_active: false });
  assert.match(stopped.json.systemMessage, /lifecycle completed/);

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
    await fs.rm(project, { recursive: true, force: true });
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

  const prepared = hook('PreToolUse', project, session, {
    tool_name: 'Write', tool_use_id: 'cloud-write', tool_input: { path: path.join(project, 'src/cloud.mjs'), content: 'ok' },
  });
  assert.match(prepared.json.hookSpecificOutput.additionalContext, /cloud prepare ran once/);
  await fs.writeFile(path.join(project, 'src/cloud.mjs'), 'ok\n');
  hook('PostToolUse', project, session, {
    tool_name: 'Write', tool_use_id: 'cloud-write', tool_input: { path: path.join(project, 'src/cloud.mjs') },
  });
  const blocked = hook('Stop', project, session, { stop_hook_active: false });
  assert.equal(blocked.json.decision, 'block');
  assert.match(blocked.json.reason, /sync finish/);
  const beforeFinish = await syncStatus(project);
  const active = beforeFinish.works.find(item => item.sessionId === session);
  assert.equal(active.status, 'working');
  assert.ok(active.paths.includes('src/cloud.mjs'));
  await finishSync({ root: project, sessionId: session });
  const stopped = hook('Stop', project, session, { stop_hook_active: true });
  assert.match(stopped.json.systemMessage, /lifecycle completed/);
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

test('permission, TODO, bad-case and durable cross-session inbox use the real Map', async t => {
  const project = await fixture();
  let workbenchPid = null;
  t.after(async () => {
    try {
      if (workbenchPid) await stopFixtureWorkbench(project, workbenchPid);
    } finally {
      await fs.rm(project, { recursive: true, force: true });
    }
  });
  const session = 'hook-session-two';
  await confirmBinding(project, session);
  hook('SessionStart', project, session, { source: 'startup', is_background_agent: true });
  await installMap(project);

  const denied = hook('PermissionRequest', project, session, {
    tool_name: 'apply_patch', tool_input: { path: path.join(project, 'src/index.mjs') },
  });
  assert.equal(denied.json.hookSpecificOutput.decision.behavior, 'deny');
  assert.match(denied.json.hookSpecificOutput.decision.message, /N1/);

  const ctx = path.join(project, '.codex/context');
  const port = await freePort();
  run(process.execPath, [workbenchCli, 'workbench', '--root', project, '--port', String(port)]);
  const archiveDenied = spawnSync(python, [contextScript, 'archive-session', '--root', project, '--session', session,
    '--summary', '未授权归档', '--files', 'src/index.mjs'], { cwd: project, encoding: 'utf8' });
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
  if (process.platform !== 'win32') {
    assert.match(received.json.hookSpecificOutput.additionalContext, /Pending Map inbox receipt/);
    assert.match(received.json.hookSpecificOutput.additionalContext, /hook-session-other/);
  }

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
