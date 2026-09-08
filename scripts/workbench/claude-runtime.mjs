import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { StringDecoder } from 'node:string_decoder';
import { atomicWrite, encode, hash, readJSON, withFileLock } from '../shared/io.mjs';
import { canonical } from '../shared/protocol.mjs';

const ownFile = fileURLToPath(import.meta.url);
const exec = promisify(execFile);
const git = async (root, ...args) => (await exec('git', args, { cwd: root, windowsHide: true })).stdout.trim();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const alive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const providerKeys = new Set(['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_ATTRIBUTION_HEADER']);
function verifyRecovery(active, deliveryId) {
  if (!deliveryId || active?.id !== deliveryId || active.state !== 'interrupted') fail('RECOVERY_NOT_AVAILABLE', 'Recovery does not match the active interrupted delivery');
  if (alive(active.workerPid) || alive(active.childPid)) fail('RUNTIME_BUSY', 'The previous native process has not exited');
}

export function claudeArguments(config, { sessionId, resume }) {
  if (!uuid.test(sessionId)) fail('INVALID_SESSION', 'Claude requires a real Session UUID');
  return [...(config.args || []), '-p', resume ? '--resume' : '--session-id', sessionId,
    '--name', config.name, '--output-format', 'stream-json', '--verbose', '--include-hook-events',
    '--strict-mcp-config', '--model', config.model,
    ...(config.systemPromptFile ? ['--append-system-prompt-file', config.systemPromptFile] : []),
    ...(config.permissionMode === 'bypassPermissions' ? ['--dangerously-skip-permissions'] : []),
    ...(config.tools ? ['--tools', config.tools] : [])];
}

