import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { Source } from './source.mjs';
import { codexMap } from './map.mjs';
import { atomicWrite } from './history.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const directory = path.resolve(process.argv[2]);
const summary = JSON.parse(await fs.readFile(path.join(directory, 'summary.json')));
const source = await new Source({ root: path.join(here, '../codex-learning-source'), commit: summary.commit, map: codexMap(summary.commit) }).init();
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const median = a => { const b = a.toSorted((a, b) => a - b); return b.length ? (b[Math.floor((b.length - 1) / 2)] + b[Math.floor(b.length / 2)]) / 2 : null; };
const seconds = x => x == null ? null : +(x / 1000).toFixed(3);
const mergedDuration = intervals => {
  let end = -Infinity, total = 0;
  for (const [a, b] of intervals.toSorted((a, b) => a[0] - b[0])) { total += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
  return total;
};
const allCalls = [], rows = [], audit = [];
for (const run of summary.runs) {
  const calls = JSON.parse(await fs.readFile(path.join(run.runDir, 'timing.json')));
  allCalls.push(...calls.map(c => ({ ...c, arm: run.arm, case: run.id })));
  const db = JSON.parse(await fs.readFile(path.join(run.runDir, 'experiment.json')));
  const start = db.trials.t.requests[0].receivedAt;
  const end = Math.max(...db.trials.t.requests.map(r => r.endedAt));
  const childEnd = Math.max(0, ...db.trials.t.children.map(c => c.endedAt || 0));
  rows.push({ case: run.id, arm: run.arm, repeat: run.repeat,
    modelBusyFraction: mergedDuration(calls.map(c => [c.start, c.end])) / (end - start),
    postChildrenParentModelMs: childEnd ? calls.filter(c => c.request === 'primary' && !c.child && c.start >= childEnd).reduce((s, c) => s + c.end - c.start, 0) : 0,
    primary: run.requests.find(r => r.id === 'primary'), followup: run.requests.find(r => r.id === 'followup'),
    children: run.children, timedOut: run.timedOut,
  });
  for (const request of run.requests) {
    const links = [];
    marked.walkTokens(marked.lexer(request.answer), token => { if (token.type === 'link') links.push(token.href); });
    const issues = [];
    for (const link of links) {
      const url = new URL(link, 'http://benchmark.local');
      if (url.pathname !== '/experiment/source') continue;
      const file = url.searchParams.get('path'), line = url.searchParams.get('line');
      if (!source.files.has(file)) { issues.push({ link, reason: 'missing-file' }); continue; }
      if (line !== null && !/^[1-9][0-9]*$/.test(line)) { issues.push({ link, reason: 'invalid-line' }); continue; }
      if (line) {
        const data = await source.read(file, Number(line), 1);
        if (Number(line) > data.totalLines) issues.push({ link, reason: 'line-out-of-range' });
      }
    }
    audit.push({ case: run.id, arm: run.arm, repeat: run.repeat, request: request.id, chars: request.answer.length,
      links: links.length, issues, correctCommit: request.id !== 'followup' ? null : request.answer.includes(summary.commit.slice(0, 8)) });
  }
}
const aggregates = [];
for (const group of ['all', 'files', 'parallel']) for (const arm of ['direct', 'adaptive', 'forced']) {
  const selected = rows.filter(r => r.arm === arm && (group === 'all' || r.case === group));
  if (!selected.length) continue;
  aggregates.push({ group, arm, n: selected.length, successes: selected.filter(r => r.primary.status === 'completed').length,
    primaryMeanSec: seconds(mean(selected.map(r => r.primary.readyMs))), primaryMedianSec: seconds(median(selected.map(r => r.primary.readyMs))),
    primaryRangeSec: [Math.min(...selected.map(r => r.primary.readyMs)), Math.max(...selected.map(r => r.primary.readyMs))].map(seconds),
    followupMeanSec: seconds(mean(selected.map(r => r.followup.readyMs))), followupQueueMeanSec: seconds(mean(selected.map(r => r.followup.initialQueueMs))),
    forkedRuns: selected.filter(r => r.children.length).length, meanChildren: mean(selected.map(r => r.children.length)),
    modelCallsPrimary: mean(selected.map(r => r.primary.modelCalls)), toolsPrimary: mean(selected.map(r => r.primary.toolCalls)),
    toolMeanSec: seconds(mean(selected.map(r => r.primary.toolMs))), synthesisMeanSec: seconds(mean(selected.map(r => r.primary.synthesisMs))),
    postChildrenParentMeanSec: seconds(mean(selected.filter(r => r.children.length).map(r => r.postChildrenParentModelMs))),
    modelBusyFraction: mean(selected.map(r => r.modelBusyFraction)), streamWithheldMeanSec: seconds(mean(selected.map(r => r.primary.readyMs - r.primary.finalAnswerFirstTextMs).filter(Number.isFinite))),
  });
}
const children = rows.flatMap(r => r.children);
const analysis = { at: new Date().toISOString(), samples: rows.length, aggregates,
  calls: { n: allCalls.length, durationMeanSec: seconds(mean(allCalls.map(c => c.end - c.start))),
    firstContentMeanSec: seconds(mean(allCalls.map(c => Math.min(c.firstTextAt || Infinity, c.firstToolAt || Infinity) - c.start).filter(Number.isFinite))),
    inputTokenTotal: allCalls.reduce((s, c) => s + (c.usage?.input_tokens || 0), 0), cacheReadTotal: allCalls.reduce((s, c) => s + (c.usage?.cache_read_input_tokens || 0), 0),
    outputTokenTotal: allCalls.reduce((s, c) => s + (c.usage?.output_tokens || 0), 0) },
  children: { n: children.length, creationMeanMs: mean(children.map(c => c.forkMs)), creationMaxMs: children.length ? Math.max(...children.map(c => c.forkMs)) : null },
  audit, rows: rows.map(({ primary, followup, children, ...r }) => ({ ...r, primarySec: seconds(primary.readyMs), followupSec: seconds(followup.readyMs), children: children.length })) };
await atomicWrite(path.join(directory, 'analysis.json'), JSON.stringify(analysis, null, 2));
const labels = { direct: '不分身', adaptive: '当前自适应', forced: '加强委派提示（非程序强制）' };
const fmt = n => n == null ? '-' : n.toFixed(1);
const table = group => [
  '| 策略 | 样本数 | 原问题均值/秒 | 追问均值/秒 | 实际分身组数 | 原问题模型调用均值 | 无执行错误完成 |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...aggregates.filter(a => a.group === group).map(a => `| ${labels[a.arm]} | ${a.n} | ${fmt(a.primaryMeanSec)} | ${fmt(a.followupMeanSec)} | ${a.forkedRuns}/${a.n} | ${fmt(a.modelCallsPrimary)} | ${a.successes}/${a.n} |`),
].join('\n');
const busy = mean(rows.map(r => r.modelBusyFraction));
const withheld = rows.map(r => r.primary.readyMs - r.primary.finalAnswerFirstTextMs);
const notFound = summary.runs.flatMap(r => r.requests.flatMap(q => q.toolErrors)).filter(e => e.code === 'NOT_FOUND').length;
const modelQueue = summary.runs.flatMap(r => r.requests).reduce((s, r) => s + r.modelQueueMs, 0);
const report = `# 本地 GLM 分身策略计时评估

日期：2026-09-28（北京时间）。范围：原 41319 本地 GLM 实验版，不是云端 Claude Lab。使用本地保存的最新 engine、配置和历史，在隔离校准目录调用真实模型；不是通过原页面发送测试问题。结束时原 41319 服务读取不可用，未启动或修改它。
状态：${rows.length === summary.order.length ? '计划样本全部完成' : '阶段性记录，仍有样本运行'}。生产策略、页面、会话记录未修改。

## 方法

- ${rows.length} 组，每组一个原问题和第 5 秒提交的一个进度追问，共 ${rows.length * 2} 次用户请求。
- 两道固定问题：记忆底层文件定位；会话 fork 历史继承与 Phase 1 提取存储的跨模块调查。
- 三种策略，每题每策略两次；交错顺序，组间串行，组内保留真实并发。
- 使用当前 engine、Map 工具、Web Search 工具和同一 GLM-5.3 配置。thinking=${JSON.stringify(summary.provider.thinking)}，maxTokens=${summary.provider.maxTokens}。这是输出上限，不代表每次生成这么多。
- 每组恢复同一提问前 ${summary.prefixMessages} 条真实历史（${summary.prefixBytes} 字节），不包含本题旧答案；固定源码 ${summary.commit}。
- 不分身/自适应的配置指纹与当前运行版本一致；加强委派组只替换委派提示。提示不能保证执行，本次按真实 child 记录判断是否分身，不能把它称为程序硬强制。
- 数值是服务端完整答案就绪时间，不是浏览器首字或动画完成时间。追问从其自身提交时刻计时。
- 不清理供应商缓存；随机起点、交错轮次降低顺序偏差但不能消除缓存和服务波动。小样本，不给 P95 或显著性结论。
- 错误、超时和未按委派提示分身的样本均保留，不能将完成速度当成质量等价。

## 汇总

${table('all')}

### 文件定位

${table('files')}

### 跨模块调查

${table('parallel')}

## 慢在哪里

1. **多次模型往返，而非本地读文件。** 本轮共 ${allCalls.length} 次模型调用，每次平均 ${fmt(analysis.calls.durationMeanSec)} 秒；首段正文或工具开始事件平均等待 ${fmt(analysis.calls.firstContentMeanSec)} 秒。模型 API 活跃区间的并集平均覆盖各组总历时 ${(busy * 100).toFixed(1)}%。该时间含服务端处理和网络，不是纯 GPU 推理，现有遥测不能再拆开供应商排队、网络和计算。
2. **分身创建几乎免费，但分派和汇总不免费。** 共 ${children.length} 个分身，创建均值 ${fmt(analysis.children.creationMeanMs)} 毫秒，最大 ${fmt(analysis.children.creationMaxMs)} 毫秒；另有主会话先生成分派、分身多轮检索、主会话汇总的模型耗时。不能把并行分身耗时简单相加当作用户等待。
3. **调查范围扩大和错误恢复会重复劳动。** 本轮有 ${notFound} 次 NOT_FOUND 工具错误；虽然失败工具本身很快，修正路径会再增加模型往返。达到 STEP_LIMIT 的分身只记录错误、不回传中间结果，主会话会重新核查。具体失败样本、原始回答和工具轨迹都保留在 summary.json 和各组目录。
4. **追问是否排队取决于主会话是否真正让出执行。** direct 或 adaptive 未 fork 时，原问题整个工具循环占用主会话；追问只能排队。实际 fork 后，主会话才可处理进度追问，可能还先调用 list_background 再回答，多一次模型往返。
5. **页面没有接通真正的正文流。** modelCall 的 onText 只记时间，完整答案在 finish 才进入 visible；UI 每 700ms 轮询，拿到终稿后再分段播放。最终答案首段正文到完整答案就绪，本轮平均还相差 ${fmt(seconds(mean(withheld)))} 秒，范围 ${fmt(seconds(Math.min(...withheld)))}–${fmt(seconds(Math.max(...withheld)))} 秒。该值是流式展示可能提前的服务器时间窗口，不是浏览器实测收益。
6. **本地并发槽不是本轮瓶颈。** 所有请求的模型槽排队总计 ${fmt(modelQueue)} 毫秒；供应商内部排队未知。thinking 已关闭，不能把慢归咎于已启用的深度思考。长前缀仍会在每次模型请求中展开并发送，虽然本地 fork 只保存引用；缓存命中不等于一次调查只需一次模型请求。

## 策略评价

- 当前策略偏向简单查询直接处理、跨模块并行调查才 fork。分身对“保持可对话”有效，但本次样本未证明能更快交付最终答案。
- 实验分组是在首次请求时按会话分配并固定，不是逐条 query 自动切换。原有长会话被分到 direct，后续复杂任务仍无 fork 工具。
- 加强提示不能替代程序约束。本轮需要按实际触发率解释数据，而不能假定提示中写“必须”就已分身。

## 优先改进方向（尚未实施）

1. 将模型正文增量接到 UI；进度显示用现有工具事件，避免多调一次模型只是报告进度。
2. 用版本绑定的 Map 文件索引定位、合并独立只读查询、复用同 commit 的已验证证据，减少模型往返。不要把旧文档描述直接当实现事实。
3. 保留短问题直答。耗时执行与接待分离；分身目标限定到明确子问题和证据范围，避免扩大任务。单分身已满足用户问题时可直接交付，多分身才做必要汇总。
4. 分身失败或预算耗尽时返回带不确定性标记的阶段证据，而非只有错误码；保留人工复核，不将部分结果伪装成完成。

## 质量与限制

- 全部引用做了文件存在与行号范围检查：${audit.reduce((s, a) => s + a.issues.length, 0)} 个机械问题；这不证明引用支持对应语义。
- 进度追问的 commit 前 8 位检查：${audit.filter(a => a.correctCommit === true).length}/${audit.filter(a => a.correctCommit !== null).length} 正确。
- 人工抽查发现文件定位回答仍有把 memories/write/src/storage.rs 说成 state DB 存取的旧误述；该文件实际重建 raw_memories.md、同步 rollout summary 文件。不同策略均不能仅凭完成和耗时宣称质量通过。
- 跨模块回答覆盖 paginated fork 历史边界、Phase 1 过滤/模型提取/入库等关键点，但不是全答案独立盲评，也不能泛化到所有 legacy fork 路径。
- 本轮以源码学习任务为主，未衡量网页搜索密集任务、多人同时使用、不同模型或网络环境。没有实测支持“压缩上下文必然降低多少秒”。

## 证据

- summary.json：预先写入的顺序、配置指纹、每次请求和回答、分身与失败记录。
- analysis.json：分组统计、首段时间、引用检查。
- 各组 timing.json：每次模型调用开始/结束、首段正文/工具事件、输入字节、缓存和输出 token。
- 各组 events.jsonl、experiment.json、sessions/：调用、调度及完整回溯记录。
- 实现依据：engine.mjs 的 submit/runParent/modelCall/runChild/finish，history.mjs 的 messages，ui.js 的 refresh/revealAnswer。
- 仅新增忽略目录内的实验与分析脚本，不改正在运行的策略或产品代码。
- 实验与分析脚本语法检查通过；npm test 仍被缺失或变更的安全扫描器阻断，未绕过。真实计时试验与产品全量测试是不同证据。
`;
await atomicWrite(path.join(directory, 'REPORT.md'), report);
console.log(JSON.stringify({ ...analysis, audit: audit.filter(a => a.issues.length || a.correctCommit === false) }, null, 2));
