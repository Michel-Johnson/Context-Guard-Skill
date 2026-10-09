import '../.github/scripts/test-environment.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomInt } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { startServer, projectStatePath, projectLockPath } from '../scripts/workbench/server.mjs';
import { WORKBENCH_BUILD, runtimeIdentity } from '../scripts/workbench/runtime.mjs';
import { diagnoseWorkbench, ensureServer, globalWorkbenchInventory, startFailedMessage, stopServer, request } from '../scripts/workbench/cli.mjs';
import { startNamedProxy } from '../scripts/workbench/named-proxy.mjs';
import { namedWorkbench, ensureNamedProxy } from '../scripts/workbench/named.mjs';
import { bindProject, resolveProjectRoot, projectId, projectName, resolveProject, saveMainBinding } from '../scripts/workbench/project.mjs';
import { RouteStore } from '../scripts/workbench/portless-routes.mjs';
import { readProjectRegistry, projectRegistryPath } from '../scripts/workbench/registry.mjs';
import { rememberProject } from '../scripts/workbench/registry.mjs';

const cwd = process.cwd();
// Non-Git fixtures must not inherit the development repository enclosing temp/.
const previousCeiling = process.env.GIT_CEILING_DIRECTORIES;
process.env.GIT_CEILING_DIRECTORIES = path.join(cwd, 'temp');
after(() => { if (previousCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = previousCeiling; });
const fixtureRoots = [];
const retainedFixtures = new Set();
const ownedLifecycleFixtures = new Set();
after(async () => {
  for (const root of fixtureRoots) {
    if (retainedFixtures.has(root)) continue;
    if (!ownedLifecycleFixtures.has(root)) { await fs.rm(root, { recursive: true, force: true }); continue; }
    try {
      const resolved = await fs.realpath(root), parent = await fs.realpath(path.join(cwd, 'temp'));
      assert.equal(path.dirname(resolved), parent);
      assert.ok(path.basename(resolved).startsWith('named-test-'));
      await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) { retainedFixtures.add(root); throw error; }
  }
});
async function fixture(t, name = 'Example Project') {
  await fs.mkdir(path.join(cwd, 'temp'), { recursive: true });
  const root = await fs.mkdtemp(path.join(cwd, 'temp/named-test-'));
  fixtureRoots.push(root);
  await fs.mkdir(path.join(root, '.codex/context/sessions'), { recursive: true });
  await fs.writeFile(path.join(root, '.codex/context/map.json'), JSON.stringify({ v: 1, project: name, root: { id: 'T0', title: name, kind: 'module', children: [] } }));
  await fs.writeFile(path.join(root, '.codex/context/sessions.jsonl'), Array.from({ length: 5 }, (_, i) => JSON.stringify({ event: 'session-start', session_id: `test-${i}`, platform: 'codex' })).join('\n') + '\n');
  return root;
}
async function environment(t) {
  const root = await fixture(t), dir = path.join(root, 'proxy');
  const proxy = await startNamedProxy({ dir, port: 0 });
  const backend = await startServer({ root, port: 0 });
  t.after(async () => { await proxy.close(); await backend.close(); });
  const named = await namedWorkbench(backend.state, request, { dir, port: 0 });
  return { root, dir, proxy, backend, named };
}
function call(url, route, { method = 'GET', headers = {}, body } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: u.port, path: route, method, headers: { Host: u.host, ...headers } }, res => {
      let text = ''; res.on('data', d => text += d); res.on('end', () => { let data; try { data = JSON.parse(text); } catch { data = text; } resolve({ status: res.statusCode, data }); });
    }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
function cliJSON(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(cwd, 'scripts/workbench/cli.mjs'), ...args], {
      cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr || stdout)));
  });
}

