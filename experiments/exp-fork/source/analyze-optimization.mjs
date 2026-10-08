import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { Source } from './source.mjs';
import { codexMap } from './map.mjs';
import { readJSON, atomicWrite } from './history.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const directories = process.argv.slice(2).map(d => path.resolve(d));
const studies = await Promise.all(directories.map(d => readJSON(path.join(d, 'summary.json'))));
const first = studies[0], replay = await readJSON(path.join(first.directory, 'replay.json'));
const source = await new Source({ root: path.join(here, '../codex-learning-source'), commit: first.commit, map: codexMap(first.commit) }).init();
const mean = a => a.reduce((s, n) => s + n, 0) / a.length;
const fmt = n => n.toFixed(1);
const fileLines = new Map(), audits = [], stats = [];
for (const [studyIndex, s] of studies.entries()) {
  const groups = [...new Set(s.runs.map(r => r.id + ':' + r.variant))];
  for (const key of groups) {
    const [id, variant] = key.split(':'), runs = s.runs.filter(r => r.id === id && r.variant === variant);
    stats.push({ study: studyIndex + 1, id, variant, n: runs.length, seconds: mean(runs.map(r => r.readyMs / 1000)),
      calls: mean(runs.map(r => r.modelCalls)), toolErrors: runs.reduce((n, r) => n + r.toolErrors.length, 0),
      prefetchSec: mean(runs.map(r => r.prefetchMs / 1000)), prefetchBytes: mean(runs.map(r => r.prefetchBytes)),
      outputTokens: mean(runs.map(r => r.outputTokens)), inputTokens: mean(runs.map(r => r.modelInputTokens)),
      rangeSec: [Math.min(...runs.map(r => r.readyMs / 1000)), Math.max(...runs.map(r => r.readyMs / 1000))],
    });
  }
  for (const [index, r] of s.runs.entries()) {
    const links = [], issues = [];
    marked.walkTokens(marked.lexer(r.answer), t => { if (t.type === 'link') links.push(t.href); });
    for (const link of links) {
      const url = new URL(link, 'http://local-evaluation');
      if (url.pathname !== '/experiment/source') continue;
      const file = url.searchParams.get('path'), line = url.searchParams.get('line') || '1';
      if (!source.files.has(file)) { issues.push({ link, reason: 'missing-file' }); continue; }
      if (!/^[1-9][0-9]*$/.test(line)) { issues.push({ link, reason: 'invalid-line' }); continue; }
      if (!fileLines.has(file)) fileLines.set(file, (await source.read(file, 1, 1)).totalLines);
      if (+line > fileLines.get(file)) issues.push({ link, reason: 'line-out-of-range' });
    }
    const storageDbClaim = /storage\.rs[^\n]*(?:state DB|数据库|SQLite)[^\n]*(?:读写|存取)/i.test(r.answer);
    audits.push({ study: studyIndex + 1, run: index + 1, case: r.id, variant: r.variant, status: r.status,
      chars: r.answer.length, links: links.length, linkIssues: issues, storageDbClaim,
      note: 'Mechanical checks and one narrow known-error detector only; not independent semantic grading.' });
  }
}
const serial = mean(replay.replay.filter(r => r.variant === 'serial').map(r => r.toolWallMs / 1000));
const parallel = mean(replay.replay.filter(r => r.variant === 'parallel').map(r => r.toolWallMs / 1000));
const label = { baseline: '原版', evidence: '证据工具', prefetch: 'Map预取+证据工具', grounded: '代码声明预取', contracted: '代码声明+提示词契约' };
const names = { files: '文件定位', parallel: '跨模块机制', 'config-holdout': '配置/执行策略留出题' };
const table = rows => [
  '| 任务 | 方案 | n | 平均模型调用 | 平均耗时/秒 | 范围/秒 |',
  '| --- | --- | ---: | ---: | ---: | --- |',
  ...rows.map(r => `| ${names[r.id]} | ${label[r.variant]} | ${r.n} | ${fmt(r.calls)} | ${fmt(r.seconds)} | ${r.rangeSec.map(fmt).join('–')} |`),
];
const lines = [
  '# 本地 GLM Harness 优化实验', '',
  `时间：${new Date().toISOString()}。模型：${first.model}。固定源码：${first.commit}。`,
  '范围：原本地 GLM 实验版，在隔离目录执行同一个 Experiment/CoordinatorModel。不是云端 Claude Lab，也未替换默认运行 harness。正式产品文件未改。', '',
  '## 结论', '',
  '优化重点不是消灭所有多轮，而是把“定位、读取、参数修正、重试控制”从模型反复决策中移到可验证的工具和调度器中。此次确实减少了文件定位的调用次数，但最快方案存在语义错误；尚无可直接替换默认实现的质量等价赢家。', '',
  '## 为什么会多轮', '',
  `旧源码实验的12组原请求共有 ${replay.audit.models} 次模型调用、${replay.audit.tools} 次工具调用。发现 NOT_FOUND ${replay.audit.toolErrors.NOT_FOUND} 次、INVALID_ARGUMENT ${replay.audit.toolErrors.INVALID_ARGUMENT} 次、同一文件后续读取 ${replay.audit.readContinuationPairs} 对、完全相同工具参数重复 ${replay.audit.exactRepeatedTools} 次。同批多工具响应 ${replay.audit.multiToolBatches} 批。`,
  '这些计数不是可直接删除的模型轮数。一个模型响应可能同时发出成功和失败工具，同一文件的后续范围可能是必要证据。完全重复很少，主要问题是检索粒度和决策边界。', '',
  '| 类型 | trace 依据 | 必要性 | 优化方向 |',
  '| --- | --- | --- | --- |',
  '| 真实信息依赖 | 先找到 Phase1，再沿调用定位 state DB 写入 | 通常必要 | 保留下一轮；搜索命中直接附代码上下文 |',
  '| 过期文档路径 | README指向 core/src/memories，但固定树中不存在 | 无须反复猜目录 | 工具附可验证的目录、路径有效性 |',
  '| 分页补读 | 默认160行，重要逻辑位于更后面；Phase1达803行 | 有的必要 | 以符号/函数为单位读取，不盲目扩大所有输出 |',
  '| 参数修正 | read_file曾请求360行，服务上限300 | 可预防 | schema声明范围、返回可修正的明确错误 |',
  '| 子任务扩大 | 父会话加入未问的legacy、元数据等调查要求 | 通常可收紧 | 明确交付范围，不增加问题 |',
  '| 失败返工 | STEP_LIMIT后子任务只传错误，主会话重读 | 可减少 | 返回证据与未完成点；局部续查 |',
  '| 汇总/状态 | 分派、最终汇总、list_background后再回答 | 依产品需要 | 状态读事件；单执行者结果直接交付 |', '',
  '## 预先提出的猜想与结果', '',
  '1. H1 证据工具：搜索命中附代码片段、目录附README、错误附有效路径。文件定位轮次下降；跨模块平均轮次没降，耗时反而更高。并非一律越多越好。',
  '2. H2 Map预取：在首轮前由代码拿有限证据。文件定位可到1次模型调用，但出现凭文件名猜职责；词面检索还会漏选记忆主题。反对直接上线朴素预取。',
  `3. H3 并行只读工具：三轮确定性回放中，搜索工具等待 ${fmt(serial)} → ${fmt(parallel)} 秒，模型调用保持5次。只验证调度层，不是新联网端到端结果。`,
  `4. H4 故障熔断：失败trace回放里，主动返回“搜索不可用”可将模型 ${replay.circuit.before.models} → ${replay.circuit.after.models} 次、上游搜索 ${replay.circuit.before.searches} → ${replay.circuit.after.searches} 次。是失败响应更快，不是成功答案更快。`,
  '5. H5 代码声明预取（探索性追加）：函数/注释能纠正storage.rs职责，但仍有README过期路径误述，需要更强的来源优先级与结构化校验。',
  '6. H6 提示词契约（探索性追加）：强调证据与简短回答没有稳定效果，留出题甚至更慢并出现路径拼写错误。不能靠加Prompt解决全部架构问题。', '',
  '## 真实 GLM 对照', '',
  '主实验两题、三方案、各两次，共12组。相同20条提问前历史，无分身、无追问，组间交错顺序，预取耗时计入总时间。工具改动按套餐累积，不把单项贡献分别归因。没有清除供应商缓存。', '',
  ...table(stats.filter(s => s.study === 1)), '',
  '注意：文件定位预取版的两份回答均把storage.rs说成state DB读写。它们虽快，但不满足质量要求。原版与证据工具版也各出现一次相同误述，不能据此声称任何方案已经完全正确。', '',
  '## 探索性补测', '',
  '在观察到职责误判后，先添加最多32个源码文件的声明/注释索引，再测试证据/范围提示词。补测各自成对比较，不能将跨批次时间差全部归因于实现。', '',
  ...table(stats.filter(s => s.study > 1)), '',
  '代码声明版两次都正确描述storage.rs重建raw_memories.md、同步rollout摘要文件，但其中一次仍将已不存在的core/src/memories列为当前编排。契约提示词也未可靠阻止这一错误。配置留出题的契约版生成了cex-rs而非codex-rs的错误链接。', '',
  '## 建议架构', '',
  '```text',
  '用户请求',
  '  -> 请求上下文：已选Map节点、commit、授权范围、交付要求',
  '  -> 确定性证据准备：路径/符号索引、有效性检查、限额预取',
  '  -> 模型：回答，或一次提出若干独立只读查询',
  '  -> 工具调度：依赖分组、限并发、去重缓存、超时与熔断',
  '  -> 证据池：内容、source_id、行范围、版本、未完成点',
  '  -> 仅证据不足时进入下一次模型调用',
  '  -> 输出校验/渲染：根据source_id生成链接，直接流式交付',
  '旁路：事件日志 -> 状态面板/空闲接待session，不打断执行',
  '```', '',
  '实现优先级：', '',
  '1. 先改工具返回契约：正确路径、范围约束、符号级代码证据。保留不确定性，不把目录清单或README包装成已验证实现。',
  '2. 再做只读批处理。相互独立的文件读取/搜索可并行，依赖上一步结果的查询必须下一轮；edit_map、提交、执行命令等有副作用操作不混入并行批次。',
  '3. 查询以(request, commit, tool, normalized arguments, authorization scope)标识。仅同版本只读结果可复用；动态网页结果要记录获取时间与刷新策略，故障不能作为正常缓存。',
  '4. 已选Map节点优先于朴素关键词匹配；无法确定范围时不给一大包猜测材料。图中存短定位索引、约束与证据引用，不复制长篇旧答案。',
  '5. 终态区分“已答复”“证据不足”“工具不可用”“任务完成”。当前completed仅表示产生文本，不能成为质量判定。熔断由代码处理，不让模型决定是否无限重试。',
  '6. 保持单执行者，接待只读事件快照。执行子任务确实独立且有足够工作量时才拆；失败时转交阶段证据，单个执行者已给出完整答复时不必再做一次同义汇总。后两项本轮未做真实端到端验证。', '',
  '## 并行的实现边界', '',
  '不能只把原loop替换成Promise.all：当前Web Search的AbortController按session保存，并发会相互覆盖。需要turn级取消信号和独立tool_call_id、稳定结果顺序、写操作屏障、统一日志归属、限并发及等待已启动任务收尾。临时调度器验证了并发上限2、结果排序、写屏障和异常收尾，未接入正式web取消链路。', '',
  '源码实验调用当前GLM与真实固定版本Git；搜索服务单次健康检查仍返回SEARCH_PROVIDER_ERROR，故并行/熔断均用保存的trace模拟工具延迟，没有再次消耗联网配额，也不声称测到新的网络速度。', '',
  '## 质量与限制', '',
  `检查 ${audits.length} 份输出、${audits.reduce((n, a) => n + a.links, 0)} 个Markdown链接；机械问题 ${audits.reduce((n, a) => n + a.linkIssues.length, 0)} 个。链接存在不等于结论受支持，人工核查不属于独立盲评。`,
  `检索覆盖测试保留失败：预期 ${replay.retrievalCoverage.expected.join('/')}，实际 ${replay.retrievalCoverage.actual.join('/')}。没有删除失败断言后假称通过。`,
  '- 每格仅1或2个样本，没有统计显著性结论。模型往返含网络、服务排队和推理，无法单独归因。减少调用不保证变快：每轮上下文、输出长度和检索工作量也会变化。',
  '- 预取函数索引的正则仅为Rust样例原型，不是可靠多语言语法分析器；部署需沿用成熟解析器或LSP索引。输出上限与作用域隔离也需正式测试。',
  '- 本地工作台后端停止，未校验服务器记忆版本；本轮仅研究用户明确指定的本地代码与实验数据，不宣称已同步服务器。',
  '- npm test仍被缺失/变更的安全扫描器阻断，未绕过。临时脚本定向检查与真实模型实验不能代替产品全量测试。没有提交、推送或部署。', '',
  '## 证据文件', '',
  ...studies.map((s, i) => `- 实验${i + 1}：${s.directory}/summary.json；各组timing.json、events.jsonl和sessions保存输入、工具与完整输出。`),
  '- replay.json：旧trace分类、回放结果与失败覆盖测试。analysis.json：全部聚合、引用校验与窄范围错误检测。',
  '- 实现：harness-optimization.mjs、optimization-evaluation.mjs、optimization-replay.mjs。均位于忽略的temp/learning-lab目录。',
  '- 基线依据：engine.mjs:201 的模型/工具循环、engine.mjs:219 的串行工具执行、engine.mjs:271 的分身错误回传，source.mjs:33 的160行默认读取。', '',
];
const output = { at: new Date().toISOString(), studies: studies.map(s => s.directory), stats, audits, replay };
await atomicWrite(path.join(first.directory, 'analysis.json'), JSON.stringify(output, null, 2));
await atomicWrite(path.join(first.directory, 'REPORT.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ stats, issues: audits.filter(a => a.linkIssues.length), report: path.join(first.directory, 'REPORT.md') }, null, 2));
