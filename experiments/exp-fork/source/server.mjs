import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { startCloudServer } from '../../scripts/cloud/server.mjs';
import { Source, fault } from './source.mjs';
import { Experiment } from './engine.mjs';
import { codexMap } from './map.mjs';
import { createLearningMapTools } from './map-tools.mjs';
import { createWebSearch } from './web-search.mjs';
import { atomicWrite, readJSON } from './history.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const phase = process.argv[3] || 'study';
if (!['study', 'calibration'].includes(phase)) throw new Error('Invalid phase');
if (process.argv[4] && (phase !== 'calibration' || !/^[a-zA-Z0-9-]+$/.test(process.argv[4]))) throw new Error('Invalid calibration directory');
const dataDir = path.join(here, phase === 'study' ? 'data' : process.argv[4] || 'calibration-data');
const sourceRoot = path.join(root, 'temp/codex-learning-source');
const credentials = await readJSON(path.join(root, 'temp/local-coordinator-data/local-config.json'));
const provider = await readJSON(path.join(root, 'temp/local-coordinator-data/provider.json'));
const pinFile = path.join(here, 'pin.json');
let pin = await readJSON(pinFile, null);
if (!pin) {
  pin = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8', windowsHide: true }).trim(), pinnedAt: new Date().toISOString() };
  await atomicWrite(pinFile, JSON.stringify(pin, null, 2));
}
const map = codexMap(pin.commit);
const source = await new Source({ root: sourceRoot, commit: pin.commit, map }).init();
const check = node => { for (const file of node.files) if (!source.files.has(file)) throw new Error(`Map references missing source: ${file}`); node.children.forEach(check); };
check(map.root);
let backend;
const mapTools = createLearningMapTools(async (route, input) => {
  if (!backend) throw fault('STARTING', 'Map backend is starting');
  const response = await fetch(backend.url + '/api/projects/codex-learning' + route, {
    method: input === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${credentials.adminToken}`, 'Content-Type': 'application/json' },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw fault(result.error?.code || 'MAP_FAILED', result.error?.message || 'Map request failed');
  return result;
}, { directory: path.join(dataDir, 'map-operations') });
const webSearch = createWebSearch({ token: provider.token });
const experiment = await new Experiment({ directory: path.join(dataDir, phase), source, provider, phase, mapTools, webSearch }).init();
await atomicWrite(path.join(dataDir, 'map.json'), JSON.stringify(map, null, 2));
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const authorized = req => {
  const cookie = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('cg_workbench='))?.slice(13);
  let credential = req.headers.authorization?.replace(/^Bearer /, '') || cookie || '';
  try { credential = decodeURIComponent(credential); } catch { return false; }
  return equal(credential, credentials.browserToken) || equal(credential, credentials.adminToken);
};
const send = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
const body = async req => {
  let text = ''; for await (const part of req) { text += part; if (Buffer.byteLength(text) > 40000) throw fault('TOO_LARGE', 'Request too large'); }
  try { return JSON.parse(text); } catch { throw fault('INVALID_JSON', 'Invalid JSON'); }
};
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const server = http.createServer(async (req, res) => {
  const receivedAt = Date.now();
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/experiment/')) {
      if (!authorized(req)) return send(res, 401, { error: 'UNAUTHORIZED' });
      if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== publicUrl) return send(res, 403, { error: 'INVALID_ORIGIN' });
      if (req.method === 'GET' && ['/experiment/ui.js', '/experiment/ui.css'].includes(url.pathname)) {
        res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(await fs.readFile(path.join(here, url.pathname.endsWith('.js') ? 'ui.js' : 'ui.css')));
      }
      if (req.method === 'GET' && url.pathname === '/experiment/source') {
        const file = await source.read(url.searchParams.get('path'), Number(url.searchParams.get('line') || 1), 160);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Cache-Control': 'no-store' });
        return res.end(`<!doctype html><meta charset="utf-8"><title>${escape(file.path)}</title><style>body{font:14px system-ui;margin:24px;color:#202020}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;background:#f4f6f5;padding:16px}a{color:#156248}</style><h2>${escape(file.path)}</h2><p>${file.commit} · ${file.start} / ${file.totalLines}</p><a href="?path=${encodeURIComponent(file.path)}&line=${Math.max(1,file.start-160)}">上一段</a> · <a href="?path=${encodeURIComponent(file.path)}&line=${Math.min(file.totalLines,file.start+160)}">下一段</a><pre>${escape(file.text)}</pre>`);
      }
      if (url.pathname === '/experiment/meta' && req.method === 'GET') return send(res, 200, { commit: pin.commit, project: 'Codex CLI', tasks: Object.values(experiment.db.trials).map(t => ({ id: t.id, title: t.title, quality: t.quality })), map });
      if (url.pathname === '/experiment/tasks' && req.method === 'POST') return send(res, 201, await experiment.newTrial((await body(req)).id));
      const match = url.pathname.match(/^\/experiment\/tasks\/([a-zA-Z0-9_-]+)(?:\/(messages|feedback|displayed|cancel))?$/);
      if (!match) return send(res, 404, { error: 'NOT_FOUND' });
      if (!match[2] && req.method === 'GET') return send(res, 200, experiment.state(match[1]));
      if (req.method !== 'POST') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      const input = await body(req);
      const result = match[2] === 'messages' ? await experiment.submit(match[1], input, receivedAt)
        : match[2] === 'feedback' ? await experiment.feedback(match[1], input)
        : match[2] === 'displayed' ? await experiment.displayed(match[1], input)
        : match[2] === 'cancel' ? await experiment.cancel(match[1]) : null;
      return send(res, 200, result);
    }
    if (!backend) return send(res, 503, { error: 'STARTING' });
    // Source stays fixed; only the Coordinator's internal adapter may edit this local Map.
    const presence = req.method === 'POST' && url.pathname === '/api/workbench/projects/codex-learning/api/presence';
    if (req.method !== 'GET' && req.method !== 'HEAD' && !presence && !url.pathname.startsWith('/auth/')) return send(res, 403, { error: { code: 'READ_ONLY_STUDY', message: '学习项目源码只读；Map 修改请通过 Coordinator' } });
    const upstream = http.request(backend.url + req.url, { method: req.method, headers: { ...req.headers, host: new URL(backend.url).host } }, response => {
      const html = response.headers['content-type']?.includes('text/html');
      const app = url.pathname.endsWith('/workbench-app.js');
      if (response.statusCode === 200 && (html || app)) {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => {
          let content = Buffer.concat(chunks).toString('utf8');
          if (html) content = content.replace('</head>', '<link rel="stylesheet" href="/experiment/ui.css"><script src="/experiment/ui.js"></script></head>');
          if (app) {
            const original = 'if(connected) installCoordinatorPanel(workbenchSync);';
            if (!content.includes(original)) return send(res, 500, { error: 'WORKBENCH_ADAPTER_MISMATCH' });
            content = content.replace(original, `if(connected) window.installLearningCoordinator(workbenchSync, {
              reload: () => workbenchSync.reload(),
              openNode: async id => {
                if(workbenchSync.viewId!=='main'&&!await workbenchSync.selectSession('__all__'))throw new Error('无法切换到 Main');
                const node=getNode(id);if(!node||isCancelled(node))throw new Error('节点不存在');
                clearRelationMode();focusId=null;if(id===viewRootId)return;
                await new Promise(resolve=>enterView(id,{unpack:false,_mapMotionComplete:resolve}));
              }
            });`);
          }
          const headers = { ...response.headers }; delete headers['content-length']; delete headers['transfer-encoding'];
          res.writeHead(response.statusCode, headers); res.end(content);
        });
      } else { res.writeHead(response.statusCode, response.headers); response.pipe(res); }
    });
    upstream.on('error', () => { if (!res.headersSent) send(res, 502, { error: 'BACKEND_UNAVAILABLE' }); else res.destroy(); });
    req.on('aborted', () => upstream.destroy()); res.on('close', () => upstream.destroy()); req.pipe(upstream);
  } catch (error) { if (!res.headersSent) send(res, error.code === 'NOT_FOUND' ? 404 : 400, { error: error.code || 'INTERNAL_ERROR', message: error.code ? error.message : 'Request failed' }); else res.destroy(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.argv[2] || 0), '127.0.0.1', resolve); });
