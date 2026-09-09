import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createWorkbenchPasswordHash, startCloudServer } from '../scripts/cloud/server.mjs';

const execFileAsync = promisify(execFile);
const git = async (root, ...args) => (await execFileAsync('git', args, { cwd: root, windowsHide: true })).stdout.trim();
const output = path.resolve(process.argv[2] || `output/playwright/browser-ci/cloud-${Date.now()}-${randomUUID()}`);
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-cloud-browser-'));
const repository = path.join(dataDir, 'repository');
const memoryConfig = {
  dataDir: path.join(dataDir, 'memory'),
  adminToken: 'memory-admin',
  projects: { 'context-guard': { token: 'project-memory-token', root: repository, ref: 'refs/heads/main' } },
};
const mainMap = {
  v: 1,
  project: 'Context Guard',
  bootstrap: 'ready',
  flows: [],
  root: { id: 'T0', title: 'Main map', purpose: 'published baseline', kind: 'module', state: 'dirty', memories: [], ideas: [], todos: [], bugs: [], dormant: [], files: [], owns: [], children: [] },
};
const sessionMap = structuredClone(mainMap);
sessionMap.root.title = 'Session map';
sessionMap.root.purpose = 'private working state';

let service;
let browser;
let context;
let page;
let passed = false;
const checks = [];
const record = name => { checks.push(name); console.log(`Cloud browser check passed: ${name}`); };
const synchronized = () => page.waitForFunction(() => document.querySelector('#cg-sync')?.dataset.status === 'synced');
const syncVersion = () => page.locator('#cg-sync-version').getAttribute('data-version');
const synchronizedAfter = version => page.waitForFunction(previous => {
  const panel = document.querySelector('#cg-sync');
  const current = document.querySelector('#cg-sync-version')?.dataset.version;
  return panel?.dataset.status === 'synced' && current && current !== previous;
}, version);
const headers = token => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const request = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { response, body: await response.json() };
};

