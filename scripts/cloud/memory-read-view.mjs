import fs from 'node:fs/promises';
import { atomicWrite, encode, readJSON } from '../workbench/io.mjs';

// Never retain historical snapshots/receipts in the hot read cache. Disk remains
// authoritative; inode and nanosecond timestamps also detect external replaces.
const projectView = state => Object.fromEntries(
  ['revision', 'main', 'preferences', 'sessions', 'closedSessions', 'events', 'eventCursors']
    .filter(key => key in state).map(key => [key, state[key]]),
);
async function stamp(file) {
  try {
    const info = await fs.stat(file, { bigint: true });
    return `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

export function createMemoryReadViews({ read = readJSON, write = atomicWrite, maxEntries = 32 } = {}) {
  const entries = new Map();
  const remember = (file, entry) => {
    entries.delete(file); entries.set(file, entry);
    for (const [key, value] of entries) {
      if (entries.size <= maxEntries) break;
      if (!value.pending && key !== file) entries.delete(key);
    }
  };
  return {
    async read(file, initial) {
      let entry = entries.get(file);
      if (!entry?.pending) {
        entry ||= {};
        const selected = entry;
        selected.pending = (async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            const before = await stamp(file);
            if (selected.stamp === before && selected.view) return selected.view;
            const state = await read(file, initial);
            if (before !== await stamp(file)) continue;
            selected.stamp = before;
            selected.view = projectView(state);
            return selected.view;
          }
          throw new Error('Memory changed while reading current state');
        })();
        remember(file, selected);
        selected.pending.finally(() => { selected.pending = null; }).catch(() => {});
      }
      // Callers may assemble responses, but cannot mutate a cached generation.
      return structuredClone(await entry.pending);
    },
    async write(file, state) {
      const entry = {};
      entry.pending = (async () => {
        await write(file, encode(state));
        entry.stamp = await stamp(file);
        entry.view = structuredClone(projectView(state));
        return entry.view;
      })();
      remember(file, entry);
      try { await entry.pending; }
      catch (error) { if (entries.get(file) === entry) entries.delete(file); throw error; }
      finally { entry.pending = null; }
    },
  };
}

export const memoryReadViews = createMemoryReadViews();