// This is an invocation adapter, not a second task queue. Cloud retains FIFO.
// A busy native turn rejects the next delivery for the existing inbox to retry.
export class ClaudeRuntime {
  constructor(directory) { this.directory = directory; }
  sessionFile(sessionId) {
    if (!uuid.test(sessionId)) fail('INVALID_SESSION', 'Claude requires a real Session UUID');
    return path.join(this.directory, sessionId, 'session.json');
  }
  jobFile(sessionId, deliveryId) { return path.join(path.dirname(this.sessionFile(sessionId)), 'deliveries', `${hash(deliveryId)}.json`); }
  async configure(sessionId, config) {
    if (!path.isAbsolute(config.command || '') || !path.isAbsolute(config.root || '') || !path.isAbsolute(config.configDir || '') || !path.isAbsolute(config.environmentFile || '')) fail('INVALID_RUNTIME', 'Claude runtime requires absolute local configuration paths');
    if (!config.name || !config.model || !['executor', 'ci'].includes(config.role)) fail('INVALID_RUNTIME', 'Claude name, model and role are required');
    if (config.role === 'ci' && (!uuid.test(config.executorSessionId || '') || config.executorSessionId === sessionId ||
        !Array.isArray(config.ciCommands) || !config.ciCommands.length || config.ciCommands.some(command => typeof command !== 'string' || !command.trim()))) fail('INVALID_RUNTIME', 'CI requires an explicit developer Session and allowed test commands');
    if (config.args && (!Array.isArray(config.args) || config.args.some(arg => typeof arg !== 'string'))) fail('INVALID_RUNTIME', 'Claude runtime arguments must be strings');
    if (config.permissionMode === 'bypassPermissions' && config.isolated !== true) fail('INVALID_RUNTIME', 'Permission bypass requires an explicitly isolated runtime');
    const file = this.sessionFile(sessionId);
    await withFileLock(file + '.lock', async () => {
      const state = await readJSON(file, {});
      if (state.active) fail('RUNTIME_BUSY', 'Stop the native turn before changing its configuration');
      await atomicWrite(file, encode({ ...state, initialized: state.initialized || config.resumeExisting === true, config: { ...config, rootAlias: config.root, root: await fs.realpath(config.root) }, sessionId }));
    });
    return { configured: true, sessionId, role: config.role };
  }
  async status(sessionId) {
    const state = await readJSON(this.sessionFile(sessionId), null);
    if (!state) return { configured: false };
    const job = state.active ? await readJSON(state.active, null) : null;
    return { configured: true, name: state.config.name, role: state.config.role,
      status: job && ['starting', 'dispatching', 'running', 'interrupted'].includes(job.state) ? alive(job.workerPid) ? 'active' : 'unknown' : 'stopped',
      at: job?.updatedAt || state.updatedAt || '', deliveryId: job?.id || null,
      error: job?.error || null };
  }
  async provision(request, { baseRef }) {
    if (!request || !uuid.test(request.sessionId || '') || !uuid.test(request.templateSessionId || '') ||
        request.sessionId === request.templateSessionId || typeof request.id !== 'string' || !/^[a-f0-9]{64}$/.test(request.id) ||
        typeof request.name !== 'string' || !request.name.trim() || request.name.length > 200) fail('INVALID_CREATION', 'Use the bounded Cloud creation request');
    const directory = path.dirname(this.sessionFile(request.sessionId));
    const receiptFile = path.join(directory, 'creation.json');
    return withFileLock(receiptFile + '.lock', async () => {
      const fingerprint = hash(canonical({ id: request.id, sessionId: request.sessionId, templateSessionId: request.templateSessionId, name: request.name }));
      let receipt = await readJSON(receiptFile, null);
      if (receipt && receipt.fingerprint !== fingerprint) fail('ID_REUSED', 'Native creation identity differs');
      const template = await readJSON(this.sessionFile(request.templateSessionId), null);
      if (template?.config.role !== 'executor' || template.config.allowSessionCreation !== true) fail('CREATION_NOT_ENABLED', 'The local operator must enable this developer template');
      if (!receipt) {
        if (typeof baseRef !== 'string' || !baseRef.startsWith('refs/')) fail('MAIN_REQUIRED', 'Use the registered project Main ref');
        const sha = await git(template.config.root, 'rev-parse', '--verify', `${baseRef}^{commit}`);
        receipt = { fingerprint, templateSessionId: request.templateSessionId, root: path.join(directory, 'worktree'), configDir: path.join(directory, 'profile'), sha, branch: `claude/session-${request.sessionId}` };
        await atomicWrite(receiptFile, encode(receipt));
      }
      const root = receipt.root;
      if (await fs.stat(root).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; })) {
        if (await fs.realpath(await git(root, 'rev-parse', '--show-toplevel')) !== await fs.realpath(root) ||
            await git(root, 'branch', '--show-current') !== receipt.branch ||
            await fs.realpath(await git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir')) !== await fs.realpath(await git(template.config.root, 'rev-parse', '--path-format=absolute', '--git-common-dir'))) fail('WORKTREE_MISMATCH', 'Preserve the existing creation directory');
      } else {
        await git(template.config.root, 'worktree', 'add', '-b', receipt.branch, root, receipt.sha);
      }
      const existing = await readJSON(this.sessionFile(request.sessionId), null);
      if (!existing) {
        // Copy only the installed Skill and reviewed settings, never transcripts,
        // global configuration, or another Session's memory.
        const source = template.config.configDir, target = receipt.configDir;
        const settings = await readJSON(path.join(source, 'settings.json'), null);
        if (!settings) fail('SETTINGS_REQUIRED', 'Template needs installed Claude settings and hooks');
        const roots = new RegExp([...new Set([source, template.config.root, template.config.rootAlias || template.config.root])].sort((a, b) => b.length - a.length)
          .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
        const relocate = value => {
          if (typeof value === 'string') return value.replace(roots, match => match === source ? target : root);
          if (Array.isArray(value)) return value.map(relocate);
          if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, relocate(child)]));
          return value;
        };
        await fs.mkdir(path.join(target, 'skills'), { recursive: true, mode: 0o700 });
        await fs.cp(path.join(source, 'skills', 'context-guard'), path.join(target, 'skills', 'context-guard'), { recursive: true });
        await atomicWrite(path.join(target, 'settings.json'), encode(relocate(settings)));
        await this.configure(request.sessionId, { ...template.config, root, configDir: target,
          systemPromptFile: template.config.systemPromptFile ? relocate(template.config.systemPromptFile) : undefined,
          name: request.name.trim(), resumeExisting: false, allowSessionCreation: false });
      }
      const prior = await readJSON(this.jobFile(request.sessionId, `create:${request.id}`), null);
      if (prior && ['failed', 'interrupted'].includes(prior.state)) fail('NATIVE_START_FAILED', 'The saved native startup did not complete; preserve its evidence');
      const delivery = await this.deliver({ id: `create:${request.id}`, sessionId: request.sessionId, root, platform: 'claude',
        message: '这是人类请求创建的独立开发会话。读取已安装的 Context Guard Skill，让原生启动 Hook 完成会话绑定，然后只回复“会话已准备”。没有分配开发任务，不要修改业务文件、创建 Plan 或声明任务完成。' });
      return { sessionId: request.sessionId, root, state: 'starting', deliveryId: delivery.deliveryId };
    });
  }
  async ciReceiver(executorSessionId) {
    const creation = await readJSON(path.join(path.dirname(this.sessionFile(executorSessionId)), 'creation.json'), null);
    const candidates = [];
    for (const name of await fs.readdir(this.directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
      if (!uuid.test(name)) continue;
      const state = await readJSON(this.sessionFile(name), null);
      if (state?.config.role === 'ci' && [executorSessionId, creation?.templateSessionId].includes(state.config.executorSessionId)) candidates.push({ sessionId: name, root: state.config.root });
    }
    if (candidates.length !== 1) fail('CI_RECEIVER_REQUIRED', 'Configure exactly one independent CI receiver for this developer Session');
    return candidates[0];
  }
  async acceptsCiExecutor(config, sessionId) {
    if (!uuid.test(sessionId || '')) return false;
    if (sessionId === config.executorSessionId) return true;
    const creation = await readJSON(path.join(path.dirname(this.sessionFile(sessionId)), 'creation.json'), null);
    const executor = await readJSON(this.sessionFile(sessionId), null);
    return creation?.templateSessionId === config.executorSessionId && executor?.config.role === 'executor' &&
      executor.config.root === await fs.realpath(creation.root);
  }
  async ciContext(sessionId, { verifySource = false } = {}) {
    const state = await readJSON(this.sessionFile(sessionId), null);
    if (state?.config.role !== 'ci') return null;
    const job = state.active && await readJSON(state.active, null);
    if (!job?.execution || ['finished', 'failed', 'interrupted'].includes(job.state) || !await this.acceptsCiExecutor(state.config, job.execution.session.id)) fail('CI_NOT_ACTIVE', 'No assigned CI task is active');
    if (verifySource && (await git(state.config.root, 'rev-parse', 'HEAD') !== job.execution.sourceSha || await git(state.config.root, 'status', '--porcelain'))) fail('CI_SOURCE_CHANGED', 'CI result requires the unchanged assigned code SHA');
    return { ...job.execution, mode: 'ci', commands: state.config.ciCommands };
  }
  async recover(sessionId, input, root) {
    if (!input || Object.keys(input).some(key => !['operationId', 'deliveryId', 'message'].includes(key)) ||
        typeof input.operationId !== 'string' || !input.operationId.trim() || input.operationId.length > 128 ||
        typeof input.deliveryId !== 'string' || !input.deliveryId || input.deliveryId.length > 256 ||
        typeof input.message !== 'string' || !input.message.trim() || input.message.length > 4000) fail('INVALID_RECOVERY', 'Recovery requires an operationId, exact interrupted deliveryId and continuation message');
    const state = await readJSON(this.sessionFile(sessionId), null);
    if (!state || await fs.realpath(root) !== state.config.root) fail('WORKTREE_MISMATCH', 'Recover only the configured worktree');
    const previous = await readJSON(this.jobFile(sessionId, input.deliveryId), null);
    if (!previous || previous.state !== 'interrupted') fail('RECOVERY_NOT_AVAILABLE', 'The specified delivery is not interrupted');
    return this.deliver({ id: `recovery:${input.operationId}`, sessionId, root: state.config.root, platform: 'claude',
      recoverDeliveryId: input.deliveryId,
      message: `Context Guard：本地操作者明确要求恢复当前会话。先核对原任务、审核与已有文件/回执，不重复已完成的操作；这不是新任务或新的开发授权。\n${input.message}`,
      ...(previous.execution ? { execution: previous.execution } : {}) });
  }
  async deliver(input) {
    const file = this.sessionFile(input.sessionId), jobFile = this.jobFile(input.sessionId, input.id);
    const fingerprint = hash(canonical(input));
    await withFileLock(file + '.lock', async () => {
      const previous = await readJSON(jobFile, null);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail('ID_REUSED', 'Claude delivery identity differs');
        if (previous.state === 'starting') {
          const state = await readJSON(file);
          if (state.active && state.active !== jobFile) {
            if (!input.recoverDeliveryId) fail('RUNTIME_BUSY', 'Another native turn owns this Session');
            verifyRecovery(await readJSON(state.active, null), input.recoverDeliveryId);
          }
          await atomicWrite(file, encode({ ...state, active: jobFile }));
        }
        return; // The saved invocation is never automatically executed twice.
      }
      const state = await readJSON(file, null);
      if (!state) fail('RUNTIME_NOT_CONFIGURED', 'Register this Claude runtime before delivery');
      if (await fs.realpath(input.root) !== state.config.root) fail('WORKTREE_MISMATCH', 'Claude delivery targets a different worktree');
      if (state.active) {
        const active = await readJSON(state.active, null);
        if (input.recoverDeliveryId) {
          verifyRecovery(active, input.recoverDeliveryId);
        } else if (!active || !['finished', 'failed'].includes(active.state)) fail('RUNTIME_BUSY', 'Claude turn is active or interrupted; retain the Cloud delivery for retry');
      } else if (input.recoverDeliveryId) {
        fail('RECOVERY_NOT_AVAILABLE', 'There is no active interrupted delivery to recover');
      }
      if (state.config.role === 'ci') {
        if (!await this.acceptsCiExecutor(state.config, input.execution?.session?.id) || !/^[a-f0-9]{40}$/.test(input.execution?.sourceSha || '')) fail('CI_ASSIGNMENT_MISMATCH', 'CI requires a verified developer handoff');
        if (await git(state.config.root, 'status', '--porcelain')) fail('CI_SOURCE_CHANGED', 'Preserve dirty CI files before changing the assigned SHA');
        await git(state.config.root, 'checkout', '--detach', input.execution.sourceSha);
      }
      const job = { id: input.id, fingerprint, sessionId: input.sessionId, message: input.message,
        ...(input.execution ? { execution: input.execution } : {}),
        ...(input.recoverDeliveryId ? { recoveredDeliveryId: input.recoverDeliveryId } : {}),
        state: 'starting', resume: Boolean(state.initialized || input.recoverDeliveryId), updatedAt: new Date().toISOString() };
      await atomicWrite(jobFile, encode(job));
      await atomicWrite(file, encode({ ...state, active: jobFile }));
    });
    await this.wake(input.sessionId, jobFile);
    // Persisted intent is already accepted locally, even if the server restarts.
    return { deliveryId: input.id, state: 'received', sessionId: input.sessionId };
  }
  async received(input) {
    const job = await readJSON(this.jobFile(input.sessionId, input.id), null);
    if (!job || job.fingerprint !== hash(canonical(input))) return false;
    await this.deliver(input);
    return true;
  }
  async wake(sessionId, jobFile) {
    const job = await readJSON(jobFile);
    if (job.state !== 'starting') return;
    const worker = spawn(process.execPath, [ownFile, '--worker', this.sessionFile(sessionId), jobFile], {
      detached: true, windowsHide: true, stdio: 'ignore',
    });
    await new Promise((resolve, reject) => { worker.once('spawn', resolve); worker.once('error', reject); });
    worker.unref();
  }
}

