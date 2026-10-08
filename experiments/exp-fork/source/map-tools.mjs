import { coordinatorTools, createCoordinatorExecutor } from '../../scripts/cloud/coordinator-tools.mjs';
import { coordinatorStructureOperations } from '../../scripts/cloud/server.mjs';
import { fault } from './source.mjs';
import { applyOperations } from '../../scripts/shared/map-model.mjs';
import { readJSON, atomicWrite } from './history.mjs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const names = new Set(['read_map', 'show_nodes', 'open_node', 'tour_nodes', 'edit_map']);
export function createLearningMapTools(request, { directory } = {}) {
  let pending = Promise.resolve();
  const snapshot = () => request('/map');
  const index = document => {
    const result = new Map();
    const visit = node => { result.set(node.id, node); for (const child of node.children || []) visit(child); };
    if (document?.root) visit(document.root);
    return result;
  };
  const resolve = (document, ids) => ids.map(id => {
    const node = index(document).get(id);
    if (!node) throw fault('NOT_FOUND', 'Map node does not exist');
    return { id: node.id, title: node.title, purpose: node.purpose || '' };
  });
  const execute = createCoordinatorExecutor({
    readMap: async id => {
      const current = await snapshot();
      const node = index(current.document).get(id || current.document.root.id);
      if (!node) throw fault('NOT_FOUND', 'Map node does not exist');
      const { children = [], ...fields } = node;
      return { version: current.version, node: { ...fields, children: resolve(current.document, children.map(child => child.id)) } };
    },
    resolveNodes: async ids => resolve((await snapshot()).document, ids),
    editMap: async (input, operationId) => {
      const run = pending.then(async () => {
        if (!directory) throw fault('MAP_WRITE_UNAVAILABLE', 'Map write journal is unavailable');
        const file = path.join(directory, createHash('sha256').update(operationId).digest('hex') + '.json');
        const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        let saved = await readJSON(file, null);
        if (saved && saved.inputHash !== inputHash) throw fault('ID_REUSED', 'Map operation content changed');
        if (saved?.result) return saved.result;
        if (!saved) {
          const current = await snapshot();
          if (input.mainVersion !== current.version) throw fault('VERSION_CONFLICT', 'Map changed; read_map again');
          const operations = coordinatorStructureOperations(input.actions, operationId);
          const applied = applyOperations(current.document, operations, { kind: 'coordinator', sessionId: 'learning-coordinator' });
          saved = { inputHash, ids: applied.resultIds, payload: { baseVersion: current.version, operationId, document: applied.doc, sessionId: 'learning-coordinator' } };
          await atomicWrite(file, JSON.stringify(saved));
        }
        // Persist the exact CAS payload first so response loss can retry idempotently.
        const result = await request('/snapshot', saved.payload);
        const nodes = index(saved.payload.document);
        saved.result = { kind: 'map-action', actionId: operationId, message: 'Map 已更新', version: result.version,
          nodes: resolve(saved.payload.document, [...new Set(saved.ids)].filter(id => nodes.has(id))) };
        await atomicWrite(file, JSON.stringify(saved));
        return saved.result;
      });
      pending = run.catch(() => {});
      return run;
    },
  });
  return { definitions: coordinatorTools.filter(t => names.has(t.name)),
    call: (name, input, operationId) => {
      if (!names.has(name)) throw fault('TOOL_FORBIDDEN', 'Tool is unavailable');
      return execute(name, input, { operationId });
    } };
}
