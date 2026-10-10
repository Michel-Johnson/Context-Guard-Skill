import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CursorAcp } from './cursor-acp.mjs';
import { connectCursorCiWorkerClient, serveCursorCiWorker } from './cursor-ci-channel.mjs';
import { prepareCursorCiProfile, cursorCiProfileCleanupConfirmed } from './cursor-ci-profile.mjs';
import { exportCursorCiSource } from './cursor-ci-source.mjs';
import { CursorCiDockerRunner } from './cursor-ci-runner.mjs';
import { createCursorCiHostProof } from './cursor-ci-proof.mjs';
import { atomicWrite, encode, hash, readJSON, withFileLock } from '../shared/io.mjs';
import { canonical, validateMessage } from '../shared/protocol.mjs';

const ownFile = fileURLToPath(import.meta.url);
const execute = promisify(execFile);
const git = async (root, ...args) => (await execute('git', args, { cwd: root, windowsHide: true })).stdout.trim();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code, message) => { throw Object.assign(new Error(message), { code, status: ['RUNTIME_BUSY', 'WORKTREE_MISMATCH', 'CREATION_UNCERTAIN', 'ID_REUSED', 'RUNTIME_NOT_CONFIGURED'].includes(code) ? 409 : 400 }); };
const alive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (cause) { return cause.code !== 'ESRCH'; } };
const nativeLive = acp => Boolean(acp && !acp.failure && !acp.stopping && !acp.child?.killed &&
  acp.child?.exitCode == null && acp.child?.signalCode == null);
const preview = text => ({ text: String(text || '').slice(0, 40000).replace(/[\uD800-\uDBFF]$/, ''), truncated: String(text || '').length > 40000 });

async function readRunnerPolicy(file, expectedHash) {
  const unavailable = () => fail('CI_RUNNER_POLICY_CHANGED', 'The pinned private Runner policy is unavailable');
  if (!path.isAbsolute(file || '') || path.resolve(file) !== file || file.length > 4096) unavailable();
  let current = path.parse(file).root, handle;
  try {
    for (const component of path.relative(current, path.dirname(file)).split(path.sep).filter(Boolean)) {
      current = path.join(current, component);
      const info = await fs.lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) unavailable();
    }
    // This includes linked worktrees and Git's common directory. Parent process
    // Git overrides must not turn a repository path into a private policy path.
    const env = { PATH: process.env.PATH, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0',
      ...(process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) };
    try {
      const gitState = (await execute('git', ['rev-parse', '--is-inside-work-tree', '--is-inside-git-dir'],
        { cwd: path.dirname(file), env, windowsHide: true, timeout: 5000, maxBuffer: 4096 })).stdout.trim().split(/\r?\n/);
      if (gitState.includes('true')) unavailable();
    } catch (cause) { if (cause.code === 'CI_RUNNER_POLICY_CHANGED' || cause.code !== 128) unavailable(); }
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size < 2 || info.size > 65536 ||
        process.platform !== 'win32' && (info.mode & 0o777) !== 0o600) unavailable();
    const bytes = await handle.readFile();
    if (bytes.length !== info.size || bytes.length > 65536 || expectedHash !== undefined && hash(bytes) !== expectedHash) unavailable();
    const after = await handle.stat(), named = await fs.lstat(file);
    if (await fs.realpath(file) !== file || named.isSymbolicLink() || named.dev !== info.dev || named.ino !== info.ino ||
        after.nlink !== 1 || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) unavailable();
    const policy = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!policy || typeof policy !== 'object' || Array.isArray(policy) ||
        Object.keys(policy).some(key => !['docker', 'socket', 'daemonId', 'imageId', 'imageEnvironment', 'tests', 'timeoutMs', 'outputBytes'].includes(key)) ||
        !Array.isArray(policy.tests) || policy.tests.some(item => !item || typeof item !== 'object' || Array.isArray(item) ||
          Object.keys(item).some(key => !['id', 'todoId', 'commandLabel', 'argv'].includes(key)))) unavailable();
    return { policy, sha256: hash(bytes) };
  } catch { unavailable(); } finally { await handle?.close(); }
}

async function validateConfig(config) {
  if (!config || Object.keys(config).some(key => !['command', 'root', 'name', 'model', 'environmentFile', 'nativeSessionId', 'permissionPolicy', 'permissionsApproved', 'timeoutMs', 'role', 'executorSessionId', 'ciCommands', 'allowSessionCreation', 'ciRunnerPolicyFile'].includes(key)) ||
      !path.isAbsolute(config.command || '') || !path.isAbsolute(config.root || '') ||
      config.environmentFile !== undefined && !path.isAbsolute(config.environmentFile) ||
      typeof config.name !== 'string' || !config.name.trim() || config.name.length > 200 ||
      config.model !== undefined && (typeof config.model !== 'string' || !config.model.trim() || config.model.length > 200) ||
      config.nativeSessionId !== undefined && (typeof config.nativeSessionId !== 'string' || !config.nativeSessionId || config.nativeSessionId.length > 256) ||
      ![undefined, 'executor', 'ci'].includes(config.role) ||
      config.allowSessionCreation !== undefined && typeof config.allowSessionCreation !== 'boolean' ||
      config.role === 'ci' && config.allowSessionCreation === true ||
      config.role === 'ci' && (!uuid.test(config.executorSessionId || '') || !Array.isArray(config.ciCommands) || !config.ciCommands.length || config.ciCommands.length > 20 || config.ciCommands.some(command => typeof command !== 'string' || !command.trim() || command.length > 4000)) ||
      config.role !== 'ci' && (config.executorSessionId !== undefined || config.ciCommands !== undefined || config.ciRunnerPolicyFile !== undefined) ||
      config.ciRunnerPolicyFile !== undefined && !path.isAbsolute(config.ciRunnerPolicyFile || '') ||
      config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 1800000) ||
      ![undefined, 'reject', 'allow-once'].includes(config.permissionPolicy) ||
      config.permissionPolicy === 'allow-once' && config.permissionsApproved !== true) fail('INVALID_RUNTIME', 'Use explicit bounded Cursor settings and approved tool permissions');
  if (config.role === 'ci' && ![undefined, 'default', 'auto'].includes(config.model)) {
    fail('CI_PROFILE_MODEL_UNSUPPORTED', 'The verified CI native profile only supports the default model route');
  }
  const root = await fs.realpath(config.root);
  if (!(await fs.stat(config.command)).isFile() || !(await fs.stat(root)).isDirectory()) fail('INVALID_RUNTIME', 'Cursor executable and workspace must exist');
  const pinned = config.ciRunnerPolicyFile === undefined ? {} :
    { ciRunnerPolicySha256: (await readRunnerPolicy(config.ciRunnerPolicyFile)).sha256 };
  return { ...config, root, ...pinned, ...(config.role === 'ci' ? { model: 'default' } : {}) };
}

