import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { MAX_MESSAGE_BYTES } from '../scripts/shared/protocol.mjs';

const moduleUrl = new URL('../scripts/workbench/cursor-ci-channel.mjs', import.meta.url);
let channel;
try { channel = await import(moduleUrl.href); }
catch (cause) { if (cause.code !== 'ERR_MODULE_NOT_FOUND' || !cause.message.includes('cursor-ci-channel.mjs')) throw cause; }
const required = () => { assert.equal(typeof channel?.bindCursorCiClient, 'function', 'Owning CI worker needs a fixed original-task client'); return channel; };
const tester = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', executor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const scope = pid => ({ mode: 'ci', session: { id: executor, generation: 2 }, taskId: 'original-task', sourceSha: 'c'.repeat(40),
  ciTodoRef: 'original-todo', references: { 'original-todo': 'todo-v3', 'original-plan': 'plan-v2' }, commands: ['approved-test'],
  tester: { sessionId: tester, nativeSessionId: 'native-tester', deliveryId: 'original-delivery', workerPid: pid } });
const message = ref => ({ v: 2, id: randomUUID(), type: 'object.put', session: scope(1).session,
  payload: { kind: 'evidence', ref, baseVersion: '', content: { output: 'synthetic observation' } } });
async function fixture(pid = process.pid) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-ci-channel-')));
  const state = { context: scope(pid), binding: { epoch: 'backend-one', bindingVersion: 'binding-v1', worktreeId: 'tester-tree', generation: 1,
    sessionId: tester, nativeSessionId: 'native-tester', root }, reads: 0, exchanges: [] };
  const client = { async context() { state.reads++; return structuredClone(state.context); },
    async exchange(input) { state.exchanges.push(input); return { received: input.id }; } };
  const options = { client, readBinding: async () => structuredClone(state.binding), testerSessionId: tester,
    nativeSessionId: 'native-tester', deliveryId: 'original-delivery', workerPid: pid, root };
  return { root, state, options };
}

test('CI host client fixes task, binding, native ID and owning PID before any exchange', async t => {
  const { bindCursorCiClient } = required(), f = await fixture();
  const client = await bindCursorCiClient(f.options); t.after(() => client.close());
  assert.deepEqual(await client.context(), scope(process.pid));
  const input = message(`ci:${tester}:observation`);
  assert.deepEqual(await client.exchange(input), { received: input.id });
  assert.deepEqual(f.state.exchanges, [input]);
  f.state.binding.bindingVersion = 'binding-v2';
  await assert.rejects(client.exchange(input), { code: 'CI_TASK_CHANGED' });
  f.state.binding.bindingVersion = 'binding-v1';
  await assert.rejects(client.context(), { code: 'CI_CAPABILITY_EXPIRED' });
  assert.equal(f.state.exchanges.length, 1, 'a cached receipt cannot revive a revoked worker');
  assert.equal(client.signal.aborted, true);
});

test('CI host client refuses unassigned references, reserved proof writes and model result claims', async t => {
  const { bindCursorCiClient } = required(), f = await fixture(), client = await bindCursorCiClient(f.options);
  t.after(() => client.close());
  const read = { v: 2, id: randomUUID(), type: 'object.read', session: scope(1).session, payload: { ref: 'original-todo', version: 'todo-v3' } };
  await client.exchange(read);
  for (const payload of [{ ref: 'other-todo', version: 'todo-v3' }, { ref: 'original-todo', version: 'old-version' }]) {
    await assert.rejects(client.exchange({ ...read, id: randomUUID(), payload }), { code: 'CI_MESSAGE_FORBIDDEN' });
  }
  for (const ref of [`ci:${executor}:observation`, `ci:${tester}:host:proof`]) {
    await assert.rejects(client.exchange(message(ref)), { code: 'CI_MESSAGE_FORBIDDEN' });
  }
  const result = { v: 2, id: randomUUID(), type: 'ci.result', session: scope(1).session,
    payload: { taskId: 'original-task', sourceSha: 'c'.repeat(40), verdict: 'passed', checks: [{ testId: 'approved-test', todoId: 'one', status: 'passed', evidenceRef: `ci:${tester}:observation` }] } };
  await assert.rejects(client.exchange(result), { code: 'CI_TEST_PROOF_REQUIRED' });
  await assert.rejects(client.context({ ciResult: true }), { code: 'CI_TEST_PROOF_REQUIRED' });
  assert.equal(f.state.exchanges.length, 1);
});

