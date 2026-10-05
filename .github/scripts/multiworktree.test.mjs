import './test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProject, projectPreferences, saveMainBinding, bindingStatus } from '../../scripts/workbench/project.mjs';
import { startServer } from '../../scripts/workbench/server.mjs';
import { request, stopServer } from '../../scripts/workbench/cli.mjs';
import { namedWorkbench } from '../../scripts/workbench/named.mjs';
import { startNamedProxy } from '../../scripts/workbench/named-proxy.mjs';
import { WorkbenchSync } from '../../prototype/workbench-sync.mjs';
import { summarizeHooks } from '../../scripts/workbench/hook-status.mjs';
const repo = fileURLToPath(new URL('../../', import.meta.url));
import { pythonCommand } from './python-command.mjs';
const python = pythonCommand();
import { run as runProcess } from './client-protocol.mjs';
function run(command, args, cwd = repo, input) {
  return runProcess(command, args, { cwd, input, timeout: 120_000, allowFailure: true,
    env: { ...process.env, CONTEXT_GUARD_NAMED_WORKBENCH: '0', CONTEXT_GUARD_HEADLESS: '1', CODEX_THREAD_ID: '', CONTEXT_GUARD_DISABLE_WORKBENCH: '1' } });
}
const git = async (root, ...args) => { const r = await run('git', args, root); assert.equal(r.code, 0, r.stderr); return r.stdout.trim(); };
const cli = (root, ...args) => run(process.execPath, [path.join(repo, 'scripts/workbench/cli.mjs'), ...args, '--root', root]);
const hookRoots = new Map();
const hook = (root, id, event = 'session-start') => run(python, [path.join(hookRoots.get(root) || repo, 'scripts/context_guard_hook.py'), event, '--platform', 'codex'], root, JSON.stringify({ cwd: root, session_id: id, prompt: '检查绑定', is_background_agent: true }));
async function fixture(t, cleanup = true) {
  await fs.mkdir(path.join(repo, 'temp'), { recursive: true });
  const dir = await fs.mkdtemp(path.join(repo, 'temp/binding-'));
  const root = path.join(dir, 'repo'), other = path.join(dir, 'other'); await fs.mkdir(root);
  if (cleanup) t.after(async () => {
    await stopServer(root);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  await git(root, 'init', '-b', 'trunk'); await git(root, 'config', 'user.email', 'fixture@example.invalid'); await git(root, 'config', 'user.name', 'Fixture');
  await fs.writeFile(path.join(root, 'README.md'), 'fixture'); await git(root, 'add', 'README.md'); await git(root, 'commit', '-m', 'initial');
  await git(root, 'worktree', 'add', '-b', 'feature', other);
  const installed = path.join(dir, 'installed');
  await fs.cp(path.join(repo, 'scripts'), path.join(installed, 'scripts'), { recursive: true });
  await fs.cp(path.join(repo, 'prototype'), path.join(installed, 'prototype'), { recursive: true });
  hookRoots.set(root, installed); hookRoots.set(other, installed);
  return { dir, root, other };
}
async function initialize(root) {
  const r = await run(python, [path.join(repo, 'scripts/context_guard.py'), 'init', '--root', root]); assert.equal(r.code, 0, r.stderr);
}
async function call(service, route, token, body) {
  const r = await fetch(new URL(route, service.state?.url || service.url), { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}
test('unbound hooks ask before initialization; no main branch is guessed; language is shared', async t => {
  const { root, other } = await fixture(t);
  const p = await resolveProject(root), q = await resolveProject(other);
  assert.equal(p.projectId, q.projectId); assert.equal(p.bindingRequired, true);
  const first = await hook(root, 'one'); assert.equal(first.code, 0); assert.match(first.stdout, /no established workbench/);
  await assert.rejects(fs.access(path.join(root, '.codex/context/map.json')));
  const mapRead = await cli(root, 'map', 'read', '--session', 'one'); assert.notEqual(mapRead.code, 0); assert.match(mapRead.stdout, /SESSION_BINDING_REQUIRED/);
  await assert.rejects(fs.access(path.join(p.sharedDir, 'workbench.json')));
  await fs.mkdir(path.join(other, '.codex/context'), { recursive: true });
  await fs.writeFile(path.join(other, '.codex/context/preferences.json'), JSON.stringify({ record_language: 'zh' }));
  assert.equal((await projectPreferences(p)).record_language, 'zh');
  assert.equal((await projectPreferences(q)).record_language, 'zh');
  const configured = await saveMainBinding(root, { mode: 'local', branch: 'trunk' }); assert.equal(configured.mainBranch, 'trunk');
});
test('language conflicts and damaged files fail explicitly instead of asking first-use again', async t => {
  const { root, other } = await fixture(t);
  for (const [dir, language] of [[root, 'zh'], [other, 'en']]) {
    await fs.mkdir(path.join(dir, '.codex/context'), { recursive: true });
    await fs.writeFile(path.join(dir, '.codex/context/preferences.json'), JSON.stringify({ record_language: language }));
  }
  const project = await resolveProject(root);
  await assert.rejects(projectPreferences(project), /conflict/);
  await projectPreferences(project, 'zh'); assert.equal((await projectPreferences(await resolveProject(other))).record_language, 'zh');
  await fs.writeFile(path.join(project.sharedDir, 'preferences.json'), '{');
  await assert.rejects(projectPreferences(project));
});
test('bound worktrees share service; Session maps are isolated; rebind expires old token and store', async t => {
  const { root, other } = await fixture(t);
  await saveMainBinding(root, { mode: 'local', branch: 'trunk' });
  await initialize(root); await initialize(other); await hook(root, 'one'); await hook(other, 'two');
  const service = await startServer({ root, port: 0 }); t.after(() => service.close());
  const bind = async (dir, id) => {
    const result = await call(service, '/api/session', service.state.adminToken, { sessionId: id, worktreeRoot: dir });
    assert.equal(result.status, 200, JSON.stringify(result)); return result.data.token;
  };
  const one = await bind(root, 'one'), two = await bind(other, 'two');
  const a = (await call(service, '/api/state', one)).data, b = (await call(service, '/api/state', two)).data;
  assert.equal(a.viewId, 'session:one'); assert.equal(b.viewId, 'session:two');
  assert.deepEqual(a.grants, ['T0']);
  const changed = await call(service, '/api/commit', one, { baseVersion: a.version, operationId: 'change-one', operations: [{ type: 'update', id: 'T0', fields: { purpose: 'one-only' } }] });
  assert.equal(changed.status, 200);
  const created = await call(service, '/api/commit?view=session%3Aone', service.humanToken, {
    baseVersion: changed.data.version,
    operationId: 'create-future-node',
    operations: [{ type: 'create', parentId: 'T0', node: { id: 'N1', title: 'Future node', kind: 'work' } }],
  });
  assert.equal(created.status, 200, JSON.stringify(created));
  const expanded = (await call(service, '/api/state', one)).data;
  assert.deepEqual(expanded.grants.sort(), ['N1', 'T0']);
  const futureWrite = await call(service, '/api/commit', one, { baseVersion: expanded.version, operationId: 'future-node-write', operations: [{ type: 'update', id: 'N1', fields: { purpose: 'dynamic grant' } }] });
  assert.equal(futureWrite.status, 200);
  await service.access.grant('one', ['T0'], futureWrite.data.version);
  const narrowed = await call(service, '/api/commit', one, { baseVersion: futureWrite.data.version, operationId: 'narrowed-node-write', operations: [{ type: 'update', id: 'N1', fields: { purpose: 'must fail' } }] });
  assert.equal(narrowed.status, 403); assert.equal(narrowed.data.error.code, 'FORBIDDEN');
  await service.access.grant('one', [], futureWrite.data.version, 'all');
  assert.deepEqual((await call(service, '/api/state', one)).data.grants.sort(), ['N1', 'T0']);
  assert.notEqual((await call(service, '/api/state', two)).data.doc.root.purpose, 'one-only');
  const all = (await call(service, '/api/state', service.humanToken)).data;
  assert.equal(all.doc.root, null); assert.equal(all.source.needsReconcile, true);
  const mainWrite = await call(service, '/api/commit', service.humanToken, { baseVersion: all.version, operationId: 'main-write', operations: [{ type: 'update', id: 'T0', fields: { title: 'must fail' } }] });
  assert.equal(mainWrite.status, 403); assert.equal(mainWrite.data.error.code, 'READ_ONLY_MAIN');
  const reused = await cli(other, 'workbench', '--session', 'two'); assert.equal(reused.code, 0, reused.stdout);
  const reusedUrl = new URL(JSON.parse(reused.stdout).url); const serviceUrl = new URL(service.state.url);
  assert.equal(reusedUrl.origin + reusedUrl.pathname, serviceUrl.origin + serviceUrl.pathname); assert.equal(reusedUrl.searchParams.get('session'), 'two');
  const prompted = await hook(other, 'two', 'user-prompt-submit'); assert.doesNotMatch(prompted.stdout, /This Session is not bound/);
  await hook(other, 'one');
  assert.equal((await call(service, '/api/session', service.state.adminToken, { sessionId: 'one', worktreeRoot: other })).data.error.code, 'SESSION_ALREADY_BOUND');
  const rebound = await call(service, '/api/session', service.state.adminToken, { sessionId: 'one', worktreeRoot: other, allowRebind: true });
  assert.equal(rebound.status, 200, JSON.stringify(rebound));
  assert.equal((await call(service, '/api/state', one)).status, 401);
  assert.notEqual(service.stores.get('session:one').doc.root.purpose, 'one-only');
});
test('a supplied workbench URL is verified before the Session binding is committed', async t => {
  const first = await fixture(t, false), second = await fixture(t, false);
  let firstService, otherService, firstProxy, otherProxy;
  t.after(async () => {
    await Promise.all([firstProxy, otherProxy, firstService, otherService].filter(Boolean).map(service => service.close()));
    await Promise.all([fs.rm(first.dir, { recursive: true, force: true }), fs.rm(second.dir, { recursive: true, force: true })]);
  });
  await saveMainBinding(first.root, { mode: 'local', branch: 'trunk' });
  await saveMainBinding(second.root, { mode: 'local', branch: 'trunk' });
  await initialize(first.root); await initialize(second.root);
  await hook(first.root, 'url-session');
  firstService = await startServer({ root: first.root, port: 0 });
  otherService = await startServer({ root: second.root, port: 0 });
  firstProxy = await startNamedProxy({ dir: path.join(first.dir, 'proxy'), port: 0 });
  otherProxy = await startNamedProxy({ dir: path.join(second.dir, 'proxy'), port: 0 });
  const firstNamed = await namedWorkbench(firstService.state, request, { dir: path.join(first.dir, 'proxy'), port: 0 });
  const otherNamed = await namedWorkbench(otherService.state, request, { dir: path.join(second.dir, 'proxy'), port: 0 });
  const rejected = await cli(first.root, 'workbench', '--session', 'url-session', '--workbench-url', otherNamed.url);
  assert.notEqual(rejected.code, 0); assert.match(rejected.stdout, /PROJECT_MISMATCH/);
  assert.equal((await bindingStatus(await resolveProject(first.root), 'url-session')).session.bound, false);
  const accepted = await cli(first.root, 'workbench', '--session', 'url-session', '--workbench-url', firstNamed.url);
  assert.equal(accepted.code, 0, accepted.stdout);
  const result = JSON.parse(accepted.stdout);
  assert.equal(result.binding.verified, true);
  assert.match(result.url, /\.localhost:/);
  assert.equal(new URL(result.url).searchParams.get('session'), 'url-session');
  const status = await bindingStatus(await resolveProject(first.root), 'url-session');
  assert.equal(status.session.bound, true);
  assert.equal(status.session.workbenchUrl, new URL('/prototype/workbench.html', firstNamed.url).href);
  const diagnosed = await cli(first.root, 'workbench', '--binding-status', '--session', 'url-session');
  assert.equal(JSON.parse(diagnosed.stdout).workbenchUrl, status.session.workbenchUrl);
  const pythonAccepted = await run(python, [path.join(repo, 'scripts/context_guard.py'), 'workbench', '--root', first.root, '--session', 'url-session', '--workbench-url', firstNamed.url, '--no-open'], first.root);
  assert.equal(pythonAccepted.code, 0, pythonAccepted.stderr);
  assert.match(JSON.parse(pythonAccepted.stdout).url, /\.localhost:/);
});
test('view reload clears pending state so following updates are consumed', async () => {
  const sync = Object.create(WorkbenchSync.prototype);
  Object.assign(sync, { config: { root: 'test' }, viewId: 'session:one', initializationRequired: true, events: {}, revision: 0, dirty: () => false, panel: { querySelector: () => ({ hidden: false }) }, a: { apply() {}, getRoot: () => ({ id: 'T0' }) }, presence: async () => {}, setStatus() {} });
  let reads = 0;
  sync.call = async () => { reads++; return { version: String(reads), doc: { root: { id: 'T0' } } }; };
  await sync.reload(); assert.equal(sync.initializationRequired, false);
  await sync.receive({ version: 'next', viewId: 'session:one' }); assert.equal(reads, 2);
});
test('native Hook readiness requires every supported event to be trusted and enabled', () => {
  const target = path.join(repo, 'installed-skill');
  const required = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt'];
  const hooks = required.map(eventName => ({ eventName, enabled: true, trustStatus: 'trusted', command: `${python} ${path.join(target, 'scripts/context_guard_hook.py')}` }));
  assert.equal(summarizeHooks({ data: [{ hooks }] }, target).trusted, true);
  assert.equal(summarizeHooks({ data: [{ hooks: hooks.map(hook => ({ ...hook, eventName: hook.eventName[0].toLowerCase() + hook.eventName.slice(1) })) }] }, target).trusted, true);
  hooks[0] = { ...hooks[0], trustStatus: 'untrusted' };
  const rejected = summarizeHooks({ data: [{ hooks }] }, target);
  assert.equal(rejected.trusted, false); assert.deepEqual(rejected.missing, ['SessionStart']);
});
