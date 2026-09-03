import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolveProject, projectPreferences, saveMainBinding, sessionBinding } from '../../scripts/workbench/project.mjs';
import { startServer } from '../../scripts/workbench/server.mjs';
import { WorkbenchSync } from '../../prototype/workbench-sync.mjs';
import { startMemoryServer } from '../../scripts/cloud/memory.mjs';
import { memoryConfigPath, memoryStatus, synchronizeMemory, prepareMemory, sessionMemoryDir } from '../../scripts/workbench/memory.mjs';
import { summarizeHooks } from '../../scripts/workbench/hook-status.mjs';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const python = process.platform === 'win32' ? 'python' : 'python3';
function run(command, args, cwd = repo, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, env: { ...process.env, CONTEXT_GUARD_NAMED_WORKBENCH: '0', CONTEXT_GUARD_HEADLESS: '1', CODEX_THREAD_ID: '', CONTEXT_GUARD_DISABLE_WORKBENCH: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('error', reject); child.on('exit', code => resolve({ code, stdout, stderr })); child.stdin.end(input);
  });
}
const git = async (root, ...args) => { const r = await run('git', args, root); assert.equal(r.code, 0, r.stderr); return r.stdout.trim(); };
const cli = (root, ...args) => run(process.execPath, [path.join(repo, 'scripts/workbench/cli.mjs'), ...args, '--root', root]);
const hookRoots = new Map();
const hook = (root, id, event = 'session-start') => run(python, [path.join(hookRoots.get(root) || repo, 'scripts/context_guard_hook.py'), event, '--platform', 'codex'], root, JSON.stringify({ cwd: root, session_id: id, prompt: '检查绑定', is_background_agent: true }));
async function fixture(t) {
  await fs.mkdir(path.join(repo, 'temp'), { recursive: true });
  const dir = await fs.mkdtemp(path.join(repo, 'temp/binding-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo'), other = path.join(dir, 'other'); await fs.mkdir(root);
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
  const first = await hook(root, 'one'); assert.equal(first.code, 0); assert.match(first.stdout, /not bound/);
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
  await service.access.grant('one', ['T0'], a.version);
  assert.equal((await call(service, '/api/commit', one, { baseVersion: a.version, operationId: 'change-one', operations: [{ type: 'update', id: 'T0', fields: { purpose: 'one-only' } }] })).status, 200);
  assert.notEqual((await call(service, '/api/state', two)).data.doc.root.purpose, 'one-only');
  const all = (await call(service, '/api/state', service.humanToken)).data;
  assert.equal(all.doc.root, null); assert.equal(all.source.needsReconcile, true);
  const reused = await cli(other, 'workbench', '--session', 'two'); assert.equal(reused.code, 0, reused.stdout); assert.equal(JSON.parse(reused.stdout).url, service.state.url);
  const prompted = await hook(other, 'two', 'user-prompt-submit'); assert.doesNotMatch(prompted.stdout, /This Session is not bound/);
  await hook(other, 'one');
  assert.equal((await call(service, '/api/session', service.state.adminToken, { sessionId: 'one', worktreeRoot: other })).data.error.code, 'SESSION_ALREADY_BOUND');
  const rebound = await call(service, '/api/session', service.state.adminToken, { sessionId: 'one', worktreeRoot: other, allowRebind: true });
  assert.equal(rebound.status, 200, JSON.stringify(rebound));
  assert.equal((await call(service, '/api/state', one)).status, 401);
  assert.notEqual(service.stores.get('session:one').doc.root.purpose, 'one-only');
});
test('private memory requires authentication, isolates Sessions, verifies merge and persists CAS receipts', async t => {
  const { dir, root, other } = await fixture(t);
  const mainSha = await git(root, 'rev-parse', 'HEAD');
  await fs.writeFile(path.join(other, 'feature.txt'), 'feature'); await git(other, 'add', 'feature.txt'); await git(other, 'commit', '-m', 'unmerged');
  const featureSha = await git(other, 'rev-parse', 'HEAD');
  const options = { dataDir: path.join(dir, 'private-memory'), adminToken: randomUUID(), projects: { example: { token: randomUUID(), root, ref: 'refs/heads/trunk' } } };
  let service = await startMemoryServer(options); t.after(() => service.close());
  const base = '/v1/projects/example/', token = options.projects.example.token;
  const memory = { map: { v: 1, project: 'example', bootstrap: 'pending', flows: [], root: null }, records: { 'sessions/one.md': 'private Session one' } };
  assert.equal((await call(service, base + 'main', '')).status, 401);
  const input = { operationId: 'save-one', baseVersion: null, baseMainVersion: null, sourceCommit: featureSha, memory };
  const saved = await call(service, base + 'sessions/one', token, input); assert.equal(saved.status, 200);
  assert.equal((await call(service, base + 'main', token)).data.snapshot, null);
  assert.equal((await call(service, base + 'sessions/two', token)).data.snapshot, null);
  const publish = { operationId: 'publish-one', baseVersion: null, sessionId: 'one', sessionVersion: saved.data.snapshot.version, expectedMainSha: mainSha };
  assert.equal((await call(service, base + 'publish', token, publish)).status, 403);
  assert.equal((await call(service, base + 'publish', options.adminToken, publish)).data.error.code, 'NOT_MERGED');
  await git(root, 'merge', '--ff-only', 'feature'); publish.expectedMainSha = featureSha;
  const published = await call(service, base + 'publish', options.adminToken, publish); assert.equal(published.status, 200, JSON.stringify(published));
  const secondMemory = { map: memory.map, records: { 'sessions/two.md': 'private Session two' } };
  const savedTwo = await call(service, base + 'sessions/two', token, { operationId: 'save-two', baseVersion: null, baseMainVersion: published.data.snapshot.version, sourceCommit: featureSha, memory: secondMemory });
  const publishedTwo = await call(service, base + 'publish', options.adminToken, { operationId: 'publish-two', baseVersion: published.data.snapshot.version, sessionId: 'two', sessionVersion: savedTwo.data.snapshot.version, expectedMainSha: featureSha });
  assert.equal(publishedTwo.status, 200, JSON.stringify(publishedTwo));
  assert.deepEqual(Object.keys(publishedTwo.data.snapshot.memory.records).sort(), ['sessions/one.md', 'sessions/two.md']);
  await service.close(); service = await startMemoryServer(options);
  assert.deepEqual((await call(service, base + 'sessions/one', token, input)).data, saved.data);
  assert.equal((await call(service, base + 'sessions/one', token, { ...input, memory: { ...memory, records: {} } })).data.error.code, 'ID_REUSED');
  const competing = await Promise.all(['a', 'b'].map(operationId => call(service, base + 'sessions/one', token, { ...input, operationId, baseVersion: saved.data.snapshot.version })));
  assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
  assert.equal((await call(service, base + 'main', token)).data.snapshot.mainSha, featureSha);
  assert.equal((await call(service, base + 'sessions/three', token, { ...input, operationId: 'private', memory: { ...memory, records: { 'private/credentials.json': 'not allowed' } } })).data.error.code, 'PRIVATE_PATH');
});
test('memory CLI lists history and restores a Session with version protection', async t => {
  const { dir, root } = await fixture(t);
  const options = { dataDir: path.join(dir, 'history-memory'), adminToken: randomUUID(), projects: { example: { token: randomUUID() } } };
  const service = await startMemoryServer(options); t.after(() => service.close());
  const token = options.projects.example.token;
  const map = title => ({ v: 1, project: 'example', bootstrap: 'ready', flows: [], root: { id: 'T0', title, kind: 'module', state: 'dirty', children: [] } });
  const first = await call(service, '/v1/projects/example/sessions/one', token, { operationId: 'cli-first', baseVersion: null, baseMainVersion: null, sourceCommit: 'a'.repeat(40), memory: { map: map('First'), records: {} } });
  const second = await call(service, '/v1/projects/example/sessions/one', token, { operationId: 'cli-second', baseVersion: first.data.snapshot.version, baseMainVersion: null, sourceCommit: 'b'.repeat(40), memory: { map: map('Second'), records: {} } });
  const invoke = (args, input) => run(process.execPath, [path.join(repo, 'scripts/workbench/cli.mjs'), ...args, '--root', root], root, input);
  const configured = await invoke(['memory', 'configure', '--input', '-'], JSON.stringify({ url: service.url, projectId: 'example', token }));
  assert.equal(configured.code, 0, configured.stderr);
  const history = await invoke(['memory', 'history', '--scope', 'session:one']);
  assert.equal(history.code, 0, history.stderr);
  assert.deepEqual(JSON.parse(history.stdout).history.map(entry => entry.version), [first.data.snapshot.version, second.data.snapshot.version]);
  const restored = await invoke(['memory', 'restore', '--input', '-'], JSON.stringify({ operationId: 'cli-restore', scope: 'session:one', baseVersion: second.data.snapshot.version, targetVersion: first.data.snapshot.version }));
  assert.equal(restored.code, 0, restored.stderr);
  assert.equal(JSON.parse(restored.stdout).snapshot.memory.map.root.title, 'First');
  const stale = await invoke(['memory', 'restore', '--input', '-'], JSON.stringify({ operationId: 'cli-stale', scope: 'session:one', baseVersion: second.data.snapshot.version, targetVersion: first.data.snapshot.version }));
  assert.notEqual(stale.code, 0); assert.match(stale.stdout, /VERSION_CONFLICT/);
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
  hooks[0] = { ...hooks[0], trustStatus: 'untrusted' };
  const rejected = summarizeHooks({ data: [{ hooks }] }, target);
  assert.equal(rejected.trusted, false); assert.deepEqual(rejected.missing, ['SessionStart']);
});
