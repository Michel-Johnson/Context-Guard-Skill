# Context Guard 接口设计

```
Context Guard
├── Agent Interface
├── Human Interface
├── Host Interface
└── Cloud Interface
```

这四层覆盖 multi-agent、多平台和端云同步。表里的角色字母是 C、E、T。

## Agent Interface

### File

小文件、可分层、可链接、按需展开、角色隔离、避免全量读取。

阅读优先级：

| 类型 | C | E | T |
| --- | --- | --- | --- |
| 导航/静态上下文 | 高 | 低 | 低 |
| 当前任务上下文 | 中 | 高 | 高 |
| 执行/测试规范 | 低 | 高 | 高 |
| 历史 Bug/决策/经验 | 按需 | 按需 | 按需 |
| 实现证据/测试结果 | 摘要 | 写/读 | 高 |

静态为 ✅，动态为 🔴：

| 文件类型 | C | E | T |
| --- | --- | --- | --- |
| 全局导航 / Map 摘要 | ✅ | 🔴 | 🔴 |
| 当前任务摘要 | ✅ | ✅ | ✅ |
| 节点详情 / 历史上下文 | 🔴 | 🔴 | 🔴 |
| 执行规范 | 🔴 | ✅ | 🔴 |
| 测试规范 | 🔴 | 🔴 | ✅ |
| 实现记录 | 🔴 | ✅ | ✅ |
| 测试记录 | 🔴 | 🔴 | ✅ |
| 历史 Bug / 经验 | 🔴 | 🔴 | 🔴 |

读写：

| 文件类型 | C | E | T |
| --- | --- | --- | --- |
| 全局导航 / Map | 读 | 读 | 读 |
| 当前任务摘要 | 读/写 | 读 | 读 |
| 节点上下文 | 读/写 | 读 | 读 |
| 执行规范 | 读 | 读 | 读 |
| 测试规范 | 读 | 读 | 读 |
| 实现记录 | 读 | 读/写 | 读 |
| 测试记录 | 读 | 读 | 读/写 |
| Bug / 经验 | 读/写 | 读/写 | 读/写 |

接口设计重点：

| Agent | 规则 |
| --- | --- |
| C | 读：直接 File；写：必须 Tool/CLI |
| E | 不设计底层工具，只规定可读上下文、可写范围、交付格式 |
| T | 同上，只规定输入、测试规范、结果格式 |

### CLI

CLI 负责写和状态变化。

| Domain | 接口 | Caller | 动作 |
| --- | --- | --- | --- |
| map | `edit_map` | Coordinator | 创建、修改、移动、删除 Main 节点。删除时如果下面还有子页或关联，先问人。人同意就可以删 |
| map | 提议 Main 节点 | | 人同意前不写入。唯一的提议 |
| map | 任务复查 | | 不写入 Main 节点 |
| map | 挂载 | | 将 Coordinator 挂载到节点；执行 Session 仍须等该事项的 brief 获批后创建，不写入 Main 节点 |
| todo | `createTodo` `updateTodo` | C / E / T | 创建、更新 TODO 事项记录 |
| task | 共用流程 | | 以 `kind`（todo 或 bug）、`nodeId`、`itemId` 定位事项；流程附着于 TODO/Bug，不创建独立 Task 实体；各动作仍按本表 Caller 授权 |
| task | 派发 | 人批准指定 brief 版本之后 | 系统为该事项创建新的执行 Session 并派发；人不选择 Session，也不能跳过 brief 审批 |
| task | 事项与 Session | | 每轮执行创建一个新 Session；同轮重试与返工沿用原 Session，不靠独立 Task 实体区分轮次 |
| task | `closeTask` | Coordinator | Coordinator 判断是否请求完成；请求本身不代表事项已关闭 |
| task | 取消事项 | Coordinator | 可以取消 TODO/Bug 的执行流程 |
| task | `task.control` complete | Coordinator | 服务端核验合并与归档回执后进入 `closing`；收到引用原控制 ID 的关闭回报才进入 `closed` |
| task | `task.report` | Executor 或 device | 回报进度；`resumed`、`closed` 引用原控制 ID，传输确认不算执行完成 |
| task | `task.message` | Coordinator | 向原事项绑定的执行 Session 发指导；带稳定消息 ID 与 Session 代次，不改变阶段或 Plan；忙碌时保留并幂等重试 |
| task | 失败退回 | | 测试或验收失败时，同一事项回到原执行 Session，不新建事项或 Session |
| task | 发布之后继续 | Coordinator | 本轮发布后结束；继续处理时读取最新 Main 并新建执行 Session，同一 Bug 保留原记录 |
| bug | `createBug` `updateBug` `resolveBug` | C / E / T | 创建、更新、修复。Bug 只有一份记录 |
| bug | 写文件 | | 不因缺少 Plan 或缺少节点授权而阻止写入。另一任务可以更新同一份 Bug 记录 |
| idea | `createIdea` `updateIdea` | human 或 coordinator | 创建、更新 Idea |
| brief | 签发 brief | human | 人对指定 brief 版本批准或拒绝并取得服务端回执；对话回答不是签发 |
| plan | `submitPlan` | C / E | 提交 Plan |
| plan | `approvePlan` `rejectPlan` | Coordinator | Coordinator 签发 Plan。不能在本地自行批准 |
| ask | 向人提问 | Coordinator | 提问不是批准，也不是签发 |
| handoff | 完成回报，然后交给 Tester | Executor 向 Coordinator 回报；随后 Coordinator | Coordinator 先批准 Plan。Executor 做完后向 Coordinator 送出完成回报。Coordinator 再把工作交给 Tester |
| result | `submitExecutionResult` `submitTestResult` | E / T | 回传执行或测试结果 |
| result | 签发验收 | human | 测试已通过之后，人签当前已通过的测试结果 |
| session | `finishSession` `recoverSession` | C / E / T | 完成、恢复 Session |
| session | `archiveSession` | C / E / T | 归档需要已有的人审记录 |
| plan | plan-finish | | 需要已有的人审记录 |
| attachment | 附件 | human、Session | 人和 Session 可以附加文件 |

