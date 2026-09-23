import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { buildFilesystemV2 } from '../scripts/shared/filesystem-v2.mjs';
import { commitMainMemoryMap, commitSessionMap, publishSessionMemory, readMemoryProject, startMemoryServer } from '../scripts/cloud/memory.mjs';
import { filesystemProjectDirectory, migrateProjectMemoryToFilesystemV2 } from '../scripts/cloud/memory-filesystem.mjs';
import { validate } from '../scripts/shared/map-model.mjs';

const runGit = promisify(execFile);

function snapshot() {
  return {
    version: 'snapshot-v1',
    mainSha: 'abc123',
    publishedAt: '2026-09-13T00:00:00Z',
    memory: {
      map: {
        root: {
          id: 'M1',
          kind: 'module',
          title: '前端',
          purpose: '负责前端交互与展示',
          flows: [{ from: 'N1', to: 'N2' }],
          todos: [{ id: 'T1', title: '补充空状态', description: '为空列表增加明确提示', status: 'pending' }],
          ideas: [{ id: 'I1', text: '允许用户保存筛选条件', state: 'pending' }],
          children: [
            { id: 'N1', kind: 'node', title: '提交按钮', purpose: '提交当前表单', children: [] },
            { id: 'N2', kind: 'node', title: '反馈列表', purpose: '', children: [] },
          ],
        },
      },
      records: {
        'bugs/B1.md': '# B1 重复提交\n\n- node: N1\n- status: open\n- 现象: 连续点击会创建两条记录。\n- sessions: S1',
        'fixes/B1.md': '# B1\n\n## 触发\n\n连续点击提交。\n\n## 根因\n\n请求缺少唯一约束。\n\n## 怎么修\n\n增加唯一键。\n\n## 代码\n\nsrc/create.ts\n\n## 证据\n\n并发测试通过。',
        'bugs/B2.md': '# B2 孤立记录\n\n- node: missing\n- status: resolved\n- 现象: 旧节点已被删除。',
      },
    },
  };
}

