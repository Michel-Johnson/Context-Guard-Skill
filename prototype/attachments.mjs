// Attachment jobs are bound to a project and stable owner, never to an array index.
export function canUploadAttachment(config) {
  return config?.root !== 'cloud:overview' && config?.interfaceCapabilities?.attachments !== false;
}

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
  if (!canUploadAttachment(config)) throw new Error('当前页面不支持上传附件，请进入已配置云盘的项目');
  const cloud = String(config.root || '').startsWith('cloud:');
  if (!job.blob.size) throw new Error('附件不能为空');
  if (job.cancelled) throw new DOMException('Cancelled', 'AbortError');
  if (job.isValid?.() === false) throw new Error('原附件目标已改变，文件尚未提交');
  const timer = setTimeout(() => job.controller.abort(), cloud ? 10 * 60 * 1000 : 15000);
  try {
    const endpoint = cloud ? `${config.apiBase}/api/attachments?view=${encodeURIComponent(job.viewId || 'main')}` : '/api/attachments';
    if (cloud) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
          'Content-Type': 'application/octet-stream',
          'X-Context-Guard-Upload-Id': job.id,
          'X-Context-Guard-Node-Id': job.target.nodeId,
          'X-Context-Guard-Owner-Kind': job.target.kind,
          'X-Context-Guard-Owner-Id': job.target.ownerId,
          'X-Context-Guard-File-Name': encodeURIComponent(job.name),
        },
        credentials: 'same-origin', body: job.blob, signal: job.controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || '附件保存失败');
      return { ...result.file, serverManaged: true };
    }
    if (job.blob.size > 8 * 1024 * 1024) throw new Error('附件最大为 8 MiB');
    const bytes = new Uint8Array(await job.blob.arrayBuffer());
    if (job.cancelled) throw new DOMException('Cancelled', 'AbortError');
    if (job.isValid?.() === false) throw new Error('原附件目标已改变，文件尚未提交');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}), 'Content-Type': 'application/json' },
      credentials: 'same-origin',
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