export function cursorEnvironment(credentials = {}, parent = process.env) {
  const providerKeys = new Set(['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN']);
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials) ||
      Object.entries(credentials).some(([key, value]) => !providerKeys.has(key) || typeof value !== 'string')) fail('INVALID_ENVIRONMENT', 'Cursor credentials must use the private provider allowlist');
  const allowed = new Set(['HOME', 'PATH', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT',
    'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'CONTEXT_GUARD_NAMED_STATE_DIR']);
  // An explicitly supplied provider credential is per-process. The official
  // CLI's memory store avoids reading/writing the user's keychain in automation.
  // Ordinary interactive-login configurations keep their native storage path.
  const explicitAuth = Object.values(credentials).some(value => value.trim().length > 0);
  return { ...Object.fromEntries(Object.entries(parent).filter(([key, value]) => allowed.has(key.toUpperCase()) && typeof value === 'string')),
    ...credentials, ...(explicitAuth ? { AGENT_CLI_CREDENTIAL_STORE: 'memory' } : {}) };
}

// Reuse the workbench's delivery IDs, not a second queue or scheduler. A native
// conversation ID is persisted separately from the Context Guard Session ID.
export class CursorRuntime {
  constructor(directory, { acpFactory = config => new CursorAcp(config), executorCreation, ciClientFactory, ciProfileInvoke, ciRunnerCommand } = {}) {
    this.directory = directory; this.acpFactory = acpFactory; this.pendingNative = new Map(); this.ownedTurns = new Map();
    this.executorCreation = executorCreation;
    this.ciClientFactory = ciClientFactory; this.ciWorkers = new Map(); this.ciClosing = false; this.ciRunnerCommand = ciRunnerCommand;
    this.ciProfileInvoke = ciProfileInvoke; this.pendingCiProfiles = new Map(); this.ciPreparing = new Map(); this.ciConnecting = new Map();
  }
  sessionFile(sessionId) {
    if (!uuid.test(sessionId || '')) fail('INVALID_SESSION', 'Use a Context Guard Session UUID');
    return path.join(this.directory, sessionId, 'session.json');
  }
  jobFile(sessionId, deliveryId) { return path.join(path.dirname(this.sessionFile(sessionId)), 'deliveries', `${hash(deliveryId)}.json`); }
  async configure(sessionId, config) {
    config = await validateConfig(config);
    return this.#saveConfiguration(sessionId, config);
  }
  async #saveConfiguration(sessionId, config) {
    if (config.role === 'ci' && sessionId === config.executorSessionId) fail('INVALID_RUNTIME', 'Tester and Executor must have independent identities');
    if (config.role === 'ci') {
      const executor = await readJSON(this.sessionFile(config.executorSessionId), null);
      if (executor && (executor.config.root === config.root || config.nativeSessionId && config.nativeSessionId === executor.nativeSessionId)) fail('INVALID_RUNTIME', 'Tester must not reuse the Executor workspace or native conversation');
    }
    const { root } = config, file = this.sessionFile(sessionId);
    // Serialize reverse identity checks with writes: two configurations cannot
    // claim the same native conversation under different logical Sessions.
    await withFileLock(path.join(this.directory, 'identities.lock'), () => withFileLock(file + '.lock', async () => {
      const current = await readJSON(file, {});
      if (current.active) fail('RUNTIME_BUSY', 'Finish the current delivery before reconfiguring Cursor');
      if (current.config && this.pendingNative.has(sessionId) && canonical(current.config) !== canonical(config)) fail('RUNTIME_BUSY', 'Finish the first native turn before changing Cursor settings');
      if (current.nativeSessionId && (current.config.root !== root || config.nativeSessionId && config.nativeSessionId !== current.nativeSessionId)) fail('WORKTREE_MISMATCH', 'Preserve the native conversation and its workspace');
      if (current.config && (current.config.role || 'executor') !== (config.role || 'executor')) fail('WORKTREE_MISMATCH', 'Preserve the configured Session role');
      const nativeSessionId = current.nativeSessionId || config.nativeSessionId || sessionId;
      for (const name of await fs.readdir(this.directory)) {
        if (!uuid.test(name) || name === sessionId) continue;
        const other = await readJSON(this.sessionFile(name), null);
        if (other?.nativeSessionId === nativeSessionId || name === nativeSessionId || other?.nativeSessionId === sessionId) fail('NATIVE_SESSION_CONFLICT', 'A native conversation must identify exactly one logical Session');
      }
      await atomicWrite(file, encode({ ...current, sessionId, config: { ...config, root },
        nativeSessionId, updatedAt: new Date().toISOString() }));
    }));
    return { configured: true, sessionId, role: config.role || 'executor' };
  }
  async ciReceivers(executorSessionId) {
    const creation = this.executorCreation ? await this.executorCreation(executorSessionId)
      : await readJSON(path.join(path.dirname(this.sessionFile(executorSessionId)), 'creation.json'), null);
    const candidates = [];
    for (const name of await fs.readdir(this.directory).catch(cause => cause.code === 'ENOENT' ? [] : Promise.reject(cause))) {
      if (!uuid.test(name)) continue;
      const state = await readJSON(this.sessionFile(name), null);
      if (state?.config.role === 'ci' && [executorSessionId, creation?.templateSessionId].includes(state.config.executorSessionId)) candidates.push({ sessionId: name, root: state.config.root });
    }
    return candidates;
  }
  async ciReceiver(executorSessionId) {
    const candidates = await this.ciReceivers(executorSessionId);
    if (candidates.length !== 1) fail('CI_RECEIVER_REQUIRED', 'Configure exactly one independent Tester for this Executor');
    return candidates[0];
  }
  async acceptsCiExecutor(config, sessionId) {
    if (!uuid.test(sessionId || '')) return false;
    if (sessionId === config.executorSessionId) return true;
    if (this.executorCreation) return (await this.executorCreation(sessionId))?.templateSessionId === config.executorSessionId;
    const creation = await readJSON(path.join(path.dirname(this.sessionFile(sessionId)), 'creation.json'), null);
    const executor = await readJSON(this.sessionFile(sessionId), null);
    return creation?.templateSessionId === config.executorSessionId && (executor?.config.role || 'executor') === 'executor' &&
      executor?.config.root === await fs.realpath(creation.root);
  }
  async ciContext(sessionId, { verifySource = false } = {}) {
    const state = await readJSON(this.sessionFile(sessionId), null);
    if (state?.config.role !== 'ci') return null;
    const job = state.active && await readJSON(state.active, null);
    if (!job?.execution || ['finished', 'failed', 'interrupted'].includes(job.state) || !await this.acceptsCiExecutor(state.config, job.execution.session.id)) fail('CI_NOT_ACTIVE', 'No assigned Tester task is active');
    if (verifySource && (await git(state.config.root, 'rev-parse', 'HEAD') !== job.execution.sourceSha || await git(state.config.root, 'status', '--porcelain'))) fail('CI_SOURCE_CHANGED', 'Tester result requires the unchanged assigned code SHA');
    return { ...job.execution, mode: 'ci', commands: state.config.ciCommands,
      tester: { sessionId, nativeSessionId: state.nativeSessionId, deliveryId: job.id, workerPid: job.workerPid || null } };
  }
  async resolveSessionId(nativeSessionId, root) {
    const worktreeRoot = await fs.realpath(root), matches = [];
    for (const name of await fs.readdir(this.directory).catch(cause => cause.code === 'ENOENT' ? [] : Promise.reject(cause))) {
      if (!uuid.test(name)) continue;
      const state = await readJSON(this.sessionFile(name), null);
      if (name !== nativeSessionId && state?.nativeSessionId !== nativeSessionId) continue;
      if (!state?.config || state.sessionId !== name || !state.nativeSessionId) fail('NATIVE_SESSION_CONFLICT', 'Preserve and repair the invalid native identity record');
      if (state.config.root !== worktreeRoot) fail('WORKTREE_MISMATCH', 'Native identity belongs to a different workspace');
      matches.push(name);
    }
    if (matches.length > 1) fail('NATIVE_SESSION_CONFLICT', 'Native identity mapping is ambiguous');
    return { sessionId: matches[0] || nativeSessionId, mapped: matches.length === 1 };
  }
  async provisionAssigned(request, { baseRef } = {}) {
    if (!request || !uuid.test(request.sessionId || '') || !uuid.test(request.templateSessionId || '') ||
        request.sessionId === request.templateSessionId || !/^[a-f0-9]{64}$/.test(request.id || '') ||
        typeof request.name !== 'string' || !request.name.trim() || request.name.length > 200) fail('INVALID_CREATION', 'Use the bounded Coordinator creation request');
    const directory = path.dirname(this.sessionFile(request.sessionId)), file = path.join(directory, 'creation.json');
    return withFileLock(file + '.lock', async () => {
      const fingerprint = hash(canonical({ id: request.id, sessionId: request.sessionId, templateSessionId: request.templateSessionId, name: request.name }));
      let receipt = await readJSON(file, null);
      if (receipt && receipt.fingerprint !== fingerprint) fail('ID_REUSED', 'Coordinator creation identity differs');
      const template = await readJSON(this.sessionFile(request.templateSessionId), null);
      if (!template || (template.config.role || 'executor') !== 'executor' || template.config.allowSessionCreation !== true) fail('CREATION_NOT_ENABLED', 'The local operator must enable this Cursor Executor template');
      if (!receipt) {
        if (typeof baseRef !== 'string' || !baseRef.startsWith('refs/')) fail('MAIN_REQUIRED', 'Use the registered project Main ref');
        const sha = await git(template.config.root, 'rev-parse', '--verify', `${baseRef}^{commit}`);
        receipt = { fingerprint, templateSessionId: request.templateSessionId, root: path.join(directory, 'worktree'), sha, branch: `cursor/session-${request.sessionId}` };
        await atomicWrite(file, encode(receipt));
      }
      const root = receipt.root;
      if (await fs.stat(root).then(() => true, cause => { if (cause.code === 'ENOENT') return false; throw cause; })) {
        if (await fs.realpath(await git(root, 'rev-parse', '--show-toplevel')) !== await fs.realpath(root) ||
            await git(root, 'branch', '--show-current') !== receipt.branch ||
            await fs.realpath(await git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir')) !== await fs.realpath(await git(template.config.root, 'rev-parse', '--path-format=absolute', '--git-common-dir'))) fail('WORKTREE_MISMATCH', 'Preserve the existing creation workspace');
      } else await git(template.config.root, 'worktree', 'add', '-b', receipt.branch, root, receipt.sha);
      const { nativeSessionId: _templateNative, ...config } = template.config;
      return this.provision({ operationId: request.id, sessionId: request.sessionId,
        config: { ...config, root, name: request.name.trim(), allowSessionCreation: false } });
    });
  }
  async provision({ operationId, sessionId, config } = {}) {
    if (typeof operationId !== 'string' || !operationId.trim() || operationId.length > 128 || config?.nativeSessionId ||
        sessionId !== undefined && !uuid.test(sessionId)) fail('INVALID_CREATION', 'Explicit creation requires a stable operation ID and no existing native Session');
    config = await validateConfig(config);
    if (config.role === 'ci' && (!sessionId || this.ciClosing)) fail('INVALID_CREATION', 'CI creation needs its reserved logical Session and a running host');
    const file = path.join(this.directory, 'creations', hash(operationId) + '.json'), fingerprint = hash(canonical(sessionId ? { sessionId, config } : config));
    if (sessionId) {
      const ownerFile = path.join(path.dirname(this.sessionFile(sessionId)), 'native-creation.json');
      await withFileLock(ownerFile + '.lock', async () => {
        const owner = await readJSON(ownerFile, null);
        if (owner && (owner.operationId !== operationId || owner.fingerprint !== fingerprint)) fail('ID_REUSED', 'Logical Session creation belongs to another operation');
        if (!owner) {
          if (await readJSON(this.sessionFile(sessionId), null)) fail('ID_REUSED', 'Preserve the existing logical Session; creation cannot replace it');
          await atomicWrite(ownerFile, encode({ operationId, fingerprint }));
        }
      });
    }
    return withFileLock(file + '.lock', async () => {
      let receipt = await readJSON(file, null), createdAcp, createdProfile;
      if (receipt && receipt.fingerprint !== fingerprint) fail('ID_REUSED', 'Cursor creation ID belongs to different settings');
      if (receipt && !receipt.sessionId) fail('CREATION_UNCERTAIN', 'Keep the original Cursor creation; do not create another conversation');
      if (receipt && config.role === 'ci') {
        const profile = this.pendingCiProfiles.get(receipt.sessionId);
        const transport = this.pendingNative.get(receipt.sessionId);
        if (!nativeLive(transport) || !profile || !receipt.ciProfile) {
          await profile?.close(); await transport?.close();
          fail('CREATION_UNCERTAIN', 'Preserve the CI native identity whose original transport was lost');
        }
        await profile.verify();
        if (this.ciClosing) fail('RUNTIME_CLOSING', 'The owning CI host is shutting down');
        if (!nativeLive(transport)) {
          await profile.close(); await transport.close();
          fail('CREATION_UNCERTAIN', 'Preserve the CI native transport that exited during verification');
        }
      }
      if (receipt?.state === 'ready') return receipt.result;
      if (!receipt) {
        await atomicWrite(file, encode({ fingerprint, state: 'creating' }));
        let acp;
        try {
          let env = cursorEnvironment(config.environmentFile ? await readJSON(config.environmentFile) : {}), cwd = config.root;
          if (config.role === 'ci') {
            const directory = path.join(path.dirname(this.sessionFile(sessionId)), 'profile-owner');
            await fs.mkdir(directory, { recursive: true, mode: 0o700 });
            const canonicalDirectory = await fs.realpath(directory);
            if (this.ciClosing) fail('RUNTIME_CLOSING', 'The owning CI host is shutting down');
            const preparing = prepareCursorCiProfile({ directory: canonicalDirectory, sessionId, root: config.root,
              command: config.command, model: config.model, environment: env, invoke: this.ciProfileInvoke });
            this.ciPreparing.set(sessionId, preparing);
            try { createdProfile = await preparing; } finally { this.ciPreparing.delete(sessionId); }
            if (this.ciClosing) fail('RUNTIME_CLOSING', 'The owning CI host is shutting down');
            this.pendingCiProfiles.set(sessionId, createdProfile);
            cwd = (await createdProfile.verify()).nativeCwd; env = createdProfile.environment;
          }
          if (config.role === 'ci' && this.ciClosing) fail('RUNTIME_CLOSING', 'The owning CI host is shutting down');
          acp = this.acpFactory({ command: createdProfile?.nativeCommand || config.command, cwd,
            // CI's fixed profile already selects the default route. Passing
            // --model default marks vendor config as user-changed and violates
            // that original policy; never relax the policy to accommodate it.
            args: [...(createdProfile?.nativeArgs || []), ...(config.role !== 'ci' && config.model ? ['--model', config.model] : [])], env,
            privateFiles: config.role === 'ci' });
          if (createdProfile) this.ciConnecting.set(sessionId, acp);
          const native = await acp.connect();
          if (!uuid.test(native.sessionId)) fail('CURSOR_INVALID_SESSION', 'Cursor returned an unsupported native Session identifier');
          receipt = { fingerprint, sessionId: sessionId || native.sessionId, nativeSessionId: native.sessionId, state: 'created' };
          await atomicWrite(file, encode(receipt));
          if (createdProfile) {
            if (this.ciClosing) fail('RUNTIME_CLOSING', 'Preserve the native identity returned during shutdown');
            const ciProfile = await createdProfile.bindNative(native.sessionId);
            receipt = { ...receipt, ciProfile }; await atomicWrite(file, encode(receipt));
          }
          // Cursor does not save a usable ACP store for an empty Session.
          // Keep this native transport until its first real prompt; never add
          // a synthetic model turn or silently create a replacement Session.
          createdAcp = acp;
        } catch (cause) {
          await acp?.close(); await createdProfile?.close();
          this.pendingCiProfiles.delete(sessionId); this.ciConnecting.delete(sessionId); throw cause;
        }
      }
      try {
        if (config.role === 'ci' && this.ciClosing) fail('RUNTIME_CLOSING', 'The owning CI host is shutting down');
        if (config.ciRunnerPolicyFile) await readRunnerPolicy(config.ciRunnerPolicyFile, config.ciRunnerPolicySha256);
        await this.#saveConfiguration(receipt.sessionId, { ...config, nativeSessionId: receipt.nativeSessionId || receipt.sessionId });
        if (config.role === 'ci' && this.ciClosing) fail('RUNTIME_CLOSING', 'The owning CI host is shutting down');
        if (receipt.ciProfile) await withFileLock(this.sessionFile(receipt.sessionId) + '.lock', async () => {
          const state = await readJSON(this.sessionFile(receipt.sessionId));
          if (state.nativeSessionId !== receipt.nativeSessionId || state.config.root !== receipt.ciProfile.worktreeRoot) fail('WORKTREE_MISMATCH', 'Preserve the original native profile identity');
          await atomicWrite(this.sessionFile(receipt.sessionId), encode({ ...state, ciProfile: receipt.ciProfile }));
        });
        if (createdAcp) {
          if (config.role === 'ci' && this.ciClosing) fail('RUNTIME_CLOSING', 'The owning CI host is shutting down');
          if (this.pendingNative.has(receipt.sessionId)) fail('NATIVE_SESSION_CONFLICT', 'Preserve the existing first-turn native transport');
          this.pendingNative.set(receipt.sessionId, createdAcp);
        }
      } catch (cause) { await createdAcp?.close(); await createdProfile?.close(); this.pendingCiProfiles.delete(receipt.sessionId); throw cause; }
      finally { this.ciConnecting.delete(receipt.sessionId); }
      const eventsFile = path.join(config.root, '.codex/context/sessions.jsonl');
      await withFileLock(eventsFile + '.lock', async () => {
        if (config.role === 'ci' && this.ciClosing) fail('RUNTIME_CLOSING', 'The owning CI host is shutting down');
        const previous = await fs.readFile(eventsFile, 'utf8').catch(cause => cause.code === 'ENOENT' ? '' : Promise.reject(cause));
        const found = previous.split('\n').some(line => { try { return JSON.parse(line).session_id === receipt.sessionId; } catch { return false; } });
        if (!found) {
          await fs.mkdir(path.dirname(eventsFile), { recursive: true });
          if (config.role === 'ci' && this.ciClosing) fail('RUNTIME_CLOSING', 'The owning CI host is shutting down');
          await fs.appendFile(eventsFile, JSON.stringify({ at: new Date().toISOString(), event: 'session-start', platform: 'cursor',
            session_id: receipt.sessionId, thread_name: config.name, source: 'cursor-acp-provision', worktree_root: config.root }) + '\n', { mode: 0o600 });
        }
      });
      if (config.role === 'ci') {
        if (this.ciClosing) fail('RUNTIME_CLOSING', 'The owning CI host is shutting down');
        const profile = this.pendingCiProfiles.get(receipt.sessionId);
        const transport = this.pendingNative.get(receipt.sessionId);
        if (!nativeLive(transport) || !profile) {
          await profile?.close(); await transport?.close();
          fail('CREATION_UNCERTAIN', 'Preserve the lost CI native transport');
        }
        await profile.verify();
      }
      const result = { created: true, sessionId: receipt.sessionId, root: config.root };
      await atomicWrite(file, encode({ ...receipt, state: 'ready', result }), { beforeReplace: () => {
        if (config.role === 'ci' && this.ciClosing) fail('RUNTIME_CLOSING', 'The owning CI host is shutting down');
      } });
      if (config.role === 'ci' && this.ciClosing) {
        await atomicWrite(file, encode({ ...receipt, state: 'created' }));
        fail('RUNTIME_CLOSING', 'Preserve the native creation returned during shutdown');
      }
      if (config.role === 'ci' && !nativeLive(this.pendingNative.get(receipt.sessionId))) {
        await atomicWrite(file, encode({ ...receipt, state: 'created' }));
        await this.pendingCiProfiles.get(receipt.sessionId)?.close();
        await this.pendingNative.get(receipt.sessionId)?.close();
        fail('CREATION_UNCERTAIN', 'Preserve the CI native transport that exited during registration');
      }
      return result;
    });
  }
  async conversation(sessionId) {
    const session = await readJSON(this.sessionFile(sessionId), null);
    if (!session) return { configured: false, sessionId, messages: [] };
    const directory = path.join(path.dirname(this.sessionFile(sessionId)), 'deliveries');
    const names = await fs.readdir(directory).catch(cause => cause.code === 'ENOENT' ? [] : Promise.reject(cause));
    const jobs = await Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => readJSON(path.join(directory, name))));
    jobs.sort((a, b) => (a.createdAt || a.updatedAt).localeCompare(b.createdAt || b.updatedAt));
    return { ...await this.status(sessionId), messages: jobs.slice(-20).flatMap(job => [
      { id: job.id + ':user', role: 'user', text: job.message },
      ...(job.result?.text ? [{ id: job.id + ':assistant', role: 'assistant', ...preview(job.result.text) }] : []),
    ]) };
  }
  async nativeReports(sessionId) {
    const directory = path.join(path.dirname(this.sessionFile(sessionId)), 'deliveries');
    const names = await fs.readdir(directory).catch(cause => cause.code === 'ENOENT' ? [] : Promise.reject(cause));
    const reports = [];
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const job = await readJSON(path.join(directory, name));
      if (!job.nativeRequest || job.reported || !['finished', 'failed', 'interrupted'].includes(job.state)) continue;
      const text = job.result?.text || '';
      reports.push({ jobFile: path.join(directory, name), message: { v: 2, id: hash(`cursor-result:${job.id}`), type: 'native.result',
        session: { id: sessionId, generation: job.nativeRequest.generation }, payload: { requestId: job.nativeRequest.id,
          status: job.state, ...preview(text), ...(job.error ? { error: job.error } : {}) } } });
    }
    return reports;
  }
  async acknowledgeReport(report) {
    await withFileLock(report.jobFile + '.worker.lock', async () => {
      const job = await readJSON(report.jobFile);
      await atomicWrite(report.jobFile, encode({ ...job, reported: true }));
    });
  }
  async rejectNative(input, code) {
    validateMessage({ v: 2, id: input.nativeRequest?.id, type: 'native.prompt', session: { id: input.sessionId, generation: input.nativeRequest?.generation }, payload: { text: input.message } });
    if (typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(code) || code === 'RUNTIME_BUSY') fail('INVALID_ARGUMENT', 'Only a definitive native rejection can be reported');
    const file = this.sessionFile(input.sessionId), jobFile = this.jobFile(input.sessionId, input.id);
    return withFileLock(file + '.lock', async () => {
      // A saved runtime intent may already have reached Cursor. Preserve it
      // instead of inventing a failed result for unknown model acceptance.
      if (await readJSON(jobFile, null)) return { preserved: true };
      const at = new Date().toISOString();
      await atomicWrite(jobFile, encode({ id: input.id, fingerprint: hash(canonical(input)), message: input.message,
        nativeRequest: input.nativeRequest, state: 'failed', error: code, createdAt: at, updatedAt: at }));
      return { recorded: true };
    });
  }
  async status(sessionId) {
    const session = await readJSON(this.sessionFile(sessionId), null);
    if (!session) return { configured: false };
    const job = session.lastDelivery && await readJSON(session.lastDelivery, null);
    const status = session.active ? job?.state === 'running' && alive(job?.workerPid) && alive(job?.childPid) ? 'active' : 'unknown'
      : job?.state === 'interrupted' ? 'interrupted' : job?.state === 'failed' ? 'failed' : 'stopped';
    return { configured: true, sessionId, nativeSessionId: session.nativeSessionId, name: session.config.name, role: session.config.role || 'executor',
      status, at: job?.updatedAt || session.updatedAt, deliveryId: job?.id || null, error: job?.error || null,
      ...(job?.result ? { result: { ...job.result, ...preview(job.result.text) } } : {}) };
  }
  async deliver(input) {
    if (!input || typeof input.id !== 'string' || !input.id || input.id.length > 256 || typeof input.message !== 'string' ||
        !input.message.trim() || Buffer.byteLength(input.message) > 65536) fail('INVALID_ARGUMENT', 'Use a bounded Cursor delivery ID and prompt');
    if (input.nativeRequest) {
      if (Object.keys(input.nativeRequest).some(key => !['id', 'generation'].includes(key))) fail('INVALID_ARGUMENT', 'Use the original native request identity');
      validateMessage({ v: 2, id: input.nativeRequest.id, type: 'native.prompt', session: { id: input.sessionId, generation: input.nativeRequest.generation }, payload: { text: input.message } });
    }
    const file = this.sessionFile(input.sessionId), jobFile = this.jobFile(input.sessionId, input.id), fingerprint = hash(canonical(input));
    await withFileLock(file + '.lock', async () => {
      const session = await readJSON(file, null);
      if (!session) fail('RUNTIME_NOT_CONFIGURED', 'Configure Cursor before delivering a message');
      if (await fs.realpath(input.root) !== session.config.root) fail('WORKTREE_MISMATCH', 'Cursor delivery targets a different workspace');
      const previous = await readJSON(jobFile, null);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail('ID_REUSED', 'Cursor delivery ID was reused for different content');
        return; // Unknown/terminal acceptance is never permission to prompt twice.
      }
      if (session.active) fail('RUNTIME_BUSY', 'Cursor already has an accepted delivery');
      if (session.config.role === 'ci') {
        if (this.ciClosing) fail('RUNTIME_CLOSING', 'The owning CI host is shutting down');
        if (input.nativeRequest || !await this.acceptsCiExecutor(session.config, input.execution?.session?.id) || !/^[a-f0-9]{40}$/.test(input.execution?.sourceSha || '')) fail('CI_ASSIGNMENT_MISMATCH', 'Tester requires a verified Executor handoff');
        if (await git(session.config.root, 'status', '--porcelain')) fail('CI_SOURCE_CHANGED', 'Preserve dirty Tester files before changing the assigned SHA');
        await git(session.config.root, 'checkout', '--detach', input.execution.sourceSha);
      } else if (input.execution) fail('CI_ASSIGNMENT_MISMATCH', 'Executor cannot receive a Tester assignment');
      const at = new Date().toISOString();
      await atomicWrite(jobFile, encode({ id: input.id, fingerprint, message: input.message,
        ...(input.execution ? { execution: input.execution } : {}),
        ...(input.nativeRequest ? { nativeRequest: input.nativeRequest } : {}), state: 'starting', createdAt: at, updatedAt: at }));
      await atomicWrite(file, encode({ ...session, active: jobFile, lastDelivery: jobFile }));
    });
    await this.wake(input.sessionId, jobFile);
    return { deliveryId: input.id, state: 'received', sessionId: input.sessionId };
  }
  async received(input) {
    const job = await readJSON(this.jobFile(input.sessionId, input.id), null);
    if (!job || job.fingerprint !== hash(canonical(input))) return false;
    await this.deliver(input); return true;
  }
  async wake(sessionId, jobFile) {
    const job = await readJSON(jobFile);
    if (job.state !== 'starting') return;
    const session = await readJSON(this.sessionFile(sessionId)), ci = session.config.role === 'ci';
    if (ci && this.ciClosing) fail('RUNTIME_CLOSING', 'The owning CI host is shutting down');
    const openCiClient = workerPid => {
      if (typeof this.ciClientFactory !== 'function') fail('CI_CONNECTION_UNAVAILABLE', 'Original CI host authorization is unavailable');
      return this.ciClientFactory({ sessionId, nativeSessionId: session.nativeSessionId, root: session.config.root,
        deliveryId: job.id, fingerprint: job.fingerprint, workerPid });
    };
    const acp = this.pendingNative.get(sessionId);
    if (acp) {
      // Unprofiled, empty CI transports cannot be upgraded by cold-loading or
      // replacing them. Preserve the exact transport while CI setup is gated.
      if (!ci) this.pendingNative.delete(sessionId);
      const owner = ci ? { profile: this.pendingCiProfiles.get(sessionId), command: this.ciRunnerCommand,
        check: () => { if (owner.stopping || this.ciClosing || this.pendingNative.get(sessionId) !== acp ||
          this.pendingCiProfiles.get(sessionId) !== owner.profile || !nativeLive(acp)) fail('CI_HELD_PROFILE_REQUIRED', 'Original held CI ownership is unavailable'); } } : undefined;
      const work = withFileLock(jobFile + '.worker.lock', () => runWorker(this.sessionFile(sessionId), jobFile, acp,
        ci ? () => openCiClient(process.pid) : undefined, owner));
      this.ownedTurns.set(jobFile, { acp, work, owner });
      void work.catch(() => {}).finally(() => {
        if (!owner?.unconfirmed && !owner?.uncertain) this.ownedTurns.delete(jobFile);
        if (owner?.completed) {
          if (this.pendingNative.get(sessionId) === acp) this.pendingNative.delete(sessionId);
          if (this.pendingCiProfiles.get(sessionId) === owner.profile) this.pendingCiProfiles.delete(sessionId);
        }
      });
      return;
    }
    const worker = spawn(process.execPath, [ownFile, '--worker', this.sessionFile(sessionId), jobFile], {
      detached: true, windowsHide: true, stdio: ci ? ['ignore', 'ignore', 'ignore', 'ipc'] : 'ignore',
      ...(ci ? { env: cursorEnvironment() } : {}),
    });
    const spawned = new Promise((resolve, reject) => { worker.once('spawn', resolve); worker.once('error', reject); });
    try {
      if (ci) {
        const bridge = serveCursorCiWorker({ worker, openClient: openCiClient });
        const stopped = new Promise(resolve => worker.once('exit', resolve));
        this.ciWorkers.set(jobFile, { worker, bridge, stopped });
        worker.once('exit', () => { bridge.close(); this.ciWorkers.delete(jobFile); });
      }
    } catch (cause) {
      worker.kill(); await spawned.catch(() => {}); throw cause;
    }
    await spawned;
    if (!ci || !this.ciClosing) worker.unref();
  }
  close() {
    this.ciClosing = true;
    return this.closing ||= Promise.resolve().then(async () => {
      const failures = [], failed = stage => failures.push(Object.assign(new Error('An owned Cursor resource shutdown is unconfirmed'), { code: stage }));
      const stop = async (stage, action) => { try { await action(); return true; } catch { failed(stage); return false; } };
      const profiles = new Set(this.pendingCiProfiles.values());
      const preparing = await Promise.allSettled([...this.ciPreparing.values()]);
      for (const result of preparing) {
        if (result.status === 'fulfilled') profiles.add(result.value);
        else if (!cursorCiProfileCleanupConfirmed(result.reason)) failed('CURSOR_PROFILE_PREPARATION_STOP_UNCONFIRMED');
      }
      for (const profile of this.pendingCiProfiles.values()) profiles.add(profile);
      const turns = [...this.ownedTurns.values()], ownerStops = new Map();
      for (const { owner } of turns) if (owner?.cleanup && !ownerStops.has(owner)) {
        const work = owner.cleanup(); work.catch(() => {}); ownerStops.set(owner, work);
      }
      await Promise.all([...ownerStops.values()].map(work => stop('CURSOR_CI_OWNER_STOP_UNCONFIRMED', () => work)));
      const ownedResource = resource => turns.find(turn => ownerStops.has(turn.owner) &&
        [turn.owner.profile, turn.acp].includes(resource))?.owner;
      const closedProfiles = new Set();
      await Promise.all([...profiles].map(async profile => {
        const owner = ownedResource(profile);
        if (owner) {
          if (owner.confirmedStops?.has(profile)) closedProfiles.add(profile);
          else failed('CURSOR_PROFILE_STOP_UNCONFIRMED');
        } else if (await stop('CURSOR_PROFILE_STOP_UNCONFIRMED', () => profile.close())) closedProfiles.add(profile);
      }));
      for (const [key, profile] of this.pendingCiProfiles) if (closedProfiles.has(profile)) this.pendingCiProfiles.delete(key);
      const workers = [...this.ciWorkers.values()];
      // Preserve the actual owning-worker exit wait, including on Node 18.
      // One bridge failure must not stop other channels/native resources closing.
      for (const { worker } of workers) { try { worker.ref(); } catch { failed('CURSOR_WORKER_REFERENCE_UNCONFIRMED'); } }
      await Promise.all(workers.map(({ bridge }) => stop('CURSOR_WORKER_CHANNEL_STOP_UNCONFIRMED', () => bridge.close())));
      const transports = new Set([...this.pendingNative.values(), ...this.ciConnecting.values(), ...turns.map(turn => turn.acp)]);
      this.shutdownOwnership = { profiles, transports, workers, turns }; // Retain failed ownership; never serialize it to a model/API.
      const closedTransports = new Set();
      await Promise.all([...transports].map(async acp => {
        const owner = ownedResource(acp);
        if (owner) {
          if (owner.confirmedStops?.has(acp)) closedTransports.add(acp);
          else failed('CURSOR_NATIVE_STOP_UNCONFIRMED');
        } else if (await stop('CURSOR_NATIVE_STOP_UNCONFIRMED', () => acp.close())) closedTransports.add(acp);
      }));
      for (const table of [this.pendingNative, this.ciConnecting]) {
        for (const [key, acp] of table) if (closedTransports.has(acp)) table.delete(key);
      }
      await Promise.all(turns.map(turn => stop('CURSOR_TURN_STOP_UNCONFIRMED', () => turn.work)));
      await Promise.all(workers.map(({ stopped }) => stop('CURSOR_WORKER_EXIT_UNCONFIRMED', () => stopped)));
      if ([this.pendingNative, this.ciConnecting].some(table => [...table.values()].some(acp => !transports.has(acp)))) {
        failed('CURSOR_LATE_NATIVE_STOP_UNCONFIRMED');
      }
      if ([...this.pendingCiProfiles.values()].some(profile => !profiles.has(profile))) failed('CURSOR_LATE_PROFILE_STOP_UNCONFIRMED');
      if ([...this.ciWorkers.values()].some(worker => !workers.includes(worker))) failed('CURSOR_LATE_WORKER_STOP_UNCONFIRMED');
      if (failures.length) throw Object.assign(new AggregateError(failures, 'Cursor shutdown could not confirm all owned resources stopped'),
        { code: 'CURSOR_SHUTDOWN_UNCONFIRMED' });
      this.shutdownOwnership = null;
    });
  }
}

