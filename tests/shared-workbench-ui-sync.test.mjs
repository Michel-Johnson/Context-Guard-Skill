import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations } from '../scripts/shared/map-model.mjs';
import { WorkbenchSync } from '../prototype/workbench-sync.mjs';
const human = { kind: 'human', sessionId: 'workbench' };

function busyBrowserFixture() {
  const sync = Object.create(WorkbenchSync.prototype);
  const base = { id: 'T0', title: '原名', children: [] }, root = { ...base, title: '修改' };
  Object.assign(sync, { ready: true, status: 'synced', config: { token: '' }, viewId: 'main',
    version: 'v1', revision: 0, baseTree: structuredClone(base), doc: { root: base },
    a: { getRoot: () => root }, endpoint: route => route,
    saveDraft() { this.savedDraft = { pendingRequest: structuredClone(this.pendingRequest), root: structuredClone(root) }; },
    setStatus(status, message) { this.status = status; this.message = message; },
    presence: async () => ({ synchronized: true }), captureKey: 'isolated-busy-draft' });
  return { sync, root };
}

test('Busy commit recovers automatically with its exact request and preserves later typing', async () => {
  const { sync, root } = busyBrowserFixture(), calls = [], originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  let healthy = false, committed = { id: 'T0', title: '修改', children: [] };
  const removed = [];
  globalThis.localStorage = { removeItem(key) { removed.push(key); } };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: options.body });
    if (!healthy) return { ok: false, status: 503, headers: { get: () => 'application/json' }, json: async () => ({ error: { code: 'STATE_BUSY', message: 'Shared state is busy; preserve lock and retry' } }) };
    if (url === '/api/commit') committed = applyOperations({ root: committed }, JSON.parse(options.body).operations, human).doc.root;
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => url === '/api/commit'
      ? { committed: true, version: committed.title === '后来输入' ? 'v3' : 'v2' }
      : { version: 'v2', doc: { root: committed } } };
  };
  try {
    await sync.flush(); assert.equal(sync.status, 'busy'); assert.equal(calls.length, 3);
    const request = structuredClone(sync.pendingRequest);
    assert.ok(calls.every(call => call.body === JSON.stringify(request)));
    root.title = '后来输入'; sync.revision++;
    healthy = true;
    assert.equal(await sync.retryBusyCommit(), true);
    assert.equal(calls[3].body, JSON.stringify(request), 'Recovery first replays the original write, never a replacement operation');
    const writes = calls.filter(call => call.url === '/api/commit');
    assert.notEqual(JSON.parse(writes.at(-1).body).operationId, request.operationId, 'Later typing is a separate commit');
    assert.equal(committed.title, '后来输入'); assert.equal(sync.baseTree.title, '后来输入');
    assert.equal(sync.pendingRequest, null); assert.equal(sync.status, 'synced');
    assert.ok(removed.includes('isolated-busy-draft'), 'Successful acknowledgement clears the obsolete recovery draft');
  } finally { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; }
});

test('Busy automatic recovery is bounded and never crosses a view, recovery guard or disposal', async () => {
  const { sync } = busyBrowserFixture(), request = { operationId: 'fixed-id', baseVersion: 'v1', operations: [] };
  sync.pendingRequest = request;
  const busy = Object.assign(new Error('busy'), { retryableBusyCommit: true, serverResponse: true, code: 'STATE_BUSY' });
  assert.equal(sync.deferBusyCommit(busy, request), true);
  let attempts = 0;
  sync.retry = async () => { attempts++; sync.deferBusyCommit(busy, request); };
  for (const field of ['disposed', 'switchingSession', 'sessionUnavailable', 'serverRecovery', 'composing']) {
    sync[field] = true; assert.equal(await sync.retryBusyCommit(), false, field); sync[field] = false;
  }
  sync.viewId = 'session:other'; assert.equal(await sync.retryBusyCommit(), false); sync.viewId = 'main';
  await sync.retryBusyCommit(); await sync.retryBusyCommit(); await sync.retryBusyCommit();
  assert.equal(attempts, 2); assert.equal(sync.status, 'error'); assert.equal(sync.pendingRequest, request);
});

