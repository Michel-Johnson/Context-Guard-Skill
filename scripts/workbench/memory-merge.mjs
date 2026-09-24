import { MapError, same } from '../shared/map-model.mjs';
import { encode, hash } from '../shared/io.mjs';

function sequenceKey(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return `value:${encode(value)}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.id === 'string' && value.id) return `id:${value.id}`;
  if (typeof value.archiveKey === 'string' && value.archiveKey) return `archive:${value.archiveKey}`;
  if (typeof value.operationId === 'string' && value.operationId) return `operation:${value.operationId}`;
  if (typeof value.from === 'string' && typeof value.to === 'string') return `flow:${value.from}\0${value.to}\0${value.label || ''}`;
  return `value:${hash(encode(value))}`;
}

function keyedSequence(values, at) {
  const entries = new Map();
  for (const value of values) {
    const key = sequenceKey(value);
    if (!key || entries.has(key)) throw new MapError('MEMORY_CONFLICT', `Cannot safely merge ${at}; sequence identity is ambiguous`, 409);
    entries.set(key, value);
  }
  return entries;
}

function mergeSessionValue(base, local, remote, at) {
  if (same(local, remote) || same(base, local)) return structuredClone(remote);
  if (same(base, remote)) return structuredClone(local);
  const field = at.split('.').at(-1);
  if (['origin', 'proposedBy', 'isNew'].includes(field)) return structuredClone(remote);
  if ((base === undefined || Array.isArray(base)) && Array.isArray(local) && Array.isArray(remote)) {
    const indexedBase = keyedSequence(base || [], at), indexedLocal = keyedSequence(local, at), indexedRemote = keyedSequence(remote, at);
    const order = [...indexedLocal.keys(), ...[...indexedRemote.keys()].filter(key => !indexedLocal.has(key))];
    const merged = [];
    for (const key of order) {
      const before = indexedBase.get(key), left = indexedLocal.get(key), right = indexedRemote.get(key);
      if (left === undefined && right === undefined) continue;
      if (left === undefined) {
        if (before === undefined) merged.push(structuredClone(right));
        else if (!same(before, right)) throw new MapError('MEMORY_CONFLICT', `Delete and edit overlap at ${at}`, 409);
        continue;
      }
      if (right === undefined) {
        if (before === undefined) merged.push(structuredClone(left));
        else if (!same(before, left)) throw new MapError('MEMORY_CONFLICT', `Edit and delete overlap at ${at}`, 409);
        continue;
      }
      merged.push(mergeSessionValue(before, left, right, `${at}[${key}]`));
    }
    return merged;
  }
  if ((base === undefined || base && typeof base === 'object' && !Array.isArray(base))
      && [local, remote].every(value => value && typeof value === 'object' && !Array.isArray(value))) {
    const merged = {};
    const before = base || {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeSessionValue(before[key], local[key], remote[key], `${at}.${key}`);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  throw new MapError('MEMORY_CONFLICT', `Both Session and Main changed ${at}`, 409);
}

export function mergeSessionDocuments(base, local, remote) {
  return mergeSessionValue(base, local, remote, 'map');
}
