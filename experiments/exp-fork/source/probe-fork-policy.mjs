import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { Experiment, classify } from './engine.mjs';
import { Source } from './source.mjs';
import { codexMap } from './map.mjs';
import { readJSON, atomicWrite } from './history.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pin = await readJSON(path.join(here, 'pin.json'));
const provider = await readJSON(path.resolve(here, '../local-coordinator-data/provider.json'));
const study = await readJSON(path.join(here, 'data/study/experiment.json'));
const cases = [
  { id: 'lookup', text: '我想知道codex这个记忆的底层有哪些文件' },
  { id: 'single-flow', text: 'Codex 的记忆 Phase 1 如何从一条 rollout 提取记忆？请说明输入过滤、模型提取和结果存储这三个步骤，并给出对应源码位置。' },
  { id: 'cross-module', text: '请从会话启动入口追踪 Codex 记忆生成的完整调用链：何时调度 Phase 1、如何认领任务和避免重复执行、Phase 2 如何汇总并写入文件，以及中途失败后如何恢复。请结合调度、数据库、文件存储和测试代码核对，并指出哪些结论还缺少证据。' },
  { id: 'independent', text: '我想同时了解 Codex 的三个独立机制：记忆生成如何落盘、fork 会话如何继承历史、工具执行如何进行审批。请分别查源码，每项给出核心入口、关键流程和一处测试依据，最后简要比较它们的状态保存方式。' },
];
const control = { id: 'explicit-control', text: '请开两个分身分别调查两个独立问题：一个只读 codex-rs/thread-store/src/local/paginated_fork.rs 的前80行，另一个只读 codex-rs/core/src/agent/control/spawn.rs 的前80行，各概括文件职责并附源码链接，最终汇总为两句话。' };
function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
const order = [1, 2].flatMap(repeat => shuffled(cases).map(c => ({ ...c, repeat })));
order.push({ ...control, repeat: 1 });
const directory = path.join(here, 'policy-probes', String(Date.now()));
const summary = { createdAt: new Date().toISOString(), commit: pin.commit,
  fingerprint: study.fingerprint, context: 'fresh session for every run',
  timeoutMs: 240000, order, runs: [] };
await atomicWrite(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ directory, order: order.map(c => `${c.id}-${c.repeat}`) }));
for (const [index, item] of order.entries()) {
  const runDirectory = path.join(directory, `${index + 1}-${item.id}-${item.repeat}`);
  const source = await new Source({ root: path.resolve(here, '../codex-learning-source'), commit: pin.commit, map: codexMap(pin.commit) }).init();
  const e = await new Experiment({ directory: runDirectory, source, provider, phase: 'calibration' }).init();
  let timer, timedOut = false, closeJob;
  try {
    if (e.db.fingerprint !== summary.fingerprint) throw new Error('Configuration differs from live policy');
    await e.newTrial('probe');
    e.db.blocks[classify(item.text)] = ['adaptive'];
    timer = setTimeout(() => {
      timedOut = true;
      console.log(JSON.stringify({ case: item.id, repeat: item.repeat, timeout: true }));
      closeJob = e.close();
    }, summary.timeoutMs);
    await e.submit('probe', { requestId: 'query', text: item.text });
    await e.drain();
    if (closeJob) await closeJob;
    const trial = e.trial('probe'), r = trial.requests[0];
    const events = (await fs.readFile(path.join(runDirectory, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    const firstForkIndex = events.findIndex(row => row.type === 'tool.call' && row.name === 'fork_task' && !row.error);
    const beforeFork = firstForkIndex < 0 ? [] : events.slice(0, firstForkIndex);
    const result = { run: index + 1, case: item.id, repeat: item.repeat,
      status: r.status, error: r.error || null, timedOut,
      readyMs: r.endedAt ? r.endedAt - r.receivedAt : null,
      forks: trial.children.length,
      firstForkDecisionMs: firstForkIndex < 0 ? null : Date.parse(events[firstForkIndex].at) - r.receivedAt,
      rootModelCallsAtFirstFork: firstForkIndex < 0 ? null : beforeFork.filter(row => row.type === 'model.call' && !row.child).length,
      rootSourceCallsBeforeFirstFork: firstForkIndex < 0 ? null : beforeFork.filter(row => row.type === 'tool.call' && row.session === trial.session && !['fork_task', 'list_background', 'guide_background'].includes(row.name)).length,
      modelCalls: r.modelCalls, toolCalls: r.toolCalls,
      children: trial.children.map(c => ({ goal: c.goal, status: c.status, forkMs: c.forkMs, error: c.error || null })),
      usage: r.usage,
      answers: trial.visible.filter(m => m.role === 'assistant').map(m => m.text),
    };
    summary.runs.push(result);
    await atomicWrite(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ ...result, children: undefined, usage: undefined, answers: undefined }));
  } finally { clearTimeout(timer); await e.close(); }
}
console.log(JSON.stringify({ directory, aggregates: [...cases, control].map(c => {
  const runs = summary.runs.filter(r => r.case === c.id);
  return { case: c.id, runs: runs.length, forked: runs.filter(r => r.forks > 0).length,
    completed: runs.filter(r => r.status === 'completed').length,
    readyMs: runs.map(r => r.readyMs), forks: runs.map(r => r.forks) };
}) }));
