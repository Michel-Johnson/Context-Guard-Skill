import '../.github/scripts/test-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startCloudServer, createWorkbenchPasswordHash } from '../scripts/cloud/server.mjs';
import { DeviceAuthorization } from '../scripts/cloud/device-authorization.mjs';
import { legacyProjectMemoryFile } from '../scripts/cloud/memory-filesystem.mjs';
import { DeviceConnection } from '../scripts/workbench/protocol-device.mjs';
import { browserLogin } from '../scripts/workbench/browser-login.mjs';
import { connectCloudProject } from '../scripts/workbench/cli.mjs';
import { resolveProject } from '../scripts/workbench/project.mjs';
import { memoryConfigPath } from '../scripts/workbench/memory.mjs';
import { hash } from '../scripts/shared/io.mjs';

const password = 'test-browser-pairing-only';
const repository = 'https://github.com/example/repo';
const repositoryId = '123';
const execFileAsync = promisify(execFile);

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-browser-auth-'));
  const memory = { dataDir: path.join(directory, 'memory'), adminToken: 'fixture-memory-admin',
    projects: { 'context-guard': { token: 'fixture-project-memory' } } };
  const map = { v: 1, project: 'Pairing fixture', root: { id: 'R', title: 'Authoritative Main', children: [] } };
  const file = legacyProjectMemoryFile(memory.dataDir, 'context-guard');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ revision: 1,
    main: { version: 'fixture-main-v1', memory: { map, records: {} } },
    sessions: { owned: { version: 'fixture-session-v1', memory: { map, records: {} } },
      foreign: { version: 'fixture-foreign-v1', memory: { map, records: {} } } },
    receipts: {}, history: [], events: [], eventCursors: {} }));
  const options = { dataDir: path.join(directory, 'cloud'), port: 0, memoryConfig: memory,
    browserToken: 'fixture-browser-cookie', browserPasswordHash: await createWorkbenchPasswordHash(password),
    protocolConfig: { repositories: [{ slug: 'example/repo', repositoryId, projectId: 'context-guard',
      clients: { coordinator: { deviceId: 'privileged-device', agentId: 'coordinator', role: 'coordinator' } } }] } };
  let cloud = await startCloudServer(options);
  const state = { directory, options, get cloud() { return cloud; },
    restart: async () => { const port = new URL(cloud.url).port; await cloud.close(); cloud = await startCloudServer({ ...options, port: Number(port) }); } };
  t.after(async () => { await cloud.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return state;
}

const deviceFor = (f, name = 'local') => new DeviceConnection({ directory: path.join(f.directory, name), origin: f.cloud.url, allowLoopback: true });
const post = (f, route, body, headers = {}) => fetch(new URL(route, f.cloud.url), { method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const grantInput = (extra = {}) => ({ repository, clientId: 'unprivileged-client', label: 'Synthetic device', deviceCode: randomBytes(32).toString('base64url'), ...extra });

async function begin(f, input = grantInput()) {
  const response = await post(f, '/api/auth/device/start', input);
  assert.equal(response.status, 200);
  assert.equal(response.headers.has('x-context-guard-credential'), false);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(JSON.stringify(body).includes(input.deviceCode), false);
  return { input, ...body.data };
}

async function login(f, next) {
  const response = await fetch(new URL('/auth/login', f.cloud.url), { method: 'POST', redirect: 'manual',
    body: new URLSearchParams({ password, next }) });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), next);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  return cookie.split(';')[0];
}

async function formFor(f, grant, cookie) {
  const response = await fetch(new URL(grant.verificationPath || grant.verificationUrl, f.cloud.url), { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(response.status, 200);
  const html = await response.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(csrf);
  return { html, csrf };
}

const decide = (f, grant, csrf, cookie, decision = 'approve', origin = f.cloud.url) => fetch(new URL('/auth/device/decision', f.cloud.url), {
  method: 'POST', redirect: 'manual', headers: { Cookie: cookie, ...(origin ? { Origin: origin } : {}) },
  body: new URLSearchParams({ userCode: grant.userCode, csrf, decision }),
});

async function approve(f, grant) {
  const next = grant.verificationPath || new URL(grant.verificationUrl).pathname + new URL(grant.verificationUrl).search;
  const cookie = await login(f, next);
  const { html, csrf } = await formFor(f, grant, cookie);
  assert.match(html, /example\/repo/);
  assert.match(html, /不授予管理或 Main 发布权限/);
  assert.equal((await decide(f, grant, csrf, cookie)).status, 302);
  return cookie;
}

async function assertReadAndIsolation(f, device) {
  const { session } = await device.send({ v: 2, id: 'bind-owned', type: 'session.bind',
    payload: { sessionId: 'owned', worktreeId: 'fixture-worktree', agentId: 'fixture-agent', expectedBindingVersion: '' } });
  assert.deepEqual(session, { id: 'owned', generation: 1 });
  const saved = JSON.parse(await fs.readFile(device.file, 'utf8'));
  const headers = { Authorization: `Bearer ${saved.credential}` };
  const main = await fetch(new URL('/v1/projects/context-guard/main', f.cloud.url), { headers });
  assert.equal(main.status, 200);
  const body = await main.json();
  assert.equal(body.snapshot.version, 'fixture-main-v1');
  assert.equal(body.snapshot.memory.map.root.title, 'Authoritative Main');
  const own = await fetch(new URL('/v1/projects/context-guard/sessions/owned', f.cloud.url), { headers });
  assert.equal(own.status, 200);
  assert.equal((await own.json()).snapshot.version, 'fixture-session-v1');
  const foreign = await fetch(new URL('/v1/projects/context-guard/sessions/foreign', f.cloud.url), { headers });
  assert.equal(foreign.status, 401);
  assert.equal((await foreign.json()).error.code, 'UNAUTHORIZED');
  const writeMain = await post(f, '/v1/projects/context-guard/main', { operationId: 'forged-write' }, headers);
  assert.equal(writeMain.status, 401);
  return saved;
}

test('BDA-001: browser approval connects the backend, reads Main and keeps foreign Sessions and Main writes isolated', async t => {
  const f = await fixture(t), device = deviceFor(f), pending = await browserLogin(device, { repository, repositoryId, label: '<synthetic device>' });
  assert.equal(pending.connected, false);
  assert.equal(await device.connected(), false);
  const pendingState = JSON.parse(await fs.readFile(path.join(device.directory, 'browser-login.json'), 'utf8'));
  assert.equal(JSON.stringify(pending).includes(pendingState.deviceCode), false);
  assert.deepEqual(await browserLogin(device, { repository, repositoryId }), pending, 'non-waiting invocation reuses the same pending grant');
  const cookie = await approve(f, pending);
  const connected = await browserLogin(deviceFor(f), { repository, repositoryId });
  assert.equal(connected.connected, true);
  assert.equal(connected.repositoryId, repositoryId);
  assert.equal(connected.projectId, 'context-guard');
  const saved = await assertReadAndIsolation(f, device);
  assert.equal(JSON.stringify(connected).includes(saved.credential), false);
  assert.equal(JSON.stringify(connected).includes(pendingState.deviceCode), false);
  const ledger = await fs.readFile(path.join(f.options.dataDir, 'interface-v2', 'device-authorizations.json'), 'utf8');
  assert.equal(ledger.includes(saved.credential), false);
  assert.equal(ledger.includes(pendingState.deviceCode), false);
  assert.equal(ledger.includes(password), false);
  const page = await fetch(pending.verificationUrl, { headers: { Cookie: cookie } });
  const html = await page.text();
  assert.equal(html.includes(saved.credential), false);
  assert.equal(html.includes('<synthetic device>'), false, 'device labels must be HTML escaped');
  assert.equal(html.includes('<form'), false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(device.directory, 'browser-login.json'), 'utf8')), { status: 'connected' });
});

test('BDA-002: waiting login publishes only a safe approval prompt and finishes after a human decision', async t => {
  const f = await fixture(t), device = deviceFor(f), prompts = [];
  const connected = await browserLogin(device, { repository, repositoryId, wait: true,
    onPending: async pending => { prompts.push(pending); await approve(f, pending); } });
  assert.equal(connected.connected, true);
  assert.equal(prompts.length, 1);
  const saved = JSON.parse(await fs.readFile(device.file, 'utf8'));
  assert.equal(JSON.stringify(prompts).includes(saved.credential), false);
  assert.deepEqual(Object.keys(prompts[0]).sort(), ['authorizationRequired', 'connected', 'expiresAt', 'userCode', 'verificationUrl']);
  const reused = await browserLogin(deviceFor(f), { repository, repositoryId,
    fetcher: () => assert.fail('a connected backend should not start another browser grant') });
  assert.equal(reused.connected, true);
  assert.equal(Object.hasOwn(reused, 'credential'), false);
});

test('BDA-003: unauthenticated, cross-site, missing-origin and forged-CSRF decisions cannot approve a grant', async t => {
  const f = await fixture(t), grant = await begin(f);
  const unsigned = await fetch(new URL(grant.verificationPath, f.cloud.url), { redirect: 'manual' });
  assert.equal(unsigned.status, 302);
  assert.equal(new URL(unsigned.headers.get('location'), f.cloud.url).pathname, '/login');
  const unsignedDecision = await decide(f, grant, 'invalid', '', 'approve');
  assert.equal(unsignedDecision.status, 401);
  const cookie = await login(f, grant.verificationPath), { csrf } = await formFor(f, grant, cookie);
  for (const [token, origin] of [['invalid', f.cloud.url], [csrf, 'https://attacker.invalid'], [csrf, ''], [csrf, 'null']]) {
    assert.equal((await decide(f, grant, token, cookie, 'approve', origin)).status, 403);
  }
  assert.equal((await post(f, '/api/auth/device/start', grantInput(), { Origin: f.cloud.url })).status, 403);
  assert.equal((await post(f, '/api/auth/device/poll', { deviceCode: grant.input.deviceCode }, { Origin: f.cloud.url })).status, 403);
  assert.equal((await post(f, '/api/auth/device/start', grantInput({ role: 'coordinator' }))).status, 400);
  assert.equal((await post(f, '/api/auth/device/start', grantInput({ repository: 'https://github.com/example/unknown' }))).status, 403);
  assert.equal((await post(f, '/api/auth/device/poll', { deviceCode: grant.input.deviceCode }).then(r => r.json())).data.status, 'pending');
  assert.equal((await decide(f, grant, csrf, cookie)).status, 302);
  assert.equal((await decide(f, grant, csrf, cookie)).status, 409, 'a decided grant is immutable');
});

test('BDA-004: a human denial leaves the backend disconnected and the next attempt gets a fresh approval code', async t => {
  const f = await fixture(t), device = deviceFor(f), grant = await browserLogin(device, { repository, repositoryId });
  const cookie = await login(f, new URL(grant.verificationUrl).pathname + new URL(grant.verificationUrl).search);
  const { csrf } = await formFor(f, grant, cookie);
  assert.equal((await decide(f, grant, csrf, cookie, 'deny')).status, 302);
  await assert.rejects(browserLogin(device, { repository, repositoryId }), { code: 'FORBIDDEN' });
  assert.equal(await device.connected(), false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(device.directory, 'browser-login.json'), 'utf8')), { status: 'FORBIDDEN' });
  const retry = await browserLogin(device, { repository, repositoryId });
  assert.notEqual(retry.userCode, grant.userCode);
});

