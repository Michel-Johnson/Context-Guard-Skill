import path from 'node:path';
import { atomicWrite, encode, hash, readJSON, withFileLock } from '../shared/io.mjs';
import { entries, MapError } from '../shared/map-model.mjs';
import { buildFilesystemV2 } from '../shared/filesystem-v2.mjs';

export const MANUAL_DISABLED_TOOLS = Object.freeze(['dispatch_task', 'review_plan', 'request_ci', 'request_rework', 'resume_task', 'guide_task', 'complete_task']);
export const filterManualTools = tools => tools.filter(tool => !MANUAL_DISABLED_TOOLS.includes(tool.name)).map(tool => {
  if (tool.name === 'edit_map') {
    const result = { ...tool, description: 'Create, update, move or delete Main nodes and TODO/Bug records at the observed mainVersion. For a memory update on an existing node, use read_map on that target node before editing; navigation and read_reference do not supply its current contents.' };
    const actions = tool.input_schema?.properties?.actions, item = actions?.items, memory = item?.properties?.memoryDocument;
    if (memory) result.input_schema = { ...tool.input_schema, properties: { ...tool.input_schema.properties,
      actions: { ...actions, items: { ...item, properties: { ...item.properties,
        memoryDocument: { ...memory, description: 'Full Markdown document: change only the requested sections and preserve all other sections verbatim. If there is no existing memory, write only applicable confirmed sections; do not fill six sections from guesses or task-local requirements. Use memoryDocument, not a filename such as memoryDocument.md.' },
      } } },
    } };
    return result;
  }
  if (tool.name !== 'prepare_task') return tool;
  const result = { ...tool, description: 'Prepare a brief for human confirmation; confirmation creates or updates a Main TODO/Bug and a pasteable execution prompt. Execution is manual.' };
  if (tool.input_schema?.properties) {
    const properties = { ...tool.input_schema.properties };
    for (const [field, description] of [
      ['taskId', 'Required task identifier; it does not set the saved Main item ID or title and does not associate an existing TODO/Bug. To reuse an item, provide itemId, nodeId and kind.'],
      ['text', 'For a new TODO, the first line becomes the Main item title (up to 200 characters). Put the user-requested title there, followed by the complete requirements on subsequent lines. An existing TODO/Bug keeps its current title; do not claim this brief renames it.'],
      ['itemId', 'To reuse an existing TODO/Bug, copy its exact Main item ID here and also provide nodeId and kind. Omit for a new TODO in a project conversation. An item-focused conversation may inherit its trusted item only when itemId, nodeId and kind are all omitted; partial routing is rejected.'],
      ['nodeId', 'For an existing item, copy its owning Main node ID and include it in nodeIds. This is required with itemId.'],
      ['kind', 'Existing item type: todo or bug. A bug brief requires itemId and nodeId; kind=bug alone must not create a TODO. New TODO briefs may omit this field.'],
    ]) if (properties[field]) properties[field] = { ...properties[field], description };
    result.input_schema = { ...tool.input_schema, properties };
  }
  return result;
});
export function coordinatorRolePrompt(source, { manual = false } = {}) {
  const markers = [...source.matchAll(/^## 人工对话模式[ \t]*(?=\r?$)/gm)];
  const heading = markers[0]?.index ?? -1;
  // Older installations/custom role guides retain the existing compatibility
  // behavior. A declared but empty/ambiguous profile is a configuration error.
  if (heading < 0) return source + (manual ? '\n本对话采用人工执行模式：讨论、读取和编辑 Map；prepare_task 只生成待人工确认的 brief。人确认后保存 Main TODO/Bug 和可粘贴执行提示，不创建、派发或恢复执行 Session。保持当前对话继续讨论。' : '');
  const profile = source.slice(heading + markers[0][0].length).trim();
  if (!profile || markers.length !== 1) {
    throw new MapError('INVALID_COORDINATOR_PROFILE', 'Coordinator manual role profile is empty or ambiguous', 503);
  }
  const boundary = heading - (source.slice(0, heading).endsWith('\r\n') ? 2 : heading ? 1 : 0);
  return manual ? `# Coordinator\n\n${profile}\n` : source.slice(0, boundary);
}
const fail = (code, message, status = 400) => { throw new MapError(code, message, status); };
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const workItemIdentity = item => item.instanceId || item.createdAt || item.id;
const snapshotDocument = snapshot => snapshot.document || snapshot.map || snapshot.memory?.map;
const allowedActor = actor => actor && actor.kind === 'human' && typeof actor.sessionId === 'string' && actor.sessionId;
const publicProposal = proposal => ({ id: proposal.id, version: proposal.version, brief: { ref: `manual-brief:${proposal.id}`, version: proposal.version },
  taskId: proposal.itemId, nodeId: proposal.nodeId, itemId: proposal.itemId, kind: proposal.kind, text: proposal.text, acceptance: proposal.acceptance,
  nodeIds: proposal.nodeIds, mainVersion: proposal.mainVersion, requiresHumanApproval: true, manual: true, pending: !proposal.review,
  ...(proposal.review ? { decision: proposal.review.decision, review: { ...proposal.review,
    result: Object.fromEntries(Object.entries(proposal.review.result).filter(([key]) => key !== 'prompt')) } } : {}) });

export function manualBriefInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.text !== 'string' || !input.text.trim() || input.text.length > 8000 ||
      typeof input.acceptance !== 'string' || !input.acceptance.trim() || input.acceptance.length > 4000 ||
      typeof input.mainVersion !== 'string' || !input.mainVersion || input.mainVersion.length > 128 ||
      !Array.isArray(input.nodeIds) || !input.nodeIds.length || input.nodeIds.length > 20 || input.nodeIds.some(id => !identifier(id)) ||
      new Set(input.nodeIds).size !== input.nodeIds.length || input.nodeId !== undefined && !identifier(input.nodeId) ||
      input.itemId !== undefined && !identifier(input.itemId) || input.kind !== undefined && !['todo', 'bug'].includes(input.kind)) fail('INVALID_ARGUMENT', 'Provide a brief, acceptance criteria, Main version and exact node IDs');
  if (input.itemId && (!input.nodeId || !input.kind)) fail('INVALID_ARGUMENT', 'An existing item requires its node and TODO/Bug kind');
  if (input.kind === 'bug' && !input.itemId) fail('INVALID_ARGUMENT', 'A Bug brief requires the existing itemId and nodeId; taskId alone does not associate an item. Create a new Bug through edit_map before preparing its brief.');
  return { text: input.text.trim(), acceptance: input.acceptance.trim(), mainVersion: input.mainVersion, nodeIds: [...input.nodeIds],
    nodeId: input.nodeId || input.nodeIds[0], ...(input.itemId ? { itemId: input.itemId, kind: input.kind } : { kind: 'todo' }) };
}

