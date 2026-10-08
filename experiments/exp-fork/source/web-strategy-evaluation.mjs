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
const pin = await readJSON(path.join(here, 'pin.json'));
const provider = await readJSON(path.join(here, '../local-coordinator-data/provider.json'));
const live = await readJSON(path.join(here, 'data/study/experiment.json'));
const history = new History(path.join(here, 'data/study/sessions'));
const messages = await history.messages(live.trials['seed'].session);
const boundary = messages.findIndex(m => m.role === 'user' && m.content === '我想知道codex这个记忆的底层有哪些文件');
if (boundary < 0) throw new Error('Missing benchmark prefix');
const prefix = messages.slice(0, boundary);
history.validate(prefix);
const source = await new Source({ root: path.join(here, '../codex-learning-source'), commit: pin.commit, map: codexMap(pin.commit) }).init();
const cases = [
  { id: 'single', children: 1, text: '请联网查询 OpenAI Codex CLI 官方文档：如何恢复已有会话，以及从已有会话分叉？最多3个简短要点，附实际检索到的官方链接。只研究公开网页，不读取本地源码。' },
  { id: 'comparison', children: 2, text: '请联网分别查 OpenAI Codex CLI 和 Anthropic Claude Code 的官方文档：它们如何恢复已有会话，以及从已有会话分叉？每个产品最多2个简短要点，附各自实际检索到的官方链接。只研究公开网页，不读取本地源码。' },
];
const offset = randomInt(2), order = [];
for (let repeat = 1; repeat <= 3; repeat++) for (const [c, item] of cases.entries()) {
  const arms = (repeat + c + offset) % 2 ? ['direct', 'fork'] : ['fork', 'direct'];
  for (const arm of arms) order.push({ ...item, repeat, arm });
}
const directory = path.join(here, 'web-strategy-evaluations', String(Date.now()));
const summary = { at: new Date().toISOString(), directory, model: provider.model, commit: pin.commit,
  provider: { baseUrl: provider.baseUrl, model: provider.model, thinking: provider.thinking, maxTokens: provider.maxTokens },
  prefixMessages: prefix.length, prefixBytes: Buffer.byteLength(JSON.stringify(prefix)),
  prefixHash: createHash('sha256').update(JSON.stringify(prefix)).digest('hex'), deadlineMs: 180000, order, runs: [],
  method: 'Two public-web queries, three repeats per arm, alternating paired order. Identical original pre-query history. Direct disables fork; fork arm adds explicit bounded delegation policy, exposes only fork_task and requests tool_choice on the first model request only. Real model generates delegation; normal engine creates and runs children and synthesizes. No synthetic model results. Non-fork first response fails the sample. No concurrent followup. Fresh MCP search adapter per run; provider caches not reset. Server final-answer latency, not browser latency. Failed or noncompliant runs retained. Local saved experiment, not cloud or active UI. Map writes denied. Earlier tool_choice-only pilot 1790536914609 was interrupted after failing to route; it is not a fork result.' };
