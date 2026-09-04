// Shared by the workbench and Node service. Unknown stored fields are retained.
export const editableFields = ['title', 'purpose', 'kind', 'state', 'memories', 'ideas', 'todos', 'bugs', 'dormant', 'files', 'owns', 'proposal', 'isNew'];
export class MapError extends Error {
  constructor(code, message, status = 400, details = {}) { super(message); Object.assign(this, { code, status, details }); }
}
export const copy = value => JSON.parse(JSON.stringify(value));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const proposalBases = new Set(['new-module', 'new-interface', 'new-component', 'new-responsibility']);
function proposalPath(value) {
  if (typeof value !== 'string') return '';
  let file = value.trim().replaceAll('\\', '/');
  while (file.startsWith('./')) file = file.slice(2);
  const parts = file.split('/').filter(Boolean);
  if (!file || file.length > 500 || file.startsWith('/') || file.startsWith('~') || /^[A-Za-z]:\//.test(file) || !parts.length || parts.some(part => part === '.' || part === '..')) return '';
  return parts.join('/') + (file.endsWith('/') ? '/' : '');
}
function supportOnlyPath(file) {
  const lower = file.toLowerCase(), parts = lower.split('/'), basename = parts.at(-1);
  if (['test', 'tests', '__tests__', 'docs', 'doc', 'references', '.github'].includes(parts[0])) return true;
  if (/^(readme|changelog|contributing|license|todo)(\.|$)/.test(basename) || basename === 'skill.md') return true;
  if (/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|package\.json)$/.test(basename)) return true;
  if (/(^|[._-])(test|tests|spec)([._-]|$)/.test(basename)) return true;
  return /(^|\/)([^/]*\.config\.[^/]+|[^/]*rc(?:\.[^/]+)?)$/.test(lower);
}
function validateAgentProposalNode(node, parentId) {
  const title = String(node?.title || '').trim(), purpose = String(node?.purpose || '').trim();
  const owns = Array.isArray(node?.owns) ? [...new Set(node.owns.map(proposalPath))] : [];
  const evidence = (Array.isArray(node?.memories) ? node.memories : []).map(memory => memory?.proposalEvidence).find(object);
  if (!title || title.length > 120 || !purpose || purpose.length > 500) throw new MapError('INVALID_PROPOSAL', 'Agent node proposals need a concise title and purpose');
  if (!owns.length || owns.some(path => !path)) throw new MapError('INVALID_PROPOSAL', 'Agent node proposals need valid repo-relative owns paths');
  if (!evidence) throw new MapError('INVALID_PROPOSAL', 'Agent node proposals need proposalEvidence');
  const reason = String(evidence.reason || '').trim(), basis = String(evidence.basis || '').trim();
  const files = Array.isArray(evidence.files) ? [...new Set(evidence.files.map(proposalPath))] : [];
  if (String(evidence.parentId || '').trim() !== parentId) throw new MapError('INVALID_PROPOSAL', 'Proposal evidence parentId must match the create parent');
  if (!reason || reason.length > 1000 || !proposalBases.has(basis)) throw new MapError('INVALID_PROPOSAL', 'Proposal evidence needs a valid basis and reason');
  if (!files.length || files.some(path => !path) || files.every(supportOnlyPath)) throw new MapError('INVALID_PROPOSAL', 'Proposal evidence needs at least one implementation file');
  if (files.some(file => !owns.some(owned => owned === file || file.startsWith(owned.endsWith('/') ? owned : `${owned}/`)))) throw new MapError('INVALID_PROPOSAL', 'Proposal evidence files must be covered by the proposed owns paths');
}
export function entries(root) {
  const found = new Map();
  function visit(node, parent = null, bucket = 'children', depth = 0) {
    if (depth > 128 || found.size >= 10000) throw new MapError('INVALID_MAP', 'Map exceeds depth/node limits');
    if (!object(node) || typeof node.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(node.id)) throw new MapError('INVALID_MAP', 'Invalid node ID');
    if (found.has(node.id)) throw new MapError('INVALID_MAP', `Duplicate node: ${node.id}`);
    found.set(node.id, { node, parent, bucket });
    for (const key of ['children', '_inbox']) {
      if (node[key] !== undefined && !Array.isArray(node[key])) throw new MapError('INVALID_MAP', `${node.id}.${key} must be an array`);
      for (const child of node[key] || []) visit(child, node, key, depth + 1);
    }
  }
  visit(root); return found;
}
export function validate(doc) {
  if (object(doc) && doc.root === null && doc.bootstrap === 'pending' && !(doc.flows || []).length) return new Map();
  if (!object(doc) || !object(doc.root)) throw new MapError('INVALID_MAP', 'Map requires a root node');
  const index = entries(doc.root);
  if (doc.unassigned_bugs !== undefined && !Array.isArray(doc.unassigned_bugs)) throw new MapError('INVALID_MAP', 'unassigned_bugs must be an array');
  if ((doc.unassigned_bugs || []).some(item => !object(item))) throw new MapError('INVALID_MAP', 'Unassigned bug must be an object');
  for (const { node } of index.values()) {
    if (typeof node.title !== 'string' || node.title.length > 10000) throw new MapError('INVALID_MAP', `${node.id}: invalid title`);
    if (node.purpose !== undefined && typeof node.purpose !== 'string') throw new MapError('INVALID_MAP', 'purpose must be text');
    for (const key of ['memories', 'ideas', 'todos', 'bugs', 'dormant', 'files', 'owns']) {
      if (node[key] !== undefined && !Array.isArray(node[key])) throw new MapError('INVALID_MAP', `${key} must be an array`);
    }
    if (node.kind && !['module', 'work'].includes(node.kind)) throw new MapError('INVALID_MAP', 'Invalid kind');
    if (node.state && !['dirty', 'untested', 'success', 'failed'].includes(node.state)) throw new MapError('INVALID_MAP', 'Invalid state');
    if (node.proposal && !['proposed', 'accepted', 'cancelled'].includes(node.proposal)) throw new MapError('INVALID_MAP', 'Invalid proposal');
    for (const item of [...(node.memories || []), ...(node.ideas || []), ...(node.todos || []), ...(node.bugs || [])]) {
      if (!object(item)) throw new MapError('INVALID_MAP', 'Memory/idea/todo/bug must be an object');
      const refs = Array.isArray(item.also) ? item.also : typeof item.also === 'string' ? item.also.split(/[,，]/).map(x => x.trim()).filter(Boolean) : [];
      if (refs.some(id => !index.has(id))) throw new MapError('INVALID_REFERENCE', `${node.id}: missing also reference`);
    }
    for (const todo of node.todos || []) {
      if (typeof todo.title !== 'string' || todo.title.length > 10000) throw new MapError('INVALID_MAP', `${node.id}: invalid TODO title`);
      if (todo.status && !['pending', 'processing', 'done'].includes(todo.status)) throw new MapError('INVALID_MAP', `${node.id}: invalid TODO status`);
    }
  }
  for (const flow of doc.flows || []) {
    if (!index.has(flow.from) || !index.has(flow.to)) throw new MapError('INVALID_REFERENCE', 'Flow endpoint is missing');
  }
  return index;
}

