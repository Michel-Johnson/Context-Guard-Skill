import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, readJSON } from '../../scripts/shared/io.mjs';
import { fault } from './source.mjs';

export class History {
  constructor(directory) { this.directory = directory; this.cache = new Map(); }
  file(id, ext) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw fault('INVALID_ID', 'Invalid session identifier');
    return path.join(this.directory, `${id}.${ext}`);
  }
  async create({ id = randomUUID(), parent = null, through = 0, purpose = '' } = {}) {
    if (parent) {
      const prefix = await this.messages(parent);
      if (!Number.isSafeInteger(through) || through < 0 || through > prefix.length) throw fault('INVALID_BOUNDARY', 'Invalid fork boundary');
      this.validate(prefix.slice(0, through));
    }
    await fs.mkdir(this.directory, { recursive: true });
    const meta = { id, parent, through, purpose, createdAt: new Date().toISOString() };
    await fs.writeFile(this.file(id, 'json'), JSON.stringify(meta), { flag: 'wx', mode: 0o600 });
    this.cache.set(id, { meta, tail: [] });
    return meta;
  }
  async load(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const meta = await readJSON(this.file(id, 'json'));
    let text = '';
    try { text = await fs.readFile(this.file(id, 'jsonl'), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    // A partial final line after a crash is not silently dropped or replayed.
    if (text && !text.endsWith('\n')) throw fault('INTERRUPTED_HISTORY', 'Incomplete append; preserve evidence and begin a new task');
    const tail = text.split('\n').filter(Boolean).map(line => JSON.parse(line));
    const result = { meta, tail }; this.cache.set(id, result); return result;
  }
  async messages(id, visited = new Set()) {
    if (visited.has(id) || visited.size > 4) throw fault('INVALID_LINEAGE', 'Invalid session lineage');
    visited.add(id);
    const { meta, tail } = await this.load(id);
    const prefix = meta.parent ? (await this.messages(meta.parent, visited)).slice(0, meta.through) : [];
    return structuredClone([...prefix, ...tail]);
  }
  async append(id, message) {
    const state = await this.load(id);
    const value = structuredClone(message);
    const handle = await fs.open(this.file(id, 'jsonl'), 'a', 0o600);
    try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
    state.tail.push(value);
  }
  validate(messages) {
    let pending = new Set();
    for (const msg of messages) {
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      if (pending.size) {
        if (msg.role !== 'user') throw fault('INCOMPLETE_TOOLS', 'Fork must follow paired tool results');
        for (const block of blocks) if (block.type === 'tool_result') pending.delete(block.tool_use_id);
        if (pending.size) throw fault('INCOMPLETE_TOOLS', 'Missing tool result at fork boundary');
      }
      if (msg.role === 'assistant') pending = new Set(blocks.filter(b => b.type === 'tool_use').map(b => b.id));
    }
    if (pending.size) throw fault('INCOMPLETE_TOOLS', 'Fork must follow paired tool results');
  }
}

export class Journal {
  constructor(directory) { this.file = path.join(directory, 'events.jsonl'); this.pending = Promise.resolve(); }
  record(event) {
    const row = { at: new Date().toISOString(), ...event };
    const next = this.pending.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.appendFile(this.file, JSON.stringify(row) + '\n', { mode: 0o600 });
    });
    this.pending = next.catch(() => {});
    return next;
  }
}

export { atomicWrite, readJSON };
