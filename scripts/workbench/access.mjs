import fs from 'node:fs/promises';
import { watchFile, unwatchFile } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MapError } from '../../prototype/map-model.mjs';
import { atomicWrite, encode, readJSON } from './io.mjs';
const execFileAsync = promisify(execFile);
export const token = () => randomBytes(32).toString('base64url');

function taskEvent(line) {
  try {
    const event = JSON.parse(line);
    const type = event?.type === 'event_msg' ? event.payload?.type : null;
    if (!['task_started', 'task_complete'].includes(type)) return null;
    return { status: type === 'task_started' ? 'active' : 'stopped', lastEvent: type, lastSeen: event.timestamp || '' };
  } catch { return null; }
}

export function rolloutTaskStatus(text, initial = { status: 'stopped', lastEvent: 'unknown', lastSeen: '' }) {
  let state = { ...initial };
  for (const line of text.split('\n')) {
    const event = taskEvent(line);
    if (event) state = event;
  }
  return state;
}

function isoTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  if (typeof value === 'string' && value) return value;
  return new Date(0).toISOString();
}

export class Access {
  constructor(root, options = {}) {
    this.root = root;
    this.ctx = path.join(root, '.codex/context');
    this.file = options.file || path.join(this.ctx, 'sessions/workbench-access.json');
    this.bindingsFile = options.bindingsFile || path.join(this.ctx, 'sessions/workbench-bindings.json');
    this.sessionsFile = path.join(this.ctx, 'sessions.jsonl');
    this.codexHome = options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    this.codexDb = options.codexDb || null;
    this.sqliteCommand = options.sqliteCommand || 'sqlite3';
    this.codexSessions = options.codexSessions || null;
    this.rolloutStates = new Map();
    this.queue = Promise.resolve();
  }
  async init() {
    this.data = await readJSON(this.file, { sessions: {} });
    this.bindings = await readJSON(this.bindingsFile, { sessions: {} });
    return this;
  }
  binding(sessionId) { return this.bindings.sessions[sessionId] || null; }
  bindingRoots() { return [...new Set([this.root, ...Object.values(this.bindings.sessions).map(item => item?.worktreeRoot).filter(Boolean)])]; }
  async hookSessionRegistry(root = this.root) {
    const sessionsFile = path.join(root, '.codex/context/sessions.jsonl');
    const text = await fs.readFile(sessionsFile, 'utf8').catch(e => e.code === 'ENOENT' ? '' : Promise.reject(e));
    const sessions = new Map();
    for (const line of text.split('\n').filter(Boolean)) {
      try {
        const event = JSON.parse(line);
        const id = typeof event.session_id === 'string' ? event.session_id.trim() : '';
        if (!id || event.event === 'maintenance' || id.startsWith('maintenance-')) continue;
        const at = typeof event.at === 'string' && event.at ? event.at : new Date(0).toISOString();
        const previous = sessions.get(id);
        const stopped = ['stop', 'subagent-stop'].includes(event.event);
        const activated = ['session-start', 'subagent-start', 'user-prompt-submit'].includes(event.event);
        sessions.set(id, {
          id,
          name: typeof event.thread_name === 'string' && event.thread_name.trim() ? event.thread_name.trim() : previous?.name || '',
          platform: typeof event.platform === 'string' && event.platform ? event.platform : previous?.platform || 'unknown',
          status: stopped ? 'stopped' : activated ? 'active' : previous?.status || 'active',
          firstSeen: previous?.firstSeen || at,
          lastSeen: at,
          lastEvent: typeof event.event === 'string' ? event.event : previous?.lastEvent || 'unknown',
          worktreeRoot: root,
        });
      } catch {}
    }
    return [...sessions.values()];
  }
  async stateDatabase() {
    if (this.codexDb) return this.codexDb;
    const files = await fs.readdir(this.codexHome, { withFileTypes: true }).catch(() => []);
    const candidates = await Promise.all(files
      .filter(item => item.isFile() && /^state(?:_\d+)?\.sqlite$/.test(item.name))
      .map(async item => {
        const file = path.join(this.codexHome, item.name);
        return { file, mtime: (await fs.stat(file).catch(() => ({ mtimeMs: 0 }))).mtimeMs };
      }));
    candidates.sort((a, b) => b.mtime - a.mtime);
    if (candidates[0]) this.codexDb = candidates[0].file;
    return this.codexDb;
  }
  async readRange(file, start, length) {
    if (length <= 0) return '';
    const handle = await fs.open(file, 'r');
    try {
      const buffer = Buffer.allocUnsafe(length);
      let offset = 0;
      while (offset < length) {
        const { bytesRead } = await handle.read(buffer, offset, length - offset, start + offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      return buffer.subarray(0, offset).toString('utf8');
    } finally { await handle.close(); }
  }
  async initialRolloutState(file, size) {
    const block = 256 * 1024;
    let end = size, suffix = '';
    while (end > 0) {
      const start = Math.max(0, end - block);
      const text = await this.readRange(file, start, end - start) + suffix;
      const lines = text.split('\n');
      suffix = start > 0 ? lines.shift() : '';
      for (let i = lines.length - 1; i >= 0; i--) {
        const event = taskEvent(lines[i]);
        if (event) return event;
      }
      end = start;
    }
    return { status: 'stopped', lastEvent: 'unknown', lastSeen: '' };
  }
  async rolloutState(file) {
    if (!file) return { status: 'stopped', lastEvent: 'unknown', lastSeen: '' };
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) return { status: 'stopped', lastEvent: 'unknown', lastSeen: '' };
    const previous = this.rolloutStates.get(file);
    if (previous && stat.size === previous.size) return previous;
    let state;
    if (previous && stat.size > previous.size) {
      const appended = await this.readRange(file, previous.size, stat.size - previous.size);
      state = rolloutTaskStatus(appended, previous);
    } else state = await this.initialRolloutState(file, stat.size);
    const next = { ...state, size: stat.size };
    this.rolloutStates.set(file, next);
    return next;
  }
  async discoverCodexSessions(roots = [this.root]) {
    if (this.codexSessions) {
      const batches = await Promise.all(roots.map(root => this.codexSessions(root)));
      return batches.flat();
    }
    const database = await this.stateDatabase();
    if (!database) return [];
    const escaped = roots.map(root => `'${root.replaceAll("'", "''")}'`).join(',');
    const sql = `select id, name, title, cwd, created_at, updated_at, rollout_path from threads where cwd in (${escaped}) and thread_source='user' and archived=0 order by updated_at desc limit 100`;
    try {
      const { stdout } = await execFileAsync(this.sqliteCommand, ['-readonly', '-json', database, sql], { encoding: 'utf8', timeout: 1500, maxBuffer: 4 * 1024 * 1024 });
      const rows = stdout.trim() ? JSON.parse(stdout) : [];
      return await Promise.all(rows.map(async row => {
        const state = await this.rolloutState(row.rollout_path);
        return {
          id: String(row.id),
          name: String(row.name || row.title || '').trim(),
          platform: 'codex',
          status: state.status,
          firstSeen: isoTime(row.created_at),
          lastSeen: [isoTime(row.updated_at), state.lastSeen].filter(Boolean).sort().at(-1),
          lastEvent: state.lastEvent,
          worktreeRoot: String(row.cwd || ''),
        };
      }));
    } catch { return []; }
  }
  async sessionRegistry() {
    const roots = this.bindingRoots();
    const [hookBatches, codexSessions] = await Promise.all([Promise.all(roots.map(root => this.hookSessionRegistry(root))), this.discoverCodexSessions(roots)]);
    const hookSessions = hookBatches.flat();
    const sessions = new Map(hookSessions.map(item => [item.id, item]));
    for (const discovered of codexSessions) {
      if (!discovered?.id) continue;
      const previous = sessions.get(discovered.id);
      sessions.set(discovered.id, {
        ...previous,
        ...discovered,
        name: discovered.name || previous?.name || '',
        firstSeen: [previous?.firstSeen, discovered.firstSeen].filter(Boolean).sort()[0] || new Date(0).toISOString(),
        lastSeen: [previous?.lastSeen, discovered.lastSeen].filter(Boolean).sort().at(-1) || new Date(0).toISOString(),
      });
    }
    return [...sessions.values()].map(item => ({ ...item, ...(this.binding(item.id) || {}) })).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }
  async recordedSessionIds() {
    const text = await fs.readFile(this.sessionsFile, 'utf8').catch(e => e.code === 'ENOENT' ? '' : Promise.reject(e));
    const ids = new Set();
    for (const line of text.split('\n').filter(Boolean)) {
      try { const event = JSON.parse(line); if (typeof event.session_id === 'string' && event.session_id.trim()) ids.add(event.session_id.trim()); } catch {}
    }
    return [...ids];
  }
  async snapshot() {
    const sessions = await this.sessionRegistry();
    return {
      sessions,
      currentSessionId: (sessions.find(item => item.status === 'active') || sessions[0])?.id || null,
      grants: this.data.sessions,
    };
  }
  async knownSessions(root = null) {
    if (!root) return (await this.sessionRegistry()).map(item => item.id);
    const [hook, codex] = await Promise.all([this.hookSessionRegistry(root), this.discoverCodexSessions([root])]);
    return [...new Set([...hook, ...codex].map(item => item.id))];
  }
  watch(onChange) {
    let timer, checking = false, signature;
    const listener = () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 30);
      timer.unref?.();
    };
    const inspect = async () => {
      if (checking) return;
      checking = true;
      try {
        const sessions = await this.sessionRegistry();
        const next = JSON.stringify(sessions.map(({ id, name, status, lastSeen }) => [id, name, status, lastSeen]));
        if (signature !== undefined && signature !== next) listener();
        signature = next;
      } finally { checking = false; }
    };
    watchFile(this.sessionsFile, { persistent: false, interval: 200 }, inspect);
    void inspect();
    const interval = setInterval(inspect, 750); interval.unref?.();
    return () => { clearTimeout(timer); clearInterval(interval); unwatchFile(this.sessionsFile, inspect); };
  }
  async register(sessionId, binding = {}) {
    const worktreeRoot = binding.worktreeRoot || this.binding(sessionId)?.worktreeRoot || this.root;
    if (!(await this.knownSessions(worktreeRoot)).includes(sessionId)) throw new MapError('UNKNOWN_SESSION', 'Session must first be recorded by a lifecycle hook or discovered in this Context Guard worktree', 403);
    const stored = {
      ...(this.binding(sessionId) || {}),
      ...binding,
      sessionId,
      worktreeRoot,
      updatedAt: new Date().toISOString(),
    };
    this.bindings.sessions[sessionId] = stored;
    await atomicWrite(this.bindingsFile, encode(this.bindings));
    return { kind: 'agent', sessionId, ...(stored.projectId ? { projectId: stored.projectId } : {}), ...(stored.worktreeId ? { worktreeId: stored.worktreeId } : {}) };
  }
  grants(sessionId) { return this.data.sessions[sessionId]?.nodes || []; }
  async grant(sessionId, nodes, version) {
    const next = this.queue.then(async () => {
      await this.register(sessionId);
      const data = structuredClone(this.data);
      data.sessions[sessionId] = { nodes: [...new Set(nodes)], version, changedAt: new Date().toISOString() };
      await atomicWrite(this.file, encode(data)); this.data = data;
    });
    this.queue = next.catch(() => {}); await next;
  }
}
