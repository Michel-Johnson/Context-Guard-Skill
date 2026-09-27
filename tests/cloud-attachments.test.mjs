import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { CloudAttachments, attachmentInput, attachmentPatch } from '../scripts/cloud/attachments.mjs';
import { startCloudServer } from '../scripts/cloud/server.mjs';
import { readJSON } from '../scripts/shared/io.mjs';

const bytes = Buffer.from('%PDF-1.4\nSynthetic attachment fixture\n%%EOF\n');
const input = (uploadId = 'one') => ({ uploadId, name: 'fixture.pdf', target: { nodeId: 'T0', kind: 'node', ownerId: 'T0' } });
const stage = (service, uploadId = 'one', body = bytes, patch = {}) => service.stage('project', 'main', { ...input(uploadId), ...patch }, Readable.from([body]));
const share = { url: 'https://pan.quark.cn/s/testfixture', passcode: 'Ab12' };
const waitFor = async fn => {
  for (let i = 0; i < 300; i++) { const result = await fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Timed out waiting for attachment');
};
async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-attachments-'));
  let doc = { root: { id: 'T0', title: 'Files', children: [] } }, uploads = 0;
  const provider = { upload: async file => { uploads++; assert.deepEqual(await fs.readFile(file), bytes); return 'remote-file'; }, share: async () => share, ...overrides };
  const publish = async (job, card, options) => { const [op] = attachmentPatch(doc, job, card, options); Object.assign(doc.root, op.fields); };
  const service = new CloudAttachments({ directory, provider, publish });
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, service, provider, publish, doc: () => doc, uploads: () => uploads };
}

test('staging validates metadata and rejects the retired base64 field', () => {
  assert.deepEqual(attachmentInput(input()), input());
  for (const name of ['../secret', 'NUL.pdf', 'bad\\file.pdf', 'bad.pdf ', '']) assert.throws(() => attachmentInput({ ...input(), name }));
  assert.throws(() => attachmentInput({ ...input(), target: { nodeId: 'T0', kind: 'mem', ownerId: '../x' } }));
  assert.throws(() => attachmentInput({ ...input(), extra: true }));
  assert.throws(() => attachmentInput({ ...input(), base64: bytes.toString('base64') }));
});

test('streaming accepts files beyond 8 MiB and removes rejected partial files', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-attachment-stream-'));
  const large = Buffer.alloc(8 * 1024 * 1024 + 1, 7);
  let uploadedSize = 0;
  const service = new CloudAttachments({ directory, maxFileBytes: large.length,
    provider: { upload: async file => { uploadedSize = (await fs.stat(file)).size; return 'large-file'; }, share: async () => share },
    publish: async () => {} });
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const receipt = await stage(service, 'large', large);
  await waitFor(async () => (await service.get('project', 'main', receipt.id)).status === 'ready');
  assert.equal(uploadedSize, large.length);

  service.maxFileBytes = 8;
  await assert.rejects(stage(service, 'too-large', Buffer.alloc(9)), { code: 'ATTACHMENT_TOO_LARGE' });
  await assert.rejects(stage(service, 'empty', Buffer.alloc(0)), { code: 'INVALID_ATTACHMENT' });
  const broken = Readable.from((async function* () { yield Buffer.from('part'); throw new Error('interrupted'); })());
  await assert.rejects(service.stage('project', 'main', input('broken'), broken), /interrupted/);
  assert.equal(service.receiving, 0);
  const incoming = await fs.readdir(path.join(directory, 'incoming'));
  assert.deepEqual(incoming, []);
});

test('startup removes only incomplete ingress files and preserves unrelated evidence', async t => {
  const f = await fixture(t);
  const incoming = path.join(f.directory, 'incoming');
  await fs.mkdir(incoming);
  await fs.writeFile(path.join(incoming, '11111111-1111-1111-1111-111111111111.part'), 'incomplete');
  await fs.writeFile(path.join(incoming, 'evidence.txt'), 'preserve');
  await f.service.start();
  assert.deepEqual(await fs.readdir(incoming), ['evidence.txt']);
});

