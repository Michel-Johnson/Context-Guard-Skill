const string = { type: 'string', minLength: 1 };
const strings = { type: 'array', items: string, minItems: 1 };
const nodeIds = { type: 'array', items: string, minItems: 1, maxItems: 3 };
const tourNodeIds = { type: 'array', items: string, minItems: 2, maxItems: 6, uniqueItems: true };
const replyComplete = { type: 'boolean', default: false,
  description: 'True only when accompanying assistant text fully answers the user and no further reading, writing or checking remains. Progress text is not a complete answer.' };
const definition = (name, description, properties, required = Object.keys(properties)) => ({ name, description,
  input_schema: { type: 'object', properties, required, additionalProperties: false } });
const executionSessionId = { type: 'string', minLength: 1,
  description: 'Copy from list_sessions; never use a Coordinator conversation ID.' };
const task = { executionSessionId, taskId: string };
export const coordinatorReferences = ['map-read.md', 'map-mount.md', 'user-reply.md', 'agent-handoff.md', 'plan-review.md', 'test-check.md', 'memory-definition.md'];
const fail = (message) => { throw Object.assign(new Error(message), { code: 'INVALID_ARGUMENT', toolHint: message }); };

export const coordinatorTools = [
  definition('list_tasks', 'List project requirements and unfinished Main TODO/Bug items.', {}),
  definition('list_sessions', 'List assigned execution Sessions and their exact executionSessionId.', {}),
  definition('list_conversations', 'List saved Coordinator conversations; their IDs are not executionSessionId.', {}),
  definition('read_map', 'Read one published Main node and its direct children; omit nodeId for root.', { nodeId: string }, []),
  definition('show_nodes', 'Show 1–3 Main node recommendation buttons.', { message: string, nodeIds, replyComplete }, ['message', 'nodeIds']),
  definition('open_node', 'Open one Main node in the workbench.', { nodeId: string, replyComplete }, ['nodeId']),
  definition('tour_nodes', 'Show a visible tour of 2–6 Main nodes in order.', { nodeIds: tourNodeIds, replyComplete }, ['nodeIds']),
  definition('read_reference', 'Read a workflow reference when needed.', { name: { type: 'string', enum: coordinatorReferences } }),
  definition('read_task', 'Read the authoritative task stage and evidence refs.', task),
  definition('read_object', 'Read a versioned object in an assigned Session.', { executionSessionId, ref: string, version: string }),
  definition('propose_mount', 'Propose a Main node for human approval; does not write Main.', { mainVersion: string, parentId: string, title: string, purpose: string, owns: strings }),
  definition('prepare_task', 'Prepare a brief for human approval. New tasks get a fresh execution Session automatically; never select or reuse one.', { taskId: string, text: string, acceptance: string, nodeIds: strings, mainVersion: string, itemId: string, nodeId: string, kind: { enum: ['todo', 'bug'] } }, ['taskId', 'text', 'acceptance', 'nodeIds', 'mainVersion']),
  definition('dispatch_task', 'Dispatch an existing approved brief; new tasks dispatch automatically.', { ...task, briefRef: string, briefVersion: string }),
  definition('review_plan', 'Approve or reject the exact submitted Plan.', { ...task, planRef: string, planVersion: string, decision: { enum: ['approved', 'rejected'] }, reason: string }),
  definition('request_ci', 'Request CI for the developer handoff and exact source SHA.', task),
  definition('request_rework', 'Return failed CI to the original task and developer.', task),
  definition('resume_task', 'Resume an interrupted task in its original execution Session.', { ...task, reason: string }),
  definition('guide_task', 'Send guidance to the existing execution Session without changing task stage.', { ...task, message: { ...string, maxLength: 2000 } }),
  definition('complete_task', 'Request closure after human acceptance; first read completionPolicy via read_task.', { ...task, gitReceiptRef: string, archiveReceiptRef: string }),
  definition('edit_map', 'Create, update, move or delete Main nodes and TODO/Bug records; update project or node memoryDocument at mainVersion.', {
    mainVersion: string, actions: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', properties: {
      op: { enum: ['create', 'update', 'move', 'delete'] }, id: string, parentId: string, nodeId: string, order: { type: 'integer', minimum: 0 },
      title: string, purpose: string, memoryDocument: { type: 'string', maxLength: 12000 }, kind: { enum: ['module', 'work', 'node', 'todo', 'bug'] }, state: { enum: ['dirty', 'untested', 'success'] }, owns: strings,
    }, required: ['op'], additionalProperties: false } },
  }),
  definition('mount_conversation', 'Attach the Coordinator to a Main node. Does not write Main and does not create an execution Session; that Session is created after the brief is approved.', {
    mainVersion: string, nodeId: string, kind: { enum: ['todo', 'bug', 'idea'] }, title: string, description: string,
  }),
  definition('ask_user', 'Ask one clarification; not for brief approval or final acceptance.', { question: string, options: { type: 'array', items: { ...string, maxLength: 120 }, minItems: 2, maxItems: 6, uniqueItems: true }, nodeIds }, ['question']),
  definition('write_file', 'Write exactly one UTF-8 text file at a repository-relative path. Does not commit, push, or change Main. When the file already exists, pass expectedSha as the SHA-256 of its current bytes.', {
    path: { ...string, maxLength: 240 }, content: { ...string, maxLength: 65536 }, expectedSha: { ...string, minLength: 64, maxLength: 64 },
  }, ['path', 'content']),
];