test('BDA-005: a pending approval survives Cloud and CLI restarts without creating a new grant', async t => {
  const f = await fixture(t), device = deviceFor(f), pending = await browserLogin(device, { repository, repositoryId });
  await f.restart();
  assert.deepEqual(await browserLogin(deviceFor(f), { repository, repositoryId }), pending);
  await approve(f, pending);
  assert.equal((await browserLogin(deviceFor(f), { repository, repositoryId })).connected, true);
  await f.restart();
  await assertReadAndIsolation(f, deviceFor(f));
});

test('BDA-006: concurrent HTTP claims consume one authorization exactly once, including after restart', async t => {
  const f = await fixture(t), grant = await begin(f);
  await approve(f, grant);
  const claims = await Promise.all([post(f, '/api/auth/device/poll', { deviceCode: grant.input.deviceCode }),
    post(f, '/api/auth/device/poll', { deviceCode: grant.input.deviceCode })]);
  assert.deepEqual(claims.map(r => r.status).sort(), [200, 401]);
  const success = claims.find(r => r.status === 200), credential = success.headers.get('x-context-guard-credential');
  assert.ok(credential);
  assert.equal(JSON.stringify(await success.json()).includes(credential), false);
  const failed = claims.find(r => r.status === 401);
  assert.equal(failed.headers.has('x-context-guard-credential'), false);
  await f.restart();
  assert.equal((await post(f, '/api/auth/device/poll', { deviceCode: grant.input.deviceCode })).status, 401);
  const stored = JSON.parse(await fs.readFile(path.join(f.options.dataDir, 'interface-v2', 'connections.json'), 'utf8'));
  assert.equal(Object.keys(stored.connections).length, 1);
  assert.equal(stored.connections[hash(credential)].principal.role, 'device');
});

