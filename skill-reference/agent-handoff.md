# Agent 交接、审核与测试结论

按当前操作阅读：交接看本页流程，审核看 [计划审核](#计划审核)，报告结果看 [测试结论](#测试结论)。角色职责见 [角色入口](../roles/README.md)。

## 准备与派发

新 TODO/Bug 调用 `prepare_task` 后等待指定版本的 brief 审批，不用 `ask_user` 重复要求批准。挂载或准备成功都不等于派发。

- **manual**：人批准 brief 后保存 Main 事项并提供可粘贴执行提示，不自动创建、派发或恢复执行 Session。
- **automatic**：人批准后后台为新任务创建执行 Session 和工作树，绑定就绪再派发；新任务不调用 `dispatch_task`。

按 [接口契约](design/design-interface-v1.2.1.md) 区分两种模式。当前投入本机对话型 manual；下文自动恢复与派发是既有 automatic 的兼容规则，不构成恢复开发授权。

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

## automatic 中断与返工

未完成任务出现 interrupted 事件后，系统自动发起恢复，保留原 Session、Plan、节点和证据。已有恢复控制时等待匹配的 resumed 回执，不重复发送或绕过 Plan 审核。需要补充指导时使用 `guide_task`，不要把仍在执行的任务当中断任务恢复。

CI 失败或人类验收拒绝都回到原任务、原执行环境。验收拒绝由系统自动推进返工，先核对权威状态，不误报为执行端未认领。

## 收工

本阶段执行笔记只保存在本地，不同步 Cloud；Map 发布仍走审核门禁。manual 提供执行提示不代表任务已经执行或关闭。

automatic 人工验收通过后，Coordinator 先读取 `read_task.completionPolicy`，用 `guide_task` 通知原 Executor 归档、结束计划。正式任务提交 PR，核验合并和任务要求的 Map 发布回执后调用 `complete_task`；服务端指定的 `experiment-only` 任务保留同一提交的测试与人审证据，按返回的回执调用 `complete_task`，不创建 PR、不发布 Main。两者都须等宿主 `closed` 回报才算关闭。不要让人直接联系执行端。

## 计划审核

Executor 把 Plan 交给 Coordinator 时适用。Executor 提交前按同一四项自检。

只检查以下四项，全部成立才可通过：

1. 范围与已确认需求一致
2. 节点与 Ask user 的挂载一致
3. 含有可检查的验收条件
4. 未越出授权节点

任一项不成立则退回，并指出不成立的项。你通过 Plan 后对方才可开发。你通过 Plan 不等于用户已验收。不得伪造审核回执。

## 测试结论

给出可引用结论时适用。

结论只能是 `passed`、`failed`、`incomplete`。必须绑到准确的 `sourceSha`、run 标识和检查名称。逐条保留测试编号。`CI_todo.md` 只记录已实现模块的测试缺口，只有实际通过才能打勾。清理已完成项时保留可追溯证据，历史从 Git 查看；不能删除未完成验收或失败证据来掩盖问题。

没有结果、运行中或查询失败写成 `incomplete`，不得写成通过。
