import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CursorCiDockerRunner } from '../scripts/workbench/cursor-ci-runner.mjs';
import { exportCursorCiSource, verifyCursorCiSource } from '../scripts/workbench/cursor-ci-source.mjs';
import { startCursorCiMcp } from '../scripts/workbench/cursor-ci-mcp.mjs';
import { hash } from '../scripts/shared/io.mjs';

// 显式真实 Docker 入口，不加入无环境的日常 npm test。配置由本机操作者提供。
// 只验证 exporter→runner→daemon→测试进程→宿主观察；原任务鉴权为合成夹具，不调用模型/Cloud。
if (process.argv.length !== 4 || process.argv[2] !== '--config' || !path.isAbsolute(process.argv[3])) throw new Error('Use --config <absolute approved private Docker JSON>');
const approved = JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
const execute = promisify(execFile);
async function fixture(body, timeoutMs, outputBytes = 65536) {
  const parent = await fs.realpath(await fs.mkdtemp(path.resolve('temp/cursor-ci-runner-real-')));
  await fs.chmod(parent, 0o700);
  const root = path.join(parent, 'repo'), directory = path.join(parent, 'records');
  await fs.mkdir(root); await fs.mkdir(directory, { mode: 0o700 });
  const git = async (...args) => (await execute('git', args, { cwd: root, windowsHide: true,
    env: { PATH: process.env.PATH, HOME: parent, GIT_CONFIG_NOSYSTEM: '1' } })).stdout.trim();
  await git('init'); await git('config', 'user.name', 'Synthetic Tester'); await git('config', 'user.email', 'tester@example.invalid');
  await fs.writeFile(path.join(root, 'check.mjs'), body);
  await fs.writeFile(path.join(root, '.env'), 'SYNTHETIC_NOT_EXPORTED=1\n');
  await git('add', '.'); await git('commit', '-m', 'synthetic approved CI snapshot');
  const sourceSha = await git('rev-parse', 'HEAD');
  const source = await exportCursorCiSource({ root, sourceSha, directory: parent, paths: ['check.mjs'] });
  const context = { session: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', generation: 1 }, taskId: 'synthetic-test', sourceSha,
    ciTodoRef: 'todo', references: { todo: 'synthetic-version' }, commands: ['node check'],
    tester: { sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nativeSessionId: 'synthetic-native', deliveryId: 'synthetic-delivery', workerPid: process.pid } };
  const policy = { ...approved, tests: [{ id: 'check', todoId: 'check-one', commandLabel: 'node check', argv: ['/source/check.mjs'] }], timeoutMs, outputBytes };
  const ciTodo = { ref: 'todo', kind: 'ciTodo', version: 'synthetic-version', content: { items: [{ id: 'check-one' }] } };
  const runner = new CursorCiDockerRunner({ directory, policy, source, context, ciTodo, authorize: async () => context });
  return { parent, runner, source, directory, context, policy, ciTodo };
}
async function evidence(f, value) {
  await fs.writeFile(path.join(f.parent, 'result.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ evidence: f.parent, scope: 'real Docker runner control; synthetic task authority; no model/production acceptance' }));
}

test('real MCP HTTP invokes pinned Docker and returns the complete original test observation', async () => {
  const f = await fixture(`import fs from 'node:fs'; import assert from 'node:assert/strict'; import {execFileSync} from 'node:child_process';
assert.notEqual(process.getuid(),0);
assert.throws(()=>fs.writeFileSync('/source/check.mjs','BAD'),e=>['EROFS','EACCES'].includes(e.code));
assert.equal(fs.existsSync('/source/.git'),false); assert.equal(fs.existsSync('/source/.env'),false);
assert.equal(fs.existsSync('/var/run/docker.sock'),false);
for(const key of ['CURSOR_API_KEY','CURSOR_AUTH_TOKEN','OPENAI_API_KEY','ANTHROPIC_API_KEY'])assert.equal(process.env[key],undefined);
fs.writeFileSync('/scratch/own.txt','scratch works'); assert.equal(fs.readFileSync('/scratch/own.txt','utf8'),'scratch works');
const child=execFileSync('/usr/local/bin/node',['-e',"const fs=require('node:fs');try{fs.writeFileSync('/source/from-child','BAD');process.exit(2);}catch(e){if(!['EROFS','EACCES'].includes(e.code))throw e;}process.stdout.write('child isolated');"],{encoding:'utf8',windowsHide:true});
assert.equal(child,'child isolated'); process.stdout.write('FULL_START\\nALL_ASSERTIONS_PASSED\\nFULL_END\\n');
`, 15000);
  const bridge = await startCursorCiMcp({ source: f.source, testerSessionId: f.context.tester.sessionId,
    nativeSessionId: f.context.tester.nativeSessionId, tests: ['check'],
    client: { context: async () => f.context, exchange: async () => { throw new Error('No synthetic CI result accepted'); } },
    runTest: (args, bound) => f.runner.run(args, bound) });
  const rpc = async (method, params, id = 'rpc') => {
    const response = await fetch(bridge.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${bridge.credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(id ? { id } : {}) }) });
    const body = await response.text(); assert.ok([200, 202].includes(response.status)); return body ? JSON.parse(body) : null;
  };
  try {
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-real-runner-client', version: '1' } });
    await rpc('notifications/initialized', {}, null);
    const params = { name: 'context_guard_test', arguments: { id: 'real-control', testId: 'check' } };
    const firstReply = await rpc('tools/call', params);
    assert.equal(firstReply.result.isError, undefined);
    const first = firstReply.result.structuredContent;
    assert.equal(first.exitCode, 0); assert.equal(first.stdout, 'FULL_START\nALL_ASSERTIONS_PASSED\nFULL_END\n'); assert.equal(first.stderr, '');
    const record = JSON.parse(await fs.readFile(path.join(f.directory, hash('real-control') + '.json'), 'utf8'));
    const before = await f.runner.inspect(record);
    assert.deepEqual((await rpc('tools/call', params)).result.structuredContent, first);
    const after = await f.runner.inspect(record);
    assert.equal(before.State.StartedAt, after.State.StartedAt);
    assert.equal((await verifyCursorCiSource(f.source)).verified, true);
    await evidence(f, { observed: first, replayedSameReceipt: true, sourceUnchanged: true });
  } finally { await bridge.close(); await f.runner.close(); }
});

