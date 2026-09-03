import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { atomicWrite, encode, readJSON } from './io.mjs';
import { RouteStore } from './portless-routes.mjs';

const secret = () => randomBytes(32).toString('base64url');
export async function backendIdentity(route) {
  try {
    const response = await fetch(`http://127.0.0.1:${route.port}/__context_guard/health`, { signal: AbortSignal.timeout(1000), redirect: 'error' });
    const value = await response.json();
    return response.ok && value.protocol === 2 && value.instance === route.instance && value.root === route.root;
  } catch { return false; }
}
function headers(input) {
  const omitted = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', ...String(input.connection || '').toLowerCase().split(',').map(s => s.trim())]);
  return Object.fromEntries(Object.entries(input).filter(([key]) => !omitted.has(key) && !key.startsWith('x-context-guard-')));
}
export async function startNamedProxy({ dir, port = 1355 } = {}) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const routes = new RouteStore(dir), instance = secret(), adminToken = secret();
  routes.loadRoutes(); // Fail closed on corrupted persisted state, without overwriting it.
  let base;
  const sockets = new Set();
  const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host === new URL(base).host) {
        if (req.headers.origin && req.headers.origin !== base) return send(res, 403, { error: 'Origin rejected' });
        if (req.url === '/__cg_proxy/health' && req.method === 'GET') return send(res, 200, { kind: 'context-guard-named', version: 1, instance });
        if (req.headers.authorization !== `Bearer ${adminToken}`) return send(res, 401, { error: 'Local proxy capability required' });
        if (req.url === '/__cg_proxy/routes' && req.method === 'POST') {
          let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 16384) return send(res, 413, { error: 'Body too large' }); }
          const route = JSON.parse(text);
          // Validate before probing; do not let the management endpoint probe arbitrary hosts.
          const { validRoute } = await import('./portless-routes.mjs');
          if (!validRoute(route)) return send(res, 400, { error: 'Invalid route' });
          if (!await backendIdentity(route)) return send(res, 409, { error: 'Backend identity changed' });
          routes.addRoute(route);
          return send(res, 200, { registered: true });
        }
        return send(res, 404, { error: 'Unknown proxy endpoint' });
      }
      const route = routes.loadRoutes().find(r => req.headers.host === `${r.hostname}:${server.address().port}`);
      if (!route) return send(res, 404, { error: 'Unknown project hostname' });
      const origin = `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== origin) return send(res, 403, { error: 'Origin rejected' });
      if (!req.url.startsWith('/') || req.url.startsWith('//')) return send(res, 400, { error: 'Origin-form URL required' });
      if (!await backendIdentity(route)) return send(res, 502, { error: 'Project backend unavailable or replaced; run context-guard workbench again' });
      if (req.destroyed || res.destroyed) return;
      const outgoing = http.request({ hostname: '127.0.0.1', port: route.port, method: req.method, path: req.url,
        headers: { ...headers(req.headers), host: req.headers.host, 'x-context-guard-proxy': route.proxyToken } }, upstream => {
        res.writeHead(upstream.statusCode, headers(upstream.headers)); upstream.pipe(res);
        upstream.on('error', () => res.destroy());
      });
      outgoing.on('error', () => { if (!res.headersSent) send(res, 502, { error: 'Backend connection failed' }); else res.destroy(); });
      req.on('aborted', () => outgoing.destroy()); res.on('close', () => outgoing.destroy());
      req.pipe(outgoing);
    } catch { if (!res.headersSent) send(res, 409, { error: 'Route rejected or route store invalid; inspect local configuration' }); else res.destroy(); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (_req, socket) => socket.destroy()); // Workbench uses SSE, not WebSockets.
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  for (let attempt = 0; ; attempt++) {
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port ? port + attempt : 0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); }); break; }
    catch (e) { server.removeAllListeners('error'); if (e.code !== 'EADDRINUSE' || !port || attempt >= 20) throw e; }
  }
  base = `http://127.0.0.1:${server.address().port}`;
  const state = { version: 1, instance, pid: process.pid, base, adminToken };
  const stateFile = path.join(dir, 'proxy.json');
  try { await atomicWrite(stateFile, encode(state)); } catch (e) { server.close(); throw e; }
  let closing;
  const close = () => closing ||= (async () => {
    const stopped = new Promise(resolve => server.close(resolve));
    for (const socket of sockets) socket.destroy(); await stopped;
    if ((await readJSON(stateFile, null))?.instance === instance) await fs.unlink(stateFile);
  })();
  return { state, server, close };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const running = await startNamedProxy({ dir: process.argv[2], port: Number(process.argv[3] || 1355) });
    process.on('SIGTERM', () => running.close()); process.on('SIGINT', () => running.close());
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
