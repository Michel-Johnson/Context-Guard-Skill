import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { History } from './history.mjs';
import { Experiment, RESPONSE_STYLE } from './engine.mjs';
import { Source } from './source.mjs';
import { codexMap } from './map.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const directory = name => path.join(here, 'test-data', name + '-' + randomUUID());
const source = { commit: 'a'.repeat(40), map: { root: { id: 'root', children: [] } }, call: async () => ({ text: 'source evidence' }) };

test('study UI reuses native Coordinator layout without persistent selector or rating footer', async () => {
  const ui = await fs.readFile(path.join(here, 'ui.js'), 'utf8');
  const css = await fs.readFile(path.join(here, 'ui.css'), 'utf8');
  for (const component of ['coordinator-toolbar', 'coordinator-heading', 'coordinator-history-list', 'coordinator-input-shell', 'coordinator-send', 'coordinator-message', 'coordinator-markdown']) assert.ok(ui.includes(component), component);
  assert.ok(ui.includes('coordinator-working-blot.mjs'));
  assert.doesNotMatch(ui, /<select|<footer|learning-version|learning-tasks/);
  assert.doesNotMatch(css, /#learning-input\{|#learning-send\{/);
  assert.match(ui, /id="learning-feedback"[^>]*hidden/);
  for (const motion of ['nextRevealSegmentEnd', 'coordinator-planning', 'coordinator-typing-phase', 'coordinator-rise-body', 'is-entering', 'prefers-reduced-motion']) assert.ok(ui.includes(motion), motion);
  assert.match(ui, /revealing\.has\(message\.id\)/);
  assert.match(ui, /if \(firstRender\) content\.append/);
  assert.doesNotMatch(ui, /el\('messages'\)\.replaceChildren\(fragment\)/);
});
const answer = text => ({ stop: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 3 }, model: 'test' });
const fork = goals => ({ stop: 'tool_use', content: goals.map((goal, i) => ({ type: 'tool_use', name: 'fork_task', id: 'call-' + i, input: { goal } })), usage: { input_tokens: 8 }, model: 'test' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate) { const end = Date.now() + 8000; while (!predicate()) { if (Date.now() > end) throw Error('Timeout'); await sleep(10); } }
async function lab(next) { return new Experiment({ directory: directory('engine'), source, provider: { model: 'test' }, phase: 'calibration', modelFactory: signal => ({ next: options => next(options, signal) }) }).init(); }
async function send(e, id, text = 'lookup', requestId = randomUUID()) { await e.submit(id, { requestId, text }); return requestId; }

test('concise prompt upgrades known baseline, preserves history and versions requests', async () => {
  const options = { directory: directory('style'), source, provider: { model: 'test' }, phase: 'calibration', modelFactory: () => ({ next: async () => answer('complete') }) };
  const old = new Experiment(options); old.system = old.system.slice(0, -RESPONSE_STYLE.length - 1); await old.init();
  await old.newTrial('t'); await send(old, 't'); await old.drain(); const oldVersion = old.db.fingerprint; const oldText = old.trial('t').visible.at(-1).text; await old.close();
  let seenSystem;
  const current = await new Experiment({ ...options, modelFactory: () => ({ next: async ({ system }) => { seenSystem = system; return answer('brief'); } }) }).init();
  assert.equal(current.trial('t').visible.at(-1).text, oldText);
  assert.equal(current.trial('t').requests[0].fingerprint, oldVersion);
  assert.equal(current.db.revisions.length, 1);
  await send(current, 't', 'followup'); await current.drain();
  assert.ok(seenSystem.includes(RESPONSE_STYLE)); assert.match(seenSystem, /不是硬上限/);
  assert.equal(current.trial('t').requests[1].fingerprint, current.db.fingerprint); await current.close();
  const changed = new Experiment({ ...options, provider: { model: 'different' } });
  await assert.rejects(changed.init(), { code: 'EXPERIMENT_CHANGED' });
});

test('fork persists only tail and freezes parent prefix, including restart', async () => {
  const dir = directory('history'), h = new History(dir), parent = await h.create();
  await h.append(parent.id, { role: 'user', content: 'old' });
  await h.append(parent.id, { role: 'assistant', content: 'evidence' });
  const child = await h.create({ parent: parent.id, through: 2 });
  await h.append(parent.id, { role: 'user', content: 'new parent only' });
  await h.append(child.id, { role: 'user', content: 'child only' });
  assert.deepEqual((await h.messages(child.id)).map(m => m.content), ['old', 'evidence', 'child only']);
  assert.equal((await fs.readFile(h.file(child.id, 'jsonl'), 'utf8')).includes('evidence'), false);
  assert.deepEqual(await new History(dir).messages(child.id), await h.messages(child.id));
  await h.append(parent.id, { role: 'assistant', content: [{ type: 'tool_use', id: 'pending' }] });
  await assert.rejects(h.create({ parent: parent.id, through: 4 }), { code: 'INCOMPLETE_TOOLS' });
});

test('balanced assignment, idempotent requests, hidden condition, metrics and final feedback', async () => {
  const e = await lab(async () => answer('done'));
  for (let i = 0; i < 4; i++) {
    await e.newTrial('t' + i); const requestId = await send(e, 't' + i); await e.drain();
    const arm = e.trial('t' + i).arm;
    await send(e, 't' + i, 'lookup', requestId); await e.drain();
    assert.equal(e.trial('t' + i).requests.length, 1);
    await assert.rejects(send(e, 't' + i, 'changed', requestId), { code: 'ID_REUSED' });
    await send(e, 't' + i, 'followup'); await e.drain(); assert.equal(e.trial('t' + i).arm, arm);
    const state = e.state('t' + i); assert.ok(!JSON.stringify(state).includes('adaptive'));
    assert.equal(Object.hasOwn(state, 'arm'), false);
    const output = state.messages.find(m => m.role === 'assistant');
    await e.displayed('t' + i, { output: output.id, clientElapsedMs: 22 });
    await e.feedback('t' + i, { output: output.id, helpful: true });
    await e.feedback('t' + i, { quality: 'solved' });
    await assert.rejects(send(e, 't' + i, 'too late'), { code: 'TASK_CLOSED' });
    assert.equal(e.trial('t' + i).requests[0].modelCalls, 1);
  }
  assert.equal(Object.values(e.db.trials).filter(t => t.arm === 'adaptive').length, 2); await e.close();
});

test('adaptive parent answers followup while child is blocked; child result synthesizes original question', async () => {
  let releaseChild, childStarted = false;
  const gate = new Promise(r => { releaseChild = r; });
  const e = await lab(async ({ system, messages }) => {
    if (system.includes('你负责分配给你的调查')) { childStarted = true; await gate; return answer('child evidence'); }
    const last = messages.at(-1).content;
    if (last === 'investigate') return fork(['read two files']);
    return answer(typeof last === 'string' && last.startsWith('[后台') ? 'synthesis complete' : 'followup complete');
  });
  e.db.blocks.lookup = ['adaptive']; await e.newTrial('t'); const first = await send(e, 't', 'investigate');
  await until(() => childStarted);
  assert.equal(e.state('t').requests[0].status, 'processing');
  await send(e, 't', 'followup'); await until(() => e.trial('t').visible.some(m => m.text === 'followup complete'));
  assert.equal(e.trial('t').requests[0].status, 'background');
  releaseChild(); await e.drain();
  assert.equal(e.trial('t').requests.find(r => r.id === first).status, 'completed');
  assert.equal(e.trial('t').children.length, 1);
  assert.ok(e.trial('t').visible.some(m => m.text === 'synthesis complete'));
  assert.equal(e.trial('t').requests[0].modelCalls, 3); await e.close();
});

test('direct followup queues behind active turn; errors and cancellations remain in records', async () => {
  let unblock, started = false;
  const gate = new Promise(r => { unblock = r; });
  const e = await lab(async ({ messages }) => { if (messages.at(-1).content === 'slow') { started = true; await gate; } if (messages.at(-1).content === 'fail') throw Object.assign(Error('failure'), { code: 'MODEL_FAILURE' }); return answer('done'); });
  e.db.blocks.lookup = ['direct']; await e.newTrial('t'); await send(e, 't', 'slow'); await until(() => started);
  await send(e, 't', 'followup'); await sleep(50); assert.equal(e.trial('t').requests[1].status, 'queued');
  unblock(); await e.drain(); await send(e, 't', 'fail'); await e.drain();
  assert.equal(e.trial('t').requests[2].status, 'failed'); assert.equal(e.trial('t').requests[2].usage[0].error, 'MODEL_FAILURE'); await e.close();
});

test('child guidance arriving during inference is read before finishing', async () => {
  let release, childStarted = false, childCalls = 0;
  const gate = new Promise(r => { release = r; });
  const e = await lab(async ({ system, messages }) => {
    if (system.includes('你负责分配给你的调查')) { childCalls++; if (childCalls === 1) { childStarted = true; await gate; } return answer(JSON.stringify(messages.at(-1))); }
    return messages.at(-1).content === 'investigate' ? fork(['goal']) : answer('done');
  });
  e.db.blocks.lookup = ['adaptive']; await e.newTrial('t'); await send(e, 't', 'investigate'); await until(() => childStarted);
  e.trial('t').children[0].guidance.push('new clarification'); release(); await e.drain();
  assert.equal(childCalls, 2); assert.match(e.trial('t').children[0].result, /new clarification/); await e.close();
});

test('restart marks unfinished requests interrupted without discarding evidence', async () => {
  const e = await lab(async () => answer('done')); await e.newTrial('t');
  e.db.trials.t.requests.push({ id: 'interrupted', status: 'running' }); await e.save(); await e.close();
  const restored = await new Experiment({ directory: e.directory, source, provider: { model: 'test' }, phase: 'calibration', modelFactory: () => ({ next: async () => answer('done') }) }).init();
  assert.equal(restored.trial('t').requests[0].status, 'interrupted'); await restored.close();
});

test('cancellation aborts inference, preserves status, and prevents unsafe continuation', async () => {
  let started = false;
  const e = await lab(async (_options, signal) => { started = true; await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error('cancelled'), { code: 'CANCELLED' })), { once: true })); return answer('never'); });
  e.db.blocks.lookup = ['direct']; await e.newTrial('t'); await send(e, 't'); await until(() => started);
  await e.cancel('t'); await e.drain(); assert.equal(e.trial('t').requests[0].status, 'cancelled');
  assert.equal(e.state('t').canSubmit, false); await assert.rejects(send(e, 't'), { code: 'TASK_INTERRUPTED' });
  assert.equal(e.state('t').messages.some(m => m.role === 'assistant'), false); await e.feedback('t', { quality: 'unsolved' }); await e.close();
});