async function prepareHeldCiHost({ config, client, context, prepared, owner }) {
  if (!owner?.profile || typeof owner.check !== 'function' || typeof client.commit !== 'function') {
    fail('CI_HELD_PROFILE_REQUIRED', 'Original held CI ownership is required for host preparation');
  }
  if (!/^[a-f0-9]{64}$/.test(config.ciRunnerPolicySha256 || '')) fail('CI_RUNNER_POLICY_CHANGED', 'Use the original host-pinned Runner policy');
  const scope = canonical(context), authorization = canonical(prepared);
  let record;
  const check = async (options = {}) => {
    owner.check();
    const profile = await owner.profile.verify(); owner.check();
    if (profile.sessionId !== context.tester.sessionId || profile.nativeSessionId !== context.tester.nativeSessionId ||
        profile.worktreeRoot !== config.root || record && canonical(profile) !== canonical(record) ||
        context.tester.workerPid !== process.pid || client.signal.aborted || owner.profile.discovery.signal?.aborted) fail('CI_NATIVE_MISMATCH', 'Preserve original CI preparation ownership');
    record ||= profile;
    const current = await client.context(options); owner.check();
    if (canonical(current) !== scope) fail('CI_TASK_CHANGED', 'Original CI preparation scope changed');
    const pinned = await readRunnerPolicy(config.ciRunnerPolicyFile, config.ciRunnerPolicySha256); owner.check();
    await owner.profile.verify(); owner.check();
    return { context: current, policy: pinned.policy };
  };
  const initial = await check();
  if (canonical(await client.hostContext()) !== authorization) fail('CI_TASK_CHANGED', 'Original approved preparation changed');
  await check();
  const parent = path.join(record.profileRoot, 'host');
  await fs.mkdir(parent, { mode: 0o700 }); await check();
  const directory = await fs.realpath(await fs.mkdtemp(path.join(parent, 'delivery-'))); await check();
  const source = await exportCursorCiSource({ root: config.root, sourceSha: context.sourceSha,
    paths: prepared.approvedPlan.paths, directory }); await check();
  const runner = new CursorCiDockerRunner({ directory, policy: initial.policy, source, context,
    ciTodo: prepared.ciTodo, authorize: async options => (await check(options)).context,
    ...(owner.command ? { command: owner.command } : {}) });
  owner.runner = runner; // Original owning turn retains cleanup responsibility even when metadata rejects.
  const proof = createCursorCiHostProof({ runner, approvedPlan: prepared.approvedPlan, ciTodo: prepared.ciTodo,
    commit: (message, options) => client.commit(message, options) });
  owner.pending = new Set();
  const track = action => (...args) => {
    if (owner.stopping) fail('CI_CAPABILITY_EXPIRED', 'The original CI host is stopping');
    const work = Promise.resolve().then(() => action(...args));
    owner.pending.add(work);
    void work.finally(() => owner.pending.delete(work)).catch(() => {});
    return work;
  };
  owner.proof = { runTest: track(proof.runTest), verifyResult: track(proof.verifyResult),
    submitVerifiedResult: track(async message => {
    // Only a successful private Core commit AND proof-ledger persistence can
    // set this host outcome. Neither model text nor a public MCP JSON can.
    const receipt = await proof.submitVerifiedResult(message);
    owner.outcome = structuredClone({ receipt, resultId: message.id });
    return receipt;
  }) }; // Never placed in JSON, IPC payload or model context.
  owner.source = source;
  owner.client = { context: async options => (await check(options)).context, exchange: track(message => client.exchange(message)) };
  await runner.check();
  await runner.verifyEnvironment();
  await runner.check(); // Metadata awaits cannot bless changed snapshot bytes/modes.
  return { authorization: 'preparation-only', taskId: context.taskId, sourceSha: context.sourceSha,
    planRef: prepared.approvedPlan.ref, planVersion: prepared.approvedPlan.version,
    planSourceSha: prepared.approvedPlan.sourceSha, approvalReceiptId: prepared.approvedPlan.approvalReceiptId,
    ciTodoRef: context.ciTodoRef, ciTodoVersion: prepared.ciTodo.version,
    deliveryId: context.tester.deliveryId, workerPid: process.pid, policySha256: config.ciRunnerPolicySha256,
    manifestSha256: source.manifestSha256, fileCount: source.manifest.fileCount };
}