test('real Docker timeout confirms the exact original test container is stopped', async () => {
  const f = await fixture("process.stdout.write('running'); setInterval(()=>{},1000);\n", 2000);
  try {
    await assert.rejects(f.runner.run({ id: 'real-timeout', testId: 'check' }), { code: 'CI_TEST_TIMEOUT' });
    const files = (await fs.readdir(f.directory)).filter(value => value.endsWith('.json'));
    const record = JSON.parse(await fs.readFile(path.join(f.directory, files[0]), 'utf8'));
    const container = await f.runner.inspect(record);
    assert.equal(record.stopIntent.reason, 'CI_TEST_TIMEOUT'); assert.equal(record.state, 'stopped'); assert.equal(record.observation, undefined);
    assert.equal(container.State.Running, false); assert.equal(container.State.Status, 'exited');
    await evidence(f, { name: record.name, containerId: container.Id, state: container.State.Status, stopReason: record.stopIntent.reason });
  } finally { await f.runner.close(); }
});

test('real Docker oversized output is stopped and never becomes a complete-output proof', async () => {
  const f = await fixture("process.stdout.write('x'.repeat(200000)); setInterval(()=>{},1000);\n", 10000);
  try {
    await assert.rejects(f.runner.run({ id: 'real-output-limit', testId: 'check' }), { code: 'CI_TEST_OUTPUT_LIMIT' });
    const files = (await fs.readdir(f.directory)).filter(value => value.endsWith('.json'));
    const record = JSON.parse(await fs.readFile(path.join(f.directory, files[0]), 'utf8'));
    const container = await f.runner.inspect(record);
    assert.equal(record.observation, undefined); assert.equal(record.stopIntent.reason, 'CI_TEST_OUTPUT_LIMIT'); assert.equal(container.State.Running, false);
    await evidence(f, { name: record.name, containerId: container.Id, outputRejected: true, state: container.State.Status });
  } finally { await f.runner.close(); }
});

