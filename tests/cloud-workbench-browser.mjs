import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startCloudServer } from '../scripts/cloud/server.mjs';

const output = path.resolve(process.argv[2] || `output/playwright/browser-ci/cloud-${Date.now()}-${randomUUID()}`);
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-cloud-browser-'));
const memoryConfig = {
  dataDir: path.join(dataDir, 'memory'),
  adminToken: 'memory-admin',
  projects: { 'context-guard': { token: 'project-memory-token' } },
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
  service = await startCloudServer({
    host: '127.0.0.1',
    port: 0,
    dataDir,
    adminToken: 'cloud-admin',
    browserToken: 'browser-token',
    privateAccess: true,
    memoryConfig,
  });
  const seededMain = await request(`${service.url}/api/projects/context-guard/snapshot`, {
    method: 'POST',
    headers: headers('cloud-admin'),
    body: JSON.stringify({ baseVersion: null, operationId: 'browser-main-seed', document: mainMap }),
  });
  assert.equal(seededMain.response.status, 200, JSON.stringify(seededMain.body));
  const seededSession = await request(`${service.url}/v1/projects/context-guard/sessions/session-one`, {
    method: 'POST',
    headers: headers('project-memory-token'),
    body: JSON.stringify({ operationId: 'browser-session-seed', baseVersion: null, baseMainVersion: null, sourceCommit: 'a'.repeat(40), memory: { map: sessionMap, records: {} } }),
  });
  assert.equal(seededSession.response.status, 200, JSON.stringify(seededSession.body));

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  await page.goto(`${service.url}/auth?token=browser-token&next=/projects/context-guard`);
  await synchronized();
  assert.match(await page.locator('.node[data-id="T0"]').textContent(), /Main map/);
  record('Main is the default view');

  await page.locator('#session-chip').click();
  await page.locator('#session-menu [data-session="session-one"]').click();
  await page.waitForFunction(() => document.querySelector('#cg-sync-session')?.value === 'session-one');
  await synchronized();
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
