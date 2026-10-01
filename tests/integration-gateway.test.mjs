import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startIntegrationGateway, validateIntegrationConfig } from '../scripts/cloud/integration-gateway.mjs';
import { IntegrationAttachmentStore } from '../scripts/cloud/integration-attachments.mjs';
import { CoordinatorManualBriefs, filterManualTools } from '../scripts/cloud/coordinator-manual.mjs';
import { applyOperations, MapError } from '../scripts/shared/map-model.mjs';
import { hash, readJSON } from '../scripts/shared/io.mjs';

const teamId = 'TTESTWORKSPACE', userId = 'UTESTUSER', projectId = 'fixture-project';
const token = 'integration-test-credential-not-an-admin-token';
const config = { host: '127.0.0.1', port: 0, token, teamId, projectIds: [projectId] };
const actor = { kind: 'human', sessionId: `slack:${teamId}:${userId}`, integration: 'slack', teamId, userId };
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-integration-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
const input = (id, type, payload = {}, extra = {}) => ({ id, type, teamId, userId, projectId, conversationId: 'chat-fixture', payload, ...extra });
async function call(gateway, body, credential = token) {
  const response = await fetch(gateway.url + '/v1/command', { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('Integration listener is opt-in and rejects non-loopback or weak credentials', async () => {
  assert.equal(await startIntegrationGateway(), null);
  assert.throws(() => validateIntegrationConfig({ ...config, host: '0.0.0.0' }), error => error.code === 'INVALID_INTEGRATION_CONFIG');
  assert.throws(() => validateIntegrationConfig({ ...config, token: 'weak' }), error => error.code === 'INVALID_INTEGRATION_CONFIG');
  assert.throws(() => validateIntegrationConfig({ ...config, actions: ['task.assign'] }), error => error.code === 'INVALID_INTEGRATION_CONFIG');
});

test('Gateway assigns human identity and enforces workspace/project/action scopes before callbacks', async t => {
  const stateDir = await temporary(t), calls = [];
  const gateway = await startIntegrationGateway({ config: { ...config, actions: ['project.read', 'map.write'] }, stateDir,
    state: async () => ({}), command: async (command, context) => { calls.push({ command, context }); return { version: 'main-v1' }; } });
  t.after(() => gateway.close());
  assert.equal((await call(gateway, input('unauth', 'map.write'), 'wrong')).status, 401);
  assert.equal((await call(gateway, input('wrong-team', 'map.write', {}, { teamId: 'TOTHER' }))).status, 403);
  assert.equal((await call(gateway, input('wrong-user', 'map.write', {}, { userId: 'system' }))).status, 403);
  assert.equal((await call(gateway, input('wrong-project', 'map.write', {}, { projectId: 'private-project' }))).status, 403);
  assert.equal((await call(gateway, input('forged', 'map.write', { actor: { kind: 'coordinator' } }))).status, 400);
  assert.equal((await call(gateway, input('forged-role', 'map.write', { role: 'coordinator' }))).status, 400);
  assert.equal((await call(gateway, input('not-enabled', 'conversation.submit'))).status, 403);
  assert.equal((await call(gateway, input('unknown', 'task.assign'))).status, 400);
  const result = await call(gateway, input('map-transaction', 'map.write', { baseVersion: 'main-v0', operations: [] }));
  assert.equal(result.body.ok, true); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].context, { actor, operationId: 'map-transaction' });
});

test('Gateway persists operation receipts and rejects ID reuse across identities or requests', async t => {
  const stateDir = await temporary(t); let count = 0;
  const options = { config, stateDir, state: async () => ({}), command: async () => ({ committed: true, count: ++count }) };
  let gateway = await startIntegrationGateway(options);
  const body = input('durable-operation', 'map.write', { baseVersion: 'v0', operations: [] });
  const simultaneous = await Promise.all([call(gateway, body), call(gateway, body)]);
  assert.deepEqual(simultaneous[0].body.data, simultaneous[1].body.data); assert.equal(count, 1);
  await gateway.close(); gateway = await startIntegrationGateway(options); t.after(() => gateway.close());
  assert.equal((await call(gateway, body)).body.data.count, 1); assert.equal(count, 1);
  assert.equal((await call(gateway, { ...body, userId: 'UOTHER' })).body.error.code, 'ID_REUSED');
  assert.equal((await call(gateway, { ...body, payload: { baseVersion: 'v1', operations: [] } })).body.error.code, 'ID_REUSED');
  const names = await fs.readdir(path.join(stateDir, 'receipts'));
  assert.equal(names.length, 1); assert.deepEqual((await readJSON(path.join(stateDir, 'receipts', names[0]))).actor, actor);
});

test('Gateway BUSY failure preserves the same operation for a later successful retry', async t => {
  const stateDir = await temporary(t); let count = 0;
  const gateway = await startIntegrationGateway({ config, stateDir, state: async () => ({}), command: async () => {
    if (++count === 1) throw new MapError('BUSY', 'Coordinator is processing a turn', 409);
    return { accepted: true };
  } });
  t.after(() => gateway.close());
  const body = input('retry-original-operation', 'conversation.submit', { text: 'A real retry preserves its request identity' });
  assert.equal((await call(gateway, body)).body.error.code, 'BUSY');
  assert.equal((await call(gateway, body)).body.data.accepted, true); assert.equal(count, 2);
});

test('SSE subscription sends public snapshot and stops polling when disconnected', async t => {
  const stateDir = await temporary(t); let calls = 0;
  const gateway = await startIntegrationGateway({ config, stateDir, pollIntervalMs: 250, command: async () => ({}),
    state: async (_scope, context) => { assert.deepEqual(context.actor, actor); calls++; return { conversationId: 'chat-fixture', status: 'waiting-for-user' }; } });
  t.after(() => gateway.close());
  const controller = new AbortController();
  const query = new URLSearchParams({ teamId, userId, projectId, conversationId: 'chat-fixture' });
  const response = await fetch(`${gateway.url}/v1/events?${query}`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: state/); assert.match(first, /waiting-for-user/); assert.equal(gateway.subscriberCount(), 1);
  controller.abort(); await reader.cancel().catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(gateway.subscriberCount(), 0); const stoppedAt = calls;
  await new Promise(resolve => setTimeout(resolve, 280)); assert.equal(calls, stoppedAt);
});

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN5kAAAAASUVORK5CYII=';
test('Protected attachment storage validates bytes and preserves project isolation and integrity', async t => {
  const directory = await temporary(t), store = new IntegrationAttachmentStore({ directory });
  const upload = { teamId, projectId, actor, filename: 'screenshot.png', mimeType: 'image/png', base64: png };
  const result = await store.upload(upload);
  assert.equal(result.hash, hash(Buffer.from(png, 'base64'))); assert.equal(result.base64, undefined); assert.equal(result.path, undefined);
  assert.deepEqual(await store.upload(upload), result);
  assert.equal((await store.resolve({ teamId, projectId, id: result.id })).base64, png);
  await assert.rejects(store.read({ teamId, projectId: 'another-project', id: result.id }), error => error.code === 'NOT_FOUND');
  await assert.rejects(store.read({ teamId: 'TOTHER', projectId, id: result.id }), error => error.code === 'NOT_FOUND');
  await assert.rejects(store.upload({ ...upload, filename: '../../escape' }), error => error.code === 'INVALID_ATTACHMENT');
  await assert.rejects(store.upload({ ...upload, mimeType: 'text/html' }), error => error.code === 'UNSUPPORTED_ATTACHMENT');
  await assert.rejects(store.upload({ ...upload, base64: '!!!!' }), error => error.code === 'INVALID_ATTACHMENT');
  await assert.rejects(store.upload({ ...upload, base64: Buffer.from('not PNG').toString('base64') }), error => error.code === 'INVALID_ATTACHMENT');
  await assert.rejects(store.upload({ ...upload, filename: 'text.txt', mimeType: 'text/plain', base64: Buffer.from([255]).toString('base64') }), error => error.code === 'INVALID_ATTACHMENT');
  const boundedText = { ...upload, filename: 'bounded.txt', mimeType: 'text/plain', base64: Buffer.alloc(256 * 1024, 65).toString('base64') };
  assert.equal((await store.upload(boundedText)).size, 256 * 1024);
  await assert.rejects(store.upload({ ...boundedText, base64: Buffer.alloc(256 * 1024 + 1, 65).toString('base64') }), error => error.code === 'ATTACHMENT_TOO_LARGE');
  await fs.writeFile(store.file(result.id), Buffer.from('tampered'));
  await assert.rejects(store.read({ teamId, projectId, id: result.id }), error => error.code === 'ATTACHMENT_CORRUPTED');
});

async function manualFixture(t) {
  const directory = await temporary(t);
  let document = { project: 'Fixture', root: { id: 'T0', title: 'Fixture', kind: 'module', memoryDocument: 'Project memory',
    children: [{ id: 'LOGIN', title: 'Login', kind: 'module', purpose: 'Token renewal', owns: ['src/login/'], todos: [],
      bugs: [{ id: 'B1', title: 'Refresh fails', status: 'open', createdAt: 'original-item', attempts: [{ status: 'Confirmed', cause: 'Expired token' }] }], children: [] }] } };
  let version = hash(JSON.stringify(document)), commits = 0, throwAfterCommit = false;
  const receipts = new Map();
  const readMain = async () => ({ document: structuredClone(document), version });
  const commitMain = async (request, actualActor) => {
    if (receipts.has(request.operationId)) return receipts.get(request.operationId);
    if (request.baseVersion !== version) throw new MapError('VERSION_CONFLICT', 'Main changed', 409);
    document = applyOperations(document, request.operations, actualActor).doc; version = hash(JSON.stringify(document)); commits++;
    const receipt = { committed: true, version }; receipts.set(request.operationId, receipt);
    if (throwAfterCommit) { throwAfterCommit = false; throw new Error('Process interrupted after Main commit'); }
    return receipt;
  };
  const options = { directory, projectId, readMain, commitMain }, service = new CoordinatorManualBriefs(options);
  return { service, options, readMain, get commits() { return commits; }, interrupt() { throwAfterCommit = true; },
    change() { document.root.memoryDocument = 'Updated project memory'; version = hash(JSON.stringify(document)); } };
}
const brief = version => ({ text: 'Correct token renewal', acceptance: 'Expired tokens are refreshed once', nodeIds: ['LOGIN'], mainVersion: version });
const review = (proposal, decision = 'approved') => ({ proposalId: proposal.id, version: proposal.version, decision, reason: 'Human reviewed this exact brief' });
const context = (operationId = 'review-first') => ({ operationId, conversationId: 'chat-fixture', actor });

test('Manual brief creates one Main TODO and pasteable fs-v2.1 prompt without any execution Session', async t => {
  const fixture = await manualFixture(t), { service } = fixture;
  const proposal = await service.prepare(brief((await fixture.readMain()).version), context('prepare-first'));
  assert.equal(proposal.requiresHumanApproval, true); assert.equal(proposal.manual, true); assert.equal(fixture.commits, 0);
  assert.equal((await service.approvals('chat-fixture'))[0].pending, true);
  await assert.rejects(service.prompt(proposal.id, 'chat-fixture'), error => error.code === 'APPROVAL_REQUIRED');
  const result = await service.review(review(proposal), context());
  assert.equal(fixture.commits, 1); assert.equal(result.executionMode, 'manual'); assert.equal(result.executionSessionId, undefined);
  const todo = (await fixture.readMain()).document.root.children[0].todos[0];
  assert.equal(todo.id, proposal.itemId); assert.equal(todo.status, 'pending'); assert.equal(todo.executionMode, 'manual');
  assert.deepEqual(todo.approvedBrief.actor, actor);
  assert.match(result.prompt, /nodes\/Fixture-module\/Login-module\/index\.md/);
  assert.match(result.prompt, new RegExp(`${proposal.itemId}\\.md`)); assert.match(result.prompt, /自己的 Session/); assert.doesNotMatch(result.prompt, /\/Users\//);
  assert.equal((await service.prompt(proposal.id, 'chat-fixture')).text, result.prompt);
  const replay = await service.review(review(proposal), context('review-second'));
  assert.deepEqual(replay, result); assert.equal(fixture.commits, 1);
  await assert.rejects(service.review(review(proposal, 'rejected'), context('review-third')), error => error.code === 'CONFLICT');
  assert.equal((await service.approvals('chat-fixture'))[0].pending, false);
});

test('Manual brief preserves original Bug/attempt identity and requires exact Main and proposal versions', async t => {
  const fixture = await manualFixture(t), { service } = fixture;
  const proposal = await service.prepare({ ...brief((await fixture.readMain()).version), nodeId: 'LOGIN', kind: 'bug', itemId: 'B1' }, context('prepare-bug'));
  await assert.rejects(service.review({ ...review(proposal), version: 'old-version' }, context()), error => error.code === 'VERSION_CONFLICT');
  await assert.rejects(service.review(review(proposal), { ...context(), conversationId: 'chat-other' }), error => error.code === 'NOT_FOUND');
  await service.review(review(proposal), context());
  const node = (await fixture.readMain()).document.root.children[0];
  assert.equal(node.bugs.length, 1); assert.equal(node.todos.length, 0); assert.equal(node.bugs[0].createdAt, 'original-item');
  assert.equal(node.bugs[0].attempts[0].cause, 'Expired token'); assert.equal(node.bugs[0].status, 'open'); assert.equal(node.bugs[0].executionMode, 'manual');
  const second = await service.prepare(brief((await fixture.readMain()).version), context('prepare-after'));
  fixture.change();
  await assert.rejects(service.review(review(second), context('review-after')), error => error.code === 'VERSION_CONFLICT');
  assert.equal(fixture.commits, 1);
});

test('Interrupted manual approval replays exact Main transaction after restart without duplicate TODO', async t => {
  const fixture = await manualFixture(t);
  const proposal = await fixture.service.prepare(brief((await fixture.readMain()).version), context('prepare-interrupt'));
  fixture.interrupt();
  await assert.rejects(fixture.service.review(review(proposal), context()), /interrupted after Main commit/);
  assert.equal(fixture.commits, 1);
  const restarted = new CoordinatorManualBriefs(fixture.options);
  const result = await restarted.review(review(proposal), context());
  assert.equal(result.decision, 'approved'); assert.equal(fixture.commits, 1); assert.equal((await fixture.readMain()).document.root.children[0].todos.length, 1);
});

test('Manual rejection does not mutate Main and manual tools cannot dispatch or control Agents', async t => {
  const fixture = await manualFixture(t);
  const proposal = await fixture.service.prepare(brief((await fixture.readMain()).version), context('prepare-reject'));
  const result = await fixture.service.review(review(proposal, 'rejected'), context());
  assert.equal(result.decision, 'rejected'); assert.equal(result.prompt, undefined); assert.equal(fixture.commits, 0);
  const tools = filterManualTools(['dispatch_task', 'request_ci', 'prepare_task', 'read_map', 'complete_task'].map(name => ({ name, description: 'old' })));
  assert.deepEqual(tools.map(tool => tool.name), ['prepare_task', 'read_map']); assert.match(tools[0].description, /manual/);
});
