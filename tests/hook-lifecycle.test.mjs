import '../.github/scripts/test-environment.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { resolveProject } from '../scripts/workbench/project.mjs';
import { repository, hookScript, contextScript, workbenchCli, python, run, hook, fixture, confirmBinding, dispose, freePort, processIsAlive, waitForProcessExit, stopFixtureWorkbench, installMap, seedHumanReview, startPlan, archivePlan, finishPlan } from './hook-test-helpers.mjs';

test('Claude unbound Stop is a diagnostic, not another model turn', async t => {
  const project = await fixture();
  t.after(() => fs.rm(project, { recursive: true, force: true }));
  const result = hook('Stop', project, 'claude-unbound', { platform: 'claude' });
  assert.match(result.json.systemMessage, /unbound|binding unavailable/i);
  assert.equal(result.json.hookSpecificOutput, undefined);
  assert.equal(result.json.decision, undefined);
});

test('Claude CI permits exact assigned test commands, not source edits or an inactive CI role', () => {
  const result = run(python, ['-c', `import sys,json;sys.path.insert(0,${JSON.stringify(path.join(repository, 'scripts'))});import context_guard_hook as h
ci={"active":{"mode":"ci","commands":["npm test"]}}
command=lambda value:{"tool_name":"Bash","tool_input":{"command":value}}
assert h.ci_tool_allowed(command("npm test"),ci) is True
assert h.ci_tool_allowed(command("npm test && git commit -am changed"),ci) is False
assert h.ci_tool_allowed({"tool_name":"Write","tool_input":{"file_path":"src/app.js","content":"changed"}},ci) is False
assert h.ci_tool_allowed(command("npm test"),{"ci":True,"active":None}) is False
assert h.ci_tool_allowed(command("npm test"),{"active":{"mode":"reviewed"}}) is None
print("CI_BOUNDARY_OK")`]);
  assert.equal(result.stdout.trim(), 'CI_BOUNDARY_OK');
});

test('completed reviewed Plan permits only clean repository delivery after acceptance', () => {
  const result = run(python, ['-c', `import sys; from pathlib import Path; sys.path.insert(0,${JSON.stringify(path.join(repository, 'scripts'))}); import context_guard_hook as h
root=Path('/tmp/context-guard-post-plan')
command=lambda value:{"tool_name":"Bash","tool_input":{"command":value}}
assert h.post_plan_delivery_command(command('git -C /tmp/context-guard-post-plan push -u origin HEAD'),root)
assert h.post_plan_delivery_command(command('gh pr create --base main --title "verified work"'),root)
assert h.post_plan_delivery_command(command('gh pr merge 123 --squash'),root)
assert h.gh_pr_merge_command(command('gh pr merge 123 --squash'))
assert h.gh_pr_merge_command(command('cd /tmp/context-guard-post-plan && gh pr merge 123 --merge --admin 2>&1'))
assert h.gh_pr_merge_command(command('cd /tmp/context-guard-post-plan; /usr/bin/gh pr merge 123 --merge'))
assert h.gh_pr_merge_command(command('bash -c "gh pr merge 123 --admin"'))
assert not h.gh_pr_merge_command(command('gh pr view 123'))
for value in ['git -C /tmp/other push origin HEAD','git push --force origin HEAD','gh pr merge 123 --admin','gh pr create --repo other/repo','git commit -am changed','git push origin HEAD && rm -f file']:
    assert not h.post_plan_delivery_command(command(value),root),value
assert not h.post_plan_delivery_command(command('cd /tmp/context-guard-post-plan && gh pr merge 123 --merge --admin 2>&1'),root)
assert h.read_only_shell('git -C /tmp/context-guard-post-plan remote -v')
assert h.read_only_shell('gh pr checks 123')
execution={"active":{"mode":"reviewed","acceptanceReview":{"decision":"approved"}}}
runtime={"last_plan":{"status":"completed","archive":{"revision":1}}}
h.git_changed_paths=lambda root: []
assert h.post_plan_delivery_ready(runtime,execution,root)
assert not h.post_plan_delivery_ready(runtime,{"active":{"mode":"ci","acceptanceReview":{"decision":"approved"}}},root)
assert not h.post_plan_delivery_ready(runtime,{"active":{"mode":"reviewed","acceptanceReview":{"decision":"rejected"}}},root)
h.git_changed_paths=lambda root: ['frontend/index.html']
assert not h.post_plan_delivery_ready(runtime,execution,root)
print('POST_PLAN_DELIVERY_OK')`]);
  assert.equal(result.stdout.trim(), 'POST_PLAN_DELIVERY_OK');
});

