import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const exec = promisify(execFile);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-core-owner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const dir of ['bin', 'scripts/shared', 'prototype', 'skill-reference', 'roles']) await fs.mkdir(path.join(root, dir), { recursive: true });
  await fs.copyFile(new URL('../bin/build-runtime.mjs', import.meta.url), path.join(root, 'bin/build-runtime.mjs'));
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  for (const file of ['README.md', 'Coordinator.md', 'Executor.md', 'Tester.md']) await fs.writeFile(path.join(root, 'roles', file), '# 用户源码\n');
  for (const [file, name] of [['scripts/shared/package.json', '@michelj/context-guard-core'], ['prototype/package.json', '@michelj/context-guard-workbench']]) {
    await fs.writeFile(path.join(root, file), JSON.stringify({ name, version: '1.0.0', repository: 'github:Michel-Johnson/Context-Guard-Skill' }));
  }
  const run = () => exec(process.execPath, ['bin/build-runtime.mjs'], { cwd: root, windowsHide: true });
  return { root, run };
}
test('Skill build validates local source without Cloud packages or rewriting user edits', async t => {
  const { root, run } = await fixture(t);
  await run();
  await fs.writeFile(path.join(root, 'roles', 'Tester.md'), '# 新修改\n');
  await fs.writeFile(path.join(root, '.runtime-generated.json'), '{旧生成记录，不再使用}');
  await run();
  assert.equal(await fs.readFile(path.join(root, 'roles', 'Tester.md'), 'utf8'), '# 新修改\n');
  assert.equal(await fs.readFile(path.join(root, '.runtime-generated.json'), 'utf8'), '{旧生成记录，不再使用}');
  await assert.rejects(fs.access(path.join(root, 'node_modules')), { code: 'ENOENT' });
});
test('Skill rejects a restored dependency on Cloud or its own exported packages', async t => {
  const { root, run } = await fixture(t);
  for (const field of ['dependencies', 'devDependencies']) for (const name of ['core', 'workbench', 'cloud']) {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ [field]: { ['@michelj/context-guard-' + name]: '1.0.0' } }));
    await assert.rejects(run(), /must own its core and UI/);
  }
});
test('Skill build rejects linked source roots without writing outside the checkout', async t => {
  const { root, run } = await fixture(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-owner-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.rmdir(path.join(root, 'skill-reference'));
  await fs.symlink(outside, path.join(root, 'skill-reference'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(run(), /symlinks or junctions/);
  assert.deepEqual(await fs.readdir(outside), []);
});
test('Skill build rejects missing and foreign-identity source packages', async t => {
  const { root, run } = await fixture(t);
  await fs.writeFile(path.join(root, 'scripts/shared/package.json'), JSON.stringify({ name: 'foreign', version: '1.0.0' }));
  await assert.rejects(run(), /Invalid source package identity/);
  await fs.unlink(path.join(root, 'prototype/package.json'));
  await assert.rejects(run());
});
