# 工作台与 Agent 接口

文档 v1.2.1，本机 Node 协议2，[文件 fs-v2.1](design-memory-filesystem-v1.0.1.md)。版本、字段与权限不变；业务名称非部署证明，精确字段核 [机器契约](../interface-contract-v2.json)。

Cloud 配对/同步/发布只在 [Cloud Map](design-memory-server-v1.1.0.md) 维护，Executor 基线/缓存/变化检查见 [上下文流程](design-context-v1.0.0.md)。本页保留调用、权限及兼容边界。

## 权限与接口

C、E、T 分别表示 Coordinator、Executor、Tester。以下是业务角色分工，不代替具体项目、节点、Session 或宿主授权。

### Agent 接口

#### 文件读取

文件按需展开，不全量读取历史。“静态”指进入角色上下文，“动态”指需要时再读；优先级表示角色关注程度，不授予写入权限。

| 资料 | C 读取 | E 读取 | T 读取 | 业务写入者 |
| --- | --- | --- | --- | --- |
| 全局导航 / Map 摘要 | 静态，高 | 动态，低 | 动态，低 | 具体结构权限见下文 |
| 项目记忆 `memory.md` | 静态 | 动态 | 动态 | 人与 Coordinator |
| 当前任务摘要 | 静态，中 | 静态，高 | 静态，高 | C |
| 节点详情 / 历史上下文 | 动态 | 动态 | 动态 | C |
| 执行规范 | 动态，低 | 静态，高 | 动态，高 | 只读 |
| 测试规范 | 动态，低 | 动态，高 | 静态，高 | 只读 |
| 实现记录 | 动态，摘要 | 静态，读写 | 静态，高 | E |
| 测试记录 | 动态，摘要 | 动态 | 静态，高、读写 | T |
| 历史 Bug / 经验 | 动态，按需 | 动态，按需 | 动态，按需 | C / E / T，在授权范围内 |

C 读取文件，写入必须通过工具或 CLI。E、T 使用已有工具，重点是可读上下文、可写范围和交付 / 测试格式，不另设计一套底层工具。

#### Agent 操作

以下列出业务能力与调用者；写入和状态变化通过现有工具或 CLI 完成。

| 领域 | 接口 | 调用者 | 动作 |
| --- | --- | --- | --- |
| map | `edit_map` | Coordinator | 创建、修改、移动、删除 Main 节点，也可按 Main 版本更新项目或节点记忆文档。删除时如果下面还有子页或关联，先问人。人同意就可以删 |
| file | `write_file` | Coordinator | 在项目仓库检出中新建或替换一个 UTF-8 文本文件。项目须显式允许。一次一个仓库相对路径。不提交、不推送、不改 Main。替换已有文件时必须带当前内容的 SHA-256；同一操作 ID 重试返回原回执 |
| map | `show_nodes` / `open_node` / `tour_nodes` | Coordinator | 可选布尔值 `replyComplete`，默认 false；仅人工对话、文本已完整答复且本步全为成功展示时结束本轮，不再请求模型复述。进度说明、无文本、读写、混合调用或失败仍继续核验；不跳过审批。Slack 按已绑定项目生成节点链接，不采用模型提供的 URL |
| map | 提议 Main 节点 | | 人同意前不写入。唯一的提议 |
| map | 任务复查 | | 不写入 Main 节点 |
| map | 挂载 | | 将 Coordinator 挂载到节点；执行 Session 仍须等该事项的 brief 获批后创建，不写入 Main 节点 |
| todo | `createTodo` `updateTodo` | C / E / T | 创建、更新 TODO 事项记录 |
| task | 共用流程 | | 以 `kind`（todo 或 bug）、`nodeId`、`itemId` 定位事项；流程附着于 TODO/Bug，不创建独立 Task 实体；各动作仍按本表调用者授权 |
| task | 派发 | 人批准指定 brief 版本之后 | 系统为该事项创建新的执行 Session 并派发；人不选择 Session，也不能跳过 brief 审批 |
| task | 事项与 Session | | 每轮执行创建一个新 Session；同轮重试与返工沿用原 Session，不靠独立 Task 实体区分轮次 |
| task | `closeTask` | Coordinator | Coordinator 判断是否请求完成；请求本身不代表事项已关闭 |
| task | 取消事项 | Coordinator | 可以取消 TODO/Bug 的执行流程 |
| task | `task.control` complete | Coordinator | 正式任务核验合并与归档回执；人明确指定的实验任务核验同一提交的独立测试与人审回执，保留证据，不要求合并或发布 Main。核验后进入 `closing`，收到引用原控制 ID 的关闭回报才进入 `closed` |
| task | `task.report` | Executor 或 device | 回报进度；`resumed`、`closed` 引用原控制 ID，传输确认不算执行完成 |
| task | `task.message` | Coordinator | 向原事项绑定的执行 Session 发指导；带稳定消息 ID 与 Session 代次，不改变阶段或 Plan；忙碌时保留并幂等重试 |
| task | 失败退回 | | 测试或验收失败时，同一事项回到原执行 Session，不新建事项或 Session |
| task | 发布之后继续 | Coordinator | 本轮发布后结束；继续处理时读取最新 Main 并新建执行 Session，同一 Bug 保留原记录 |
| bug | `createBug` `updateBug` `resolveBug` | C / E / T | 创建、更新、修复。Bug 只有一份记录 |
| bug | 写文件 | | 不因缺少 Plan 或缺少节点授权而阻止写入。另一任务可以更新同一份 Bug 记录 |
| idea | `createIdea` `updateIdea` | human 或 coordinator | 创建、更新 Idea |
| brief | 签发 brief | human | 人对指定 brief 版本批准或拒绝并取得服务端回执；对话回答不是签发 |
| brief | `prepare_task`（人工模式） | Coordinator | 显式选择事项须提供 `itemId`、`nodeId`、`kind`；`taskId` 不关联事项。已关联事项对话仅三字段全缺省时继承可信焦点，显式局部身份返回 `INVALID_ARGUMENT`；无焦点时 `kind=bug` 缺 `itemId` 同样拒绝，不生成 TODO 提案。新 Bug 先通过 `edit_map` 创建。确认仍按指定版本，不自动派发 |
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

