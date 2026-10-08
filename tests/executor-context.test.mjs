import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { buildContextTree, contextChanges, contextChangeLines, contextDocument, contextHash, contextSlice, publicContextTree, resolveContextNode } from '../scripts/shared/context-tree.mjs';
import { buildFilesystemV2 } from '../scripts/shared/filesystem-v2.mjs';
import { executorContext } from '../scripts/workbench/context.mjs';
import { resolveProject, sessionBinding, sessionBindingsPath } from '../scripts/workbench/project.mjs';
import { memoryConfigPath, sessionMemoryDir } from '../scripts/workbench/memory.mjs';
import { buildArchiveReconciliation } from '../scripts/workbench/reconcile.mjs';
import { hash, atomicWrite, encode } from '../scripts/shared/io.mjs';
import { startServer } from '../scripts/workbench/server.mjs';

const node = (id, title, children = []) => ({ id, title, kind: children.length ? 'module' : 'work', purpose: title, children, memories: [], bugs: [], todos: [], ideas: [] });
const fixture = () => ({ version: 'v1', memory: { map: { root: node('ROOT', '项目', [node('A', '主页', [node('A1', '列表')]), node('B', '登录'), node('C', '支付')]), flows: [{ from: 'A', to: 'B', label: '依赖鉴权' }] }, records: {} } });
const tree = snapshot => publicContextTree(buildContextTree(contextDocument(snapshot, { sessionId: 'executor' })));

test('hash 不用于安全；同内容确定，节点修改只重算自身与祖先分支', () => {
  assert.equal(contextHash('hello'), '4f9f2cab');
  const snapshot = fixture(), before = buildContextTree(snapshot);
  snapshot.memory.map.root.children[0].children[0].purpose = '新的需求';
  snapshot.version = 'v2';
  const after = buildContextTree(snapshot, before);
  assert.deepEqual(after.stats, { ownHashes: 1, branchHashes: 3 });
  assert.equal(after.nodes.B.treeHash, before.nodes.B.treeHash);
  assert.equal(after.nodes.ROOT.hash, before.nodes.ROOT.hash);
  assert.notEqual(after.nodes.ROOT.treeHash, before.nodes.ROOT.treeHash);
  assert.deepEqual(buildContextTree(snapshot, after).stats, { ownHashes: 0, branchHashes: 0 });
});

test('hash 树与读取不改变 fs-v2.1 的任何输出、清单或源快照', () => {
  const snapshot = fixture(), serialized = JSON.stringify(snapshot);
  const before = [...buildFilesystemV2(snapshot).files];
  const scoped = contextDocument(snapshot, { sessionId: 'executor' });
  buildContextTree(scoped); contextSlice(scoped, 'A');
  assert.equal(JSON.stringify(snapshot), serialized);
  assert.deepEqual([...buildFilesystemV2(snapshot).files], before);
  assert.match(buildFilesystemV2(snapshot).files.get('manifest.json'), /"sha256": "[a-f0-9]{64}"/);
});

test('读取与 hash 都不包含 Idea、拒绝节点或其他 Session 的事项及记录', () => {
  const snapshot = fixture(), a = snapshot.memory.map.root.children[0];
  a.ideas = [{ id: 'I1', title: '不可读取的 Idea' }];
  a.bugs = [{ id: 'B1', title: '自己的事项', sessions: ['executor'] }, { id: 'B2', title: '其他事项', sessions: ['other'] }];
  snapshot.memory.records = { 'bugs/B1.md': '自己的记录', 'bugs/B2.md': '其他记录' };
  snapshot.memory.map.root.children[2].access = [{ agentId: 'executor', allow: 'none' }];
  const scoped = contextDocument(snapshot, { sessionId: 'executor' });
  const result = buildContextTree(scoped), content = contextSlice(scoped, 'A');
  assert.equal(result.nodes.C, undefined);
  assert.deepEqual(content.node.bugs.map(item => item.id), ['B1']);
  assert.deepEqual(content.records, { 'bugs/B1.md': '自己的记录' });
  assert.doesNotMatch(JSON.stringify(result), /不可读取的 Idea|其他事项|其他记录/);
  assert.throws(() => contextSlice(scoped, 'C'), { code: 'NOT_FOUND' });
  assert.throws(() => contextDocument(snapshot, { sessionId: '' }), { code: 'SESSION_REQUIRED' });
});

