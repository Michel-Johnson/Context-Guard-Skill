import { readProjectRegistry } from './registry.mjs';
import { readJSON } from '../shared/io.mjs';
import { MAX_MESSAGE_BYTES } from '../shared/protocol.mjs';

async function jsonRequest(url, options = {}) {
  const { timeoutMs = 8000, ...requestOptions } = options;
  const response = await fetch(url, { ...requestOptions, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Heartbeat endpoint unavailable');
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_MESSAGE_BYTES) throw new Error('Heartbeat response too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Hosted by the existing user-wide service. Project backends retain credentials,
// registration and business queues; this is the only device heartbeat timer.
export class DeviceHeartbeat {
  constructor({ dir, intervalMs = 10000, request = jsonRequest, registry = () => readProjectRegistry({ dir }), onTick = async () => {} } = {}) {
    this.intervalMs = intervalMs; this.request = request; this.registry = registry;
    this.running = null; this.closed = false; this.errors = 0;
    this.batches = 0; this.lastSentAt = '';
    this.onTick = onTick;
  }
  poll() {
    if (this.closed) return Promise.resolve();
    return this.running ||= this.run().finally(() => { this.running = null; });
  }
  async run() {
    await this.onTick();
    const { projects } = await this.registry();
    const groups = new Map();
    await Promise.all(projects.map(async project => {
      try {
        const state = await readJSON(project.stateFile, null);
        if (!state?.capabilities?.includes('device-managed-heartbeat') || state.projectId !== project.projectId) return;
        const base = new URL(state.url);
        if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1') return;
        const endpoint = new URL('/api/device-heartbeat', base);
        const headers = { Authorization: `Bearer ${state.adminToken}`, 'Content-Type': 'application/json' };
        const input = await this.request(endpoint, { headers, timeoutMs: 1000 });
        if (!input?.message?.payload?.sessions?.length) return;
        const origin = new URL(input.origin);
        if (origin.username || origin.password || origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))) throw new Error('Invalid Cloud origin');
        const group = groups.get(origin.origin) || [];
        group.push({ endpoint, headers, input }); groups.set(origin.origin, group);
      } catch { this.errors++; }
    }));
    await Promise.all([...groups].map(async ([origin, entries]) => {
      try {
        const body = JSON.stringify(entries.map(({ input }) => ({ credential: input.credential, message: input.message })));
        if (Buffer.byteLength(body) > MAX_MESSAGE_BYTES) throw new Error('Device heartbeat too large');
        const replies = await this.request(new URL('/api/v2/heartbeat', origin), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        if (!Array.isArray(replies) || replies.length !== entries.length) throw new Error('Invalid device heartbeat receipt');
        this.batches++; this.lastSentAt = new Date().toISOString();
        await Promise.all(entries.map(async ({ endpoint, headers, input }) => {
          const reply = replies.find(item => item.id === input.message.id);
          if (!reply || typeof reply.ok !== 'boolean') throw new Error('Missing heartbeat receipt');
          await this.request(endpoint, { method: 'POST', headers, body: JSON.stringify(reply), timeoutMs: 1000 });
        }));
      } catch { this.errors++; }
    }));
  }
  start() {
    if (this.timer || this.closed) return;
    const tick = () => this.poll().catch(() => { this.errors++; });
    this.timer = setInterval(tick, this.intervalMs); this.timer.unref?.(); tick();
  }
  async close() { this.closed = true; clearInterval(this.timer); await this.running; }
}