`developerMainWriteClientIds` 是遗留配置，不授予可用的 Main 结构写入入口。`map main apply` 和 `main.structure.patch` 返回 `FORBIDDEN`，白名单 developer 客户端不能代替 Coordinator。人仍可通过工作台编辑 Main TODO 和注释，这不属于 developer 客户端写结构。

### 人类接口

工作台前端与后端的接口。

| 领域 | 接口 | 调用者 | 动作 |
| --- | --- | --- | --- |
| map | `getMap` `getNode` | | 读 |
| map | `createNode` `updateNode` `moveNode` `deleteNode` | human | Cloud 路径改 Main。页面上的修改自动保存。删除时如果下面还有子页或关联，先问人。人同意就可以删 |
| map | 本地 Main | | 只读 |
| todo | `listTodos` `getTodo` `updateTodo` | human | 查看、更新 TODO 业务内容；普通工作台编辑既有事项时保留服务端 dispatch 回执，展示用任务投影不写回 Main。Coordinator 派发与验收入口不变 |
| task | `listTasks` `getTask` | human | 查看 TODO/Bug 共用流程及投递状态；以事项类型、节点 ID、事项 ID 定位，不另建 Task 记录 |
| task | `acceptTask` | human | 对指定 TODO/Bug 的当前 brief 版本批准或拒绝，取得服务端审核回执；普通对话回答不能代替签发 |
| bug | `listBugs` `getBug` `updateBug` | human | 查看、更新 Bug 业务内容；普通工作台编辑既有事项时保留服务端 dispatch 回执，展示用任务投影不写回 Main。Coordinator 派发与验收入口不变 |
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

### 宿主接口

Codex、Cursor、Claude 等宿主与 Context Guard 的连接。

| 领域 | 接口 | 动作 |
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

### Cloud 接口

本地 Context Guard 与云端交换状态、事件和权限。