test('at most two children per request and no fork tool in child scope', async () => {
  const e = await lab(async ({ system, messages, tools }) => {
    if (system.includes('你负责分配给你的调查')) { assert.equal(tools.some(t => t.name === 'fork_task'), false); return answer('evidence'); }
    return messages.at(-1).content === 'investigate' ? fork(['one', 'two', 'three']) : answer('done');
  });
  e.db.blocks.lookup = ['adaptive']; await e.newTrial('t'); await send(e, 't', 'investigate'); await e.drain();
  assert.equal(e.trial('t').children.length, 2);
  assert.match(JSON.stringify(await e.history.messages(e.trial('t').session)), /CHILD_LIMIT/); await e.close();
});

test('pinned real source and all map indexes resolve; host paths and symlinks are rejected', async () => {
  const pin = JSON.parse(await fs.readFile(path.join(here, 'pin.json'), 'utf8'));
  const map = codexMap(pin.commit), s = await new Source({ root: path.resolve(here, '../codex-learning-source'), commit: pin.commit, map }).init();
  const visit = n => { for (const file of n.files) assert.ok(s.files.has(file), file); n.children.forEach(visit); }; visit(map.root);
  assert.match((await s.read('README.md', 1, 10)).text, /Codex/);
  await assert.rejects(s.read('../local-coordinator-data/provider.json'), { code: 'INVALID_PATH' });
  await assert.rejects(s.read('C:/secret'), { code: 'INVALID_PATH' });
  assert.deepEqual((await s.call('list_files', { path: 'README.md' })).paths, ['README.md']);
  assert.ok((await s.call('search_code', { query: 'ThreadStore', path: 'codex-rs/thread-store/README.md' })).matches.length);
});
