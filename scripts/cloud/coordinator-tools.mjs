const string = { type: 'string', minLength: 1 };
const strings = { type: 'array', items: string, minItems: 1 };
const definition = (name, description, properties, required = Object.keys(properties)) => ({ name, description,
  input_schema: { type: 'object', properties, required, additionalProperties: false } });
const task = { sessionId: string, taskId: string };
const fail = (message) => { throw Object.assign(new Error(message), { code: 'INVALID_ARGUMENT' }); };

export const coordinatorTools = [
  definition('list_sessions', 'List only the Sessions explicitly assigned to this Coordinator. Registration is not proof of liveness.', {}),
  definition('read_map', 'Read one published Main node and its direct children, not a Session draft. Omit nodeId for the root.', { nodeId: string }, []),
  definition('read_reference', 'Read an installed Coordinator reference when this workflow step requires it.', { name: string }),
  definition('read_task', 'Read the authoritative task stage, Plan, handoff and CI references.', task),
  definition('read_object', 'Read a versioned task, Plan, evidence or CI object in an assigned Session.', { sessionId: string, ref: string, version: string }),
  definition('propose_mount', 'Propose a Main node; this does not write Main or approve it. Wait for a human.', { mainVersion: string, parentId: string, title: string, purpose: string, owns: strings }),
  definition('prepare_task', 'Prepare an immutable requirement and request human approval. Do not dispatch yet.', { ...task, text: string, acceptance: string, nodeIds: strings, mainVersion: string }),
  definition('dispatch_task', 'Dispatch a human-approved brief in reviewed mode. Routing is copied from the approved brief.', { ...task, briefRef: string, briefVersion: string }),
  definition('review_plan', 'Review the exact submitted Plan; cannot approve a brief or human acceptance.', { ...task, planRef: string, planVersion: string, decision: { enum: ['approved', 'rejected'] }, reason: string }),
  definition('request_ci', 'Request CI using the exact SHA and evidence refs from the developer handoff.', task),
  definition('request_rework', 'Return failed CI to its original task and developer, preserving failure evidence.', task),
  definition('complete_task', 'After human acceptance, request closure with a merged GitHub PR and published Session memory version. The server independently verifies both; this tool does not merge code.', { ...task, gitReceiptRef: string, archiveReceiptRef: string }),
  definition('ask_user', 'Ask the human a question. No approval is implied by asking.', { question: string }),
];

function validateInput(tool, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Tool input must be an object');
  const { properties, required } = tool.input_schema;
  if (Object.keys(input).some(key => !Object.hasOwn(properties, key)) || required.some(key => !Object.hasOwn(input, key))) fail('Tool fields differ from its schema');
  for (const [key, value] of Object.entries(input)) {
    const rule = properties[key];
    if (rule.type === 'string' && (typeof value !== 'string' || !value.trim() || value.length > 8000) || rule.enum && !rule.enum.includes(value) || rule.type === 'array' && (!Array.isArray(value) || !value.length || value.length > 100 || value.some(item => typeof item !== 'string' || !item.trim()))) fail('Invalid tool field');
  }
}

// ctx is constructed by the authenticated Cloud project, never from model input.
// exchange must reuse ProtocolStore authorization and idempotency receipts.
export function createCoordinatorExecutor(ctx) {
  return async (name, input, { operationId }) => {
    const tool = coordinatorTools.find(item => item.name === name);
    if (!tool) fail('Tool is not registered');
    validateInput(tool, input);
    if (name === 'list_sessions') return ctx.listSessions();
    if (name === 'read_map') return ctx.readMap(input.nodeId);
    if (name === 'read_reference') return ctx.readReference(input.name);
    if (name === 'ask_user') return { question: input.question, approval: 'not-granted' };
    if (name === 'propose_mount') {
      const parent = await ctx.readMap(input.parentId);
      if (parent.version !== input.mainVersion) fail('Main changed; read the parent again');
      if (input.owns.some(value => value.startsWith('/') || value.includes('..') || value.includes('\\'))) fail('Node ownership must use repository-relative paths');
      return { kind: 'mount-proposal', proposalId: operationId, ...input, requiresHumanApproval: true };
    }
    const exchange = (type, payload, suffix = '') => ctx.exchange(input.sessionId, operationId + suffix, type, payload);
    if (name === 'read_object') return exchange('object.read', { ref: input.ref, version: input.version });
    if (name === 'read_task') return ctx.readTask(input.sessionId, input.taskId);
    if (name === 'prepare_task') {
      for (const id of input.nodeIds) if ((await ctx.readMap(id)).version !== input.mainVersion) fail('Main changed; re-confirm task routing');
      const text = JSON.stringify({ v: 1, taskId: input.taskId, text: input.text, acceptance: input.acceptance, nodeIds: input.nodeIds, mainVersion: input.mainVersion });
      if (text.length > 2000) fail('Keep the task brief within 2000 characters');
      const brief = await exchange('brief.submit', { taskId: input.taskId, text }, ':brief');
      const requested = await exchange('review.request', { kind: 'brief', taskId: input.taskId, ref: brief.ref, version: brief.version }, ':review');
      return { ...requested, sessionId: input.sessionId, taskId: input.taskId, text: input.text, acceptance: input.acceptance,
        nodeIds: input.nodeIds, mainVersion: input.mainVersion, brief, requiresHumanApproval: true };
    }
    const current = await ctx.readTask(input.sessionId, input.taskId);
    if (name === 'complete_task') return exchange('task.control', { taskId: input.taskId, action: 'complete', expectedVersion: current.version,
      data: { gitReceiptRef: input.gitReceiptRef, archiveReceiptRef: input.archiveReceiptRef } });
    if (name === 'dispatch_task') {
      if (input.briefRef !== current.brief.ref || input.briefVersion !== current.brief.version) fail('The brief changed after it was read');
      const brief = await exchange('object.read', { ref: current.brief.ref, version: current.brief.version }, ':brief');
      let content; try { content = JSON.parse(brief.content.text); } catch { fail('Expected a structured approved brief'); }
      if (content.v !== 1 || content.taskId !== input.taskId) fail('Brief identity differs');
      return exchange('task.assign', { taskId: input.taskId, sessionId: input.sessionId, briefRef: current.brief.ref,
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
