const string = { type: 'string', minLength: 1 };
const strings = { type: 'array', items: string, minItems: 1 };
const nodeIds = { type: 'array', items: string, minItems: 1, maxItems: 3 };
const definition = (name, description, properties, required = Object.keys(properties)) => ({ name, description,
  input_schema: { type: 'object', properties, required, additionalProperties: false } });
const executionSessionId = { type: 'string', minLength: 1,
  description: 'Exact executionSessionId returned by list_sessions. Never use main, legacy, session:* or item-* Coordinator conversation IDs.' };
const task = { executionSessionId, taskId: string };
export const coordinatorReferences = ['map-read.md', 'map-mount.md', 'user-reply.md', 'agent-handoff.md', 'plan-review.md', 'test-check.md'];
const fail = (message) => { throw Object.assign(new Error(message), { code: 'INVALID_ARGUMENT', toolHint: message }); };

export const coordinatorTools = [
  definition('list_tasks', 'List project requirements, creation status and their execution Session when ready. New tasks receive fresh Sessions automatically.', {}),
  definition('list_sessions', 'List execution Sessions assigned to this Coordinator. Use only sessions[].executionSessionId in task tools. Registration is not proof of liveness.', {}),
  definition('list_conversations', 'List saved Coordinator conversations for topic continuity. conversationId is never an executionSessionId and cannot be used in task tools.', {}),
  definition('read_map', 'Read one published Main node and its direct children, not a Session draft. Omit nodeId for the root.', { nodeId: string }, []),
  definition('show_nodes', 'Show 1–3 exact Main node buttons only when they are direct recommendations or requested actions.', { message: string, nodeIds }),
  definition('read_reference', 'Read an installed Coordinator reference when this workflow step requires it.', { name: { type: 'string', enum: coordinatorReferences } }),
  definition('read_task', 'Read the authoritative task stage, Plan, handoff and CI references.', task),
  definition('read_object', 'Read a versioned task, Plan, evidence or CI object in an assigned Session.', { sessionId: string, ref: string, version: string }),
  definition('propose_mount', 'Propose a Main node; this does not write Main or approve it. Wait for a human.', { mainVersion: string, parentId: string, title: string, purpose: string, owns: strings }),
  definition('prepare_task', 'Prepare project requirements for human approval. The scheduler creates a fresh execution Session after approval.', { executionSessionId, taskId: string, text: string, acceptance: string, nodeIds: strings, mainVersion: string }, ['taskId', 'text', 'acceptance', 'nodeIds', 'mainVersion']),
  definition('dispatch_task', 'Dispatch a human-approved brief in reviewed mode. Routing is copied from the approved brief.', { ...task, briefRef: string, briefVersion: string }),
  definition('review_plan', 'Review the exact submitted Plan; cannot approve a brief or human acceptance.', { ...task, planRef: string, planVersion: string, decision: { enum: ['approved', 'rejected'] }, reason: string }),
  definition('request_ci', 'Request CI using the exact SHA and evidence refs from the developer handoff.', task),
  definition('request_rework', 'Return failed CI to its original task and developer, preserving failure evidence.', task),
  definition('resume_task', 'Resume an interrupted, incomplete task with its original Session, Plan and evidence; the system may invoke this automatically and never creates a new task.', { ...task, reason: string }),
  definition('complete_task', 'After human acceptance, request closure with a merged GitHub PR and published Session memory version. The server independently verifies both; this tool does not merge code.', { ...task, gitReceiptRef: string, archiveReceiptRef: string }),
  definition('edit_map', 'Create, rename, update or move Main nodes through the configured Coordinator identity. This never deletes nodes or edits records.', {
    mainVersion: string, actions: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', properties: {
      op: { enum: ['create', 'update', 'move'] }, id: string, parentId: string, order: { type: 'integer', minimum: 0 },
      title: string, purpose: string, kind: { enum: ['module', 'work'] }, state: { enum: ['dirty', 'untested', 'success'] }, owns: strings,
    }, required: ['op'], additionalProperties: false } },
  }),
  definition('mount_conversation', 'Attach the current intent to a Main TODO, Bug or Idea and return its durable conversation.', {
    mainVersion: string, nodeId: string, kind: { enum: ['todo', 'bug', 'idea'] }, title: string, description: string,
  }),
  definition('ask_user', 'Ask one concise question, with 2–6 short options when a choice is needed. nodeIds render at most 3 exact node choices. The UI also allows free text. Asking or answering grants no approval. Wait after this call.', { question: string, options: { type: 'array', items: { ...string, maxLength: 120 }, minItems: 2, maxItems: 6, uniqueItems: true }, nodeIds }, ['question']),
];

