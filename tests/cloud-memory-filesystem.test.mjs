import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  filesystemProjectDirectory,
  legacyProjectMemoryFile,
  migrateProjectMemoryToFilesystemV2,
  projectMemoryFile,
  projectMemoryLockFile,
  writeProjectMemory,
} from '../scripts/cloud/memory-filesystem.mjs';
import { withFileLock } from '../scripts/shared/io.mjs';
import { commitMainMemoryMap, readMemoryProject } from '../scripts/cloud/memory.mjs';
import { memoryReadViews } from '../scripts/cloud/memory-read-view.mjs';

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