test('挂载子树、已读节点、直接关联与全局约束都能检查；无关正文不报', () => {
  const original = fixture(), before = tree(original), after = structuredClone(original);
  after.version = 'v2';
  after.memory.map.root.children[0].children[0].purpose = '列表变更';
  after.memory.map.root.children[1].purpose = '鉴权变更';
  after.memory.map.root.children[2].purpose = '不相关的正文';
  assert.deepEqual(contextChanges(before, tree(after), { mounted: ['A'], read: ['A1'] }).map(item => item.name), ['列表', '登录']);
  assert.deepEqual(contextChanges(before, tree(after), { read: ['C'] }).map(item => item.name), ['支付']);
  after.memory.map.root.memoryDocument = '新的全局约束';
  assert.equal(contextChanges(before, tree(after))[0].name, '项目');
});

test('新增、删除、移动、改名及其他模块的结构变化不漏报', () => {
  const original = fixture(), after = structuredClone(original), before = tree(original);
  after.version = 'v2';
  after.memory.map.root.children[0].children = [];
  after.memory.map.root.children[1].children = [node('A1', '列表')];
  after.memory.map.root.children[2].title = '结算';
  after.memory.map.root.children.push(node('D', '新模块'));
  const changes = contextChanges(before, tree(after));
  for (const [name, type] of [['列表', '移动'], ['结算', '改名'], ['新模块', '新增']]) assert.ok(changes.some(item => item.name === name && item.type === type));
  after.memory.map.root.children.pop();
  assert.ok(contextChanges(tree(original), tree({ ...after, memory: { map: { root: node('ROOT', '项目') }, records: {} } })).some(item => item.type === '删除'));
});

test('工具输出只有名称与类型，重名补路径，分页有剩余数量', () => {
  const changes = [{ key: 'secret-id-one', name: '提交', path: '网页 / 提交', type: '修改' }, { key: 'secret-id-two', name: '提交', path: '接口 / 提交', type: '修改' }];
  assert.deepEqual(contextChangeLines(changes), ['网页 / 提交 — 修改', '接口 / 提交 — 修改']);
  assert.deepEqual(contextChangeLines(changes, { limit: 1 }), ['网页 / 提交 — 修改', '还有 1 项；使用 --offset 1 继续查看']);
  assert.deepEqual(contextChangeLines([]), ['无变化']);
  assert.doesNotMatch(contextChangeLines(changes).join('\n'), /secret-id|hash|version/);
  const index = tree(fixture());
  assert.equal(resolveContextNode(index, '主页'), 'A');
  assert.equal(resolveContextNode(index, '项目 / 主页 / 列表'), 'A1');
  assert.throws(() => resolveContextNode(index, '不存在'), { code: 'NOT_FOUND' });
});

async function clientFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'executor-context-unit-'));
  const cleanups = [];
  t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });
  const project = await resolveProject(root), snapshot = fixture(), requests = [];
  const localRead = async (key, version) => {
    requests.push({ key, version });
    if (version && version !== snapshot.version) throw Object.assign(new Error('版本变化'), { code: 'VERSION_CONFLICT' });
    return { sessionId: 'executor', ...(key ? { version: snapshot.version, content: contextSlice(contextDocument(snapshot, { sessionId: 'executor' }), key) } : { tree: tree(snapshot) }) };
  };
  const call = (action, options = {}) => executorContext(project, 'executor', action, options, { localRead });
  return { root, project, snapshot, requests, localRead, call, onCleanup: cleanup => cleanups.push(cleanup) };
}

test('开工只取导航和根说明；按需读取及重复调用复用缓存', async t => {
  const { call, requests } = await clientFixture(t);
  const nav = await call('read');
  assert.equal(nav.source, 'local');
  assert.equal(nav.navigation.length, 5);
  assert.deepEqual(requests.map(item => item.key), [undefined, 'ROOT']);
  assert.equal(nav.global.node.children, undefined);
  const first = await call('read', { node: '主页', mount: '主页' });
  assert.equal(first.content.node.children, undefined);
  const count = requests.length;
  assert.deepEqual(await call('read', { node: '主页' }), first);
  assert.equal(requests.length, count);
  await call('read', { node: '主页', refresh: true });
  assert.equal(requests.length, count + 2);
});

