import './test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const nodeCli = path.join(repositoryRoot, 'scripts/workbench/cli.mjs');
const skillCli = path.join(repositoryRoot, 'bin/context-guard-skill.js');

function runCli(executable, args, { cwd = repositoryRoot } = {}) {
  return spawnSync(process.execPath, [executable, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, CONTEXT_GUARD_NAMED_WORKBENCH: '0' },
  });
}

function assertHelp(result, label) {
  assert.equal(result.status, 0, `${label} should exit 0`);
  assert.match(result.stdout, /--help/, `${label} should print help text`);
  assert.doesNotMatch(result.stdout, /"url":/, `${label} should not start the workbench`);
  assert.doesNotMatch(result.stdout, /SESSION_REQUIRED/, `${label} should not run map actions`);
}

test('workbench --help prints usage without init or service startup', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-workbench-help-'));
  for (const args of [['workbench', '--help'], ['workbench', '-h'], ['workbench', '--help', '--root', emptyDir]]) {
    const result = runCli(nodeCli, args, { cwd: emptyDir });
    assertHelp(result, `node cli ${args.join(' ')}`);
    assert.equal(fs.existsSync(path.join(emptyDir, '.codex', 'context')), false, 'help must not create context');
  }
  fs.rmSync(emptyDir, { recursive: true, force: true });
});

test('context-guard skill routes workbench --help to help text only', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-skill-workbench-help-'));
  const result = runCli(skillCli, ['workbench', '--help'], { cwd: emptyDir });
  assertHelp(result, 'context-guard-skill workbench --help');
  assert.equal(fs.existsSync(path.join(emptyDir, '.codex', 'context')), false, 'skill entry must not create context');
  fs.rmSync(emptyDir, { recursive: true, force: true });
});

test('map and memory --help print usage without contacting the workbench', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-help-'));
  for (const args of [['map', '--help'], ['map', '-h'], ['memory', '--help'], ['preferences', '--help']]) {
    const result = runCli(nodeCli, args, { cwd: emptyDir });
    assertHelp(result, `node cli ${args.join(' ')}`);
  }
  fs.rmSync(emptyDir, { recursive: true, force: true });
});
