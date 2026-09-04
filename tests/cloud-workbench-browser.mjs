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
    body: JSON.stringify({ operationId: 'browser-session-seed', baseVersion: null, baseMainVersion: baselinePublication.body.snapshot.version, sourceCommit: featureSha, memory: { map: sessionMap, records: {} } }),
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
  assert.equal(await page.locator('body').evaluate(el => el.classList.contains('rel-mode')), false);
  assert.equal(await page.locator('#btn-rel').getAttribute('aria-pressed'), 'false');
  await page.locator('#session-chip').click();
  assert.equal(await page.locator('#session-menu .session-option-name').filter({ hasText: '当前会话' }).count(), 0, 'Cloud overview/project pages have no actual current Session');
  assert.equal(await page.locator('#session-menu [data-session="session-one"] .session-option-name').textContent(), 'agent 会话');
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
  await synchronized();
  await page.locator('#session-chip').click();
  await page.locator('#session-menu [data-session="session-one"]').click();
  await page.waitForFunction(() => document.querySelector('#btn-publish-main')?.dataset.status === 'ready');
  await page.locator('#btn-publish-main').click();
  await page.waitForFunction(() => document.querySelector('#btn-publish-main')?.dataset.status === 'published');
  await synchronized();
  assert.match(await page.locator('.node[data-id="T0"]').textContent(), /Session map edited in browser/);
  assert.doesNotMatch(await page.content(), /memory-admin|cloud-admin|project-memory-token/);
  await page.reload();
  await synchronized();
  assert.match(await page.locator('.node[data-id="T0"]').textContent(), /Session map edited in browser/);
  assert.equal(new URL(page.url()).searchParams.has('session'), false);
  await page.locator('#session-chip').click();
  assert.equal(await page.locator('#session-menu [data-session="session-one"]').count(), 0, 'a published Session leaves the active selector');
  assert.equal(await page.locator('#cg-sync-session option[value="session-one"]').count(), 0);
  await page.locator('#session-chip').click();
  record('Verified publication updates durable read-only Main without exposing an admin token');

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
