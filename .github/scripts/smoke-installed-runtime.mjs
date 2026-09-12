import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The parent installer harness supplies an isolated home and kills this process
// on timeout. Import only the installed Skill, never the source checkout.
const [skill, project] = process.argv.slice(2).map(value => path.resolve(value));
assert.ok(skill && project, 'Usage: smoke-installed-runtime.mjs <installed-skill> <isolated-project>');
const { startServer } = await import(pathToFileURL(path.join(skill, 'scripts/workbench/server.mjs')));
const running = await startServer({ root: project, port: 0 });
try {
  const base = new URL(running.state.url).origin;
  const get = route => fetch(base + route, { signal: AbortSignal.timeout(10_000) });
  const health = await get('/__context_guard/health');
  assert.equal(health.status, 200);
  const identity = await health.json();
  assert.equal(identity.ok, true);
  assert.equal(await fs.realpath(identity.root), await fs.realpath(project));
  assert.equal(identity.pid, process.pid);
  for (const file of ['workbench.html', 'workbench-app.js', 'workbench.css', 'workbench-sync.mjs', 'vendor/marked.mjs']) {
    const response = await get(`/prototype/${file}`);
    assert.equal(response.status, 200, `Installed asset unavailable: ${file}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (file === 'workbench.html') {
      // HTML receives runtime bootstrap data and CSP nonces; static bytes do not.
      assert.ok(bytes.includes(Buffer.from('workbench-app.js')), 'Workbench entry script missing');
      assert.match(response.headers.get('content-type') || '', /text\/html/);
    } else {
      assert.ok(bytes.equals(await fs.readFile(path.join(skill, 'prototype', file))), `Installed asset differs: ${file}`);
    }
  }
  const denied = await get('/api/state');
  assert.ok([401, 403].includes(denied.status), 'Private state must require authorization');
  const response = await fetch(base + '/api/state', {
    headers: { Authorization: `Bearer ${running.humanToken}` }, signal: AbortSignal.timeout(10_000)
  });
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.ok(state.doc?.root && state.version, 'Installed state API must return a versioned map');
  console.log('Installed Workbench passed: startup, health, packaged assets, authorized state and access denial.');
} finally {
  await running.close();
}