try {
  assert.deepEqual(await fs.readFile('prototype/vendor/marked.mjs'), await fs.readFile('node_modules/marked/lib/marked.esm.js'), 'vendor lexer must match the locked dependency');
  assert.deepEqual(await fs.readFile('licenses/Marked-MIT.txt'), await fs.readFile('node_modules/marked/LICENSE.md'), 'ship the upstream license unchanged');
  const markdownDependency=JSON.parse(await fs.readFile('package-lock.json','utf8')).packages['node_modules/marked'];
  assert.equal(markdownDependency.resolved, `https://registry.npmjs.org/marked/-/marked-${markdownDependency.version}.tgz`, 'CI must not depend on a developer-only package mirror');
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(repository);
  await git(repository, 'init', '-b', 'main');
  await git(repository, 'config', 'user.name', 'Cloud Browser Test');
  await git(repository, 'config', 'user.email', 'cloud-browser@example.invalid');
  await fs.writeFile(path.join(repository, 'version.txt'), 'base\n');
  await git(repository, 'add', 'version.txt');
  await git(repository, 'commit', '-m', 'base');
  const baseSha = await git(repository, 'rev-parse', 'HEAD');
  await git(repository, 'switch', '-c', 'feature');
  await fs.writeFile(path.join(repository, 'version.txt'), 'feature\n');
  await git(repository, 'commit', '-am', 'feature');
  const featureSha = await git(repository, 'rev-parse', 'HEAD');
  await git(repository, 'switch', 'main');
  service = await startCloudServer({
    host: '127.0.0.1',
    port: 0,
    dataDir,
    adminToken: 'cloud-admin',
    browserToken: 'browser-token',
    browserPasswordHash: await createWorkbenchPasswordHash('browser-password'),
    privateAccess: true,
    memoryConfig,
  });
  const baselineSession = await request(`${service.url}/v1/projects/context-guard/sessions/baseline-session`, {
    method: 'POST',
    headers: headers('project-memory-token'),
    body: JSON.stringify({ operationId: 'browser-baseline-session', baseVersion: null, baseMainVersion: null, sourceCommit: baseSha, memory: { map: mainMap, records: {} } }),
  });
  assert.equal(baselineSession.response.status, 200, JSON.stringify(baselineSession.body));
  const baselinePublication = await request(`${service.url}/v1/projects/context-guard/publish`, {
    method: 'POST',
    headers: headers('project-memory-token'),
    body: JSON.stringify({ operationId: 'browser-baseline-publish', baseVersion: null, sessionId: 'baseline-session', sessionVersion: baselineSession.body.snapshot.version, expectedMainSha: baseSha }),
  });
  assert.equal(baselinePublication.response.status, 200, JSON.stringify(baselinePublication.body));
  const seededMain = await request(`${service.url}/api/projects/context-guard/snapshot`, {
    method: 'POST',
    headers: headers('cloud-admin'),
    body: JSON.stringify({ baseVersion: null, operationId: 'browser-main-seed', document: mainMap }),
  });
  assert.equal(seededMain.response.status, 200, JSON.stringify(seededMain.body));
  const seededSession = await request(`${service.url}/v1/projects/context-guard/sessions/session-one`, {
    method: 'POST',
    headers: headers('project-memory-token'),
    body: JSON.stringify({ operationId: 'browser-session-seed', baseVersion: null, baseMainVersion: baselinePublication.body.snapshot.version, sourceCommit: featureSha, memory: { map: sessionMap, records: { 'sessions.jsonl': JSON.stringify({ session_id: 'session-one', thread_name: '修复同步连接', platform: 'codex', event: 'session-start', at: '2026-09-06T00:00:00Z' }) } } }),
  });
  assert.equal(seededSession.response.status, 200, JSON.stringify(seededSession.body));

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`${service.url}/projects/context-guard`);
  assert.equal(new URL(page.url()).pathname, '/login');
  await page.locator('input[name="password"]').fill('browser-password');
  await Promise.all([
    page.waitForURL(/\/projects\/context-guard$/),
    page.locator('button[type="submit"]').click(),
  ]);
  record('Unauthenticated users get a visible password login');
  const authCookie = (await page.context().cookies()).find(cookie => cookie.name === 'cg_workbench');
  assert.ok(authCookie?.httpOnly);
  assert.ok(authCookie?.expires > Date.now() / 1000 + 29 * 24 * 60 * 60);
  await page.reload();
  assert.equal(new URL(page.url()).pathname, '/projects/context-guard');
  const reopened = await page.context().newPage();
  await reopened.goto(`${service.url}/projects/context-guard`);
  assert.equal(new URL(reopened.url()).pathname, '/projects/context-guard');
  await reopened.close();
  record('Persistent cookie keeps login across refresh and a reopened page');
  await synchronized();
  assert.match(await page.locator('.node[data-id="T0"]').textContent(), /Main map/);
  // A failed authoritative read must not load an unrelated static/local Map.
  const startupPage = await context.newPage();
  let fallbackReads = 0;
  await startupPage.route('**/.codex/context/map.json', route => { fallbackReads++; return route.fulfill({ json: sessionMap }); });
  await startupPage.route('**/api/state*', route => route.fulfill({ contentType: 'application/json', body: '{' }));
  let releaseFonts;
  const fontsHeld = new Promise(resolve => { releaseFonts = resolve; });
  await startupPage.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async route => { await fontsHeld; await route.abort(); });
  await startupPage.goto(`${service.url}/projects/context-guard`);
  await startupPage.locator('#cg-sync[data-status="error"]').waitFor({ state: 'attached' });
  assert.equal(fallbackReads, 0);
  assert.equal(await startupPage.getByText('Session map', { exact: true }).count(), 0);
  await startupPage.unroute('**/api/state*');
  await startupPage.locator('#btn-settings').click();
  await startupPage.locator('#cg-sync > summary').click();
  await startupPage.locator('#cg-sync-retry').click();
  await startupPage.locator('#cg-sync[data-status="synced"]').waitFor({ state: 'attached' });
  assert.match(await startupPage.locator('.node[data-id="T0"]').textContent(), /Main map/);
  releaseFonts();
  await startupPage.close();
  record('Failed startup preserves project authority; retry works while external fonts stall');
  assert.equal(await page.locator('body').evaluate(el => el.classList.contains('rel-mode')), false);
  assert.equal(await page.locator('#btn-rel').getAttribute('aria-pressed'), 'false');
  await page.locator('#session-chip').click();
  assert.equal(await page.locator('#session-menu .session-option-name').filter({ hasText: '当前会话' }).count(), 0, 'Cloud overview/project pages have no actual current Session');
  assert.equal(await page.locator('#session-menu [data-session="session-one"] .session-option-name').textContent(), 'codex-修复同步连接');
  assert.doesNotMatch(await page.locator('#session-menu').textContent(), /session-one/);
  assert.doesNotMatch((await page.locator('#cg-sync-session option').allTextContents()).join(' '), /session-one/);
  await page.locator('#session-chip').click();
  record('Main is the default view');

  const pendingPage = await context.newPage();
  const lateSessionId = `late-session-${process.pid}-${Date.now()}`;
  await pendingPage.goto(`${service.url}/projects/context-guard?session=${lateSessionId}`);
  await pendingPage.waitForFunction(id => document.querySelector('#cg-sync-session')?.value === id, lateSessionId);
  assert.equal(new URL(pendingPage.url()).searchParams.get('session'), lateSessionId);
  assert.match(await pendingPage.locator('#cg-sync-status').textContent(), /正在同步到 Cloud/);
  assert.equal(await pendingPage.locator('#cloud-sync-status').getAttribute('aria-label'), '云端同步中');
  assert.equal(await pendingPage.locator(`#cg-sync-session option[value="${lateSessionId}"]`).count(), 1);
  assert.equal(await pendingPage.locator('#cg-sync-session option[value="session-one"]').count(), 1, 'Cloud deep links retain other registered Sessions');
  assert.equal(await pendingPage.locator('#cg-sync-session option[value="__all__"]').count(), 1, 'Cloud deep links retain the Main entry');
  await pendingPage.locator('#session-chip').click();
  assert.equal(await pendingPage.locator('#session-menu [data-session="session-one"]').count(), 1);
  assert.equal(await pendingPage.locator('#session-menu [data-session="__all__"]').count(), 1);
  await pendingPage.locator('#session-chip').click();
  const lateMap = structuredClone(sessionMap);
  lateMap.root.title = 'Late Session map';
  const lateSession = await request(`${service.url}/v1/projects/context-guard/sessions/${lateSessionId}`, {
    method: 'POST',
    headers: headers('project-memory-token'),
    body: JSON.stringify({
      operationId: 'browser-late-session',
      baseVersion: null,
      baseMainVersion: baselinePublication.body.snapshot.version,
      sourceCommit: featureSha,
      memory: { map: lateMap, records: {} },
      client: { sessionId: lateSessionId, hookEvent: 'SessionStart', eventId: 'hook-late-session', occurredAt: new Date().toISOString(), cursor: 0 },
    }),
  });
  assert.equal(lateSession.response.status, 200, JSON.stringify(lateSession.body));
  await pendingPage.waitForFunction(id => document.querySelector('#cg-sync-session')?.value === id && document.querySelector('#cg-sync')?.dataset.status === 'synced', lateSessionId);
  await pendingPage.waitForFunction(() => document.querySelector('.node[data-id="T0"]')?.textContent?.includes('Late Session map'));
  assert.match(await pendingPage.locator('.node[data-id="T0"]').textContent(), /Late Session map/);
  assert.equal(lateSession.body.snapshot.lastSync.sessionId, lateSessionId);
  assert.equal(lateSession.body.snapshot.lastSync.hookEvent, 'SessionStart');
  assert.equal(lateSession.body.snapshot.updatedAt, new Date(lateSession.body.snapshot.updatedAt).toISOString());
  await pendingPage.close();
  record('A pending Session deep link stays selected and opens automatically after Hook-style Cloud registration');

  await page.locator('.cloud-overview-link').click();
  await page.waitForURL(`${service.url}/`);
  assert.match(await page.locator('.node[data-id="P_context-guard"]').textContent(), /Context Guard/);
  await page.locator('.node[data-id="P_context-guard"]').click();
  await page.waitForURL(`${service.url}/projects/context-guard`);
  await synchronized();
  record('Project page has a stable route back to the overview');

  const relationPage = await context.newPage();
  await relationPage.goto(`${service.url}/projects/context-guard?relation=T0#cloud-relation-contract`);
  await relationPage.waitForFunction(() => document.querySelector('#cg-sync')?.dataset.status === 'synced' && document.body.classList.contains('rel-mode'));
  assert.equal(await relationPage.locator('#btn-rel').getAttribute('aria-pressed'), 'true');
  await relationPage.locator('#session-chip').click();
  await relationPage.locator('#session-menu [data-session="session-one"]').click();
  await relationPage.waitForFunction(() => document.querySelector('#cg-sync-session')?.value === 'session-one' && !document.body.classList.contains('rel-mode'));
  const switchedRelationUrl = new URL(relationPage.url());
  assert.equal(switchedRelationUrl.searchParams.get('session'), 'session-one');
  assert.equal(switchedRelationUrl.searchParams.has('relation'), false);
  assert.equal(switchedRelationUrl.hash, '#cloud-relation-contract');
  await relationPage.reload();
  await relationPage.waitForFunction(() => document.querySelector('#cg-sync')?.dataset.status === 'synced' && document.querySelector('#cg-sync-session')?.value === 'session-one');
  assert.equal(await relationPage.locator('body').evaluate(el => el.classList.contains('rel-mode')), false);
  await relationPage.close();
  record('Relation mode requires an explicit action or deep link and resets on Session switch');

  await page.locator('#session-chip').click();
  await page.locator('#session-menu [data-session="session-one"]').click();
  await page.waitForFunction(() => document.querySelector('#cg-sync-session')?.value === 'session-one');
  await synchronized();
  assert.equal(new URL(page.url()).searchParams.get('session'), 'session-one');
  assert.match(await page.locator('.node[data-id="T0"]').textContent(), /Session map/);
  record('Session selector changes the Map scope');

  await page.locator('.node[data-id="T0"]').click();
  const title = page.locator('#detail [data-ed="title"]');
  const beforeEditVersion = await syncVersion();
  await title.fill('Session map edited in browser');
  await page.waitForFunction(() => ['draft', 'saving', 'persisted'].includes(document.querySelector('#cg-sync')?.dataset.status));
  await title.blur();
  await synchronizedAfter(beforeEditVersion);
  const savedSession = await request(`${service.url}/v1/projects/context-guard/sessions/session-one`, { headers: headers('project-memory-token') });
  assert.equal(savedSession.body.snapshot.version, await syncVersion());
  assert.equal(savedSession.body.snapshot.memory.map.root.title, 'Session map edited in browser');
  assert.equal(savedSession.body.snapshot.updatedAt, new Date(savedSession.body.snapshot.updatedAt).toISOString());
  const unchangedMain = await request(`${service.url}/api/projects/context-guard/map`, { headers: headers('cloud-admin') });
  assert.equal(unchangedMain.body.document.root.title, 'Main map');
  record('Session edit is durably stored without changing Main');

  await page.reload();
  await synchronized();
  await page.locator('#session-chip').click();
  await page.locator('#session-menu [data-session="session-one"]').click();
  await page.waitForFunction(() => document.querySelector('#cg-sync-session')?.value === 'session-one');
  await synchronized();
  assert.match(await page.locator('.node[data-id="T0"]').textContent(), /Session map edited in browser/);
  record('Browser refresh restores the persisted Session edit');

  const conflictBase = await syncVersion();
  let interceptedResolve, releaseResolve;
  const intercepted = new Promise(resolve => { interceptedResolve = resolve; });
  const release = new Promise(resolve => { releaseResolve = resolve; });
  const commitRoute = /\/api\/workbench\/projects\/context-guard\/api\/commit/;
  await page.route(commitRoute, async route => {
    interceptedResolve();
    await release;
    await route.continue();
  });
  await page.locator('.node[data-id="T0"]').click();
  const conflictingTitle = page.locator('#detail [data-ed="title"]');
  await conflictingTitle.fill('Unsaved browser conflict draft');
  await intercepted;
  const remote = await request(`${service.url}/api/workbench/projects/context-guard/api/commit?view=session%3Asession-one`, {
    method: 'POST',
    headers: headers('browser-token'),
    body: JSON.stringify({ baseVersion: conflictBase, operationId: 'browser-conflict-winner', operations: [{ type: 'update', id: 'T0', fields: { purpose: 'concurrent server edit' } }] }),
  });
  assert.equal(remote.response.status, 200, JSON.stringify(remote.body));
  releaseResolve();
  await page.waitForFunction(() => document.querySelector('#cg-sync')?.dataset.status === 'conflict');
  const recoveryDraft = await page.evaluate(() => Object.entries(localStorage)
    .filter(([key]) => key.startsWith('cg-sync-draft:'))
    .map(([, value]) => JSON.parse(value))
    .find(value => value?.doc?.root?.title === 'Unsaved browser conflict draft'));
  assert.ok(recoveryDraft, 'the losing browser edit must remain in a recovery draft');
  const conflictWinner = await request(`${service.url}/v1/projects/context-guard/sessions/session-one`, { headers: headers('project-memory-token') });
  assert.equal(conflictWinner.body.snapshot.memory.map.root.title, 'Session map edited in browser');
  assert.equal(conflictWinner.body.snapshot.memory.map.root.purpose, 'concurrent server edit');
  await page.unroute(commitRoute);
  record('Concurrent edit shows conflict and preserves the losing browser draft');

  await page.reload();
  await synchronized();
  await page.locator('#session-chip').click();
  await page.locator('#session-menu [data-session="session-one"]').click();
  await page.waitForFunction(() => document.querySelector('#cg-sync-session')?.value === 'session-one');
  await synchronized();
  await git(repository, 'merge', '--ff-only', 'feature');
  await page.reload();
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('session'));
  await synchronized();
  assert.match(await page.locator('.node[data-id="T0"]').textContent(), /Session map edited in browser/);
  assert.doesNotMatch(await page.content(), /memory-admin|cloud-admin|project-memory-token/);
  await page.reload();
  await synchronized();
  assert.match(await page.locator('.node[data-id="T0"]').textContent(), /Session map edited in browser/);
  assert.equal(new URL(page.url()).searchParams.has('session'), false);
  assert.equal(await page.locator('#btn-publish-main').count(), 0, 'Main publication has no browser control');
  await page.locator('#session-chip').click();
  assert.equal(await page.locator('#session-menu [data-session="session-one"]').count(), 0, 'a published Session leaves the active selector');
  assert.equal(await page.locator('#cg-sync-session option[value="session-one"]').count(), 0);
  await page.locator('#session-chip').click();
  record('Verified publication updates durable Main without exposing an admin token');

  assert.equal(await page.locator('#coordinator-panel').count(), 0, 'ordinary projects do not gain a Coordinator');
  await page.addInitScript(() => {
    let config;
    Object.defineProperty(window, '__CG_SERVER', {
      configurable: true,
      get: () => config,
      set: value => { config = value; config.interfaceCapabilities.coordinator = true; },
    });
  });
  await page.route(/\/bootstrap(?:\?|$)/, async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.interfaceCapabilities = { ...body.interfaceCapabilities, coordinator: true };
    await route.fulfill({ response, json: body });
  });
  const submissions = [];
  const markdownImageRequests = [];
  page.on('request', request=>{if(request.url()==='https://example.invalid/private.png')markdownImageRequests.push(request.url());});
  let coordinatorState = { status: 'waiting-for-user', simulated: true, messages: [{ role: 'assistant', text: '<img src=x onerror=alert(1)>', tools: [] }],
    approvals: [{ id: 'proposal-1', pending: true, brief: { ref: 'brief-1', version: 'v1' }, text: '模拟需求确认', acceptance: '明确验收标准', sessionId: 'assigned-session', nodeIds: ['T0'], mainVersion: 'main-v1' }] };
  coordinatorState.messages.push(
    { role: 'user', text: '[实验：模拟人工输入]\n请审核这个计划', tools: [] },
    { role: 'assistant', text: '## 审核结果\n\n1. **范围一致**，执行 `npm ci`。\n   - 保留目录边界\n\n> 先审核，再开发。\n\n```js\nconst value = "<script>";\n```\n\n| 阶段 | 状态 |\n| --- | --- |\n| Plan | 通过 |\n\n[规范](https://example.invalid/spec) [不安全链接](javascript:alert(1))\n\n![不加载远程图片](https://example.invalid/private.png)', tools: [] },
    { role: 'user', text: '[服务器工作流事件，不是新的用户授权]\n{"type":"review.result","privateEventMarker":"diagnostic-only"}', tools: [] },
    { role: 'assistant', text: '', tools: [{ name: 'read_task' }, { name: 'read_reference' }] },
    { role: 'assistant', text: '请说明预期行为，并提供 `复现步骤`。', tools: [{ name: 'ask_user' }] },
  );
  coordinatorState.approvals.push(...['frontend', 'build'].map(id => ({ id, kind: 'mount-proposal', pending: true,
    mainVersion: 'main-v1', title: id, purpose: '隔离实验节点', owns: [id + '/'] })));
  const mountReviews = [];
  await page.route(/\/api\/coordinator\/mount-review(?:\?|$)/, async route => {
    mountReviews.push(route.request().postDataJSON());
    if (mountReviews.length === 1) return route.abort();
    for (const approval of coordinatorState.approvals) if (approval.kind === 'mount-proposal') approval.pending = false;
    return route.fulfill({ json: { committed: { version: 'main-v2', nodeIds: ['frontend', 'build'] } } });
  });
  const approvals = [];
  await page.route(/\/api\/coordinator\/approval(?:\?|$)/, async route => {
    approvals.push(route.request().postDataJSON());
    if (approvals.length === 1) return route.abort();
    coordinatorState.approvals[0].pending = false;
    return route.fulfill({ json: { receiptId: 'human-receipt' } });
  });
  await page.route(/\/api\/coordinator(?:\?|$)/, async route => {
    if (route.request().method() === 'POST') {
      submissions.push(route.request().postDataJSON());
      if (submissions.length === 1) return route.abort(); // Delivery is uncertain: preserve the ID.
      if (submissions.at(-1).text === '更正审批 ID，先核对当前 Plan') {
        coordinatorState = { ...coordinatorState, status: 'waiting-for-user', error: null, retryInput: null, canCorrect: false };
        return route.fulfill({ json: { accepted: true, id: submissions.at(-1).id }, status: 202 });
      }
      coordinatorState = { ...coordinatorState, status: 'error', error: { code: 'MODEL_TIMEOUT' }, retryInput: submissions[0] };
      return route.fulfill({ json: { accepted: true, id: submissions.at(-1).id }, status: 202 });
    }
    await route.fulfill({ json: coordinatorState });
  });
  await page.reload(); await synchronized();
  const coordinator = page.locator('#coordinator-panel');
  await coordinator.locator(':scope > summary').click();
  await coordinator.getByText('<img src=x onerror=alert(1)>', { exact: false }).waitFor();
  assert.equal(await coordinator.locator('img,script,iframe').count(), 0, 'Markdown cannot inject HTML or fetch remote images');
  assert.equal(await coordinator.locator('.coordinator-markdown strong').textContent(), '范围一致');
  assert.equal(await coordinator.locator('.coordinator-markdown ol > li > ul > li').textContent(), '保留目录边界');
  assert.equal(await coordinator.locator('.coordinator-markdown pre code').textContent(), 'const value = "<script>";');
  assert.equal(await coordinator.locator('.coordinator-markdown table tbody tr').count(), 1);
  assert.equal(await coordinator.getByRole('link', { name: '规范', exact: true }).getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await coordinator.locator('a[href^="javascript:"]').count(), 0);
  assert.equal(markdownImageRequests.length, 0, 'rendering must not disclose viewing activity through remote images');
  assert.equal(await coordinator.locator('.coordinator-message.user').textContent(), '请审核这个计划');
  assert.equal(await coordinator.locator('.coordinator-speaker').count(), 0);
  assert.equal(await coordinator.getByRole('status').count(), 0, 'normal status is not displayed');
  assert.equal(await coordinator.locator('form').evaluate(node => getComputedStyle(node).borderTopWidth), '0px');
  assert.equal(await coordinator.locator('.coordinator-debug').count(), 0);
  assert.equal(await coordinator.getByText('请说明预期行为，并提供', { exact: false }).isVisible(), true, 'questions stay visible while tool diagnostics are collapsed');
  assert.equal(await coordinator.locator('.coordinator-messages').innerText().then(text=>text.includes('diagnostic-only')), false);
  assert.equal(await coordinator.getByText(/运行记录/).count(), 0);
  record('coordinator-safe-markdown-chat-without-diagnostics-controls');
  const navigationVersion = await syncVersion();
  await page.evaluate(async () => {
    const { conversationFragments } = await import('/prototype/coordinator-markdown.mjs');
    const host = document.createElement('div'); host.id = 'node-link-test';
    host.append(conversationFragments([{ role: 'assistant', text: '推荐：**前端交互**；未知节点；重名；`前端交互`；[前端交互](https://example.invalid)' }], document, {
      nodes: [{ id: 'target', title: '前端交互' }, { id: 'a', title: '重名' }, { id: 'b', title: '重名' }],
      onNode: id => { host.dataset.selected = id; },
    }).body);
    document.body.append(host);
  });
  assert.equal(await page.locator('#node-link-test button').count(), 1, 'ambiguous titles, unknown nodes, code and links are not converted');
  await page.locator('#node-link-test button').evaluate(button => button.click());
  assert.equal(await page.locator('#node-link-test').getAttribute('data-selected'), 'target');
  await page.locator('#node-link-test').evaluate(node => node.remove());
  coordinatorState.nodeReferences = [{ id: 'T0', title: '定位节点' }];
  coordinatorState.messages.push({ role: 'assistant', text: '推荐挂载节点：定位节点。' });
  await page.reload(); await synchronized();
  await coordinator.locator(':scope > summary').click();
  await coordinator.locator('textarea').fill('跳转时保留草稿');
  await coordinator.getByRole('button', { name: '定位节点', exact: true }).click();
  assert.equal(await coordinator.getAttribute('open'), '', 'node navigation keeps the conversation open');
  assert.equal(await coordinator.locator('textarea').inputValue(), '跳转时保留草稿');
  await coordinator.locator('textarea').fill('');
  assert.equal(await page.locator('.node.selected[data-id="T0"]').count(), 1);
  assert.equal(await syncVersion(), navigationVersion, 'navigation does not mutate Main');
  assert.equal(approvals.length + mountReviews.length + submissions.length, 0, 'navigation never approves or dispatches');
  record('coordinator-node-navigation-without-approval');
  coordinatorState.messages.push({role:'assistant',text:'要上传什么？',questions:[{id:'choice',text:'要上传什么？',options:['网站构建产物','其他文件']}]});
  await coordinator.getByRole('button',{name:'网站构建产物',exact:true}).waitFor();
  await coordinator.getByRole('button',{name:'补充说明',exact:true}).click();
  assert.equal(await coordinator.locator('textarea').evaluate(node=>node===document.activeElement),true);
  await coordinator.locator('textarea').fill('保留我的补充');
  await coordinator.getByRole('button',{name:'网站构建产物',exact:true}).click();
  await coordinator.getByRole('button',{name:'重试原请求',exact:true}).waitFor();
  assert.equal(submissions.length,1);
  assert.equal(submissions[0].text,'要上传什么？\n\n我的选择：网站构建产物');
  assert.equal(await coordinator.locator('textarea').inputValue(),'保留我的补充');
  assert.equal(await coordinator.getByRole('button',{name:'网站构建产物',exact:true}).isEnabled(),false);
  assert.equal(approvals.length+mountReviews.length,0,'choice answers are never approvals');
  // Reload clears the deliberately uncertain local request; this mock has not persisted it.
  submissions.length=0;coordinatorState.messages.pop();
  await page.reload();await synchronized();await coordinator.locator(':scope > summary').click();
  await coordinator.locator('.coordinator-messages').evaluate(node=>{node.scrollTop=0;});
  await coordinator.screenshot({ path: path.join(output, 'coordinator-chat.png') });
  await coordinator.getByRole('button', { name: '确认这些节点', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#coordinator-panel [role=status]')?.textContent.includes('节点审核尚未成功'));
  await coordinator.getByRole('button', { name: '确认这些节点', exact: true }).click();
  await coordinator.getByRole('button', { name: '确认这些节点', exact: true }).waitFor({ state: 'detached' });
  assert.deepEqual(mountReviews[0].proposalIds, ['frontend', 'build']);
  assert.deepEqual(mountReviews[1], mountReviews[0], 'the batch retry preserves its original request');
  assert.equal(submissions.length, 0, 'node confirmation uses the script endpoint, not a model request');
  await coordinator.getByRole('button', { name: '确认需求', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#coordinator-panel [role=status]')?.textContent.includes('确认尚未成功'));
  await coordinator.getByRole('button', { name: '确认需求', exact: true }).click();
  await coordinator.getByRole('button', { name: '确认需求', exact: true }).waitFor({ state: 'detached' });
  assert.equal(approvals[0].id, approvals[1].id);
  assert.equal(submissions.length, 0, 'human confirmation is a script request, not a model prompt');
  await coordinator.locator('textarea').fill('模拟需求');
  await coordinator.getByRole('button', { name: '发送', exact: true }).click();
  await coordinator.getByRole('button', { name: '重试原请求' }).waitFor();
  assert.match(await coordinator.getByRole('status').textContent(), /尚未确认提交/);
  await coordinator.getByRole('button', { name: '重试原请求' }).click();
  await page.waitForFunction(() => document.querySelector('#coordinator-panel [role=status]')?.textContent.includes('MODEL_TIMEOUT'));
  assert.equal(submissions[0].id, submissions[1].id, 'uncertain transport must reuse the exact request');
  await page.reload(); await synchronized();
  await coordinator.locator(':scope > summary').click();
  await coordinator.getByRole('button', { name: '重试原请求' }).waitFor();
  await coordinator.locator('textarea').fill('未提交的纠正意见');
  await coordinator.getByRole('button', { name: '重试原请求' }).click();
  await page.waitForFunction(() => document.querySelector('#coordinator-panel [role=status]')?.textContent.includes('MODEL_TIMEOUT'));
  assert.equal(submissions[2].id, submissions[0].id);
  assert.equal(submissions[2].retry, true, 'provider retry survives reload and remains explicit');
  assert.equal(await coordinator.locator('textarea').inputValue(), '未提交的纠正意见', 'retrying another request must not erase an unsent draft');
  assert.equal(await coordinator.getByRole('button', { name: '发送', exact: true }).isEnabled(), false, 'unknown transport failure still preserves the original intent');
  coordinatorState = { ...coordinatorState, canCorrect: true, error: { code: 'NOT_FOUND' } };
  await page.waitForFunction(() => document.querySelector('#coordinator-panel [role=status]')?.textContent.includes('可补充纠正意见'));
  await coordinator.locator('textarea').fill('更正审批 ID，先核对当前 Plan');
  await coordinator.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#coordinator-panel [role=status]')?.textContent === '' && !document.querySelector('#coordinator-panel button[type=submit]').disabled);
  assert.notEqual(submissions.at(-1).id, submissions[0].id);
  assert.equal(submissions.at(-1).retry, undefined, 'human correction is a new message, not an unsafe replay');
  record('Coordinator feature gate, safe Markdown rendering and durable explicit retries');

  const itemConversations=[];
  await page.route(/\/api\/coordinator\/conversations(?:\?|$)/,async route=>{
    const item=route.request().postDataJSON(), id=item.kind+'-'+item.itemId;
    itemConversations.push({...item,id});
    coordinatorState.conversations=[{id:'legacy',title:'历史总对话'},...itemConversations.map(item=>({...item,title:item.itemId}))];
    return route.fulfill({json:{id}});
  });

  for (const kind of ['todo', 'bug']) {
    await coordinator.locator(':scope > summary').click();
    await page.locator(`[data-act="add-${kind}"]`).click();
    const dialog = page.locator('dialog.bug-assign-dialog');
    assert.equal(await dialog.locator('[name="session"]').count(), 0, 'intake must not require an existing Session');
    await dialog.locator('textarea').fill(`Discuss new ${kind} before dispatch`);
    const previous = await syncVersion();
    await dialog.getByRole('button', { name: '创建并讨论', exact: true }).click();
    await synchronizedAfter(previous);
    assert.equal(await coordinator.getAttribute('open'), '', 'creating work opens the conversation immediately');
    const saved = await request(`${service.url}/v1/projects/context-guard/main`, { headers: headers('project-memory-token') });
    const item = saved.body.snapshot.memory.map.root[kind === 'todo' ? 'todos' : 'bugs'].find(item => item.title === `Discuss new ${kind} before dispatch`);
    assert.ok(item, 'the requirement must be persisted in Main');
    assert.equal(item.dispatch, undefined, 'creating a requirement must not dispatch work or approve a brief');
    assert.deepEqual(item.sessions, []);
    await page.waitForFunction(id=>document.querySelector('#coordinator-panel')?.dataset.conversation===id,kind+'-'+item.id);
  }
  assert.notEqual(itemConversations[0].id,itemConversations[1].id);
  const openItem=async item=>{
    if(await coordinator.getAttribute('open')!==null) await coordinator.locator(':scope > summary').click();
    await page.locator(`[data-coordinator-item="${item.itemId}"][data-coordinator-kind="${item.kind}"]`).click();
    await page.waitForFunction(id=>document.querySelector('#coordinator-panel')?.dataset.conversation===id,item.id);
  };
  await coordinator.locator('textarea').fill('Bug 独立草稿');
  await openItem(itemConversations[0]);
  assert.equal(await coordinator.locator('textarea').inputValue(),'');
  await coordinator.locator('textarea').fill('TODO 独立草稿');
  await page.waitForTimeout(100);
  await openItem(itemConversations[1]);
  assert.equal(await coordinator.locator('textarea').inputValue(),'Bug 独立草稿');
  record('Coordinator intake saves TODO and Bug without selecting or dispatching a Session');

  assert.equal(await coordinator.locator('.coordinator-session-create').count(),0);
  assert.equal(await coordinator.getByLabel('Coordinator 事项对话').count(),0);
  assert.equal(await coordinator.getByText(/运行记录/).count(),0);
  record('Coordinator hides removed controls while per-item conversation entry remains usable');

  await page.screenshot({ path: path.join(output, 'cloud-session-edit.png'), fullPage: true });
  await fs.writeFile(path.join(output, 'result.json'), `${JSON.stringify({ passed: true, checks }, null, 2)}\n`);
  passed = true;
} finally {
  if (page && !passed) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await browser?.close().catch(() => {});
  await service?.close().catch(() => {});
  await fs.rm(dataDir, { recursive: true, force: true });
}

console.log(`Cloud browser artifacts: ${output}`);
