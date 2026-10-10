# 当前开发方向：本机对话型 MVP

本文决定开发投入，不表示目标已实现，也不替代格式、权限、PR 或验收。历史待办与本文冲突时，以本文决定是否继续。

已批准的维护：共享 Map、协议、UI、角色及通用资料归 Skill，Cloud 固定包消费；Executor 使用轻量导航、按需读取、片段缓存、快速 hash 树和收工检查，Cloud 只补鉴权读取适配。不改 fs-v2.1 或 SHA-256 清单，不恢复派发，不因此授权生产部署。

## 只保留三条主线

1. Map / fs-v2.1：结构、记忆、关系、Bug/TODO 和 attempt 可准确读写，数据归用户。
2. 本机对话型 Coordinator：只读回答所需切片，优先速度和事实准确性，不扩调度器/传输层。
3. Claude Code CLI / Cursor：按需取上下文，开发笔记仅本地 Markdown，不同步 Cloud。Codex Hook 后续再做。

## 暂缓范围

Codex Hook、会话记录同步、Cloud 自动派发（心跳、耐久队列、自动 worktree、中断恢复、`resumed`）、Quark 附件、CI 接收器匹配和人审回执自动化暂缓。不删除既有代码、不改历史通过结论，停止新增、专项联调及优化；安全门禁和正常回归保留。开发需求交 Coordinator，测试缺口进 [CI_todo](../CI_todo.md)。

第 5 步前不扩自动派发。两种既有模式按 [接口](../skill-reference/design/design-interface-v1.2.1.md) 分开：
- manual：人批准 brief 后保存 Main 事项和执行提示，不自动建执行 Session 或派发。
- automatic：人批准后才建执行 Session 并派发，保留审核/权限/回执。
挂载均不写 Main、不建执行 Session，不因旧 TODO、设计或按钮恢复暂缓投入。

## 唯一 MVP 场景与验收

真实项目、本机工作台、已有 Map，与 Coordinator 就真实 Bug 讨论 5–10 轮。发送后 2 秒内开始有意义正文，准确引用模块、Bug 和 attempt；表情或占位文字不计。

用 manual：人确认 brief 后形成 Main 事项及 Claude/Cursor 可执行提示，含必要切片和路径；人选厂商 Agent，执行笔记本地保存，Map 结果经审核发布。离线本地工作台保留，但其模型能力单独验收，不从拆仓库或 UI 存在推断接通。

与直接使用 Cursor Projects 做同任务对照，录屏记录形成无需再改任务的耗时、修订次数及等待/思考时间。无对照和用户验收不宣称更快。

## 开发顺序

1. Coordinator 快速讨论 / brief 两模式，小上下文、提前 compact、Main 前缀缓存；先量准确率和首字延迟，再调 token。
2. 默认 `map read --context` 导航、`--node` 正文；fs-v2.1 事项沿 `index.md` 链接展开，FIND/snapshot 只迁移或恢复。
3. 验 manual 人审→Main 事项→执行提示；automatic 仅保持既有实现与必要回归。
4. 跑真实场景、录屏、同任务对照。
5. 依录屏修改 README，首句突出“能和你对话的项目 coordinator”，此前不提前改营销文案。

每步先验再推进；未达速度/质量先检查 Map 和 Coordinator 负担，不以 Cloud 编排扩范围。
