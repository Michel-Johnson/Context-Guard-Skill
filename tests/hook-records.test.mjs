import '../.github/scripts/test-environment.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { resolveProject, saveMainBinding, sessionBinding } from '../scripts/workbench/project.mjs';
import { diagnoseWorkbench } from '../scripts/workbench/cli.mjs';
import { contextScript, workbenchCli, python, run, hook, fixture, confirmBinding, freePort, processIsAlive, stopFixtureWorkbench, installMap } from './hook-test-helpers.mjs';

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
  const deferredStatus = spawnSync(python, [contextScript, 'record-bad-case', '--root', project, '--session', session,
    '--title', '延期', '--phenomenon', '不得延期', '--status', 'deferred'], { cwd: project, encoding: 'utf8', windowsHide: true });
  assert.notEqual(deferredStatus.status, 0);
  assert.match(deferredStatus.stderr, /deferred|unfixable|invalid choice/i);

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

  const unassignedOutput = run(python, [contextScript, 'record-bad-case', '--root', project, '--session', session,
    '--title', '未挂载的坏例', '--phenomenon', '仅保存私有坏例']).stdout;
  const unassignedId = unassignedOutput.match(/recorded bad case: (B\d+)/)?.[1];
  assert.ok(unassignedId);
  const unassignedFix = [contextScript, 'record-bad-case-fix', '--root', project, '--session', session,
    '--case', unassignedId, '--method', '保留未挂载记录', '--evidence', '未创建 Map 附件', '--status', 'fixed'];
  const interruptedUnassignedFix = spawnSync(python, unassignedFix, {
    cwd: project, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, CONTEXT_GUARD_TESTING: '1', CONTEXT_GUARD_BAD_CASE_FAILPOINT: 'after-map' },
  });
  assert.equal(interruptedUnassignedFix.status, 91);
  run(python, [contextScript, 'record-bad-case', '--root', project, '--session', session,
    '--title', '后续坏例', '--phenomenon', '旧事务不应阻塞新登记']);
  assert.deepEqual(await fs.readdir(transactionDir), []);
  map = JSON.parse(await fs.readFile(path.join(ctx, 'map.json'), 'utf8'));
  assert.equal(map.root.children[0].bugs.some(item => item.id === unassignedId), false);
  recoveredEvents = JSON.parse(await fs.readFile(path.join(ctx, 'bad-case-events.json'), 'utf8'));
  assert.equal(recoveredEvents.filter(item => item.case === unassignedId && item.event === 'fix').length, 1);

  const beforeConflict = await fs.readFile(path.join(ctx, 'map.json'), 'utf8');
  assert.throws(() => run(python, [contextScript, 'record-todo', '--root', project, '--session', session,
    '--signal', badSignal, '--node', 'N1', '--title', 'must not write']), /already resolved as bad-case/);
  assert.equal(await fs.readFile(path.join(ctx, 'map.json'), 'utf8'), beforeConflict, 'classification conflict must fail before any Map write');

  const mixed = hook('UserPromptSubmit', project, session, { turn_id: 'mixed', prompt: '修复显示；以后加快捷键；保存失败记坏例' });
  const mixedId = mixed.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)[1];
  const splitArgs = [contextScript, 'split-signal', '--root', project, '--session', session, '--signal', mixedId, '--input', '-'];
  const splitInput = JSON.stringify({ items: ['修复显示', '以后加快捷键', '保存失败'] });
  const children = JSON.parse(run(python, splitArgs, { input: splitInput }).stdout);
  assert.deepEqual(JSON.parse(run(python, splitArgs, { input: splitInput }).stdout), children);
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
  run(python, [contextScript, 'resolve-signal', '--root', project, '--session', session, '--signal', reminderId, '--kind', 'task']);
  run(python, [contextScript, 'resolve-signal', '--root', project, '--session', session, '--signal', children[0].id, '--kind', 'task']);
  run(python, [contextScript, 'record-todo', '--root', project, '--session', session, '--signal', children[1].id, '--node', 'N1', '--title', '快捷键']);
  run(python, [contextScript, 'record-bad-case', '--root', project, '--session', session, '--signal', children[2].id, '--node', 'N1', '--title', '保存失败', '--phenomenon', '提交失败']);
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
  assert.deepEqual(allowed.json, {});

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