test('upload, protected link, map persistence and cleanup; duplicates do not reupload', async t => {
  const f = await fixture(t);
  const staged = await stage(f.service);
  const ready = await waitFor(async () => { const j = await f.service.get('project', 'main', staged.id); return j.status === 'ready' && j; });
  assert.equal(f.doc().root.files[0].path, share.url);
  assert.equal(f.doc().root.files[0].passcode, share.passcode);
  assert.equal(f.doc().root.files[0].status, 'ready');
  await assert.rejects(fs.stat(f.service.stageFile(ready)), { code: 'ENOENT' });
  await stage(f.service);
  assert.equal(f.uploads(), 1);
  await assert.rejects(stage(f.service, 'one', bytes, { name: 'other.pdf' }), { code: 'ID_REUSED' });
  await assert.rejects(f.service.get('another-project', 'main', staged.id), { code: 'NOT_FOUND' });
  await assert.rejects(f.service.get('project', 'session:other', staged.id), { code: 'NOT_FOUND' });
});

test('share failure keeps bytes and FID; retry does not upload again', async t => {
  let fail = true;
  const f = await fixture(t, { share: async () => { if (fail) throw new Error('private provider error'); return share; } });
  const staged = await stage(f.service);
  const error = await waitFor(async () => { const j = await f.service.get('project', 'main', staged.id); return j.status === 'error' && j; });
  assert.equal(error.fid, 'remote-file'); assert.equal(error.uncertain, false);
  assert.deepEqual(await fs.readFile(f.service.stageFile(error)), bytes);
  assert.equal(JSON.stringify(f.service.public(error)).includes('private provider error'), false);
  fail = false; await f.service.retry('project', 'main', staged.id);
  await waitFor(async () => (await f.service.get('project', 'main', staged.id)).status === 'ready');
  assert.equal(f.uploads(), 1);
});

test('native CLI remote path and file identity survive restart without duplicate upload', async t => {
  const remotePath = '/cloud-12345678-1234-1234-1234-123456789abc.pdf';
  let uploads = 0;
  const f = await fixture(t, {
    upload: async () => { uploads++; return { fileId: 'native-file', remotePath }; },
    share: async () => { throw new Error('temporary share failure'); },
  });
  const staged = await stage(f.service);
  await waitFor(async () => (await f.service.get('project', 'main', staged.id)).status === 'error');
  await f.service.close();
  const saved = await readJSON(f.service.file(staged.id));
  assert.equal(saved.fid, 'native-file');
  assert.equal(saved.remotePath, remotePath);
  const restarted = new CloudAttachments({ directory: f.directory, publish: f.publish, provider: {
    upload: async () => { throw new Error('must not reupload'); },
    share: async (fid, location) => { assert.equal(fid, 'native-file'); assert.equal(location, remotePath); return share; },
  } });
  t.after(() => restarted.close());
  await restarted.start();
  await restarted.retry('project', 'main', staged.id);
  await waitFor(async () => (await restarted.get('project', 'main', staged.id)).status === 'ready');
  await restarted.close();
  assert.equal(uploads, 1);
  assert.equal(f.doc().root.files[0].fileId, 'native-file');
});

test('uncertain upload never automatically reuploads, even across restart', async t => {
  const f = await fixture(t, { upload: async () => { throw new Error('connection lost'); } });
  const staged = await stage(f.service);
  await waitFor(async () => (await f.service.get('project', 'main', staged.id)).status === 'error');
  await assert.rejects(f.service.retry('project', 'main', staged.id), { code: 'UPLOAD_UNCERTAIN' });
  const job = await f.service.get('project', 'main', staged.id);
  job.status = 'uploading'; await f.service.save(job); await f.service.close();
  let called = false;
  const restarted = new CloudAttachments({ directory: f.directory, publish: f.publish, provider: { upload: async () => { called = true; } } });
  await restarted.start(); await restarted.close();
  assert.equal(called, false);
  assert.equal((await readJSON(restarted.file(job.id))).uncertain, true);
});

