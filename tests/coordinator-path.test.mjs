import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinatorNodePath, coordinatorPathText } from '../scripts/shared/coordinator-path.mjs';

const root = () => ({ id: 'ROOT_INTERNAL', title: '项目', purpose: '全局目标', memoryDocument: '根约束', children: [
  { id: 'PARENT_INTERNAL', title: '工程', purpose: '构建和测试', memoryDocument: '父约束', children: [
    { id: 'MAIN_INTERNAL', title: '测试', purpose: '回归', memoryDocument: '节点约束', children: [
      { id: 'CHILD_INTERNAL', title: '后代', memoryDocument: '不应自动读取' },
    ] },
  ] }, { id: 'OTHER_INTERNAL', title: '其他', memoryDocument: '兄弟秘密' },
] });

test('真实路径按根到当前节点读取全部正文，不包含兄弟和后代，展示不附编号', () => {
  const path = coordinatorNodePath(root(), 'MAIN_INTERNAL');
  assert.deepEqual(path.map(node => node.memoryDocument), ['根约束', '父约束', '节点约束']);
  assert.deepEqual(path.map(node => node.memoryStatus), ['loaded', 'loaded', 'loaded']);
  assert.equal(coordinatorPathText(path), '项目：全局目标\n└─ 工程：构建和测试\n  └─ 测试：回归');
  assert.doesNotMatch(coordinatorPathText(path), /INTERNAL/);
  assert.doesNotMatch(JSON.stringify(path), /兄弟秘密|不应自动读取/);
  assert.equal(coordinatorNodePath(root(), 'ROOT_INTERNAL').length, 1);
});

test('缺失、无权和容量不足按节点标明，不裁切正文或放宽权限', () => {
  const doc = root(); delete doc.children[0].memoryDocument;
  assert.deepEqual(coordinatorNodePath(doc, 'MAIN_INTERNAL').map(node => node.memoryStatus), ['loaded', 'missing', 'loaded']);
  assert.deepEqual(coordinatorNodePath(root(), 'MAIN_INTERNAL', { nodeIds: ['MAIN_INTERNAL'] }).map(node => node.memoryStatus), ['loaded', 'forbidden', 'loaded']);
  assert.throws(() => coordinatorNodePath(root(), 'MAIN_INTERNAL', { nodeIds: ['OTHER_INTERNAL'] }), { code: 'FORBIDDEN' });
  assert.throws(() => coordinatorNodePath(root(), 'DELETED_INTERNAL'), { code: 'NOT_FOUND' });
  const small = coordinatorNodePath(root(), 'MAIN_INTERNAL', { maxMemoryChars: 3 });
  assert.equal(small[0].memoryDocument, '根约束');
  assert.equal(small[1].memoryStatus, 'capacity'); assert.equal(small[1].memoryDocument, undefined);
  assert.equal(small[2].memoryStatus, 'capacity');
});