| 领域 | 接口 | 动作 |
| --- | --- | --- |
| project | `connectProject` `disconnectProject` `getProjectState` | |
| sync | `pullState` `pushOperation` `syncStatus` `checkpoint` | 同步只走 Session。旧的项目地图同步不是接口 |
| session | `openSession` `syncSession` `reopenSession` | |
| session | `publishSession` | 不写入 Main 节点。发布之后这一轮结束；后续执行从最新 Main 开始并新建 Session |
| events | `subscribeEvents` `getEvents` `ackEvent` | 区分 Cloud 入队、宿主持久接收和实际处理；`ackEvent` 只确认接收，不代表 Agent 已执行；重连重送原 ID，宿主去重，业务完成须有匹配回报 |
| conflict | `getConflict` `resolveConflict` | 能识别人当前是否正在改，并提醒人 |
| auth | `login` `refreshToken` `logout` | 登录只有这一套 |
| memory | `getMainMemory` `getSessionMemory` `updateMemory` | |
| memory | `getMemoryFile` | 按 Main/Session 和版本读取单个文件，包括项目或节点 `memory.md`；版本变化时返回冲突 |
| memory | 恢复 Main | 只保留最近 5 个 Main 版本。更早的版本自动删除 |
| integration | 消息相关性判断 | 在已开放项目内根据消息、有限线程上下文及项目概览判断是否需要 Coordinator 回应；不创建对话、不写 Map、不调用业务工具。无关消息保持安静，判断失败不得当作相关。决定带原消息 ID 与所读 Main 版本；插件持久保存后按原 ID 重试 |
| recovery | `retrySync` `recoverSession` | 保留原事项、Session 与消息 ID；明确未执行的失败可重试，结果未知先核对；失败可见，不把排队或接收显示为完成 |
| heartbeat | `heartbeat` `getPresence` | |

#### 读取已发布 Main

`skill-reference/map-read.md` 指向本节。Cloud 读取已发布 Main 调用 `workbench.read`，`POST /api/v2/messages`。

认证：请求头 `Authorization: Bearer <credential>`。凭证来自 `auth.open` 返回的设备连接，或已注册的 Agent 连接。人类浏览器也可以用工作台 cookie，并在 URL 上带已授权项目的 `?project=`。

调用参数在消息的 `payload` 里：

| 字段 | 要求 |
| --- | --- |
| `scope` | `main` 或 `session`。读已发布 Main 用 `main` |
| `cursor` | 字符串，可以为空，最长 4096。第一页用空字符串 |
| `limit` | 整数，1–100 |
| `version` | 可选。省略时取当前已发布版本；后面的分页和路由必须固定响应里的这一版 |
| `nodeIds` | 可选的节点 ID 列表 |
| `recovery` | 只有 `scope` 为 `session` 且没有 `nodeIds` 时才能为 true |

消息还要带调用方自己的 `session`：`id` 与 `generation`。读 Main 时这个 Session 是调用身份，不是另一张地图。

最小示例：

```http
POST /api/v2/messages
Authorization: Bearer <credential>
Content-Type: application/json

{
  "v": 2,
  "id": "read-main",
  "type": "workbench.read",
  "session": { "id": "s", "generation": 1 },
  "payload": { "scope": "main", "cursor": "", "limit": 20 }
}
```

## 启动与绑定

### 项目名称与入口

workbench --root 输出 JSON URL，如 http://my-project.localhost:1355/prototype/workbench.html；Node 非零失败，Python 默认浏览器，--no-open 可禁。不需 Portless 全局/DNS/证书/管理员或新增 npm 依赖，Map CLI 直连认证后端。

名称来自项目名，小写 DNS 字母数字连字符（Context_Guard→context-guard），全非 ASCII 用稳定 project-`<id>`，--name 可指定。已注册名称不能跨项目占用，即使后端停止；不杀其他项目，路由私有非记忆。

```sh
context-guard workbench --root "/path/to/project" --name my-project
context-guard workbench --diagnose --root "/path/to/project" --session "actual-hook-session-id"
context-guard map status --root "/path/to/project" --session "actual-hook-session-id"
context-guard map read --root "/path/to/project" --session "actual-hook-session-id" --node M1
context-guard map changes --root "/path/to/project" --session "actual-hook-session-id" --cursor "last-cursor"
```

Hook/初始化/Bug Markdown 需 Python，服务/写入/通知 Node18+，非 Git 保留单文档。浏览器仅恢复副本/偏好，非权威。

### 真实 Session 与项目绑定

CODEX_THREAD_ID/CLAUDE_SESSION_ID/CURSOR_SESSION_ID 是宿主 ID；注册须生命周期、当前进程或同 worktree Codex 本地状态证明。codex exec 无 SessionStart，仍宿主证明，不虚构人类/演示身份。以 Session 为键，同分支也隔离；页面宿主任务名/worktree，不以完整/缩短 ID 代标签。

