import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hash } from '../scripts/shared/io.mjs';
import { writeProjectFile } from '../scripts/cloud/coordinator-file.mjs';
import { coordinatorTools, selectCoordinatorTools } from '../scripts/cloud/coordinator-tools.mjs';

const feedback = `# 回答质量反馈

本文记录用户对 Coordinator 回答质量的反馈，供后续改进参考。

## 反馈

1. 希望 Coordinator 回复附带处理用时。
2. Coordinator 回复过长、不够简短易懂，需要改进。
`;

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-file-write-'));
  return { directory, receiptFile: path.join(directory, 'receipts', 'file-writes.json'), root: path.join(directory, 'repo') };
}

test('write_file stays hidden until the project allows one repository text file', () => {
  assert.equal(selectCoordinatorTools(coordinatorTools).some(tool => tool.name === 'write_file'), false);
  assert.equal(selectCoordinatorTools(coordinatorTools, { fileWrite: true }).some(tool => tool.name === 'write_file'), true);
  assert.equal(coordinatorTools.find(tool => tool.name === 'write_file').input_schema.required.includes('expectedSha'), false);
});

test('Unfinished file writes preserve intervening edits and recover only the original or already-written content', async t => {
  for (const expected of [null, 'original content']) {
    for (const crashContent of [expected, 'requested content']) {
      await t.test(`${expected === null ? 'create' : 'replace'} interrupted ${crashContent === expected ? 'before' : 'after'} write`, async t => {
        const { directory, receiptFile, root } = await fixture();
        t.after(() => fs.rm(directory, { recursive: true, force: true }));
        await fs.mkdir(root);
        await fs.mkdir(path.dirname(receiptFile));
        const target = path.join(root, 'notes.md'), content = 'requested content';
        const expectedSha = expected === null ? undefined : hash(expected);
        const input = { root, receiptFile, enabled: true, operationId: 'pending-write', relativePath: 'notes.md', content, expectedSha };
        // A legacy pending receipt must remain recoverable without a migration.
        const fingerprint = hash(JSON.stringify({ path: input.relativePath, content, expectedSha: expectedSha || null }));
        await fs.writeFile(receiptFile, JSON.stringify({ operations: { [input.operationId]: { fingerprint, committed: false, result: null } } }));
        await fs.writeFile(target, 'new external edit');
        const pendingReceipt = await fs.readFile(receiptFile, 'utf8');
        await assert.rejects(writeProjectFile(input), { code: 'VERSION_CONFLICT' });
        assert.equal(await fs.readFile(target, 'utf8'), 'new external edit');
        assert.equal(await fs.readFile(receiptFile, 'utf8'), pendingReceipt);
        await fs.rm(target);
        if (expected !== null) await assert.rejects(writeProjectFile(input), { code: 'VERSION_CONFLICT' });
        if (crashContent !== null) await fs.writeFile(target, crashContent);
        const recovered = await writeProjectFile(input);
        assert.equal(recovered.created, expected === null);
        assert.equal(await fs.readFile(target, 'utf8'), content);
        await fs.writeFile(target, 'edit after acknowledgment');
        assert.deepEqual(await writeProjectFile(input), recovered);
        assert.equal(await fs.readFile(target, 'utf8'), 'edit after acknowledgment');
      });
    }
  }
});

test('Coordinator writes one feedback file and refuses a second path, a hidden path, or an escaped symlink', async t => {
  const { directory, receiptFile, root } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(root);
  const input = { root, receiptFile, enabled: true, operationId: 'feedback-1', relativePath: 'docs/feedback.md', content: feedback };
  await assert.rejects(writeProjectFile({ ...input, enabled: false }), { code: 'FORBIDDEN' });
  const created = await writeProjectFile(input);
  assert.equal(created.kind, 'file-write');
  assert.equal(created.created, true);
  assert.equal(created.committedToGit, false);
  assert.equal(created.sha256, hash(feedback));
  assert.equal(await fs.readFile(path.join(root, 'docs/feedback.md'), 'utf8'), feedback);
  assert.deepEqual(await writeProjectFile(input), created);
  await assert.rejects(writeProjectFile({ ...input, content: `${feedback}\n补充\n` }), { code: 'ID_REUSED' });
  await assert.rejects(writeProjectFile({ ...input, operationId: 'feedback-2', content: `${feedback}\n补充\n` }), { code: 'VERSION_CONFLICT' });
  const replaced = await writeProjectFile({ ...input, operationId: 'feedback-2', content: `${feedback}\n补充\n`, expectedSha: created.sha256 });
  assert.equal(replaced.created, false);
  assert.match(await fs.readFile(path.join(root, 'docs/feedback.md'), 'utf8'), /补充/);
  for (const relativePath of ['../outside.md', '/tmp/outside.md', '.env', '.git/config', 'docs/.secret', 'node_modules/pkg/index.js']) {
    await assert.rejects(writeProjectFile({ ...input, operationId: `bad-${relativePath.length}`, relativePath, content: 'no' }), { code: 'INVALID_ARGUMENT' });
  }
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-file-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(outside, path.join(root, 'linked'));
  await assert.rejects(writeProjectFile({ ...input, operationId: 'escape', relativePath: 'linked/pwned.md', content: 'no' }), { code: 'INVALID_ARGUMENT' });
  assert.equal(await fs.readdir(outside).then(names => names.length, () => 0), 0);
  const saved = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
  saved.operations['feedback-1'].committed = false;
  await fs.writeFile(receiptFile, JSON.stringify(saved));
  await fs.rm(path.join(root, 'docs/feedback.md'));
  const recovered = await writeProjectFile(input);
  assert.equal(recovered.sha256, created.sha256);
  assert.equal(await fs.readFile(path.join(root, 'docs/feedback.md'), 'utf8'), feedback);
});
