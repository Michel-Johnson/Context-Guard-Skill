import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomInt } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Experiment } from './engine.mjs';
import { Source } from './source.mjs';
import { codexMap } from './map.mjs';
import { History, readJSON, atomicWrite } from './history.mjs';
import { createLearningMapTools } from './map-tools.mjs';
import { createWebSearch } from './web-search.mjs';
import { CoordinatorModel } from '../../scripts/cloud/coordinator-model.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pin = await readJSON(path.join(here, 'pin.json'));
const provider = await readJSON(path.join(here, '../local-coordinator-data/provider.json'));
const live = await readJSON(path.join(here, 'data/study/experiment.json'));
const original = new History(path.join(here, 'data/study/sessions'));
const messages = await original.messages(live.trials['seed'].session);
const boundary = messages.findIndex(m => m.role === 'user' && m.content === '我想知道codex这个记忆的底层有哪些文件');
if (boundary < 0) throw new Error('Missing pre-query history');
const prefix = messages.slice(0, boundary); original.validate(prefix);
const source = await new Source({ root: path.join(here, '../codex-learning-source'), commit: pin.commit, map: codexMap(pin.commit) }).init();
const directory = path.join(here, 'strategy-evaluations', String(Date.now()));
const cases = [
  { id: 'files', text: '我想知道codex这个记忆的底层有哪些文件' },
  { id: 'parallel', text: '分别调查 Codex 的会话 fork 如何继承历史，以及记忆 Phase 1 如何从 rollout 提取并存储记忆。每部分简要给出机制和对应源码位置。' },
];
const arms = ['direct', 'adaptive', 'forced'];
const offset = randomInt(3), order = [];
for (let repeat = 1; repeat <= 2; repeat++) for (let c = 0; c < cases.length; c++) {
  const rotation = (offset + c + repeat - 1) % 3;
  for (let a = 0; a < 3; a++) order.push({ ...cases[c], repeat, arm: arms[(rotation + (repeat === 1 ? a : 3 - a)) % 3] });
}
const forcedPolicy = '本次实验策略：遇到需要读取源码的调查任务，第一步必须调用 fork_task，将完整调查或独立子问题交给分身；不要在主会话先查源码。可独立拆分的两个调查分别交给两个分身，同一模型响应批次创建。进度追问直接依据已有状态简短回答，不为进度追问新建分身，也不要等待分身完成才回应。后台结果到达后只做必要的简短汇总，不重复调查。';
const followup = '现在查到什么？用一句话报告进度，并告诉我当前源码 commit 的前8位，原来的调查继续。';
const summary = { at: new Date().toISOString(), directory, model: provider.model, commit: pin.commit, liveFingerprint: live.fingerprint,
  provider: { baseUrl: provider.baseUrl, model: provider.model, maxTokens: provider.maxTokens, thinking: provider.thinking, timeoutMs: provider.timeoutMs },
  prefixMessages: prefix.length, prefixBytes: Buffer.byteLength(JSON.stringify(prefix)), prefixHash: createHash('sha256').update(JSON.stringify(prefix)).digest('hex'),
  forcedPolicy, followup, followupAfterMs: 5000, deadlineMs: 180000, order, runs: [],
  methodology: 'Current local engine with Map and web-search tools, same pre-query history and source. Fresh sessions; interleaved balanced strategy order, two repeats per question/strategy. Follow-up at 5s in the same conversation. Runs serial; within-run concurrency retained. No UI timing claimed. Provider cache not reset. Tool writes prohibited in isolated benchmark. Forced arm changes only delegation policy, not query or model. Completion and link validity are not proof of correctness.' };
