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
  writeProjectMemory,
} from '../scripts/cloud/memory-filesystem.mjs';
import { readMemoryProject } from '../scripts/cloud/memory.mjs';
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
