// Shared by the workbench and Node service. Unknown stored fields are retained.
export const editableFields = ['title', 'purpose', 'kind', 'state', 'memories', 'ideas', 'bugs', 'dormant', 'files', 'owns', 'proposal', 'isNew'];
export class MapError extends Error {
  constructor(code, message, status = 400, details = {}) { super(message); Object.assign(this, { code, status, details }); }
}
export const copy = value => JSON.parse(JSON.stringify(value));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = x => x && typeof x === 'object' && !Array.isArray(x);
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
  for (const { node } of index.values()) {
    if (typeof node.title !== 'string' || node.title.length > 10000) throw new MapError('INVALID_MAP', `${node.id}: invalid title`);
    if (node.purpose !== undefined && typeof node.purpose !== 'string') throw new MapError('INVALID_MAP', 'purpose must be text');
    for (const key of ['memories', 'ideas', 'bugs', 'dormant', 'files', 'owns']) {
      if (node[key] !== undefined && !Array.isArray(node[key])) throw new MapError('INVALID_MAP', `${key} must be an array`);
    }
    if (node.kind && !['module', 'work'].includes(node.kind)) throw new MapError('INVALID_MAP', 'Invalid kind');
    if (node.state && !['dirty', 'untested', 'success', 'failed'].includes(node.state)) throw new MapError('INVALID_MAP', 'Invalid state');
    if (node.proposal && !['proposed', 'accepted', 'cancelled'].includes(node.proposal)) throw new MapError('INVALID_MAP', 'Invalid proposal');
    for (const item of [...(node.memories || []), ...(node.ideas || []), ...(node.bugs || [])]) {
      if (!object(item)) throw new MapError('INVALID_MAP', 'Memory/idea/bug must be an object');
      const refs = Array.isArray(item.also) ? item.also : typeof item.also === 'string' ? item.also.split(/[,，]/).map(x => x.trim()).filter(Boolean) : [];
      if (refs.some(id => !index.has(id))) throw new MapError('INVALID_REFERENCE', `${node.id}: missing also reference`);
    }
  }
  for (const flow of doc.flows || []) {
    if (!index.has(flow.from) || !index.has(flow.to)) throw new MapError('INVALID_REFERENCE', 'Flow endpoint is missing');
  }
  return index;
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
      checkFields(op.node, ['id', ...editableFields]);
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
      const node = { title: '', kind: 'work', state: 'dirty', purpose: '', memories: [], ideas: [], bugs: [], dormant: [], files: [], owns: [], children: [], ...copy(op.node), origin: actor.kind, proposedBy: actor.sessionId };
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
