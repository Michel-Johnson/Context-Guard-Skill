import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { browserLogin } from '../scripts/workbench/browser-login.mjs';
import { connectCloudProject } from '../scripts/workbench/cli.mjs';
import { resolveProject } from '../scripts/workbench/project.mjs';
import { memoryConfigPath } from '../scripts/workbench/memory.mjs';

const repository = 'https://github.com/example/browser-login';
const repositoryId = '123';
async function fixture(t, { expiresIn = 600, startDelay = 0 } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-browser-login-deadline-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let elapsed = 0, approved = false, code = 0;
  const calls = [], prompts = [], sleeps = [];
  const file = path.join(directory, 'browser-login.json');
  const reply = (data, credential) => new Response(JSON.stringify({ ok: true, data }), {
    headers: { 'Content-Type': 'application/json', ...(credential ? { 'x-context-guard-credential': credential } : {}) },
  });
  const device = { directory, origin: 'https://cloud.example.invalid', file: path.join(directory, 'device-connection.json'),
    identity: async () => ({ clientId: 'fixture-client' }),
    transmit: async () => { calls.push({ route: 'heartbeat' }); return {}; },
    saveConnection: async (data, credential, identity) => fs.writeFile(device.file, JSON.stringify({ ...data, ...identity, origin: device.origin, credential })),
  };
  const options = { repository, repositoryId, wait: true, clock: () => elapsed,
    sleep: async ms => { sleeps.push(ms); elapsed += ms; },
    onPending: async safe => { prompts.push(safe); },
    fetcher: async (url, options) => {
      const route = new URL(url).pathname;
      calls.push({ route, body: JSON.parse(options.body), signal: options.signal });
      if (route === '/api/auth/device/start') {
        assert.equal(code, 0, 'a single wait invocation must never start a replacement grant');
        elapsed += startDelay;
        const userCode = `ABCD-${(++code).toString(16).toUpperCase().padStart(4, '0')}`;
        return reply({ verificationPath: `/connect?code=${userCode}`, userCode, expiresIn,
          expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() });
      }
      assert.equal(route, '/api/auth/device/poll');
      return approved ? reply({ projectId: 'fixture-project', repositoryId, capabilities: ['device-memory'] }, randomBytes(32).toString('base64url')) : reply({ status: 'pending' });
    },
  };
  return { device, options, file, calls, prompts, sleeps, reply,
    now: () => elapsed, advance: ms => { elapsed += ms; }, approve: () => { approved = true; },
    readPending: async () => JSON.parse(await fs.readFile(file, 'utf8')),
  };
}

test('waiting past the displayed grant TTL fails without silently starting or displaying a replacement', async t => {
  const f = await fixture(t, { expiresIn: 1 });
  let rejected;
  try { await browserLogin(f.device, { ...f.options, sleep: async ms => { f.sleeps.push(ms); f.advance(5000); } }); }
  catch (error) { rejected = error; }
  assert.equal(f.prompts.length, 1);
  assert.equal(f.calls.filter(call => call.route.endsWith('/start')).length, 1, 'an expired waiter must not issue a second device/start');
  assert.equal(rejected?.code, 'UNAUTHORIZED');
  assert.equal(f.calls.filter(call => call.route.endsWith('/poll')).length, 1);
  assert.ok(f.sleeps[0] > 0 && f.sleeps[0] <= 1000, 'sleep is capped at the displayed grant deadline');
  const pending = await f.readPending();
  assert.equal(pending.userCode, f.prompts[0].userCode);
  assert.equal(pending.expiresAt, f.prompts[0].expiresAt);
  assert.equal(await fs.access(f.device.file).then(() => true, () => false), false);
});

test('start latency and repeated pending polls do not renew the ten-minute invocation budget', async t => {
  const f = await fixture(t, { startDelay: 120000 });
  await assert.rejects(browserLogin(f.device, f.options), { code: 'UNAUTHORIZED' });
  assert.equal(f.now(), 600000);
  assert.equal(f.prompts.length, 1);
  assert.equal(f.calls.filter(call => call.route.endsWith('/start')).length, 1);
  assert.ok(f.calls.filter(call => call.route.endsWith('/poll')).length > 1);
  const pending = await f.readPending();
  assert.equal(pending.userCode, f.prompts[0].userCode);
  assert.equal(pending.expiresAt, f.prompts[0].expiresAt);
});