test('BDA-007: choosing a registered Coordinator client ID through browser pairing still grants only device privileges', async t => {
  const f = await fixture(t), grant = await begin(f, grantInput({ clientId: 'coordinator' }));
  await approve(f, grant);
  const result = await post(f, '/api/auth/device/poll', { deviceCode: grant.input.deviceCode });
  const credential = result.headers.get('x-context-guard-credential');
  assert.equal(result.status, 200);
  const disk = JSON.parse(await fs.readFile(path.join(f.options.dataDir, 'interface-v2', 'connections.json'), 'utf8'));
  const principal = disk.connections[hash(credential)].principal;
  assert.equal(principal.role, 'device');
  assert.notEqual(principal.deviceId, 'privileged-device');
  const publish = await post(f, '/v1/projects/context-guard/publish', { operationId: 'forged-publication' }, { Authorization: `Bearer ${credential}` });
  assert.equal(publish.status, 401);
});

test('BDA-008: expired, revoked and interrupted issuance never produce a replayable credential', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-browser-expiry-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let now = 1000, authorized = true, issued = 0;
  const options = { directory, now: () => now, lifetimeMs: 1000, authorizeRepository: async () => authorized ? repositoryId : null,
    issueDevice: async () => { issued++; throw new Error('Simulated interruption after consumption'); } };
  const grants = new DeviceAuthorization(options), expired = grantInput(), expiration = await grants.start(expired, 'fixture');
  const csrf = (await grants.view(expiration.userCode, 'fixture')).csrf;
  now = 2000;
  await assert.rejects(grants.decide({ userCode: expiration.userCode, csrf, decision: 'approve' }, 'fixture'), { code: 'FORBIDDEN' });
  await assert.rejects(grants.poll({ deviceCode: expired.deviceCode }), { code: 'UNAUTHORIZED' });
  const revoked = grantInput(), pending = await grants.start(revoked, 'fixture'), page = await grants.view(pending.userCode, 'fixture');
  authorized = false;
  await assert.rejects(grants.decide({ userCode: pending.userCode, csrf: page.csrf, decision: 'approve' }, 'fixture'), { code: 'FORBIDDEN' });
  authorized = true;
  await grants.decide({ userCode: pending.userCode, csrf: page.csrf, decision: 'approve' }, 'fixture');
  authorized = false;
  await assert.rejects(grants.poll({ deviceCode: revoked.deviceCode }), { code: 'FORBIDDEN' });
  authorized = true;
  await assert.rejects(grants.poll({ deviceCode: revoked.deviceCode }), /Simulated interruption/);
  await assert.rejects(new DeviceAuthorization(options).poll({ deviceCode: revoked.deviceCode }), { code: 'UNAUTHORIZED' });
  assert.equal(issued, 1);
});

