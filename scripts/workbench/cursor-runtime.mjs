import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CursorAcp } from './cursor-acp.mjs';
import { atomicWrite, encode, hash, readJSON, withFileLock } from '../shared/io.mjs';
import { canonical, validateMessage } from '../shared/protocol.mjs';

const ownFile = fileURLToPath(import.meta.url);
const execute = promisify(execFile);
const git = async (root, ...args) => (await execute('git', args, { cwd: root, windowsHide: true })).stdout.trim();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code, message) => { throw Object.assign(new Error(message), { code, status: ['RUNTIME_BUSY', 'WORKTREE_MISMATCH', 'CREATION_UNCERTAIN', 'ID_REUSED', 'RUNTIME_NOT_CONFIGURED'].includes(code) ? 409 : 400 }); };
const alive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (cause) { return cause.code !== 'ESRCH'; } };
const preview = text => ({ text: String(text || '').slice(0, 40000).replace(/[\uD800-\uDBFF]$/, ''), truncated: String(text || '').length > 40000 });

async function validateConfig(config) {
  if (!config || Object.keys(config).some(key => !['command', 'root', 'name', 'model', 'environmentFile', 'nativeSessionId', 'permissionPolicy', 'permissionsApproved', 'timeoutMs', 'role', 'executorSessionId', 'ciCommands', 'allowSessionCreation'].includes(key)) ||
      !path.isAbsolute(config.command || '') || !path.isAbsolute(config.root || '') ||
      config.environmentFile !== undefined && !path.isAbsolute(config.environmentFile) ||
      typeof config.name !== 'string' || !config.name.trim() || config.name.length > 200 ||
      config.model !== undefined && (typeof config.model !== 'string' || !config.model.trim() || config.model.length > 200) ||
      config.nativeSessionId !== undefined && (typeof config.nativeSessionId !== 'string' || !config.nativeSessionId || config.nativeSessionId.length > 256) ||
      ![undefined, 'executor', 'ci'].includes(config.role) ||
      config.allowSessionCreation !== undefined && typeof config.allowSessionCreation !== 'boolean' ||
      config.role === 'ci' && config.allowSessionCreation === true ||
      config.role === 'ci' && (!uuid.test(config.executorSessionId || '') || !Array.isArray(config.ciCommands) || !config.ciCommands.length || config.ciCommands.length > 20 || config.ciCommands.some(command => typeof command !== 'string' || !command.trim() || command.length > 4000)) ||
      config.role !== 'ci' && (config.executorSessionId !== undefined || config.ciCommands !== undefined) ||
      config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 1800000) ||
      ![undefined, 'reject', 'allow-once'].includes(config.permissionPolicy) ||
      config.permissionPolicy === 'allow-once' && config.permissionsApproved !== true) fail('INVALID_RUNTIME', 'Use explicit bounded Cursor settings and approved tool permissions');
  const root = await fs.realpath(config.root);
  if (!(await fs.stat(config.command)).isFile() || !(await fs.stat(root)).isDirectory()) fail('INVALID_RUNTIME', 'Cursor executable and workspace must exist');
  return { ...config, root };
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
  constructor(directory, { acpFactory = config => new CursorAcp(config), executorCreation } = {}) {
    this.directory = directory; this.acpFactory = acpFactory; this.pendingNative = new Map(); this.ownedTurns = new Map();
    this.executorCreation = executorCreation;
  }
  sessionFile(sessionId) {
    if (!uuid.test(sessionId || '')) fail('INVALID_SESSION', 'Use a Context Guard Session UUID');
    return path.join(this.directory, sessionId, 'session.json');
  }
  jobFile(sessionId, deliveryId) { return path.join(path.dirname(this.sessionFile(sessionId)), 'deliveries', `${hash(deliveryId)}.json`); }
  async configure(sessionId, config) {
    config = await validateConfig(config);
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
      let receipt = await readJSON(file, null), createdAcp;
      if (receipt && receipt.fingerprint !== fingerprint) fail('ID_REUSED', 'Cursor creation ID belongs to different settings');
      if (receipt?.state === 'ready') return receipt.result;
      if (receipt && !receipt.sessionId) fail('CREATION_UNCERTAIN', 'Keep the original Cursor creation; do not create another conversation');
      if (!receipt) {
        await atomicWrite(file, encode({ fingerprint, state: 'creating' }));
        const acp = this.acpFactory({ command: config.command, cwd: config.root,
          args: config.model ? ['--model', config.model] : [],
          env: cursorEnvironment(config.environmentFile ? await readJSON(config.environmentFile) : {}) });
        try {
          const native = await acp.connect();
          if (!uuid.test(native.sessionId)) fail('CURSOR_INVALID_SESSION', 'Cursor returned an unsupported native Session identifier');
          receipt = { fingerprint, sessionId: sessionId || native.sessionId, nativeSessionId: native.sessionId, state: 'created' };
          await atomicWrite(file, encode(receipt));
          // Cursor does not save a usable ACP store for an empty Session.
          // Keep this native transport until its first real prompt; never add
          // a synthetic model turn or silently create a replacement Session.
          createdAcp = acp;
        } catch (cause) { await acp.close(); throw cause; }
      }
      try {
        await this.configure(receipt.sessionId, { ...config, nativeSessionId: receipt.nativeSessionId || receipt.sessionId });
        if (createdAcp) {
          if (this.pendingNative.has(receipt.sessionId)) fail('NATIVE_SESSION_CONFLICT', 'Preserve the existing first-turn native transport');
          this.pendingNative.set(receipt.sessionId, createdAcp);
        }
      } catch (cause) { await createdAcp?.close(); throw cause; }
      const eventsFile = path.join(config.root, '.codex/context/sessions.jsonl');
      await withFileLock(eventsFile + '.lock', async () => {
        const previous = await fs.readFile(eventsFile, 'utf8').catch(cause => cause.code === 'ENOENT' ? '' : Promise.reject(cause));
        const found = previous.split('\n').some(line => { try { return JSON.parse(line).session_id === receipt.sessionId; } catch { return false; } });
        if (!found) {
          await fs.mkdir(path.dirname(eventsFile), { recursive: true });
          await fs.appendFile(eventsFile, JSON.stringify({ at: new Date().toISOString(), event: 'session-start', platform: 'cursor',
            session_id: receipt.sessionId, thread_name: config.name, source: 'cursor-acp-provision', worktree_root: config.root }) + '\n', { mode: 0o600 });
        }
      });
      const result = { created: true, sessionId: receipt.sessionId, root: config.root };
      await atomicWrite(file, encode({ ...receipt, state: 'ready', result }));
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
    if ((await readJSON(jobFile)).state !== 'starting') return;
    const acp = this.pendingNative.get(sessionId);
    if (acp) {
      this.pendingNative.delete(sessionId);
      const work = withFileLock(jobFile + '.worker.lock', () => runWorker(this.sessionFile(sessionId), jobFile, acp));
      this.ownedTurns.set(jobFile, { acp, work });
      void work.catch(() => {}).finally(() => this.ownedTurns.delete(jobFile));
      return;
    }
    const worker = spawn(process.execPath, [ownFile, '--worker', this.sessionFile(sessionId), jobFile], {
      detached: true, windowsHide: true, stdio: 'ignore',
    });
    await new Promise((resolve, reject) => { worker.once('spawn', resolve); worker.once('error', reject); });
    worker.unref();
  }
  async close() {
    const transports = [...this.pendingNative.values(), ...[...this.ownedTurns.values()].map(turn => turn.acp)];
    this.pendingNative.clear();
    await Promise.all(transports.map(acp => acp.close()));
    await Promise.allSettled([...this.ownedTurns.values()].map(turn => turn.work));
  }
}

