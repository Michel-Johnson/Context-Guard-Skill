import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

let profileModule;
try { profileModule = await import('../scripts/workbench/cursor-ci-profile.mjs'); }
catch (cause) { if (cause.code !== 'ERR_MODULE_NOT_FOUND' || !cause.message.includes('cursor-ci-profile.mjs')) throw cause; }
const required = () => {
  assert.equal(typeof profileModule?.prepareCursorCiProfile, 'function', 'CI needs its own native environment before creating the original native Session');
  return profileModule.prepareCursorCiProfile;
};
const tools = ['context_guard_context', 'context_guard_source', 'context_guard_test', 'context_guard_exchange'];
// Official CLI 2026.10.01 adds these defaults during session/new, not during
// mcp enable. This independent fixture contains no credentials or native ID.
const nativeDefaults = {
  display: { showLineNumbers: false, showThinkingBlocks: false, showStatusIndicators: false,
    showStatusLineRunningTime: false, mode: 'zen' },
  notifications: true, hints: true, modelSlashCommands: true, steering: true, rewind: true,
  model: { modelId: 'default', displayModelId: 'auto', displayName: 'Auto', displayNameShort: 'Auto',
    aliases: ['auto'], maxMode: false },
  hasChangedDefaultModel: false, exploreSubagentModel: 'default',
  network: { useHttp1ForAgent: false }, autoAcceptWebSearch: false,
  selectedModel: { modelId: 'default', parameters: [] }, modelParameters: { default: [] },
  modelSelectionHistory: ['default'],
};
async function fixture() {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cg-cursor-profile-fixture-')));
  const root = path.join(directory, 'source'), owner = path.join(directory, 'owner');
  await fs.mkdir(root, { mode: 0o700 }); await fs.mkdir(owner, { mode: 0o700 });
  await fs.mkdir(path.join(root, '.cursor')); await fs.writeFile(path.join(root, '.cursor', 'mcp.json'), 'project config remains untouched\n');
  const provider = `SYNTHETIC_PROVIDER_${randomUUID()}`, calls = [], sessionId = randomUUID();
  const options = { directory: owner, root, sessionId, command: process.execPath,
    environment: { PATH: process.env.PATH, HOME: directory, USERPROFILE: directory, CURSOR_CONFIG_DIR: root,
      ...(process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
      CURSOR_API_KEY: provider, AGENT_CLI_CREDENTIAL_STORE: 'memory' },
    invoke: async (command, argv, options) => { calls.push({ command, argv, options }); return { stdout: '', stderr: '' }; },
  };
  return { directory, root, owner, provider, calls, options };
}

test('CI profile fixes separate native and source roots and never persists provider credentials', async t => {
  const prepare = required(), f = await fixture(), profile = await prepare(f.options); t.after(() => profile.close());
  const record = await profile.verify();
  assert.equal(record.sessionId, f.options.sessionId); assert.equal(record.worktreeRoot, f.root);
  assert.notEqual(record.nativeCwd, f.root); assert.equal(path.relative(f.root, record.nativeCwd).startsWith('..'), true);
  assert.equal(await fs.realpath(record.nativeCwd), record.nativeCwd);
  assert.deepEqual(await fs.readdir(record.nativeCwd), []);
  assert.equal(profile.environment.HOME, path.join(record.profileRoot, 'home'));
  assert.equal(profile.environment.USERPROFILE, profile.environment.HOME);
  assert.equal(profile.environment.CURSOR_CONFIG_DIR, path.join(profile.environment.HOME, '.cursor'));
  assert.equal(profile.environment.TMPDIR, path.join(record.profileRoot, 'tmp'));
  assert.equal(profile.environment.CURSOR_API_KEY, f.provider); assert.equal(profile.environment.AGENT_CLI_CREDENTIAL_STORE, 'memory');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].command, process.execPath);
  assert.deepEqual(f.calls[0].argv, ['mcp', 'enable', 'context-guard-ci']);
  assert.equal(f.calls[0].options.cwd, record.nativeCwd); assert.equal(f.calls[0].options.windowsHide, true);
  const configuration = JSON.parse(await fs.readFile(path.join(profile.environment.CURSOR_CONFIG_DIR, 'cli-config.json'), 'utf8'));
  assert.equal(configuration.approvalMode, 'allowlist');
  assert.deepEqual(configuration.permissions.allow, tools.map(name => `Mcp(context-guard-ci:${name})`));
  assert.deepEqual(configuration.permissions.deny, ['Shell(*)', 'Read(**)', 'Write(**)', 'WebFetch(*)']);
  for (const file of [path.join(f.owner, 'ci-profile.json'), path.join(profile.environment.CURSOR_CONFIG_DIR, 'cli-config.json'), path.join(profile.environment.CURSOR_CONFIG_DIR, 'mcp.json')]) {
    assert.equal((await fs.readFile(file, 'utf8')).includes(f.provider), false);
    if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o077, 0);
  }
  assert.equal(await fs.readFile(path.join(f.root, '.cursor', 'mcp.json'), 'utf8'), 'project config remains untouched\n');
  await assert.rejects(profile.discovery.call('context_guard_context', {}), { code: 'CI_NOT_ACTIVE' });
});

