import '../.github/scripts/test-environment.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomInt, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { attachBugWithRecovery, diagnoseWorkbench, ensureServer, stopServer, updateBugWithRecovery } from '../scripts/workbench/cli.mjs';
import { MapStore } from '../scripts/workbench/store.mjs';
import { MemorySyncCoordinator, mergeSessionDocuments, operationsOverlap, parseSseBlocks } from '../scripts/workbench/sync-coordinator.mjs';
import { definitiveMemoryRejection } from '../scripts/workbench/memory.mjs';
import { canRetryWorkbenchListen, prepareSessionCommit, startServer } from '../scripts/workbench/server.mjs';
import { canRetryWorkbenchListen as sharedListenGuard } from '../scripts/workbench/listen.mjs';
import { Access, hostAttestedPlatform, recordHostAttestedSession, rolloutTaskStatus } from '../scripts/workbench/access.mjs';
import { generateProjections } from '../scripts/workbench/projections.mjs';
import { applyOperations, assignmentScope, diffTrees, restoreSessionWorkItemOperations, scopeChangesToSession, scopeDocumentToSession, validate, isClosedBugStatus } from '../scripts/shared/map-model.mjs';
import { atomicWrite, encode, hash, pause, readJSON } from '../scripts/shared/io.mjs';
import { buildArchiveReconciliation, ownerForPath } from '../scripts/workbench/reconcile.mjs';
import { WorkbenchSync, reconcileRecoveryDraft, workbenchTimeoutMs } from '../prototype/workbench-sync.mjs';
const human = { kind: 'human', sessionId: 'workbench' }, agent = { kind: 'agent', sessionId: 'test-session' };
const fixtureRoots = [];
const retainedFixtures = new Set();

// Exercise the actual classic-script status functions without starting a browser.
// Function boundaries are checked explicitly; a missing function is a test failure.
async function workItemProgressForTest(projectState = 'closed') {
  const source = await fs.readFile(new URL('../prototype/workbench-app.js', import.meta.url), 'utf8');
  const section = (name, next) => {
    const start = source.indexOf(`function ${name}(`), end = source.indexOf(`function ${next}(`, start);
    assert.ok(start >= 0 && end > start, `Actual UI function boundary: ${name}`);
    return source.slice(start, end);
  };
  const sync = Object.create(WorkbenchSync.prototype);
  sync.projectTaskStates = new Map([['bug:N1:B1', {state:projectState}], ['todo:N1:TD1', {state:projectState}]]);
  sync.taskStates = new Map([['old-summary', {state:'completed'}]]);
  const functions = new Function('workbenchSync', 't', 'uiLang',
    section('humanReviewProgress', 'taskSummaryHtml') + section('bugProgress', 'bugProgressHtml') +
    section('todoProgress', 'todoProgressHtml') + 'return {bugProgress,todoProgress};');
  return functions(sync, key => key, 'zh');
}
test('Manual open Bug ignores a closed historical project task without changing Main', async () => {
  const item = {id:'B1',status:'open',executionMode:'manual',approvedBrief:{ready:true}};
  const before = structuredClone(item), progress = await workItemProgressForTest();
  assert.deepEqual(progress.bugProgress(item,'N1'), {kind:'waiting',label:'bugWaiting',detail:''});
  assert.deepEqual(item,before);
});
test('Manual pending TODO ignores a closed historical project task without changing Main', async () => {
  const item = {id:'TD1',status:'pending',executionMode:'manual',approvedBrief:{ready:true}};
  const before = structuredClone(item), progress = await workItemProgressForTest();
  assert.deepEqual(progress.todoProgress(item,'N1'), {kind:'waiting',label:'todoPending',detail:''});
  assert.deepEqual(item,before);
});
test('Manual status labels preserve Main states including readable legacy Bugs and ignore old review, summary and sessions', async () => {
  const progress = await workItemProgressForTest();
  for (const [kind,status,expectedKind,label] of [
    ['bug','open','waiting','bugWaiting'], ['bug','fixed','fixed','bugFixed'],
    ['bug','resolved','resolved','bugResolved'], ['bug','dormant','resolved','bugResolved'],
    ['bug','unfixable','unfixable','bugUnfixable'], ['bug','deferred','unfixable','bugUnfixable'],
    ['bug','wontfix','unfixable','bugUnfixable'], ['bug','pending','settling','bugSettling'],
    ['bug','handling','processing','bugProcessing'], ['bug','inprogress','processing','bugProcessing'],
    ['bug','recurred','processing','bugProcessing'], ['bug','unknown','waiting','bugWaiting'],
    ['todo','pending','waiting','todoPending'], ['todo','processing','processing','todoProcessing'],
    ['todo','done','resolved','todoDone'], ['todo','unknown','waiting','todoPending'],
  ]) {
    const item = Object.freeze({id:kind==='bug'?'B1':'TD1',status,executionMode:'manual',approvedBrief:{ready:true},
      dispatch:{task_id:'old-task',status:'closed'},review:{taskId:'old-task',decision:'approved'},
      resolution:{dispatch:{task_id:'old-summary',status:'completed'}},sessions:Object.freeze(['old-session'])});
    const before = structuredClone(item);
    assert.deepEqual(progress[`${kind}Progress`](item,'N1'), {kind:expectedKind,label,detail:''}, `${kind}/${status}`);
    assert.deepEqual(item,before, `${kind}/${status} retains all stored history`);
  }
});
test('Automatic work-item labels retain project-stage and human-review behavior; approvedBrief alone is not manual', async () => {
  const closed = await workItemProgressForTest('closed'), running = await workItemProgressForTest('executing');
  for (const [kind,id,status,label] of [['bug','B1','open','bugResolved'],['todo','TD1','pending','todoDone']]) {
    assert.deepEqual(closed[`${kind}Progress`]({id,status,approvedBrief:{ready:true}},'N1'), {kind:'resolved',label,detail:''});
    assert.deepEqual(running[`${kind}Progress`]({id,status},'N1'), {kind:'processing',label:'执行中',detail:''});
    assert.deepEqual(running[`${kind}Progress`]({id,status,dispatch:{task_id:'current'},review:{taskId:'current',decision:'approved'}},'N1'),
      {kind:'resolved',label:'验收通过',detail:''});
  }
});

test('Attachment file display normalizes legacy paths without mutating the Map or creating a synchronization diff', async () => {
  const source = await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const start = source.indexOf('function filePathOf('), end = source.indexOf('function normRepoPath(',start);
  assert.ok(start>=0&&end>start,'Actual attachment display helper exists');
  const fileList = new Function(source.slice(start,end)+'return fileList;')();
  for(const owner of [{id:'B1'}, {id:'B1',files:'legacy-path'}, {id:'B1',files:[' docs/a.md ',{path:'img.png',name:'截图'},'  ']}]){
    const before=structuredClone(owner), list=fileList(owner);
    assert.deepEqual(owner,before,'Rendering retains the stored field shape and values');
    assert.deepEqual(list,Array.isArray(before.files)?[{path:'docs/a.md'},{path:'img.png',name:'截图'}]:[]);
    const sync=Object.create(WorkbenchSync.prototype);
    sync.ready=true; sync.revision=0;
    sync.baseTree={id:'T0',bugs:[before],children:[]};
    sync.a={getRoot:()=>({id:'T0',bugs:[owner],children:[]})};
    assert.deepEqual(sync.operations(),[],'Read-only rendering does not become a map write');
  }
  assert.deepEqual(fileList(null),[]);
  assert.deepEqual(fileList(Object.freeze({files:Object.freeze(['a.md'])})),[{path:'a.md'}],'Frozen read snapshots are supported');
});
test('Explicit attachment addition still saves normalized paths and avoids duplicates', async () => {
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const section=(name,next)=>{const start=source.indexOf(`function ${name}(`),end=source.indexOf(`function ${next}(`,start);assert.ok(start>=0&&end>start);return source.slice(start,end);};
  const owner={id:'B1',files:['a.md']};
  const add=new Function('ownerOf',section('filePathOf','normRepoPath')+section('addFilePath','canFsAccess')+'return addFilePath;')(()=>owner);
  assert.equal(add({},'bug','B1','b.md'),true);
  assert.deepEqual(owner.files,[{path:'a.md'},{path:'b.md'}]);
  assert.equal(add({},'bug','B1','b.md'),true);
  assert.equal(owner.files.length,2);
  assert.equal(add({},'bug','B1','   '),false);
});

test('stale browser drafts are cleared only without pending input or meaningful changes', () => {
  const base = { id: 'T0', title: 'Map', purpose: 'before', children: [] };
  const remote = { ...base, purpose: 'updated on Cloud' };
  const draft = { baseVersion: 'old', baseTree: structuredClone(base), doc: { root: structuredClone(base) } };
  assert.deepEqual(reconcileRecoveryDraft(draft, remote, 'new'), { kind: 'stale' });
  assert.deepEqual(reconcileRecoveryDraft({ ...draft, doc: { root: structuredClone(remote) } }, remote, 'new'), { kind: 'stale' });
  assert.deepEqual(reconcileRecoveryDraft({ ...draft, pendingRequest: { operationId: 'uncertain', operations: [] } }, remote, 'new'), { kind: 'conflict' });
  assert.deepEqual(reconcileRecoveryDraft({ ...draft, inputDraft: { text: 'unfinished' } }, remote, 'new'), { kind: 'conflict' });
});

test('stale browser drafts merge disjoint fields and keep overlapping edits for review', () => {
  const base = { id: 'T0', title: 'Map', purpose: 'before', children: [
    { id: 'N1', title: 'First', children: [] }, { id: 'N2', title: 'Second', children: [] },
  ] };
  const local = structuredClone(base), remote = structuredClone(base);
  local.title = 'Local title'; local.children[0].title = 'Local first';
  remote.purpose = 'Remote purpose'; remote.children[1].title = 'Remote second';
  const draft = { baseVersion: 'old', baseTree: base, doc: { root: local } };
  const result = reconcileRecoveryDraft(draft, remote, 'new');
  assert.equal(result.kind, 'merged');
  assert.equal(result.root.title, 'Local title');
  assert.equal(result.root.purpose, 'Remote purpose');
  assert.equal(result.root.children[0].title, 'Local first');
  assert.equal(result.root.children[1].title, 'Remote second');
  const overlap = structuredClone(remote); overlap.title = 'Different remote title';
  assert.deepEqual(reconcileRecoveryDraft(draft, overlap, 'new'), { kind: 'conflict' });
  assert.equal(local.title, 'Local title', 'the saved draft stays unchanged after a conflict');
});

test('stale browser drafts do not guess identities for simultaneous list edits', () => {
  const base = { id: 'T0', title: 'Map', children: [], memories: [{ text: 'one' }] };
  const local = structuredClone(base), remote = structuredClone(base);
  local.memories[0].text = 'local'; remote.memories[0].text = 'remote';
  assert.deepEqual(reconcileRecoveryDraft({ baseVersion: 'old', baseTree: base, doc: { root: local } }, remote, 'new'), { kind: 'conflict' });
});

test('stale browser draft merge preserves a one-sided reorder and rejects competing reorders', () => {
  const base = { id: 'T0', title: 'Map', children: [
    { id: 'N1', title: 'One', children: [] }, { id: 'N2', title: 'Two', children: [] }, { id: 'N3', title: 'Three', children: [] },
  ] };
  const local = structuredClone(base), remote = structuredClone(base);
  local.children = [local.children[1], local.children[0], local.children[2]];
  remote.children[2].title = 'Cloud three';
  const draft = { baseVersion: 'old', baseTree: base, doc: { root: local } };
  const result = reconcileRecoveryDraft(draft, remote, 'new');
  assert.equal(result.kind, 'merged');
  assert.deepEqual(result.root.children.map(node => node.id), ['N2', 'N1', 'N3']);
  assert.equal(result.root.children[2].title, 'Cloud three');
  remote.children = [remote.children[0], remote.children[2], remote.children[1]];
  assert.deepEqual(reconcileRecoveryDraft(draft, remote, 'new'), { kind: 'conflict' });
});

test('Workbench uses a longer read budget without extending write uncertainty', async () => {
  assert.equal(workbenchTimeoutMs('GET'), 30000);
  assert.equal(workbenchTimeoutMs('POST'), 10000);
  const originalFetch = globalThis.fetch, originalTimeout = AbortSignal.timeout;
  const budgets = [];
  globalThis.fetch = async (_url, options) => ({ ok: true, status: 200,
    headers: { get: () => 'application/json' }, json: async () => ({ method: options.method }) });
  AbortSignal.timeout = milliseconds => { budgets.push(milliseconds); return new AbortController().signal; };
  try {
    const client = { config: { token: '' }, viewId: 'main', endpoint: route => route };
    assert.equal((await WorkbenchSync.prototype.call.call(client, '/api/state')).method, 'GET');
    assert.equal((await WorkbenchSync.prototype.call.call(client, '/api/commit', { operationId: 'same-id' })).method, 'POST');
    assert.deepEqual(budgets, [30000, 10000]);
  } finally { globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout; }
});

