import path from 'node:path';
import { atomicWrite, encode, hash, readJSON, withFileLock } from './io.mjs';
import { canonical, fail, ProtocolError } from './protocol.mjs';
import { entries, scopeDocumentToSession, applyOperations } from '../../prototype/map-model.mjs';

const collections = { todo: 'todos', bug: 'bugs', memory: 'memories', idea: 'ideas', message: 'messages', access: 'access' };
// Retry receipts must retain both the old and new endpoints of a relation.
export function operationGrants(document, operations, grants) {
  const required = new Set(), flows = structuredClone(document.flows || []);
  for (const op of operations) {
    const position = op.legacyIndex ?? flows.findIndex(flow => flow.id === op.id);
    const previous = op.type === 'relation' ? flows[position] : null;
    for (const id of [op.id, op.parentId, previous?.from, previous?.to, op.fields?.from, op.fields?.to]) {
      if (grants.includes(id)) required.add(id);
    }
    if (op.type === 'relation') {
      if (op.action === 'delete') flows.splice(position, 1);
      else if (op.action === 'create') flows.push({ ...op.fields, id: op.id });
      else flows[position] = { ...previous, ...op.fields, id: op.id };
    }
  }
  return [...required];
}
export async function verifyChangeReferences(changes, { object, blob }) {
  for (const change of changes) for (const reference of change.fields?.refs || []) {
    if (reference.ref.startsWith('blob:')) {
      const metadata = await blob(reference.ref.slice(5));
      if (metadata.sha256 !== reference.version) fail('CONFLICT', 'Attachment digest differs from its reference');
    } else {
      const saved = await object(reference.ref, reference.version);
      if (saved.version !== reference.version) fail('CONFLICT', 'Object reference version differs');
    }
  }
}
// Legacy records have no IDs. A version-scoped reference cannot retarget after a
// deletion; the first v2 edit persists that reference as its permanent ID.
export function nodeProjection(node, version) {
  const projected = structuredClone(node);
  delete projected.children; delete projected._inbox;
  for (const [kind, field] of Object.entries(collections)) if (Array.isArray(projected[field])) {
    projected[field] = projected[field].map((item, index) => ({ ...item, id: item.id || `legacy-${hash(canonical([version, node.id, kind, index]))}` }));
  }
  return projected;
}

export function relationProjection(flows = [], version) {
  return flows.map((flow, index) => ({ ...flow, id: flow.id || `legacy-${hash(canonical([version, 'relation', index]))}` }));
}