test('CI native enable atomically rewrites configuration with private permissions from process start',
  { skip: process.platform === 'win32' ? 'POSIX umask is not a Windows ACL guarantee' : false }, async t => {
    const f = await fixture(), parentMask = process.umask(), command = path.join(f.directory, 'synthetic-native');
    assert.equal(/\s/.test(process.execPath), false, 'the synthetic shebang needs an unambiguous Node path');
    await fs.writeFile(command, `#!${process.execPath}\nconst fs = require('node:fs'), path = require('node:path');
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['mcp', 'enable', 'context-guard-ci'])) process.exit(7);
const file = path.join(process.env.CURSOR_CONFIG_DIR, 'cli-config.json');
const bytes = fs.readFileSync(file); fs.writeFileSync(file+'.tmp', bytes); fs.renameSync(file+'.tmp', file);
fs.writeFileSync(path.join(process.env.TMPDIR, 'native-mask.json'), JSON.stringify({ mask: process.umask() }));\n`, { mode: 0o700, flag: 'wx' });
    const { invoke, ...options } = f.options;
    const profile = await required()({ ...options, command }); t.after(() => profile.close());
    await profile.verify();
    assert.equal((await fs.stat(path.join(profile.environment.CURSOR_CONFIG_DIR, 'cli-config.json'))).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await fs.readFile(path.join(profile.environment.TMPDIR, 'native-mask.json'))).mask, 0o077);
    assert.equal(process.umask(), parentMask);
  });

test('CI profile binds one native ID without replacing the original profile or discovery', async t => {
  const prepare = required(), f = await fixture(), profile = await prepare(f.options); t.after(() => profile.close());
  const original = await profile.verify(), nativeSessionId = randomUUID();
  const bound = await profile.bindNative(nativeSessionId);
  assert.equal(bound.nativeSessionId, nativeSessionId); assert.equal(bound.profileRoot, original.profileRoot);
  assert.deepEqual(await profile.bindNative(nativeSessionId), bound);
  await assert.rejects(profile.bindNative(randomUUID()), { code: 'CI_NATIVE_MISMATCH' });
  assert.equal((await profile.verify()).nativeSessionId, nativeSessionId);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.owner, 'ci-profile.json'), 'utf8')).nativeSessionId, nativeSessionId);
  await assert.rejects(prepare(f.options), { code: 'CI_PROFILE_ALREADY_EXISTS' });
  assert.equal(f.calls.length, 1, 'a persisted profile is not permission to start another native environment');
});

test('preparation-only native fixtures cannot gain activation identity from their saved JSON', async t => {
  const f = await fixture(), profile = await required()(f.options); t.after(() => profile.close());
  assert.equal(profile.nativeCommand, process.execPath);
  const record = await profile.verify(); assert.equal(record.nativeIdentity, undefined);
  await assert.rejects(profile.verifyNative(), { code: 'CI_NATIVE_UNSUPPORTED' });
  await assert.rejects(profile.verify(), { code: 'CI_PROFILE_CLOSED' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.owner, 'ci-profile.json'), 'utf8')), record);
  assert.equal(f.calls.length, 1, 'unsupported identity does not run a native version probe or recreate a profile');
});

