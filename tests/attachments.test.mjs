import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadAttachment } from '../prototype/attachments.mjs';

test('Cloud browser upload includes stable owner and captured view, uses cookie not undefined bearer', async t => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => { request = { url, ...options }; return { ok: true, json: async () => ({ file: { path: 'quark-job:test' } }) }; });
  const job = { id: 'one', name: 'fixture.pdf', blob: new Blob(['synthetic']), controller: new AbortController(),
    viewId: 'session:one', target: { root: 'cloud:project', nodeId: 'N1', kind: 'node', ownerId: 'N1' } };
  const result = await uploadAttachment({ root: 'cloud:project', apiBase: '/api/workbench/projects/project' }, job);
  assert.equal(request.url, '/api/workbench/projects/project/api/attachments?view=session%3Aone');
  assert.equal(request.credentials, 'same-origin'); assert.equal(request.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(request.body).target, { nodeId: 'N1', kind: 'node', ownerId: 'N1' });
  assert.equal(result.serverManaged, true);
});

test('local attachment endpoint and token remain compatible', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/attachments'); assert.equal(options.headers.Authorization, 'Bearer fixture');
    assert.equal(JSON.parse(options.body).nodeId, 'N1');
    return { ok: true, json: async () => ({ path: 'docs/shots/file.pdf' }) };
  });
  const result = await uploadAttachment({ token: 'fixture', root: '/local' }, { id: 'one', blob: new Blob(['x']), controller: new AbortController(), target: { nodeId: 'N1' } });
  assert.equal(result.path, 'docs/shots/file.pdf'); assert.equal(result.serverManaged, undefined);
});
