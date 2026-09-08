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
});