test('CI profile accepts fixed official default hydration without relearning its authority or extending expiry', async t => {
  const f = await fixture(), clock = 1700000000000;
  let current = clock;
  const profile = await required()({ ...f.options, model: 'auto', now: () => current }); t.after(() => profile.close());
  const original = await profile.verify(), configFile = path.join(profile.environment.CURSOR_CONFIG_DIR, 'cli-config.json');
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  assert.equal(config.privacyCache, undefined, 'the host does not impersonate the provider privacy cache');
  Object.assign(config, structuredClone(nativeDefaults), { privacyCache: { ghostMode: true, privacyMode: 2, updatedAt: clock } });
  await fs.writeFile(configFile, JSON.stringify(config, null, 4));
  const native = randomUUID(), bound = await profile.bindNative(native);
  assert.equal(bound.nativeSessionId, native); assert.equal(bound.configSha256, original.configSha256);
  assert.equal(bound.configPolicySha256, original.configPolicySha256); assert.match(bound.configPolicySha256, /^[a-f0-9]{64}$/);
  assert.equal(bound.profileRoot, original.profileRoot); assert.equal(bound.expiresAt, clock + 1800000);
  current += 1000; config.privacyCache.updatedAt = current;
  await fs.writeFile(configFile, JSON.stringify(config));
  assert.deepEqual(await profile.verify(), bound, 'a native cache refresh does not refreeze or renew the original profile');
  await assert.rejects(profile.discovery.call('context_guard_context', {}), { code: 'CI_NOT_ACTIVE' });
  current = bound.expiresAt;
  await assert.rejects(profile.verify(), { code: 'CI_PROFILE_EXPIRED' });
  assert.deepEqual(JSON.parse(await fs.readFile(configFile, 'utf8')), config, 'expiry preserves the native configuration');
});

