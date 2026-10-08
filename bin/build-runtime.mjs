#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// 保留既有构建入口，但不下载或改写源码。安装包仍可独立运行。
export async function buildRuntime() {
  const descriptor = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  for (const dependencies of [descriptor.dependencies, descriptor.devDependencies]) {
    for (const name of Object.keys(dependencies || {})) {
      if (/^@michelj\/context-guard-(core|workbench|cloud)$/.test(name)) throw new Error('Skill must own its core and UI, not depend on Cloud packages');
    }
  }
  async function check(file) {
    const target = path.join(root, file);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw new Error('Source must not contain symlinks or junctions');
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(target)) await check(path.posix.join(file, name));
    } else if (!stat.isFile()) throw new Error('Source must contain ordinary files');
  }
  for (const file of ['scripts', 'scripts/shared', 'prototype', 'references', 'roles.md', 'Coordinator.md', 'Executor.md', 'Tester.md']) {
    // scripts 包含本地运行时，仅检查其入口；其余完整检查。
    if (file === 'scripts') { if (!(await fs.lstat(path.join(root, file))).isDirectory() || (await fs.lstat(path.join(root, file))).isSymbolicLink()) throw new Error('Invalid source root'); }
    else await check(file);
  }
  for (const [file, name] of [['scripts/shared/package.json', '@michelj/context-guard-core'], ['prototype/package.json', '@michelj/context-guard-workbench']]) {
    const pkg = JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
    if (pkg.name !== name || pkg.repository !== 'github:Michel-Johnson/Context-Guard-Skill' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Invalid source package identity');
  }
  console.log('Validated Skill-owned core, UI and references; no Cloud download or source rewrite.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildRuntime().catch(error => { console.error(error.message); process.exitCode = 1; });
}