function relatedIds(node) {
  const out = new Set();
  const values = [node, ...(node.memories || []), ...(node.ideas || []), ...(node.todos || []), ...(node.bugs || [])];
  for (const value of values) {
    const refs = Array.isArray(value?.also)
      ? value.also
      : typeof value?.also === 'string'
        ? value.also.split(/[,，]/).map(id => id.trim()).filter(Boolean)
        : [];
    refs.forEach(id => out.add(id));
  }
  return out;
}

export function assignmentScope(doc, nodeId) {
  const index = validate(doc);
  if (!index.has(nodeId)) throw new MapError('NOT_FOUND', `Node ${nodeId} is missing`, 404);
  const related = new Set([nodeId]);
  for (const flow of doc.flows || []) {
    if (flow.from === nodeId) related.add(flow.to);
    if (flow.to === nodeId) related.add(flow.from);
  }
  for (const [id, { node }] of index) {
    const refs = relatedIds(node);
    if (id === nodeId) refs.forEach(ref => related.add(ref));
    if (refs.has(nodeId)) related.add(id);
  }
  const scope = new Set();
  for (const id of related) {
    let entry = index.get(id);
    while (entry) {
      if (!['cancelled', 'proposed'].includes(entry.node.proposal)) scope.add(entry.node.id);
      entry = entry.parent ? index.get(entry.parent.id) : null;
    }
  }
  return [...scope];
}

const assignedSessions = item => Array.isArray(item?.sessions)
  ? [...new Set(item.sessions.map(value => String(value || '').trim()).filter(Boolean))]
  : [];

export function workItemAssignedTo(item, sessionId) {
  return Boolean(sessionId) && (assignedSessions(item).includes(sessionId) || String(item?.target_session || '').trim() === sessionId);
}

