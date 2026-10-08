import '../.github/scripts/test-environment.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { pause } from '../scripts/shared/io.mjs';

// Real Chromium and the shipped UI module. Only the native provider boundary
// is a controlled HTTP fixture; this suite cannot prove vendor compatibility.
const workspace = fileURLToPath(new URL('../', import.meta.url));
const evidence = await fs.mkdtemp(path.join(workspace, 'temp/cursor-chat-browser-'));
const checks = [], errors = [], posts = [], held = [];
let holdFirst = false, browser, page;
const views = {
  one: { status: 'stopped', messages: [{ role: 'assistant', text: '汉'.repeat(125) + '<script>window.injected=true</script>' }] },
  two: { status: 'stopped', messages: [{ role: 'assistant', text: 'Second Session only' }] },
};
const respond = (res, value) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html lang="zh"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/prototype/workbench.css"><button id="btn-cursor" hidden>打开 Cursor</button><script type="module">import {installCursorChat} from "/prototype/cursor-chat.mjs"; window.chat=installCursorChat({config:{},call:async(route,input)=>{const response=await fetch(route,{method:input?"POST":"GET",headers:{"Content-Type":"application/json"},body:input?JSON.stringify(input):undefined});if(!response.ok)throw new Error("fixture HTTP failed");return response.json();}});</script></html>');
      return;
    }
    if (['/prototype/cursor-chat.mjs', '/prototype/workbench.css'].includes(url.pathname)) {
      res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.mjs') ? 'text/javascript' : 'text/css' });
      res.end(await fs.readFile(path.join(workspace, url.pathname.slice(1)))); return;
    }
    if (url.pathname === '/api/cursor-chat') {
      if (req.method === 'POST') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const input = JSON.parse(Buffer.concat(chunks)); posts.push(input);
        views[input.sessionId] = { status: 'stopped', messages: [{ id: input.id + ':user', role: 'user', text: input.text }, { id: input.id + ':assistant', role: 'assistant', text: 'Native fixture follow-up' }] };
        respond(res, { state: 'received' }); return;
      }
      const session = url.searchParams.get('session');
      if (!session) { respond(res, { sessions: [{ id: 'one', name: 'First Session' }, { id: 'two', name: 'Second Session' }] }); return; }
      if (session === 'one' && holdFirst) { held.push(res); return; }
      respond(res, views[session]); return;
    }
    res.writeHead(404); res.end();
  } catch { res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const until = async fn => { const deadline = Date.now() + 5000; while (!await fn()) { if (Date.now() >= deadline) throw new Error('fixture condition timed out'); await pause(20); } };
const record = name => { checks.push(name); console.log('Cursor browser passed: ' + name); };
let passed = false;
try {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', cause => errors.push(cause.message));
  await page.goto(origin);
  const trigger = page.getByRole('button', { name: '打开 Cursor' });
  await trigger.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Cursor 对话' });
  const input = page.getByRole('textbox', { name: '任务或追问' });
  await input.waitFor(); assert.equal(await input.evaluate(element => document.activeElement === element), true);
  await page.waitForFunction(() => document.querySelectorAll('.cursor-chat-message p').length >= 3);
  assert.equal(await page.locator('.cursor-chat-message p').evaluateAll(elements => elements.every(element => Array.from(element.textContent).length <= 60)), true);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await page.locator('.cursor-chat-message').textContent(), views.one.messages[0].text);
  record('native dialog, initial focus, <=60-character paragraphs and plain-text provider output');

  holdFirst = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await until(() => held.length > 0);
  await page.getByRole('combobox', { name: 'Cursor 会话' }).selectOption('two');
  await page.getByText('Second Session only', { exact: true }).waitFor();
  const oldResponse = page.waitForResponse(response => response.url().endsWith('session=one'));
  holdFirst = false; for (const response of held.splice(0)) respond(response, { status: 'stopped', messages: [{ role: 'assistant', text: 'STALE first Session' }] });
  await oldResponse; await page.evaluate(() => window.chat.refresh());
  assert.equal(await page.locator('.cursor-chat-messages').textContent(), 'Second Session only');
  record('late response cannot replace the currently selected Session');

  await page.getByRole('button', { name: '暂停更新' }).click();
  const send = page.getByRole('button', { name: '发送', exact: true });
  await send.click();
  assert.equal(await input.getAttribute('aria-invalid'), 'true');
  assert.equal(await input.getAttribute('aria-describedby'), 'cursor-chat-status');
  await input.fill('Explain this Session'); await input.press('Control+Enter');
  await page.getByText('Native fixture follow-up', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled);
  assert.equal(await input.inputValue(), ''); assert.equal(posts.length, 1); assert.equal(posts[0].sessionId, 'two');
  assert.equal(await page.getByRole('button', { name: '继续更新' }).isVisible(), true);
  record('keyboard submission works with updates paused and restores send availability');

  await page.setViewportSize({ width: 320, height: 640 });
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
  await page.screenshot({ path: path.join(evidence, 'narrow.png') });
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog').open);
  assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
  assert.deepEqual(errors, []); record('320px reflow, Escape and focus restoration');
  passed = true;
} catch (cause) {
  if (page) { await fs.writeFile(path.join(evidence, 'failed-page.html'), await page.content()); await page.screenshot({ path: path.join(evidence, 'failed.png') }); }
  throw cause;
} finally {
  for (const response of held.splice(0)) response.destroy();
  await browser?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed, checks, errors }, null, 2));
  console.log('Cursor browser evidence: ' + evidence);
}
