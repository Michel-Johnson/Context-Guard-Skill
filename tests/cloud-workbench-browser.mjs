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
    attachmentProvider: {
      upload: async () => 'browser-fixture-file',
      share: async () => ({ url: 'https://pan.quark.cn/s/browserfixture', passcode: 'Ab12' }),
    },
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
  // Cloud publication and cross-view reconciliation run on a 30-second cycle.
  // Keep assertions strict while allowing one complete authoritative refresh.
  page.setDefaultTimeout(35000);
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
  assert.equal(await page.locator('#session-menu [data-session="session-one"]').count(), 0, 'idle historical Sessions stay out of the main working list');
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
  assert.equal(await pendingPage.locator('#cg-sync-session option[value="session-one"]').count(), 0, 'a deep link does not expose other idle Sessions');
  assert.equal(await pendingPage.locator('#cg-sync-session option[value="__all__"]').count(), 1, 'Cloud deep links retain the Main entry');
  await pendingPage.locator('#session-chip').click();
  assert.equal(await pendingPage.locator('#session-menu [data-session="session-one"]').count(), 0);
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
  await relationPage.goto(`${service.url}/projects/context-guard?session=session-one#cloud-relation-contract`);
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

  await page.goto(`${service.url}/projects/context-guard?session=session-one`);
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
  await page.waitForFunction(() => ['synced', 'conflict'].includes(document.querySelector('#cg-sync')?.dataset.status), undefined, { timeout: 35000 });
  assert.equal(await page.locator('#cg-sync').getAttribute('data-status'), 'conflict');
  assert.match(await page.locator('#cg-sync-status').textContent(), /草稿与服务器版本冲突/);
  await page.evaluate(() => localStorage.removeItem('cg-sync-draft:cloud:context-guard:session:session-one'));
  await page.reload();
  await synchronized();
  await page.locator('#session-chip').click();
  await page.locator('#session-menu [data-session="session-one"]').click();
  await page.waitForFunction(() => document.querySelector('#cg-sync-session')?.value === 'session-one');
  await synchronized();
  await git(repository, 'merge', '--ff-only', 'feature');
  await page.reload();
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('session'), undefined, { timeout: 35000 });
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
  assert.equal(await page.locator('#btn-coordinator').isVisible(), false, 'ordinary projects do not expose the Coordinator launcher');
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
  let releaseDelayedSubmission;
  const coordinatorReads = [];
  let coordinatorReadFailure = false;
  const markdownImageRequests = [];
  page.on('request', request=>{if(request.url()==='https://example.invalid/private.png')markdownImageRequests.push(request.url());});
  let runningPreview = false;
  let coordinatorState = { status: 'waiting-for-user', simulated: true, messages: [{ role: 'assistant', text: '<img src=x onerror=alert(1)>', tools: [] }],
    sessionTemplates: [{ id: 'developer-template', name: 'Claude Developer' }], sessionCreations: [],
    conversations: [{id:'main',scope:'main',title:'Main 对话'},{id:'session:history-one',scope:'session',title:'历史开发 Session'}],
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
  const conversationCreationRequests = [];
  await page.route(/\/api\/coordinator\/conversations\/new(?:\?|$)/, async route => {
    const request = route.request().postDataJSON();conversationCreationRequests.push(request);
    if(conversationCreationRequests.length===1)return route.abort();
    coordinatorState.conversations.push({id:'chat-created',scope:'chat',title:'Coordinator Session 1'});
    return route.fulfill({ status: 201, json: { id: 'chat-created' } });
  });
  await page.route(/\/api\/coordinator(?:\?|$)/, async route => {
    if (route.request().method() === 'POST') {
      submissions.push(route.request().postDataJSON());
      if (submissions.at(-1).text === '立即显示测试') {
        await new Promise(resolve => { releaseDelayedSubmission = resolve; });
        coordinatorState = { ...coordinatorState, status: 'waiting-for-user', error: null, retryInput: null, canCorrect: false,
          messages: [...coordinatorState.messages, { role: 'user', text: '立即显示测试', tools: [] }] };
        return route.fulfill({ json: { accepted: true, id: submissions.at(-1).id }, status: 202 });
      }
      if (submissions.at(-1).text === '已持久化但响应丢失') {
        coordinatorState = { ...coordinatorState, status: 'waiting-for-user', error: null, retryInput: null, canCorrect: false,
          acceptedRequestIds: [submissions.at(-1).id] };
        return route.abort(); // The server accepted the turn, but the acknowledgement was lost.
      }
      if (submissions.length === 1) return route.abort(); // Delivery is uncertain: preserve the ID.
      if (submissions.at(-1).text === '更正审批 ID，先核对当前 Plan') {
        coordinatorState = { ...coordinatorState, status: 'waiting-for-user', error: null, retryInput: null, canCorrect: false };
        return route.fulfill({ json: { accepted: true, id: submissions.at(-1).id }, status: 202 });
      }
      coordinatorState = { ...coordinatorState, status: 'error', error: { code: 'MODEL_TIMEOUT' }, retryInput: submissions[0] };
      return route.fulfill({ json: { accepted: true, id: submissions.at(-1).id }, status: 202 });
    }
    const readConversation=new URL(route.request().url()).searchParams.get('conversation');coordinatorReads.push(readConversation);
    if(coordinatorReadFailure){coordinatorReadFailure=false;return route.abort();}
    const responseState=readConversation==='chat-created'?{...coordinatorState,messages:[],approvals:[],acceptances:[],status:'idle'}:runningPreview?{...coordinatorState,status:'running',streamingText:'第一段回复。\n第二段回复。\n第三段回复。'}:coordinatorState;
    await route.fulfill({ json: responseState });
  });
  await page.reload(); await synchronized();
  const coordinator = page.locator('#coordinator-panel');
  await page.locator('#btn-coordinator').waitFor({ state: 'visible' });
  const detailTitleBeforeCoordinator = (await page.locator('#detail h2').first().textContent()).trim();
  assert.equal(await page.locator('#btn-coordinator').isVisible(), true, 'Coordinator entry lives in the top bar');
  assert.equal(await page.locator('#btn-coordinator').evaluate(el => el.closest('header.top') !== null), true);
  assert.equal(await page.locator('#cloud-sync-status').isVisible(), false, 'synced state does not render a checkmark button');
  await page.locator('#btn-coordinator').click();
  assert.equal(await page.locator('#btn-coordinator').getAttribute('aria-expanded'), 'true');
  assert.equal(await coordinator.evaluate(el => el.parentElement?.id), 'detail', 'Coordinator reuses the existing inspector');
  assert.equal(await coordinator.evaluate(el => getComputedStyle(el).position), 'static', 'Coordinator is not a floating overlay');
  assert.equal(await page.locator('#detail').evaluate(el => el.classList.contains('coordinator-open')), true);
  await page.waitForFunction(() => document.querySelector('#coordinator-panel')?.dataset.conversation === 'main');
  const createSessionAction=coordinator.getByRole('button',{name:'新建 Coordinator Session',exact:true});
  assert.equal(await createSessionAction.textContent(),'＋','new Session uses a symbol-only control');
  assert.equal(await createSessionAction.evaluate(el=>el.parentElement?.classList.contains('coordinator-toolbar')),true,'new Session lives in the Coordinator toolbar');
  const historyAction=coordinator.getByRole('button',{name:'历史 Session',exact:true});
  assert.equal(await historyAction.textContent(),'◷','history uses a symbol-only control');
  assert.equal(await historyAction.evaluate(el=>el.parentElement?.classList.contains('coordinator-toolbar')),true,'history lives in the Coordinator toolbar');
  const toolbarAppearance=await coordinator.locator('.coordinator-toolbar').evaluate(toolbar=>{
    const action=toolbar.querySelector('.coordinator-toolbar-action'),style=getComputedStyle(action),toolbarStyle=getComputedStyle(toolbar);
    return{width:style.width,height:style.height,fontSize:style.fontSize,borderWidth:style.borderTopWidth,borderRadius:style.borderRadius,background:style.backgroundColor,color:style.color,boxShadow:style.boxShadow,gap:toolbarStyle.gap};
  });
  assert.deepEqual(toolbarAppearance,{width:'28px',height:'28px',fontSize:'16px',borderWidth:'1px',borderRadius:'8px',background:'rgba(0, 0, 0, 0)',color:'rgb(116, 108, 96)',boxShadow:'none',gap:'12px'},'Coordinator icon actions use the compact neutral button system');
  await coordinator.getByLabel('发送给 Coordinator').fill('Main 草稿');await historyAction.click();
  await coordinator.getByRole('button',{name:'历史开发 Session',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#coordinator-panel')?.dataset.conversation==='session:history-one');
  assert.ok(coordinatorReads.includes('session:history-one'),'history opens the selected Session conversation');
  await coordinator.getByLabel('发送给 Coordinator').fill('历史草稿');await historyAction.click();
  await coordinator.getByRole('button',{name:'当前 · Main 对话',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#coordinator-panel')?.dataset.conversation==='main');
  assert.equal(await coordinator.getByLabel('发送给 Coordinator').inputValue(),'Main 草稿','switching history preserves each conversation draft');
  await coordinator.getByLabel('发送给 Coordinator').fill('');
  coordinatorReadFailure=true;
  await page.locator('#btn-coordinator').click();await page.locator('#btn-coordinator').click();
  const readRetry=coordinator.getByRole('button',{name:'重试读取',exact:true});
  await readRetry.waitFor();
  assert.equal(await readRetry.textContent(),'↻','read retry uses the shared symbol-only control');
  assert.equal(await readRetry.evaluate(el=>el.parentElement?.classList.contains('coordinator-toolbar')),true,'read retry lives in the Coordinator toolbar');
  await readRetry.click();
  await page.waitForFunction(()=>document.querySelector('#coordinator-panel > [role=status]')?.textContent==='');
  const coordinatorLayout = await coordinator.evaluate(el => {
    const drawer = el.parentElement.getBoundingClientRect();
    const form = el.querySelector('form.coordinator-compose').getBoundingClientRect();
    const input = el.querySelector('.coordinator-input-shell textarea');
    const typing = el.querySelector('.coordinator-typing');
    const typingPhase = typing.querySelector('.coordinator-typing-phase');
    const send = el.querySelector('.coordinator-input-shell > button');
    const inputRect = input.getBoundingClientRect();
    const sendRect = send.getBoundingClientRect();
    return { drawerBottom: drawer.bottom, panelBottom: el.getBoundingClientRect().bottom, formBottom: form.bottom,
      inputHeight: inputRect.height, sendPosition: getComputedStyle(send).position,
      sendWidth:sendRect.width,sendHeight:sendRect.height,sendRadius:getComputedStyle(send).borderRadius,
      sendCenterDelta: Math.abs((sendRect.top + sendRect.bottom - inputRect.top - inputRect.bottom) / 2),
      sendDisabled:send.disabled,
      workingPhase: typingPhase?.textContent,
      shimmerDuration: getComputedStyle(typingPhase).animationDuration,
      shimmerTiming: getComputedStyle(typingPhase).animationTimingFunction,
      shimmerIteration: getComputedStyle(typingPhase).animationIterationCount,
      typingDots: typing.querySelectorAll('i').length };
  });
  assert.ok(coordinatorLayout.panelBottom <= coordinatorLayout.drawerBottom + 1, 'chat stays inside the inspector height');
  assert.ok(coordinatorLayout.formBottom <= coordinatorLayout.drawerBottom + 1, 'chat composer remains visible inside the inspector');
  assert.ok(coordinatorLayout.inputHeight <= 58, `composer starts compact instead of filling the inspector: ${JSON.stringify(coordinatorLayout)}`);
  assert.equal(coordinatorLayout.sendPosition, 'absolute', 'send button sits inside the composer like ChatGPT');
  assert.deepEqual([coordinatorLayout.sendWidth,coordinatorLayout.sendHeight,coordinatorLayout.sendRadius],[32,32,'50%'],'send uses a compact circular control');
  assert.ok(coordinatorLayout.sendCenterDelta <= 0.5, `send arrow stays vertically centered in the composer: ${JSON.stringify(coordinatorLayout)}`);
  assert.equal(coordinatorLayout.sendDisabled,true,'empty composer keeps the send arrow disabled');
  await coordinator.getByLabel('发送给 Coordinator').fill('可以发送');
  assert.equal(await coordinator.getByRole('button',{name:'发送',exact:true}).isEnabled(),true,'typing enables the send arrow immediately');
  await coordinator.getByLabel('发送给 Coordinator').fill('');
  assert.equal(coordinatorLayout.workingPhase, 'Planning next moves', 'reply state uses Cursor desktop wording');
  assert.equal(coordinatorLayout.shimmerDuration, '1s', 'planning shimmer matches Cursor desktop duration');
  assert.equal(coordinatorLayout.shimmerTiming, 'linear', 'planning shimmer matches Cursor desktop easing');
  assert.equal(coordinatorLayout.shimmerIteration, 'infinite', 'planning shimmer continues until response text arrives');
  assert.equal(coordinatorLayout.typingDots, 0, 'Cursor planning state has no staggered dots');
  runningPreview=true;
  await page.locator('#btn-coordinator').click();
  await page.locator('#btn-coordinator').click();
  await coordinator.locator('.coordinator-streaming').waitFor();
  assert.equal(await coordinator.locator('.coordinator-streaming').count(), 1, 'streaming response keeps a live visual state');
  assert.equal(await coordinator.locator('.coordinator-streaming-text').count(), 1, 'streaming response uses a buffered text surface');
  assert.equal(await coordinator.locator('.coordinator-typing.is-visible').count(), 0, 'planning state exits as soon as response text exists');
  assert.equal(await coordinator.locator('.coordinator-word-reveal').count(),0,'response chunks appear without per-word opacity animation');
  await coordinator.locator('.coordinator-streaming').evaluate(node => { node.dataset.motionProbe = 'stable'; });
  await page.waitForFunction(() => {
    const node=document.querySelector('.coordinator-streaming-text');
    return node && node.textContent && node.textContent !== '第一段回复。\n第二段回复。\n第三段回复。' && node.textContent.includes('\n');
  });
  await page.waitForTimeout(650);
  assert.equal(await coordinator.locator('.coordinator-streaming-text').textContent(), '第一段回复。\n第二段回复。\n第三段回复。', 'streaming text reveals complete lines without dropping content');
  assert.equal(await coordinator.locator('.coordinator-streaming .coordinator-markdown').evaluate(node => getComputedStyle(node, '::after').content), 'none', 'streaming response has no blinking caret');
  assert.equal(await coordinator.locator('.coordinator-streaming').getAttribute('data-motion-probe'), 'stable', 'streaming updates preserve the message node instead of replaying the whole transcript');
  runningPreview=false;
  await page.locator('#btn-coordinator').click();
  await page.locator('#btn-coordinator').click();
  await page.waitForFunction(() => !document.querySelector('.coordinator-typing.is-visible'));
  const oneShotText='第一段最终回复。\n第二段最终回复。\n第三段最终回复。';
  coordinatorState={...coordinatorState,status:'waiting-for-user',streamingText:'',messages:[...coordinatorState.messages,{role:'assistant',text:oneShotText,tools:[]}]};
  await page.locator('#btn-coordinator').click();
  await page.locator('#btn-coordinator').click();
  const oneShotMessage=coordinator.locator('.coordinator-message.assistant').filter({hasText:'第一段最终回复。'}).last();
  await oneShotMessage.waitFor();
  assert.equal(await coordinator.locator('.coordinator-final-reveal,.coordinator-reveal-original').count(),0,'one-shot replies render only their final Markdown DOM');
  assert.ok(await oneShotMessage.locator('p').count()>=1,'one-shot replies use final Markdown structure immediately');
  const stableFinalLayout=await oneShotMessage.evaluate(node=>({text:node.textContent,html:node.innerHTML,height:node.getBoundingClientRect().height}));
  await page.waitForTimeout(300);
  assert.deepEqual(await oneShotMessage.evaluate(node=>({text:node.textContent,html:node.innerHTML,height:node.getBoundingClientRect().height})),stableFinalLayout,'one-shot reply layout stays unchanged after first paint');
  assert.equal(await coordinator.locator('.coordinator-messages').evaluate(node=>getComputedStyle(node).paddingBottom),'36px','latest message keeps space above the composer');
  await page.emulateMedia({reducedMotion:'reduce'});
  const reducedMotion=await coordinator.evaluate(el=>({shimmerAnimation:getComputedStyle(el.querySelector('.coordinator-typing-phase')).animationName}));
  assert.deepEqual(reducedMotion,{shimmerAnimation:'none'},'reduced motion disables the planning shimmer');
  await page.emulateMedia({reducedMotion:'no-preference'});
  record('Coordinator composer is compact and reply state uses a continuous indicator');
  await coordinator.getByText('<img src=x onerror=alert(1)>', { exact: false }).waitFor();
  assert.ok(coordinatorReads.includes('main'), 'Main opens a fresh scoped conversation instead of legacy history');
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
  assert.equal(await coordinator.locator('form.coordinator-compose').evaluate(node => getComputedStyle(node).borderTopWidth), '0px');
  assert.equal(await coordinator.locator('.coordinator-debug').count(), 0);
  assert.equal(await coordinator.getByText('请说明预期行为，并提供', { exact: false }).isVisible(), true, 'questions stay visible while tool diagnostics are collapsed');
  assert.equal(await coordinator.locator('.coordinator-messages').innerText().then(text=>text.includes('diagnostic-only')), false);
  assert.equal(await coordinator.getByText(/运行记录/).count(), 0);
  record('coordinator-safe-markdown-chat-without-diagnostics-controls');
  await page.locator('#btn-coordinator').click();
  assert.equal(await page.locator('#btn-coordinator').getAttribute('aria-expanded'), 'false');
  assert.equal(await coordinator.evaluate(el => el.parentElement === document.body), true, 'closed chat leaves the inspector available for node details');
  assert.equal((await page.locator('#detail h2').first().textContent()).trim(), detailTitleBeforeCoordinator);
  await page.locator('#btn-coordinator').click();
  await page.waitForFunction(() => document.querySelector('#coordinator-panel')?.dataset.conversation === 'main');
  await coordinator.getByLabel('发送给 Coordinator').fill('切回详情仍保留的草稿');
  await page.locator('.node[data-id="T0"]').click();
  assert.equal(await coordinator.getAttribute('open'), null, 'selecting a map node returns to its details');
  await page.locator('#btn-coordinator').click();
  assert.equal(await coordinator.getByLabel('发送给 Coordinator').inputValue(), '切回详情仍保留的草稿');
  await coordinator.getByLabel('发送给 Coordinator').fill('');
  await page.locator('#workbench-tools > summary').click();
  await page.locator('#btn-bugs').click();
  assert.equal(await coordinator.getAttribute('open'), null, 'work lists and Coordinator do not compete for the right panel');
  assert.equal(await page.locator('#btn-coordinator').getAttribute('aria-expanded'), 'false');
  await page.locator('#workbench-tools > summary').click();
  await page.locator('#btn-bugs').click();
  await page.locator('#btn-coordinator').click();
  record('Coordinator shares the node inspector and restores its previous detail view');
  await createSessionAction.click();
  await coordinator.getByText(/新建 Coordinator Session 尚未确认/).waitFor();
  await createSessionAction.click();
  await page.waitForFunction(()=>document.querySelector('#coordinator-panel')?.dataset.conversation==='chat-created');
  assert.equal(conversationCreationRequests.length,2);
  assert.equal(conversationCreationRequests[0].id,conversationCreationRequests[1].id,'uncertain creation retries preserve the operation ID');
  assert.equal(await coordinator.locator('.coordinator-session-create').count(),0,'Coordinator Session creation never opens an execution environment form');
  assert.equal(await coordinator.getByLabel('发送给 Coordinator').inputValue(),'');
  assert.equal(await coordinator.locator('.coordinator-messages').textContent(),'');
  record('Coordinator creates a durable blank chat Session without creating an execution Session');
  const navigationVersion = await syncVersion();
  await page.evaluate(async () => {
    const { conversationFragments } = await import('/prototype/coordinator-markdown.mjs');
    const host = document.createElement('div'); host.id = 'node-link-test';
    host.append(conversationFragments([{ role: 'assistant', text: '推荐：**前端交互**；未知节点；重名；`前端交互`；[前端交互](https://example.invalid)' }], document, {
      nodes: [{ id: 'target', title: '前端交互（frontend/）' }, { id: 'a', title: '重名' }, { id: 'b', title: '重名' }],
      onNode: id => { host.dataset.selected = id; },
    }).body);
    document.body.append(host);
  });
  assert.equal(await page.locator('#node-link-test button').count(), 0, 'plain response text never becomes Map buttons');
  assert.match(await page.locator('#node-link-test').textContent(), /前端交互/, 'node names remain readable text');
  await page.locator('#node-link-test').evaluate(node => node.remove());
  await page.evaluate(async () => {
    const { conversationFragments } = await import('/prototype/coordinator-markdown.mjs');
    const host = document.createElement('div'); host.id = 'legacy-question-test';
    host.append(conversationFragments([{ role: 'assistant', text: '等待你确认的三个澄清问题如下：\n\n1. TD3：空搜索结果的提示文案与行为，建议挂「前端交互」。\n\n2. B41：搜索框清空后的结果恢复行为，建议挂「前端交互」。\n\n3. TD4：测试实验的目标、完成条件与挂载节点。' }], document, {
      nodes: [{ id: 'frontend', title: '前端交互（frontend/）' }], canAnswer: true, onAnswer: () => {}, onNode: () => {},
    }).body);
    document.body.append(host);
  });
  assert.equal(await page.locator('#legacy-question-test .coordinator-legacy-question').count(), 3, 'legacy numbered confirmation questions become inline cards');
  assert.equal(await page.locator('#legacy-question-test textarea').count(), 3, 'each legacy question has an inline answer field');
  assert.equal(await page.locator('#legacy-question-test button.coordinator-node-link').count(), 0, 'legacy question text does not create implicit node buttons');
  await page.locator('#legacy-question-test').evaluate(node => node.remove());
  await page.evaluate(async () => {
    const { conversationFragments } = await import('/prototype/coordinator-markdown.mjs');
    const host = document.createElement('div'); host.id = 'structured-node-test';
    host.append(conversationFragments([{ role: 'assistant', text: '建议放在这里。', actions: [
      { kind: 'node-references', message: '候选节点', nodes: [{ id: 'reader', title: '阅读' }, { id: 'admin', title: '管理' }, { id: 'content', title: '内容' }, { id: 'test', title: '工程' }] },
      { kind: 'conversation-mounted', conversationId: 'item-next', node: { id: 'reader', title: '阅读' } },
    ] }, { role: 'assistant', text: '选择节点', questions: [{ id: 'node-choice', text: '挂到哪里？', nodes: [{ id: 'reader', title: '阅读' }] }] }], document, {
      canAnswer: true, onNode: id => { host.dataset.selected = id; }, onConversation: id => { host.dataset.conversation = id; }, onAnswer: () => {},
    }).body);
    document.body.append(host);
  });
  assert.equal(await page.locator('#structured-node-test .coordinator-actions').first().locator('button.coordinator-node-link').count(), 3, 'even historical structured actions render at most three node buttons');
  assert.equal(await page.locator('#structured-node-test button.coordinator-node-link').count(), 5);
  await page.locator('#structured-node-test .coordinator-actions button.coordinator-node-link').first().evaluate(button => button.click());
  assert.equal(await page.locator('#structured-node-test').getAttribute('data-selected'), 'reader');
  await page.locator('#structured-node-test').getByRole('button', { name: '继续这个事项' }).evaluate(button => button.click());
  assert.equal(await page.locator('#structured-node-test').getAttribute('data-conversation'), 'item-next');
  await page.locator('#structured-node-test').evaluate(node => node.remove());
  await page.evaluate(async () => {
    const { conversationFragments } = await import('/prototype/coordinator-markdown.mjs');
    const host = document.createElement('div'); host.id = 'question-keyboard-test';
    host.append(conversationFragments([{ role: 'assistant', text: '补充细节', questions: [{ id: 'keyboard-question', text: '请补充细节' }] }], document, {
      canAnswer: true, onAnswer: (_question, answer) => { host.dataset.answer = answer; },
    }).body);
    document.body.append(host);
  });
  const keyboardAnswer = page.locator('#question-keyboard-test textarea');
  await keyboardAnswer.fill('第一行'); await keyboardAnswer.press('Shift+Enter'); await keyboardAnswer.type('第二行');
  assert.equal(await keyboardAnswer.inputValue(), '第一行\n第二行', 'Shift+Enter keeps a newline in an inline answer');
  await keyboardAnswer.press('Enter');
  assert.equal(await page.locator('#question-keyboard-test').getAttribute('data-answer'), '第一行\n第二行', 'Enter sends an inline answer');
  assert.equal(await page.locator('#question-keyboard-test .coordinator-answer-compose > button').textContent(), '发送');
  await page.locator('#question-keyboard-test').evaluate(node => node.remove());
  coordinatorState.nodeReferences = [{ id: 'T0', title: '定位节点' }];
  coordinatorState.messages.push({ role: 'assistant', text: '推荐挂载节点。', actions: [{ kind: 'node-references', message: '推荐', nodes: [{ id: 'T0', title: '定位节点' }] }] });
  await page.reload(); await synchronized();
  await page.locator('#btn-coordinator').click();
  await coordinator.locator('textarea').fill('跳转时保留草稿');
  await coordinator.getByRole('button', { name: '定位节点', exact: true }).click();
  assert.equal(await coordinator.getAttribute('open'), '', 'node navigation keeps the conversation open');
  assert.equal(await coordinator.locator('textarea').inputValue(), '跳转时保留草稿');
  await coordinator.locator('textarea').fill('');
  assert.equal(await page.locator('.node.selected[data-id="T0"]').count(), 1);
  assert.equal(await syncVersion(), navigationVersion, 'navigation does not mutate Main');
  assert.equal(approvals.length + mountReviews.length + submissions.length, 0, 'navigation never approves or dispatches');
  record('coordinator-node-navigation-without-approval');
  coordinatorState.status='running';coordinatorState.streamingText='';
  await page.reload();await synchronized();await page.locator('#btn-coordinator').click();
  await coordinator.getByText('Planning next moves',{exact:true}).waitFor();
  const planningPlacement=await coordinator.locator('.coordinator-typing.is-visible').evaluate(node=>({
    parent:node.parentElement?.className,
    previous:node.previousElementSibling?.className,
    beforeComposer:node.nextElementSibling?.className,
  }));
  assert.match(planningPlacement.parent,/coordinator-messages/,'planning state belongs to the message timeline');
  assert.match(planningPlacement.previous,/coordinator-message user/,'planning state follows the current user message');
  assert.notEqual(planningPlacement.beforeComposer,'coordinator-compose','planning state is not fixed above the composer');
  coordinatorState.streamingText='正在形成可见答案';
  await coordinator.getByText('正在形成可见答案',{exact:true}).waitFor();
  assert.equal(await coordinator.locator('.coordinator-typing.is-visible').count(),0,'planning shimmer disappears on the first visible response chunk');
  coordinatorState.streamingText='';coordinatorState.status='waiting-for-user';
  coordinatorState.messages.push({role:'assistant',text:'最终答案'});
  await coordinator.locator('.coordinator-message.assistant').filter({hasText:'最终答案'}).last().waitFor();
  assert.equal(await coordinator.getByText('正在形成可见答案',{exact:true}).count(),0,'stream preview is replaced by the durable final message');
  const transitionText='流式转最终只保留一份';
  coordinatorState.status='running';coordinatorState.streamingText=transitionText;
  coordinatorState.messages.push({role:'user',text:'检查重复过渡'},{role:'assistant',text:transitionText});
  await coordinator.locator('.coordinator-message.assistant').filter({hasText:transitionText}).waitFor();
  assert.equal(await coordinator.locator('.coordinator-message.assistant').filter({hasText:transitionText}).count(),1,'a committed final response suppresses the identical streaming preview');
  assert.equal(await coordinator.locator('.coordinator-streaming').count(),0,'the committed response is never rendered as a second streaming row');
  coordinatorState.streamingText='';coordinatorState.status='waiting-for-user';
  const seamlessText='先检查页面层级与段落间距。\n\n1. 检查对齐与留白。\n2. 检查窄屏换行。';
  coordinatorState.messages.push({role:'user',text:'检查流式完成态'});
  coordinatorState.status='running';coordinatorState.streamingText=seamlessText.slice(0,-10);
  await coordinator.locator('.coordinator-streaming').waitFor();
  await coordinator.locator('.coordinator-messages').evaluate(node=>{node.scrollTop=0;});
  coordinatorState.streamingText=seamlessText;
  await page.waitForFunction(()=>document.querySelector('.coordinator-streaming-text ol li:last-child')?.textContent==='检查窄屏换行。');
  assert.equal(await coordinator.locator('.coordinator-messages').evaluate(node=>node.scrollTop),0,'stream updates do not steal scroll position while the user reads older messages');
  const streamLayout=await coordinator.locator('.coordinator-streaming').evaluate(node=>{
    const root=node.getBoundingClientRect(),content=node.querySelector('.coordinator-streaming-text');
    return {height:root.height,blocks:[...content.children].map(child=>({tag:child.tagName,y:child.getBoundingClientRect().top-root.top,height:child.getBoundingClientRect().height}))};
  });
  coordinatorState.streamingText='';coordinatorState.status='waiting-for-user';coordinatorState.messages.push({role:'assistant',text:seamlessText});
  const seamlessFinal=coordinator.locator('.coordinator-message.assistant').filter({hasText:'先检查页面层级与段落间距。'}).last();
  await page.waitForFunction(()=>!document.querySelector('.coordinator-streaming'));
  const finalLayout=await seamlessFinal.evaluate(node=>{
    const root=node.getBoundingClientRect(),content=node.querySelector('.coordinator-markdown');
    return {height:root.height,blocks:[...content.children].map(child=>({tag:child.tagName,y:child.getBoundingClientRect().top-root.top,height:child.getBoundingClientRect().height}))};
  });
  assert.deepEqual(finalLayout,streamLayout,'stream completion keeps the same Markdown block layout without a second reflow');
  record('coordinator-streaming-text-is-visible-before-final-message');
  coordinatorState.messages.push({role:'assistant',text:'要上传什么？',questions:[{id:'choice',text:'要上传什么？',options:['网站构建产物','其他文件']}]});
  await coordinator.getByRole('button',{name:'网站构建产物',exact:true}).waitFor();
  assert.equal(await coordinator.locator('.coordinator-input-shell > button').textContent(),'','the main send control uses an icon instead of a text label');
  assert.equal(await coordinator.getByRole('button',{name:'发送',exact:true}).getAttribute('title'),'发送','the icon-only send control keeps an accessible label');
  await coordinator.getByLabel('发送给 Coordinator').fill('保留我的自由对话草稿');
  await coordinator.getByLabel('回答：要上传什么？').fill('保留我的补充');
  await coordinator.getByRole('button',{name:'网站构建产物',exact:true}).click();
  assert.equal(submissions.length,0,'the first option click only selects it');
  assert.equal(await coordinator.getByRole('button',{name:'网站构建产物',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await coordinator.getByRole('button',{name:'提交回答',exact:true}).count(),0,'questions have no separate submit-answer button');
  await coordinator.getByRole('button',{name:'网站构建产物',exact:true}).click();
  await coordinator.getByRole('button',{name:'重试原请求',exact:true}).waitFor();
  assert.equal(await coordinator.getByRole('button',{name:'重试原请求',exact:true}).textContent(),'↻','retry uses a symbol-only control');
  assert.equal(await coordinator.getByRole('button',{name:'重试原请求',exact:true}).evaluate(el=>el.parentElement===document.querySelector('#coordinator-panel .coordinator-toolbar')),true,'retry lives in the Coordinator toolbar');
  assert.equal(submissions.length,1);
  assert.equal(submissions[0].text,'网站构建产物\n\n保留我的补充');
  assert.equal(submissions[0].answerTo,'choice');
  assert.equal(await coordinator.getByLabel('回答：要上传什么？').inputValue(),'保留我的补充');
  assert.equal(await coordinator.getByLabel('发送给 Coordinator').inputValue(),'保留我的自由对话草稿');
  assert.equal(await coordinator.getByRole('button',{name:'网站构建产物',exact:true}).isEnabled(),false);
  assert.equal(approvals.length+mountReviews.length,0,'choice answers are never approvals');
  coordinatorState.status='running';coordinatorState.activeTurnId=submissions[0].id;
  coordinatorState.messages.at(-1).questions[0].answer={text:submissions[0].text,requestId:submissions[0].id};
  await page.reload();await synchronized();await page.locator('#btn-coordinator').click();
  await coordinator.locator('.coordinator-question-status').waitFor({state:'visible'});
  assert.match(await coordinator.locator('.coordinator-answer').textContent(),/网站构建产物[\s\S]*保留我的补充/);
  assert.equal(await coordinator.locator('.coordinator-typing').isVisible(),false,'answer activity stays with the question');
  coordinatorState.status='waiting-for-user';coordinatorState.activeTurnId=null;
  await coordinator.locator('.coordinator-question-status').waitFor({state:'hidden'});
  coordinatorState.status='running';
  await coordinator.locator('.coordinator-typing').waitFor({state:'visible'});
  coordinatorState.status='waiting-for-user';
  await coordinator.locator('.coordinator-typing').waitFor({state:'hidden'});
  // Reload clears the deliberately uncertain local request; this mock has not persisted it.
  submissions.length=0;coordinatorState.messages.pop();
  await page.reload();await synchronized();await page.locator('#btn-coordinator').click();
  await coordinator.locator('.coordinator-messages').evaluate(node=>{node.scrollTop=0;});
  await coordinator.screenshot({ path: path.join(output, 'coordinator-chat.png') });
  await coordinator.getByRole('button', { name: '确认这些节点', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#coordinator-panel [role=status]')?.textContent.includes('节点审核尚未成功'));
  await coordinator.getByRole('button', { name: '确认这些节点', exact: true }).click();
  await coordinator.getByRole('button', { name: '确认这些节点', exact: true }).waitFor({ state: 'detached' });
  assert.deepEqual(mountReviews[0].proposalIds, ['frontend', 'build']);
  assert.deepEqual(mountReviews[1], mountReviews[0], 'the batch retry preserves its original request');
  assert.equal(submissions.length, 0, 'node confirmation uses the script endpoint, not a model request');
  coordinatorState.approvals.push({ id: 'reader', kind: 'mount-proposal', pending: true,
    mainVersion: 'main-v2', title: 'reader', purpose: '读者体验', owns: ['reader/'] });
  await page.reload();await synchronized();await page.locator('#btn-coordinator').click();
  await coordinator.getByRole('button', { name: '拒绝这些节点', exact: true }).click();
  await coordinator.getByRole('button', { name: '拒绝这些节点', exact: true }).waitFor({ state: 'detached' });
  assert.equal(mountReviews[2].decision, 'rejected');
  assert.equal(mountReviews[2].reason, '拒绝所示节点，请重新提案');
  await coordinator.getByRole('button', { name: '确认需求', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#coordinator-panel [role=status]')?.textContent.includes('确认尚未成功'));
  await coordinator.getByRole('button', { name: '确认需求', exact: true }).click();
  await coordinator.getByRole('button', { name: '确认需求', exact: true }).waitFor({ state: 'detached' });
  assert.equal(approvals[0].id, approvals[1].id);
  assert.equal(submissions.length, 0, 'human confirmation is a script request, not a model prompt');
  await coordinator.getByLabel('发送给 Coordinator').fill('模拟需求');
  await coordinator.getByLabel('发送给 Coordinator').press('Shift+Enter');
  await coordinator.getByLabel('发送给 Coordinator').type('补充一行');
  assert.equal(await coordinator.getByLabel('发送给 Coordinator').inputValue(),'模拟需求\n补充一行');
  await coordinator.getByLabel('发送给 Coordinator').press('Enter');
  await coordinator.getByRole('button', { name: '重试原请求' }).waitFor();
  await page.waitForFunction(() => document.querySelector('#coordinator-panel > [role=status]')?.textContent.includes('尚未确认提交'));
  assert.match(await coordinator.locator(':scope > [role=status]').first().textContent(), /尚未确认提交/);
  await coordinator.getByRole('button', { name: '重试原请求' }).click();
  await page.waitForFunction(() => document.querySelector('#coordinator-panel [role=status]')?.textContent.includes('MODEL_TIMEOUT'));
  assert.equal(submissions[0].id, submissions[1].id, 'uncertain transport must reuse the exact request');
  await page.reload(); await synchronized();
  await page.locator('#btn-coordinator').click();
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
  await page.waitForFunction(() => document.querySelector('#coordinator-panel [role=status]')?.textContent === '' && document.querySelector('#coordinator-panel button[type=submit]').disabled && document.querySelector('textarea[aria-label="发送给 Coordinator"]')?.value === '');
  assert.notEqual(submissions.at(-1).id, submissions[0].id);
  assert.equal(submissions.at(-1).retry, undefined, 'human correction is a new message, not an unsafe replay');
  record('Coordinator feature gate, safe Markdown rendering and durable explicit retries');

  const beforeLostReply = submissions.length;
  await coordinator.getByLabel('发送给 Coordinator').fill('已持久化但响应丢失');
  await coordinator.getByLabel('发送给 Coordinator').press('Enter');
  await page.waitForFunction(() => {
    const panel = document.querySelector('#coordinator-panel');
    const retry = panel.querySelector('button[aria-label="重试原请求"]');
    return panel.querySelector('[role=status]').textContent === '' && retry.hidden &&
      panel.querySelector('button[type=submit]').disabled && panel.querySelector('textarea[aria-label="发送给 Coordinator"]').value === '';
  });
  assert.equal(submissions.length, beforeLostReply + 1, 'durable receipt reconciliation never submits a second model turn');
  record('Coordinator reconciles a lost HTTP acknowledgement without manual retry or duplicate submission');

  await coordinator.getByLabel('发送给 Coordinator').fill('立即显示测试');
  await coordinator.getByLabel('发送给 Coordinator').press('Enter');
  await coordinator.locator('.coordinator-message.coordinator-optimistic').filter({ hasText: '立即显示测试' }).waitFor({ state: 'visible' });
  await coordinator.locator('.coordinator-typing.is-visible').waitFor({state:'visible'});
  assert.equal(typeof releaseDelayedSubmission, 'function', 'the delayed request is still waiting for the server receipt');
  assert.equal(await coordinator.locator('.coordinator-message.coordinator-optimistic').filter({ hasText: '立即显示测试' }).textContent(), '立即显示测试', 'the sent message appears before the network response');
  assert.match(await coordinator.locator('.coordinator-typing.is-visible').evaluate(node=>node.previousElementSibling?.className||''),/coordinator-optimistic/,'planning motion appears immediately below the optimistic user message');
  releaseDelayedSubmission();
  await page.waitForFunction(() => !document.querySelector('.coordinator-message.coordinator-optimistic'));
  assert.equal(await coordinator.locator('.coordinator-message.user').filter({ hasText: '立即显示测试' }).count(), 1, 'server confirmation reconciles the optimistic message without duplication');
  record('Coordinator sends with immediate optimistic message feedback');

  const itemConversations=[];
  await page.route(/\/api\/coordinator\/conversations(?:\?|$)/,async route=>{
    const item=route.request().postDataJSON(), id=item.kind+'-'+item.itemId;
    itemConversations.push({...item,id});
    coordinatorState.conversations=[{id:'legacy',title:'历史总对话'},...itemConversations.map(item=>({...item,title:item.itemId}))];
    return route.fulfill({json:{id}});
  });

  for (const kind of ['todo', 'bug']) {
    await page.locator('#btn-coordinator').click();
    await page.locator(`[data-act="add-${kind}"]`).click();
    const previous = await syncVersion();
    const editor = kind === 'todo' ? page.locator('#detail [data-ed="todo-text"]').last() : page.locator('#detail [data-ed="bug-title"]').last();
    await editor.fill(`Discuss new ${kind} before dispatch`);
    await editor.press('Tab');
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
    if(await coordinator.getAttribute('open')!==null) await page.locator('#btn-coordinator').click();
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

  assert.equal(await coordinator.getByRole('button',{name:'新建 Coordinator Session',exact:true}).count(),1);
  assert.equal(await coordinator.getByLabel('Coordinator 事项对话').count(),0);
  assert.equal(await coordinator.getByText(/运行记录/).count(),0);
  record('Coordinator hides removed controls while per-item conversation entry remains usable');

  const acceptanceRequests = [];
  await page.route(/\/api\/coordinator\/acceptance(?:\?|$)/, async route => {
    acceptanceRequests.push(route.request().postDataJSON());
    coordinatorState = { ...coordinatorState, acceptances: [] };
    await route.fulfill({ json: { accepted: true } });
  });
  coordinatorState = { ...coordinatorState, acceptances: [{
    taskId: 'task-review-ui', sessionId: 'session-one', sourceSha: 'sha-review-ui',
    brief: { text: '这是一个超过六十个字符的验收说明，用于确认任务信息会自动按句子分段并以 Markdown 结构显示。' },
    result: { verdict: 'passed' }, ci: { ref: 'ci-review-ui', version: 'ci-version-review-ui' },
  }] };
  await page.reload(); await synchronized(); await page.locator('#btn-coordinator').click();
  await coordinator.getByRole('button', { name: '验收不通过', exact: true }).click();
  const reviewForm = coordinator.locator('.coordinator-review-inline');
  await reviewForm.waitFor();
  await reviewForm.locator('textarea').fill('需要补充部署路径和回滚验证。');
  await reviewForm.getByRole('button', { name: '提交反馈', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.coordinator-review-inline'));
  assert.equal(acceptanceRequests.length, 1);
  assert.equal(acceptanceRequests[0].decision, 'rejected');
  assert.equal(acceptanceRequests[0].reason, '需要补充部署路径和回滚验证。');
  record('Coordinator acceptance rejection opens an inline feedback form');

  const attachmentMap = structuredClone(sessionMap);
  attachmentMap.root.memories = [{ text: 'Attachment fixture', state: 'dirty', files: [] }];
  const currentMain = await request(`${service.url}/v1/projects/context-guard/main`, { headers: headers('project-memory-token') });
  const attachmentSeed = await request(`${service.url}/v1/projects/context-guard/sessions/attachment-session`, {
    method: 'POST', headers: headers('project-memory-token'), body: JSON.stringify({ operationId: 'attachment-browser-seed',
      baseVersion: null, baseMainVersion: currentMain.body.snapshot.version, sourceCommit: featureSha, memory: { map: attachmentMap, records: {} } }),
  });
  assert.equal(attachmentSeed.response.status, 200, JSON.stringify(attachmentSeed.body));
  const attachmentPage = await context.newPage();
  await attachmentPage.goto(`${service.url}/projects/context-guard?session=attachment-session`);
  await attachmentPage.waitForFunction(() => document.querySelector('#cg-sync')?.dataset.status === 'synced'
    && document.querySelector('.node[data-id="T0"]')?.textContent?.includes('Session map'));
  await attachmentPage.locator('.node[data-id="T0"]').click();
  const attachmentButton = attachmentPage.getByRole('button', { name: '附件 ＋', exact: true });
  await attachmentButton.waitFor();
  const chooser = attachmentPage.waitForEvent('filechooser');
  await attachmentButton.click();
  await (await chooser).setFiles({
    name: 'browser-fixture.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nSynthetic browser fixture\n%%EOF'),
  });
  const quarkLink = attachmentPage.getByRole('link', { name: 'browser-fixture.pdf', exact: true });
  await quarkLink.waitFor();
  assert.equal(await quarkLink.getAttribute('href'), 'https://pan.quark.cn/s/browserfixture');
  assert.match(await attachmentPage.locator('.file-chip').first().textContent(), /Ab12/);
  assert.equal(await attachmentPage.getByRole('button', { name: '附件 1 ＋', exact: true }).count(), 1);
  await attachmentPage.reload();
  await attachmentPage.locator('.node[data-id="T0"]').click();
  await quarkLink.waitFor();
  await attachmentPage.screenshot({ path: path.join(output, 'quark-desktop.png'), fullPage: true });
  await attachmentPage.setViewportSize({ width: 390, height: 844 });
  await attachmentPage.screenshot({ path: path.join(output, 'quark-mobile.png'), fullPage: true });
  const phoneSplit = attachmentPage.locator('#drawer-split');
  assert.equal(await attachmentPage.locator('html').evaluate(el => el.classList.contains('cg-phone')), true);
  await attachmentPage.locator('#workbench-tools > summary').click();
  const phoneToolsMenu = await attachmentPage.locator('.workbench-tools-menu').evaluate(menu => {
    const rect = menu.getBoundingClientRect();
    const point = { x: rect.left + Math.min(rect.width / 2, 20), y: rect.top + Math.min(rect.height / 2, 20) };
    return { open: menu.closest('details')?.open, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      hit: menu.contains(document.elementFromPoint(point.x, point.y)), viewport: { width: innerWidth, height: innerHeight } };
  });
  assert.ok(phoneToolsMenu.open && phoneToolsMenu.hit && phoneToolsMenu.rect.left >= 0
    && phoneToolsMenu.rect.right <= phoneToolsMenu.viewport.width
    && phoneToolsMenu.rect.bottom <= phoneToolsMenu.viewport.height,
  `phone workbench tools menu must actually be visible: ${JSON.stringify(phoneToolsMenu)}`);
  for (const selector of ['#dir-toggle', '#btn-rel', '#btn-auth', '#btn-bugs', '#btn-todos']) {
    assert.equal(await attachmentPage.locator(selector).evaluate(control => {
      const rect = control.getBoundingClientRect();
      return control.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    }), true, `${selector} must be reachable in the phone tools menu`);
  }
  await attachmentPage.locator('#workbench-tools > summary').click();
  record('Phone workbench tools menu opens visibly inside the viewport');
  await phoneSplit.focus();
  for (let i = 0; i < 24; i++) await phoneSplit.press('Shift+ArrowUp');
  const expandedPhoneDrawer = await attachmentPage.evaluate(() => ({
    chromeBottom: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chrome-top')),
    drawerTop: document.querySelector('.drawer').getBoundingClientRect().top,
    viewportHeight: document.querySelector('#viewport').getBoundingClientRect().height,
  }));
  assert.ok(Math.abs(expandedPhoneDrawer.drawerTop - expandedPhoneDrawer.chromeBottom) <= 2, `phone inspector can reach the top bar: ${JSON.stringify(expandedPhoneDrawer)}`);
  assert.ok(expandedPhoneDrawer.viewportHeight <= 2, 'phone inspector need not leave the map visible');
  await attachmentPage.screenshot({ path: path.join(output, 'phone-inspector-expanded.png'), fullPage: true });
  await phoneSplit.dblclick();
  assert.ok(await attachmentPage.locator('#viewport').evaluate(el => el.getBoundingClientRect().height) > 100, 'double-click restores the map area');
  record('Phone inspector can expand over the map and restore its default split');
  await attachmentPage.close();
  record('Visible Cloud attachment picker uploads a PDF, persists a protected Quark link and survives refresh');

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