test('post-plan PR merge fails closed while GitHub checks fail or have not run', () => {
  const result = run(python, ['-c', `import sys,copy,types; from pathlib import Path; sys.path.insert(0,${JSON.stringify(path.join(repository, 'scripts'))}); import context_guard_hook as h
command=lambda value:{"tool_name":"Bash","tool_input":{"command":value}}
assert h.post_plan_merge_target(command('gh pr merge 17 --merge')) == '17'
assert not h.post_plan_delivery_command(command('gh pr merge --merge'),Path('/tmp/lab'))
good={"state":"OPEN","mergeStateStatus":"CLEAN","headRefOid":"a"*40,"statusCheckRollup":[{"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"},{"__typename":"CheckRun","status":"COMPLETED","conclusion":"SKIPPED"}]}
assert h.merge_checks_green(good,'a'*40)
for change in ({"mergeStateStatus":"UNSTABLE"},{"statusCheckRollup":[]},{"headRefOid":"b"*40},{"statusCheckRollup":[{"__typename":"CheckRun","status":"COMPLETED","conclusion":"FAILURE"}]},{"statusCheckRollup":[{"__typename":"CheckRun","status":"IN_PROGRESS","conclusion":None}]}):
    candidate={**good,**change}
    assert not h.merge_checks_green(candidate,'a'*40),candidate
original=h.subprocess.run
def run_failure(args,**kwargs):
    return types.SimpleNamespace(returncode=0,stdout='a'*40+'\\n' if args[0]=='git' else __import__('json').dumps({**good,'mergeStateStatus':'UNSTABLE'}))
h.subprocess.run=run_failure
assert not h.verified_merge_checks(Path('/tmp/lab'),'17')
h.subprocess.run=lambda args,**kwargs: types.SimpleNamespace(returncode=0,stdout='a'*40+'\\n' if args[0]=='git' else __import__('json').dumps(good))
assert h.verified_merge_checks(Path('/tmp/lab'),'17')
h.subprocess.run=original
print('PR_MERGE_GATE_OK')`]);
  assert.equal(result.stdout.trim(), 'PR_MERGE_GATE_OK');
});

test('post-plan PR merge waiver is scoped, expires, and requires GitHub billing annotations', () => {
  const result = run(python, ['-c', `import os,sys,json,types; from pathlib import Path; sys.path.insert(0,${JSON.stringify(path.join(repository, 'scripts'))}); import context_guard_hook as h
root=Path('/tmp/lab'); sha='a'*40
pr={'state':'OPEN','mergeStateStatus':'UNSTABLE','headRefOid':sha,'statusCheckRollup':[{'__typename':'CheckRun','status':'COMPLETED','conclusion':'FAILURE'}]}
os.environ['CONTEXT_GUARD_GITHUB_BILLING_WAIVER_REPO']='example/lab'
os.environ['CONTEXT_GUARD_GITHUB_BILLING_WAIVER_UNTIL']='2100-01-01T00:00:00Z'
message='The job was not started because recent account payments have failed or your spending limit needs to be increased.'
original=h.subprocess.run
def run_gh(args,**kwargs):
    if args[1:3]==['repo','view']: value={'nameWithOwner':'example/lab'}
    elif 'check-runs?' in args[-1]: value={'total_count':1,'check_runs':[{'id':17,'status':'completed','conclusion':'failure','head_sha':sha}]}
    else: value=[{'message':message}]
    return types.SimpleNamespace(returncode=0,stdout=json.dumps(value))
h.subprocess.run=run_gh
assert h.billing_waiver_checks(root,pr,sha)
assert not h.billing_waiver_checks(root,{**pr,'statusCheckRollup':[{'__typename':'StatusContext','state':'FAILURE'}]},sha)
message='A real test assertion failed'
assert not h.billing_waiver_checks(root,pr,sha)
message='The job was not started because recent account payments have failed or your spending limit needs to be increased.'
os.environ['CONTEXT_GUARD_GITHUB_BILLING_WAIVER_UNTIL']='2020-01-01T00:00:00Z'
assert not h.billing_waiver_checks(root,pr,sha)
os.environ['CONTEXT_GUARD_GITHUB_BILLING_WAIVER_UNTIL']='2100-01-01T00:00:00Z'
os.environ['CONTEXT_GUARD_GITHUB_BILLING_WAIVER_REPO']='other/lab'
assert not h.billing_waiver_checks(root,pr,sha)
h.subprocess.run=original
print('BILLING_WAIVER_OK')`]);
  assert.equal(result.stdout.trim(), 'BILLING_WAIVER_OK');
});

