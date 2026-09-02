import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { MapError } from '../../prototype/map-model.mjs';
import { atomicWrite, encode, readJSON } from './io.mjs';
export const token = () => randomBytes(32).toString('base64url');
export class Access {
  constructor(root) { this.ctx = path.join(root, '.codex/context'); this.file = path.join(this.ctx, 'sessions/workbench-access.json'); this.queue = Promise.resolve(); }
  async init() { this.data = await readJSON(this.file, { sessions: {} }); return this; }
  async knownSessions() {
    const text = await fs.readFile(path.join(this.ctx, 'sessions.jsonl'), 'utf8').catch(e => e.code === 'ENOENT' ? '' : Promise.reject(e));
    const ids = new Set();
    for (const line of text.split('\n').filter(Boolean)) { try { const event = JSON.parse(line); if (event.session_id) ids.add(event.session_id); } catch {} }
    return [...ids];
  }
  async register(sessionId) {
    if (!(await this.knownSessions()).includes(sessionId)) throw new MapError('UNKNOWN_SESSION', 'Session must first be recorded by a lifecycle hook', 403);
    return { kind: 'agent', sessionId };
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