test('converts a legacy snapshot into linked node/module Markdown files', () => {
  const { files, report } = buildFilesystemV2(snapshot());
  const root = files.get('nodes/前端-module/index.md');
  const submit = files.get('nodes/前端-module/提交按钮-node/index.md');

  assert.match(root, /### Sub[\s\S]*提交按钮/);
  assert.match(root, /### \[补充空状态\]/);
  assert.match(root, /### \[允许用户保存筛选条件\]/);
  assert.match(submit, /### Related[\s\S]*反馈列表/);
  assert.match(submit, /连续点击会创建两条记录。/);
  assert.equal(report.nodes, 3);
  assert.equal(report.bugs.migrated, 2);
  assert.equal(report.bugs.unassigned, 1);
  assert.equal(report.todos, 1);
  assert.equal(report.ideas, 1);
});

test('preserves orphan bugs and does not invent missing legacy fields', () => {
  const { files } = buildFilesystemV2(snapshot());
  const bug = files.get('nodes/前端-module/提交按钮-node/bugs/B1.md');
  const orphan = files.get('unassigned/bugs/B2.md');

  assert.match(bug, /Reporter: NULL/);
  assert.match(bug, /Status: Open/);
  assert.match(bug, /Status: Confirmed[\s\S]*原因：请求缺少唯一约束。/);
  assert.match(bug, /\[A1\]\(tests\/B1-A1.md\)/);
  assert.match(bug, /\[A1\]\(traces\/B1-A1.md\)/);
  assert.match(orphan, /旧节点已被删除。/);
});

test('omits an attribution attempt when the legacy record has no usable cause', () => {
  const input = snapshot();
  input.memory.records['fixes/B1.md'] = '# B1\n\n## 根因\n\n待定位\n\n## 怎么修\n\n未修\n\n## 代码\n\n待补充';
  const { files } = buildFilesystemV2(input);
  const bug = files.get('nodes/前端-module/提交按钮-node/bugs/B1.md');
  const causeSection = bug.match(/## 4\. 原因与代码改动([\s\S]*?)## 5\./)[1];

  assert.doesNotMatch(causeSection, /Status:/);
  assert.match(causeSection, /NULL/);
});

test('treats a diagnostic note beginning with pending investigation as no attribution', () => {
  const input = snapshot();
  input.memory.records['fixes/B1.md'] = '# B1\n\n## 根因\n\n待定位；服务器当前不可用。\n\n## 怎么修\n\n未修';
  const { files } = buildFilesystemV2(input);
  const bug = files.get('nodes/前端-module/提交按钮-node/bugs/B1.md');
  const causeSection = bug.match(/## 4\. 原因与代码改动([\s\S]*?)## 5\./)[1];

  assert.doesNotMatch(causeSection, /Status:/);
});

test('adds stable ids when sibling directory names collide', () => {
  const input = snapshot();
  input.memory.map.root.children.push({ id: 'N3', kind: 'node', title: '提交按钮', purpose: '另一个节点', children: [] });
  const { files } = buildFilesystemV2(input);

  assert(files.has('nodes/前端-module/提交按钮-node--N1/index.md'));
  assert(files.has('nodes/前端-module/提交按钮-node--N3/index.md'));
});

test('encodes parentheses in generated Markdown links', () => {
  const input = snapshot();
  input.memory.map.root.children[0].title = '提交 API (v2)';
  const { files } = buildFilesystemV2(input);
  const root = files.get('nodes/前端-module/index.md');

  assert.match(root, /%28v2%29-node\/index\.md/);
});

test('projects leftover deferred bugs as Unfixable and omits leftover wontfix files', () => {
  const input = snapshot();
  input.memory.records['bugs/B3.md'] = '# B3 以后再说\n\n- node: N1\n- status: deferred\n- 现象: 旧延期记录。';
  input.memory.records['bugs/B4.md'] = '# B4 不改了\n\n- node: N1\n- status: wontfix\n- 现象: 旧不处理记录。';
  const { files, report } = buildFilesystemV2(input);
  const deferred = files.get('nodes/前端-module/提交按钮-node/bugs/B3.md');
  const index = files.get('nodes/前端-module/提交按钮-node/index.md');

  assert.match(deferred, /Status: Unfixable/);
  assert.equal(files.has('nodes/前端-module/提交按钮-node/bugs/B4.md'), false);
  assert.match(index, /Status: Unfixable/);
  assert.doesNotMatch(index, /旧不处理记录/);
  assert.equal(report.warnings.some(item => item.code === 'HISTORICAL_DEFERRED' && item.id === 'B3'), true);
  assert.equal(report.warnings.some(item => item.code === 'DROPPED_WONTFIX' && item.id === 'B4'), true);
  assert.equal(report.bugs.migrated, 3);
});

test('deleting a Bug removes its active record and regenerated Markdown without erasing history', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-fs-v2-bug-delete-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = path.join(dataDir, 'repository');
  await fs.mkdir(repository);
  for (const args of [['init', '-q'], ['config', 'user.email', 'test@example.test'], ['config', 'user.name', 'Test']]) {
    await runGit('git', args, { cwd: repository, windowsHide: true });
  }
  await fs.writeFile(path.join(repository, 'README.md'), 'test repository\n');
  await runGit('git', ['add', 'README.md'], { cwd: repository, windowsHide: true });
  await runGit('git', ['commit', '-qm', 'test'], { cwd: repository, windowsHide: true });
  const sourceCommit = (await runGit('git', ['rev-parse', 'HEAD'], { cwd: repository, windowsHide: true })).stdout.trim();
  const projectId = 'test';
  const configuration = { dataDir, adminToken: 'test-admin', projects: { [projectId]: { token: 'test-project', root: repository, ref: 'HEAD' } } };
  const map = { v: 1, project: 'Test', bootstrap: 'ready', flows: [], root: {
    id: 'T0', title: 'Test', kind: 'module', state: 'dirty', bugs: [{ id: 'B1', title: 'Old bug', status: 'open' }], children: [],
  } };
  const records = {
    'bugs/B1.md': '# B1 Old bug\n\n- node: T0\n- status: open\n- 现象: Old problem.',
    'fixes/B1.md': '# B1\n\n## 根因\n\nOld cause.',
  };
  const projectDir = path.join(dataDir, createHash('sha256').update(projectId).digest('hex'));
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, 'memory.json'), JSON.stringify({
    revision: 1, main: { version: 'main-v1', memory: { map, records } },
    sessions: { s1: { version: 'session-v1', memory: { map, records } } },
    receipts: {}, history: [{ scope: 'main', version: 'main-v1', snapshot: { version: 'main-v1', memory: { map, records } } }], events: [], eventCursors: {},
  }));
  await migrateProjectMemoryToFilesystemV2(dataDir, projectId);
  const request = { operationId: 'delete-b1', baseVersion: 'main-v1', operations: [
    { type: 'delete-work-item', nodeId: 'T0', kind: 'bug', itemId: 'B1' },
  ] };
  const result = await commitMainMemoryMap(configuration, projectId, request);
  assert.deepEqual(await commitMainMemoryMap(configuration, projectId, request), result);
  const state = await readMemoryProject(configuration, projectId);
  assert.equal(state.main.memory.map.root.bugs.length, 0);
  assert.equal(state.main.memory.records['bugs/B1.md'], undefined);
  assert.equal(state.main.memory.records['fixes/B1.md'], undefined);
  assert.deepEqual(state.main.deletedRecordKeys, ['bugs/B1.md', 'fixes/B1.md']);
  assert.equal(state.history.length, 2);
  assert.equal(state.history[0].snapshot.memory.records['bugs/B1.md'], records['bugs/B1.md']);
  assert.equal(state.history[1].snapshot.memory.records['bugs/B1.md'], undefined);
  const content = path.join(filesystemProjectDirectory(dataDir, projectId), 'content', 'main', 'nodes', 'Test-module');
  await assert.rejects(fs.stat(path.join(content, 'bugs', 'B1.md')), { code: 'ENOENT' });
  assert.doesNotMatch(await fs.readFile(path.join(content, 'index.md'), 'utf8'), /Old bug/);
  await assert.rejects(commitMainMemoryMap(configuration, projectId, { ...request, operationId: 'stale-b1' }), error => error.code === 'VERSION_CONFLICT');

  const session = await commitSessionMap(configuration, projectId, 's1', { operationId: 'session-delete-b1', baseVersion: 'session-v1', operations: request.operations });
  assert.equal(session.committed, true);
  const next = await readMemoryProject(configuration, projectId);
  assert.equal(next.sessions.s1.memory.records['bugs/B1.md'], undefined);
  assert.deepEqual(next.sessions.s1.deletedRecordKeys, ['bugs/B1.md', 'fixes/B1.md']);

  const service = await startMemoryServer({ ...configuration, port: 0 });
  try {
    const send = (operationId, nextMap) => fetch(`${service.url}/v1/projects/${projectId}/sessions/s2`, {
      method: 'POST', headers: { Authorization: 'Bearer test-project', 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationId, baseVersion: null, baseMainVersion: next.main.version,
        sourceCommit, memory: { map: nextMap, records } }),
    });
    const stale = await send('stale-session', map);
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.code, 'DELETED_WORK_ITEM');
    const clean = await send('clean-session', next.main.memory.map);
    assert.equal(clean.status, 200);
    const saved = (await clean.json()).snapshot;
    assert.equal(saved.memory.records['bugs/B1.md'], undefined, 'a new Session cannot revive a deleted legacy Bug record');
    assert.deepEqual(saved.deletedRecordKeys, ['bugs/B1.md', 'fixes/B1.md']);
    await publishSessionMemory(configuration, projectId, { operationId: 'publish-clean-session', baseVersion: next.main.version,
      sessionId: 's2', sessionVersion: saved.version, expectedMainSha: sourceCommit });
    const published = await readMemoryProject(configuration, projectId);
    assert.equal(published.main.memory.records['bugs/B1.md'], undefined);
    assert.deepEqual(published.main.deletedRecordKeys, ['bugs/B1.md', 'fixes/B1.md']);
  } finally { await service.close(); }
});

test('renders durable Bug and Todo rounds, refutations, links and complete first paragraphs', () => {
  const input = snapshot();
  input.memory.map.root.purpose = '前端模块负责全部交互、状态同步与可访问性。\n\n后续段落不进索引。';
  input.memory.map.root.todos[0].description = '需要保留完整的需求第一段，不按二十字截断。\n\n第二段只在详情里。';
  input.memory.map.root.todos[0].attempts = [
    { status: 'Refuted', refutedBy: 'A2', reason: '跨窗口仍重复', acceptance: '单窗口不得重复提交', solution: '仅禁用按钮',
      codeIndex: [{ path: 'src/button.js', summary: '禁用按钮' }], test: { summary: '跨窗口失败', content: '两个窗口复现重复。' }, sessionIds: ['s1'] },
    { status: 'Confirmed', acceptance: '两个窗口只提交一次', solution: '服务端唯一约束',
      event: '扩展到跨窗口', eventSource: 'Human', codeIndex: [{ path: 'src/server.js', summary: '增加唯一约束' }],
      test: { summary: '跨窗口通过', content: '两个窗口只生成一条记录。' }, sessionIds: ['s2'] },
  ];
  input.memory.map.root.children[0].bugs = [{ id: 'B5', title: '并发重复', status: 'open',
    phenomenon: '并发点击导致重复反馈，现象需要完整保留。\n\n后续诊断留在详情。',
    attempts: [
      { status: 'Refuted', refutedBy: 'A2', reason: '未覆盖跨窗口', reproduction: '在一个窗口双击', cause: '按钮未禁用',
        test: { summary: '跨窗口失败', content: '复现跨窗口重复。' } },
      { status: 'Confirmed', reproduction: '两个窗口同时提交', cause: '服务端无原子唯一约束', resolution: '增加唯一约束',
        codeIndex: [{ path: 'src/create.js', summary: '原子创建' }], test: { summary: '并发通过', content: '并发只创建一条。' } },
    ] }];
  for (const child of input.memory.map.root.children) child.kind = 'work';
  validate(input.memory.map);
  const { files, report } = buildFilesystemV2(input);
  const root = files.get('nodes/前端-module/index.md');
  const childIndex = files.get('nodes/前端-module/提交按钮-node/index.md');
  const todo = files.get('nodes/前端-module/todos/T1.md');
  const bug = files.get('nodes/前端-module/提交按钮-node/bugs/B5.md');
  assert.match(root, /前端模块负责全部交互、状态同步与可访问性。/);
  assert.match(root, /需要保留完整的需求第一段，不按二十字截断。/);
  assert.match(childIndex, /并发点击导致重复反馈，现象需要完整保留。/);
  assert.doesNotMatch(root + childIndex, /后续段落不进索引|第二段只在详情里|后续诊断留在详情/);
  for (const file of [todo, bug]) {
    assert.match(file, /CurrentAttempt: A2/);
    assert.match(file, /Status: Refuted\nRefutedBy: A2/);
    assert.match(file, /### A2\nStatus: Confirmed/);
    assert.match(file, /\[A2\]\(tests\//);
    assert.match(file, /\[A2\]\(traces\//);
  }
  assert.match(todo, /当前有效方案\n服务端唯一约束/);
  assert.match(bug, /当前有效结论\n增加唯一约束/);
  assert.equal(files.get('nodes/前端-module/todos/tests/T1-A2.md').includes('两个窗口只生成一条记录。'), true);
  assert.equal(files.get('nodes/前端-module/提交按钮-node/bugs/traces/B5-A2.md').includes('NULL'), true);
  assert.equal(report.lossy.briefsTruncated, 0);
});

test('rejects refutations without a later round or an explicit reason', () => {
  const input = snapshot().memory.map;
  for (const child of input.root.children) child.kind = 'work';
  input.root.todos[0].attempts = [{ status: 'Refuted', refutedBy: 'A2', reason: 'wrong' }];
  assert.throws(() => validate(input), { code: 'INVALID_ATTEMPT' });
  input.root.todos[0].attempts.push({ status: 'Confirmed', solution: 'fixed' });
  validate(input);
  input.root.todos[0].attempts[0].reason = '';
  assert.throws(() => validate(input), { code: 'INVALID_ATTEMPT' });
});
