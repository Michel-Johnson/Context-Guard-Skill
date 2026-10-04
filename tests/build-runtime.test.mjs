import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const exec = promisify(execFile);
const builder = fileURLToPath(new URL('../bin/build-runtime.mjs', import.meta.url));
const releaseURL = (name, version) => `https://github.com/Michel-Johnson/Context-Guard-Cloud/releases/download/shared-v${version}/michelj-${name.split('/')[1]}-${version}.tgz`;
async function fixture(t, { declaredVersion = '1.0.0', installedVersion = '1.0.0' } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-build-runtime-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'skill'), outside = path.join(directory, 'outside');
  await fs.mkdir(path.join(root, 'bin'), { recursive: true });
  await fs.mkdir(outside);
  await fs.copyFile(builder, path.join(root, 'bin/build-runtime.mjs'));
  const dependencies = {};
  for (const [name, files] of [
    ['@michelj/context-guard-core', { 'example.mjs': 'export const example = 1;\n', 'roles/Tester.md': '# Tester\n' }],
    ['@michelj/context-guard-workbench', { 'workbench.html': '<!doctype html><title>Test</title>' }],
  ]) {
    dependencies[name] = releaseURL(name, declaredVersion);
    const packageRoot = path.join(root, 'node_modules', name);
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name, version: installedVersion, type: 'module' }));
    for (const [file, data] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(packageRoot, file)), { recursive: true });
      await fs.writeFile(path.join(packageRoot, file), data);
    }
  }
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: dependencies }));
  return { root, outside,
    run: async () => {
      try { const result = await exec(process.execPath, ['bin/build-runtime.mjs'], { cwd: root, windowsHide: true }); return { code: 0, ...result }; }
      catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
    },
  };
}

test('runtime builder materializes pinned core and UI with a repeatable manifest', async t => {
  const f = await fixture(t);
  assert.equal((await f.run()).code, 0);
  const first = await fs.readFile(path.join(f.root, '.runtime-generated.json'), 'utf8');
  assert.equal((await f.run()).code, 0);
  assert.equal(await fs.readFile(path.join(f.root, '.runtime-generated.json'), 'utf8'), first);
  assert.equal(await fs.readFile(path.join(f.root, 'Tester.md'), 'utf8'), '# Tester\n');
  assert.equal(await fs.readFile(path.join(f.root, 'scripts/shared/example.mjs'), 'utf8'), 'export const example = 1;\n');
});

test('runtime builder preserves existing source files instead of overwriting them', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'Tester.md'), '# User source\n');
  assert.notEqual((await f.run()).code, 0);
  assert.equal(await fs.readFile(path.join(f.root, 'Tester.md'), 'utf8'), '# User source\n');
});

test('runtime builder preserves edits to previously generated files', async t => {
  const f = await fixture(t);
  assert.equal((await f.run()).code, 0);
  await fs.writeFile(path.join(f.root, 'Tester.md'), '# User edit\n');
  assert.notEqual((await f.run()).code, 0);
  assert.equal(await fs.readFile(path.join(f.root, 'Tester.md'), 'utf8'), '# User edit\n');
});

test('runtime builder rejects generated manifest path traversal before modifying files', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.outside, 'sentinel'), 'preserve');
  await fs.writeFile(path.join(f.root, '.runtime-generated.json'), JSON.stringify({ files: { '../outside/sentinel': 'invalid' } }));
  assert.notEqual((await f.run()).code, 0);
  assert.equal(await fs.readFile(path.join(f.outside, 'sentinel'), 'utf8'), 'preserve');
});

test('runtime builder rejects a destination junction before writing outside the Skill root', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, 'scripts'));
  await fs.symlink(f.outside, path.join(f.root, 'scripts/shared'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await f.run();
  assert.notEqual(result.code, 0, result.stdout);
  assert.deepEqual(await fs.readdir(f.outside), []);
});

test('runtime builder rejects a linked manifest before reading or overwriting it', async t => {
  const f = await fixture(t);
  const outsideManifest = path.join(f.outside, 'manifest.json');
  const original = JSON.stringify({ files: {} });
  await fs.writeFile(outsideManifest, original);
  try { await fs.symlink(outsideManifest, path.join(f.root, '.runtime-generated.json'), 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip(`File symlinks unavailable: ${error.code}`); return; }
    throw error;
  }
  assert.notEqual((await f.run()).code, 0);
  assert.equal(await fs.readFile(outsideManifest, 'utf8'), original);
});

test('runtime builder rejects installed 1.0.0 when the fixed release requires 1.1.0', async t => {
  const f = await fixture(t, { declaredVersion: '1.1.0' });
  const result = await f.run();
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Unexpected runtime dependency/);
  assert.equal(await fs.access(path.join(f.root, '.runtime-generated.json')).then(() => true, () => false), false);
});

test('runtime builder upgrades matching fixed releases from 1.0.0 to 1.0.1', async t => {
  const f = await fixture(t);
  assert.equal((await f.run()).code, 0);
  const packageFile = path.join(f.root, 'package.json');
  const manifest = JSON.parse(await fs.readFile(packageFile, 'utf8'));
  for (const name of Object.keys(manifest.devDependencies)) {
    manifest.devDependencies[name] = releaseURL(name, '1.0.1');
    const descriptorFile = path.join(f.root, 'node_modules', name, 'package.json');
    const descriptor = JSON.parse(await fs.readFile(descriptorFile, 'utf8'));
    descriptor.version = '1.0.1';
    await fs.writeFile(descriptorFile, JSON.stringify(descriptor));
  }
  await fs.writeFile(packageFile, JSON.stringify(manifest));
  await fs.writeFile(path.join(f.root, 'node_modules/@michelj/context-guard-core/example.mjs'), 'export const example = 2;\n');
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr);
  assert.equal(await fs.readFile(path.join(f.root, 'scripts/shared/example.mjs'), 'utf8'), 'export const example = 2;\n');
  const generated = JSON.parse(await fs.readFile(path.join(f.root, '.runtime-generated.json'), 'utf8'));
  for (const name of Object.keys(manifest.devDependencies)) {
    assert.equal(generated.packages[name].version, '1.0.1');
    assert.equal(generated.packages[name].dependency, releaseURL(name, '1.0.1'));
  }
});
