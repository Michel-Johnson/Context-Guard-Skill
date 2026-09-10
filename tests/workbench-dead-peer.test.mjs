import '../.github/scripts/test-environment.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startServer } from '../scripts/workbench/server.mjs';
import { request, stopServer } from '../scripts/workbench/cli.mjs';
import { encode } from '../scripts/shared/io.mjs';

const agentSession = 'd5d4cc57-3a92-4511-9cf5-b1dfe0d34c55';
const fixtureRoots = [];
after(async () => {
  const temporary = await fs.realpath(os.tmpdir());
  for (const root of fixtureRoots) {
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), temporary);
    assert.ok(path.basename(resolved).startsWith('cg-dead-peer-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-dead-peer-'));
  fixtureRoots.push(root);
  const ctx = path.join(root, '.codex/context');
  await fs.mkdir(path.join(ctx, 'sessions'), { recursive: true });
  const doc = {
    v: 1,
    project: 'dead-peer',
    root: {
      id: 'T0',
      title: '项目',
      children: [{ id: 'N1', title: '节点', purpose: '原文', memories: [], bugs: [], children: [] }],
    },
  };
  await fs.writeFile(path.join(ctx, 'map.json'), encode(doc));
  await fs.writeFile(path.join(ctx, 'sessions.jsonl'), JSON.stringify({
    at: '2026-01-01T00:00:00Z',
    platform: 'claude',
    session_id: agentSession,
    event: 'session-start',
  }) + '\n');
  return { root, ctx, doc };
}

async function hungPeers(server, clientIds) {
  const abort = new AbortController();
  const streams = await Promise.all(clientIds.map(clientId => fetch(
    new URL(`/api/events?clientId=${encodeURIComponent(clientId)}`, server.state.url),
    { headers: { Authorization: `Bearer ${server.humanToken}` }, signal: abort.signal },
  )));
  return {
    abort,
    async close() {
      abort.abort();
      await Promise.all(streams.map(stream => stream.body?.cancel().catch(() => {})));
    },
  };
}

test('unresponsive SSE peers do not block map status, map read, or workbench stop', async t => {
  process.env.CONTEXT_GUARD_FENCE_MS = '50';
  const f = await fixture();
  const server = await startServer({ root: f.root, port: 0 });
  t.after(async () => {
    delete process.env.CONTEXT_GUARD_FENCE_MS;
    await server.close().catch(() => {});
  });
  const hung = await hungPeers(server, [
    '816a3883-fee6-437c-bbde-76b1243c8919',
    '7c962398-bbc4-4800-85ae-6dedc2738f7b',
  ]);
  t.after(() => hung.close());
  const { token } = await request(server.state, '/api/session', {
    method: 'POST',
    body: { sessionId: agentSession, worktreeRoot: f.root },
  });
  const status = await request(server.state, '/api/state', { token });
  assert.equal(status.version, server.store.version);
  assert.ok(status.doc);
  const read = await request(server.state, '/api/state?node=N1', { token });
  assert.equal(read.node.id, 'N1');
  const stopped = await stopServer(f.root);
  assert.equal(stopped.stopped, true);
});

test('responsive dirty pages still fence Agent reads', async t => {
  process.env.CONTEXT_GUARD_FENCE_MS = '50';
  const f = await fixture();
  const server = await startServer({ root: f.root, port: 0 });
  t.after(async () => {
    delete process.env.CONTEXT_GUARD_FENCE_MS;
    await server.close().catch(() => {});
  });
  const clientId = 'responsive-dirty';
  const abort = new AbortController();
  const stream = await fetch(
    new URL(`/api/events?clientId=${encodeURIComponent(clientId)}`, server.state.url),
    { headers: { Authorization: `Bearer ${server.humanToken}` }, signal: abort.signal },
  );
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const respond = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (!block.includes('event: checkpoint')) continue;
        const checkpoint = JSON.parse(block.split('\n').find(line => line.startsWith('data: ')).slice(6)).checkpoint;
        await request(server.state, '/api/presence', {
          token: server.humanToken,
          method: 'POST',
          body: { clientId, dirty: true, version: server.store.version, checkpoint },
        });
        return;
      }
    }
  })();
  t.after(async () => {
    abort.abort();
    await reader.cancel().catch(() => {});
    await respond.catch(() => {});
  });
  const { token } = await request(server.state, '/api/session', {
    method: 'POST',
    body: { sessionId: agentSession, worktreeRoot: f.root },
  });
  await assert.rejects(Promise.all([request(server.state, '/api/state', { token }), respond]), { code: 'UI_PENDING' });
});
