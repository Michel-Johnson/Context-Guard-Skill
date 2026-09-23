import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  filesystemProjectDirectory,
  legacyProjectMemoryFile,
  migrateProjectMemoryToFilesystemV2,
  projectMemoryFile,
  projectMemoryLockFile,
  writeProjectMemory,
} from '../scripts/cloud/memory-filesystem.mjs';
import { withFileLock } from '../scripts/shared/io.mjs';
import { commitMainMemoryMap, createMemoryHandler, readMemoryProject, startMemoryServer } from '../scripts/cloud/memory.mjs';
import { memoryReadViews } from '../scripts/cloud/memory-read-view.mjs';
import { memoryConfigPath } from '../scripts/workbench/memory.mjs';
import { resolveProject } from '../scripts/workbench/project.mjs';

const runProcess = promisify(execFile);

function state() {
  return {
    revision: 7,
    main: {
      version: 'main-v1',
      mainSha: 'a'.repeat(40),
      publishedAt: '2026-09-13T00:00:00Z',
      memory: {
        map: {
          root: {
            id: 'M1',
            kind: 'module',
            title: '项目',
            purpose: '项目根模块',
            children: [{ id: 'N1', kind: 'work', title: '提交', purpose: '提交表单', children: [] }],
          },
        },
        records: {
          'bugs/B1.md': '# B1 重复提交\n\n- node: N1\n- status: open\n- 现象: 连续点击产生重复记录。',
          'FIND.md': '# Legacy index',
        },
      },
    },
    preferences: null,
    sessions: {
      sessionA: {
        sessionId: 'sessionA',
        version: 'session-v1',
        sourceCommit: 'b'.repeat(40),
        baseMainVersion: 'main-v1',
        updatedAt: '2026-09-13T00:01:00Z',
        memory: {
          map: { root: { id: 'M1', kind: 'module', title: '项目', purpose: '项目根模块', children: [] } },
          records: {},
        },
      },
    },
    closedSessions: {},
    receipts: {},
    history: [],
    events: [],
    eventCursors: {},
  };
}

async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-memory-v2-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const projectId = 'project';
  const legacy = legacyProjectMemoryFile(dataDir, projectId);
  await fs.mkdir(path.dirname(legacy), { recursive: true });
  await fs.writeFile(legacy, JSON.stringify(state()));
  return { dataDir, projectId, legacy };
}

test('activates filesystem v2 with a rollback backup and complete projections', async (t) => {
  const value = await fixture(t);
  const result = await migrateProjectMemoryToFilesystemV2(value.dataDir, value.projectId);
  const root = filesystemProjectDirectory(value.dataDir, value.projectId);

  assert.equal(projectMemoryFile(value.dataDir, value.projectId), path.join(root, 'runtime-state.json'));
  assert.equal(JSON.parse(await fs.readFile(result.activeFile, 'utf8')).revision, 7);
  assert.equal(JSON.parse(await fs.readFile(result.backup, 'utf8')).revision, 7);
  assert.match(await fs.readFile(path.join(root, 'content/main/nodes/项目-module/提交-node/index.md'), 'utf8'), /连续点击产生重复记录。/);
  assert.equal(await fs.readFile(path.join(root, 'content/main/legacy-records/FIND.md'), 'utf8'), '# Legacy index');
  const storage = JSON.parse(await fs.readFile(path.join(root, 'content/storage.json'), 'utf8'));
  const session = JSON.parse(await fs.readFile(path.join(root, 'content/sessions', storage.sessions.sessionA.directory, 'session.json'), 'utf8'));
  assert.equal(session.sessionId, 'sessionA');
});

test('reads and writes the active runtime state while refreshing Markdown', async (t) => {
  const value = await fixture(t);
  await migrateProjectMemoryToFilesystemV2(value.dataDir, value.projectId);
  const next = state();
  next.revision = 8;
  next.main.memory.map.root.purpose = '更新后的项目简介';
  await writeProjectMemory(memoryReadViews, value.dataDir, value.projectId, next);

  const configuration = { dataDir: value.dataDir, adminToken: 'admin', projects: { project: { token: 'token' } } };
  assert.equal((await readMemoryProject(configuration, value.projectId)).revision, 8);
  const index = await fs.readFile(path.join(filesystemProjectDirectory(value.dataDir, value.projectId), 'content/main/nodes/项目-module/index.md'), 'utf8');
  assert.match(index, /更新后的项目简介/);
  assert.equal(JSON.parse(await fs.readFile(value.legacy, 'utf8')).revision, 7);
});