export function manualExecutionPrompt({ projectId, proposal, document, version }) {
  const index = entries(document.root);
  const projection = buildFilesystemV2({ version, memory: { map: document, records: {} } });
  const navigation = JSON.parse(projection.files.get('map.json'));
  const selected = proposal.nodeIds.map(id => {
    const node = index.get(id)?.node;
    if (!node) fail('VERSION_CONFLICT', 'Brief node is no longer available', 409);
    const nodeFile = navigation.nodes.find(item => item.id === id)?.path;
    const memoryPath = id === document.root.id ? 'memory.md' : nodeFile?.replace(/index\.md$/, 'memory.md');
    return [`### ${node.title} (${node.id})`, node.purpose || '',
      `节点阅读路径（Main scope）：${nodeFile}`, ...(projection.files.has(memoryPath) ? [`记忆阅读路径：${memoryPath}`, node.memoryDocument] : []),
      ...(node.owns?.length ? [`代码范围：${node.owns.join(', ')}`] : [])].filter(Boolean).join('\n\n');
  }).join('\n\n');
  const itemFile = navigation.nodes.find(node => node.id === proposal.nodeId)?.path.replace(/index\.md$/, `${proposal.kind === 'bug' ? 'bugs' : 'todos'}/${proposal.itemId}.md`);
  return `# 执行需求\n\n项目：${projectId}\n工作项：${proposal.kind.toUpperCase()} ${proposal.itemId}\nMain 版本：${version}\n\n## 目标\n\n${proposal.text}\n\n## 验收\n\n${proposal.acceptance}\n\n## Map 切片\n\n${selected}\n\n## 读写路径\n\n- 阅读 Main 的 map.json、上述节点 index.md，以及工作项 ${itemFile}。这些是 fs-v2.1 scope-relative 读取路径，通过 Context Guard 的按版本单文件读取入口使用，不能当作宿主的绝对磁盘路径。\n- 在用户当前打开的项目根目录调用已安装的 Context Guard Skill；Codex、Cursor、Claude 使用同一个工作项 ID。按现有绑定流程确认自己的 Session 身份及最新 Main 版本，不能把 Coordinator 对话 ID 当作执行 Session ID。\n- 若 Main 版本变化，刷新相关切片并核对需求；无法核对时报告冲突，不覆盖新内容。\n- 只把代码结果、attempt 结论、验收证据和受影响节点写入自己的 Session；使用现有 Skill/hooks 的 Session 写回入口，不直接覆盖 Main。\n- 执行结束后汇报工作项 ID、Session ID、改动和验收证据，交由用户在工作台审核后进入 Main。\n`;
}

