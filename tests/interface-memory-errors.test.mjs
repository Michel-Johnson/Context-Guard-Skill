import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { memoryRequest } from '../scripts/workbench/memory.mjs';
import { startMemoryServer } from '../scripts/cloud/memory.mjs';
import { hash } from '../scripts/shared/io.mjs';

test('IF-016: legacy memory transport classifies empty, HTML, truncated and denied replies', async t => {
  let kind = 'html';
  const server = http.createServer((req, res) => {
    if (kind === 'denied') { res.writeHead(401); res.end('private diagnostic'); return; }
    res.writeHead(200, { 'Content-Type': kind === 'html' ? 'text/html' : 'application/json' });
    res.end(({ html: '<html>unavailable</html>', empty: '', truncated: '{', null: 'null', good: '{"projectId":"test","snapshot":null}' })[kind]);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const configuration = { url: `http://127.0.0.1:${server.address().port}`, projectId: 'test', token: 'test-only' };
  for (kind of ['html', 'empty', 'truncated', 'null']) await assert.rejects(memoryRequest({}, 'main', undefined, configuration), { code: 'MEMORY_UNAVAILABLE' });
  kind = 'denied'; await assert.rejects(memoryRequest({}, 'main', undefined, configuration), { code: 'UNAUTHORIZED' });
  kind = 'good'; assert.equal((await memoryRequest({}, 'main', undefined, configuration)).projectId, 'test');
});

test('private memory compresses large replies without changing versions, content or authorization', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-memory-transfer-'));
  let server;
  t.after(async () => { await server?.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const directory = path.join(dataDir, hash('test')); await fs.mkdir(directory);
  const main = { version: 'v1', memory: { map: { v: 1, project: 'test', root: { id: 'R', title: 'Root', purpose: 'project memory '.repeat(10000) } }, records: {} } };
  await fs.writeFile(path.join(directory, 'memory.json'), JSON.stringify({ revision: 1, main, sessions: {}, events: [] }));
  server = await startMemoryServer({ dataDir, adminToken: 'test-admin', projects: { test: { token: 'test-project' } } });
  const read = encoding => fetch(`${server.url}/v1/projects/test/main`, { headers: { Authorization: 'Bearer test-project', 'Accept-Encoding': encoding } });
  const compressed = await read('gzip, deflate');
  assert.equal(compressed.headers.get('content-encoding'), 'gzip');
  assert.equal(compressed.headers.get('cache-control'), 'no-store');
  assert.equal(compressed.headers.get('vary'), 'Accept-Encoding');
  assert.deepEqual((await compressed.json()).snapshot, main);
  for (const encoding of ['identity', 'gzip;q=0']) {
    const plain = await read(encoding);
    assert.equal(plain.headers.get('content-encoding'), null);
    assert.ok(Number(compressed.headers.get('content-length')) < Number(plain.headers.get('content-length')) / 10);
    assert.deepEqual((await plain.json()).snapshot, main);
  }
  assert.equal((await fetch(`${server.url}/v1/projects/test/main`)).status, 401);
});
