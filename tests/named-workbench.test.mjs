import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { startServer } from '../scripts/workbench/server.mjs';
import { ensureServer, stopServer, request } from '../scripts/workbench/cli.mjs';
import { startNamedProxy } from '../scripts/workbench/named-proxy.mjs';
import { namedWorkbench, ensureNamedProxy } from '../scripts/workbench/named.mjs';
import { bindProject, resolveProjectRoot, projectName } from '../scripts/workbench/project.mjs';
import { RouteStore } from '../scripts/workbench/portless-routes.mjs';

const cwd = process.cwd();
const fixtureRoots = [];
after(async () => { for (const root of fixtureRoots) await fs.rm(root, { recursive: true, force: true }); });
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
test('named HTTP entry preserves authentication, Origin/Host checks, session registration and writes', async t => {
  const { backend, named, dir, proxy } = await environment(t), origin = new URL(named.url).origin;
  assert.match(named.url, /example-project.localhost/);
  assert.equal((await call(named.url, '/prototype/workbench.html')).status, 200);
  assert.equal((await call(named.url, '/api/state')).status, 401);
  assert.equal((await call(named.url, '/__context_guard/bootstrap', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call(named.url, '/__context_guard/bootstrap', { headers: { Host: `unknown.localhost:${new URL(named.url).port}` } })).status, 404);
  assert.equal((await call(backend.state.url, '/__context_guard/bootstrap', { headers: { Host: new URL(named.url).host } })).status, 403);
  const boot = await call(named.url, '/__context_guard/bootstrap');
  const auth = { Authorization: `Bearer ${boot.data.token}`, Origin: origin, 'Content-Type': 'application/json' };
  const before = await call(named.url, '/api/state', { headers: auth });
  assert.equal(before.status, 200);
  const saved = await call(named.url, '/api/commit', { method: 'POST', headers: auth, body: { baseVersion: before.data.version, operationId: 'named-write', operations: [{ type: 'update', id: 'T0', fields: { title: 'Saved through named entry' } }] } });
  assert.equal(saved.status, 200);
  assert.equal((await call(named.url, '/api/state', { headers: auth })).data.doc.root.title, 'Saved through named entry');
  for (let i = 0; i < 5; i++) assert.ok((await request(backend.state, '/api/session', { method: 'POST', body: { sessionId: `test-${i}` } })).token);
  const actor = await request(backend.state, '/api/session', { method: 'POST', body: { sessionId: 'test-0' } });
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
test('corrupt routes fail closed without overwriting data, and names normalize deterministically', async t => {
  const root = await fixture(t), store = new RouteStore(root), file = path.join(root, 'routes.json');
  await fs.writeFile(file, 'not-json'); assert.throws(() => store.loadRoutes());
  await assert.rejects(startNamedProxy({ dir: root, port: 0 }));
  assert.equal(await fs.readFile(file, 'utf8'), 'not-json');
  assert.equal(projectName('Context_Guard', root), 'context-guard');
  assert.match(projectName('中文', root), /^project-[a-f0-9]{12}$/);
});
test('concurrent separate launchers reuse one daemon without replacing an occupied service', async t => {
  const root = await fixture(t), dir = path.join(root, 'global');
  const occupied = http.createServer((_q, r) => r.end('unrelated')); await new Promise(r => occupied.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => occupied.close(r)));
  const port = occupied.address().port;
  const code = `import {ensureNamedProxy} from ${JSON.stringify(new URL('../scripts/workbench/named.mjs', import.meta.url).href)}; console.log(JSON.stringify(await ensureNamedProxy({dir:process.argv[1],port:Number(process.argv[2])})));`;
  const states = await Promise.all(Array.from({ length: 5 }, () => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code, dir, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = ''; p.stdout.on('data', d => output += d); p.stderr.on('data', d => error += d); p.on('error', reject); p.on('exit', c => c === 0 ? resolve(JSON.parse(output)) : reject(new Error(error)));
  }))).catch(async error => {
    // Synthetic fixture diagnostics only; never publish proxy capabilities.
    const log = await fs.readFile(path.join(dir, 'proxy.log'), 'utf8').catch(() => '');
    const codes = [...new Set(log.match(/\bE[A-Z]{3,}\b/g) || [])];
    throw new Error(`${error.message}; daemon error codes: ${codes.join(',') || 'none'}`);
  });
  assert.equal(new Set(states.map(s => s.instance)).size, 1);
  assert.notEqual(Number(new URL(states[0].base).port), port);
  t.after(async () => {
    const stopped = await call(states[0].base, '/__cg_proxy/stop', { method: 'POST', headers: { Authorization: `Bearer ${states[0].adminToken}` } });
    assert.equal(stopped.status, 202);
    for (let i = 0; i < 100; i++) { try { await fs.access(path.join(dir, 'proxy.json')); } catch { return; } await new Promise(r => setTimeout(r, 20)); }
    throw new Error('Proxy did not stop');
  });
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
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'fixture');
  git('worktree', 'add', '--detach', source, 'HEAD');
  await assert.rejects(bindProject(source, foreign));
  await fs.mkdir(path.join(source, '.codex/context'), { recursive: true });
  const mapFile = path.join(source, '.codex/context/map.json'); await fs.writeFile(mapFile, '{"local":"preserved"}');
  await assert.rejects(bindProject(source, root), /Local Map/);
  await bindProject(source, root, { keepLocal: true });
  assert.equal(await resolveProjectRoot(source), root);
  assert.equal(await fs.readFile(mapFile, 'utf8'), '{"local":"preserved"}');
  const cloud = spawnSync(process.execPath, [path.join(cwd, 'scripts/sync/client.mjs'), 'status', '--root', source], { encoding: 'utf8' });
  assert.equal(cloud.status, 1); assert.match(cloud.stdout, /BOUND_SYNC_UNSUPPORTED/);
  const results = await Promise.all([ensureServer(root, 0), ensureServer(source, 0)]); t.after(() => stopServer(root));
  assert.equal(results[0].instance, results[1].instance);
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const hook = path.join(cwd, 'scripts/context_guard_hook.py');
  const child = spawn(python, [hook, 'session-start', '--platform', 'codex'], { cwd: source, env: { ...process.env, CONTEXT_GUARD_DISABLE_WORKBENCH: '1', CODEX_THREAD_ID: 'bound-test' }, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.resume(); let err = ''; child.stderr.on('data', d => err += d); child.stdin.end(JSON.stringify({ cwd: source, session_id: 'bound-test' }));
  const [exit] = await once(child, 'exit'); assert.equal(exit, 0, err);
  assert.match(await fs.readFile(path.join(root, '.codex/context/sessions.jsonl'), 'utf8'), /bound-test/);
  assert.equal(await fs.readFile(mapFile, 'utf8'), '{"local":"preserved"}');
});
test('real SessionStart injects named URL and automatic browser opener is claimed only once', async t => {
  const root = await fixture(t, 'Hook Project'), dir = path.join(root, 'proxy');
  execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
  const proxy = await startNamedProxy({ dir, port: 0 }); t.after(() => proxy.close());
  t.after(() => stopServer(root));
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const env = { ...process.env, CONTEXT_GUARD_NAMED_STATE_DIR: dir, CONTEXT_GUARD_NAMED_WORKBENCH: '1', CONTEXT_GUARD_DISABLE_WORKBENCH: '0', CONTEXT_GUARD_HEADLESS: '1' };
  const run = (args, input = '') => new Promise((resolve, reject) => {
    const child = spawn(python, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d); child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr))); child.stdin.end(input);
  });
  const hook = await run([path.join(cwd, 'scripts/context_guard_hook.py'), 'session-start', '--platform', 'codex'], JSON.stringify({ cwd: root, session_id: 'named-hook' }));
  assert.match(hook.stdout + hook.stderr, /http:\/\/hook-project\.localhost:\d+\/prototype\/workbench.html/);
  // Use a spy, not the user's browser, but exercise the real Python opener path.
  const code = `import sys,os,json; sys.path.insert(0,${JSON.stringify(path.join(cwd, 'scripts'))}); import context_guard as c; from pathlib import Path; os.environ.pop('CI',None); os.environ.pop('CONTEXT_GUARD_HEADLESS',None); calls=[]; c.webbrowser.open=lambda *a,**k:calls.append(a[0]); c.start_workbench(Path.cwd()); c.start_workbench(Path.cwd()); print(json.dumps(calls))`;
  const opened = await run(['-c', code]); assert.equal(JSON.parse(opened.stdout).length, 1);
});
