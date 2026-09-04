import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(repository, 'scripts');
const python = process.platform === 'win32' ? 'python' : 'python3';

function pythonProcess(source, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-c', source, ...args], {
      cwd: repository,
      env: { ...process.env, PYTHONPATH: scripts },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => resolve({ code, stdout, stderr }));
  });
}

const addSignal = `
from pathlib import Path
import sys
from context_guard import add_prompt_signal
add_prompt_signal(Path(sys.argv[1]), "shared-session", sys.argv[2], "prompt " + sys.argv[2])
`;

const resolveSignal = `
from pathlib import Path
import sys
from context_guard import resolve_prompt_signal
resolve_prompt_signal(Path(sys.argv[1]), "shared-session", sys.argv[2], "task")
`;

test('same-Session prompt writers preserve every signal', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-runtime-race-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const writers = Array.from({ length: 24 }, (_, index) => pythonProcess(addSignal, [root, `turn-${index}`]));
  const results = await Promise.all(writers);
  for (const result of results) assert.equal(result.code, 0, result.stderr);

  const runtimeDir = path.join(root, '.codex/context/private/hook-runtime');
  const runtimeFiles = (await fs.readdir(runtimeDir)).filter(file => file.endsWith('.json'));
  assert.equal(runtimeFiles.length, 1);
  const runtime = JSON.parse(await fs.readFile(path.join(runtimeDir, runtimeFiles[0]), 'utf8'));
  assert.equal(runtime.signals.length, writers.length);
  assert.equal(new Set(runtime.signals.map(signal => signal.id)).size, writers.length);
});

test('concurrent classification of one signal is idempotent and leaves no pending copy', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-runtime-resolve-race-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.equal((await pythonProcess(addSignal, [root, 'shared-turn'])).code, 0);
  const runtimeDir = path.join(root, '.codex/context/private/hook-runtime');
  const runtimeFile = (await fs.readdir(runtimeDir)).find(file => file.endsWith('.json'));
  const before = JSON.parse(await fs.readFile(path.join(runtimeDir, runtimeFile), 'utf8'));
  const signalId = before.signals[0].id;

  const resolvers = await Promise.all(Array.from({ length: 16 }, () => pythonProcess(resolveSignal, [root, signalId])));
  for (const result of resolvers) assert.equal(result.code, 0, result.stderr);

  const after = JSON.parse(await fs.readFile(path.join(runtimeDir, runtimeFile), 'utf8'));
  assert.equal(after.signals.length, 1);
  assert.equal(after.signals[0].status, 'resolved');
  assert.equal(after.signals[0].kind, 'task');
});

test('a crashed lock owner cannot strand the Session', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-runtime-crash-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const crash = await pythonProcess(`
from pathlib import Path
import os, sys
from context_guard import acquire_hook_runtime_lock
lease = acquire_hook_runtime_lock(Path(sys.argv[1]), "shared-session")
os._exit(23)
`, [root]);
  assert.equal(crash.code, 23);
  const recovered = await pythonProcess(addSignal, [root, 'after-crash']);
  assert.equal(recovered.code, 0, recovered.stderr);
});

test('corrupt runtime is preserved and fails closed', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-runtime-corrupt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.equal((await pythonProcess(addSignal, [root, 'before-corruption'])).code, 0);
  const runtimeDir = path.join(root, '.codex/context/private/hook-runtime');
  const runtimeFile = (await fs.readdir(runtimeDir)).find(file => file.endsWith('.json'));
  const target = path.join(runtimeDir, runtimeFile);
  await fs.writeFile(target, '{broken-json', 'utf8');

  const rejected = await pythonProcess(addSignal, [root, 'must-not-overwrite']);
  assert.notEqual(rejected.code, 0);
  assert.match(rejected.stderr, /hook runtime is unreadable/);
  assert.equal(await fs.readFile(target, 'utf8'), '{broken-json');
});
