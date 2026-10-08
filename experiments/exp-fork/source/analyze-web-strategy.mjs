import fs from 'node:fs/promises';
import path from 'node:path';
import { readJSON, atomicWrite } from './history.mjs';

const dir = path.resolve(process.argv[2]);
const summary = await readJSON(path.join(dir, 'summary.json'));
const mean = a => a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0;
const union = intervals => {
  let total = 0, end = 0;
  for (const [a, b] of intervals.sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, b - Math.max(end, a)); end = Math.max(end, b);
  }
  return total;
};
const rows = [], allSearches = [], allModels = [], allChildren = [];
for (const r of summary.runs) {
  const timing = await readJSON(path.join(r.runDir, 'timing.json'));
  allSearches.push(...timing.searches); allModels.push(...timing.traces); allChildren.push(...r.children);
  const urls = [...r.answer.matchAll(/https?:\/\/[^\s)\]>]+/g)].map(m => m[0]);
  const retrieved = new Set(timing.searches.flatMap(s => s.result?.results?.map(x => x.url) || []));
  const ownSearches = timing.searches.filter(s => !s.error);
  rows.push({ ...r, citedUrls: [...new Set(urls)], unreturnedUrls: [...new Set(urls.filter(u => !retrieved.has(u)))],
    emptySearches: ownSearches.filter(s => !s.result?.results?.length).length,
    modelUnionMs: union(timing.traces.map(t => [t.start, t.end])),
    searchUnionMs: union(timing.searches.map(t => [t.start, t.end])),
    synthesisCalls: timing.traces.filter(t => t.synthesis).length,
  });
}
const stats = ['single', 'comparison'].flatMap(id => ['direct', 'fork'].map(arm => {
  const values = rows.filter(r => r.id === id && r.arm === arm);
  const times = values.map(r => r.readyMs / 1000).sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  return { id, arm, n: values.length, meanSec: mean(times), medianSec: times.length % 2 ? times[mid] : mean(times.slice(Math.max(0, mid - 1), mid + 1)), minSec: times[0], maxSec: times.at(-1),
    completedMeanSec: mean(values.filter(r => r.answer && r.status.startsWith('completed')).map(r => r.readyMs / 1000)),
    completedN: values.filter(r => r.answer && r.status.startsWith('completed')).length,
    timeouts: values.filter(r => r.timedOut).length,
    modelCalls: mean(values.map(r => r.modelCalls)), searches: mean(values.map(r => r.searches)),
    searchSumSec: mean(values.map(r => r.searchMs / 1000)), searchUnionSec: mean(values.map(r => r.searchUnionMs / 1000)),
    synthesisSec: mean(values.map(r => r.synthesisMs / 1000)),
    errors: values.filter(r => r.status !== 'completed' || r.searchErrors.length).length,
    actualForkRuns: values.filter(r => r.children.length).length, children: values.map(r => r.children.length),
  };
}));
const details = {
  models: allModels.length, modelMeanSec: mean(allModels.map(t => (t.end - t.start) / 1000)),
  searches: allSearches.length, searchMeanSec: mean(allSearches.map(t => (t.end - t.start) / 1000)),
  emptySearches: allSearches.filter(s => !s.error && !s.result?.results?.length).length,
  errors: allSearches.filter(s => s.error).map(s => s.error),
  children: allChildren.length, forkMeanMs: mean(allChildren.map(c => c.forkMs)),
  failedChildren: allChildren.filter(c => c.status !== 'completed').map(c => ({ status: c.status, error: c.error })),
  rootOnlyResults: allSearches.flatMap(s => s.result?.results || []).filter(r => new URL(r.url).pathname === '/').length,
  totalResults: allSearches.flatMap(s => s.result?.results || []).length,
};
const degradedIndex = rows.findIndex(r => r.searchErrors.includes('SEARCH_PROVIDER_ERROR'));
const preDegradation = degradedIndex < 0 ? rows : rows.slice(0, degradedIndex);
const pairs = [];
for (const id of ['single', 'comparison']) for (let repeat = 1; repeat <= 3; repeat++) {
  const direct = preDegradation.find(r => r.id === id && r.repeat === repeat && r.arm === 'direct');
  const fork = preDegradation.find(r => r.id === id && r.repeat === repeat && r.arm === 'fork');
  if (direct && fork) pairs.push({ id, repeat, directSec: direct.readyMs / 1000, forkSec: fork.readyMs / 1000,
    forkTimedOut: fork.timedOut, forkStatus: fork.status, differenceSec: (fork.readyMs - direct.readyMs) / 1000 });
}
const f = n => Number(n).toFixed(1);
const report = [
  '# GLM Web Search 分身耗时实验', '',
  '范围：原本地 GLM 实验版的当前保存代码和配置，在隔离目录调用真实 GLM-5.3 与已有 Web Search MCP。不是云端 Claude Lab，也不是浏览器端到端计时。未更改产品代码、页面或正式会话。', '',
  '## 本轮结论', '',
  `计划12组，已有终态记录 ${rows.length} 组，最后正在执行的一组在搜索服务持续报错后主动中断；其 events.jsonl 保留，但不计作完成。第 ${degradedIndex + 1} 组开始出现 SEARCH_PROVIDER_ERROR，之后多组没有任何搜索结果。后半段的快速报错回复不能当成正常联网答案，也不能混入性能结论。`, '',
  '以下仅列持续服务报错前的配对记录；它们也存在官方证据不足、搜索解析失败和分身步数耗尽，不代表等质量答案。', '',
  '| 任务 | 轮次 | 不分身/秒 | 分身/秒 | 差异 |',
  '| --- | ---: | ---: | --- | --- |',
  ...pairs.map(p => `| ${p.id === 'single' ? '单产品官方文档查询' : '双产品官方文档对比'} | ${p.repeat} | ${f(p.directSec)} | ${p.forkTimedOut ? '180秒未完成，取消' : f(p.forkSec)} | ${p.forkTimedOut ? '至少慢 ' : '慢 '}${f(p.differenceSec)} 秒${p.forkStatus === 'completed-with-errors' ? '；分身失败后主会话补查' : ''} |`), '',
  '本轮未观察到执行分身提速，但有效配对少且质量不等价，不能概括所有联网任务。建议先提高搜索证据可用性、限制无效重复搜索，再比较单会话并行搜索与执行分身。当前接待分身提案尚未实测。', '',
  '## 方法', '',
  `- 计划两道题，每种策略每题三次，成对交替先后顺序；已记录 ${rows.length}/${summary.order.length} 组终态，其余中断。无中途追问。`,
  '- 单产品：联网查询 Codex CLI 会话恢复与分叉，最多3点并附官方链接。',
  '- 双产品：分别联网查询 Codex CLI、Claude Code 的上述能力，各最多2点并附官方链接。',
  `- 同一份提问前 ${summary.prefixMessages} 条历史、${summary.prefixBytes} 字节，thinking disabled，maxTokens 8192。`,
  '- 不分身：原 direct 工具集合。分身：首轮只暴露 fork_task 并设置 tool_choice，由真实模型生成委派，随后恢复原工具集合和正常运行循环。单产品要求1个分身，双产品要求2个。这是受控实际分身对比，不是默认自适应触发率试验。',
  '- 主会话真实分派与最终汇总均计时；分身创建、模型、搜索分别记录。每组新建搜索连接，供应商缓存不清除。组间串行，分身保留并发。',
  '- 首个预试验仅设置 tool_choice，但模型仍选择了搜索，已中断，证据保存在同级 1790536914609。它不计为分身样本，也不混入正式均值。',
  '- 每组上限180秒；模型/工具失败与空结果保留。均值包括这些样本，不能据此宣称答案质量相同。', '',
  '## 全部记录汇总（含服务故障，不用于正常性能结论）', '',
  '超时样本属于右截断：不能把180秒当成完成耗时。下表“有文本返回”包括搜索失败通知，不等于交付答案；同时保留所有组的结束/截断耗时与超时数。', '',
  '| 问题 | 策略 | n | 有文本返回均值秒（数量） | 结束/截断均值秒 | 超时 | 模型调用 | 搜索次数 | 实际分身组数 |',
  '| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |',
  ...stats.map(s => `| ${s.id === 'single' ? '单产品' : '双产品'} | ${s.arm === 'direct' ? '不分身' : '分身'} | ${s.n} | ${f(s.completedMeanSec)} (${s.completedN}) | ${f(s.meanSec)} | ${s.timeouts} | ${f(s.modelCalls)} | ${f(s.searches)} | ${s.actualForkRuns}/${s.n} |`), '',
  '## 耗时与证据', '',
  `- ${details.models} 次真实模型请求，平均 ${f(details.modelMeanSec)} 秒；${details.searches} 次搜索，平均 ${f(details.searchMeanSec)} 秒。模型时间包含网络和供应商处理，不能再区分推理和排队。`,
  `- ${details.children} 个真实分身，创建平均 ${f(details.forkMeanMs)} 毫秒；失败分身 ${details.failedChildren.length} 个。`,
  `- 搜索空结果 ${details.emptySearches} 次；搜索错误 ${details.errors.length} 次；${details.totalResults} 条返回结果中 ${details.rootOnlyResults} 条 URL 只有根路径。首页链接并不自动代表错误，但对定位具体文档的证据不足。`,
  '- 当前 engine 的同一会话工具列表使用 for...of 逐个 await；同一模型响应中的多次搜索也串行。不同分身才能通过现有路径并发搜索。',
  '- 分身同时增加父会话分派/汇总，可能重复查询或因搜索结果不足反复改词。判断收益需要比较总历时，不能把并发搜索或模型时长相加当成用户等待。',
  '- 现有工具仅返回搜索摘要和链接，没有打开网页全文的工具；本实验不等于核读了完整官方文档。', '',
  'SEARCH_PROVIDER_ERROR 是适配器归一化错误，可能来自 MCP 错误或 isError 响应。未记录供应商原始错误文本，无法确认是额度、权限还是服务故障。模型回答中“配额/权限”的说法不是本实验已验证的根因。', '',
  '## 逐组记录', '',
  '| # | 题目 | 策略 | 结束/截断秒 | 模型调用 | 搜索 | 分身 | 状态 |',
  '| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |',
  ...rows.map((r, i) => `| ${i + 1} | ${r.id} | ${r.arm} | ${f(r.readyMs / 1000)} | ${r.modelCalls} | ${r.searches} | ${r.children.length} | ${r.status} |`), '',
  '## 边界', '',
  '- 每格原计划只有3次，且并未全部完成有效搜索；真实搜索结果、生成路径和服务负载会变化。不是显著性证明，也不能据此概括所有联网任务。',
  '- 机械检查仅检查回答 URL 是否出现在本组搜索返回中，不验证网页可达性或语义正确性；原始答案和搜索结果供复核。',
  '- 未测试“空闲接待分身”方案，也未测试单会话并行工具改造。',
  '- 本地工作台绑定显示后端停止，未验证服务器记忆版本；本实验只使用明确指定的本地实验配置，不声称代表最新云端。',
  '- npm test 被缺失或变更的安全扫描器阻断，未绕过；实验脚本语法检查与真实调用另行记录。', '',
  '## 原始答案', '',
  ...rows.flatMap((r, i) => [`### ${i + 1}. ${r.id} / ${r.arm}`, '', r.answer || `无最终答案：${r.error || r.status}`, '', `未在搜索返回 URL 中匹配到的引用：${r.unreturnedUrls.join(', ') || '无'}。`, '']),
];
await atomicWrite(path.join(dir, 'analysis.json'), JSON.stringify({ stopped: 'Persistent search provider errors; final running group interrupted', degradedIndex, pairs, stats, details, rows }, null, 2));
await atomicWrite(path.join(dir, 'REPORT.md'), report.join('\n') + '\n');
console.log(JSON.stringify({ pairs, stats, details, report: path.join(dir, 'REPORT.md') }, null, 2));
