import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from './client-protocol.mjs';

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