## Human Interface

Workbench Frontend 对 Backend。

| Domain | 接口 | Caller | 动作 |
| --- | --- | --- | --- |
| map | `getMap` `getNode` | | 读 |
| map | `createNode` `updateNode` `moveNode` `deleteNode` | human | Cloud 路径改 Main。页面上的修改自动保存。删除时如果下面还有子页或关联，先问人。人同意就可以删 |
| map | 本地 Main | | 只读 |
| todo | `listTodos` `getTodo` `updateTodo` | human | 查看、更新 TODO 事项记录 |
| task | `listTasks` `getTask` | human | 查看 TODO/Bug 共用流程及投递状态；以事项类型、节点 ID、事项 ID 定位，不另建 Task 记录 |
| task | `acceptTask` | human | 对指定 TODO/Bug 的当前 brief 版本批准或拒绝，取得服务端审核回执；普通对话回答不能代替签发 |
| bug | `listBugs` `getBug` `updateBug` | human | 查看、更新 Bug 事项记录 |
| idea | `listIdeas` `getIdea` `updateIdea` | | |
| plan | `getPlan` | | 读 |
| result | `getResult` | | 读 |
| result | `acceptResult` `rejectResult` | human | 测试已通过之后，人签当前已通过的测试结果 |
| session | `listSessions` `getSession` `switchSession` | human | 查看正在工作的 Session 的进度和状态；切换只改变查看对象，不改变任务路由 |
| conversation | 与 Coordinator 对话 | human | 人可以打开对话并发送消息 |
| permission | `getGrants` | | 读 |
| permission | `grant` `revoke` | human | 唯一的权限接口 |
| conflict | `getConflict` `resolveConflict` | Agent | 能识别人当前是否正在改，并提醒人 |
| project | `getProject` `updateSettings` | | |

## Host Interface

Codex、Cursor、Claude 等宿主与 Context Guard 的连接。

| Domain | 接口 | 动作 |
| --- | --- | --- |
| session | `sessionStart` `sessionStop` | Session 停止不代表事项完成；完成由 Coordinator 依据回执判断 |
| session | `interrupt` | 同一事项在同一 Session 和同一 Plan 上继续，不新建事项或 Session |
| prompt | `userPromptSubmit` | |
| tool | `preToolUse` `postToolUse` `toolFailure` | |
| permission | `permissionRequest` | |
| compact | `preCompact` `postCompact` | 对话被压短之后，当前计划和没做完的事还在 |
| subagent | `subagentStart` `subagentStop` | 不限制它改哪些文件 |
| identity | `getSessionId` `getWorktree` `getPlatform` | |
| context | `injectContext` `refreshContext` | |
| runtime | `heartbeat` `getRuntimeState` | 宿主持久保存投递；明确未启动或忙碌失败时按原消息 ID、事项与 Session 代次恢复，结果未知时先核对而不重复唤起 Agent；过期投递明确拒绝 |
| adapter | `normalizeEvent` | |

## Cloud Interface

本地 Context Guard 与云端交换状态、事件和权限。

| Domain | 接口 | 动作 |
| --- | --- | --- |
| project | `connectProject` `disconnectProject` `getProjectState` | |
| sync | `pullState` `pushOperation` `syncStatus` `checkpoint` | 同步只走 Session。旧的项目地图同步不是接口 |
| session | `openSession` `syncSession` `reopenSession` | |
| session | `publishSession` | 不写入 Main 节点。发布之后这一轮结束；后续执行从最新 Main 开始并新建 Session |
| events | `subscribeEvents` `getEvents` `ackEvent` | 区分 Cloud 入队、宿主持久接收和实际处理；`ackEvent` 只确认接收，不代表 Agent 已执行；重连重送原 ID，宿主去重，业务完成须有匹配回报 |
| conflict | `getConflict` `resolveConflict` | 能识别人当前是否正在改，并提醒人 |
| auth | `login` `refreshToken` `logout` | 登录只有这一套 |
| memory | `getMainMemory` `getSessionMemory` `updateMemory` | |
| memory | `getMemoryFile` | 按 Main/Session 和版本读取单个文件；版本变化时返回冲突 |
| memory | 恢复 Main | 只保留最近 5 个 Main 版本。更早的版本自动删除 |
| recovery | `retrySync` `recoverSession` | 保留原事项、Session 与消息 ID；明确未执行的失败可重试，结果未知先核对；失败可见，不把排队或接收显示为完成 |
| heartbeat | `heartbeat` `getPresence` | |
