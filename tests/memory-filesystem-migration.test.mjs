import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFilesystemV2 } from '../scripts/shared/filesystem-v2.mjs';

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
