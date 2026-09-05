import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { memoryRequest } from '../scripts/workbench/memory.mjs';

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