export const selectCoordinatorTools = (tools, { fileWrite = false } = {}) => fileWrite ? tools : tools.filter(tool => tool.name !== 'write_file');

function validateInput(tool, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Tool input must be an object');
  const { properties, required } = tool.input_schema;
  if (Object.keys(input).some(key => !Object.hasOwn(properties, key)) || required.some(key => !Object.hasOwn(input, key))) fail('Tool fields differ from its schema');
  for (const [key, value] of Object.entries(input)) {
    const rule = properties[key];
    if (rule.type === 'boolean' && typeof value !== 'boolean' ||
        rule.type === 'string' && (typeof value !== 'string' || !value.trim() || value.length > (rule.maxLength || 8000)) || rule.enum && !rule.enum.includes(value) ||
        rule.type === 'array' && (!Array.isArray(value) || value.length < (rule.minItems || 1) || value.length > (rule.maxItems || 100) ||
          rule.items?.type === 'string' && value.some(item => typeof item !== 'string' || !item.trim()))) fail('Invalid tool field');
  }
  if (Object.hasOwn(input, 'executionSessionId') && (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.executionSessionId) ||
      input.executionSessionId === 'main' || input.executionSessionId === 'legacy' || input.executionSessionId.startsWith('item-'))) {
    fail('executionSessionId must be copied from list_sessions, never from list_conversations');
  }
}