// Proposals are conversational state, not a second Task system. Approval uses
// the same Main CAS callback as the workbench and never creates an Agent Session.
export class CoordinatorManualBriefs {
  constructor({ directory, projectId, readMain, commitMain }) {
    if (!path.isAbsolute(directory || '') || !identifier(projectId) || typeof readMain !== 'function' || typeof commitMain !== 'function') throw new Error('Manual brief storage and Main services are required');
    Object.assign(this, { projectId, readMain, commitMain });
    this.file = path.join(directory, 'manual-briefs.json');
  }
  async state() { return readJSON(this.file, { proposals: {}, operations: {}, reviews: {} }); }
  async approvals(conversationId) {
    return Object.values((await this.state()).proposals).filter(proposal => proposal.conversationId === conversationId).map(publicProposal);
  }
  async acknowledgeNotification(proposalId, conversationId) {
    return withFileLock(this.file + '.lock', async () => {
      const state = await this.state(), proposal = state.proposals[proposalId];
      if (!proposal || proposal.conversationId !== conversationId || !proposal.review) fail('NOT_FOUND', 'Reviewed brief is unavailable', 404);
      proposal.review.notified = true;
      await atomicWrite(this.file, encode(state));
    });
  }
  async prepare(input, { operationId, conversationId, actor } = {}) {
    if (!identifier(operationId) || !identifier(conversationId)) fail('INVALID_ARGUMENT', 'Provide stable proposal and conversation IDs');
    const value = manualBriefInput(input);
    const fingerprint = hash(JSON.stringify({ value, conversationId }));
    const id = `manual-${hash(JSON.stringify([this.projectId, conversationId, operationId]))}`;
    return withFileLock(this.file + '.lock', async () => {
      const state = await this.state(), previous = state.proposals[id];
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail('ID_REUSED', 'Proposal ID belongs to a different brief', 409);
        return publicProposal(previous);
      }
      const snapshot = await this.readMain(), document = snapshotDocument(snapshot);
      if (snapshot.version !== value.mainVersion) fail('VERSION_CONFLICT', 'Main changed; refresh the brief before proposing', 409);
      const index = entries(document.root);
      if ([...value.nodeIds, value.nodeId].some(nodeId => !index.has(nodeId))) fail('NOT_FOUND', 'A brief node is missing', 404);
      if (!value.nodeIds.includes(value.nodeId)) fail('INVALID_ARGUMENT', 'The work-item node must be included in the brief scope');
      let identity = null;
      if (value.itemId) {
        const matches = (index.get(value.nodeId).node[value.kind === 'bug' ? 'bugs' : 'todos'] || []).filter(item => item.id === value.itemId);
        if (matches.length !== 1) fail('CONFLICT', 'The TODO/Bug is missing or ambiguous', 409);
        const item = matches[0];
        if (item.dispatch?.session_id || item.status === 'processing' || ['done', 'resolved', 'unfixable'].includes(item.status)) fail('ACTIVE_EXECUTION', 'Choose an open item without an automatic execution assignment', 409);
        identity = workItemIdentity(item);
      }
      const proposal = { id, fingerprint, projectId: this.projectId, conversationId, operationId, ...value,
        itemId: value.itemId || `TD${hash(id).slice(0, 24)}`, itemIdentity: identity,
        createdAt: new Date().toISOString(), ...(actor ? { actor: structuredClone(actor) } : {}) };
      proposal.version = hash(JSON.stringify({ ...value, itemId: proposal.itemId, itemIdentity: identity }));
      state.proposals[id] = proposal;
      await atomicWrite(this.file, encode(state));
      return publicProposal(proposal);
    });
  }
  async review(input, { operationId, conversationId, actor } = {}) {
    if (!identifier(operationId) || !identifier(conversationId) || !allowedActor(actor) || !input ||
        !identifier(input.proposalId) || !['approved', 'rejected'].includes(input.decision) || typeof input.version !== 'string' ||
        typeof (input.reason ?? '') !== 'string' || (input.reason || '').length > 2000) fail('INVALID_ARGUMENT', 'Review the exact brief version with a verified human actor');
    const fingerprint = hash(JSON.stringify({ input: { proposalId: input.proposalId, version: input.version, decision: input.decision, reason: input.reason || '' }, conversationId, actor }));
    return withFileLock(this.file + '.lock', async () => {
      const state = await this.state(), proposal = state.proposals[input.proposalId];
      if (!proposal || proposal.conversationId !== conversationId) fail('NOT_FOUND', 'Brief is unavailable in this conversation', 404);
      if (proposal.version !== input.version) fail('VERSION_CONFLICT', 'Review references an old brief version', 409);
      if (state.reviews[operationId]) {
        if (state.reviews[operationId].fingerprint !== fingerprint) fail('ID_REUSED', 'Review ID belongs to another request', 409);
        return state.reviews[operationId].result;
      }
      if (proposal.review) {
        if (proposal.review.fingerprint !== fingerprint) fail('CONFLICT', 'Brief has already been reviewed differently', 409);
        return proposal.review.result;
      }
      if (proposal.intent && proposal.intent.fingerprint !== fingerprint) fail('CONFLICT', 'A different review is already being committed', 409);
      const approvedAt = proposal.intent?.at || new Date().toISOString();
      let receipt, prompt;
      if (input.decision === 'approved') {
        if (!proposal.intent) {
          const snapshot = await this.readMain(), document = snapshotDocument(snapshot);
          if (snapshot.version !== proposal.mainVersion) fail('VERSION_CONFLICT', 'Main changed after the brief; refresh before confirming', 409);
          const node = entries(document.root).get(proposal.nodeId)?.node;
          if (!node) fail('VERSION_CONFLICT', 'The brief node was removed', 409);
          const field = proposal.kind === 'bug' ? 'bugs' : 'todos', list = node[field] || [];
          const matches = list.filter(item => item.id === proposal.itemId);
          if (proposal.itemIdentity && (matches.length !== 1 || workItemIdentity(matches[0]) !== proposal.itemIdentity)) fail('VERSION_CONFLICT', 'Work item identity changed after the brief', 409);
          if (!proposal.itemIdentity && matches.length) fail('CONFLICT', 'New TODO identity is already in use', 409);
          const approval = { proposalId: proposal.id, version: proposal.version, mainVersion: proposal.mainVersion,
            text: proposal.text, acceptance: proposal.acceptance, actor: structuredClone(actor), approvedAt, executionMode: 'manual', ready: true };
          const item = proposal.itemIdentity ? { ...matches[0], approvedBrief: approval, executionMode: 'manual' } : { id: proposal.itemId,
            title: proposal.text.split('\n')[0].slice(0, 200), description: proposal.text, status: 'pending', createdAt: approvedAt, approvedBrief: approval };
          item.executionMode = 'manual';
          const operations = [{ type: 'update', id: node.id, fields: { [field]: proposal.itemIdentity
            ? list.map(value => value.id === proposal.itemId ? item : value) : [...list, item] } }];
          const projected = structuredClone(document);
          entries(projected.root).get(node.id).node[field] = operations[0].fields[field];
          proposal.intent = { fingerprint, at: approvedAt, actor, operationId: `manual-review:${hash(JSON.stringify([this.projectId, proposal.id]))}`,
            baseVersion: snapshot.version, operations, document: projected };
          // Persist before Main commit so retry after a crash reuses the exact
          // operation, actor and CAS version instead of creating another TODO.
          await atomicWrite(this.file, encode(state));
        }
        const intent = proposal.intent;
        try {
          receipt = await this.commitMain({ operationId: intent.operationId, baseVersion: intent.baseVersion, operations: intent.operations }, intent.actor);
        } catch (error) {
          if (error.code === 'VERSION_CONFLICT') { delete proposal.intent; await atomicWrite(this.file, encode(state)); }
          throw error;
        }
        prompt = manualExecutionPrompt({ projectId: this.projectId, proposal, document: intent.document, version: receipt.version });
      }
      const result = { decision: input.decision, proposalId: proposal.id, itemId: proposal.itemId, nodeId: proposal.nodeId,
        kind: proposal.kind, version: receipt?.version || proposal.mainVersion, ...(prompt ? { prompt } : {}), executionMode: 'manual',
        actor: structuredClone(actor), reviewedAt: approvedAt };
      proposal.review = { fingerprint, decision: input.decision, reason: input.reason || '', actor: structuredClone(actor), result };
      delete proposal.intent;
      state.reviews[operationId] = { fingerprint, result };
      await atomicWrite(this.file, encode(state));
      return result;
    });
  }
  async prompt(proposalId, conversationId) {
    const proposal = (await this.state()).proposals[proposalId];
    if (!proposal || proposal.conversationId !== conversationId) fail('NOT_FOUND', 'Brief is unavailable in this conversation', 404);
    if (proposal.review?.decision !== 'approved') fail('APPROVAL_REQUIRED', 'Confirm the current brief before exporting an execution prompt', 409);
    const snapshot = await this.readMain(), node = entries(snapshotDocument(snapshot).root).get(proposal.nodeId)?.node;
    const item = node?.[proposal.kind === 'bug' ? 'bugs' : 'todos']?.find(value => value.id === proposal.itemId);
    if (item?.approvedBrief?.proposalId !== proposal.id || item.approvedBrief.version !== proposal.version) fail('VERSION_CONFLICT', 'This execution prompt is no longer the current approved brief', 409);
    return { text: proposal.review.result.prompt, filename: `context-guard-${proposal.kind}-${proposal.itemId}.md` };
  }
}
