import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readJSON, atomicWrite } from './history.mjs';
import { boundedReadBatch, SearchCircuit, EvidenceSource, prefetchEvidence } from './harness-optimization.mjs';
import { Source } from './source.mjs';
import { codexMap } from './map.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const destination = path.resolve(process.argv[2]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const started = performance.now();
const checks = [];
let active = 0, peak = 0;
const calls = ['read_file', 'read_file', 'edit_map', 'search_code', 'read_file'].map((name, id) => ({ name, id }));
const returned = await boundedReadBatch(calls, async c => {
  if (c.name === 'edit_map') assert.equal(active, 0);
  active++; peak = Math.max(peak, active);
  await sleep(c.id % 2 ? 12 : 20); active--; return c.id;
});
assert.deepEqual(returned, [0, 1, 2, 3, 4]); assert.equal(peak, 2); assert.equal(active, 0);
checks.push('bounded concurrency=2; preserves tool-result order; mutation is a serial barrier');
let completedSlow = false, startedThird = false;
await assert.rejects(boundedReadBatch([{ name: 'read_file', id: 0 }, { name: 'read_file', id: 1 }, { name: 'read_file', id: 2 }], async c => {
  if (!c.id) throw new Error('synthetic failure');
  if (c.id === 2) startedThird = true;
  await sleep(15); completedSlow = true;
}), /synthetic failure/);
assert.equal(completedSlow, true); assert.equal(startedThird, false);
checks.push('worker failure waits for in-flight work and stops scheduling additional work');
let upstream = 0;
const breaker = new SearchCircuit({ call: async () => { upstream++; throw Object.assign(new Error('fixture provider error'), { code: 'SEARCH_PROVIDER_ERROR' }); } });
for (let i = 0; i < 5; i++) await assert.rejects(breaker.call({ query: 'public query' }), e => e.code === (i < 2 ? 'SEARCH_PROVIDER_ERROR' : 'SEARCH_CIRCUIT_OPEN'));
assert.equal(upstream, 2); checks.push('circuit prevents more provider requests after two consecutive failures');
let attempts = 0;
const reset = new SearchCircuit({ call: async () => { if (++attempts === 1) throw Object.assign(new Error('fixture failure'), { code: 'SEARCH_PROVIDER_ERROR' }); return { results: [] }; } });
await assert.rejects(reset.call({})); await reset.call({}); assert.equal(reset.failures, 0); assert.equal(reset.open, false);
checks.push('successful empty search resets provider-failure count; empty search is not provider failure');
const pin = await readJSON(path.join(here, 'pin.json'));
const base = await new Source({ root: path.join(here, '../codex-learning-source'), commit: pin.commit, map: codexMap(pin.commit) }).init();
const source = new EvidenceSource(base);
const read = await source.call('read_file', { path: 'codex-rs/memories/README.md' });
assert(read.referencedPathChecks.some(r => r.path === 'codex-rs/core/src/memories' && !r.exists));
await assert.rejects(source.call('list_files', { path: 'codex-rs/memories/src' }), e => e.code === 'NOT_FOUND' && e.message.includes('codex-rs/memories/write'));
await assert.rejects(source.call('read_file', { path: '../private' }), e => e.code === 'INVALID_PATH');
const packet = await prefetchEvidence(source, '分别调查会话 fork 历史与记忆 Phase 1');
let retrievalCoverage;
try {
  assert.deepEqual(new Set(packet.selectedNodes), new Set(['fork', 'memory']));
  retrievalCoverage = { passed: true, expected: ['fork', 'memory'], actual: packet.selectedNodes };
} catch (error) {
  if (error.code !== 'ERR_ASSERTION') throw error;
  retrievalCoverage = { passed: false, expected: ['fork', 'memory'], actual: packet.selectedNodes, limitation: 'Lexical Map ranker misses an independently requested topic; preserve this negative result.' };
}
assert(Buffer.byteLength(JSON.stringify(packet)) <= 32000);
checks.push('pinned source path validation, stale README detection, invalid paths rejected, prefetch byte bound');

