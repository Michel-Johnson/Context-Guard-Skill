import { entries, filterNodeAccess, MapError, scopeDocumentToSession } from './map-model.mjs';

// FNV-1a 只用于变化提示；不参与鉴权、发布或 SHA-256 清单。
export function contextHash(text) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193);
  return (value >>> 0).toString(16).padStart(8, '0');
}
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const ownNode = node => Object.fromEntries(Object.entries(node).filter(([key]) => !['children', '_inbox', '_inboxExpanded', 'access', 'ideas'].includes(key)));

export function contextDocument(snapshot, { sessionId, agentId = sessionId, grants } = {}) {
  if (!sessionId) throw new MapError('SESSION_REQUIRED', '上下文读取需要真实 Session');
  if (!snapshot?.memory?.map?.root || !snapshot.version) throw new MapError('CONTEXT_UNAVAILABLE', '上下文尚未准备好', 503);
  const doc = scopeDocumentToSession(snapshot.memory.map, sessionId);
  const readable = new Set(filterNodeAccess(doc, grants || [...entries(doc.root).keys()], agentId, 'read'));
  const prune = node => {
    if (!readable.has(node.id)) return null;
    node.ideas = [];
    node.children = (node.children || []).map(prune).filter(Boolean);
    node._inbox = (node._inbox || []).map(prune).filter(Boolean);
    return node;
  };
  doc.root = prune(doc.root);
  if (!doc.root) throw new MapError('FORBIDDEN', '没有项目上下文读取权限', 403);
  const visible = entries(doc.root);
  doc.flows = (doc.flows || []).filter(flow => visible.has(flow.from) && visible.has(flow.to));
  doc.root.flows = (doc.root.flows || []).filter(flow => visible.has(flow.from) && visible.has(flow.to));
  // 只返回本 Session 可见事项的记录，不能把原始 records 混入读取切片。
  const records = {};
  for (const { node } of visible.values()) for (const [field, directories] of [['bugs', ['bugs', 'fixes']], ['todos', ['todos']]]) {
    for (const item of node[field] || []) for (const directory of directories) {
      const name = `${directory}/${item.id}.md`;
      if (Object.hasOwn(snapshot.memory.records || {}, name)) records[name] = snapshot.memory.records[name];
    }
  }
  return { ...snapshot, contextAgentId: agentId, memory: { map: doc, records } };
}

function nodeRecords(snapshot, node) {
  const records = {};
  for (const [field, directories] of [['bugs', ['bugs', 'fixes']], ['todos', ['todos']]]) {
    for (const item of node[field] || []) for (const directory of directories) {
      const name = `${directory}/${item.id}.md`;
      if (Object.hasOwn(snapshot.memory.records || {}, name)) records[name] = snapshot.memory.records[name];
    }
  }
  return records;
}

