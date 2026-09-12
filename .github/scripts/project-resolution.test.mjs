import './test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from './client-protocol.mjs';

test('a non-Git folder needs one Git probe and retains empty repository metadata', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-probe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const moduleUrl = new URL('../../scripts/workbench/project.mjs', import.meta.url).href;
  const program = `
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    let calls = 0;
    cp.execFile = (command, args, options, callback) => {
      if (command !== 'git') throw new Error('Unexpected command');
      calls++;
      queueMicrotask(() => callback(Object.assign(new Error('Not a Git repository'), { code: 128 }), '', ''));
    };
    syncBuiltinESMExports();
    const { resolveProject } = await import(${JSON.stringify(moduleUrl)});
    const project = await resolveProject(process.argv[1]);
    console.log(JSON.stringify({ calls, kind: project.kind, fields: ['branch','head','gitDir','mainBranch','mainRef','mainSha'].map(key => project[key]) }));
  `;
  const result = await run(process.execPath, ['--input-type=module', '-e', program, root], { timeout: 10_000 });
  assert.deepEqual(JSON.parse(result.stdout), { calls: 1, kind: 'folder', fields: ['', '', '', '', '', ''] });
});
