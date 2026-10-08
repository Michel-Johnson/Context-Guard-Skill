import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sharedMappings, sharedPackageFiles } from './shared-package-contract.mjs';

test('共享包只从 Skill 唯一源码导出，核心不依赖具体后端', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  for (const deps of [pkg.dependencies, pkg.devDependencies]) {
    assert.ok(!Object.keys(deps || {}).some(name => name.startsWith('@michelj/context-guard')));
  }
  for (const kind of ['core', 'workbench']) {
    const files = sharedPackageFiles(kind);
    assert.equal(new Set(files).size, files.length);
    for (const [source, target] of sharedMappings(kind)) {
      assert.equal(fs.lstatSync(source).isFile(), true, source);
      assert.doesNotMatch(target, /(?:^|\/)(?:cloud|plugins|deploy|\.codex|tests|node_modules)(?:\/|$)/);
    }
  }
  assert.ok(sharedPackageFiles('core').includes('interface-contract-v2.json'));
  assert.ok(sharedPackageFiles('core').includes('roles/Coordinator.md'));
  assert.ok(sharedPackageFiles('workbench').includes('working-blot-atlas.png'));
  assert.ok(!sharedPackageFiles('core').some(file => /design-slack|design-cloud-attachments|design-coordinator-compaction/.test(file)));
  assert.throws(() => sharedPackageFiles('unknown'));
});
