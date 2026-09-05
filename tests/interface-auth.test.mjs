import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { ProtocolAuth } from '../scripts/cloud/protocol-auth.mjs';
import { startCloudServer, createWorkbenchPasswordHash } from '../scripts/cloud/server.mjs';

test('IF-020: credentials expire, revoke and survive restart without storing plaintext', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-v2-auth-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let now = 1000, enabled = true;
  const options = { directory, now: () => now, lifetimeMs: 1000, verifyPassword: async v => v === 'test-only', resolveIdentity: async (slug, clientId) => enabled && slug === 'example/repo' && clientId === 'client' ? { repositoryId: '123', deviceId: 'device', agentId: 'agent' } : null };
  const auth = new ProtocolAuth(options);
  const input = { v: 2, id: 'login', type: 'auth.open', payload: { repository: 'git@github.com:example/repo.git', password: 'test-only', clientId: 'client' } };
  const opened = await auth.open(input, 'test');
  const disk = await fs.readFile(auth.file, 'utf8');
  assert.equal(disk.includes(opened.credential), false); assert.equal(disk.includes('test-only'), false);
  const restarted = new ProtocolAuth(options);
  assert.equal((await restarted.authenticate(opened.credential)).agentId, 'agent');
  enabled = false; await assert.rejects(restarted.authenticate(opened.credential), { code: 'FORBIDDEN' });
  enabled = true; now = 2001; await assert.rejects(restarted.authenticate(opened.credential), { code: 'UNAUTHORIZED' });
  const next = await restarted.open(input, 'test'); await restarted.close(next.credential);
  await assert.rejects(restarted.authenticate(next.credential), { code: 'UNAUTHORIZED' });
});

test('IF-024: Cloud binary upload enforces binding, hash completion and byte ranges', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cloud-blob-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const server = await startCloudServer({ dataDir, port: 0, browserToken: 'test-browser', browserPasswordHash: await createWorkbenchPasswordHash('test-only'), protocolConfig: { repositories: [{ slug: 'example/repo', repositoryId: '123' }] } });
  try {
    let credential;
    const request = message => fetch(new URL('/api/v2/messages', server.url), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(message) });
    const login = await request({ v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', password: 'test-only', clientId: 'device' } });
    credential = login.headers.get('x-context-guard-credential');
    const bind = await request({ v: 2, id: 'bind', type: 'session.bind', payload: { sessionId: 's', worktreeId: 'wt', agentId: 'a', expectedBindingVersion: '' } });
    const session = (await bind.json()).data.session;
    const bytes = Buffer.from('hello cloud');
    const registered = await request({ v: 2, id: 'blob', type: 'blob.put', session, payload: { name: 'sample.txt', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mediaType: 'text/plain' } });
    assert.equal(registered.status, 200);
    const target = new URL((await registered.json()).data.uploadPath, server.url);
    const headers = { Authorization: `Bearer ${credential}`, 'X-Context-Guard-Session': 's', 'X-Context-Guard-Generation': '1' };
    assert.equal((await fetch(target, { headers })).status, 404);
    const uploaded = await fetch(target, { method: 'PUT', headers: { ...headers, 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` }, body: bytes });
    assert.deepEqual(await uploaded.json(), { offset: bytes.length, complete: true });
    const partial = await fetch(target, { headers: { ...headers, Range: 'bytes=6-10' } });
    assert.equal(partial.status, 206); assert.equal(await partial.text(), 'cloud');
    assert.equal((await fetch(target, { headers: { ...headers, 'X-Context-Guard-Session': 'other' } })).status, 403);
    assert.equal((await fetch(target, { headers: { ...headers, 'X-Context-Guard-Generation': '2' } })).status, 409);
    assert.equal((await fetch(target)).status, 401);
  } finally { await server.close(); }
});

test('IF-026: one Cloud event stream hints multiple owned Sessions without exposing foreign bindings', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cloud-events-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const server = await startCloudServer({ dataDir, port: 0, browserToken: 'test-browser', browserPasswordHash: await createWorkbenchPasswordHash('test-only'), protocolConfig: { repositories: [{ slug: 'example/repo', repositoryId: '123' }] } });
  let stream;
  try {
    const request = (message, credential) => fetch(new URL('/api/v2/messages', server.url), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(message) });
    const login = async clientId => (await request({ v: 2, id: `login-${clientId}`, type: 'auth.open', payload: { repository: 'https://github.com/example/repo', password: 'test-only', clientId } })).headers.get('x-context-guard-credential');
    const owner = await login('owner'), other = await login('other');
    const bind = async (sessionId, credential) => {
      const response = await request({ v: 2, id: `bind-${sessionId}`, type: 'session.bind', payload: { sessionId, worktreeId: 'wt', agentId: sessionId, expectedBindingVersion: '' } }, credential);
      assert.equal(response.status, 200);
    };
    await bind('foreign', other); await bind('first', owner);
    stream = await fetch(new URL('/api/v2/events', server.url), { headers: { Authorization: `Bearer ${owner}` }, signal: AbortSignal.timeout(10000) });
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader(), decoder = new TextDecoder(); let text = '';
    while (!text.includes('"id":"first"')) text += decoder.decode((await reader.read()).value);
    await bind('second', owner);
    while (!text.includes('"id":"second"')) text += decoder.decode((await reader.read()).value);
    assert.equal(text.includes('foreign'), false);
    assert.match(text, /event: sync.event/);
    await reader.cancel();
  } finally { await server.close(); }
});

test('IF-021: real Cloud HTTP login, registered binding, isolation and logout', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-v2-cloud-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const server = await startCloudServer({ dataDir, port: 0, browserToken: 'test-browser', browserPasswordHash: await createWorkbenchPasswordHash('test-only'), protocolConfig: { repositories: [{ slug: 'example/repo', repositoryId: '123', clients: { client: { deviceId: 'device', agentId: 'agent', bindings: { session: 'worktree' } } } }] } });
  try {
    const request = async (message, credential) => fetch(new URL('/api/v2/messages', server.url), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(message) });
    const login = await request({ v: 2, id: 'login', type: 'auth.open', payload: { repository: 'https://github.com/example/repo', password: 'test-only', clientId: 'client' } });
    assert.equal(login.status, 200); const credential = login.headers.get('x-context-guard-credential'); assert.ok(credential);
    const bind = await request({ v: 2, id: 'bind', type: 'session.bind', payload: { sessionId: 'session', worktreeId: 'worktree', agentId: 'agent', expectedBindingVersion: '' } }, credential);
    assert.equal(bind.status, 200); assert.equal((await bind.json()).data.session.generation, 1);
    const forged = await request({ v: 2, id: 'forged', type: 'session.bind', payload: { sessionId: 'another', worktreeId: 'worktree', agentId: 'agent', expectedBindingVersion: '' } }, credential);
    assert.equal(forged.status, 403);
    const close = await request({ v: 2, id: 'close', type: 'auth.close', payload: {} }, credential); assert.equal(close.status, 200);
    const denied = await request({ v: 2, id: 'beat', type: 'sync.heartbeat', payload: { sessions: [] } }, credential); assert.equal(denied.status, 401);
  } finally { await server.close(); }
});