test('Claude display name uses only the bounded own-session transcript metadata', async t => {
  const project = await fixture();
  t.after(() => fs.rm(project, { recursive: true, force: true }));
  const config = path.join(project, 'claude'), transcript = path.join(config, 'projects', 'lab', 'session-one.jsonl');
  await fs.mkdir(path.dirname(transcript), { recursive: true });
  await fs.writeFile(transcript, 'x'.repeat(300000) + '\n' + JSON.stringify({ type: 'custom-title', sessionId: 'session-one', customTitle: 'Claude Developer Lab' }) + '\n');
  const read = (file, session) => run(python, ['-c', 'import sys,json; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from context_guard_hook import session_display_name; print(json.dumps(session_display_name({"transcript_path":sys.argv[2]},"claude",Path.cwd(),sys.argv[3])))', path.join(repository, 'scripts'), file, session], { cwd: project, env: { CLAUDE_CONFIG_DIR: config } }).stdout.trim();
  assert.equal(JSON.parse(read(transcript, 'session-one')), 'Claude Developer Lab');
  assert.equal(JSON.parse(read(transcript, 'session-two')), '');
  const outside = path.join(project, 'session-one.jsonl');
  await fs.copyFile(transcript, outside);
  assert.equal(JSON.parse(read(outside, 'session-one')), '');
});

test('Hook grants match dynamic all, explicit revocation and per-node read-only access', async () => {
  const project = await fixture();
  try {
    const ctx = path.join(project, '.codex/context');
    await fs.mkdir(path.join(ctx, 'sessions'), { recursive: true });
    const doc = { root: { id: 'T0', children: [{ id: 'M1', children: [] }, { id: 'M2', access: [{ agentId: 'grant-test', allow: 'read' }], children: [] }] } };
    await fs.writeFile(path.join(ctx, 'map.json'), JSON.stringify(doc));
    const access = path.join(ctx, 'sessions/workbench-access.json');
    const snapshot = () => JSON.parse(run(python, ['-c', 'import sys,json; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from context_guard_hook import map_snapshot; print(json.dumps(map_snapshot(Path(sys.argv[2]),"grant-test")["grants"]))', path.join(repository, 'scripts'), ctx], {cwd:project}).stdout);
    await fs.writeFile(access, JSON.stringify({ sessions: { 'grant-test': { mode: 'all', nodes: [] } } }));
    assert.deepEqual(snapshot(), ['T0', 'M1']);
    doc.root.children.push({ id: 'M3', children: [] });
    await fs.writeFile(path.join(ctx, 'map.json'), JSON.stringify(doc));
    assert.deepEqual(snapshot(), ['T0', 'M1', 'M3']);
    await fs.writeFile(access, JSON.stringify({ sessions: { 'grant-test': { mode: 'explicit', nodes: [] } } }));
    assert.deepEqual(snapshot(), []);
    await fs.writeFile(access, JSON.stringify({ sessions: { 'grant-test': { mode: 'explicit', nodes: ['M1', 'M2'] } } }));
    assert.deepEqual(snapshot(), ['M1']);
  } finally { await dispose(project); }
});