启动/每提示 workbench --binding-status：绑定 current/moved/other-worktree/stale/project-mismatch，运行 ready/stopped/legacy/duplicate/unknown/named-mismatch。未绑定先 --list，唯一就绪或兼容停止实例复用，首次/歧义/不匹配/迁移才人确认，Hook 不猜/开浏览器。

URL 须同 Git 项目/后端/兼容运行时。损坏修复不造空 Map；识别旧运行时/规范 URL 过期经注册表 workbench --session 修复，无须重绑。未知/重复/不匹配先诊断，不另开。

Main 取明确 GitHub origin/HEAD 或 --bind-main `<branch>` --remote `<name>` / --local-main `<branch>`，不猜 main/master。语言项目级继承；迁移已有 Session 人确认 --rebind，保旧数据、撤旧能力、清视图缓存。

命名路由前准备绑定，最终 URL 身份核验才提交；绑定返 workbenchUrl，直连仅诊断。?session=`<id>` 固定页只此 Session，其他任务不改选中；全局/切换用未固定工作台。

### 关联 worktree 与服务复用

Git 公共目录共享绑定/项目服务，Map/日志按 Session/worktree 隔离。旧本地图仅明确绑定 Session 初始化；Cloud 视图取已发布 Main，断连保最后有效，不导未合并图或 Git 跟踪记忆。

```sh
context-guard workbench bind --root /path/to/second-worktree --project-root /path/to/map-worktree
```

路径须同本地 Git 公共目录，不关联克隆/同名/其他仓库，不绑定链。先保第二草稿、停其服务，目标 Map 已存在不创建；第二已有图须 --keep-local 才继续，只留文件、不合并/删除/授绑定。

目标只定服务，Python 记录仍源树不迁。命名/身份存公共 Git，私有全局 ~/.context-guard/named-workbench/projects.json 在可替换 Skill 外；升级/重装/重启不清绑定或增服务。

### 状态清点与迁移

--list 只读持久目录/路由/核后端，含仅路由旧实例、跨树去重，不启停/清理。registeredCount 持久数，runningCount 有身份回应后端含旧，readyCount 兼容且命名可用；另 stoppedCount/attentionCount，共享代理不算后端，过期路由保留。

项目只展示名称/URL及 ready/direct-only/legacy/duplicate/route-stale/route-mismatch/stopped/unknown，非 Session/Git/实例ID。unknown 是所有者存活无回应，不自动替换。

兼容看结构/命名能力，非宽泛 HTTP 协议号；--diagnose 查公共 Git 全注册不启停。migrationRequired 时审精确 pid:instance；migrate --root ... --retire `<keys>` 先私有公共Git备各 .codex/context，再只 SIGTERM，身份变中止、超时不强杀，未知文件保留。

### 进程与浏览器生命周期

回环 HTTP 代理跨项目、独立于后端，停项目不影响其他；无目录轮询/证书/外网/隧道，支持 SSE 非 WebSocket。默认1355，占用则随后20端口选空，不接管。崩溃下次 workbench/SessionStart 恢复，无监督轮询；活但不健康报错不强杀。

转发凭据前核实例、Host/Origin及跨项目隔离。已识别旧代理/后端原位升级：代理认证停并保路由，后端同步屏障/锁释放，否则 UPGRADE_PENDING、不另起。未知/重复仍显式迁移，兼容升级保浏览器稳定来源。

打开权后端原子领取，活页抑重开、首次并发5秒窗口；失败也可能延迟5秒，CLI 仍给URL。headless/CI/恢复/压缩不开浏览器，SessionStart 只核绑定/注入。

- CONTEXT_GUARD_NAMED_WORKBENCH=0 或 --direct：旧直连。
- CONTEXT_GUARD_NAMED_STATE_DIR：默认 ~/.context-guard/named-workbench，私有、不跨 OS 用户。
- CONTEXT_GUARD_NAMED_PORT：默认1355。

路由存储派生 Portless0.15.6 Apache-2.0，THIRD_PARTY_NOTICES.md/licenses/Portless-Apache-2.0.txt 随包。代理/适配自有，非完整 Portless。tests/named-workbench.test.mjs 入 npm test，不证明全部宿主/系统/浏览器验收，缺口 CI_todo。

map read 取页面检查点，未保存 UI_PENDING，无回应页驱逐，恢复副本不阻权威。读取不锁推理，下次写仍已读版本；不退旧卡片。

## 提交操作