test('CI host client rejects identity drift and does not renew its initial deadline', async t => {
  const { bindCursorCiClient } = required();
  for (const alter of [f => { f.state.context.tester.workerPid++; }, f => { f.state.context.tester.nativeSessionId = 'foreign'; },
    f => { f.state.context.tester.deliveryId = 'foreign'; }, f => { f.state.binding.root = path.dirname(f.root); }]) {
    const f = await fixture(); alter(f);
    await assert.rejects(bindCursorCiClient(f.options), { code: 'CI_NATIVE_MISMATCH' });
    assert.equal(f.state.exchanges.length, 0);
  }
  let now = 1000;
  const f = await fixture(), client = await bindCursorCiClient({ ...f.options, now: () => now, ttlMs: 100 });
  t.after(() => client.close()); now = 1100;
  await assert.rejects(client.context(), { code: 'CI_CAPABILITY_EXPIRED' });
  now = 1000;
  await assert.rejects(client.context(), { code: 'CI_CAPABILITY_EXPIRED' });
});

test('closing a CI client during original authorization rejects a late success', async t => {
  const { bindCursorCiClient } = required(), f = await fixture();
  let release, entered;
  const waiting = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const client = await bindCursorCiClient(f.options); t.after(() => client.close());
  f.options.client.context = async () => { entered(); await waiting; return scope(process.pid); };
  const operation = client.context(), rejection = assert.rejects(operation, { code: 'CI_CAPABILITY_EXPIRED' });
  await started; client.close(); release(); await rejection;
  assert.equal(client.signal.aborted, true);
});

test('binding changes while the original authorization is pending cannot grant a late read', async t => {
  const { bindCursorCiClient } = required(), f = await fixture();
  const client = await bindCursorCiClient(f.options); t.after(() => client.close());
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), waiting = new Promise(resolve => { release = resolve; });
  f.options.client.context = async () => { entered(); await waiting; return scope(process.pid); };
  const pending = client.context(), rejected = assert.rejects(pending, { code: 'CI_TASK_CHANGED' });
  await started; f.state.binding.epoch = 'restarted-backend'; release(); await rejected;
  assert.equal(client.signal.aborted, true); assert.equal(f.state.exchanges.length, 0);
});

