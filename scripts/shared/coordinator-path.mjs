import { entries, MapError } from './map-model.mjs';

// 路径、描述和记忆均取自同一份 Main，不能由模型拼接节点关系。
export function coordinatorNodePath(root, nodeId, { nodeIds = null, maxMemoryChars = 96000 } = {}) {
  const index = entries(root), target = index.get(nodeId);
  if (!target) throw new MapError('NOT_FOUND', '讨论节点已不存在', 404);
  if (Array.isArray(nodeIds) && !nodeIds.includes(nodeId)) throw new MapError('FORBIDDEN', '无权绑定此节点', 403);
  if (!Number.isSafeInteger(maxMemoryChars) || maxMemoryChars < 0) throw new MapError('INVALID_ARGUMENT', '记忆容量必须为非负整数');
  const chain = [];
  for (let current = target; current; current = current.parent ? index.get(current.parent.id) : null) chain.unshift(current.node);
  let remaining = maxMemoryChars;
  return chain.map(node => {
    const body = typeof node.memoryDocument === 'string' ? node.memoryDocument.trim() : '';
    const permitted = node.id === root.id || !Array.isArray(nodeIds) || nodeIds.includes(node.id);
    const memoryStatus = !permitted ? 'forbidden' : !body ? 'missing' : body.length > remaining ? 'capacity' : 'loaded';
    if (memoryStatus === 'loaded') remaining -= body.length;
    return { id: node.id, title: node.title || '未命名节点', purpose: node.purpose || '',
      memoryStatus, ...(memoryStatus === 'loaded' ? { memoryDocument: body } : {}) };
  });
}

export function coordinatorPathText(path) {
  return path.map(node => coordinatorNodeLabel(node)).join(' → ');
}

export function coordinatorNodeLabel(node) {
  const title = String(node.title || '').trim();
  return title === node.id && !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/u.test(title) || /^(?:TD[-_]|NCM)[A-Za-z0-9_-]{8,}$/u.test(title)
    ? String(node.purpose || '').trim().split(/[。\n]/u)[0] || '未命名节点'
    : title || '未命名节点';
}
