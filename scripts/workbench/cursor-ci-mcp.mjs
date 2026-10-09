import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonical, validateMessage, MAX_MESSAGE_BYTES } from '../shared/protocol.mjs';
import { verifyCursorCiSource } from './cursor-ci-source.mjs';

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = (code, message = 'Current CI operation is unavailable') => { throw Object.assign(new Error(message), { code }); };
const noExtra = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const safeCode = (cause, fallback) => /^[A-Z][A-Z0-9_]{0,99}$/.test(cause?.code || '') ? cause.code : fallback;
const identity = context => canonical({ session: context.session, taskId: context.taskId, sourceSha: context.sourceSha,
  ciTodoRef: context.ciTodoRef, references: context.references, commands: context.commands, tester: context.tester });

// The full local Agent credential stays in this host client, never in MCP or the
// test process. Both requests use the existing public CI endpoints and gates.
export class OriginalCursorCiClient {
  constructor({ origin, credential, fetcher = fetch, timeoutMs = 10000 }) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || typeof credential !== 'string' || credential.length < 32 ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 40000) fail('CI_CONFIG_INVALID');
    this.origin = url.origin; this.credential = credential; this.fetcher = fetcher; this.timeoutMs = timeoutMs;
  }
  async request(route, body) {
    let response;
    try {
      response = await this.fetcher(new URL(route, this.origin), { method: body ? 'POST' : 'GET', redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs), headers: { Authorization: `Bearer ${this.credential}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { fail('CI_CONNECTION_UNAVAILABLE'); }
    if ([401, 403].includes(response.status)) fail('CI_AUTHORIZATION_REJECTED');
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) fail('CI_RECEIPT_INVALID');
    let data;
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > MAX_MESSAGE_BYTES) fail('CI_REPLY_TOO_LARGE');
        chunks.push(chunk);
      }
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { fail('CI_RECEIPT_INVALID'); }
    if (!response.ok) fail('CI_OPERATION_REJECTED');
    if (body && (data?.id !== body.id || data.ok !== true || !Object.hasOwn(data, 'data'))) fail('CI_RECEIPT_INVALID');
    return body ? data.data : data;
  }
  exchange(message) { validateMessage(message); return this.request('/api/v2/ci', message); }
  async context({ ciResult = false } = {}) {
    const context = (await this.request('/api/v2/execution')).active;
    if (!record(context) || context.mode !== 'ci' || !record(context.references) ||
        !Object.hasOwn(context.references, context.ciTodoRef) || typeof context.references[context.ciTodoRef] !== 'string' ||
        !context.references[context.ciTodoRef].trim() || context.references[context.ciTodoRef].length > 4096 ||
        typeof context.taskId !== 'string' || !context.taskId || !/^[a-f0-9]{40}$/.test(context.sourceSha || '') ||
        !uuid.test(context.session?.id || '') || !Number.isSafeInteger(context.session.generation) || context.session.generation < 1) {
      fail('CI_NOT_ACTIVE');
    }
    // Local delivery state alone is not current Cloud authority. This ordinary
    // object.read rechecks the original active task/role before every operation.
    // CI 终态结果由原 ci.result 事务鉴权并重放准确回执。不得先读旧
    // testing 引用，否则合法转阶段会变成误报，且无法查询未知回执。
    if (!ciResult) await this.exchange({ v: 2, id: randomUUID(), type: 'object.read', session: context.session,
      payload: { ref: context.ciTodoRef, version: context.references[context.ciTodoRef] } });
    return context;
  }
}

const tools = [
  { name: 'context_guard_context', description: 'Read the assigned CI task and fixed test IDs; no caller-selected identity.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'context_guard_source', description: 'Read an approved file from the exact assigned commit snapshot.',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string', minLength: 1, maxLength: 4096 } }, additionalProperties: false } },
  { name: 'context_guard_test', description: 'Run one host-declared test ID under the original request ID; never specify shell, argv or environment.',
    inputSchema: { type: 'object', required: ['id', 'testId'], properties: { id: { type: 'string', minLength: 1, maxLength: 128 }, testId: { type: 'string', minLength: 1, maxLength: 128 } }, additionalProperties: false } },
  { name: 'context_guard_exchange', description: 'Send stable-ID evidence or a tested result to the original CI channel. No approvals, Plan writes or Main operations.',
    inputSchema: { type: 'object', required: ['id', 'type', 'payload'], properties: {
      id: { type: 'string', minLength: 1, maxLength: 128 }, type: { enum: ['object.read', 'object.put', 'ci.result'] }, payload: { type: 'object' } }, additionalProperties: false } },
];
export const CURSOR_CI_TOOL_NAMES = Object.freeze(tools.map(tool => tool.name));

// One capability per native CI turn. Business truth/receipts remain in the
// original protocol; this server has no task queue or model loop.
async function createCiTurn({ client, testerSessionId, nativeSessionId, source, tests = [], runTest,
  verifyResult, ttlMs = 1800000, now = Date.now } = {}) {
  if (!client || typeof client.context !== 'function' || typeof client.exchange !== 'function' || !uuid.test(testerSessionId || '') ||
      typeof nativeSessionId !== 'string' || !nativeSessionId || nativeSessionId.length > 256 ||
      !Array.isArray(tests) || tests.length > 20 || tests.some(id => typeof id !== 'string' || !id || id.length > 128) ||
      new Set(tests).size !== tests.length || !Number.isSafeInteger(ttlMs) || ttlMs < 100 || ttlMs > 1800000) fail('CI_CONFIG_INVALID');
  const scope = await client.context(), fingerprint = identity(scope), expiresAt = now() + ttlMs;
  if (scope.tester?.sessionId !== testerSessionId || scope.tester?.nativeSessionId !== nativeSessionId ||
      scope.tester?.workerPid !== process.pid ||
      typeof scope.tester?.deliveryId !== 'string' || !scope.tester.deliveryId || scope.tester.deliveryId.length > 256) fail('CI_NATIVE_MISMATCH');
  if (source && source.manifest?.sourceSha !== scope.sourceSha) fail('CI_SOURCE_CHANGED');
  const abort = new AbortController();
  const expiry = setTimeout(() => abort.abort(), ttlMs); expiry.unref?.();
  let closed = false;
  const fresh = async (ciResult = false) => { try {
    if (closed || abort.signal.aborted || now() >= expiresAt) fail('CI_CAPABILITY_EXPIRED');
    const current = await client.context({ ciResult });
    if (identity(current) !== fingerprint) fail('CI_TASK_CHANGED');
    if (closed || abort.signal.aborted || now() >= expiresAt) fail('CI_CAPABILITY_EXPIRED');
    return current;
  } catch (cause) { abort.abort(); throw cause; }
  };
  const call = async (name, args) => {
    const ciResult = name === 'context_guard_exchange' && args?.type === 'ci.result';
    const context = await fresh(ciResult);
    let result;
    if (name === 'context_guard_context') {
      if (!noExtra(args, []) || Object.keys(args).length) fail('CI_ARGUMENT_INVALID');
      result = { role: 'ci', session: context.session, taskId: context.taskId, sourceSha: context.sourceSha,
        ciTodoRef: context.ciTodoRef, references: context.references, writePrefix: `ci:${testerSessionId}:`,
        testIds: tests, ...(source ? { sourceFiles: Object.keys(source.manifest.files), manifestSha256: source.manifestSha256 } : {}) };
    } else if (name === 'context_guard_source') {
      if (!noExtra(args, ['path']) || typeof args.path !== 'string' || !source || !Object.hasOwn(source.manifest.files, args.path)) fail('CI_SOURCE_FORBIDDEN');
      await verifyCursorCiSource(source);
      const bytes = await fs.readFile(path.join(source.snapshot, ...args.path.split('/')));
      if (bytes.length > 65536) fail('CI_SOURCE_READ_LIMIT');
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { fail('CI_SOURCE_NOT_TEXT'); }
      result = { path: args.path, sourceSha: context.sourceSha, sha256: source.manifest.files[args.path].sha256, text };
      await verifyCursorCiSource(source);
    } else if (name === 'context_guard_test') {
      if (!noExtra(args, ['id', 'testId']) || typeof args.id !== 'string' || !args.id || args.id.length > 128 || !tests.includes(args.testId)) fail('CI_TEST_FORBIDDEN');
      if (typeof runTest !== 'function') fail('CI_RUNNER_UNAVAILABLE');
      result = await runTest({ id: args.id, testId: args.testId }, { context, source, signal: abort.signal });
    } else if (name === 'context_guard_exchange') {
      if (!noExtra(args, ['id', 'type', 'payload']) || !['object.read', 'object.put', 'ci.result'].includes(args.type)) fail('CI_MESSAGE_FORBIDDEN');
      const message = validateMessage({ v: 2, ...args, session: context.session });
      const own = message.payload.ref?.startsWith(`ci:${testerSessionId}:`);
      const assigned = Object.hasOwn(context.references, message.payload.ref) && context.references[message.payload.ref] === message.payload.version;
      if (message.type === 'object.read' && !own && !assigned || message.type === 'object.put' && (!own || message.payload.kind !== 'evidence') ||
          message.type === 'ci.result' && (message.payload.taskId !== context.taskId || message.payload.sourceSha !== context.sourceSha)) fail('CI_MESSAGE_FORBIDDEN');
      if (message.type === 'ci.result') {
        if (typeof verifyResult !== 'function') fail('CI_TEST_PROOF_REQUIRED');
        await verifyResult(message, { context, source });
        await fresh(true);
      }
      result = await client.exchange(message); // Original ID, original receipts.
      if (message.type === 'ci.result') return result; // 已鉴权的原终态回执是本次操作真值。
    } else fail('CI_TOOL_UNKNOWN');
    await fresh(); // Revocation/drift during a call cannot become a success.
    return result;
  };
  return { fresh, call, revoke() { closed = true; clearTimeout(expiry); abort.abort(); } };
}

// Both ordinary active turns and pre-session discovery use this exact wire
// contract. Discovery has no original task credential or business grant.
async function createCiHttp({ fresh, call, onClose }) {
  const credential = `cgci_${randomBytes(32).toString('base64url')}`;
  const key = Buffer.from(credential);
  let initialized = false, protocolVersion = null, endpoint, closing;
  const server = http.createServer(async (req, res) => {
    let input;
    const send = (status, body) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    try {
      if (req.headers.host !== new URL(endpoint).host || req.url !== '/ci' || req.headers.origin || req.headers.cookie) fail('CI_ENDPOINT_FORBIDDEN');
      const supplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      if (supplied.length !== key.length || !timingSafeEqual(supplied, key)) return send(401, { error: { code: 'CI_CAPABILITY_REQUIRED' } });
      if (req.method !== 'POST') return send(405, { error: { code: 'METHOD_NOT_ALLOWED' } });
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail('CI_ARGUMENT_INVALID');
      let bytes = 0; const chunks = [];
      req.setTimeout(10000, () => req.destroy());
      for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_MESSAGE_BYTES) fail('CI_INPUT_LIMIT'); chunks.push(chunk); }
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const hasId = Object.hasOwn(input || {}, 'id');
      if (!noExtra(input, ['jsonrpc', 'id', 'method', 'params']) || input.jsonrpc !== '2.0' || typeof input.method !== 'string' ||
          hasId && !(typeof input.id === 'string' && input.id.length > 0 && input.id.length <= 128 || Number.isSafeInteger(input.id))) fail('CI_ARGUMENT_INVALID');
      const params = input.params;
      await fresh(input.method === 'tools/call' && params?.name === 'context_guard_exchange' && params?.arguments?.type === 'ci.result');
      if (input.method === 'initialize') {
        if (!hasId || !record(params) || !record(params.capabilities) || !record(params.clientInfo) ||
            !['2025-03-26', '2025-06-18', '2025-11-25'].includes(params.protocolVersion)) fail('CI_PROTOCOL_INVALID');
        protocolVersion = params.protocolVersion; initialized = false;
        return send(200, { jsonrpc: '2.0', id: input.id, result: { protocolVersion, capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'context-guard-local-ci', version: '0.1.0' } } });
      }
      if (req.headers['mcp-protocol-version'] && req.headers['mcp-protocol-version'] !== protocolVersion) fail('CI_PROTOCOL_INVALID');
      if (input.method === 'notifications/initialized') {
        if (hasId || !protocolVersion || params && (!noExtra(params, ['_meta']))) fail('CI_PROTOCOL_INVALID');
        initialized = true; return send(202);
      }
      if (!initialized || !hasId) fail('CI_PROTOCOL_INVALID');
      if (input.method === 'ping') return send(200, { jsonrpc: '2.0', id: input.id, result: {} });
      if (input.method === 'tools/list') {
        if (params && !noExtra(params, ['_meta'])) fail('CI_ARGUMENT_INVALID');
        return send(200, { jsonrpc: '2.0', id: input.id, result: { tools } });
      }
      if (input.method !== 'tools/call' || !noExtra(params, ['name', 'arguments', '_meta']) || !record(params.arguments)) fail('CI_ARGUMENT_INVALID');
      let result;
      try { result = await call(params.name, params.arguments); }
      catch (cause) { return send(200, { jsonrpc: '2.0', id: input.id, result: { isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: { code: safeCode(cause, 'CI_CALL_FAILED') } }) }] } }); }
      send(200, { jsonrpc: '2.0', id: input.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }],
        ...(record(result) ? { structuredContent: result } : {}) } });
    } catch (cause) {
      send(403, { jsonrpc: '2.0', id: typeof input?.id === 'string' || Number.isSafeInteger(input?.id) ? input.id : null,
        error: { code: -32000, message: safeCode(cause, 'CI_TRANSPORT_FAILED') } });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  endpoint = `http://127.0.0.1:${server.address().port}/ci`;
  return { endpoint, credential, call, close() {
    if (closing) return closing;
    onClose();
    closing = new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
    return closing;
  } };
}

export async function startCursorCiMcp(options) {
  const turn = await createCiTurn(options);
  try { return await createCiHttp({ fresh: turn.fresh, call: turn.call, onClose: () => turn.revoke() }); }
  catch (cause) { turn.revoke(); throw cause; }
}

// The official native client discovers MCP before it returns its Session ID.
// Activate once, only after the original delivery/native/owning PID is known.
// An uncertain or failed activation is not permission to replace that turn.
export async function startCursorCiDiscovery({ ttlMs = 1800000, now = Date.now } = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 100 || ttlMs > 1800000 || typeof now !== 'function') fail('CI_CONFIG_INVALID');
  const startedAt = now();
  if (!Number.isSafeInteger(startedAt)) fail('CI_CONFIG_INVALID');
  const expiresAt = startedAt + ttlMs;
  let closed = false, attempted = false, turn;
  const expire = () => { closed = true; clearTimeout(expiry); turn?.revoke(); };
  const expiry = setTimeout(expire, ttlMs); expiry.unref?.();
  const alive = () => { if (closed || now() >= expiresAt) { expire(); fail('CI_CAPABILITY_EXPIRED'); } };
  const fresh = async ciResult => { alive(); if (turn) await turn.fresh(ciResult); alive(); };
  const call = async (name, args) => { alive(); if (!turn) fail('CI_NOT_ACTIVE'); return turn.call(name, args); };
  let transport;
  try { transport = await createCiHttp({ fresh, call, onClose: expire }); }
  catch (cause) { expire(); throw cause; }
  return { ...transport, async activate(options) {
    alive();
    if (attempted) fail('CI_ALREADY_ACTIVATED');
    attempted = true;
    try {
      if (!noExtra(options, ['client', 'testerSessionId', 'nativeSessionId', 'source', 'tests', 'runTest', 'verifyResult'])) fail('CI_CONFIG_INVALID');
      const remaining = expiresAt - now();
      if (remaining < 100) fail('CI_CAPABILITY_EXPIRED');
      const active = await createCiTurn({ ...options, ttlMs: remaining, now });
      if (closed || now() >= expiresAt) { active.revoke(); fail('CI_CAPABILITY_EXPIRED'); }
      turn = active;
    } catch (cause) { expire(); throw cause; }
  } };
}
