import { MapError, validate } from '../../prototype/map-model.mjs';
export function validateMemory(value) {
  if (!value || typeof value !== 'object' || !value.map) throw new MapError('INVALID_MEMORY', 'A map and records are required');
  validate(value.map);
  if (!value.records || typeof value.records !== 'object' || Array.isArray(value.records)) throw new MapError('INVALID_MEMORY', 'records must be an object');
  for (const [file, content] of Object.entries(value.records)) {
    if (!/^(?:(?:sessions|bugs|fixes|tasks|cards)\/[A-Za-z0-9_.-]+\.md|(?:index|FIND|user-messages|architecture|l1-candidates)\.md|(?:preferences|bugs-index|bad-case-events|jump-index|owns-index|tasks-index|l1-candidates)\.json|sessions\.jsonl)$/.test(file) || file.split('/').includes('..') || typeof content !== 'string') throw new MapError('PRIVATE_PATH', 'Only development records may be uploaded; private/runtime files are excluded');
  }
}
