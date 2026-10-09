import path from 'node:path';
import { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { canonical, MAX_MESSAGE_BYTES, validateMessage } from '../shared/protocol.mjs';
import { hash } from '../shared/io.mjs';
import { cursorCiSourcePath } from './cursor-ci-source.mjs';

const channel = 'context-guard-cursor-ci';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const only = (value, fields) => record(value) && Object.keys(value).every(key => fields.includes(key));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const bounded = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const fail = code => { throw Object.assign(new Error('Assigned Cursor CI channel is unavailable'), { code }); };
const safeCode = cause => /^[A-Z][A-Z0-9_]{0,99}$/.test(cause?.code || '') ? cause.code : 'CI_CHANNEL_FAILED';
const scopeOf = context => ({ mode: context.mode, session: { id: context.session.id, generation: context.session.generation },
  taskId: context.taskId, sourceSha: context.sourceSha, ciTodoRef: context.ciTodoRef, references: context.references, commands: context.commands,
  tester: { sessionId: context.tester.sessionId, nativeSessionId: context.tester.nativeSessionId,
    deliveryId: context.tester.deliveryId, workerPid: context.tester.workerPid } });
const size = value => { try { return Buffer.byteLength(JSON.stringify(value)); } catch { return Infinity; } };
const validTimeout = value => Number.isSafeInteger(value) && value >= 100 && value <= 40000;

// Host-only registration pin. Unrelated capabilities/bindings may change, but
// another origin or login can never revive this worker's original authority.
export async function pinCursorCiAuthority({ readAuthority } = {}) {
  if (typeof readAuthority !== 'function') fail('CI_CHANNEL_CONFIG_INVALID');
  let initial, closed = false;
  const check = async () => {
    if (closed) fail('CI_AUTHORITY_CHANGED');
    try {
      const value = await readAuthority();
      if (closed || !bounded(value?.origin) || !bounded(value?.credential)) fail('CI_AUTHORITY_CHANGED');
      const identity = hash(canonical({ origin: value.origin, credential: value.credential,
        repositoryId: value.repositoryId ?? null, deviceId: value.deviceId ?? null,
        agentId: value.agentId ?? null, role: value.role ?? null }));
      if (initial !== undefined && initial !== identity) fail('CI_AUTHORITY_CHANGED');
      initial = identity;
      return identity; // Never return registration metadata or the credential.
    } catch (cause) { closed = true; throw cause; }
  };
  await check();
  return check;
}

// Reads only fixed original objects through the host's device connection, not
// the public CI actor. This is preparation, NOT current Cloud task authority.
// Activation/result commit must additionally check the tuple in Core's lock.
export async function readCursorCiHostContext({ context, readExecution, readObject } = {}) {
  if (typeof readExecution !== 'function' || typeof readObject !== 'function' || !context?.session ||
      !bounded(context.taskId) || !bounded(context.ciTodoRef) || !bounded(context.references?.[context.ciTodoRef])) fail('CI_HOST_CONTEXT_REQUIRED');
  const active = await readExecution();
  if (active?.taskId !== context.taskId || active.mode !== 'reviewed' || active.closed || !bounded(active.approval) ||
      !bounded(active.plan?.ref) || !bounded(active.plan.version) || !/^[a-f0-9]{40}$/.test(active.plan.sourceSha || '')) fail('CI_APPROVED_PLAN_REQUIRED');
  const fixed = canonical({ taskId: active.taskId, mode: active.mode, closed: !!active.closed, plan: active.plan, approval: active.approval });
  const unchanged = async () => {
    const current = await readExecution();
    if (!current || canonical({ taskId: current.taskId, mode: current.mode, closed: !!current.closed,
      plan: current.plan, approval: current.approval }) !== fixed) fail('CI_TASK_CHANGED');
  };
  const read = async (ref, version, kind) => {
    await unchanged();
    const result = await readObject(ref, version);
    await unchanged();
    if (result?.ref !== ref || result.version !== version || result.kind !== kind || !record(result.content) ||
        size(result) > MAX_MESSAGE_BYTES) fail('CI_HOST_CONTEXT_INVALID');
    return result;
  };
  const plan = await read(active.plan.ref, active.plan.version, 'plan');
  const receipt = await read(active.approval, active.approval, 'reviewReceipt');
  if (receipt.content.kind !== 'plan' || receipt.content.decision !== 'approved' ||
      receipt.content.ref !== plan.ref || receipt.content.version !== plan.version ||
      receipt.content.receiptId !== active.approval || !bounded(receipt.content.issuer)) fail('CI_APPROVED_PLAN_REQUIRED');
  const paths = plan.content.paths;
  if (!Array.isArray(paths) || !paths.length || paths.length > 128 || new Set(paths).size !== paths.length ||
      !paths.every(cursorCiSourcePath)) fail('CI_HOST_CONTEXT_INVALID');
  const ciTodo = await read(context.ciTodoRef, context.references[context.ciTodoRef], 'ciTodo');
  if (!Array.isArray(ciTodo.content.items) || !ciTodo.content.items.length ||
      ciTodo.content.items.some(item => !bounded(item?.id) || item.id.length > 128) ||
      new Set(ciTodo.content.items.map(item => item.id)).size !== ciTodo.content.items.length) fail('CI_HOST_CONTEXT_INVALID');
  return { authorization: 'preparation-only', approvedPlan: { ref: plan.ref, version: plan.version,
    sourceSha: active.plan.sourceSha, approvalReceiptId: active.approval, paths: [...paths] }, ciTodo: structuredClone(ciTodo) };
}

// The original HTTP client and its full Agent credential remain in the host.
// Both held-native callbacks and the owning Node worker use this fixed scope.
export async function bindCursorCiClient({ client, readBinding, readHostContext, testerSessionId, nativeSessionId, deliveryId, workerPid,
  root, ttlMs = 1800000, now = Date.now } = {}) {
  if (typeof client?.context !== 'function' || typeof client?.exchange !== 'function' || typeof readBinding !== 'function' ||
      !uuid.test(testerSessionId || '') || !bounded(nativeSessionId) || !bounded(deliveryId) || !path.isAbsolute(root || '') ||
      path.resolve(root) !== root || !Number.isSafeInteger(workerPid) || workerPid <= 0 || typeof now !== 'function' ||
      !Number.isSafeInteger(ttlMs) || ttlMs < 100 || ttlMs > 1800000) fail('CI_CHANNEL_CONFIG_INVALID');
  const abort = new AbortController(), expiresAt = now() + ttlMs;
  let closed = false;
  const close = () => { closed = true; clearTimeout(expiry); abort.abort(); };
  const expiry = setTimeout(close, ttlMs); expiry.unref?.();
  const available = () => { if (closed || now() >= expiresAt) { close(); fail('CI_CAPABILITY_EXPIRED'); } };
  let fingerprint, hostFingerprint;
  const fresh = async () => {
    try {
      available();
      const binding = await readBinding();
      available();
      if (!only(binding, ['epoch', 'bindingVersion', 'worktreeId', 'generation', 'sessionId', 'nativeSessionId', 'root']) ||
          !['epoch', 'bindingVersion', 'worktreeId'].every(key => bounded(binding[key])) ||
          !Number.isSafeInteger(binding.generation) || binding.generation < 1 || binding.root !== root ||
          binding.sessionId !== testerSessionId || binding.nativeSessionId !== nativeSessionId) fail('CI_NATIVE_MISMATCH');
      const current = await client.context(); // Original object.read rechecks task/role authority.
      available();
      const confirmedBinding = await readBinding();
      available();
      if (canonical(confirmedBinding) !== canonical(binding)) fail('CI_TASK_CHANGED');
      if (!record(current) || current.mode !== 'ci' || !uuid.test(current.session?.id || '') || current.session.id === testerSessionId ||
          !Number.isSafeInteger(current.session.generation) || current.session.generation < 1 || !bounded(current.taskId) ||
          !/^[a-f0-9]{40}$/.test(current.sourceSha || '') || !record(current.references) || !bounded(current.ciTodoRef) ||
          !Object.hasOwn(current.references, current.ciTodoRef) || !bounded(current.references[current.ciTodoRef]) ||
          Object.entries(current.references).some(([ref, version]) => !bounded(ref) || !bounded(version)) ||
          !Array.isArray(current.commands) || !current.commands.length || current.commands.length > 20 || current.commands.some(value => !bounded(value)) ||
          current.tester?.sessionId !== testerSessionId || current.tester?.nativeSessionId !== nativeSessionId ||
          current.tester?.deliveryId !== deliveryId || current.tester?.workerPid !== workerPid) fail('CI_NATIVE_MISMATCH');
      const context = scopeOf(current), currentFingerprint = canonical({ binding, context });
      if (fingerprint !== undefined && currentFingerprint !== fingerprint) fail('CI_TASK_CHANGED');
      fingerprint = currentFingerprint;
      return context;
    } catch (cause) { close(); throw cause; }
  };
  try { await fresh(); } catch (cause) { close(); throw cause; }
  return {
    signal: abort.signal, close,
    async context(options = {}) {
      if (!only(options, ['ciResult'])) fail('CI_ARGUMENT_INVALID');
      if (options.ciResult !== undefined && options.ciResult !== false) fail('CI_TEST_PROOF_REQUIRED');
      return fresh();
    },
    async hostContext(options = {}) {
      if (!only(options, []) || typeof readHostContext !== 'function') fail('CI_HOST_CONTEXT_REQUIRED');
      try {
        const context = await fresh(), result = await readHostContext(context);
        await fresh();
        if (!only(result, ['authorization', 'approvedPlan', 'ciTodo']) || size(result) > MAX_MESSAGE_BYTES ||
            result.authorization !== 'preparation-only' ||
            !only(result.approvedPlan, ['ref', 'version', 'sourceSha', 'approvalReceiptId', 'paths']) ||
            !['ref', 'version', 'approvalReceiptId'].every(key => bounded(result.approvedPlan[key])) ||
            !/^[a-f0-9]{40}$/.test(result.approvedPlan.sourceSha || '') || !Array.isArray(result.approvedPlan.paths) ||
            !result.approvedPlan.paths.length || result.approvedPlan.paths.length > 128 ||
            new Set(result.approvedPlan.paths).size !== result.approvedPlan.paths.length ||
            !result.approvedPlan.paths.every(cursorCiSourcePath) || !only(result.ciTodo, ['ref', 'version', 'kind', 'content']) ||
            result.ciTodo.ref !== context.ciTodoRef || result.ciTodo.version !== context.references[context.ciTodoRef] ||
            result.ciTodo.kind !== 'ciTodo' || !record(result.ciTodo.content)) fail('CI_HOST_CONTEXT_INVALID');
        const current = canonical(result);
        if (hostFingerprint !== undefined && hostFingerprint !== current) fail('CI_TASK_CHANGED');
        hostFingerprint = current;
        return structuredClone(result);
      } catch (cause) { close(); throw cause; }
    },
    async exchange(input) {
      const context = await fresh(), message = validateMessage(input);
      if (canonical(message.session) !== canonical(context.session)) fail('CI_MESSAGE_FORBIDDEN');
      const own = message.payload.ref?.startsWith(`ci:${testerSessionId}:`);
      const reserved = message.payload.ref?.startsWith(`ci:${testerSessionId}:host:`);
      const assigned = Object.hasOwn(context.references, message.payload.ref) && context.references[message.payload.ref] === message.payload.version;
      if (message.type === 'ci.result') fail('CI_TEST_PROOF_REQUIRED'); // Full host proof/transaction gate is not wired yet.
      if (!['object.read', 'object.put'].includes(message.type) || message.type === 'object.read' && !own && !assigned ||
          message.type === 'object.put' && (!own || reserved || message.payload.kind !== 'evidence')) fail('CI_MESSAGE_FORBIDDEN');
      const result = await client.exchange(message);
      await fresh(); // A late response or old receipt cannot restore revoked scope.
      return result;
    },
  };
}

// This endpoint belongs to one ChildProcess created by the workbench. It is
// not an HTTP server, generic RPC, task queue or a vendor model harness.
export function serveCursorCiWorker({ worker, openClient, timeoutMs = 10000 } = {}) {
  if (!(worker instanceof ChildProcess) || !Number.isSafeInteger(worker.pid) || worker.pid <= 0 || !worker.connected ||
      typeof openClient !== 'function' || !validTimeout(timeoutMs)) fail('CI_CHANNEL_CONFIG_INVALID');
  let closed = false, client, opening, pending = 0;
  const seen = new Set(), timers = new Set();
  const close = () => {
    if (closed) return;
    closed = true; client?.close();
    for (const timer of timers) clearTimeout(timer);
    worker.off('message', receive); worker.off('disconnect', close); worker.off('exit', close); worker.off('error', close);
    if (worker.connected) { try { worker.disconnect(); } catch { /* Already disconnected by this own peer. */ } }
  };
  const open = async () => {
    opening ||= Promise.resolve().then(() => openClient(worker.pid)).then(value => {
      if (closed) { value?.close(); fail('CI_CHANNEL_CLOSED'); }
      if (typeof value?.context !== 'function' || typeof value?.hostContext !== 'function' ||
          typeof value?.exchange !== 'function' || typeof value?.close !== 'function' || !value.signal) {
        value?.close?.(); fail('CI_CHANNEL_CONFIG_INVALID');
      }
      client = value; client.signal.addEventListener('abort', close, { once: true });
      if (client.signal.aborted) { close(); fail('CI_CHANNEL_CLOSED'); }
      return value;
    });
    return opening;
  };
  const send = value => new Promise((resolve, reject) => {
    if (closed || !worker.connected || size(value) > MAX_MESSAGE_BYTES) return reject(Object.assign(new Error('CI response unavailable'), { code: 'CI_CHANNEL_CLOSED' }));
    worker.send(value, cause => cause ? reject(Object.assign(new Error('CI response unavailable'), { code: 'CI_CHANNEL_CLOSED' })) : resolve());
  });
  const receive = input => {
    if (closed) return;
    if (!only(input, ['channel', 'v', 'id', 'type', 'payload']) || input.channel !== channel || input.v !== 1 || !uuid.test(input.id || '') ||
        !['context', 'hostContext', 'exchange'].includes(input.type) || !record(input.payload) || size(input) > MAX_MESSAGE_BYTES ||
        input.type === 'context' && (!only(input.payload, ['ciResult']) || ![undefined, false].includes(input.payload.ciResult)) ||
        input.type === 'hostContext' && !only(input.payload, []) ||
        seen.has(input.id) || seen.size >= 256 || pending >= 4) { close(); return; }
    seen.add(input.id); pending++;
    const timer = setTimeout(close, timeoutMs); timers.add(timer); timer.unref?.();
    void (async () => {
      try {
        const current = await open();
        if (closed) fail('CI_CHANNEL_CLOSED');
        const result = await current[input.type](input.payload);
        if (closed) fail('CI_CHANNEL_CLOSED');
        await send({ channel, v: 1, id: input.id, result });
      } catch (cause) {
        if (!closed) {
          try { await send({ channel, v: 1, id: input.id, error: { code: safeCode(cause) } }); }
          finally { close(); }
        }
      } finally { clearTimeout(timer); timers.delete(timer); pending--; }
    })().catch(close);
  };
  worker.on('message', receive); worker.once('disconnect', close); worker.once('exit', close); worker.once('error', close);
  return { close };
}

// Called by the owning Node worker, never by Cursor CLI. No identity, URL or
// credential is accepted from this peer; the host fixes all of them.
export function connectCursorCiWorkerClient({ peer = process, timeoutMs = 10000 } = {}) {
  if (typeof peer?.send !== 'function' || typeof peer?.on !== 'function' || !peer.connected || !validTimeout(timeoutMs)) fail('CI_CHANNEL_CONFIG_INVALID');
  const abort = new AbortController(), pending = new Map();
  let closed = false;
  const close = (code = 'CI_CHANNEL_CLOSED') => {
    if (closed) return;
    closed = true; abort.abort();
    peer.off('message', receive); peer.off('disconnect', disconnected);
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(Object.assign(new Error('CI channel closed'), { code })); }
    pending.clear();
    if (peer.connected) { try { peer.disconnect(); } catch { /* Own IPC peer already closed. */ } }
  };
  const disconnected = () => close();
  const receive = input => {
    if (!only(input, ['channel', 'v', 'id', 'result', 'error']) || input.channel !== channel || input.v !== 1 || !uuid.test(input.id || '') ||
        Object.hasOwn(input, 'result') === Object.hasOwn(input, 'error') || size(input) > MAX_MESSAGE_BYTES) { close(); return; }
    const waiter = pending.get(input.id);
    if (!waiter) { close(); return; }
    pending.delete(input.id); clearTimeout(waiter.timer);
    if (input.error) {
      const code = safeCode(input.error); waiter.reject(Object.assign(new Error('CI operation rejected'), { code })); close();
    } else waiter.resolve(input.result);
  };
  peer.on('message', receive); peer.once('disconnect', disconnected);
  const request = (type, payload) => new Promise((resolve, reject) => {
    if (closed) return reject(Object.assign(new Error('CI channel closed'), { code: 'CI_CHANNEL_CLOSED' }));
    if (pending.size >= 4) return reject(Object.assign(new Error('CI channel busy'), { code: 'CI_CHANNEL_BUSY' }));
    const id = randomUUID(), input = { channel, v: 1, id, type, payload };
    if (size(input) > MAX_MESSAGE_BYTES) return reject(Object.assign(new Error('CI input too large'), { code: 'CI_INPUT_LIMIT' }));
    const timer = setTimeout(() => close('CI_CHANNEL_TIMEOUT'), timeoutMs); timer.unref?.();
    pending.set(id, { resolve, reject, timer });
    peer.send(input, cause => { if (cause) close(); });
  });
  return { signal: abort.signal, close: () => close(), context: (options = {}) => request('context', options),
    hostContext: (options = {}) => request('hostContext', options), exchange: input => request('exchange', input) };
}
