import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CursorRuntime, cursorEnvironment } from '../scripts/workbench/cursor-runtime.mjs';
import { ProtocolDelivery } from '../scripts/workbench/protocol-delivery.mjs';
import { readJSON, atomicWrite, encode, hash, pause } from '../scripts/shared/io.mjs';
import { canonical, validateMessage } from '../scripts/shared/protocol.mjs';
import { resolveProject } from '../scripts/workbench/project.mjs';
import { pythonCommand } from '../.github/scripts/python-command.mjs';
import { fileURLToPath } from 'node:url';
import { ClaudeRuntime } from '../scripts/workbench/claude-runtime.mjs';
import { registeredExecutorCreation } from '../scripts/workbench/server.mjs';

for (const role of ['executor', 'ci']) {
  test(`Cursor ${role} worker keeps tool grants separate from the other role`, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-worker-permission-'));
    const root = path.join(directory, 'source'); await fs.mkdir(root);
    const execute = promisify(execFile);
    const git = async (...args) => (await execute('git', args, { cwd: root, windowsHide: true })).stdout.trim();
    await git('init', '-b', 'main');
    await fs.writeFile(path.join(root, '.gitignore'), '.codex/\n');
    await fs.writeFile(path.join(root, 'source.txt'), 'unchanged\n');
    await git('add', '.gitignore', 'source.txt');
    await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'permission fixture');
    const sourceSha = await git('rev-parse', 'HEAD'), executorSessionId = randomUUID(), sessionId = randomUUID();
    const options = [{ optionId: 'always', kind: 'allow_always' }, { optionId: 'once', kind: 'allow_once' }, { optionId: 'deny', kind: 'reject_once' }];
    const requests = [
      { toolCall: { toolCallId: 'write', kind: 'edit', content: [{ type: 'diff', path: path.join(root, 'source.txt'), oldText: 'unchanged\n', newText: 'changed\n' }] }, options },
      { toolCall: { toolCallId: 'shell', kind: 'execute', title: 'node --test', rawInput: { command: 'node --test' } }, options },
      { toolCall: { toolCallId: 'outside', kind: 'read', locations: [{ path: path.join(directory, 'outside.txt') }] }, options },
      { toolCall: { toolCallId: 'question', kind: 'other' }, options },
      { options },
    ];
    const decisions = [];
    // Only the native transport is substituted; the actual worker installs and
    // invokes its permission callback. No vendor or filesystem sandbox claim.
    const native = { initialized: false, sessionId, child: { pid: process.pid },
      async connect() { this.initialized = true; return { sessionId }; },
      async prompt() {
        for (const request of requests) decisions.push(await this.requestPermission({ sessionId, ...request }));
        return { stopReason: 'end_turn' };
      }, async close() {},
    };
    const runtime = new CursorRuntime(path.join(directory, 'runtime'), { acpFactory: () => native });
    t.after(() => runtime.close()); // Preserve isolated files under the user's no-deletion instruction.
    if (role === 'ci') await runtime.configure(executorSessionId, { command: process.execPath, root: directory, name: 'Executor' });
    await runtime.provision({ operationId: 'permission-task', sessionId, config: {
      command: process.execPath, root, name: 'Permission fixture', role,
      permissionPolicy: 'allow-once', permissionsApproved: true,
      ...(role === 'ci' ? { executorSessionId, ciCommands: ['node --test'] } : {}),
    } });
    await runtime.deliver({ id: 'permission-turn', sessionId, root, message: 'Inspect assigned code',
      ...(role === 'ci' ? { execution: { session: { id: executorSessionId, generation: 1 }, taskId: 'permission-task', sourceSha } } : {}),
    });
    const jobFile = runtime.jobFile(sessionId, 'permission-turn'), deadline = Date.now() + 5000;
    while (!['finished', 'failed', 'interrupted'].includes((await readJSON(jobFile)).state)) {
      assert.ok(Date.now() < deadline, 'worker must finish the permission turn'); await pause(10);
    }
    assert.equal((await readJSON(jobFile)).state, 'finished');
    assert.deepEqual(decisions, Array(requests.length).fill(role === 'ci' ? undefined : 'once'));
    assert.equal(await fs.readFile(path.join(root, 'source.txt'), 'utf8'), 'unchanged\n');
  });
}