```sh
context-guard map apply --root "/path/to/project" --session "actual-hook-session-id" --input request.json
context-guard map operation --root "/path/to/project" --session "actual-hook-session-id" --id "same-operation-id"
```

```json
{
  "operationId": "a-unique-id-kept-for-retries",
  "baseVersion": "version-returned-by-read",
  "operations": [
    {"type":"create","parentId":"M1","node":{"id":"N100","title":"通知","kind":"work","purpose":"负责对外投递","owns":["src/notifications/index.mjs"],"memories":[{"text":"引入对外投递","paths":["src/notifications/index.mjs"],"proposalEvidence":{"parentId":"M1","basis":"new-module","reason":"新增独立运行边界和入口","files":["src/notifications/index.mjs"]}}]}},
    {"type":"update","id":"N21","fields":{"purpose":"更新后的职责"}}
  ]
}
```

原子操作：
- initialize：仅 root:null 旧图，正常带版本 project/node:{id:"T0",title:"...",kind:"module"}，不替非空；新初始化最小根。
- create：唯一 ID/现有 parent/可编辑字段。人可最少信息，Agent 要短 title/purpose、owns、含 parentId/basis/reason/files 的 proposalEvidence 记忆及至少一个实现文件；拒重复活动名/重叠待审，仍人审提案。
- update：id/fields，Agent 仅自己未确认提案或人授权真实 Session 节点。
- move：id/parentId，来源目标均授权，不根/环/无效 ID。
- delete/document：仅人，引用有效；document 涉 bootstrap/flows。
- attach-bug：仅唯一 Bug 摘要，不增其他字段权/批准。

可编辑 title/purpose/kind/state/memories/ideas/todos/bugs/dormant/files/owns；proposal/isNew 工作台确认。children 与旧 _inbox ID 均唯一，旧未知元数据保留，owns 相对路径非任意文件写入。

新 Session 默认动态全 Session Map，后建已确认节点加入。人可明确集合/恢复全范围/撤销；子授权非祖先，撤销对排队未写有效。非 Main/发布/管理，确认提案不等于改范围。

Bug/TODO 只给 sessions/target_session 包含自身；其他/未分配从 Session 状态、事件、卡片、索引排除。受限保存还原隐藏项，不能删他人工作或猜 ID 改写。

## 归档与 Map 对齐

archive-session --files 为实际改动相对文件，写本地笔记前做版本化归属检查。默认新上下文流程不追加节点流水账；[笔记](../formats/session-record.md) 不上传。以下是未启用新流程的兼容规则：

- owns 最长匹配，精确文件优先，追加归档记忆；未匹配 unclassified，不自动建节点。
- 文档/测试/生成/配置可显式 assignments(nodeId/reason/files)，目标已确认、本次文件、正常授权。
- 新结构 proposal(parentId/title/purpose/reason/basis/files)，basis new-module/new-interface/new-component/new-responsibility；仅支持文件非证据，父已确认、名称不重复、重叠去重，不能自批。
- Session/规范文件集/内容幂等，相同不重复，不同内容可同文件新记录。
- 缺权、UI_PENDING、路径错/冲突则不写归档，原命令可重试。

底层 map reconcile --root `<project>` --session `<actual-session-id>` --input `<json>`；通常 archive-session --input `<json-file-or->`：

```json
{
  "assignments": [
    {
      "nodeId": "workbench",
      "reason": "工作台实现的回归测试",
      "files": ["tests/workbench-browser.mjs"]
    }
  ],
  "proposal": {
    "parentId": "T0",
    "title": "通知",
    "purpose": "负责对外通知投递",
    "reason": "引入独立运行边界和公开入口",
    "basis": "new-module",
    "files": ["src/notifications/index.mjs"]
  }
}
```

可省不用顶层字段，按当前 Map 经原协议生成操作，不读写旧 roadmap。

## 状态、错误与恢复

保存/同步后台，“设置→同步与恢复”放恢复/Session选择；失败保浏览器副本，顶栏错误码/短因，详情设置，不浮动工具栏。

文本无需目录权限；静态演示/恢复才附件选择器。Node POST /api/attachments 仅人类，docs/shots/ 新 UUID 前缀，不覆路径，Map 引用相对路径；限8MiB，同 ID 同名同字节幂等、异内容拒绝。下载仅当前可见引用，非通用读文件。无附件按钮隐藏，首个粘贴/拖入显示，删末个隐藏。

上传离页须确认/取消；目标已删不改 Map，无引用文件保留待人工清理。

