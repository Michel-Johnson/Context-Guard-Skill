import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ClaudeRuntime, claudeArguments } from '../scripts/workbench/claude-runtime.mjs';
import { ProtocolDelivery } from '../scripts/workbench/protocol-delivery.mjs';
import { pause, readJSON, hash } from '../scripts/shared/io.mjs';
import { canonical } from '../scripts/shared/protocol.mjs';

test('Native creation isolates the worktree and profile, pins Main and preserves retry identity', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-native-create-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(directory, 'tracked.txt'), 'Main baseline');
  git('add', 'tracked.txt'); git('commit', '-m', 'baseline');
  const sha = git('rev-parse', 'HEAD'), configDir = path.join(directory, '.git', 'template');
  await fs.mkdir(path.join(configDir, 'skills', 'context-guard'), { recursive: true });
  await fs.writeFile(path.join(configDir, 'skills', 'context-guard', 'SKILL.md'), 'fixture Skill');
  await fs.writeFile(path.join(configDir, 'settings.json'), JSON.stringify({
    permissions: { allow: [`Read(${directory}/**)`] }, hooks: { SessionStart: [{ command: `${configDir}/skills/context-guard/hook.py` }] },
  }));
  await fs.writeFile(path.join(configDir, 'old-transcript.json'), 'do not copy');
  const runtime = new ClaudeRuntime(path.join(directory, '.git', 'runtime')), templateSessionId = randomUUID();
  const config = { command: process.execPath, root: directory, configDir, environmentFile: path.join(directory, '.git', 'provider.json'),
    name: 'Template', model: 'fixture', role: 'executor', resumeExisting: true, allowSessionCreation: true,
    systemPromptFile: path.join(configDir, 'skills', 'context-guard', 'Developer.md') };
  await runtime.configure(templateSessionId, config);
  runtime.wake = async () => {}; // This test verifies preparation, not a real model invocation.
  const request = { id: hash('creation'), sessionId: randomUUID(), templateSessionId, name: 'New developer' };
  const first = await runtime.provision(request, { baseRef: 'refs/heads/main' });
  const state = await readJSON(runtime.sessionFile(request.sessionId));
  assert.notEqual(first.root, directory);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: first.root, encoding: 'utf8', windowsHide: true }).trim(), sha);
  assert.equal(state.initialized, false);
  assert.equal(state.config.allowSessionCreation, false);
  assert.equal(state.config.environmentFile, config.environmentFile);
  assert.equal(state.config.systemPromptFile, path.join(state.config.configDir, 'skills', 'context-guard', 'Developer.md'));
  const settings = await readJSON(path.join(state.config.configDir, 'settings.json'));
  assert.equal(settings.permissions.allow[0], `Read(${first.root}/**)`);
  assert.equal(settings.hooks.SessionStart[0].command, `${state.config.configDir}/skills/context-guard/hook.py`);
  await assert.rejects(fs.stat(path.join(state.config.configDir, 'old-transcript.json')), { code: 'ENOENT' });
  const jobBefore = await fs.readFile(state.active, 'utf8');
  const restarted = new ClaudeRuntime(runtime.directory); restarted.wake = async () => {};
  assert.deepEqual(await restarted.provision(request, { baseRef: 'refs/heads/main' }), first);
  assert.equal(await fs.readFile(state.active, 'utf8'), jobBefore);
  const ciId = randomUUID(), ciRoot = path.join(directory, '.git', 'ci-worktree');
  git('worktree', 'add', '--detach', ciRoot, sha);
  const ciConfig = { ...config, role: 'ci', root: ciRoot, executorSessionId: templateSessionId, ciCommands: ['npm test'], allowSessionCreation: false };
  await runtime.configure(ciId, ciConfig);
  assert.deepEqual(await runtime.ciReceiver(request.sessionId), { sessionId: ciId, root: await fs.realpath(ciRoot) });
  assert.equal(await runtime.acceptsCiExecutor(ciConfig, request.sessionId), true);
  assert.equal(await runtime.acceptsCiExecutor(ciConfig, randomUUID()), false);
  await runtime.deliver({ id: 'created-ci', sessionId: ciId, root: ciRoot, platform: 'claude', message: 'Test the exact SHA',
    execution: { session: { id: request.sessionId, generation: 1 }, taskId: 'created-task', sourceSha: sha } });
  const ciContext = await runtime.ciContext(ciId, { verifySource: true });
  assert.equal(ciContext.session.id, request.sessionId);
  assert.equal(ciContext.sourceSha, sha);
  await assert.rejects(runtime.provision({ ...request, name: 'Other' }, { baseRef: 'refs/heads/main' }), { code: 'ID_REUSED' });
  await assert.rejects(runtime.provision({ ...request, id: hash('child'), templateSessionId: request.sessionId, sessionId: randomUUID() }, { baseRef: 'refs/heads/main' }), { code: 'CREATION_NOT_ENABLED' });
});

