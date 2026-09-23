import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProtocolDelivery, executionPrompt } from '../scripts/workbench/protocol-delivery.mjs';
import { spawnSync } from 'node:child_process';
import { WorkbenchSync } from '../prototype/workbench-sync.mjs';
import { queueCodexMessage } from '../scripts/workbench/server.mjs';
import { ProtocolStore } from '../scripts/shared/protocol-store.mjs';

test('Applied resume receipts suppress replayed native delivery across restart without suppressing new controls', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-resume-delivery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let store = new ProtocolStore(directory);
  const device = { repositoryId: 'repo', deviceId: 'device', agentId: 'backend', role: 'device' };
  const session = { id: 'developer', generation: 1 };
  await store.handle(device, { v: 2, id: 'bind', type: 'session.bind', payload: {
    sessionId: session.id, worktreeId: 'tree', agentId: 'executor', expectedBindingVersion: '',
  } }, { verifyBinding: () => true });
  const control = { v: 2, id: 'resume-1', type: 'task.control', session,
    payload: { taskId: 'task', action: 'resume', expectedVersion: 'v1', data: { reason: 'continue' } } };
  let calls = 0;
  const deliver = async message => {
    await store.receiveNotification(device, message);
    if (!await store.resumeControlApplied(device, message)) await new ProtocolDelivery(path.join(directory, 'native'), {
      claude: async () => { calls++; },
    }).deliver({ id: message.id, sessionId: session.id, platform: 'claude', root: directory, message: 'Resume task' });
  };
  assert.equal(await store.resumeControlApplied(device, control), false, 'no receipt must not discard work');
  await store.receiveNotification(device, { v: 2, id: 'resumed', type: 'task.report', session,
    payload: { taskId: 'task', stage: 'resumed', data: { controlId: control.id } } });
  store = new ProtocolStore(directory);
  await deliver(control);
  assert.equal(calls, 0, 'even a missing native delivery intent must not re-invoke an applied control');
  await deliver({ ...control, id: 'resume-2' });
  assert.equal(calls, 1, 'a new authorized control is not suppressed');
  assert.equal(await store.resumeControlApplied(device, { ...control, payload: { ...control.payload, taskId: 'another-task' } }), false);
  await assert.rejects(store.resumeControlApplied(device, { ...control, session: { ...session, generation: 2 } }), { code: 'STALE_SESSION' });
  await assert.rejects(store.resumeControlApplied({ ...device, role: 'executor' }, control), { code: 'FORBIDDEN' });
});

test('Verified closure prompt preserves the server control receipt and does not repeat development', async () => {
  const message = { v: 2, id: 'verified-control', type: 'task.control', session: { id: 'developer', generation: 3 },
    payload: { taskId: 'task', action: 'complete', expectedVersion: 'v1', data: { gitReceiptRef: 'github-pr:7', archiveReceiptRef: 'published-session' } } };
  const prompt = await executionPrompt(message);
  const report = JSON.parse(prompt.split('\n').at(-1));
  assert.deepEqual(report.session, message.session);
  assert.equal(report.payload.stage, 'closed');
  assert.deepEqual(report.payload.data, { controlId: message.id, closeReceiptId: message.id });
  assert.match(prompt, /不要重新执行开发/);
  assert.equal(await executionPrompt(message), prompt, 'replay retains the report identity');
});

