import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../scripts/workbench/server.mjs';
import { request } from '../scripts/workbench/cli.mjs';
import { encode } from '../scripts/shared/io.mjs';
import { applyOperations } from '../scripts/shared/map-model.mjs';
import { WorkbenchSync } from '../prototype/workbench-sync.mjs';
import { attachmentOwner, attachmentTarget } from '../prototype/attachments.mjs';

// Execute the current classic-script handlers, not copies of their algorithms.
// Only DOM rendering, upload transport and commit transport are substituted;
// stable-owner lookup, UI branches, diff generation and Map application are real.
async function attachmentUi(files, { failFirstFlush = false, removePending = false } = {}) {
  const source = await fs.readFile(new URL('../prototype/workbench-app.js', import.meta.url), 'utf8');
  const section = (name, next, asynchronous = false) => {
    const declaration = `${asynchronous ? 'async ' : ''}function ${name}(`;
    const start = source.indexOf(declaration), end = source.indexOf(`function ${next}(`, start);
    assert.ok(start >= 0 && end > start, `Actual attachment handler boundary: ${name}`);
    assert.equal(source.indexOf(declaration, start + declaration.length), -1, `Unique handler: ${name}`);
    return source.slice(start, end);
  };
  const owner = { id: 'B1', title: 'Fixture Bug', status: 'open', ...(files === undefined ? {} : { files: structuredClone(files) }) };
  const data = { id: 'T0', title: 'Fixture', kind: 'module', bugs: [owner], children: [] };
  const target = attachmentTarget(data, 'bug', 'B1', '/attachment-fixture');
  const path = 'docs/shots/same.png';
  const job = { id: 'stable-upload', target, viewId: 'main', name: 'same.png', blob: new Blob(['synthetic image']) };
  const sync = Object.create(WorkbenchSync.prototype), calls = { uploads: 0, flushes: 0, renders: 0, clears: 0, operations: [] };
  Object.assign(sync, { config: { root: target.root }, viewId: job.viewId, status: 'synced', ready: true, revision: 0,
    baseTree: structuredClone(data), a: { getRoot: () => data }, setStatus() {} });
  sync.flush = async () => {
    calls.flushes++;
    if (failFirstFlush && calls.flushes === 1) throw new Error('Controlled commit transport failure');
    const operations = sync.operations();
    calls.operations.push(structuredClone(operations));
    if (operations.length) sync.baseTree = applyOperations({ root: sync.baseTree }, operations, { kind: 'human', sessionId: 'attachment-fixture' }).doc.root;
  };
  const api = { attachmentOwner, async uploadAttachment(_configuration, input) {
    calls.uploads++;
    assert.equal(input.id, job.id, 'Transport receives the same stable upload job');
    return { path };
  } };
  if (removePending) job.saved = { path };
  const handlers = new Function('ctx', `
    let pendingWrite = ctx.job, workbenchSync = ctx.sync, data = ctx.data, attaching = null, attachDraft = '';
    const attachmentApi = () => ctx.api, rememberPreview = () => {};
    const renderAll = () => { ctx.calls.renders++; workbenchSync.revision++; };
    const clearAttach = () => { ctx.calls.clears++; pendingWrite = null; };
    ${section('filePathOf', 'normRepoPath')}
    ${section('ownerOf', 'isAttaching')}
    ${section('resumeAttachment', 'repoRelPath', true)}
    ${section('bindFileUi', 'unpackInbox')}
    return { resumeAttachment, bindFileUi, pending: () => pendingWrite };
  `)({ job, sync, data, api, calls });
  return { ...handlers, owner, data, target, job, path, sync, calls };
}

for (const [name, files] of [
  ['absent files', undefined],
  ['an existing string path', ['docs/shots/same.png']],
  ['a legacy whitespace string path', [' docs/shots/same.png ']],
  ['a legacy whitespace object path', [{ path: ' docs/shots/same.png ', name: 'Legacy label' }]],
]) test(`Actual upload handler recognizes ${name} and confirms one persisted reference`, async () => {
  const f = await attachmentUi(files);
  assert.equal(await f.resumeAttachment(f.job), true, `Upload must finish, not report an already-present reference as unsynced: ${f.job.error}`);
  assert.equal(f.job.running, false);
  assert.equal(f.pending(), null, 'A confirmed reference clears the captured pending job');
  assert.equal(f.calls.uploads, 1);
  const committed = attachmentOwner(f.sync.baseTree, f.target);
  assert.equal(committed.files.length, 1, 'Existing legacy references must not be appended twice');
  const reference = committed.files[0];
  assert.equal((typeof reference === 'string' ? reference : reference.path).trim(), f.path);
  if (files === undefined) assert.deepEqual(committed.files, [{ path: f.path, name: 'same.png' }]);
});

test('Actual upload retry reuses the saved same-name file after a failed reference commit', async () => {
  const f = await attachmentUi(undefined, { failFirstFlush: true });
  assert.equal(await f.resumeAttachment(f.job), false);
  assert.match(f.job.error, /Controlled commit transport failure/);
  assert.equal(f.pending(), f.job, 'Failed commit keeps the original job recoverable');
  assert.equal(f.job.saved.path, f.path);
  assert.equal(await f.resumeAttachment(f.job), true);
  assert.equal(f.calls.uploads, 1, 'Retry must not allocate/upload a second same-name file');
  assert.equal(f.calls.flushes, 2);
  assert.deepEqual(f.owner.files, [{ path: f.path, name: 'same.png' }]);
  assert.deepEqual(attachmentOwner(f.sync.baseTree, f.target).files, f.owner.files);
  assert.equal(f.pending(), null);
});

for (const removePending of [false, true]) test(`Actual remove-file click persists the selected reference removal (${removePending ? 'pending upload' : 'ordinary'})`, async () => {
  const f = await attachmentUi([' keep.txt ', { path: ' docs/shots/same.png ', name: 'Remove me' }], { removePending });
  const button = { dataset: { fk: 'bug', fi: 'B1', i: '1' } };
  const element = { querySelectorAll: selector => selector === '[data-act="rm-file"]' ? [button] : [], querySelector: () => null };
  f.bindFileUi(element, f.data);
  assert.equal(typeof button.onclick, 'function', 'The actual UI binder installed the click handler');
  let prevented = false;
  button.onclick({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(f.owner.files, [{ path: 'keep.txt' }]);
  assert.equal(f.calls.clears, removePending ? 1 : 0);
  await f.sync.flush();
  assert.deepEqual(attachmentOwner(f.sync.baseTree, f.target).files, [{ path: 'keep.txt' }]);
  assert.equal(f.calls.operations[0].length, 1, 'Explicit deletion produces a real Map diff');
  assert.deepEqual(Object.keys(f.calls.operations[0][0].fields), ['bugs']);
});

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