test('top-level record-todo and record-bad-case use Session Map nodes missing from disk map.json', async t => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-session-map-'));
  let workbenchPid = null;
  t.after(async () => {
    if (workbenchPid) await stopFixtureWorkbench(project, workbenchPid);
    else {
      spawnSync(process.execPath, [workbenchCli, 'workbench', '--root', project, '--stop'], {
        encoding: 'utf8', timeout: 15_000, windowsHide: true,
      });
    }
    await fs.rm(project, { recursive: true, force: true, maxRetries: 3 });
  });
  execFileSync('git', ['init', '-b', 'trunk'], { cwd: project, stdio: 'pipe', windowsHide: true });
  execFileSync('git', [
    '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null',
    'commit', '--allow-empty', '-m', 'fixture',
  ], { cwd: project, stdio: 'pipe', windowsHide: true });
  run(python, [contextScript, 'init', '--root', project]);
  await saveMainBinding(project, { mode: 'local', branch: 'trunk' });
  const session = 'session-map-todo';
  await confirmBinding(project, session);
  hook('SessionStart', project, session, { source: 'startup', is_background_agent: true });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src/export.md'), '# export\n');

  const port = await freePort();
  run(process.execPath, [workbenchCli, 'workbench', '--root', project, '--session', session, '--port', String(port)]);
  const resolved = await resolveProject(project);
  const state = JSON.parse(await fs.readFile(path.join(resolved.sharedDir, 'workbench.json'), 'utf8'));
  workbenchPid = state.pid;

  const snapshot = JSON.parse(run(process.execPath, [workbenchCli, 'map', 'read', '--root', project, '--session', session]).stdout);
  run(process.execPath, [workbenchCli, 'map', 'apply', '--root', project, '--session', session], {
    input: JSON.stringify({
      operationId: 'propose-M3-export',
      baseVersion: snapshot.version,
      operations: [{
        type: 'create',
        parentId: 'T0',
        node: {
          id: 'M3',
          title: 'Export',
          kind: 'work',
          purpose: 'Own markdown export',
          owns: ['src/export.md'],
          memories: [{
            text: 'Adds markdown export',
            paths: ['src/export.md'],
            proposalEvidence: {
              parentId: 'T0',
              basis: 'new-module',
              reason: 'Adds a separate export boundary and entry point',
              files: ['src/export.md'],
            },
          }],
        },
      }],
    }),
  });
  const diskMap = JSON.parse(await fs.readFile(path.join(project, '.codex/context/map.json'), 'utf8'));
  assert.deepEqual(diskMap.root.children, []);
  assert.equal(diskMap.bootstrap, 'pending');
  const sessionNode = JSON.parse(run(process.execPath, [
    workbenchCli, 'map', 'read', '--root', project, '--session', session, '--node', 'M3',
  ]).stdout);
  assert.equal(sessionNode.node.id, 'M3');

  const prompt = hook('UserPromptSubmit', project, session, { turn_id: 'todo-turn', prompt: '支持导出 markdown' });
  const signalId = prompt.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)?.[1];
  assert.ok(signalId);
  run(python, [
    contextScript, 'record-todo', '--root', project, '--session', session, '--signal', signalId,
    '--node', 'M3', '--title', '支持导出 markdown', '--description', '从 Session Map 节点写入',
  ]);
  const recorded = JSON.parse(run(process.execPath, [
    workbenchCli, 'map', 'read', '--root', project, '--session', session, '--node', 'M3',
  ]).stdout);
  assert.equal(recorded.node.todos.length, 1);
  assert.equal(recorded.node.todos[0].title, '支持导出 markdown');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(project, '.codex/context/map.json'), 'utf8')).root.children, []);

  const badPrompt = hook('UserPromptSubmit', project, session, { turn_id: 'bad-turn', prompt: '导出失败必须记坏例' });
  const badSignal = badPrompt.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)?.[1];
  run(python, [
    contextScript, 'record-bad-case', '--root', project, '--session', session, '--signal', badSignal,
    '--node', 'M3', '--title', '导出失败', '--phenomenon', '无法写出 markdown',
  ]);
  const withBug = JSON.parse(run(process.execPath, [
    workbenchCli, 'map', 'read', '--root', project, '--session', session, '--node', 'M3',
  ]).stdout);
  assert.equal(withBug.node.bugs.length, 1);

  const missing = spawnSync(python, [
    contextScript, 'record-todo', '--root', project, '--session', session,
    '--signal', signalId, '--node', 'MISSING', '--title', 'must fail',
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /unknown map node: MISSING/);
});