test('invalid share receipts are never persisted or trusted by retry', async t => {
  let calls = 0;
  const f = await fixture(t, { share: async () => { calls++; return { url: 'https://evil.example/file', passcode: 'Ab12' }; } });
  const receipt = await stage(f.service);
  await waitFor(async () => (await f.service.get('project', 'main', receipt.id)).status === 'error');
  assert.equal((await f.service.get('project', 'main', receipt.id)).share, undefined);
  await f.service.retry('project', 'main', receipt.id);
  await waitFor(async () => (await f.service.get('project', 'main', receipt.id)).status === 'error');
  assert.equal(calls, 2);
  assert.equal(f.doc().root.files[0].path.startsWith('quark-job:'), true);
});

test('removed owner is never recreated and unrelated files survive', () => {
  const doc = { root: { id: 'T0', files: [{ path: 'existing.pdf' }], memories: [{ _attachmentId: 'memory-a', files: [] }], children: [] } };
  const job = { id: 'job', target: { nodeId: 'T0', kind: 'mem', ownerId: 'memory-a' } };
  const card = { attachmentId: 'job', path: share.url };
  assert.throws(() => attachmentPatch(doc, job, card), { code: 'ATTACHMENT_REMOVED' });
  const ops = attachmentPatch(doc, job, card, { create: true });
  assert.equal(ops[0].fields.memories[0].files[0].path, share.url);
  assert.equal(doc.root.memories[0].files.length, 0);
  job.target.ownerId = 'removed';
  assert.throws(() => attachmentPatch(doc, job, card, { create: true }), { code: 'ATTACHMENT_OWNER_GONE' });
});

test('staging quota rejects additional files without discarding failed work', async t => {
  const f = await fixture(t, { share: async () => { throw new Error('offline'); } });
  f.service.maxStagedBytes = bytes.length;
  const staged = await stage(f.service);
  await waitFor(async () => (await f.service.get('project', 'main', staged.id)).status === 'error');
  await assert.rejects(stage(f.service, 'two'), { code: 'STAGING_FULL' });
});

test('concurrent repeated submissions and retries produce one remote file', async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 4 }, () => stage(f.service)));
  assert.equal(new Set(results.map(item => item.id)).size, 1);
  await waitFor(async () => (await f.service.get('project', 'main', results[0].id)).status === 'ready');
  await Promise.all(Array.from({ length: 4 }, () => f.service.retry('project', 'main', results[0].id)));
  assert.equal(f.uploads(), 1);
});

test('Map write failure retains bytes and confirmed link; restart resumes without another upload/share', async t => {
  const f = await fixture(t);
  const publish = f.service.publish;
  f.service.publish = async (job, card, options) => { if (card.status === 'ready') throw new Error('disk offline'); return publish(job, card, options); };
  const receipt = await stage(f.service);
  const failed = await waitFor(async () => { const j = await f.service.get('project', 'main', receipt.id); return j.status === 'error' && j; });
  assert.deepEqual(failed.share, share);
  assert.deepEqual(await fs.readFile(f.service.stageFile(failed)), bytes);
  await f.service.close();
  failed.status = 'linked'; delete failed.error; await f.service.save(failed);
  const restarted = new CloudAttachments({ directory: f.directory, publish,
    provider: { upload: () => assert.fail('must reuse FID'), share: () => assert.fail('must reuse link') } });
  t.after(() => restarted.close());
  await restarted.start();
  await waitFor(async () => (await restarted.get('project', 'main', receipt.id)).status === 'ready');
  await restarted.close();
});

