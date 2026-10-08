import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const error = (code, message) => Object.assign(new Error(message), { code });
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

// Cursor owns the model loop, tools and conversation history. This module only
// implements its official stdio ACP client; it is not a second agent harness.
export class CursorAcp {
  constructor({ command, cwd, env, args = [], timeoutMs = 60000, outputLimitBytes = 4 * 1024 * 1024,
    onUpdate = () => {}, requestPermission, requestInteraction } = {}) {
    if (!path.isAbsolute(command || '') || !path.isAbsolute(cwd || '') ||
        !Array.isArray(args) || args.some(arg => typeof arg !== 'string') ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
        !Number.isSafeInteger(outputLimitBytes) || outputLimitBytes <= 0) {
      throw error('INVALID_RUNTIME', 'Cursor ACP requires absolute command/cwd and bounded transport settings');
    }
    this.timeoutMs = timeoutMs;
    this.cwd = cwd;
    this.outputLimitBytes = outputLimitBytes;
    this.onUpdate = onUpdate;
    this.requestPermission = requestPermission;
    this.requestInteraction = requestInteraction;
    this.pending = new Map();
    this.nextId = 1;
    this.updates = Promise.resolve();
    this.child = spawn(command, [...args, 'acp'], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.closed = new Promise(resolve => { this.resolveClosed = resolve; });
    this.child.once('error', () => this.fail(error('CURSOR_START_FAILED', 'Cursor process could not start')));
    this.child.once('close', () => {
      this.fail(error('CURSOR_DISCONNECTED', 'Cursor process exited before its response'));
      this.resolveClosed();
    });
    this.child.stdin.on('error', () => this.fail(error('CURSOR_DISCONNECTED', 'Cursor input stream closed')));
    // Drain diagnostics but never expose raw logs/credentials in an API error.
    this.child.stderr.resume();
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    this.child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > this.outputLimitBytes) {
          this.fail(error('CURSOR_OUTPUT_LIMIT', 'Cursor ACP frame exceeds the configured limit')); return;
        }
        if (!line.trim()) continue;
        try { this.receive(JSON.parse(line)); }
        catch { this.fail(error('CURSOR_PROTOCOL_ERROR', 'Invalid Cursor ACP frame')); return; }
      }
      if (Buffer.byteLength(buffer) > this.outputLimitBytes) this.fail(error('CURSOR_OUTPUT_LIMIT', 'Cursor ACP frame exceeds the configured limit'));
    });
  }

  fail(reason) {
    if (this.failure) return;
    this.failure = reason;
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(reason); }
    this.pending.clear();
    // Only this instance's child is stopped. Never target an arbitrary PID.
    void this.close();
  }

  write(message) {
    if (this.failure) throw this.failure;
    if (this.stopping) throw error('CURSOR_DISCONNECTED', 'Cursor transport is closing');
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  }

  request(method, params, timeoutMs = this.timeoutMs) {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(error('CURSOR_TIMEOUT', 'Cursor ACP request timed out')), timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (cause) { clearTimeout(timer); this.pending.delete(id); reject(cause); }
    });
  }

  receive(message) {
    if (message?.jsonrpc !== '2.0' || typeof message !== 'object') throw error('CURSOR_PROTOCOL_ERROR', 'Invalid envelope');
    if (typeof message.method !== 'string') {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      if (Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error')) throw error('CURSOR_PROTOCOL_ERROR', 'Invalid response');
      this.pending.delete(message.id); clearTimeout(waiter.timer);
      if (message.error) waiter.reject(error('CURSOR_RPC_ERROR', `Cursor rejected request (${Number(message.error.code) || 0})`));
      else waiter.resolve(message.result);
      return;
    }
    if (message.params?.sessionId && message.params.sessionId !== this.sessionId) {
      this.fail(error('CURSOR_SESSION_MISMATCH', 'Cursor update targets another Session')); return;
    }
    if (message.method === 'session/update') {
      this.updates = this.updates.then(() => this.onUpdate(message.params)).catch(() => this.fail(error('CURSOR_UPDATE_FAILED', 'Cursor update could not be recorded')));
      return;
    }
    if (!Object.hasOwn(message, 'id')) return;
    void this.answer(message).catch(() => this.fail(error('CURSOR_CALLBACK_FAILED', 'Cursor client callback failed')));
  }

  async answer(message) {
    let result;
    if (message.method === 'session/request_permission') {
      const decision = await this.requestPermission?.(message.params);
      const option = message.params?.options?.find(item => item.optionId === decision);
      result = { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } };
    } else if (['cursor/ask_question', 'cursor/create_plan'].includes(message.method)) {
      result = await this.requestInteraction?.(message.method, message.params) || { outcome: { outcome: 'cancelled' } };
    } else {
      this.write({ id: message.id, error: { code: -32601, message: 'Unsupported client method' } }); return;
    }
    if (!this.failure && !this.stopping) this.write({ id: message.id, result });
  }

  async connect({ sessionId } = {}) {
    if (this.initialized) throw error('CURSOR_ALREADY_CONNECTED', 'This transport already has a Session');
    const init = await this.request('initialize', { protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'context-guard', version: '0.8.0' } });
    if (init?.protocolVersion !== 1) throw error('CURSOR_PROTOCOL_VERSION', 'Unsupported Cursor ACP protocol version');
    if (sessionId && (!validId(sessionId) || init.agentCapabilities?.loadSession !== true)) throw error('CURSOR_RESUME_UNSUPPORTED', 'Cursor cannot load the requested Session');
    await this.request('authenticate', { methodId: 'cursor_login' });
    if (sessionId) this.sessionId = sessionId; // load may emit transcript updates before its response.
    const result = await this.request(sessionId ? 'session/load' : 'session/new', { cwd: this.cwd, mcpServers: [], ...(sessionId ? { sessionId } : {}) });
    if (!sessionId && !validId(result?.sessionId)) throw error('CURSOR_INVALID_SESSION', 'Cursor did not return a native Session ID');
    this.sessionId = sessionId || result.sessionId;
    this.initialized = true;
    return { sessionId: this.sessionId, capabilities: init.agentCapabilities };
  }

  async prompt(text, { timeoutMs = 1800000 } = {}) {
    if (!this.initialized) throw error('CURSOR_NOT_CONNECTED', 'Connect Cursor before sending a prompt');
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 65536 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw error('INVALID_PROMPT', 'Use a nonempty bounded prompt and timeout');
    if (this.busy) throw error('RUNTIME_BUSY', 'Cursor already has an active turn');
    this.busy = true;
    try {
      const result = await this.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text }] }, timeoutMs);
      await this.updates;
      if (this.failure) throw this.failure;
      if (typeof result?.stopReason !== 'string') throw error('CURSOR_PROTOCOL_ERROR', 'Cursor response lacks a stop reason');
      return result; // A native turn ending is not proof that a business task passed.
    } finally { this.busy = false; }
  }

  cancel() {
    if (!this.initialized) throw error('CURSOR_NOT_CONNECTED', 'Connect Cursor before cancelling');
    this.write({ method: 'session/cancel', params: { sessionId: this.sessionId } });
  }

  close() {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      if (this.child.exitCode === null && this.child.signalCode === null) {
        this.child.stdin.end(); this.child.kill('SIGTERM');
        const timer = setTimeout(() => this.child.kill('SIGKILL'), 5000);
        try { await this.closed; } finally { clearTimeout(timer); }
      } else await this.closed;
    })();
    return this.stopping;
  }
}