// Default observation forwards real Git unchanged and always imports actual
// source. Compatibility modes deliberately change arguments/output; failure
// modes inject process errors to check classification, not real timeouts.
function observedProject(root, physicalMode = '') {
  const moduleURL = pathToFileURL(path.join(cwd, 'scripts/workbench/project.mjs')).href;
  const code = String.raw`
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { promisify } from 'node:util';
    const original = childProcess.execFile, calls = [], physicalMode = process.argv[3];
    childProcess.execFile = (command, args, options, callback) => {
      const started = performance.now();
      const physical = command === 'git' && args.includes('--show-toplevel') && args.includes('--git-common-dir') && args.includes('--git-dir');
      const commits = command === 'git' && args[0] === 'rev-parse' && args.includes('--end-of-options') && args.includes('HEAD');
      if (commits && physicalMode === 'commit-unknown-option') {
        // Controlled old-option rejection; modern Git may merely echo/filter an unknown flag.
        calls.push({ args, milliseconds: 0 });
        const stderr = 'error: unknown option end-of-options\n';
        queueMicrotask(() => callback(Object.assign(new Error('Controlled unsupported Git option'), { code: 129, stdout: '', stderr }), '', stderr));
        return;
      }
      if (physical && physicalMode === 'killed' || commits && ['commit-killed', 'commit-timeout', 'commit-system-error'].includes(physicalMode)) {
        calls.push({ args, milliseconds: 0 });
        const error = physicalMode === 'commit-system-error'
          ? Object.assign(new Error('Controlled Git system failure'), { code: 'ENOENT' })
          : Object.assign(new Error('Controlled killed Git process'), { code: physicalMode === 'commit-timeout' ? 'ETIMEDOUT' : 1, killed: true, signal: 'SIGTERM' });
        queueMicrotask(() => callback(error, '', ''));
        return;
      }
      let executedArgs = args;
      if (physical && physicalMode === 'unknown-option') executedArgs = ['rev-parse', '--unknown-path-format-option', '--show-toplevel', '--git-common-dir', '--git-dir'];
      if (physical && physicalMode === 'relative') executedArgs = args.filter(value => value !== '--path-format=absolute');
      if (physical && ['unsupported', 'legacy-common'].includes(physicalMode)) executedArgs = args.map(value => value === '--path-format=absolute' ? '--path-format=unsupported' : value);
      if (physicalMode === 'legacy-common' && args.length === 3 && args[2] === '--git-common-dir') executedArgs = ['config', '--get', 'context-guard.missing-common-dir'];
      return original(command, executedArgs, options, (error, stdout, stderr) => {
        if (command === 'git') calls.push({ args, milliseconds: performance.now() - started });
        if (commits && physicalMode === 'commit-extra-record') stdout += 'unexpected-record\n';
        if (commits && physicalMode === 'commit-invalid-record') stdout = stdout.split('\n')[0] + '\n' + 'not-a-commit' + '\n';
        if (commits && physicalMode === 'commit-mixed-format') stdout = stdout.split('\n')[0] + '\n' + 'a'.repeat(64) + '\n';
        callback(error, stdout, stderr);
      });
    };
    childProcess.execFile[promisify.custom] = (command, args, options) => new Promise((resolve, reject) => {
      childProcess.execFile(command, args, options, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr }));
    });
    syncBuiltinESMExports();
    const { resolveProject } = await import(process.argv[1]);
    const started = performance.now();
    let project, error;
    let errorDetails;
    try { project = await resolveProject(process.argv[2]); } catch (cause) { error = cause.message; errorDetails = { code: cause.code, killed: cause.killed, signal: cause.signal }; }
    console.log(JSON.stringify({ project, error, errorDetails, calls, milliseconds: performance.now() - started }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, moduleURL, root, physicalMode], {
    cwd, env: process.env, encoding: 'utf8', windowsHide: true, timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}
async function projectIdentityFixture(t) {
  const root = await fixture(t, 'Identity resolution');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'identity@example.test');
  git('config', 'user.name', 'Identity Test');
  git('add', '.');
  git('commit', '-qm', 'Identity fixture');
  git('remote', 'add', 'origin', 'https://github.com/example/default.git');
  git('remote', 'add', 'upstream', 'https://github.com/example/selected.git');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  git('update-ref', 'refs/remotes/upstream/main', 'HEAD');
  return { root, git };
}
function identityDiagnostic(t, observed) {
  t.diagnostic(JSON.stringify({ gitCalls: observed.calls.length, milliseconds: observed.milliseconds,
    commands: observed.calls.map(call => call.args.join(' ')) }));
}
test('project identity explicit local binding skips automatic origin and default discovery', async t => {
  const { root, git } = await projectIdentityFixture(t);
  await saveMainBinding(root, { mode: 'local', branch: 'main' });
  const observed = observedProject(root);
  identityDiagnostic(t, observed);
  assert.equal(observed.error, undefined);
  assert.equal(observed.calls.length, 3);
  assert.deepEqual(observed.calls.find(call => call.args.includes('--end-of-options')).args,
    ['rev-parse', '--revs-only', '--end-of-options', 'HEAD', 'refs/heads/main^{commit}']);
  assert.equal(observed.calls.some(call => ['config', 'symbolic-ref'].includes(call.args[0])), false);
  assert.equal(observed.project.binding.source, 'explicit');
  assert.equal(observed.project.mainRef, 'refs/heads/main');
  assert.equal(observed.project.mainSha, git('rev-parse', 'HEAD'));
  assert.equal(observed.project.remote, '');
  assert.equal(observed.project.github, null);
});
test('project identity explicit remote binding reads only selected remote and remains fresh', async t => {
  const { root, git } = await projectIdentityFixture(t);
  await saveMainBinding(root, { remote: 'upstream', branch: 'main' });
  const before = observedProject(root);
  identityDiagnostic(t, before);
  assert.equal(before.error, undefined);
  assert.equal(before.calls.length, 4);
  assert.deepEqual(before.calls.filter(call => ['config', 'symbolic-ref'].includes(call.args[0])).map(call => call.args),
    [['config', '--get', 'remote.upstream.url']]);
  assert.equal(before.project.github.slug, 'example/selected');
  git('commit', '--allow-empty', '-qm', 'New identity');
  git('branch', '-m', 'changed');
  git('update-ref', 'refs/remotes/upstream/main', 'HEAD');
  git('remote', 'set-url', 'upstream', 'https://github.com/example/changed.git');
  const after = observedProject(root);
  assert.equal(after.error, undefined);
  assert.equal(after.calls.length, 4);
  assert.equal(after.project.github.slug, 'example/changed');
  assert.equal(after.project.branch, 'changed');
  assert.equal(after.project.head, git('rev-parse', 'HEAD'));
  assert.equal(after.project.mainSha, after.project.head);
  assert.notEqual(after.project.head, before.project.head);
  assert.equal(after.project.worktreeId, before.project.worktreeId);
  git('tag', '-a', 'main-baseline', before.project.head, '-m', 'Synthetic annotated Main');
  git('update-ref', 'refs/remotes/upstream/main', 'refs/tags/main-baseline');
  const tagged = observedProject(root);
  assert.equal(tagged.error, undefined);
  assert.equal(tagged.calls.length, 4);
  assert.equal(tagged.project.head, after.project.head);
  assert.equal(tagged.project.mainSha, before.project.head, 'Main still peels to its commit without changing HEAD');
});
test('project identity unbound GitHub repository keeps default discovery and missing-ref semantics', async t => {
  const { root, git } = await projectIdentityFixture(t);
  const observed = observedProject(root);
  identityDiagnostic(t, observed);
  assert.equal(observed.error, undefined);
  assert.equal(observed.calls.length, 6);
  assert.equal(observed.project.binding.source, 'github-default');
  assert.equal(observed.project.mainRef, 'refs/remotes/origin/main');
  assert.equal(observed.project.bindingRequired, false);
  git('update-ref', '-d', 'refs/remotes/origin/main');
  const missing = observedProject(root);
  assert.equal(missing.error, undefined);
  assert.equal(missing.project.bindingRequired, true);
  assert.equal(missing.project.mainSha, '');
});
test('project identity invalid stored binding fails closed before automatic discovery', async t => {
  const { root } = await projectIdentityFixture(t);
  const project = await resolveProject(root);
  await fs.mkdir(project.sharedDir, { recursive: true });
  const filename = path.join(project.sharedDir, 'project-binding.json');
  const invalid = JSON.stringify({ v: 1, projectId: 'git-other-project', main: { branch: 'main' } });
  await fs.writeFile(filename, invalid);
  const observed = observedProject(root);
  identityDiagnostic(t, observed);
  assert.match(observed.error, /Invalid project binding; repair it explicitly, do not recreate it/);
  assert.equal(observed.calls.length, 1);
  assert.equal(await fs.readFile(filename, 'utf8'), invalid);
});
test('project identity batched physical directories preserve linked, subdir, alias and detached identity', async t => {
  const { root, git } = await projectIdentityFixture(t);
  await saveMainBinding(root, { mode: 'local', branch: 'main' });
  const main = observedProject(root).project;
  const subdir = path.join(root, 'subdir'), alias = path.join(root, 'alias');
  await fs.mkdir(subdir);
  await fs.symlink(subdir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  for (const opened of [subdir, alias]) {
    const observed = observedProject(opened);
    assert.equal(observed.error, undefined);
    assert.equal(observed.calls.length, 3);
    assert.equal(observed.project.projectId, main.projectId);
    assert.equal(observed.project.worktreeId, main.worktreeId);
    assert.equal(observed.project.worktreeRoot, main.worktreeRoot);
    assert.equal(observed.project.openedRoot, await fs.realpath(subdir));
  }
  const linked = path.join(root, 'linked'), moved = path.join(root, 'moved');
  git('worktree', 'add', '-q', '-b', 'linked-test', linked);
  const original = observedProject(linked);
  assert.equal(original.error, undefined);
  assert.equal(original.calls.length, 3);
  assert.equal(original.project.projectId, main.projectId);
  assert.notEqual(original.project.worktreeId, main.worktreeId);
  assert.equal(original.project.commonDir, main.commonDir);
  execFileSync('git', ['checkout', '-q', '--detach', 'HEAD'], { cwd: linked, windowsHide: true });
  const detached = observedProject(linked);
  assert.equal(detached.error, undefined);
  assert.equal(detached.project.branch, '');
  assert.equal(detached.project.head, main.head);
  assert.equal(detached.project.worktreeId, original.project.worktreeId);
  git('worktree', 'move', linked, moved);
  const relocated = observedProject(moved).project;
  assert.equal(relocated.worktreeId, original.project.worktreeId);
  git('worktree', 'add', '-q', '-b', 'replacement-test', linked);
  const replacement = observedProject(linked).project;
  assert.equal(replacement.projectId, main.projectId);
  assert.notEqual(replacement.worktreeId, original.project.worktreeId);
});
test('project identity non-Git and bare keep one call while unborn Git preserves physical identity', async t => {
  const root = await fixture(t), bare = path.join(root, 'bare.git'), unborn = path.join(root, 'unborn');
  execFileSync('git', ['init', '--bare', '-q', bare], { cwd: root, windowsHide: true });
  for (const opened of [root, bare]) {
    const observed = observedProject(opened);
    assert.equal(observed.error, undefined);
    assert.equal(observed.calls.length, 1);
    assert.equal(observed.project.kind, 'folder');
    assert.equal(observed.project.bindingRequired, false);
    assert.equal(observed.project.commonDir, null);
    for (const field of ['head', 'branch', 'gitDir', 'mainRef', 'mainSha']) assert.equal(observed.project[field], '');
  }
  await fs.mkdir(unborn);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: unborn, windowsHide: true });
  const initial = observedProject(unborn);
  assert.equal(initial.error, undefined);
  assert.equal(initial.calls.length, 4);
  assert.equal(initial.project.kind, 'git');
  assert.equal(initial.project.bindingRequired, true);
  assert.equal(initial.project.head, '');
  assert.equal(initial.project.mainSha, '');
  assert.equal(initial.project.mainRef, '');
  assert.equal(initial.project.branch, 'main');
  assert.equal(initial.project.commonDir, await fs.realpath(path.join(unborn, '.git')));
  const again = observedProject(unborn);
  assert.equal(again.error, undefined);
  assert.equal(again.project.projectId, initial.project.projectId);
  assert.equal(again.project.worktreeId, initial.project.worktreeId);
});
test('project identity ambiguous, relative and unsupported physical output uses legacy resolution', async t => {
  const { root } = await projectIdentityFixture(t);
  await saveMainBinding(root, { mode: 'local', branch: 'main' });
  const current = observedProject(root).project;
  for (const mode of ['unknown-option', 'relative', 'unsupported', 'legacy-common']) {
    const observed = observedProject(root, mode);
    assert.equal(observed.error, undefined, mode);
    assert.deepEqual(observed.project, current, mode);
    assert.equal(observed.calls.length, mode === 'legacy-common' ? 7 : 6, mode);
    assert.ok(observed.calls.some(call => call.args.length === 2 && call.args[1] === '--show-toplevel'), mode);
    assert.ok(observed.calls.some(call => call.args.length === 3 && call.args[2] === '--git-dir'), mode);
    if (mode === 'legacy-common') assert.ok(observed.calls.some(call => call.args.length === 2 && call.args[1] === '--git-common-dir'));
  }
});
test('project identity killed physical query remains a failure without legacy fallback', async t => {
  const { root } = await projectIdentityFixture(t);
  const observed = observedProject(root, 'killed');
  assert.match(observed.error, /Controlled killed Git process/);
  assert.equal(observed.project, undefined);
  assert.deepEqual(observed.errorDetails, { code: 1, killed: true, signal: 'SIGTERM' });
  assert.equal(observed.calls.length, 1);
});

test('project identity commit output falls back to fresh independent reads for incompatible records', async t => {
  const { root, git } = await projectIdentityFixture(t);
  await saveMainBinding(root, { mode: 'local', branch: 'main' });
  const current = observedProject(root).project;
  for (const mode of ['commit-unknown-option', 'commit-extra-record', 'commit-invalid-record', 'commit-mixed-format']) {
    const observed = observedProject(root, mode);
    assert.equal(observed.error, undefined, mode);
    assert.deepEqual(observed.project, current, mode);
    assert.equal(observed.calls.length, 5, mode);
    assert.equal(observed.calls.filter(call => call.args.includes('--end-of-options')).length, 1, mode);
    assert.ok(observed.calls.some(call => call.args.length === 2 && call.args[1] === 'HEAD'), mode);
    assert.ok(observed.calls.some(call => call.args.includes('--verify') && call.args.at(-1) === 'refs/heads/main^{commit}'), mode);
  }
  const sha256Root = path.join(root, 'sha256');
  await fs.mkdir(sha256Root);
  const sha256Git = (...args) => execFileSync('git', args, { cwd: sha256Root, encoding: 'utf8', windowsHide: true }).trim();
  sha256Git('init', '-q', '-b', 'main', '--object-format=sha256');
  sha256Git('-c', 'user.name=Test', '-c', 'user.email=identity@example.test', 'commit', '--allow-empty', '-qm', 'SHA-256 fixture');
  await saveMainBinding(sha256Root, { mode: 'local', branch: 'main' });
  const sha256 = observedProject(sha256Root);
  assert.equal(sha256.error, undefined);
  assert.equal(sha256.calls.length, 3);
  assert.equal(sha256.project.head.length, 64);
  assert.equal(sha256.project.head, sha256Git('rev-parse', 'HEAD'));
  assert.equal(sha256.project.mainSha, sha256.project.head);
  git('branch', 'alternate');
  git('update-ref', '-d', 'refs/heads/main');
  const unborn = observedProject(root);
  assert.equal(unborn.error, undefined);
  assert.equal(unborn.calls.length, 5);
  assert.equal(unborn.project.kind, 'git');
  assert.equal(unborn.project.head, '');
  assert.equal(unborn.project.mainSha, '');
  assert.equal(unborn.project.branch, 'main');
  assert.equal(unborn.project.bindingRequired, true);
  assert.equal(unborn.project.mainRef, 'refs/heads/main');
  assert.equal(unborn.project.worktreeId, current.worktreeId);
  assert.equal(unborn.project.commonDir, current.commonDir);
});

test('project identity commit query preserves killed and system failures without optional fallback', async t => {
  const { root } = await projectIdentityFixture(t);
  await saveMainBinding(root, { mode: 'local', branch: 'main' });
  for (const mode of ['commit-killed', 'commit-timeout', 'commit-system-error']) {
    const observed = observedProject(root, mode);
    assert.equal(observed.project, undefined);
    assert.match(observed.error, mode === 'commit-system-error' ? /Controlled Git system failure/ : /Controlled killed Git process/);
    assert.deepEqual(observed.errorDetails, mode === 'commit-system-error' ? { code: 'ENOENT' }
      : { code: mode === 'commit-timeout' ? 'ETIMEDOUT' : 1, killed: true, signal: 'SIGTERM' });
    assert.equal(observed.calls.filter(call => call.args.includes('--end-of-options')).length, 1);
    assert.equal(observed.calls.some(call => call.args.length === 2 && call.args[1] === 'HEAD'), false);
    assert.equal(observed.calls.some(call => call.args.includes('--verify')), false);
  }
});
test('unchanged project registry records avoid redundant writes while validation and unions remain fresh', async t => {
  const root = await fixture(t), dir = path.join(root, 'registry'), file = projectRegistryPath(dir);
  retainedFixtures.add(root);
  let project = { projectId: 'registry-one', kind: 'git', sharedDir: path.join(root, 'shared'),
    worktreeRoot: path.join(root, 'main'), openedRoot: path.join(root, 'main'),
    binding: { main: { mode: 'local', branch: 'main', ref: 'refs/heads/main' } } };
  let options = { dir, name: 'registry-one', origin: 'http://registry-one.localhost:51001',
    state: { instance: 'registry-instance-one', buildId: WORKBENCH_BUILD, runtimeSchema: 4, url: 'http://127.0.0.1:51001/prototype/workbench.html' } };
  const rename = fs.rename;
  let writes = 0, passed = false;
  const observer = t.mock.method(fs, 'rename', async (...args) => {
    if (path.resolve(String(args[1])) === file) writes++;
    return rename(...args);
  });
  try {
    const initial = await rememberProject(project, options);
    assert.equal(writes, 1, 'the observer sees the real initial registry commit');
    // Reordered keys and an old timestamp must not turn equal content into a write.
    const reordered = Object.fromEntries(Object.entries({ ...initial, updatedAt: '2000-01-01T00:00:00.000Z' }).reverse());
    await fs.writeFile(file, JSON.stringify({ version: 1, projects: [reordered] }));
    const bytes = await fs.readFile(file), modified = (await fs.stat(file, { bigint: true })).mtimeNs;
    writes = 0;
    const unchanged = await rememberProject(project, options);
    assert.deepEqual(unchanged, reordered);
    assert.equal(writes, 0, 'equal records do not commit projects.json');
    assert.deepEqual(await fs.readFile(file), bytes);
    assert.equal((await fs.stat(file, { bigint: true })).mtimeNs, modified);
    assert.equal(unchanged.updatedAt, '2000-01-01T00:00:00.000Z');
    await assert.rejects(fs.access(file + '.lock'), { code: 'ENOENT' });

    for (const change of [
      () => options = { ...options, name: 'renamed-project' },
      () => options = { ...options, origin: 'http://renamed-project.localhost:51001' },
      () => project = { ...project, binding: { main: { mode: 'local', branch: 'trunk', ref: 'refs/heads/trunk' } } },
      () => options = { ...options, state: { ...options.state, instance: 'registry-instance-two' } },
      () => options = { ...options, state: { ...options.state, url: 'http://127.0.0.1:51002/prototype/workbench.html', buildId: 'project-workbench-v23' } },
      () => project = { ...project, worktreeRoot: path.join(root, 'linked'), openedRoot: path.join(root, 'linked') },
      () => project = { ...project, openedRoot: path.join(root, 'linked', 'subdir') },
    ]) {
      change(); writes = 0;
      const changed = await rememberProject(project, options);
      assert.equal(writes, 1, 'each real record change is committed exactly once');
      assert.deepEqual((await readProjectRegistry({ dir })).projects.find(record => record.projectId === project.projectId), changed);
      await rememberProject(project, options);
      assert.equal(writes, 1, 'repeating the same change does not add another commit');
    }
    const stable = (await readProjectRegistry({ dir })).projects[0];
    assert.deepEqual(stable.roots, [path.join(root, 'main'), path.join(root, 'linked'), path.join(root, 'linked', 'subdir')]);
    const extra = { ...stable, unknownPreviousField: { keep: 'not-a-whitelist' } };
    await fs.writeFile(file, JSON.stringify({ version: 1, projects: [extra] }));
    writes = 0;
    const normalized = await rememberProject(project, options);
    assert.equal(writes, 1, 'unknown previous fields remain a real content difference');
    assert.equal(Object.hasOwn(normalized, 'unknownPreviousField'), false);

    writes = 0;
    const snapshots = await Promise.all(['concurrent-a', 'concurrent-b'].map(name => rememberProject({ ...project, openedRoot: path.join(root, name) }, options)));
    assert.equal(writes, 2);
    const smaller = snapshots.find(record => record.roots.length === stable.roots.length + 1);
    const larger = snapshots.find(record => record.roots.length === stable.roots.length + 2);
    assert.ok(smaller && larger);
    assert.deepEqual(larger.roots.slice(0, smaller.roots.length), smaller.roots, 'lock acquisition preserves the insertion order of every accumulated root');
    const other = name => ({ ...project, projectId: name, sharedDir: path.join(root, name), worktreeRoot: path.join(root, name), openedRoot: path.join(root, name) });
    writes = 0;
    await Promise.all(['registry-two', 'registry-three'].map(name => rememberProject(other(name), { dir, name })));
    assert.equal(writes, 2);
    const complete = await readProjectRegistry({ dir });
    assert.deepEqual(complete.projects.map(record => record.projectId), ['registry-one', 'registry-three', 'registry-two']);
    assert.deepEqual(complete.projects.find(record => record.projectId === project.projectId), larger);

    writes = 0;
    await assert.rejects(rememberProject(other('collision'), options), { code: 'PROJECT_NAME_CONFLICT' });
    assert.equal(writes, 0);
    assert.deepEqual(await readProjectRegistry({ dir }), complete);
    for (const corrupted of [
      'not-json',
      JSON.stringify({ ...complete, projects: [...complete.projects, complete.projects[0]] }),
      JSON.stringify({ ...complete, projects: complete.projects.map((record, index) => index ? record : { ...record, origin: 'invalid-origin' }) }),
    ]) {
      await fs.writeFile(file, corrupted);
      await assert.rejects(rememberProject(project, options));
      assert.equal(writes, 0);
      assert.equal(await fs.readFile(file, 'utf8'), corrupted);
    }
    passed = true;
  } finally {
    observer.mock.restore();
    if (passed) retainedFixtures.delete(root);
  }
});

test('named HTTP entry preserves authentication, Origin/Host checks, session registration and writes', async t => {
  const { backend, named, dir, proxy } = await environment(t), origin = new URL(named.url).origin;
  assert.match(named.url, /example-project.localhost/);
  assert.equal((await call(named.url, '/prototype/workbench.html')).status, 200);
  assert.equal((await call(named.url, '/api/state')).status, 401);
  assert.equal((await call(named.url, '/__context_guard/bootstrap', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call(named.url, '/__context_guard/bootstrap', { headers: { Host: `unknown.localhost:${new URL(named.url).port}` } })).status, 404);
  assert.equal((await call(backend.state.url, '/__context_guard/bootstrap', { headers: { Host: new URL(named.url).host } })).status, 403);
  const boot = await call(named.url, '/__context_guard/bootstrap');
  assert.equal(boot.data.instance, backend.state.instance);
  assert.equal(boot.data.buildId, WORKBENCH_BUILD);
  assert.ok(boot.data.capabilities.includes('runtime-instance-check'));
  const auth = { Authorization: `Bearer ${boot.data.token}`, Origin: origin, 'Content-Type': 'application/json' };
  const before = await call(named.url, '/api/state', { headers: auth });
  assert.equal(before.status, 200);
  const saved = await call(named.url, '/api/commit', { method: 'POST', headers: auth, body: { baseVersion: before.data.version, operationId: 'named-write', operations: [{ type: 'update', id: 'T0', fields: { title: 'Saved through named entry' } }] } });
  assert.equal(saved.status, 200);
  assert.equal((await call(named.url, '/api/state', { headers: auth })).data.doc.root.title, 'Saved through named entry');
  for (let i = 0; i < 5; i++) assert.ok((await request(backend.state, '/api/session', { method: 'POST', body: { sessionId: `test-${i}` } })).token);
  const actor = await request(backend.state, '/api/session', { method: 'POST', body: { sessionId: 'test-0' } });
  const defaultAccess = await call(named.url, '/api/access', { headers: auth });
  assert.equal(defaultAccess.data.grants['test-0'].mode, 'all');
  assert.deepEqual(defaultAccess.data.grants['test-0'].nodes, ['T0']);
  assert.equal((await call(named.url, '/api/access', { method: 'POST', headers: auth, body: { sessionId: 'test-0', nodes: [] } })).status, 200);
  const denied = await call(named.url, '/api/commit', { method: 'POST', headers: { ...auth, Authorization: `Bearer ${actor.token}` }, body: { baseVersion: saved.data.version, operationId: 'ungranted-agent', operations: [{ type: 'update', id: 'T0', fields: { title: 'Must not change' } }] } });
  assert.equal(denied.status, 403);
  const otherRoot = await fixture(t, 'Other Project'), other = await startServer({ root: otherRoot, port: 0 }); t.after(() => other.close());
  const otherName = await namedWorkbench(other.state, request, { dir });
  assert.equal((await call(otherName.url, '/api/state', { headers: auth })).status, 403);
  assert.equal((await call(otherName.url, '/api/state', { headers: { Authorization: auth.Authorization } })).status, 401);
  await assert.rejects(namedWorkbench(other.state, request, { dir, name: 'example-project' }), /registration failed/);
  assert.equal((await call(otherName.url, '/__context_guard/health')).status, 200);
  assert.equal((await call(named.url, '/__context_guard/health')).status, 200);
  assert.equal((await call(proxy.state.base, '/__cg_proxy/routes', { method: 'POST', body: {} })).status, 401);
});

for (const scenario of [
  { name: 'normal final release' },
  { name: 'temporary lock EBUSY then release', code: 'EBUSY' },
  { name: 'temporary state EBUSY then release', code: 'EBUSY', state: true },
  { name: 'persistent EBUSY fails at the existing deadline', code: 'EBUSY', expires: true, expected: 'STOP_FAILED' },
  { name: 'same instance lock still present fails at the existing deadline', retained: true, expires: true, expected: 'STOP_FAILED' },
  { name: 'EACCES is not retried', code: 'EACCES', expected: 'EACCES' },
  { name: 'unconfirmed stop cannot retry EBUSY', code: 'EBUSY', beforeAck: true, state: true, expected: 'EBUSY' },
  { name: 'platform-scoped temporary EPERM', code: 'EPERM', expected: process.platform === 'win32' ? undefined : 'EPERM' },
  ...(process.platform === 'win32' ? [{ name: 'persistent EPERM fails at the existing deadline', code: 'EPERM', expires: true, expected: 'STOP_FAILED' }] : []),
]) test(`stop acknowledgement: ${scenario.name}`, async t => {
  const root = await fixture(t, 'Stop Contention'), project = await resolveProject(root);
  const stateFile = projectStatePath(project), lockFile = projectLockPath(project);
  const instance = 'stop-fixture', adminToken = 'stop-capability';
  let acknowledged = false, probes = 0, elapsed = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/stop') {
      assert.equal(req.method, 'POST');
      assert.equal(req.headers.authorization, `Bearer ${adminToken}`);
      if (!scenario.retained) await Promise.all([fs.unlink(stateFile), fs.unlink(lockFile)]);
      acknowledged = true;
      res.end('{}');
    } else res.end(JSON.stringify({ ...runtimeIdentity(), instance }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, instance, adminToken }));
  await fs.writeFile(lockFile, JSON.stringify({ instance }));
  const stat = fs.stat.bind(fs), now = Date.now;
  t.mock.method(Date, 'now', () => now() + elapsed);
  t.mock.method(fs, 'stat', async (file, ...args) => {
    if (String(file) === (scenario.state ? stateFile : lockFile) && (acknowledged || scenario.beforeAck)) {
      probes++;
      // Advance the clock, not the production timeout, to exercise its exact bound.
      if (scenario.expires) elapsed = 12000;
      if (scenario.code && (scenario.expires || probes <= 2)) throw Object.assign(new Error('fixture file contention'), { code: scenario.code });
    }
    return stat(file, ...args);
  });
  if (scenario.expected) await assert.rejects(stopServer(root), { code: scenario.expected });
  else assert.deepEqual(await stopServer(root), { stopped: true });
  assert.equal(acknowledged, !scenario.beforeAck);
  if (scenario.code && !scenario.expected) assert.ok(probes >= 3, 'do not report success while state or lock is unreadable');
  if (scenario.expires || scenario.beforeAck || (scenario.code && scenario.expected === scenario.code)) assert.equal(probes, 1, 'do not retry past the deadline or outside the shutdown allowance');
  if (scenario.retained) assert.equal(JSON.parse(await fs.readFile(lockFile, 'utf8')).instance, instance, 'never delete a retained lock to force success');
});

test('an explicit local Coordinator role persists without granting Main write authority', async t => {
  const { root, backend } = await environment(t);
  const selected = await cliJSON(['workbench', '--root', root, '--session', 'test-0', '--role', 'coordinator', '--direct']);
  assert.equal(selected.binding.role, 'coordinator');
  const resumed = await cliJSON(['workbench', '--root', root, '--session', 'test-0', '--direct']);
  assert.equal(resumed.binding.role, 'coordinator', 'ordinary rebinding retains the explicit context role');
  const rejected = await request(backend.state, '/api/session-prepare', { method: 'POST', body: { sessionId: 'test-0', role: 'admin' } }).catch(error => error);
  assert.equal(rejected.code, 'INVALID_ROLE');
  assert.equal((await cliJSON(['workbench', '--binding-status', '--root', root, '--session', 'test-0'])).session.role, 'coordinator');
  await assert.rejects(cliJSON(['map', 'main', 'apply', '--root', root, '--session', 'test-0']), /FORBIDDEN/);
  const coordinator = await request(backend.state, '/api/session', { method: 'POST', body: { sessionId: 'test-0', worktreeRoot: root } });
  const executor = await request(backend.state, '/api/session', { method: 'POST', body: { sessionId: 'test-1', worktreeRoot: root } });
  const tool = { operationId: 'list-1', name: 'list_tasks', input: {} };
  const unavailable = await request(backend.state, '/api/v2/coordinator-tools', { method: 'POST', token: coordinator.token, body: tool }).catch(error => error);
  assert.equal(unavailable.code, 'UNAVAILABLE');
  assert.match(unavailable.message, /Cloud connection unavailable/);
  const forbidden = await request(backend.state, '/api/v2/coordinator-tools', { method: 'POST', token: executor.token, body: tool }).catch(error => error);
  assert.equal(forbidden.code, 'FORBIDDEN');
});
test('five live SSE pages suppress automatic duplicate opens; first parallel claim wins', async t => {
  const { backend, named } = await environment(t);
  const claims = await Promise.all(Array.from({ length: 5 }, () => request(backend.state, '/api/open-claim', { method: 'POST', body: {} })));
  assert.equal(claims.filter(x => x.shouldOpen).length, 1);
  const boot = await call(named.url, '/__context_guard/bootstrap'), streams = [];
  t.after(() => streams.forEach(({ req, res }) => { res.destroy(); req.destroy(); }));
  for (let i = 0; i < 5; i++) await new Promise((resolve, reject) => {
    const u = new URL(named.url), req = http.get({ hostname: '127.0.0.1', port: u.port, path: `/api/events?clientId=page-${i}&token=${boot.data.token}`, headers: { Host: u.host } }, res => {
      streams.push({ req, res }); res.once('data', d => { assert.match(d.toString(), /event: state/); resolve(); }); res.resume();
    }); req.on('error', reject);
  });
  assert.equal((await request(backend.state, '/api/open-claim', { method: 'POST', body: {} })).shouldOpen, false);
});
test('backend port reuse fails closed without forwarding credentials; route can be re-registered', async t => {
  const { backend, named, root, dir } = await environment(t), oldPort = Number(new URL(backend.state.url).port);
  await backend.close();
  const seen = [], impostor = http.createServer((req, res) => { seen.push(req.headers); res.end('{}'); });
  await new Promise(r => impostor.listen(oldPort, '127.0.0.1', r));
  assert.equal((await call(named.url, '/api/state', { headers: { Authorization: 'Bearer synthetic-capability' } })).status, 502);
  assert.ok(seen.length); assert.ok(seen.every(h => !h.authorization && !h['x-context-guard-proxy']));
  await new Promise(r => impostor.close(r));
  const fresh = await startServer({ root, port: 0 }); t.after(() => fresh.close());
  const restored = await namedWorkbench(fresh.state, request, { dir });
  assert.equal(restored.url, named.url);
  assert.equal((await call(named.url, '/__context_guard/health')).status, 200);
});
test('global registry repairs a legacy worktree-owned name without creating a second project workbench', async t => {
  const root = await fixture(t, 'Registry Project'), linked = path.join(root, 'linked');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', windowsHide: true });
  git('init', '-b', 'trunk');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'fixture');
  git('worktree', 'add', '-b', 'feature', linked);
  await fs.mkdir(path.join(linked, '.codex/context'), { recursive: true });
  await fs.copyFile(path.join(root, '.codex/context/map.json'), path.join(linked, '.codex/context/map.json'));
  await saveMainBinding(root, { mode: 'local', branch: 'trunk' });
  const dir = path.join(root, 'global'), backend = await startServer({ root, port: 0 });
  t.after(() => backend.close());
  await fs.mkdir(dir, { recursive: true });
  const project = await resolveProject(root), hostname = 'registry-project.localhost';
  new RouteStore(dir).addRoute({
    hostname, root, projectId: projectId(root), instance: backend.state.instance,
    runtimeSchema: 3, port: Number(new URL(backend.state.url).port), proxyToken: 'x'.repeat(32),
  });
  const proxy = await startNamedProxy({ dir, port: 0 }); t.after(() => proxy.close());
  const named = await namedWorkbench(backend.state, request, { dir });
  assert.match(named.url, /registry-project\.localhost/);
  const route = new RouteStore(dir).loadRoutes().find(item => item.hostname === hostname);
  assert.equal(route.root, project.sharedDir);
  assert.equal(route.projectKey, project.projectId);
  const registered = (await readProjectRegistry({ dir })).projects.find(item => item.projectId === project.projectId);
  assert.equal(registered.origin, new URL(named.url).origin);
  assert.ok(registered.roots.includes(root));
  assert.equal((await resolveProject(linked)).projectId, registered.projectId);
  const inventory = await cliJSON(['workbench', '--list', '--root', linked], { CONTEXT_GUARD_NAMED_STATE_DIR: dir });
  assert.equal(inventory.registeredCount, 1);
  assert.equal(inventory.runningCount, 1);
  assert.equal(inventory.readyCount, 1);
  assert.equal(inventory.projects[0].status, 'ready');
  assert.equal('projectId' in inventory.projects[0], false);
  assert.equal('instance' in inventory.projects[0], false);
});
test('global inventory separates registered, running, legacy, stopped and unknown workbenches', async t => {
  const dir = path.join(await fixture(t, 'Inventory State'), 'global');
  const proxy = await startNamedProxy({ dir, port: 0 }); t.after(() => proxy.close());

  const readyRoot = await fixture(t, 'Ready Project');
  const ready = await startServer({ root: readyRoot, port: 0 }); t.after(() => ready.close());
  await namedWorkbench(ready.state, request, { dir });

  const legacyRoot = await fixture(t, 'Legacy Project');
  const legacyProject = await resolveProject(legacyRoot);
  const legacyInstance = 'l'.repeat(40);
  const legacy = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      protocol: 1, runtimeSchema: 1, buildId: 'legacy-workbench', capabilities: [],
      projectId: legacyProject.projectId, instance: legacyInstance, pid: process.pid,
      root: legacyRoot, namedRoot: legacyRoot,
    }));
  });
  await new Promise(resolve => legacy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => legacy.close(resolve)));
  new RouteStore(dir).addRoute({
    hostname: 'legacy-project.localhost', root: legacyRoot, projectId: projectId(legacyRoot),
    instance: legacyInstance, port: legacy.address().port, proxyToken: 'l'.repeat(32),
  });

  const stoppedRoot = await fixture(t, 'Stopped Project');
  const stoppedProject = await resolveProject(stoppedRoot);
  const stopped = await startServer({ root: stoppedRoot, port: 0 });
  await rememberProject(stoppedProject, { dir, state: stopped.state });
  await stopped.close();

  const unknownRoot = await fixture(t, 'Unknown Project');
  const unknownProject = await resolveProject(unknownRoot);
  const portProbe = http.createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const unusedPort = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const unknownState = {
    url: `http://127.0.0.1:${unusedPort}/prototype/workbench.html`,
    pid: process.pid, instance: 'u'.repeat(40), root: unknownRoot,
  };
  await fs.mkdir(path.join(unknownRoot, '.codex/context/private'), { recursive: true });
  await fs.writeFile(path.join(unknownRoot, '.codex/context/private/workbench.json'), JSON.stringify(unknownState));
  await rememberProject(unknownProject, { dir, state: unknownState });

  const inventory = await globalWorkbenchInventory({ dir, currentRoot: readyRoot });
  assert.equal(inventory.registeredCount, 3);
  assert.equal(inventory.projectCount, 4);
  assert.equal(inventory.runningCount, 2);
  assert.equal(inventory.readyCount, 1);
  assert.equal(inventory.currentProject.name, 'ready-project');
  assert.equal(inventory.currentProject.status, 'ready');
  assert.equal(inventory.projects.find(project => project.name === 'legacy-project').status, 'legacy');
  assert.equal(inventory.projects.find(project => project.name === 'legacy-project').registered, false);
  assert.equal(inventory.projects.find(project => project.name === 'Stopped Project').status, 'stopped');
  assert.equal(inventory.projects.find(project => project.name === 'Unknown Project').status, 'unknown');

  await ready.close();
  const afterStop = await globalWorkbenchInventory({ dir, currentRoot: readyRoot });
  assert.equal(afterStop.runningCount, 1);
  assert.equal(afterStop.currentProject.status, 'route-stale');
});
test('global inventory reports two backends for one Git project as a duplicate', async t => {
  const root = await fixture(t, 'Duplicate Project'), linked = path.join(root, 'linked');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', windowsHide: true });
  git('init', '-b', 'main');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'fixture');
  git('worktree', 'add', '-b', 'feature', linked);
  await fs.mkdir(path.join(linked, '.codex/context/private'), { recursive: true });
  await fs.copyFile(path.join(root, '.codex/context/map.json'), path.join(linked, '.codex/context/map.json'));
  const project = await resolveProject(root), dir = path.join(root, 'global');
  const identity = (instance, serviceRoot) => ({
    protocol: 2, runtimeSchema: 3, buildId: 'project-workbench-v4',
    capabilities: ['git-common-dir-project', 'named-origin-verification', 'prepared-session-binding', 'private-main-baseline', 'stable-worktree-identity', 'global-project-registry'],
    projectId: project.projectId, instance, pid: process.pid, root: serviceRoot, namedRoot: project.sharedDir,
  });
  const services = [];
  for (const [instance, serviceRoot] of [['a'.repeat(40), root], ['b'.repeat(40), linked]]) {
    const server = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(identity(instance, serviceRoot))); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    services.push({ url: `http://127.0.0.1:${server.address().port}/prototype/workbench.html`, pid: process.pid, instance, root: serviceRoot });
  }
  await fs.mkdir(project.sharedDir, { recursive: true });
  await fs.writeFile(path.join(project.sharedDir, 'workbench.json'), JSON.stringify(services[0]));
  await fs.writeFile(path.join(linked, '.codex/context/private/workbench.json'), JSON.stringify(services[1]));
  await rememberProject(project, { dir, state: services[0] });
  const inventory = await globalWorkbenchInventory({ dir, currentRoot: linked });
  assert.equal(inventory.registeredCount, 1);
  assert.equal(inventory.runningCount, 2);
  assert.equal(inventory.currentProject.status, 'duplicate');
  assert.equal(inventory.currentProject.runningInstances, 2);
});
test('a recognized installed runtime upgrade preserves the project and replaces only the old process', async t => {
  const root = await fixture(t, 'Upgrade Project'), installed = path.join(root, 'installed-old');
  await fs.cp(path.join(cwd, 'scripts'), path.join(installed, 'scripts'), { recursive: true });
  await fs.cp(path.join(cwd, 'prototype'), path.join(installed, 'prototype'), { recursive: true });
  const runtimeFile = path.join(installed, 'scripts/workbench/runtime.mjs');
  const runtime = (await fs.readFile(runtimeFile, 'utf8'))
    .replace(WORKBENCH_BUILD, "project-workbench-v8")
    .replace(/\s*'runtime-instance-check',\r?\n/, '\n');
  await fs.writeFile(runtimeFile, runtime);
  const old = spawnSync(process.execPath, [path.join(installed, 'scripts/workbench/cli.mjs'), 'workbench', '--root', root, '--port', '0', '--direct'], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, CONTEXT_GUARD_NAMED_WORKBENCH: '0', CONTEXT_GUARD_HEADLESS: '1' },
  });
  assert.equal(old.status, 0, old.stderr);
  const oldResult = JSON.parse(old.stdout), before = await diagnoseWorkbench(root);
  assert.equal(before.runtime.status, 'upgrade-required');
  const inventory = await globalWorkbenchInventory({ currentRoot: root });
  assert.equal(inventory.currentProject.status, 'upgrade-required', 'a recognized upgrade must not be mislabeled as unknown legacy');
  const upgraded = await ensureServer(root, 0); t.after(() => stopServer(root));
  assert.notEqual(upgraded.instance, oldResult.instance);
  assert.equal((await diagnoseWorkbench(root)).runtime.status, 'ready');
  assert.equal((await call(upgraded.url, '/__context_guard/health')).data.buildId, WORKBENCH_BUILD);
});
test('proxy restart keeps persisted routes and one project closing cannot take down another', async t => {
  const { proxy, backend, named, dir } = await environment(t);
  const otherRoot = await fixture(t, 'Second'), other = await startServer({ root: otherRoot, port: 0 }); t.after(() => other.close());
  const otherName = await namedWorkbench(other.state, request, { dir });
  const port = Number(new URL(proxy.state.base).port); await proxy.close();
  const restarted = await startNamedProxy({ dir, port }); t.after(() => restarted.close());
  assert.equal((await call(named.url, '/__context_guard/health')).status, 200);
  await backend.close();
  assert.equal((await call(otherName.url, '/__context_guard/health')).status, 200);
});
test('a recognized older named proxy upgrades in place and preserves its route store', async t => {
  const dir = await fixture(t), instance = 'o'.repeat(32), adminToken = 'a'.repeat(32);
  const old = http.createServer((req, res) => {
    if (req.url === '/__cg_proxy/health') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({
        kind: 'context-guard-named', version: 1, runtimeSchema: 2,
        capabilities: ['project-key-routes'], instance,
      }));
    }
    if (req.url === '/__cg_proxy/stop' && req.method === 'POST' && req.headers.authorization === `Bearer ${adminToken}`) {
      res.writeHead(202).end();
      setImmediate(() => old.close(async () => { await fs.unlink(path.join(dir, 'proxy.json')).catch(() => {}); }));
      return;
    }
    res.writeHead(403).end();
  });
  await new Promise(resolve => old.listen(0, '127.0.0.1', resolve));
  const port = old.address().port;
  await fs.writeFile(path.join(dir, 'routes.json'), '[]');
  await fs.writeFile(path.join(dir, 'proxy.json'), JSON.stringify({ version: 1, instance, pid: process.pid, base: `http://127.0.0.1:${port}`, adminToken }));
  const upgraded = await ensureNamedProxy({ dir, port });
  t.after(async () => {
    const response = await call(upgraded.base, '/__cg_proxy/stop', { method: 'POST', headers: { Authorization: `Bearer ${upgraded.adminToken}` } });
    assert.equal(response.status, 202);
  });
  assert.notEqual(upgraded.instance, instance);
  assert.equal(upgraded.runtimeSchema, 4);
  assert.deepEqual(new RouteStore(dir).loadRoutes(), []);
});
test('corrupt routes fail closed without overwriting data, and names normalize deterministically', async t => {
  const root = await fixture(t), store = new RouteStore(root), file = path.join(root, 'routes.json');
  await fs.writeFile(file, 'not-json'); assert.throws(() => store.loadRoutes());
  await assert.rejects(startNamedProxy({ dir: root, port: 0 }));
  assert.equal(await fs.readFile(file, 'utf8'), 'not-json');
  assert.equal(projectName('Context_Guard', root), 'context-guard');
  assert.match(projectName('中文', root), /^project-[a-f0-9]{12}$/);
});
test('owned named proxy listen attempts preserve native listeners and retry only precise loopback denials', async t => {
  for (const scenario of [
    { name: 'asynchronous Windows listen denial', retry: true },
    { name: 'synchronous Windows listen denial', retry: true, synchronous: true },
    { name: 'port zero rejects listen denial', zero: true },
    { name: 'filesystem denial is not retried', syscall: 'open' },
    { name: 'other address denial is not retried', address: '0.0.0.0' },
    { name: 'other attempted port denial is not retried', wrongPort: true },
  ]) await t.test(scenario.name, async t => {
    const root = await fixture(t), dir = path.join(root, 'proxy');
    retainedFixtures.add(root);
    // One candidate; the actual owned proxy validates availability within its original range.
    const port = scenario.zero ? 0 : randomInt(49152, 65515);
    const create = http.createServer, attempts = [], listenerCounts = [], warnings = [];
    let owned, running, factoryMock, listenMock, listeningBaseline, errorBaseline, listeningCalls = 0, errorCalls = 0, passed = false;
    const onWarning = warning => { if (warning.name === 'MaxListenersExceededWarning' && warning.emitter === owned) warnings.push(warning.type); };
    process.on('warning', onWarning);
    factoryMock = t.mock.method(http, 'createServer', (...args) => {
      factoryMock.mock.restore();
      owned = create(...args);
      owned.on('listening', () => listeningCalls++);
      owned.on('error', () => errorCalls++);
      listeningBaseline = owned.listenerCount('listening');
      errorBaseline = owned.listenerCount('error');
      const listen = owned.listen;
      listenMock = t.mock.method(owned, 'listen', function (...input) {
        attempts.push({ port: input[0], address: input[1] });
        listenerCounts.push({ listening: owned.listenerCount('listening'), error: owned.listenerCount('error') });
        if (attempts.length <= 11) {
          const error = Object.assign(new Error('Synthetic owned named listen denial'), {
            code: 'EACCES', syscall: scenario.syscall || 'listen', address: scenario.address || '127.0.0.1', port: input[0] + (scenario.wrongPort ? 1 : 0),
          });
          // Match native callback registration before failure without touching any other server.
          owned.once('listening', input[2]);
          if (scenario.synchronous) throw error;
          process.nextTick(() => owned.emit('error', error));
          return owned;
        }
        return listen.apply(this, input);
      });
      return owned;
    });
    try {
      if (scenario.retry && process.platform === 'win32') {
        running = await startNamedProxy({ dir, port });
        assert.equal(running.server, owned);
        assert.ok(owned.listening);
        assert.ok(attempts.length >= 12 && attempts.length <= 21);
        assert.deepEqual(attempts, attempts.map((_value, index) => ({ port: port + index, address: '127.0.0.1' })));
        assert.equal(Number(new URL(running.state.base).port), attempts.at(-1).port);
        const response = await call(running.state.base, '/__cg_proxy/health');
        assert.equal(response.status, 200);
        assert.equal(response.data.kind, 'context-guard-named');
        assert.ok(response.data.instance === running.state.instance);
        assert.equal(listeningCalls, 1);
      } else {
        await assert.rejects(startNamedProxy({ dir, port }), {
          code: 'EACCES', syscall: scenario.syscall || 'listen', address: scenario.address || '127.0.0.1', port: port + (scenario.wrongPort ? 1 : 0),
        });
        assert.deepEqual(attempts, [{ port, address: '127.0.0.1' }]);
        assert.equal(listeningCalls, 0);
      }
      assert.deepEqual(listenerCounts, attempts.map(() => ({ listening: listeningBaseline, error: errorBaseline + 1 })), 'only the current attempt adds one error listener');
      assert.equal(owned.listenerCount('listening'), listeningBaseline);
      assert.equal(owned.listenerCount('error'), errorBaseline);
      const retrying = scenario.retry && process.platform === 'win32';
      const actualBindFailures = retrying ? attempts.length - 12 : 0;
      assert.equal(errorCalls, (scenario.synchronous ? 0 : retrying ? 11 : 1) + actualBindFailures);
      assert.deepEqual(warnings, []);
      passed = true;
    } finally {
      process.off('warning', onWarning);
      listenMock?.mock.restore(); factoryMock.mock.restore();
      await running?.close();
      if (passed) retainedFixtures.delete(root);
    }
  });
});

