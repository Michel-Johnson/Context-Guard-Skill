import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../scripts/workbench/server.mjs';
import { request } from '../scripts/workbench/cli.mjs';
import { encode } from '../scripts/workbench/io.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-attachments-'));
  const context = path.join(root, '.codex/context');
  await fs.mkdir(context, { recursive: true });
  await fs.writeFile(path.join(context, 'map.json'), encode({
    v: 1,
    project: 'attachments-test',
    root: {
      id: 'T0', title: 'Test', children: [
        { id: 'N1', title: 'One', memories: [], children: [] },
        { id: 'N2', title: 'Two', memories: [], children: [] },
      ],
    },
  }));
  await fs.writeFile(path.join(context, 'sessions.jsonl'), `${JSON.stringify({ session_id: 'attachment-agent' })}\n`);
  return root;
}

test('attachment upload is idempotent, collision-safe, and restricted to the human workbench', async t => {
  const root = await fixture();
  const server = await startServer({ root, port: 0 });
  t.after(async () => { await server.close(); await fs.rm(root, { recursive: true, force: true }); });
  const call = (route, body, token = server.humanToken) => request(server.state, route, { token, method: 'POST', body });
  const input = content => ({ uploadId: randomUUID(), nodeId: 'N1', name: '相同文件.png', base64: Buffer.from(content).toString('base64') });
  const firstInput = input('first');
  const secondInput = input('second');
  const first = await call('/api/attachments', firstInput);
  const second = await call('/api/attachments', secondInput);

  assert.notEqual(first.path, second.path);
  assert.equal(await fs.readFile(path.join(root, first.path), 'utf8'), 'first');
  assert.equal(await fs.readFile(path.join(root, second.path), 'utf8'), 'second');
  assert.equal((await call('/api/attachments', firstInput)).duplicate, true);
  for (const changed of [{ name: 'other.png' }, { nodeId: 'N2' }, { base64: secondInput.base64 }]) {
    await assert.rejects(call('/api/attachments', { ...firstInput, ...changed }), { code: 'UPLOAD_ID_REUSED' });
  }

  const agent = await request(server.state, '/api/session', { method: 'POST', body: { sessionId: 'attachment-agent' } });
  await assert.rejects(call('/api/attachments', input('agent'), agent.token), { code: 'FORBIDDEN' });
  await assert.rejects(call('/api/attachments', { ...input('missing'), nodeId: 'gone' }), { code: 'NOT_FOUND' });
  await assert.rejects(call('/api/attachments', { ...input('bad'), base64: 'not base64' }), { code: 'INVALID_ATTACHMENT' });
});

test('attachment downloads require a current map reference and reject path traversal', async t => {
  const root = await fixture();
  const server = await startServer({ root, port: 0 });
  t.after(async () => { await server.close(); await fs.rm(root, { recursive: true, force: true }); });
  const uploadInput = { uploadId: randomUUID(), nodeId: 'N1', name: 'note.txt', base64: Buffer.from('saved attachment').toString('base64') };
  const saved = await request(server.state, '/api/attachments', { token: server.humanToken, method: 'POST', body: uploadInput });

  const download = relative => fetch(new URL(`/api/attachments?path=${encodeURIComponent(relative)}`, server.state.url), {
    headers: { Authorization: `Bearer ${server.humanToken}` },
  });
  assert.equal((await download(saved.path)).status, 404);
  await request(server.state, '/api/commit', {
    token: server.humanToken,
    method: 'POST',
    body: {
      operationId: randomUUID(),
      baseVersion: server.store.version,
      operations: [{ type: 'update', id: 'N1', fields: { files: [{ path: saved.path, name: 'note.txt' }] } }],
    },
  });
  const response = await download(saved.path);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'saved attachment');
  assert.equal((await download('../package.json')).status, 403);
});