async function runWorker(file, jobFile) {
  const session = await readJSON(file), config = session.config;
  const job = await readJSON(jobFile);
  if (job.state !== 'starting') return;
  const update = async fields => {
    Object.assign(job, fields, { updatedAt: new Date().toISOString() });
    await atomicWrite(jobFile, encode(job));
  };
  // Written before spawning Claude. A crash after this point is uncertain, not
  // permission to submit the same prompt again.
  await update({ workerPid: process.pid, state: 'dispatching' });
  let child, timedOut = false;
  try {
    const credentials = await readJSON(config.environmentFile);
    if (Object.keys(credentials).some(key => !providerKeys.has(key)) || Object.values(credentials).some(value => typeof value !== 'string')) fail('INVALID_ENVIRONMENT', 'Only provider settings are accepted in the private environment file');
    const keep = ['PATH', 'SYSTEMROOT', 'SystemRoot', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HOME', 'CONTEXT_GUARD_NAMED_STATE_DIR'];
    const env = { ...Object.fromEntries(keep.filter(key => process.env[key]).map(key => [key, process.env[key]])), ...credentials,
      CLAUDE_CONFIG_DIR: config.configDir, CLAUDE_HOME: config.configDir, CONTEXT_GUARD_HEADLESS: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', PYTHONDONTWRITEBYTECODE: '1' };
    child = spawn(config.command, claudeArguments(config, { sessionId: session.sessionId, resume: job.resume }), {
      cwd: config.root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const exit = new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
    exit.catch(() => {}); // A spawn failure may precede opening the private log.
    let buffer = '', bytes = 0, result = null, initialized = false;
    const decoder = new StringDecoder('utf8');
    const output = await fs.open(jobFile + '.jsonl', 'a', 0o600);
    let writes = Promise.resolve();
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, config.timeoutMs || 600000);
    const killTimer = setTimeout(() => child.kill('SIGKILL'), (config.timeoutMs || 600000) + 5000);
    const interrupted = () => { timedOut = true; child.kill('SIGTERM'); };
    process.once('SIGTERM', interrupted); process.once('SIGINT', interrupted);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) { timedOut = true; child.kill('SIGTERM'); return; }
      writes = writes.then(() => output.write(chunk));
      buffer += decoder.write(chunk);
      for (;;) {
        const index = buffer.indexOf('\n'); if (index < 0) break;
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try {
          const event = JSON.parse(line);
          if (event.session_id && event.session_id !== session.sessionId) { timedOut = true; child.kill('SIGTERM'); break; }
          if (event.type === 'system' && event.subtype === 'init') initialized = true;
          if (event.type === 'result') result = event;
        } catch { /* Native diagnostic text is not a protocol receipt. */ }
      }
    });
    child.stderr.resume(); // Do not publish provider stderr or credentials.
    child.stdin.on('error', () => {});
    child.stdin.end(job.message);
    try {
      await update({ state: 'running', childPid: child.pid });
      const code = await exit;
      await writes; await output.sync();
      await update({ state: timedOut || !result ? 'interrupted' : code === 0 && !result.is_error ? 'finished' : 'failed',
        error: timedOut ? 'CLAUDE_TIMEOUT_OR_INTERRUPTED' : !result ? 'CLAUDE_NO_RESULT' : result.is_error ? 'CLAUDE_FAILED' : null });
      await withFileLock(file + '.lock', async () => {
        const latest = await readJSON(file);
        await atomicWrite(file, encode({ ...latest, initialized: latest.initialized || initialized,
          ...(['finished', 'failed'].includes(job.state) ? { active: null } : {}), updatedAt: job.updatedAt }));
      });
    } finally { clearTimeout(timer); clearTimeout(killTimer); await output.close(); }
  } catch (error) { await update({ state: 'interrupted', error: String(error.code || 'CLAUDE_LAUNCH_FAILED').slice(0, 100) }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === ownFile && process.argv[2] === '--worker') {
  const [file, jobFile] = process.argv.slice(3);
  withFileLock(jobFile + '.worker.lock', () => runWorker(file, jobFile)).catch(() => { process.exitCode = 1; });
}
