import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const runtime = JSON.parse(await fs.readFile(new URL('./calibration-runtime.json', import.meta.url)));
const credentials = JSON.parse(await fs.readFile(new URL('../local-coordinator-data/local-config.json', import.meta.url)));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([{ name: 'cg_workbench', value: credentials.browserToken, url: runtime.baseUrl }]);
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(runtime.url);
  await page.locator('#learning-input').waitFor({ state: 'visible' });
  await page.locator('#learning-new').click();
  await page.waitForFunction(() => document.querySelector('.learning-fork-status')?.textContent === '分身：待分配');
  await page.locator('#learning-input').fill('打开配置与权限部分');
  await page.locator('#learning-send').click();
  await page.waitForFunction(() => document.querySelector('.coordinator-typing-phase')?.hidden === false);
  await page.screenshot({ path: fileURLToPath(new URL('./map-controls-working.png', import.meta.url)) });
  const task = await page.evaluate(() => sessionStorage.getItem('codex-learning-task'));
  let state;
  for (let n = 0; n < 160; n++) {
    state = await page.evaluate(async id => (await fetch('/experiment/tasks/' + id)).json(), task);
    if (state.requests.length && !state.processing) break;
    await page.waitForTimeout(1000);
  }
  assert.equal(state.processing, false, 'model completed');
  assert.ok(state.actions.some(action => action.kind === 'node-navigation' && action.node.id === 'policy'), JSON.stringify(state.messages));
  await page.getByText('沙箱与执行策略', { exact: true }).first().waitFor({ state: 'visible' });
  await page.screenshot({ path: fileURLToPath(new URL('./map-controls-desktop.png', import.meta.url)) });
  console.log(JSON.stringify({ task, fork: state.fork, actions: state.actions.map(a => ({ kind: a.kind, node: a.node })), errors }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: fileURLToPath(new URL('./map-controls-mobile.png', import.meta.url)) });
  const layout = await page.locator('.learning-fork-status').evaluate(el => {
    const r = el.getBoundingClientRect(); return { text: el.textContent, x: r.x, right: r.right, viewport: innerWidth };
  });
  assert.ok(layout.x >= 0 && layout.right <= layout.viewport, JSON.stringify(layout));
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL('./map-controls-error.png', import.meta.url)) });
  console.log(JSON.stringify({ errors, body: (await page.locator('body').innerText()).slice(-2500) }));
  throw error;
} finally { await browser.close(); }