test('CI profile rejects native configuration outside fixed defaults and preserves the failed bytes', async t => {
  const changes = {
    'shell permission': c => c.permissions.allow.push('Shell(*)'),
    'permission omission': c => { delete c.permissions; },
    'permission order': c => c.permissions.deny.reverse(),
    'unrestricted approval': c => { c.approvalMode = 'unrestricted'; },
    'automatic search': c => { c.autoAcceptWebSearch = true; },
    'network override': c => { c.network.useHttp1ForAgent = true; },
    'unknown nested field': c => { c.display.command = 'synthetic executable'; },
    'status line command': c => { c.statusLine = { command: 'synthetic executable' }; },
    'sandbox override': c => { c.sandbox = { mode: 'disabled' }; },
    'authentication cache': c => { c.authInfo = { userId: 'synthetic' }; },
    'extra model': c => { c.model.modelId = 'foreign-model'; },
    'max model': c => { c.model.maxMode = true; },
    'selected model': c => { c.selectedModel.modelId = 'foreign-model'; },
    'model parameters': c => { c.modelParameters.default.push({ id: 'max', value: true }); },
    'subagent model': c => { c.exploreSubagentModel = 'inherit'; },
    'extra subagent model': c => { c.subagentModels = { explore: 'foreign-model' }; },
    'privacy disabled': c => { c.privacyCache.ghostMode = false; },
    'foreign privacy policy': c => { c.privacyCache.privacyMode = 3; },
    'invalid privacy timestamp': c => { c.privacyCache.updatedAt = -1; },
    'future privacy timestamp': c => { c.privacyCache.updatedAt = 1700000300001; },
    'privacy nested extra': c => { c.privacyCache.token = 'synthetic-provider'; },
    'unknown root': c => { c.futureToolPolicy = true; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async t => {
    const f = await fixture(), profile = await required()({ ...f.options, now: () => 1700000000000 }); t.after(() => profile.close());
    const configFile = path.join(profile.environment.CURSOR_CONFIG_DIR, 'cli-config.json');
    const config = Object.assign(JSON.parse(await fs.readFile(configFile, 'utf8')), structuredClone(nativeDefaults),
      { privacyCache: { ghostMode: true, privacyMode: 2, updatedAt: 1700000000000 } });
    change(config); const bytes = JSON.stringify(config);
    await fs.writeFile(configFile, bytes);
    await assert.rejects(profile.bindNative(randomUUID()), { code: 'CI_PROFILE_CHANGED' });
    assert.equal(await fs.readFile(configFile, 'utf8'), bytes);
    assert.equal(JSON.parse(await fs.readFile(path.join(f.owner, 'ci-profile.json'), 'utf8')).nativeSessionId, undefined);
    await assert.rejects(profile.discovery.call('context_guard_context', {}), { code: 'CI_CAPABILITY_EXPIRED' });
  });
});

test('CI profile refuses unsupported model routes before creating any native preparation intent', async () => {
  const f = await fixture();
  let unexpected;
  try {
    await assert.rejects(async () => { unexpected = await required()({ ...f.options, model: 'foreign-model' }); },
      { code: 'CI_PROFILE_MODEL_UNSUPPORTED' });
  } finally { await unexpected?.close(); }
  await assert.rejects(fs.stat(path.join(f.owner, 'ci-profile.json')), { code: 'ENOENT' });
  assert.equal(f.calls.length, 0);
});

test('CI profile refuses policy, MCP endpoint and empty native cwd drift without repairing files', async t => {
  const prepare = required();
  for (const kind of ['permissions', 'endpoint', 'cwd']) {
    const f = await fixture(), profile = await prepare(f.options); t.after(() => profile.close());
    const record = await profile.verify(), configurationDirectory = profile.environment.CURSOR_CONFIG_DIR;
    if (kind === 'permissions') {
      const file = path.join(configurationDirectory, 'cli-config.json'), configuration = JSON.parse(await fs.readFile(file, 'utf8'));
      configuration.permissions.allow.push('Shell(*)'); await fs.writeFile(file, JSON.stringify(configuration));
    } else if (kind === 'endpoint') {
      const file = path.join(configurationDirectory, 'mcp.json'), mcp = JSON.parse(await fs.readFile(file, 'utf8'));
      mcp.mcpServers['context-guard-ci'].url = 'https://foreign.invalid/ci'; await fs.writeFile(file, JSON.stringify(mcp));
    } else await fs.writeFile(path.join(record.nativeCwd, 'unexpected.txt'), 'preserved\n');
    await assert.rejects(profile.verify(), { code: 'CI_PROFILE_CHANGED' });
    assert.equal(await fs.readFile(path.join(f.root, '.cursor', 'mcp.json'), 'utf8'), 'project config remains untouched\n');
    if (kind === 'cwd') assert.equal(await fs.readFile(path.join(record.nativeCwd, 'unexpected.txt'), 'utf8'), 'preserved\n');
  }
});

test('CI profile refuses newly introduced executable user configuration without altering it', async t => {
  const prepare = required();
  for (const name of ['.cursor/hooks.json', '.cursor/skills/injected/SKILL.md', '.cursor/commands/injected.md',
    '.cursor/agents/injected.md', '.cursor/plugins/injected.json', '.claude/settings.json', '.claude/agents/injected.md',
    '.agents/skills/injected/SKILL.md', '.codex/skills/injected/SKILL.md', '.grok/skills/injected/SKILL.md', 'AGENTS.md']) await t.test(name, async t => {
    const f = await fixture(), profile = await prepare(f.options); t.after(() => profile.close());
    const file = path.join(profile.environment.HOME, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'synthetic executable configuration stays preserved\n');
    await assert.rejects(profile.verify(), { code: 'CI_PROFILE_CHANGED' });
    assert.equal(await fs.readFile(file, 'utf8'), 'synthetic executable configuration stays preserved\n');
    await assert.rejects(profile.discovery.call('context_guard_context', {}), { code: 'CI_CAPABILITY_EXPIRED' });
  });
});

test('CI profile denies unknown backend credentials and implicit provider login before creating an intent', async () => {
  const prepare = required();
  for (const environment of [{ PATH: process.env.PATH }, { PATH: process.env.PATH, CURSOR_API_KEY: 'synthetic', CONTEXT_GUARD_TOKEN: 'host-only' }]) {
    const f = await fixture();
    await assert.rejects(prepare({ ...f.options, environment }), { code: 'CI_PROFILE_ENVIRONMENT_INVALID' });
    await assert.rejects(fs.stat(path.join(f.owner, 'ci-profile.json')), { code: 'ENOENT' });
    assert.equal(f.calls.length, 0);
  }
});

test('CI profile normalizes Windows environment names without admitting ambiguous credentials', async t => {
  const prepare = required(), f = await fixture();
  const profile = await prepare({ ...f.options, environment: { Path: 'synthetic-path', SystemRoot: 'synthetic-system',
    UserProfile: f.directory, AppData: f.root, CURSOR_API_KEY: f.provider } });
  t.after(() => profile.close());
  assert.equal(profile.environment.PATH, 'synthetic-path'); assert.equal(profile.environment.SYSTEMROOT, 'synthetic-system');
  assert.equal(profile.environment.USERPROFILE, profile.environment.HOME);
  assert.equal(profile.environment.APPDATA, path.join(profile.environment.HOME, 'appdata'));
  const other = await fixture();
  await assert.rejects(prepare({ ...other.options, environment: { Path: 'one', PATH: 'two', CURSOR_API_KEY: other.provider } }), { code: 'CI_PROFILE_ENVIRONMENT_INVALID' });
  await assert.rejects(fs.stat(path.join(other.owner, 'ci-profile.json')), { code: 'ENOENT' });
});

test('CI profile keeps failed native enable intent and redacts vendor diagnostics', async () => {
  const prepare = required(), f = await fixture();
  await assert.rejects(prepare({ ...f.options, invoke: async () => { throw new Error(f.provider); } }), cause => {
    assert.equal(cause.code, 'CI_PROFILE_ENABLE_FAILED'); assert.equal(cause.message.includes(f.provider), false); return true;
  });
  const record = JSON.parse(await fs.readFile(path.join(f.owner, 'ci-profile.json'), 'utf8'));
  assert.equal(record.state, 'failed'); assert.ok(await fs.stat(record.profileRoot));
  assert.equal(JSON.stringify(record).includes(f.provider), false);
  await assert.rejects(prepare(f.options), { code: 'CI_PROFILE_ALREADY_EXISTS' });
  assert.equal(f.calls.length, 0);
});

test('CI profile refuses vendor enable changing its generated MCP identity or adding servers', async t => {
  const prepare = required();
  for (const change of ['endpoint', 'extra-server']) await t.test(change, async t => {
    const f = await fixture();
    await assert.rejects(prepare({ ...f.options, invoke: async (_command, _argv, options) => {
      const file = path.join(options.env.CURSOR_CONFIG_DIR, 'mcp.json'), mcp = JSON.parse(await fs.readFile(file, 'utf8'));
      if (change === 'endpoint') mcp.mcpServers['context-guard-ci'].url = 'https://unapproved.invalid/ci';
      else mcp.mcpServers.unapproved = { command: 'unapproved-command' };
      await fs.writeFile(file, JSON.stringify(mcp));
    } }).then(profile => { t.after(() => profile.close()); return profile; }), { code: 'CI_PROFILE_CHANGED' });
    assert.equal((await fs.readFile(path.join(f.owner, 'ci-profile.json'), 'utf8')).includes(f.provider), false);
    assert.equal((await fs.readFile(path.join(f.root, '.cursor', 'mcp.json'), 'utf8')), 'project config remains untouched\n');
  });
});

test('CI profile close revokes discovery and cannot be revived by existing files', async () => {
  const prepare = required(), f = await fixture(), profile = await prepare(f.options), record = await profile.verify();
  await profile.close(); await profile.close();
  await assert.rejects(profile.verify(), { code: 'CI_PROFILE_CLOSED' });
  await assert.rejects(profile.discovery.call('context_guard_context', {}), { code: 'CI_CAPABILITY_EXPIRED' });
  assert.ok(await fs.stat(record.profileRoot), 'closing preserves the native store and all local evidence');
});

test('CI profile fixes its initial deadline and cannot renew it by rebinding the native ID', async t => {
  const prepare = required(), f = await fixture(); let now = 1000;
  const profile = await prepare({ ...f.options, now: () => now }); t.after(() => profile.close());
  const before = await profile.verify(); assert.equal(before.expiresAt, 1801000);
  now = 1100; const bound = await profile.bindNative(randomUUID()); assert.equal(bound.expiresAt, before.expiresAt);
  now = before.expiresAt;
  await assert.rejects(profile.verify(), { code: 'CI_PROFILE_EXPIRED' });
  now = 1000;
  await assert.rejects(profile.bindNative(bound.nativeSessionId), { code: 'CI_PROFILE_CLOSED' });
  assert.equal(f.calls.length, 1);
});

test('CI profile serializes repeated native binding without replacing the original identity', async t => {
  const prepare = required(), f = await fixture(), profile = await prepare(f.options); t.after(() => profile.close());
  const native = randomUUID(), results = await Promise.all([profile.bindNative(native), profile.bindNative(native)]);
  assert.deepEqual(results[0], results[1]); assert.equal((await profile.verify()).nativeSessionId, native);
  assert.equal(f.calls.length, 1);
});

async function guardCall(record, input, { bytes, manifestSha = record.guardPolicySha256 } = {}) {
  const hooks = JSON.parse(await fs.readFile(path.join(record.profileRoot, 'home', '.cursor', 'hooks.json'), 'utf8'));
  // Execute the actual pinned bootstrap, not the copied module directly.
  const command = hooks.hooks.preToolUse[0].command.replace(record.guardPolicySha256, manifestSha);
  const child = spawn(command, { shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', code => resolve({ code, stdout, stderr }));
  });
  child.stdin.on('error', () => {}); child.stdin.end(bytes ?? JSON.stringify(input));
  const result = await done;
  assert.equal(result.code, 0); assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}
const nativeEvent = (record, extra = {}) => ({ hook_event_name: 'preToolUse',
  conversation_id: record.nativeSessionId, session_id: record.nativeSessionId,
  workspace_roots: [record.hookWorkspaceRoot], cwd: record.nativeCwd,
  tool_name: 'MCP:context_guard_context', tool_input: {}, ...extra });

test('CI guard accepts the exact official ACP storage workspace, not an arbitrary native or private root', async t => {
  const f = await fixture(), profile = await required()(f.options); t.after(() => profile.close());
  const record = await profile.bindNative(randomUUID());
  // Official 2026.10.01 ACP Hook input observed in the isolated native probe:
  // workspace_roots points at private DATA/projects/<normalized cwd>, no cwd.
  // Independent expected path uses path segments, not the production helper.
  const slug = record.nativeCwd.split(/[^A-Za-z0-9]+/).filter(Boolean).join('-');
  const expected = path.join(record.profileRoot, 'home', '.cursor', 'projects', slug);
  const event = { hook_event_name: 'preToolUse', tool_name: 'MCP:context_guard_context', tool_input: {},
    conversation_id: record.nativeSessionId, session_id: record.nativeSessionId, workspace_roots: [expected] };
  assert.equal((await guardCall(record, event)).permission, 'allow');
  assert.equal(record.hookWorkspaceRoot, expected);
  assert.equal(await fs.realpath(record.hookWorkspaceRoot), record.hookWorkspaceRoot);
  if (process.platform !== 'win32') assert.equal((await fs.stat(record.hookWorkspaceRoot)).mode & 0o077, 0);
  for (const roots of [[record.nativeCwd], [f.root], [path.join(expected, 'foreign')], [expected, record.nativeCwd]]) {
    assert.equal((await guardCall(record, { ...event, workspace_roots: roots })).permission, 'deny');
  }
  assert.equal((await guardCall(record, { ...event, cwd: f.root })).permission, 'deny');
});

test('CI Hook metadata storage allows native data but rejects executable roots and private directory drift', async t => {
  const cases = ['.cursor/hooks.json', '.cursor/mcp.json', '.cursor/commands/foreign.md', '.cursor/agents/foreign.md',
    '.cursor/skills/foreign/SKILL.md', '.cursor/rules/foreign.mdc', '.claude/settings.json', '.agents/skills/foreign/SKILL.md',
    'AGENTS.md', 'CLAUDE.md', 'symlink', 'root-mode', 'projects-mode'];
  for (const change of cases) await t.test(change, async t => {
    const f = await fixture(), profile = await required()(f.options); t.after(() => profile.close());
    const record = await profile.bindNative(randomUUID());
    await fs.mkdir(path.join(record.hookWorkspaceRoot, 'agent-transcripts'));
    await fs.writeFile(path.join(record.hookWorkspaceRoot, 'agent-transcripts', 'native-data.json'), '{}\n', { mode: 0o600 });
    assert.equal((await guardCall(record, nativeEvent(record))).permission, 'allow'); await profile.verify();
    let preserved;
    if (change === 'symlink') {
      preserved = record.hookWorkspaceRoot + '.preserved'; await fs.rename(record.hookWorkspaceRoot, preserved);
      try { await fs.symlink(preserved, record.hookWorkspaceRoot, 'dir'); }
      catch (cause) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(cause.code)) { t.skip('Windows symlink permission is unavailable'); return; } throw cause; }
    } else if (change.endsWith('-mode')) {
      if (process.platform === 'win32') { t.skip('POSIX mode is not a Windows ACL guarantee'); return; }
      preserved = change === 'root-mode' ? record.hookWorkspaceRoot : path.dirname(record.hookWorkspaceRoot);
      await fs.chmod(preserved, 0o755);
    } else {
      preserved = path.join(record.hookWorkspaceRoot, change); await fs.mkdir(path.dirname(preserved), { recursive: true });
      await fs.writeFile(preserved, 'synthetic unapproved executable configuration\n', { mode: 0o600 });
    }
    assert.equal((await guardCall(record, nativeEvent(record))).permission, 'deny');
    await assert.rejects(profile.verify(), { code: 'CI_PROFILE_CHANGED' });
    assert.ok(await fs.stat(preserved), 'reject drift without repairing or deleting the observed configuration');
  });
});