test('Cursor Tester retains its independent role and checks the exact Executor handoff without granting direct prompts', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-ci-role-'));
  const execute = promisify(execFile), root = path.join(directory, 'executor'), ciRoot = path.join(directory, 'tester');
  await fs.mkdir(root);
  const git = async (...args) => (await execute('git', args, { cwd: root, windowsHide: true })).stdout.trim();
  await git('init', '-b', 'main');
  await fs.writeFile(path.join(root, 'calculation.txt'), '12 / 3 = 4\n');
  await git('add', 'calculation.txt');
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'isolated source');
  const sha = await git('rev-parse', 'HEAD');
  await git('worktree', 'add', '--detach', ciRoot, sha);
  const runtime = new CursorRuntime(path.join(directory, 'runtime')), executor = randomUUID(), tester = randomUUID();
  runtime.wake = async () => {}; // Only the durable role boundary; no vendor/model replacement claim.
  await runtime.configure(executor, { command: process.execPath, root, name: '开发', role: 'executor' });
  const config = { command: process.execPath, root: ciRoot, name: '独立测试', role: 'ci', executorSessionId: executor, ciCommands: ['node --test'] };
  await assert.rejects(runtime.configure(tester, { ...config, executorSessionId: tester }), { code: 'INVALID_RUNTIME' });
  await assert.rejects(runtime.configure(tester, { ...config, root }), { code: 'INVALID_RUNTIME' });
  await assert.rejects(runtime.configure(tester, { ...config, nativeSessionId: executor }), { code: 'INVALID_RUNTIME' });
  await runtime.configure(tester, config);
  assert.equal((await runtime.status(tester)).role, 'ci');
  assert.deepEqual(await runtime.ciReceiver(executor), { sessionId: tester, root: await fs.realpath(ciRoot) });
  const input = { id: 'exact-handoff', sessionId: tester, root: ciRoot, message: '核对指定提交', execution: {
    session: { id: executor, generation: 1 }, taskId: 'approved-task', sourceSha: sha, ciTodoRef: 'checks', references: {},
  } };
  await assert.rejects(runtime.deliver({ ...input, execution: undefined }), { code: 'CI_ASSIGNMENT_MISMATCH' });
  await assert.rejects(runtime.deliver({ ...input, execution: { ...input.execution, session: { id: randomUUID(), generation: 1 } } }), { code: 'CI_ASSIGNMENT_MISMATCH' });
  await runtime.deliver(input);
  assert.deepEqual(await runtime.ciContext(tester, { verifySource: true }), { ...input.execution, mode: 'ci', commands: ['node --test'] });
  await fs.writeFile(path.join(ciRoot, 'calculation.txt'), 'unverified change\n');
  await assert.rejects(runtime.ciContext(tester, { verifySource: true }), { code: 'CI_SOURCE_CHANGED' });
  assert.equal(await runtime.ciContext(executor), null, 'Executor cannot acquire CI scope by asking for it');
});

test('Cursor environment includes scoped credentials but excludes unrelated parent secrets', () => {
  const env = cursorEnvironment({ CURSOR_API_KEY: 'fixture-key' }, { HOME: '/fixture', PATH: '/bin', CURSOR_API_KEY: 'parent-key', OPENAI_API_KEY: 'unrelated', ANTHROPIC_AUTH_TOKEN: 'unrelated' });
  assert.deepEqual(env, { HOME: '/fixture', PATH: '/bin', CURSOR_API_KEY: 'fixture-key' });
  assert.throws(() => cursorEnvironment({ OPENAI_API_KEY: 'unrelated' }), { code: 'INVALID_ENVIRONMENT' });
  assert.throws(() => cursorEnvironment({ CURSOR_API_KEY: 42 }), { code: 'INVALID_ENVIRONMENT' });
});

