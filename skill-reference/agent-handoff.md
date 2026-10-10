# Agent 交接、审核与测试结论

角色见 [入口](../roles/README.md)，模式/权限以 [接口](design/design-interface-v1.2.1.md) 为准；按当前操作读，不启动通读。

## 准备与派发

prepare_task 后等待指定 brief 版本人审，不再 ask_user 重复批准；挂载/准备成功不是派发。
- manual：批准后 Main 事项/可粘贴提示，不建、派发或恢复执行 Session。
- automatic：批准后系统建 Session/worktree，绑定再派发；新任务不用 dispatch_task。
当前投入 manual，自动条款仅兼容，不恢复暂缓开发。

conversationId 和 executionSessionId 不混用；main/legacy/session:*/item-* 非执行 ID。新任务 ID 取 list_tasks，旧执行 ID 逐字取本轮 list_sessions；为空尚未创建/绑定，不调 read_task。核 taskId/itemId/nodeId/kind/审批，legacy-dispatch-review 核原任务，不重派。内部 ID/权限排错不交用户。

## 交接内容

必须含已确认原文、挂载节点、Main 版本、可检查验收，不能含糊、改需求、扩大节点权限或用 Session 草稿作 Main。Executor 先代码/handoff，Coordinator 转 Tester；技术与人审前不归档/结束，不直接对人说话。

## Executor 接收核对

用当前宿主 worktree；mainVersion 是记忆版本。先核差距，已满足留证据不重做，缺测试入 Plan。plan-status 取 pending_signals，已挂 Cloud 任务 resolve-signal --kind task，不另建同义事项；新需求按内容分类。未分类阻写先分类，不换工具绕过。

## automatic 中断与返工

interrupted 由系统恢复原 Session/Plan/节点/证据；已有恢复等待匹配 resumed，不重发或绕审核。执行中补指导用 guide_task，不伪装中断。CI 失败/人审拒绝回原任务环境；拒绝自动返工先核权威状态。

## 收工

笔记只本地，Map 发布按门禁；manual 提示非执行/关闭。

automatic 人审后读 read_task.completionPolicy，用 guide_task 通知归档/plan-finish。正式任务核 PR 合并及要求的 Map 回执后 complete_task；服务端 experiment-only 保留同提交独立测试/人审，按回执 complete_task，不 PR/发布 Main。均等宿主 closed，不让人另联执行端。

## 计划审核

Executor 自检、Coordinator 审核同四项：需求范围一致、挂载与 Ask user 一致、验收可检查、未越节点授权。缺一退回指出项，审核通过才开发，不等于人审验收，不伪造回执。

## 测试结论

仅 passed/failed/incomplete，绑准确 sourceSha、run、检查名及逐条测试编号；无结果/运行中/查询失败为 incomplete。CI_todo 只测试缺口，通过立即移除，证据留 Git/PR；不删未验项或失败证据掩盖问题。