test('收工只报变化，不自动确认；查看差异后仍需明确接受且再校验版本', async t => {
  const { call, snapshot } = await clientFixture(t);
  await call('read', { node: '主页', mount: '主页' });
  snapshot.version = 'v2'; snapshot.memory.map.root.children[0].purpose = '主页需求改变';
  assert.deepEqual(await call('check'), ['主页 — 修改']);
  await assert.rejects(call('check', { requireClear: true }), { code: 'CONTEXT_CHANGED' });
  const diff = await call('read', { node: '主页', diff: true });
  assert.equal(diff.before.node.purpose, '主页');
  assert.equal(diff.after.node.purpose, '主页需求改变');
  snapshot.version = 'v3';
  await assert.rejects(call('check', { acceptChanges: true }), { code: 'CONTEXT_CHANGED' });
  await call('check');
  assert.deepEqual(await call('check', { acceptChanges: true }), ['无变化']);
  assert.deepEqual(await call('check', { requireClear: true }), { clear: true, active: true });
  assert.equal((await call('read', { node: '主页' })).content.node.purpose, '主页需求改变');
  assert.deepEqual(await call('check'), ['无变化'], '接受过的变化不能因重新读取正文再次出现');
});

test('首次实际读取之后的 Cloud 变化不会被刷新正文吞掉', async t => {
  const { call, snapshot } = await clientFixture(t);
  await call('read', { node: '主页' });
  snapshot.version = 'v2'; snapshot.memory.map.root.children[0].purpose = '新需求';
  await call('read', { node: '主页', refresh: true });
  assert.deepEqual(await call('check'), ['主页 — 修改']);
});

