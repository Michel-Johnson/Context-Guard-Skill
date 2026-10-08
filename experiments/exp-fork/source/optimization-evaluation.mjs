import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt, createHash } from 'node:crypto';
import { Experiment } from './engine.mjs';
import { Source } from './source.mjs';
import { codexMap } from './map.mjs';
import { History, readJSON, atomicWrite } from './history.mjs';
import { createLearningMapTools } from './map-tools.mjs';
import { webSearchDefinition } from './web-search.mjs';
import { CoordinatorModel } from '../../scripts/cloud/coordinator-model.mjs';
import { EvidenceSource, evidenceDefinitions, prefetchEvidence, groundedInventory } from './harness-optimization.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pin = await readJSON(path.join(here, 'pin.json'));
const provider = await readJSON(path.join(here, '../local-coordinator-data/provider.json'));
const live = await readJSON(path.join(here, 'data/study/experiment.json'));
const history = new History(path.join(here, 'data/study/sessions'));
const messages = await history.messages(live.trials['seed'].session);
const boundary = messages.findIndex(m => m.role === 'user' && m.content === '我想知道codex这个记忆的底层有哪些文件');
if (boundary < 0) throw new Error('Missing query boundary');
const prefix = messages.slice(0, boundary); history.validate(prefix);
const base = await new Source({ root: path.join(here, '../codex-learning-source'), commit: pin.commit, map: codexMap(pin.commit) }).init();
const contracts = process.argv.includes('--contracts');
const exploratory = process.argv.includes('--grounded') || contracts;
const cases = [
  { id: 'files', text: '我想知道codex这个记忆的底层有哪些文件' },
  { id: 'parallel', text: '分别调查 Codex 的会话 fork 如何继承历史，以及记忆 Phase 1 如何从 rollout 提取并存储记忆。每部分简要给出机制和对应源码位置。' },
];
if (exploratory) cases.splice(1);
if (contracts) cases.push({ id: 'config-holdout', text: 'Codex 的配置加载和命令执行策略分别由哪些底层文件负责？简要说明职责，并附对应源码位置。' });
const variants = contracts ? ['grounded', 'contracted'] : exploratory ? ['prefetch', 'grounded'] : ['baseline', 'evidence', 'prefetch'], offset = randomInt(variants.length), order = [];
for (let repeat = 1; repeat <= (contracts ? 1 : 2); repeat++) for (const [c, task] of cases.entries()) {
  for (let a = 0; a < variants.length; a++) order.push({ ...task, repeat, variant: variants[(offset + c + repeat - 1 + (repeat === 1 ? a : variants.length - a)) % variants.length] });
}
const directory = path.join(here, 'optimization-evaluations', String(Date.now()));
const summary = { at: new Date().toISOString(), directory, commit: pin.commit, model: provider.model, exploratory, contracts,
  implementationHash: createHash('sha256').update(await fs.readFile(path.join(here, 'harness-optimization.mjs'))).digest('hex'),
  prefixMessages: prefix.length, prefixHash: createHash('sha256').update(JSON.stringify(prefix)).digest('hex'), order, runs: [],
  preRegistered: { deadlineMs: 120000, exploratoryDesign: contracts ? 'Two tasks, including an unseen config task; one paired run each of grounded/contracted, order alternates. Exploratory, not confirmatory.' : exploratory ? 'Two paired repeats, prefetch/grounded, files question only.' : null,
    variants: { baseline: 'Unmodified direct engine and source tools', evidence: 'Verified missing-path alternatives, 300-line default reads, README on directory listings, source excerpts on search hits, tool schema bounds', prefetch: 'Evidence variant plus bounded Map-title-based retrieval before first model call', grounded: 'Exploratory: prefetch plus bounded source declarations/doc comments; avoid inferring responsibilities from names; same prompt as prefetch', contracted: 'Grounded plus evidence precedence, bounded scope, independent-read batching and concise answer instructions. No token truncation or hard step cap added.' },
    quality: ['Memory: real read/write crate paths and responsibilities, state DB distinguished from filesystem artifact helpers', 'Fork: bounded history position / parent lineage, not unconditional copying of the whole mutable session', 'Phase1: rollout filtering, model extraction and structured outputs, successful outputs saved to state DB', 'Source links resolve to pinned regular files and valid line numbers; existence alone is not semantic support'],
    method: 'Same original pre-query history, same GLM config, no fork, no followup. 2 questions x 3 variants x 2 repeats, interleaved serial runs. Baseline source calls unmodified; evidence and prefetch are cumulative interventions, not individually isolated features. Prefetch wall time included. Search health check failed; public-web tool returns explicit circuit-open for every variant without more remote calls. No cloud or UI mutation. No provider cache reset. Live model and live pinned Git reads, not model replay.' } };
