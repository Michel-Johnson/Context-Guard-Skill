import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CursorCiDockerRunner } from '../scripts/workbench/cursor-ci-runner.mjs';
import { exportCursorCiSource } from '../scripts/workbench/cursor-ci-source.mjs';
import { hash } from '../scripts/shared/io.mjs';
import { canonical } from '../scripts/shared/protocol.mjs';

const imageId = 'sha256:' + 'd'.repeat(64), containerId = 'a'.repeat(64);
async function fixture(t) {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-ci-runner-test-')));
  await fs.chmod(parent, 0o700);
  const root = path.join(parent, 'repo'), directory = path.join(parent, 'records');
  await fs.mkdir(root); await fs.mkdir(directory, { mode: 0o700 });
  const execute = promisify(execFile);
  const git = async (...args) => (await execute('git', args, { cwd: root, windowsHide: true,
    env: { PATH: process.env.PATH, HOME: parent, GIT_CONFIG_NOSYSTEM: '1', ...(process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) } })).stdout.trim();
  await git('init'); await git('config', 'user.name', 'Synthetic Tester'); await git('config', 'user.email', 'tester@example.invalid');
  await fs.writeFile(path.join(root, 'check.mjs'), 'import assert from "node:assert/strict"; assert.equal(1,1);\n');
  await git('add', '.'); await git('commit', '-m', 'synthetic committed fixture');
  const sourceSha = await git('rev-parse', 'HEAD');
  const source = await exportCursorCiSource({ root, sourceSha, directory: parent, paths: ['check.mjs'] });
  const context = { session: { id: 'executor', generation: 1 }, taskId: 'task', sourceSha, ciTodoRef: 'todo', references: { todo: 'v1' },
    commands: ['node --test'], tester: { sessionId: 'tester', nativeSessionId: 'native', deliveryId: 'delivery', workerPid: process.pid } };
  const policy = { docker: process.execPath, socket: path.join(parent, 'synthetic.sock'), daemonId: 'synthetic-daemon', imageId,
    imageEnvironment: ['PATH=/usr/bin:/bin', 'NODE_VERSION=24'], tests: [{ id: 'check', todoId: 'todo-one', commandLabel: 'node --test', argv: ['--test', '/source/check.mjs'] }],
    timeoutMs: 1000, outputBytes: 4096 };
  const state = { calls: [], status: 'created', exitCode: 0, stdout: 'synthetic observed output', stderr: '' };
  const inspected = () => ({ Id: containerId, Name: '/' + state.name, Image: imageId, Config: { Labels: state.labels,
    User: '1000:1000', WorkingDir: '/scratch', Tty: false, Entrypoint: ['/usr/local/bin/node'], Cmd: policy.tests[0].argv, Env: policy.imageEnvironment },
    HostConfig: { NetworkMode: state.unsafeNetwork ? 'host' : 'none', Privileged: false, ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'],
      PidsLimit: 64, Memory: 256 * 1024 * 1024, NanoCpus: 1000000000, LogConfig: { Type: 'none' }, RestartPolicy: { Name: 'no' },
      Tmpfs: { '/tmp': 'rw,nosuid,nodev,noexec,size=16m,mode=1777', '/scratch': 'rw,nosuid,nodev,size=64m,mode=700,uid=1000,gid=1000' } },
    Mounts: [{ Type: 'bind', Source: source.snapshot, Destination: '/source', RW: false }],
    State: { Running: state.status === 'running', Status: state.status, ExitCode: state.exitCode } });
  // 仅 Docker CLI/daemon 边界为替身；Git 快照、权限检查、持久账本、取消与校验执行产品实现。
  const command = async (executable, fullArgs, options) => {
    assert.equal(executable, policy.docker);
    assert.deepEqual(fullArgs.slice(0, 2), ['--host', `unix://${policy.socket}`]);
    assert.deepEqual(options.env, { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }); assert.equal(options.windowsHide, true);
    const args = fullArgs.slice(2); state.calls.push(args);
    if (args[0] === 'info') return { stdout: JSON.stringify({ ID: state.foreignDaemon ? 'foreign' : policy.daemonId, OSType: 'linux', Architecture: 'arm64' }) };
    if (args[0] === 'image') return { stdout: JSON.stringify({ Id: imageId, Os: 'linux', Architecture: 'arm64', Config: { Env: policy.imageEnvironment, ...(state.volume ? { Volumes: { '/private': {} } } : {}) } }) };
    if (args[0] === 'create') {
      const record = JSON.parse(await fs.readFile(path.join(directory, hash('request') + '.json'), 'utf8'));
      assert.equal(record.state, 'intent'); assert.equal(record.containerId, undefined);
      state.name = args[args.indexOf('--name') + 1]; state.labels = {};
      for (let index = 0; index < args.length; index++) if (args[index] === '--label') { const value = args[++index]; const equals = value.indexOf('='); state.labels[value.slice(0, equals)] = value.slice(equals + 1); }
      if (state.createUnknown) throw new Error('synthetic lost create reply');
      return { stdout: containerId + '\n' };
    }
    if (args[0] === 'inspect') { const value = inspected(); if (state.foreignOwner) value.Config.Labels = {}; return { stdout: JSON.stringify(value) }; }
    if (args[0] === 'start') {
      assert.deepEqual(args.slice(0, 2), ['start', '--attach']);
      state.status = 'running'; if (state.startUnknown) throw new Error('synthetic lost start reply');
      if (state.timeout) throw Object.assign(new Error('synthetic CLI timeout'), { killed: true });
      if (state.outputLimit) throw Object.assign(new Error('synthetic full-output limit'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
      if (state.waiting) await new Promise(resolve => { state.finishWait = resolve; state.entered?.(); }); else state.status = 'exited';
      return { stdout: state.stdout, stderr: state.stderr };
    }
    if (args[0] === 'kill') {
      const record = JSON.parse(await fs.readFile(path.join(directory, hash('request') + '.json'), 'utf8'));
      assert.equal(record.state, 'stopping'); assert.ok(record.stopIntent?.reason);
      state.killed = args[1]; if (!state.stopUnknown) { state.status = 'exited'; state.exitCode = 137; state.finishWait?.(); }
      return { stdout: containerId };
    }
    if (args[0] === 'wait') {
      if (state.timeout) throw Object.assign(new Error('synthetic CLI timeout'), { killed: true });
      if (state.waiting) await new Promise(resolve => { state.finishWait = resolve; state.entered?.(); });
      else state.status = 'exited';
      return { stdout: String(state.exitCode) };
    }
    if (args[0] === 'logs') return { stdout: state.stdout, stderr: state.stderr };
    throw new Error('Unexpected synthetic Docker operation');
  };
  const ciTodo = { ref: 'todo', kind: 'ciTodo', version: 'v1', content: { items: [{ id: 'todo-one' }] } };
  const runner = new CursorCiDockerRunner({ directory, policy, source, context, ciTodo, command, user: { uid: 1000, gid: 1000 },
    pulse: callback => { state.pulse = callback; return setInterval(() => {}, 100000); },
    authorize: async () => { if (state.revoked) throw Object.assign(new Error('revoked'), { code: 'CI_AUTHORIZATION_REJECTED' }); return context; } });
  t.after(() => runner.close());
  return { runner, state, directory, context, policy, source, command, ciTodo };
}

test('CI runner uses fixed container policy, records host observations and replays without rerunning', async t => {
  const f = await fixture(t), input = { id: 'request', testId: 'check' };
  const result = await f.runner.run(input);
  assert.equal(result.exitCode, 0); assert.equal(result.status, 'exited'); assert.equal(result.sourceSha, f.context.sourceSha);
  assert.equal(Object.hasOwn(result, 'verdict'), false);
  assert.deepEqual(await f.runner.run(input), result);
  const created = f.state.calls.filter(args => args[0] === 'create'); assert.equal(created.length, 1);
  for (const flag of ['--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--no-healthcheck']) assert.ok(created[0].includes(flag));
  assert.ok(created[0].includes(`type=bind,src=${f.source.snapshot},dst=/source,readonly,bind-recursive=disabled`));
  assert.equal(created[0].filter(value => value === '--mount').length, 1);
  assert.deepEqual(created[0].slice(-3), [imageId, '--test', '/source/check.mjs']);
  assert.equal(f.state.calls.filter(args => args[0] === 'start').length, 1);
  assert.equal(f.state.calls.some(args => ['rm', 'prune'].includes(args[0])), false);
  assert.equal(f.state.calls.some(args => ['wait', 'logs'].includes(args[0])), false);
  assert.ok(created[0].includes('--log-driver=none'));
});

test('CI runner rejects model-selected command fields and rechecks authorization before old receipts', async t => {
  const f = await fixture(t);
  for (const input of [{ id: 'request', testId: 'other' }, { id: 'request', testId: 'check', argv: ['sh'] }]) await assert.rejects(f.runner.run(input), { code: 'CI_TEST_FORBIDDEN' });
  await f.runner.run({ id: 'request', testId: 'check' }); f.state.revoked = true;
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_AUTHORIZATION_REJECTED' });
  assert.equal(f.state.calls.filter(args => args[0] === 'create').length, 1);
});

test('CI runner refuses changed daemon and image volumes before any test creation', async t => {
  const f = await fixture(t); f.state.foreignDaemon = true;
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_RUNNER_ENVIRONMENT_CHANGED' });
  f.state.foreignDaemon = false; f.state.volume = true;
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_RUNNER_ENVIRONMENT_CHANGED' });
  assert.equal(f.state.calls.some(args => args[0] === 'create'), false);
});

test('CI runner keeps an unknown create intent and never blindly creates or starts another test', async t => {
  const f = await fixture(t); f.state.createUnknown = true;
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_RUN_UNKNOWN' });
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_RUN_UNKNOWN' });
  assert.equal(f.state.calls.filter(args => args[0] === 'create').length, 1);
  assert.equal(f.state.calls.filter(args => args[0] === 'start').length, 0);
});

test('CI runner confirms its original container stopped after timeout and retains terminal failure', async t => {
  const f = await fixture(t); f.state.timeout = true;
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_TEST_TIMEOUT' });
  assert.equal(f.state.killed, containerId); assert.equal(f.state.status, 'exited');
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_TEST_TIMEOUT' });
  assert.equal(f.state.calls.filter(args => args[0] === 'start').length, 1);
});

test('CI runner stops only its verified container on cancellation and close', async t => {
  const f = await fixture(t); f.state.waiting = true;
  const entered = new Promise(resolve => { f.state.entered = resolve; });
  const running = f.runner.run({ id: 'request', testId: 'check' });
  const rejected = assert.rejects(running, { code: 'CI_TEST_CANCELLED' });
  await entered; await f.runner.close(); await rejected;
  assert.equal(f.state.killed, containerId); assert.equal(f.state.status, 'exited');
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_RUNNER_CLOSED' });
});

test('CI runner does not treat a killed Docker CLI as confirmed container termination', async t => {
  const f = await fixture(t); f.state.timeout = true; f.state.stopUnknown = true;
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_STOP_UNCONFIRMED' });
  assert.equal(f.state.status, 'running');
  await assert.rejects(f.runner.close(), { code: 'CI_STOP_UNCONFIRMED' });
  f.state.stopUnknown = false;
});

test('CI runner will not kill a different owner and rejects corrupted saved observations', async t => {
  const f = await fixture(t); f.state.foreignOwner = true;
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_CONTAINER_OWNERSHIP_CHANGED' });
  assert.equal(f.state.calls.some(args => args[0] === 'start' || args[0] === 'kill'), false);
  f.state.foreignOwner = false;
  const g = await fixture(t); await g.runner.run({ id: 'request', testId: 'check' });
  const file = path.join(g.directory, hash('request') + '.json'), record = JSON.parse(await fs.readFile(file, 'utf8'));
  record.observation.exitCode = 8; await fs.writeFile(file, JSON.stringify(record));
  await assert.rejects(g.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_TEST_PROOF_INVALID' });
});

test('CI runner persists stop intent before kill and rejects any truncated output proof', async t => {
  const f = await fixture(t); f.state.outputLimit = true;
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_TEST_OUTPUT_LIMIT' });
  const record = JSON.parse(await fs.readFile(path.join(f.directory, hash('request') + '.json'), 'utf8'));
  assert.equal(record.stopIntent.reason, 'CI_TEST_OUTPUT_LIMIT'); assert.equal(record.state, 'stopped');
  assert.equal(record.observation, undefined); assert.equal(f.state.status, 'exited');
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_TEST_OUTPUT_LIMIT' });
  assert.equal(f.state.calls.filter(args => args[0] === 'start').length, 1);
});

test('CI runner detects in-flight revocation without another model request and stops the owned container', async t => {
  const f = await fixture(t); f.state.waiting = true;
  const entered = new Promise(resolve => { f.state.entered = resolve; });
  const running = f.runner.run({ id: 'request', testId: 'check' });
  const rejected = assert.rejects(running, { code: 'CI_AUTHORIZATION_REJECTED' });
  await entered; f.state.revoked = true; f.state.pulse(); await rejected;
  assert.equal(f.state.status, 'exited'); assert.equal(f.state.killed, containerId);
});

test('CI runner rejects altered actual container policy but still stops by exact ownership', async t => {
  const f = await fixture(t); f.state.unsafeNetwork = true;
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_CONTAINER_POLICY_CHANGED' });
  assert.equal(f.state.calls.some(args => args[0] === 'start'), false);
  assert.equal(f.state.status, 'created');
});

function recoveredRunner(f) {
  return new CursorCiDockerRunner({ directory: f.directory, policy: f.policy, source: f.source, context: f.context,
    ciTodo: f.ciTodo, command: f.command, user: { uid: 1000, gid: 1000 },
    authorize: async () => { if (f.state.revoked) throw Object.assign(new Error('revoked'), { code: 'CI_AUTHORIZATION_REJECTED' }); return f.context; } });
}

test('CI runner recovers durable ownership on close even after task revocation', async t => {
  const f = await fixture(t); f.state.startUnknown = true; f.state.stopUnknown = true;
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_STOP_UNCONFIRMED' });
  const restarted = recoveredRunner(f); f.state.revoked = true;
  await assert.rejects(restarted.run({ id: 'request', testId: 'check' }), { code: 'CI_AUTHORIZATION_REJECTED' });
  f.state.stopUnknown = false;
  await restarted.close();
  assert.equal(f.state.status, 'exited');
  assert.equal(f.state.calls.filter(args => args[0] === 'create').length, 1);
  assert.equal(f.state.calls.filter(args => args[0] === 'start').length, 1);
});

test('CI runner close recovers original ownership without reading changed source or image configuration', async t => {
  const f = await fixture(t); f.state.startUnknown = true; f.state.stopUnknown = true;
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_STOP_UNCONFIRMED' });
  const restarted = recoveredRunner(f);
  await fs.chmod(path.join(f.source.snapshot, 'check.mjs'), 0o600);
  await fs.writeFile(path.join(f.source.snapshot, 'check.mjs'), '// changed fixture source\n');
  await assert.rejects(restarted.run({ id: 'request', testId: 'check' }), { code: 'CI_SOURCE_CHANGED' });
  f.state.volume = true; f.state.stopUnknown = false;
  await restarted.close();
  assert.equal(f.state.status, 'exited');
});

test('CI runner cleanup refuses foreign durable scope and never reports unknown daemon as stopped', async t => {
  const f = await fixture(t); f.state.startUnknown = true; f.state.stopUnknown = true;
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_STOP_UNCONFIRMED' });
  const file = path.join(f.directory, hash('request') + '.json'), original = await fs.readFile(file, 'utf8');
  const record = JSON.parse(original); record.scope.taskId = 'another-task'; await fs.writeFile(file, JSON.stringify(record));
  const restarted = recoveredRunner(f), previousKills = f.state.calls.filter(args => args[0] === 'kill').length;
  await assert.rejects(restarted.close(), { code: 'CI_STOP_UNCONFIRMED' });
  assert.equal(f.state.calls.filter(args => args[0] === 'kill').length, previousKills);
  await fs.writeFile(file, original); f.state.foreignDaemon = true;
  await assert.rejects(restarted.close(), { code: 'CI_STOP_UNCONFIRMED' });
  assert.equal(f.state.calls.filter(args => args[0] === 'kill').length, previousKills);
  f.state.foreignDaemon = false; f.state.stopUnknown = false; await restarted.close();
  assert.equal(f.state.status, 'exited');
});

test('CI runner old worker PID allows only ownership cleanup, never business execution replay', async t => {
  const f = await fixture(t); f.state.startUnknown = true; f.state.stopUnknown = true;
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_STOP_UNCONFIRMED' });
  const file = path.join(f.directory, hash('request') + '.json'), record = JSON.parse(await fs.readFile(file, 'utf8'));
  // 合成旧进程账本；其余原投递、Task、SHA、策略和标签保持精确匹配。
  record.scope.tester.workerPid = process.pid + 100000;
  record.fingerprint = hash(canonical({ scope: canonical(record.scope), source: record.manifestSha256, policy: record.policyHash, testId: record.request.testId }));
  f.state.labels['context-guard.ci-request'] = record.fingerprint; await fs.writeFile(file, JSON.stringify(record));
  const restarted = recoveredRunner(f);
  await assert.rejects(restarted.run({ id: 'request', testId: 'check' }), { code: 'ID_REUSED' });
  f.state.stopUnknown = false; await restarted.close();
  assert.equal(f.state.status, 'exited');
  assert.equal(f.state.calls.filter(args => args[0] === 'start').length, 1);
});

test('CI runner new instance reports unresolved original containers and never kills another owner', async t => {
  const f = await fixture(t); f.state.startUnknown = true; f.state.stopUnknown = true;
  await assert.rejects(f.runner.run({ id: 'request', testId: 'check' }), { code: 'CI_STOP_UNCONFIRMED' });
  const restarted = recoveredRunner(f), previousKills = f.state.calls.filter(args => args[0] === 'kill').length;
  f.state.foreignOwner = true;
  await assert.rejects(restarted.close(), { code: 'CI_STOP_UNCONFIRMED' });
  assert.equal(f.state.calls.filter(args => args[0] === 'kill').length, previousKills);
  f.state.foreignOwner = false;
  await assert.rejects(restarted.close(), { code: 'CI_STOP_UNCONFIRMED' });
  f.state.stopUnknown = false; await restarted.close();
  assert.equal(f.state.status, 'exited');
});