export function translateChanges(document, changes, actor, grants, version) {
  let doc = scopeDocumentToSession(document, actor.sessionId); const operations = [];
  const flowIds = relationProjection(doc.flows, version).map(flow => flow.id);
  for (const { node } of entries(doc.root).values()) {
    const projected = nodeProjection(node, version);
    for (const field of Object.values(collections)) if (projected[field]) node[field] = projected[field];
  }
  const add = operation => { doc = applyOperations(doc, [operation], actor, grants).doc; operations.push(operation); };
  for (const change of changes) {
    const index = entries(doc.root), f = change.fields || {};
    if (change.kind === 'relation') {
      const legacyIndex = flowIds.indexOf(change.id);
      add({ type: 'relation', action: change.op, id: change.id,
        ...(legacyIndex >= 0 && !doc.flows[legacyIndex].id ? { legacyIndex } : {}),
        ...(change.fields ? { fields: change.fields } : {}) });
      if (change.op === 'delete') flowIds.splice(legacyIndex, 1);
      else if (change.op === 'create') flowIds.push(change.id);
      continue;
    }
    if (change.kind === 'access' && actor.kind !== 'human') fail('FORBIDDEN', 'Only a human can change access');
    if (change.kind === 'node') {
      const { parentId, order, proposalEvidence, ...fields } = f;
      if (proposalEvidence) {
        if (change.op !== 'create') fail('INVALID_ARGUMENT', 'Proposal evidence belongs to node creation');
        fields.memories = [{ text: proposalEvidence.reason, proposalEvidence }];
      }
      if (change.op === 'create') add({ type: 'create', parentId, ...(order !== undefined ? { order } : {}), node: { ...fields, id: change.id } });
      else if (change.op === 'delete') {
        const node = index.get(change.id)?.node;
        if (node?.children?.length || node?._inbox?.length || (doc.flows || []).some(flow => flow.from === change.id || flow.to === change.id)) fail('CONFLICT', 'Remove children and relations explicitly before deleting a node');
        add({ type: 'delete', id: change.id });
      }
      else {
        if (parentId || order !== undefined) add({ type: 'move', id: change.id, parentId: parentId || index.get(change.id)?.parent?.id, ...(order !== undefined ? { order } : {}) });
        if (Object.keys(fields).length) add({ type: 'update', id: change.id, fields });
      }
      continue;
    }
    const field = collections[change.kind];
    if (!field) fail('INVALID_ARGUMENT', 'This Map record kind is not implemented yet');
    const matches = [...index.values()].flatMap(({ node }) => (node[field] || [])
      .flatMap((item, position) => item.id === change.id ? [{ node, item, position }] : []));
    if (matches.length > 1) fail('CONFLICT', 'Record ID has multiple owners');
    const existing = matches[0];
    if (change.op === 'create' && existing) fail('CONFLICT', 'Record already exists');
    if (change.op !== 'create' && !existing) fail('NOT_FOUND', 'Record is missing from this snapshot');
    const nodeId = f.nodeId || existing?.node.id || (change.kind === 'message' ? doc.root.id : undefined), target = index.get(nodeId)?.node;
    if (!target) fail('NOT_FOUND', 'Record owner is missing');
    if (existing && existing.node.id !== nodeId) fail('INVALID_ARGUMENT', 'Moving records requires an explicit delete and create');
    const list = structuredClone(target[field] || []), { nodeId: _nodeId, ...fields } = f;
    if (change.op === 'create') list.push({ ...fields, id: change.id, ...(['todo', 'bug'].includes(change.kind) ? { sessions: [actor.sessionId] } : {}) });
    else if (change.op === 'delete') list.splice(existing.position, 1);
    else list[existing.position] = { ...list[existing.position], ...fields, id: change.id };
    add({ type: 'update', id: nodeId, fields: { [field]: list } });
  }
  return operations;
}

export class ProtocolMap {
  constructor(directory) { this.directory = directory; }
  async patch(principal, message, { store, actor, grants, prepare, authorize, references = async () => {} }) {
    const operationId = `v2:${hash(canonical([principal.repositoryId, principal.agentId, message.session, message.id]))}`;
    const file = path.join(this.directory, `${hash(operationId)}.json`), fingerprint = hash(canonical(message));
    try {
      return await withFileLock(`${file}.lock`, async () => {
        await authorize();
        await references();
        let intent = await readJSON(file, null);
        if (intent && intent.fingerprint !== fingerprint) fail('ID_REUSED', 'Map request ID already has different content');
        if (!intent) {
          await store.serial(() => store.refresh());
          if (store.version !== message.payload.baseVersion) fail('CONFLICT', 'Map changed', { currentVersion: store.version });
          const initialGrants = await grants();
          const operations = translateChanges(store.doc, message.payload.changes, actor, initialGrants, store.version);
          const prepared = await prepare({ operationId, baseVersion: store.version, operations });
          intent = { fingerprint, request: prepared.input, actor: prepared.actor,
            requiredGrants: operationGrants(store.doc, operations, initialGrants) };
          await atomicWrite(file, encode(intent));
        }
        // MapStore commits the Map and its durable operation receipt together.
        // A crash after that commit reuses this exact translated request.
        await authorize();
        if (actor.kind !== 'human') {
          const currentGrants = await grants();
          if ((intent.requiredGrants || []).some(id => !currentGrants.includes(id))) fail('FORBIDDEN', 'A node grant was revoked');
        }
        const result = await store.commit(intent.request, intent.actor, grants, authorize);
        return { version: result.version, operationId, committed: result.committed };
      });
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      const code = error.code === 'ID_REUSED' ? 'ID_REUSED' : error.status === 403 ? 'FORBIDDEN' : error.status === 404 ? 'NOT_FOUND' : error.status === 409 ? 'CONFLICT' : error.status === 400 ? 'INVALID_ARGUMENT' : 'UNAVAILABLE';
      fail(code, code === 'UNAVAILABLE' ? 'Map outcome requires recovery; retry the same request ID' : error.message);
    }
  }
}
