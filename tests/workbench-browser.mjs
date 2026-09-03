import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
    cwd: root, env, input: JSON.stringify({ cwd: root, session_id: session, thread_name: 'basic-browser', is_background_agent: true }), timeout: 20000,
  });
  const sessions = (await fs.readFile(path.join(ctx, 'sessions.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(sessions.some(event => event.session_id === session && event.event === 'session-start'));
  assert.ok((await fs.stat(path.join(ctx, 'sessions', `${session}.md`))).isFile());
  await run(process.execPath, [path.join(workspace, 'bin/context-guard-skill.js'), 'set-language', '--root', root, '--language', 'zh'], { cwd: root, env });
  await fs.writeFile(mapPath, encode({ v: 1, project: 'browser-test', bootstrap: 'pending', flows: [], root: null }));
  running = await startServer({ root, port: 0, messageQueue });
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
  await synchronized();
  if (await page.locator('#btn-settings').getAttribute('aria-expanded') === 'true') await page.locator('#btn-settings').click();
  assert.equal(await page.locator('.session-chip').isVisible(), true);
  assert.equal(await page.locator('#cg-sync-session').inputValue(), '__all__');
  assert.equal(await page.locator('#session-name').textContent(), '全部 Session');
  assert.equal(await page.locator('#session-status').evaluate(el => el.classList.contains('empty')), true);
  assert.equal(await page.locator('.node[data-id="N1"]').evaluate(el => el.classList.contains('noauth')), false);
  assert.equal(await page.locator('#auth-count').count(), 0);
  assert.equal(await page.locator('#cg-sync-session option:checked').textContent(), '全部 Session');
  await page.locator('#session-chip').click();
  assert.equal(await page.locator('#session-menu [data-session]').count(), 2);
  await page.locator('#session-chip').click();
  await fs.appendFile(path.join(ctx, 'sessions.jsonl'), `${JSON.stringify({ at: new Date(Date.now() + 500).toISOString(), event: 'maintenance', platform: 'cli', session_id: 'maintenance-browser' })}\n`);
  const liveSession = 'browser-live-agent';
  await fs.appendFile(path.join(ctx, 'sessions.jsonl'), `${JSON.stringify({ at: new Date(Date.now() + 1000).toISOString(), event: 'session-start', platform: 'cursor', session_id: liveSession })}\n`);
  await page.waitForFunction(() => document.querySelectorAll('#session-menu [data-session]').length === 3);
  assert.equal(await page.locator('#cg-sync-session').inputValue(), '__all__');
  assert.equal(await page.locator('#cg-sync-session option').filter({ hasText: 'maintenance-browser' }).count(), 0);
  await running.access.grant(liveSession, ['N1'], running.store.version);
  await page.locator('#session-chip').click();
  assert.equal(await page.locator('#session-menu [data-session]').count(), 3);
  await page.locator(`#session-menu [data-session="${session}"]`).click();
  await page.waitForFunction(id => document.querySelector('#cg-sync-session')?.value === id, session);
  assert.equal(await page.locator('.node[data-id="N1"]').evaluate(el => el.classList.contains('noauth')), true);
  await page.locator('#session-chip').click();
  await page.locator(`#session-menu [data-session="${liveSession}"]`).click();
  await page.waitForFunction(id => document.querySelector('#cg-sync-session')?.value === id, liveSession);
  assert.equal(await page.locator('#session-name').textContent(), 'cursor-browser-live-agent');
  assert.equal(await page.locator('.node[data-id="N1"]').evaluate(el => el.classList.contains('noauth')), false);
  await page.locator('#session-chip').click();
  await page.locator(`#session-menu [data-session="${session}"]`).click();
  await page.waitForFunction(id => document.querySelector('#cg-sync-session')?.value === id, session);
  recordCheck('top-session-switch-and-scope');
  await page.locator('#session-chip').click();
  await page.locator('#session-menu [data-session="__all__"]').click();
  await page.waitForFunction(() => document.querySelector('#cg-sync-session')?.value === '__all__');
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
  await until(() => queuedMessages.length === 1);
  assert.equal((await read()).root.children[0].bugs.find(bug => bug.title === '处理状态测试').sessions.length, 0);
  assert.deepEqual(new Set(running.access.grants(session)), new Set(['T0', 'N1']));
  assert.equal(queuedMessages[0].sessionId, session);
  assert.match(queuedMessages[0].message, /处理状态测试/);
  assert.match(queuedMessages[0].message, /N1/);
  releaseBugQueue();
  await page.waitForFunction(() => document.querySelector('#bug-panel-list li')?.textContent?.includes('处理中 · codex-basic-browser'));
  await until(async () => (await read()).root.children[0].bugs.find(bug => bug.title === '处理状态测试').sessions.includes(session));
  await synchronized();
  const resolvedBug = await read();
  resolvedBug.root.children[0].bugs.find(bug => bug.title === '处理状态测试').status = 'resolved';
  await fs.writeFile(mapPath, encode(resolvedBug));
  await page.waitForFunction(() => document.querySelector('#bug-panel-list li')?.textContent?.includes('已解决'));
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
  assert.equal((await read()).root.title, '浏览器验收'); recordCheck('legacy-cache-not-written');
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
  await page.route('**/api/commit', route => route.abort('connectionfailed'));
  await title.fill('断线期间的草稿'); await title.press('Tab'); await page.waitForSelector('#cg-sync[data-status="offline"]', { state: 'attached' });
  assert.notEqual((await read()).root.children[0].title, '断线期间的草稿');
  await page.unroute('**/api/commit'); await openSyncSettings(); await page.locator('#cg-sync-retry').click(); await synchronized();
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
  // An existing page reconnects after server restart without losing its local draft.
  const port = new URL(running.state.url).port; await running.close();
  await page.waitForSelector('#cg-sync[data-status="offline"]', { state: 'attached' });
  running = await startServer({ root, port: Number(port), messageQueue });
  await synchronized();
  assert.ok(running.access.grants(session).includes('N1'), 'session grants must survive workbench restart');
  await title.fill('服务重启后保存'); await title.press('Tab'); await synchronized();
  assert.equal((await read()).root.children[0].title, '服务重启后保存'); recordCheck('server-reconnect-and-grant-recovery');
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
  stage = 'session-map-isolation';
  await page.locator('#session-chip').click();
  await page.locator('#session-menu [data-session="__all__"]').click();
  await page.waitForFunction(() => document.querySelector('#cg-sync-session')?.value === '__all__');
  const mainBeforeIsolation = await read();
  const isolated = await fetch(new URL('/api/isolation', running.state.url), { method: 'POST', headers: { Authorization: `Bearer ${running.state.adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ baseVersion: hash(await fs.readFile(mapPath)) }) });
  assert.equal(isolated.status, 200);
  const sessionBefore = await cli('read');
  await cli('apply', { operationId: 'browser-session-isolation', baseVersion: sessionBefore.version, operations: [{ type: 'update', id: 'N1', fields: { title: 'Session 私有标题' } }] });
  assert.equal((await read()).root.children[0].title, mainBeforeIsolation.root.children[0].title);
  await page.locator('#session-chip').click();
  await page.locator(`#session-menu [data-session="${session}"]`).click();
  await page.waitForFunction(() => document.querySelector('.node[data-id="N1"]')?.textContent?.includes('Session 私有标题'));
  await page.locator('#session-chip').click();
  await page.locator('#session-menu [data-session="__all__"]').click();
  await page.waitForFunction(title => document.querySelector('.node[data-id="N1"]')?.textContent?.includes(title), mainBeforeIsolation.root.children[0].title);
  recordCheck('session-map-switch-isolation');
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
