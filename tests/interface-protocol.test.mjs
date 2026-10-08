import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const sourceFiles = async directory => {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await sourceFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
};
test('shared contracts have no dependency on either service and install excludes demos', async () => {
  for (const file of await sourceFiles(new URL('../scripts/shared/', import.meta.url))) {
    const source = await fs.readFile(file, 'utf8');
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()['"][^'"]*(?:workbench|cloud|prototype)\//, file.pathname);
  }
  const { installedFiles, packedFiles } = await import('../.github/scripts/package-contract.mjs');
  assert.equal(new Set(installedFiles).size, installedFiles.length);
  assert.equal(new Set(packedFiles).size, packedFiles.length);
  for (const file of packedFiles) assert.doesNotMatch(file, /fixtures|^site\/|^docs\/design\/|^scripts\/(?:cloud|legacy|sync)\/|^plugins\/|^deploy\//);
  for (const retired of ['scripts/sync/client.mjs', 'scripts/legacy/map-sync.mjs', 'scripts/shared/sync-paths.mjs']) {
    await assert.rejects(fs.access(new URL('../' + retired, import.meta.url)), { code: 'ENOENT' });
  }
  const server = await fs.readFile(new URL('../scripts/workbench/server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /from\s*['"][^'"]*(?:legacy|sync\/client)/);
  const { runtimeIdentity, compatibleRuntime, upgradeableRuntime } = await import('../scripts/workbench/runtime.mjs');
  const current = runtimeIdentity();
  const previous = { ...current, buildId: 'project-workbench-v17', capabilities: current.capabilities.filter(c => c !== 'production-data-isolation') };
  assert.equal(compatibleRuntime(previous), false, 'old asset router must restart before adopting the new install');
  const oldContext = { ...current, buildId: 'project-workbench-v22', capabilities: current.capabilities.filter(c => c !== 'executor-on-demand-context') };
  assert.equal(compatibleRuntime(oldContext), false, '旧工作台没有上下文接口，不能继续复用');
  assert.equal(upgradeableRuntime(oldContext), true, '沿原有安全退出与升级流程保留数据');
  assert.equal(upgradeableRuntime(previous), true);
});
