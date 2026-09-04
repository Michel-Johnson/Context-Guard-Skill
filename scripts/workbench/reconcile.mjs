import { createHash } from 'node:crypto';
import { entries } from '../../prototype/map-model.mjs';

const PROPOSAL_BASES = new Set(['new-module', 'new-interface', 'new-component', 'new-responsibility']);
const PROPOSAL_FIELDS = new Set(['parentId', 'title', 'purpose', 'reason', 'basis', 'files', 'kind']);
const INPUT_FIELDS = new Set(['summary', 'decisions', 'next', 'files', 'assignments', 'proposal', 'nodeIds', 'planId', 'verification', 'assessment']);

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
    // Proposed nodes do not own product scope until a human accepts them.
    if (node.proposal === 'cancelled' || node.proposal === 'proposed') continue;
    for (const owned of node.owns || []) {
      const score = ownScore(owned, file);
      if (!score) continue;
      const rank = node.kind === 'work' ? 0 : 1;
      if (!best || score > best.score || (score === best.score && rank < best.rank)) best = { id, node, score, rank };
    }
  }
  return best;
}

function normalizedAssignments(input, files, index, directlyMapped) {
  const raw = input.assignments ?? [];
  if (!Array.isArray(raw) || raw.length > 100) throw new Error('Archive assignments must be an array with at most 100 items');
  const knownFiles = new Set(files), assigned = new Map(), normalized = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Each archive assignment must be an object');
    const nodeId = String(item.nodeId || '').trim();
    const reason = String(item.reason || '').trim();
    const assignedFiles = [...new Set((Array.isArray(item.files) ? item.files : []).map(normalizeRepoPath))].sort();
    const entry = index.get(nodeId);
    if (!entry || ['proposed', 'cancelled'].includes(entry.node.proposal)) throw new Error(`Archive assignment needs an accepted Map node: ${nodeId || '(empty)'}`);
    if (!reason || reason.length > 500) throw new Error(`Archive assignment ${nodeId} needs a concise reason`);
    if (!assignedFiles.length) throw new Error(`Archive assignment ${nodeId} needs files`);
    for (const file of assignedFiles) {
      if (!knownFiles.has(file)) throw new Error(`Archive assignment file was not changed by this session: ${file}`);
      if (directlyMapped.has(file)) throw new Error(`Archive assignment is unnecessary because owns already covers: ${file}`);
      if (assigned.has(file)) throw new Error(`Archive file is assigned more than once: ${file}`);
      assigned.set(file, nodeId);
    }
    normalized.push({ nodeId, reason, files: assignedFiles });
  }
  return { normalized, assigned };
}

function isSupportOnlyPath(file) {
  const lower = file.toLowerCase(), parts = lower.split('/');
  const basename = parts.at(-1);
  if (['test', 'tests', '__tests__', 'docs', 'doc', 'references', '.github'].includes(parts[0])) return true;
  if (/^(readme|changelog|contributing|license|todo)(\.|$)/.test(basename) || basename === 'skill.md') return true;
  if (/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|package\.json)$/.test(basename)) return true;
  if (/(^|[._-])(test|tests|spec)([._-]|$)/.test(basename)) return true;
  return /(^|\/)([^/]*\.config\.[^/]+|[^/]*rc(?:\.[^/]+)?)$/.test(lower);
}

