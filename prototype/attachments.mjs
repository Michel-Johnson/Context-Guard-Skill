// Attachment jobs are bound to a project and stable owner, never to an array index.
export function attachmentTarget(node, kind, key, root) {
  const owner = kind === 'node' ? node : kind === 'bug' ? node.bugs?.find(b => b.id === key) : node[{ mem: 'memories', idea: 'ideas', dorm: 'dormant' }[kind]]?.[Number(key)];
  if (!owner) throw new Error('附件目标已不存在');
  if (kind !== 'node' && kind !== 'bug') owner._attachmentId ||= crypto.randomUUID();
  return { root, nodeId: node.id, kind, ownerId: kind === 'node' ? node.id : kind === 'bug' ? owner.id : owner._attachmentId };
}

export function attachmentOwner(tree, target) {
  let node;
  function visit(entry) {
    if (!entry || node) return;
    if (entry.id === target.nodeId) { node = entry; return; }
    [...(entry.children || []), ...(entry._inbox || [])].forEach(visit);
  }
  visit(tree);
  if (!node) return null;
  if (target.kind === 'node') return node;
  const matches = target.kind === 'bug'
    ? (node.bugs || []).filter(b => b.id === target.ownerId)
    : (node[{ mem: 'memories', idea: 'ideas', dorm: 'dormant' }[target.kind]] || []).filter(item => item._attachmentId === target.ownerId);
  return matches.length === 1 ? matches[0] : null;
}

export async function uploadAttachment(config, job) {
  if (job.blob.size > 8 * 1024 * 1024) throw new Error('附件最大为 8 MiB');
  const bytes = new Uint8Array(await job.blob.arrayBuffer());
  if (job.cancelled) throw new DOMException('Cancelled', 'AbortError');
  if (job.isValid?.() === false) throw new Error('原附件目标已改变，文件尚未提交');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  const timer = setTimeout(() => job.controller.abort(), 15000);
  try {
    const response = await fetch('/api/attachments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: job.id, nodeId: job.target.nodeId, name: job.name, base64: btoa(binary) }),
      signal: job.controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || '附件保存失败');
    return result;
  } finally {
    clearTimeout(timer);
  }
}