test('CI profile creates only its fixed fail-closed native guards before vendor enable', async t => {
  const f = await fixture();
  f.options.invoke = async (_command, _argv, options) => {
    const hooks = JSON.parse(await fs.readFile(path.join(options.env.CURSOR_CONFIG_DIR, 'hooks.json'), 'utf8'));
    assert.equal(hooks.version, 1);
    assert.deepEqual(Object.keys(hooks.hooks), ['preToolUse', 'subagentStart', 'beforeMCPExecution']);
    for (const entries of Object.values(hooks.hooks)) {
      assert.equal(entries.length, 1); assert.equal(entries[0].failClosed, true);
      assert.equal(entries[0].timeout, 5); assert.equal(entries[0].loop_limit, null);
      assert.equal(entries[0].matcher, '.*'); assert.match(entries[0].command, /cursor-ci-guard/);
    }
  };
  const profile = await required()(f.options); t.after(() => profile.close());
  const original = await profile.verify(); assert.equal(original.format, 3);
  assert.equal(original.mode, 'ci-mcp-only-v2');
  const denied = await guardCall(original, nativeEvent(original)); assert.equal(denied.permission, 'deny');
  const bound = await profile.bindNative(randomUUID());
  assert.equal(bound.guardPolicySha256, original.guardPolicySha256);
  assert.equal(bound.hooksSha256, original.hooksSha256);
  assert.equal(bound.expiresAt, original.expiresAt);
  for (const tool of tools) {
    assert.equal((await guardCall(bound, nativeEvent(bound, { tool_name: `MCP:${tool}` }))).permission, 'allow');
    // Official ACP local MCP wrapper 2026.10.01 omits cwd from its base
    // payload; the HookExecutor still supplies the single native workspace.
    const noCwd = nativeEvent(bound, { tool_name: `MCP:${tool}` }); delete noCwd.cwd;
    assert.equal((await guardCall(bound, noCwd)).permission, 'allow');
    assert.equal((await guardCall(bound, nativeEvent(bound, { hook_event_name: 'beforeMCPExecution', tool_name: tool,
      tool_input: '{}', mcp_server_name: 'context-guard-ci', url: profile.discovery.endpoint,
      mcp_server_url: profile.discovery.endpoint }))).permission, 'allow');
  }
});