test('later Todo attempts survive committed updates, restart and projection repair', async t => {
  const value = await fixture(t);
  await migrateProjectMemoryToFilesystemV2(value.dataDir, value.projectId);
  const configuration = { dataDir: value.dataDir, adminToken: 'admin', projects: { project: { token: 'token' } } };
  const base = (await readMemoryProject(configuration, value.projectId)).main;
  const todo = { id: 'T1', title: '防止重复提交', desc: '并发提交只能创建一条记录。', status: 'processing', attempts: [
    { status: 'Confirmed', acceptance: '单窗口不得重复', solution: '禁用按钮', test: { summary: '单窗口通过', content: '单窗口验证通过。' } },
  ] };
  const first = await commitMainMemoryMap(configuration, value.projectId, { operationId: 'todo-a1', baseVersion: base.version,
    operations: [{ type: 'update', id: 'N1', fields: { todos: [todo] } }] });
  todo.attempts[0] = { ...todo.attempts[0], status: 'Refuted', refutedBy: 'A2', reason: '跨窗口仍重复' };
  todo.attempts.push({ status: 'Confirmed', acceptance: '两个窗口只创建一条', solution: '增加服务端唯一约束',
    test: { summary: '跨窗口通过', content: '并发回归通过。' }, sessionIds: ['sessionA'] });
  await commitMainMemoryMap(configuration, value.projectId, { operationId: 'todo-a2', baseVersion: first.version,
    operations: [{ type: 'update', id: 'N1', fields: { todos: [todo] } }] });
  const root = filesystemProjectDirectory(value.dataDir, value.projectId);
  const file = path.join(root, 'content/main/nodes/项目-module/提交-node/todos/T1.md');
  const before = await fs.readFile(file, 'utf8');
  assert.match(before, /CurrentAttempt: A2/);
  assert.match(before, /Status: Refuted\nRefutedBy: A2/);
  assert.match(before, /增加服务端唯一约束/);
  await fs.rm(path.join(root, 'content'), { recursive: true, force: true });
  const restored = await readMemoryProject(configuration, value.projectId);
  assert.equal(restored.main.memory.map.root.children[0].todos[0].attempts.length, 2);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.match(await fs.readFile(path.join(root, 'content/main/nodes/项目-module/提交-node/todos/tests/T1-A2.md'), 'utf8'), /并发回归通过。/);
});

