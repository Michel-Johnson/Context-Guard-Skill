import path from 'node:path';
import { atomicWrite, encode, readJSON, withFileLock, hash } from '../shared/io.mjs';
import { MapError } from '../shared/map-model.mjs';
import { contextChanges, contextChangeLines, resolveContextNode } from '../shared/context-tree.mjs';
import { memoryConfigPath, memoryRequest, sessionMemoryDir } from './memory.mjs';

const cacheFile = (project, session) => path.join(sessionMemoryDir(project, session), 'context-cache.json');
export const hasExecutorContext = async (project, session) => !!await readJSON(cacheFile(project, session), null);
const number = (value, fallback, max) => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) throw new MapError('INVALID_ARGUMENT', '分页参数超出范围');
  return parsed;
};
function validTree(tree) {
  if (!tree?.version || !tree.root || !tree.nodes || !Object.hasOwn(tree.nodes, tree.root) || Object.keys(tree.nodes).length > 10000) throw new MapError('CONTEXT_UNAVAILABLE', '服务器没有返回完整的上下文索引', 503);
  for (const [key, node] of Object.entries(tree.nodes)) {
    if (node.key !== key || !Array.isArray(node.children) || !Array.isArray(node.related) || typeof node.path !== 'string'
      || ![node.hash, node.structureHash, node.treeHash].every(hash => /^[a-f0-9]{8}$/.test(hash))) throw new MapError('CONTEXT_UNAVAILABLE', '上下文索引损坏', 503);
    if (node.children.some(id => !Object.hasOwn(tree.nodes, id)) || node.related.some(id => !Object.hasOwn(tree.nodes, id))) throw new MapError('CONTEXT_UNAVAILABLE', '上下文索引不完整', 503);
  }
  return tree;
}

