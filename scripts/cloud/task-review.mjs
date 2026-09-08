import { createHash } from 'node:crypto';
import { entries, MapError } from '../../prototype/map-model.mjs';

export function reviewInput(value) {
  const fields = ['operationId', 'sessionId', 'taskId', 'resultVersion', 'nodeId', 'itemId'];
  if (!value || fields.some(key => typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 128)
    || !['bug', 'todo'].includes(value.kind) || !['approved', 'rejected'].includes(value.decision)
    || value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.length > 2000)) {
    throw new MapError('INVALID_ARGUMENT', 'A task result version, work item and review decision are required', 400);
  }
  return { ...Object.fromEntries(fields.map(key => [key, value[key]])), kind: value.kind, decision: value.decision, reason: (value.reason || '').trim() };
}

export function reviewOperations(document, input, task) {
  const node = entries(document.root).get(input.nodeId)?.node;
  const field = input.kind === 'bug' ? 'bugs' : 'todos';
  const matches = node?.[field]?.filter(item => item.id === input.itemId) || [];
  if (matches.length !== 1) throw new MapError('CONFLICT', 'Work item is missing or ambiguous', 409);
  const item = matches[0];
  if (item.dispatch?.task_id !== input.taskId || item.dispatch?.session_id !== input.sessionId
    || task.taskId !== input.taskId || task.sessionId !== input.sessionId || task.version !== input.resultVersion) {
    throw new MapError('VERSION_CONFLICT', 'The task result changed; refresh before reviewing', 409);
  }
  if (item.review?.taskId === input.taskId && item.review.resultVersion === input.resultVersion) {
    if (item.review.decision !== input.decision || item.review.reason !== input.reason) throw new MapError('CONFLICT', 'This result has already been reviewed differently', 409);
    return { review: item.review, operations: [] };
  }
  if (!task.result?.summary?.trim() || input.decision === 'approved' && task.result.outcome !== 'success') {
    throw new MapError('RESULT_REQUIRED', 'Approval requires the Agent success result and summary', 409);
  }
  const reviewedAt = new Date().toISOString();
  const review = { ...input, reviewedAt };
  const identity = createHash('sha256').update(JSON.stringify([input.nodeId, input.kind, input.itemId, input.taskId, input.resultVersion])).digest('hex');
  const updated = { ...item, review, status: input.decision === 'approved' ? (input.kind === 'bug' ? 'resolved' : 'done') : (input.kind === 'bug' ? 'open' : 'pending') };
  // Feedback itself is the durable pending queue entry. No model is dispatched.
  if (input.decision === 'rejected') updated.reviewFeedback = [...(item.reviewFeedback || []), { id: `feedback-${identity}`, status: 'pending', sessionId: input.sessionId, taskId: input.taskId, resultVersion: input.resultVersion, reason: input.reason, createdAt: reviewedAt }];
  const fields = { [field]: node[field].map(value => value === item ? updated : value) };
  if (input.decision === 'approved') {
    const id = `experience-${identity}`;
    fields.memories = [...(node.memories || []).filter(memory => memory.id !== id), { id, text: task.result.summary, state: 'success', files: [], taskId: input.taskId, resultVersion: input.resultVersion, acceptedAt: reviewedAt }];
  }
  return { review, operations: [{ type: 'update', id: node.id, fields }] };
}

export function pendingReviewFeedback(document) {
  return [...entries(document.root).values()].flatMap(({ node }) => ['bugs', 'todos'].flatMap(field => (node[field] || [])
    .flatMap(item => (item.reviewFeedback || []).filter(feedback => feedback.status === 'pending')
      .map(feedback => ({ ...feedback, nodeId: node.id, kind: field === 'bugs' ? 'bug' : 'todo', itemId: item.id, title: item.title || item.desc || '' })))));
}