test('BDA-009: repository identity mismatch rejects and revokes the issued connection instead of saving it', async t => {
  const f = await fixture(t), device = deviceFor(f);
  const grant = await browserLogin(device, { repository, repositoryId: '999' });
  await approve(f, grant);
  await assert.rejects(browserLogin(device, { repository, repositoryId: '999' }), { code: 'FORBIDDEN' });
  assert.equal(await device.connected(), false);
  const connections = JSON.parse(await fs.readFile(path.join(f.options.dataDir, 'interface-v2', 'connections.json'), 'utf8'));
  assert.equal(Object.keys(connections.connections).length, 0);
});

test('BDA-010: the project connection entry reuses browser approval and stores no password or credential in project configuration', async t => {
  const f = await fixture(t), root = path.join(f.directory, 'repository');
  await fs.mkdir(root);
  const git = async (...args) => (await execFileAsync('git', args, { cwd: root, windowsHide: true })).stdout.trim();
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.invalid');
  await fs.writeFile(path.join(root, 'README.md'), 'Synthetic authorization repository');
  await git('add', 'README.md'); await git('commit', '-m', 'fixture');
  const sha = await git('rev-parse', 'HEAD');
  await git('remote', 'add', 'origin', repository);
  await git('update-ref', 'refs/remotes/origin/main', sha);
  await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  const options = { url: f.cloud.url, browser: true, repositoryLookup: async slug => { assert.equal(slug, 'example/repo'); return { repositoryId }; } };
  const pending = await connectCloudProject(root, options);
  assert.equal(pending.connected, false);
  await approve(f, pending);
  assert.deepEqual(await connectCloudProject(root, options), { connected: true, projectId: 'context-guard', url: f.cloud.url });
  const project = await resolveProject(root), config = JSON.parse(await fs.readFile(memoryConfigPath(project), 'utf8'));
  assert.deepEqual(config, { projectId: 'context-guard', url: f.cloud.url });
  assert.deepEqual(await connectCloudProject(root, options), { connected: true, projectId: 'context-guard', url: f.cloud.url });
});

