import '../.github/scripts/test-environment.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { startServer } from '../scripts/workbench/server.mjs';
import { encode, pause, hash, readJSON } from '../scripts/workbench/io.mjs';
import { isolatedEnvironment, run } from '../.github/scripts/client-protocol.mjs';
import { chromium } from 'playwright';
const workspace = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.argv[2] || `output/playwright/browser-ci/${Date.now()}-${randomUUID()}`);
await fs.mkdir(output, { recursive: true });
// Keep fixtures outside the checkout: init resolves a nested directory to its Git root.
const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-browser-ci-'));
const root = path.join(sandbox, 'project'), ctx = path.join(root, '.codex/context');
const env = isolatedEnvironment(sandbox);
const session = '01a06653-9bd7-7733-9679-f7781d63975d';
const mapPath = path.join(ctx, 'map.json');
const node = { id: 'N1', title: '原始节点', purpose: '用于正式画布验证', kind: 'work', proposal: 'accepted', state: 'dirty', memories: [], ideas: [], todos: [], bugs: [], dormant: [], files: [], owns: [], children: [] };
const doc = { v: 1, project: 'browser-test', bootstrap: 'ready', extra: { preserved: true }, root: { ...node, id: 'T0', title: '浏览器验收', kind: 'module', children: [node] } };
let running, browser, page, passed = false, stage = 'isolated-hook-bootstrap';
const errors = [], checks = [], queuedMessages = [];
let releaseBugQueue;
const bugQueueGate = new Promise(resolve => { releaseBugQueue = resolve; });
const messageQueue = async payload => {
  queuedMessages.push(payload);
  if (payload.bug?.title === '处理状态测试') await bugQueueGate;
  if (payload.bug?.title === '发送失败测试') throw new Error('injected delivery failure');
};
function recordCheck(name) { checks.push(name); console.log(`Browser check passed: ${name}`); }
const read = async () => JSON.parse(await fs.readFile(mapPath, 'utf8'));
async function until(fn, timeout = 6000) { const end = Date.now() + timeout; while (!await fn()) { if (Date.now() >= end) throw new Error('condition timed out'); await pause(25); } }
const synchronized = () => page.waitForFunction(() => document.querySelector('#cg-sync')?.dataset.status === 'synced');
async function servePrototype() {
  const protoDir = path.join(workspace, 'prototype');
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'workbench.html';
      const file = path.normalize(path.join(protoDir, rel));
      if (!file.startsWith(protoDir + path.sep)) { res.writeHead(403); res.end(); return; }
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}
async function chromeHeights(target) {
  return target.evaluate(() => {
    const els = [
      document.querySelector('.nav-crumbs .here'),
      document.getElementById('dir-toggle'),
      document.getElementById('rel-toggle'),
      document.getElementById('btn-auth'),
      document.getElementById('btn-bugs'),
      document.getElementById('btn-settings'),
    ].filter(el => el && el.offsetParent);
    return els.map(el => Math.round(el.getBoundingClientRect().height));
  });
}
async function openSyncSettings() {
  if (await page.locator('#btn-settings').getAttribute('aria-expanded') !== 'true') await page.locator('#btn-settings').click();
  if (await page.locator('#cg-sync').getAttribute('open') === null) await page.locator('#cg-sync summary').click();
}
async function cli(action, input, extra = [], expectedError) {
  // Exercise the installed/public command routing, not a direct store call.
  const args = [path.join(workspace, 'bin/context-guard-skill.js'), 'map', action, '--root', root, '--session', session, ...extra];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`CLI ${action} timed out`)); }, 25000);
    child.stdout.setEncoding('utf8').on('data', x => out += x); child.stderr.setEncoding('utf8').on('data', x => err += x);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdin.on('error', () => {});
    child.on('close', code => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(out);
        assert.equal(code, expectedError ? 1 : 0, `CLI ${action}: ${err || out}`);
        if (expectedError) assert.equal(result.error?.code, expectedError);
        else assert.equal(result.error ?? undefined, undefined, `CLI ${action} returned an error`);
        resolve({ code, ...result });
      } catch (error) { reject(error); }
    });
    child.stdin.end(input ? JSON.stringify(input) : undefined);
  });
}
async function bindSession(sessionId, worktreeRoot = root) {
  const response = await fetch(new URL('/api/session', running.state.url), {
    method: 'POST',
    headers: { Authorization: `Bearer ${running.state.adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, worktreeRoot }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
async function stopIsolatedProxy() {
  const file = path.join(env.HOME, '.context-guard/named-workbench/proxy.json');
  const state = await readJSON(file, null);
  if (!state?.base || !state.adminToken) return;
  await new Promise((resolve, reject) => {
    const request = http.request(new URL('/__cg_proxy/stop', state.base), {
      method: 'POST', agent: false,
      headers: { Authorization: `Bearer ${state.adminToken}`, Connection: 'close' },
    }, response => {
      response.resume();
      response.on('end', () => response.statusCode === 202 ? resolve() : reject(new Error(`Proxy cleanup returned HTTP ${response.statusCode}`)));
    });
    request.setTimeout(2000, () => request.destroy(new Error('Proxy cleanup timed out')));
    request.on('error', reject);
    request.end();
  });
  await until(() => fs.stat(file).then(() => false, error => error.code === 'ENOENT' ? true : Promise.reject(error)), 4000);
}
try {
  await fs.mkdir(root);
  const python = (process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']).find(command => {
    const result = spawnSync(command, ['--version'], { env, encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return result.status === 0 && /^Python 3\./m.test(`${result.stdout}\n${result.stderr}`);
  });
  assert.ok(python, 'Python 3 is required for the real SessionStart hook');
  const unbound = await run(python, [path.join(workspace, 'scripts/context_guard_hook.py'), 'session-start', '--platform', 'codex'], {
    cwd: root, env, input: JSON.stringify({ cwd: root, session_id: session, thread_name: 'basic-browser', is_background_agent: true }), timeout: 20000,
  });
  assert.match(unbound.stdout, /no established workbench for automatic Session binding/);
  const sessions = (await fs.readFile(path.join(ctx, 'sessions.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(sessions.some(event => event.session_id === session && event.event === 'session-start'));
  await assert.rejects(fs.stat(path.join(ctx, 'sessions', `${session}.md`)), { code: 'ENOENT' });
  await assert.rejects(fs.stat(mapPath), { code: 'ENOENT' });
  await run(python, [path.join(workspace, 'scripts/context_guard.py'), 'init', '--root', root], { cwd: root, env });
  await fs.writeFile(mapPath, encode({ v: 1, project: 'browser-test', bootstrap: 'pending', flows: [], root: null }));
  running = await startServer({ root, port: 0, messageQueue });
  await bindSession(session);
  const boundHook = await run(python, [path.join(workspace, 'scripts/context_guard_hook.py'), 'session-start', '--platform', 'codex'], {
    cwd: root, env, input: JSON.stringify({ cwd: root, session_id: session, thread_name: 'basic-browser', is_background_agent: true }), timeout: 20000,
  });
  const sessionRecord = await fs.stat(path.join(ctx, 'sessions', `${session}.md`)).catch(() => null);
  assert.ok(sessionRecord?.isFile(), `bound SessionStart did not initialize Session memory: ${boundHook.stdout}`);
  await run(process.execPath, [path.join(workspace, 'bin/context-guard-skill.js'), 'set-language', '--root', root, '--language', 'zh'], { cwd: root, env });
  browser = await chromium.launch({ headless: true, env });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', error => errors.push(error.stack || error.message));
  recordCheck('real-hook-session-bootstrap');
  stage = 'bidirectional-sync';
  const legacy = { repos: { 'browser-test': { live: { ...doc.root, title: '旧缓存绝不能回盖' } } }, repoId: 'browser-test' };
  await page.addInitScript(value => localStorage.setItem('cg-workbench-maps-v16', JSON.stringify(value)), legacy);
  await page.goto(running.state.url);
  await page.waitForSelector('#cg-sync[data-status="error"]', { state: 'attached' });
  await openSyncSettings();
  await page.getByRole('button', { name: '将当前图设为真实地图' }).click(); await synchronized();
  const initialized = await read(); assert.equal(initialized.root.id, 'T0'); assert.ok(initialized.root.children.length > 0); assert.equal(initialized.bootstrap, 'ready');
  recordCheck('empty-map-explicitly-initializes-current-workbench');
  await fs.writeFile(mapPath, encode(doc));
  await page.waitForFunction(() => document.querySelector('#repo-title')?.textContent?.includes('browser-test'));
  await page.waitForFunction(() => document.querySelector('#cg-sync-status')?.textContent?.includes('旧缓存'));
  await synchronized();
  if (await page.locator('#btn-settings').getAttribute('aria-expanded') === 'true') await page.locator('#btn-settings').click();
  assert.equal(await page.locator('.session-chip').isVisible(), true);
  assert.equal(await page.locator('#cg-sync-session').inputValue(), '__all__');
  assert.equal(await page.locator('#session-name').textContent(), '主工作台 · 全部 Session');
  assert.equal(await page.locator('#session-status').evaluate(el => el.classList.contains('empty')), true);
  assert.equal(await page.locator('.node[data-id="N1"]').evaluate(el => el.classList.contains('noauth')), false);
  assert.equal(await page.locator('#auth-count').count(), 0);
  assert.equal(await page.locator('#cg-sync-session option:checked').textContent(), '主工作台 · 全部 Session');
  assert.equal(await page.locator('body').evaluate(el => el.classList.contains('rel-mode')), false);
  assert.equal(await page.locator('#btn-rel').getAttribute('aria-pressed'), 'false');
  await page.locator('#session-chip').click();
  assert.equal(await page.locator('#session-menu [data-session]').count(), 2);
  assert.equal(await page.locator('#session-menu .session-option-name').filter({ hasText: '当前会话' }).count(), 0, 'an unpinned browser must not invent a current Session');
  await page.locator('#session-chip').click();
  await fs.appendFile(path.join(ctx, 'sessions.jsonl'), `${JSON.stringify({ at: new Date(Date.now() + 500).toISOString(), event: 'maintenance', platform: 'cli', session_id: 'maintenance-browser' })}\n`);
  const liveSession = 'browser-live-agent';
  await fs.appendFile(path.join(ctx, 'sessions.jsonl'), `${JSON.stringify({ at: new Date(Date.now() + 1000).toISOString(), event: 'session-start', platform: 'cursor', session_id: liveSession, thread_name: 'live-browser' })}\n`);
  await bindSession(liveSession);
  await page.waitForFunction(() => document.querySelectorAll('#session-menu [data-session]').length === 3);
  assert.equal(await page.locator('#cg-sync-session').inputValue(), '__all__');
  const pinnedPage = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await pinnedPage.goto(`${running.state.url}?session=${encodeURIComponent(session)}`);
  await pinnedPage.waitForFunction(id => document.querySelector('#cg-sync-session')?.value === id, session);
  assert.equal(await pinnedPage.locator('#cg-sync-session').inputValue(), session, 'a Session URL must not switch to a newer active task');
  assert.equal(await pinnedPage.locator('#session-name').textContent(), 'codex-basic-browser');
  assert.doesNotMatch(await pinnedPage.locator('#session-name').textContent(), /project|feature\//);
  await pinnedPage.locator('#session-chip').click();
  const pinnedCurrent = pinnedPage.locator('#session-menu [data-session][aria-current="true"]');
  assert.equal(await pinnedCurrent.count(), 1, 'only the URL-bound Session is the current Session');
  assert.equal(await pinnedCurrent.getAttribute('data-session'), session);
  assert.equal(await pinnedPage.locator('#session-menu [data-session]').count(), 1, 'a pinned Session cannot browse another Session or the global work-item queue');
  assert.equal(await pinnedPage.locator('#cg-sync-session option').count(), 1);
  assert.doesNotMatch(await pinnedCurrent.locator('.session-option-name').textContent(), /当前会话/);
  await pinnedPage.close();
  assert.equal(await page.locator('#cg-sync-session option').filter({ hasText: 'maintenance-browser' }).count(), 0);

  const sameBranchA = 'browser-contract-a';
  const sameBranchB = 'browser-contract-b';
  const closedSession = 'browser-contract-closed';
  const publishedSession = 'browser-contract-published';
  const staleSession = 'browser-contract-stale';
  const contractPage = await browser.newPage({ viewport: { width: 900, height: 700 } });
  contractPage.on('pageerror', error => errors.push(error.stack || error.message));
  await contractPage.route('**/api/access*', async route => {
    const response = await route.fetch();
    const body = await response.json();
    const base = body.sessions.find(item => item.id === session);
    assert.ok(base, 'the real Session must be present in the access contract');
    const namedBase = { ...base, name: 'basic-browser', platform: 'codex' };
    body.currentSessionId = sameBranchB;
    body.sessions = [
      { ...namedBase, name: '', lastSeen: '2000-01-01T00:00:00.000Z' },
      namedBase,
      { id: sameBranchA, name: 'agent=当前会话', platform: 'cursor', status: 'active', bindingState: 'bound', worktreeName: 'shared-worktree', branch: 'feature/shared', lastSeen: '2026-01-02T00:00:00.000Z' },
      { id: sameBranchB, name: 'agent=当前会话', platform: 'cursor', status: 'active', bindingState: 'bound', worktreeName: 'shared-worktree', branch: 'feature/shared', lastSeen: '2026-01-01T00:00:00.000Z' },
      { id: closedSession, name: '', platform: 'codex', status: 'closed', bindingState: 'bound' },
      { id: publishedSession, name: '', platform: 'codex', status: 'published', bindingState: 'bound' },
      { id: staleSession, name: '', platform: 'codex', status: 'active', bindingState: 'stale', branch: 'feature/stale' },
    ];
    await route.fulfill({ response, json: body });
  });
  await contractPage.goto(running.state.url);
  await contractPage.waitForFunction(() => document.querySelector('#cg-sync-session')?.value === '__all__');
  await contractPage.locator('#session-chip').click();
  assert.equal(await contractPage.locator(`#session-menu [data-session="${session}"]`).count(), 1, 'duplicate Session records are collapsed by sessionId');
  const contractCurrent = contractPage.locator('#session-menu [data-session][aria-current="true"]');
  assert.equal(await contractCurrent.count(), 0, 'an API currentSessionId must not invent a browser Session without a URL pin');
  const baseLabel = await contractPage.locator(`#session-menu [data-session="${session}"] .session-option-name`).textContent();
  assert.equal(baseLabel, 'codex-basic-browser');
  const labelA = await contractPage.locator(`#session-menu [data-session="${sameBranchA}"] .session-option-name`).textContent();
  const labelB = await contractPage.locator(`#session-menu [data-session="${sameBranchB}"] .session-option-name`).textContent();
  assert.equal(labelA, 'cursor 会话');
  assert.equal(labelB, 'cursor 会话');
  const detailA = await contractPage.locator(`#session-menu [data-session="${sameBranchA}"] .session-option-context`).textContent();
  const detailB = await contractPage.locator(`#session-menu [data-session="${sameBranchB}"] .session-option-context`).textContent();
  assert.equal(detailA, '会话 1');
  assert.equal(detailB, '会话 2');
  assert.notEqual(detailA, detailB, 'same-name Sessions remain independently identifiable without changing their primary label');
  assert.equal(await contractPage.locator(`#cg-sync-session option[value="${sameBranchA}"]`).textContent(), 'cursor 会话 — 会话 1');
  assert.doesNotMatch(await contractPage.locator(`#cg-sync-session option[value="${sameBranchA}"]`).textContent(), /shared-worktree|feature\/shared/);
  const visibleSessionText = `${await contractPage.locator('#session-menu').textContent()} ${(await contractPage.locator('#cg-sync-session option').allTextContents()).join(' ')}`;
  assert.doesNotMatch(visibleSessionText, /agent=当前会话/);
  assert.doesNotMatch(`${baseLabel} ${labelA} ${labelB}`, /shared-worktree|feature\/shared/);
  for (const id of [session, sameBranchA, sameBranchB, closedSession, publishedSession, staleSession]) assert.doesNotMatch(visibleSessionText, new RegExp(id));
  assert.equal(await contractPage.locator(`#session-menu [data-session="${closedSession}"]`).count(), 0);
  assert.equal(await contractPage.locator(`#session-menu [data-session="${publishedSession}"]`).count(), 0);
  assert.equal(await contractPage.locator(`#session-menu [data-session="${staleSession}"]`).isDisabled(), true);
  assert.equal(await contractPage.locator(`#session-menu [data-session="${staleSession}"]`).getAttribute('title'), '绑定已失效 · feature/stale');
  assert.equal(await contractPage.locator(`#cg-sync-session option[value="${session}"]`).count(), 1);
  assert.equal(await contractPage.locator(`#cg-sync-session option[value="${closedSession}"]`).count(), 0);
  assert.equal(await contractPage.locator(`#cg-sync-session option[value="${publishedSession}"]`).count(), 0);
  assert.equal(await contractPage.locator(`#cg-sync-session option[value="${staleSession}"]`).getAttribute('disabled'), '');
  await contractPage.close();

  const invalidPinnedPage = await browser.newPage({ viewport: { width: 900, height: 700 } });
  invalidPinnedPage.on('pageerror', error => errors.push(error.stack || error.message));
  await invalidPinnedPage.goto(`${running.state.url}?session=removed-session#invalid-session-contract`);
  await invalidPinnedPage.waitForFunction(() => document.querySelector('#cg-sync')?.dataset.status === 'synced' && document.querySelector('#cg-sync-session')?.value === '__all__');
  const recoveredUrl = new URL(invalidPinnedPage.url());
  assert.equal(recoveredUrl.searchParams.has('session'), false, 'a removed Session URL falls back to All Sessions');
  assert.equal(recoveredUrl.hash, '#invalid-session-contract');
  await invalidPinnedPage.close();

  const relationUrl = new URL(running.state.url);
  relationUrl.searchParams.set('session', session);
  relationUrl.searchParams.set('relation', 'N1');
  relationUrl.hash = '#relation-contract';
  const relationPage = await browser.newPage({ viewport: { width: 900, height: 700 } });
  relationPage.on('pageerror', error => errors.push(error.stack || error.message));
  await relationPage.goto(relationUrl.href);
  await relationPage.waitForFunction(() => document.body.classList.contains('rel-mode'));
  assert.equal(await relationPage.locator('#btn-rel').getAttribute('aria-pressed'), 'true');
  await relationPage.locator('#session-chip').click();
  assert.equal(await relationPage.locator(`#session-menu [data-session="${liveSession}"]`).count(), 0);
  assert.equal(await relationPage.locator('#session-menu [data-session="__all__"]').count(), 0);
  const switchedRelationUrl = new URL(relationPage.url());
  assert.equal(switchedRelationUrl.searchParams.get('session'), session);
  assert.equal(switchedRelationUrl.searchParams.get('relation'), 'N1');
  assert.equal(switchedRelationUrl.hash, '#relation-contract');
  await relationPage.close();
  recordCheck('session-identity-lifecycle-and-relation-defaults');

  await running.access.grant(liveSession, ['N1'], running.store.version);
  await page.locator('#session-chip').click();
  assert.equal(await page.locator('#session-menu [data-session]').count(), 3);
  await page.locator(`#session-menu [data-session="${session}"]`).click();
  await page.waitForFunction(id => document.querySelector('#cg-sync-session')?.value === id, session);
  assert.equal(await page.locator('.node[data-id="N1"]').evaluate(el => el.classList.contains('noauth')), false, 'a newly bound Session starts with full workbench access');
  await running.access.grant(session, [], running.store.version);
  await page.reload();
  await page.waitForFunction(id => document.querySelector('#cg-sync')?.dataset.status === 'synced' && document.querySelector('#cg-sync-session')?.value === id, session);
  assert.equal(await page.locator('.node[data-id="N1"]').evaluate(el => el.classList.contains('noauth')), true);
  await page.goto(running.state.url);
  await page.waitForFunction(() => document.querySelector('#cg-sync')?.dataset.status === 'synced' && document.querySelector('#cg-sync-session')?.value === '__all__');
  await page.locator('#session-chip').click();
  await page.locator(`#session-menu [data-session="${liveSession}"]`).click();
  await page.waitForFunction(id => document.querySelector('#cg-sync-session')?.value === id, liveSession);
  assert.match(await page.locator('#session-name').textContent(), /^cursor-live-browser/);
  assert.doesNotMatch(await page.locator('#session-name').textContent(), new RegExp(liveSession));
  assert.doesNotMatch(await page.locator('#session-menu').textContent(), new RegExp(session));
  assert.doesNotMatch((await page.locator('#cg-sync-session option').allTextContents()).join(' '), new RegExp(session));
  assert.equal(await page.locator('.node[data-id="N1"]').evaluate(el => el.classList.contains('noauth')), false);
  await page.locator('#session-chip').click();
  await page.locator(`#session-menu [data-session="${session}"]`).click();
  await page.waitForFunction(id => document.querySelector('#cg-sync-session')?.value === id, session);
  assert.match(await page.locator('#session-name').textContent(), /^codex-basic-browser/);
  assert.doesNotMatch(await page.locator('#session-name').textContent(), new RegExp(session));
  assert.doesNotMatch(await page.locator('#session-name').getAttribute('title'), new RegExp(session));
  recordCheck('top-session-switch-and-scope');
  await page.locator('#session-chip').click();
  await page.locator('#session-menu [data-session="__all__"]').click();
  await page.waitForFunction(() => document.querySelector('#cg-sync-session')?.value === '__all__');
  assert.equal(new URL(page.url()).searchParams.has('session'), false, 'All Sessions removes the Session URL pin');
  assert.equal(await page.locator('.node[data-id="N1"]').evaluate(el => el.classList.contains('noauth')), false);
  recordCheck('all-session-global-scope');
  await page.locator('.node[data-id="N1"]').click();
  assert.equal(await page.locator('#detail [data-fold="mem"]').getAttribute('open'), null);
  await page.locator('#detail [data-act="add-bug"]').click();
  const createDialog = page.locator('.bug-assign-dialog');
  assert.equal(await createDialog.locator('h3').count(), 0);
  assert.equal(await createDialog.getByLabel('Bug 标题').count(), 0);
  await createDialog.getByLabel('Bug 描述').fill('处理状态测试\n全局视角分配');
  await createDialog.getByLabel('处理 Session').selectOption(session);
  await createDialog.locator('[data-scope]').waitFor();
  assert.match(await createDialog.locator('[data-scope]').textContent(), /2 个新节点/);
  await createDialog.getByRole('button', { name: '确认授权并发送' }).click();
  await page.locator('#btn-bugs').click();
  const bugRow = page.locator('#bug-panel-list li').filter({ hasText: '处理状态测试' });
  await bugRow.waitFor();
  await page.waitForFunction(() => document.querySelector('#bug-panel-list li')?.textContent?.includes('待处理 · 发送中'));
  assert.equal(await bugRow.locator('.bug-dot.waiting').count(), 1);
  await until(() => queuedMessages.length === 1);
  assert.equal((await read()).root.children[0].bugs.find(bug => bug.title === '处理状态测试').sessions.length, 0);
  assert.deepEqual(new Set(running.access.grants(session)), new Set(['T0', 'N1']));
  assert.equal(queuedMessages[0].sessionId, session);
  assert.match(queuedMessages[0].message, /处理状态测试/);
  assert.match(queuedMessages[0].message, /N1/);
  releaseBugQueue();
  await page.waitForFunction(() => document.querySelector('#bug-panel-list li')?.textContent?.includes('处理中 · codex-basic-browser'));
  assert.equal(await bugRow.locator('.bug-dot.processing').count(), 1);
  await until(async () => (await read()).root.children[0].bugs.find(bug => bug.title === '处理状态测试').sessions.includes(session));
  await synchronized();
  const resolvedBug = await read();
  resolvedBug.root.children[0].bugs.find(bug => bug.title === '处理状态测试').status = 'resolved';
  await fs.writeFile(mapPath, encode(resolvedBug));
  await page.waitForFunction(() => document.querySelector('#bug-panel-list li')?.textContent?.includes('已解决'));
  assert.equal(await bugRow.locator('.bug-dot.resolved').count(), 1);
  const cleanBug = await read(); cleanBug.root.children[0].bugs = [];
  await fs.writeFile(mapPath, encode(cleanBug));
  await page.waitForFunction(() => document.querySelector('#bug-count')?.textContent === '0');
  await page.locator('#btn-bugs').click();
  const failedDelivery = await read();
  failedDelivery.root.children[0].bugs.push({ id: 'B99', title: '发送失败测试', status: 'open', sessions: [] });
  await fs.writeFile(mapPath, encode(failedDelivery));
  await page.waitForFunction(() => document.querySelector('#bug-count')?.textContent === '1');
  await page.locator('#btn-bugs').click();
  const failedRow = page.locator('#bug-panel-list li').filter({ hasText: '发送失败测试' });
  await failedRow.click();
  await failedRow.locator('[data-claim]').click();
  const assignDialog = page.locator('.bug-assign-dialog');
  await assignDialog.getByLabel('处理 Session').selectOption(session);
  await assignDialog.getByRole('button', { name: '创建并发送' }).click();
  await page.waitForFunction(() => document.querySelector('#bug-panel-list li')?.textContent?.includes('待处理 · 发送失败'));
  await until(async () => (await read()).root.children[0].bugs.find(bug => bug.id === 'B99')?.dispatch?.status === 'failed');
  await synchronized();
  const failedState = await read();
  const failedBug = failedState.root.children[0].bugs.find(bug => bug.id === 'B99');
  assert.deepEqual(failedBug.sessions, []);
  assert.equal(failedBug.dispatch.status, 'failed');
  assert.equal(queuedMessages.length, 2);
  failedState.root.children[0].bugs = [];
  await fs.writeFile(mapPath, encode(failedState));
  await page.waitForFunction(() => document.querySelector('#bug-count')?.textContent === '0');
  await page.locator('#btn-bugs').click();
  recordCheck('bug-message-delivery-gates-handling-status');
  await page.locator('#session-chip').click();
  await page.locator(`#session-menu [data-session="${session}"]`).click();
  await page.waitForFunction(id => document.querySelector('#cg-sync-session')?.value === id, session);
  await page.locator('.node[data-id="N1"]').click();
  await page.locator('#detail [data-act="add-bug"]').click();
  const scopedDialog = page.locator('.bug-assign-dialog');
  assert.equal(await scopedDialog.getByLabel('Bug 标题').count(), 0);
  await scopedDialog.getByLabel('Bug 描述').fill('单会话自动分配');
  assert.equal(await scopedDialog.getByLabel('处理 Session').count(), 0);
  assert.equal(await scopedDialog.locator('input[name="session"]').inputValue(), session);
  await scopedDialog.getByRole('button', { name: '创建并发送' }).click();
  await until(() => queuedMessages.length === 3);
  await until(async () => (await read()).root.children[0].bugs.some(bug => bug.title === '单会话自动分配' && bug.sessions.includes(session)));
  const scopedClean = await read(); scopedClean.root.children[0].bugs = [];
  await fs.writeFile(mapPath, encode(scopedClean));
  await page.waitForFunction(() => document.querySelector('#bug-count')?.textContent === '0');
  recordCheck('single-session-bug-auto-assignment');
  await page.locator('#detail [data-act="add-todo"]').click();
  assert.equal(await page.locator('.bug-assign-dialog').count(), 0);
  const inlineTodo = page.locator('#detail .todo-list li:last-child [data-ed="todo-text"]');
  await inlineTodo.fill('开发新的需求入口\n节点级 TODO 自动发送到当前 Session');
  await inlineTodo.press('Tab');
  await until(() => queuedMessages.length === 4);
  await until(async () => (await read()).root.children[0].todos.some(todo => todo.title === '开发新的需求入口' && todo.status === 'processing' && todo.sessions.includes(session)));
  assert.match(queuedMessages[3].message, /TODO: TD\d+ · 开发新的需求入口/);
  const todoRow = page.locator('#detail .todo-list li').filter({ hasText: '开发新的需求入口' });
  await todoRow.waitFor();
  assert.match(await todoRow.textContent(), /处理中/);
  await todoRow.locator('.todo-check').click();
  await until(async () => (await read()).root.children[0].todos.some(todo => todo.title === '开发新的需求入口' && todo.status === 'done'));
  assert.match(await todoRow.textContent(), /已完成/);
  recordCheck('todo-session-assignment-and-completion');
  await fs.appendFile(path.join(ctx, 'sessions.jsonl'), `${JSON.stringify({ at: new Date(Date.now() + 1500).toISOString(), event: 'stop', platform: 'codex', session_id: session, thread_name: 'basic-browser' })}\n`);
  await page.waitForFunction(() => document.querySelector('#session-status')?.classList.contains('stopped'));
  assert.equal(await page.locator('#session-status').getAttribute('aria-label'), '已完成');
  recordCheck('icon-only-session-status');
  await page.locator('#session-chip').click();
  await page.locator('#session-menu [data-session="__all__"]').click();
  await page.waitForFunction(() => document.querySelector('#cg-sync-session')?.value === '__all__');
  assert.equal((await read()).root.title, '浏览器验收'); recordCheck('legacy-cache-not-written');
  const chrome = await chromeHeights(page);
  assert.ok(chrome.length >= 3, 'chrome buttons are on screen');
  assert.equal(new Set(chrome).size, 1, `chrome button heights ${chrome.join(',')}`);
  await page.locator('.node[data-id="N1"]').click();
  const trashBtn = page.locator('#detail button.trash');
  assert.equal(await trashBtn.count(), 1, 'non-root inspector has a delete trash');
  const actH = await trashBtn.evaluate(el => Math.round(el.getBoundingClientRect().height));
  assert.equal(actH, chrome[0], `inspector trash height ${actH} vs chrome ${chrome[0]}`);
  assert.equal(await page.locator('#detail [data-act="module"], #detail [data-act="child"]').count(), 0);
  assert.equal(await page.locator('#detail .add-hint').count(), 0, 'inspector does not show redundant add-node guidance');
  assert.equal(await trashBtn.locator('.lid').count(), 1, 'live trash uses the lid-open icon');
  await trashBtn.hover();
  const lidMove = await trashBtn.locator('.lid').evaluate(el => getComputedStyle(el).transform);
  assert.notEqual(lidMove, 'none', `lid should open on hover, got ${lidMove}`);
  const liveMark = await page.evaluate(() => {
    const s = document.createElement('span');
    s.className = 'state-chip success';
    s.textContent = '测试通过';
    document.querySelector('#detail').appendChild(s);
    const cs = getComputedStyle(s);
    const mark = getComputedStyle(s, '::before');
    const m = new DOMMatrix(mark.transform);
    const out = { bg: cs.backgroundColor, radius: cs.borderRadius, color: cs.color, size: cs.fontSize, mark: mark.backgroundColor, content: mark.content, markRadius: mark.borderRadius, skewC: m.c };
    s.remove();
    return out;
  });
  assert.equal(liveMark.bg, 'rgba(0, 0, 0, 0)', `live chip should not be a pill, got ${liveMark.bg}`);
  assert.equal(liveMark.radius, '0px');
  assert.equal(liveMark.color, 'rgb(45, 45, 45)');
  assert.equal(liveMark.size, '14px');
  assert.equal(liveMark.mark, 'rgb(198, 237, 110)', `highlighter mark ${liveMark.mark}`);
  assert.equal(liveMark.markRadius, '10px', 'live chip follows gallery 11 round marker, scaled up');
  assert.ok(Math.abs(liveMark.skewC - Math.tan(-4 * Math.PI / 180)) < 0.01, `round-head skew ${liveMark.skewC}`);
  recordCheck('chrome-button-height');
  const splitBox = await page.locator('#drawer-split').boundingBox();
  assert.ok(splitBox && splitBox.width >= 16, 'inspector split is on screen');
  const widthBefore = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--drawer-width').trim());
  await page.mouse.move(splitBox.x + splitBox.width / 2, splitBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(splitBox.x - 90, splitBox.y + 80, { steps: 8 });
  await page.mouse.up();
  const widthAfter = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--drawer-width').trim());
  assert.notEqual(widthAfter, widthBefore);
  await page.locator('#drawer-split').dblclick();
  recordCheck('drawer-split-drag');
  await page.locator('#btn-bugs').click();
  assert.equal(await page.evaluate(() => document.body.classList.contains('bugs-open')), true);
  const bugSplit = await page.locator('#drawer-split').boundingBox();
  assert.ok(bugSplit && bugSplit.width >= 16, 'bug panel split is on screen');
  const bugBefore = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bug-panel-width').trim());
  await page.mouse.move(bugSplit.x + bugSplit.width / 2, bugSplit.y + 80);
  await page.mouse.down();
  await page.mouse.move(bugSplit.x - 80, bugSplit.y + 80, { steps: 8 });
  await page.mouse.up();
  const bugAfter = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bug-panel-width').trim());
  assert.notEqual(bugAfter, bugBefore);
  await page.locator('#drawer-split').dblclick();
  await page.locator('#btn-bugs').click();
  recordCheck('bug-panel-split-drag');
  await page.locator('.node[data-id="N1"]').click();
  const linkedTarget = new URL(page.url()); linkedTarget.searchParams.set('linked-text-test', '1');
  const linkedMap = await read();
  linkedMap.root.children[0].purpose = `仓库地址：${linkedTarget.href}。`;
  await fs.writeFile(mapPath, encode(linkedMap));
  const purposeLink = page.locator('#detail [data-ed="purpose"] a.text-link');
  await purposeLink.waitFor();
  assert.equal(await purposeLink.getAttribute('href'), linkedTarget.href);
  assert.equal(await purposeLink.getAttribute('target'), '_blank');
  assert.equal(await purposeLink.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await page.locator('#detail [data-ed="purpose"]').textContent(), `仓库地址：${linkedTarget.href}。`);
  const popupPromise = page.waitForEvent('popup');
  await purposeLink.click();
  const linkedPage = await popupPromise;
  await linkedPage.waitForLoadState('domcontentloaded');
  assert.equal(new URL(linkedPage.url()).searchParams.get('linked-text-test'), '1');
  await linkedPage.close();
  const purposeEditor = page.locator('#detail [data-ed="purpose"]');
  await purposeEditor.fill('用于正式画布验证'); await purposeEditor.press('Tab');
  await until(async () => (await read()).root.children[0].purpose === '用于正式画布验证'); await synchronized();
  recordCheck('text-url-opens-directly');
  const title = page.locator('#detail [data-ed="title"]');
  await title.fill('人类中文改名'); await title.press('Tab');
  await until(async () => (await read()).root.children[0].title === '人类中文改名'); await synchronized(); recordCheck('browser-to-map');
  assert.deepEqual((await read()).extra, { preserved: true });
  const external = await read(); external.root.children[0].title = '外部文件更新'; await fs.writeFile(mapPath, encode(external));
  await page.waitForFunction(() => document.querySelector('#detail [data-ed="title"]')?.textContent === '外部文件更新'); await synchronized(); recordCheck('file-to-browser');
  await title.fill('连续输入一'); await title.fill('连续输入二'); await title.fill('连续输入最终值'); await title.press('Tab');
  await until(async () => (await read()).root.children[0].title === '连续输入最终值'); await synchronized(); recordCheck('rapid-input');
  await title.focus();
  await title.dispatchEvent('compositionstart'); await title.fill('中文组合输入');
  const beforeComposition = (await read()).root.children[0].title; await pause(250); assert.equal((await read()).root.children[0].title, beforeComposition);
  await title.dispatchEvent('compositionend'); await title.press('Tab');
  await until(async () => (await read()).root.children[0].title === '中文组合输入'); await synchronized(); recordCheck('ime');
  const version = hash(await fs.readFile(mapPath));
  await page.locator('#viewport').hover(); await page.mouse.wheel(0, 120); await pause(250);
  assert.equal(hash(await fs.readFile(mapPath)), version); recordCheck('view-does-not-write');
  await until(() => running.access.grants(session).includes('N1'));
  let current = await cli('read'); assert.equal(current.code, 0); assert.equal(current.version, hash(await fs.readFile(mapPath))); recordCheck('human-to-agent-fence');
  const initialInbox = await cli('inbox', undefined, ['--start']);
  assert.equal(initialInbox.pending, true, 'the bound SessionStart baseline must retain later human changes');
  await cli('ack', undefined, ['--receipt', initialInbox.receipt]);
  const staleVersion = current.version;
  let result = await cli('apply', { baseVersion: current.version, operationId: randomUUID(), operations: [{ type: 'update', id: 'N1', fields: { title: 'Agent CLI 更新' } }] });
  assert.equal(result.committed, true); await page.waitForFunction(() => document.querySelector('#detail [data-ed="title"]')?.textContent === 'Agent CLI 更新'); recordCheck('agent-cli-to-page');
  assert.equal((await cli('inbox')).pending, false, 'Own commits must not create a feedback loop');
  await cli('apply', { baseVersion: staleVersion, operationId: randomUUID(), operations: [{ type: 'update', id: 'N1', fields: { title: '旧版本不能覆盖' } }] }, [], 'VERSION_CONFLICT');
  assert.equal((await read()).root.children[0].title, 'Agent CLI 更新'); recordCheck('stale-version-rejected');
  stage = 'human-confirmation';
  current = await cli('read');
  const proposalFile = 'src/agent-proposal.mjs';
  const create = { baseVersion: current.version, operationId: randomUUID(), operations: [{ type: 'create', parentId: 'T0', node: {
    id: 'N2', title: 'Agent 提议', purpose: '提供新的独立产品职责', owns: [proposalFile],
    memories: [{ text: '新增独立职责', paths: [proposalFile], proposalEvidence: {
      parentId: 'T0', basis: 'new-responsibility', reason: '新增独立实现边界且当前 Map 没有对应节点', files: [proposalFile],
    } }],
  } }] };
  result = await cli('apply', create); assert.equal(result.committed, true); assert.equal((await cli('apply', create)).duplicate, true);
  assert.equal((await read()).root.children.filter(x => x.id === 'N2').length, 1);
  assert.equal((await read()).root.children.find(x => x.id === 'N2').proposal, 'proposed');
  current = await cli('read');
  await cli('apply', { baseVersion: current.version, operationId: randomUUID(), operations: [{ type: 'update', id: 'N2', fields: { proposal: 'accepted' } }] }, [], 'FORBIDDEN');
  assert.equal((await read()).root.children.find(x => x.id === 'N2').proposal, 'proposed');
  assert.equal((await cli('inbox')).pending, false); recordCheck('retry-deduplication-and-no-self-confirmation');
  await page.locator('.node[data-id="N2"]').click();
  assert.match(await page.locator('#detail .proposal-evidence').textContent(), /新增独立实现边界且当前 Map 没有对应节点/);
  assert.match(await page.locator('#detail .proposal-evidence').textContent(), /src\/agent-proposal\.mjs/);
  await page.locator('#detail [data-act="accept"]').click(); await synchronized();
  await until(async () => (await read()).root.children.find(x => x.id === 'N2')?.proposal === 'accepted'); recordCheck('proposal-human-confirmation');
  stage = 'inbox-ack';
  const confirmation = await cli('inbox');
  assert.equal(confirmation.pending, true);
  assert.equal(confirmation.changes.find(x => x.id === 'N2').fields.proposal.after.value, 'accepted');
  assert.ok(confirmation.events.some(event => event.actor.kind === 'human'));
  assert.equal((await cli('inbox')).receipt, confirmation.receipt);
  await cli('ack', undefined, ['--receipt', 'invalid-receipt'], 'RECEIPT_MISMATCH');
  await page.locator('.node[data-id="N2"] .add-child').click();
  await page.locator('.node[data-id="N2"].picking .add-pick [data-add="work"]').click();
  await page.locator('[data-ed="compose-title"]').fill('人类新增子节点');
  await page.locator('[data-act="compose-ok"]').click(); await synchronized();
  await until(async () => (await read()).root.children.find(x => x.id === 'N2')?.children.some(x => x.title === '人类新增子节点')); recordCheck('human-create');
  assert.equal((await cli('inbox')).receipt, confirmation.receipt, 'Unacknowledged delivery must survive a later edit');
  assert.equal((await cli('ack', undefined, ['--receipt', confirmation.receipt])).acknowledged, true);
  assert.equal((await cli('ack', undefined, ['--receipt', confirmation.receipt])).duplicate, true);
  const later = await cli('inbox');
  assert.equal(later.pending, true); assert.notEqual(later.receipt, confirmation.receipt);
  assert.ok(later.changes.some(change => change.type === 'created' && change.title === '人类新增子节点'));
  await cli('ack', undefined, ['--receipt', later.receipt]);
  assert.equal((await cli('inbox')).pending, false); recordCheck('durable-inbox-exact-ack-later-edit-preserved');
  const savedVersion = (await cli('read')).version;
  await page.reload(); await synchronized();
  assert.equal((await cli('read')).version, savedVersion);
  await page.locator('.node[data-id="N2"]').click();
  assert.equal(await page.locator('#detail [data-ed="title"]').textContent(), 'Agent 提议');
  assert.equal((await read()).root.children.find(x => x.id === 'N2').proposal, 'accepted'); recordCheck('refresh-preserves-committed-state');
  stage = 'conflict-and-recovery';
  await page.locator('.node[data-id="N1"]').click();
  const second = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); second.on('pageerror', e => errors.push(e.stack || e.message));
  await second.goto(running.state.url); await second.waitForSelector('#cg-sync[data-status="synced"]', { state: 'attached' }); await second.locator('.node[data-id="N1"]').click();
  await title.dispatchEvent('compositionstart'); await title.fill('保留的输入法草稿');
  await second.locator('#detail [data-ed="title"]').fill('另一个页面先保存'); await second.locator('#detail [data-ed="title"]').press('Tab');
  await until(async () => (await read()).root.children[0].title === '另一个页面先保存');
  await page.waitForSelector('#cg-sync[data-status="conflict"]', { state: 'attached' }); assert.equal(await title.textContent(), '保留的输入法草稿');
  result = await cli('read', undefined, [], 'UI_PENDING'); recordCheck('multi-page-conflict-and-agent-fence');
  await title.dispatchEvent('compositionend'); await openSyncSettings(); await page.locator('#cg-sync-reload').click(); await synchronized();
  await second.close();
  // A network failure retains the same request; retry saves it without duplication.
  await page.route('**/api/commit*', route => route.abort('connectionfailed'));
  await title.fill('断线期间的草稿'); await title.press('Tab'); await page.waitForSelector('#cg-sync[data-status="offline"]', { state: 'attached' });
  assert.notEqual((await read()).root.children[0].title, '断线期间的草稿');
  await page.unroute('**/api/commit*'); await openSyncSettings(); await page.locator('#cg-sync-retry').click(); await synchronized();
  assert.equal((await read()).root.children[0].title, '断线期间的草稿'); recordCheck('network-retry');
  // Five simultaneously open frontends share one authoritative map. Only the
  // connected pages with unsaved edits may fence Agent reads; closed tabs must
  // disappear from the live peer set even when their browser draft is dirty.
  stage = 'five-page-concurrency';
  const frontends = [page];
  for (let index = 1; index < 5; index++) {
    const frontend = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    frontend.on('pageerror', error => errors.push(error.stack || error.message));
    await frontend.goto(running.state.url);
    await frontend.waitForSelector('#cg-sync[data-status="synced"]', { state: 'attached' });
    frontends.push(frontend);
  }
  const humanState = async () => {
    const response = await fetch(new URL('/api/state', running.state.url), { headers: { Authorization: `Bearer ${running.humanToken}` } });
    assert.equal(response.status, 200);
    return response.json();
  };
  await until(async () => (await humanState()).peers.length === 5);
  assert.equal(new Set((await humanState()).peers.map(peer => peer.id)).size, 5);
  const concurrentTitles = frontends.map((_, index) => `五页面并发草稿-${index + 1}`);
  for (let index = 0; index < frontends.length; index++) {
    const frontend = frontends[index];
    await frontend.locator('.node[data-id="N1"]').click();
    const editor = frontend.locator('#detail [data-ed="title"]');
    await editor.dispatchEvent('compositionstart');
    await editor.fill(concurrentTitles[index]);
  }
  await cli('read', undefined, [], 'UI_PENDING');
  const winner = frontends[0].locator('#detail [data-ed="title"]');
  await winner.dispatchEvent('compositionend'); await winner.press('Tab');
  await until(async () => (await read()).root.children[0].title === concurrentTitles[0]);
  await frontends[0].waitForSelector('#cg-sync[data-status="synced"]', { state: 'attached' });
  for (const frontend of frontends.slice(1)) {
    await frontend.waitForSelector('#cg-sync[data-status="conflict"]', { state: 'attached' });
  }
  assert.deepEqual(await Promise.all(frontends.map(frontend => frontend.locator('#cg-sync').getAttribute('data-status'))), ['synced', 'conflict', 'conflict', 'conflict', 'conflict']);
  for (const frontend of frontends.slice(1)) await frontend.close();
  await until(async () => (await humanState()).peers.length === 1);
  assert.equal((await cli('read')).version, hash(await fs.readFile(mapPath)));
  recordCheck('five-page-conflict-and-closed-peer-cleanup');
  const xss = await read(); xss.root.children[0].title = '<img src=x onerror="window.injected=true">'; await fs.writeFile(mapPath, encode(xss));
  await page.waitForFunction(() => document.querySelector('#detail [data-ed="title"]')?.textContent?.startsWith('<img'));
  assert.equal(await page.evaluate(() => !!window.injected), false); recordCheck('map-text-not-html');
  // An existing page detects a replaced backend and waits for an explicit refresh.
  const port = new URL(running.state.url).port, previousInstance = running.state.instance; await running.close();
  await page.waitForSelector('#cg-sync[data-status="offline"]', { state: 'attached' });
  running = await startServer({ root, port: Number(port), messageQueue });
  assert.notEqual(running.state.instance, previousInstance);
  await page.waitForFunction(() => document.querySelector('#cg-sync-status')?.textContent?.includes('工作台后端实例已变更，请刷新页面'));
  assert.equal(await page.locator('#cg-sync').getAttribute('data-status'), 'error');
  await page.reload();
  await synchronized();
  assert.ok(running.access.grants(session).includes('N1'), 'session grants must survive workbench restart');
  await page.locator('.node[data-id="N1"]').click();
  await title.fill('服务重启后保存'); await title.press('Tab'); await synchronized();
  assert.equal((await read()).root.children[0].title, '服务重启后保存'); recordCheck('server-instance-change-detected-and-manual-refresh-recovers');
  // Recovery import previews before writing, then applies only explicitly selected fields.
  stage = 'migration-preview';
  const migration = await read(); migration.root.children[0].purpose = '迁移已选择的用途';
  const imported = path.join(sandbox, 'import.json'); await fs.writeFile(imported, encode(migration));
  await page.locator('#cg-sync-file').setInputFiles(imported); await page.waitForSelector('dialog[open]');
  assert.equal((await read()).root.children[0].purpose, '用于正式画布验证');
  await page.locator('dialog input[type="checkbox"]').check(); await page.getByRole('button', { name: '提交已选差异' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  await until(async () => (await read()).root.children[0].purpose === '迁移已选择的用途'); await synchronized();
  await page.locator('#cg-sync-file').setInputFiles(imported); await page.waitForSelector('dialog[open]');
  assert.equal(await page.locator('dialog input[type="checkbox"]').count(), 0); await page.getByRole('button', { name: '取消', exact: true }).click(); recordCheck('migration-preview-and-idempotence');
  if (await page.locator('#btn-settings').getAttribute('aria-expanded') === 'true') await page.locator('#btn-settings').click();
  // First attachments remain reachable without an always-visible attachment button.
  stage = 'attachment-editing';
  const attachmentFixture = await read();
  attachmentFixture.root.children[0].memories = [{ text: '附件回归记忆', state: 'dirty', files: [] }];
  attachmentFixture.root.children[0].ideas = [{ text: '附件回归想法', state: 'dirty', files: [] }];
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs/attachment.txt'), 'Attachment fixture');
  await fs.writeFile(mapPath, encode(attachmentFixture));
  await page.waitForFunction(() => document.querySelector('#detail [data-ed="mem"]')?.textContent === '附件回归记忆'); await synchronized();
  for (const kind of ['mem', 'idea']) {
    const fold = page.locator(`[data-fold="${kind}"]`);
    if (await fold.evaluate(el => el.tagName === 'DETAILS') && await fold.getAttribute('open') === null) {
      await fold.locator(':scope > summary').click();
    }
  }
  assert.equal(await page.locator('#detail [data-act="ask-file"], #detail .files').count(), 0);
  const transfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.setData('text/plain', 'docs/attachment.txt'); return data; });
  await page.locator('#detail [data-ed="mem"]').dispatchEvent('drop', { dataTransfer: transfer });
  await until(async () => (await read()).root.children[0].memories[0].files.length === 1); await synchronized();
  assert.equal(await page.locator('#detail [data-act="ask-file"]').count(), 1);
  assert.deepEqual((await read()).root.children[0].ideas[0].files, []);
  await page.locator('#detail [data-act="rm-file"]').click();
  await until(async () => (await read()).root.children[0].memories[0].files.length === 0); await synchronized();
  assert.equal(await page.locator('#detail [data-act="ask-file"], #detail .files').count(), 0);
  await page.locator('.node[data-id="N2"]').click(); await page.locator('.node[data-id="N1"]').click();
  await page.locator('#detail [data-ed="idea"]').evaluate(el => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'docs/attachment.txt');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await until(async () => (await read()).root.children[0].ideas[0].files.length === 1); await synchronized();
  assert.deepEqual((await read()).root.children[0].memories[0].files, []);
  assert.deepEqual((await read()).root.children.find(x => x.id === 'N2').ideas, []);
  await page.locator('#detail [data-act="rm-file"]').click();
  await until(async () => (await read()).root.children[0].ideas[0].files.length === 0); await synchronized();
  assert.equal(await page.locator('#detail [data-act="ask-file"], #detail .files').count(), 0);
  await transfer.dispose(); recordCheck('attachments-only-after-first-file');
  stage = 'delete-reparent';
  const createdChild = (await read()).root.children.find(x => x.id === 'N2')?.children.find(x => x.title === '人类新增子节点');
  assert.ok(createdChild, 'human-created child is still under N2');
  await page.locator('.node[data-id="N2"]').click();
  await page.locator('#detail button.trash').click();
  assert.ok((await page.locator('#detail .delete-ask').textContent()).includes('接到上一级'));
  await page.locator('#detail [data-act="delete-keep"]').click();
  await synchronized();
  await until(async () => {
    const map = await read();
    const n2 = map.root.children.find(x => x.id === 'N2');
    const sibling = map.root.children.find(x => x.title === '人类新增子节点');
    return n2?.proposal === 'cancelled' && sibling?.id === createdChild.id;
  });
  assert.equal((await read()).root.children.find(x => x.id === 'N2')?.children.some(x => x.title === '人类新增子节点'), false);
  await page.locator(`.node[data-id="${createdChild.id}"]`).click();
  await page.locator('#detail button.trash').click();
  assert.equal(await page.locator('#detail .delete-ask').count(), 0, 'leaf delete must not ask about children');
  await synchronized();
  await until(async () => (await read()).root.children.find(x => x.id === createdChild.id)?.proposal === 'cancelled');
  recordCheck('delete-reparent');
  stage = 'static-preview-clicks';
  const staticServer = await servePrototype();
  const preview = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  preview.on('pageerror', error => errors.push(error.message));
  try {
    const port = staticServer.address().port;
    await preview.goto(`http://127.0.0.1:${port}/workbench.html?https://raw.githubusercontent.com/example/repo/sha/prototype/workbench.html?preview=1`);
    await preview.waitForSelector('.node.root');
    assert.equal(await preview.evaluate(() => document.documentElement.classList.contains('theme-preview')), true);
    assert.equal(await preview.locator('header.top').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 253, 248)');
    const previewBanner = await preview.evaluate(() => {
      const el = document.querySelector('.theme-preview-banner');
      const s = getComputedStyle(el);
      return {
        display: s.display,
        shown: s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0
      };
    });
    assert.equal(previewBanner.shown, false, `preview module-card chip must stay hidden ${JSON.stringify(previewBanner)}`);
    recordCheck('preview-theme-banner-hidden');
    assert.equal(await preview.locator('.node.noauth').count(), 0, 'static preview unlocks every node');
    assert.equal(await preview.locator('.sync-notice').evaluate(el => el.hidden), true);
    const previewChrome = await chromeHeights(preview);
    assert.equal(new Set(previewChrome).size, 1, `preview chrome heights ${previewChrome.join(',')}`);
    const context = await preview.evaluate(() => {
      const crumbs = document.querySelector('.nav-crumbs');
      const here = crumbs.querySelector('.here');
      return {
        h1: !!document.querySelector('header.top h1'),
        here: here?.textContent.replace(/\s+/g, ' ').trim(),
        switch: here?.classList.contains('switch'),
        hits: (crumbs.innerText.match(/Context Guard/g) || []).length
      };
    });
    assert.equal(context.h1, false, 'repo name is not a second title');
    assert.equal(context.hits, 1, `root should show one context card ${JSON.stringify(context)}`);
    assert.equal(context.switch, true);
    await preview.locator('#context-card').click();
    assert.equal(await preview.locator('#repo-menu.open').count(), 1);
    await preview.locator('#context-card').click();
    assert.equal(await preview.locator('#repo-menu.open').count(), 0);
    await preview.locator('.node[data-id="M1"]').click();
    await preview.waitForFunction(() => document.querySelector('.nav-crumbs a'));
    const nested = await preview.evaluate(() =>
      [...document.querySelectorAll('.nav-crumbs a, .nav-crumbs .here')].map(el => ({
        tag: el.tagName, text: el.textContent.replace(/\s+/g, ' ').trim(), switch: el.classList.contains('switch')
      }))
    );
    assert.ok(nested.length >= 2, `drilled path ${JSON.stringify(nested)}`);
    assert.equal(nested[0].tag, 'A');
    assert.ok(nested[0].text.includes('Context Guard'));
    assert.ok(nested.at(-1).text.includes('工作台'));
    assert.equal(nested.at(-1).switch, false);
    await preview.locator('.nav-crumbs a').first().click();
    await preview.waitForFunction(() => !document.querySelector('.nav-crumbs a') && document.querySelector('.nav-crumbs .here.switch'));
    recordCheck('context-card-merged');
    const dirToggle = preview.locator('#dir-toggle');
    await dirToggle.waitFor({ state: 'visible' });
    assert.equal(await preview.locator('#dir-toggle button').count(), 0);
    assert.equal(await dirToggle.evaluate(el => Math.round(el.getBoundingClientRect().height)), previewChrome[0]);
    const dirW = await dirToggle.evaluate(el => Math.round(el.getBoundingClientRect().width));
    assert.ok(dirW <= 64, `layout slider should stay compact, got ${dirW}`);
    const coverLr = await dirToggle.evaluate(() => {
      const thumb = document.querySelector('#dir-toggle .dir-thumb').getBoundingClientRect();
      const lr = document.querySelector('#dir-toggle [data-dir="lr"]').getBoundingClientRect();
      const tb = document.querySelector('#dir-toggle [data-dir="tb"]').getBoundingClientRect();
      const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      return { overLr: overlap(thumb, lr), overTb: overlap(thumb, tb) };
    });
    assert.ok(coverLr.overTb > coverLr.overLr, `slider should cover 上下 when 左右 is current ${JSON.stringify(coverLr)}`);
    const lrSpread = await preview.evaluate(() => {
      const root = document.querySelector('.node.root').getBoundingClientRect();
      const kid = document.querySelector('.node[data-id="M1"]').getBoundingClientRect();
      return { dx: kid.x - root.x, dy: kid.y - root.y };
    });
    assert.ok(lrSpread.dx > lrSpread.dy, `first layer left-right should sit children to the side ${JSON.stringify(lrSpread)}`);
    await dirToggle.locator('.dir-opt[data-dir="lr"]').click();
    await preview.waitForFunction(() => {
      const thumb = document.querySelector('#dir-toggle .dir-thumb').getBoundingClientRect();
      const lr = document.querySelector('#dir-toggle [data-dir="lr"]').getBoundingClientRect();
      const tb = document.querySelector('#dir-toggle [data-dir="tb"]').getBoundingClientRect();
      const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      return overlap(thumb, lr) > overlap(thumb, tb);
    });
    const tbSpread = await preview.evaluate(() => {
      const root = document.querySelector('.node.root').getBoundingClientRect();
      const kid = document.querySelector('.node[data-id="M1"]').getBoundingClientRect();
      return { dx: kid.x - root.x, dy: kid.y - root.y, tb: document.body.classList.contains('layout-tb') };
    });
    assert.equal(tbSpread.tb, true);
    assert.ok(tbSpread.dy > 20, `first layer top-down should sit children below ${JSON.stringify(tbSpread)}`);
    const tbWrap = await preview.evaluate(() => {
      const boxes = ['M1', 'M2', 'M3', 'M4', 'M5'].map(id => {
        const r = document.querySelector(`.node[data-id="${id}"]`).getBoundingClientRect();
        return { id, y: Math.round(r.top), x: Math.round(r.left) };
      });
      const bands = [];
      boxes.forEach(b => {
        if (!bands.some(y => Math.abs(y - b.y) < 24)) bands.push(b.y);
      });
      const ys = boxes.map(b => b.y);
      return { boxes, bands: bands.length, ySpan: Math.max(...ys) - Math.min(...ys) };
    });
    assert.ok(tbWrap.bands >= 2 && tbWrap.ySpan > 40, `top-down should wrap children, not one row ${JSON.stringify(tbWrap)}`);
    await dirToggle.locator('.dir-opt[data-dir="lr"]').click();
    recordCheck('layout-dir-on-first-layer');
    recordCheck('layout-tb-wraps');
    await preview.locator('#btn-rel').click();
    await preview.locator('.node[data-id="M2"]').click();
    await preview.locator('.flow-lab').first().waitFor({ state: 'visible' });
    const flowLabs = await preview.evaluate(() => {
      const labs = [...document.querySelectorAll('.flow-lab')].map(el => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      });
      const hits = [];
      for (let i = 0; i < labs.length; i++) {
        for (let j = i + 1; j < labs.length; j++) {
          const a = labs[i], b = labs[j];
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
            hits.push([a.text, b.text]);
          }
        }
      }
      const box = id => {
        const r = document.querySelector(`.node[data-id="${id}"]`).getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      };
      const m2 = box('M2'), m4 = box('M4');
      const mid = { cx: (m2.cx + m4.cx) / 2, cy: (m2.cy + m4.cy) / 2 };
      const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
      const pair = labs.filter(l => l.text === '安装时可选 hooks' || l.text === 'SessionStart 触发冷启动');
      const awayFromApex = pair.filter(l => dist(l, mid) >= dist(l, m2) || dist(l, mid) >= dist(l, m4));
      return { texts: labs.map(l => l.text), hits, awayFromApex: awayFromApex.map(l => l.text) };
    });
    assert.ok(flowLabs.texts.includes('安装时可选 hooks'), 'hook install label');
    assert.ok(flowLabs.texts.includes('SessionStart 触发冷启动'), 'hook start label');
    assert.deepEqual(flowLabs.hits, [], `overlapping relation labels ${JSON.stringify(flowLabs.hits)}`);
    assert.deepEqual(flowLabs.awayFromApex, [], `labels should stay on the arc, not hug a node: ${flowLabs.awayFromApex.join(',')}`);
    await preview.locator('#btn-rel').click();
    recordCheck('relation-flow-labels');
    await preview.locator('#btn-bugs').click();
    const panelDots = await preview.evaluate(() => [...document.querySelectorAll('#bug-panel-list li[data-bug]')].map(li => {
      const badge = li.querySelector('.bug-status');
      const dot = li.querySelector('.bug-dot');
      const kindOf = el => [...(el?.classList || [])].find(c => c !== 'bug-status' && c !== 'bug-dot') || '';
      return {
        badge: kindOf(badge),
        dot: kindOf(dot),
        bg: dot ? getComputedStyle(dot).backgroundColor : ''
      };
    }));
    assert.ok(panelDots.length >= 8, `preview should show a status board, got ${panelDots.length}`);
    panelDots.forEach(row => {
      assert.equal(row.dot, row.badge, `right-side dot must follow status ${JSON.stringify(row)}`);
    });
    const kinds = new Set(panelDots.map(row => row.badge));
    const colors = new Set(panelDots.map(row => row.bg));
    ["waiting","processing","handoff","resolved","deferred"].forEach(kind => {
      assert.ok(kinds.has(kind), `missing ${kind} in ${[...kinds].join(",")}`);
    });
    assert.ok(colors.size > 1, `different statuses must not share one color ${JSON.stringify(panelDots)}`);
    await preview.locator('#bug-panel-list li[data-bug="B20"]').click();
    await preview.waitForSelector('body.bug-path-mode');
    assert.ok(await preview.locator('#links path.current-flow').count(), 'bug path keeps the moving dashes');
    assert.equal(await preview.locator('.current-bead').count(), 0);
    const previewClaims = await preview.evaluate(() => {
      const rows = [...document.querySelectorAll('#bug-panel-list li[data-bug]')];
      return {
        buttons: document.querySelectorAll('#bug-panel-list [data-claim]').length,
        assign: rows.filter(li => /分配 Session|Assign session/.test(li.textContent || '')).map(li => li.dataset.bug),
        selected: document.querySelector('#bug-panel-list li.on .bug-status')?.textContent || '',
        inspector: document.querySelector('#detail [data-act="claim"]')?.textContent || ''
      };
    });
    assert.deepEqual(previewClaims.assign, [], `preview has no Agent session, so selected rows must not all say Assign session ${JSON.stringify(previewClaims)}`);
    assert.equal(previewClaims.buttons, 0);
    assert.equal(previewClaims.inspector, '');
    assert.match(previewClaims.selected, /处理中|In progress/);
    await preview.locator('#bug-panel-list li[data-bug="B40"]').click();
    const waitingClaim = await preview.evaluate(() => ({
      buttons: document.querySelectorAll('#bug-panel-list [data-claim]').length,
      badge: document.querySelector('#bug-panel-list li.on .bug-status')?.textContent || ''
    }));
    assert.equal(waitingClaim.buttons, 0);
    assert.match(waitingClaim.badge, /待处理|Waiting/);
    await preview.locator('#btn-bug-exit').click();
    if (await preview.evaluate(() => document.body.classList.contains('bugs-open'))) {
      await preview.locator('#btn-bugs').click();
    }
    recordCheck('bug-path-flow-no-bead');
    const child = preview.locator('#nodes .node.module').nth(1);
    const childId = await child.getAttribute('data-id');
    const childTitle = (await child.locator('.m-head span').innerText()).trim();
    await child.click();
    await until(async () => (await preview.locator('#detail [data-ed="title"]').textContent())?.trim() === childTitle);
    assert.equal(await preview.locator('#detail [data-act="module"], #detail [data-act="child"]').count(), 0);
    assert.equal(await preview.locator('#detail .add-hint').count(), 0, 'child inspector omits redundant add-node guidance');
    assert.equal(await preview.locator('#detail button.trash').count(), 1);
    assert.equal(await preview.locator('#detail button.trash .lid').count(), 1);
    await dirToggle.click();
    assert.equal(await preview.evaluate(() => document.body.classList.contains('layout-tb')), true);
    assert.equal(await dirToggle.evaluate(el => el.classList.contains('is-tb')), true);
    await dirToggle.click();
    assert.equal(await preview.evaluate(() => document.body.classList.contains('layout-tb')), false);
    assert.equal(await dirToggle.evaluate(el => el.classList.contains('is-tb')), false);
    recordCheck('layout-dir-slide');
    await preview.locator('#btn-auth').click();
    await preview.locator(`#nodes .node[data-id="${childId}"]`).click();
    assert.equal(await preview.locator('.sync-notice').evaluate(el => el.hidden), true, 'auth click must not force readonly');
    await preview.locator('#btn-auth').click();
    if (await preview.locator('.nav-crumbs a').count()) {
      await preview.locator('.nav-crumbs a').first().click();
      await preview.waitForFunction(() => !document.querySelector('.nav-crumbs a') && document.querySelector('.nav-crumbs .here.switch'));
    }
    assert.equal(await preview.locator('#detail button.trash').count(), 0, 'map root has no trash');
    assert.equal(await preview.locator('#detail .add-hint').count(), 0, 'root inspector omits redundant add-node guidance');
    await preview.locator('.node.root .add-child').click();
    const rootPick = preview.locator('.node.root .add-pick');
    assert.equal(await rootPick.evaluate(el => getComputedStyle(el).display), 'flex', 'plus must open a kind picker');
    assert.equal(await preview.locator('[data-ed="compose-title"]').count(), 0, 'plus must not start compose until a kind is chosen');
    assert.equal(await preview.locator('.nav-crumbs a').count(), 0, 'plus must not enter a module');
    const pickShadow = await rootPick.evaluate(el => getComputedStyle(el).boxShadow);
    assert.ok(pickShadow === 'none' || pickShadow === '', `kind picker must have no shadow, got ${pickShadow}`);
    await rootPick.locator('[data-add="work"]').click();
    assert.equal((await preview.locator('[data-ed="compose-title"]').textContent())?.trim(), '子节点名称');
    await preview.locator('[data-act="compose-cancel"]').click();
    await preview.locator('.node.root .add-child').click();
    await preview.locator('.node.root .add-pick [data-add="module"]').click();
    assert.equal((await preview.locator('[data-ed="compose-title"]').textContent())?.trim(), '模块名称');
    await preview.locator('[data-act="compose-cancel"]').click();
    await preview.locator('.node[data-id="M1"] .add-child').click();
    assert.equal(await preview.locator('.nav-crumbs a').count(), 0, 'plus on a child module must not drill in');
    assert.equal(await preview.locator('.node[data-id="M1"].picking .add-pick').count(), 1);
    recordCheck('map-plus-picks-kind');
    const chromeGap = await preview.evaluate(() => {
      const header = document.querySelector('header.top').getBoundingClientRect();
      const vp = document.getElementById('viewport').getBoundingClientRect();
      return { headerBottom: header.bottom, headerTop: header.top, vpTop: vp.top, overlap: header.bottom - vp.top };
    });
    assert.ok(chromeGap.vpTop + 0.51 >= chromeGap.headerBottom, `canvas must start at the header bottom, not under it ${JSON.stringify(chromeGap)}`);
    const readClip = () => preview.evaluate(() => {
      const header = document.querySelector('header.top').getBoundingClientRect();
      const vp = document.getElementById('viewport').getBoundingClientRect();
      const y = header.bottom - 3;
      const hits = [];
      for (let x = 40; x <= 900; x += 20) {
        const el = document.elementFromPoint(x, y);
        if (el && el.closest && el.closest('#nodes .node')) hits.push(x);
      }
      const overlapping = [...document.querySelectorAll('#nodes .node')].filter(el => {
        const r = el.getBoundingClientRect();
        return r.bottom > header.bottom - 1 && r.top < header.bottom && r.right > 8 && r.left < window.innerWidth - 8;
      }).length;
      return { hits, overlapping, vpTop: vp.top, headerBottom: header.bottom };
    });
    const emptyPanFrom = () => preview.evaluate(() => {
      const vp = document.getElementById('viewport').getBoundingClientRect();
      for (let y = vp.bottom - 48; y > vp.top + 36; y -= 28) {
        for (let x = vp.left + 28; x < Math.min(vp.right - 28, 720); x += 36) {
          const el = document.elementFromPoint(x, y);
          if (el && !el.closest('.node') && el.closest('#viewport')) return { x, y };
        }
      }
      return { x: vp.left + 48, y: Math.min(vp.bottom - 40, vp.top + 320) };
    });
    let headerCutsNode = await readClip();
    for (let i = 0; i < 8 && headerCutsNode.overlapping === 0; i++) {
      const panFrom = await emptyPanFrom();
      await preview.mouse.move(panFrom.x, panFrom.y);
      await preview.mouse.down();
      await preview.mouse.move(panFrom.x, Math.max(16, panFrom.y - 480), { steps: 12 });
      await preview.mouse.up();
      headerCutsNode = await readClip();
    }
    if (headerCutsNode.overlapping === 0) {
      await preview.evaluate(() => {
        const header = document.querySelector('header.top').getBoundingClientRect();
        const node = document.querySelector('#nodes .node');
        const world = document.getElementById('world');
        if (!node || !world) return;
        const r = node.getBoundingClientRect();
        const dy = r.top - (header.bottom - 16);
        const cur = new DOMMatrix(getComputedStyle(world).transform);
        world.style.transform = `translate(${cur.e}px, ${cur.f - dy}px) scale(${cur.a || 1})`;
      });
      headerCutsNode = await readClip();
    }
    assert.ok(headerCutsNode.vpTop + 0.51 >= headerCutsNode.headerBottom, `panning must not tuck the canvas under the header ${JSON.stringify(headerCutsNode)}`);
    assert.ok(headerCutsNode.overlapping > 0, `a node box must reach the header strip ${JSON.stringify(headerCutsNode)}`);
    assert.equal(headerCutsNode.hits.length, 0, `panning a node under the header must clip, not slice a dead pill ${JSON.stringify(headerCutsNode)}`);
    const deadPill = await preview.evaluate(() => {
      const header = document.querySelector('header.top').getBoundingClientRect();
      const vp = document.getElementById('viewport').getBoundingClientRect();
      const clipTop = Math.max(vp.top, header.bottom);
      const slivers = [...document.querySelectorAll('#nodes .node')].flatMap(node => {
        if (getComputedStyle(node).visibility === 'hidden') return [];
        const r = node.getBoundingClientRect();
        const above = clipTop - r.top;
        const below = r.bottom - clipTop;
        if (above > 1 && below > 0 && below < 36) return [{ vis: Math.round(below), id: node.dataset.id }];
        return [];
      });
      const yHits = [];
      for (let x = 40; x <= 900; x += 16) {
        const el = document.elementFromPoint(x, clipTop + 4);
        const node = el && el.closest && el.closest('#nodes .node');
        if (!node) continue;
        const r = node.getBoundingClientRect();
        const visH = Math.min(r.bottom, vp.bottom) - Math.max(r.top, clipTop);
        if (visH > 0 && visH < 36) yHits.push({ visH: Math.round(visH), id: node.dataset.id });
      }
      return { clipTop, headerBottom: header.bottom, vpTop: vp.top, slivers, yHits };
    });
    assert.equal(deadPill.slivers.length, 0, `thin clipped node must not show as a pill under the header ${JSON.stringify(deadPill)}`);
    assert.equal(deadPill.yHits.length, 0, `no dead pill hit-test under the header ${JSON.stringify(deadPill)}`);
    recordCheck('static-preview-node-click');
    await preview.goto(`http://127.0.0.1:${port}/workbench.html?preview=1&phone=1`);
    await preview.waitForSelector('.node .add-child');
    const ghostPlus = await preview.evaluate(() =>
      [...document.querySelectorAll('.node:not(.selected) .add-child')].map(el => Number(getComputedStyle(el).opacity))
    );
    assert.ok(ghostPlus.length, 'phone nodes have add-child');
    assert.ok(ghostPlus.every(o => o === 0), `unselected pluses must be hidden on phone, got ${ghostPlus.join(',')}`);
    const banners = await preview.evaluate(() => {
      const vh = window.innerHeight, vw = window.innerWidth;
      return [...document.querySelectorAll('.theme-preview-banner, .phone-preview-banner')].map(el => {
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        const shown = s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0;
        return { shown, h: Math.round(r.height), w: Math.round(r.width), covers: shown && (r.height > vh * 0.2 || r.width > vw * 0.45) };
      });
    });
    assert.ok(banners.every(b => !b.shown && !b.covers), `phone preview banners must not cover the map ${JSON.stringify(banners)}`);
    recordCheck('phone-preview-banners-hidden');
    recordCheck('phone-add-child-hidden');
    await preview.goto(`http://127.0.0.1:${port}/workbench.html?https://raw.githubusercontent.com/example/repo/sha/prototype/workbench.html?gallery=1`);
    await preview.waitForSelector('.g-item');
    const gallery = await preview.evaluate(() => {
      const items = [...document.querySelectorAll('.g-item')];
      const names = items.map(el => el.querySelector('.g-num')?.textContent || '');
      const bars = items.filter(el => el.querySelector('.g-chrome .bar'));
      const stages = items.filter(el => el.querySelector('.g-chrome .stage .map') && el.querySelector('.g-chrome .insp'));
      const cards = items.map(el => el.querySelectorAll('.bar .here').length);
      return {
        n: items.length,
        uniq: new Set(names).size,
        bars: bars.length,
        stages: stages.length,
        oneCard: cards.every(n => n === 1),
        title: document.querySelector('.g-bar b')?.textContent
      };
    });
    assert.equal(gallery.n, 50, `chrome gallery should show 50 drafts ${JSON.stringify(gallery)}`);
    assert.equal(gallery.uniq, 50);
    assert.equal(gallery.bars, 50);
    assert.equal(gallery.stages, 50, `each draft must show the full workbench ${JSON.stringify(gallery)}`);
    assert.equal(gallery.oneCard, true, 'each draft has one context card');
    assert.equal(gallery.title, '工作台风格 · 50 版');
    const frozen = await preview.evaluate(() => {
      const pick = id => {
        const item = document.querySelector('#v' + id);
        const cs = el => getComputedStyle(el);
        const map = item.querySelector('.map');
        const root = item.querySelector('.root');
        const mod = item.querySelector('.mod');
        const insp = item.querySelector('.insp');
        const bar = item.querySelector('.bar');
        const note = item.querySelector('.note');
        const hint = item.querySelector('.add-hint');
        const trash = item.querySelector('.who .trash');
        return {
          mapBg: cs(map).backgroundColor,
          rootBg: cs(root).backgroundColor,
          modBg: cs(mod).backgroundColor,
          inspBg: cs(insp).backgroundColor,
          inspBorder: cs(insp).borderLeftColor,
          noteBg: cs(note).backgroundColor,
          hint: hint?.textContent?.trim() || '',
          trashH: Math.round(trash.getBoundingClientRect().height),
          barBg: cs(bar).backgroundColor
        };
      };
      return { a: pick('01'), b: pick('12'), c: pick('32'), d: pick('25') };
    });
    assert.equal(frozen.a.mapBg, 'rgb(254, 250, 242)', `live canvas cream ${frozen.a.mapBg}`);
    assert.equal(frozen.a.rootBg, 'rgb(255, 243, 191)');
    assert.equal(frozen.a.modBg, 'rgb(243, 234, 214)');
    assert.equal(frozen.a.inspBg, 'rgb(254, 250, 242)');
    assert.equal(frozen.a.noteBg, 'rgb(255, 255, 255)');
    assert.equal(frozen.a.hint, '要加模块或节点，去图上点 ＋。这里不放按钮。');
    assert.equal(frozen.a.trashH, 36);
    for (const other of [frozen.b, frozen.c, frozen.d]) {
      assert.equal(other.mapBg, frozen.a.mapBg, `map must stay live ${JSON.stringify(other)}`);
      assert.equal(other.rootBg, frozen.a.rootBg);
      assert.equal(other.modBg, frozen.a.modBg);
      assert.equal(other.inspBg, frozen.a.inspBg);
      assert.equal(other.noteBg, frozen.a.noteBg);
    }
    assert.notEqual(frozen.a.barBg, frozen.b.barBg, 'ink bar still differs from live chrome');
    assert.notEqual(frozen.a.barBg, frozen.c.barBg, 'blueprint bar still differs from live chrome');
    recordCheck('chrome-gallery-50');
    await preview.goto(`http://127.0.0.1:${port}/workbench.html?https://raw.githubusercontent.com/example/repo/sha/prototype/workbench.html?gallery=add`);
    await preview.waitForSelector('.g-add-mock');
    const addGal = await preview.evaluate(() => {
      const items = [...document.querySelectorAll('.g-item')];
      const names = items.map(el => el.querySelector('.g-num')?.textContent || '');
      const mocks = items.filter(el => el.querySelector('.g-add-mock'));
      const slots = items.map(el => el.querySelector('.slot')?.innerHTML || '');
      const titles = items.map(el => el.querySelector('h2')?.childNodes[0]?.textContent?.trim());
      const notes = items.map(el => el.querySelectorAll('.note').length);
      return {
        n: items.length,
        uniq: new Set(names).size,
        mocks: mocks.length,
        slotUniq: new Set(slots).size,
        title: document.querySelector('.g-bar b')?.textContent,
        cold: titles.every(t => t === '冷启动'),
        threeNotes: notes.every(n => n === 3)
      };
    });
    assert.equal(addGal.n, 50, `add-row gallery should show 50 drafts ${JSON.stringify(addGal)}`);
    assert.equal(addGal.uniq, 50);
    assert.equal(addGal.mocks, 50);
    assert.ok(addGal.slotUniq >= 48, `add slots must differ, got ${addGal.slotUniq}`);
    assert.equal(addGal.title, '新增这一行 · 50 版');
    assert.equal(addGal.cold, true, 'title stays 冷启动');
    assert.equal(addGal.threeNotes, true, 'memory/idea/bug cards stay');
    const addFrozen = await preview.evaluate(() => {
      const pick = id => {
        const item = document.querySelector('#v' + id);
        const cs = el => getComputedStyle(el);
        const mock = item.querySelector('.g-add-mock');
        const lead = item.querySelector('.lead');
        const note = item.querySelector('.note');
        const h2 = item.querySelector('h2');
        return {
          bg: cs(mock).backgroundColor,
          pad: cs(mock).padding,
          lead: cs(lead).color,
          noteBg: cs(note).backgroundColor,
          h2: cs(h2).fontSize
        };
      };
      const slot = id => document.querySelector('#v' + id + ' .slot').innerHTML;
      return { a: pick('01'), b: pick('12'), c: pick('33'), s1: slot('01'), s2: slot('03'), s3: slot('09') };
    });
    assert.equal(addFrozen.a.bg, 'rgb(254, 250, 242)');
    assert.equal(addFrozen.a.noteBg, 'rgb(255, 255, 255)');
    assert.equal(addFrozen.a.h2, '18px');
    assert.equal(addFrozen.b.bg, addFrozen.a.bg);
    assert.equal(addFrozen.c.noteBg, addFrozen.a.noteBg);
    assert.notEqual(addFrozen.s1, addFrozen.s2);
    assert.notEqual(addFrozen.s1, addFrozen.s3);
    recordCheck('add-row-gallery-50');
    await preview.goto(`http://127.0.0.1:${port}/workbench.html?https://raw.githubusercontent.com/example/repo/sha/prototype/workbench.html?gallery=trash`);
    await preview.waitForSelector('.g-tr-mock');
    const trashGal = await preview.evaluate(() => {
      const items = [...document.querySelectorAll('.g-item')];
      const names = items.map(el => el.querySelector('.g-num')?.textContent || '');
      const mocks = items.filter(el => el.querySelector('.g-tr-mock'));
      const icons = items.map(el => el.querySelector('.ico')?.innerHTML || '');
      const titles = items.map(el => el.querySelector('h2')?.textContent?.trim());
      const pe = items[0] ? getComputedStyle(items[0].querySelector('.g-tr-mock')).pointerEvents : '';
      return {
        n: items.length,
        uniq: new Set(names).size,
        mocks: mocks.length,
        iconUniq: new Set(icons).size,
        title: document.querySelector('.g-bar b')?.textContent,
        cold: titles.every(t => t === '冷启动'),
        pe
      };
    });
    assert.equal(trashGal.n, 50, `trash gallery should show 50 drafts ${JSON.stringify(trashGal)}`);
    assert.equal(trashGal.uniq, 50);
    assert.equal(trashGal.mocks, 50);
    assert.ok(trashGal.iconUniq >= 40, `trash icons must differ, got ${trashGal.iconUniq}`);
    assert.equal(trashGal.title, '垃圾桶图标 · 50 版');
    assert.equal(trashGal.cold, true, 'title stays 冷启动');
    assert.equal(trashGal.pe, 'auto', 'hover must reach the icon');
    const frozenTrash = await preview.evaluate(() => {
      const item = document.querySelector('#v01');
      const cs = el => getComputedStyle(el);
      const mock = item.querySelector('.g-tr-mock');
      const ico = item.querySelector('.ico');
      const h2 = item.querySelector('h2');
      return {
        bg: cs(mock).backgroundColor,
        h2: cs(h2).fontSize,
        icoH: Math.round(ico.getBoundingClientRect().height),
        color: cs(ico).color
      };
    });
    assert.equal(frozenTrash.bg, 'rgb(254, 250, 242)');
    assert.equal(frozenTrash.h2, '18px');
    assert.equal(frozenTrash.icoH, 36);
    assert.equal(frozenTrash.color, 'rgb(226, 75, 75)');
    await preview.locator('#v01 .ico').hover();
    const lidMove = await preview.locator('#v01 .ico .lid').evaluate(el => getComputedStyle(el).transform);
    assert.notEqual(lidMove, 'none', `lid should lift on hover, got ${lidMove}`);
    recordCheck('trash-icon-gallery-50');
    await preview.goto(`http://127.0.0.1:${port}/workbench.html?https://raw.githubusercontent.com/example/repo/sha/prototype/workbench.html?gallery=chip`);
    await preview.waitForSelector('.g-ch-mock');
    const chipGal = await preview.evaluate(() => {
      const items = [...document.querySelectorAll('.g-item')];
      const names = items.map(el => el.querySelector('.g-num')?.textContent || '');
      const mocks = items.filter(el => el.querySelector('.g-ch-mock'));
      const chips = items.map(el => {
        const c = el.querySelector('.who .chip');
        if (!c) return '';
        const s = getComputedStyle(c);
        const b = getComputedStyle(c, '::before');
        const a = getComputedStyle(c, '::after');
        return [s.padding, s.fontSize, s.fontWeight, s.letterSpacing, b.backgroundColor, b.backgroundImage, b.transform, b.top, b.bottom, b.left, b.right, b.opacity, b.borderRadius, b.boxShadow, a.content].join('|');
      });
      const titles = items.map(el => el.querySelector('h2')?.textContent?.trim());
      const altN = items.map(el => el.querySelectorAll('.alts .chip').length);
      return {
        n: items.length,
        uniq: new Set(names).size,
        mocks: mocks.length,
        chipUniq: new Set(chips).size,
        title: document.querySelector('.g-bar b')?.textContent,
        cold: titles.every(t => t === '冷启动'),
        threeAlts: altN.every(n => n === 3)
      };
    });
    assert.equal(chipGal.n, 50, `chip gallery should show 50 drafts ${JSON.stringify(chipGal)}`);
    assert.equal(chipGal.uniq, 50);
    assert.equal(chipGal.mocks, 50);
    assert.ok(chipGal.chipUniq >= 40, `chips must differ, got ${chipGal.chipUniq}`);
    assert.equal(chipGal.title, '状态标签 · 50 版');
    assert.equal(chipGal.cold, true, 'title stays 冷启动');
    assert.equal(chipGal.threeAlts, true, 'each draft shows the other three states');
    const frozenChip = await preview.evaluate(() => {
      const item = document.querySelector('#v01');
      const cs = el => getComputedStyle(el);
      const mock = item.querySelector('.g-ch-mock');
      const h2 = item.querySelector('h2');
      const chip = item.querySelector('.who .chip');
      const csBefore = getComputedStyle(chip, '::before');
      return {
        bg: cs(mock).backgroundColor,
        h2: cs(h2).fontSize,
        text: chip?.textContent?.trim(),
        chipBg: cs(chip).backgroundColor,
        chipColor: cs(chip).color,
        mark: csBefore.backgroundColor,
        radius: cs(chip).borderRadius
      };
    });
    assert.equal(frozenChip.bg, 'rgb(254, 250, 242)');
    assert.equal(frozenChip.h2, '18px');
    assert.equal(frozenChip.text, '测试通过');
    assert.equal(frozenChip.chipBg, 'rgba(0, 0, 0, 0)');
    assert.equal(frozenChip.chipColor, 'rgb(45, 45, 45)');
    assert.equal(frozenChip.radius, '0px');
    assert.equal(frozenChip.mark, 'rgb(198, 237, 110)');
    const picked = await preview.evaluate(() => {
      const b = getComputedStyle(document.querySelector('#v11 .who .chip'), '::before');
      return { rad: b.borderRadius };
    });
    assert.equal(picked.rad, '8px', 'gallery 11 is the round-head marker');
    const upright = await preview.evaluate(() => {
      const check = sel => {
        const item = document.querySelector(sel);
        const cs = el => getComputedStyle(el);
        const els = {
          h2: item.querySelector('h2'),
          chip: item.querySelector('.who .chip'),
          lead: item.querySelector('.lead'),
          alt: item.querySelector('.alts .chip'),
          num: item.querySelector('.g-num')
        };
        return Object.fromEntries(Object.entries(els).map(([k, el]) => {
          const s = cs(el);
          return [k, { style: s.fontStyle, family: s.fontFamily, synth: s.fontSynthesis }];
        }));
      };
      return {
        iChips: document.querySelectorAll('i.chip').length,
        v09: check('#v09'),
        v16: check('#v16'),
        v28: check('#v28')
      };
    });
    assert.equal(upright.iChips, 0, 'chips must be spans, not <i>');
    for (const id of ['v09', 'v16', 'v28']) {
      const block = upright[id];
      for (const part of ['h2', 'chip', 'lead', 'alt', 'num']) {
        assert.equal(block[part].style, 'normal', `${id} ${part} font-style`);
        assert.match(block[part].family, /Noto Sans SC/, `${id} ${part} family ${block[part].family}`);
        assert.doesNotMatch(block[part].family, /Comic Neue|Georgia|Libre Baskerville|Songti|cursive/i, `${id} ${part} still slanted family`);
        assert.equal(block[part].synth, 'none', `${id} ${part} font-synthesis`);
      }
    }
    recordCheck('state-chip-gallery-50');
  } finally {
    await preview.close();
    await new Promise(resolve => staticServer.close(resolve));
  }
  await page.screenshot({ path: path.join(output, 'synced.png'), fullPage: true });
  assert.deepEqual(errors, []);
  passed = true;
  console.log(JSON.stringify({ output, checks, errors }));
} catch (e) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  // Only synthetic fixture text/errors; no HTTP headers, tokens, or user directories.
  await fs.writeFile(path.join(output, 'failure.txt'), `stage=${stage}\n${e.stack}\n${JSON.stringify(errors)}`);
  console.error(`Browser CI failed at ${stage}; fixture retained at ${sandbox}`);
  throw e;
} finally {
  try { if (browser) await browser.close(); }
  finally {
    if (running) await running.close();
    await stopIsolatedProxy();
    await fs.writeFile(path.join(output, 'results.json'), encode({ passed, stage, checks, errors }));
    if (passed) {
      const resolved = await fs.realpath(sandbox), temporary = await fs.realpath(os.tmpdir());
      assert.equal(path.dirname(resolved), temporary);
      assert.ok(path.basename(resolved).startsWith('cg-browser-ci-'));
      await fs.rm(resolved, { recursive: true, force: true });
    }
  }
}