function visibleWorkItem(item, sessionId) {
  const scoped = copy(item);
  scoped.sessions = [sessionId];
  if (Object.hasOwn(scoped, 'target_session')) scoped.target_session = sessionId;
  if (scoped.dispatch?.session_id && scoped.dispatch.session_id !== sessionId) delete scoped.dispatch;
  return scoped;
}

function scopedWorkItems(items, sessionId) {
  return (items || []).filter(item => workItemAssignedTo(item, sessionId)).map(item => visibleWorkItem(item, sessionId));
}

export function scopeDocumentToSession(document, sessionId) {
  const scoped = copy(document);
  if (!scoped?.root || !sessionId) return scoped;
  for (const { node } of entries(scoped.root).values()) {
    if (Array.isArray(node.bugs)) node.bugs = scopedWorkItems(node.bugs, sessionId);
    if (Array.isArray(node.todos)) node.todos = scopedWorkItems(node.todos, sessionId);
  }
  if (Array.isArray(scoped.unassigned_bugs)) scoped.unassigned_bugs = [];
  return scoped;
}

function restoreWorkItems(existing = [], incoming = [], sessionId) {
  const current = new Map(existing.map(item => [item?.id, item]));
  const next = [];
  const incomingIds = new Set(incoming.map(item => item?.id).filter(Boolean));
  for (const item of existing) {
    if (!workItemAssignedTo(item, sessionId)) next.push(copy(item));
    else if (!incomingIds.has(item?.id)) {
      const otherSessions = assignedSessions(item).filter(id => id !== sessionId);
      if (otherSessions.length) next.push({ ...copy(item), sessions: otherSessions });
    }
  }
  for (const item of incoming) {
    const before = current.get(item?.id);
    if (before && !workItemAssignedTo(before, sessionId)) throw new MapError('FORBIDDEN_WORK_ITEM', 'Session cannot replace a hidden work item', 403);
    const otherSessions = assignedSessions(before).filter(id => id !== sessionId);
    const keepsCurrent = !before || assignedSessions(item).includes(sessionId) || String(item?.target_session || '') === sessionId;
    const restored = { ...copy(item), sessions: [...otherSessions, ...(keepsCurrent ? [sessionId] : [])] };
    if (before && before.target_session && before.target_session !== sessionId && !keepsCurrent) restored.target_session = before.target_session;
    else if (keepsCurrent && Object.hasOwn(item, 'target_session')) restored.target_session = sessionId;
    if (before?.dispatch?.session_id && before.dispatch.session_id !== sessionId && !restored.dispatch) restored.dispatch = copy(before.dispatch);
    next.push(restored);
  }
  return next;
}

function assignedBug(document, bugId, sessionId) {
  if (!document?.root) return false;
  for (const { node } of entries(document.root).values()) {
    const bug = (node.bugs || []).find(item => item?.id === bugId);
    if (bug) return workItemAssignedTo(bug, sessionId);
  }
  return false;
}

export function restoreSessionWorkItemOperations(document, operations, sessionId) {
  if (!sessionId) return copy(operations);
  const index = document?.root ? entries(document.root) : new Map();
  return operations.map(operation => {
    const op = copy(operation);
    const node = index.get(op.id)?.node;
    if (op.type === 'update' && node) {
      if (Array.isArray(op.fields?.bugs)) op.fields.bugs = restoreWorkItems(node.bugs, op.fields.bugs, sessionId);
      if (Array.isArray(op.fields?.todos)) op.fields.todos = restoreWorkItems(node.todos, op.fields.todos, sessionId);
    }
    if (op.type === 'create') for (const key of ['bugs', 'todos']) if (Array.isArray(op.node?.[key])) {
      op.node[key] = op.node[key].map(item => ({ ...item, sessions: [sessionId], ...(Object.hasOwn(item, 'target_session') ? { target_session: sessionId } : {}) }));
    }
    if (op.type === 'attach-bug') op.bug = { ...op.bug, sessions: [sessionId] };
    if (op.type === 'update-bug' && !assignedBug(document, op.bug?.id, sessionId)) throw new MapError('FORBIDDEN_WORK_ITEM', 'Session can only update bugs assigned to it', 403);
    return op;
  });
}