const publicUrl = `http://127.0.0.1:${server.address().port}`;
try {
  backend = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir: path.join(dataDir, 'workbench'),
    adminToken: credentials.adminToken, browserToken: credentials.browserToken, privateAccess: true, secureCookies: false,
    publicOrigin: publicUrl, browserPasswordHash: '', memoryConfig: { dataDir: path.join(dataDir, 'memory'), adminToken: credentials.adminToken, projects: {} }, protocolConfig: {},
  });
  const post = async (route, input) => {
    const r = await fetch(backend.url + route, { method: 'POST', headers: { Authorization: `Bearer ${credentials.adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const data = await r.json(); if (!r.ok && data.error?.code !== 'PROJECT_EXISTS') throw new Error(JSON.stringify(data)); return data;
  };
  const marker = path.join(dataDir, 'seeded.json');
  if (!await readJSON(marker, null)) {
    await post('/api/projects', { id: 'codex-learning', name: 'Codex CLI', description: 'Codex 源码学习' });
    await post('/api/projects/codex-learning/snapshot', { baseVersion: null, operationId: 'codex-learning-seed', document: map });
    await atomicWrite(marker, JSON.stringify({ commit: pin.commit }));
  }
  const runtime = { pid: process.pid, url: publicUrl + '/projects/codex-learning', baseUrl: publicUrl, commit: pin.commit, dataDir };
  await atomicWrite(path.join(here, phase === 'study' ? 'runtime.json' : 'calibration-runtime.json'), JSON.stringify(runtime, null, 2));
  console.log(JSON.stringify(runtime));
} catch (error) { server.closeAllConnections(); server.close(); await experiment.close(); await backend?.close(); throw error; }
async function close() { await experiment.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); await backend.close(); process.exit(0); }
process.on('SIGTERM', close); process.on('SIGINT', close);
