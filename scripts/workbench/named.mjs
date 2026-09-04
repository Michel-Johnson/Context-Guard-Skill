import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { readJSON, pause } from './io.mjs';
import { projectId, projectName, resolveProject } from './project.mjs';
import { compatibleRuntime, WORKBENCH_RUNTIME_SCHEMA } from './runtime.mjs';
import { globalWorkbenchDirectory, registeredProject, rememberProject } from './registry.mjs';
import { RouteStore } from './portless-routes.mjs';

export const namedDirectory = globalWorkbenchDirectory;
const PROXY_RUNTIME_SCHEMA = 2;
function alive(pid) { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } }
async function proxyProbe(state) {
  if (!state || state.version !== 1 || !/^http:\/\/127\.0\.0\.1:\d+$/.test(state.base) || !state.adminToken) return false;
  try { const res = await fetch(state.base + '/__cg_proxy/health', { signal: AbortSignal.timeout(700), redirect: 'error' }); const value = await res.json(); return res.ok && value.kind === 'context-guard-named' && value.instance === state.instance ? value : null; } catch { return null; }
}
const compatibleProxy = value => value?.runtimeSchema === PROXY_RUNTIME_SCHEMA && value.capabilities?.includes('project-key-routes');
function stopProxy(state) {
  return new Promise((resolve, reject) => {
    const target = new URL('/__cg_proxy/stop', state.base);
    const req = http.request(target, { method: 'POST', agent: false, headers: { Authorization: `Bearer ${state.adminToken}`, Connection: 'close' } }, res => {
      res.resume(); res.on('end', () => res.statusCode === 202 ? resolve() : reject(new Error(`Proxy upgrade rejected with HTTP ${res.statusCode}`)));
    });
    req.setTimeout(1500, () => req.destroy(new Error('Proxy upgrade timed out')));
    req.on('error', reject); req.end();
  });
}
export async function ensureNamedProxy({ dir = namedDirectory(), port = Number(process.env.CONTEXT_GUARD_NAMED_PORT || 1355) } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65515) throw new Error('Invalid named proxy port');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'proxy.json'), lock = path.join(dir, 'startup.lock');
  const identity = randomUUID(), deadline = Date.now() + 15000;
  let held = false;
  while (!held) {
    const state = await readJSON(file, null);
    if (compatibleProxy(await proxyProbe(state))) return state;
    if (Date.now() > deadline) throw new Error('Named proxy startup busy; no process was replaced');
    try { const h = await fs.open(lock, 'wx', 0o600); try { await h.writeFile(JSON.stringify({ pid: process.pid, identity })); } finally { await h.close(); } held = true; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const owner = await readJSON(lock, null).catch(() => null);
      if (owner?.pid && !alive(owner.pid)) {
        // Serialize stale-lock reclamation: a second waiter must not unlink a
        // new live owner's lock after the first waiter has already reclaimed it.
        const reap = lock + '.reap';
        try {
          await fs.mkdir(reap);
          try { const current = await readJSON(lock, null).catch(() => null); if (current?.pid && !alive(current.pid)) await fs.unlink(lock).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
          finally { await fs.rmdir(reap); }
        } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(50); }
      }
      else await pause(50);
    }
  }
  try {
    let state = await readJSON(file, null);
    let probe = await proxyProbe(state);
    if (compatibleProxy(probe)) return state;
    if (probe && state?.adminToken && alive(state.pid)) {
      await stopProxy(state);
      while (Date.now() < deadline && alive(state.pid) && (await readJSON(file, null))?.instance === state.instance) await pause(25);
      if (alive(state.pid) && (await readJSON(file, null))?.instance === state.instance) throw new Error('Older named proxy did not stop safely; no replacement was started');
      state = await readJSON(file, null);
      probe = await proxyProbe(state);
      if (compatibleProxy(probe)) return state;
    }
    if (state && alive(state.pid)) throw new Error('Existing proxy process is not healthy; inspect it before restarting');
    const log = await fs.open(path.join(dir, 'proxy.log'), 'a', 0o600);
    const child = spawn(process.execPath, [fileURLToPath(new URL('./named-proxy.mjs', import.meta.url)), dir, String(port)], { detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
    child.unref(); await log.close();
    while (Date.now() < deadline) { await pause(60); state = await readJSON(file, null); if (compatibleProxy(await proxyProbe(state))) return state; }
    throw new Error('Named proxy failed to start; inspect its private proxy.log');
  } finally { if ((await readJSON(lock, null))?.identity === identity) await fs.unlink(lock); }
}
export async function namedWorkbench(state, request, { name, dir, port } = {}) {
  const project = await resolveProject(state.root);
  const registryDir = dir || namedDirectory();
  const registered = await registeredProject(project, { dir: registryDir });
  const saved = await readJSON(project.kind === 'git' ? path.join(project.sharedDir, 'named-entry.json') : path.join(state.root, '.codex/context/private/named-entry.json'), null);
  const doc = await readJSON(path.join(state.root, '.codex/context/map.json'), {});
  const chosen = name || saved?.name || registered?.name || projectName(doc.project || path.basename(state.root), state.root);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(chosen)) throw new Error('Use a lowercase DNS name (letters, digits, hyphens; 1–63 characters)');
  const capabilities = await fetch(new URL('/__context_guard/health', state.url), { signal: AbortSignal.timeout(1000) }).then(r => r.json());
  if (!capabilities.namedEntry || !compatibleRuntime(capabilities)) throw new Error('The running workbench needs an upgrade for verified named URLs. Save drafts and use the explicit migration flow; it was not restarted');
  const proxy = await ensureNamedProxy({ dir: registryDir, port });
  const hostname = `${chosen}.localhost`, origin = `http://${hostname}:${new URL(proxy.base).port}`;
  // Stable, domain-separated capability for concurrent first registration.
  const proxyToken = saved?.proxyToken || createHash('sha256').update(`named-forwarding:${state.adminToken}`).digest('base64url');
  const identityRoot = capabilities.namedRoot || state.root;
  const route = { hostname, root: identityRoot, projectId: projectId(identityRoot), projectKey: project.projectId, instance: state.instance, runtimeSchema: WORKBENCH_RUNTIME_SCHEMA, port: Number(new URL(state.url).port), proxyToken };
  const previous = new RouteStore(registryDir).loadRoutes().find(item => item.hostname === hostname) || null;
  let replace = null;
  if (previous && (previous.root !== route.root || previous.projectId !== route.projectId)) {
    const knownRoot = registered?.roots?.includes(previous.root);
    const sameGitProject = await resolveProject(previous.root).then(item => item.projectId === project.projectId).catch(() => false);
    if (previous.projectKey === project.projectId || knownRoot || sameGitProject) {
      replace = { hostname: previous.hostname, root: previous.root, projectId: previous.projectId, instance: previous.instance };
    }
  }
  const response = await fetch(proxy.base + '/__cg_proxy/routes', { method: 'POST', headers: { Authorization: `Bearer ${proxy.adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...route, ...(replace ? { replace } : {}) }), signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error('Project name registration failed; name may belong to another project');
  // Claim the name before changing the backend's accepted origin. A collision
  // must not break the project's previously working URL.
  await request(state, '/api/named-entry', { method: 'POST', body: { origin, name: chosen, proxyToken } });
  const result = { url: origin + '/prototype/workbench.html', projectRoot: state.root, proxyPort: Number(new URL(proxy.base).port) };
  await verifyWorkbenchUrl(result.url, { projectId: state.projectId, instance: state.instance });
  await rememberProject(project, { dir: registryDir, name: chosen, origin, state: { ...state, ...capabilities } });
  return result;
}

export async function readWorkbenchHealth(url) {
  let response, value;
  try {
    const target = new URL('/__context_guard/health', url);
    // Node 18 delegates *.localhost to DNS on some platforms even though the
    // browser-facing name is required to resolve to loopback. Probe the local
    // proxy directly while preserving its host-based project routing.
    if (target.protocol === 'http:' && target.hostname.endsWith('.localhost')) {
      const result = await new Promise((resolve, reject) => {
        const request = http.get({ hostname: '127.0.0.1', port: target.port, path: target.pathname + target.search, headers: { host: target.host } }, incoming => {
          let text = '';
          incoming.on('data', chunk => text += chunk);
          incoming.on('end', () => {
            try { resolve({ ok: incoming.statusCode >= 200 && incoming.statusCode < 300, value: JSON.parse(text) }); }
            catch (error) { reject(error); }
          });
        });
        request.setTimeout(1500, () => request.destroy(new Error('timeout')));
        request.on('error', reject);
      });
      response = result;
      value = result.value;
    } else {
      response = await fetch(target, { signal: AbortSignal.timeout(1500), redirect: 'error' });
      value = await response.json();
    }
  } catch (cause) {
    throw new Error(`Workbench URL verification failed: ${cause.message}`);
  }
  return { response, value };
}

export async function verifyWorkbenchUrl(url, expected) {
  const { response, value } = await readWorkbenchHealth(url);
  if (!response.ok || !compatibleRuntime(value) || value.projectId !== expected.projectId || value.instance !== expected.instance) {
    throw new Error('Workbench URL resolves to a different project, instance, or runtime');
  }
  return value;
}
