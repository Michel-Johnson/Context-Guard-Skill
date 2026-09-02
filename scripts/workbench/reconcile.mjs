import { createHash } from 'node:crypto';
import { entries } from '../../prototype/map-model.mjs';

function normalizeRepoPath(value) {
  let file = String(value || '').trim().replaceAll('\\', '/');
  while (file.startsWith('./')) file = file.slice(2);
  if (!file || file.startsWith('/') || file.startsWith('~') || /^[A-Za-z]:\//.test(file)) throw new Error(`Archive file must be repo-relative: ${value}`);
  const parts = file.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '.' || part === '..')) throw new Error(`Archive file escapes the project: ${value}`);
  file = parts.join('/');
  if (String(value || '').trim().replaceAll('\\', '/').endsWith('/')) file += '/';
  if (file.length > 500) throw new Error(`Archive file path is too long: ${value}`);
  return file;
}

function ownScore(owned, file) {
  const target = normalizeRepoPath(owned), candidate = normalizeRepoPath(file);
  if (target === candidate) return 10000 + target.length;
  const directory = target.endsWith('/') ? target : `${target}/`;
  return candidate.startsWith(directory) ? 1000 + directory.length : 0;
}

export function ownerForPath(doc, file) {
  const index = entries(doc.root);
  let best = null;
  for (const [id, { node }] of index) {
    if (node.proposal === 'cancelled') continue;
    for (const owned of node.owns || []) {
      const score = ownScore(owned, file);
      if (!score) continue;
      const rank = node.kind === 'work' ? 0 : 1;
      if (!best || score > best.score || (score === best.score && rank < best.rank)) best = { id, node, score, rank };
    }
  }
  return best;
}

function archiveKey(sessionId, files, input) {
  return createHash('sha256').update(JSON.stringify([
    sessionId,
    files,
    String(input.summary || '').trim(),
    String(input.decisions || '').trim(),
    String(input.next || '').trim(),
  ])).digest('hex');
}

function archiveTitle(input, uncovered) {
  const source = [input.summary, input.decisions, input.next].find(value => String(value || '').trim());
  const first = String(source || '').trim().split(/\r?\n/)[0].split(/[。！？.!?]/)[0].trim();
  if (first) return first.slice(0, 120);
  const file = uncovered[0] || '变更';
  return `未映射开发：${file.split('/').at(-1)}`.slice(0, 120);
}

function archiveMemory(input, sessionId, key, files) {
  return {
    text: String(input.summary || input.decisions || input.next || 'Agent 完成了一次代码变更。').trim(),
    state: 'success',
    session: sessionId,
    record: `.codex/context/sessions/${String(sessionId).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 120) || 'session'}.md`,
    paths: files,
    archiveKey: key,
  };
}

export function buildArchiveReconciliation(doc, sessionId, input = {}) {
  if (!doc?.root) throw new Error('Map has no root node');
  const files = [...new Set((Array.isArray(input.files) ? input.files : []).map(normalizeRepoPath))].sort();
  if (!files.length) return { key: null, files: [], mapped: {}, uncovered: [], operations: [], operationId: null };
  const key = archiveKey(sessionId, files, input), mapped = new Map(), uncovered = [];
  for (const file of files) {
    const owner = ownerForPath(doc, file);
    if (!owner) uncovered.push(file);
    else mapped.set(owner.id, [...(mapped.get(owner.id) || []), file]);
  }

  const index = entries(doc.root), operations = [];
  for (const [id, ownedFiles] of mapped) {
    const node = index.get(id).node;
    if ((node.memories || []).some(memory => memory?.archiveKey === key)) continue;
    operations.push({
      type: 'update',
      id,
      fields: { memories: [...(node.memories || []), archiveMemory(input, sessionId, key, ownedFiles)] },
    });
  }

  let proposedId = null;
  if (uncovered.length) {
    proposedId = `P${key.slice(0, 16)}`;
    const existing = index.get(proposedId)?.node;
    if (existing) {
      if (!(existing.memories || []).some(memory => memory?.archiveKey === key)) throw new Error(`Map node ID collision: ${proposedId}`);
    } else {
      const title = archiveTitle(input, uncovered);
      operations.push({
        type: 'create',
        parentId: doc.root.id,
        node: {
          id: proposedId,
          title,
          purpose: String(input.summary || title).trim(),
          kind: 'work',
          state: 'untested',
          owns: uncovered,
          memories: [archiveMemory(input, sessionId, key, uncovered)],
        },
      });
    }
  }

  return {
    key,
    files,
    mapped: Object.fromEntries(mapped),
    uncovered,
    proposedId,
    operations,
    operationId: `archive:${key}`,
  };
}
