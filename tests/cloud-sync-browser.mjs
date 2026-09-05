import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startCloudServer } from '../scripts/cloud/server.mjs';
import { startServer } from '../scripts/workbench/server.mjs';
import { resolveProject } from '../scripts/workbench/project.mjs';
import { sessionMemoryDir } from '../scripts/workbench/memory.mjs';
import { atomicWrite, encode } from '../scripts/workbench/io.mjs';

const output = path.resolve(process.argv[2] || `output/playwright/browser-ci/session-sync-${Date.now()}-${randomUUID()}`);
const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-session-sync-browser-'));
const root = path.join(sandbox, 'project');
const ctx = path.join(root, '.codex/context');
const sessionId = 'browser-session-sync';
const memoryConfig = {
  dataDir: path.join(sandbox, 'memory'),
  adminToken: 'memory-admin',
  projects: { 'context-guard': { token: 'project-memory-token' } },
};
const document = {
  v: 1, project: 'Context Guard', bootstrap: 'ready', flows: [],
  root: {
    id: 'T0', title: 'Session Map', purpose: '双向同步测试', kind: 'module', state: 'dirty', proposal: 'accepted',
    memories: [], ideas: [], todos: [], bugs: [], dormant: [], files: [], owns: [], children: [],
  },
};
const headers = token => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const request = async (url, options = {}) => {
  const response = await fetch(url, options);
  const body = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(body)}`);
  return body;
};
let cloud, local, browser, localPage, cloudPage, passed = false;

try {
  await fs.mkdir(ctx, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'sync@example.test'], { cwd: root, windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Sync Test'], { cwd: root, windowsHide: true });
  await fs.writeFile(path.join(root, 'README.md'), '# sync fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root, windowsHide: true });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore', windowsHide: true });
  await fs.writeFile(path.join(ctx, 'map.json'), encode(document));
  await fs.writeFile(path.join(ctx, 'sessions.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), event: 'session-start', platform: 'codex', session_id: sessionId, thread_name: 'browser-sync' })}\n`);

  cloud = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir: path.join(sandbox, 'cloud'), adminToken: 'cloud-admin', memoryConfig });
  const project = await resolveProject(root);
  await atomicWrite(path.join(project.sharedDir, 'memory-client.json'), encode({ url: cloud.url, projectId: 'context-guard', token: 'project-memory-token' }));
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  await request(`${cloud.url}/v1/projects/context-guard/sessions/${sessionId}`, {
    method: 'POST', headers: headers('project-memory-token'),
    body: JSON.stringify({ operationId: 'browser-sync-seed', baseVersion: null, baseMainVersion: null, sourceCommit, memory: { map: document, records: {} } }),
  });

  local = await startServer({ root, port: 0 });
  await request(new URL('/api/session', local.state.url), {
    method: 'POST', headers: headers(local.state.adminToken),
    body: JSON.stringify({ sessionId, worktreeRoot: root }),
  });

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  localPage = await context.newPage(); cloudPage = await context.newPage();
  for (const page of [localPage, cloudPage]) page.setDefaultTimeout(12000);
  await localPage.goto(`${local.state.url}?session=${sessionId}`);
  await localPage.waitForFunction(id => document.querySelector('#cg-sync-session')?.value === id, sessionId);
  await localPage.waitForSelector('#cloud-sync-status.synced:not([hidden])');
  await cloudPage.goto(`${cloud.url}/auth?token=cloud-admin&next=${encodeURIComponent('/projects/context-guard')}`);
  await cloudPage.locator('#session-chip').click();
  await cloudPage.locator(`#session-menu [data-session="${sessionId}"]`).click();
  await cloudPage.waitForFunction(id => document.querySelector('#cg-sync-session')?.value === id, sessionId);

  await localPage.locator('.node[data-id="T0"]').click();
  await localPage.locator('#detail [data-ed="title"]').fill('本地写入 Cloud');
  await localPage.locator('#detail [data-ed="title"]').blur();
  await localPage.waitForSelector('#cloud-sync-status.synced:not([hidden])');
  await cloudPage.waitForFunction(() => document.querySelector('.node[data-id="T0"]')?.textContent?.includes('本地写入 Cloud'));

  await cloudPage.locator('.node[data-id="T0"]').click();
  await cloudPage.locator('#detail [data-ed="purpose"]').fill('Cloud 写回本地');
  await cloudPage.locator('#detail [data-ed="purpose"]').blur();
  await cloudPage.waitForFunction(() => document.querySelector('#cg-sync')?.dataset.status === 'synced');
  await localPage.waitForFunction(() => document.querySelector('.node[data-id="T0"]')?.textContent?.includes('Cloud 写回本地'));
  await localPage.waitForSelector('#cloud-sync-status.synced:not([hidden])');

  await Promise.all([localPage.reload(), cloudPage.reload()]);
  await localPage.waitForFunction(id => document.querySelector('#cg-sync-session')?.value === id, sessionId);
  await cloudPage.locator('#session-chip').click();
  await cloudPage.locator(`#session-menu [data-session="${sessionId}"]`).click();
  await cloudPage.waitForFunction(id => document.querySelector('#cg-sync-session')?.value === id, sessionId);
  for (const page of [localPage, cloudPage]) {
    assert.match(await page.locator('.node[data-id="T0"]').textContent(), /本地写入 Cloud/);
    await page.locator('.node[data-id="T0"]').click();
    assert.equal((await page.locator('#detail [data-ed="purpose"]').textContent()).trim(), 'Cloud 写回本地');
  }
  const disk = JSON.parse(await fs.readFile(path.join(sessionMemoryDir(project, sessionId), 'map.json'), 'utf8'));
  assert.equal(disk.root.title, '本地写入 Cloud');
  assert.equal(disk.root.purpose, 'Cloud 写回本地');
  const changes = await request(`${cloud.url}/v1/projects/context-guard/sessions/${sessionId}/changes?after=0`, { headers: headers('project-memory-token') });
  assert.ok(changes.events.length >= 3);
  for (const event of changes.events) assert.equal(event.at, new Date(event.at).toISOString());

  await fs.mkdir(output, { recursive: true });
  await localPage.screenshot({ path: path.join(output, 'local.png'), fullPage: true });
  await cloudPage.screenshot({ path: path.join(output, 'cloud.png'), fullPage: true });
  await fs.writeFile(path.join(output, 'result.json'), encode({ passed: true, checks: ['local-to-cloud', 'cloud-to-local', 'refresh-persistence', 'server-timestamps'] }));
  passed = true;
} finally {
  if (!passed) {
    await fs.mkdir(output, { recursive: true }).catch(() => {});
    await localPage?.screenshot({ path: path.join(output, 'local-failure.png'), fullPage: true }).catch(() => {});
    await cloudPage?.screenshot({ path: path.join(output, 'cloud-failure.png'), fullPage: true }).catch(() => {});
  }
  await browser?.close().catch(() => {});
  await local?.close().catch(() => {});
  await cloud?.close().catch(() => {});
  // Windows can briefly retain directory handles after browser/server shutdown.
  await fs.rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

console.log(`Session sync browser artifacts: ${output}`);
