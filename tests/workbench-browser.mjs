import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { startServer } from '../scripts/workbench/server.mjs';
import { encode, pause, hash } from '../scripts/workbench/io.mjs';
import { isolatedEnvironment, run } from '../.github/scripts/client-protocol.mjs';
import { chromium } from 'playwright';
const workspace = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.argv[2] || `output/playwright/browser-ci/${Date.now()}-${randomUUID()}`);
await fs.mkdir(output, { recursive: true });
// Keep fixtures outside the checkout: init resolves a nested directory to its Git root.
const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-browser-ci-'));
const root = path.join(sandbox, 'project'), ctx = path.join(root, '.codex/context');
const env = isolatedEnvironment(sandbox);
const session = 'browser-test-agent';
const mapPath = path.join(ctx, 'map.json');
const node = { id: 'N1', title: '原始节点', purpose: '用于正式画布验证', kind: 'work', proposal: 'accepted', state: 'dirty', memories: [], ideas: [], bugs: [], dormant: [], files: [], owns: [], children: [] };
const doc = { v: 1, project: 'browser-test', bootstrap: 'ready', extra: { preserved: true }, root: { ...node, id: 'T0', title: '浏览器验收', kind: 'module', children: [node] } };
let running, browser, page, passed = false, stage = 'isolated-hook-bootstrap';
const errors = [], checks = [];
function recordCheck(name) { checks.push(name); console.log(`Browser check passed: ${name}`); }
const read = async () => JSON.parse(await fs.readFile(mapPath, 'utf8'));
async function until(fn, timeout = 6000) { const end = Date.now() + timeout; while (!await fn()) { if (Date.now() >= end) throw new Error('condition timed out'); await pause(25); } }
const synchronized = () => page.waitForFunction(() => document.querySelector('#cg-sync')?.dataset.status === 'synced');
async function servePrototype() {
  const protoDir = path.join(workspace, 'prototype');
  const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
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
try {
  await fs.mkdir(root);
  const python = (process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']).find(command => {
    const result = spawnSync(command, ['--version'], { env, encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return result.status === 0 && /^Python 3\./m.test(`${result.stdout}\n${result.stderr}`);
  });
  assert.ok(python, 'Python 3 is required for the real SessionStart hook');
  await run(python, [path.join(workspace, 'scripts/context_guard_hook.py'), 'session-start', '--platform', 'codex'], {
    cwd: root, env, input: JSON.stringify({ cwd: root, session_id: session, is_background_agent: true }), timeout: 20000,
  });
  const sessions = (await fs.readFile(path.join(ctx, 'sessions.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(sessions.some(event => event.session_id === session && event.event === 'session-start'));
  assert.ok((await fs.stat(path.join(ctx, 'sessions', `${session}.md`))).isFile());
  await run(process.execPath, [path.join(workspace, 'bin/context-guard-skill.js'), 'set-language', '--root', root, '--language', 'zh'], { cwd: root, env });
  await fs.writeFile(mapPath, encode(doc));
  running = await startServer({ root, port: 0 });
  browser = await chromium.launch({ headless: true, env });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  recordCheck('real-hook-session-bootstrap');
  stage = 'bidirectional-sync';
  const legacy = { repos: { 'browser-test': { live: { ...doc.root, title: '旧缓存绝不能回盖' } } }, repoId: 'browser-test' };
  await page.addInitScript(value => localStorage.setItem('cg-workbench-maps-v16', JSON.stringify(value)), legacy);
  await page.goto(running.state.url); await synchronized();
  assert.equal((await read()).root.title, '浏览器验收'); recordCheck('legacy-cache-not-written');
  const chrome = await chromeHeights(page);
  assert.ok(chrome.length >= 3, 'chrome buttons are on screen');
  assert.equal(new Set(chrome).size, 1, `chrome button heights ${chrome.join(',')}`);
  const moduleBtn = page.locator('#detail [data-act="module"]');
  if (await moduleBtn.count()) {
    const actH = await moduleBtn.evaluate(el => Math.round(el.getBoundingClientRect().height));
    assert.equal(actH, chrome[0], `inspector ＋模块 height ${actH} vs chrome ${chrome[0]}`);
  }
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
  await page.locator('#detail [data-act="grant"]').click();
  await until(() => running.access.grants('browser-test-agent').includes('N1'));
  let current = await cli('read'); assert.equal(current.code, 0); assert.equal(current.version, hash(await fs.readFile(mapPath))); recordCheck('human-to-agent-fence');
  assert.equal((await cli('inbox', undefined, ['--start'])).initialized, true);
  const staleVersion = current.version;
  let result = await cli('apply', { baseVersion: current.version, operationId: randomUUID(), operations: [{ type: 'update', id: 'N1', fields: { title: 'Agent CLI 更新' } }] });
  assert.equal(result.committed, true); await page.waitForFunction(() => document.querySelector('#detail [data-ed="title"]')?.textContent === 'Agent CLI 更新'); recordCheck('agent-cli-to-page');
  assert.equal((await cli('inbox')).pending, false, 'Own commits must not create a feedback loop');
  await cli('apply', { baseVersion: staleVersion, operationId: randomUUID(), operations: [{ type: 'update', id: 'N1', fields: { title: '旧版本不能覆盖' } }] }, [], 'VERSION_CONFLICT');
  assert.equal((await read()).root.children[0].title, 'Agent CLI 更新'); recordCheck('stale-version-rejected');
  stage = 'human-confirmation';
  current = await cli('read');
  const create = { baseVersion: current.version, operationId: randomUUID(), operations: [{ type: 'create', parentId: 'T0', node: { id: 'N2', title: 'Agent 提议' } }] };
  result = await cli('apply', create); assert.equal(result.committed, true); assert.equal((await cli('apply', create)).duplicate, true);
  assert.equal((await read()).root.children.filter(x => x.id === 'N2').length, 1);
  assert.equal((await read()).root.children.find(x => x.id === 'N2').proposal, 'proposed');
  current = await cli('read');
  await cli('apply', { baseVersion: current.version, operationId: randomUUID(), operations: [{ type: 'update', id: 'N2', fields: { proposal: 'accepted' } }] }, [], 'FORBIDDEN');
  assert.equal((await read()).root.children.find(x => x.id === 'N2').proposal, 'proposed');
  assert.equal((await cli('inbox')).pending, false); recordCheck('retry-deduplication-and-no-self-confirmation');
  await page.locator('.node[data-id="N2"]').click(); await page.locator('#detail [data-act="accept"]').click(); await synchronized();
  await until(async () => (await read()).root.children.find(x => x.id === 'N2')?.proposal === 'accepted'); recordCheck('proposal-human-confirmation');
  stage = 'inbox-ack';
  const confirmation = await cli('inbox');
  assert.equal(confirmation.pending, true);
  assert.equal(confirmation.changes.find(x => x.id === 'N2').fields.proposal.after.value, 'accepted');
  assert.ok(confirmation.events.some(event => event.actor.kind === 'human'));
  assert.equal((await cli('inbox')).receipt, confirmation.receipt);
  await cli('ack', undefined, ['--receipt', 'invalid-receipt'], 'RECEIPT_MISMATCH');
  await page.locator('#detail [data-act="child"]').click(); await page.locator('[data-ed="compose-title"]').fill('人类新增子节点'); await page.locator('[data-act="compose-ok"]').click(); await synchronized();
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
  const second = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); second.on('pageerror', e => errors.push(e.message));
  await second.goto(running.state.url); await second.waitForSelector('#cg-sync[data-status="synced"]', { state: 'attached' }); await second.locator('.node[data-id="N1"]').click();
  await title.dispatchEvent('compositionstart'); await title.fill('保留的输入法草稿');
  await second.locator('#detail [data-ed="title"]').fill('另一个页面先保存'); await second.locator('#detail [data-ed="title"]').press('Tab');
  await until(async () => (await read()).root.children[0].title === '另一个页面先保存');
  await page.waitForSelector('#cg-sync[data-status="conflict"]', { state: 'attached' }); assert.equal(await title.textContent(), '保留的输入法草稿');
  result = await cli('read', undefined, [], 'UI_PENDING'); recordCheck('multi-page-conflict-and-agent-fence');
  await title.dispatchEvent('compositionend'); await openSyncSettings(); await page.locator('#cg-sync-reload').click(); await synchronized();
  await second.close();
  // A network failure retains the same request; retry saves it without duplication.
  await page.route('**/api/commit', route => route.abort('connectionfailed'));
  await title.fill('断线期间的草稿'); await title.press('Tab'); await page.waitForSelector('#cg-sync[data-status="offline"]', { state: 'attached' });
  assert.notEqual((await read()).root.children[0].title, '断线期间的草稿');
  await page.unroute('**/api/commit'); await openSyncSettings(); await page.locator('#cg-sync-retry').click(); await synchronized();
  assert.equal((await read()).root.children[0].title, '断线期间的草稿'); recordCheck('network-retry');
  const xss = await read(); xss.root.children[0].title = '<img src=x onerror="window.injected=true">'; await fs.writeFile(mapPath, encode(xss));
  await page.waitForFunction(() => document.querySelector('#detail [data-ed="title"]')?.textContent?.startsWith('<img'));
  assert.equal(await page.evaluate(() => !!window.injected), false); recordCheck('map-text-not-html');
  // An existing page reconnects after server restart without losing its local draft.
  const port = new URL(running.state.url).port; await running.close();
  await page.waitForSelector('#cg-sync[data-status="offline"]', { state: 'attached' });
  running = await startServer({ root, port: Number(port) });
  await synchronized();
  await title.fill('服务重启后保存'); await title.press('Tab'); await synchronized();
  assert.equal((await read()).root.children[0].title, '服务重启后保存'); recordCheck('server-reconnect');
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
  stage = 'static-preview-clicks';
  const staticServer = await servePrototype();
  const preview = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  preview.on('pageerror', error => errors.push(error.message));
  try {
    const port = staticServer.address().port;
    await preview.goto(`http://127.0.0.1:${port}/workbench.html?preview=1`);
    await preview.waitForSelector('.node.root');
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
    const barBg = await preview.locator('header.top').evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(barBg, 'rgb(50, 54, 57)', `live top bar stays charcoal ${barBg}`);
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
    await dirToggle.locator('.dir-opt[data-dir="tb"]').click();
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
    await preview.locator('#bug-panel-list li[data-bug="B20"]').click();
    await preview.waitForSelector('body.bug-path-mode');
    assert.ok(await preview.locator('#links path.current-flow').count(), 'bug path keeps the moving dashes');
    assert.equal(await preview.locator('.current-bead').count(), 0);
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
    await dirToggle.locator('.dir-opt[data-dir="tb"]').click();
    assert.equal(await preview.evaluate(() => document.body.classList.contains('layout-tb')), true);
    assert.equal(await dirToggle.evaluate(el => el.classList.contains('is-tb')), true);
    await dirToggle.locator('.dir-opt[data-dir="lr"]').click();
    assert.equal(await preview.evaluate(() => document.body.classList.contains('layout-tb')), false);
    assert.equal(await dirToggle.evaluate(el => el.classList.contains('is-tb')), false);
    recordCheck('layout-dir-slide');
    await preview.locator('#btn-auth').click();
    await preview.locator(`#nodes .node[data-id="${childId}"]`).click();
    assert.equal(await preview.locator('.sync-notice').evaluate(el => el.hidden), true, 'auth click must not force readonly');
    await preview.locator('#btn-auth').click();
    await preview.mouse.move(420, 280);
    await preview.mouse.down();
    await preview.mouse.move(420, 720, { steps: 12 });
    await preview.mouse.up();
    const headerCutsNode = await preview.evaluate(() => {
      const bottom = document.querySelector('header.top').getBoundingClientRect().bottom;
      for (let x = 40; x <= 520; x += 40) {
        const el = document.elementFromPoint(x, bottom - 3);
        if (el && el.closest && el.closest('.node')) return true;
      }
      return false;
    });
    assert.equal(headerCutsNode, false, 'panning a node under the header must clip, not slice a dead pill');
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
        const act = item.querySelector('.acts span');
        return {
          mapBg: cs(map).backgroundColor,
          rootBg: cs(root).backgroundColor,
          modBg: cs(mod).backgroundColor,
          inspBg: cs(insp).backgroundColor,
          inspBorder: cs(insp).borderLeftColor,
          noteBg: cs(note).backgroundColor,
          actH: Math.round(act.getBoundingClientRect().height),
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
    assert.equal(frozen.a.actH, 36);
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
    await fs.writeFile(path.join(output, 'results.json'), encode({ passed, stage, checks, errors }));
    if (passed) {
      const resolved = await fs.realpath(sandbox), temporary = await fs.realpath(os.tmpdir());
      assert.equal(path.dirname(resolved), temporary);
      assert.ok(path.basename(resolved).startsWith('cg-browser-ci-'));
      await fs.rm(resolved, { recursive: true, force: true });
    }
  }
}
