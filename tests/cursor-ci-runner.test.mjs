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
import { assertCursorCiHostEvidence, createCursorCiHostProof, cursorCiNodeTapPassed } from '../scripts/workbench/cursor-ci-proof.mjs';
import { ProtocolStore } from '../scripts/shared/protocol-store.mjs';
import { scopedObjectKey } from '../scripts/shared/protocol-workflow.mjs';
import { startCursorCiMcp } from '../scripts/workbench/cursor-ci-mcp.mjs';

const imageId = 'sha256:' + 'd'.repeat(64), containerId = 'a'.repeat(64);
async function fixture(t, { tap = false, setup, directoryScope = false } = {}) {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-ci-runner-test-')));
  await fs.chmod(parent, 0o700);
  const root = path.join(parent, 'repo'), directory = path.join(parent, 'records');
  await fs.mkdir(root); await fs.mkdir(directory, { mode: 0o700 });
  const execute = promisify(execFile);
  const git = async (...args) => (await execute('git', args, { cwd: root, windowsHide: true,
    env: { PATH: process.env.PATH, HOME: parent, GIT_CONFIG_NOSYSTEM: '1', ...(process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) } })).stdout.trim();
  await git('init'); await git('config', 'user.name', 'Synthetic Tester'); await git('config', 'user.email', 'tester@example.invalid');
  if (directoryScope) {
    await fs.mkdir(path.join(root, 'tests')); await fs.mkdir(path.join(root, 'tests-other'));
    await fs.writeFile(path.join(root, 'tests', 'helper.mjs'), 'export const value = 1;\n');
    await fs.writeFile(path.join(root, 'tests-other', 'outside.mjs'), 'throw new Error("outside approval");\n');
    await fs.writeFile(path.join(root, 'unapproved.mjs'), 'throw new Error("outside approval");\n');
  }
  const testPath = directoryScope ? 'tests/check.mjs' : 'check.mjs';
  await fs.writeFile(path.join(root, testPath), 'import assert from "node:assert/strict"; assert.equal(1,1);\n');
  await git('add', '.'); await git('commit', '-m', 'synthetic committed fixture');
  const sourceSha = await git('rev-parse', 'HEAD');
  const source = await exportCursorCiSource({ root, sourceSha, directory: parent, paths: [directoryScope ? 'tests' : testPath] });
  const context = { session: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', generation: 1 }, taskId: 'task', sourceSha, ciTodoRef: 'todo', references: { todo: 'v1' },
    commands: ['node --test'], tester: { sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nativeSessionId: 'native', deliveryId: 'delivery', workerPid: process.pid } };
  const policy = { docker: process.execPath, socket: path.join(parent, 'synthetic.sock'), daemonId: 'synthetic-daemon', imageId,
    imageEnvironment: ['PATH=/usr/bin:/bin', 'NODE_VERSION=24'], tests: [{ id: 'check', todoId: 'todo-one', commandLabel: 'node --test', argv: ['--test', ...(tap ? ['--test-reporter=tap'] : []), `/source/${testPath}`] }],
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
  await setup?.({ directory, context, policy, ciTodo });
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

const passingTap = 'TAP version 13\n# Subtest: fixed check\nok 1 - fixed check\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n';
async function proofFixture(t, { directoryScope = false } = {}) {
  let store, ci, taskKey;
  const sent = [];
  const f = await fixture(t, { tap: true, directoryScope, setup: async ({ directory, context, ciTodo }) => {
    store = new ProtocolStore(path.join(directory, 'synthetic-core'));
    const device = { repositoryId: 'synthetic-repo', deviceId: 'synthetic-device', agentId: context.session.id, role: 'device' };
    ci = { ...device, agentId: context.tester.sessionId, role: 'ci', bindings: { [context.session.id]: 'synthetic-worktree' } };
    await store.handle(device, { v: 2, id: 'fixture-bind', type: 'session.bind', payload: {
      sessionId: context.session.id, agentId: context.session.id, worktreeId: 'synthetic-worktree', expectedBindingVersion: '' } }, { verifyBinding: () => true });
    const todo = (await store.handle(ci, { v: 2, id: 'fixture-todo', type: 'object.put', session: context.session,
      payload: { ref: context.ciTodoRef, baseVersion: '', kind: 'ciTodo', content: ciTodo.content } })).data;
    context.references[context.ciTodoRef] = todo.version; ciTodo.version = todo.version;
    taskKey = scopedObjectKey(ci, context.session, 'task:task');
    // Explicit synthetic authority: real Core reducers, not a real user approval.
    await store.transaction(state => { state.tasks[taskKey] = { id: 'task', repositoryId: device.repositoryId, session: context.session,
      stage: 'testing', version: 'synthetic', busy: true, sourceSha: context.sourceSha,
      handoff: { ciTodoRef: context.ciTodoRef, unitTestRefs: [] }, references: context.references }; });
  } });
  f.state.stdout = passingTap;
  const approvedPlan = { ref: 'synthetic-approved-plan', version: 'synthetic-plan-version', approvalReceiptId: 'synthetic-approval',
    sourceSha: 'e'.repeat(40), paths: [directoryScope ? 'tests' : 'check.mjs'] }; // Plan baseline differs from the final handoff SHA.
  const commit = async (message, { expectedEvidence } = {}) => {
    sent.push(structuredClone(message));
    const result = (await store.handle(ci, message, { authorize: (state, principal, input) => {
      if (input.type === 'ci.result') assertCursorCiHostEvidence(state, principal, input, expectedEvidence);
    } })).data;
    if (f.state.lostAck === message.type) { f.state.lostAck = null; throw Object.assign(new Error('synthetic lost ACK'), { code: 'CI_CONNECTION_UNAVAILABLE' }); }
    return result;
  };
  const proof = createCursorCiHostProof({ runner: f.runner, approvedPlan, ciTodo: f.ciTodo, commit });
  const proposal = observed => ({ v: 2, id: 'original-result', type: 'ci.result', session: f.context.session,
    payload: { taskId: f.context.taskId, sourceSha: f.context.sourceSha, verdict: observed.status,
      checks: [{ testId: observed.testId, todoId: observed.todoId, status: observed.status, evidenceRef: observed.evidenceRef,
        ...(observed.reproductionRef ? { reproductionRef: observed.reproductionRef } : {}) }] } });
  return { ...f, proof, store, ci, taskKey, sent, proposal, approvedPlan, commit };
}

test('host proof accepts expanded original Plan directory scope but rejects unapproved or uncovered paths', async t => {
  const f = await proofFixture(t, { directoryScope: true });
  assert.deepEqual(Object.keys(f.source.manifest.files), ['tests/check.mjs', 'tests/helper.mjs']);
  assert.equal(await fs.stat(path.join(f.source.snapshot, 'tests-other')).then(() => true, error => {
    assert.equal(error.code, 'ENOENT'); return false;
  }), false, 'adjacent path prefix is not an approved directory');
  const observed = await f.proof.runTest({ id: 'request', testId: 'check' });
  assert.equal(observed.status, 'passed');
  const receipt = await f.proof.submitVerifiedResult(f.proposal(observed));
  assert.equal(receipt.verdict, 'passed');
  const evidence = f.sent.find(message => message.type === 'object.put').payload.content;
  assert.deepEqual(evidence.approvedPlan.paths, ['tests'], 'keep original directory approval, not reconstructed file claims');
  assert.deepEqual(evidence.argv, ['--test', '--test-reporter=tap', '/source/tests/check.mjs']);
  for (const paths of [['elsewhere'], ['tests/check.mjs'], ['tests', 'tests-other'], ['tests', 'missing'],
    ['.'], ['../tests'], ['.codex'], ['tests/.env']]) {
    assert.throws(() => createCursorCiHostProof({ runner: f.runner, ciTodo: f.ciTodo, commit: f.commit,
      approvedPlan: { ...f.approvedPlan, paths } }), { code: 'CI_PROOF_CONFIG_INVALID' });
  }
});

test('host proof rejects zero discovery, skips, cancellation, partial and inconsistent TAP', async () => {
  assert.equal(cursorCiNodeTapPassed({ exitCode: 0, stdout: passingTap, stderr: '' }), true);
  for (const stdout of [passingTap.replace('# tests 1', '# tests 0'), passingTap.replace('# skipped 0', '# skipped 1'),
    passingTap.replace('# cancelled 0', '# cancelled 1'), passingTap.replace('# todo 0', '# todo 1'),
    passingTap.replace('# fail 0', '# fail 1'), passingTap.replace('ok 1 -', 'not ok 1 -'),
    passingTap.replace('1..1', '1..2'), passingTap.replace('# pass 1', '# pass 2'),
    passingTap.replace('# pass 1', '# pass 1\n# pass 1'), passingTap.replace('# tests 1\n', ''),
    passingTap.replace('ok 1 - fixed check', 'ok 2 - fixed check'), 'arbitrary test output']) {
    assert.equal(cursorCiNodeTapPassed({ exitCode: 0, stdout, stderr: '' }), false, stdout);
  }
  assert.equal(cursorCiNodeTapPassed({ exitCode: 3, stdout: passingTap, stderr: '' }), false);
  assert.equal(cursorCiNodeTapPassed({ exitCode: 0, stdout: passingTap, stderr: 'unaccounted error' }), false);
});

test('host proof TAP policy accepts actual Node reporter output rather than only handwritten fixtures', async t => {
  const f = await fixture(t, { tap: true });
  const output = await promisify(execFile)(process.execPath, ['--test', '--test-reporter=tap', path.join(f.source.snapshot, 'check.mjs')],
    { env: { PATH: process.env.PATH, ...(process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) }, windowsHide: true });
  assert.equal(cursorCiNodeTapPassed({ exitCode: 0, ...output }), true);
});

test('host proof requires approved paths, fixed Node reporter and complete numbered CI TODO coverage', async t => {
  const f = await proofFixture(t), options = { runner: f.runner, approvedPlan: f.approvedPlan, ciTodo: f.ciTodo, commit: f.commit };
  for (const approvedPlan of [{ ...f.approvedPlan, approvalReceiptId: '' }, { ...f.approvedPlan, paths: ['other.mjs'] },
    { ...f.approvedPlan, paths: ['check.mjs', 'check.mjs'] }]) {
    assert.throws(() => createCursorCiHostProof({ ...options, approvedPlan }), { code: 'CI_PROOF_CONFIG_INVALID' });
  }
  for (const ciTodo of [{ ...f.ciTodo, version: 'not-current' }, { ...f.ciTodo, content: { items: [{ id: 'todo-one' }, { id: 'uncovered' }] } },
    { ...f.ciTodo, content: { items: [{ id: 'todo-one' }, { id: 'todo-one' }] } }]) {
    assert.throws(() => createCursorCiHostProof({ ...options, ciTodo }), { code: 'CI_PROOF_CONFIG_INVALID' });
  }
  const noReporter = await fixture(t);
  assert.throws(() => createCursorCiHostProof({ ...options, runner: noReporter.runner }), { code: 'CI_PROOF_CONFIG_INVALID' });
  assert.equal(f.state.calls.length, 0); assert.equal(noReporter.state.calls.length, 0);
});

test('host proof persists actual runner evidence and replays a lost original Core write without rerunning', async t => {
  const f = await proofFixture(t); f.state.lostAck = 'object.put';
  await assert.rejects(f.proof.runTest({ id: 'request', testId: 'check' }), { code: 'CI_CONNECTION_UNAVAILABLE' });
  const observed = await f.proof.runTest({ id: 'request', testId: 'check' });
  assert.equal(observed.status, 'passed'); assert.ok(observed.evidenceVersion);
  assert.equal(f.sent.length, 2); assert.deepEqual(f.sent[0], f.sent[1]);
  assert.equal(f.state.calls.filter(args => args[0] === 'start').length, 1);
  const saved = (await f.store.handle(f.ci, { v: 2, id: 'read-host-fixture', type: 'object.read', session: f.context.session,
    payload: { ref: observed.evidenceRef, version: observed.evidenceVersion } })).data;
  assert.equal(saved.content.observation.containerId, containerId); assert.equal(saved.content.sourceSha, f.context.sourceSha);
  assert.equal(saved.content.approvedPlan.sourceSha, 'e'.repeat(40));
  f.state.revoked = true;
  await assert.rejects(f.proof.runTest({ id: 'request', testId: 'check' }), { code: 'CI_AUTHORIZATION_REJECTED' });
});

test('host proof keeps original result ID and payload after lost terminal ACK and rejects any changed proposal', async t => {
  const f = await proofFixture(t), observed = await f.proof.runTest({ id: 'request', testId: 'check' }), message = f.proposal(observed);
  f.state.lostAck = 'ci.result';
  await assert.rejects(f.proof.submitVerifiedResult(message), { code: 'CI_CONNECTION_UNAVAILABLE' });
  assert.equal((await f.store.transaction(state => state.tasks[f.taskKey], { readOnly: true })).stage, 'awaiting-merge');
  // Recreate the host publisher over the exact private ledger, not the model loop.
  const restored = createCursorCiHostProof({ runner: f.runner, approvedPlan: f.approvedPlan, ciTodo: f.ciTodo, commit: f.commit });
  const receipt = await restored.submitVerifiedResult(message);
  assert.equal(receipt.stage, 'awaiting-merge'); assert.deepEqual(await restored.submitVerifiedResult(message), receipt);
  assert.deepEqual(f.sent.filter(value => value.type === 'ci.result'), [message, message]);
  await assert.rejects(restored.submitVerifiedResult({ ...message, id: 'another-result' }), { code: 'CI_RESULT_ALREADY_PENDING' });
  await assert.rejects(restored.submitVerifiedResult({ ...message, payload: { ...message.payload, verdict: 'incomplete' } }), { code: 'ID_REUSED' });
  await assert.rejects(restored.runTest({ id: 'request', testId: 'check' }), { code: 'CI_RESULT_ALREADY_PENDING' });
  f.state.revoked = true;
  await assert.rejects(restored.submitVerifiedResult(message), { code: 'CI_AUTHORIZATION_REJECTED' });
});

test('host proof original Core transaction rejects host evidence changed after the observed receipt', async t => {
  const f = await proofFixture(t), observed = await f.proof.runTest({ id: 'request', testId: 'check' });
  await f.store.handle(f.ci, { v: 2, id: 'synthetic-evidence-drift', type: 'object.put', session: f.context.session,
    payload: { ref: observed.evidenceRef, baseVersion: observed.evidenceVersion, kind: 'evidence', content: { observation: 'different evidence' } } });
  await assert.rejects(f.proof.submitVerifiedResult(f.proposal(observed)), { code: 'CI_EVIDENCE_CHANGED' });
  assert.equal((await f.store.transaction(state => state.tasks[f.taskKey], { readOnly: true })).stage, 'testing');
  assert.equal(f.state.calls.filter(args => args[0] === 'start').length, 1);
});

test('host proof original Core transaction rejects changed content even with the same recorded version', async t => {
  const f = await proofFixture(t), observed = await f.proof.runTest({ id: 'request', testId: 'check' });
  await f.store.transaction(state => {
    const object = state.objects[scopedObjectKey(f.ci, f.context.session, observed.evidenceRef)];
    object.versions[observed.evidenceVersion].content.observation.exitCode = 7; // Synthetic corruption, not an API write.
  });
  await assert.rejects(f.proof.submitVerifiedResult(f.proposal(observed)), { code: 'CI_EVIDENCE_CHANGED' });
  assert.equal((await f.store.transaction(state => state.tasks[f.taskKey], { readOnly: true })).stage, 'testing');
});

test('host proof rejects forged or misattributed checks and never promotes skipped output to passed', async t => {
  const f = await proofFixture(t); f.state.stdout = passingTap.replace('# skipped 0', '# skipped 1');
  const observed = await f.proof.runTest({ id: 'request', testId: 'check' });
  assert.equal(observed.status, 'incomplete');
  const correct = f.proposal(observed);
  for (const change of [{ evidenceRef: `ci:${f.context.tester.sessionId}:forged` }, { todoId: 'not-handed-off' },
    { testId: 'not-run' }, { status: 'passed' }]) {
    const forged = { ...correct, payload: { ...correct.payload, verdict: 'passed', checks: [{ ...correct.payload.checks[0], ...change }] } };
    await assert.rejects(f.proof.submitVerifiedResult(forged), { code: 'CI_TEST_PROOF_INVALID' });
  }
  assert.equal(f.sent.some(value => value.type === 'ci.result'), false);
  assert.equal((await f.proof.submitVerifiedResult(correct)).stage, 'ci-failed');
});

test('host proof failed execution returns its fixed command evidence as reproduction, never a passed verdict', async t => {
  const f = await proofFixture(t); f.state.exitCode = 1; f.state.stdout = passingTap.replace('ok 1 -', 'not ok 1 -').replace('# pass 1', '# pass 0').replace('# fail 0', '# fail 1');
  const observed = await f.proof.runTest({ id: 'request', testId: 'check' });
  assert.equal(observed.status, 'failed'); assert.equal(observed.reproductionRef, observed.evidenceRef);
  assert.equal((await f.proof.submitVerifiedResult(f.proposal(observed))).stage, 'ci-failed');
  assert.equal(f.state.calls.filter(args => args[0] === 'start').length, 1);
});

test('MCP test and verified result use private host publication while ordinary model result exchange stays denied', async t => {
  const f = await proofFixture(t), ordinary = [];
  const bridge = await startCursorCiMcp({ client: { context: async () => ({ mode: 'ci', ...f.context }),
    exchange: async message => { ordinary.push(message); throw Object.assign(new Error('model result denied'), { code: 'CI_TEST_PROOF_REQUIRED' }); } },
    testerSessionId: f.context.tester.sessionId, nativeSessionId: f.context.tester.nativeSessionId,
    source: f.source, tests: ['check'], ...f.proof });
  t.after(() => bridge.close());
  const rpc = async (method, params, id = 'rpc') => {
    const response = await fetch(bridge.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridge.credential}` },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id ? { id } : {}), method, ...(params ? { params } : {}) }) });
    assert.ok([200, 202].includes(response.status)); return response.status === 202 ? null : response.json();
  };
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-native', version: '1' } });
  await rpc('notifications/initialized', undefined, null);
  const result = await rpc('tools/call', { name: 'context_guard_test', arguments: { id: 'request', testId: 'check' } });
  const message = f.proposal(result.result.structuredContent), { session, v, ...args } = message;
  const accepted = await rpc('tools/call', { name: 'context_guard_exchange', arguments: args });
  assert.equal(accepted.result.structuredContent.stage, 'awaiting-merge'); assert.equal(ordinary.length, 0);
  assert.deepEqual(f.sent.find(value => value.type === 'ci.result'), message);
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
