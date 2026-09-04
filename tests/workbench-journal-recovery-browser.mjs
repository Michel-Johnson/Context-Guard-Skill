import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { MapStore } from '../scripts/workbench/store.mjs';
import { startServer } from '../scripts/workbench/server.mjs';
import { encode, hash } from '../scripts/workbench/io.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-journal-browser-'));
const context = path.join(root, '.codex/context');
await fs.mkdir(context, { recursive: true });
await fs.writeFile(path.join(context, 'map.json'), encode({ v: 1, project: 'journal-browser', root: { id: 'T0', title: 'Recovery UI', children: [{ id: 'N1', title: 'Preserved map', children: [] }] } }));

const seed = await new MapStore(root).init();
await seed.commit({ operationId: randomUUID(), baseVersion: seed.version, operations: [{ type: 'update', id: 'N1', fields: { purpose: 'must survive repair' } }] }, { kind: 'human', sessionId: 'workbench' });
await seed.close();
const valid = await fs.readFile(seed.eventsFile, 'utf8');
const corrupted = `${valid}{broken}\n`;
await fs.writeFile(seed.eventsFile, corrupted);
const mapDigest = hash(await fs.readFile(seed.file));

const running = await startServer({ root, port: 0 });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(running.state.url);
  await page.waitForFunction(() => document.querySelector('#cg-sync-repair')?.hidden === false);
  assert.equal(await page.locator('#cg-sync').getAttribute('data-status'), 'error');
  await page.locator('#btn-settings').click();
  await page.locator('#cg-sync > summary').click();
  await page.locator('#cg-sync-repair').click();
  await page.waitForSelector('#cg-sync[data-status="synced"]');
  assert.equal(running.store.blocked, null);
  assert.equal(hash(await fs.readFile(running.store.file)), mapDigest);
  assert.equal(running.store.doc.root.children[0].purpose, 'must survive repair');
  assert.equal(running.store.journal.pending, false);
  assert.equal(await fs.readFile(running.store.journal.backup, 'utf8'), corrupted);
  console.log('Journal recovery browser check passed');
} finally {
  await browser.close();
  await running.close();
  await fs.rm(root, { recursive: true, force: true });
}