test('Workbench retries only a definitive busy commit with the same operation ID', async () => {
  const originalFetch = globalThis.fetch, calls = [];
  const client = { config: { token: '' }, viewId: 'main', endpoint: route => route };
  const request = { operationId: 'busy-replay', baseVersion: 'v1', operations: [] };
  try {
    globalThis.fetch = async (_url, options) => {
      calls.push(options.body);
      return { ok: calls.length > 1, status: calls.length > 1 ? 200 : 503,
        headers: { get: () => 'application/json' }, json: async () => calls.length > 1 ? { committed: true }
          : { error: { code: 'STATE_BUSY', message: 'Shared state is busy; preserve lock and retry' } } };
    };
    assert.deepEqual(await WorkbenchSync.prototype.call.call(client, '/api/commit', request), { committed: true });
    assert.deepEqual(calls, [JSON.stringify(request), JSON.stringify(request)]);

    calls.length = 0;
    globalThis.fetch = async (_url, options) => {
      calls.push(options.body);
      return { ok: false, status: 503, headers: { get: () => 'application/json' },
        json: async () => ({ error: { code: 'STATE_BUSY', message: 'Interrupted lock recovery needs explicit repair; preserve the recovery guard' } }) };
    };
    await assert.rejects(WorkbenchSync.prototype.call.call(client, '/api/commit', request), { code: 'STATE_BUSY' });
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('only definitive memory rejections may release a retry identity', () => {
  assert.equal(definitiveMemoryRejection({ status: 409, code: 'SESSION_BASELINE_CONFLICT' }), true);
  assert.equal(definitiveMemoryRejection({ status: 400, code: 'INVALID_ARGUMENT' }), true);
  assert.equal(definitiveMemoryRejection({ status: 503, code: 'MEMORY_UNAVAILABLE' }), false);
  assert.equal(definitiveMemoryRejection(new Error('network')), false);
});

for (const managed of [false, true]) test(`binding conflict terminates synchronization without deleting the pending write${managed ? ' (managed)' : ''}`, async t => {
  const f = await fixture(), store = await new MapStore(f.root).init();
  let calls = 0;
  const coordinator = new MemorySyncCoordinator({ project: {}, sessionId: agent.sessionId, store, directory: f.root, managed,
    request: async () => { calls++; throw Object.assign(new Error('New host Session required'), { code: 'CONFLICT', status: 409, details: { reason: 'session-bound-elsewhere' } }); } });
  t.after(async () => { await coordinator.close(); await store.close(); });
  const pending = { operationId: 'preserve-original-map-write', baseVersion: 'old-map-version', operations: [{ type: 'update', id: 'N1', fields: { title: 'unsent draft' } }] };
  await atomicWrite(coordinator.outboxFile, encode(pending));
  coordinator.configuration = { url: 'https://cloud.example.invalid' };
  await coordinator.run();
  assert.equal(calls, 1);
  assert.equal(coordinator.status.status, 'conflict');
  assert.equal(coordinator.status.reason, 'session-bound-elsewhere');
  assert.equal(coordinator.status.pending, 1);
  assert.equal(coordinator.retryTimer, undefined);
  await coordinator.queueLocal(); await coordinator.flush();
  await coordinator.projectHeartbeat({ mapVersion: 'cloud-version', mapCursor: 1 });
  assert.equal(calls, 1, 'a terminal binding rejection is not another connection attempt');
  assert.deepEqual(await readJSON(coordinator.outboxFile), pending);
  assert.equal((await readJSON(coordinator.stateFile)).reason, 'session-bound-elsewhere');
  assert.deepEqual(store.doc, f.doc, 'the local draft remains intact');
});

test('human cleanup removes attached and unassigned Bugs without changing other memory', () => {
  const doc = { v: 1, root: { id: 'R', title: 'root', bugs: [{ id: 'B1', title: 'test' }], todos: [{ id: 'TD1', title: 'keep task' }], memories: [{ text: 'keep memory' }], children: [] }, unassigned_bugs: [{ id: 'B2', title: 'unassigned test' }] };
  const operations = [{ type: 'update', id: 'R', fields: { bugs: [] } }, { type: 'document', fields: { unassigned_bugs: [] } }];
  const cleaned = applyOperations(doc, operations, human).doc;
  assert.deepEqual(cleaned.root.bugs, []); assert.deepEqual(cleaned.unassigned_bugs, []);
  assert.deepEqual(cleaned.root.todos, doc.root.todos); assert.deepEqual(cleaned.root.memories, doc.root.memories);
  assert.equal(doc.root.bugs.length, 1, 'input remains usable as a recovery snapshot');
  assert.throws(() => applyOperations(doc, operations, agent, ['R']), { code: 'FORBIDDEN' });
  assert.throws(() => applyOperations(doc, [{ type: 'document', fields: { unassigned_bugs: {} } }], human), { code: 'INVALID_MAP' });
});

test('browser reconnect retries share one operation and Session switches wait', async () => {
  const sync = Object.create(WorkbenchSync.prototype);
  let release, calls = 0;
  sync.retryNow = async () => { calls++; await new Promise(resolve => { release = resolve; }); };
  const first = sync.retry(), second = sync.retry();
  assert.equal(calls, 1);
  release(); await Promise.all([first, second]);
  assert.equal(sync.retrying, null);
  sync.switchingSession = true;
  await sync.retry();
  assert.equal(calls, 1);
  sync.switchingSession = false; sync.sessionUnavailable = true;
  await sync.retry(); await sync.presence(); await sync.recoverConnection();
  assert.equal(calls, 1, 'unavailable Session must not reconnect');
});

test('Workbench follows v2 project-task stages without requiring legacy dispatch metadata', async () => {
  const sync = Object.create(WorkbenchSync.prototype);
  const calls = []; let renders = 0;
  Object.assign(sync, { config: { interfaceCapabilities: { taskDispatch: true } }, taskStates: new Map(), projectTaskStates: new Map(),
    a: { statusChanged: () => renders++ }, call: async (_route, input) => {
      calls.push(input); return { tasks: [], projectTasks: [{ taskId: 'task-1', itemId: 'TD1', nodeId: 'N1', kind: 'todo',
        state: calls.length === 1 ? 'executing' : 'accepted', updatedAt: '2026-09-23T00:00:00Z' }] };
    } });
  await sync.refreshTaskStatuses();
  assert.deepEqual(calls[0], { tasks: [] }, 'new tasks need no old Session dispatch field');
  assert.equal(sync.projectTaskState('todo', 'N1', 'TD1').state, 'executing');
  assert.equal(sync.projectTaskState('todo', 'N2', 'TD1'), null, 'duplicate item IDs in another node cannot inherit this status');
  await sync.refreshTaskStatuses();
  assert.equal(sync.projectTaskState('todo', 'N1', 'TD1').state, 'accepted');
  assert.equal(renders, 2);
});

test('Session reopen merge preserves disjoint append-only records and rejects conflicting content', () => {
  const base = { v: 1, root: { id: 'T0', title: 'Project', proposal: 'accepted', memories: [], children: [] } };
  const local = structuredClone(base), main = structuredClone(base);
  local.root.memories.push({ archiveKey: 'local', text: 'Local Session record' });
  main.root.memories.push({ archiveKey: 'main', text: 'Main record' });
  const merged = mergeSessionDocuments(base, local, main);
  assert.deepEqual(merged.root.memories.map(item => item.archiveKey), ['local', 'main']);
  assert.throws(() => mergeSessionDocuments(base,
    { ...local, root: { ...local.root, title: 'Local title' } },
    { ...main, root: { ...main.root, title: 'Main title' } }), { code: 'MEMORY_CONFLICT' });
});

for (const localTail of [false, true]) test(`Session reconcile merges the same title and remote-only fields${localTail ? ' while replaying a local tail receipt' : ''}`, async t => {
  const f = await fixture(), base = structuredClone(f.doc);
  base.bootstrap = 'ready'; base.root.purpose = 'before'; base.root.memories = [];
  const local = structuredClone(base); local.root.title = 'shared edit';
  if (localTail) local.root.memories.push({ archiveKey: 'local-only', text: 'preserve local tail' });
  const remote = structuredClone(base); remote.root.title = 'shared edit'; remote.root.purpose = 'remote-only';
  await atomicWrite(path.join(f.ctx, 'map.json'), encode(local));
  const store = await new MapStore(f.root).init();
  let uploaded = structuredClone(remote), applied = 0;
  const requests = [], receipts = new Map();
  const coordinator = new MemorySyncCoordinator({ project: {}, sessionId: 'merge-session', store, directory: f.root, managed: true,
    request: async (_project, scope, input) => {
      assert.equal(scope, 'sessions/merge-session/map'); requests.push(structuredClone(input));
      if (receipts.has(input.operationId)) return receipts.get(input.operationId);
      assert.equal(input.baseVersion, 'remote-v1');
      assert.deepEqual(await readJSON(coordinator.baseFile), remote, 'tail upload starts from the confirmed remote ancestor');
      uploaded = applyOperations(uploaded, input.operations, human).doc; applied++;
      const receipt = { version: 'remote-v2', cursor: 2, persistedAt: '2026-10-05T00:00:00Z' };
      receipts.set(input.operationId, receipt);
      throw new Error('receipt lost after server commit');
    },
  });
  t.after(async () => { await coordinator.close(); await store.close(); });
  coordinator.configuration = {};
  coordinator.status.serverVersion = 'old-version';
  await atomicWrite(coordinator.baseFile, encode(base));
  await atomicWrite(coordinator.outboxFile, encode({ operationId: 'superseded-request', baseVersion: 'old-version', operations: diffTrees(base.root, local.root) }));
  await coordinator.reconcileRemote({ version: 'remote-v1', memory: { map: remote } }, 1);
  const expected = structuredClone(local); expected.root.purpose = 'remote-only';
  assert.deepEqual(store.doc, expected);
  assert.equal(coordinator.snapshot().conflict, null);
  if (localTail) {
    assert.equal(coordinator.snapshot().pending, 1);
    const pending = await readJSON(coordinator.outboxFile);
    assert.notEqual(pending.operationId, 'superseded-request');
    assert.deepEqual(pending.operations, [{ type: 'update', id: 'T0', fields: { memories: local.root.memories } }]);
    assert.deepEqual(await readJSON(coordinator.baseFile), remote, 'unknown receipt cannot advance the ancestor');
    await coordinator.flush();
    assert.deepEqual(requests[1], requests[0], 'lost receipt replays the exact operation ID, base and payload');
    assert.equal(applied, 1);
    assert.deepEqual(uploaded, expected);
  } else assert.equal(requests.length, 0, 'identical local edits are already present remotely');
  assert.equal(coordinator.snapshot().status, 'synced');
  assert.deepEqual(await readJSON(coordinator.baseFile), expected);
  assert.equal(await readJSON(coordinator.outboxFile, null), null);
  await coordinator.reconcileRemote({ version: localTail ? 'remote-v2' : 'remote-v1', memory: { map: expected } }, localTail ? 2 : 1);
  assert.equal(requests.length, localTail ? 2 : 0, 'duplicate remote delivery never repeats the local tail');
});

for (const kind of ['different-title', 'delete-vs-edit', 'duplicate-record-id']) test(`Session reconcile preserves evidence for ${kind}`, async t => {
  const f = await fixture(), base = structuredClone(f.doc);
  base.root.todos = [{ id: 'TD1', title: 'before', status: 'pending' }];
  const local = structuredClone(base), remote = structuredClone(base);
  if (kind === 'different-title') { local.root.title = 'local'; remote.root.title = 'remote'; }
  else {
    local.root.todos = kind === 'delete-vs-edit' ? [] : [...local.root.todos, { id: 'TD1', title: 'ambiguous', status: 'pending' }];
    remote.root.todos[0].title = 'remote edit';
  }
  const store = { doc: local, off() {} };
  const coordinator = new MemorySyncCoordinator({ directory: f.root, sessionId: 'conflict-session', store });
  t.after(() => coordinator.close());
  const pending = { operationId: 'unconfirmed-local', baseVersion: 'old', operations: diffTrees(base.root, local.root) };
  await atomicWrite(coordinator.baseFile, encode(base));
  await atomicWrite(coordinator.outboxFile, encode(pending));
  await coordinator.reconcileRemote({ version: 'remote', memory: { map: remote } }, 3);
  assert.equal(coordinator.snapshot().conflict.code, 'REMOTE_AND_LOCAL_CHANGED');
  assert.deepEqual(await readJSON(coordinator.baseFile), base);
  assert.deepEqual(await readJSON(coordinator.outboxFile), pending);
  assert.deepEqual(store.doc, local);
  const conflict = await readJSON(coordinator.conflictFile);
  assert.deepEqual([conflict.base, conflict.local, conflict.remote], [base, local, remote]);
});

test('Session reconcile propagates commit permission errors without replacing the base or outbox', async t => {
  const f = await fixture(), base = f.doc, local = structuredClone(base), remote = structuredClone(base);
  local.root.title = remote.root.title = 'shared edit'; remote.root.purpose = 'remote-only';
  const store = { doc: local, version: 'local', off() {}, commit: async () => { throw Object.assign(new Error('permission denied'), { code: 'FORBIDDEN' }); } };
  const coordinator = new MemorySyncCoordinator({ directory: f.root, sessionId: 'permission-session', store });
  t.after(() => coordinator.close());
  const pending = { operationId: 'keep-permission-pending' };
  await atomicWrite(coordinator.baseFile, encode(base)); await atomicWrite(coordinator.outboxFile, encode(pending));
  await assert.rejects(coordinator.reconcileRemote({ version: 'remote', memory: { map: remote } }, 1), { code: 'FORBIDDEN' });
  assert.deepEqual(await readJSON(coordinator.baseFile), base);
  assert.deepEqual(await readJSON(coordinator.outboxFile), pending);
  assert.equal(await readJSON(coordinator.conflictFile, null), null);
});

test('journal recovery retries a bootstrap blocked by a Session reopen conflict', async () => {
  const store = { on() {}, off() {} };
  const coordinator = new MemorySyncCoordinator({ project: {}, sessionId: 'recovery-session', store, directory: '/unused' });
  coordinator.status = { configured: true, status: 'conflict', pending: 0, conflict: { code: 'MAIN_ADVANCED_BEFORE_SESSION_REOPEN' } };
  coordinator.persist = async fields => coordinator.update(fields);
  let initialized = 0;
  coordinator.initialize = async () => { initialized++; coordinator.update({ status: 'synced' }); };
  coordinator.onStoreEvent({ actor: { kind: 'system', sessionId: null }, actions: ['journal-recovery'] });
  await coordinator.serial;
  assert.equal(initialized, 1);
  assert.equal(coordinator.snapshot().status, 'synced');
  assert.equal(coordinator.snapshot().conflict, null);
});

test('Workbench keeps the bound Session identity visible while its Map needs recovery', async () => {
  const sync = Object.create(WorkbenchSync.prototype);
  const calls = [];
  Object.assign(sync, {
    config: { root: '/project' }, viewId: 'session:bound-session', activeSession: 'bound-session',
    repairButton: null, call: async route => {
      assert.equal(route, '/api/state');
      return { version: 'blocked-v1', doc: { root: null }, recovery: { code: 'JOURNAL_CORRUPT', message: 'recover' } };
    },
    connect: () => calls.push('connect'),
    refreshAccess: async () => calls.push('access'),
    refreshCloudStatus: async () => calls.push('cloud'),
    setStatus: (status, message) => calls.push(`${status}:${message}`),
  });
  assert.equal(await sync.start(), false);
  assert.deepEqual(calls.slice(0, 3), ['connect', 'access', 'cloud']);
  assert.equal(calls.at(-1), 'error:recover');
  assert.equal(sync.pendingSession, '');
});

test('failed Session switch restores canvas, version and identity together', async t => {
  const originalGlobals = Object.fromEntries(['location', 'history'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of Object.entries(originalGlobals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const originalUrl = 'https://example.invalid/projects/project?session=old&theme=sketch#map';
  const browserLocation = { href: originalUrl }, replacedUrls = [];
  Object.defineProperty(globalThis, 'location', { configurable: true, value: browserLocation });
  Object.defineProperty(globalThis, 'history', { configurable: true, value: {
    replaceState(_state, _title, url) {
      browserLocation.href = new URL(url, browserLocation.href).href;
      replacedUrls.push(browserLocation.href);
    },
  } });
  const sync = Object.create(WorkbenchSync.prototype);
  let tree = { id: 'old', title: 'Original' };
  const originalTree = structuredClone(tree), calls = [];
  const nextSnapshot = { version: 'v-next', doc: { root: { id: 'next', title: 'Wrong map' } } };
  let reloads = 0;
  Object.assign(sync, {
    config: { root: 'cloud:project' }, sessions: [{ id: 'next' }],
    activeSession: 'old', viewId: 'session:old', version: 'v-old',
    doc: { root: tree }, baseTree: tree, ready: true,
    a: { getRoot: () => tree, apply: doc => { tree = doc.root; } },
    panel: { querySelector: () => ({}) }, dirty: () => false,
    connect() {}, setStatus() {},
    async call(route, input, method, view) {
      calls.push({ route, input, method, view });
      assert.deepEqual(calls.at(-1), { route: '/api/state', input: undefined, method: 'GET', view: 'session:next' });
      assert.equal(this.activeSession, 'old', 'preflight precedes identity changes');
      assert.equal(this.viewId, 'session:old');
      return structuredClone(nextSnapshot);
    },
    async reload() {
      reloads++;
      assert.equal(this.activeSession, 'next');
      assert.equal(this.viewId, 'session:next');
      this.doc = structuredClone(nextSnapshot.doc);
      this.a.apply(this.doc); this.version = nextSnapshot.version; this.baseTree = this.doc.root;
      const url = new URL(location.href); url.searchParams.set('session', 'next');
      history.replaceState(null, '', url);
      throw new Error('interrupted switch');
    },
  });
  assert.equal(await sync.selectSession('next'), false);
  assert.deepEqual(calls, [{ route: '/api/state', input: undefined, method: 'GET', view: 'session:next' }]);
  assert.equal(reloads, 1, 'successful preflight reaches the partially applied reload');
  assert.equal(sync.activeSession, 'old');
  assert.equal(sync.viewId, 'session:old');
  assert.equal(sync.version, 'v-old');
  assert.equal(tree.id, 'old');
  assert.equal(sync.baseTree.id, 'old');
  assert.deepEqual(tree, originalTree);
  assert.deepEqual(sync.doc, { root: originalTree });
  assert.deepEqual(sync.baseTree, originalTree);
  assert.equal(sync.ready, true);
  assert.equal(sync.switchingSession, false);
  const nextUrl = new URL(originalUrl); nextUrl.searchParams.set('session', 'next');
  assert.deepEqual(replacedUrls, [nextUrl.href, originalUrl], 'rollback restores the changed browser URL');
  assert.equal(location.href, originalUrl);
});
after(async () => {
  const temporary = await fs.realpath(os.tmpdir());
  for (const root of fixtureRoots) {
    if (retainedFixtures.has(root)) continue;
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), temporary);
    assert.ok(path.basename(resolved).startsWith('cg-sync-'));
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-sync-'));
  fixtureRoots.push(root);
  const ctx = path.join(root, '.codex/context'); await fs.mkdir(path.join(ctx, 'sessions'), { recursive: true });
  const doc = { v: 1, project: 'test-project', unknownTop: { preserve: true }, root: { id: 'T0', title: '项目', kind: 'module', unknownNode: 42, children: [{ id: 'N1', title: '原始标题', kind: 'work', proposal: 'accepted', memories: [], bugs: [], children: [] }] } };
  await fs.writeFile(path.join(ctx, 'map.json'), encode(doc));
  await fs.writeFile(path.join(ctx, 'sessions.jsonl'), JSON.stringify({ at: '2026-01-01T00:00:00Z', platform: 'codex', session_id: agent.sessionId, thread_name: '真实会话名称', event: 'session-start' }) + '\n');
  return { root, ctx, doc };
}
test('local workbench serves the Ready Coordinator working animation and its atlas', async () => {
  const f = await fixture();
  const running = await startServer({ root: f.root, port: 0 });
  try {
    const base = new URL(running.state.url).origin;
    const module = await fetch(base + '/prototype/coordinator-working-blot.mjs');
    assert.equal(module.status, 200);
    assert.match(module.headers.get('content-type'), /text\/javascript/);
    assert.match(await module.text(), /createCoordinatorWorkingBlot/);
    const atlas = await fetch(base + '/prototype/working-blot-atlas.png');
    assert.equal(atlas.status, 200);
    assert.equal(atlas.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await atlas.arrayBuffer()), await fs.readFile('prototype/working-blot-atlas.png'));
  } finally {
    await running.close();
  }
});
function edit(store, title, extras = {}) { return { baseVersion: store.version, operationId: randomUUID(), operations: [{ type: 'update', id: 'N1', fields: { title } }], ...extras }; }
function agentProposal(id = 'N2', title = '提议', file = 'src/proposal.mjs') {
  return {
    type: 'create', parentId: 'T0', node: {
      id, title, purpose: '提供一个新的独立产品职责', kind: 'work', owns: [file],
      memories: [{ text: '新增独立职责', paths: [file], proposalEvidence: {
        parentId: 'T0', basis: 'new-responsibility', reason: '新增独立实现边界且当前 Map 没有对应节点', files: [file],
      } }],
    },
  };
}

test('attach-bug recovers when an old operation receipt outlives the Map entry', async () => {
  const sessionId = 'session-recovery', bug = { id: 'B4', title: '恢复坏例', status: 'open' };
  let visible = false, commit;
  const call = async (route, options = {}) => {
    if (route.startsWith('/api/operation?')) return { found: true, result: { committed: true, version: 'old-version' } };
    if (route === '/api/state') return {
      version: visible ? 'restored-version' : 'missing-version',
      doc: { root: { id: 'T0', bugs: [], children: [{ id: 'N1', bugs: visible ? [{ ...bug, sessions: [sessionId] }] : [], children: [] }] } },
    };
    if (route === '/api/commit') { commit = options.body; visible = true; return { committed: true, version: 'restored-version' }; }
    throw new Error(`unexpected route ${route}`);
  };
  const recovered = await attachBugWithRecovery(call, sessionId, { node: 'N1', bug });
  assert.equal(recovered.recovered, true);
  assert.equal(commit.baseVersion, 'missing-version');
  assert.match(commit.operationId, /^bug-recover:[a-f0-9]{24}$/);
  assert.equal(commit.recoveryOf, `bug:${sessionId}:${bug.id}`);
  assert.deepEqual(commit.operations, [{ type: 'attach-bug', id: 'N1', bug }]);
  commit = undefined;
  const duplicate = await attachBugWithRecovery(call, sessionId, { node: 'N1', bug });
  assert.equal(duplicate.duplicate, true);
  assert.equal(commit, undefined);
});

test('map apply rejects a request that only has operationId', async () => {
  const sessionId = agent.sessionId;
  await assert.rejects(
    prepareSessionCommit({ doc: {} }, { operationId: 'op-bad-only' }, agent, sessionId),
    error => error.code === 'INVALID_ARGUMENT' && error.status === 400 && /baseVersion/.test(error.message) && /operations/.test(error.message),
  );
  await assert.rejects(
    prepareSessionCommit({ doc: {} }, { operationId: 'op-bad-ops', baseVersion: 'v1' }, agent, sessionId),
    error => error.code === 'INVALID_ARGUMENT' && error.status === 400 && error.message.includes('operations') && !error.message.includes('baseVersion'),
  );
  await assert.rejects(
    prepareSessionCommit({ doc: {} }, { operationId: 'op-bad-base', operations: [{ type: 'update', id: 'N1', fields: { title: 'x' } }] }, agent, sessionId),
    error => error.code === 'INVALID_ARGUMENT' && error.status === 400 && error.message.includes('baseVersion') && !error.message.includes('operations'),
  );
});

test('orphan Bug recovery requires the original attachment receipt from the same Session', async () => {
  const sessionId = agent.sessionId, bug = { id: 'B4', title: '恢复坏例', status: 'open' };
  const input = { recoveryOf: `bug:${sessionId}:${bug.id}`, operations: [{ type: 'attach-bug', id: 'N1', bug }] };
  const validRecord = { result: { committed: true }, event: { actor: agent, operations: [{ type: 'attach-bug', id: 'N1', bug: { ...bug, sessions: [sessionId] } }] } };
  const prepared = await prepareSessionCommit({ doc: {}, operation: async () => validRecord }, input, agent, sessionId);
  assert.equal(prepared.actor.kind, 'recovery');
  assert.equal(prepared.input.operations[0].type, 'recover-bug');
  const preparedUpdate = await prepareSessionCommit(
    { doc: {}, operation: async () => validRecord },
    { recoveryOf: input.recoveryOf, operations: [{ type: 'update-bug', bug: { id: bug.id, status: 'resolved' } }] },
    agent,
    sessionId,
  );
  assert.equal(preparedUpdate.input.operations[0].id, 'N1');
  assert.equal(preparedUpdate.input.operations[0].bug.status, 'resolved');
  await assert.rejects(
    prepareSessionCommit({ doc: {}, operation: async () => null }, input, agent, sessionId),
    error => error.code === 'FORBIDDEN_RECOVERY',
  );
  await assert.rejects(
    prepareSessionCommit({ doc: {}, operation: async () => ({ ...validRecord, event: { ...validRecord.event, actor: { ...agent, sessionId: 'other' } } }) }, input, agent, sessionId),
    error => error.code === 'FORBIDDEN_RECOVERY',
  );
  const map = { v: 1, project: 'test', root: { id: 'T0', title: '项目', kind: 'module', children: [{ id: 'N1', title: '节点', kind: 'work', bugs: [], children: [] }] } };
  assert.throws(
    () => applyOperations(map, [{ type: 'recover-bug', id: 'N1', bug }], agent, ['N1']),
    error => error.code === 'FORBIDDEN_RECOVERY',
  );
  const recovered = applyOperations(
    { ...map, unassigned_bugs: [{ ...bug, desc: '保留内容', sessions: [] }] },
    [{ type: 'recover-bug', id: 'N1', bug }], { ...agent, kind: 'recovery' }, ['N1'],
  ).doc;
  assert.equal(recovered.unassigned_bugs.length, 0);
  assert.deepEqual(recovered.root.children[0].bugs[0].sessions, [sessionId]);
  assert.equal(recovered.root.children[0].bugs[0].desc, '保留内容');
});

test('update-bug restores an orphan before applying its status', async () => {
  const sessionId = 'session-recovery', bug = { id: 'B4', status: 'resolved' };
  let commit, projections = 0;
  const call = async (route, options = {}) => {
    if (route.startsWith('/api/operation?')) return { found: true, result: { committed: true } };
    if (route === '/api/state') return { version: 'missing-version', doc: { root: { id: 'T0', bugs: [], children: [] } } };
    if (route === '/api/commit') { commit = options.body; return { committed: true, version: 'restored-version' }; }
    if (route === '/api/projections') { projections += 1; return { status: 'ready' }; }
    throw new Error(`unexpected route ${route}`);
  };
  const result = await updateBugWithRecovery(call, sessionId, { bug });
  assert.equal(result.recovered, true);
  assert.match(commit.operationId, /^bug-status-recover:[a-f0-9]{24}$/);
  assert.equal(commit.recoveryOf, `bug:${sessionId}:${bug.id}`);
  assert.deepEqual(commit.operations, [{ type: 'update-bug', bug }]);
  assert.equal(projections, 1);
});
async function until(fn, timeout = 4000) { const end = Date.now() + timeout; while (!await fn()) { assert.ok(Date.now() < end, 'condition timed out'); await pause(25); } }

test('session registry exposes lifecycle state and filters maintenance actors', async () => {
  const f = await fixture(), access = await new Access(f.root).init();
  await fs.appendFile(path.join(f.ctx, 'sessions.jsonl'), [
    JSON.stringify({ at: '2026-01-01T00:00:01Z', event: 'maintenance', platform: 'cli', session_id: 'maintenance-test' }),
    JSON.stringify({ at: '2026-01-01T00:00:02Z', event: 'session-start', platform: 'cursor', session_id: 'second-session' }),
    JSON.stringify({ at: '2026-01-01T00:00:03Z', event: 'stop', platform: 'cursor', session_id: 'second-session' }),
  ].join('\n') + '\n');
  assert.deepEqual((await access.snapshot()).sessions, []);
  await access.register(agent.sessionId, { worktreeRoot: f.root });
  await access.register('second-session', { worktreeRoot: f.root });
  const snapshot = await access.snapshot();
  assert.deepEqual(snapshot.sessions.map(item => item.id), ['second-session', agent.sessionId]);
  assert.equal(snapshot.sessions[0].status, 'stopped');
  assert.equal(snapshot.sessions[1].status, 'active');
  assert.equal(snapshot.sessions[1].name, '真实会话名称');
  assert.equal(snapshot.currentSessionId, null);
  assert.equal((await access.snapshot(null, agent.sessionId)).currentSessionId, agent.sessionId);
  assert.equal(snapshot.grants[agent.sessionId].mode, 'all');
  assert.ok((await access.recordedSessionIds()).includes('maintenance-test'));
});

test('Codex task discovery supplies real names and active/completed state without a hook record', async () => {
  const f = await fixture();
  const access = await new Access(f.root, { codexSessions: async () => [
    { id: 'codex-active', name: '新任务', platform: 'codex', status: 'active', firstSeen: '2026-01-01T00:00:04Z', lastSeen: '2026-01-01T00:00:05Z', lastEvent: 'task_started' },
    { id: 'codex-complete', name: '已完成任务', platform: 'codex', status: 'stopped', firstSeen: '2026-01-01T00:00:02Z', lastSeen: '2026-01-01T00:00:03Z', lastEvent: 'task_complete' },
  ] }).init();
  assert.deepEqual((await access.snapshot()).sessions, []);
  await access.register('codex-active', { worktreeRoot: f.root });
  await access.register('codex-complete', { worktreeRoot: f.root });
  const snapshot = await access.snapshot();
  assert.equal(snapshot.currentSessionId, null);
  assert.equal((await access.snapshot(null, 'codex-active')).currentSessionId, 'codex-active');
  assert.deepEqual(snapshot.sessions.slice(0, 2).map(({ id, name, status }) => ({ id, name, status })), [
    { id: 'codex-active', name: '新任务', status: 'active' },
    { id: 'codex-complete', name: '已完成任务', status: 'stopped' },
  ]);
  assert.deepEqual(await access.register('codex-complete'), { kind: 'agent', sessionId: 'codex-complete' });
});

test('Codex database discovery hides its child process and reuses rows until the database changes', async () => {
  const f = await fixture();
  const database = path.join(f.root, 'state.sqlite');
  const rollout = path.join(f.root, 'rollout.jsonl');
  const started = JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', type: 'event_msg', payload: { type: 'task_started' } });
  const completed = JSON.stringify({ timestamp: '2026-01-01T00:00:01Z', type: 'event_msg', payload: { type: 'task_complete' } });
  await fs.writeFile(database, 'initial');
  await fs.writeFile(rollout, `${started}\n`);
  const calls = [];
  const access = await new Access(f.root, {
    codexDb: database,
    sqliteCommand: 'sqlite3-test',
    querySqlite: async () => null,
    allowExternalSqlite: true,
    execFile: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: JSON.stringify([{ id: 'codex-db', name: '数据库任务', created_at: 1, updated_at: 2, rollout_path: rollout }]) };
    },
  }).init();

  assert.equal((await access.discoverCodexSessions())[0].status, 'active');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'sqlite3-test');
  assert.equal(calls[0].options.windowsHide, true);

  await fs.appendFile(rollout, `${completed}\n`);
  assert.equal((await access.discoverCodexSessions())[0].status, 'stopped');
  assert.equal(calls.length, 1, 'rollout changes must not relaunch sqlite when the database is unchanged');

  await fs.appendFile(database, '-changed');
  await access.discoverCodexSessions();
  assert.equal(calls.length, 2, 'database changes must refresh the cached query');
});

test('supported Node.js does not fall back to an external SQLite process', async () => {
  const f = await fixture();
  const database = path.join(f.root, 'state.sqlite');
  await fs.writeFile(database, 'not-a-database');
  let externalCalls = 0;
  const access = await new Access(f.root, {
    codexDb: database,
    nodeVersion: '22.5.0',
    querySqlite: async () => null,
    execFile: async () => { externalCalls++; throw new Error('external SQLite must not run'); },
  }).init();

  assert.deepEqual(await access.discoverCodexSessions(), []);
  assert.equal(externalCalls, 0);
});

test('Node SQLite discovery reads Codex sessions without starting an external process', async t => {
  const sqlite = await import('node:sqlite').catch(() => null);
  if (!sqlite?.DatabaseSync) { t.skip('node:sqlite requires Node 22.5 or newer'); return; }
  const f = await fixture();
  const database = path.join(f.root, 'native-state.sqlite');
  const rollout = path.join(f.root, 'native-rollout.jsonl');
  const started = JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', type: 'event_msg', payload: { type: 'task_started' } });
  await fs.writeFile(rollout, `${started}\n`);
  const connection = new sqlite.DatabaseSync(database);
  try {
    connection.exec('CREATE TABLE threads (id TEXT, name TEXT, title TEXT, created_at INTEGER, updated_at INTEGER, rollout_path TEXT, cwd TEXT, thread_source TEXT, archived INTEGER)');
    connection.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('native-session', '进程内任务', '', 1, 2, rollout, path.toNamespacedPath(f.root), 'user', 0);
  } finally { connection.close(); }
  let externalCalls = 0;
  const access = await new Access(f.root, {
    codexDb: database,
    execFile: async () => { externalCalls++; throw new Error('external sqlite must not run'); },
  }).init();

  const sessions = await access.discoverCodexSessions();
  assert.deepEqual(sessions.map(({ id, name, status }) => ({ id, name, status })), [
    { id: 'native-session', name: '进程内任务', status: 'active' },
  ]);
  assert.equal(externalCalls, 0);
});

test('Codex discovery reads the sqlite subdirectory used by current Codex homes', async () => {
  const f = await fixture();
  const home = path.join(f.root, 'codex-home');
  const database = path.join(home, 'sqlite', 'state_5.sqlite');
  await fs.mkdir(path.dirname(database), { recursive: true });
  await fs.writeFile(database, 'state');
  const queries = [];
  const access = await new Access(f.root, {
    codexHome: home,
    querySqlite: async (file, sql) => {
      queries.push({ file, sql });
      return [{ id: 'exec-from-sqlite', name: 'exec 任务', cwd: f.root, created_at: 1, updated_at: 2, rollout_path: '' }];
    },
  }).init();
  const sessions = await access.discoverCodexSessions();
  assert.equal(queries[0].file, database);
  assert.deepEqual(sessions.map(({ id, name }) => ({ id, name })), [{ id: 'exec-from-sqlite', name: 'exec 任务' }]);
});

test('Codex thread lookup by id accepts cwd spelling differences and non-user sources', async () => {
  const f = await fixture();
  const access = await new Access(f.root, {
    codexDb: path.join(f.root, 'state.sqlite'),
    querySqlite: async (_file, sql) => {
      if (!sql.includes("id='exec-slash'")) return [];
      return [{ id: 'exec-slash', name: '斜杠 cwd', cwd: `${f.root}${path.sep}`, created_at: 1, updated_at: 2, rollout_path: '' }];
    },
  }).init();
  assert.equal(await access.sessionExists('exec-slash', f.root), true);
  assert.equal(await access.sessionExists('other-project', f.root), false);
  await access.register('exec-slash', { worktreeRoot: f.root });
  assert.equal((await access.snapshot()).sessions.some(item => item.id === 'exec-slash'), true);
});

test('host-attested Codex thread can register without a lifecycle hook', async () => {
  const f = await fixture();
  const access = await new Access(f.root, { codexSessions: async () => [] }).init();
  await assert.rejects(() => access.register('01a07d62-exec-thread', { worktreeRoot: f.root }), { code: 'UNKNOWN_SESSION' });
  assert.equal(hostAttestedPlatform('01a07d62-exec-thread', { CODEX_THREAD_ID: 'someone-else' }), '');
  assert.equal(await recordHostAttestedSession(f.root, '01a07d62-exec-thread', { CODEX_THREAD_ID: 'someone-else' }), false);
  assert.equal(await recordHostAttestedSession(f.root, '01a07d62-exec-thread', { CODEX_THREAD_ID: '01a07d62-exec-thread' }), true);
  assert.equal(await recordHostAttestedSession(f.root, '01a07d62-exec-thread', { CODEX_THREAD_ID: '01a07d62-exec-thread' }), false);
  assert.deepEqual(await access.register('01a07d62-exec-thread', { worktreeRoot: f.root }), { kind: 'agent', sessionId: '01a07d62-exec-thread' });
  const recorded = (await fs.readFile(path.join(f.ctx, 'sessions.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const host = recorded.find(item => item.session_id === '01a07d62-exec-thread');
  assert.equal(host.platform, 'codex');
  assert.equal(host.source, 'host-environment');
});

test('workbench and map read accept a host-attested Codex exec thread without a prior hook', async t => {
  const f = await fixture();
  let passed = false;
  retainedFixtures.add(f.root);
  t.after(async () => {
    const result = await stopServer(f.root);
    if (passed) { assert.equal(result.stopped, true, 'the CLI-owned backend acknowledges shutdown'); retainedFixtures.delete(f.root); }
  });
  const env = {
    ...process.env,
    CODEX_THREAD_ID: '01a07d62-exec-cli',
    CLAUDE_SESSION_ID: '',
    CURSOR_SESSION_ID: '',
    CONTEXT_GUARD_HEADLESS: '1',
    CONTEXT_GUARD_NAMED_WORKBENCH: '0',
  };
  const cli = (args, extraEnv = env) => execFileSync(process.execPath, ['scripts/workbench/cli.mjs', ...args], {
    cwd: process.cwd(), env: extraEnv, encoding: 'utf8', windowsHide: true,
  });
  const running = await startServer({ root: f.root, port: 0 });
  try {
    const denied = await fetch(new URL('/api/session', running.state.url), {
      method: 'POST',
      headers: { Authorization: `Bearer ${running.state.adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: '01a07d62-exec-cli', worktreeRoot: f.root }),
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'UNKNOWN_SESSION');
  } finally {
    await running.close();
  }
  let invented = '';
  try {
    cli(['map', 'read', '--root', f.root, '--session', 'invented-session', '--node', 'N1'], {
      ...env, CODEX_THREAD_ID: '',
    });
  } catch (error) {
    invented = `${error.stdout || ''}${error.stderr || ''}${error.message || ''}`;
  }
  assert.match(invented, /SESSION_BINDING_REQUIRED/);
  const bound = JSON.parse(cli(['workbench', '--root', f.root, '--session', '01a07d62-exec-cli', '--direct']));
  assert.equal(bound.binding.bound, true);
  const read = JSON.parse(cli(['map', 'read', '--root', f.root, '--session', '01a07d62-exec-cli', '--node', 'N1']));
  assert.equal(read.node.id, 'N1');
  assert.match(await fs.readFile(path.join(f.ctx, 'sessions.jsonl'), 'utf8'), /host-environment/);
  passed = true;
});

test('map read with CODEX_THREAD_ID binds without Cloud connect or a prior hook', async t => {
  const f = await fixture();
  let passed = false;
  retainedFixtures.add(f.root);
  t.after(async () => {
    const result = await stopServer(f.root);
    if (passed) { assert.equal(result.stopped, true, 'the CLI-owned backend acknowledges shutdown'); retainedFixtures.delete(f.root); }
  });
  try {
  const read = JSON.parse(execFileSync(process.execPath, [
    'scripts/workbench/cli.mjs', 'map', 'read', '--root', f.root, '--session', 'exec-auto-bind', '--node', 'N1',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_THREAD_ID: 'exec-auto-bind',
      CONTEXT_GUARD_HEADLESS: '1',
      CONTEXT_GUARD_NAMED_WORKBENCH: '0',
    },
    encoding: 'utf8',
    windowsHide: true,
  }));
  assert.equal(read.node.id, 'N1');
  assert.equal(read.error, null);
  passed = true;
  } catch (error) {
    retainedFixtures.add(f.root);
    const domainCodes = new Set(['START_FAILED', 'FORBIDDEN', 'UNKNOWN_SESSION', 'SESSION_BINDING_REQUIRED', 'SESSION_REQUIRED',
      'BINDING_REQUIRED', 'WORKBENCH_UNAVAILABLE', 'WORKBENCH_IDENTITY_MISMATCH', 'PROJECT_MISMATCH', 'UPGRADE_PENDING',
      'LEGACY_SERVICE', 'DUPLICATE_SERVICE', 'HTTP_ERROR', 'INVALID_MAP', 'JOURNAL_CORRUPT']);
    const summarize = output => {
      let json = false; const codes = new Set();
      for (const line of String(output || '').split(/\r?\n/)) {
        try { const value = JSON.parse(line); json = true; if (domainCodes.has(value?.error?.code)) codes.add(value.error.code); } catch {}
      }
      return { json, codes: [...codes] };
    };
    const log = await fs.readFile(path.join(f.ctx, 'private/node-workbench.log'), 'utf8').catch(() => '');
    const systemCodes = ['EADDRINUSE', 'EACCES', 'EPERM', 'ENOENT', 'ENAMETOOLONG', 'EPIPE', 'ECONNRESET', 'ETIMEDOUT'];
    t.diagnostic(JSON.stringify({ phase: 'host-attested-auto-bind', node: process.version,
      status: Number.isInteger(error.status) ? error.status : null,
      signal: ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(error.signal) ? error.signal : null,
      stdout: summarize(error.stdout), stderr: summarize(error.stderr),
      backendCodes: systemCodes.filter(code => new RegExp(`\\b${code}\\b`).test(log)), fixtureRetained: true }));
    throw error;
  }
});

test('workbench listen retries only Windows loopback port denials within the original range', () => {
  assert.equal(canRetryWorkbenchListen, sharedListenGuard, 'the existing server export uses the shared guard');
  const port = 8881, denied = { code: 'EACCES', syscall: 'listen', address: '127.0.0.1', port };
  assert.equal(canRetryWorkbenchListen(denied, port, 0, 'win32'), true);
  for (const platform of ['linux', 'darwin']) assert.equal(canRetryWorkbenchListen(denied, port, 0, platform), false);
  for (const error of [{ ...denied, syscall: 'open' }, { ...denied, syscall: 'authorize' },
    { ...denied, address: '0.0.0.0' }, { ...denied, port: port + 1 }, { ...denied, port: String(port) },
    { ...denied, code: 'EPERM' }, { code: 'EACCES' }]) assert.equal(canRetryWorkbenchListen(error, port, 0, 'win32'), false);
  assert.equal(canRetryWorkbenchListen({ ...denied, port: port + 19 }, port, 19, 'win32'), true);
  assert.equal(canRetryWorkbenchListen({ ...denied, port: port + 20 }, port, 20, 'win32'), false);
  assert.equal(canRetryWorkbenchListen({ ...denied, port: 0 }, 0, 0, 'win32'), false);
  for (const platform of ['win32', 'linux', 'darwin']) {
    assert.equal(canRetryWorkbenchListen({ code: 'EADDRINUSE' }, port, 0, platform), true);
    assert.equal(canRetryWorkbenchListen({ code: 'EADDRINUSE' }, 0, 0, platform), false);
    assert.equal(canRetryWorkbenchListen({ code: 'EADDRINUSE' }, port, 20, platform), false);
  }
});

test('owned HTTP listen denial uses the next loopback port on Windows and fails closed elsewhere', async t => {
  const f = await fixture();
  // The actual owned backend, not a separate port-zero probe, checks availability.
  const port = randomInt(49152, 65515);
  assert.ok(port >= 49152 && port <= 65514, 'the high fixture candidate has room for the bounded range');
  const create = http.createServer, attempts = [], listenerCounts = [], warnings = [];
  let running, owned, listenMock, factoryMock, listeningBaseline, sentinelCalls = 0;
  const sentinel = () => { sentinelCalls++; };
  const onWarning = warning => { if (warning.name === 'MaxListenersExceededWarning' && warning.emitter === owned) warnings.push(warning.type); };
  process.on('warning', onWarning);
  factoryMock = t.mock.method(http, 'createServer', (...args) => {
    // Restore the factory immediately; only this returned server is injected.
    factoryMock.mock.restore();
    owned = create(...args);
    owned.on('listening', sentinel);
    listeningBaseline = owned.listenerCount('listening');
    const listen = owned.listen;
    listenMock = t.mock.method(owned, 'listen', function (...input) {
      attempts.push({ port: input[0], address: input[1] });
      listenerCounts.push(owned.listenerCount('listening'));
      if (attempts.length <= 11) {
        // Node's real listen registers this callback before an async failure.
        owned.once('listening', input[2]);
        process.nextTick(() => owned.emit('error', Object.assign(new Error('Synthetic listen denial'), {
          code: 'EACCES', syscall: 'listen', address: '127.0.0.1', port: input[0],
        })));
        return owned;
      }
      return listen.apply(this, input);
    });
    return owned;
  });
  try {
    if (process.platform === 'win32') {
      running = await startServer({ root: f.root, port });
      assert.equal(running.server, owned);
      assert.ok(owned.listening);
      assert.ok(attempts.length >= 12 && attempts.length <= 21);
      assert.deepEqual(attempts, attempts.map((_value, index) => ({ port: port + index, address: '127.0.0.1' })));
      assert.equal(Number(new URL(running.state.url).port), attempts.at(-1).port);
      const response = await fetch(new URL('/api/state', running.state.url), { headers: { Authorization: `Bearer ${running.humanToken}` } });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).doc.root.id, 'T0');
      assert.equal(sentinelCalls, 1, 'the unrelated persistent listening listener is retained');
    } else {
      await assert.rejects(startServer({ root: f.root, port }), { code: 'EACCES', syscall: 'listen', address: '127.0.0.1', port });
      assert.deepEqual(attempts, [{ port, address: '127.0.0.1' }]);
    }
    assert.deepEqual(listenerCounts, attempts.map(() => listeningBaseline), 'failed attempts preserve exactly the native and unrelated listener baseline');
    assert.equal(owned.listenerCount('listening'), listeningBaseline);
    assert.equal(owned.listenerCount('error'), 0);
    assert.deepEqual(warnings, []);
  } finally {
    process.off('warning', onWarning);
    listenMock?.mock.restore(); factoryMock.mock.restore();
    await running?.close();
  }
});

test('rollout lifecycle parser maps work to spinner state and completion to check state', () => {
  const started = JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', type: 'event_msg', payload: { type: 'task_started' } });
  const completed = JSON.stringify({ timestamp: '2026-01-01T00:00:01Z', type: 'event_msg', payload: { type: 'task_complete' } });
  assert.equal(rolloutTaskStatus(started).status, 'active');
  assert.equal(rolloutTaskStatus(`${started}\n${completed}`).status, 'stopped');
  assert.equal(rolloutTaskStatus(JSON.stringify({ timestamp: '2026-01-01T00:00:02Z', type: 'turn_completed' })).status, 'stopped');
  assert.equal(rolloutTaskStatus(JSON.stringify({ timestamp: '2026-01-01T00:00:03Z', type: 'event_msg', payload: { event: { type: 'task_failed' } } })).status, 'stopped');
  assert.equal(rolloutTaskStatus('{}').status, 'unknown');
});

test('newer stopped evidence wins over a stale active discovery for a bound Session', async () => {
  const f = await fixture();
  await fs.appendFile(path.join(f.ctx, 'sessions.jsonl'), [
    JSON.stringify({ at: '2026-01-01T00:00:01Z', event: 'session-start', platform: 'codex', session_id: 'finished-session' }),
    JSON.stringify({ at: '2026-01-01T00:00:05Z', event: 'stop', platform: 'codex', session_id: 'finished-session' }),
  ].join('\n') + '\n');
  const access = await new Access(f.root, { codexSessions: async () => [{
    id: 'finished-session', name: '已结束任务', platform: 'codex', status: 'active',
    statusSeen: '2026-01-01T00:00:02Z', firstSeen: '2026-01-01T00:00:01Z',
    lastSeen: '2026-01-01T00:00:09Z', lastEvent: 'task_started',
  }] }).init();
  await access.register('finished-session', { worktreeRoot: f.root });
  const session = (await access.snapshot()).sessions[0];
  assert.equal(session.status, 'stopped');
  assert.equal(session.lastEvent, 'stop');
  assert.equal(session.statusSeen, '2026-01-01T00:00:05Z');
});

test('a governance-blocked Stop is not shown as a still-running Agent Session', async () => {
  const f = await fixture();
  await fs.appendFile(path.join(f.ctx, 'sessions.jsonl'), [
    JSON.stringify({ at: '2026-01-01T00:00:01Z', event: 'user-prompt-submit', platform: 'codex', session_id: 'blocked-stop' }),
    JSON.stringify({ at: '2026-01-01T00:00:02Z', event: 'stop-blocked', platform: 'codex', session_id: 'blocked-stop' }),
  ].join('\n') + '\n');
  const access = await new Access(f.root, { codexSessions: async () => [] }).init();
  await access.register('blocked-stop', { worktreeRoot: f.root });
  const session = (await access.snapshot()).sessions[0];
  assert.equal(session.status, 'stopped');
  assert.equal(session.lastEvent, 'stop-blocked');
});

test('Session sync compares node fields and parses chunked SSE safely', () => {
  assert.equal(operationsOverlap(
    [{ type: 'update', id: 'N1', fields: { title: 'local' } }],
    [{ type: 'update', id: 'N1', fields: { purpose: 'remote' } }],
  ), false);
  assert.equal(operationsOverlap(
    [{ type: 'update', id: 'N1', fields: { title: 'local' } }],
    [{ type: 'update', id: 'N1', fields: { title: 'remote' } }],
  ), true);
  assert.equal(operationsOverlap(
    [{ type: 'delete', id: 'N1' }],
    [{ type: 'update', id: 'N1', fields: { purpose: 'remote' } }],
  ), true);
  const parsed = parseSseBlocks('event: change\r\ndata: {"cursor":1}\r\n\r\nevent: change\ndata: {"cursor":');
  assert.deepEqual(parsed.blocks, ['event: change\ndata: {"cursor":1}']);
  assert.equal(parsed.rest, 'event: change\ndata: {"cursor":');
});

test('Legacy SSE deadline cancels a pending read independently of fetch abort', async t => {
  const f = await fixture();
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const coordinator = new MemorySyncCoordinator({ directory: f.root, store: { off() {} }, streamIdleMs: 30 });
  coordinator.abort = new AbortController();
  let timeout;
  t.after(async () => { clearTimeout(timeout); await coordinator.close(); });
  coordinator.armStreamDeadline();
  await Promise.race([
    coordinator.consumeEvents(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('pending stream read did not cancel')), 2000); }),
  ]);
  assert.equal(cancelled, true);
  assert.equal(coordinator.abort.signal.reason.code, 'EVENT_STREAM_TIMEOUT');
});

test('Legacy heartbeat is single-flight, write-free while idle, and stops on v2 takeover', async t => {
  const f = await fixture();
  let calls = 0, writes = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const coordinator = new MemorySyncCoordinator({ directory: f.root, sessionId: 'idle', store: { off() {} }, heartbeatMs: 20,
    request: async () => { calls++; await gate; return { cursor: 7 }; },
  });
  coordinator.status = { ...coordinator.status, status: 'synced', cursor: 7, serverVersion: 'version' };
  coordinator.persist = async fields => { writes++; coordinator.update(fields); };
  t.after(async () => { release(); await coordinator.close(); });
  coordinator.startLegacyHeartbeat();
  await pause(80);
  assert.equal(calls, 0, 'cached serverVersion cannot replace successful initialization');
  coordinator.initialized = true;
  await until(() => calls === 1);
  await pause(100);
  assert.equal(calls, 1, 'a slow request does not accumulate heartbeat requests');
  release();
  await until(() => calls >= 2);
  assert.equal(writes, 0, 'unchanged Cloud does not rewrite state or map');
  coordinator.status.conflict = { code: 'REMOTE_AND_LOCAL_CHANGED' };
  const conflictAt = calls;
  await pause(80);
  assert.equal(calls, conflictAt, 'heartbeat never bypasses an unresolved conflict');
  coordinator.status.conflict = null;
  await coordinator.projectHeartbeat({ mapVersion: 'version', mapCursor: 7 });
  const stoppedAt = calls;
  await pause(80);
  assert.equal(calls, stoppedAt, 'v2 takeover stops the legacy poller');
});

test('assignment scope includes the node, ancestors and direct flow/also relations', () => {
  const doc = {
    v: 1,
    project: 'scope',
    flows: [{ from: 'N2', to: 'N3' }],
    root: {
      id: 'T0', title: '项目', proposal: 'accepted', children: [
        { id: 'N1', title: '父级', proposal: 'accepted', children: [
          { id: 'N2', title: '目标', proposal: 'accepted', memories: [{ text: '关联', also: ['N4'] }], children: [] },
        ] },
        { id: 'N3', title: '流程关联', proposal: 'accepted', children: [] },
        { id: 'N4', title: '内容关联', proposal: 'accepted', children: [] },
      ],
    },
  };
  assert.deepEqual(new Set(assignmentScope(doc, 'N2')), new Set(['T0', 'N1', 'N2', 'N3', 'N4']));
  assert.throws(() => assignmentScope(doc, 'missing'), { code: 'NOT_FOUND' });
});

test('write, preserve unknown data, reject stale update, persist idempotency across restart', async () => {
  const f = await fixture(); let store = await new MapStore(f.root).init();
  try {
    const stale = edit(store, '不应覆盖'), request = { baseVersion: store.version, operationId: randomUUID(), operations: [{ type: 'create', parentId: 'T0', node: { id: 'N2', title: '新增' } }] };
    const result = await store.commit(request, human); assert.equal(result.committed, true);
    await assert.rejects(store.commit(stale, human), { code: 'VERSION_CONFLICT' });
    await store.close(); store = await new MapStore(f.root).init();
    assert.equal((await store.commit(request, human)).duplicate, true);
    assert.equal(store.doc.root.children.length, 2); assert.equal(store.doc.root.unknownNode, 42); assert.deepEqual(store.doc.unknownTop, { preserve: true });
    assert.equal(hash(await fs.readFile(store.file)), result.version);
    await assert.rejects(store.commit({ ...request, operations: [] }, human), { code: 'ID_REUSED' });
  } finally { await store.close(); }
});

for (const point of ['after-pending', 'after-map', 'after-event', 'after-result']) {
  test(`restart recovery at ${point} does not duplicate create`, async () => {
    const f = await fixture(); let fail = true;
    let store = await new MapStore(f.root, { fault: async p => { if (p === point && fail) { fail = false; throw new Error('injected crash'); } } }).init();
    const request = { baseVersion: store.version, operationId: randomUUID(), operations: [{ type: 'create', parentId: 'T0', node: { id: 'N2', title: '崩溃恢复' } }] };
    try { await assert.rejects(store.commit(request, human)); await store.close(); store = await new MapStore(f.root).init();
      const result = await store.commit(request, human); assert.equal(result.committed, true); assert.equal(store.doc.root.children.filter(x => x.id === 'N2').length, 1);
    } finally { await store.close(); }
  });
}

test('concurrent submissions serialize, invalid JSON and external replacement recover', async () => {
  const f = await fixture(), store = await new MapStore(f.root).init();
  try {
    const results = await Promise.allSettled([store.commit(edit(store, '甲'), human), store.commit(edit(store, '乙'), human)]);
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    await fs.writeFile(store.file, '{'); await until(() => store.error); assert.ok(store.doc.root.children[0].title);
    const next = structuredClone(store.doc); next.root.children[0].title = '外部保存';
    await atomicWrite(store.file, encode(next));
    await until(() => store.doc.root.children[0].title === '外部保存' && !store.error);
    assert.ok(store.events.at(-1).nodeIds.includes('N1')); assert.ok(store.events.at(-1).fields.includes('title'));
    assert.equal(store.changes('lost-cursor').reset, true); assert.equal(store.changes(store.cursor).changes.length, 0);
  } finally { await store.close(); }
});

test('permissions, field validation, cycles and missing references', async () => {
  const f = await fixture(), store = await new MapStore(f.root).init();
  try {
    await assert.rejects(store.commit(edit(store, '越权'), agent), { code: 'FORBIDDEN' });
    await store.commit(edit(store, '授权修改'), agent, ['N1']);
    await assert.rejects(store.commit(edit(store, '自确认', { operations: [{ type: 'update', id: 'N1', fields: { proposal: 'accepted' } }] }), agent, ['N1']), { code: 'FORBIDDEN' });
    await assert.rejects(store.commit(edit(store, '非法字段', { operations: [{ type: 'update', id: 'N1', fields: { origin: 'human' } }] }), agent, ['N1']), { code: 'INVALID_FIELDS' });
    assert.throws(() => applyOperations(store.doc, [{ type: 'move', id: 'T0', parentId: 'N1' }], human), { code: 'INVALID_MOVE' });
    assert.throws(() => applyOperations(store.doc, [{ type: 'update', id: 'N1', fields: { memories: [{ text: 'x', also: ['missing'] }] } }], human), { code: 'INVALID_REFERENCE' });
    assert.equal(applyOperations(store.doc, [{ type: 'update', id: 'N1', fields: { state: 'untested' } }], human).doc.root.children[0].state, 'untested');
    assert.throws(() => applyOperations(store.doc, [{ type: 'create', parentId: 'T0', node: { id: 'N2', title: '无证据提议' } }], agent), { code: 'INVALID_PROPOSAL' });
    const result = applyOperations(store.doc, [agentProposal()], agent);
    assert.equal(result.doc.root.children[1].proposal, 'proposed');
    assert.throws(() => applyOperations(result.doc, [agentProposal('N3', '提议', 'src/other.mjs')], agent), { code: 'DUPLICATE_PROPOSAL' });
  } finally { await store.close(); }
});

test('archive reconciliation updates owned nodes and leaves uncovered work unclassified', () => {
  const doc = {
    v: 1,
    project: 'archive-map',
    root: {
      id: 'T0', title: '项目', kind: 'module', proposal: 'accepted', memories: [], children: [
        { id: 'M1', title: '运行时', kind: 'module', proposal: 'accepted', memories: [], owns: ['src/'], children: [
          { id: 'N1', title: '入口', kind: 'work', proposal: 'accepted', memories: [], owns: ['src/index.js'], children: [] },
        ] },
      ],
    },
  };
  assert.equal(ownerForPath(doc, 'src/index.js').id, 'N1');
  assert.equal(ownerForPath(doc, 'src/worker.js').id, 'M1');
  assert.equal(ownerForPath(doc, 'feature/new.js'), null);
  const input = { summary: '实现新的自动记录功能', files: ['src/index.js', 'src/worker.js', 'feature/new.js'] };
  const reconciliation = buildArchiveReconciliation(doc, agent.sessionId, input);
  assert.deepEqual(reconciliation.mapped, { N1: ['src/index.js'], M1: ['src/worker.js'] });
  assert.deepEqual(reconciliation.uncovered, ['feature/new.js']);
  assert.deepEqual(reconciliation.unclassified, ['feature/new.js']);
  assert.equal(reconciliation.proposedId, null);
  assert.deepEqual(reconciliation.operations.map(operation => operation.type), ['update', 'update']);
  assert.throws(() => applyOperations(doc, reconciliation.operations, agent), { code: 'FORBIDDEN' });
  const updated = applyOperations(doc, reconciliation.operations, agent, ['M1', 'N1']).doc;
  assert.equal(updated.root.children[0].children[0].memories[0].session, agent.sessionId);
  assert.equal(buildArchiveReconciliation(updated, agent.sessionId, input).operations.length, 0);
});

test('archive reconciliation explicitly assigns support files to an accepted node', () => {
  const doc = {
    v: 1,
    project: 'archive-map',
    root: { id: 'T0', title: '项目', kind: 'module', proposal: 'accepted', children: [
      { id: 'W1', title: '工作台', purpose: '提供可视化工作台', kind: 'work', proposal: 'accepted', owns: ['prototype/workbench.html'], memories: [], children: [] },
    ] },
  };
  const input = {
    summary: '修复工作台并补齐回归',
    files: ['prototype/workbench.html', 'scripts/workbench/server.mjs', 'tests/workbench-browser.mjs', 'references/design/design-workbench-interface-v1.1.0.md'],
    assignments: [{
      nodeId: 'W1',
      reason: '服务、测试和接口文档都是工作台实现的配套变更',
      files: ['scripts/workbench/server.mjs', 'tests/workbench-browser.mjs', 'references/design/design-workbench-interface-v1.1.0.md'],
    }],
  };
  const reconciliation = buildArchiveReconciliation(doc, agent.sessionId, input);
  assert.deepEqual(reconciliation.mapped, { W1: [
    'prototype/workbench.html', 'references/design/design-workbench-interface-v1.1.0.md', 'scripts/workbench/server.mjs', 'tests/workbench-browser.mjs',
  ] });
  assert.deepEqual(reconciliation.unclassified, []);
  assert.equal(reconciliation.operations.length, 1);
  const updated = applyOperations(doc, reconciliation.operations, agent, ['W1']).doc;
  assert.equal(updated.root.children[0].memories[0].assignmentEvidence[0].reason, input.assignments[0].reason);
});

test('archive reconciliation only creates evidence-backed proposals and deduplicates them', () => {
  const doc = {
    v: 1,
    project: 'archive-map',
    root: { id: 'T0', title: '项目', kind: 'module', proposal: 'accepted', children: [] },
  };
  const base = { summary: '新增独立通知模块', files: ['src/notify/index.mjs', 'tests/notify.test.mjs'] };
  assert.throws(() => buildArchiveReconciliation(doc, agent.sessionId, {
    ...base,
    proposal: { parentId: 'T0', title: '通知', purpose: '发送通知', files: base.files },
  }), /reason/);
  assert.throws(() => buildArchiveReconciliation(doc, agent.sessionId, {
    summary: '只补测试', files: ['tests/notify.test.mjs'],
    proposal: { parentId: 'T0', title: '通知', purpose: '发送通知', reason: '新职责', basis: 'new-module', files: ['tests/notify.test.mjs'] },
  }), /cannot be the sole evidence/);
  const proposal = {
    parentId: 'T0',
    title: '通知',
    purpose: '集中处理外部通知发送',
    reason: '新增独立运行边界和入口，不属于现有节点',
    basis: 'new-module',
    files: base.files,
  };
  const reconciliation = buildArchiveReconciliation(doc, agent.sessionId, { ...base, proposal });
  assert.deepEqual(reconciliation.unclassified, []);
  assert.deepEqual(reconciliation.operations.map(operation => operation.type), ['create']);
  const updated = applyOperations(doc, reconciliation.operations, agent).doc;
  const proposed = updated.root.children[0];
  assert.equal(proposed.id, reconciliation.proposedId);
  assert.equal(proposed.proposal, 'proposed');
  assert.equal(proposed.memories[0].proposalEvidence.basis, 'new-module');
  assert.equal(buildArchiveReconciliation(updated, agent.sessionId, { ...base, proposal }).operations.length, 0);

  const later = buildArchiveReconciliation(updated, agent.sessionId, { ...base, summary: '继续完善通知模块', proposal });
  assert.equal(later.proposedId, proposed.id);
  assert.equal(later.proposalDuplicate, true);
  assert.deepEqual(later.operations.map(operation => operation.type), ['update']);
  const laterDoc = applyOperations(updated, later.operations, agent).doc;
  assert.equal(laterDoc.root.children.length, 1);
  assert.equal(laterDoc.root.children[0].memories.length, 2);
  const otherSession = buildArchiveReconciliation(laterDoc, 'other-session', { ...base, summary: '另一会话发现同一模块', proposal });
  assert.equal(otherSession.proposedId, proposed.id);
  assert.equal(otherSession.proposalDuplicate, true);
  assert.deepEqual(otherSession.operations, []);
});

test('archive governance rejects duplicate, conflicting, and unrelated declarations', () => {
  const doc = {
    v: 1,
    project: 'archive-map',
    root: { id: 'T0', title: '项目', kind: 'module', proposal: 'accepted', children: [
      { id: 'N1', title: '入口', kind: 'work', proposal: 'accepted', owns: ['src/index.js'], memories: [], children: [] },
    ] },
  };
  assert.throws(() => buildArchiveReconciliation(doc, agent.sessionId, {
    files: ['src/index.js'], assignments: [{ nodeId: 'N1', reason: '重复声明', files: ['src/index.js'] }],
  }), /owns already covers/);
  assert.throws(() => buildArchiveReconciliation(doc, agent.sessionId, {
    files: ['feature/new.js'], assignments: [{ nodeId: 'missing', reason: '不存在', files: ['feature/new.js'] }],
  }), /accepted Map node/);
  assert.throws(() => buildArchiveReconciliation(doc, agent.sessionId, {
    files: ['feature/new.js'], proposal: {
      parentId: 'T0', title: '入口', purpose: '重复入口', reason: '误判为新职责', basis: 'new-responsibility', files: ['feature/new.js'],
    },
  }), /duplicates an accepted node title/);
});

test('archive reconciliation keeps optimistic version conflicts visible', async () => {
  const f = await fixture(), store = await new MapStore(f.root).init();
  try {
    store.doc.root.children[0].owns = ['src/'];
    await atomicWrite(store.file, encode(store.doc));
    await store.refresh();
    const reconciliation = buildArchiveReconciliation(store.doc, agent.sessionId, { summary: '完成归档', files: ['src/index.js'] });
    const request = { baseVersion: store.version, operationId: reconciliation.operationId, operations: reconciliation.operations };
    await store.commit(edit(store, '并发的人类修改'), human);
    await assert.rejects(store.commit(request, agent, ['N1']), { code: 'VERSION_CONFLICT' });
  } finally { await store.close(); }
});

test('bad-case compatibility operations attach unassigned cases and resolve them', async () => {
  const f = await fixture();
  const attached = applyOperations(f.doc, [{ type: 'attach-bug', id: '', bug: { id: 'B1', title: '未挂节点', status: 'open', sessions: [agent.sessionId] } }], agent).doc;
  assert.equal(attached.unassigned_bugs[0].id, 'B1');
  const resolved = applyOperations(attached, [{ type: 'update-bug', bug: { id: 'B1', status: 'resolved' } }], agent).doc;
  assert.equal(resolved.unassigned_bugs[0].status, 'resolved');
  assert.throws(() => applyOperations(resolved, [{ type: 'update-bug', bug: { id: 'B9', status: 'resolved' } }], agent), { code: 'NOT_FOUND' });
});

test('bug status writes reject deferral and accept unfixable without reopening leftover deferred records', () => {
  const f = { doc: { v: 1, root: { id: 'T0', title: 'Root', kind: 'module', state: 'dirty', children: [], bugs: [
    { id: 'B1', title: '现行', status: 'open' },
    { id: 'B2', title: '历史延期', status: 'deferred' },
  ] } } };
  assert.equal(isClosedBugStatus('fixed'), false);
  assert.equal(isClosedBugStatus('deferred'), true);
  assert.throws(() => applyOperations(f.doc, [{ type: 'update-bug', bug: { id: 'B1', status: 'deferred' } }], agent), { code: 'INVALID_BUG' });
  assert.throws(() => applyOperations(f.doc, [{ type: 'update-bug', bug: { id: 'B1', status: 'wontfix' } }], agent), { code: 'INVALID_BUG' });
  assert.throws(() => applyOperations(f.doc, [{ type: 'attach-bug', bug: { id: 'B3', title: '新延期', status: 'deferred' } }], agent), { code: 'INVALID_BUG' });
  const closed = applyOperations(f.doc, [{ type: 'update-bug', bug: { id: 'B1', status: 'unfixable' } }], agent).doc;
  assert.equal(closed.root.bugs.find(item => item.id === 'B1').status, 'unfixable');
  assert.equal(closed.root.bugs.find(item => item.id === 'B2').status, 'deferred');
});

test('projection retains legacy/manual content, includes state and bugs, detects pending versions', async () => {
  const f = await fixture(); await fs.mkdir(path.join(f.ctx, 'cards')); await fs.writeFile(path.join(f.ctx, 'cards/N1.md'), '人工笔记不能丢失\n');
  f.doc.root.children[0].bugs.push({ id: 'B32', title: '回归坏例', status: 'open' });
  f.doc.root.children[0].todos = [{ id: 'TD1', title: '开发新需求', status: 'processing' }];
  await generateProjections(f.root, f.doc, 'version-one');
  let card = await fs.readFile(path.join(f.ctx, 'cards/N1.md'), 'utf8'); assert.match(card, /人工笔记不能丢失/); assert.match(card, /B32/); assert.match(card, /TD1: 开发新需求 \[processing\]/); assert.match(card, /sourceVersion: version-one/);
  await fs.appendFile(path.join(f.ctx, 'cards/N1.md'), '\n后续人工补充\n'); await generateProjections(f.root, f.doc, 'version-two');
  card = await fs.readFile(path.join(f.ctx, 'cards/N1.md'), 'utf8'); assert.match(card, /后续人工补充/); assert.equal(card.split('人工笔记不能丢失').length, 2); assert.doesNotMatch(card, /version-one/);
});

test('Session projection indexes only work assigned to that Session', async () => {
  const f = await fixture();
  await fs.mkdir(path.join(f.ctx, 'bugs'), { recursive: true });
  await fs.mkdir(path.join(f.ctx, 'tasks'), { recursive: true });
  f.doc.root.children[0].bugs.push(
    { id: 'B1', title: '当前 Bug', status: 'open', sessions: [agent.sessionId] },
    { id: 'B2', title: '其他 Bug', status: 'open', sessions: ['other-session'] },
  );
  f.doc.root.children[0].todos = [
    { id: 'TD1', title: '当前 TODO', status: 'processing', sessions: [agent.sessionId] },
    { id: 'TD2', title: '其他 TODO', status: 'processing', sessions: ['other-session'] },
  ];
  await Promise.all([
    fs.writeFile(path.join(f.ctx, 'bugs/B1.md'), '# B1 当前 Bug\n'),
    fs.writeFile(path.join(f.ctx, 'bugs/B2.md'), '# B2 其他 Bug\n'),
    fs.writeFile(path.join(f.ctx, 'tasks/TD1.md'), '# TD1 当前 TODO\n'),
    fs.writeFile(path.join(f.ctx, 'tasks/TD2.md'), '# TD2 其他 TODO\n'),
  ]);
  const scoped = scopeDocumentToSession(f.doc, agent.sessionId);
  await generateProjections(f.root, scoped, 'session-version', () => true, { sessionId: agent.sessionId });
  const [bugs, tasks, card] = await Promise.all([
    readJSON(path.join(f.ctx, 'bugs-index.json')),
    readJSON(path.join(f.ctx, 'tasks-index.json')),
    fs.readFile(path.join(f.ctx, 'cards/N1.md'), 'utf8'),
  ]);
  assert.deepEqual(Object.keys(bugs), ['B1']);
  assert.deepEqual(Object.keys(tasks), ['TD1']);
  assert.match(card, /B1: 当前 Bug/);
  assert.doesNotMatch(card, /B2: 其他 Bug/);
  assert.match(card, /TD1: 当前 TODO/);
  assert.doesNotMatch(card, /TD2: 其他 TODO/);
});

test('Session work-item scope hides other assignments and preserves them during edits', () => {
  const doc = {
    v: 1,
    project: 'scope-test',
    unassigned_bugs: [{ id: 'B4', title: '未分配', status: 'open', sessions: [] }],
    root: {
      id: 'T0', title: '项目', kind: 'module', children: [{
        id: 'N1', title: '节点', kind: 'work', proposal: 'accepted',
        bugs: [
          { id: 'B1', title: '我的', status: 'open', sessions: ['session-a'] },
          { id: 'B2', title: '别人的', status: 'open', sessions: ['session-b'] },
          { id: 'B3', title: '共同的', status: 'open', sessions: ['session-a', 'session-b'], dispatch: { session_id: 'session-b' } },
        ],
        todos: [
          { id: 'TD1', title: '我的任务', status: 'processing', sessions: ['session-a'] },
          { id: 'TD2', title: '别人的任务', status: 'processing', target_session: 'session-b', sessions: ['session-b'] },
        ],
        children: [],
      }],
    },
  };
  const scoped = scopeDocumentToSession(doc, 'session-a');
  const node = scoped.root.children[0];
  assert.deepEqual(node.bugs.map(item => item.id), ['B1', 'B3']);
  assert.deepEqual(node.todos.map(item => item.id), ['TD1']);
  assert.deepEqual(node.bugs[1].sessions, ['session-a']);
  assert.equal(node.bugs[1].dispatch, undefined);
  assert.deepEqual(scoped.unassigned_bugs, []);

  node.bugs[0].title = '我的（已修改）';
  node.bugs[1].sessions = [];
  const operations = restoreSessionWorkItemOperations(doc, [{ type: 'update', id: 'N1', fields: { bugs: node.bugs } }], 'session-a');
  const restored = operations[0].fields.bugs;
  assert.equal(restored.find(item => item.id === 'B1').title, '我的（已修改）');
  assert.deepEqual(restored.find(item => item.id === 'B2').sessions, ['session-b']);
  assert.deepEqual(restored.find(item => item.id === 'B3').sessions, ['session-b']);
  assert.throws(() => restoreSessionWorkItemOperations(doc, undefined, 'session-a'), { code: 'INVALID_OPERATIONS' });
  assert.throws(() => restoreSessionWorkItemOperations(doc, null, 'session-a'), { code: 'INVALID_OPERATIONS' });
  assert.throws(() => restoreSessionWorkItemOperations(doc, [], 'session-a'), { code: 'INVALID_OPERATIONS' });
  assert.throws(() => restoreSessionWorkItemOperations(doc, [{ type: 'update-bug', bug: { id: 'B2', status: 'resolved' } }], 'session-a'), { code: 'FORBIDDEN_WORK_ITEM' });
  assert.throws(() => restoreSessionWorkItemOperations(doc, [{ type: 'update', id: 'N1', fields: { bugs: [{ id: 'B2', title: '伪造覆盖', status: 'open', sessions: ['session-a'] }] } }], 'session-a'), { code: 'FORBIDDEN_WORK_ITEM' });

  const changes = scopeChangesToSession({ changes: [{ operations: [{ type: 'update', id: 'N1', fields: { bugs: doc.root.children[0].bugs } }] }] }, doc, 'session-a');
  assert.deepEqual(changes.changes[0].operations[0].fields.bugs.map(item => item.id), ['B1', 'B3']);
});

test('Cursor runtime HTTP requires local CLI authority and an exact Cursor binding', async () => {
  const f = await fixture(), sessionId = randomUUID(), otherSessionId = randomUUID();
  retainedFixtures.add(f.root); // 用户要求保留本地文件；仅关闭本测试服务。
  for (const [id, platform] of [[sessionId, 'cursor'], [otherSessionId, 'claude']]) {
    await fs.appendFile(path.join(f.ctx, 'sessions.jsonl'), JSON.stringify({ at: new Date().toISOString(), platform, session_id: id, event: 'session-start' }) + '\n');
  }
  const running = await startServer({ root: f.root, port: 0 });
  const base = new URL(running.state.url).origin;
  const call = async (credential, input, headers = {}) => {
    const response = await fetch(base + '/api/cursor-runtime', { method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const register = async id => {
      const response = await fetch(base + '/api/session', { method: 'POST', headers: { Authorization: `Bearer ${running.state.adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: id }) });
      assert.equal(response.status, 200); return response.json();
    };
    const registered = await register(sessionId); await register(otherSessionId);
    const config = { command: process.execPath, root: f.root, name: 'Cursor fixture' }, input = { sessionId, action: 'configure', config };
    for (const credential of [running.humanToken, registered.token, 'invalid']) assert.equal((await call(credential, input)).status, 401);
    assert.equal((await call(running.state.adminToken, input, { Origin: base })).status, 401);
    assert.equal((await call(running.state.adminToken, { ...input, sessionId: otherSessionId })).status, 409);
    assert.equal((await call(running.state.adminToken, { ...input, config: { ...config, root: os.tmpdir() } })).status, 409);
    assert.equal((await call(running.state.adminToken, input)).data.configured, true);
    const status = await call(running.state.adminToken, { sessionId, action: 'status' });
    assert.equal(status.status, 200); assert.equal(status.data.status, 'stopped'); assert.equal(status.data.nativeSessionId, sessionId);
    assert.equal((await call(running.state.adminToken, { sessionId, action: 'message', message: { id: 'bad', message: 'No invocation', root: '/foreign' } })).status, 400);
    const chat = async (route, credential, input) => {
      const response = await fetch(base + route, { method: input ? 'POST' : 'GET', headers: { Authorization: `Bearer ${credential}`, ...(input ? { 'Content-Type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
      return { status: response.status, data: await response.json() };
    };
    assert.equal((await chat('/api/cursor-chat', registered.token)).status, 403);
    assert.equal((await chat('/api/cursor-chat', 'invalid')).status, 401);
    assert.deepEqual((await chat('/api/cursor-chat', running.humanToken)).data.sessions, [{ id: sessionId, name: config.name, kind: 'local' }]);
    assert.equal((await chat('/api/cursor-chat?session=' + otherSessionId, running.humanToken)).status, 403);
    const module = await fetch(base + '/prototype/cursor-chat.mjs');
    assert.equal(module.status, 200); assert.match(module.headers.get('content-type'), /javascript/);
    const sent = await chat('/api/cursor-chat', running.humanToken, { id: 'fixture-turn', sessionId, text: 'Synthetic boundary task' });
    assert.equal(sent.status, 200); assert.equal(sent.data.state, 'received');
    // Node is intentionally not a Cursor executable. A provider failure must
    // produce a terminal failure, not a green successful task or missing prompt.
    let view;
    const deadline = Date.now() + 6000;
    do {
      view = await chat('/api/cursor-chat?session=' + sessionId, running.humanToken);
      if (view.data.status === 'failed') break;
      assert.ok(Date.now() < deadline, 'failed native process did not reach its public terminal state');
      await pause(25);
    } while (true);
    assert.equal(view.status, 200); assert.equal(view.data.error, 'CURSOR_DISCONNECTED');
    assert.deepEqual(view.data.messages, [{ id: 'local-native:fixture-turn:user', role: 'user', text: 'Synthetic boundary task' }]);
    const duplicate = await chat('/api/cursor-chat', running.humanToken, { id: 'fixture-turn', sessionId, text: 'Synthetic boundary task' });
    assert.deepEqual(duplicate, sent);
    assert.equal((await chat('/api/cursor-chat', running.humanToken, { id: 'fixture-turn', sessionId, text: 'Changed task' })).data.error.code, 'ID_REUSED');
  } finally { await running.close(); }
});

test('Claude recovery HTTP is local-operator-only and requires a bound interrupted receiver', async () => {
  const f = await fixture(), sessionId = randomUUID();
  await fs.appendFile(path.join(f.ctx, 'sessions.jsonl'), JSON.stringify({ at: new Date().toISOString(), platform: 'claude', session_id: sessionId, event: 'session-start' }) + '\n');
  const running = await startServer({ root: f.root, port: 0 });
  const base = new URL(running.state.url).origin;
  const call = async (route, token, input, headers = {}) => {
    const response = await fetch(base + route, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const registration = await call('/api/session', running.state.adminToken, { sessionId });
    assert.equal(registration.status, 200);
    const recovery = { operationId: 'recover', deliveryId: 'absent', message: 'Continue only existing approved work' }, input = { sessionId, recovery };
    for (const token of [running.humanToken, registration.data.token, 'invalid']) {
      assert.equal((await call('/api/claude-runtime', token, input)).status, 401);
    }
    assert.equal((await call('/api/claude-runtime', running.state.adminToken, input, { Origin: base })).status, 401);
    assert.equal((await call('/api/claude-runtime', running.state.adminToken, { ...input, sessionId: randomUUID() })).status, 409);
    const environmentFile = path.join(f.root, 'provider.json'); await fs.writeFile(environmentFile, '{}');
    const configured = await call('/api/claude-runtime', running.state.adminToken, { sessionId, config: {
      command: process.execPath, root: f.root, configDir: path.join(f.root, 'claude-config'), environmentFile, name: 'Fixture', model: 'fixture-model', role: 'executor',
    } });
    assert.equal(configured.status, 200);
    const absent = await call('/api/claude-runtime', running.state.adminToken, input);
    assert.equal(absent.data.error.code, 'RECOVERY_NOT_AVAILABLE');
    assert.equal((await call('/api/claude-runtime', running.state.adminToken, { ...input, config: {} })).status, 409);
  } finally { await running.close(); }
});

test('HTTP rejects forged role, origin, path access; sessions/scopes/revocation and migration preview', async () => {
  const f = await fixture(), delivered = [];
  f.doc.root.children[0].bugs.push(
    { id: 'B1', title: '待分配', status: 'open', sessions: [] },
    { id: 'B2', title: '分配给当前 Session', status: 'open', sessions: [agent.sessionId] },
    { id: 'B3', title: '分配给其他 Session', status: 'open', sessions: ['other-session'] },
  );
  f.doc.root.children[0].todos = [
    { id: 'TD1', title: '新需求', status: 'pending', sessions: [] },
    { id: 'TD2', title: '当前任务', status: 'processing', sessions: [agent.sessionId] },
    { id: 'TD3', title: '其他任务', status: 'processing', sessions: ['other-session'] },
  ];
  await fs.writeFile(path.join(f.ctx, 'map.json'), encode(f.doc));
  const running = await startServer({ root: f.root, port: 0, messageQueue: async payload => delivered.push(payload) });
  const base = new URL(running.state.url).origin;
  const call = async (route, credential, data, headers = {}) => {
    const response = await fetch(base + route, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', ...headers }, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, data: await response.json() };
  };
  try {
    await fs.writeFile(path.join(f.ctx, 'l1-candidates.json'), '{"lenses":[]}');
    assert.equal((await call('/.codex/context/l1-candidates.json', running.humanToken)).status, 200);
    const registration = await call('/api/session', running.state.adminToken, { sessionId: agent.sessionId }); assert.equal(registration.status, 200);
    const accessState = await call('/api/access', running.humanToken);
    assert.equal(accessState.data.sessions[0].id, agent.sessionId);
    assert.equal(accessState.data.currentSessionId, null);
    assert.equal(accessState.data.grants[agent.sessionId].mode, 'all');
    assert.deepEqual(new Set(accessState.data.grants[agent.sessionId].nodes), new Set(['T0', 'N1']));
    const selectedAccess = await call(`/api/access?view=session%3A${agent.sessionId}`, running.humanToken);
    assert.equal(selectedAccess.data.currentSessionId, agent.sessionId);
    assert.deepEqual(selectedAccess.data.sessions.map(item => item.id), [agent.sessionId]);
    const credential = registration.data.token;
    const agentState = await call('/api/state', credential);
    assert.deepEqual(agentState.data.doc.root.children[0].bugs.map(item => item.id), ['B2']);
    assert.deepEqual(agentState.data.doc.root.children[0].todos.map(item => item.id), ['TD2']);
    const selectedState = await call(`/api/state?view=session%3A${agent.sessionId}`, running.humanToken);
    assert.deepEqual(selectedState.data.doc.root.children[0].bugs.map(item => item.id), ['B2']);
    const globalState = await call('/api/state', running.humanToken);
    assert.deepEqual(globalState.data.doc.root.children[0].bugs.map(item => item.id), ['B1', 'B2', 'B3']);
    assert.equal((await call('/api/session', running.state.adminToken, { sessionId: 'fake-session' })).status, 403);
    assert.equal((await call('/api/state', credential, null, { Origin: 'https://evil.invalid' })).status, 403);
    assert.equal((await call('/package.json', credential)).status, 404);
    const cleanPage = await new Promise((resolve, reject) => {
      const request = http.get(`${base}/api/events?token=${encodeURIComponent(running.humanToken)}&clientId=clean-reload`, resolve);
      request.on('error', reject);
    });
    cleanPage.destroy(); await pause(30);
    assert.equal((await call('/api/state', credential)).status, 200, 'a disconnected clean page must not block Agent checkpoints');
    const dirtyPage = await new Promise((resolve, reject) => {
      const request = http.get(`${base}/api/events?token=${encodeURIComponent(running.humanToken)}&clientId=dirty-reload`, response => {
        let buffer = '';
        response.on('data', chunk => {
          buffer += chunk.toString('utf8');
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (!block.includes('event: checkpoint')) continue;
            const checkpoint = JSON.parse(block.split('\n').find(line => line.startsWith('data: ')).slice(6)).checkpoint;
            call('/api/presence', running.humanToken, { clientId: 'dirty-reload', dirty: true, version: running.store.version, checkpoint }).catch(reject);
          }
        });
        resolve(response);
      });
      request.on('error', reject);
    });
    assert.equal((await call('/api/presence', running.humanToken, { clientId: 'dirty-reload', dirty: true, version: running.store.version })).status, 200);
    assert.equal((await call('/api/state', credential)).status, 409, 'a responsive dirty page must block Agent checkpoints');
    dirtyPage.destroy(); await pause(30);
    assert.equal((await call('/api/state', credential)).status, 200, 'a disconnected dirty page must not remain as a phantom checkpoint peer');
    assert.equal((await call('/api/access', credential, { sessionId: agent.sessionId, nodes: ['N1'], actor: 'human' })).status, 403);
    assert.equal((await call('/api/access-plan', running.humanToken, { sessionId: agent.sessionId, nodeId: 'N1' })).status, 404);
    assert.equal((await call('/api/session-message', running.humanToken, { sessionId: agent.sessionId, nodeId: 'N1', bugId: 'B1' })).status, 404);
    assert.equal((await call('/api/access', running.humanToken, { sessionId: agent.sessionId, nodes: [] })).status, 200);
    assert.equal((await call('/api/access', running.humanToken, { sessionId: agent.sessionId, mode: 'all' })).status, 200);
    assert.equal((await call('/__context_guard/bootstrap', running.humanToken)).data.interfaceCapabilities.durableDelivery, undefined);
    assert.equal(delivered.length, 0, 'human access changes must not deliver a task to an existing Session');
    const beforeScopedEdit = await call('/api/state', credential);
    const visibleBugs = beforeScopedEdit.data.doc.root.children[0].bugs;
    visibleBugs[0].title = '当前 Session 已修改';
    assert.equal((await call('/api/commit', credential, { baseVersion: beforeScopedEdit.data.version, operationId: randomUUID(), operations: [{ type: 'update', id: 'N1', fields: { bugs: visibleBugs } }] })).status, 200);
    assert.equal(running.store.doc.root.children[0].bugs.find(item => item.id === 'B1').title, '待分配');
    assert.equal(running.store.doc.root.children[0].bugs.find(item => item.id === 'B2').title, '当前 Session 已修改');
    assert.equal(running.store.doc.root.children[0].bugs.find(item => item.id === 'B3').title, '分配给其他 Session');
    const incomplete = await call('/api/commit', credential, { operationId: 'op-bad-only' });
    assert.equal(incomplete.status, 400);
    assert.equal(incomplete.data.error.code, 'INVALID_ARGUMENT');
    assert.match(incomplete.data.error.message, /baseVersion/);
    assert.match(incomplete.data.error.message, /operations/);
    assert.equal((await call('/api/commit', credential, edit(running.store, 'CLI权限'))).status, 200);
    await call('/api/access', running.humanToken, { sessionId: agent.sessionId, nodes: [] });
    assert.equal((await call('/api/commit', credential, edit(running.store, '已撤权'))).status, 403);
    const cache = structuredClone(running.store.doc); cache.root.children[0].title = '旧缓存';
    const preview = await call('/api/migration-preview', running.humanToken, { doc: cache }); assert.equal(preview.status, 200); assert.equal(preview.data.operations.length, 1);
    assert.equal(running.store.doc.root.children[0].title, 'CLI权限'); assert.equal((await fs.stat(preview.data.backup)).isFile(), true);
  } finally { await running.close(); }
});

test('canvas inbox expansion and absent empty arrays do not create edits', async () => {
  const f = await fixture(), a = f.doc.root, b = structuredClone(a); b._inbox = b.children; b.children = []; b.files = [];
  assert.deepEqual(diffTrees(a, b), []); validate(f.doc);
});

for (const point of ['after-pending', 'after-map', 'after-event', 'after-result']) {
  test(`real process exit at ${point} reconciles the on-disk journal`, async () => {
    const f = await fixture(), baseVersion = hash(await fs.readFile(path.join(f.ctx, 'map.json')));
    const request = { baseVersion, operationId: randomUUID(), operations: [{ type: 'create', parentId: 'T0', node: { id: 'N2', title: '真实进程退出' } }] };
    const input = path.join(f.root, 'request.json'); await fs.writeFile(input, encode(request));
    const code = await new Promise((resolve, reject) => { const child = spawn(process.execPath, ['tests/crash-worker.mjs', f.root, point, input], { windowsHide: true, stdio: 'ignore' }); child.on('exit', resolve); child.on('error', reject); });
    assert.equal(code, 71);
    const store = await new MapStore(f.root).init();
    try {
      const result = await store.commit(request, human);
      if (point === 'after-pending') {
        assert.equal(result.committed, false); assert.equal(store.doc.root.children.length, 1);
        await store.commit({ ...request, operationId: randomUUID() }, human);
      } else assert.equal(result.committed, true);
      assert.equal(store.doc.root.children.filter(n => n.id === 'N2').length, 1);
    } finally { await store.close(); }
  });
}

test('actual Windows file lock: brief lock recovers; long lock respects wall-clock deadline', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture(), store = await new MapStore(f.root).init();
  async function lock(seconds) {
    const child = spawn('python', ['tests/win-file-lock.py', store.file, String(seconds)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error('lock helper failed')); }); });
    return child;
  }
  try {
    await lock(0.15); const begin = performance.now(); await store.commit(edit(store, '短暂占用后保存'), human); assert.ok(performance.now() - begin < 900);
    const old = hash(await fs.readFile(store.file)); const child = await lock(2); const started = performance.now();
    await assert.rejects(store.commit(edit(store, '不能替换'), human)); const elapsed = performance.now() - started;
    assert.ok(elapsed >= 300 && elapsed < 900, `bounded deadline, observed ${elapsed}ms`); assert.equal(hash(await fs.readFile(store.file)), old);
    await new Promise(resolve => child.once('exit', resolve));
  } finally { await store.close(); }
});

test('projection failure is explicit and direct authoritative reads remain available', async () => {
  const f = await fixture(), store = await new MapStore(f.root, { project: async () => { throw new Error('index disk fault'); } }).init();
  try { const result = await store.commit(edit(store, '地图已经保存'), human); assert.equal(result.committed, true); await until(() => store.projection.status === 'failed'); assert.equal(store.doc.root.children[0].title, '地图已经保存'); }
  finally { await store.close(); }
});

test('a legacy null-root map can be explicitly initialized but existing roots cannot be replaced', async () => {
  const complete = applyOperations(
    { v: 1, bootstrap: 'pending', project: 'legacy', root: null, flows: [] },
    [
      { type: 'initialize', project: 'legacy', node: { id: 'T0', title: '完整地图', kind: 'module', children: [{ id: 'N1', title: '现有模块', kind: 'work', children: [] }] } },
      { type: 'document', fields: { flows: [{ from: 'T0', to: 'N1', label: '包含' }] } },
    ],
    human,
  ).doc;
  assert.equal(complete.root.children[0].title, '现有模块');
  assert.equal(complete.root.proposal, 'accepted');
  assert.equal(complete.flows.length, 1);
  assert.throws(() => applyOperations(
    { v: 1, bootstrap: 'pending', project: 'legacy', root: null, flows: [] },
    [{ type: 'initialize', project: 'legacy', node: { id: 'T0', title: 'Agent 整图', children: [{ id: 'N1', title: '越权', children: [] }] } }],
    agent,
  ), { code: 'FORBIDDEN' });
  const f = await fixture(); await fs.writeFile(path.join(f.ctx, 'map.json'), encode({ v: 1, bootstrap: 'pending', root: null, flows: [] }));
  const store = await new MapStore(f.root).init();
  try {
    const operations = [{ type: 'initialize', project: 'legacy', node: { id: 'T0', title: 'Legacy project', kind: 'module' } }];
    await store.commit({ baseVersion: store.version, operationId: randomUUID(), operations }, agent);
    assert.equal(store.doc.root.proposal, 'proposed');
    await assert.rejects(store.commit({ baseVersion: store.version, operationId: randomUUID(), operations }, human), { code: 'INVALID_INITIALIZATION' });
  } finally { await store.close(); }
});

test('unknown external modification after interrupted commit freezes further writes', async () => {
  const f = await fixture(), raw = await fs.readFile(path.join(f.ctx, 'map.json'));
  const request = { baseVersion: hash(raw), operationId: randomUUID(), operations: [{ type: 'update', id: 'N1', fields: { title: 'Interrupted' } }] };
  const input = path.join(f.root, 'request.json'); await fs.writeFile(input, encode(request));
  await new Promise(resolve => { spawn(process.execPath, ['tests/crash-worker.mjs', f.root, 'after-map', input], { windowsHide: true, stdio: 'ignore' }).once('exit', resolve); });
  f.doc.root.title = 'Unknown external save'; await fs.writeFile(path.join(f.ctx, 'map.json'), encode(f.doc));
  const store = await new MapStore(f.root).init();
  try { assert.equal(store.blocked.code, 'RECOVERY_REQUIRED'); await assert.rejects(store.commit(edit(store, 'Must not write'), human), { code: 'RECOVERY_REQUIRED' }); }
  finally { await store.close(); }
});

test('legacy GET-only service is identified and preserved; a second Node owner is rejected', async () => {
  const f = await fixture(); await fs.mkdir(path.join(f.ctx, 'private'), { recursive: true });
  const legacy = http.createServer((_req, res) => res.end(JSON.stringify({ ok: true, root: f.root, pid: process.pid })));
  await new Promise(resolve => legacy.listen(0, '127.0.0.1', resolve));
  await fs.writeFile(path.join(f.ctx, 'private/workbench.json'), encode({ url: `http://127.0.0.1:${legacy.address().port}/prototype/workbench.html` }));
  try {
    const diagnosis = await diagnoseWorkbench(f.root);
    assert.equal(diagnosis.runtime.status, 'legacy');
    assert.equal(diagnosis.migrationRequired, true);
    assert.equal('adminToken' in diagnosis.runtime.services[0], false);
    await assert.rejects(ensureServer(f.root), { code: 'LEGACY_SERVICE' }); assert.equal(legacy.listening, true);
  }
  finally { await new Promise(resolve => legacy.close(resolve)); }
  const running = await startServer({ root: f.root, port: 0 });
  try { await assert.rejects(startServer({ root: f.root, port: 0 }), { code: 'ALREADY_RUNNING' }); }
  finally { await running.close(); }
});

test('explicit legacy migration backs up context and retires only an exact service identity', async t => {
  const f = await fixture();
  execFileSync('git', ['init', '-b', 'main'], { cwd: f.root, windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Context Guard Test'], { cwd: f.root, windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'context-guard@example.invalid'], { cwd: f.root, windowsHide: true });
  await fs.writeFile(path.join(f.root, 'README.md'), 'fixture');
  execFileSync('git', ['add', 'README.md'], { cwd: f.root, windowsHide: true });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: f.root, windowsHide: true });
  const instance = randomUUID();
  const code = `const http=require('node:http');const root=process.argv[1],instance=process.argv[2];const s=http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({ok:true,root,pid:process.pid,protocol:2,instance}))});s.listen(0,'127.0.0.1',()=>process.stdout.write(String(s.address().port)+'\\n'));process.on('SIGTERM',()=>s.close(()=>process.exit(0)));`;
  const child = spawn(process.execPath, ['-e', code, f.root, instance], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => { try { child.kill('SIGTERM'); } catch {} });
  const port = Number(await new Promise((resolve, reject) => { child.stdout.once('data', data => resolve(String(data).trim())); child.once('error', reject); }));
  await fs.mkdir(path.join(f.ctx, 'private'), { recursive: true });
  await fs.writeFile(path.join(f.ctx, 'private/workbench.json'), encode({ url: `http://127.0.0.1:${port}/prototype/workbench.html`, pid: child.pid, instance }));
  const diagnosis = await diagnoseWorkbench(f.root);
  assert.equal(diagnosis.runtime.status, 'legacy');
  const retireKey = diagnosis.migrationPlan[0].retireKey;
  assert.equal(retireKey, `${child.pid}:${instance}`);
  const output = execFileSync(process.execPath, ['scripts/workbench/cli.mjs', 'workbench', 'migrate', '--root', f.root, '--retire', retireKey], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true });
  const migrated = JSON.parse(output);
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.restartRequired, false);
  const manifest = JSON.parse(await fs.readFile(path.join(migrated.backupDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.services[0].retireKey, retireKey);
  assert.equal((await diagnoseWorkbench(f.root)).runtime.status, 'stopped');
});

test('project path aliases reuse the same healthy service', async () => {
  const f = await fixture(), alias = path.join(f.root, 'project-link');
  await fs.symlink(f.root, alias, 'junction');
  const running = await startServer({ root: f.root, port: 0 });
  try { assert.equal((await ensureServer(alias)).instance, running.state.instance); }
  finally { await running.close(); await fs.unlink(alias); }
});

test('stop waits for pending work and idle connections before immediate restart', async () => {
  const f = await fixture(); let running = await startServer({ root: f.root, port: 0 });
  const pool = new http.Agent({ keepAlive: true });
  let release;
  try {
    await new Promise((resolve, reject) => http.get(new URL('/__context_guard/health', running.state.url), { agent: pool }, res => { res.resume(); res.on('end', resolve); }).on('error', reject));
    running.store.serial(() => new Promise(resolve => { release = resolve; }));
    let stopped = false;
    const stopping = stopServer(f.root).then(result => { stopped = true; return result; });
    await until(() => !!running.server.cgClose.promise);
    assert.equal(stopped, false, 'stop must wait for pending work');
    release();
    assert.equal((await stopping).stopped, true);
    await assert.rejects(fs.access(path.join(f.ctx, 'private/node-workbench.lock')), { code: 'ENOENT' });
    await assert.rejects(fs.access(path.join(f.ctx, 'private/workbench.json')), { code: 'ENOENT' });
    await running.close();
    running = await startServer({ root: f.root, port: 0 });
    assert.equal((await ensureServer(f.root)).instance, running.state.instance);
  } finally { release?.(); pool.destroy(); await running.close(); }
});

if (process.platform === 'win32') test('Windows short paths support map and inbox file watching', async () => {
  const f = await fixture();
  // Exercise the path form returned by Windows TEMP on hosted runners.
  const script = 'import ctypes, sys; b = ctypes.create_unicode_buffer(32768); n = ctypes.windll.kernel32.GetShortPathNameW(sys.argv[1], b, len(b)); assert n > 0; print(b.value)';
  const shortRoot = execFileSync('python', ['-c', script, f.root], { encoding: 'utf8', windowsHide: true }).trim();
  const store = await new MapStore(shortRoot).init();
  const { AgentInbox } = await import('../scripts/workbench/inbox.mjs');
  const inbox = new AgentInbox(shortRoot, agent.sessionId, async () => { await store.serial(() => store.refresh()); return store.changes(); });
  try {
    await inbox.read({ start: true });
    const waiting = inbox.wait(3000);
    const next = structuredClone(f.doc); next.root.children[0].title = 'Short path update';
    await fs.writeFile(path.join(f.ctx, 'map.json'), encode(next));
    assert.equal((await waiting).pending, true);
    assert.equal(store.doc.root.children[0].title, 'Short path update');
  } finally { await store.close(); }
});
