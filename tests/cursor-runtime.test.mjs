import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { CursorRuntime, cursorEnvironment } from '../scripts/workbench/cursor-runtime.mjs';
import { ProtocolDelivery } from '../scripts/workbench/protocol-delivery.mjs';
import { readJSON, atomicWrite, encode, hash, pause } from '../scripts/shared/io.mjs';
import { canonical, validateMessage } from '../scripts/shared/protocol.mjs';

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