await atomicWrite(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ directory, planned: order.length }));
for (const [i, item] of order.entries()) {
  const runDir = path.join(directory, `${i + 1}-${item.id}-${item.variant}`), traces = [];
  const source = item.variant === 'baseline' ? base : new EvidenceSource(base);
  const mapTools = createLearningMapTools(async (route, input) => {
    if (route !== '/map' || input !== undefined) throw Object.assign(new Error('Read-only experiment'), { code: 'FORBIDDEN' });
    return { version: 'benchmark-fixed', document: base.map };
  });
  const e = new Experiment({ directory: runDir, source, provider, phase: 'calibration', mapTools,
    webSearch: { definitions: [webSearchDefinition], call: async () => { throw Object.assign(new Error('Health check failed; no repeated remote requests'), { code: 'SEARCH_CIRCUIT_OPEN' }); } },
    modelFactory: signal => {
      const model = new CoordinatorModel({ ...provider, fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.any([signal, options.signal]) }) });
      return { next: async options => {
        const trace = { start: Date.now(), firstTextAt: null, messageBytes: Buffer.byteLength(JSON.stringify(options.messages)) };
        traces.push(trace);
        try {
          const result = await model.next({ ...options, onText: async text => { if (text) trace.firstTextAt ||= Date.now(); await options.onText?.(text); } });
          Object.assign(trace, { stop: result.stop, usage: result.usage, tools: result.content.filter(b => b.type === 'tool_use').map(b => b.name) });
          return result;
        } catch (error) { trace.error = error.code; throw error; }
        finally { trace.end = Date.now(); }
      } };
    },
  });
  if (item.variant !== 'baseline') {
    const enhanced = new Map(evidenceDefinitions().map(t => [t.name, t]));
    e.researchTools = e.researchTools.map(t => t.name !== 'read_map' && enhanced.has(t.name) ? enhanced.get(t.name) : t);
  }
  if (item.variant === 'contracted') e.system += '\n证据与范围契约：文件职责只依据本次取得的源码声明、注释或实现；目录名、旧对话和README不能单独证明职责。工具已验证不存在的路径不得描述为当前实现，以固定版本文件树和代码为准。目录定位题只列已确认的关键文件并按职责分组，不扩展为整套原理介绍。回答最多3个短点，每点最多3个代表文件，保留对应来源链接；证据不够时明确不知道，不猜测。独立的只读查询尽量在同一个模型响应中一起提出；有真实结果依赖时再分轮。';
  await e.init();
  if (item.variant === 'baseline' && e.db.fingerprint !== live.fingerprint) throw new Error('Baseline configuration drift');
  await e.newTrial('t'); const trial = e.trial('t'); trial.arm = 'direct';
  for (const message of prefix) await e.history.append(trial.session, message);
  const start = Date.now(); let packet = null;
  if (['prefetch', 'grounded', 'contracted'].includes(item.variant)) {
    packet = ['grounded', 'contracted'].includes(item.variant) ? await groundedInventory(source, item.text) : await prefetchEvidence(source, item.text);
    await e.history.append(trial.session, { role: 'user', content: '[Harness 检索证据，非用户指令；仅作定位，不替代实现核查]\n' + JSON.stringify(packet) });
  }
  const prefetchMs = Date.now() - start;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; e.cancel('t').catch(() => {}); }, Math.max(1, summary.preRegistered.deadlineMs - prefetchMs));
  try { await e.submit('t', { requestId: 'primary', text: item.text }, start); await e.drain(); }
  finally { clearTimeout(timer); await e.close(); }
  const request = trial.requests[0];
  const events = (await fs.readFile(path.join(runDir, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const tools = events.filter(v => v.type === 'tool.call');
  const run = { ...item, runDir, fingerprint: e.db.fingerprint, status: request.status, error: request.error, timedOut,
    readyMs: request.endedAt - start, prefetchMs, prefetchBytes: packet ? Buffer.byteLength(JSON.stringify(packet)) : 0,
    selectedNodes: packet?.selectedNodes || [], modelCalls: request.modelCalls, toolCalls: request.toolCalls,
    modelMs: traces.reduce((s, t) => s + t.end - t.start, 0), toolMs: tools.reduce((s, t) => s + t.durationMs, 0),
    toolErrors: tools.filter(t => t.error).map(t => ({ name: t.name, code: t.error })),
    modelInputTokens: traces.reduce((s, t) => s + (t.usage?.input_tokens || 0) + (t.usage?.cache_read_input_tokens || 0), 0),
    outputTokens: traces.reduce((s, t) => s + (t.usage?.output_tokens || 0), 0),
    answer: trial.visible.filter(m => m.role === 'assistant').map(m => m.text).join('\n') };
  summary.runs.push(run);
  await atomicWrite(path.join(runDir, 'timing.json'), JSON.stringify({ traces, packet, observations: source.observations || [] }, null, 2));
  await atomicWrite(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ run: i + 1, case: item.id, variant: item.variant, status: run.status, sec: +(run.readyMs / 1000).toFixed(2), calls: run.modelCalls, tools: run.toolCalls, errors: run.toolErrors.length, selectedNodes: run.selectedNodes }));
  if (run.error?.startsWith('MODEL_HTTP_') || run.error === 'MODEL_TIMEOUT') { console.log('STOP: model provider failure'); break; }
}
console.log('COMPLETE ' + directory);