| 状态 | 必须处理 |
| --- | --- |
| committed:true | Map 已写，投影可待办/失败，页面另确认版本 |
| VERSION_CONFLICT | 保草稿、重读协调，新ID，不旧整图重试 |
| SESSION_REOPEN_REQUIRED | 后台取最新 Main、下一完整代，再补丁 |
| SESSION_BASELINE_CONFLICT | 完整重开需最新 Main，保草稿协调 |
| 网络未知 | 同 ID、完全同请求，跨重启幂等；异内容拒绝 |
| RECOVERY_REQUIRED | 可能已写，保 private/sync，重启/查同ID，不新 create；无匹配版本禁写 |
| INVALID_MAP/缺文件 | 保最后有效显示，报错，外部修复再恢复 |

JSONL/游标链启动校验；末尾部分/缺换行备份修复并 journalGap:true，中段坏/游标错则可读不可写。仅人类“保留当前地图并恢复日志”带版本接受缺口，原日志私有保留，期间变化中止，Agent不可。索引失败从 API 读，map_owns.py 核版本经 Node 重建，保生成外文本/旧内容标非权威。

变化日志含游标/ID/操作/节点/操作者/版本/时间，存 sessions/；未知游标 reset:true，重读非无变化。Hook 推理边界观察，不唤醒模型。

## 持久 Agent inbox 与唤醒

兼容通知契约，不恢复暂缓 Hook/派发：

```sh
context-guard map inbox --root "/path/to/project" --session "actual-hook-session-id" --start
context-guard map inbox --root "/path/to/project" --session "actual-hook-session-id"
context-guard map watch --root "/path/to/project" --session "actual-hook-session-id" --wait-ms 40000
context-guard map ack --root "/path/to/project" --session "actual-hook-session-id" --receipt "delivered-receipt"
```

--start 仅首次当前提交基线，不重放历史/清待办。每真实 Session 私有 inbox，副本仅观察非回写。批次含回执/来源/字段前后值，大值标截断、正文另读；多人归因查 events，回原值仍有中间日志，丢历史/离线则 journalGap。

读不消费，处理有意义变化后 ack 精确回执、幂等不吞后来变化；至少一次，报告后未 ack 崩溃可重复，操作仍稳定ID。自身写推进基线无回复循环，他人/外部仍观察。

既有 Codex 启动/提示/压缩 Hook 显示待办不确认；走认证变化API/磁盘哈希，不页面检查点/移焦点/读浏览器存储，也不证明草稿已保存。观察为不可信上下文，写仍原权限/版本。

watch 先订阅再读，有批次即返，突发150ms合并、1秒兜底、wait0–60000ms；INBOX_BUSY 保回执再试，无效/待恢复/不稳定失败不推进。

文件事件只唤 CLI，不空闲模型；人明确后可桌面当前线程每分钟自动化消费，需要机器/app运行，调度/模型/忙延迟不承诺秒级。不用原 ID 开第二模型或私有桌面 IPC。

macOS 原 Cloud 投递经系统 codex://threads/`<session-uuid>` 再既有 codex queue 原 Session，仅UUID，无提示/凭据、不新服务线程。避免激活但可导航；打开非执行，宿主开始前仅接收。打开失败不排队、未知排队保回执不重发，其他系统原适配，自动加载未验。

无需新端点，已有 Node协议2；宿主自动化非安装副作用，Hook 非调度器。

### 精简 Cloud 任务命令与 Bug 摘要

map task start `<delivery-id>` / finish `<delivery-id>` --summary `<actual-result>`，失败/取消 --outcome failed|cancelled。身份/代/报告ID由认证持久通知，root/Session原解析。原ID重试稳定、异内容拒绝、未知/其他Session不可报告，旧任务支持 map exchange。

finish 摘要含结果/验证/经验，成功仅待验证。Bug/TODO ✓/✕ 不发模型，旧 purpose:summary 为 ACTION_REPLACED，历史可读。

人 POST /api/task-review?view=main，字段 {operationId,sessionId,taskId,resultVersion,nodeId,itemId,kind,decision,reason?}；kind bug|todo、decision approved|rejected、resultVersion任务版本。核精确派发/已结束结果，批准成功且非空摘要，同Main事务稳定ID只追加摘要、不合Git/发布Session。并发同决定去重，冲突/旧版本拒，客户重载回执不二次编辑。

