import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { atomicWrite, encode, hash, withFileLock } from '../shared/io.mjs';
import { canonical } from '../shared/protocol.mjs';
import { verifyCursorCiSource } from './cursor-ci-source.mjs';

const execute = promisify(execFile);
const fail = code => { throw Object.assign(new Error('Assigned CI execution is unavailable'), { code }); };
const only = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => fields.includes(key));
const scopeOf = context => ({ session: context.session, taskId: context.taskId, sourceSha: context.sourceSha, ciTodoRef: context.ciTodoRef,
  references: context.references, commands: context.commands, tester: context.tester });
const cid = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const cleanupScope = scope => ({ ...scope, tester: { ...scope.tester, workerPid: null } });
const environment = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };

// 原任务的一次测试执行账本；不派单、不调用模型、不维护新的任务状态机。
export class CursorCiDockerRunner {
  constructor({ directory, policy, source, context, ciTodo, authorize, command = execute, user, pulse = setInterval } = {}) {
    if (!path.isAbsolute(directory || '') || path.resolve(directory) !== directory || typeof authorize !== 'function' ||
        typeof command !== 'function' || !source || source.manifest?.sourceSha !== context?.sourceSha || !context?.tester?.deliveryId ||
        !Array.isArray(context.commands) || context.tester.workerPid !== process.pid ||
        !only(policy, ['docker', 'socket', 'daemonId', 'imageId', 'imageEnvironment', 'tests', 'timeoutMs', 'outputBytes']) ||
        !path.isAbsolute(policy.docker || '') || !path.isAbsolute(policy.socket || '') ||
        typeof policy.daemonId !== 'string' || !policy.daemonId.trim() || policy.daemonId.length > 128 ||
        !/^sha256:[a-f0-9]{64}$/.test(policy.imageId || '') || !Array.isArray(policy.imageEnvironment) ||
        policy.imageEnvironment.some(value => typeof value !== 'string' || !/^(PATH|NODE_VERSION|YARN_VERSION)=/.test(value)) ||
        !Array.isArray(policy.tests) || !policy.tests.length || policy.tests.length > 20 ||
        policy.tests.some(value => !only(value, ['id', 'todoId', 'commandLabel', 'argv']) || typeof value.id !== 'string' || !value.id || value.id.length > 128 ||
          typeof value.todoId !== 'string' || !value.todoId || value.todoId.length > 128 || !Array.isArray(value.argv) || !value.argv.length || value.argv.length > 64 ||
          !context.commands?.includes(value.commandLabel) ||
          value.argv.some(arg => typeof arg !== 'string' || !arg || arg.length > 4096 || arg.includes('\0'))) ||
        new Set(policy.tests.map(value => value.id)).size !== policy.tests.length ||
        !Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs < 100 || policy.timeoutMs > 300000 ||
        !Number.isSafeInteger(policy.outputBytes) || policy.outputBytes < 1024 || policy.outputBytes > 1024 * 1024) fail('CI_RUNNER_CONFIG_INVALID');
    if (ciTodo?.ref !== context.ciTodoRef || ciTodo.kind !== 'ciTodo' || ciTodo.version !== context.references?.[context.ciTodoRef] ||
        !Array.isArray(ciTodo.content?.items) || !ciTodo.content.items.length ||
        policy.tests.some(test => !ciTodo.content.items.some(item => item.id === test.todoId))) fail('CI_TEST_SCOPE_INVALID');
    user ||= { uid: process.getuid?.(), gid: process.getgid?.() };
    if (![user.uid, user.gid].every(value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647)) fail('CI_RUNNER_USER_INVALID');
    if (!path.isAbsolute(source.snapshot || '') || source.snapshot.includes(',') || directory.includes(',')) fail('CI_RUNNER_CONFIG_INVALID');
    this.directory = directory; this.policy = structuredClone(policy); this.source = source; this.context = structuredClone(context);
    for (const test of this.policy.tests) { Object.freeze(test.argv); Object.freeze(test); }
    Object.freeze(this.policy.tests); Object.freeze(this.policy.imageEnvironment); Object.freeze(this.policy);
    this.scope = canonical(scopeOf(context)); this.policyHash = hash(canonical(this.policy));
    this.authorize = authorize; this.command = command; this.user = user; this.pending = new Map(); this.owned = new Map(); this.closed = false; this.pulse = pulse;
  }
  async check({ ciResult = false } = {}) {
    await this.checkAuthority({ ciResult });
    await this.checkDirectory();
    await verifyCursorCiSource(this.source);
  }
  async checkDirectory() {
    if (await fs.realpath(this.directory) !== this.directory || !(await fs.lstat(this.directory)).isDirectory() ||
        process.platform !== 'win32' && (await fs.stat(this.directory)).mode & 0o077) fail('CI_RUNNER_DIRECTORY_INVALID');
  }
  async checkAuthority(options = {}) {
    const current = await this.authorize(options);
    if (canonical(scopeOf(current)) !== this.scope) fail('CI_TASK_CHANGED');
  }
  async docker(args, timeout = 10000) {
    return this.command(this.policy.docker, ['--host', `unix://${this.policy.socket}`, ...args], {
      env: environment, timeout, maxBuffer: this.policy.outputBytes, windowsHide: true });
  }
  async verifyEnvironment() {
    try {
      const daemon = await this.verifyDaemon();
      const image = JSON.parse((await this.docker(['image', 'inspect', this.policy.imageId, '--format', '{{json .}}'])).stdout);
      if (daemon.ID !== this.policy.daemonId || daemon.OSType !== 'linux' || image.Id !== this.policy.imageId || image.Os !== 'linux' ||
          canonical(image.Config?.Env || []) !== canonical(this.policy.imageEnvironment) ||
          image.Config?.Volumes && Object.keys(image.Config.Volumes).length || image.Config?.Healthcheck ||
          ![['arm64', 'aarch64'], ['amd64', 'x86_64']].some(group => group.includes(image.Architecture) && group.includes(daemon.Architecture))) fail('CI_RUNNER_ENVIRONMENT_CHANGED');
    } catch (cause) { if (cause.code === 'CI_RUNNER_ENVIRONMENT_CHANGED') throw cause; fail('CI_RUNNER_UNAVAILABLE'); }
  }
  async verifyDaemon() {
    const daemon = JSON.parse((await this.docker(['info', '--format', '{{json .}}'])).stdout);
    if (daemon.ID !== this.policy.daemonId || daemon.OSType !== 'linux') fail('CI_RUNNER_ENVIRONMENT_CHANGED');
    return daemon;
  }
  validateRecord(record, key) {
    if (record?.format !== 1 || !only(record.request, ['id', 'testId']) || typeof record.request.id !== 'string' ||
        !record.request.id || record.request.id.length > 128 || hash(record.request.id) !== key ||
        !this.policy.tests.some(test => test.id === record.request.testId) ||
        record.policyHash !== this.policyHash || record.manifestSha256 !== this.source.manifestSha256 ||
        !Number.isSafeInteger(record.scope?.tester?.workerPid) || record.scope.tester.workerPid <= 0 ||
        canonical(cleanupScope(record.scope)) !== canonical(cleanupScope(JSON.parse(this.scope))) ||
        record.fingerprint !== hash(canonical({ scope: canonical(record.scope), source: this.source.manifestSha256,
          policy: this.policyHash, testId: record.request.testId })) ||
        !uuid.test(record.owner || '') || !uuid.test((record.name || '').replace(/^context-guard-ci-/, '')) ||
        !record.name.startsWith('context-guard-ci-') || record.containerId !== undefined && !cid.test(record.containerId) ||
        !['intent', 'created', 'starting', 'executed', 'observed', 'stopping', 'stopped'].includes(record.state)) fail('CI_RUNNER_RECORD_INVALID');
  }
  async readRecord(file) {
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > 8 * 1024 * 1024 ||
          process.platform !== 'win32' && info.mode & 0o077) fail('CI_RUNNER_RECORD_INVALID');
      const record = JSON.parse(await handle.readFile('utf8'));
      this.validateRecord(record, path.basename(file, '.json'));
      return record;
    } finally { await handle.close(); }
  }
  async recoverOwned() {
    await this.checkDirectory();
    const files = (await fs.readdir(this.directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    let unconfirmed = files.length > 20;
    for (const name of files.slice(0, 20)) {
      try { const record = await this.readRecord(path.join(this.directory, name)); this.owned.set(record.name, record); }
      catch { unconfirmed = true; }
    }
    return unconfirmed;
  }
  createArguments(record, test) {
    const { uid, gid } = this.user;
    return ['create', '--name', record.name, '--label', `context-guard.ci-owner=${record.owner}`, '--label', `context-guard.ci-request=${record.fingerprint}`,
      '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--no-healthcheck',
      '--log-driver=none', '--restart=no',
      '--user', `${uid}:${gid}`, '--pids-limit=64', '--memory=256m', '--cpus=1',
      '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777',
      '--tmpfs', `/scratch:rw,nosuid,nodev,size=64m,mode=700,uid=${uid},gid=${gid}`,
      '--mount', `type=bind,src=${this.source.snapshot},dst=/source,readonly,bind-recursive=disabled`,
      '--workdir=/scratch', '--entrypoint=/usr/local/bin/node', this.policy.imageId, ...test.argv];
  }
  async inspect(record) {
    const value = JSON.parse((await this.docker(['inspect', record.containerId || record.name, '--format', '{{json .}}'])).stdout);
    if (!cid.test(value.Id || '') || record.containerId && value.Id !== record.containerId || value.Name !== '/' + record.name ||
        value.Image !== this.policy.imageId || value.Config?.Labels?.['context-guard.ci-owner'] !== record.owner ||
        value.Config?.Labels?.['context-guard.ci-request'] !== record.fingerprint) fail('CI_CONTAINER_OWNERSHIP_CHANGED');
    return value;
  }
  verifyContainer(value, record) {
    const config = value.Config || {}, host = value.HostConfig || {}, test = this.policy.tests.find(test => test.id === record.request.testId);
    const source = (value.Mounts || []).filter(mount => mount.Type === 'bind');
    if (config.User !== `${this.user.uid}:${this.user.gid}` || config.WorkingDir !== '/scratch' || config.Tty !== false ||
        canonical(config.Entrypoint) !== canonical(['/usr/local/bin/node']) || canonical(config.Cmd) !== canonical(test.argv) ||
        canonical(config.Env) !== canonical(this.policy.imageEnvironment) ||
        host.NetworkMode !== 'none' || host.Privileged !== false || host.ReadonlyRootfs !== true ||
        canonical(host.CapDrop) !== canonical(['ALL']) || !host.SecurityOpt?.includes('no-new-privileges') || host.CapAdd?.length ||
        host.PidsLimit !== 64 || host.Memory !== 256 * 1024 * 1024 || host.NanoCpus !== 1000000000 ||
        host.LogConfig?.Type !== 'none' || host.RestartPolicy?.Name !== 'no' || host.Binds?.length ||
        source.length !== 1 || source[0].Source !== this.source.snapshot || source[0].Destination !== '/source' || source[0].RW !== false ||
        (value.Mounts || []).some(mount => !['bind', 'tmpfs'].includes(mount.Type)) ||
        Object.keys(host.Tmpfs || {}).sort().join(',') !== '/scratch,/tmp' ||
        host.Tmpfs['/tmp'] !== '/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777'.split(':')[1] ||
        host.Tmpfs['/scratch'] !== `rw,nosuid,nodev,size=64m,mode=700,uid=${this.user.uid},gid=${this.user.gid}` ||
        Object.keys(value.NetworkSettings?.Networks || {}).some(name => name !== 'none')) fail('CI_CONTAINER_POLICY_CHANGED');
  }
  async stop(record) {
    let value;
    try {
      await this.verifyDaemon(); // 停止只要求可信 daemon 与精确归属；不依赖源码、授权或镜像仍可读取。
      value = await this.inspect(record);
      if (value.State?.Running) {
        await this.docker(['kill', value.Id]).catch(() => {});
        value = await this.inspect(record);
      }
      if (value.State?.Running !== false || !['exited', 'created', 'dead'].includes(value.State.Status)) fail('CI_STOP_UNCONFIRMED');
    } catch (cause) { if (cause.code === 'CI_CONTAINER_OWNERSHIP_CHANGED') throw cause; fail('CI_STOP_UNCONFIRMED'); }
    this.owned.delete(record.name);
    return value;
  }
  async run(input, { signal } = {}) {
    if (this.closed) fail('CI_RUNNER_CLOSED');
    if (!only(input, ['id', 'testId']) || typeof input.id !== 'string' || !input.id || input.id.length > 128 ||
        !this.policy.tests.some(test => test.id === input.testId)) fail('CI_TEST_FORBIDDEN');
    await this.check();
    if (signal?.aborted) fail('CI_TEST_CANCELLED');
    const fingerprint = hash(canonical({ scope: this.scope, source: this.source.manifestSha256, policy: this.policyHash, testId: input.testId }));
    const key = hash(input.id), file = path.join(this.directory, key + '.json');
    if (this.pending.has(key)) {
      const pending = this.pending.get(key);
      if (pending.fingerprint !== fingerprint) fail('ID_REUSED');
      const cancel = () => pending.controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      try { return await pending.work; } finally { signal?.removeEventListener('abort', cancel); }
    }
    const controller = new AbortController(), forward = () => controller.abort();
    signal?.addEventListener('abort', forward, { once: true });
    if (signal?.aborted || this.closed) controller.abort();
    const work = withFileLock(file + '.lock', () => this.perform(input, fingerprint, file, controller.signal));
    this.pending.set(key, { fingerprint, work, controller });
    try { return await work; } finally { signal?.removeEventListener('abort', forward); this.pending.delete(key); }
  }
  async close() {
    this.closed = true;
    const active = [...this.pending.values()];
    for (const entry of active) entry.controller.abort();
    const outcomes = await Promise.allSettled(active.map(entry => entry.work));
    let unconfirmed = false;
    try { unconfirmed = await this.recoverOwned(); } catch { unconfirmed = true; }
    for (const record of [...this.owned.values()]) {
      const file = path.join(this.directory, hash(record.request.id) + '.json');
      try {
        await withFileLock(file + '.lock', async () => {
          // 只恢复原投递的停止责任；旧 worker PID 不授予新实例执行或回报权限。
          const current = await this.readRecord(file);
          if (current.name !== record.name || current.owner !== record.owner) fail('CI_RUNNER_RECORD_INVALID');
          if (!['observed', 'stopped'].includes(current.state)) {
            current.stopIntent ||= { reason: 'CI_TEST_CANCELLED', requestId: current.request.id, containerId: current.containerId || null };
            current.state = 'stopping'; await atomicWrite(file, encode(current));
          }
          const value = await this.stop(current);
          if (current.state === 'stopping') { current.containerId = value.Id; current.state = 'stopped'; await atomicWrite(file, encode(current)); }
        });
      } catch { unconfirmed = true; }
    }
    if (unconfirmed || outcomes.some(value => value.status === 'rejected' && value.reason?.code === 'CI_STOP_UNCONFIRMED')) fail('CI_STOP_UNCONFIRMED');
  }
  async perform(input, fingerprint, file, signal) {
    await this.check(); await this.verifyEnvironment();
    let record;
    try { record = await this.readRecord(file); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; record = null; }
    if (record && record.fingerprint !== fingerprint) fail('ID_REUSED');
    if (record?.observation) {
      const { sha256, ...observed } = record.observation;
      if (sha256 !== hash(canonical(observed)) || observed.requestId !== input.id || observed.testId !== input.testId ||
          observed.sourceSha !== this.context.sourceSha || observed.manifestSha256 !== this.source.manifestSha256 ||
          observed.policyHash !== this.policyHash || !cid.test(observed.containerId || '') || observed.imageId !== this.policy.imageId ||
          observed.status !== 'exited' || !Number.isInteger(observed.exitCode)) fail('CI_TEST_PROOF_INVALID');
      await this.check(); return record.observation;
    }
    const save = async fields => { record = { ...record, ...fields }; await atomicWrite(file, encode(record)); this.owned.set(record.name, record); };
    if (record) this.owned.set(record.name, record);
    if (record?.stopIntent) { await this.stop(record); fail(record.stopIntent.reason); }
    const halt = async reason => {
      await save({ stopIntent: { reason, requestId: input.id, containerId: record.containerId || null }, state: 'stopping' });
      await this.stop(record); await save({ state: 'stopped' }); this.owned.delete(record.name); fail(reason);
    };
    if (!record) {
      record = { format: 1, fingerprint, request: structuredClone(input), scope: JSON.parse(this.scope), policyHash: this.policyHash,
        manifestSha256: this.source.manifestSha256, name: `context-guard-ci-${randomUUID()}`, owner: randomUUID(), state: 'intent' };
      await withFileLock(path.join(this.directory, 'budget.lock'), async () => {
        if ((await fs.readdir(this.directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).length >= 20) fail('CI_TEST_BUDGET_EXCEEDED');
        await save({}); // 写意图在 create 前；不确定结果绝不另建容器。
      });
      try {
        await this.check();
        if (signal?.aborted || this.closed) fail('CI_TEST_CANCELLED');
        const created = (await this.docker(this.createArguments(record, this.policy.tests.find(test => test.id === input.testId)))).stdout.trim();
        if (!cid.test(created)) fail('CI_RUN_UNKNOWN');
        await save({ containerId: created, state: 'created' });
      } catch (cause) { if (['CI_TEST_CANCELLED', 'CI_TEST_BUDGET_EXCEEDED'].includes(cause.code)) { this.owned.delete(record.name); throw cause; } fail('CI_RUN_UNKNOWN'); }
    }
    let value;
    try { value = await this.inspect(record); } catch (cause) { if (cause.code === 'CI_CONTAINER_OWNERSHIP_CHANGED') throw cause; fail('CI_RUN_UNKNOWN'); }
    try { this.verifyContainer(value, record); } catch { return halt('CI_CONTAINER_POLICY_CHANGED'); }
    if (record.state === 'created' && value.State?.Status !== 'created') return halt('CI_RUN_UNKNOWN');
    if (!['created', 'executed'].includes(record.state)) return halt('CI_RUN_UNKNOWN');
    if (record.state === 'created') {
      await this.check();
      if (signal?.aborted || this.closed) return halt('CI_TEST_CANCELLED');
      await save({ state: 'starting' });
      let cancellation, stopWork, monitoring = false, monitorWork, cliError, output;
      const cancel = reason => { cancellation ||= reason; stopWork ||= halt(cancellation); stopWork.catch(() => {}); };
      const externalCancel = () => cancel('CI_TEST_CANCELLED');
      signal?.addEventListener('abort', externalCancel, { once: true });
      const pulse = this.pulse(() => { if (monitoring || cancellation) return; monitoring = true;
        monitorWork = this.checkAuthority().catch(() => cancel('CI_AUTHORIZATION_REJECTED')).finally(() => { monitoring = false; }); }, 1000);
      pulse?.unref?.();
      const deadline = setTimeout(() => cancel('CI_TEST_TIMEOUT'), this.policy.timeoutMs); deadline.unref?.();
      try {
        if (signal?.aborted) externalCancel();
        if (!cancellation) output = await this.docker(['start', '--attach', value.Id], this.policy.timeoutMs);
      } catch (cause) { cliError = cause; output = { stdout: cause.stdout || '', stderr: cause.stderr || '' }; }
      finally { clearTimeout(deadline); clearInterval(pulse); signal?.removeEventListener('abort', externalCancel); await monitorWork; }
      if (stopWork) return stopWork;
      if (cliError?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return halt('CI_TEST_OUTPUT_LIMIT');
      if (cliError?.killed || cliError?.signal) return halt('CI_TEST_TIMEOUT');
      value = await this.inspect(record);
      if (value.State?.Running !== false || value.State.Status !== 'exited' || !Number.isInteger(value.State.ExitCode) ||
          cliError && (!Number.isInteger(cliError.code) || cliError.code !== value.State.ExitCode)) return halt('CI_RUN_UNKNOWN');
      if (!output || Buffer.byteLength(output.stdout || '') + Buffer.byteLength(output.stderr || '') > this.policy.outputBytes) return halt('CI_TEST_OUTPUT_LIMIT');
      await save({ state: 'executed', output: { stdout: output.stdout || '', stderr: output.stderr || '' }, exitCode: value.State.ExitCode });
    }
    value = await this.inspect(record);
    this.verifyContainer(value, record);
    if (value.State?.Running !== false || value.State.Status !== 'exited' || !Number.isInteger(value.State.ExitCode)) fail('CI_RUN_UNKNOWN');
    await this.check();
    const observation = { requestId: input.id, testId: input.testId, sourceSha: this.context.sourceSha, manifestSha256: this.source.manifestSha256,
      policyHash: this.policyHash, containerId: value.Id, imageId: value.Image, exitCode: value.State.ExitCode,
      stdout: record.output.stdout, stderr: record.output.stderr, status: 'exited' };
    observation.sha256 = hash(canonical(observation));
    await save({ state: 'observed', observation });
    this.owned.delete(record.name);
    return observation; // 实际退出是观察，不是 CI verdict 或人工验收。
  }
}