test('Cursor delivery pins its workspace/native identity and preserves duplicate receipts on restart', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-delivery-'));
  // 本次用户要求不删除本地文件；隔离现场保留，不触碰个人目录。
  const sessionId = randomUUID(), runtime = new CursorRuntime(path.join(directory, 'runtime'));
  let wakes = 0;
  runtime.wake = async () => { wakes++; }; // No external model; verifies durable delivery intent only.
  await runtime.configure(sessionId, { command: process.execPath, root: directory, name: 'Cursor fixture' });
  assert.equal((await runtime.status(sessionId)).nativeSessionId, sessionId, 'existing binding uses its native conversation, not a guessed/new ID');
  const input = { id: 'first', sessionId, root: directory, platform: 'cursor', message: 'Inspect only' };
  const delivery = new ProtocolDelivery(path.join(directory, 'delivery'), { cursor: runtime });
  const receipt = await delivery.deliver(input);
  assert.equal(receipt.state, 'received'); assert.equal(wakes, 1);
  assert.equal((await runtime.status(sessionId)).status, 'unknown', 'saved intent is not proof of a live model');
  assert.deepEqual(await new ProtocolDelivery(delivery.directory, { cursor: runtime }).deliver(input), receipt);
  assert.equal(wakes, 1);
  await assert.rejects(runtime.deliver({ ...input, message: 'Changed' }), { code: 'ID_REUSED' });
  await assert.rejects(runtime.deliver({ ...input, id: 'parallel' }), { code: 'RUNTIME_BUSY' });
  await assert.rejects(runtime.deliver({ ...input, root: os.tmpdir() }), { code: 'WORKTREE_MISMATCH' });
  await assert.rejects(runtime.configure(sessionId, { command: process.execPath, root: directory, name: 'Change' }), { code: 'RUNTIME_BUSY' });
  const jobFile = runtime.jobFile(sessionId, input.id), job = await readJSON(jobFile);
  await atomicWrite(jobFile, encode({ ...job, state: 'finished', result: { stopReason: 'end_turn', text: 'Actual fixture result' } }));
  const session = await readJSON(runtime.sessionFile(sessionId));
  await atomicWrite(runtime.sessionFile(sessionId), encode({ ...session, active: null }));
  const restarted = new CursorRuntime(runtime.directory); restarted.wake = runtime.wake;
  const status = await restarted.status(sessionId);
  assert.equal(status.status, 'stopped'); assert.equal(status.result.text, 'Actual fixture result');
  await restarted.deliver({ ...input, id: 'follow-up', message: 'Explain that result' });
  assert.equal((await readJSON(restarted.sessionFile(sessionId))).nativeSessionId, sessionId);
  assert.equal(wakes, 2);
});

test('Cursor configuration rejects implicit tool bypass, unsafe paths and cross-session native changes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-config-'));
  // 隔离现场保留，遵守本次任务的无删除约束。
  const runtime = new CursorRuntime(path.join(directory, 'runtime')), sessionId = randomUUID();
  const config = { command: process.execPath, root: directory, name: 'Fixture' };
  await assert.rejects(runtime.configure('../other', config), { code: 'INVALID_SESSION' });
  for (const fields of [{ command: 'agent' }, { environmentFile: 'relative.json' }, { permissionPolicy: 'allow-once' },
    { force: true }, { timeoutMs: 0 }, { root: 'relative' }]) {
    await assert.rejects(runtime.configure(sessionId, { ...config, ...fields }), { code: 'INVALID_RUNTIME' });
  }
  await runtime.configure(sessionId, { ...config, permissionPolicy: 'allow-once', permissionsApproved: true });
  await assert.rejects(runtime.configure(sessionId, { ...config, nativeSessionId: 'different-native' }), { code: 'WORKTREE_MISMATCH' });
  await assert.rejects(runtime.configure(sessionId, { ...config, root: os.tmpdir() }), { code: 'WORKTREE_MISMATCH' });
});

