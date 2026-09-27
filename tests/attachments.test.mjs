import test from 'node:test';
import assert from 'node:assert/strict';
import { canUploadAttachment, uploadAttachment } from '../prototype/attachments.mjs';

test('overview and unconfigured Cloud projects reject uploads before reading or sending files', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('must not upload'));
  assert.equal(canUploadAttachment({ root: '/local' }), true);
  assert.equal(canUploadAttachment({ root: 'cloud:project', interfaceCapabilities: { attachments: true } }), true);
  for (const config of [{ root: 'cloud:overview' }, { root: 'cloud:project', interfaceCapabilities: { attachments: false } }]) {
    assert.equal(canUploadAttachment(config), false);
    await assert.rejects(uploadAttachment(config, {}), /当前页面不支持上传附件/);
  }
});

test('Cloud browser upload includes stable owner and captured view, uses cookie not undefined bearer', async t => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => { request = { url, ...options }; return { ok: true, json: async () => ({ file: { path: 'quark-job:test' } }) }; });
  const job = { id: 'one', name: 'fixture.pdf', blob: new Blob(['synthetic'], { type: 'application/json' }), controller: new AbortController(),
    viewId: 'session:one', target: { root: 'cloud:project', nodeId: 'N1', kind: 'node', ownerId: 'N1' } };
  const result = await uploadAttachment({ root: 'cloud:project', apiBase: '/api/workbench/projects/project' }, job);
  assert.equal(request.url, '/api/workbench/projects/project/api/attachments?view=session%3Aone');
  assert.equal(request.credentials, 'same-origin'); assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.body, job.blob);
  assert.equal(request.headers['Content-Type'], 'application/octet-stream');
  assert.equal(request.headers['X-Context-Guard-Upload-Id'], 'one');
  assert.equal(request.headers['X-Context-Guard-Node-Id'], 'N1');
  assert.equal(request.headers['X-Context-Guard-Owner-Kind'], 'node');
  assert.equal(request.headers['X-Context-Guard-Owner-Id'], 'N1');
  assert.equal(decodeURIComponent(request.headers['X-Context-Guard-File-Name']), 'fixture.pdf');
  assert.equal(String(request.body).includes('base64'), false);
  assert.equal(result.serverManaged, true);
});

test('Cloud browser sends files larger than the former 8 MiB limit without reading them into JavaScript memory', async t => {
  const blob = new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]);
  let request;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { request = options; return { ok: true, json: async () => ({ file: {} }) }; });
  await uploadAttachment({ root: 'cloud:project', apiBase: '/cloud' }, { id: 'large', name: 'large.pdf', blob,
    controller: new AbortController(), target: { nodeId: 'N1', kind: 'node', ownerId: 'N1' } });
  assert.equal(request.body, blob);
  assert.equal(request.body.size, 8 * 1024 * 1024 + 1);
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