async function workerFixture(t, program, options = {}) {
  const api = required(), f = await fixture();
  const { hostCredential, beforeOpen, ...transportOptions } = options;
  if (hostCredential) {
    f.options.client.credential = hostCredential;
    f.state.context.hostCredential = hostCredential;
  }
  const file = path.join(f.root, 'own-worker.mjs');
  await fs.writeFile(file, `import { connectCursorCiWorkerClient } from ${JSON.stringify(moduleUrl.href)};\n${program}`, { flag: 'wx', mode: 0o600 });
  const worker = spawn(process.execPath, [file], { cwd: f.root, windowsHide: true,
    env: { PATH: process.env.PATH, HOME: f.root, ...(process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '', diagnostics = ''; worker.stdout.on('data', bytes => { output += bytes; }); worker.stderr.on('data', bytes => { diagnostics += bytes; });
  // Node 24 parent-initiated IPC disconnect can omit ChildProcess 'close'.
  // Require the real exit AND both fully drained stdio streams, not a timeout
  // or disappearance of a PID. IPC closure is separately asserted below.
  const exited = Promise.all([once(worker, 'exit'), finished(worker.stdout, { cleanup: true }), finished(worker.stderr, { cleanup: true })])
    .then(([result]) => { assert.equal(worker.connected, false); return result; });
  let opens = 0, produced;
  const opened = new Promise(resolve => { produced = resolve; });
  const bridge = api.serveCursorCiWorker({ worker, openClient: async pid => {
    opens++; assert.equal(pid, worker.pid, 'parent derives ownership from its own ChildProcess');
    f.state.context.tester.workerPid = pid;
    await beforeOpen?.();
    const client = await api.bindCursorCiClient({ ...f.options, workerPid: pid }); produced(client); return client;
  }, ...transportOptions });
  t.after(async () => { bridge.close(); if (worker.exitCode === null && worker.signalCode === null) worker.kill(); await exited; });
  return { ...f, worker, bridge, exited, opened, output: () => output, diagnostics: () => diagnostics, opens: () => opens };
}

test('real owning Node IPC exchanges fixed task messages without transmitting host credentials', async t => {
  const secret = `SYNTHETIC_HOST_ONLY_${randomUUID()}`;
  const f = await workerFixture(t, `const client = connectCursorCiWorkerClient();
const context = await client.context();
const reply = await client.exchange(${JSON.stringify(message(`ci:${tester}:observation`))});
console.log(JSON.stringify({ context, reply, environmentNames: Object.keys(process.env) }));
client.close();`, { hostCredential: secret });
  const [code, signal] = await f.exited;
  assert.equal(code, 0, f.diagnostics()); assert.equal(signal, null);
  const result = JSON.parse(f.output());
  assert.equal(f.options.client.credential, secret, 'the backend really holds a canary unknown to the worker');
  assert.deepEqual(result.context, scope(f.worker.pid));
  assert.equal(result.environmentNames.includes('CURSOR_API_KEY'), false);
  assert.equal(f.opens(), 1); assert.equal(f.state.exchanges.length, 1);
  assert.equal(result.reply.received, f.state.exchanges[0].id);
  assert.equal(f.output().includes(secret), false);
});

test('malformed or foreign IPC cannot bootstrap or invoke a business operation', async t => {
  for (const input of [{ channel: 'foreign', v: 1, id: randomUUID(), type: 'context', payload: {} },
    { channel: 'context-guard-cursor-ci', v: 1, id: randomUUID(), type: 'fetch', payload: { url: 'https://foreign.invalid' } },
    { channel: 'context-guard-cursor-ci', v: 1, id: randomUUID(), type: 'context', payload: {}, workerPid: 42 }]) {
    const f = await workerFixture(t, `process.on('disconnect', () => process.exit(0)); process.send(${JSON.stringify(input)});`);
    const [code] = await f.exited; assert.equal(code, 0, f.diagnostics());
    assert.equal(f.opens(), 0); assert.equal(f.state.exchanges.length, 0);
  }
});

test('host disconnect permanently aborts the owning IPC client', async t => {
  const f = await workerFixture(t, `const client = connectCursorCiWorkerClient();
await client.context(); console.log('READY');
await new Promise(resolve => client.signal.addEventListener('abort', resolve, { once: true }));
try { await client.context(); throw new Error('Unexpected restored channel'); } catch (error) { console.log(error.code); }
client.close();`);
  const deadline = Date.now() + 10000;
  while (!f.output().includes('READY')) {
    assert.ok(Date.now() < deadline, 'own worker must reach an observable ready state');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.worker.exitCode, null, f.diagnostics());
  }
  f.bridge.close();
  const [code] = await f.exited; assert.equal(code, 0, f.diagnostics());
  assert.match(f.output(), /CI_CHANNEL_CLOSED/);
  assert.equal(f.state.exchanges.length, 0); assert.equal(f.opens(), 1);
});

test('closing during IPC bootstrap revokes the late client without sending a task grant', async t => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), waiting = new Promise(resolve => { release = resolve; });
  const f = await workerFixture(t, `const client = connectCursorCiWorkerClient();
try { await client.context(); console.log('UNEXPECTED_GRANT'); } catch (error) { console.log(error.code); }
client.close();`, { beforeOpen: async () => { entered(); await waiting; } });
  await started; f.bridge.close();
  const [code] = await f.exited; assert.equal(code, 0, f.diagnostics());
  release();
  const late = await f.opened;
  if (!late.signal.aborted) await new Promise(resolve => late.signal.addEventListener('abort', resolve, { once: true }));
  assert.equal(late.signal.aborted, true, 'a late host client is permanently revoked');
  assert.match(f.output(), /CI_CHANNEL_CLOSED/); assert.doesNotMatch(f.output(), /UNEXPECTED_GRANT/);
  assert.equal(f.state.exchanges.length, 0); assert.equal(f.opens(), 1);
});

test('duplicate, excessive or oversize raw IPC is closed before any evidence exchange', async t => {
  for (const kind of ['duplicate', 'concurrent', 'oversize']) {
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    const input = { channel: 'context-guard-cursor-ci', v: 1, id: randomUUID(), type: 'context', payload: {} };
    const program = `process.on('disconnect',()=>process.exit(0));
const input=${JSON.stringify(input)};
${kind === 'duplicate' ? 'process.send(input);process.send(input);' : kind === 'concurrent'
      ? `for(const id of ${JSON.stringify(Array.from({ length: 5 }, () => randomUUID()))}) process.send({...input,id});`
      : `const payload=${JSON.stringify(message(`ci:${tester}:observation`))}; payload.payload.content.output='x'.repeat(${MAX_MESSAGE_BYTES});process.send({...input,type:'exchange',payload});`}`;
    const f = await workerFixture(t, program, { beforeOpen: () => waiting });
    const [code] = await f.exited; release();
    assert.equal(code, 0, f.diagnostics()); assert.equal(f.state.exchanges.length, 0);
    assert.ok(f.opens() <= 1, 'no replacement bootstrap is allowed');
  }
});