function validateInput(tool, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Tool input must be an object');
  const { properties, required } = tool.input_schema;
  if (Object.keys(input).some(key => !Object.hasOwn(properties, key)) || required.some(key => !Object.hasOwn(input, key))) fail('Tool fields differ from its schema');
  for (const [key, value] of Object.entries(input)) {
    const rule = properties[key];
    if (rule.type === 'string' && (typeof value !== 'string' || !value.trim() || value.length > 8000) || rule.enum && !rule.enum.includes(value) ||
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
  return async (name, input, { operationId }) => {
    const tool = coordinatorTools.find(item => item.name === name);
    if (!tool) fail('Tool is not registered');
    if (name === 'read_reference' && typeof input?.name === 'string') input = { ...input,
      name: input.name.replace(/^references\//, '').replace(/\.md$/, '') + '.md' };
    validateInput(tool, input);
    if (name === 'list_tasks') return ctx.listTasks();
    if (name === 'list_sessions') return ctx.listSessions();
    if (name === 'list_conversations') return ctx.listConversations();
    if (name === 'read_map') return ctx.readMap(input.nodeId);
    if (name === 'show_nodes') return { kind: 'node-references', message: input.message, nodes: await ctx.resolveNodes(input.nodeIds) };
    if (name === 'read_reference') return ctx.readReference(input.name);
    if (name === 'ask_user') {
      if (input.options && (input.options.length < 2 || input.options.length > 6 || new Set(input.options).size !== input.options.length || input.options.some(option => option.length > 120))) fail('Provide 2–6 unique short options');
      return { question: input.question, ...(input.options ? { options: input.options } : {}),
        ...(input.nodeIds ? { nodes: await ctx.resolveNodes(input.nodeIds) } : {}), approval: 'not-granted' };
    }
    if (name === 'edit_map') return ctx.editMap(input, operationId);
    if (name === 'mount_conversation') return ctx.mountConversation(input, operationId);
    if (name === 'propose_mount') {
      const parent = await ctx.readMap(input.parentId);
      if (parent.version !== input.mainVersion) fail('Main changed; read the parent again');
      if (input.owns.some(value => value.startsWith('/') || value.includes('..') || value.includes('\\'))) fail('Node ownership must use repository-relative paths');
      return { kind: 'mount-proposal', proposalId: operationId, ...input, requiresHumanApproval: true };
    }
    const exchange = (type, payload, suffix = '') => ctx.exchange(input.executionSessionId, operationId + suffix, type, payload);
    if (name === 'read_object') return exchange('object.read', { ref: input.ref, version: input.version });
    if (name === 'read_task') return ctx.readTask(input.executionSessionId, input.taskId);
    if (name === 'prepare_task') {
      for (const id of input.nodeIds) if ((await ctx.readMap(id)).version !== input.mainVersion) fail('Main changed; re-confirm task routing');
      if (ctx.prepareProjectTask) {
        const { executionSessionId: ignored, ...requirements } = input;
        return ctx.prepareProjectTask(requirements, operationId);
      }
      const text = JSON.stringify({ v: 1, taskId: input.taskId, text: input.text, acceptance: input.acceptance, nodeIds: input.nodeIds, mainVersion: input.mainVersion });
      if (text.length > 2000) fail('Keep the task brief within 2000 characters');
      const brief = await exchange('brief.submit', { taskId: input.taskId, text }, ':brief');
      const requested = await exchange('review.request', { kind: 'brief', taskId: input.taskId, ref: brief.ref, version: brief.version }, ':review');
      return { ...requested, sessionId: input.executionSessionId, taskId: input.taskId, text: input.text, acceptance: input.acceptance,
        nodeIds: input.nodeIds, mainVersion: input.mainVersion, brief, requiresHumanApproval: true };
    }
    const current = await ctx.readTask(input.executionSessionId, input.taskId);
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
}