function normalizedProposal(input, files, unclassified, index) {
  if (input.proposal === undefined || input.proposal === null) return null;
  const raw = input.proposal;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Archive proposal must be an object');
  const unknown = Object.keys(raw).filter(key => !PROPOSAL_FIELDS.has(key));
  if (unknown.length) throw new Error(`Archive proposal has unsupported fields: ${unknown.join(', ')}`);
  const parentId = String(raw.parentId || '').trim();
  const title = String(raw.title || '').trim();
  const purpose = String(raw.purpose || '').trim();
  const reason = String(raw.reason || '').trim();
  const basis = String(raw.basis || '').trim();
  const kind = String(raw.kind || 'work').trim();
  const proposedFiles = [...new Set((Array.isArray(raw.files) ? raw.files : []).map(normalizeRepoPath))].sort();
  const parent = index.get(parentId)?.node;
  if (!parent || ['proposed', 'cancelled'].includes(parent.proposal)) throw new Error(`Archive proposal needs an accepted parent node: ${parentId || '(empty)'}`);
  if (!title || title.length > 120) throw new Error('Archive proposal needs a title of at most 120 characters');
  if (!purpose || purpose.length > 500) throw new Error('Archive proposal needs a purpose of at most 500 characters');
  if (!reason || reason.length > 1000) throw new Error('Archive proposal needs a reason of at most 1000 characters');
  if (!PROPOSAL_BASES.has(basis)) throw new Error(`Archive proposal basis must be one of: ${[...PROPOSAL_BASES].join(', ')}`);
  if (!['module', 'work'].includes(kind)) throw new Error('Archive proposal kind must be module or work');
  if (!proposedFiles.length) throw new Error('Archive proposal needs files');
  const knownFiles = new Set(files), available = new Set(unclassified);
  for (const file of proposedFiles) {
    if (!knownFiles.has(file)) throw new Error(`Archive proposal file was not changed by this session: ${file}`);
    if (!available.has(file)) throw new Error(`Archive proposal file already belongs to an existing node: ${file}`);
  }
  if (proposedFiles.every(isSupportOnlyPath)) throw new Error('Tests, docs, and configuration cannot be the sole evidence for a new Map node');
  const normalizedTitle = title.toLocaleLowerCase();
  for (const { node } of index.values()) {
    if (node.proposal === 'cancelled' || String(node.title || '').trim().toLocaleLowerCase() !== normalizedTitle) continue;
    if (node.proposal !== 'proposed') throw new Error(`Archive proposal duplicates an accepted node title: ${title}`);
  }
  return { parentId, title, purpose, reason, basis, files: proposedFiles, kind };
}

function archiveKey(sessionId, files, input, governance) {
  return createHash('sha256').update(JSON.stringify([
    sessionId,
    files,
    String(input.summary || '').trim(),
    String(input.decisions || '').trim(),
    String(input.next || '').trim(),
    governance,
    input.planId || null, input.verification || null, input.assessment || null,
  ])).digest('hex');
}

function archiveMemory(input, sessionId, key, files, extra = {}) {
  return {
    text: String(input.summary || input.decisions || input.next || 'Agent 完成了一次代码变更。').trim(),
    state: 'success',
    session: sessionId,
    record: `.codex/context/sessions/${String(sessionId).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 120) || 'session'}.md`,
    paths: files,
    archiveKey: key,
    recorded_at: new Date().toISOString(),
    ...(input.planId ? { plan_id: input.planId, verification: input.verification, assessment: input.assessment } : {}),
    ...extra,
  };
}

function findDuplicateProposal(index, proposal) {
  const title = proposal.title.toLocaleLowerCase(), files = new Set(proposal.files);
  for (const [id, { node }] of index) {
    if (node.proposal !== 'proposed') continue;
    const sameTitle = String(node.title || '').trim().toLocaleLowerCase() === title;
    const overlaps = (node.owns || []).some(file => files.has(normalizeRepoPath(file)));
    if (sameTitle || overlaps) return { id, node };
  }
  return null;
}

