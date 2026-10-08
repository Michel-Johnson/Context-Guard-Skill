import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, atomicWrite } from './history.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, 'data/study');
const db = await readJSON(path.join(dir, 'experiment.json'));
const stats = values => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b), n = v.length;
  return { n, meanMs: n ? Math.round(v.reduce((a, b) => a + b, 0) / n) : null, medianMs: n ? Math.round((v[Math.floor((n - 1) / 2)] + v[Math.floor(n / 2)]) / 2) : null, p90Ms: n ? Math.round(v[Math.ceil(n * .9) - 1]) : null };
};
const allTrials = Object.values(db.trials).filter(t => t.arm);
const trials = allTrials.filter(t => t.requests.every(r => (r.fingerprint || db.fingerprint) === db.fingerprint));
function summarize(selected) {
  const requests = selected.flatMap(t => t.requests), complete = requests.filter(r => r.status === 'completed'), children = selected.flatMap(t => t.children);
  const outputs = selected.flatMap(t => t.visible.filter(m => m.role === 'assistant').map(m => ({ ...m, receivedAt: t.requests.find(r => r.id === m.requestId).receivedAt })));
  const usage = requests.flatMap(r => r.usage).map(c => c.usage).filter(Boolean);
  const tokenSums = {}; for (const u of usage) for (const [key, value] of Object.entries(u)) if (typeof value === 'number') tokenSums[key] = (tokenSums[key] || 0) + value;
  return {
    tasks: selected.length, feedback: Object.fromEntries(['solved', 'partial', 'unsolved', 'unrated'].map(q => [q, selected.filter(t => (t.quality || 'unrated') === q).length])),
    requests: requests.length, statuses: Object.fromEntries([...new Set(requests.map(r => r.status))].map(s => [s, requests.filter(r => r.status === s).length])),
    responseReady: stats(complete.map(r => r.endedAt - r.receivedAt)),
    responseDisplayed: stats(outputs.filter(m => m.displayedAt).map(m => m.displayedAt - m.receivedAt)),
    browserElapsed: stats(outputs.map(m => m.clientElapsedMs)),
    helpfulAnswerLatency: stats(outputs.filter(m => m.helpful === true && m.displayedAt).map(m => m.displayedAt - m.receivedAt)),
    initialResponse: stats(selected.map(t => t.requests[0]).filter(r => r?.status === 'completed').map(r => r.endedAt - r.receivedAt)),
    followupDuringBackground: stats(complete.filter(r => r.backgroundAtArrival > 0).map(r => r.endedAt - r.receivedAt)),
    requestServiceTotalPerTask: stats(selected.filter(t => t.requests.length && t.requests.every(r => r.endedAt)).map(t => t.requests.reduce((sum, r) => sum + r.endedAt - r.receivedAt, 0))),
    taskWallIncludingHuman: stats(selected.filter(t => t.endedAt).map(t => t.endedAt - t.startedAt)),
    overlapRequests: requests.filter(r => r.overlap?.length).length,
    forkedTasks: selected.filter(t => t.children.length).length, children: children.length, forkTime: stats(children.map(c => c.forkMs)),
    modelCalls: requests.reduce((n, r) => n + r.modelCalls, 0), toolCalls: requests.reduce((n, r) => n + r.toolCalls, 0), tokenSums,
  };
}
const report = { phase: db.phase, commit: db.commit, generatedAt: new Date().toISOString(), fingerprint: db.fingerprint,
  excludedOtherOrMixedRevisionTasks: allTrials.length - trials.length,
  byRevision: Object.fromEntries([...new Set(allTrials.flatMap(t => t.requests.map(r => r.fingerprint || db.fingerprint)))].map(version => [version, { tasks: allTrials.filter(t => t.requests.every(r => (r.fingerprint || db.fingerprint) === version)).length, requests: allTrials.flatMap(t => t.requests).filter(r => (r.fingerprint || db.fingerprint) === version).length }])),
  note: 'Descriptive pilot, not a causal verdict. Response latency excludes failed requests; statuses retain every failure/cancellation. Helpful-answer timing requires explicit human feedback. Category groups and overlapping tasks are shown separately. Cache is provider-reported only.',
  arms: Object.fromEntries(['direct', 'adaptive'].map(arm => [arm, summarize(trials.filter(t => t.arm === arm))])),
  byCategory: Object.fromEntries(['lookup', 'investigation', 'comparison'].map(category => [category, Object.fromEntries(['direct', 'adaptive'].map(arm => [arm, summarize(trials.filter(t => t.arm === arm && t.category === category))]))])),
};
await atomicWrite(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
const seconds = ms => ms === null ? '-' : (ms / 1000).toFixed(2) + 's';
const lines = ['# Coordinator 策略实验', '', `源码：${db.commit}`, `阶段：${db.phase}`, '', '| 策略 | 任务 | 请求 | 完成/失败/中断/取消 | 平均响应 | 中位数 | P90 | 已解决 | 分身任务 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
lines.splice(4, 0, `仅统计当前提示词版本；另有 ${report.excludedOtherOrMixedRevisionTasks} 个旧版或跨版本任务保留在原始数据中，不混入当前均值。`);
for (const [arm, s] of Object.entries(report.arms)) lines.push(`| ${arm} | ${s.tasks} | ${s.requests} | ${s.statuses.completed || 0}/${s.statuses.failed || 0}/${s.statuses.interrupted || 0}/${s.statuses.cancelled || 0} | ${seconds(s.responseReady.meanMs)} | ${seconds(s.responseReady.medianMs)} | ${seconds(s.responseReady.p90Ms)} | ${s.feedback.solved} | ${s.forkedTasks} |`);
lines.push('', '响应计时从请求到达至最终答复就绪，包含排队、工具、分身和汇总。均值仅包含成功完成请求，失败和未完成不能按零耗时计入。', '', 'JSON 保留完整状态分布、实际显示延迟、用户标记有帮助的答案耗时、分类统计、Token 和跨任务重叠。任务总墙钟时间包含用户思考时间，不能替代服务响应速度。', '', '按任务随机分组，追问保持同组。adaptive 不一定实际 fork，按分配组统计。单个用户的小样本仅用于探索，不能由平均值直接断言策略优劣。');
await atomicWrite(path.join(dir, 'report.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ phase: db.phase, arms: report.arms, report: path.join(dir, 'report.md') }, null, 2));