async function runWorker(file, jobFile, heldAcp, openCiClient, ciOwner) {
  const session = await readJSON(file), config = session.config, job = await readJSON(jobFile);
  if (job.state !== 'starting') return;
  const update = async fields => { Object.assign(job, fields, { updatedAt: new Date().toISOString() }); await atomicWrite(jobFile, encode(job)); };
  const finish = async fields => {
    await update(fields);
    await withFileLock(file + '.lock', async () => {
      const current = await readJSON(file);
      if (current.active === jobFile) await atomicWrite(file, encode({ ...current, active: null, updatedAt: job.updatedAt }));
    });
  };
  let acp = heldAcp, log, ready = false, bytes = 0, text = '', stopping = false, ciClient, ciScope;
  const preserveHeldCi = config.role === 'ci' && !!heldAcp;
  let preparedCleanup, cleanup;
  const closePreparedRunner = () => preparedCleanup ||= Promise.resolve().then(async () => {
    try { await ciOwner?.runner?.close(); }
    catch { if (ciOwner) ciOwner.unconfirmed = true; fail('CI_STOP_UNCONFIRMED', 'The original CI host stop is unconfirmed'); }
  });
  const closeCiHost = () => {
    if (cleanup) return cleanup;
    let resolve, reject;
    cleanup = new Promise((yes, no) => { resolve = yes; reject = no; }); // Before synchronous abort re-entry.
    if (ciOwner) { ciOwner.stopping = true; ciOwner.confirmedStops ||= new Set(); }
    const failures = [];
    const attempt = async (code, resource, action) => { try { await action(); if (resource) ciOwner?.confirmedStops.add(resource); }
      catch { failures.push(Object.assign(new Error('An owned CI stop is unconfirmed'), { code })); } };
    // close() revokes profile/Discovery synchronously. All three resource
    // attempts start independently, even if one rejects. No callback lock waits
    // for cleanup; cleanup alone waits for original in-flight proof/ACK work.
    const stops = [attempt('CI_PROFILE_STOP_UNCONFIRMED', ciOwner?.profile, () => ciOwner?.profile?.close()),
      attempt('CI_NATIVE_STOP_UNCONFIRMED', acp, () => acp?.close()),
      attempt('CI_RUNNER_STOP_UNCONFIRMED', ciOwner?.runner, () => preparedCleanup || ciOwner?.runner?.close())];
    void Promise.all(stops).then(async () => {
      await Promise.allSettled([...(ciOwner?.pending || [])]);
      if (failures.length) {
        if (ciOwner) ciOwner.unconfirmed = true;
        reject(Object.assign(new AggregateError(failures, 'The original CI stop is unconfirmed'), { code: 'CI_STOP_UNCONFIRMED' }));
      } else resolve();
    }).catch(reject);
    return cleanup;
  };
  if (ciOwner) ciOwner.cleanup = closeCiHost;
  const stop = () => {
    stopping = true;
    if (config.role === 'ci') void closeCiHost().catch(() => {});
    else void acp?.close().catch(() => {});
  };
  const ensureCiAvailable = () => {
    if (stopping || ciClient?.signal.aborted || ciOwner?.profile?.discovery.signal?.aborted) {
      fail('CI_CAPABILITY_EXPIRED', 'The original CI host is no longer available');
    }
    ciOwner?.check();
  };
  const discoverySignal = ciOwner?.profile?.discovery.signal;
  discoverySignal?.addEventListener('abort', stop, { once: true });
  if (discoverySignal?.aborted) stop();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    await update({ workerPid: process.pid, state: 'connecting' });
    log = await fs.open(jobFile + '.jsonl', 'a', 0o600);
    if (stopping) fail('CURSOR_INTERRUPTED', 'Cursor worker was stopped');
    // ACP descriptions do not prove bounded test commands/paths. Never lend
    // the Executor's broad grant to a Tester, including retained old settings.
    const requestPermission = params => config.role !== 'ci' && config.permissionPolicy === 'allow-once' && config.permissionsApproved === true
        ? params.options?.find(option => option.kind === 'allow_once')?.optionId : undefined,
      onUpdate = async event => {
        if (!ready) return; // session/load replays history, not new turn output.
        const line = JSON.stringify(event) + '\n'; bytes += Buffer.byteLength(line);
        if (bytes > 64 * 1024 * 1024) fail('CURSOR_OUTPUT_LIMIT', 'Cursor output exceeds the configured limit');
        await log.write(line);
        if (event.update?.sessionUpdate === 'agent_message_chunk' && event.update.content?.type === 'text') text += event.update.content.text;
      };
    if (acp) { acp.requestPermission = requestPermission; acp.onUpdate = onUpdate; }
    if (config.role === 'ci') {
      ciClient = openCiClient ? await openCiClient() : connectCursorCiWorkerClient();
      ciClient.signal.addEventListener('abort', stop, { once: true });
      if (ciClient.signal.aborted) stop();
      ensureCiAvailable();
      const context = await ciClient.context(); // Original task/role checked before a paid/native prompt.
      ciScope = canonical(context);
      ensureCiAvailable();
      const prepared = await ciClient.hostContext(); // Original approved Plan/receipt and fixed TODO, host-only preparation.
      ensureCiAvailable();
      if (config.ciRunnerPolicyFile) {
        const ciPreparation = await prepareHeldCiHost({ config, client: ciClient, context, prepared, owner: ciOwner });
        await update({ ciPreparation });
        ensureCiAvailable();
      }
      const profile = ciOwner?.profile, record = profile && await profile.verify();
      ensureCiAvailable();
      if (!record?.nativeIdentity || typeof profile.verifyNative !== 'function' || !ciOwner.proof ||
          !acp?.initialized || acp.sessionId !== session.nativeSessionId) {
        fail('CI_NATIVE_ISOLATION_REQUIRED', 'The assigned native CI isolation must be verified before prompting');
      }
      const identity = await profile.verifyNative(); ensureCiAvailable();
      if (canonical(identity) !== canonical(record.nativeIdentity)) fail('CI_NATIVE_MISMATCH', 'Preserve the original verified native distribution');
      ciOwner.activationAttempted = true;
      ciOwner.uncertain = true; // Retain ownership until both result and finish are durably confirmed.
      await update({ ciActivation: { nativeSessionId: session.nativeSessionId, deliveryId: job.id,
        sourceSha: context.sourceSha, expiresAt: record.expiresAt, state: 'attempted' } });
      ensureCiAvailable();
      await profile.discovery.activate({ client: ciOwner.client, source: ciOwner.source,
        testerSessionId: context.tester.sessionId, nativeSessionId: context.tester.nativeSessionId,
        tests: ciOwner.runner.policy.tests.map(test => test.id), ...ciOwner.proof });
      ensureCiAvailable();
      await profile.verifyNative(); ensureCiAvailable();
    }
    if (!acp) acp = new CursorAcp({ command: config.command, cwd: config.root, args: config.model ? ['--model', config.model] : [],
      env: cursorEnvironment(config.environmentFile ? await readJSON(config.environmentFile) : {}), requestPermission, onUpdate });
    const native = acp.initialized ? { sessionId: acp.sessionId } : await acp.connect({ sessionId: session.nativeSessionId || undefined });
    if (session.nativeSessionId && native.sessionId !== session.nativeSessionId) fail('NATIVE_SESSION_CONFLICT', 'Native transport does not match the saved conversation');
    await withFileLock(file + '.lock', async () => {
      const current = await readJSON(file);
      await atomicWrite(file, encode({ ...current, nativeSessionId: native.sessionId }));
    });
    if (config.role === 'ci') ensureCiAvailable();
    ready = true;
    // Persist dispatch BEFORE writing the prompt. A worker crash here cannot
    // cause the same delivery to be invoked again after backend restart.
    await update({ state: 'running', childPid: acp.child.pid });
    let timeoutMs = config.timeoutMs || 1800000;
    if (config.role === 'ci') {
      // Native/config and durable job awaits cannot bless a silently revoked
      // remote Task. Recheck the original scoped authority immediately before
      // dispatch; only synchronous ownership/deadline checks follow it.
      const current = await ciClient.context();
      ensureCiAvailable();
      if (canonical(current) !== ciScope) fail('CI_TASK_CHANGED', 'Original CI dispatch scope changed');
      timeoutMs = Math.min(timeoutMs, job.ciActivation.expiresAt - Date.now());
      if (timeoutMs <= 0) fail('CI_CAPABILITY_EXPIRED', 'The original CI deadline has expired');
    }
    const result = await acp.prompt(job.message, { timeoutMs });
    await log.sync();
    if (config.role === 'ci') {
      await closeCiHost(); // Includes in-flight private proof/late ACK, not just socket close.
      if (!ciOwner.outcome) fail('CI_RESULT_UNCONFIRMED', 'A native end_turn is not a committed test result');
      await finish({ state: 'finished', ciReceipt: ciOwner.outcome,
        result: { stopReason: result.stopReason, text }, error: null });
      ciOwner.completed = true;
      ciOwner.uncertain = false;
      return;
    }
    await acp.close(); // Confirm native exit before allowing another delivery.
    await finish({ state: result.stopReason === 'end_turn' ? 'finished' : 'interrupted',
      result: { stopReason: result.stopReason, text }, error: result.stopReason === 'end_turn' ? null : 'CURSOR_TURN_STOPPED' });
  } catch (cause) {
    try {
      if (ciOwner?.activationAttempted || stopping) await closeCiHost();
      else await closePreparedRunner();
    }
    catch (stopFailure) { await update({ state: 'unknown', error: stopFailure.code }); throw stopFailure; }
    if (ciOwner?.activationAttempted) {
      if (ciOwner.outcome) {
        await finish({ state: 'finished', ciReceipt: ciOwner.outcome,
          result: { stopReason: null, text }, error: null });
        ciOwner.completed = true;
        ciOwner.uncertain = false;
      } else {
        ciOwner.uncertain = true;
        await update({ state: 'unknown', error: String(cause.code || 'CI_RESULT_UNCONFIRMED').slice(0, 100),
          ...(text ? { result: { stopReason: null, text } } : {}) });
      }
      return;
    }
    if (!preserveHeldCi) await acp?.close();
    await finish({ state: job.state === 'running' ? 'interrupted' : 'failed', ...(text ? { result: { stopReason: null, text } } : {}), error: String(cause.code || 'CURSOR_FAILED').slice(0, 100) });
  } finally {
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    discoverySignal?.removeEventListener('abort', stop);
    ciClient?.signal.removeEventListener('abort', stop);
    ciClient?.close();
    if (!preserveHeldCi) await acp?.close();
    await log?.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === ownFile && process.argv[2] === '--worker') {
  const [file, jobFile] = process.argv.slice(3);
  withFileLock(jobFile + '.worker.lock', () => runWorker(file, jobFile)).catch(() => { process.exitCode = 1; });
}
