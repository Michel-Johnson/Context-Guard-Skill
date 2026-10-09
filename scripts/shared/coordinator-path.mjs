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
  return path.map((node, index) => {
    const purpose = node.purpose || '尚未填写描述';
    const description = purpose.length > 320 ? purpose.slice(0, 320) + '…（描述已截短）' : purpose;
    return `${index ? '  '.repeat(index - 1) + '└─ ' : ''}${node.title}：${description}`;
  }).join('\n');
}