test('real worker crash leaves durable ownership that a revoked new worker can stop without source access', async () => {
  const f = await fixture("process.stdout.write('started'); setInterval(()=>{},1000);\n", 60000);
  const parameters = path.join(f.parent, 'worker.json');
  await fs.writeFile(parameters, JSON.stringify({ directory: f.directory, source: f.source, context: f.context, policy: f.policy, ciTodo: f.ciTodo }), { flag: 'wx', mode: 0o600 });
  const code = `import fs from 'node:fs/promises'; import {execFile} from 'node:child_process'; import {promisify} from 'node:util';
import {CursorCiDockerRunner} from ${JSON.stringify(new URL('../scripts/workbench/cursor-ci-runner.mjs', import.meta.url).href)};
const options=JSON.parse(await fs.readFile(process.argv[1],'utf8')); options.context.tester.workerPid=process.pid;
options.authorize=async()=>options.context; const execute=promisify(execFile);
options.command=async(executable,args,options)=>{const work=execute(executable,args,{...options,windowsHide:true});if(args.includes('--attach'))process.stdout.write(JSON.stringify({cliPid:work.child.pid})+'\\n');return await work;};
await new CursorCiDockerRunner(options).run({id:'real-crash',testId:'check'});`;
  let childOutput = '';
  const child = execFile(process.execPath, ['--input-type=module', '-e', code, parameters], {
    windowsHide: true, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, maxBuffer: 65536 }, () => {});
  child.stdout.on('data', data => { childOutput += data; });
  const exited = new Promise(resolve => child.once('exit', (exitCode, signal) => resolve({ exitCode, signal })));
  const file = path.join(f.directory, hash('real-crash') + '.json');
  let record, running = false;
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !running) {
      try {
        record = JSON.parse(await fs.readFile(file, 'utf8'));
        if (record.state === 'starting') running = (await f.runner.inspect(record)).State.Running === true;
      } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
      if (!running) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(running, true, 'Original worker must actually start the Docker test before crash');
    assert.equal(record.scope.tester.workerPid, child.pid);
    child.kill('SIGKILL'); assert.equal((await exited).signal, 'SIGKILL');
    assert.equal((await f.runner.inspect(record)).State.Running, true, 'Worker death must not be mistaken for container termination');
    await fs.chmod(path.join(f.source.snapshot, 'check.mjs'), 0o600);
    await fs.writeFile(path.join(f.source.snapshot, 'check.mjs'), '// changed after worker crash\n');
    const restarted = new CursorCiDockerRunner({ directory: f.directory, source: f.source, context: f.context,
      policy: f.policy, ciTodo: f.ciTodo, authorize: async () => { throw Object.assign(new Error('revoked'), { code: 'CI_AUTHORIZATION_REJECTED' }); } });
    await assert.rejects(restarted.run({ id: 'real-crash', testId: 'check' }), { code: 'CI_AUTHORIZATION_REJECTED' });
    await restarted.close();
    const stopped = await f.runner.inspect(record), saved = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(stopped.State.Running, false); assert.equal(stopped.State.Status, 'exited');
    assert.equal(saved.state, 'stopped'); assert.equal(saved.observation, undefined);
    assert.equal(stopped.Id, record.containerId);
    const cliPid = JSON.parse(childOutput.trim()).cliPid;
    assert.ok(Number.isSafeInteger(cliPid) && cliPid > 0);
    let cliStopped = false;
    const cliDeadline = Date.now() + 5000;
    while (Date.now() < cliDeadline && !cliStopped) {
      try { process.kill(cliPid, 0); } catch (cause) { if (cause.code !== 'ESRCH') throw cause; cliStopped = true; }
      if (!cliStopped) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(cliStopped, true, 'Original attached Docker CLI must exit after its exact container is stopped');
    await evidence(f, { crashedWorkerPid: child.pid, originalDockerCliPid: cliPid, containerId: stopped.Id,
      originalWorkerPid: saved.scope.tester.workerPid, replacementWorkerPid: process.pid,
      stopped: true, attachedCliExited: true, businessAuthorityRevoked: true, sourceChanged: true, noReplay: true });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited; await f.runner.close();
  }
});