test('accept-layer accepted Session Map nodes validate without disk map.json or workbench server', async t => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-accept-layer-'));
  let workbenchPid = null;
  t.after(async () => {
    if (workbenchPid) await stopFixtureWorkbench(project, workbenchPid);
    else {
      spawnSync(process.execPath, [workbenchCli, 'workbench', '--root', project, '--stop'], {
        encoding: 'utf8', timeout: 15_000, windowsHide: true,
      });
    }
    await fs.rm(project, { recursive: true, force: true, maxRetries: 3 });
  });
  execFileSync('git', ['init', '-b', 'trunk'], { cwd: project, stdio: 'pipe', windowsHide: true });
  execFileSync('git', [
    '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null',
    'commit', '--allow-empty', '-m', 'fixture',
  ], { cwd: project, stdio: 'pipe', windowsHide: true });
  run(python, [contextScript, 'init', '--root', project]);
  await saveMainBinding(project, { mode: 'local', branch: 'trunk' });
  const session = 'accept-layer-session';
  await confirmBinding(project, session);
  hook('SessionStart', project, session, { source: 'startup', is_background_agent: true });
  await fs.mkdir(path.join(project, 'src/m1'), { recursive: true });
  await fs.writeFile(path.join(project, 'src/m1/index.js'), 'export {};\n');

  const port = await freePort();
  run(process.execPath, [workbenchCli, 'workbench', '--root', project, '--session', session, '--port', String(port)]);
  const resolved = await resolveProject(project);
  const workbenchState = JSON.parse(await fs.readFile(path.join(resolved.sharedDir, 'workbench.json'), 'utf8'));
  workbenchPid = workbenchState.pid;
  const binding = await sessionBinding(resolved, session);
  const sessionMapFile = path.join(
    resolved.sharedDir,
    'session-memory',
    createHash('sha256').update(`${session}\0${binding.worktreeId}`).digest('hex'),
    'map.json',
  );
  const mainMapFile = path.join(resolved.sharedDir, 'main', 'map.json');

  let snapshot = JSON.parse(run(process.execPath, [workbenchCli, 'map', 'read', '--root', project, '--session', session]).stdout);
  run(process.execPath, [workbenchCli, 'map', 'apply', '--root', project, '--session', session], {
    input: JSON.stringify({
      operationId: 'propose-M1-layer',
      baseVersion: snapshot.version,
      operations: [{
        type: 'create',
        parentId: 'T0',
        node: {
          id: 'M1',
          title: 'First layer module',
          kind: 'module',
          purpose: 'Own the first accepted layer',
          owns: ['src/m1/'],
          memories: [{
            text: 'Bootstrap first layer',
            paths: ['src/m1/index.js'],
            proposalEvidence: {
              parentId: 'T0',
              basis: 'new-module',
              reason: 'First layer bootstrap module',
              files: ['src/m1/index.js'],
            },
          }],
        },
      }],
    }),
  });

  snapshot = JSON.parse(run(process.execPath, [workbenchCli, 'map', 'read', '--root', project, '--session', session]).stdout);
  assert.equal(snapshot.doc.root.children.find(node => node.id === 'M1')?.proposal, 'proposed');
  const bootstrap = await fetch(new URL('/__context_guard/bootstrap', workbenchState.url)).then(response => response.json());
  const accept = await fetch(new URL(`/api/commit?view=session:${encodeURIComponent(session)}`, workbenchState.url), {
    method: 'POST',
    headers: { Authorization: `Bearer ${bootstrap.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operationId: `accept-layer-${randomUUID()}`,
      baseVersion: snapshot.version,
      operations: [{ type: 'update', id: 'M1', fields: { proposal: 'accepted' } }],
    }),
  });
  assert.equal(accept.status, 200, await accept.text());
  const accepted = JSON.parse(await fs.readFile(sessionMapFile, 'utf8'));
  assert.equal(accepted.root.children.find(node => node.id === 'M1')?.proposal, 'accepted');
  assert.equal(accepted.bootstrap, 'ready');
  const diskMap = JSON.parse(await fs.readFile(path.join(project, '.codex/context/map.json'), 'utf8'));
  assert.deepEqual(diskMap.root.children, []);
  assert.equal(diskMap.bootstrap, 'pending');
  const mainMap = JSON.parse(await fs.readFile(mainMapFile, 'utf8'));
  assert.deepEqual(mainMap.root?.children || [], []);

  run(process.execPath, [workbenchCli, 'workbench', '--root', project, '--stop']);
  workbenchPid = null;

  const prompt = hook('UserPromptSubmit', project, session, { turn_id: 'accept-layer-turn', prompt: '实现 M1 入口' });
  const signalId = prompt.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)?.[1];
  assert.ok(signalId);
  run(python, [
    contextScript, 'record-todo', '--root', project, '--session', session, '--signal', signalId,
    '--node', 'M1', '--title', '实现 M1 入口', '--description', 'accept-layer 后写入 Session Map',
  ]);
  run(process.execPath, [workbenchCli, 'workbench', '--root', project, '--session', session, '--port', String(port)]);
  const recorded = JSON.parse(run(process.execPath, [
    workbenchCli, 'map', 'read', '--root', project, '--session', session, '--node', 'M1',
  ]).stdout);
  assert.equal(recorded.node.todos.length, 1);
  assert.equal(recorded.node.todos[0].title, '实现 M1 入口');
});

test('record-todo upgrades a task-resolved bootstrap signal on empty-graph first sessions', async t => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-task-signal-todo-'));
  let workbenchPid = null, passed = false;
  t.after(async () => {
    let cleaned = false;
    try {
      if (workbenchPid) await stopFixtureWorkbench(project, workbenchPid);
      else {
        spawnSync(process.execPath, [workbenchCli, 'workbench', '--root', project, '--stop'], {
          encoding: 'utf8', timeout: 15_000, windowsHide: true,
        });
      }
      if (passed) { await fs.rm(project, { recursive: true, force: true, maxRetries: 3 }); cleaned = true; }
    } finally {
      if (!cleaned) t.diagnostic(JSON.stringify({ phase: 'empty-graph-fixture-retained', fixture: project, functionalPassed: passed }));
    }
  });
  execFileSync('git', ['init', '-b', 'trunk'], { cwd: project, stdio: 'pipe', windowsHide: true });
  execFileSync('git', [
    '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null',
    'commit', '--allow-empty', '-m', 'fixture',
  ], { cwd: project, stdio: 'pipe', windowsHide: true });
  run(python, [contextScript, 'init', '--root', project]);
  await saveMainBinding(project, { mode: 'local', branch: 'trunk' });
  const session = 'empty-graph-task-signal';
  await confirmBinding(project, session);
  hook('SessionStart', project, session, { source: 'startup', is_background_agent: true });
  await fs.mkdir(path.join(project, 'src/m1'), { recursive: true });
  await fs.writeFile(path.join(project, 'src/m1/export.md'), '# export\n');

  const port = await freePort();
  run(process.execPath, [workbenchCli, 'workbench', '--root', project, '--session', session, '--port', String(port)]);
  const resolved = await resolveProject(project);
  const state = JSON.parse(await fs.readFile(path.join(resolved.sharedDir, 'workbench.json'), 'utf8'));
  workbenchPid = state.pid;

  let snapshot = JSON.parse(run(process.execPath, [workbenchCli, 'map', 'read', '--root', project, '--session', session]).stdout);
  run(process.execPath, [workbenchCli, 'map', 'apply', '--root', project, '--session', session], {
    input: JSON.stringify({
      operationId: 'propose-M1-export',
      baseVersion: snapshot.version,
      operations: [{
        type: 'create',
        parentId: 'T0',
        node: {
          id: 'M1',
          title: 'HTTP service and routing',
          kind: 'module',
          purpose: 'Own HTTP entry points',
          owns: ['src/m1/'],
          memories: [{
            text: 'Bootstrap first layer',
            paths: ['src/m1/export.md'],
            proposalEvidence: {
              parentId: 'T0',
              basis: 'new-module',
              reason: 'First layer bootstrap module',
              files: ['src/m1/export.md'],
            },
          }],
        },
      }],
    }),
  });

  const prompt = hook('UserPromptSubmit', project, session, {
    turn_id: 'idea-turn',
    prompt: '在 M1 上记录需求：支持导出 markdown，变成可执行 todo',
  });
  const context = prompt.json.hookSpecificOutput?.additionalContext;
  if (typeof context !== 'string' || !/User signal: (SIG-[a-f0-9]+)/.test(context)) {
    const text = typeof context === 'string' ? context : '';
    const durable = await fs.readFile(path.join(project, '.codex/context/private/hook-runtime',
      `${createHash('sha256').update(session).digest('hex')}.json`), 'utf8').then(JSON.parse).catch(() => null);
    const cachedSession = await fs.readFile(path.join(project, '.codex/context/private/hook-sessions.json'), 'utf8')
      .then(JSON.parse).catch(() => null);
    const saved = await fs.readFile(path.join(resolved.sharedDir, 'workbench.json'), 'utf8').then(JSON.parse).catch(() => null);
    const diagnosis = await diagnoseWorkbench(project, session).catch(() => null);
    const statuses = new Set(['ready', 'stopped', 'unknown', 'legacy', 'duplicate', 'upgrade-required', 'named-mismatch']);
    t.diagnostic(JSON.stringify({ phase: 'empty-graph-prompt-missing-signal', hookStatus: prompt.status,
      context: { present: typeof context === 'string', eventMatches: prompt.json.hookSpecificOutput?.hookEventName === 'UserPromptSubmit',
        userSignalMarker: text.includes('User signal:'), bindingUnreadable: text.includes('Context Guard binding unreadable'),
        automaticUnverified: text.includes('Context Guard automatic binding unverified'),
        keptBindingUnverified: text.includes('Context Guard kept the existing Session binding'),
        noEstablishedWorkbench: text.includes('no established workbench'), unbound: text.includes('not bound to the current worktree'),
        runtimeLegacy: text.includes('workbench runtime is legacy'), runtimeDuplicate: text.includes('workbench runtime is duplicate'),
        runtimeUnknown: text.includes('workbench runtime is unknown') },
      cachedSessionMatches: cachedSession?.codex === session,
      durable: { available: Boolean(durable), signalsCount: Array.isArray(durable?.signals) ? durable.signals.length : 0,
        ideaTurnPresent: Array.isArray(durable?.signals) && durable.signals.some(item => item.turn_id === 'idea-turn') },
      saved: { present: Boolean(saved), sameInstance: saved?.instance === state.instance, ownedPidAlive: processIsAlive(workbenchPid) },
      postFailureProbe: { laterThanHook: true, available: Boolean(diagnosis), bound: diagnosis?.session?.bound === true,
        verified: diagnosis?.session?.verified === true, sameRoot: diagnosis?.project?.root === await fs.realpath(project),
        runtimeStatus: statuses.has(diagnosis?.runtime?.status) ? diagnosis.runtime.status : 'unclassified' } }));
  }
  const signalId = prompt.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)?.[1];
  assert.ok(signalId);

  const blocked = hook('PreToolUse', project, session, {
    tool_name: 'apply_patch',
    tool_use_id: 'bootstrap-blocked',
    tool_input: { command: `*** Update File: ${path.join(project, 'src/m1/export.md')}` },
  });
  assert.equal(blocked.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(blocked.json.hookSpecificOutput.permissionDecisionReason, /Classify pending user signals/);
  assert.match(blocked.json.hookSpecificOutput.permissionDecisionReason, /resolve-signal --root/);
  assert.match(blocked.json.hookSpecificOutput.permissionDecisionReason, new RegExp(`--signal ${signalId} --kind task`));

  run(python, [contextScript, 'resolve-signal', '--root', project, '--session', session, '--signal', signalId, '--kind', 'task']);

  run(python, [
    contextScript, 'record-todo', '--root', project, '--session', session, '--signal', signalId,
    '--node', 'M1', '--title', '支持导出 markdown', '--description', '从用户需求写入可执行 todo',
  ]);
  run(python, [
    contextScript, 'record-todo', '--root', project, '--session', session, '--signal', signalId,
    '--node', 'M1', '--title', '支持导出 markdown', '--description', '从用户需求写入可执行 todo',
  ]);

  const recorded = JSON.parse(run(process.execPath, [
    workbenchCli, 'map', 'read', '--root', project, '--session', session, '--node', 'M1',
  ]).stdout);
  assert.equal(recorded.node.todos.length, 1);
  assert.equal(recorded.node.todos[0].title, '支持导出 markdown');
  assert.equal(recorded.node.todos[0].source_signal, signalId);
  assert.equal(recorded.node.todos[0].target_session, session);

  const runtime = JSON.parse(await fs.readFile(
    path.join(project, '.codex/context/private/hook-runtime', `${createHash('sha256').update(session).digest('hex')}.json`),
    'utf8',
  ));
  assert.equal(runtime.signals.find(item => item.id === signalId)?.kind, 'todo');
  assert.equal(runtime.signals.find(item => item.id === signalId)?.record_id, recorded.node.todos[0].id);

  assert.throws(() => run(python, [
    contextScript, 'record-bad-case', '--root', project, '--session', session, '--signal', signalId,
    '--node', 'M1', '--title', 'must not reclassify', '--phenomenon', 'todo already recorded',
  ]), /already resolved as todo/);
  passed = true;
});
