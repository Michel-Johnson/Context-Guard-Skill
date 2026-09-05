import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from '../scripts/workbench/server.mjs';
import { request } from '../scripts/workbench/cli.mjs';
import { hash } from '../scripts/workbench/io.mjs';
import { messageHandler, ProjectMessagePump, sendMessage } from '../scripts/workbench/protocol-client.mjs';

const session = { id: 'session-1', generation: 1 };
const message = { v: 2, id: 'r1', type: 'sync.read', session, payload: { afterSeq: 0, limit: 50 } };
test('IF-014: local backend exposes v2 binding and queue reads using existing Agent credentials', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-interface-http-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ctx = path.join(root, '.codex/context'); await fs.mkdir(ctx, { recursive: true });
  await fs.writeFile(path.join(ctx, 'map.json'), JSON.stringify({ v: 1, project: 'test', root: { id: 'T0', title: 'test', children: [] } }));
  await fs.writeFile(path.join(ctx, 'sessions.jsonl'), JSON.stringify({ session_id: session.id, event: 'session-start' }) + '\n');
  const server = await startServer({ root, port: 0 });
  try {
    const registered = await request(server.state, '/api/session', { method: 'POST', body: { sessionId: session.id } });
    const send = input => sendMessage(server.state.url, registered.token, input, { allowLoopback: true });
    const bound = await send({ v: 2, id: 'bind', type: 'session.bind', payload: { sessionId: session.id, worktreeId: registered.actor.worktreeId, agentId: session.id, expectedBindingVersion: '' } });
    assert.deepEqual(bound.session, session);
    await server.access.grant(session.id, ['T0'], server.store.version);
    const page = await send({ v: 2, id: 'map-read', type: 'workbench.read', session, payload: { scope: 'session', cursor: '', limit: 10 } });
    assert.equal(page.items[0].node.id, 'T0');
    const patch = { v: 2, id: 'map-patch', type: 'workbench.patch', session, payload: { baseVersion: page.version,
      changes: [{ op: 'update', kind: 'node', id: 'T0', fields: { purpose: 'v2 Map edit' } }] } };
    const changed = await send(patch);
    assert.equal(server.store.doc.root.purpose, 'v2 Map edit');
    assert.deepEqual(await send(patch), changed);
    await assert.rejects(send({ ...patch, payload: { ...patch.payload, changes: [{ op: 'update', kind: 'node', id: 'T0', fields: { purpose: 'different' } }] } }), { code: 'ID_REUSED' });
    assert.deepEqual(await send(message), { messages: [], nextSeq: 0, hasMore: false });
    const cliReply = await new Promise((resolve, reject) => {
      const cli = spawn(process.execPath, [path.resolve('bin/context-guard-skill.js'), 'map', 'exchange', '--root', root, '--session', session.id, '--input', '-'], { windowsHide: true });
      let stdout = '', stderr = '';
      cli.stdout.on('data', chunk => { stdout += chunk; }); cli.stderr.on('data', chunk => { stderr += chunk; });
      cli.on('error', reject); cli.on('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
      cli.stdin.end(JSON.stringify(message));
    });
    assert.equal(cliReply.id, message.id); assert.equal(cliReply.ok, true);
    assert.deepEqual(cliReply.data.messages, []);
    await assert.rejects(send({ ...message, id: 'other', session: { id: 'another', generation: 1 } }), { code: 'FORBIDDEN' });
    const bytes = Buffer.from('binary proof');
    const blob = await send({ v: 2, id: 'blob', type: 'blob.put', session, payload: { name: 'proof.txt', size: bytes.length, sha256: hash(bytes), mediaType: 'text/plain' } });
    const attach = { v: 2, id: 'attach-proof', type: 'workbench.patch', session, payload: { baseVersion: server.store.version,
      changes: [{ op: 'create', kind: 'memory', id: 'proof', fields: { nodeId: 'T0', text: 'proof', refs: [{ ref: `blob:${blob.blobId}`, version: hash(bytes) }] } }] } };
    await assert.rejects(send(attach), { code: 'NOT_FOUND' });
    const headers = { Authorization: `Bearer ${registered.token}`, 'X-Context-Guard-Session': session.id, 'X-Context-Guard-Generation': '1' };
    const uploaded = await fetch(new URL(blob.uploadPath, server.state.url), { method: 'PUT', headers: { ...headers, 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` }, body: bytes });
    assert.equal(uploaded.status, 200); assert.equal((await uploaded.json()).complete, true);
    await send(attach);
    assert.equal(server.store.doc.root.memories[0].refs[0].version, hash(bytes));
    const downloaded = await fetch(new URL(blob.uploadPath, server.state.url), { headers: { ...headers, Range: 'bytes=0-5' } });
    assert.equal(downloaded.status, 206); assert.equal(await downloaded.text(), 'binary');
    const forbidden = await fetch(new URL(blob.uploadPath, server.state.url), { headers: { ...headers, 'X-Context-Guard-Session': 'another' } });
    assert.equal(forbidden.status, 403);
    const humanSend = input => sendMessage(server.state.url, server.humanToken, input, { allowLoopback: true });
    const lock = { v: 2, id: 'human-lock', type: 'workbench.patch', session, payload: { baseVersion: server.store.version,
      changes: [{ op: 'create', kind: 'access', id: 'permission', fields: { nodeId: 'T0', agentId: session.id, allow: 'read' } }] } };
    await humanSend(lock);
    const readable = await send({ v: 2, id: 'read-only', type: 'workbench.read', session, payload: { scope: 'session', cursor: '', limit: 10 } });
    assert.equal(readable.items[0].node.id, 'T0');
    await assert.rejects(send(patch), { code: 'FORBIDDEN' });
    await humanSend({ ...lock, id: 'human-revoke', payload: { baseVersion: server.store.version,
      changes: [{ op: 'update', kind: 'access', id: 'permission', fields: { allow: 'none' } }] } });
    const hidden = await send({ v: 2, id: 'revoked-read', type: 'workbench.read', session, payload: { scope: 'session', cursor: '', limit: 10 } });
    assert.deepEqual(hidden.items, []);
  } finally { await server.close(); }
});
test('IF-010: real HTTP boundary authenticates, rejects malformed JSON and echoes receipts', async t => {
  const server = http.createServer(messageHandler({
    authenticate: req => req.headers.authorization === 'Bearer test-only' ? { agentId: 'a' } : null,
    handle: async (p, m) => ({ id: m.id, ok: true, data: { messages: [], nextSeq: 0, hasMore: false } }),
    allowedOrigin: 'https://workbench.example',
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const options = { allowLoopback: true };
  assert.deepEqual(await sendMessage(origin, 'test-only', message, options), { messages: [], nextSeq: 0, hasMore: false });
  await assert.rejects(sendMessage(origin, 'incorrect', message, options), { code: 'UNAUTHORIZED' });
  await assert.rejects(sendMessage(origin, 'test-only', message), { code: 'FORBIDDEN' });
  const crossOrigin = await fetch(origin, { method: 'POST', headers: { Authorization: 'Bearer test-only', Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify(message) });
  assert.equal(crossOrigin.status, 403);
  const malformed = await fetch(origin, { method: 'POST', headers: { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' }, body: '{' });
  assert.equal((await malformed.json()).error.code, 'INVALID_ARGUMENT');
});
test('IF-011: old servers, wrong receipts and HTML never report successful synchronization', async () => {
  for (const response of [new Response('{}', { status: 404 }), new Response('<html>login</html>'), new Response(JSON.stringify({ ok: true, id: 'another', data: {} }), { headers: { 'Content-Type': 'application/json' } })]) {
    await assert.rejects(sendMessage('https://example.test', 'test-only', message, { fetcher: async () => response }));
  }
});
test('IF-012: heartbeat detects cloud-only changes; ack is sent after durable apply', async () => {
  const order = [];
  const notification = { v: 2, id: 'n1', type: 'sync.event', session, payload: { latestSeq: 1 } };
  const pump = new ProjectMessagePump({
    sessions: async () => [{ ...session, ackedSeq: 0 }],
    send: async m => {
      order.push(m.type);
      if (m.type === 'sync.heartbeat') return { sessions: [{ ...session, latestSeq: 1, ackedSeq: 0 }] };
      if (m.type === 'sync.read') return { messages: [{ seq: 1, message: notification }], nextSeq: 1, hasMore: false };
      return { ackedSeq: 1 };
    },
    apply: async m => { assert.equal(m.id, 'n1'); order.push('persist'); return { outcome: 'applied' }; },
  });
  await Promise.all([pump.poll(), pump.poll(), pump.wake()]);
  assert.deepEqual(order, ['sync.heartbeat', 'sync.read', 'persist', 'sync.ack']);
  await pump.close();
});
test('IF-013: failed apply and wrong Session cannot advance acknowledgement', async () => {
  for (const wrongSession of [false, true]) {
    const calls = [];
    const pump = new ProjectMessagePump({
      sessions: async () => [{ ...session, ackedSeq: 0 }],
      send: async m => {
        calls.push(m.type);
        if (m.type === 'sync.heartbeat') return { sessions: [{ ...session, latestSeq: 1, ackedSeq: 0 }] };
        return { messages: [{ seq: 1, message: { v: 2, id: 'n', type: 'sync.event', session: wrongSession ? { ...session, id: 'other' } : session, payload: { latestSeq: 1 } } }], nextSeq: 1 };
      },
      apply: async () => { throw new Error('disk unavailable'); },
    });
    await assert.rejects(pump.poll()); assert.equal(calls.includes('sync.ack'), false); await pump.close();
  }
});
test('IF-018: a stalled Session cannot prevent a healthy Session acknowledgement', async () => {
  let release, healthyAck = false;
  const stalled = new Promise(resolve => { release = resolve; });
  const sessions = [session, { id: 'healthy', generation: 1 }];
  const pump = new ProjectMessagePump({
    sessions: async () => sessions.map(s => ({ ...s, ackedSeq: 0 })),
    send: async m => {
      if (m.type === 'sync.heartbeat') return { sessions: sessions.map(s => ({ ...s, ackedSeq: 0, latestSeq: 1 })) };
      if (m.type === 'sync.read') {
        if (m.session.id === session.id) { await stalled; throw new Error('stalled connection'); }
        return { messages: [{ seq: 1, message: { v: 2, id: 'n', type: 'sync.event', session: m.session, payload: { latestSeq: 1 } } }], nextSeq: 1 };
      }
      healthyAck = true; release(); return { ackedSeq: 1 };
    },
    apply: async () => ({ outcome: 'applied' }),
  });
  try { await assert.rejects(pump.poll()); assert.equal(healthyAck, true); }
  finally { release(); await pump.close(); }
});
