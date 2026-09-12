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

test('test isolation preserves installed browser cache and explicit Playwright locations', async () => {
  const moduleUrl = new URL('./test-environment.mjs', import.meta.url).href;
  for (const mode of ['default', 'explicit', 'npm', 'hermetic']) {
    const program = `
      import os from 'node:os';
      import path from 'node:path';
      import assert from 'node:assert/strict';
      for (const key of ['PLAYWRIGHT_BROWSERS_PATH', 'npm_config_playwright_browsers_path', 'npm_package_config_playwright_browsers_path']) delete process.env[key];
      const home = os.homedir();
      const cache = process.platform === 'win32' ? process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
        : process.platform === 'darwin' ? path.join(home, 'Library', 'Caches') : process.env.XDG_CACHE_HOME || path.join(home, '.cache');
      let expected = path.join(cache, 'ms-playwright');
      if (${JSON.stringify(mode)} === 'explicit') process.env.PLAYWRIGHT_BROWSERS_PATH = expected = path.join(os.tmpdir(), 'fixture-browser-tools');
      if (${JSON.stringify(mode)} === 'npm') process.env.npm_config_playwright_browsers_path = expected = path.join(os.tmpdir(), 'fixture-npm-browser-tools');
      if (${JSON.stringify(mode)} === 'hermetic') process.env.PLAYWRIGHT_BROWSERS_PATH = expected = '0';
      await import(${JSON.stringify(moduleUrl)});
      assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, expected);
      assert.notEqual(os.homedir(), home);
      console.log('browser cache preserved; personal home isolated');
    `;
    const result = await run(process.execPath, ['--input-type=module', '-e', program], { timeout: 10_000 });
    assert.match(result.stdout, /browser cache preserved/);
  }
});