test('断连或读错版本必须失败，不能冒充无变化；旧片段仍可读', async t => {
  const { call, project, requests } = await clientFixture(t);
  await call('read', { node: '主页' });
  await assert.rejects(executorContext(project, 'executor', 'check', {}, { localRead: async () => { throw new Error('断连'); } }), /断连/);
  const count = requests.length;
  assert.equal((await call('read', { node: '主页' })).name, '主页');
  assert.equal(requests.length, count);
  await assert.rejects(call('read', { limit: 0 }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(call('check', { offset: -1 }), { code: 'INVALID_ARGUMENT' });
});

test('没有启用新读取流程时收尾兼容；Session 缓存彼此隔离', async t => {
  const { project, call } = await clientFixture(t);
  await assert.rejects(call('check'), { code: 'CONTEXT_NOT_STARTED' });
  assert.deepEqual(await call('check', { ifStarted: true, requireClear: true }), { clear: true, active: false });
  await call('read');
  assert.deepEqual(await executorContext(project, 'other', 'check', { ifStarted: true, requireClear: true }), { clear: true, active: false });
});

test('旧流程待确认通知不能被新上下文读取绕过', async t => {
  const { root, call } = await clientFixture(t);
  await atomicWrite(path.join(root, '.codex/context/private/sync/inboxes', hash('executor') + '.json'), encode({ pending: { receipt: 'synthetic-pending' } }));
  await assert.rejects(call('read'), { code: 'INBOX_PENDING' });
});

test('开发过程仅归档 Session；仍检查文件归属，不追加 Map 记忆流水账', () => {
  const snapshot = fixture(), before = JSON.stringify(snapshot);
  snapshot.memory.map.root.children[0].owns = ['src/home.mjs'];
  const result = buildArchiveReconciliation(snapshot.memory.map, 'executor', { files: ['src/home.mjs'], summary: '开发过程', recordOnly: true });
  assert.deepEqual(result.mapped, { A: ['src/home.mjs'] });
  assert.deepEqual(result.operations, []);
  assert.deepEqual(buildArchiveReconciliation(snapshot.memory.map, 'executor', { files: ['src/unmapped.mjs'], recordOnly: true }).unclassified, ['src/unmapped.mjs']);
  assert.throws(() => buildArchiveReconciliation(snapshot.memory.map, 'executor', { recordOnly: 'yes' }), /布尔值/);
  assert.doesNotMatch(JSON.stringify(snapshot), /开发过程/);
  assert.ok(before);
});

test('真实公共 CLI → 本机工作台 → 私有缓存 → 收工检查，进程重启后不丢基线', async t => {
  const { root, snapshot, onCleanup } = await clientFixture(t);
  snapshot.memory.map.root.children[0].owns = ['src/home.mjs'];
  await atomicWrite(path.join(root, 'src/home.mjs'), 'export const value = 1;\n');
  const mapFile = path.join(root, '.codex/context/map.json');
  await atomicWrite(mapFile, encode(snapshot.memory.map));
  const before = await fs.readFile(mapFile, 'utf8');
  const server = await startServer({ root, port: 0 });
  onCleanup(() => server.close());
  const run = promisify(execFile), launcher = fileURLToPath(new URL('../bin/context-guard-skill.js', import.meta.url));
  const cli = async (args, input) => {
    const child = run(process.execPath, [launcher, ...args, '--root', root, '--session', 'executor'],
      { env: { ...process.env, CODEX_THREAD_ID: 'executor', CONTEXT_GUARD_NAMED_WORKBENCH: '0' }, timeout: 20000, windowsHide: true });
    if (input) child.child.stdin.end(JSON.stringify(input));
    return JSON.parse((await child).stdout);
  };
  await cli(['workbench', '--direct']);
  const first = await cli(['map', 'read', '--context', '--node', '主页', '--mount', '主页']);
  assert.equal(first.name, '主页');
  assert.equal(await fs.readFile(mapFile, 'utf8'), before, '读取缓存不改原 Map');
  const plan = await cli(['plan-start', '--input', '-'], { approved: true, summary: '只修改主页', paths: ['src/home.mjs'], node_ids: ['A'] });
  assert.equal(plan.status, 'working');
  assert.deepEqual(plan.node_ids, ['A']);
  assert.deepEqual(plan.sync, {}, '开工不使用旧全量 prepare');
  assert.deepEqual(await cli(['map', 'context-check']), ['无变化']);
  snapshot.memory.map.root.children[0].purpose = '主页新设计';
  await atomicWrite(mapFile, encode(snapshot.memory.map));
  assert.deepEqual(await cli(['map', 'context-check']), ['主页 — 修改']);
  const repeated = await cli(['map', 'context-check']);
  assert.deepEqual(repeated, ['主页 — 修改'], '每个 CLI 进程都读取同一私有基线');
  assert.equal((await cli(['map', 'read', '--context', '--node', '主页'])).content.node.purpose, '主页', '未经刷新保留任务已读内容');
  await assert.rejects(cli(['map', 'context-check', '--require-clear']), error => error.code === 1 && JSON.parse(error.stdout).error.code === 'CONTEXT_CHANGED');
  const diff = await cli(['map', 'read', '--context', '--node', '主页', '--diff']);
  assert.equal(diff.before.node.purpose, '主页');
  assert.equal(diff.after.node.purpose, '主页新设计');
  assert.deepEqual(await cli(['map', 'context-check', '--accept-changes']), ['无变化']);
  assert.deepEqual(await cli(['map', 'context-check', '--require-clear']), { clear: true, active: true });
});

test('公共 CLI 的 Cloud 读取契约：只访问薄接口，不下载 Main 或完整 Session', async t => {
  const { root, project, snapshot, onCleanup } = await clientFixture(t);
  await atomicWrite(sessionBindingsPath(project), encode({ sessions: { executor: await sessionBinding(project, 'executor') } }));
  const requests = [];
  // 这是合成 HTTP 提供方；真实 Cloud handler 另有 Cloud 仓库接口测试。
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname !== '/v1/projects/project/context' || url.searchParams.get('session') !== 'executor' || req.headers.authorization !== 'Bearer synthetic-credential') {
      res.writeHead(401); res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED' } })); return;
    }
    const key = url.searchParams.get('node');
    res.end(JSON.stringify({ projectId: 'project', sessionId: 'executor', ...(key ? { version: snapshot.version, content: contextSlice(contextDocument(snapshot, { sessionId: 'executor' }), key) } : { tree: tree(snapshot) }) }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  onCleanup(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await atomicWrite(memoryConfigPath(project), encode({ url: `http://127.0.0.1:${server.address().port}`, projectId: 'project', token: 'synthetic-credential' }));
  const run = promisify(execFile), launcher = fileURLToPath(new URL('../bin/context-guard-skill.js', import.meta.url));
  const cli = async args => JSON.parse((await run(process.execPath, [launcher, ...args, '--root', root, '--session', 'executor'], { windowsHide: true })).stdout);
  assert.equal((await cli(['map', 'read', '--context'])).source, 'cloud');
  await cli(['map', 'read', '--context', '--node', '主页', '--mount', '主页']);
  const count = requests.length;
  await cli(['map', 'read', '--context', '--node', '主页']);
  assert.equal(requests.length, count);
  assert.deepEqual(await cli(['map', 'context-check']), ['无变化']);
  snapshot.version = 'v2'; snapshot.memory.map.root.children[1].purpose = '鉴权更新';
  assert.deepEqual(await cli(['map', 'context-check']), ['登录 — 修改']);
  assert.ok(requests.every(value => value.startsWith('/v1/projects/project/context?')));
  assert.equal(await fs.stat(path.join(sessionMemoryDir(project, 'executor'), 'context-cache.json')).then(value => value.mode & 0o777), 0o600);
  await assert.rejects(fs.access(path.join(sessionMemoryDir(project, 'executor'), 'map.json')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(root, '.codex/context/map.json')), { code: 'ENOENT' });
});
