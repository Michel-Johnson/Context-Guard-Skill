# Agent 职责与协作设计

文档版本：v1.0.1。

本文汇总现有角色设计，不是运行时 system prompt，也不增加工具权限。实际运行从 [角色入口](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/roles.md) 选择对应提示，不要求 Agent 启动时通读全部角色或设计文档。

## 角色分工

| 角色 | 职责 | 运行提示 |
| --- | --- | --- |
| 用户 | 决定目标和业务取舍，确认需求，验收最终结果 | 人类审核回执，不由 Agent 代签 |
| Coordinator | 与用户讨论，读取项目记忆、定位节点、整理任务；按所选模式组织执行与验收 | [Coordinator.md](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/Coordinator.md) |
| Executor | 实现已确认的任务，提交 Plan、实现结果和验证证据，处理返工 | [Executor.md](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/Executor.md) |
| Tester | 独立验证指定提交，报告测试结果和缺失证据，不修改业务代码 | [Tester.md](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/Tester.md) |

用户与 Coordinator 沟通；Executor 和 Tester 向 Coordinator 回报。角色身份不扩大协议权限：普通执行 Agent 只写自己的 Session，Coordinator 是 Main 结构的唯一非人写入者。测试通过不等于用户验收通过。

## 本机对话型目标

当前投入方向是让 Coordinator 用少量、准确的 Map 上下文连续讨论，而非充当自动调度器。目标流程是：讨论需求，提出 brief，由用户确认，形成 Main TODO 和可粘贴执行提示；用户选择 Codex、Cursor 或 Claude 执行，结果写回 Session，经用户审核后进入 Main。

这是当前 MVP 目标，不表示全流程已完成验收。Cloud 自动派发、自动创建工作树、中断恢复等链路仍暂缓；已有设计和代码不构成恢复开发的授权。人工执行模式与旧自动执行模式不能混用。

## 上下文与协作边界

Coordinator 先通过项目记忆了解全貌，用 Main 导航定位节点，再按需读取节点记忆和事项记录。Main 是已发布基线；进行中的实现、attempt 和验证证据从对应任务与 Session 读取，不能把旧对话摘要当作当前状态。

执行模式下，Executor 提交 Plan 和实现证据，Tester 独立验证同一提交，用户决定最终业务验收。人工执行模式不自动派发或恢复执行 Session。具体调用和授权见 [接口设计](design-interface-v1.2.1.md)、[工作台接口](design-workbench-interface-v1.1.0.md) 和各角色运行提示。

项目与节点 `memory.md` 的内容和维护见 [记忆撰写规范](design-memory-definition-v0.2.0.md)；索引和事项记录属于底层文件，见 [文件结构规范](design-memory-filesystem-v1.0.1.md)。这些设计不替代版本检查、冲突处理或人工确认。
