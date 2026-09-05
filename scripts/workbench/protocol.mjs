// Shared wire validation. Authentication and business authorization run separately.
export class ProtocolError extends Error {
  constructor(code, message, details) {
    super(message); this.code = code; this.details = details;
    this.status = ({ UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, ID_REUSED: 409, STALE_SESSION: 409, TOO_LARGE: 413, UNAVAILABLE: 503 })[code] || 400;
  }
}
export const fail = (code, message, details) => { throw new ProtocolError(code, message, details); };
export const MAX_MESSAGE_BYTES = 256 * 1024;
const check = (ok, where) => { if (!ok) fail('INVALID_ARGUMENT', `Invalid ${where}`); };
const string = (max = 128, empty = false) => (v, p) => check(typeof v === 'string' && (empty || v.trim().length > 0) && v.length <= max, p);
const id = string(), version = string(4096), emptyVersion = string(4096, true), text = string(2000);
const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => (v, p) => check(Number.isSafeInteger(v) && v >= min && v <= max, p);
const choice = (...values) => (v, p) => check(values.includes(v), p);
const optional = rule => Object.assign((v, p) => { if (v !== undefined) rule(v, p); }, { optional: true });
const object = fields => (v, p = 'payload') => {
  check(v !== null && typeof v === 'object' && !Array.isArray(v), p);
  check(Object.keys(v).every(k => Object.hasOwn(fields, k)), `${p} fields`);
  for (const [key, rule] of Object.entries(fields)) { check(rule.optional || Object.hasOwn(v, key), `${p}.${key}`); rule(v[key], `${p}.${key}`); }
};
const array = (rule, min = 0, max = 100) => (v, p) => { check(Array.isArray(v) && v.length >= min && v.length <= max, p); v.forEach((x, i) => rule(x, `${p}[${i}]`)); };
const ids = (v, p) => { array(id, 1)(v, p); check(new Set(v).size === v.length, p); };
const jsonObject = (v, p) => check(v !== null && typeof v === 'object' && !Array.isArray(v), p);
const sha = (v, p) => check(typeof v === 'string' && /^[a-f0-9]{40}$/.test(v), p);
const session = object({ id, generation: integer(1) });
const refs = array(id);
const reportData = {
  planReady: object({ planRef: id, planVersion: version, sourceSha: sha }),
  progress: object({ seq: integer(), summary: text }),
  interrupted: object({ reason: text, occurredAt: (v, p) => check(typeof v === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)), p) }),
  handoff: object({ sourceSha: sha, ciTodoRef: id, unitTestRefs: refs, experienceRefs: refs }),
  cancelled: object({ controlId: id }), resumed: object({ controlId: id }), closed: object({ controlId: id, closeReceiptId: id }),
};
const controls = {
  cancel: object({ reason: text }), resume: object({ reason: text }),
  complete: object({ gitReceiptRef: optional(id), cloudReceiptRef: optional(id), archiveReceiptRef: id }),
};
const fields = {
  node: { parentId: optional(id), title: text, purpose: optional(text), kind: choice('module', 'work'), state: choice('dirty', 'untested', 'success', 'failed'), order: optional(integer()), proposal: optional(choice('proposed', 'accepted', 'cancelled')),
    owns: optional(array(string(500), 1)), proposalEvidence: optional(object({ parentId: id, basis: choice('new-module', 'new-interface', 'new-component', 'new-responsibility'), reason: string(1000), files: array(string(500), 1) })) },
  todo: { nodeId: id, title: text, status: choice('pending', 'processing', 'done'), description: optional(text) },
  bug: { nodeId: id, title: text, status: choice('open', 'resolved'), reproduction: optional(text) },
  message: { nodeId: optional(id), text },
  memory: { nodeId: id, text, refs: optional(array(object({ ref: id, version }))) },
  idea: { nodeId: id, text, refs: optional(array(object({ ref: id, version }))) },
  relation: { from: id, to: id, label: optional(text) },
  access: { nodeId: id, agentId: id, allow: choice('read', 'write', 'none') },
};
const change = (v, p) => {
  object({ op: choice('create', 'update', 'delete'), kind: choice(...Object.keys(fields)), id, fields: optional(jsonObject) })(v, p);
  if (v.op === 'delete') { check(!Object.hasOwn(v, 'fields'), p); return; }
  const rules = v.op === 'update' ? Object.fromEntries(Object.entries(fields[v.kind]).map(([k, r]) => [k, optional(r)])) : fields[v.kind];
  object(rules)(v.fields, `${p}.fields`);
  check(Object.keys(v.fields).length > 0, `${p}.fields`);
};
export const payloadRules = {
  'object.put': object({ kind: choice('plan', 'evidence', 'experience', 'ciTodo'), ref: id, baseVersion: emptyVersion, content: jsonObject }),
  'object.read': object({ ref: id, version }),
  'auth.open': object({ repository: string(2048), password: string(1024), clientId: id }),
  'auth.close': object({}),
  'sync.heartbeat': object({ sessions: array(object({ id, generation: integer(1), ackedSeq: integer() })) }),
  'sync.read': object({ afterSeq: integer(), limit: integer(1, 100) }),
  'sync.ack': object({ items: array((v, p) => { object({ seq: integer(1), outcome: choice('applied', 'rejected', 'cancelled'), reason: optional(text) })(v, p); check(v.outcome === 'applied' || !!v.reason, p); }, 1) }),
  'sync.event': object({ latestSeq: integer() }),
  'workbench.patch': object({ baseVersion: version, changes: array(change, 1) }),
  'workbench.read': v => {
    object({ scope: choice('main', 'session'), nodeIds: optional(ids), version: optional(version), cursor: string(4096, true), limit: integer(1, 100), recovery: optional(choice(true, false)) })(v);
    check(!v.recovery || v.scope === 'session' && !v.nodeIds, 'recovery scope');
  },
  'blob.put': object({ name: string(255), size: integer(0, 64 * 1024 * 1024), sha256: (v, p) => check(typeof v === 'string' && /^[a-f0-9]{64}$/.test(v), p), mediaType: string(255) }),
  'blob.get': object({ blobId: id }),
  'merge.request': object({ sessionVersion: version, baseMainVersion: version, sourceSha: sha, contentRef: id }),
  'merge.result': v => { object({ mergeId: id, state: choice('merged', 'conflict', 'failed'), mainVersion: optional(version), error: optional(text) })(v); check(v.state === 'merged' ? !!v.mainVersion : !!v.error, 'merge result'); },
  'brief.submit': object({ taskId: id, text }),
  'review.request': v => { object({ kind: choice('brief', 'plan'), ref: id, version, taskId: id, requirementsRef: optional(id), requirementsVersion: optional(version), rulesVersion: optional(version) })(v); if (v.kind === 'plan') check(!!v.requirementsRef && !!v.requirementsVersion && !!v.rulesVersion, 'plan review references'); },
  'review.result': object({ kind: choice('brief', 'plan'), ref: id, version, decision: choice('approved', 'rejected'), reason: text, receiptId: optional(id) }),
  'task.assign': object({ taskId: id, briefRef: id, briefVersion: version, sessionId: id, nodeIds: ids, mainVersion: version }),
  'task.report': v => { object({ taskId: id, stage: choice(...Object.keys(reportData)), data: jsonObject })(v); reportData[v.stage](v.data); },
  'task.rework': object({ taskId: id, sourceSha: sha, ciResultRef: id, failedTestIds: ids }),
  'ci.request': object({ taskId: id, sourceSha: sha, ciTodoRef: id, unitTestRefs: refs }),
  'ci.result': object({ taskId: id, sourceSha: sha, verdict: choice('passed', 'failed', 'incomplete'), checks: array(v => { object({ testId: id, todoId: id, status: choice('passed', 'failed', 'incomplete'), evidenceRef: id, reproductionRef: optional(id) })(v); check(v.status !== 'failed' || !!v.reproductionRef, 'failed check reproduction'); }, 1) }),
  'executor.state': v => { object({ agentId: id, state: choice('busy', 'idle'), taskId: optional(id) })(v); check(v.state === 'busy' ? !!v.taskId : v.taskId === undefined, 'executor task'); },
  'session.bind': object({ sessionId: id, worktreeId: id, agentId: id, expectedBindingVersion: emptyVersion }),
  'task.control': v => { object({ taskId: id, action: choice(...Object.keys(controls)), expectedVersion: version, data: jsonObject })(v); controls[v.action](v.data); },
};
const projectTypes = new Set(['auth.open', 'auth.close', 'sync.heartbeat', 'session.bind']);
export function validateMessage(input) {
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(input)); } catch { fail('INVALID_ARGUMENT', 'Message must be JSON'); }
  if (bytes > MAX_MESSAGE_BYTES) fail('TOO_LARGE', 'Message exceeds 256 KiB');
  const pending = [[input, 0]];
  while (pending.length) {
    const [value, depth] = pending.pop();
    check(depth <= 64, 'JSON nesting depth');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number') { check(Number.isFinite(value), 'JSON number'); continue; }
    check(typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'JSON value');
    for (const child of Object.values(value)) pending.push([child, depth + 1]);
  }
  object({ v: choice(2), id, type: choice(...Object.keys(payloadRules)), session: optional(session), payload: jsonObject })(input, 'message');
  check(projectTypes.has(input.type) ? input.session === undefined : input.session !== undefined, 'message.session');
  payloadRules[input.type](input.payload);
  if (input.type === 'task.assign') check(input.payload.sessionId === input.session.id, 'assignment session');
  return input;
}
export function errorReply(id, error) {
  const known = error instanceof ProtocolError;
  return { id, ok: false, error: { code: known ? error.code : 'UNAVAILABLE', message: known ? error.message : 'Operation temporarily unavailable', retryable: !known || error.code === 'UNAVAILABLE', ...(known && error.details ? { details: error.details } : {}) } };
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