test('BDA-011: an older Cloud or an unsafe verification link gives an explicit failure without saving a connection', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-browser-invalid-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const device = new DeviceConnection({ directory, origin: 'https://cloud.example.invalid' });
  await assert.rejects(browserLogin(device, { repository, repositoryId, fetcher: async () => new Response('Not supported', { status: 404 }) }), { code: 'UPGRADE_REQUIRED' });
  await assert.rejects(browserLogin(device, { repository, repositoryId, fetcher: async () => new Response(JSON.stringify({ ok: true,
    data: { verificationPath: 'https://attacker.invalid/connect?code=ABCD-1234', userCode: 'ABCD-1234', expiresAt: new Date(Date.now() + 60000).toISOString(), expiresIn: 60 } }),
    { headers: { 'Content-Type': 'application/json' } }) }), { code: 'UNAVAILABLE' });
  assert.equal(await device.connected(), false);
});

test('BDA-013: a server-revoked cached credential cannot be reported as a connected backend on the next login', async t => {
  const f = await fixture(t), device = deviceFor(f);
  await browserLogin(device, { repository, repositoryId, wait: true, onPending: grant => approve(f, grant) });
  const saved = JSON.parse(await fs.readFile(device.file, 'utf8'));
  const revoked = await post(f, '/api/v2/messages', { v: 2, id: 'revoke', type: 'auth.close', payload: {} }, { Authorization: `Bearer ${saved.credential}` });
  assert.equal(revoked.status, 200);
  try {
    const result = await browserLogin(deviceFor(f), { repository, repositoryId });
    assert.equal(result.connected, false, 'local presence of an old credential is not proof of Cloud authorization');
  } catch (error) {
    if (error.name === 'AssertionError') throw error;
    assert.ok(['UNAUTHORIZED', 'FORBIDDEN'].includes(error.code), `explicit reauthorization error expected, got ${error.code}`);
  }
});

test('BDA-014: losing the one-time claim reply requires fresh approval and never pretends that a connection was saved', async t => {
  const f = await fixture(t), device = deviceFor(f), pending = await browserLogin(device, { repository, repositoryId });
  await approve(f, pending);
  await assert.rejects(browserLogin(device, { repository, repositoryId, fetcher: async (url, options) => {
    const response = await fetch(url, options);
    assert.equal(response.status, 200, 'Cloud issued a credential before the reply was lost');
    await response.body.cancel();
    throw new Error('Simulated lost authorization reply');
  } }), { code: 'UNAVAILABLE' });
  assert.equal(await device.connected(), false);
  await assert.rejects(browserLogin(device, { repository, repositoryId }), { code: 'UNAUTHORIZED' });
  const next = await browserLogin(device, { repository, repositoryId });
  assert.equal(next.connected, false);
  assert.notEqual(next.userCode, pending.userCode);
});

