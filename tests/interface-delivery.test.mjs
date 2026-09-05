import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProtocolDelivery, executionPrompt } from '../scripts/workbench/protocol-delivery.mjs';
import { spawnSync } from 'node:child_process';
import { WorkbenchSync } from '../prototype/workbench-sync.mjs';

test('IF-029: host acceptance is not completion and uncertain acceptance never invokes a second model', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-delivery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const adapters = { codex: async input => { calls++; if (input.id === 'uncertain') throw new Error('reply lost'); } };
  const delivery = new ProtocolDelivery(directory, adapters);
  const input = { id: 'accepted', platform: 'codex', sessionId: 's', root: directory, message: 'Inspect the approved task and write a Plan' };
  const receipts = await Promise.all([delivery.deliver(input), delivery.deliver(input)]);
  assert.equal(calls, 1); assert.deepEqual(receipts[0], receipts[1]); assert.equal(receipts[0].state, 'received');
  await assert.rejects(delivery.deliver({ ...input, message: 'different' }), { code: 'ID_REUSED' });
  await assert.rejects(delivery.deliver({ ...input, id: 'unsupported', platform: 'unknown' }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(delivery.deliver({ ...input, id: 'uncertain' }), error => error.details.deliveryState === 'uncertain');
  await assert.rejects(new ProtocolDelivery(directory, adapters).deliver({ ...input, id: 'uncertain' }), error => error.details.deliveryState === 'uncertain');
  assert.equal(calls, 2);
});

test('IF-043: host prompts preserve approved requirements, node routing and pinned Main/Plan versions', async () => {
  const session = { id: 's', generation: 1 };
  const assignment = { v: 2, id: 'delivery', type: 'task.assign', session, payload: {
    taskId: 'task', briefRef: 'brief', briefVersion: 'brief-v1', sessionId: 's', nodeIds: ['N1', 'N2'], mainVersion: 'main-v1',
  } };
  const read = async (ref, version) => {
    assert.equal(ref, 'brief'); assert.equal(version, 'brief-v1');
    return { kind: 'brief', version, content: { taskId: 'task', text: 'approved requirement' } };
  };
  const prompt = await executionPrompt(assignment, read);
  for (const value of ['N1, N2', 'main-v1', 'approved requirement', 'delivery']) assert.ok(prompt.includes(value));
  assert.match(prompt, /先读代码并提交 Plan/);
  await assert.rejects(executionPrompt(assignment, async () => ({ kind: 'plan', version: 'brief-v1', content: { text: 'wrong' } })), { code: 'CONFLICT' });
  const review = { v: 2, id: 'review', type: 'review.result', session, payload: { kind: 'plan', ref: 'plan', version: 'plan-v1', decision: 'approved', reason: 'matches requirements', receiptId: 'receipt' } };
  await assert.rejects(executionPrompt(review, async () => ({ kind: 'reviewReceipt', content: { ...review.payload, decision: 'rejected' } })), { code: 'CONFLICT' });
});

test('IF-044: interruption hook retries the original event and never saves adapter error output', () => {
  const script = `import sys, pathlib\nsys.path.insert(0, str(pathlib.Path('scripts').resolve()))\nimport context_guard_hook as h\nsaved=[]\ncalls=[]\nh.write_hook_runtime=lambda *args: saved.append(args[-1].copy())\nruntime={'pending_interrupts':[{'id':'event-1','at':'2026-01-01T00:00:00Z'}]}\ndef offline(args):\n calls.append(args)\n raise RuntimeError('private adapter output')\nh.run_node_workbench=offline\nh.sync_pending_interrupt(pathlib.Path('.'), 's', runtime)\nassert runtime['interrupt_sync']=='pending' and len(runtime['pending_interrupts'])==1\nassert 'private adapter output' not in str(saved)\ndef online(args):\n calls.append(args)\n return {'queued':True}\nh.run_node_workbench=online\nh.sync_pending_interrupt(pathlib.Path('.'), 's', runtime)\nassert runtime['pending_interrupts']==[] and runtime['interrupt_sync']=='confirmed'\nassert calls[0]==calls[1]\n`;
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
});

test('IF-045: source preparation can retain a pending memory transport without bypassing conflict or authorization', () => {
  const script = `import sys, pathlib\nsys.path.insert(0, str(pathlib.Path('scripts').resolve()))\nimport context_guard_hook as h\nh.sync_command=lambda *args: {'error':{'code':'MEMORY_UNAVAILABLE','message':'private detail'}}\nassert h.prepare_plan_sync(pathlib.Path('.'),'s',['src/'])=={'pending':True,'code':'MEMORY_UNAVAILABLE'}\nfor code in ['FORBIDDEN','UNAUTHORIZED','WORK_IMPACT','MEMORY_CONFLICT','SESSION_BASELINE_REQUIRED']:\n h.sync_command=lambda *args: {'error':{'code':code}}\n try: h.prepare_plan_sync(pathlib.Path('.'),'s',['src/'])\n except ValueError: pass\n else: raise AssertionError(code)\nh.sync_command=lambda *args: {'status':'conflict'}\ntry: h.prepare_plan_sync(pathlib.Path('.'),'s',['src/'])\nexcept ValueError: pass\nelse: raise AssertionError('conflict bypassed')\n`;
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
});

test('IF-030: browser retries and reloads retain the delivery ID and refuse an old backend', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; });
  const make = () => Object.assign(Object.create(WorkbenchSync.prototype), { config: { root: 'test-project', interfaceCapabilities: { durableDelivery: true } } });
  const first = make(), seen = [];
  first.call = async (_route, request) => { seen.push(request.operationId); throw new Error('reply lost'); };
  await assert.rejects(first.sendTodo('s', 'node', 'todo'));
  const reloaded = make();
  reloaded.call = async (_route, request) => { seen.push(request.operationId); return { deliveryId: request.operationId, state: 'received' }; };
  await reloaded.sendTodo('s', 'node', 'todo');
  assert.equal(seen[0], seen[1]); assert.equal(values.size, 0);
  reloaded.config.interfaceCapabilities = {};
  await assert.rejects(reloaded.sendTodo('s', 'node', 'todo'), /先升级/);
  assert.equal(seen.length, 2);
  reloaded.config.interfaceCapabilities.durableDelivery = true;
  reloaded.call = async () => ({ sent: true });
  await assert.rejects(reloaded.sendTodo('s', 'node', 'todo'), /未返回可靠交付回执/);
  reloaded.call = () => assert.fail('uncertain delivery must not dispatch again');
  await assert.rejects(reloaded.sendTodo('s', 'node', 'todo'), /不会重复发送/);
});