export function scopeChangesToSession(result, document, sessionId) {
  const visibleBugIds = new Set();
  if (document?.root) for (const { node } of entries(document.root).values()) {
    for (const bug of node.bugs || []) if (workItemAssignedTo(bug, sessionId)) visibleBugIds.add(bug.id);
  }
  const changes = (result.changes || []).map(change => {
    const operations = (change.operations || []).flatMap(operation => {
      const op = copy(operation);
      if (op.type === 'attach-bug') return workItemAssignedTo(op.bug, sessionId) ? [{ ...op, bug: visibleWorkItem(op.bug, sessionId) }] : [];
      if (op.type === 'update-bug') return visibleBugIds.has(op.bug?.id) ? [op] : [];
      if (op.type === 'update') for (const key of ['bugs', 'todos']) if (Array.isArray(op.fields?.[key])) op.fields[key] = scopedWorkItems(op.fields[key], sessionId);
      if (op.type === 'create') for (const key of ['bugs', 'todos']) if (Array.isArray(op.node?.[key])) op.node[key] = scopedWorkItems(op.node[key], sessionId);
      return [op];
    });
    return { ...change, operations, fields: (change.fields || []).filter(field => field !== 'unassigned_bugs') };
  });
  return { ...result, changes };
}
function checkFields(fields, allowed = editableFields) {
  if (!object(fields) || Object.keys(fields).some(key => !allowed.includes(key))) throw new MapError('INVALID_FIELDS', 'Unsupported field');
}
export function applyOperations(document, operations, actor, grants = []) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 2000) throw new MapError('INVALID_OPERATIONS', 'Expected 1–2000 operations');
  const doc = copy(document), resultIds = [];
  const human = actor.kind === 'human';
  const allowed = node => human || grants.includes(node.id) || (node.proposal === 'proposed' && node.proposedBy === actor.sessionId);
  for (const op of operations) {
    if (op.type === 'initialize') {
      if (doc.root !== null || typeof op.project !== 'string' || !op.project.trim()) throw new MapError('INVALID_INITIALIZATION', 'Only an empty legacy pending map can be initialized');
      checkFields(op.node, ['id', ...editableFields, 'children', '_inbox']);
      if (!human && (op.node.children?.length || op.node._inbox?.length)) throw new MapError('FORBIDDEN', 'Only the workbench can initialize a complete map', 403);
      doc.project = op.project;
      doc.root = { id: 'T0', title: op.project, kind: 'module', state: 'dirty', children: [], ...copy(op.node), origin: actor.kind, proposal: human ? 'accepted' : 'proposed', proposedBy: actor.sessionId };
      doc.bootstrap = 'proposed'; resultIds.push(doc.root.id); continue;
    }
    if (!doc.root) throw new MapError('INITIALIZATION_REQUIRED', 'Initialize this legacy empty map before adding nodes');
    const index = entries(doc.root);
    const target = index.get(op.id);
    if (op.type === 'create') {
      const parent = index.get(op.parentId)?.node;
      if (!parent) throw new MapError('NOT_FOUND', 'Parent is missing', 404);
      checkFields(op.node, ['id', ...editableFields]);
      const id = op.node.id;
      if (!id || index.has(id)) throw new MapError('DUPLICATE_ID', 'Node ID already exists or is empty', 409);
      if (!human) {
        validateAgentProposalNode(op.node, op.parentId);
        const title = String(op.node.title).trim().toLocaleLowerCase();
        const owns = new Set(op.node.owns.map(proposalPath));
        for (const { node: existing } of index.values()) {
          if (existing.proposal === 'cancelled') continue;
          if (String(existing.title || '').trim().toLocaleLowerCase() === title) throw new MapError('DUPLICATE_PROPOSAL', 'A non-cancelled node already has this title', 409);
          if (existing.proposal === 'proposed' && (existing.owns || []).some(file => owns.has(proposalPath(file)))) throw new MapError('DUPLICATE_PROPOSAL', 'A pending proposal already covers this path', 409);
        }
      }
      const node = { title: '', kind: 'work', state: 'dirty', purpose: '', memories: [], ideas: [], todos: [], bugs: [], dormant: [], files: [], owns: [], children: [], ...copy(op.node), origin: actor.kind, proposedBy: actor.sessionId };
      if (!human) { node.proposal = 'proposed'; node.isNew = true; }
      else { node.proposal ||= 'accepted'; node.isNew = node.proposal === 'proposed'; }
      (parent.children ||= []).push(node); resultIds.push(id);
    } else if (op.type === 'document') {
      if (!human) throw new MapError('FORBIDDEN', 'Only the workbench can change document metadata', 403);
      checkFields(op.fields, ['bootstrap', 'flows']); Object.assign(doc, copy(op.fields));
    } else if (op.type === 'attach-bug') {
      // Compatibility operation only adds a bug stub; it cannot confirm or rewrite nodes.
      if (!object(op.bug) || !/^B[0-9]+$/.test(op.bug.id || '')) throw new MapError('INVALID_BUG', 'Invalid bug');
      const list = target ? (target.node.bugs ||= []) : (doc.unassigned_bugs ||= []);
      const existing = list.find(x => x.id === op.bug.id);
      if (existing && !same(existing, op.bug)) throw new MapError('DUPLICATE_ID', 'Bug ID already exists', 409);
      if (!existing) list.push(copy(op.bug));
      resultIds.push(op.id || doc.root.id);
    } else if (op.type === 'update-bug') {
      if (!object(op.bug) || !/^B[0-9]+$/.test(op.bug.id || '') || !['open', 'fixed', 'resolved', 'deferred', 'wontfix'].includes(op.bug.status)) throw new MapError('INVALID_BUG', 'Invalid bug status update');
      let found = null, owner = doc.root.id;
      for (const [id, entry] of index) {
        found = (entry.node.bugs || []).find(item => item.id === op.bug.id);
        if (found) { owner = id; break; }
      }
      if (!found) found = (doc.unassigned_bugs || []).find(item => item.id === op.bug.id);
      if (!found) throw new MapError('NOT_FOUND', `Bug ${op.bug.id} is missing`, 404);
      found.status = op.bug.status; resultIds.push(owner);
    } else {
      if (!target) throw new MapError('NOT_FOUND', `Node ${op.id} is missing`, 404);
      if (!allowed(target.node)) throw new MapError('FORBIDDEN', `Session is not authorized for ${op.id}`, 403);
      if (op.type === 'update') {
        checkFields(op.fields);
        if (!human && ['proposal', 'isNew'].some(key => Object.hasOwn(op.fields, key))) throw new MapError('FORBIDDEN', 'Agent cannot confirm or cancel a proposal', 403);
        Object.assign(target.node, copy(op.fields));
      } else if (op.type === 'move') {
        const parent = index.get(op.parentId)?.node;
        if (!target.parent || !parent || entries(target.node).has(parent.id)) throw new MapError('INVALID_MOVE', 'Missing parent, root move or tree cycle');
        if (!allowed(parent)) throw new MapError('FORBIDDEN', 'Destination is not authorized', 403);
        target.parent[target.bucket] = target.parent[target.bucket].filter(x => x.id !== op.id);
        (parent.children ||= []).push(target.node);
      } else if (op.type === 'delete') {
        if (!human || !target.parent) throw new MapError('FORBIDDEN', 'Only human can permanently remove a non-root node', 403);
        target.parent[target.bucket] = target.parent[target.bucket].filter(x => x.id !== op.id);
      } else throw new MapError('INVALID_OPERATION', 'Unknown operation type');
      resultIds.push(op.id);
    }
  }
  const layer = [...(doc.root.children || []), ...(doc.root._inbox || [])].filter(n => n.proposal !== 'cancelled');
  if (layer.length) doc.bootstrap = layer.every(n => n.proposal !== 'proposed') ? 'ready' : 'proposed';
  validate(doc); return { doc, resultIds: [...new Set(resultIds)] };
}
// Ignore canvas-only inbox expansion and absent empty arrays. Compare only fields
// the editor owns, so merely drawing a legacy map never rewrites its metadata.
export function diffTrees(before, after) {
  const a = entries(before), b = entries(after), ops = [];
  for (const [id, { node, parent }] of b) {
    const old = a.get(id);
    if (!old) {
      const fields = Object.fromEntries(['id', ...editableFields].filter(k => node[k] !== undefined).map(k => [k, copy(node[k])]));
      ops.push({ type: 'create', parentId: parent?.id, node: fields }); continue;
    }
    if (old.parent?.id !== parent?.id) ops.push({ type: 'move', id, parentId: parent?.id });
    const fields = {};
    for (const key of editableFields) {
      if (node[key] === undefined) continue;
      if (old.node[key] === undefined && (Array.isArray(node[key]) && !node[key].length || node[key] === '')) continue;
      if (!same(old.node[key], node[key])) fields[key] = copy(node[key]);
    }
    if (Object.keys(fields).length) ops.push({ type: 'update', id, fields });
  }
  for (const [id, { parent }] of a) if (!b.has(id) && parent && b.has(parent.id)) ops.push({ type: 'delete', id });
  return ops;
}