test('Cursor native reports preserve failed output, clip previews and acknowledge only after delivery', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-reports-'));
  const runtime = new CursorRuntime(path.join(directory, 'runtime')), sessionId = randomUUID();
  runtime.wake = async () => {};
  await runtime.configure(sessionId, { command: process.execPath, root: directory, name: 'Reports' });
  const input = { id: 'delivery', sessionId, root: directory, message: 'Task', nativeRequest: { id: 'request', generation: 2 } };
  await assert.rejects(runtime.deliver({ ...input, nativeRequest: { id: 'request', generation: 0 } }), { code: 'INVALID_ARGUMENT' });
  await runtime.deliver(input);
  const jobFile = runtime.jobFile(sessionId, input.id), job = await readJSON(jobFile);
  const resultText = 'x'.repeat(39999) + '😀' + 'Unshown output';
  await atomicWrite(jobFile, encode({ ...job, state: 'interrupted', error: 'CURSOR_INTERRUPTED', result: { text: resultText, stopReason: null } }));
  const session = await readJSON(runtime.sessionFile(sessionId));
  await atomicWrite(runtime.sessionFile(sessionId), encode({ ...session, active: null }));
  const view = await runtime.conversation(sessionId);
  assert.equal(view.status, 'interrupted'); assert.equal(view.messages.length, 2);
  assert.equal(view.messages[1].text, 'x'.repeat(39999)); assert.equal(view.messages[1].truncated, true);
  assert.equal(view.result.truncated, true);
  const reports = await runtime.nativeReports(sessionId);
  assert.equal(reports.length, 1); validateMessage(reports[0].message);
  assert.equal(reports[0].message.payload.status, 'interrupted');
  assert.deepEqual(reports, await new CursorRuntime(runtime.directory).nativeReports(sessionId), 'restart retains the same request/result ID');
  await runtime.acknowledgeReport(reports[0]);
  assert.deepEqual(await runtime.nativeReports(sessionId), []);
  assert.equal((await readJSON(jobFile)).result.text, resultText, 'private native evidence is not truncated');
});

