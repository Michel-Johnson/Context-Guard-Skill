import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, encode, atomicWrite } from './io.mjs';

// Never repair an interior record as though it were an interrupted final append.
export function inspectJournal(raw) {
  const text = raw.toString('utf8');
  const lines = text.split('\n');
  const events = [];
  let offset = 0;
  let cursor = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) { offset += line.length + 1; continue; }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return {
        events,
        prefix: text.slice(0, offset),
        problem: { kind: index === lines.length - 1 ? 'tail' : 'corrupt', line: index + 1, message: '日志记录不是完整 JSON' },
      };
    }
    if (!event || typeof event !== 'object') {
      return { events, prefix: text.slice(0, offset), problem: { kind: 'corrupt', line: index + 1, message: '日志记录不是对象' } };
    }
    const { cursor: next, at, ...record } = event;
    if (typeof record.operationId !== 'string' || typeof record.version !== 'string' || !record.actor?.kind || !Array.isArray(record.actions) || typeof at !== 'string' || next !== hash(`${cursor || ''}:${encode(record)}`)) {
      return { events, prefix: text.slice(0, offset), problem: { kind: 'corrupt', line: index + 1, message: '日志字段或游标校验失败' } };
    }
    events.push(event);
    cursor = next;
    offset += line.length + 1;
  }
  return { events, prefix: text, needsNewline: text.length > 0 && !text.endsWith('\n') };
}

export async function backupJournal(runtime, raw) {
  const file = path.join(runtime, 'recovery', `journal-${Date.now()}-${randomUUID()}.jsonl`);
  await atomicWrite(file, raw);
  return file;
}

export async function replaceJournal(file, original, content) {
  await atomicWrite(file, content, {
    beforeReplace: async () => {
      if (hash(await fs.readFile(file)) !== hash(original)) {
        const error = new Error('日志在恢复期间被外部修改；原件与备份均保留，请重新读取');
        error.code = 'JOURNAL_CHANGED';
        throw error;
      }
    },
  });
}