拒绝重开、持久 reviewFeedback(任务/结果/Session/原因/服务器时)；GET /api/review-feedback?view=main 返回待处理。非队列，不猜Agent/唤醒/自动返工，Main路由/澄清后续。

## 用户提示信号与 Map TODO

UserPromptSubmit 私有稳定信号，按语义非关键词：

```sh
context-guard record-todo --root "/path/to/project" --session "actual-hook-session-id" \
  --signal "SIG-..." --node N1 --title "新需求" --description "验收说明"
context-guard record-bad-case --root "/path/to/project" --session "actual-hook-session-id" \
  --signal "SIG-..." --node N1 --title "失败" --phenomenon "失败现象"
context-guard resolve-signal --root "/path/to/project" --session "actual-hook-session-id" \
  --signal "SIG-..." --kind task
```

record-todo 核真实生命周期/节点授权，todos[] 绑Session/信号及创建更新时间，幂等。Bug 挂图成功才解决；TODO.md 归人，Hook 拒 Agent 写。

split-signal --root ... --session ... --signal `<parent>` --input `<json>`，如 {"items":["现在修复渲染","后续添加快捷键","记录保存失败"]}；拆分幂等，逐子分类，未解阻收工，分类冲突在Map前拒，不遗孤立事项。

## 明确的开发计划

批准实现后先分类信号：

```sh
context-guard plan-start --root <project> --session <actual-session-id> --input <plan.json>
```

```json
{"approved":true,"summary":"修复渲染","node_ids":["N1"],"paths":["src/","tests/render.test.mjs"]}
```

approved 是 Agent 对人授权的记录，非浏览器能力；另核节点权限，读取节点/待办审核、ack inbox、哈希路径、时间及已配 Cloud Sync。

不可第二活动 Plan，extend:true 扩已批范围时保ID/旧基线/未验、记修订并失效旧归档。新增脏路径需 scope_review，Git HEAD基线，不藏未验编辑，无虚构原生批准事件。

修改工具需活动Plan，已知越界拒；未知shell标未验证，非沙箱。只读/独立恢复可用，Hook不逐文件Cloud同步。

人审前不归档；人审后 archive-session --files ... --input `<archive.json>` 包含全部改动、可选assignments/proposal，并提供：

```json
{"verification":"npm test：通过；产物或日志位置","assessment":{"decision":"reuse","reason":"未引入独立模块，属于渲染职责"}}
```

assessment reuse/propose/none，propose须证据且不能自批；未知脚本scope_review，失败工具failure_review及重验，委派subagent_review映Agent到证据/弃用原因。Hook只查存在非真实性。无文件Plan仍授权节点摘要/证据，unclassified非成功。

本地人审/归档后plan-finish；Cloud任务先精确提交/handoff，Plan活动，Tester/人审后归档结束。finish核归档/文件hash/未确认变化，Cloud范围/检查/结束；失败未完成，归档后再改重新验证。plan-status恢复活动/完成/信号。

Stop不自行结束。Codex仅保存未完并下次提示恢复，不显示阻断控制；支持不可见续执行宿主可阻一次，重复Stop INCOMPLETE不循环。本地观察不锁其他写者，远端finish串行冲突，任意脚本实际范围需人/Agent审，宿主投递须安装验收。

## 缓存迁移与外部保存

保旧来源，导出cg-workbench-maps-v16；同来源新页可导旧缓存，不同来源旧页Application→Local Storage或 copy(localStorage.getItem('cg-workbench-maps-v16'))。保存JSON后Node“导入并比较”，不删原数据。

输入/当前图私有备份，预览默认不选，按ID/字段审替换/删除，非mtime胜者。版本校验、重复不create，未知元数据保备份、不默认授权。

外部编辑探测/校验/推送，但忽略锁有最终校验竞态，支持Agent须CLI/API；未知保待办，不承诺任意外部写者全局串行。

## 本机信任边界

回环/Host/Origin/大小/分离能力防actor自称人，私有Token不公开；单用户工具非OS沙箱，有用户全文件/浏览器权者可改图冒人。端口不暴露，不隔离同UID恶意Agent。

一个兼容Node拥有项目，旧/重复先诊断/备份/显式迁移，不杀。workbench --root ... --stop 等页面检查点，无回应驱逐、脏页先保存/处理。运行私有、摘要sessions、索引派生，不增数据库/Test Hub/发布步骤。