test('moving the local wall clock backwards does not extend a monotonic waiting deadline', async t => {
  const f = await fixture(t);
  let wallTime = Date.now();
  t.mock.method(Date, 'now', () => wallTime);
  await assert.rejects(browserLogin(f.device, { ...f.options, sleep: async ms => { wallTime -= 60000; f.advance(ms); } }), { code: 'UNAUTHORIZED' });
  assert.ok(f.now() <= 600000);
  assert.equal(f.calls.filter(call => call.route.endsWith('/start')).length, 1);
  assert.equal(f.prompts.length, 1);
});

test('a competing invocation changing the pending grant makes a waiter fail rather than follow an unseen code', async t => {
  const f = await fixture(t);
  const changedCode = randomBytes(32).toString('base64url');
  await assert.rejects(browserLogin(f.device, { ...f.options, sleep: async ms => {
    f.advance(ms);
    const pending = await f.readPending();
    await fs.writeFile(f.file, JSON.stringify({ ...pending, deviceCode: changedCode, userCode: 'FFFF-0000' }));
  } }), { code: 'CONFLICT' });
  assert.equal(f.calls.filter(call => call.route.endsWith('/start')).length, 1);
  assert.equal(f.calls.filter(call => call.route.endsWith('/poll')).length, 1);
  assert.equal(f.prompts.length, 1);
  assert.equal((await f.readPending()).deviceCode, changedCode, 'a waiter must not overwrite another invocation');
});

test('an explicitly retried command can replace an expired cached grant and displays its new code', async t => {
  const f = await fixture(t), oldCode = randomBytes(32).toString('base64url');
  await fs.writeFile(f.file, JSON.stringify({ origin: f.device.origin, repository, repositoryId, deviceCode: oldCode,
    verificationUrl: `${f.device.origin}/connect?code=FFFF-0000`, userCode: 'FFFF-0000', expiresAt: new Date(0).toISOString() }));
  const pending = await browserLogin(f.device, { ...f.options, wait: false });
  assert.equal(pending.connected, false);
  assert.notEqual(pending.userCode, 'FFFF-0000');
  assert.notEqual((await f.readPending()).deviceCode, oldCode);
  assert.equal(f.prompts.length, 1);
  assert.equal(f.calls.filter(call => call.route.endsWith('/start')).length, 1);
});

test('approval after one pending poll persists the connection and healthy reuse starts no new grant', async t => {
  const f = await fixture(t);
  const connected = await browserLogin(f.device, { ...f.options, sleep: async ms => { f.advance(ms); f.approve(); } });
  assert.equal(connected.connected, true);
  assert.equal(f.prompts.length, 1);
  assert.equal(Object.hasOwn(connected, 'credential'), false);
  assert.deepEqual(await f.readPending(), { status: 'connected' });
  const stored = JSON.parse(await fs.readFile(f.device.file, 'utf8'));
  assert.equal(JSON.stringify(f.prompts).includes(stored.credential), false);
  assert.equal((await browserLogin(f.device, { ...f.options, fetcher: () => assert.fail('healthy reuse must not reauthorize') })).connected, true);
  assert.equal(f.calls.filter(call => call.route.endsWith('/start')).length, 1);
  assert.equal(f.calls.filter(call => call.route === 'heartbeat').length, 1);
});

test('temporary authorization start errors retry at most three times with the same device code', async t => {
  for (const recover of [true, false]) {
    const f = await fixture(t), fetcher = f.options.fetcher, codes = [];
    let starts = 0;
    const operation = browserLogin(f.device, { ...f.options, wait: false, fetcher: async (url, options) => {
      if (new URL(url).pathname.endsWith('/start')) {
        codes.push(JSON.parse(options.body).deviceCode);
        if (++starts < 3 || !recover) throw new Error('synthetic start connection failure');
      }
      return fetcher(url, options);
    } });
    if (recover) assert.equal((await operation).authorizationRequired, true);
    else await assert.rejects(operation, { code: 'UNAVAILABLE' });
    assert.equal(starts, 3);
    assert.equal(new Set(codes).size, 1);
    assert.equal((await f.readPending()).deviceCode, codes[0]);
    assert.deepEqual(f.sleeps, [250, 500]);
    assert.equal(f.prompts.length, recover ? 1 : 0);
  }
});

