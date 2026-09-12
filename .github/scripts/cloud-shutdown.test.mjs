import './test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startCloudServer } from '../../scripts/cloud/server.mjs';

test('Cloud close waits for in-flight automatic publication before releasing its data directory', { timeout: 10_000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-shutdown-'));
  const memory = path.join(root, 'memory');
  let entered, release, armed = false, stopped = false;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const stat = fs.stat;
  const interception = t.mock.method(fs, 'stat', async (file, ...args) => {
    if (armed && String(file).startsWith(memory + path.sep)) {
      armed = false; entered(); await blocked;
    }
    return stat(file, ...args);
  });
  let service;
  try {
    service = await startCloudServer({ host: '127.0.0.1', port: 0, dataDir: root, adminToken: 'fixture-admin',
      memoryConfig: { dataDir: memory, adminToken: 'fixture-memory', projects: { 'context-guard': { token: 'fixture-project' } } } });
    armed = true;
    let deadline;
    try { await Promise.race([started, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Automatic publication did not start')), 3000); })]); }
    finally { clearTimeout(deadline); }
    const closed = service.close().then(() => { stopped = true; });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(stopped, false, 'close must not release files while publication still uses them');
    release(); await closed;
    await service.close();
    assert.equal(stopped, true);
  } finally {
    release(); interception.mock.restore();
    await service?.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('Cloud close drains an interrupted HTTP write before restart and preserves its committed result', { timeout: 10_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-request-drain-'));
  let entered, release, service, stopped = false;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const options = { host: '127.0.0.1', port: 0, dataDir: root, adminToken: 'fixture-admin' };
  try {
    service = await startCloudServer({ ...options, async faultInjector(stage) {
      if (stage === 'transaction-prepared') { entered(); await blocked; }
    } });
    const headers = { Authorization: 'Bearer fixture-admin', 'Content-Type': 'application/json' };
    const request = fetch(`${service.url}/api/projects/context-guard/commits`, {
      method: 'POST', headers, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ baseVersion: null, operationId: 'shutdown-write', operations: [{ type: 'initialize', project: 'Fixture', node: { id: 'T0', title: 'Drained write', kind: 'module', state: 'dirty', children: [] } }] }),
    }).then(response => response.text(), () => null);
    let timer;
    try { await Promise.race([started, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Write did not start')), 3000); })]); }
    finally { clearTimeout(timer); }
    const closing = service.close().then(() => { stopped = true; });
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(stopped, false, 'socket closure is not completion of the write');
    release(); await closing; await request;
    service = await startCloudServer(options);
    const response = await fetch(`${service.url}/api/projects/context-guard/map`, { headers, signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).document.root.title, 'Drained write');
  } finally {
    release(); await service?.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