test('SessionStart records CODEX_THREAD_ID when the hook payload omits session_id', async () => {
  const project = await fixture();
  try {
    run(python, [contextScript, 'init', '--root', project], { cwd: project });
    run(python, [hookScript, 'session-start', '--platform', 'codex'], {
      cwd: project,
      env: { CODEX_THREAD_ID: '01a07d62-hook-exec' },
      input: JSON.stringify({ cwd: project }),
    });
    const events = (await fs.readFile(path.join(project, '.codex/context/sessions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(events.some(item => item.session_id === '01a07d62-hook-exec' && item.event === 'session-start'));
  } finally { await dispose(project); }
});

test('approved plan extension preserves unfinished work and dirty-file baselines', async t => {
  const project = await fixture();
  let workbenchPid;
  t.after(async () => { await dispose(project); if (workbenchPid) await waitForProcessExit(workbenchPid); });
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Fixture'], ['config', 'user.email', 'fixture@example.invalid']]) run('git', args, { cwd: project });
  await fs.writeFile(path.join(project, 'src/scratch.txt'), 'original');
  await fs.writeFile(path.join(project, 'notes.md'), 'notes baseline');
  run('git', ['add', 'src/scratch.txt', 'notes.md'], { cwd: project }); run('git', ['commit', '-m', 'fixture'], { cwd: project });
  const session = 'plan-extension'; await confirmBinding(project, session);
  hook('SessionStart', project, session, { source: 'startup', is_background_agent: true });
  await installMap(project);
  const original = await startPlan(t, project, session);
  const identity = await resolveProject(project);
  workbenchPid = JSON.parse(await fs.readFile(path.join(identity.sharedDir, 'workbench.json'), 'utf8')).pid;
  await fs.writeFile(path.join(project, 'src/scratch.txt'), 'unfinished work');
  await fs.writeFile(path.join(project, 'notes.md'), 'new dirty scope');
  await fs.mkdir(path.join(project, 'extra')); await fs.writeFile(path.join(project, 'extra/new.txt'), 'new untracked work');
  const extend = extra => JSON.parse(run(python, [contextScript, 'plan-start', '--root', project, '--session', session, '--input', '-'], { input: JSON.stringify({ approved: true, extend: true, summary: 'Add review scope without closing acceptance', node_ids: ['N1'], paths: ['src/', 'notes.md', 'extra/'], ...extra }) }).stdout);
  assert.throws(() => extend({ approved: false }), /approved:true/);
  assert.throws(() => extend({ node_ids: ['missing'] }), /authorization/);
  const amended = extend({});
  assert.equal(amended.id, original.id); assert.equal(amended.status, 'working');
  assert.equal(amended.started_at, original.started_at);
  assert.equal(amended.baseline['src/scratch.txt'], original.baseline['src/scratch.txt']);
  assert.equal(amended.baseline['notes.md'], createHash('sha256').update('notes baseline').digest('hex'));
  assert.equal(amended.baseline['extra/new.txt'], undefined);
  assert.equal(amended.scope_review_required, true); assert.equal(amended.amendments.length, 1);
  assert.equal(amended.revision, original.revision + 1);
});

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
  assert.match(sourceHook.stdout, /binding unreadable/);

  const installedHook = run(python, [path.join(installed, 'scripts/context_guard_hook.py'), 'session-start', '--platform', 'codex'], {
    cwd: installed, env: { PWD: installed, CODEX_WORKSPACE_ROOT: installed, CODEX_PROJECT_ROOT: installed, CODEX_CWD: installed, WORKSPACE_ROOT: installed, PROJECT_ROOT: installed },
    input: JSON.stringify({ session_id: 'installed-session', cwd: installed, source: 'startup', is_background_agent: true }),
  });
  assert.doesNotMatch(installedHook.stdout, /Context Guard Map snapshot/);
  const installedSessions = await fs.readFile(path.join(installed, '.codex/context/sessions.jsonl'), 'utf8').catch(() => '');
  assert.doesNotMatch(installedSessions, /installed-session/);
});

test('Node diagnostic inspection permits only literal output, not code inside a console.log expression', () => {
  const result = run(python, ['-c', `import sys;sys.path.insert(0,${JSON.stringify(path.join(repository, 'scripts'))});import context_guard_hook as h
assert h.read_only_shell('''node -e "console.log('node-ok')"''')
assert h.node_eval_read_only("console.log('node-ok');")
assert h.node_eval_read_only('console.log("node-ok")')
for script in ["console.log('x'+process.exit()+'y')", "console.log('x');process.exit();console.log('y')", "console.log(process.cwd())"]:
    assert not h.node_eval_read_only(script),script
assert not h.read_only_shell('''node -e "console.log('node-ok')" && touch changed.txt''')
assert not h.read_only_shell('''node -e "console.log('node-ok')" --require ./side-effect.cjs''')
assert not h.read_only_shell('''node -e "console.log('node-ok')" --import ./side-effect.mjs''')
print('NODE_INSPECTION_OK')`]);
  assert.equal(result.stdout.trim(), 'NODE_INSPECTION_OK');
});

test('hooks keep an auditable plan across prompt, tools, compaction, interrupt and stop', async t => {
  const project = await fixture();
  t.after(() => dispose(project));
  const session = 'hook-session-one';
  await confirmBinding(project, session);

  const started = hook('SessionStart', project, session, { source: 'startup', is_background_agent: true });
  assert.match(started.json.hookSpecificOutput.additionalContext, /Context Guard Map snapshot/);
  assert.match(started.json.hookSpecificOutput.additionalContext, /SKILL\.md/);
  assert.ok(started.json.hookSpecificOutput.additionalContext.length < 1600);
  assert.doesNotMatch(started.json.hookSpecificOutput.additionalContext, /--phenomenon|--decisions|--operationId|Classify every/);

  const prompted = hook('UserPromptSubmit', project, session, { prompt: '完成 Hook 生命周期开发' });
  const signalId = prompted.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)?.[1];
  assert.ok(signalId);
  run(python, [contextScript, 'resolve-signal', '--root', project, '--session', session, '--signal', signalId, '--kind', 'task']);
  await installMap(project);
  const noPlan = hook('PreToolUse', project, session, { tool_name: 'exec_command', tool_input: { cmd: 'python3 fix.py' } });
  assert.equal(noPlan.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(noPlan.json.hookSpecificOutput.permissionDecisionReason, /plan-start/);
  for (const cmd of ['python3 --version', 'node -v', 'node -e "console.log(\'node-ok\')"', 'python3 -c "print(1)"']) {
    const probe = hook('PreToolUse', project, session, { tool_name: 'Bash', tool_input: { command: cmd } });
    assert.equal(probe.json.hookSpecificOutput?.permissionDecision, undefined, `${cmd}: ${probe.stdout}`);
  }
  const pipedRead = hook('PreToolUse', project, session, {
    tool_name: 'Bash',
    tool_input: { command: `context-guard map read --root ${JSON.stringify(project)} --session ${session} --node M1 | python3` },
  });
  assert.equal(pipedRead.json.hookSpecificOutput?.permissionDecision, undefined);
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
  assert.deepEqual(prepared.json, {});
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
  assert.match(subagentStopped.json.systemMessage, /subagent stopped/);
  const interrupted = hook('Interrupt', project, session);
  assert.match(interrupted.json.systemMessage, /interrupted; plan preserved/);
  const deferred = hook('Stop', project, session, { stop_hook_active: false });
  assert.deepEqual(deferred.json, {});
  assert.doesNotMatch(deferred.stdout, /finishing the current task|SIG-|Classify pending|plan-[a-f0-9]+|plan-finish/);
  const repeatedStop = hook('Stop', project, session, { stop_hook_active: true });
  assert.deepEqual(repeatedStop.json, {});
  assert.doesNotMatch(repeatedStop.stdout, /finishing the current task|SIG-|Classify pending|plan-[a-f0-9]+|plan-finish/);
  const resumed = hook('UserPromptSubmit', project, session, { turn_id: 'resume-turn', prompt: '继续' });
  assert.match(resumed.json.hookSpecificOutput.additionalContext, /Active plan: plan-[a-f0-9]+/);
  assert.doesNotMatch(resumed.json.hookSpecificOutput.additionalContext, /Resume it before|Classify every|record-todo --root/);
  const resumeSignal = resumed.json.hookSpecificOutput.additionalContext.match(/User signal: (SIG-[a-f0-9]+)/)[1];
  run(python, [contextScript, 'resolve-signal', '--root', project, '--session', session, '--signal', resumeSignal, '--kind', 'task']);
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
  assert.ok(events.filter(event => event.event === 'stop').every(event => event.state === 'stopped' && event.hook_event === 'Stop'));
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
    `node "${path.join(repository, 'bin/context-guard-skill.js')}" workbench --diagnose --root "${project}"`,
    `node "${path.join(repository, 'bin/context-guard-skill.js')}" workbench --binding-status --root "${project}" --session ${session}`,
    `node "${path.join(repository, 'bin/context-guard-skill.js')}" plan-status --root "${project}" --session ${session}`,
    `context-guard map status --root "${project}" --session ${session}; echo EXIT=$?`,
    `context-guard map status --root "${project}" --session ${session} 2>&1; echo EXIT=$?`,
    `context-guard map read --root "${project}" --session ${session} --node N1 > ${path.join(os.tmpdir(), 'cg-map-read.json')}`,
    `context-guard map read --root "${project}" --session ${session} --node N1 > ${path.join(os.tmpdir(), 'cg-map-read.json')} 2>&1`,
    `context-guard set-language --root "${project}" --language zh`,
    `context-guard write-candidates --root "${project}" --input /tmp/cg-candidates.json`,
    `context-guard map apply --root "${project}" --session ${session} --input /tmp/cg-map-request.json`,
    'sed -n \'1,20p\' RULE.md 2>&1',
    'ls 2>&1 | head',
  ];
  for (const command of commands) {
    const result = hook('PreToolUse', project, session, { tool_name: 'exec_command', tool_input: { cmd: command } });
    assert.equal(result.json.hookSpecificOutput?.permissionDecision, undefined, command);
    const claude = hook('PreToolUse', project, session, { platform: 'claude', tool_name: 'Bash', tool_input: { command } });
    assert.equal(claude.json.hookSpecificOutput?.permissionDecision, undefined, command);
  }

  const requestWrite = hook('PreToolUse', project, session, {
    platform: 'claude', tool_name: 'Write',
    tool_input: { file_path: path.join(os.tmpdir(), 'cg_write_probe.json'), content: '{"approved":true}' },
  });
  assert.equal(requestWrite.json.hookSpecificOutput?.permissionDecision, undefined);
  const projectWrite = hook('PreToolUse', project, session, {
    platform: 'claude', tool_name: 'Write',
    tool_input: { file_path: path.join(project, 'src/note.txt'), content: 'no' },
  });
  assert.equal(projectWrite.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(projectWrite.json.hookSpecificOutput.permissionDecisionReason, /plan-start --input -/);
  for (const filePath of [
    path.join(project, '..', 'other-worktree', 'src', 'a.py'),
    path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(os.tmpdir(), 'cg_write_probe.py'),
  ]) {
    const blocked = hook('PreToolUse', project, session, {
      platform: 'claude', tool_name: 'Write',
      tool_input: { file_path: filePath, content: 'no' },
    });
    assert.equal(blocked.json.hookSpecificOutput.permissionDecision, 'deny', filePath);
    assert.match(blocked.json.hookSpecificOutput.permissionDecisionReason, /plan-start/);
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
  assert.deepEqual(script.json, {});
  const outside = hook('PreToolUse', project, session, { tool_name: 'apply_patch', tool_input: '*** Add File: outside.txt\n+x' });
  assert.equal(outside.json.hookSpecificOutput.permissionDecision, 'deny');
  for (const command of ['cat > outside.txt <<EOF\nx\nEOF', 'mv src/dirty.txt outside.txt',
    'cp src/dirty.txt outside.txt', 'touch outside.txt', 'mkdir outside-dir']) {
    const shellOutside = hook('PreToolUse', project, session, { tool_name: 'Bash', tool_input: { command } });
    assert.equal(shellOutside.json.hookSpecificOutput.permissionDecision, 'deny', command);
  }
  await fs.writeFile(path.join(project, 'src/dirty.txt'), 'modified again');
  hook('PostToolUse', project, session, { tool_name: 'exec_command', tool_input: { cmd: 'python3 fix.py' }, tool_response: { exit_code: 1 } });
  hook('PostToolUseFailure', project, session, { tool_name: 'exec_command', tool_input: { cmd: 'python3 fix.py' }, error: 'failed' });
  const failureEvents = (await fs.readFile(path.join(project, '.codex/context/sessions.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(failureEvents.some(event => event.event === 'toolFailure' && event.hook_event === 'PostToolUse' && event.result === 'failed'));
  assert.ok(failureEvents.some(event => event.event === 'toolFailure' && event.hook_event === 'PostToolUseFailure'));
  assert.throws(() => finishPlan(project, session), /Archive this plan/);
  assert.throws(() => archivePlan(project, session, 'src/dirty.txt'), /scope_review/);
  assert.throws(() => archivePlan(project, session, 'src/dirty.txt', { scope_review: 'checked src only' }), /failure_review/);
  assert.throws(() => archivePlan(project, session, '', { scope_review: 'checked', failure_review: 'retested' }), /omitted changed files/);
  archivePlan(project, session, 'src/dirty.txt', { scope_review: 'git diff verified src only', failure_review: 'fixed script; output verified' });
  await fs.writeFile(path.join(project, 'src/dirty.txt'), 'after receipt');
  assert.throws(() => finishPlan(project, session), /changed after archive/);
  archivePlan(project, session, 'src/dirty.txt', { scope_review: 'git diff verified src only', failure_review: 'fixed script; output verified' });
  finishPlan(project, session);
  const state = JSON.parse(run(python, [contextScript, 'plan-status', '--root', project, '--session', session]).stdout);
  assert.equal(state.active_plan, null);
  assert.equal(state.last_plan.status, 'completed');
  assert.ok(state.last_plan.started_at && state.last_plan.completed_at && state.last_plan.archive.at);
  const map = JSON.parse(await fs.readFile(path.join(project, '.codex/context/map.json'), 'utf8'));
  assert.equal(map.root.children.length, 1, 'completion must not create a summary node');
  const memory = map.root.children[0].memories.at(-1);
  assert.equal(memory.assessment.decision, 'reuse');
  assert.ok(memory.plan_id && memory.verification && memory.recorded_at);
});

test('archive-session and plan-finish refuse until a human review of that work is recorded', async t => {
  const project = await fixture(), session = 'review-gate-session';
  t.after(() => dispose(project));
  await confirmBinding(project, session);
  hook('SessionStart', project, session, { is_background_agent: true });
  await installMap(project);
  await startPlan(t, project, session, ['src/'], { humanReview: false });
  await fs.writeFile(path.join(project, 'src/scratch.txt'), 'changed\n');
  hook('PostToolUse', project, session, {
    tool_name: 'apply_patch', tool_use_id: 'review-gate', tool_input: { path: path.join(project, 'src/scratch.txt') },
  });
  assert.throws(() => archivePlan(project, session, 'src/scratch.txt'), /Human review of this work is required/);
  assert.throws(() => finishPlan(project, session), /Archive this plan|Human review of this work is required/);
  await seedHumanReview(project, session);
  const inbox = JSON.parse(run(process.execPath, [workbenchCli, 'map', 'inbox', '--root', project, '--session', session, '--start']).stdout);
  if (inbox.receipt) {
    run(process.execPath, [workbenchCli, 'map', 'ack', '--root', project, '--session', session, '--receipt', String(inbox.receipt)]);
  }
  archivePlan(project, session, 'src/scratch.txt');
  finishPlan(project, session);
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
  const result = run(python, ['-c', `
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
    payload = {'session_id': 's', 'turn_id': 'turn-1', 'timestamp': '2026-09-04T12:00:00.000Z'}
    with patch.object(hook, 'run_node_workbench', side_effect=[RuntimeError('offline'), {'committed': True}]) as memory_call:
        assert hook.session_memory_sync(root, 's', 'user-prompt-submit', payload)['error']['code'] == 'MEMORY_SYNC_PENDING'
        assert hook.session_memory_sync(root, 's', 'user-prompt-submit', payload)['committed'] is True
        args = memory_call.call_args_list[-1].args[0]
        assert args[:2] == ['memory', 'sync']
        assert args[args.index('--session') + 1] == 's'
        assert args[args.index('--hook-event') + 1] == 'UserPromptSubmit'
        assert args[args.index('--occurred-at') + 1] == payload['timestamp']
        assert args[args.index('--event-id') + 1].startswith('hook-')
    assert hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'touch x'}})
    assert hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':'python3 fix.py'}})
    assert not hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':'python3 --version'}})
    assert not hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':'node -v'}})
    assert not hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':'node -e "console.log(\\'node-ok\\')"'}})
    assert not hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':'python3 -c "print(1)"'}})
    assert not hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':'context-guard map read --root /tmp/p --session s --node M1 | python3'}})
    assert not hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':'context-guard map read --root /tmp/p --session s --node M1 | python3 -c "import json,sys; print(json.load(sys.stdin))"'}})
    assert hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':'cat evil.py | python3'}})
    assert hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':'context-guard map apply --input /tmp/r.json --root /tmp/p --session s | python3'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'git status --short'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'sed -n "1,20p" RULE.md && rg -n hook scripts | head -5'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'context-guard workbench --diagnose --root .'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'context-guard workbench --root . --session session-1'}})
    assert not hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':'context-guard map status --root /tmp/p --session s; echo EXIT=$?'}})
    assert not hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':'context-guard map status --root /tmp/p --session s 2>&1; echo EXIT=$?'}})
    capture = (Path(tempfile.gettempdir()) / 'cg-map-read.json').as_posix()
    assert not hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':f'context-guard map read --root /tmp/p --session s --node N1 > "{capture}"'}})
    assert not hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':f'context-guard map read --root /tmp/p --session s --node N1 > "{capture}" 2>&1'}})
    assert hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':'context-guard map read --root /tmp/p --session s --node N1 > RULE.md'}})
    assert hook.mutating_tool({'tool_name':'Bash','tool_input':{'command':'python3 fix.py > /tmp/leak.txt'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'context-guard set-language --root . --language zh'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'context-guard write-candidates --root . --input /tmp/c.json'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'sed -n "1,20p" RULE.md 2>&1'}})
    assert hook.control_tool({'tool_name':'Bash','tool_input':{'command':'context-guard map apply --input /tmp/r.json; echo EXIT=$?'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'printf %s JSON | context-guard plan-start --input -'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'printf %s JSON | node /tmp/context-guard-skill.js plan-start --input -'}})
    assert not hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'printf %s JSON | python3 /tmp/context_guard.py plan-start --input -'}})
    assert hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'python3 payload.py | context-guard plan-start --input -'}})
    assert hook.mutating_tool({'tool_name':'Write','tool_input':{'file_path':'/tmp/cg_write_probe.json','content':'{}'}})
    request = Path(tempfile.gettempdir()) / 'cg_write_probe.json'
    assert hook.protocol_request_write({'tool_name':'Write','tool_input':{'file_path':str(request)}}, root)
    assert not hook.protocol_request_write({'tool_name':'Write','tool_input':{'file_path':str(root / 'src/a.txt')}}, root)
    assert not hook.protocol_request_write({'tool_name':'Write','tool_input':{'file_path':'../other-worktree/src/a.py'}}, root)
    assert not hook.protocol_request_write({'tool_name':'Write','tool_input':{'file_path':str(root.parent / 'other-worktree' / 'src' / 'a.py')}}, root)
    assert not hook.protocol_request_write({'tool_name':'Write','tool_input':{'file_path':str(Path.home() / '.claude' / 'settings.json')}}, root)
    assert not hook.protocol_request_write({'tool_name':'Write','tool_input':{'file_path':str(Path(tempfile.gettempdir()) / 'cg_write_probe.py')}}, root)
    assert hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'rg --pre ./writer pattern .'}})
    assert hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'find . -delete'}})
    assert hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'git diff --output=leak.patch'}})
    assert hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'curl --data x http://127.0.0.1/'}})
    assert hook.mutating_tool({'tool_name':'exec_command','tool_input':{'cmd':'rm context-guard plan-start'}})
    assert hook.tool_paths({'tool_name':'apply_patch','tool_input':'*** Update File: src/a\\n*** Move to: src/b'}, root) == ['src/a', 'src/b']
    assert hook.tool_paths({'tool_name':'Bash','tool_input':{'command':'cat > scripts/generate-search-index.mjs <<EOF\\nx\\nEOF'}}, root) == ['scripts/generate-search-index.mjs']
    assert hook.tool_paths({'tool_name':'Bash','tool_input':{'command':'mv src/a scripts/generate-search-index.mjs'}}, root) == ['scripts/generate-search-index.mjs', 'src/a']
    assert 'scripts/generate-search-index.mjs' in hook.tool_target_strings({'tool_name':'Bash','tool_input':{'command':'cp src/a scripts/generate-search-index.mjs'}})
print('verified')
`]);
  assert.match(result.stdout, /verified/);
});

test('CLI entrypoints work through filesystem aliases, including Windows path casing', async t => {
  const project = await fixture();
  t.after(() => dispose(project));
  for (const file of [workbenchCli]) {
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