async function runWorker(file, jobFile, heldAcp) {
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
  let acp = heldAcp, log, ready = false, bytes = 0, text = '', stopping = false;
  const stop = () => { stopping = true; void acp?.close(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  await update({ workerPid: process.pid, state: 'connecting' });
  try {
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
    else acp = new CursorAcp({ command: config.command, cwd: config.root, args: config.model ? ['--model', config.model] : [],
      env: cursorEnvironment(config.environmentFile ? await readJSON(config.environmentFile) : {}), requestPermission, onUpdate });
    const native = acp.initialized ? { sessionId: acp.sessionId } : await acp.connect({ sessionId: session.nativeSessionId || undefined });
    if (session.nativeSessionId && native.sessionId !== session.nativeSessionId) fail('NATIVE_SESSION_CONFLICT', 'Native transport does not match the saved conversation');
    await withFileLock(file + '.lock', async () => {
      const current = await readJSON(file);
      await atomicWrite(file, encode({ ...current, nativeSessionId: native.sessionId }));
    });
    ready = true;
    // Persist dispatch BEFORE writing the prompt. A worker crash here cannot
    // cause the same delivery to be invoked again after backend restart.
    await update({ state: 'running', childPid: acp.child.pid });
    const result = await acp.prompt(job.message, { timeoutMs: config.timeoutMs || 1800000 });
    await log.sync();
    await acp.close(); // Confirm native exit before allowing another delivery.
    await finish({ state: result.stopReason === 'end_turn' ? 'finished' : 'interrupted',
      result: { stopReason: result.stopReason, text }, error: result.stopReason === 'end_turn' ? null : 'CURSOR_TURN_STOPPED' });
  } catch (cause) {
    await acp?.close();
    await finish({ state: job.state === 'running' ? 'interrupted' : 'failed', ...(text ? { result: { stopReason: null, text } } : {}), error: String(cause.code || 'CURSOR_FAILED').slice(0, 100) });
  } finally {
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    await acp?.close(); await log?.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === ownFile && process.argv[2] === '--worker') {
  const [file, jobFile] = process.argv.slice(3);
  withFileLock(jobFile + '.worker.lock', () => runWorker(file, jobFile)).catch(() => { process.exitCode = 1; });
}