test('versioned filesystem reads expose scoped Markdown without legacy records or Agent Ideas', async t => {
  const value = await fixture(t);
  const seeded = state();
  seeded.main.memory.map.root.ideas = [{ id: 'I1', text: 'Coordinator-only idea text', state: 'pending' }];
  await fs.writeFile(value.legacy, JSON.stringify(seeded));
  const configuration = { dataDir: value.dataDir, adminToken: 'admin', projects: { project: { token: 'project-token' } } };
  const service = await startMemoryServer({ ...configuration, port: 0 });
  const get = (route, token = 'project-token') => fetch(`${service.url}/v1/projects/project/filesystem/${route}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  try {
    const unavailable = await get('main/map.json');
    assert.equal(unavailable.status, 409);
    assert.equal((await unavailable.json()).error.code, 'FSV2_UNAVAILABLE');
    await migrateProjectMemoryToFilesystemV2(value.dataDir, value.projectId);
    const map = await get('main/map.json');
    assert.equal(map.status, 200);
    const mapBody = await map.json();
    assert.equal(mapBody.version, 'main-v1');
    assert.equal(JSON.parse(mapBody.content).root, 'M1');
    assert.equal(Object.hasOwn(mapBody, 'records'), false);
    const indexPath = 'nodes/项目-module/index.md'.split('/').map(encodeURIComponent).join('/');
    const agentIndex = await get(`main/${indexPath}?version=main-v1`);
    assert.equal(agentIndex.status, 200);
    assert.doesNotMatch((await agentIndex.json()).content, /Coordinator-only idea text/);
    const adminIndex = await get(`main/${indexPath}`, 'admin');
    assert.match((await adminIndex.json()).content, /Coordinator-only ide/);
    const ideaPath = 'nodes/项目-module/ideas/I1.md'.split('/').map(encodeURIComponent).join('/');
    assert.equal((await get(`main/${ideaPath}`)).status, 403);
    assert.match((await (await get(`main/${ideaPath}`, 'admin')).json()).content, /Coordinator-only idea text/);
    assert.equal((await get('main/legacy-records/FIND.md', 'admin')).status, 404);
    assert.equal((await get('main/map.json?version=old')).status, 409);
    const traversal = await get('main/nodes/%2E%2E%2Flegacy-records%2FFIND.md', 'admin');
    assert.equal(traversal.status, 400);
    const sessionMap = await get('sessions/sessionA/map.json');
    assert.equal(sessionMap.status, 200);
    assert.equal((await sessionMap.json()).scope, 'session:sessionA');
    const clientRoot = path.join(value.dataDir, 'client');
    await fs.mkdir(clientRoot);
    const client = await resolveProject(clientRoot);
    await fs.mkdir(path.dirname(memoryConfigPath(client)), { recursive: true });
    await fs.writeFile(memoryConfigPath(client), JSON.stringify({ url: service.url, projectId: value.projectId, token: 'project-token' }));
    const cli = fileURLToPath(new URL('../scripts/workbench/cli.mjs', import.meta.url));
    const command = await runProcess(process.execPath, [cli, 'memory', 'file', '--root', clientRoot, '--scope', 'main', '--path', 'map.json'], { windowsHide: true });
    assert.equal(JSON.parse(command.stdout).path, 'map.json');
  } finally { await service.close(); }
});

test('device filesystem reads are bound to their own Session', async t => {
  const value = await fixture(t);
  await migrateProjectMemoryToFilesystemV2(value.dataDir, value.projectId);
  const configuration = { dataDir: value.dataDir, adminToken: 'admin', projects: { project: { token: 'project-token' } } };
  const observed = [];
  const handler = createMemoryHandler(configuration, { authorizeDevice: async input => {
    observed.push({ sessionId: input.sessionId, scope: input.scope, method: input.method });
    return input.credential === 'device-token' && input.method === 'GET' && (!input.sessionId || input.sessionId === 'sessionA');
  } });
  const server = http.createServer(async (request, response) => {
    if (!await handler(request, response)) { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/v1/projects/project/filesystem/`;
  const read = route => fetch(url + route, { headers: { Authorization: 'Bearer device-token' } });
  try {
    assert.equal((await read('main/map.json')).status, 200);
    assert.equal((await read('sessions/sessionA/map.json')).status, 200);
    assert.equal((await read('sessions/sessionB/map.json')).status, 401);
    assert.deepEqual(observed.map(item => [item.sessionId, item.scope, item.method]), [
      ['', 'main', 'GET'], ['sessionA', 'sessions/sessionA', 'GET'], ['sessionB', 'sessions/sessionB', 'GET'],
    ]);
  } finally {
    handler.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
  }
});

test('repairs a missing projection from the committed v2 runtime state', async (t) => {
  const value = await fixture(t);
  await migrateProjectMemoryToFilesystemV2(value.dataDir, value.projectId);
  const root = filesystemProjectDirectory(value.dataDir, value.projectId);
  await fs.rm(path.join(root, 'content'), { recursive: true, force: true });

  const configuration = { dataDir: value.dataDir, adminToken: 'admin', projects: { project: { token: 'token' } } };
  assert.equal((await readMemoryProject(configuration, value.projectId)).revision, 7);
  assert.match(await fs.readFile(path.join(root, 'content/main/nodes/项目-module/index.md'), 'utf8'), /项目根模块/);
});

test('refuses to activate the same project twice', async (t) => {
  const value = await fixture(t);
  await migrateProjectMemoryToFilesystemV2(value.dataDir, value.projectId);
  await assert.rejects(() => migrateProjectMemoryToFilesystemV2(value.dataDir, value.projectId), /already active/);
});

test('activation shares the legacy write lock and migrates the latest committed state', async (t) => {
  const value = await fixture(t);
  let migration;
  await withFileLock(projectMemoryLockFile(value.dataDir, value.projectId), async () => {
    migration = migrateProjectMemoryToFilesystemV2(value.dataDir, value.projectId);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const next = state();
    next.revision = 8;
    await fs.writeFile(value.legacy, JSON.stringify(next));
    await assert.rejects(fs.access(path.join(filesystemProjectDirectory(value.dataDir, value.projectId), 'FORMAT')));
  });

  const result = await migration;
  assert.equal(result.revision, 8);
  assert.equal(JSON.parse(await fs.readFile(result.activeFile, 'utf8')).revision, 8);
});

test('rejects Windows separator traversal before activating filesystem v2', async (t) => {
  const value = await fixture(t);
  const malicious = state();
  malicious.main.memory.map.root.todos = [{ id: '..\\..\\escaped', title: 'escape', status: 'pending' }];
  await fs.writeFile(value.legacy, JSON.stringify(malicious));

  await assert.rejects(() => migrateProjectMemoryToFilesystemV2(value.dataDir, value.projectId), /Unsafe memory record path/);
  await assert.rejects(fs.access(path.join(filesystemProjectDirectory(value.dataDir, value.projectId), 'FORMAT')));
});
