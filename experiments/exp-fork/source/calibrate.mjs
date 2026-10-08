import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Experiment, classify } from './engine.mjs';
import { Source } from './source.mjs';
import { codexMap } from './map.mjs';
import { readJSON } from './history.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), pin = await readJSON(path.join(here, 'pin.json'));
const source = await new Source({ root: path.resolve(here, '../codex-learning-source'), commit: pin.commit, map: codexMap(pin.commit) }).init();
const provider = await readJSON(path.resolve(here, '../local-coordinator-data/provider.json'));
const directory = path.join(here, 'calibration-runs', String(Date.now()));
const e = await new Experiment({ directory, source, provider, phase: 'calibration' }).init();
const question = '这是后台调查链路校准：请用 fork_task 分别安排两项独立调查。第一项只读 codex-rs/thread-store/src/local/paginated_fork.rs 的前 80 行，概括这个文件的职责；第二项只读 codex-rs/core/src/agent/control/spawn.rs 的前 80 行，概括职责。每项各一句话附源码链接，最终合并为两句话。不要扩大阅读范围。';
e.db.blocks[classify(question)] = ['adaptive']; await e.newTrial('fork-calibration');
const timer = setTimeout(() => { console.log('Calibration timeout; preserving failure'); e.close(); }, 240000);
try {
  await e.submit('fork-calibration', { requestId: 'first', text: question });
  const deadline = Date.now() + 90000;
  while (!e.trial('fork-calibration').children.length && Date.now() < deadline && e.state('fork-calibration').processing) await new Promise(r => setTimeout(r, 300));
  if (e.trial('fork-calibration').children.length) await e.submit('fork-calibration', { requestId: 'followup', text: '补充一个独立小问题：固定的源码 commit 是什么？直接从当前上下文回答即可。之前的调查继续。' });
  await e.drain();
  const trial = e.trial('fork-calibration');
  console.log(JSON.stringify({ directory, children: trial.children.map(c => ({ status: c.status, forkMs: c.forkMs, error: c.error })), requests: trial.requests.map(r => ({ id: r.id, status: r.status, elapsedMs: r.endedAt - r.receivedAt, backgroundAtArrival: r.backgroundAtArrival, modelCalls: r.modelCalls, toolCalls: r.toolCalls })), answers: trial.visible.filter(m => m.role === 'assistant').map(m => m.text) }, null, 2));
  if (trial.children.length !== 2 || trial.children.some(c => c.status !== 'completed') || trial.requests.some(r => r.status !== 'completed')) process.exitCode = 1;
} finally { clearTimeout(timer); await e.close(); }
