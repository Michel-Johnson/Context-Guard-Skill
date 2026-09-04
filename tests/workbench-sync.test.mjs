import '../.github/scripts/test-environment.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { diagnoseWorkbench, ensureServer, stopServer } from '../scripts/workbench/cli.mjs';
import { MapStore } from '../scripts/workbench/store.mjs';
import { MemorySyncCoordinator, operationsOverlap, parseSseBlocks } from '../scripts/workbench/sync-coordinator.mjs';
import { memoryRequest } from '../scripts/workbench/memory.mjs';
import { startMemoryServer } from '../scripts/cloud/memory.mjs';
import { bugSessionMessage, startServer, todoSessionMessage } from '../scripts/workbench/server.mjs';
import { Access, rolloutTaskStatus } from '../scripts/workbench/access.mjs';
import { generateProjections } from '../scripts/workbench/projections.mjs';
import { applyOperations, assignmentScope, diffTrees, validate } from '../prototype/map-model.mjs';
import { atomicWrite, encode, hash, pause, readJSON } from '../scripts/workbench/io.mjs';
import { buildArchiveReconciliation, ownerForPath } from '../scripts/workbench/reconcile.mjs';
const human = { kind: 'human', sessionId: 'workbench' }, agent = { kind: 'agent', sessionId: 'test-session' };
const fixtureRoots = [];
after(async () => {
  const temporary = await fs.realpath(os.tmpdir());
  for (const root of fixtureRoots) {
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), temporary);
    assert.ok(path.basename(resolved).startsWith('cg-sync-'));
    await fs.rm(resolved, { recursive: true, force: true });
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
  assert.equal(snapshot.currentSessionId, agent.sessionId);
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
  assert.equal(snapshot.currentSessionId, 'codex-active');
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
    connection.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('native-session', '进程内任务', '', 1, 2, rollout, f.root, 'user', 0);
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

test('Bug handoff message carries the actionable Bug and node context', () => {
  const message = bugSessionMessage(
    { id: 'N1', title: '工作台同步' },
    { id: 'B7', title: '认领状态不真实', desc: '投递成功前不得显示处理中', record: '用户点击认领' },
  );
  assert.match(message, /B7 · 认领状态不真实/);
  assert.match(message, /N1 · 工作台同步/);
  assert.match(message, /投递成功前不得显示处理中/);
});

test('TODO handoff message carries the development item and node context', () => {
  const message = todoSessionMessage(
    { id: 'N1', title: '工作台同步' },
    { id: 'TD7', title: '增加需求入口', desc: '复用 Session 授权和消息发送' },
  );
  assert.match(message, /TD7 · 增加需求入口/);
  assert.match(message, /N1 · 工作台同步/);
  assert.match(message, /复用 Session 授权和消息发送/);
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

test('Workbench coordinator automatically syncs one Session in both directions and survives an outage', async t => {
  const f = await fixture();
  const sharedDir = path.join(f.root, 'shared');
  const dataDir = path.join(f.root, 'memory-data');
  await fs.mkdir(sharedDir, { recursive: true });
  const configuration = { dataDir, adminToken: 'memory-admin', projects: { project: { token: 'project-token' } } };
  let service = await startMemoryServer({ ...configuration, host: '127.0.0.1', port: 0 });
  t.after(async () => { await service.close().catch(() => {}); });
  const port = Number(new URL(service.url).port);
  const project = { sharedDir, head: 'a'.repeat(40) };
  await atomicWrite(path.join(sharedDir, 'memory-client.json'), encode({ url: service.url, projectId: 'project', token: 'project-token' }));
  await memoryRequest(project, 'sessions/session-sync', {
    operationId: 'coordinator-seed', baseVersion: null, baseMainVersion: null, sourceCommit: project.head,
    memory: { map: f.doc, records: {} },
  });
  const store = await new MapStore(f.root, {
    file: path.join(f.ctx, 'map.json'), runtime: path.join(f.root, 'store-runtime'), eventsFile: path.join(f.root, 'store-events.jsonl'),
  }).init();
  const syncDir = path.join(f.root, 'session-sync');
  let holdAcknowledgement = false, releaseAcknowledgement = null;
  const request = async (...args) => {
    const result = await memoryRequest(...args);
    if (holdAcknowledgement && String(args[1]).endsWith('/map')) await new Promise(resolve => { releaseAcknowledgement = resolve; });
    return result;
  };
  let coordinator = new MemorySyncCoordinator({ project, sessionId: 'session-sync', store, directory: syncDir, request, retryMin: 25, retryMax: 100 });
  await coordinator.start();
  await until(() => coordinator.snapshot().status === 'synced');

  holdAcknowledgement = true;
  await store.commit({ baseVersion: store.version, operationId: 'local-session-edit', operations: [{ type: 'update', id: 'N1', fields: { title: '本地自动上传' } }] }, human);
  await until(async () => (await memoryRequest(project, 'sessions/session-sync')).snapshot.memory.map.root.children[0].title === '本地自动上传');
  await until(() => !!releaseAcknowledgement);
  assert.equal(coordinator.snapshot().status, 'syncing', 'server persistence without an acknowledged response is not synced');
  assert.equal(coordinator.snapshot().pending, 1);
  holdAcknowledgement = false; releaseAcknowledgement();
  await until(() => coordinator.snapshot().status === 'synced');

  const remote = (await memoryRequest(project, 'sessions/session-sync')).snapshot;
  await memoryRequest(project, 'sessions/session-sync/map', {
    operationId: 'remote-session-edit', baseVersion: remote.version,
    operations: [{ type: 'update', id: 'N1', fields: { purpose: '云端自动下发' } }],
  });
  await until(() => store.doc.root.children[0].purpose === '云端自动下发');

  await service.close();
  await store.commit({ baseVersion: store.version, operationId: 'offline-session-edit', operations: [{ type: 'update', id: 'N1', fields: { title: '断网期间保留' } }] }, human);
  await until(async () => !!await readJSON(path.join(syncDir, 'remote-sync/outbox.json'), null));
  assert.equal(coordinator.snapshot().pending, 1);
  service = await startMemoryServer({ ...configuration, host: '127.0.0.1', port });
  await until(async () => (await memoryRequest(project, 'sessions/session-sync')).snapshot.memory.map.root.children[0].title === '断网期间保留', 6000);
  await until(() => coordinator.snapshot().status === 'synced');

  // A process that starts while Cloud is unavailable must retry initialization,
  // not wait forever for an SSE event that may never be emitted.
  await coordinator.close(); await service.close();
  await store.commit({ baseVersion: store.version, operationId: 'cold-offline-edit', operations: [{ type: 'update', id: 'N1', fields: { title: '冷启动断网保留' } }] }, human);
  coordinator = new MemorySyncCoordinator({ project, sessionId: 'session-sync', store, directory: syncDir, request, retryMin: 25, retryMax: 100 });
  await coordinator.start();
  await until(() => coordinator.snapshot().status === 'offline');
  service = await startMemoryServer({ ...configuration, host: '127.0.0.1', port });
  await until(async () => (await memoryRequest(project, 'sessions/session-sync')).snapshot.memory.map.root.children[0].title === '冷启动断网保留', 6000);
  await until(() => coordinator.snapshot().status === 'synced');
  await coordinator.close(); await store.close();
});

test('Workbench coordinator preserves local, remote, and base documents on a same-field conflict', async t => {
  const f = await fixture();
  const sharedDir = path.join(f.root, 'conflict-shared'), dataDir = path.join(f.root, 'conflict-memory');
  await fs.mkdir(sharedDir, { recursive: true });
  const configuration = { dataDir, adminToken: 'memory-admin', projects: { project: { token: 'project-token' } } };
  const service = await startMemoryServer({ ...configuration, host: '127.0.0.1', port: 0 });
  t.after(async () => { await service.close().catch(() => {}); });
  const project = { sharedDir, head: 'b'.repeat(40) };
  await atomicWrite(path.join(sharedDir, 'memory-client.json'), encode({ url: service.url, projectId: 'project', token: 'project-token' }));
  await memoryRequest(project, 'sessions/conflict-session', {
    operationId: 'conflict-seed', baseVersion: null, baseMainVersion: null, sourceCommit: project.head,
    memory: { map: f.doc, records: {} },
  });
  const store = await new MapStore(f.root, {
    file: path.join(f.ctx, 'map.json'), runtime: path.join(f.root, 'conflict-store-runtime'), eventsFile: path.join(f.root, 'conflict-store-events.jsonl'),
  }).init();
  const syncDir = path.join(f.root, 'conflict-session-sync');
  let coordinator = new MemorySyncCoordinator({ project, sessionId: 'conflict-session', store, directory: syncDir, retryMin: 25, retryMax: 100 });
  await coordinator.start(); await until(() => coordinator.snapshot().status === 'synced'); await coordinator.close();

  await store.commit({ baseVersion: store.version, operationId: 'conflict-local', operations: [{ type: 'update', id: 'N1', fields: { title: '本地标题' } }] }, human);
  const remote = (await memoryRequest(project, 'sessions/conflict-session')).snapshot;
  await memoryRequest(project, 'sessions/conflict-session/map', {
    operationId: 'disjoint-remote', baseVersion: remote.version,
    operations: [{ type: 'update', id: 'N1', fields: { purpose: '云端用途' } }],
  });
  coordinator = new MemorySyncCoordinator({ project, sessionId: 'conflict-session', store, directory: syncDir, retryMin: 25, retryMax: 100 });
  await coordinator.start(); await until(() => coordinator.snapshot().status === 'synced');
  let mergedRemote = (await memoryRequest(project, 'sessions/conflict-session')).snapshot;
  assert.equal(store.doc.root.children[0].title, '本地标题');
  assert.equal(store.doc.root.children[0].purpose, '云端用途');
  assert.equal(mergedRemote.memory.map.root.children[0].title, '本地标题');
  assert.equal(mergedRemote.memory.map.root.children[0].purpose, '云端用途');
  await coordinator.close();

  await store.commit({ baseVersion: store.version, operationId: 'same-field-local', operations: [{ type: 'update', id: 'N1', fields: { title: '本地冲突标题' } }] }, human);
  mergedRemote = (await memoryRequest(project, 'sessions/conflict-session')).snapshot;
  await memoryRequest(project, 'sessions/conflict-session/map', {
    operationId: 'same-field-remote', baseVersion: mergedRemote.version,
    operations: [{ type: 'update', id: 'N1', fields: { title: '云端标题' } }],
  });
  coordinator = new MemorySyncCoordinator({ project, sessionId: 'conflict-session', store, directory: syncDir, retryMin: 25, retryMax: 100 });
  await coordinator.start(); await until(() => coordinator.snapshot().status === 'conflict');
  const conflict = await readJSON(path.join(syncDir, 'remote-sync/conflict.json'));
  assert.equal(conflict.base.root.children[0].title, '本地标题');
  assert.equal(conflict.local.root.children[0].title, '本地冲突标题');
  assert.equal(conflict.remote.root.children[0].title, '云端标题');
  assert.equal(store.doc.root.children[0].title, '本地冲突标题', 'conflict must not overwrite the local draft');
  await coordinator.close(); await store.close();
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
    files: ['prototype/workbench.html', 'scripts/workbench/server.mjs', 'tests/workbench-browser.mjs', 'references/workbench-interface.md'],
    assignments: [{
      nodeId: 'W1',
      reason: '服务、测试和接口文档都是工作台实现的配套变更',
      files: ['scripts/workbench/server.mjs', 'tests/workbench-browser.mjs', 'references/workbench-interface.md'],
    }],
  };
  const reconciliation = buildArchiveReconciliation(doc, agent.sessionId, input);
  assert.deepEqual(reconciliation.mapped, { W1: [
    'prototype/workbench.html', 'references/workbench-interface.md', 'scripts/workbench/server.mjs', 'tests/workbench-browser.mjs',
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

test('projection retains legacy/manual content, includes state and bugs, detects pending versions', async () => {
  const f = await fixture(); await fs.mkdir(path.join(f.ctx, 'cards')); await fs.writeFile(path.join(f.ctx, 'cards/N1.md'), '人工笔记不能丢失\n');
  f.doc.root.children[0].bugs.push({ id: 'B32', title: '回归坏例', status: 'open' });
  f.doc.root.children[0].todos = [{ id: 'TD1', title: '开发新需求', status: 'processing' }];
  await generateProjections(f.root, f.doc, 'version-one');
  let card = await fs.readFile(path.join(f.ctx, 'cards/N1.md'), 'utf8'); assert.match(card, /人工笔记不能丢失/); assert.match(card, /B32/); assert.match(card, /TD1: 开发新需求 \[processing\]/); assert.match(card, /sourceVersion: version-one/);
  await fs.appendFile(path.join(f.ctx, 'cards/N1.md'), '\n后续人工补充\n'); await generateProjections(f.root, f.doc, 'version-two');
  card = await fs.readFile(path.join(f.ctx, 'cards/N1.md'), 'utf8'); assert.match(card, /后续人工补充/); assert.equal(card.split('人工笔记不能丢失').length, 2); assert.doesNotMatch(card, /version-one/);
});

test('HTTP rejects forged role, origin, path access; sessions/scopes/revocation and migration preview', async () => {
  const f = await fixture(), delivered = [];
  f.doc.root.children[0].bugs.push({ id: 'B1', title: '待分配', status: 'open', sessions: [] });
  f.doc.root.children[0].todos = [{ id: 'TD1', title: '新需求', status: 'pending', sessions: [] }];
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
    assert.equal(accessState.data.currentSessionId, agent.sessionId);
    const credential = registration.data.token;
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
      const request = http.get(`${base}/api/events?token=${encodeURIComponent(running.humanToken)}&clientId=dirty-reload`, resolve);
      request.on('error', reject);
    });
    assert.equal((await call('/api/presence', running.humanToken, { clientId: 'dirty-reload', dirty: true, version: running.store.version })).status, 200);
    assert.equal((await call('/api/state', credential)).status, 409, 'a connected dirty page must block Agent checkpoints');
    dirtyPage.destroy(); await pause(30);
    assert.equal((await call('/api/state', credential)).status, 200, 'a disconnected dirty page must not remain as a phantom checkpoint peer');
    assert.equal((await call('/api/access', credential, { sessionId: agent.sessionId, nodes: ['N1'], actor: 'human' })).status, 403);
    assert.equal((await call('/api/session-message', credential, { sessionId: agent.sessionId, nodeId: 'N1', bugId: 'B1' })).status, 403);
    const plan = await call('/api/access-plan', running.humanToken, { sessionId: agent.sessionId, nodeId: 'N1' });
    assert.equal(plan.status, 200);
    assert.deepEqual(new Set(plan.data.nodes), new Set(['T0', 'N1']));
    const deniedMessage = await call('/api/session-message', running.humanToken, { sessionId: agent.sessionId, nodeId: 'N1', bugId: 'B1' });
    assert.equal(deniedMessage.status, 403); assert.equal(deniedMessage.data.error.code, 'SESSION_SCOPE_REQUIRED');
    assert.equal((await call('/api/access', running.humanToken, { sessionId: agent.sessionId, addNodes: plan.data.nodes })).status, 200);
    assert.equal((await call('/api/session-message', running.humanToken, { sessionId: agent.sessionId, nodeId: 'N1', bugId: 'B1' })).status, 200);
    assert.equal((await call('/api/session-message', running.humanToken, { sessionId: agent.sessionId, nodeId: 'N1', todoId: 'TD1' })).status, 200);
    assert.equal(delivered.length, 2);
    assert.equal(delivered[1].todo.id, 'TD1');
    assert.match(delivered[1].message, /TODO: TD1 · 新需求/);
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
