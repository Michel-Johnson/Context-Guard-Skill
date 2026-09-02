import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { MapStore } from './store.mjs';
import { Access, token } from './access.mjs';
import { atomicWrite, encode, readJSON, pause, hash } from './io.mjs';
import { generateProjections } from './projections.mjs';
import { MapError, entries, validate, diffTrees } from '../../prototype/map-model.mjs';
export const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const statePath = root => path.join(root, '.codex/context/private/workbench.json');
export async function health(state) {
  try { const res = await fetch(new URL('/__context_guard/health', state.url), { signal: AbortSignal.timeout(600) }); return res.ok ? await res.json() : null; } catch { return null; }
}
export async function startServer({ root, port = 8877, host = '127.0.0.1', fault } = {}) {
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new MapError('INVALID_HOST', 'Workbench only listens on loopback');
  root = await fs.realpath(path.resolve(root));
  const ctx = path.join(root, '.codex/context'), lock = path.join(ctx, 'private/node-workbench.lock');
  await fs.mkdir(path.dirname(lock), { recursive: true });
  const instance = token();
  for (let i = 0; i < 2; i++) {
    try { const h = await fs.open(lock, 'wx', 0o600); await h.writeFile(encode({ pid: process.pid, instance })); await h.close(); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const owner = await readJSON(lock, null);
      if (!owner?.pid) throw new MapError('STARTING', 'Another instance is starting; retry shortly', 409);
      let alive = true; try { process.kill(owner.pid, 0); } catch (err) { if (err.code === 'ESRCH') alive = false; }
      if (alive) throw new MapError('ALREADY_RUNNING', 'Project already has a Node service', 409);
      await fs.unlink(lock);
    }
  }
  const adminToken = token(), humanToken = token(), agentTokens = new Map(), peers = new Map();
  const access = await new Access(root).init();
  let projectionQueue = Promise.resolve();
  const store = new MapStore(root, { fault, project: (doc, version) => {
    const job = projectionQueue.then(() => store.version === version ? generateProjections(root, doc, version, () => store.version === version) : false);
    projectionQueue = job.catch(() => {}); return job;
  } });
  let server, base;
  const send = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
  function broadcast(type, data) {
    for (const peer of peers.values()) if (peer.res && !peer.res.destroyed) {
      if (peer.res.writableLength > 2 * 1024 * 1024) { peer.res.destroy(); continue; }
      peer.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }
  function pendingPeers() { return [...peers.values()].filter(p => p.dirty || !p.res || p.res.destroyed).map(p => p.id); }
  async function fence() {
    const checkpoint = randomUUID();
    broadcast('checkpoint', { checkpoint });
    const deadline = Date.now() + 1200;
    while ([...peers.values()].some(p => p.checkpoint !== checkpoint)) {
      if (Date.now() >= deadline) throw new MapError('UI_PENDING', 'A page has not acknowledged the synchronization checkpoint', 409, { peers: pendingPeers() });
      await pause(15);
    }
    if (pendingPeers().length) throw new MapError('UI_PENDING', 'A page has unsaved edits', 409, { peers: pendingPeers() });
  }
  async function body(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new MapError('CONTENT_TYPE', 'Use application/json', 415);
    let size = 0, chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new MapError('BODY_TOO_LARGE', 'Request exceeds 16 MiB', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks)); } catch { throw new MapError('INVALID_JSON', 'Malformed JSON'); }
  }
  function auth(req, url) {
    const credential = req.headers.authorization?.replace(/^Bearer /, '') || (url.pathname === '/api/events' ? url.searchParams.get('token') : null);
    if (credential === humanToken) return { kind: 'human', sessionId: 'workbench' };
    const actor = agentTokens.get(credential);
    if (!actor) throw new MapError('UNAUTHORIZED', 'Missing or expired capability', 401);
    return actor;
  }
  const isHuman = actor => { if (actor.kind !== 'human') throw new MapError('FORBIDDEN', 'Requires the workbench capability', 403); };
  try {
    await store.init();
    server = http.createServer(async (req, res) => {
      try {
        if (req.headers.host !== new URL(base).host) throw new MapError('HOST_REJECTED', 'Invalid Host', 403);
        if (req.headers.origin && req.headers.origin !== base) throw new MapError('ORIGIN_REJECTED', 'Cross-origin requests are not allowed', 403);
        const url = new URL(req.url, base), route = url.pathname;
        if (route === '/__context_guard/health' && req.method === 'GET') return send(res, 200, { ok: true, root, pid: process.pid, protocol: 2, instance, recovery: store.blocked, rss: process.memoryUsage().rss });
        if (route === '/__context_guard/bootstrap' && req.method === 'GET') return send(res, 200, { token: humanToken, root, protocol: 2 });
        if (route === '/api/session' && req.method === 'POST') {
          if (req.headers.authorization !== `Bearer ${adminToken}`) throw new MapError('UNAUTHORIZED', 'Requires local CLI credential', 401);
          const input = await body(req), actor = await access.register(input.sessionId), credential = token(); agentTokens.set(credential, actor);
          return send(res, 200, { token: credential, actor });
        }
        if (route === '/api/stop' && req.method === 'POST') {
          if (req.headers.authorization !== `Bearer ${adminToken}`) throw new MapError('UNAUTHORIZED', 'Requires local CLI credential', 401);
          await fence(); send(res, 202, { stopping: true }); setImmediate(() => close()); return;
        }
        if (route.startsWith('/api/')) {
          const actor = auth(req, url);
          if (route === '/api/events' && req.method === 'GET') {
            isHuman(actor); const id = url.searchParams.get('clientId');
            if (!id || id.length > 100) throw new MapError('INVALID_CLIENT', 'Invalid clientId');
            let peer = peers.get(id) || { id, dirty: false, version: null };
            peer.res?.end(); peer.res = res; peers.set(id, peer);
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
            res.write(`retry: 500\nevent: state\ndata: ${JSON.stringify(store.state(false))}\n\n`);
            req.on('close', () => { if (peer.res === res) peer.res = null; }); return;
          }
          if (route === '/api/presence' && req.method === 'POST') {
            isHuman(actor); const input = await body(req), peer = peers.get(input.clientId);
            if (peer) { peer.dirty = !!input.dirty; peer.version = input.version; peer.checkpoint = input.checkpoint; if (input.closing && !peer.dirty) { peer.res?.end(); peers.delete(input.clientId); } }
            return send(res, 200, { version: store.version, synchronized: input.version === store.version && !input.dirty && !store.error && !store.blocked, error: store.error, recovery: store.blocked });
          }
          if (route === '/api/state' && req.method === 'GET') {
            if (actor.kind === 'agent') await fence();
            await store.serial(() => store.refresh());
            const state = store.state();
            if (url.searchParams.has('node')) { const entry = state.doc && entries(state.doc.root).get(url.searchParams.get('node')); if (!entry) throw new MapError('NOT_FOUND', 'Node missing', 404); delete state.doc; state.node = entry.node; state.parentId = entry.parent?.id || null; }
            return send(res, 200, { ...state, actor, grants: access.grants(actor.sessionId), peers: [...peers.values()].map(({ id, dirty, version }) => ({ id, dirty, version })) });
          }
          if (route === '/api/changes' && req.method === 'GET') { await store.serial(() => store.refresh()); return send(res, 200, store.changes(url.searchParams.get('cursor'))); }
          if (route === '/api/operation' && req.method === 'GET') { const record = await store.operation(url.searchParams.get('id') || ''); return send(res, 200, { found: !!record, result: record?.result, recovery: store.blocked }); }
          if (route === '/api/commit' && req.method === 'POST') {
            const input = await body(req);
            if (actor.kind === 'agent') await fence();
            const result = await store.commit(input, actor, () => access.grants(actor.sessionId), async () => { if (actor.kind === 'agent' && pendingPeers().length) throw new MapError('UI_PENDING', 'Page edits are still pending', 409); });
            return send(res, 200, result);
          }
          if (route === '/api/access' && req.method === 'GET') { isHuman(actor); return send(res, 200, { sessions: await access.knownSessions(), grants: access.data.sessions }); }
          if (route === '/api/access' && req.method === 'POST') {
            isHuman(actor); const input = await body(req);
            await store.serial(async () => {
              await store.refresh(); const ids = entries(store.doc.root);
              if (!Array.isArray(input.nodes) || input.nodes.some(id => !ids.has(id))) throw new MapError('INVALID_SCOPE', 'Unknown node in scope');
              await access.grant(input.sessionId, input.nodes, store.version);
              await store.recordEvent({ operationId: randomUUID(), fromVersion: store.version, version: store.version, actor, actions: ['grant'], nodeIds: input.nodes, sessionId: input.sessionId });
            });
            broadcast('access', {}); return send(res, 200, { saved: true });
          }
          if (route === '/api/migration-preview' && req.method === 'POST') {
            isHuman(actor); const input = await body(req); validate(input.doc);
            if (input.doc.project !== store.doc.project) throw new MapError('PROJECT_MISMATCH', 'Cache belongs to a different project');
            await store.serial(() => store.refresh());
            const backup = path.join(store.runtime, 'migration-' + hash(encode(input.doc)) + '.json');
            await atomicWrite(backup, encode({ imported: input.doc, disk: store.doc, baseVersion: store.version }));
            return send(res, 200, { baseVersion: store.version, operations: diffTrees(store.doc.root, input.doc.root), backup, warning: 'Review every replacement and deletion; timestamps do not resolve conflicts.' });
          }
          if (route === '/api/projections' && req.method === 'POST') {
            const input = await body(req); await store.serial(() => store.refresh());
            if (input.wait) {
              const version = store.version;
              const ready = await store.project(store.doc, version);
              if (!ready) throw new MapError('VERSION_CONFLICT', 'Map changed during index generation', 409);
              store.projection = { status: 'ready', sourceVersion: version };
              return send(res, 200, store.projection);
            }
            store.scheduleProjection(); return send(res, 202, { status: 'pending' });
          }
          throw new MapError('NOT_FOUND', 'Unknown API route', 404);
        }
        if (req.method !== 'GET') throw new MapError('METHOD', 'GET required', 405);
        let file, contentType;
        if (route === '/' || route === '/prototype/workbench.html') {
          const html = await fs.readFile(path.join(skillRoot, 'prototype/workbench.html'), 'utf8');
          const boot = JSON.stringify({ token: humanToken, root, protocol: 2 }).replace(/</g, '\\u003c');
          const nonce = token();
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': `default-src 'self'; script-src 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` });
          return res.end(html.replace('<!-- CG_SERVER_BOOT -->', `<script>window.__CG_SERVER=${boot};</script>`).replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`));
        }
        if (['/prototype/map-model.mjs', '/prototype/workbench-sync.mjs'].includes(route)) { file = path.join(skillRoot, route.slice(1)); contentType = 'text/javascript; charset=utf-8'; }
        else if (['/.codex/context/map.json', '/.codex/context/preferences.json', '/.codex/context/candidates.json', '/.codex/context/l1-candidates.json'].includes(route)) { file = path.join(root, route.slice(1)); contentType = 'application/json; charset=utf-8'; }
        else throw new MapError('NOT_FOUND', 'File not exposed', 404);
        const content = await fs.readFile(file); res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(content);
      } catch (e) {
        if (!res.headersSent) send(res, e.status || (e.code === 'ENOENT' ? 404 : 500), { error: { code: e.code || 'INTERNAL_ERROR', message: e.message, ...e.details } });
        else res.end();
      }
    });
    server.requestTimeout = 10000; server.headersTimeout = 10000;
    for (let attempt = 0; ; attempt++) {
      try { await new Promise((resolve, reject) => { const onError = e => reject(e); server.once('error', onError); server.listen(port === 0 ? 0 : port + attempt, '127.0.0.1', () => { server.off('error', onError); resolve(); }); }); break; }
      catch (e) { if (e.code !== 'EADDRINUSE' || attempt >= 20 || port === 0) throw e; }
    }
    base = `http://127.0.0.1:${server.address().port}`;
    const state = { protocol: 2, root, pid: process.pid, instance, url: base + '/prototype/workbench.html', adminToken };
    await atomicWrite(statePath(root), encode(state));
    store.on('change', state => broadcast('state', state));
    const heartbeat = setInterval(() => broadcast('ping', {}), 10000); heartbeat.unref();
    function close() {
      if (close.promise) return close.promise;
      close.promise = (async () => {
        clearInterval(heartbeat);
        // Stop accepting reconnects before draining events or slow projections.
        const disconnected = new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
        });
        for (const p of peers.values()) p.res?.end();
        // Node 18 does not reap idle keep-alive sockets in server.close().
        server.closeIdleConnections?.();
        await disconnected;
        await store.close(); await projectionQueue;
        if ((await readJSON(statePath(root), null))?.instance === instance) await fs.unlink(statePath(root));
        if ((await readJSON(lock, null))?.instance === instance) await fs.unlink(lock);
      })();
      return close.promise;
    }
    // Handler needs the shutdown closure after initialization.
    server.cgClose = close;
    return { state, store, access, server, close, humanToken };
  } catch (e) { await store.close(); server?.close(); if ((await readJSON(lock, null))?.instance === instance) await fs.unlink(lock); throw e; }
}
