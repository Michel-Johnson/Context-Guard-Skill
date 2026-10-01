import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const threadKey = (team, channel, ts) => `${team}:${channel}:${ts}`;
const empty = () => ({ version: 1, inbox: {}, threads: {}, channels: {}, preferences: {}, drafts: {}, outgoing: {} });

// A single process owns this file. Every acknowledgement follows an fsync and
// atomic rename, so restart replays gateway operations with their original IDs.
export class Store {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'state.json'); this.tail = Promise.resolve(); }
  async open() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { this.data = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.data = empty(); }
    if (this.data.version !== 1) throw new Error('Unsupported Slack state version');
    return this;
  }
  async update(operation) {
    const run = this.tail.then(async () => {
      const next = structuredClone(this.data), result = await operation(next);
      const temporary = path.join(this.directory, `.state-${randomUUID()}`);
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(next)); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, this.file);
      const directory = await fs.open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      this.data = next;
      return result;
    });
    this.tail = run.catch(() => {});
    return run;
  }
  async receive(id, envelope) {
    return this.update(state => {
      if (state.inbox[id]) return false;
      state.inbox[id] = { envelope, status: 'pending', attempts: 0, at: Date.now(), next: 0 };
      return true;
    });
  }
  async bind(key, binding) {
    return this.update(state => {
      const prior = state.threads[key];
      if (prior && (prior.projectId !== binding.projectId || prior.conversationId !== binding.conversationId)) throw new Error('Thread binding is immutable');
      state.threads[key] = prior || { ...binding, mirrored: {}, cursor: null, at: Date.now() };
      return state.threads[key];
    });
  }
}
