import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url)), exec = promisify(execFile);
const read = async file => JSON.parse(await fs.readFile(path.join(here, file), 'utf8'));
const manifest = await read('manifest.json');
assert.equal(manifest.files.length, 31);
for (const entry of manifest.files) {
  assert.match(entry.path, /^source\/[A-Za-z0-9.-]+$/);
  const file = path.join(here, entry.path), bytes = await fs.readFile(file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.archiveSha256);
  if (/\.(mjs|js)$/.test(file)) await exec(process.execPath, ['--check', file], { windowsHide: true });
}
const index = await read('results/index.json');
assert.equal(index.studies.length, 9);
assert.equal(index.studies.reduce((n, s) => n + s.samples, 0), 76);
const blocked = new Set(['answer', 'answers', 'primaryAnswers', 'followupAnswers', 'messages', 'goal', 'token', 'adminToken', 'browserToken', 'password', 'runDir', 'directory', 'followupSnapshot']);
function inspect(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) { assert(!blocked.has(key), `Private field ${key}`); inspect(item); }
}
for (const study of index.studies) {
  const data = await read(study.file); assert.equal(data.runs.length, study.samples); inspect(data);
}
const metrics = await read('results/harness-main.json');
const average = (task, variant, key) => {
  const runs = metrics.runs.filter(r => r.task === task && r.variant === variant);
  assert.equal(runs.length, 2); return runs.reduce((n, r) => n + r[key], 0) / runs.length;
};
assert.equal(average('files', 'baseline', 'modelCalls'), 4.5);
assert.equal(average('files', 'prefetch', 'modelCalls'), 1);
assert.equal(average('parallel', 'baseline', 'modelCalls'), 7);
assert.equal(average('parallel', 'prefetch', 'modelCalls'), 5);
const allModelCalls = (await Promise.all(['harness-main', 'harness-grounded', 'harness-contracts'].map(n => read('results/' + n + '.json')))).flatMap(s => s.runs).reduce((n, r) => n + r.modelCalls, 0);
assert.equal(allModelCalls, 72);
const traceIndex = await read('results/traces/index.json');
for (const t of traceIndex) {
  const trace = await read('results/traces/' + t.name + '.json'); assert.equal(trace.events.length, t.events); inspect(trace);
}
const web = await read('results/web-strategies.json');
assert.equal(web.runs.length, 11); assert(web.runs.some(r => r.timedOut));
assert(web.runs.some(r => r.searchErrors.includes('SEARCH_PROVIDER_ERROR')));
const replay = await read('results/optimization-replay.json');
assert.equal(replay.retrievalCoverage.passed, false);
assert.equal(replay.circuit.before.models, 3); assert.equal(replay.circuit.after.models, 1);
console.log(JSON.stringify({ archive: 'verified', sourceFiles: manifest.files.length, studies: index.studies.length, samples: 76, harnessModelCalls: allModelCalls, retainedNegativeResults: true }));
