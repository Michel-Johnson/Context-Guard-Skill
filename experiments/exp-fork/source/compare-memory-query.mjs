import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomInt } from 'node:crypto';
import { Experiment, classify } from './engine.mjs';
import { Source } from './source.mjs';
import { codexMap } from './map.mjs';
import { History, readJSON, atomicWrite } from './history.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const study = await readJSON(path.join(here, 'data/study/experiment.json'));
const original = study.trials['seed'];
const request = original.requests.find(r => r.id === 'memory-query');
const history = new History(path.join(here, 'data/study/sessions'));
const messages = await history.messages(original.session);
const boundaries = messages.flatMap((m, i) => m.role === 'user' && m.content === request.text ? [i] : []);
if (boundaries.length !== 1) throw new Error('Ambiguous query boundary');
const prefix = messages.slice(0, boundaries[0]);
history.validate(prefix);
const pin = await readJSON(path.join(here, 'pin.json'));
const provider = await readJSON(path.resolve(here, '../local-coordinator-data/provider.json'));
const directory = path.join(here, 'comparisons', String(Date.now()));
const pair = randomInt(2) ? ['direct', 'adaptive'] : ['adaptive', 'direct'];
const order = [...pair, ...pair.toReversed()];
const summary = {
  query: request.text, originalRequest: request.id,
  originalReadyMs: request.endedAt - request.receivedAt,
  fingerprint: request.fingerprint, prefixMessages: prefix.length,
  prefixHash: createHash('sha256').update(JSON.stringify(prefix)).digest('hex'),
  order, runs: [],
};
console.log(JSON.stringify({ directory, order, prefixMessages: prefix.length }));
for (const [index, arm] of order.entries()) {
  const source = await new Source({ root: path.resolve(here, '../codex-learning-source'), commit: pin.commit, map: codexMap(pin.commit) }).init();
  const e = await new Experiment({ directory: path.join(directory, `${index + 1}-${arm}`), source, provider, phase: 'calibration' }).init();
  let timer;
  try {
    if (e.db.fingerprint !== request.fingerprint) throw new Error('Replay configuration does not match original');
    await e.newTrial('replay');
    for (const message of prefix) await e.history.append(e.trial('replay').session, message);
    e.db.blocks[classify(request.text)] = [arm];
    timer = setTimeout(() => { console.log(JSON.stringify({ arm, timeout: true })); void e.close(); }, 240000);
    await e.submit('replay', { requestId: 'query', text: request.text });
    await e.drain();
    const trial = e.trial('replay'), r = trial.requests[0];
    const result = {
      run: index + 1, arm: trial.arm, status: r.status,
      readyMs: r.endedAt ? r.endedAt - r.receivedAt : null,
      firstModelTextMs: r.firstModelTextAt ? r.firstModelTextAt - r.receivedAt : null,
      modelCalls: r.modelCalls, toolCalls: r.toolCalls,
      children: trial.children.map(c => ({ status: c.status, forkMs: c.forkMs })),
      usage: r.usage,
      answers: trial.visible.filter(m => m.role === 'assistant').map(m => m.text),
    };
    summary.runs.push(result);
    await atomicWrite(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ ...result, usage: undefined, answers: undefined }));
    if (r.status !== 'completed') process.exitCode = 1;
  } finally { clearTimeout(timer); await e.close(); }
}
console.log(JSON.stringify({ directory, averages: ['direct', 'adaptive'].map(arm => {
  const runs = summary.runs.filter(r => r.arm === arm && r.status === 'completed');
  return { arm, completed: runs.length, readyMs: runs.length ? runs.reduce((s, r) => s + r.readyMs, 0) / runs.length : null };
}) }));