test('a poll connection-establishment error and trusted retryable failure reuse the same grant within its deadline', async t => {
  const f = await fixture(t), fetcher = f.options.fetcher, codes = [];
  let polls = 0;
  const result = await browserLogin(f.device, { ...f.options, fetcher: async (url, options) => {
    if (new URL(url).pathname.endsWith('/poll')) {
      codes.push(JSON.parse(options.body).deviceCode);
      if (++polls === 1) throw Object.assign(new Error('synthetic DNS failure'), { cause: { code: 'ENOTFOUND' } });
      if (polls === 2) return new Response(JSON.stringify({ ok: false, error: { code: 'UNAVAILABLE', message: 'Synthetic temporary rejection', retryable: true } }),
        { status: 503, headers: { 'Content-Type': 'application/json' } });
      f.approve();
    }
    return fetcher(url, options);
  } });
  assert.equal(result.connected, true);
  assert.equal(f.calls.filter(call => call.route.endsWith('/start')).length, 1);
  assert.equal(f.prompts.length, 1);
  assert.equal(polls, 3);
  assert.equal(new Set(codes).size, 1);
  assert.deepEqual(f.sleeps, [250, 500]);
});

test('authorization retry backoff cannot extend the original displayed grant expiry', async t => {
  const f = await fixture(t, { expiresIn: 1 }), fetcher = f.options.fetcher;
  let polls = 0;
  await assert.rejects(browserLogin(f.device, { ...f.options, sleep: async ms => { f.sleeps.push(ms); f.advance(1000); },
    fetcher: async (url, options) => {
      if (new URL(url).pathname.endsWith('/poll')) {
        polls++;
        throw Object.assign(new Error('synthetic refused connection'), { cause: { code: 'ECONNREFUSED' } });
      }
      return fetcher(url, options);
    } }), { code: 'UNAUTHORIZED' });
  assert.equal(polls, 1);
  assert.deepEqual(f.sleeps, [250]);
  assert.equal(f.calls.filter(call => call.route.endsWith('/start')).length, 1);
  assert.equal((await f.readPending()).userCode, f.prompts[0].userCode);
});

test('repeated poll connection-establishment failures stop after three attempts and preserve the grant', async t => {
  for (const code of ['ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT']) {
    const f = await fixture(t), fetcher = f.options.fetcher;
    let polls = 0;
    await assert.rejects(browserLogin(f.device, { ...f.options, fetcher: async (url, options) => {
      if (new URL(url).pathname.endsWith('/poll')) {
        polls++;
        throw Object.assign(new Error('synthetic pre-connection error'), { cause: { code } });
      }
      return fetcher(url, options);
    } }), { code: 'UNAVAILABLE' });
    assert.equal(polls, 3);
    assert.deepEqual(f.sleeps, [250, 500]);
    assert.equal(f.calls.filter(call => call.route.endsWith('/start')).length, 1);
    assert.equal(f.prompts.length, 1);
    assert.equal((await f.readPending()).userCode, f.prompts[0].userCode);
  }
});

test('unknown poll claims, malformed receipts and authentication rejection stop without changing codes or retrying', async t => {
  for (const failure of ['reset', 'timeout', 'truncated', 'missing-credential', 'claimed', 'forbidden', 'untrusted-503']) {
    const f = await fixture(t), fetcher = f.options.fetcher;
    let polls = 0;
    await assert.rejects(browserLogin(f.device, { ...f.options, fetcher: async (url, options) => {
      if (!new URL(url).pathname.endsWith('/poll')) return fetcher(url, options);
      polls++;
      if (failure === 'reset') throw Object.assign(new Error('synthetic reset'), { cause: { code: 'ECONNRESET' } });
      if (failure === 'timeout') throw Object.assign(new Error('synthetic timeout'), { name: 'TimeoutError' });
      if (failure === 'truncated') return new Response('{', { headers: { 'Content-Type': 'application/json' } });
      if (failure === 'missing-credential') return f.reply({ projectId: 'fixture-project', repositoryId, capabilities: ['device-memory'] });
      if (failure === 'untrusted-503') return new Response('<html>unavailable</html>', { status: 503 });
      return new Response(JSON.stringify({ ok: false, error: { code: failure === 'claimed' ? 'UNAUTHORIZED' : 'FORBIDDEN', message: 'Synthetic authorization rejection' } }),
        { status: failure === 'claimed' ? 401 : 403, headers: { 'Content-Type': 'application/json' } });
    } }));
    assert.equal(polls, 1, failure);
    assert.equal(f.calls.filter(call => call.route.endsWith('/start')).length, 1);
    assert.equal(f.prompts.length, 1);
    assert.deepEqual(f.sleeps, []);
    assert.equal(await fs.access(f.device.file).then(() => true, () => false), false);
    if (!['claimed', 'forbidden'].includes(failure)) assert.equal((await f.readPending()).userCode, f.prompts[0].userCode);
  }
});

