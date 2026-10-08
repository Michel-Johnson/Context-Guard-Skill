# Agent 交接

Coordinator 向 Executor、Tester 发送任务时适用。Executor 接收时按同一四项核对。

## 准备与派发

新 TODO/Bug 调用 `prepare_task` 后等待 brief 审批，不用 `ask_user` 再发批准或派发选项。人批准 brief 后后台为任务自动创建执行 Session 和工作树，就绪后派发；不为新任务调用 `dispatch_task`。这就是 Coordinator 创建执行 Session 的正常能力，但不能把“挂载”或“准备成功”说成已经派发。

`conversationId` 与 `executionSessionId` 是两类身份，禁止混用。`main`、`legacy`、`session:*`、`item-*` 是对话标识，不能作执行 ID。新任务身份取自 `list_tasks`；旧任务执行 ID 必须逐字复制自本轮 `list_sessions` 返回值。

执行 ID 为空表示尚未创建或绑定，不能调用 `read_task`。核对条目的 `taskId`、`itemId`、`nodeId`、`kind` 及审批状态，需要准备需求时沿用这些身份。`legacy-dispatch-review` 先核对原任务，不能当新任务重派。不向用户展示内部执行 ID，也不要求用户选 Session 或处理内部权限错误。

## 交接内容

一次交接必须写明：

1. 任务说明（用户已确认的那一版，不得改字）
2. 挂载节点
3. Main 版本
4. 验收条件

不得使用含糊指令，例如「适当处理」「参考相关模块」。不得在交接中授予额外节点权限，不得把 Session 草稿当作 Main。

对方可读取总体 context，执行过程中不得改写 Main。不得对人说话。Executor 先提交代码和 handoff，Coordinator 再交给 Tester；测试和人工验收前不归档或结束计划。人工验收后才归档并结束计划。

## Executor 接收核对

所有命令使用宿主提供的当前 worktree；`mainVersion` 是记忆版本，不是 Git SHA。先核对现有代码与任务要求的差距，已满足的部分记录事实和证据，需要补验证时将缺失检查纳入 Plan，不重复实现已经完成的功能。

执行前通过 `plan-status` 读取 `pending_signals`。对应已挂载 Cloud 任务的信号用 `resolve-signal --kind task` 分类，不另建同义 TODO/Bug；独立新需求按其内容记录。Hook 因未分类信号拒绝写入时，先完成分类，再继续原操作，不换工具绕过。

## 中断与返工

未完成任务出现 interrupted 事件后，系统自动发起恢复，保留原 Session、Plan、节点和证据。已有恢复控制时等待匹配的 resumed 回执，不重复发送或绕过 Plan 审核。需要补充指导时使用 `guide_task`，不要把仍在执行的任务当中断任务恢复。

CI 失败或人类验收拒绝都回到原任务、原执行环境。验收拒绝由系统自动推进返工，先核对权威状态，不误报为执行端未认领。

## 收工

人工验收通过后，Coordinator 先读取 `read_task.completionPolicy`，用 `guide_task` 通知原 Executor 归档、结束计划。正式任务提交 PR，核验合并和 Session 发布回执后调用 `complete_task`；服务端指定的 `experiment-only` 任务保留同一提交的测试与人审证据，按返回的回执调用 `complete_task`，不创建 PR、不发布 Main。两者都须等宿主 `closed` 回报才算关闭。不要让人直接联系执行端。
