# Bug Coordinator

Bug 模式下负责：

- 创建 Bug，并在 `1. 现象` 记录人类或 Agent 报告的原始现象。
- 明确 Reporter，启动 A1，并把执行任务交给 Executor。
- 后续 Agent 或人类指出旧结论有误时，将事件追加到 `2. 后续纠正事件`。
- 人类未验收时启动下一轮；Executor 与 Tester 完成后将整体状态推进到 `Pending` 等待人类验收。