test('denial still disconnects explicitly and never silently renews in the same wait invocation', async t => {
  const f = await fixture(t), fetcher = f.options.fetcher;
  await assert.rejects(browserLogin(f.device, { ...f.options, fetcher: async (url, options) => {
    if (new URL(url).pathname.endsWith('/poll')) return new Response(JSON.stringify({ ok: false, error: { code: 'FORBIDDEN', message: 'Synthetic denial' } }),
      { status: 403, headers: { 'Content-Type': 'application/json' } });
    return fetcher(url, options);
  } }), { code: 'FORBIDDEN' });
  assert.deepEqual(await f.readPending(), { status: 'FORBIDDEN' });
  assert.equal(f.calls.filter(call => call.route.endsWith('/start')).length, 1);
  assert.equal(await fs.access(f.device.file).then(() => true, () => false), false);
});

test('a deadline reached while acquiring the local lock prevents any authorization request', async t => {
  const f = await fixture(t);
  let reads = 0;
  await assert.rejects(browserLogin(f.device, { ...f.options, clock: () => ++reads < 3 ? 0 : 600000 }), { code: 'UNAUTHORIZED' });
  assert.equal(f.calls.length, 0);
  assert.equal(f.prompts.length, 0);
  assert.equal(await fs.access(f.file + '.lock').then(() => true, () => false), false);
});

test('a poll started near the total deadline uses only its remaining network budget', { timeout: 2000 }, async t => {
  const f = await fixture(t, { startDelay: 599990 }), fetcher = f.options.fetcher;
  await assert.rejects(browserLogin(f.device, { ...f.options, fetcher: async (url, options) => {
    if (!new URL(url).pathname.endsWith('/poll')) return fetcher(url, options);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Poll used the full request timeout instead of remaining ten milliseconds')), 200);
      options.signal.addEventListener('abort', () => { clearTimeout(timer); f.advance(10); reject(options.signal.reason); }, { once: true });
    });
  } }), { code: 'UNAUTHORIZED' });
  assert.equal(f.now(), 600000);
  assert.equal(f.calls.filter(call => call.route.endsWith('/start')).length, 1);
  assert.equal(await fs.access(f.device.file).then(() => true, () => false), false);
});

test('the public project connection entry expires without renewing or saving a device connection', { timeout: 15000 }, async t => {
  const f = await fixture(t), root = path.join(f.device.directory, 'repository');
  await fs.mkdir(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe', encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  git('remote', 'add', 'origin', repository);
  git('update-ref', 'refs/remotes/origin/main', sha);
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  let starts = 0, polls = 0;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {} // Consume only synthetic requests; no credentials are issued.
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/auth/device/start') {
      starts += 1;
      res.end(JSON.stringify({ ok: true, data: { userCode: 'ABCD-1234', verificationPath: '/connect?code=ABCD-1234',
        expiresIn: 1, expiresAt: new Date(Date.now() + 1000).toISOString() } }));
    } else {
      assert.equal(req.url, '/api/auth/device/poll');
      polls += 1;
      res.end(JSON.stringify({ ok: true, data: { status: 'pending' } }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); });
  const prompts = [];
  let promptedAt;
  await assert.rejects(connectCloudProject(root, { url: `http://127.0.0.1:${server.address().port}`, browser: true, wait: true,
    repositoryLookup: async slug => { assert.equal(slug, 'example/browser-login'); return { repositoryId }; },
    onPending: prompt => { promptedAt = performance.now(); prompts.push(prompt); },
  }), { code: 'UNAUTHORIZED' });
  assert.ok(performance.now() - promptedAt < 4000, 'an expired one-second grant must not become an unseen ten-minute wait');
  assert.equal(starts, 1);
  assert.equal(polls, 1);
  assert.equal(prompts.length, 1);
  const project = await resolveProject(root), directory = path.join(project.sharedDir, 'interface-v2');
  const pending = JSON.parse(await fs.readFile(path.join(directory, 'browser-login.json'), 'utf8'));
  assert.equal(pending.userCode, prompts[0].userCode);
  assert.equal(await fs.access(path.join(directory, 'device-connection.json')).then(() => true, () => false), false);
  assert.equal(await fs.access(memoryConfigPath(project)).then(() => true, () => false), false);
});