test('Claude invocation pins the actual Session, model, name and permission boundary', () => {
  const sessionId = randomUUID(), config = { name: 'Developer', model: 'configured-model', args: [] };
  const args = claudeArguments(config, { sessionId, resume: false });
  assert.equal(args[args.indexOf('--session-id') + 1], sessionId);
  assert.equal(args[args.indexOf('--model') + 1], config.model);
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.ok(claudeArguments(config, { sessionId, resume: true }).includes('--resume'));
  assert.throws(() => claudeArguments(config, { sessionId: 'guessed' }), { code: 'INVALID_SESSION' });
});

test('Claude keeps a single native turn, resumes its Session, and deduplicates after backend restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-claude-runtime-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }));
  const script = path.join(directory, 'native-fixture.cjs'), seen = path.join(directory, 'seen.jsonl');
  await fs.writeFile(script, `const fs=require('node:fs'); let input=''; process.stdin.on('data',c=>input+=c).on('end',()=>{
    const args=process.argv.slice(2), index=Math.max(args.indexOf('--session-id'),args.indexOf('--resume')), session_id=args[index+1];
    fs.appendFileSync(${JSON.stringify(seen)},JSON.stringify({args,input})+'\\n');
    console.log(JSON.stringify({type:'system',subtype:'init',session_id}));
    setTimeout(()=>console.log(JSON.stringify({type:'result',session_id,is_error:false,result:'完成'})),800);
  });`);
  const environmentFile = path.join(directory, 'provider.json'); await fs.writeFile(environmentFile, '{}');
  const runtimeDirectory = path.join(directory, 'runtime'), runtime = new ClaudeRuntime(runtimeDirectory);
  const sessionId = randomUUID(), config = { command: process.execPath, args: [script], name: 'Claude Test', model: 'configured-model', role: 'executor', root: directory, configDir: path.join(directory, 'config'), environmentFile };
  await assert.rejects(runtime.configure(sessionId, { ...config, permissionMode: 'bypassPermissions' }), { code: 'INVALID_RUNTIME' });
  await runtime.configure(sessionId, config);
  const delivery = { id: 'delivery-one', platform: 'claude', sessionId, root: directory, message: 'First task' };
  // Simulate a crash between storing the invocation and linking Session.active.
  await fs.mkdir(path.dirname(runtime.jobFile(sessionId, delivery.id)), { recursive: true });
  await fs.writeFile(runtime.jobFile(sessionId, delivery.id), JSON.stringify({ id: delivery.id, fingerprint: hash(canonical(delivery)), sessionId, message: delivery.message, state: 'starting', resume: false }));
  const protocol = new ProtocolDelivery(path.join(directory, 'delivery'), { claude: {
    deliver: async input => { await runtime.deliver(input); throw Object.assign(new Error('lost local acknowledgement'), { deliveryUncertain: true }); },
  } });
  await assert.rejects(protocol.deliver(delivery), { code: 'UNAVAILABLE' });
  const restored = new ProtocolDelivery(path.join(directory, 'delivery'), { claude: new ClaudeRuntime(runtimeDirectory) });
  assert.equal((await restored.deliver(delivery)).state, 'received');
  await assert.rejects(runtime.deliver({ ...delivery, id: 'delivery-two' }), { code: 'RUNTIME_BUSY' });
  const wait = async id => {
    const deadline = Date.now() + 10000;
    for (;;) {
      const job = await readJSON(runtime.jobFile(sessionId, id), null);
      if (job?.state === 'finished' && (await runtime.status(sessionId)).status === 'stopped') return job;
      if (Date.now() > deadline) throw new Error(`Native fixture did not finish: ${job?.state}/${job?.error}`);
      await pause(50);
    }
  };
  await wait(delivery.id);
  await new ProtocolDelivery(path.join(directory, 'delivery'), { claude: new ClaudeRuntime(runtimeDirectory) }).deliver(delivery);
  await runtime.deliver({ ...delivery, id: 'delivery-two', message: 'Second task' });
  await wait('delivery-two');
  const invocations = (await fs.readFile(seen, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(invocations.length, 2);
  assert.deepEqual(invocations.map(x => x.input), ['First task', 'Second task']);
  assert.ok(invocations[0].args.includes('--session-id'));
  assert.ok(invocations[1].args.includes('--resume'));
  await assert.rejects(runtime.deliver({ ...delivery, message: 'Different input' }), { code: 'ID_REUSED' });
});

test('Explicit Claude recovery retains old intent, refuses live processes and replays one continuation after restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-claude-recovery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }));
  const script = path.join(directory, 'native.cjs'), seen = path.join(directory, 'seen.jsonl');
  await fs.writeFile(script, `const fs=require('fs');let input='';process.stdin.on('data',c=>input+=c).on('end',()=>{
    const args=process.argv.slice(2),session_id=args[args.indexOf('--resume')+1];
    fs.appendFileSync(${JSON.stringify(seen)},JSON.stringify({args,input})+'\\n');
    console.log(JSON.stringify({type:'system',subtype:'init',session_id}));
    setTimeout(()=>console.log(JSON.stringify({type:'result',session_id,is_error:false})),300);
  });`);
  const environmentFile = path.join(directory, 'provider.json'); await fs.writeFile(environmentFile, '{}');
  const runtimeDirectory = path.join(directory, 'runtime'), runtime = new ClaudeRuntime(runtimeDirectory), sessionId = randomUUID();
  await runtime.configure(sessionId, { command: process.execPath, args: [script], name: 'Recovery', model: 'test-model', role: 'executor', root: directory, configDir: path.join(directory, 'config'), environmentFile, resumeExisting: true });
  const file = runtime.sessionFile(sessionId), jobFile = runtime.jobFile(sessionId, 'original');
  await fs.mkdir(path.dirname(jobFile), { recursive: true });
  const state = { ...await readJSON(file), active: jobFile };
  await fs.writeFile(file, JSON.stringify(state));
  const old = { id: 'original', sessionId, message: 'Original work', state: 'interrupted', workerPid: process.pid };
  await fs.writeFile(jobFile, JSON.stringify(old));
  const request = { operationId: 'continue-once', deliveryId: 'original', message: 'Inspect prior work; finish only the remaining approved steps.' };
  await assert.rejects(runtime.recover(sessionId, request, directory), { code: 'RUNTIME_BUSY' });
  await fs.writeFile(jobFile, JSON.stringify({ ...old, workerPid: null, childPid: process.pid }));
  await assert.rejects(runtime.recover(sessionId, request, directory), { code: 'RUNTIME_BUSY' });
  await assert.rejects(runtime.recover(sessionId, { ...request, deliveryId: 'wrong' }, directory), { code: 'RECOVERY_NOT_AVAILABLE' });
  await assert.rejects(runtime.recover(sessionId, { ...request, unexpected: true }, directory), { code: 'INVALID_RECOVERY' });
  await assert.rejects(runtime.recover(sessionId, request, os.tmpdir()), { code: 'WORKTREE_MISMATCH' });
  const originalBytes = JSON.stringify({ ...old, workerPid: null, childPid: null });
  await fs.writeFile(jobFile, originalBytes);
  runtime.wake = async () => {}; // Crash after saving the continuation, before starting its worker.
  await runtime.recover(sessionId, request, directory);
  const recoveryFile = runtime.jobFile(sessionId, 'recovery:continue-once');
  assert.equal((await readJSON(recoveryFile)).recoveredDeliveryId, 'original');
  await fs.writeFile(file, JSON.stringify(state)); // Also exercise the job-to-Session link crash window.
  const restored = new ClaudeRuntime(runtimeDirectory);
  const results = await Promise.all([restored.recover(sessionId, request, directory), restored.recover(sessionId, request, directory)]);
  assert.deepEqual(results[0], results[1]);
  await assert.rejects(restored.recover(sessionId, { ...request, message: 'Changed request' }, directory), { code: 'ID_REUSED' });
  const deadline = Date.now() + 10000;
  while ((await readJSON(recoveryFile)).state !== 'finished' || (await restored.status(sessionId)).status !== 'stopped') {
    if (Date.now() > deadline) throw new Error('Recovery fixture did not finish');
    await pause(30);
  }
  await restored.recover(sessionId, request, directory);
  await assert.rejects(restored.recover(sessionId, { ...request, operationId: 'another' }, directory), { code: 'RECOVERY_NOT_AVAILABLE' });
  const invocations = (await fs.readFile(seen, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].args[invocations[0].args.indexOf('--resume') + 1], sessionId);
  assert.ok(invocations[0].input.includes(request.message));
  assert.equal(await fs.readFile(jobFile, 'utf8'), originalBytes, 'never rewrite or remove the old delivery');
});

