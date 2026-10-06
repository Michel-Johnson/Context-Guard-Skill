import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, isolatedEnvironment } from './client-protocol.mjs';
import { discoverNodeTests } from './run-node-tests.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const runner = fileURLToPath(new URL('./run-node-tests.mjs', import.meta.url));

test('Node runner import is inert and discovery preserves every automatic file exactly once', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repository, 'tests/test-manifest.json'), 'utf8')).automaticNodeTests;
  const expected = manifest.roots.flatMap(root => fs.readdirSync(path.join(repository, root), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(manifest.suffix))
    .map(entry => path.posix.join(root, entry.name)))
    .filter(file => !manifest.excluded.includes(file)).sort();
  const actual = discoverNodeTests(repository);
  assert.equal(actual.length, expected.length); assert.equal(new Set(actual).size, expected.length);
  assert.deepEqual([...actual].sort(), expected);
  const hooks = ['tests/hook-lifecycle.test.mjs', 'tests/hook-records.test.mjs'];
  assert.deepEqual(actual.slice(0, 5), [...hooks, 'tests/named-workbench.test.mjs',
    '.github/scripts/multiworktree.test.mjs', '.github/scripts/workbench-project.test.mjs']);
  const helper = fs.readFileSync(path.join(repository, 'tests/hook-test-helpers.mjs'), 'utf8');
  assert.doesNotMatch(helper, /^test\(|from ['"]node:test['"]/m, 'the shared helper must not register tests');
  const names = hooks.flatMap(file => {
    const source = fs.readFileSync(path.join(repository, file), 'utf8');
    assert.match(source, /from ['"]\.\/hook-test-helpers\.mjs['"]/, 'both independent suites use the formal helper');
    return [...source.matchAll(/^test\('([^']+)'/gm)].map(match => match[1]);
  });
  assert.equal(new Set(names).size, names.length, 'Hook case names must remain unique across the two suites');
});

test('Node runner public parent executes all files once, starts both Hook suites early and bounds concurrency', async () => {
  const temporary = path.join(repository, 'temp'); fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, 'node-runner-'));
  const files = ['.github/scripts/a.test.mjs', '.github/scripts/b.test.mjs', 'tests/hook-lifecycle.test.mjs', 'tests/hook-records.test.mjs', 'tests/z.test.mjs'];
  let passed = false;
  try {
    const env = isolatedEnvironment(root);
    const imported = await run(process.execPath, ['--input-type=module', '-e',
      `await import(${JSON.stringify(new URL('./run-node-tests.mjs', import.meta.url).href)}); console.log('runner import has no execution');`],
    { cwd: root, env, timeout: 10_000 });
    assert.equal(imported.stdout.trim(), 'runner import has no execution');
    const filtered = await run(process.execPath, [runner, '--test-name-pattern=absent'], { cwd: root, env, allowFailure: true, timeout: 10_000 });
    assert.equal(filtered.code, 1); assert.match(filtered.stderr, /Unsupported Node test runner arguments/);
    for (const mode of ['pass', 'fail', 'exception']) {
      const cwd = path.join(root, mode);
      for (const directory of ['.github/scripts', 'tests']) fs.mkdirSync(path.join(cwd, directory), { recursive: true });
      fs.writeFileSync(path.join(cwd, 'tests/test-manifest.json'), JSON.stringify({ separatePackages: [] }));
      for (const file of files) {
        const source = `
          import test from 'node:test';
          import assert from 'node:assert/strict';
          import fs from 'node:fs';
          const file = ${JSON.stringify(file)};
          const record = kind => fs.appendFileSync('events.jsonl', JSON.stringify({ file, kind, at: String(process.hrtime.bigint()) }) + '\\n');
          record('start');
          ${mode === 'exception' && file.endsWith('/b.test.mjs') ? "throw new Error('synthetic module exception');" : ''}
          test(file + ' PRIVATE_TIMING_NAME_MARKER', async () => {
            try {
              if (file === 'tests/hook-lifecycle.test.mjs') {
                // Only one first-wave suite waits; the other must release its slot.
                const deadline = Date.now() + 5000;
                while (fs.readFileSync('events.jsonl', 'utf8').trim().split('\\n').map(JSON.parse).filter(event => event.kind === 'start').length < ${files.length}) {
                  assert.ok(Date.now() < deadline, 'remaining files must start');
                  await new Promise(resolve => setTimeout(resolve, 10));
                }
              } else await new Promise(resolve => setTimeout(resolve, 100));
              ${mode === 'fail' && file.endsWith('/b.test.mjs') ? "assert.fail('synthetic assertion failure');" : ''}
            } finally { record('finish'); }
          });
        `;
        fs.writeFileSync(path.join(cwd, file), source);
      }
      fs.writeFileSync(path.join(cwd, '.github/scripts/security-checks.test.mjs'), "throw new Error('standalone must not run twice');");
      const result = await run(process.execPath, [runner], { cwd, env, allowFailure: true, timeout: 20_000 });
      assert.equal(result.code, mode === 'pass' ? 0 : 1, result.stdout + result.stderr);
      assert.match(result.stdout, /TAP version 13/); assert.match(result.stdout, /# tests 5/);
      assert.match(result.stdout, mode === 'pass' ? /# fail 0/ : /# fail 1/);
      if (mode !== 'pass') assert.match(result.stdout, mode === 'fail' ? /synthetic assertion failure/ : /synthetic module exception/);
      const timing = result.stderr.split('\n').filter(line => line.startsWith('[node-test-timing] '))
        .map(line => JSON.parse(line.slice('[node-test-timing] '.length)));
      assert.ok(timing.length > 0);
      assert.ok(!JSON.stringify(timing).includes('PRIVATE_TIMING_NAME_MARKER'), 'raw test names never enter timing output');
      const allowed = new Set(['scope', 'phase', 'utc', 'elapsedMs', 'files', 'concurrency', 'file', 'event', 'order',
        'line', 'nesting', 'durationMs', 'passed', 'firstObservedTestMs', 'lastObservedResultMs', 'observedResults', 'processBoundaries', 'formats', 'outcome']);
      const lastElapsed = new Map();
      for (const row of timing) {
        assert.ok(Object.keys(row).every(key => allowed.has(key)));
        assert.ok(Number.isFinite(Date.parse(row.utc)));
        assert.ok(Number.isInteger(row.elapsedMs) && row.elapsedMs >= (lastElapsed.get(row.scope) || 0));
        lastElapsed.set(row.scope, row.elapsedMs);
        if (row.file) assert.ok(files.includes(row.file), 'only discovered relative paths are logged');
      }
      assert.equal(timing[0].phase, 'launch-request');
      assert.equal(timing.at(-1).phase, 'owned-child-close-observed');
      assert.equal(timing.at(-1).outcome, mode === 'pass' ? 'success' : 'failure');
      assert.ok(timing.some(row => row.phase === 'execute-start' && row.concurrency === 2 && row.files === files.length));
      assert.ok(timing.some(row => row.phase === 'stream-ended'));
      const formatRows = timing.filter(row => row.phase === 'file-field-formats');
      assert.equal(formatRows.length, 1);
      assert.deepEqual(Object.keys(formatRows[0].formats).sort(), ['absent', 'absolute', 'fileURI', 'relative']);
      assert.ok(Object.values(formatRows[0].formats).every(value => Number.isInteger(value) && value >= 0));
      assert.ok(Object.values(formatRows[0].formats).reduce((total, value) => total + value, 0) > 0);
      // Counts only: no raw event path is exposed, even for unmatched formats.
      console.error(`[runner-test-format] ${JSON.stringify({ mode, formats: formatRows[0].formats })}`);
      const observed = timing.filter(row => row.phase === 'observed-result');
      assert.ok(observed.length > 0);
      const expectedOrder = Number(process.versions.node.split('.')[0]) >= 22 ? 'execution' : 'declaration-report';
      assert.ok(observed.every(row => row.order === expectedOrder));
      assert.ok(observed.every(row => expectedOrder === 'execution' ? row.event === 'test:complete' : ['test:pass', 'test:fail'].includes(row.event)));
      const summaries = timing.filter(row => row.phase === 'file-observations');
      assert.equal(summaries.length, files.length);
      assert.deepEqual(summaries.map(row => row.file).sort(), [...files].sort());
      assert.ok(summaries.every(row => row.processBoundaries === 'unavailable'));
      for (const summary of summaries) {
        const results = observed.filter(row => row.file === summary.file);
        assert.ok(results.length > 0, 'each actual file result has an observation');
        assert.equal(summary.observedResults, results.length);
        assert.equal(summary.lastObservedResultMs, results.at(-1).elapsedMs);
        if (summary.firstObservedTestMs !== null) assert.ok(summary.firstObservedTestMs <= summary.lastObservedResultMs);
      }
      const events = fs.readFileSync(path.join(cwd, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
        .sort((left, right) => BigInt(left.at) < BigInt(right.at) ? -1 : 1);
      const started = events.filter(event => event.kind === 'start').map(event => event.file);
      assert.deepEqual([...started].sort(), [...files].sort());
      assert.deepEqual(started.slice(0, 2).sort(), ['tests/hook-lifecycle.test.mjs', 'tests/hook-records.test.mjs'], 'both Hook suites must start in the first concurrent wave');
      if (mode === 'pass') {
        let active = 0, peak = 0;
        for (const event of events) { active += event.kind === 'start' ? 1 : -1; peak = Math.max(peak, active); assert.ok(active >= 0 && active <= 2); }
        assert.equal(active, 0); assert.equal(peak, 2);
        assert.equal(events.filter(event => event.kind === 'finish').length, files.length);
      }
    }
    passed = true;
  } finally {
    if (passed) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('Hook helper import is inert and its one port candidate preserves the bounded range', async () => {
  const temporary = path.join(repository, 'temp'); fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, 'hook-helper-'));
  let passed = false;
  try {
    const helper = new URL('../../tests/hook-test-helpers.mjs', import.meta.url).href;
    const result = await run(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      const { freePort } = await import(${JSON.stringify(helper)});
      const port = await freePort();
      assert.ok(Number.isInteger(port));
      assert.ok(port >= 49152 && port <= 65514);
      assert.ok(port + 20 <= 65535);
      console.log('helper import inert; single bounded candidate');
    `], { cwd: root, env: isolatedEnvironment(root), timeout: 10_000 });
    assert.equal(result.stdout.trim(), 'helper import inert; single bounded candidate', 'no test registration or server startup output');
    passed = true;
  } finally {
    if (passed) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

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
