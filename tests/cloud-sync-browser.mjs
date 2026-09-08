import '../.github/scripts/test-environment.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createWorkbenchPasswordHash, startCloudServer } from '../scripts/cloud/server.mjs';
import { startServer } from '../scripts/workbench/server.mjs';
import { resolveProject } from '../scripts/workbench/project.mjs';
import { sessionMemoryDir } from '../scripts/workbench/memory.mjs';
import { atomicWrite, encode, pause } from '../scripts/workbench/io.mjs';

const output = path.resolve(process.argv[2] || `output/playwright/browser-ci/session-sync-${Date.now()}-${randomUUID()}`);
const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'context-guard-session-sync-browser-'));
const root = path.join(sandbox, 'project');
const ctx = path.join(root, '.codex/context');
const sessionId = 'browser-session-sync';
const memoryConfig = {
  dataDir: path.join(sandbox, 'memory'),
  adminToken: 'memory-admin',
  projects: { 'context-guard': { token: 'project-memory-token', root, ref: 'refs/heads/main' } },
};
const document = {
  v: 1, project: 'Context Guard', bootstrap: 'ready', flows: [],
  root: {
    id: 'T0', title: 'Session Map', purpose: '双向同步测试', kind: 'module', state: 'dirty', proposal: 'accepted',
    memories: [], ideas: [], todos: [{ id: 'TD1', title: '浏览器挂载任务', desc: '从 Cloud 触发本地 Codex', status: 'pending', sessions: [] }],
    bugs: [{ id: 'B1', title: '已修复的同步问题', status: 'fixed', sessions: [sessionId] }], dormant: [], files: [], owns: [], children: [],
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
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:example/repo.git'], { cwd: root, windowsHide: true });
  const fixtureSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', fixtureSha], { cwd: root, windowsHide: true });
  execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], { cwd: root, windowsHide: true });
  await fs.writeFile(path.join(ctx, 'map.json'), encode(document));
  await fs.writeFile(path.join(ctx, 'sessions.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), event: 'session-start', platform: 'codex', session_id: sessionId, thread_name: 'browser-sync' })}\n`);

  cloud = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir: path.join(sandbox, 'cloud'), adminToken: 'cloud-admin', browserToken: 'cloud-admin',
    browserPasswordHash: await createWorkbenchPasswordHash('test-only'), memoryConfig,
    protocolConfig: { repositories: [{ slug: 'example/repo', repositoryId: '123', projectId: 'context-guard' }] } });
  const project = await resolveProject(root);
  await atomicWrite(path.join(project.sharedDir, 'memory-client.json'), encode({ url: cloud.url, projectId: 'context-guard', token: 'project-memory-token' }));
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const baseline = await request(`${cloud.url}/v1/projects/context-guard/sessions/browser-baseline`, {
    method: 'POST', headers: headers('project-memory-token'),
    body: JSON.stringify({ operationId: 'browser-sync-baseline', baseVersion: null, baseMainVersion: null, sourceCommit, memory: { map: document, records: {} } }),
  });
  const published = await request(`${cloud.url}/v1/projects/context-guard/publish`, {
    method: 'POST', headers: headers('project-memory-token'),
    body: JSON.stringify({ operationId: 'browser-sync-main', baseVersion: null, sessionId: 'browser-baseline', sessionVersion: baseline.snapshot.version, expectedMainSha: sourceCommit }),
  });
  await request(`${cloud.url}/v1/projects/context-guard/sessions/${sessionId}`, {
    method: 'POST', headers: headers('project-memory-token'),
    body: JSON.stringify({ operationId: 'browser-sync-seed', baseVersion: null, baseMainVersion: published.snapshot.version, sourceCommit, memory: { map: document, records: {} } }),
  });

  const delivered = [];
  local = await startServer({ root, port: 0, messageQueue: async input => delivered.push(input), repositoryLookup: async () => ({ repositoryId: '123', slug: 'example/repo' }) });
  await request(new URL('/api/v2/messages', local.state.url), {
    method: 'POST', headers: headers(local.humanToken),
    body: JSON.stringify({ v: 2, id: 'browser-device-login', type: 'auth.open', payload: { repository: 'auto', clientId: 'local-backend', password: 'test-only' } }),
  });
  const registration = await request(new URL('/api/session', local.state.url), {
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
  await cloudPage.waitForFunction(() => document.querySelector('#cg-sync')?.dataset.status === 'synced');
  await cloudPage.locator('.node[data-id="T0"]').click();
  await cloudPage.locator('button[data-todo-assign="TD1"]').click();
  const assignmentDialog = cloudPage.locator('dialog[open]');
  await assignmentDialog.locator('select[name="session"]').selectOption(sessionId);
  await assignmentDialog.locator('[data-submit]').click();
  await cloudPage.locator('#detail').getByText('Codex 已收到', { exact: true }).waitFor({ timeout: 25000 });
  assert.equal(delivered.length, 1); assert.equal(delivered[0].sessionId, sessionId);
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

  await cloudPage.locator('#session-chip').click();
  await cloudPage.locator('#session-menu [data-session="__all__"]').click();
  await cloudPage.locator('.node[data-id="T0"]').click();
  await cloudPage.route('**/api/task-review*', async route => {
    const response = await route.fetch();
    await pause(200); // Let the committed Main state notification arrive first.
    await route.fulfill({ response });
  });
  const report = (index, stage, outcome = 'success', summary = 'Fixture task completed') => request(new URL('/api/v2/task-report', local.state.url), {
    method: 'POST', headers: headers(registration.token), body: JSON.stringify({ deliveryId: delivered[index].message.match(/map task start (\S+)/)[1], stage,
      ...(stage === 'finished' ? { outcome, summary } : {}) }),
  });
  const actualSummary = '原因：同步等待。\n修复：隔离心跳。\n验证：正式回归通过。';
  const approve = cloudPage.locator('[data-task-review="approved"][data-review-item="TD1"]');
  assert.equal(await approve.isDisabled(), true, 'unfinished task cannot be reviewed');
  await report(0, 'started'); await report(0, 'finished', 'success', actualSummary);
  await cloudPage.locator('#detail').getByText('待人类验收', { exact: true }).waitFor();
  await approve.click();
  await cloudPage.locator('#detail').getByText('验收通过', { exact: true }).waitFor();
  await cloudPage.locator('#cg-sync[data-status="synced"]').waitFor({ state: 'attached' });
  assert.equal(await approve.isDisabled(), true);
  assert.equal(delivered.length, 1, 'acceptance never queues a summary');
  await cloudPage.reload();
  await cloudPage.locator('.node[data-id="T0"]').click();
  const summaryPanel = cloudPage.locator('#detail details').filter({ has: cloudPage.locator('summary', { hasText: 'Agent 结果与经验' }) });
  await summaryPanel.locator('summary').click();
  assert.equal((await summaryPanel.locator('p').textContent()).trim(), actualSummary);
  assert.equal(await approve.isDisabled(), true, 'refresh preserves review');
  assert.ok((await cloudPage.locator('#detail .mem-list').allTextContents()).join('').includes(actualSummary), 'accepted experience is published');
  await cloudPage.locator('[data-bug-assign="B1"]').click();
  await cloudPage.locator('dialog[open] select[name="session"]').selectOption(sessionId);
  await cloudPage.locator('dialog[open] [data-submit]').click();
  const deadline = Date.now() + 25000;
  while (delivered.length < 2 && Date.now() < deadline) await pause(100);
  assert.equal(delivered.length, 2);
  await report(1, 'started'); await report(1, 'finished', 'success', 'Agent reports a fix; human must verify it');
  const reject = cloudPage.locator('[data-task-review="rejected"][data-review-item="B1"]');
  await reject.click();
  await cloudPage.locator('dialog[open] textarea[name="reason"]').fill('问题仍然能复现');
  await cloudPage.locator('dialog[open] button[value="submit"]').click();
  await cloudPage.locator('#detail').getByText('验收未通过 · 待澄清', { exact: true }).waitFor();
  assert.equal(await cloudPage.locator('#bug-count').textContent(), '1', 'rejected verification still counts as unresolved');
  const feedback = await cloudPage.request.get(`${cloud.url}/api/workbench/projects/context-guard/api/review-feedback?view=main`).then(response => response.json());
  assert.equal(feedback.items.length, 1); assert.equal(feedback.items[0].reason, '问题仍然能复现');
  await cloudPage.reload(); await cloudPage.locator('.node[data-id="T0"]').click();
  await cloudPage.locator('#detail').getByText('验收未通过 · 待澄清', { exact: true }).waitFor();
  assert.equal(await reject.isDisabled(), true);
  assert.equal(delivered.length, 2, 'rejection saves feedback without waking any Agent');

  await fs.mkdir(output, { recursive: true });
  await localPage.screenshot({ path: path.join(output, 'local.png'), fullPage: true });
  await cloudPage.screenshot({ path: path.join(output, 'cloud.png'), fullPage: true });
  await fs.writeFile(path.join(output, 'result.json'), encode({ passed: true, checks: ['cloud-task-to-local-codex', 'local-to-cloud', 'cloud-to-local', 'refresh-persistence', 'server-timestamps', 'human-review-without-model-dispatch', 'atomic-experience-publication', 'review-refresh-persistence', 'rejected-bug-feedback-without-dispatch'] }));
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