const old = await readJSON(path.join(here, 'strategy-evaluations/1790533599501/summary.json'));
const audit = { runs: old.runs.length, models: 0, tools: 0, toolErrors: {}, exactRepeatedTools: 0, multiToolBatches: 0, readContinuationPairs: 0 };
for (const r of old.runs) {
  const events = (await fs.readFile(path.join(r.runDir, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const seen = new Set(), reads = new Map(), batchCounts = new Map();
  for (const e of events.filter(e => e.request === 'primary')) {
    if (e.type === 'model.call') { audit.models++; if ((batchCounts.get(e.session) || 0) > 1) audit.multiToolBatches++; batchCounts.set(e.session, 0); }
    if (e.type !== 'tool.call') continue;
    audit.tools++; batchCounts.set(e.session, (batchCounts.get(e.session) || 0) + 1);
    if (e.error) audit.toolErrors[e.error] = (audit.toolErrors[e.error] || 0) + 1;
    const key = e.name + ':' + JSON.stringify(e.input);
    if (seen.has(key)) audit.exactRepeatedTools++; seen.add(key);
    if (e.name === 'read_file' && !e.error) {
      const key = e.session + ':' + e.input.path, previous = reads.get(key);
      if (previous) audit.readContinuationPairs++;
      reads.set(key, e.input);
    }
  }
}
const web = await readJSON(path.join(here, 'web-strategy-evaluations/1790537062194/summary.json'));
const original = web.runs.find(r => r.id === 'comparison' && r.repeat === 1 && r.arm === 'direct');
const events = (await fs.readFile(path.join(original.runDir, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
const batches = []; let batch;
for (const e of events) {
  if (e.type === 'model.call') { batch = []; batches.push(batch); }
  if (e.type === 'tool.call') batch.push(e);
}
const replay = [];
for (let repeat = 1; repeat <= 3; repeat++) for (const variant of repeat % 2 ? ['serial', 'parallel'] : ['parallel', 'serial']) {
  const before = performance.now();
  for (const batch of batches) {
    const result = await boundedReadBatch(batch, async c => { await sleep(c.durationMs); return c.input; }, variant === 'serial' ? 1 : 2);
    assert.deepEqual(result, batch.map(c => c.input));
  }
  replay.push({ repeat, variant, toolWallMs: performance.now() - before, modelCallsUnchanged: batches.length });
  console.log(JSON.stringify({ replay: repeat, variant, toolWallMs: Math.round(replay.at(-1).toolWallMs) }));
}
const failing = web.runs.find(r => r.id === 'comparison' && r.repeat === 3 && r.arm === 'direct');
const failedEvents = (await fs.readFile(path.join(failing.runDir, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
let modelCalls = 0, searches = 0;
const circuit = new SearchCircuit({ call: async () => { searches++; throw Object.assign(new Error('recorded failure'), { code: 'SEARCH_PROVIDER_ERROR' }); } });
for (const event of failedEvents) {
  if (circuit.open) break;
  if (event.type === 'model.call') modelCalls++;
  if (event.type === 'tool.call' && event.name === 'web_search') { try { await circuit.call(event.input); } catch {} }
}
const result = { at: new Date().toISOString(), checks, retrievalCoverage, audit, replay,
  replayScope: 'Recorded search durations reproduced with timers, stable original tool batches. No model/provider calls. Live-model next steps could differ; predicted total is not a measured fresh user answer.',
  replaySource: original.runDir, originalReadyMs: original.readyMs,
  recordedModelMs: (await readJSON(path.join(original.runDir, 'timing.json'))).traces.reduce((s, t) => s + t.end - t.start, 0),
  circuit: { source: failing.runDir, before: { models: failing.modelCalls, searches: failing.searches }, after: { models: modelCalls, searches },
    scope: 'Replay halts the harness with explicit unavailable status when circuit opens. This improves failure response, NOT successful answer delivery. A wrapper without loop termination only saves network calls.' },
  elapsedMs: performance.now() - started };
await atomicWrite(path.join(destination, 'replay.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
