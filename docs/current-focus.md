# 当前开发方向：本机对话型 MVP

读者：仓库开发 Agent。本文规定**开发优先级**，不表示下列目标已实现，也不替代 `fs-v2.1`、接口、安全或 PR 规则。历史实现与测试记录保留；遇到旧待办与本文冲突，以本文决定是否投入。

本次明确授权的维护任务是 Cloud／Skill 拆仓库和旧代码清理：Cloud 服务、Slack 与接口定义迁入 `Context-Guard-Cloud`；Skill 保留本地后端、宿主与安装入口，共享运行时由固定 Cloud 包构建。此授权允许修复和验证迁移边界，不恢复下列暂缓功能的扩展开发。

## 只保留三条主线

1. **Map 与 fs-v2.1**：项目结构化记忆归用户所有；保持版本、节点、Bug/TODO 和 attempt 可准确读取、编辑及回写。
2. **对话型 Coordinator**：只取回答所需的 Map 切片，优先聊天速度与事实准确性；不再把调度器或传输层当作它的开发目标。
3. **跨客户端 Skill + hooks**：Codex、Cursor、Claude 从同一份 Map 读取，并把各自执行结果写回对应 Session。

## 暂缓范围

Cloud 自动派发链（心跳、耐久队列、自动建 worktree、中断恢复、`resumed` 回执）、Quark 附件、CI 接收器匹配、人工验收回执自动化均**暂缓**。不删除现有代码，也不把既有 `[x]` 验收改成失败；只停止新增功能、专项联调和优化投入。维护既有安全门禁及正常回归，不用“暂缓”绕过必需检查。相关未完成项在 [CI_todo.md](../CI_todo.md) 标注。

第 5 步完成前，不新增心跳、耐久队列、自动 worktree 或中断恢复，也不扩写现有自动派发实现。既有两种执行模式分开维护，以 Cloud 仓库的 [接口定义](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/docs/interface.md) 为准：

- **manual**：人批准 brief 后保存 Main 事项并提供可粘贴执行提示，不自动创建执行 Session 或派发。
- **automatic**：人批准 brief 后才创建新的执行 Session 并派发；保持已有权限、审核和回执门禁。

两种模式的挂载都不写 Main，也不在挂载时创建执行 Session。不得在同一流程同时声称 manual 和自动派发；不因旧 TODO、历史设计或页面按钮恢复其余暂缓投入。

## 唯一 MVP 场景与验收

在用户自己的真实项目、本机工作台、已建立的 Map 上，用户就某条真实 Bug 与 Coordinator 连续讨论 5–10 轮。Coordinator 首次有意义回复应在用户发送后 **2 秒内**开始，引用准确模块、Bug 和既有 attempt 结论；每轮都要让用户继续思考，而非等待系统。

讨论收敛后，Coordinator 提出 brief。本 MVP 使用 **manual**：人确认后形成 Main 事项及可粘贴到 Codex、Cursor 或 Claude 的执行提示，内含必要 Map 切片和读写路径；厂商 Agent 自行执行，现有 hooks 将结果写回 Session，成果再按审核与发布规则进入 Main。本场景不要求自动派发能力；离线本地工作台仍须保留，其实际本机 Coordinator 能力另行验收，不由拆仓库或界面存在推断已经接通。

用同一个真实任务与直接使用 Cursor Projects 比较：从提问到得到一条用户无需再改的任务所花的时间，以及等待与思考各占多少。录屏保留原始时间点和修订次数；没有对照与用户验收，不宣称 MVP 更快。

## 开发顺序

1. 瘦身 Coordinator：快速讨论 / brief 两种模式，小上下文、提前 compact、缓存 Main 前缀；先量准确率与首字延迟，再调 token。
2. 裁定 Agent 打开模块优先读哪套目录（旧 FIND/snapshot 或 fs-v2.1 Markdown），随后让 Skill 只教一种默认读法；旧入口仅作为明确的迁移/恢复路径。
3. 验证 manual 的批准→保存 Main 事项→执行提示闭环；automatic 的批准→新执行 Session→派发按既有实现保留并做必要回归。挂载不写 Main、不创建执行 Session；不新增心跳、耐久队列、自动 worktree 或中断恢复。
4. 用自己的项目跑唯一 MVP 场景、录屏，并与 Cursor Projects 做同任务对照。
5. 根据录屏改 README：第一句话突出“能和你对话的项目 coordinator”，不以“范式”开场。此前不提前改营销文案。

每一步先完成可观察验收，再进入下一步。若 2 秒或任务质量不达标，优先检查 Map 是否准确、Coordinator 是否过重，不回到 Cloud 编排扩范围。