test('Resume control prompt preserves the control receipt and requires a resumed report', async () => {
  const message = { v: 2, id: 'resume-control', type: 'task.control', session: { id: 'developer', generation: 3 },
    payload: { taskId: 'task', action: 'resume', expectedVersion: 'v9', data: { reason: '用户明确要求继续' } } };
  const prompt = await executionPrompt(message);
  const report = JSON.parse(prompt.split('\n').find(line => line.startsWith('{')));
  assert.equal(report.type, 'task.report');
  assert.equal(report.payload.stage, 'resumed');
  assert.equal(report.payload.data.controlId, message.id);
  assert.deepEqual(report.session, message.session);
  assert.match(prompt, /不是新任务/);
  assert.match(prompt, /Plan 未批准/);
  assert.match(prompt, /回复未知时保留原 operationId/);
  assert.match(prompt, /用新的 operationId 提交 Plan/);
  assert.match(prompt, /reviewed 任务不使用 map task start\/finish/);
  assert.match(prompt, /如果原任务是链路验证或明确要求不修改业务文件/);
  assert.match(prompt, /只读证据提交 map task handoff/);
  assert.match(prompt, /map exchange --input -（stdin）/);
  assert.equal(await executionPrompt(message), prompt, 'replay retains the resume report identity');
});

test('desktop loading precedes native queue delivery without duplicate model invocation', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-desktop-delivery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const input = { id: 'desktop-load', platform: 'codex', sessionId, message: 'Inspect only', root: directory };
  const calls = [];
  let openingFails = true;
  const adapter = payload => queueCodexMessage(payload, { platform: 'darwin', run: async (file, args) => {
    calls.push({ file, args });
    if (file === '/usr/bin/open' && openingFails) throw Object.assign(new Error('timeout'), { killed: true, code: 'ETIMEDOUT' });
  } });
  const delivery = new ProtocolDelivery(directory, { codex: adapter });
  await assert.rejects(delivery.deliver(input), error => error.details.deliveryState === 'failed');
  assert.equal(calls.length, 1, 'opener failure must not queue the task');
  openingFails = false;
  await delivery.deliver(input);
  assert.deepEqual(calls[1], { file: '/usr/bin/open', args: ['-g', `codex://threads/${sessionId}`] });
  assert.deepEqual(calls[2].args, ['queue', '--thread', sessionId, '--message', input.message]);
  await new ProtocolDelivery(directory, { codex: adapter }).deliver(input);
  assert.equal(calls.length, 3, 'receipt replay must neither reopen nor enqueue again');
  await assert.rejects(adapter({ ...input, sessionId: '../settings?token=x' }), { code: 'INVALID_SESSION' });
  assert.equal(calls.length, 3);
  await assert.rejects(new ProtocolDelivery(directory, { codex: payload => queueCodexMessage(payload, {
    platform: 'darwin', run: async file => { if (file !== '/usr/bin/open') throw Object.assign(new Error('queue reply lost'), { killed: true }); },
  }) }).deliver({ ...input, id: 'queue-uncertain' }), error => error.details.deliveryState === 'uncertain');
  const portable = [];
  await queueCodexMessage(input, { platform: 'linux', run: async (_file, args) => portable.push(args) });
  assert.deepEqual(portable, [['queue', '--thread', sessionId, '--message', input.message]], 'non-macOS delivery is unchanged');
});