test('CI native guard denies builtins, Task, foreign providers and identity drift without raw diagnostics', async t => {
  const f = await fixture(), profile = await required()(f.options); t.after(() => profile.close());
  const record = await profile.bindNative(randomUUID());
  const cases = [
    ...['Read', 'Grep', 'List', 'ReadLints', 'Glob', 'Shell', 'Write', 'WebFetch', 'Task', 'Unknown',
      'MCP:context_guard_context_extra', 'MCP:foreign:context_guard_context'].map(tool_name => ({ tool_name })),
    { hook_event_name: 'subagentStart' }, { hook_event_name: 'futureEvent' },
    { conversation_id: randomUUID() }, { session_id: randomUUID() }, { cwd: f.root },
    { workspace_roots: [record.nativeCwd, f.root] }, { workspace_roots: [] },
    { hook_event_name: 'beforeMCPExecution', tool_name: tools[0], tool_input: '{}',
      mcp_server_name: 'foreign', url: profile.discovery.endpoint, mcp_server_url: profile.discovery.endpoint },
    { hook_event_name: 'beforeMCPExecution', tool_name: tools[0], tool_input: '{}',
      mcp_server_name: 'context-guard-ci', url: 'https://foreign.invalid', mcp_server_url: profile.discovery.endpoint },
    { hook_event_name: 'beforeMCPExecution', tool_name: tools[0], tool_input: '{}',
      mcp_server_name: 'context-guard-ci', url: profile.discovery.endpoint },
    { hook_event_name: 'beforeMCPExecution', tool_name: tools[0], tool_input: '{}',
      mcp_server_name: 'context-guard-ci', url: profile.discovery.endpoint, mcp_server_url: profile.discovery.endpoint,
      command: 'unapproved executable' },
  ];
  for (const change of cases) {
    const result = await guardCall(record, nativeEvent(record, change));
    assert.equal(result.permission, 'deny', JSON.stringify(change));
    assert.equal(JSON.stringify(result).includes(f.provider), false);
    assert.equal(JSON.stringify(result).includes(profile.discovery.endpoint), false);
  }
  for (const bytes of ['null', '[]', '{', ' '.repeat(65537), JSON.stringify({ ...nativeEvent(record), tool_input: f.provider })]) {
    assert.equal((await guardCall(record, null, { bytes })).permission, 'deny');
  }
  assert.equal((await guardCall(record, nativeEvent(record), { manifestSha: '0'.repeat(64) })).permission, 'deny');
});