test('BDA-015: simultaneous local invocations share approval and persist only one Cloud device connection', async t => {
  const f = await fixture(t), first = await browserLogin(deviceFor(f), { repository, repositoryId });
  await approve(f, first);
  const outcomes = await Promise.all([browserLogin(deviceFor(f), { repository, repositoryId }),
    browserLogin(deviceFor(f), { repository, repositoryId })]);
  assert.equal(outcomes.every(value => value.connected === true), true);
  const state = JSON.parse(await fs.readFile(path.join(f.options.dataDir, 'interface-v2', 'connections.json'), 'utf8'));
  assert.equal(Object.keys(state.connections).length, 1);
  assert.equal((await deviceFor(f).transmit({ v: 2, id: 'verify-concurrent-login', type: 'sync.heartbeat', payload: { sessions: [] } })).sessions.length, 0);
});

test('BDA-016: server clock skew does not change the local approval window or prevent Main access', async t => {
  for (const offsetMs of [-3600000, 3600000]) {
    await t.test(`server clock offset ${offsetMs / 60000} minutes`, async sub => {
      const f = await fixture(sub), device = deviceFor(f);
      let expiresIn;
      const fetcher = async (url, options) => {
        const response = await fetch(url, options);
        if (new URL(url).pathname !== '/api/auth/device/start') return response;
        const body = await response.json();
        assert.equal(body.ok, true);
        expiresIn = body.data.expiresIn;
        assert.ok(Number.isInteger(expiresIn) && expiresIn >= 1 && expiresIn <= 600);
        body.data.expiresAt = new Date(Date.now() + expiresIn * 1000 + offsetMs).toISOString();
        const headers = new Headers(response.headers); headers.delete('content-length');
        return new Response(JSON.stringify(body), { status: response.status, headers });
      };
      const before = Date.now(), pending = await browserLogin(device, { repository, repositoryId, fetcher }), after = Date.now();
      const deadline = Date.parse(pending.expiresAt);
      assert.ok(deadline >= before + expiresIn * 1000 && deadline <= after + expiresIn * 1000,
        'the local deadline is derived from the relative TTL, not the server wall clock');
      await approve(f, pending);
      assert.equal((await browserLogin(deviceFor(f), { repository, repositoryId })).connected, true);
      await assertReadAndIsolation(f, deviceFor(f));
    });
  }
});

test('BDA-017: oversized or non-integer relative authorization TTLs are rejected without saving credentials', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-browser-invalid-ttl-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const [index, expiresIn] of [601, 0, -1, '600', 1.5, null, undefined].entries()) {
    const device = new DeviceConnection({ directory: path.join(directory, String(index)), origin: 'https://cloud.example.invalid' });
    await assert.rejects(browserLogin(device, { repository, repositoryId, fetcher: async () => new Response(JSON.stringify({ ok: true,
      data: { verificationPath: '/connect?code=ABCD-1234', userCode: 'ABCD-1234', expiresAt: new Date(Date.now() + 60000).toISOString(), expiresIn } }),
      { headers: { 'Content-Type': 'application/json' } }) }), { code: 'UNAVAILABLE' });
    assert.equal(await device.connected(), false);
  }
});

test('BDA-012: real browser password entry and approval buttons complete pairing without exposing backend credentials', {
  skip: process.env.CONTEXT_GUARD_AUTH_BROWSER !== '1' && 'Explicit browser acceptance: set CONTEXT_GUARD_AUTH_BROWSER=1 with Playwright Chromium installed',
}, async t => {
  const f = await fixture(t), device = deviceFor(f), { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext(), page = await context.newPage();
  const connected = await browserLogin(device, { repository, repositoryId, wait: true, onPending: async grant => {
    await page.goto(grant.verificationUrl);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('heading', { name: '连接设备', exact: true }).waitFor();
    await page.getByText(grant.userCode, { exact: true }).waitFor();
    const [decision] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/auth/device/decision'),
      page.getByRole('button', { name: '允许连接', exact: true }).click(),
    ]);
    if (decision.status() !== 302) assert.fail(`browser approval Origin=${decision.request().headers().origin}, response: ${await decision.text()}`);
    await page.getByRole('status').waitFor();
  } });
  assert.equal(connected.connected, true);
  const saved = await assertReadAndIsolation(f, device);
  assert.equal((await page.content()).includes(saved.credential), false);
  assert.equal(page.url().includes(saved.credential), false);
  assert.equal(JSON.stringify(await context.storageState()).includes(saved.credential), false);
  assert.equal(Object.hasOwn(connected, 'credential'), false);
});
