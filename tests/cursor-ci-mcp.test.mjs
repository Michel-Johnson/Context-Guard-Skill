import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OriginalCursorCiClient, startCursorCiMcp } from '../scripts/workbench/cursor-ci-mcp.mjs';
import * as ciTools from '../scripts/workbench/cursor-ci-mcp.mjs';
import { exportCursorCiSource } from '../scripts/workbench/cursor-ci-source.mjs';
import { ProtocolStore } from '../scripts/shared/protocol-store.mjs';
import { scopedObjectKey } from '../scripts/shared/protocol-workflow.mjs';

const testerSessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const executorSessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const scope = () => ({ mode: 'ci', session: { id: executorSessionId, generation: 2 }, taskId: 'task-one',
  sourceSha: 'c'.repeat(40), ciTodoRef: 'todo-one', references: { 'todo-one': 'todo-v3', 'plan-one': 'plan-v2' }, commands: ['fixed-test'],
  tester: { sessionId: testerSessionId, nativeSessionId: 'native-tester', deliveryId: 'assigned-delivery', workerPid: process.pid } });
const config = { testerSessionId, nativeSessionId: 'native-tester', tests: ['fixed-test'] };

// 只替代原 CI 后端依赖；MCP、HTTP、协议校验与提交快照均执行真实产品代码。
async function fixture(t, options = {}) {
  const state = { context: scope(), exchanges: [], reads: 0 };
  const client = { async context() { state.reads++; if (state.revoked) throw Object.assign(new Error('private backend'), { code: 'CI_AUTHORIZATION_REJECTED' }); return structuredClone(state.context); },
    async exchange(message) { state.exchanges.push(message); return { received: message.id }; } };
  const bridge = await startCursorCiMcp({ client, ...config, ...options });
  t.after(() => bridge.close());
  const request = async (message, headers = {}, endpoint = bridge.endpoint) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json',
      Authorization: `Bearer ${bridge.credential}`, ...headers }, body: JSON.stringify(message) });
    const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null, text };
  };
  const initialize = async () => {
    assert.equal((await request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-client', version: '1' } } })).status, 200);
    assert.equal((await request({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  };
  const call = (name, args = {}) => request({ jsonrpc: '2.0', id: 'rpc-call', method: 'tools/call', params: { name, arguments: args } });
  return { bridge, state, request, initialize, call };
}
const toolError = response => JSON.parse(response.body.result.content[0].text).error.code;
const resultMessage = () => ({ id: 'ci-result-stable', type: 'ci.result', payload: { taskId: 'task-one', sourceSha: 'c'.repeat(40),
  verdict: 'passed', checks: [{ testId: 'fixed-test', todoId: 'one', status: 'passed', evidenceRef: `ci:${testerSessionId}:evidence` }] } });

async function discoveryFixture(t, options = {}) {
  assert.equal(typeof ciTools.startCursorCiDiscovery, 'function', 'Native startup needs task-free metadata discovery');
  const bridge = await ciTools.startCursorCiDiscovery(options);
  t.after(() => bridge.close());
  const request = async (method, params, headers = {}) => {
    const message = { jsonrpc: '2.0', ...(method === 'notifications/initialized' ? {} : { id: 'discovery-request' }), method, ...(params ? { params } : {}) };
    const response = await fetch(bridge.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridge.credential}`, ...headers }, body: JSON.stringify(message) });
    const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  assert.equal((await request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-native-discovery', version: '1' } })).status, 200);
  assert.equal((await request('notifications/initialized')).status, 202);
  const state = { context: scope(), exchanges: [] };
  const activation = { ...config, client: { context: async () => structuredClone(state.context), exchange: async message => { state.exchanges.push(message); return { received: message.id }; } } };
  return { bridge, state, activation, request, call: (name, args = {}) => request('tools/call', { name, arguments: args }) };
}

test('dormant MCP discovers the fixed tools without granting task reads, tests or writes', async t => {
  const f = await discoveryFixture(t);
  assert.equal((await f.request('tools/list', undefined, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await f.request('tools/list', undefined, { Origin: 'https://unrelated.invalid' })).status, 403);
  const listed = (await f.request('tools/list')).body.result;
  assert.deepEqual(listed.tools.map(item => item.name), ['context_guard_context', 'context_guard_source', 'context_guard_test', 'context_guard_exchange']);
  for (const name of listed.tools.map(item => item.name)) assert.equal(toolError(await f.call(name)), 'CI_NOT_ACTIVE');
  assert.equal(JSON.stringify(listed).includes('task-one'), false);
  assert.equal(JSON.stringify(listed).includes(f.bridge.credential), false);
  assert.equal(f.state.exchanges.length, 0);
});

test('discovery activated without host proof remains read-only and never falls back to ordinary writes', async t => {
  const f = await discoveryFixture(t); await f.bridge.activate(f.activation);
  assert.equal((await f.call('context_guard_context')).body.result.structuredContent.taskId, scope().taskId);
  const read = { id: 'original-read', type: 'object.read', payload: { ref: 'plan-one', version: 'plan-v2' } };
  assert.equal((await f.call('context_guard_exchange', read)).body.result.structuredContent.received, read.id);
  const put = { id: 'no-host-proof', type: 'object.put', payload: { ref: `ci:${testerSessionId}:evidence`,
    baseVersion: '', kind: 'evidence', content: { observation: 'not host observed' } } };
  const deniedPut = await f.call('context_guard_exchange', put);
  assert.equal(deniedPut.body.result.isError, true, 'missing host proof must not return an ordinary write receipt');
  assert.equal(toolError(deniedPut), 'CI_HOST_PROOF_REQUIRED');
  assert.equal(toolError(await f.call('context_guard_exchange', resultMessage())), 'CI_HOST_PROOF_REQUIRED');
  assert.equal(toolError(await f.call('context_guard_test', { id: 'request', testId: 'fixed-test' })), 'CI_HOST_PROOF_REQUIRED');
  assert.deepEqual(f.state.exchanges, [{ v: 2, ...read, session: scope().session }], 'only the original fixed read reaches the client');
});

test('discovery rejects incomplete or invalid private host callback bundles and burns the original capability', async t => {
  const complete = { runTest: async () => {}, verifyResult: async () => {}, submitVerifiedResult: async () => {} };
  for (const name of Object.keys(complete)) for (const invalid of ['missing', undefined, null, 'model-supplied', {}]) {
    await t.test(`${name}: ${typeof invalid === 'object' && invalid !== null ? 'object' : String(invalid)}`, async t => {
      const f = await discoveryFixture(t), callbacks = { ...complete };
      if (invalid === 'missing') delete callbacks[name]; else callbacks[name] = invalid;
      const original = { endpoint: f.bridge.endpoint, credential: f.bridge.credential };
      await assert.rejects(f.bridge.activate({ ...f.activation, ...callbacks }), { code: 'CI_CONFIG_INVALID' });
      await assert.rejects(f.bridge.activate({ ...f.activation, ...complete }), { code: 'CI_CAPABILITY_EXPIRED' });
      await assert.rejects(f.bridge.call('context_guard_context', {}), { code: 'CI_CAPABILITY_EXPIRED' });
      assert.equal(f.bridge.endpoint, original.endpoint); assert.equal(f.bridge.credential, original.credential);
      assert.equal(f.state.exchanges.length, 0);
    });
  }
  for (const name of Object.keys(complete)) {
    await t.test(`${name}: inherited callback`, async t => {
      const f = await discoveryFixture(t);
      const options = Object.assign(Object.create({ [name]: complete[name] }), f.activation, complete);
      delete options[name];
      assert.equal(Object.hasOwn(options, name), false);
      assert.equal(typeof options[name], 'function', 'prototype provides the callback lost by an object spread');
      const original = { endpoint: f.bridge.endpoint, credential: f.bridge.credential };
      await assert.rejects(f.bridge.activate(options), { code: 'CI_CONFIG_INVALID' });
      await assert.rejects(f.bridge.activate({ ...f.activation, ...complete }), { code: 'CI_CAPABILITY_EXPIRED' });
      await assert.rejects(f.bridge.call('context_guard_context', {}), { code: 'CI_CAPABILITY_EXPIRED' });
      assert.equal(f.bridge.endpoint, original.endpoint); assert.equal(f.bridge.credential, original.credential);
      assert.equal(f.state.exchanges.length, 0);
    });
  }
});

test('dormant MCP activates one original native turn without changing endpoint or protocol', async t => {
  let signal;
  const f = await discoveryFixture(t), original = { endpoint: f.bridge.endpoint, credential: f.bridge.credential };
  const forbidResult = async () => { throw Object.assign(new Error('test-only synthetic host'), { code: 'CI_TEST_PROOF_REQUIRED' }); };
  await f.bridge.activate({ ...f.activation,
    runTest: async (_, bound) => { signal = bound.signal; return { observation: 'synthetic-runner' }; },
    verifyResult: forbidResult, submitVerifiedResult: forbidResult });
  assert.equal(f.bridge.endpoint, original.endpoint); assert.equal(f.bridge.credential, original.credential);
  const context = (await f.call('context_guard_context')).body.result.structuredContent;
  assert.equal(context.taskId, scope().taskId); assert.equal(context.session.id, executorSessionId);
  assert.deepEqual(context.testIds, ['fixed-test']);
  assert.equal((await f.call('context_guard_test', { id: 'original-run', testId: 'fixed-test' })).body.result.structuredContent.observation, 'synthetic-runner');
  await assert.rejects(f.bridge.activate(f.activation), { code: 'CI_ALREADY_ACTIVATED' });
  f.state.context.tester.deliveryId = 'foreign-delivery';
  assert.equal((await f.call('context_guard_context')).body.error.message, 'CI_TASK_CHANGED');
  assert.equal(signal.aborted, true);
  f.state.context = scope();
  assert.equal((await f.call('context_guard_context')).body.error.message, 'CI_CAPABILITY_EXPIRED');
  assert.equal(f.state.exchanges.length, 0);
});

test('closing dormant MCP during activation cannot leak a late business grant or reactivate', async t => {
  const f = await discoveryFixture(t);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), waiting = new Promise(resolve => { release = resolve; });
  const activation = f.bridge.activate({ ...f.activation, client: { ...f.activation.client, context: async () => { entered(); await waiting; return scope(); } } });
  await started;
  const rejection = assert.rejects(activation, { code: 'CI_CAPABILITY_EXPIRED' });
  assert.equal(toolError(await f.call('context_guard_context')), 'CI_NOT_ACTIVE');
  await assert.rejects(f.bridge.activate(f.activation), { code: 'CI_ALREADY_ACTIVATED' });
  await f.bridge.close(); release(); await rejection;
  await assert.rejects(f.bridge.call('context_guard_context', {}), { code: 'CI_CAPABILITY_EXPIRED' });
  await assert.rejects(f.bridge.activate(f.activation), { code: 'CI_CAPABILITY_EXPIRED' });
});

test('dormant MCP failed identity activation burns the capability instead of retrying with a replacement', async t => {
  const f = await discoveryFixture(t);
  f.state.context.tester.workerPid = process.pid + 1;
  await assert.rejects(f.bridge.activate(f.activation), { code: 'CI_NATIVE_MISMATCH' });
  f.state.context = scope();
  await assert.rejects(f.bridge.activate(f.activation), { code: 'CI_CAPABILITY_EXPIRED' });
  assert.equal((await f.call('context_guard_context')).body.error.message, 'CI_CAPABILITY_EXPIRED');
  assert.equal(f.state.exchanges.length, 0);
});

test('dormant MCP cannot renew its startup deadline or choose a new activation clock', async t => {
  let clock = 1000;
  const f = await discoveryFixture(t, { now: () => clock, ttlMs: 100 });
  clock = 1100;
  await assert.rejects(f.bridge.activate(f.activation), { code: 'CI_CAPABILITY_EXPIRED' });
  const g = await discoveryFixture(t);
  await assert.rejects(g.bridge.activate({ ...g.activation, ttlMs: 1800000 }), { code: 'CI_CONFIG_INVALID' });
  await assert.rejects(g.bridge.activate(g.activation), { code: 'CI_CAPABILITY_EXPIRED' });
});

test('local MCP requires its capability, exact endpoint and initialized protocol', async t => {
  const f = await fixture(t);
  const message = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  assert.equal((await f.request(message, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await f.request(message, { Origin: 'https://unrelated.invalid' })).status, 403);
  assert.equal((await f.request(message, { Cookie: 'session=unrelated' })).status, 403);
  assert.equal((await f.request(message, {}, f.bridge.endpoint + '?extra=1')).status, 403);
  assert.equal((await f.request(message)).body.error.message, 'CI_PROTOCOL_INVALID');
  await f.initialize();
  const listed = await f.request(message);
  assert.deepEqual(listed.body.result.tools.map(value => value.name), ['context_guard_context', 'context_guard_source', 'context_guard_test', 'context_guard_exchange']);
  assert.equal((await f.request(message, { 'MCP-Protocol-Version': 'wrong' })).body.error.message, 'CI_PROTOCOL_INVALID');
  const context = (await f.call('context_guard_context')).body.result.structuredContent;
  assert.equal(context.session.id, executorSessionId);
  assert.equal(context.writePrefix, `ci:${testerSessionId}:`);
  assert.deepEqual(context.testIds, ['fixed-test']);
  assert.equal(JSON.stringify(context).includes(f.bridge.credential), false);
});

test('local MCP keeps original message IDs and restricts reads and evidence ownership', async t => {
  const f = await fixture(t); await f.initialize();
  const read = { id: 'stable-read', type: 'object.read', payload: { ref: 'plan-one', version: 'plan-v2' } };
  assert.equal((await f.call('context_guard_exchange', read)).body.result.structuredContent.received, read.id);
  assert.equal(f.state.exchanges[0].session.id, executorSessionId);
  assert.equal(toolError(await f.call('context_guard_exchange', { ...read, payload: { ref: 'plan-one', version: 'plan-v1' } })), 'CI_MESSAGE_FORBIDDEN');
  assert.equal(toolError(await f.call('context_guard_exchange', { ...read, payload: { ref: 'unrelated', version: 'plan-v2' } })), 'CI_MESSAGE_FORBIDDEN');
  const put = { id: 'stable-evidence', type: 'object.put', payload: { kind: 'evidence', ref: `ci:${testerSessionId}:evidence`, baseVersion: '', content: { observation: 'synthetic' } } };
  await f.call('context_guard_exchange', put);
  await f.call('context_guard_exchange', put);
  assert.deepEqual(f.state.exchanges.slice(1).map(value => value.id), ['stable-evidence', 'stable-evidence']);
  assert.equal(toolError(await f.call('context_guard_exchange', { ...put, payload: { ...put.payload, kind: 'plan' } })), 'CI_MESSAGE_FORBIDDEN');
  assert.equal(toolError(await f.call('context_guard_exchange', { ...put, payload: { ...put.payload, ref: 'ci:other:evidence' } })), 'CI_MESSAGE_FORBIDDEN');
  assert.equal(toolError(await f.call('context_guard_exchange', { ...put, type: 'task.control' })), 'CI_MESSAGE_FORBIDDEN');
  assert.equal(f.state.exchanges.length, 3);
});

test('local MCP accepts only fixed test IDs and cannot accept model-selected argv or identity', async t => {
  const seen = [];
  const f = await fixture(t, { runTest: async (args, bound) => { seen.push({ args, bound }); return { outcome: 'observed', id: args.id }; } });
  await f.initialize();
  const run = await f.call('context_guard_test', { id: 'same-test-request', testId: 'fixed-test' });
  assert.equal(run.body.result.structuredContent.outcome, 'observed');
  assert.deepEqual(seen[0].args, { id: 'same-test-request', testId: 'fixed-test' });
  assert.equal(seen[0].bound.context.sourceSha, scope().sourceSha);
  assert.equal(seen[0].bound.signal.aborted, false);
  for (const args of [{ id: 'x', testId: 'other' }, { id: 'x', testId: 'fixed-test', argv: ['sh'] },
    { id: 'x', testId: 'fixed-test', root: '/user' }, { id: 'x', testId: 'fixed-test', env: { TOKEN: 'model' } }]) {
    assert.equal(toolError(await f.call('context_guard_test', args)), 'CI_TEST_FORBIDDEN');
  }
  assert.equal(toolError(await f.call('context_guard_context', { sessionId: 'other' })), 'CI_ARGUMENT_INVALID');
  assert.equal(seen.length, 1);
  await f.bridge.close(); assert.equal(seen[0].bound.signal.aborted, true);
});

test('local MCP never converts missing runner or end-turn into CI success', async t => {
  const f = await fixture(t); await f.initialize();
  assert.equal(toolError(await f.call('context_guard_test', { id: 'test-request', testId: 'fixed-test' })), 'CI_RUNNER_UNAVAILABLE');
  assert.equal(toolError(await f.call('context_guard_exchange', resultMessage())), 'CI_TEST_PROOF_REQUIRED');
  assert.equal(f.state.exchanges.length, 0);
});

test('local MCP binds the registered native Tester and original delivery before issuing tools', async t => {
  for (const tester of [undefined, { ...scope().tester, sessionId: executorSessionId }, { ...scope().tester, nativeSessionId: 'other-native' },
    { ...scope().tester, deliveryId: '' }, { ...scope().tester, workerPid: null }, { ...scope().tester, workerPid: process.pid + 1 }]) {
    await assert.rejects(startCursorCiMcp({ ...config, client: { context: async () => ({ ...scope(), tester }), exchange: async () => {} } }), { code: 'CI_NATIVE_MISMATCH' });
  }
  const f = await fixture(t); await f.initialize();
  f.state.context.tester.deliveryId = 'replacement-delivery';
  assert.equal((await f.call('context_guard_context')).body.error.message, 'CI_TASK_CHANGED');
  assert.equal(f.state.exchanges.length, 0);
});

test('local MCP validates exact task and SHA before requiring host test proof', async t => {
  let verifications = 0;
  const f = await fixture(t, { verifyResult: async () => { verifications++; } }); await f.initialize();
  for (const payload of [{ ...resultMessage().payload, taskId: 'wrong' }, { ...resultMessage().payload, sourceSha: 'd'.repeat(40) }]) {
    assert.equal(toolError(await f.call('context_guard_exchange', { ...resultMessage(), payload })), 'CI_MESSAGE_FORBIDDEN');
  }
  assert.equal(verifications, 0);
  assert.equal((await f.call('context_guard_exchange', resultMessage())).body.result.structuredContent.received, 'ci-result-stable');
  assert.equal(verifications, 1); assert.equal(f.state.exchanges.length, 1);
});

test('local MCP rechecks revocation, exact-reference drift and expiry before any mutation', async t => {
  let clock = 1000;
  const f = await fixture(t); await f.initialize();
  f.state.context.references['plan-one'] = 'plan-v3';
  assert.equal((await f.call('context_guard_context')).body.error.message, 'CI_TASK_CHANGED');
  f.state.context = scope();
  assert.equal((await f.call('context_guard_context')).body.error.message, 'CI_CAPABILITY_EXPIRED', '漂移后能力永久失效，不借相同旧引用恢复');
  const g = await fixture(t); await g.initialize(); g.state.revoked = true;
  assert.equal((await g.call('context_guard_context')).body.error.message, 'CI_AUTHORIZATION_REJECTED');
  const h = await fixture(t, { now: () => clock, ttlMs: 100 }); await h.initialize(); clock = 1100;
  assert.equal((await h.call('context_guard_context')).body.error.message, 'CI_CAPABILITY_EXPIRED');
  assert.equal(f.state.exchanges.length, 0);
  assert.equal(g.state.exchanges.length, 0); assert.equal(h.state.exchanges.length, 0);
});

test('local MCP does not return a success if the task changes during execution or proof validation', async t => {
  let f;
  f = await fixture(t, { runTest: async () => { f.state.context.taskId = 'replacement'; return { status: 'observed' }; } });
  await f.initialize();
  assert.equal(toolError(await f.call('context_guard_test', { id: 'x', testId: 'fixed-test' })), 'CI_TASK_CHANGED');
  const g = await fixture(t, { verifyResult: async () => { g.state.revoked = true; } }); await g.initialize();
  assert.equal(toolError(await g.call('context_guard_exchange', resultMessage())), 'CI_AUTHORIZATION_REJECTED');
  assert.equal(g.state.exchanges.length, 0);
});

test('local MCP task drift revokes the in-flight host test signal without claiming container termination', async t => {
  let entered;
  const entry = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { runTest: async (_, { signal }) => { entered(signal); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); return { stopped: true }; } });
  await f.initialize();
  const running = f.call('context_guard_test', { id: 'active-test', testId: 'fixed-test' });
  const signal = await entry;
  f.state.context.tester.workerPid = process.pid + 1;
  assert.equal((await f.call('context_guard_context')).body.error.message, 'CI_TASK_CHANGED');
  assert.equal(signal.aborted, true);
  assert.equal(toolError(await running), 'CI_CAPABILITY_EXPIRED');
});

test('local MCP expiry aborts the host test without waiting for another client request', async t => {
  const f = await fixture(t, { ttlMs: 100, runTest: async (_, { signal }) => {
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); return { aborted: true };
  } });
  await f.initialize();
  assert.equal(toolError(await f.call('context_guard_test', { id: 'expires', testId: 'fixed-test' })), 'CI_CAPABILITY_EXPIRED');
});

test('local MCP bounds error diagnostics and keeps scalar receipts out of structuredContent', async t => {
  const f = await fixture(t, { runTest: async () => { throw Object.assign(new Error('SYNTHETIC_PRIVATE_DIAGNOSTIC'), { code: 'private:synthetic-token' }); } });
  await f.initialize();
  const response = await f.call('context_guard_test', { id: 'x', testId: 'fixed-test' });
  assert.equal(toolError(response), 'CI_CALL_FAILED');
  assert.equal(response.text.includes('private'), false);
  const g = await fixture(t, { runTest: async () => ['synthetic observation'] }); await g.initialize();
  const scalar = (await g.call('context_guard_test', { id: 'x', testId: 'fixed-test' })).body.result;
  assert.equal(Object.hasOwn(scalar, 'structuredContent'), false);
  assert.deepEqual(JSON.parse(scalar.content[0].text), ['synthetic observation']);
});

test('local MCP reads only the approved exact commit snapshot and rejects modified bytes', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-ci-mcp-test-')));
  await fs.chmod(directory, 0o700);
  const root = path.join(directory, 'repo'), snapshots = path.join(directory, 'snapshots');
  await fs.mkdir(root); await fs.mkdir(snapshots, { mode: 0o700 });
  const execute = promisify(execFile);
  const git = async (...args) => (await execute('git', args, { cwd: root, windowsHide: true, env: { PATH: process.env.PATH, HOME: directory,
    GIT_CONFIG_NOSYSTEM: '1', ...(process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) } })).stdout.trim();
  await git('init'); await git('config', 'user.name', 'Synthetic Tester'); await git('config', 'user.email', 'tester@example.invalid');
  await fs.writeFile(path.join(root, 'approved.mjs'), 'export const value = 1;\n');
  await fs.writeFile(path.join(root, '.env'), 'SYNTHETIC_HOST_ONLY=1');
  await git('add', '.'); await git('commit', '-m', 'synthetic fixture');
  const sourceSha = await git('rev-parse', 'HEAD');
  const source = await exportCursorCiSource({ root, directory: snapshots, sourceSha, paths: ['approved.mjs'] });
  const client = { async context() { return { ...scope(), sourceSha }; }, async exchange() { throw new Error('not expected'); } };
  const f = await fixture(t, { source, client }); await f.initialize();
  const read = (await f.call('context_guard_source', { path: 'approved.mjs' })).body.result.structuredContent;
  assert.equal(read.sourceSha, sourceSha); assert.equal(read.text, 'export const value = 1;\n');
  for (const value of ['.env', '../approved.mjs', root + '/approved.mjs', 'missing']) {
    assert.equal(toolError(await f.call('context_guard_source', { path: value })), 'CI_SOURCE_FORBIDDEN');
  }
  await fs.chmod(path.join(source.snapshot, 'approved.mjs'), 0o600);
  await fs.writeFile(path.join(source.snapshot, 'approved.mjs'), 'export const value = 2;\n');
  await fs.chmod(path.join(source.snapshot, 'approved.mjs'), 0o400);
  assert.equal(toolError(await f.call('context_guard_source', { path: 'approved.mjs' })), 'CI_SOURCE_CHANGED');
});

test('original CI client uses only original local endpoints and reauthorizes every context read', async t => {
  const credential = 'synthetic-local-agent-credential-' + 'x'.repeat(32), seen = [];
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${credential}`);
    let body = ''; for await (const chunk of req) body += chunk;
    seen.push({ route: req.url, method: req.method, body: body && JSON.parse(body) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/api/v2/execution' ? { active: scope() } : { id: JSON.parse(body).id, ok: true, data: { syntheticReceipt: true } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const client = new OriginalCursorCiClient({ origin: `http://127.0.0.1:${server.address().port}`, credential });
  assert.deepEqual(await client.context(), scope()); await client.context();
  assert.deepEqual(seen.map(value => value.route), ['/api/v2/execution', '/api/v2/ci', '/api/v2/execution', '/api/v2/ci']);
  assert.deepEqual(seen[1].body.payload, { ref: 'todo-one', version: 'todo-v3' });
  assert.notEqual(seen[1].body.id, seen[3].body.id);
  assert.equal(seen[1].body.session.id, executorSessionId);
  for (const origin of ['https://127.0.0.1', 'http://example.invalid', 'http://localhost', 'http://user@127.0.0.1', 'http://127.0.0.1/path']) {
    assert.throws(() => new OriginalCursorCiClient({ origin, credential }), { code: 'CI_CONFIG_INVALID' });
  }
});

test('original CI client rejects missing active task, authorization, malformed or mismatched receipts', async () => {
  const options = { origin: 'http://127.0.0.1', credential: 'x'.repeat(32) };
  for (const active of [null, { ...scope(), mode: 'executor' }, { ...scope(), sourceSha: 'HEAD' }, { ...scope(), references: {} }]) {
    const client = new OriginalCursorCiClient({ ...options, fetcher: async () => Response.json({ active }) });
    await assert.rejects(client.context(), { code: 'CI_NOT_ACTIVE' });
  }
  const message = { v: 2, id: 'same', type: 'object.read', session: scope().session, payload: { ref: 'todo-one', version: 'todo-v3' } };
  for (const [response, code] of [[Response.json({}, { status: 403 }), 'CI_AUTHORIZATION_REJECTED'],
    [new Response('not JSON'), 'CI_RECEIPT_INVALID'], [Response.json({ id: 'different', ok: true, data: {} }), 'CI_RECEIPT_INVALID'],
    [Response.json({ id: 'same', ok: false, data: {} }), 'CI_RECEIPT_INVALID']]) {
    await assert.rejects(new OriginalCursorCiClient({ ...options, fetcher: async () => response }).exchange(message), { code });
  }
  await assert.rejects(new OriginalCursorCiClient({ ...options, fetcher: async () => { throw new Error('private'); } }).context(), { code: 'CI_CONNECTION_UNAVAILABLE' });
});

test('accepted terminal CI result preserves the real Core receipt and exact-ID replay', async t => {
  // 真实 Core 事务与终态；HTTP 鉴权/读取阶段门禁为本地提供方替身，无真实人工审批或模型。
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-ci-terminal-test-')));
  const store = new ProtocolStore(directory), session = { id: executorSessionId, generation: 1 };
  const device = { repositoryId: 'synthetic-repo', deviceId: 'synthetic-device', agentId: executorSessionId, role: 'device' };
  const ci = { ...device, agentId: testerSessionId, role: 'ci', bindings: { [executorSessionId]: 'executor-worktree' } };
  await store.handle(device, { v: 2, id: 'bind-fixture', type: 'session.bind', payload: {
    sessionId: executorSessionId, worktreeId: 'executor-worktree', agentId: executorSessionId, expectedBindingVersion: '' } }, { verifyBinding: () => true });
  const put = async (id, kind, ref, content) => (await store.handle(ci, { v: 2, id, type: 'object.put', session,
    payload: { kind, ref, baseVersion: '', content } })).data;
  const todo = await put('fixture-todo', 'ciTodo', 'todo-one', { items: [{ id: 'one', description: 'synthetic observation' }] });
  const evidenceRef = `ci:${testerSessionId}:evidence`;
  await put('fixture-evidence', 'evidence', evidenceRef, { observation: 'synthetic fixture, not actual business testing' });
  const taskKey = scopedObjectKey(ci, session, 'task:task-one');
  await store.transaction(state => { state.tasks[taskKey] = { id: 'task-one', repositoryId: device.repositoryId, session, stage: 'testing',
    version: 'fixture-version', busy: true, sourceSha: scope().sourceSha, handoff: { ciTodoRef: 'todo-one', unitTestRefs: [] },
    references: { 'todo-one': todo.version } }; });
  const context = { ...scope(), session, references: { 'todo-one': todo.version } };
  const credential = 'synthetic-terminal-' + 'x'.repeat(32), seen = [];
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${credential}`) { res.writeHead(401); res.end(); return; }
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/api/v2/execution') { res.end(JSON.stringify({ active: context })); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const message = JSON.parse(body); seen.push(message);
    try {
      const reply = await store.handle(ci, message, { authorize: state => {
        if (message.type === 'object.read' && state.tasks[taskKey].stage !== 'testing') {
          throw Object.assign(new Error('Current testing stage required'), { code: 'FORBIDDEN', status: 403 });
        }
      } });
      res.end(JSON.stringify(reply));
    } catch (cause) { res.statusCode = cause.status || 400; res.end(JSON.stringify({ id: message.id, ok: false, error: { code: cause.code } })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const client = new OriginalCursorCiClient({ origin: `http://127.0.0.1:${server.address().port}`, credential });
  const f = await fixture(t, { client, verifyResult: async () => {} }); await f.initialize();
  const first = await f.call('context_guard_exchange', resultMessage());
  const coreTask = await store.transaction(state => state.tasks[taskKey], { readOnly: true });
  assert.equal(coreTask.stage, 'awaiting-merge');
  assert.notEqual(coreTask.ciTodoResult.version, todo.version);
  assert.equal(first.body.result.isError, undefined);
  assert.equal(first.body.result.structuredContent.stage, 'awaiting-merge');
  const replay = await f.call('context_guard_exchange', resultMessage());
  assert.deepEqual(replay.body.result, first.body.result);
  const changedId = await f.call('context_guard_exchange', { ...resultMessage(), id: 'new-id-after-terminal' });
  assert.equal(toolError(changedId), 'CI_OPERATION_REJECTED');
  const otherRead = await f.call('context_guard_context');
  assert.equal(otherRead.body.error.message, 'CI_AUTHORIZATION_REJECTED');
  const state = await store.transaction(value => value, { readOnly: true });
  assert.equal(Object.values(state.queues).flatMap(value => value.items).filter(value => value.message.type === 'ci.result').length, 1);
  assert.equal(seen.filter(value => value.type === 'ci.result').length, 3);
});
