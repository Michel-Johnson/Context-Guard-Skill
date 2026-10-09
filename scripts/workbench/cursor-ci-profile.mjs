import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicWrite, encode, hash, withFileLock } from '../shared/io.mjs';
import { canonical } from '../shared/protocol.mjs';
import { startCursorCiDiscovery, CURSOR_CI_TOOL_NAMES } from './cursor-ci-mcp.mjs';
import { privateCursorCommand } from './cursor-acp.mjs';

const invokePrivate = (command, args, options) => {
  const native = privateCursorCommand(command, args);
  return execute(native.command, native.args, { ...options, windowsHide: true });
};

const execute = promisify(execFile), uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = code => { throw Object.assign(new Error('The assigned CI native profile is unavailable'), { code }); };
const policy = { version: 1, editor: { vimMode: false }, approvalMode: 'allowlist', permissions: {
  allow: CURSOR_CI_TOOL_NAMES.map(name => `Mcp(context-guard-ci:${name})`),
  deny: ['Shell(*)', 'Read(**)', 'Write(**)', 'WebFetch(*)'],
} };
// Verified against official CLI 2026.10.01. session/new adds defaults and later
// refreshes privacyCache; a whole-file hash is an audit record, not a stable
// permission oracle. Never learn a new baseline from the native process.
const managedDefaults = {
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
const configurationPolicy = { version: 'cursor-cli-2026.10.01-default-v1', policy, managedDefaults, ghostMode: true };
function verifyConfiguration(bytes, now) {
  const value = JSON.parse(bytes);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !Object.hasOwn(policy, key) && !Object.hasOwn(managedDefaults, key) && key !== 'privacyCache')) fail('CI_PROFILE_CHANGED');
  for (const [key, expected] of Object.entries(policy)) if (canonical(value[key]) !== canonical(expected)) fail('CI_PROFILE_CHANGED');
  for (const [key, expected] of Object.entries(managedDefaults)) {
    if (Object.hasOwn(value, key) && canonical(value[key]) !== canonical(expected)) fail('CI_PROFILE_CHANGED');
  }
  if (Object.hasOwn(value, 'privacyCache')) {
    const cache = value.privacyCache;
    if (!cache || typeof cache !== 'object' || Array.isArray(cache) ||
        Object.keys(cache).some(key => !['ghostMode', 'privacyMode', 'updatedAt'].includes(key)) || cache.ghostMode !== true ||
        Object.hasOwn(cache, 'privacyMode') && ![0, 1, 2].includes(cache.privacyMode) ||
        !Number.isSafeInteger(cache.updatedAt) || cache.updatedAt < 0 || cache.updatedAt > now() + 300000) fail('CI_PROFILE_CHANGED');
  }
  // Missing privacyCache uses the official ghost=true default. Do not seed a
  // provider cache, suppress its refresh, or use its timestamp to renew TTL.
  return hash(canonical(configurationPolicy));
}
const inherited = new Set(['PATH', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT']);
const redirected = new Set(['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TMPDIR', 'TEMP', 'TMP',
  'CURSOR_CONFIG_DIR', 'CURSOR_DATA_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'CONTEXT_GUARD_NAMED_STATE_DIR']);
const provider = new Set(['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN']);

async function refuseExecutableConfiguration(home) {
  // These are executable/custom instruction sources, not the native Session
  // store. Absence is checked again before use; drift is never repaired.
  for (const relative of ['.cursor/hooks.json', '.cursor/hooks', '.cursor/skills', '.cursor/commands', '.cursor/agents',
    '.cursor/plugins', '.cursor/rules', '.claude', '.agents', '.codex', '.grok', 'AGENTS.md', 'CLAUDE.md']) {
    const present = await fs.lstat(path.join(home, relative)).then(() => true, cause => {
      if (cause.code === 'ENOENT') return false; throw cause;
    });
    if (present) fail('CI_PROFILE_CHANGED');
  }
}

async function realDirectory(directory, { privateMode = false, outsideProject = false } = {}) {
  if (!path.isAbsolute(directory || '') || await fs.realpath(directory) !== directory) fail('CI_PROFILE_PATH_INVALID');
  for (let current = directory;; current = path.dirname(current)) {
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('CI_PROFILE_PATH_INVALID');
    if (outsideProject) for (const name of ['.git', '.cursor', '.claude']) {
      const exists = await fs.lstat(path.join(current, name)).then(() => true, cause => {
        if (cause.code === 'ENOENT') return false; throw cause;
      });
      if (exists) fail('CI_PROFILE_PATH_INVALID');
    }
    if (path.dirname(current) === current) break;
  }
  if (privateMode && process.platform !== 'win32' && (await fs.stat(directory)).mode & 0o077) fail('CI_PROFILE_PATH_INVALID');
}

async function privateBytes(file) {
  const original = await fs.lstat(file);
  if (!original.isFile() || original.isSymbolicLink()) fail('CI_PROFILE_CHANGED');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.ino !== original.ino || info.dev !== original.dev || info.nlink !== 1 || info.size > 65536 ||
        process.platform !== 'win32' && info.mode & 0o077) fail('CI_PROFILE_CHANGED');
    return await handle.readFile();
  } finally { await handle.close(); }
}

// This is native configuration preparation, not a filesystem sandbox or a new
// model harness. No Core credential, arbitrary endpoint or hook is accepted.
export async function prepareCursorCiProfile({ directory, sessionId, root, command, environment, model, invoke = invokePrivate, now = Date.now } = {}) {
  if (![undefined, 'default', 'auto'].includes(model)) fail('CI_PROFILE_MODEL_UNSUPPORTED');
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) fail('CI_PROFILE_ENVIRONMENT_INVALID');
  const entries = Object.entries(environment);
  if (new Set(entries.map(([key]) => key.toUpperCase())).size !== entries.length) fail('CI_PROFILE_ENVIRONMENT_INVALID');
  environment = Object.fromEntries(entries.map(([key, value]) => [key.toUpperCase(), value]));
  if (!uuid.test(sessionId || '') || !path.isAbsolute(command || '') || typeof invoke !== 'function' || typeof now !== 'function' ||
      !Number.isSafeInteger(now()) ||
      Object.entries(environment).some(([key, value]) => typeof value !== 'string' ||
        !inherited.has(key) && !redirected.has(key) && !provider.has(key) && key !== 'AGENT_CLI_CREDENTIAL_STORE') ||
      ![...provider].some(key => environment[key]?.trim())) fail('CI_PROFILE_ENVIRONMENT_INVALID');
  await realDirectory(directory, { privateMode: true }); await realDirectory(root);
  if (!(await fs.stat(command)).isFile()) fail('CI_PROFILE_PATH_INVALID');
  const file = path.join(directory, 'ci-profile.json');
  let intent;
  try { intent = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600); }
  catch (cause) { if (cause.code === 'EEXIST') fail('CI_PROFILE_ALREADY_EXISTS'); throw cause; }
  let record = { format: 2, mode: 'ci-mcp-only-v1', sessionId, worktreeRoot: root, command, model: 'default',
    state: 'preparing', expiresAt: now() + 1800000 };
  try { await intent.writeFile(encode(record)); await intent.sync(); } finally { await intent.close(); }
  let discovery, closed = false;
  const close = async () => { closed = true; await discovery?.close(); };
  try {
    const base = await fs.realpath(os.tmpdir()); await realDirectory(base, { outsideProject: true });
    const profileRoot = await fs.realpath(await fs.mkdtemp(path.join(base, 'context-guard-cursor-ci-')));
    await fs.chmod(profileRoot, 0o700);
    record = { ...record, profileRoot, nativeCwd: path.join(profileRoot, 'native-cwd') };
    await atomicWrite(file, encode(record));
    const home = path.join(profileRoot, 'home'), temporary = path.join(profileRoot, 'tmp');
    const directories = [home, temporary, record.nativeCwd, path.join(home, '.cursor'), path.join(home, 'appdata'),
      path.join(home, 'local-appdata'), path.join(home, 'xdg-config'), path.join(home, 'xdg-data'), path.join(home, 'xdg-cache')];
    for (const target of directories) await fs.mkdir(target, { mode: 0o700 });
    // Override every native home/data/temp path, including Windows and XDG.
    // Unrelated parent configuration and backend registry paths are not copied.
    const env = { ...Object.fromEntries(Object.entries(environment).filter(([key]) => inherited.has(key) || provider.has(key))),
      HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'appdata'), LOCALAPPDATA: path.join(home, 'local-appdata'),
      CURSOR_CONFIG_DIR: path.join(home, '.cursor'), CURSOR_DATA_DIR: path.join(home, '.cursor'),
      XDG_CONFIG_HOME: path.join(home, 'xdg-config'), XDG_DATA_HOME: path.join(home, 'xdg-data'), XDG_CACHE_HOME: path.join(home, 'xdg-cache'),
      TMPDIR: temporary, TEMP: temporary, TMP: temporary, AGENT_CLI_CREDENTIAL_STORE: 'memory' };
    discovery = await startCursorCiDiscovery({ ttlMs: record.expiresAt - now(), now });
    const configuration = path.join(env.CURSOR_CONFIG_DIR, 'cli-config.json'), mcp = path.join(env.CURSOR_CONFIG_DIR, 'mcp.json');
    const mcpConfiguration = { mcpServers: { 'context-guard-ci': { url: discovery.endpoint,
      headers: { Authorization: `Bearer ${discovery.credential}` } } } };
    await fs.writeFile(configuration, encode(policy), { flag: 'wx', mode: 0o600 });
    await fs.writeFile(mcp, encode(mcpConfiguration), { flag: 'wx', mode: 0o600 });
    try { await invoke(command, ['mcp', 'enable', 'context-guard-ci'], { cwd: record.nativeCwd, env, windowsHide: true, timeout: 15000, maxBuffer: 65536 }); }
    catch { fail('CI_PROFILE_ENABLE_FAILED'); }
    const configurationBytes = await privateBytes(configuration), mcpBytes = await privateBytes(mcp);
    if (canonical(JSON.parse(mcpBytes)) !== canonical(mcpConfiguration) ||
        canonical(JSON.parse(configurationBytes)) !== canonical(policy) ||
        [...provider].some(key => environment[key] && [configurationBytes, mcpBytes].some(bytes => bytes.includes(environment[key])))) fail('CI_PROFILE_CHANGED');
    record = { ...record, state: 'prepared', configSha256: hash(configurationBytes),
      configPolicySha256: verifyConfiguration(configurationBytes, now), mcpSha256: hash(mcpBytes) };
    await atomicWrite(file, encode(record));
    const verify = async () => {
      if (closed) fail('CI_PROFILE_CLOSED');
      if (now() >= record.expiresAt) { await close(); fail('CI_PROFILE_EXPIRED'); }
      try {
        for (const target of [directory, profileRoot, ...directories]) await realDirectory(target, { privateMode: true });
        await refuseExecutableConfiguration(home);
        // No project files, ancestor repository discovery or user tool roots.
        await realDirectory(record.nativeCwd, { outsideProject: true });
        if ((await fs.readdir(record.nativeCwd)).length || canonical(JSON.parse(await privateBytes(file))) !== canonical(record) ||
            verifyConfiguration(await privateBytes(configuration), now) !== record.configPolicySha256 ||
            hash(await privateBytes(mcp)) !== record.mcpSha256) fail('CI_PROFILE_CHANGED');
      } catch { await close(); fail('CI_PROFILE_CHANGED'); }
      if (closed) fail('CI_PROFILE_CLOSED');
      if (now() >= record.expiresAt) { await close(); fail('CI_PROFILE_EXPIRED'); }
      return structuredClone(record);
    };
    await verify();
    return { environment: env, discovery, verify, close, bindNative: nativeSessionId => withFileLock(file + '.lock', async () => {
      await verify();
      if (!uuid.test(nativeSessionId || '') || record.nativeSessionId && record.nativeSessionId !== nativeSessionId) fail('CI_NATIVE_MISMATCH');
      if (!record.nativeSessionId) { record = { ...record, nativeSessionId }; await atomicWrite(file, encode(record)); }
      return verify();
    }) };
  } catch (cause) {
    await close(); await atomicWrite(file, encode({ ...record, state: 'failed' }));
    if (/^CI_[A-Z0-9_]+$/.test(cause.code || '')) throw cause;
    fail('CI_PROFILE_PREPARATION_FAILED');
  }
}
