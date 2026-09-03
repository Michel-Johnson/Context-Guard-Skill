import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { readJSON, pause } from './io.mjs';
import { projectId, projectName } from './project.mjs';

export const namedDirectory = () => path.resolve(process.env.CONTEXT_GUARD_NAMED_STATE_DIR || path.join(os.homedir(), '.context-guard/named-workbench'));
function alive(pid) { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } }
async function proxyHealth(state) {
  if (!state || state.version !== 1 || !/^http:\/\/127\.0\.0\.1:\d+$/.test(state.base) || !state.adminToken) return false;
  try { const res = await fetch(state.base + '/__cg_proxy/health', { signal: AbortSignal.timeout(700), redirect: 'error' }); const value = await res.json(); return res.ok && value.kind === 'context-guard-named' && value.instance === state.instance; } catch { return false; }
}
export async function ensureNamedProxy({ dir = namedDirectory(), port = Number(process.env.CONTEXT_GUARD_NAMED_PORT || 1355) } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65515) throw new Error('Invalid named proxy port');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'proxy.json'), lock = path.join(dir, 'startup.lock');
  const identity = randomUUID(), deadline = Date.now() + 15000;
  let held = false;
  while (!held) {
    const state = await readJSON(file, null);
    if (await proxyHealth(state)) return state;
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
    if (await proxyHealth(state)) return state;
    if (state && alive(state.pid)) throw new Error('Existing proxy process is not healthy; inspect it before restarting');
    const log = await fs.open(path.join(dir, 'proxy.log'), 'a', 0o600);
    const child = spawn(process.execPath, [fileURLToPath(new URL('./named-proxy.mjs', import.meta.url)), dir, String(port)], { detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
    child.unref(); await log.close();
    while (Date.now() < deadline) { await pause(60); state = await readJSON(file, null); if (await proxyHealth(state)) return state; }
    throw new Error('Named proxy failed to start; inspect its private proxy.log');
  } finally { if ((await readJSON(lock, null))?.identity === identity) await fs.unlink(lock); }
}
export async function namedWorkbench(state, request, { name, dir, port } = {}) {
  const saved = await readJSON(path.join(state.root, '.codex/context/private/named-entry.json'), null);
  const doc = await readJSON(path.join(state.root, '.codex/context/map.json'), {});
  const chosen = name || saved?.name || projectName(doc.project || path.basename(state.root), state.root);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(chosen)) throw new Error('Use a lowercase DNS name (letters, digits, hyphens; 1–63 characters)');
  const capabilities = await fetch(new URL('/__context_guard/health', state.url), { signal: AbortSignal.timeout(1000) }).then(r => r.json());
  if (!capabilities.namedEntry) throw new Error('The running workbench needs an upgrade for named URLs. Use --direct, or stop it explicitly after saving drafts; it was not restarted');
  const proxy = await ensureNamedProxy({ dir, port });
  const hostname = `${chosen}.localhost`, origin = `http://${hostname}:${new URL(proxy.base).port}`;
  // Stable, domain-separated capability for concurrent first registration.
  const proxyToken = saved?.proxyToken || createHash('sha256').update(`named-forwarding:${state.adminToken}`).digest('base64url');
  const route = { hostname, root: state.root, projectId: projectId(state.root), instance: state.instance, port: Number(new URL(state.url).port), proxyToken };
  const response = await fetch(proxy.base + '/__cg_proxy/routes', { method: 'POST', headers: { Authorization: `Bearer ${proxy.adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(route), signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error('Project name registration failed; name may belong to another project');
  // Claim the name before changing the backend's accepted origin. A collision
  // must not break the project's previously working URL.
  await request(state, '/api/named-entry', { method: 'POST', body: { origin, name: chosen, proxyToken } });
  return { url: origin + '/prototype/workbench.html', projectRoot: state.root, proxyPort: Number(new URL(proxy.base).port) };
}
