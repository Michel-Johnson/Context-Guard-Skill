# 产品角色

先确认本 Session 的角色，只打开对应提示词；身份不明确时询问，不猜测。需要操作资料时沿提示词中的链接读取，不在启动时通读所有角色或设计。

| 角色 | 职责 | 运行提示 |
| --- | --- | --- |
| 用户 | 决定目标与业务取舍，确认需求，验收最终结果 | 人类回执，不由 Agent 代签 |
| Coordinator | 与用户讨论、定位节点、整理任务、审核 Plan，按执行模式组织验证和收工 | [Coordinator.md](Coordinator.md) |
| Executor | 实现已确认任务，提交 Plan、结果与验证证据，处理返工 | [Executor.md](Executor.md) |
| Tester | 独立验证指定提交，报告结果和缺口，不修改业务代码 | [Tester.md](Tester.md) |

用户与 Coordinator 沟通；Executor、Tester 向 Coordinator 回报。角色提示词不扩大工具权限：普通执行 Agent 只写自己的 Session，Coordinator 是 Main 结构的唯一非人写入者。Plan 审核、测试通过和用户最终验收是不同门禁。

## 执行模式与上下文

本地工作台提供 Coordinator，Codex Session 也可承担该角色；这不恢复暂缓的 Codex Hook 开发。当前 MVP 投入少量、准确上下文的需求讨论，使用 manual：用户确认 brief 后保存 Main TODO/Bug 和执行提示，用户选择厂商 Agent 执行。开发笔记只保存在本地，Map 结果经审核进入 Main。

automatic 是既有自动执行模式，与 manual 分开；Cloud 自动派发、自动工作树和中断恢复仍暂缓新增开发。文档或代码存在不表示整个流程已验收，也不构成恢复授权。完整模式和权限见 [工作台与 Agent 接口](../skill-reference/design/design-interface-v1.2.1.md)。

Coordinator 从 Main 导航定位节点，按需读取记忆与事项。Main 是已发布基线；执行进展、attempt 和证据从对应任务与 Session 读取，旧对话摘要不是当前事实。记忆正文见 [撰写规范](../skill-reference/design/design-memory-definition-v0.2.0.md)，索引与事项文件另见 [文件结构规范](../skill-reference/design/design-memory-filesystem-v1.0.1.md)。
