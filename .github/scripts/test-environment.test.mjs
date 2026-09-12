import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from './client-protocol.mjs';

test('test isolation replaces personal homes without adding depth to temporary fixture paths', async () => {
  const moduleUrl = new URL('./test-environment.mjs', import.meta.url).href;
  const program = `
    import os from 'node:os';
    import path from 'node:path';
    const before = os.tmpdir();
    await import(${JSON.stringify(moduleUrl)});
    console.log(JSON.stringify({ sameTemp: os.tmpdir() === before,
      isolatedHome: os.homedir().includes('context-guard-test-home-'),
      codexHome: process.env.CODEX_HOME === path.join(os.homedir(), '.codex'),
      claudeNativeOverride: process.env.CLAUDE_CONFIG_DIR || '',
      session: process.env.CODEX_THREAD_ID,
      gitConfig: process.env.GIT_CONFIG_GLOBAL.endsWith('empty-gitconfig') }));
  `;
  const result = await run(process.execPath, ['--input-type=module', '-e', program], { timeout: 10_000 });
  assert.deepEqual(JSON.parse(result.stdout), { sameTemp: true, isolatedHome: true, codexHome: true, claudeNativeOverride: '', session: '', gitConfig: true });
});