test('concurrent separate launchers reuse one daemon without replacing an occupied service', async t => {
  const root = await fixture(t), dir = path.join(root, 'global');
  const occupied = http.createServer((_q, r) => r.end('unrelated'));
  let port = null, phase = 'occupied-listen', passed = false, firstError, launchers, closed = 0, diagnosed = false;
  retainedFixtures.add(root);
  const diagnose = async () => {
    if (diagnosed) return;
    diagnosed = true;
    // Read only this synthetic daemon's message, never output capabilities or raw logs.
    const log = await fs.readFile(path.join(dir, 'proxy.log'), 'utf8').catch(() => '');
    const listen = log.split(/\r?\n/).map(line => /^listen (EACCES|EADDRINUSE): [^\r\n]* 127\.0\.0\.1:(\d+)$/.exec(line)).find(match => match && Number(match[2]) >= 1 && Number(match[2]) <= 65535);
    const codes = ['EACCES', 'EADDRINUSE', 'ENOENT', 'EPERM'].filter(code => new RegExp(`\\b${code}\\b`).test(log));
    console.error('[named-launcher-diagnostic] ' + JSON.stringify({
      fixture: root, phase, occupiedPort: port, launcherCloses: closed, occupiedListening: occupied.listening,
      daemonCodes: codes, daemonMessage: listen ? { source: 'daemon-message', operation: 'listen', code: listen[1], address: '127.0.0.1', port: Number(listen[2]) } : null,
      daemonOperationUnknown: !listen,
    }));
  };
  t.after(async () => {
    try {
      const settled = launchers ? await launchers : [];
      const state = settled.find(result => result.status === 'fulfilled')?.value;
      if (state) {
        let saved;
        try { saved = JSON.parse(await fs.readFile(path.join(dir, 'proxy.json'), 'utf8')); }
        catch { throw new Error('Owned proxy state could not be read'); }
        assert.ok(saved.instance === state.instance, 'Owned proxy instance must match');
        assert.ok(saved.pid === state.pid, 'Owned proxy PID must match');
        assert.ok(Number.isInteger(state.pid) && state.pid > 0 && state.pid !== process.pid);
        assert.ok(saved.base === state.base, 'Owned proxy base must match');
        assert.ok(saved.adminToken === state.adminToken, 'Owned proxy capability must match');
        phase = 'owned-proxy-stop';
        const stopped = await call(state.base, '/__cg_proxy/stop', { method: 'POST', headers: { Authorization: `Bearer ${state.adminToken}` } });
        assert.equal(stopped.status, 202);
        let exited = false;
        for (let i = 0; i < 100; i++) {
          let stateGone = false, pidGone = false;
          try { await fs.access(path.join(dir, 'proxy.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; stateGone = true; }
          try { process.kill(state.pid, 0); } catch (error) { if (error.code !== 'ESRCH') throw error; pidGone = true; }
          if (stateGone && pidGone) { exited = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.ok(exited, 'Proxy did not stop and exit within the original shutdown window');
      } else {
        // A state without a successful launcher is not sufficient ownership evidence.
        try { await fs.access(path.join(dir, 'proxy.json')); throw new Error('Proxy ownership could not be verified'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    } catch (error) { await diagnose(); throw firstError || error; }
    finally {
      try { if (occupied.listening) await new Promise((resolve, reject) => occupied.close(error => error ? reject(error) : resolve())); }
      catch (error) { await diagnose(); throw firstError || error; }
    }
    if (passed) retainedFixtures.delete(root);
  });
  try {
    await new Promise((resolve, reject) => {
      const onError = error => { occupied.off('listening', onListening); reject(error); };
      const onListening = () => { occupied.off('error', onError); resolve(); };
      occupied.once('error', onError); occupied.once('listening', onListening); occupied.listen(0, '127.0.0.1');
    });
    port = occupied.address().port;
    phase = 'launcher-close';
    const code = `import {ensureNamedProxy} from ${JSON.stringify(new URL('../scripts/workbench/named.mjs', import.meta.url).href)}; console.log(JSON.stringify(await ensureNamedProxy({dir:process.argv[1],port:Number(process.argv[2])})));`;
    launchers = Promise.allSettled(Array.from({ length: 5 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code, dir, String(port)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let output = '', errorOutput = '', failure;
      child.stdout.on('data', data => output += data); child.stderr.on('data', data => errorOutput += data);
      child.on('error', error => { failure = error; firstError ||= error; });
      child.on('close', exitCode => {
        closed++;
        if (!failure && exitCode !== 0) failure = new Error(errorOutput);
        if (!failure) {
          try { resolve(JSON.parse(output)); return; }
          catch { failure = new Error('Named launcher returned invalid JSON'); }
        }
        firstError ||= failure; reject(failure);
      });
    })));
    const settled = await launchers;
    if (firstError) throw firstError;
    const states = settled.map(result => result.value);
    phase = 'launcher-assertions';
    assert.equal(new Set(states.map(state => state.instance)).size, 1);
    assert.notEqual(Number(new URL(states[0].base).port), port);
    passed = true;
  } catch (error) { firstError ||= error; await diagnose(); throw error; }
});
test('published state is not healthy until initialization finishes, including slow disk flush', async t => {
  const dir = await fixture(t), originalOpen = fs.open;
  let release, flushing;
  const blocked = new Promise(r => release = r), reached = new Promise(r => flushing = r);
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    // Delay the state file flush (portable to Windows, which skips dir fsync).
    if (String(args[0]).startsWith(path.join(dir, 'proxy.json.'))) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { flushing(); await blocked; await sync(); };
    }
    return handle;
  };
  t.after(async () => { release(); fs.open = originalOpen; await (await starting).close(); });
  // A known port lets us probe during the state write, not after start returns.
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const starting = startNamedProxy({ dir, port });
  await reached;
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await call(base, '/__cg_proxy/health')).status, 503);
  assert.equal((await call(base, '/__cg_proxy/stop', { method: 'POST' })).status, 503);
  release(); const proxy = await starting; t.after(() => proxy.close());
  assert.equal((await call(base, '/__cg_proxy/health')).status, 200);
  assert.equal((await call(base, '/__cg_proxy/stop', { method: 'POST', headers: { Authorization: `Bearer ${proxy.state.adminToken}` } })).status, 202);
  await proxy.close();
  await assert.rejects(fs.access(path.join(dir, 'proxy.json')), { code: 'ENOENT' });
  await assert.rejects(call(base, '/__cg_proxy/health'));
});
test('explicit linked-worktree binding reuses server and hook context without overwriting maps', async t => {
  const root = await fixture(t), source = path.join(root, 'linked'), foreign = await fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', windowsHide: true });
  git('init'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'fixture');
  git('worktree', 'add', '--detach', source, 'HEAD');
  await assert.rejects(bindProject(source, foreign));
  await fs.mkdir(path.join(source, '.codex/context'), { recursive: true });
  const mapFile = path.join(source, '.codex/context/map.json'); await fs.writeFile(mapFile, '{"local":"preserved"}');
  await assert.rejects(bindProject(source, root), /Local Map/);
  await bindProject(source, root, { keepLocal: true });
  assert.equal(await resolveProjectRoot(source), root);
  assert.equal(await fs.readFile(mapFile, 'utf8'), '{"local":"preserved"}');
  const cloud = spawnSync(process.execPath, [path.join(cwd, 'scripts/workbench/cli.mjs'), 'sync', 'status', '--root', source], { encoding: 'utf8', windowsHide: true });
  assert.equal(cloud.status, 0, cloud.stderr);
  assert.equal(JSON.parse(cloud.stdout).managedBy, 'workbench');
  assert.equal(JSON.parse(cloud.stdout).configured, false);
  const results = await Promise.all([ensureServer(root, 0), ensureServer(source, 0)]); t.after(() => stopServer(root));
  assert.equal(results[0].instance, results[1].instance);
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const hook = path.join(cwd, 'scripts/context_guard_hook.py');
  const child = spawn(python, [hook, 'session-start', '--platform', 'codex'], { cwd: source, env: { ...process.env, CONTEXT_GUARD_DISABLE_WORKBENCH: '1', CODEX_THREAD_ID: 'bound-test' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.resume(); let err = ''; child.stderr.on('data', d => err += d); child.stdin.end(JSON.stringify({ cwd: source, session_id: 'bound-test' }));
  const [exit] = await once(child, 'exit'); assert.equal(exit, 0, err);
  assert.match(await fs.readFile(path.join(source, '.codex/context/sessions.jsonl'), 'utf8'), /bound-test/);
  assert.doesNotMatch(await fs.readFile(path.join(root, '.codex/context/sessions.jsonl'), 'utf8'), /bound-test/);
  assert.equal(await fs.readFile(mapFile, 'utf8'), '{"local":"preserved"}');
});
test('real SessionStart injects named URL and automatic browser opener is claimed only once', async t => {
  const root = await fixture(t, 'Hook Project'), dir = path.join(root, 'proxy');
  let passed = false, backend, proxy, ownedChildPid;
  retainedFixtures.add(root);
  ownedLifecycleFixtures.add(root);
  t.after(async () => {
    const deadline = Date.now() + 12000;
    try {
      await stopServer(root);
      if (ownedChildPid) {
        for (;;) {
          try { process.kill(ownedChildPid, 0); }
          catch (error) { if (error.code === 'ESRCH') break; throw error; }
          assert.ok(Date.now() < deadline, 'the owned restored backend exits within the original shutdown window');
          await new Promise(resolve => setTimeout(resolve, Math.min(50, deadline - Date.now())));
        }
      }
    } finally {
      try { await backend?.close(); } finally { await proxy?.close(); }
    }
    if (passed) retainedFixtures.delete(root);
  });
  execFileSync('git', ['init', '-b', 'trunk'], { cwd: root, stdio: 'pipe', windowsHide: true });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'pipe', windowsHide: true });
  await saveMainBinding(root, { mode: 'local', branch: 'trunk' });
  proxy = await startNamedProxy({ dir, port: 0 });
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const env = { ...process.env, CONTEXT_GUARD_NAMED_STATE_DIR: dir, CONTEXT_GUARD_NAMED_WORKBENCH: '1', CONTEXT_GUARD_DISABLE_WORKBENCH: '0', CONTEXT_GUARD_HEADLESS: '1' };
  const run = (args, input = '') => new Promise((resolve, reject) => {
    const child = spawn(python, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d); child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr))); child.stdin.end(input);
  });
  const hookArgs = [path.join(cwd, 'scripts/context_guard_hook.py'), 'session-start', '--platform', 'codex'];
  const payload = JSON.stringify({ cwd: root, session_id: 'named-hook' });
  const unbound = await run(hookArgs, payload);
  assert.match(unbound.stdout + unbound.stderr, /no established workbench/);
  await assert.rejects(fs.access(path.join(root, '.codex/context/private/workbench.json')));
  backend = await startServer({ root, port: 0 });
  const known = await namedWorkbench(backend.state, request, { dir });
  const automaticallyBound = await run(hookArgs, payload);
  assert.match(automaticallyBound.stdout + automaticallyBound.stderr, new RegExp(known.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(automaticallyBound.stdout + automaticallyBound.stderr, /Ask the user/);
  assert.equal((await diagnoseWorkbench(root, 'named-hook')).session.verified, true, automaticallyBound.stdout + automaticallyBound.stderr);
  const hook = await run(hookArgs, payload);
  assert.match(hook.stdout + hook.stderr, /http:\/\/hook-project\.localhost:\d+\/prototype\/workbench.html/);
  const repaired = await diagnoseWorkbench(root, 'named-hook');
  assert.equal(repaired.session.verified, true);
  assert.match(repaired.session.workbenchUrl, /hook-project\.localhost/);
  await backend.close();
  const restored = await run(hookArgs, payload);
  assert.doesNotMatch(restored.stdout + restored.stderr, /Ask the user/);
  const restoredDiagnosis = await diagnoseWorkbench(root, 'named-hook');
  const restoredService = restoredDiagnosis.runtime.services.find(service => service.status === 'ready'
    && service.projectId === restoredDiagnosis.project.id && Number.isInteger(service.pid)
    && service.pid > 0 && service.pid !== process.pid && typeof service.root === 'string');
  if (restoredService && await fs.realpath(restoredService.root) === await fs.realpath(root)) ownedChildPid = restoredService.pid;
  if (!restoredDiagnosis.session.verified) {
    const output = restored.stdout + restored.stderr;
    const codes = ['START_FAILED', 'UPGRADE_PENDING', 'HTTP_ERROR', 'FORBIDDEN', 'UNKNOWN_SESSION', 'EACCES', 'EADDRINUSE', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'];
    t.diagnostic(JSON.stringify({ phase: 'SessionStart-restored', node: process.version,
      session: { bound: restoredDiagnosis.session.bound, verified: restoredDiagnosis.session.verified, state: restoredDiagnosis.session.state },
      runtime: { status: restoredDiagnosis.runtime.status, namedStatus: restoredDiagnosis.runtime.named?.status,
        serviceStatuses: restoredDiagnosis.runtime.services.map(service => service.status) },
      sameNamedUrl: restoredDiagnosis.workbenchUrl === known.url,
      hook: { includesKnownUrl: output.includes(known.url), bindingUnreadable: /binding unreadable/.test(output),
        repairUnverified: /could not be verified or repaired|binding unverified/.test(output), codes: codes.filter(code => new RegExp(`\\b${code}\\b`).test(output)) },
      fixtureRetained: true }));
  }
  assert.equal(restoredDiagnosis.session.verified, true, restored.stdout + restored.stderr);
  // Use a spy, not the user's browser, but exercise the real Python opener path.
  const code = `import sys,os,json; sys.path.insert(0,${JSON.stringify(path.join(cwd, 'scripts'))}); import context_guard as c; from pathlib import Path; os.environ.pop('CI',None); os.environ.pop('CONTEXT_GUARD_HEADLESS',None); calls=[]; c.webbrowser.open=lambda *a,**k:calls.append(a[0]); c.start_workbench(Path.cwd()); c.start_workbench(Path.cwd()); print(json.dumps(calls))`;
  const opened = await run(['-c', code]); assert.equal(JSON.parse(opened.stdout).length, 1);
  passed = true;
});

test('named entry keeps Git Session views isolated and survives a backend worktree change', async t => {
  const root = await fixture(t, 'Shared Project'), other = path.join(root, 'linked');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', windowsHide: true });
  git('init', '-b', 'trunk');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'fixture');
  git('worktree', 'add', '-b', 'feature', other);
  await fs.mkdir(path.join(other, '.codex/context'), { recursive: true });
  await fs.copyFile(path.join(root, '.codex/context/map.json'), path.join(other, '.codex/context/map.json'));
  await fs.copyFile(path.join(root, '.codex/context/sessions.jsonl'), path.join(other, '.codex/context/sessions.jsonl'));
  await saveMainBinding(root, { mode: 'local', branch: 'trunk' });
  const dir = path.join(root, 'proxy'), proxy = await startNamedProxy({ dir, port: 0 }); t.after(() => proxy.close());
  const backend = await startServer({ root, port: 0 }); t.after(() => backend.close());
  const named = await namedWorkbench(backend.state, request, { dir });
  const one = await request(backend.state, '/api/session', { method: 'POST', body: { sessionId: 'test-0', worktreeRoot: root } });
  const two = await request(backend.state, '/api/session', { method: 'POST', body: { sessionId: 'test-1', worktreeRoot: other } });
  const headers = actor => ({ Authorization: `Bearer ${actor.token}`, Origin: new URL(named.url).origin, 'Content-Type': 'application/json' });
  const first = await call(named.url, '/api/state', { headers: headers(one) });
  await backend.access.grant('test-0', ['T0'], first.data.version);
  const saved = await call(named.url, '/api/commit', { method: 'POST', headers: headers(one), body: { baseVersion: first.data.version, operationId: 'named-isolated', operations: [{ type: 'update', id: 'T0', fields: { purpose: 'only-first-session' } }] } });
  assert.equal(saved.status, 200);
  assert.notEqual((await call(named.url, '/api/state', { headers: headers(two) })).data.doc.root.purpose, 'only-first-session');
  const all = await call(named.url, '/api/state', { headers: { Authorization: `Bearer ${backend.humanToken}` } });
  assert.equal(all.data.doc.root, null);
  await backend.close();
  const restarted = await startServer({ root: other, port: 0 }); t.after(() => restarted.close());
  const restored = await namedWorkbench(restarted.state, request, { dir });
  assert.equal(restored.url, named.url);
  assert.equal((await call(restored.url, '/__context_guard/health')).status, 200);
});

test('START_FAILED mentions the default directory only when that directory caused the failure', async t => {
  const base = 'Node workbench did not become healthy; inspect private/node-workbench.log';
  const dir = '/tmp/context-guard-default';
  assert.equal(startFailedMessage({ log: 'listen EADDRINUSE', directory: { path: dir, overridden: false, unavailable: false } }), base);
  assert.equal(startFailedMessage({ log: `${dir} is unavailable (EACCES)`, directory: { path: dir, overridden: false, unavailable: false } }), base);
  assert.equal(startFailedMessage({ log: `${dir} is unavailable (EACCES)`, directory: { path: dir, overridden: true, unavailable: true } }), base);
  assert.equal(startFailedMessage({ log: 'the process exited before listen', directory: { path: dir, overridden: false, unavailable: true } }), base);
  const named = startFailedMessage({ log: `The default directory ${dir} is unavailable (ENOTDIR)`, directory: { path: dir, overridden: false, unavailable: true } });
  assert.match(named, new RegExp(`The default directory ${dir} is unavailable`));
  assert.match(named, /skill-reference\/design\/design-interface-v1\.2\.1\.md/);
  assert.match(named, new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const windowsDirectory = String.raw`C:\Users\fixture\.context-guard\named-workbench`;
  const windowsState = { path: windowsDirectory, overridden: false, unavailable: true };
  assert.match(startFailedMessage({ log: JSON.stringify({ error: { message: `The default directory ${windowsDirectory} is unavailable (ENOTDIR)` } }), directory: windowsState }), /The default directory/);
  assert.equal(startFailedMessage({ log: JSON.stringify({ error: { message: 'Another directory is unavailable (ENOTDIR)' } }), directory: windowsState }), base);

  const home = await fs.mkdtemp(path.join(cwd, 'temp/default-dir-home-'));
  fixtureRoots.push(home);
  await fs.mkdir(path.join(home, '.context-guard'), { recursive: true });
  await fs.writeFile(path.join(home, '.context-guard/named-workbench'), 'not-a-directory\n');
  const root = await fixture(t, 'Blocked Directory');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CONTEXT_GUARD_NAMED_STATE_DIR;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { ensureServer } from ${JSON.stringify(pathToFileURL(path.join(cwd, 'scripts/workbench/cli.mjs')).href)};
    try {
      await ensureServer(${JSON.stringify(root)}, 0);
      console.log(JSON.stringify({ ok: true }));
    } catch (error) {
      console.log(JSON.stringify({ code: error.code, message: error.message }));
    }
  `], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => stdout += chunk);
  child.stderr.on('data', chunk => stderr += chunk);
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`startup hung\n${stdout}\n${stderr}`)); }, 20000);
    child.on('exit', status => { clearTimeout(timer); resolve(status); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
  });
  assert.equal(code, 0, stderr || stdout);
  const result = JSON.parse(stdout);
  assert.equal(result.code, 'START_FAILED');
  const startupLog = await fs.readFile(path.join(root, '.codex/context/private/node-workbench.log'), 'utf8');
  assert.match(result.message, /The default directory .+ is unavailable/, startupLog);
  assert.match(result.message, /skill-reference\/design\/design-interface-v1\.2\.1\.md/);
  assert.match(result.message, /inspect private\/node-workbench\.log/);
});