// ctx is constructed by the authenticated Cloud project, never from model input.
// exchange must reuse ProtocolStore authorization and idempotency receipts.
export function createCoordinatorExecutor(ctx) {
  const execute = async (name, input, options) => {
    const { operationId } = options;
    const tool = coordinatorTools.find(item => item.name === name);
    if (!tool) fail('Tool is not registered');
    if (name === 'read_reference' && typeof input?.name === 'string') input = { ...input,
      name: input.name.replace(/^references\//, '').replace(/\.md$/, '') + '.md' };
    validateInput(tool, input);
    await ctx.authorizeTool?.(name, input, options);
    if (name === 'list_tasks') return ctx.listTasks();
    if (name === 'list_sessions') return ctx.listSessions();
    if (name === 'list_conversations') return ctx.listConversations();
    if (name === 'read_map') return { ...(await ctx.readMap(input.nodeId)), kind: 'map-read', actionId: operationId };
    if (name === 'show_nodes') return { kind: 'node-references', message: input.message, nodes: await ctx.resolveNodes(input.nodeIds) };
    if (name === 'open_node') return { kind: 'node-navigation', actionId: operationId, node: (await ctx.resolveNodes([input.nodeId]))[0] };
    if (name === 'tour_nodes') return { kind: 'node-tour', actionId: operationId, nodes: await ctx.resolveNodes(input.nodeIds) };
    if (name === 'read_reference') return ctx.readReference(input.name);
    if (name === 'ask_user') {
      if (await ctx.pendingBriefApproval?.()) fail('A prepared brief already has a dedicated human approval card. Do not ask_user for approval or claim dispatch; wait for the approval receipt.');
      if (await ctx.pendingAcceptanceReview?.()) fail('A tested task already has a dedicated human acceptance card. Do not ask_user for acceptance or claim completion; wait for the acceptance receipt.');
      if (input.options && (input.options.length < 2 || input.options.length > 6 || new Set(input.options).size !== input.options.length || input.options.some(option => option.length > 120))) fail('Provide 2–6 unique short options');
      return { question: input.question, ...(input.options ? { options: input.options } : {}),
        ...(input.nodeIds ? { nodes: await ctx.resolveNodes(input.nodeIds) } : {}), approval: 'not-granted' };
    }
    if (name === 'edit_map') return ctx.editMap(input, operationId);
    if (name === 'mount_conversation') return ctx.mountConversation(input, operationId);
    if (name === 'write_file') return ctx.writeFile(input, operationId);
    if (name === 'propose_mount') {
      const parent = await ctx.readMap(input.parentId);
      if (parent.version !== input.mainVersion) fail('Main changed; read the parent again');
      if (input.owns.some(value => value.startsWith('/') || value.includes('..') || value.includes('\\'))) fail('Node ownership must use repository-relative paths');
      return { kind: 'mount-proposal', proposalId: operationId, ...input, requiresHumanApproval: true };
    }
    const exchange = (type, payload, suffix = '') => ctx.exchange(input.executionSessionId, operationId + suffix, type, payload, options);
    if (name === 'read_object') return exchange('object.read', { ref: input.ref, version: input.version });
    if (name === 'read_task') return ctx.readTask(input.executionSessionId, input.taskId, options);
    if (name === 'prepare_task') {
      for (const id of input.nodeIds) if ((await ctx.readMap(id)).version !== input.mainVersion) fail('Main changed; re-confirm task routing');
      if (ctx.prepareProjectTask) {
        const requirements = { ...input };
        return ctx.prepareProjectTask(requirements, operationId);
      }
      const text = JSON.stringify({ v: 1, taskId: input.taskId, text: input.text, acceptance: input.acceptance, nodeIds: input.nodeIds, mainVersion: input.mainVersion });
      if (text.length > 2000) fail('Keep the task brief within 2000 characters');
      const brief = await exchange('brief.submit', { taskId: input.taskId, text }, ':brief');
      const requested = await exchange('review.request', { kind: 'brief', taskId: input.taskId, ref: brief.ref, version: brief.version }, ':review');
      return { ...requested, sessionId: input.executionSessionId, taskId: input.taskId, text: input.text, acceptance: input.acceptance,
        nodeIds: input.nodeIds, mainVersion: input.mainVersion, brief, requiresHumanApproval: true };
    }
    const current = await ctx.readTask(input.executionSessionId, input.taskId, options);
    if (name === 'guide_task') return exchange('task.message', { taskId: input.taskId, text: input.message,
      ...(current.plan ? { planRef: current.plan.ref, planVersion: current.plan.version } : {}) });
    if (name === 'resume_task') return exchange('task.control', { taskId: input.taskId, action: 'resume', expectedVersion: current.version,
      data: { reason: input.reason } });
    if (name === 'complete_task') return exchange('task.control', { taskId: input.taskId, action: 'complete', expectedVersion: current.version,
      data: { gitReceiptRef: input.gitReceiptRef, archiveReceiptRef: input.archiveReceiptRef } });
    if (name === 'dispatch_task') {
      if (input.briefRef !== current.brief.ref || input.briefVersion !== current.brief.version) fail('The brief changed after it was read');
      const brief = await exchange('object.read', { ref: current.brief.ref, version: current.brief.version }, ':brief');
      let content; try { content = JSON.parse(brief.content.text); } catch { fail('Expected a structured approved brief'); }
      if (content.v !== 1 || content.taskId !== input.taskId) fail('Brief identity differs');
      return exchange('task.assign', { taskId: input.taskId, sessionId: input.executionSessionId, briefRef: current.brief.ref,
        briefVersion: current.brief.version, nodeIds: content.nodeIds, mainVersion: content.mainVersion, mode: 'reviewed' });
    }
    if (name === 'review_plan') {
      if (!current.plan) fail('No submitted Plan is available');
      if (input.planRef !== current.plan.ref || input.planVersion !== current.plan.version) fail('The Plan changed after it was read; do not approve a different version');
      const rules = await ctx.readReference('plan-review.md');
      await exchange('review.request', { taskId: input.taskId, kind: 'plan', ref: current.plan.ref, version: current.plan.version,
        requirementsRef: current.brief.ref, requirementsVersion: current.brief.version, rulesVersion: rules.version }, ':request');
      return exchange('review.result', { kind: 'plan', ref: current.plan.ref, version: current.plan.version, decision: input.decision, reason: input.reason });
    }
    if (name === 'request_ci') {
      if (!current.handoff) fail('Developer handoff is not available');
      return exchange('ci.request', { taskId: input.taskId, sourceSha: current.sourceSha, ciTodoRef: current.handoff.ciTodoRef, unitTestRefs: current.handoff.unitTestRefs });
    }
    if (name === 'request_rework') {
      if (!current.ci) fail('No CI result is available');
      const ci = await exchange('object.read', { ref: current.ci.ref, version: current.ci.version }, ':ci');
      return exchange('task.rework', { taskId: input.taskId, sourceSha: current.sourceSha, ciResultRef: current.ci.ref,
        failedTestIds: current.stage === 'acceptance-rejected' ? [] : ci.content.checks.filter(check => check.status !== 'passed').map(check => check.testId),
        ...(current.stage === 'acceptance-rejected' ? { reason: current.acceptanceReview.reason } : {}) });
    }
    fail('Tool is not implemented');
  };
  return async (name, input, options) => {
    const result = await execute(name, input, options);
    return ctx.filterResult ? ctx.filterResult(name, result, options) : result;
  };
}