test('Non-commit busy responses and explicit repair guards never opt into automatic recovery', async () => {
  const { sync } = busyBrowserFixture(), originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => ({ ok: false, status: 503, headers: { get: () => 'application/json' }, json: async () => {
    calls++; return { error: { code: 'STATE_BUSY', message: 'Shared state is busy; preserve lock and retry' } };
  } });
  try {
    const request = { operationId: 'approval-not-replayed' };
    await assert.rejects(sync.call('/api/coordinator/approval', request), error => !error.retryableBusyCommit);
    assert.equal(calls, 1);
    for (const error of [Object.assign(new Error('repair'), { code: 'STATE_BUSY', serverResponse: true }),
      Object.assign(new Error('conflict'), { code: 'VERSION_CONFLICT', serverResponse: true }), new Error('network')]) {
      assert.equal(sync.deferBusyCommit(error, request), false);
    }
    assert.equal(await sync.retryBusyCommit(), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('Heartbeat recovers a busy commit before treating a newer head as a conflicting edit', async () => {
  const { sync } = busyBrowserFixture(), request = { operationId: 'heartbeat-original', baseVersion: 'v1',
    operations: [{ type: 'update', id: 'T0', fields: { title: '修改' } }] };
  sync.pendingRequest = request;
  sync.deferBusyCommit({ retryableBusyCommit: true }, request);
  const originalTimer = globalThis.setTimeout, originalStorage = globalThis.localStorage;
  const calls = []; let tick;
  globalThis.localStorage = { removeItem() {} };
  globalThis.setTimeout = callback => { tick = callback; return undefined; };
  sync.call = async (route, body) => {
    calls.push({ route, body });
    if (route === '/api/presence') return { version: 'v2' };
    if (route === '/api/commit') { assert.equal(body, request); return { committed: true, version: 'v2' }; }
    assert.equal(route, '/api/state'); return { version: 'v2', doc: { root: sync.a.getRoot() } };
  };
  sync.refreshTaskStatuses = async () => {};
  try {
    sync.scheduleHeartbeat(); await tick();
    assert.deepEqual(calls.map(x => x.route), ['/api/presence', '/api/commit', '/api/state']);
    assert.equal(sync.status, 'synced'); assert.equal(sync.pendingRequest, null);
    assert.equal(sync.busyCommit, null);
    sync.disposed = true;
  } finally { globalThis.setTimeout = originalTimer; globalThis.localStorage = originalStorage; }
});

test('Busy recovery stops on a real version conflict without replacing the original operation', async () => {
  const { sync, root } = busyBrowserFixture(), request = { operationId: 'cas-original', baseVersion: 'v1',
    operations: [{ type: 'update', id: 'T0', fields: { title: '修改' } }] };
  sync.pendingRequest = request;
  sync.deferBusyCommit({ retryableBusyCommit: true }, request);
  let commits = 0;
  sync.call = async (route, body) => {
    assert.equal(route, '/api/commit'); assert.equal(body, request); commits++;
    throw Object.assign(new Error('conflict'), { code: 'VERSION_CONFLICT', serverResponse: true });
  };
  await sync.retryBusyCommit();
  assert.equal(sync.status, 'conflict'); assert.equal(sync.pendingRequest, request);
  assert.equal(sync.savedDraft.root.title, root.title);
  assert.equal(await sync.retryBusyCommit(), false); assert.equal(commits, 1);
});

test('A late synchronized receipt cannot delete newer typing or falsely mark it synchronized', async () => {
  const { sync, root } = busyBrowserFixture(), request = { operationId: 'late-confirmation', baseVersion: 'v1',
    operations: [{ type: 'update', id: 'T0', fields: { title: '修改' } }] };
  sync.pendingRequest = request;
  sync.deferBusyCommit({ retryableBusyCommit: true }, request);
  const originalStorage = globalThis.localStorage, removed = [];
  globalThis.localStorage = { removeItem(key) { removed.push(key); } };
  let confirm, announce;
  const finalPresence = new Promise(resolve => { announce = resolve; });
  let presenceCalls = 0;
  sync.presence = async () => {
    if (++presenceCalls === 1) return { synchronized: true };
    announce(); return new Promise(resolve => { confirm = resolve; });
  };
  sync.call = async route => route === '/api/commit' ? { committed: true, version: 'v2' }
    : { version: 'v2', doc: { root: structuredClone(root) } };
  try {
    const recovering = sync.retryBusyCommit(); await finalPresence;
    root.title = '确认等待期间的新输入'; sync.revision++; sync.saveDraft();
    confirm({ synchronized: true }); await recovering;
    assert.equal(sync.dirty(), true); assert.equal(sync.status, 'draft');
    assert.deepEqual(removed, [], 'A receipt for the older edit cannot clear the newer recovery draft');
    assert.equal(sync.savedDraft.root.title, '确认等待期间的新输入');
  } finally { globalThis.localStorage = originalStorage; }
});