test('Cloud HTTP upload uses authenticated project/view, persists card and rejects cross-origin requests', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-quark-http-'));
  let loseCreation = false, uploads = 0;
  const service = await startCloudServer({ port: 0, dataDir, adminToken: 'test-admin',
    memoryConfig: { dataDir: path.join(dataDir, 'memory'), adminToken: 'test-memory', projects: { 'context-guard': { token: 'test-project' } } },
    attachmentProvider: { upload: async () => { uploads++; return 'http-file'; }, share: async () => share },
    faultInjector: async (point, job) => { if (point === 'attachment-map-committed' && job.status === 'staged' && loseCreation) { loseCreation = false; throw new Error('Lost creation result'); } },
  });
  t.after(async () => { await service.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const seed = await fetch(`${service.url}/v1/projects/context-guard/sessions/example`, { method: 'POST', headers: { Authorization: 'Bearer test-project', 'Content-Type': 'application/json' }, body: JSON.stringify({
    operationId: 'seed', baseVersion: null, baseMainVersion: null, sourceCommit: 'a'.repeat(40),
    memory: { map: { v: 1, project: 'Fixture', bootstrap: 'ready', flows: [], root: { id: 'T0', title: 'Files', kind: 'module', state: 'dirty', children: [] } }, records: {} },
  }) });
  assert.equal(seed.status, 200, await seed.text());
  const base = `${service.url}/api/workbench/projects/context-guard/api/attachments`, view = '?view=session%3Aexample';
  const auth = { Authorization: 'Bearer test-admin' };
  const uploadOptions = (uploadId = 'one', extraHeaders = {}) => ({ method: 'POST', headers: { ...auth,
    'Content-Type': 'application/octet-stream', 'X-Context-Guard-Upload-Id': uploadId, 'X-Context-Guard-Node-Id': 'T0',
    'X-Context-Guard-Owner-Kind': 'node', 'X-Context-Guard-Owner-Id': 'T0',
    'X-Context-Guard-File-Name': encodeURIComponent('fixture.pdf'), ...extraHeaders }, body: bytes });
  const options = uploadOptions();
  assert.equal((await fetch(base + view, { ...options, headers: { ...options.headers, Authorization: undefined } })).status, 401);
  assert.equal((await fetch(base + view, uploadOptions('one', { Origin: 'https://evil.example' }))).status, 403);
  assert.equal((await fetch(base + view, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input(), base64: bytes.toString('base64') }) })).status, 415);
  const accepted = await fetch(base + view, options); const receipt = await accepted.json();
  assert.equal(accepted.status, 202, JSON.stringify(receipt));
  await waitFor(async () => { const r = await fetch(`${base}/${receipt.id}${view}`, { headers: auth }); return (await r.json()).status === 'ready'; });
  const state = await fetch(`${service.url}/api/workbench/projects/context-guard/api/state${view}`, { headers: auth }).then(r => r.json());
  assert.equal(state.doc.root.files[0].path, share.url);
  assert.equal(state.doc.root.files[0].status, 'ready');
  assert.equal((await fetch(`${base}/${receipt.id}?view=main`, { headers: auth })).status, 404);
  loseCreation = true;
  const lostRequest = uploadOptions('lost-creation');
  assert.equal((await fetch(base + view, lostRequest)).status, 500);
  const beforeRemoval = await fetch(`${service.url}/api/workbench/projects/context-guard/api/state${view}`, { headers: auth }).then(r => r.json());
  assert.equal(beforeRemoval.doc.root.files.length, 2);
  const removal = await fetch(`${service.url}/api/workbench/projects/context-guard/api/commit${view}`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: 'remove-placeholder', baseVersion: beforeRemoval.version,
      operations: [{ type: 'update', id: 'T0', fields: { files: [beforeRemoval.doc.root.files[0]] } }] }),
  });
  assert.equal(removal.status, 200);
  const replay = await fetch(base + view, lostRequest).then(r => r.json());
  await waitFor(async () => { const j = await fetch(`${base}/${replay.id}${view}`, { headers: auth }).then(r => r.json()); return j.status === 'error'; });
  const afterRemoval = await fetch(`${service.url}/api/workbench/projects/context-guard/api/state${view}`, { headers: auth }).then(r => r.json());
  assert.equal(afterRemoval.doc.root.files.length, 1, 'lost creation receipt must not resurrect a removed attachment');
  assert.equal(uploads, 1, 'removed attachment must not reach Quark');
});