// 私有、可删除重建的读取缓存；不修改 Map、Markdown 或现有 Session 格式。
export async function executorContext(project, session, action, options = {}, { localRead } = {}) {
  if (!session) throw new MapError('SESSION_REQUIRED', '请先绑定真实 Session');
  const file = cacheFile(project, session);
  return withFileLock(file + '.lock', async () => {
    const config = await readJSON(memoryConfigPath(project), null);
    const origin = config ? `${config.url}\0${config.projectId}` : `local\0${project.projectId}`;
    let cache = await readJSON(file, null);
    if (cache && cache.origin !== origin && !options.restart) throw new MapError('CONTEXT_SOURCE_CHANGED', '上下文来源已切换，请用 --restart 建立新的读取基线', 409);
    if (options.restart) cache = null;
    if (!cache && options.ifStarted) return { clear: true, active: false };
    if (!cache && action === 'check') throw new MapError('CONTEXT_NOT_STARTED', '尚未建立开工上下文基线，不能判断开发期间的变化', 409);
    const refreshNavigation = !!cache && options.refresh && !options.node;
    const read = async (node, version) => {
      const result = config ? await memoryRequest(project, `context?${new URLSearchParams({ session, ...(node ? { node } : {}), ...(version ? { version } : {}) })}`)
        : await localRead?.(node, version);
      if (!result || result.sessionId !== session) throw new MapError('CONTEXT_UNAVAILABLE', '无法确认上下文所属 Session', 503);
      return result;
    };
    const readGlobal = async index => {
      const result = await read(index.root, index.version);
      if (result.version !== index.version || result.content?.node?.id !== index.root) throw new MapError('CONTEXT_UNAVAILABLE', '项目说明与导航索引不一致', 503);
      return result.content;
    };
    const save = async () => {
      await atomicWrite(file, encode(cache));
      await atomicWrite(path.join(project.worktreeRoot, '.codex/context/private/context-readers', hash(session) + '.json'),
        encode({ sessionId: session, worktreeRoot: project.worktreeRoot, file }));
    };
    if (!cache) {
      const inbox = path.join(project.kind === 'git' ? sessionMemoryDir(project, session) : path.join(project.worktreeRoot, '.codex/context'), 'private/sync/inboxes', hash(session) + '.json');
      if ((await readJSON(inbox, null))?.pending) throw new MapError('INBOX_PENDING', '先处理并确认旧流程的 Map 通知，再开始新的上下文读取', 409);
      const result = await read();
      const tree = validTree(result.tree);
      cache = { origin, baseline: tree, index: tree, fragments: {}, original: {}, read: [], mounted: [], reviewed: null };
      // 仅拉取项目级说明，不下载整棵树的正文。
      const global = await readGlobal(tree);
      cache.fragments[tree.root] = global;
      cache.original[tree.root] = global;
      await save();
    }
    if (options.mount) {
      const key = resolveContextNode(cache.index, options.mount);
      cache.mounted = [...new Set([...cache.mounted, key])];
      await save();
    }
    if (action === 'status') return { context: true, version: cache.index.version,
      grants: Object.values(cache.index.nodes).filter(node => node.writable).map(node => node.key) };
    const offset = number(options.offset, 0, 10000), limit = number(options.limit, action === 'read' ? 100 : 20, 100);
    if (limit < 1) throw new MapError('INVALID_ARGUMENT', '每页至少返回一项');
    if (action === 'read' && !options.diff) {
      if (!options.node) {
        if (refreshNavigation) {
          const latest = validTree((await read()).tree);
          const global = await readGlobal(latest);
          // 显式刷新显示内容，保留开工/确认基线和此前实际读取的正文。
          cache.index = latest;
          cache.fragments[latest.root] = global;
          cache.checked = null;
          await save();
        }
        const nodes = Object.values(cache.index.nodes);
        if (!cache.fragments[cache.index.root]) {
          const global = await readGlobal(cache.index);
          cache.fragments[cache.index.root] = global;
          cache.original[cache.index.root] = global;
          await save();
        }
        return { source: config ? 'cloud' : 'local', version: cache.index.version, global: cache.fragments[cache.index.root],
          navigation: nodes.slice(offset, offset + limit).map(node => ({ name: node.name, path: node.path, purpose: node.purpose })),
          remaining: Math.max(0, nodes.length - offset - limit) };
      }
      const key = resolveContextNode(cache.index, options.node);
      if (!Object.hasOwn(cache.fragments, key) || options.refresh) {
        const latest = await read();
        cache.index = validTree(latest.tree);
        if (!cache.index.nodes[key]) throw new MapError('NOT_FOUND', '节点已删除或失去读取权限', 404);
        const result = await read(key, cache.index.version);
        if (result.version !== cache.index.version || result.content?.node?.id !== key) throw new MapError('CONTEXT_UNAVAILABLE', '读取切片与索引不一致', 503);
        // 首次实际读取以该次版本作为对比基线，刷新不会吞掉未处理的变化。
        if (!Object.hasOwn(cache.original, key)) {
          cache.original[key] = result.content;
        }
        cache.fragments[key] = result.content;
        cache.read = [...new Set([...cache.read, key])];
        cache.checked = null;
        await save();
      }
      return { name: cache.index.nodes[key].name, content: cache.fragments[key] };
    }
    // 失败不回退旧缓存，不能把断连解释成“无变化”。
    const latest = await read();
    const tree = validTree(latest.tree);
    const baseline = cache.reviewed?.tree || cache.baseline;
    const changes = contextChanges(baseline, tree, { mounted: cache.mounted, read: cache.read });
    if (options.diff) {
      if (!options.node) throw new MapError('INVALID_ARGUMENT', '查看差异需要 --node 节点名称或路径');
      const inLatest = Object.values(tree.nodes).some(node => [node.key, node.name, node.path].includes(options.node));
      const key = resolveContextNode(inLatest ? tree : cache.index, options.node);
      const after = tree.nodes[key] ? (await read(key, tree.version)).content : null;
      return { name: (tree.nodes[key] || cache.index.nodes[key]).name,
        before: cache.original[key] ?? null, after, ...(cache.original[key] === undefined ? { note: '此节点此前未读取正文，只保存了 hash，无法还原旧正文' } : {}) };
    }
    if (options.acceptChanges) {
      if (!cache.checked || cache.checked.version !== tree.version) throw new MapError('CONTEXT_CHANGED', '上下文又有变化，请重新检查并确认影响', 409);
      cache.reviewed = { tree };
      cache.index = tree;
      cache.fragments = {};
      cache.original = {};
    }
    cache.checked = { version: tree.version };
    await save();
    if (options.requireClear) {
      if (changes.length && !options.acceptChanges) throw new MapError('CONTEXT_CHANGED', contextChangeLines(changes).join('\n'), 409);
      return { clear: true, active: true };
    }
    return contextChangeLines(options.acceptChanges ? [] : changes, { offset, limit });
  });
}

export const contextFailure = error => `无法检查：${({ MEMORY_UNAVAILABLE: 'Cloud 暂时不可用', UNAUTHORIZED: '登录已失效', FORBIDDEN: '没有读取权限', VERSION_CONFLICT: '读取期间版本已变化，请重试', SESSION_BINDING_REQUIRED: '请先绑定当前 Session',
  CLOUD_LOGIN_REQUIRED: '请先登录项目 Cloud', CONTEXT_SOURCE_CHANGED: '来源已切换，请明确重建读取基线', INBOX_PENDING: '先处理旧流程的待确认通知',
  CONTEXT_NOT_STARTED: '尚未建立开工上下文基线，不能判断开发期间的变化',
  CONTEXT_UNAVAILABLE: '上下文读取结果不完整或损坏', CONTEXT_CHANGED: '上下文有变化，请查看差异并处理后重查', INVALID_ARGUMENT: '命令参数不正确', NOT_FOUND: '节点已删除或不可读取',
  AMBIGUOUS_NODE: '节点重名，请使用完整模块路径', ENOENT: '本地读取状态缺失', SESSION_REQUIRED: '请先绑定真实 Session', STATE_BUSY: '读取缓存正被占用，请重试',
})[error.code] || '读取失败，请检查连接或本地状态'}`;