export function buildArchiveReconciliation(doc, sessionId, input = {}) {
  if (!doc?.root) throw new Error('Map has no root node');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Archive input must be an object');
  const unknown = Object.keys(input).filter(key => !INPUT_FIELDS.has(key));
  if (unknown.length) throw new Error(`Archive input has unsupported fields: ${unknown.join(', ')}`);
  const files = [...new Set((Array.isArray(input.files) ? input.files : []).map(normalizeRepoPath))].sort();
  if (!files.length && !(input.nodeIds || []).length) {
    if (input.proposal || (input.assignments || []).length) throw new Error('Archive governance input needs changed files');
    return { key: null, files: [], mapped: {}, assignments: [], unclassified: [], uncovered: [], proposedId: null, operations: [], operationId: null };
  }

  const index = entries(doc.root), mapped = new Map(), directlyMapped = new Set();
  if (!Array.isArray(input.nodeIds || [])) throw new Error('nodeIds must be an array');
  for (const id of input.nodeIds || []) {
    const node = index.get(id)?.node;
    if (!node || ['proposed', 'cancelled'].includes(node.proposal)) throw new Error('Plan archive needs an accepted node');
    mapped.set(id, []);
  }
  for (const file of files) {
    const owner = ownerForPath(doc, file);
    if (!owner) continue;
    directlyMapped.add(file);
    mapped.set(owner.id, [...(mapped.get(owner.id) || []), file]);
  }
  const assignments = normalizedAssignments(input, files, index, directlyMapped);
  for (const [file, nodeId] of assignments.assigned) mapped.set(nodeId, [...(mapped.get(nodeId) || []), file].sort());
  let unclassified = files.filter(file => !directlyMapped.has(file) && !assignments.assigned.has(file));
  const proposal = normalizedProposal(input, files, unclassified, index);
  const governance = { assignments: assignments.normalized, proposal };
  const key = archiveKey(sessionId, files, input, governance), operations = [];

  for (const [id, ownedFiles] of mapped) {
    const node = index.get(id).node;
    if ((node.memories || []).some(memory => memory?.archiveKey === key)) continue;
    const assignmentEvidence = assignments.normalized.filter(item => item.nodeId === id);
    operations.push({
      type: 'update',
      id,
      fields: { memories: [...(node.memories || []), archiveMemory(input, sessionId, key, ownedFiles, assignmentEvidence.length ? { assignmentEvidence } : {})] },
    });
  }

  let proposedId = null, proposalDuplicate = false;
  if (proposal) {
    const duplicate = findDuplicateProposal(index, proposal);
    const evidence = { basis: proposal.basis, reason: proposal.reason, parentId: proposal.parentId, files: proposal.files };
    if (duplicate) {
      proposedId = duplicate.id;
      proposalDuplicate = true;
      if (duplicate.node.proposedBy === sessionId && !(duplicate.node.memories || []).some(memory => memory?.archiveKey === key)) {
        operations.push({
          type: 'update',
          id: duplicate.id,
          fields: {
            owns: [...new Set([...(duplicate.node.owns || []).map(normalizeRepoPath), ...proposal.files])].sort(),
            memories: [...(duplicate.node.memories || []), archiveMemory(input, sessionId, key, proposal.files, { proposalEvidence: evidence })],
          },
        });
      }
    } else {
      const proposalKey = createHash('sha256').update(JSON.stringify(proposal)).digest('hex');
      proposedId = `P${proposalKey.slice(0, 16)}`;
      if (index.has(proposedId)) throw new Error(`Map node ID collision: ${proposedId}`);
      operations.push({
        type: 'create',
        parentId: proposal.parentId,
        node: {
          id: proposedId,
          title: proposal.title,
          purpose: proposal.purpose,
          kind: proposal.kind,
          state: 'untested',
          owns: proposal.files,
          memories: [archiveMemory(input, sessionId, key, proposal.files, { proposalEvidence: evidence })],
        },
      });
    }
    const proposed = new Set(proposal.files);
    unclassified = unclassified.filter(file => !proposed.has(file));
  }

  if (input.planId && unclassified.length) throw new Error(`Plan archive has unclassified files: ${unclassified.join(', ')}`);
  return {
    key,
    files,
    mapped: Object.fromEntries(mapped),
    assignments: assignments.normalized,
    unclassified,
    // Kept as a compatibility alias for older clients. It no longer triggers node creation.
    uncovered: unclassified,
    proposedId,
    proposalDuplicate,
    operations,
    operationId: `archive:${key}`,
  };
}
