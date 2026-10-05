import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from './client-protocol.mjs';

test('installer copy filters retain the same boundaries for ordinary and namespaced paths', () => {
  const source = fs.readFileSync('bin/context-guard-skill.js', 'utf8');
  for (const [paths, root] of [[path.win32, 'E:\\fixture\\skill'], [path.win32, '\\\\server\\share\\skill'], [path.posix, '/fixture/skill']]) {
    const copies = new Map();
    const context = vm.createContext({
      __dirname: paths.join(root, 'bin'),
      require(name) {
        if (name === 'path') return paths;
        if (name === 'fs') return { existsSync: () => true, mkdirSync() {},
          cpSync(from, to, options) { copies.set(paths.basename(from), { from, options }); } };
        if (name === 'os' || name === 'child_process') return {};
        throw new Error(`Unexpected require: ${name}`);
      },
      process: { argv: ['node', 'context-guard', '--help'] }, console: { log() {} },
    });
    vm.runInContext(source, context);
    vm.runInContext('copySkill("fixture-target")', context);
    for (const [entry, allowed, denied] of [
      ['bin', ['', 'context-guard-skill.js'], ['build-runtime.mjs', 'postinstall.js', 'nested/context-guard-skill.js']],
      ['scripts', ['', 'context_guard.py', 'shared/io.mjs', 'workbench/cli.mjs'],
        ['cloud', 'cloud/server.mjs', 'branch_guard.py', '__pycache__', 'lib/__pycache__/module.pyc', 'lib/module.pyc', 'lib/module.pyo']],
    ]) {
      const { from, options } = copies.get(entry);
      for (const [items, expected] of [[allowed, true], [denied, false]]) for (const relative of items) {
        const candidate = paths.join(from, relative);
        for (const input of [candidate, paths.toNamespacedPath(candidate)]) {
          assert.equal(options.filter(input), expected, `${root}: ${entry}/${relative}`);
        }
      }
    }
  }
});

test('real installer copies its launcher and scripts without hooks or excluded development files', () => {
  const parent = path.resolve('temp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'installer-copy-'));
  const source = path.join(root, 'source'), skill = path.join(root, 'skill');
  const env = isolatedEnvironment(root);
  try {
    const files = {
      'SKILL.md': '# Synthetic skill\n',
      'bin/context-guard-skill.js': fs.readFileSync('bin/context-guard-skill.js', 'utf8'),
      'bin/build-runtime.mjs': 'excluded build script',
      'scripts/context_guard.py': '# Synthetic Python entry\n',
      'scripts/shared/io.mjs': 'export const fixture = true;\n',
      'scripts/cloud/server.mjs': 'excluded cloud server',
      'scripts/branch_guard.py': '# excluded branch guard',
      'scripts/__pycache__/module.pyc': 'excluded bytecode',
      'scripts/lib/module.pyo': 'excluded optimized bytecode',
    };
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
      fs.writeFileSync(path.join(source, file), content);
    }
    const result = spawnSync(process.execPath, [path.join(source, 'bin/context-guard-skill.js'), 'install', '--no-hooks', '--target', skill],
      { env, windowsHide: true, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    for (const file of ['SKILL.md', 'bin/context-guard-skill.js', 'scripts/context_guard.py', 'scripts/shared/io.mjs']) {
      assert.equal(fs.readFileSync(path.join(skill, file), 'utf8'), files[file], file);
    }
    for (const file of ['bin/build-runtime.mjs', 'scripts/cloud', 'scripts/branch_guard.py', 'scripts/__pycache__', 'scripts/lib/module.pyo']) {
      assert.equal(fs.existsSync(path.join(skill, file)), false, file);
    }
    const help = spawnSync(process.execPath, [path.join(skill, 'bin/context-guard-skill.js'), '--help'],
      { env, windowsHide: true, encoding: 'utf8', timeout: 30_000 });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Context Guard Skill/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installed runtime serves the package and rejects missing assets or dependencies', { timeout: 90_000 }, () => {
  const parent = path.resolve('temp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'installed-runtime-'));
  const env = isolatedEnvironment(root);
  env.GIT_CEILING_DIRECTORIES = root;
  const skill = path.join(root, 'skill');
  const project = path.join(root, 'project');
  const source = path.join(root, 'source');
  const run = args => spawnSync(process.execPath, args, { env, windowsHide: true, encoding: 'utf8', timeout: 30_000 });
  const ok = result => assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    fs.mkdirSync(source);
    for (const entry of [...pkg.files, 'package.json']) {
      fs.cpSync(path.resolve(entry), path.join(source, entry), { recursive: true });
    }
    ok(run([path.join(source, 'bin/context-guard-skill.js'), 'install', '--target', skill]));
    ok(run([path.join(skill, 'bin/context-guard-skill.js'), 'init', '--root', project]));
    const args = ['.github/scripts/smoke-installed-runtime.mjs', skill, project];
    const success = run(args);
    ok(success);
    assert.match(success.stdout, /Installed Workbench passed/);
    const lock = path.join(project, '.codex/context/private/node-workbench.lock');
    assert.equal(fs.existsSync(lock), false, 'Successful smoke must release its service lock');
    const asset = path.join(skill, 'prototype/workbench-app.js');
    const original = fs.readFileSync(asset);
    fs.unlinkSync(asset);
    const missingAsset = run(args);
    assert.notEqual(missingAsset.status, 0);
    assert.match(missingAsset.stderr, /Installed asset unavailable/);
    assert.equal(fs.existsSync(lock), false, 'Failed smoke must release its service lock');
    fs.writeFileSync(asset, original);
    fs.unlinkSync(path.join(skill, 'scripts/shared/io.mjs'));
    const broken = run(args);
    assert.notEqual(broken.status, 0);
    assert.match(broken.stderr, /ERR_MODULE_NOT_FOUND/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
