import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
export const hash = text => createHash('sha256').update(text).digest('hex');
export const encode = value => JSON.stringify(value, null, 2) + '\n';
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}
export async function atomicWrite(file, content, { deadlineMs = 350, beforeReplace = async () => {} } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(content); await handle.sync(); await handle.close(); handle = null;
    const deadline = performance.now() + deadlineMs;
    for (;;) {
      await beforeReplace();
      try { await fs.rename(temp, file); break; }
      catch (e) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || performance.now() >= deadline) throw e;
        await pause(Math.min(10, Math.max(0, deadline - performance.now())));
      }
    }
    // Directory fsync is supported on Unix, not Windows. File contents were flushed.
    if (process.platform !== 'win32') {
      const dir = await fs.open(path.dirname(file), 'r');
      try { await dir.sync(); } finally { await dir.close(); }
    }
  } finally { if (handle) await handle.close(); await fs.unlink(temp).catch(() => {}); }
}