test('Cursor provisioning repairs a saved native creation without inventing or duplicating its Session', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-provision-'));
  const runtime = new CursorRuntime(path.join(directory, 'runtime')), sessionId = randomUUID();
  const config = { command: process.execPath, root: await fs.realpath(directory), name: 'Native-created fixture' };
  const operationId = 'saved-native-creation', file = path.join(runtime.directory, 'creations', hash(operationId) + '.json');
  // Only the recovery boundary is synthesized. Native creation itself is tested against official Cursor separately.
  await atomicWrite(file, encode({ fingerprint: hash(canonical(config)), sessionId, state: 'created' }));
  const first = await runtime.provision({ operationId, config });
  assert.deepEqual(first, { created: true, sessionId, root: config.root });
  assert.equal((await runtime.status(sessionId)).nativeSessionId, sessionId);
  assert.deepEqual(await new CursorRuntime(runtime.directory).provision({ operationId, config }), first);
  const lines = (await fs.readFile(path.join(directory, '.codex/context/sessions.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1); assert.equal(JSON.parse(lines[0]).source, 'cursor-acp-provision');
  await assert.rejects(runtime.provision({ operationId, config: { ...config, name: 'Different' } }), { code: 'ID_REUSED' });
  const uncertain = 'unconfirmed';
  await atomicWrite(path.join(runtime.directory, 'creations', hash(uncertain) + '.json'), encode({ fingerprint: hash(canonical(config)), state: 'creating' }));
  await assert.rejects(runtime.provision({ operationId: uncertain, config }), { code: 'CREATION_UNCERTAIN' });
});

test('Cursor newly provisioned Session keeps its original transport for the first real prompt', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-first-turn-'));
  const sessionId = randomUUID(); let clients = 0, prompts = 0;
  const native = { initialized: false, sessionId, child: { pid: process.pid }, closed: false,
    async connect() { this.initialized = true; return { sessionId }; },
    async prompt(text) { prompts++; await this.onUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Native fixture: ' + text } } }); return { stopReason: 'end_turn' }; },
    async close() { this.closed = true; },
  };
  const runtime = new CursorRuntime(path.join(directory, 'runtime'), { acpFactory: () => { clients++; return native; } });
  const config = { command: process.execPath, root: directory, name: 'Fresh native Session' };
  const created = await runtime.provision({ operationId: 'create', config });
  assert.equal(created.sessionId, sessionId); assert.equal(native.closed, false); assert.equal(prompts, 0, 'creation must not inject a billed bootstrap prompt');
  await assert.rejects(runtime.configure(sessionId, { ...config, model: 'different' }), { code: 'RUNTIME_BUSY' });
  await runtime.deliver({ id: 'first-turn', sessionId, root: directory, message: 'Actual first task' });
  const jobFile = runtime.jobFile(sessionId, 'first-turn'), deadline = Date.now() + 3000;
  for (;;) { if ((await readJSON(jobFile)).state === 'finished') break; assert.ok(Date.now() < deadline); await pause(10); }
  const view = await runtime.conversation(sessionId);
  assert.equal(clients, 1); assert.equal(prompts, 1); assert.equal(native.closed, true);
  assert.equal(view.nativeSessionId, sessionId); assert.equal(view.messages[1].text, 'Native fixture: Actual first task');
  await runtime.close();
});

test('Coordinator reserved Cursor identity stays separate from the native identity and survives restart', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-coordinator-identity-'));
  const sessionId = randomUUID(), nativeSessionId = randomUUID(); let connects = 0;
  const native = { async connect() { connects++; return { sessionId: nativeSessionId }; }, async close() {} };
  const runtime = new CursorRuntime(path.join(directory, 'runtime'), { acpFactory: () => native });
  const config = { command: process.execPath, root: await fs.realpath(directory), name: 'Coordinator Executor' };
  const created = await runtime.provision({ operationId: 'coordinator-request', sessionId, config });
  assert.equal(created.sessionId, sessionId);
  assert.equal((await runtime.status(sessionId)).nativeSessionId, nativeSessionId);
  assert.ok(runtime.pendingNative.has(sessionId), 'first native transport is indexed by the Coordinator identity');
  assert.equal(runtime.pendingNative.has(nativeSessionId), false);
  assert.deepEqual(await runtime.resolveSessionId(nativeSessionId, directory), { sessionId, mapped: true });
  assert.deepEqual(await runtime.resolveSessionId(sessionId, directory), { sessionId, mapped: true });
  const restarted = new CursorRuntime(runtime.directory);
  assert.deepEqual(await restarted.provision({ operationId: 'coordinator-request', sessionId, config }), created);
  assert.deepEqual(await restarted.resolveSessionId(nativeSessionId, directory), { sessionId, mapped: true });
  await assert.rejects(runtime.provision({ operationId: 'coordinator-request', sessionId: randomUUID(), config }), { code: 'ID_REUSED' });
  await assert.rejects(restarted.resolveSessionId(nativeSessionId, os.tmpdir()), { code: 'WORKTREE_MISMATCH' });
  await assert.rejects(runtime.configure(randomUUID(), { ...config, nativeSessionId }), { code: 'NATIVE_SESSION_CONFLICT' });
  assert.deepEqual(await restarted.resolveSessionId('unmanaged-native', directory), { sessionId: 'unmanaged-native', mapped: false });
  assert.equal(connects, 1, 'restart or repeated creation cannot create a replacement native conversation');
  const records = (await fs.readFile(path.join(directory, '.codex/context/sessions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(records.length, 1); assert.equal(records[0].session_id, sessionId);
  await runtime.close();
});

test('Cursor templates create independent worktrees for Coordinator requests and retain the exact creation receipt', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-template-'));
  const execute = promisify(execFile), root = path.join(directory, 'source'); await fs.mkdir(root);
  const git = async (...args) => (await execute('git', args, { cwd: root, windowsHide: true })).stdout.trim();
  await git('init', '-b', 'main');
  await fs.writeFile(path.join(root, 'README.md'), 'Coordinator fixture\n');
  await git('add', 'README.md');
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'main fixture');
  const sha = await git('rev-parse', 'HEAD'), templateSessionId = randomUUID(), sessionId = randomUUID(), nativeSessionId = randomUUID(); let connects = 0;
  const runtime = new CursorRuntime(path.join(directory, 'runtime'), { acpFactory: () => ({ async connect() { connects++; return { sessionId: nativeSessionId }; }, async close() {} }) });
  await runtime.configure(templateSessionId, { command: process.execPath, root, name: 'Template', allowSessionCreation: true });
  const request = { id: hash('coordinator-creation'), templateSessionId, sessionId, name: 'Assigned Executor' };
  const created = await runtime.provisionAssigned(request, { baseRef: 'refs/heads/main' });
  assert.equal(created.sessionId, sessionId); assert.notEqual(created.root, root);
  assert.equal((await execute('git', ['rev-parse', 'HEAD'], { cwd: created.root, windowsHide: true })).stdout.trim(), sha);
  assert.equal((await runtime.status(sessionId)).nativeSessionId, nativeSessionId);
  const receipt = await readJSON(path.join(path.dirname(runtime.sessionFile(sessionId)), 'creation.json'));
  assert.equal(receipt.templateSessionId, templateSessionId); assert.equal(receipt.sha, sha);
  assert.equal((await readJSON(runtime.sessionFile(sessionId))).config.allowSessionCreation, false);
  assert.deepEqual(await runtime.provisionAssigned(request, { baseRef: 'refs/heads/main' }), created);
  await assert.rejects(runtime.provisionAssigned({ ...request, name: 'Different request' }, { baseRef: 'refs/heads/main' }), { code: 'ID_REUSED' });
  await assert.rejects(runtime.provisionAssigned({ ...request, id: hash('other'), sessionId: randomUUID(), templateSessionId: sessionId }, { baseRef: 'refs/heads/main' }), { code: 'CREATION_NOT_ENABLED' });
  assert.equal(connects, 1);
  const ciRoot = path.join(directory, 'independent-tester'); await git('worktree', 'add', '--detach', ciRoot, sha);
  const bindings = new Map([[sessionId, { worktreeRoot: created.root }]]);
  const claude = new ClaudeRuntime(path.join(directory, 'claude-runtime'), {
    executorCreation: id => registeredExecutorCreation([runtime, claude], id, bindings.get(id)),
  });
  const testerId = randomUUID();
  await claude.configure(testerId, { command: process.execPath, root: ciRoot, configDir: path.join(directory, 'tester-profile'),
    environmentFile: path.join(directory, 'provider.json'), name: 'Independent Claude Tester', model: 'fixture',
    role: 'ci', executorSessionId: templateSessionId, ciCommands: ['node --test'] });
  assert.deepEqual(await claude.ciReceiver(sessionId), { sessionId: testerId, root: await fs.realpath(ciRoot) });
  assert.equal(await claude.acceptsCiExecutor((await readJSON(claude.sessionFile(testerId))).config, sessionId), true,
    'a registered Cursor child can use the configured independent Claude Tester');
  bindings.set(sessionId, { worktreeRoot: root });
  await assert.rejects(claude.ciReceiver(sessionId), { code: 'FORBIDDEN' });
  await runtime.close();
});

test('CLI and imported Claude Hook resolve only the saved Cursor native/worktree mapping', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-hook-identity-'));
  const project = await resolveProject(directory), sessionId = randomUUID(), nativeSessionId = randomUUID();
  const runtime = new CursorRuntime(path.join(project.sharedDir, 'cursor-runtime'), { acpFactory: () => ({ async connect() { return { sessionId: nativeSessionId }; }, async close() {} }) });
  await runtime.provision({ operationId: 'coordinator-hook', sessionId, config: { command: process.execPath, root: directory, name: 'Imported Hook Executor' } });
  const execute = promisify(execFile), scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
  const lookup = await execute(process.execPath, [path.join(scripts, 'workbench/cli.mjs'), 'workbench', 'cursor', '--resolve-native', '--root', directory, '--session', nativeSessionId], { windowsHide: true });
  assert.deepEqual(JSON.parse(lookup.stdout), { sessionId, mapped: true });
  const code = `import sys, json\nfrom pathlib import Path\nsys.path.insert(0, sys.argv[1])\nimport context_guard_hook as hook\nctx = Path(sys.argv[2]) / '.codex/context'\npayload = {'session_id': sys.argv[3], 'context_guard_session_id': 'forged', 'role': 'coordinator'}\nprint(json.dumps({'sessionId': hook.session_id(payload, 'claude', ctx, 'session-start')}))`;
  const normalized = await execute(pythonCommand(), ['-c', code, scripts, directory, nativeSessionId], { windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.deepEqual(JSON.parse(normalized.stdout), { sessionId });
  const stored = await readJSON(path.join(directory, '.codex/context/private/hook-sessions.json'));
  assert.equal(stored.claude, sessionId);
  // A duplicate mapping is corruption, not permission to pick the first match.
  const duplicateId = randomUUID();
  await atomicWrite(runtime.sessionFile(duplicateId), encode({ sessionId: duplicateId, nativeSessionId, config: { command: process.execPath, root: project.worktreeRoot, name: 'Corrupt duplicate' } }));
  await assert.rejects(execute(process.execPath, [path.join(scripts, 'workbench/cli.mjs'), 'workbench', 'cursor', '--resolve-native', '--root', directory, '--session', nativeSessionId], { windowsHide: true }), cause => cause.code === 1 && JSON.parse(cause.stdout).error.code === 'NATIVE_SESSION_CONFLICT');
  await runtime.close();
});

test('Two creation operations cannot replace the native transport owned by one Coordinator Session', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-creation-owner-')), sessionId = randomUUID();
  let connects = 0, closes = 0;
  const runtime = new CursorRuntime(path.join(directory, 'runtime'), { acpFactory: () => ({
    async connect() { connects++; return { sessionId: randomUUID() }; }, async close() { closes++; },
  }) });
  const config = { command: process.execPath, root: directory, name: 'One owned Executor' };
  const first = await runtime.provision({ operationId: 'first-owner', sessionId, config });
  const original = runtime.pendingNative.get(sessionId), nativeId = (await runtime.status(sessionId)).nativeSessionId;
  await assert.rejects(runtime.provision({ operationId: 'second-owner', sessionId, config }), { code: 'ID_REUSED' });
  assert.equal(connects, 1, 'reject a second owner before contacting Cursor');
  assert.equal(runtime.pendingNative.get(sessionId), original);
  assert.equal((await runtime.status(sessionId)).nativeSessionId, nativeId);
  assert.deepEqual(await runtime.provision({ operationId: 'first-owner', sessionId, config }), first);
  assert.equal(closes, 0, 'a rejected creation must not close the original transport');
  const raced = randomUUID(), results = await Promise.allSettled(['race-a', 'race-b'].map(operationId => runtime.provision({ operationId, sessionId: raced, config })));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter(item => item.status === 'rejected' && item.reason.code === 'ID_REUSED').length, 1);
  assert.equal(connects, 2, 'concurrent requests may create only one native conversation per logical identity');
  await runtime.close();
});

test('Cursor definite rejection returns a report but never overwrites an accepted or busy native delivery', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-rejected-'));
  const runtime = new CursorRuntime(path.join(directory, 'runtime')), sessionId = randomUUID();
  const input = { id: 'not-configured', sessionId, root: directory, message: 'Task', nativeRequest: { id: 'request', generation: 1 } };
  assert.equal((await runtime.rejectNative(input, 'RUNTIME_NOT_CONFIGURED')).recorded, true);
  assert.equal((await runtime.nativeReports(sessionId))[0].message.payload.error, 'RUNTIME_NOT_CONFIGURED');
  await assert.rejects(runtime.rejectNative({ ...input, id: 'busy' }, 'RUNTIME_BUSY'), { code: 'INVALID_ARGUMENT' });
  assert.equal((await runtime.nativeReports(sessionId)).length, 1);
  await runtime.configure(sessionId, { command: process.execPath, root: directory, name: 'Configured fixture' }); runtime.wake = async () => {};
  const accepted = { ...input, id: 'accepted', nativeRequest: { id: 'accepted-request', generation: 1 } };
  await runtime.deliver(accepted);
  const before = await readJSON(runtime.jobFile(sessionId, accepted.id));
  assert.equal((await runtime.rejectNative(accepted, 'CURSOR_START_FAILED')).preserved, true);
  assert.deepEqual(await readJSON(runtime.jobFile(sessionId, accepted.id)), before);
  assert.equal((await runtime.nativeReports(sessionId)).length, 1);
});