await atomicWrite(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ directory, samples: order.length }));
for (const [i, item] of order.entries()) {
  const runDir = path.join(directory, `${i + 1}-${item.id}-${item.arm}`);
  const context = new AsyncLocalStorage(), traces = [], searches = [], rpc = [];
  let forceNext = item.arm === 'fork';
  const baseSearch = createWebSearch({ token: provider.token, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body), row = { start: Date.now(), method: body.method };
    rpc.push(row);
    try { const response = await fetch(url, options); row.status = response.status; return response; }
    finally { row.headersAt = Date.now(); }
  } });
  const webSearch = { definitions: baseSearch.definitions, call: async (input, options) => {
    const row = { start: Date.now(), input }; searches.push(row);
    try { const result = await baseSearch.call(input, options); row.result = result; return result; }
    catch (error) { row.error = error.code || 'SEARCH_FAILURE'; throw error; }
    finally { row.end = Date.now(); }
  } };
  const mapTools = createLearningMapTools(async (route, input) => {
    if (route !== '/map' || input !== undefined) throw Object.assign(new Error('Read-only benchmark'), { code: 'FORBIDDEN' });
    return { version: 'benchmark-fixed', document: source.map };
  });
  const e = new Experiment({ directory: runDir, source, provider, phase: 'calibration', mapTools, webSearch,
    modelFactory: signal => {
      const model = new CoordinatorModel({ ...provider, fetch: (url, options) => {
        if (forceNext) {
          forceNext = false;
          const body = JSON.parse(options.body);
          body.tool_choice = { type: 'tool', name: 'fork_task' };
          options = { ...options, body: JSON.stringify(body) };
        }
        return fetch(url, { ...options, signal: AbortSignal.any([signal, options.signal]) });
      } });
      return { next: async options => {
        const routing = forceNext;
        if (routing) options = { ...options, tools: options.tools.filter(t => t.name === 'fork_task') };
        const trace = { ...context.getStore(), start: Date.now(), firstTextAt: null, messageBytes: Buffer.byteLength(JSON.stringify(options.messages)),
          synthesis: typeof options.messages.at(-1)?.content === 'string' && options.messages.at(-1).content.startsWith('[后台调查结果') };
        traces.push(trace);
        try {
          const result = await model.next({ ...options, onText: async text => { if (text) trace.firstTextAt ||= Date.now(); await options.onText?.(text); } });
          Object.assign(trace, { stop: result.stop, usage: result.usage, tools: result.content.filter(b => b.type === 'tool_use').map(b => b.name) });
          if (routing && (result.stop !== 'tool_use' || !trace.tools.includes('fork_task') || trace.tools.some(t => t !== 'fork_task'))) throw Object.assign(new Error('Model did not follow fork routing'), { code: 'ROUTING_NONCOMPLIANCE' });
          return result;
        } catch (error) { trace.error = error.code || 'MODEL_FAILURE'; throw error; }
        finally { trace.end = Date.now(); }
      } };
    },
  });
  if (item.arm === 'fork') e.policy = `本次实验采用执行分身：第一步必须仅调用 fork_task，不在主会话搜索。${item.children === 1 ? '将整个单产品问题委派给1个分身。' : '同一响应调用两次 fork_task，分别委派 Codex CLI 和 Claude Code 的独立调查，每个分身只负责自己的产品。'}明确要求分身使用 web_search 查询官方文档，返回必要结论和真实来源链接，不读本地源码。收到结果后只做简短汇总，不重复搜索。`;
  await e.init();
  if (item.arm === 'direct' && e.db.fingerprint !== live.fingerprint) throw new Error('Direct configuration drift');
  const callModel = e.modelCall.bind(e);
  e.modelCall = (trial, request, session, child, tools) => context.run({ session, child: Boolean(child) }, () => callModel(trial, request, session, child, tools));
  await e.newTrial('t');
  const trial = e.trial('t'); trial.arm = item.arm === 'direct' ? 'direct' : 'adaptive';
  for (const message of prefix) await e.history.append(trial.session, message);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; e.cancel('t').catch(() => {}); }, summary.deadlineMs);
  try { await e.submit('t', { requestId: 'primary', text: item.text }); await e.drain(); }
  finally { clearTimeout(timer); await e.close(); }
  const events = (await fs.readFile(path.join(runDir, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const request = trial.requests[0];
  const answer = trial.visible.filter(m => m.role === 'assistant').map(m => m.text).join('\n');
  const searchEvents = events.filter(v => v.type === 'tool.call' && v.name === 'web_search');
  const run = { ...item, runDir, status: request.status, error: request.error, timedOut, readyMs: request.endedAt - request.receivedAt,
    modelCalls: request.modelCalls, toolCalls: request.toolCalls, searches: searches.length,
    successfulSearches: searches.filter(s => !s.error && s.result?.results?.length).length,
    searchMs: searches.reduce((s, r) => s + r.end - r.start, 0), searchErrors: searches.filter(s => s.error).map(s => s.error),
    parentSearches: searchEvents.filter(s => s.session === trial.session).length,
    forkMs: trial.children.reduce((s, c) => s + c.forkMs, 0),
    children: trial.children.map(c => ({ id: c.id, goal: c.goal, status: c.status, durationMs: c.endedAt - c.startedAt, forkMs: c.forkMs, result: c.result, error: c.error })),
    parentModelMs: traces.filter(t => !t.child).reduce((s, t) => s + t.end - t.start, 0),
    synthesisMs: traces.filter(t => t.synthesis).reduce((s, t) => s + t.end - t.start, 0), answer };
  summary.runs.push(run);
  await atomicWrite(path.join(runDir, 'timing.json'), JSON.stringify({ traces, searches, rpc }, null, 2));
  await atomicWrite(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ run: i + 1, case: item.id, arm: item.arm, status: run.status, seconds: +(run.readyMs / 1000).toFixed(2), calls: run.modelCalls, searches: run.searches, successfulSearches: run.successfulSearches, children: run.children.length, searchErrors: run.searchErrors }));
  if (run.error?.startsWith('MODEL_HTTP_') || run.error === 'ROUTING_NONCOMPLIANCE' || run.searchErrors.includes('SEARCH_AUTH')) {
    console.log('STOP: provider rejected access; evidence retained'); break;
  }
}
const mean = values => values.reduce((s, v) => s + v, 0) / values.length;
summary.aggregates = cases.flatMap(c => ['direct', 'fork'].map(arm => {
  const runs = summary.runs.filter(r => r.id === c.id && r.arm === arm);
  return { case: c.id, arm, n: runs.length, meanSec: mean(runs.map(r => r.readyMs / 1000)), rangeSec: runs.map(r => r.readyMs / 1000),
    modelCalls: mean(runs.map(r => r.modelCalls)), searches: mean(runs.map(r => r.searches)), searchSumSec: mean(runs.map(r => r.searchMs / 1000)),
    children: runs.map(r => r.children.length), errors: runs.filter(r => r.status !== 'completed' || r.searchErrors.length).length };
}));
await atomicWrite(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ complete: summary.runs.length === order.length, directory, aggregates: summary.aggregates }));