// previous 是同一权限范围的可重建缓存。正文与子列表未变时复用 hash。
export function buildContextTree(snapshot, previous) {
  const document = snapshot.memory.map, index = entries(document.root), related = new Map([...index.keys()].map(id => [id, new Set()]));
  const writable = new Set(filterNodeAccess(document, [...index.keys()], snapshot.contextAgentId, 'write'));
  for (const flow of [...(document.flows || []), ...(document.root.flows || [])]) {
    if (related.has(flow.from) && related.has(flow.to)) { related.get(flow.from).add(flow.to); related.get(flow.to).add(flow.from); }
  }
  for (const { node } of index.values()) for (const field of ['memories', 'bugs', 'todos']) for (const item of node[field] || []) {
    const references = Array.isArray(item.also) ? item.also : typeof item.also === 'string' ? item.also.split(/[,，]/).map(value => value.trim()) : [];
    for (const id of references) if (related.has(id)) { related.get(node.id).add(id); related.get(id).add(node.id); }
  }
  const nodes = {}, sources = {}, stats = { ownHashes: 0, branchHashes: 0 };
  const visit = (node, parent = null, parentPath = [], label = node.title || '未命名节点') => {
    const parts = [...parentPath, label];
    const children = [...(node.children || []), ...(node._inbox || [])];
    const totals = new Map(), positions = new Map();
    for (const child of children) totals.set(child.title, (totals.get(child.title) || 0) + 1);
    for (const child of children) {
      const position = (positions.get(child.title) || 0) + 1; positions.set(child.title, position);
      visit(child, node.id, parts, totals.get(child.title) > 1 ? `${child.title}（第 ${position} 项）` : child.title || '未命名节点');
    }
    const global = node === document.root ? Object.fromEntries(Object.entries(document).filter(([key]) => !['root', 'unassigned_bugs'].includes(key))) : undefined;
    const source = canonical({ node: ownNode(node), records: nodeRecords(snapshot, node), related: [...related.get(node.id)].sort(), global });
    const structure = canonical([parent, node.title, node.kind, children.map(child => child.id), [...related.get(node.id)].sort()]);
    const prior = previous?.sources?.[node.id];
    const hash = prior?.source === source ? previous.nodes[node.id].hash : (stats.ownHashes++, contextHash(source));
    const structureHash = prior?.structure === structure ? previous.nodes[node.id].structureHash : contextHash(structure);
    const branch = canonical([hash, structureHash, writable.has(node.id), children.map(child => nodes[child.id].treeHash)]);
    const treeHash = prior?.branch === branch ? previous.nodes[node.id].treeHash : (stats.branchHashes++, contextHash(branch));
    nodes[node.id] = { key: node.id, name: node.title || '未命名节点', purpose: String(node.purpose || '').slice(0, 160), owns: node.owns || [],
      writable: writable.has(node.id), path: parts.join(' / '), parent,
      children: children.map(child => child.id), related: [...related.get(node.id)].sort(), hash, structureHash, treeHash };
    sources[node.id] = { source, structure, branch };
  };
  visit(document.root);
  return { version: snapshot.version, root: document.root.id, nodes, sources, stats };
}
export const publicContextTree = tree => ({ version: tree.version, root: tree.root, nodes: tree.nodes });
export function contextSlice(snapshot, key) {
  const document = snapshot.memory.map, index = entries(document.root);
  const node = index.get(key)?.node;
  if (!node) throw new MapError('NOT_FOUND', '找不到或无权读取该节点', 404);
  const related = [...(document.flows || []), ...(document.root.flows || [])]
    .filter(flow => flow.from === key || flow.to === key)
    .map(flow => ({ name: index.get(flow.from === key ? flow.to : flow.from)?.node.title, label: flow.label || '' }));
  return { node: ownNode(node), records: nodeRecords(snapshot, node), related,
    ...(key === document.root.id ? { global: Object.fromEntries(Object.entries(document).filter(([name]) => !['root', 'unassigned_bugs'].includes(name))) } : {}) };
}
export function resolveContextNode(tree, name) {
  const matches = Object.values(tree.nodes).filter(node => [node.key, node.name, node.path].includes(name));
  if (matches.length !== 1) throw new MapError(matches.length ? 'AMBIGUOUS_NODE' : 'NOT_FOUND', matches.length ? '节点重名，请使用完整模块路径' : '找不到或无权读取该节点', 404);
  return matches[0].key;
}
export function contextChanges(before, after, { mounted = [], read = [] } = {}) {
  const watched = new Set([before.root, after.root, ...read]);
  for (const tree of [before, after]) {
    const visited = new Set();
    const subtree = key => { if (visited.has(key)) return; visited.add(key); watched.add(key); for (const child of tree.nodes[key]?.children || []) subtree(child); };
    for (const key of mounted) subtree(key);
  }
  // 已声明关系可有循环；只扩展直接关联，避免沿整个项目关系网无限扩张。
  for (const key of [...watched]) for (const tree of [before, after]) for (const id of tree.nodes[key]?.related || []) watched.add(id);
  const changes = [];
  const names = new Map();
  for (const tree of [before, after]) for (const node of Object.values(tree.nodes)) {
    if (!names.has(node.name)) names.set(node.name, new Set());
    names.get(node.name).add(node.key);
  }
  const changed = new Set();
  const visitChanges = key => {
    if (changed.has(key) || before.nodes[key]?.treeHash === after.nodes[key]?.treeHash) return;
    changed.add(key);
    for (const child of new Set([...(before.nodes[key]?.children || []), ...(after.nodes[key]?.children || [])])) visitChanges(child);
  };
  visitChanges(before.root); visitChanges(after.root);
  for (const key of changed) {
    const a = before.nodes[key], b = after.nodes[key];
    let type;
    if (!a) type = '新增';
    else if (!b) type = '删除';
    else if (a.parent !== b.parent) type = '移动';
    else if (a.name !== b.name) type = '改名';
    else if (a.writable !== b.writable) type = '权限变化';
    else if (a.structureHash !== b.structureHash) type = '结构变化';
    else if (watched.has(key) && a.hash !== b.hash) type = '修改';
    if (type) changes.push({ key, name: (b || a).name, path: (b || a).path, type, ambiguous: names.get((b || a).name).size > 1 });
  }
  return changes;
}
export function contextChangeLines(changes, { offset = 0, limit = 20 } = {}) {
  if (!changes.length) return ['无变化'];
  const names = new Map();
  for (const item of changes) names.set(item.name, (names.get(item.name) || 0) + 1);
  const lines = changes.slice(offset, offset + limit).map(item => `${item.ambiguous || names.get(item.name) > 1 ? item.path : item.name} — ${item.type}`);
  if (offset + limit < changes.length) lines.push(`还有 ${changes.length - offset - limit} 项；使用 --offset ${offset + limit} 继续查看`);
  return lines;
}