test('IF-029: host acceptance is not completion and uncertain acceptance never invokes a second model', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-delivery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  let retryFailures = 0;
  const adapters = { codex: async input => {
    calls++;
    if (input.id === 'uncertain') throw Object.assign(new Error('reply lost'), { deliveryUncertain: true });
    if (input.id === 'retry' && retryFailures++ === 0) throw Object.assign(new Error('not accepted'), { code: 'QUEUE_REJECTED' });
  } };
  const delivery = new ProtocolDelivery(directory, adapters);
  const input = { id: 'accepted', platform: 'codex', sessionId: 's', root: directory, message: 'Inspect the approved task and write a Plan' };
  const receipts = await Promise.all([delivery.deliver(input), delivery.deliver(input)]);
  assert.equal(calls, 1); assert.deepEqual(receipts[0], receipts[1]); assert.equal(receipts[0].state, 'received');
  await assert.rejects(delivery.deliver({ ...input, message: 'different' }), { code: 'ID_REUSED' });
  await assert.rejects(delivery.deliver({ ...input, id: 'unsupported', platform: 'unknown' }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(delivery.deliver({ ...input, id: 'uncertain' }), error => error.details.deliveryState === 'uncertain');
  await assert.rejects(new ProtocolDelivery(directory, adapters).deliver({ ...input, id: 'uncertain' }), error => error.details.deliveryState === 'uncertain');
  await assert.rejects(delivery.deliver({ ...input, id: 'retry' }), error => error.details.deliveryState === 'failed');
  assert.equal((await delivery.deliver({ ...input, id: 'retry' })).state, 'received');
  assert.equal(calls, 4);
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
  assert.match(prompt, /--input <JSON文件路径>/);
  assert.match(prompt, /--input -（stdin）/);
  assert.match(prompt, /不得手工创建、选择、分配或替换 Session/);
  assert.match(prompt, /map task plan 成功返回 awaiting-plan-review 后，立即结束本轮/);
  assert.match(prompt, /不得直接改写 Main/);
  assert.ok(!prompt.includes('--input <JSON>'));
  const direct = await executionPrompt({ ...assignment, payload: { ...assignment.payload, mode: 'session' } }, read);
  for (const value of ['approved requirement', 'map task start delivery', 'map task finish delivery', '--summary']) assert.ok(direct.includes(value));
  for (const value of ['main-v1', '"stage"', '"session"', '--session s']) assert.equal(direct.includes(value), false);
  assert.ok(direct.length < 350);
  assert.equal(direct.includes('收到审核通过后再执行'), false);
  await assert.rejects(executionPrompt(assignment, async () => ({ kind: 'plan', version: 'brief-v1', content: { text: 'wrong' } })), { code: 'CONFLICT' });
  const review = { v: 2, id: 'review', type: 'review.result', session, payload: { kind: 'plan', ref: 'plan', version: 'plan-v1', decision: 'approved', reason: 'matches requirements', receiptId: 'receipt' } };
  const reviewedPrompt = await executionPrompt(review, async () => ({ kind: 'reviewReceipt', content: { ...review.payload } }));
  assert.match(reviewedPrompt, /链路验证或明确要求不修改业务文件/);
  assert.match(reviewedPrompt, /只读证据提交 handoff/);
  await assert.rejects(executionPrompt(review, async () => ({ kind: 'reviewReceipt', content: { ...review.payload, decision: 'rejected' } })), { code: 'CONFLICT' });
});

test('Rework delivery preserves human rejection and CI feedback without changing task identity', async () => {
  for (const [reason, failedTestIds] of [
    ['验收未通过：移动端按钮被遮挡。\n请保留原来的桌面布局。', []],
    ['CI 失败：离线请求没有展示重试入口。', ['offline-retry']],
    [undefined, ['legacy-test']],
  ]) {
    const message = { v: 2, id: 'rework-delivery', type: 'task.rework', session: { id: 'developer', generation: 1 },
      payload: { taskId: 'original-task', sourceSha: 'a'.repeat(40), ciResultRef: 'ci:original-task:result', failedTestIds, ...(reason ? { reason } : {}) } };
    const prompt = await executionPrompt(message);
    if (reason) assert.ok(prompt.includes(`返工原因：${reason}\n代码：`), 'feedback must not be omitted or summarized');
    else assert.equal(prompt.includes('返工原因：'), false, 'legacy CI feedback must not invent a reason');
    assert.equal(prompt.includes('undefined'), false);
    assert.ok(prompt.includes('原任务 original-task 返工，不创建新任务'));
    assert.ok(prompt.includes(`失败测试：${failedTestIds.join(', ')}`));
    assert.ok(prompt.includes('CI：ci:original-task:result'));
    assert.ok(prompt.endsWith('交付编号：rework-delivery'));
    assert.equal(await executionPrompt(message), prompt, 'replay preserves feedback and delivery identity');
  }
});

test('IF-044: interruption hook retries the original event and never saves adapter error output', () => {
  const script = `import sys, pathlib\nsys.path.insert(0, str(pathlib.Path('scripts').resolve()))\nimport context_guard_hook as h\nsaved=[]\ncalls=[]\nh.write_hook_runtime=lambda *args: saved.append(args[-1].copy())\nruntime={'pending_interrupts':[{'id':'event-1','at':'2026-01-01T00:00:00Z'}]}\ndef offline(args):\n calls.append(args)\n raise RuntimeError('private adapter output')\nh.run_node_workbench=offline\nh.sync_pending_interrupt(pathlib.Path('.'), 's', runtime)\nassert runtime['interrupt_sync']=='pending' and len(runtime['pending_interrupts'])==1\nassert 'private adapter output' not in str(saved)\ndef online(args):\n calls.append(args)\n return {'queued':True}\nh.run_node_workbench=online\nh.sync_pending_interrupt(pathlib.Path('.'), 's', runtime)\nassert runtime['pending_interrupts']==[] and runtime['interrupt_sync']=='confirmed'\nassert calls[0]==calls[1]\n`;
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
});

test('local Coordinator Hook injects current Main navigation and fails closed when Cloud Main is unavailable', () => {
  const script = `import sys, pathlib, tempfile, json
from types import SimpleNamespace
sys.path.insert(0, str(pathlib.Path('scripts').resolve()))
import context_guard_hook as h
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory)/'project'; ctx=root/'.codex/context'; ctx.mkdir(parents=True)
 git=pathlib.Path(directory)/'git'; shared=git/'context-guard'; (shared/'main').mkdir(parents=True)
 document={'root':{'id':'T0','title':'Root','purpose':'Project','children':[{'id':'N1','title':'Article','purpose':'Public','todos':[{'id':'TD1','title':'Current from Main','status':'processing'}],'children':[]}]}}
 (shared/'main/map.json').write_text(json.dumps(document),encoding='utf-8')
 h.subprocess.run=lambda args,**kwargs: SimpleNamespace(returncode=0,stdout=str(git),stderr='')
 snapshot={'role':'coordinator','version':'session-v1','cloud_cursor':0,'grant_nodes':[],'todos':[{'id':'TD1','title':'Stale Session title','node':'N1','status':'pending'}],'bugs':[]}
 h.map_snapshot=lambda *args: snapshot
 h.map_inbox=lambda *args: {'pending':False}
 coordinator,_=h.map_context(root,ctx,'session-1')
 assert 'Coordinator static Main context' in coordinator and 'Article' in coordinator and 'Current from Main' in coordinator
 assert 'Stale Session title' not in coordinator
 snapshot['role']='executor'
 executor,_=h.map_context(root,ctx,'session-1')
 assert 'Coordinator static Main context' not in executor and 'Article' not in executor
 snapshot['role']='coordinator'
 (shared/'memory-client.json').write_text('{}',encoding='utf-8')
 cloud_document={'root':{'id':'T0','title':'Cloud Root','children':[{'id':'N1','title':'Current Cloud Article','todos':[{'id':'TD1','title':'Fresh Cloud task','status':'done'}],'children':[]}]}}
 h.subprocess.run=lambda args,**kwargs: SimpleNamespace(returncode=0,stdout=str(git) if args[0]=='git' else json.dumps({'version':'cloud-v2','doc':cloud_document}),stderr='')
 cloud,_=h.map_context(root,ctx,'session-1')
 assert 'Current Cloud Article' in cloud and 'Fresh Cloud task' in cloud and 'cloud-v2' in cloud
 assert 'Current from Main' not in cloud
 h.subprocess.run=lambda args,**kwargs: SimpleNamespace(returncode=0 if args[0]=='git' else 1,stdout=str(git) if args[0]=='git' else '',stderr='unavailable')
 unavailable,_=h.map_context(root,ctx,'session-1')
 assert 'Coordinator Main navigation unavailable' in unavailable and 'Article' not in unavailable
`;
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
});

test('IF-045: source preparation can retain a pending memory transport without bypassing conflict or authorization', () => {
  const script = `import sys, pathlib\nsys.path.insert(0, str(pathlib.Path('scripts').resolve()))\nimport context_guard_hook as h\nh.sync_command=lambda *args: {'error':{'code':'MEMORY_UNAVAILABLE','message':'private detail'}}\nassert h.prepare_plan_sync(pathlib.Path('.'),'s',['src/'])=={'pending':True,'code':'MEMORY_UNAVAILABLE'}\nfor code in ['FORBIDDEN','UNAUTHORIZED','WORK_IMPACT','MEMORY_CONFLICT','SESSION_BASELINE_REQUIRED']:\n h.sync_command=lambda *args: {'error':{'code':code}}\n try: h.prepare_plan_sync(pathlib.Path('.'),'s',['src/'])\n except ValueError: pass\n else: raise AssertionError(code)\nh.sync_command=lambda *args: {'status':'conflict'}\ntry: h.prepare_plan_sync(pathlib.Path('.'),'s',['src/'])\nexcept ValueError: pass\nelse: raise AssertionError('conflict bypassed')\n`;
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
});

test('legacy browser deliveries remain exportable and are never replayed during interface migration', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([
    ['cg-delivery:project:{"todoId":"TD1"}', '{"operationId":"old-op","todoId":"TD1"}'],
    ['cg-delivery:project:{"bugId":"B1"}', '{invalid legacy JSON'],
    ['cg-delivery:other:{"todoId":"TD2"}', '{"operationId":"other-op"}'],
  ]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size; }, key: index => [...values.keys()][index] || null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
  } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; });
  const sync = Object.assign(Object.create(WorkbenchSync.prototype), { config: { root: 'project' }, ready: false, captureKey: null, inputDraft: null, doc: { project: 'project' } });
  assert.equal(sync.loadRecovery(), true);
  assert.equal(sync.legacyDeliveryRecovery.length, 2);
  assert.match(sync.recoveryNotice('草稿已保留'), /2 项旧派发记录/);
  const status = { textContent: '' }, version = { textContent: '', dataset: {} };
  sync.panel = { dataset: {}, querySelector: selector => selector === '#cg-sync-status' ? status : version };
  sync.notice = { hidden: true, textContent: '', title: '' };
  sync.setStatus('synced', sync.recoveryNotice(''));
  assert.equal(sync.notice.hidden, false, 'a closed recovery panel still exposes the pending legacy delivery');
  assert.match(sync.notice.textContent, /旧交付待核对/);
  let exported;
  sync.download = value => { exported = value; };
  sync.export();
  assert.deepEqual(exported.legacyDeliveries, sync.legacyDeliveryRecovery);
  assert.equal(exported.legacyDeliveries[1].raw, '{invalid legacy JSON');
  assert.equal(values.size, 3, 'export and recovery scan must not delete or replay old requests');
});

test('IF-030: browser retries and reloads retain the delivery ID and refuse an old backend', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; });
  const make = () => Object.assign(Object.create(WorkbenchSync.prototype), { config: { root: 'test-project', interfaceCapabilities: { durableDelivery: true } }, taskStates: new Map() });
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
  reloaded.config.interfaceCapabilities.humanReview = true; reloaded.viewId = 'main';
  const review = { sessionId: 's', taskId: 't', resultVersion: 'v1', nodeId: 'node', itemId: 'todo', kind: 'todo', decision: 'approved' }, reviewIds = [];
  reloaded.call = async (_route, input) => { reviewIds.push(input.operationId); throw new Error('review reply lost'); };
  await assert.rejects(reloaded.reviewTask(review));
  reloaded.call = async (_route, input) => { reviewIds.push(input.operationId); return { operationId: input.operationId, review: input }; };
  await reloaded.reviewTask(review);
  assert.equal(reviewIds[0], reviewIds[1], 'review retry preserves its operation identity');
  reloaded.viewId = 'session:s';
  await assert.rejects(reloaded.reviewTask(review), /主工作台/);
});