test('Claude CI checks out the exact handoff SHA and rejects results after source mutation', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-claude-ci-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }));
  const root = path.join(directory, 'ci-worktree'); await fs.mkdir(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(directory, 'isolated-gitconfig'), GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'ci@example.invalid');
  await fs.writeFile(path.join(root, 'source.txt'), 'approved\n'); git('add', '.'); git('commit', '-m', 'approved');
  const sourceSha = git('rev-parse', 'HEAD');
  await fs.writeFile(path.join(root, 'source.txt'), 'later\n'); git('commit', '-am', 'later');
  const gate = path.join(directory, 'finish'), script = path.join(directory, 'native.cjs');
  await fs.writeFile(script, `const fs=require('fs');process.stdin.resume();const args=process.argv.slice(2);const session_id=args[args.indexOf('--session-id')+1];console.log(JSON.stringify({type:'system',subtype:'init',session_id}));const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(gate)})){clearInterval(timer);console.log(JSON.stringify({type:'result',session_id,is_error:false}));}},20);`);
  const environmentFile = path.join(directory, 'provider.json'); await fs.writeFile(environmentFile, '{}');
  const sessionId = randomUUID(), executorSessionId = randomUUID(), runtime = new ClaudeRuntime(path.join(directory, 'runtime'));
  await runtime.configure(sessionId, { command: process.execPath, args: [script], name: 'CI', model: 'test-model', role: 'ci', root, configDir: path.join(directory, 'config'), environmentFile, executorSessionId, ciCommands: ['npm test'] });
  assert.equal((await runtime.ciReceiver(executorSessionId)).sessionId, sessionId);
  await runtime.deliver({ id: 'ci-task', sessionId, root, platform: 'claude', message: 'test only', execution: { session: { id: executorSessionId, generation: 1 }, taskId: 'task', sourceSha } });
  assert.equal(git('rev-parse', 'HEAD'), sourceSha);
  assert.equal((await runtime.ciContext(sessionId, { verifySource: true })).sourceSha, sourceSha);
  await fs.writeFile(path.join(root, 'source.txt'), 'unauthorized change\n');
  await assert.rejects(runtime.ciContext(sessionId, { verifySource: true }), { code: 'CI_SOURCE_CHANGED' });
  await fs.writeFile(path.join(root, 'source.txt'), 'approved\n');
  await fs.writeFile(gate, 'finish');
  const deadline = Date.now() + 10000;
  while ((await readJSON(runtime.jobFile(sessionId, 'ci-task'))).state !== 'finished' || (await runtime.status(sessionId)).status !== 'stopped') {
    if (Date.now() > deadline) throw new Error('CI fixture did not finish');
    await pause(50);
  }
  await assert.rejects(runtime.ciContext(sessionId), { code: 'CI_NOT_ACTIVE' });
  const jobFile = runtime.jobFile(sessionId, 'ci-task');
  await fs.writeFile(jobFile, JSON.stringify({ ...await readJSON(jobFile), state: 'interrupted' }));
  await fs.writeFile(runtime.sessionFile(sessionId), JSON.stringify({ ...await readJSON(runtime.sessionFile(sessionId)), active: jobFile }));
  await assert.rejects(runtime.ciContext(sessionId), { code: 'CI_NOT_ACTIVE' }, 'an interrupted CI worker no longer has test authority');
});