await atomicWrite(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ directory, samples: order.length, order: order.map(x => x.id + ':' + x.arm) }));
for (const [index, item] of order.entries()) {
  const runDir = path.join(directory, `${index + 1}-${item.id}-${item.arm}`), traces = [], context = new AsyncLocalStorage();
  const mapTools = createLearningMapTools(async (route, input) => {
    if (route !== '/map' || input !== undefined) throw Object.assign(new Error('Benchmark is read-only'), { code: 'FORBIDDEN' });
    return { version: 'benchmark-fixed', document: source.map };
  });
  const e = new Experiment({ directory: runDir, source, provider, phase: 'calibration', mapTools, webSearch: createWebSearch({ token: provider.token }),
    modelFactory: signal => {
      const model = new CoordinatorModel({ ...provider, fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.any([signal, options.signal]) }) });
      return { next: async options => {
        const trace = { ...context.getStore(), start: Date.now(), firstTextAt: null, firstToolAt: null,
          systemChars: options.system.length, messageBytes: Buffer.byteLength(JSON.stringify(options.messages)), messages: options.messages.length,
          synthesis: typeof options.messages.at(-1)?.content === 'string' && options.messages.at(-1).content.startsWith('[后台调查结果') };
        traces.push(trace);
        try {
          const result = await model.next({ ...options, onText: async text => { if (text) trace.firstTextAt ||= Date.now(); await options.onText?.(text); }, onToolStart: async name => { trace.firstToolAt ||= Date.now(); await options.onToolStart?.(name); } });
          Object.assign(trace, { stop: result.stop, usage: result.usage, tools: result.content.filter(b => b.type === 'tool_use').map(b => b.name) });
          return result;
        } catch (error) { trace.error = error.code || 'MODEL_FAILURE'; throw error; }
        finally { trace.end = Date.now(); }
      } };
    },
  });
  if (item.arm === 'forced') e.policy = forcedPolicy;
  await e.init();
  if (item.arm !== 'forced' && e.db.fingerprint !== live.fingerprint) throw new Error('Benchmark configuration differs from current live configuration');
  const modelCall = e.modelCall.bind(e);
  e.modelCall = (trial, request, session, child, tools) => context.run({ request: request.id, session, child: Boolean(child) }, () => modelCall(trial, request, session, child, tools));
  await e.newTrial('t'); const trial = e.trial('t'); trial.arm = item.arm === 'direct' ? 'direct' : 'adaptive';
  for (const message of prefix) await e.history.append(trial.session, message);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; e.cancel('t').catch(() => {}); }, summary.deadlineMs);
  try {
    await e.submit('t', { requestId: 'primary', text: item.text });
    await sleep(summary.followupAfterMs);
    await e.submit('t', { requestId: 'followup', text: followup });
    await e.drain();
  } finally { clearTimeout(timer); await e.close(); }
  const events = (await fs.readFile(path.join(runDir, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const rows = trial.requests.map(request => {
    const calls = traces.filter(t => t.request === request.id), metrics = request.usage;
    const tools = events.filter(event => event.type === 'tool.call' && event.request === request.id);
    const parentFinals = calls.filter(t => !t.child && t.stop === 'end_turn' && t.firstTextAt);
    return { id: request.id, status: request.status, readyMs: request.endedAt - request.receivedAt,
      initialQueueMs: request.startedAt - request.receivedAt, finalAnswerFirstTextMs: parentFinals.length ? parentFinals.at(-1).firstTextAt - request.receivedAt : null,
      modelCalls: request.modelCalls, modelMs: metrics.reduce((s, c) => s + c.durationMs, 0), modelQueueMs: metrics.reduce((s, c) => s + c.queueMs, 0),
      toolCalls: request.toolCalls, toolMs: tools.reduce((s, c) => s + c.durationMs, 0), toolErrors: tools.filter(c => c.error).map(c => ({ name: c.name, code: c.error })),
      parentModelMs: metrics.filter(c => !c.child).reduce((s, c) => s + c.durationMs, 0), childModelMs: metrics.filter(c => c.child).reduce((s, c) => s + c.durationMs, 0),
      synthesisMs: calls.filter(t => t.synthesis).reduce((s, t) => s + t.end - t.start, 0),
      outputTokens: metrics.reduce((s, c) => s + (c.usage?.output_tokens || 0), 0),
      cacheReadTokens: metrics.reduce((s, c) => s + (c.usage?.cache_read_input_tokens || 0), 0),
      uncachedInputTokens: metrics.reduce((s, c) => s + (c.usage?.input_tokens || 0), 0),
      answer: trial.visible.filter(m => m.role === 'assistant' && m.requestId === request.id).map(m => m.text).join('\n') };
  });
  const run = { ...item, runDir, fingerprint: e.db.fingerprint, timedOut, requests: rows,
    children: trial.children.map(c => ({ id: c.id, request: c.request, goal: c.goal, status: c.status, forkMs: c.forkMs, queueMs: c.startedAt - c.createdAt, durationMs: c.endedAt - c.startedAt, result: c.result, error: c.error })) };
  summary.runs.push(run);
  await atomicWrite(path.join(runDir, 'timing.json'), JSON.stringify(traces, null, 2));
  await atomicWrite(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ run: index + 1, case: item.id, arm: item.arm, children: run.children.length, results: rows.map(r => ({ id: r.id, status: r.status, ms: r.readyMs, calls: r.modelCalls, tools: r.toolCalls })) }));
}
console.log('COMPLETE ' + directory);