test('CI native guard and profile reject altered owned files without learning or repairing them', async t => {
  for (const relative of ['guard/guard-policy.json', 'guard/cursor-ci-guard.mjs', 'home/.cursor/hooks.json', 'home/.cursor/mcp.json']) {
    const f = await fixture(), profile = await required()(f.options); t.after(() => profile.close());
    const record = await profile.bindNative(randomUUID()), file = path.join(record.profileRoot, relative);
    const original = await fs.readFile(file), changed = Buffer.concat([original, Buffer.from('\n ')]);
    await fs.writeFile(file, changed);
    if (relative.endsWith('.mjs')) {
      // A corrupted executable fails the bootstrap; vendor failClosed must
      // turn that nonzero/no-output into denial (real vendor control pending).
      const hooks = JSON.parse(await fs.readFile(path.join(record.profileRoot, 'home', '.cursor', 'hooks.json'), 'utf8'));
      const child = spawn(hooks.hooks.preToolUse[0].command, { shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const done = new Promise(resolve => child.once('close', code => resolve(code)));
      child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(nativeEvent(record)));
      assert.equal(await done, 1);
    } else assert.equal((await guardCall(record, nativeEvent(record))).permission, 'deny');
    await assert.rejects(profile.verify(), { code: 'CI_PROFILE_CHANGED' });
    assert.deepEqual(await fs.readFile(file), changed);
  }
});

test('CI native guard pins the complete immutable original record and rejects linked or missing authority', async t => {
  for (const change of ['expiry', 'logical-id', 'source-root', 'native-cwd', 'command', 'state', 'new-field', 'manifest-link', 'record-missing']) {
    const f = await fixture(), profile = await required()(f.options); t.after(() => profile.close());
    const record = await profile.bindNative(randomUUID()), recordFile = path.join(f.owner, 'ci-profile.json');
    const changed = structuredClone(record);
    if (change === 'expiry') changed.expiresAt++;
    else if (change === 'logical-id') changed.sessionId = randomUUID();
    else if (change === 'source-root') changed.worktreeRoot = f.directory;
    else if (change === 'native-cwd') changed.nativeCwd = f.root;
    else if (change === 'command') changed.command = path.join(f.directory, 'foreign-cli');
    else if (change === 'state') changed.state = 'failed';
    else if (change === 'new-field') changed.verified = true;
    else if (change === 'manifest-link') {
      await fs.link(path.join(record.profileRoot, 'guard', 'guard-policy.json'), path.join(f.directory, 'manifest-link'));
    } else await fs.rename(recordFile, recordFile + '.preserved');
    if (!['manifest-link', 'record-missing'].includes(change)) await fs.writeFile(recordFile, JSON.stringify(changed));
    assert.equal((await guardCall(record, nativeEvent(record))).permission, 'deny', change);
    await assert.rejects(profile.verify(), { code: 'CI_PROFILE_CHANGED' });
  }
  const f = await fixture(), profile = await required()(f.options); t.after(() => profile.close());
  const record = await profile.bindNative(randomUUID());
  const guard = await import('../scripts/workbench/cursor-ci-guard.mjs');
  assert.equal((await guard.evaluateCursorCiGuard({ manifestFile: path.join(record.profileRoot, 'guard', 'guard-policy.json'),
    manifestSha256: record.guardPolicySha256, input: nativeEvent(record), now: () => record.expiresAt })).permission, 'deny');
  assert.equal((await guardCall(record, nativeEvent(record, { hook_event_name: 'beforeMCPExecution', tool_name: tools[0],
    mcp_server_name: 'context-guard-ci', url: profile.discovery.endpoint, mcp_server_url: profile.discovery.endpoint,
    tool_input: '{' }))).permission, 'deny');
});

test('CI native guard denies expiry occurring during the original record read', async t => {
  const f = await fixture(), profile = await required()(f.options); t.after(() => profile.close());
  const record = await profile.bindNative(randomUUID());
  const guard = await import('../scripts/workbench/cursor-ci-guard.mjs');
  const originalOpen = fs.open; let current = record.expiresAt - 1, reached = false;
  fs.open = async (...args) => {
    const result = await originalOpen(...args);
    if (args[0] === path.join(f.owner, 'ci-profile.json')) { reached = true; current = record.expiresAt; }
    return result;
  };
  try {
    const result = await guard.evaluateCursorCiGuard({ manifestFile: path.join(record.profileRoot, 'guard', 'guard-policy.json'),
      manifestSha256: record.guardPolicySha256, input: nativeEvent(record), now: () => current });
    assert.equal(reached, true); assert.equal(result.permission, 'deny');
  } finally { fs.open = originalOpen; }
});

test('CI profile rejects linked configuration bytes even when their content has not changed', async t => {
  const prepare = required();
  for (const kind of ['hardlink', 'symlink']) await t.test(kind, async t => {
    const f = await fixture(), profile = await prepare(f.options); t.after(() => profile.close());
    const file = path.join(profile.environment.CURSOR_CONFIG_DIR, 'mcp.json'), preserved = path.join(f.directory, 'preserved-mcp.json');
    await fs.rename(file, preserved);
    try { if (kind === 'hardlink') await fs.link(preserved, file); else await fs.symlink(preserved, file); }
    catch (cause) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(cause.code)) { t.skip('Windows symlink permission is unavailable'); return; } throw cause; }
    await assert.rejects(profile.verify(), { code: 'CI_PROFILE_CHANGED' });
    assert.ok(await fs.stat(preserved), 'link rejection preserves the original file');
  });
});
