# Session 工作台接口规范草案 v0.3

> 历史设计背景；当前传输格式以 [接口规范 v2](interface-contract-v2.md) 为准。本文不与 v2 叠加执行。

状态：提案，等待逐项讨论；不是已实现的 API 承诺。源码对照基线：`69c3f77d`。

本文不修改运行协议、不部署服务。现有 `references/workbench-interface.md`、`references/cloud-sync-interface.md` 和 `references/server-memory.md` 仍描述现行约束；有差异处以本文的“提案”标识进入后续设计，不自动覆盖实现。

## 1. 已明确的产品边界

1. Session 在各自 worktree 工作，不直接编辑 GitHub Main 或 Cloud Main。
2. GitHub PR 负责源码、正式测试及获准的工程文件；执行 CI 和分发/提交过滤。
3. Cloud 合并请求负责可视化成果、经验等获准内容。具体文件和内容清单后续定义，不能默认上传整个工作目录。
4. Cloud Main 只能经合并服务更新，普通 Session 写接口不允许指向 Main。
5. 本地模式使用本地前端和后端；Cloud 模式允许只运行本地后端，由 Cloud 提供前端。本地前端不应成为同步必需条件。
6. 两种前端提供相同的 Session 操作语义。Cloud 上的编辑、提问和本地后端产生的结果需要双向传递，不只是定时上传 Map 文件。
7. Cloud 下发的是 Todo/Bug 分配、问题和允许的工作台操作，不是代码补丁或任意文件修改。代码由本地 Agent 在对应 worktree 中处理，再经过 GitHub PR。同步工作台数据不等于同步源码。

## 2. 模块职责（提案）

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| 工作台前端（本地或 Cloud） | 展示状态、发起操作、显示回执和失败、保留未提交草稿 | 直接写文件、决定 Main 合并、伪造 Agent 或管理员身份 |
| Session 本地后端 | 校验并执行 Session 命令、协调本地持久化、生成状态与事件 | 接受任意远程文件路径/任意 shell 命令、直接写 Main |
| Cloud 连接与事件服务 | 鉴权、路由到正确 Session、持久接收队列、事件分发与断线恢复 | 将“已入队”当成“本地已执行” |
| Agent 宿主适配器 | 将结构化问题送到正确的实际任务，返回可验证的接收/执行状态 | 将排队成功当成模型已经回答 |
| Cloud 合并服务 | 固定待审版本、审核与版本校验、原子更新 Main 和保留回执 | 合并审核后新增但未审的内容 |
| 存储适配层 | 原子保存、记录恢复、附件归属及受限路径访问 | 自行改变接口语义或跨 Session 写入 |

已确认：Cloud 联机模式采用“本地 Session 后端执行、Cloud 持久排队和分发确认结果”。本地离线时操作先保存在 Cloud 待处理序列中，恢复后补读；Cloud 可以显示待执行编辑，但不能标记为本地已执行。这与当前云端直接修改 Session 快照的实现不同，仍需后续实现迁移。Cloud 权威归档与本地执行职责不是同一概念。

已确认：同一电脑、同一项目共用一个同步后台，由本地工作台后端承担，不为每个 Session 启动重复脚本。后台按 Session/worktree 分发，每个 Session 独立队列、进度和结果。多个电脑不是自动共享同一个进程，跨电脑迁移仍需显式绑定规则。

## 3. 身份、作用域和连接

- 仓库身份由规范化的 Git 远程信息匹配；服务器内部 `projectId` 自动取得，不让用户手填。仓库匹配不等于授权。
- 每个请求固定 `projectId`、`sessionId`、`generation`；本机 worktree 绑定由后端验证。重开同一 Session 用新 generation 隔离旧请求。
- 分支名仅为元数据，不是 Session 身份。Main 使用独立只读接口，不用缺省 Session 来暗指 Main。
- 多远程、fork、仓库移动及非 Git 项目的匹配规则待确认；身份不明确时禁止静默绑定。
- 本地后端主动通过 TLS 连接 Cloud，不要求用户把本地监听端口暴露到公网；浏览器不持有 Agent 同步令牌。
- 登录后自动取得限定项目/Session 的设备权限。配对方式、凭证保存、刷新和撤销细节待定；密码不得写入配置、日志、Map 或 URL。
- 同一 Session generation 的执行实例需要带期限的独占绑定及递增连接代次，拒绝失效实例执行命令。具体租约协议待定。

## 4. 统一交互契约

以下为逻辑接口名，不是已经部署的 URL。HTTP 路径与 WebSocket/SSE 的传输选择后续确定；不得机械透传所有本地管理端点。

| 编号 | 接口 | 输入要点 | 输出/成功条件 | 调用权限 |
| --- | --- | --- | --- | --- |
| IF-01 | capabilities | 客户端支持的协议和能力 | 协议选择、数据版本、支持操作、限制、连接模式 | 已授权连接 |
| IF-02 | session.snapshot | 明确 Session/generation，可选已知版本 | 已确认状态、版本、事件游标、连接和恢复状态 | Session 读 |
| IF-03 | session.command | 命令 ID、基础版本、类型和结构化载荷 | 持久回执；Cloud 入队与后端执行分开 | 按命令授权 |
| IF-04 | session.events | Session/generation、最后应用的游标 | 按序状态增量、命令结果、消息进度等 | Session 读 |
| IF-05 | command.receipt | 原命令 ID 和作用域 | 当前处理阶段、最终结果或明确未找到 | 原请求可见范围 |
| IF-06 | attachment.put/get | 附件 ID、大小、类型、摘要及所有权 | 完整保存且摘要正确；下载需校验作用域 | Session 附件读写 |
| IF-07 | session.question | 消息 ID、文本、关联节点/任务 | 入队、宿主接收、执行、回答或失败分别可查 | 向该 Session 发消息 |
| IF-08 | session.presence | 客户端 ID、草稿/在线信息 | 临时在线状态；不能当成业务保存回执 | Session 连接 |
| IF-09 | main.snapshot | 项目、可选 Main 版本 | 已合并基线、来源和版本；只读 | Main 读 |
| IF-10 | cloud.merge-request | 固定 Session 版本、Main 基础版本和内容清单摘要 | 不可变候选版本和可审查差异 | 提交合并请求 |
| IF-11 | cloud.merge-review | 请求 ID、候选摘要、审核结果 | 与该候选版本绑定的审核记录 | 独立审核权限 |
| IF-12 | cloud.merge | 请求 ID、候选摘要、预期 Main 版本、幂等 ID | 原子合并回执及新 Main 版本 | 合并服务权限 |

命令类型初步分为：地图操作、Todo/Bug 操作、消息、权限变更。授权修改必须是独立受限命令，不允许混入普通文本或节点字段。是否允许 Agent 提交某类命令由服务端权限决定。

### 4.1 请求示意

```json
{
  "protocolVersion": "proposed-v1",
  "projectId": "server-assigned",
  "sessionId": "actual-session",
  "generation": 1,
  "commandId": "unique-id",
  "baseVersion": "revision-read-before-edit",
  "type": "map.apply",
  "payload": { "operations": [] }
}
```

此示例只展示信封，不代表空操作合法。操作类型、字段校验、消息长度、附件大小和队列限额需要正式 schema。未知写操作必须拒绝，不能忽略后返回成功。调用者身份从已验证的连接中取得，不信任请求自己声明的角色。

### 4.2 回执与重试

- Cloud 接收后持久化成功才返回 `accepted`；本地执行并保存后为 `appliedLocal`；确认结果在 Cloud 持久化后为 `replicated`。
- 本地模式只要求本地持久化，不伪装成已经云端同步。前端是否已经展示是独立状态，不阻塞业务持久化。
- 同一作用域、同一 commandId、相同原始业务载荷重试，返回原处理结果，不重复产生业务效果。动态预处理不能改变幂等判断依据。
- 相同 ID 不同载荷返回 `ID_REUSED`。超时表示结果未知，先查询回执或用原请求重试。
- 消息的“宿主接收”“开始执行”“回答完成”独立于传输回执；不具备宿主唤醒能力时返回明确的不支持或等待状态。

### 4.3 事件与恢复

- 持久事件包含 eventId、Session/generation、单调游标、关联 commandId、状态版本、类型和载荷。时间用于展示，不用于决定写入顺序。
- 快照携带与其状态一致的游标；订阅从该游标之后开始，不能在读快照和订阅之间漏事件。
- 接收方应用后推进游标；重复事件去重，发现缺口补拉，游标失效则取新快照并保留本地未确认命令进行对账。
- 心跳、鼠标位置等临时事件与业务事件分开，不要求永久保存；具体哪些可视化状态属于共享数据后续逐项确认。
- 草稿、密码输入、浏览器私人偏好不默认广播。共享节点、关系、Todo/Bug、消息和执行状态属于候选同步范围。
- “像直播”表示正常在线时事件驱动、无需刷新，不承诺断网时仍即时一致。延迟目标与测量方法待定。

### 4.4 并发与错误

不同 worktree 隔离文件，但同一 Session 的 Agent、两个前端及后台任务仍需经过后端协调写入。baseVersion 过期不允许静默覆盖；自动合并范围必须受规则约束。

建议标准错误：`UNAUTHENTICATED`、`FORBIDDEN`、`UNKNOWN_SESSION`、`STALE_GENERATION`、`VERSION_CONFLICT`、`ID_REUSED`、`INCOMPATIBLE_PROTOCOL`、`UNSUPPORTED_CAPABILITY`、`RECOVERY_REQUIRED`、`QUEUE_FULL`。本地离线时明确返回排队阶段或拒绝原因。错误包含可安全显示的信息、是否可重试及恢复动作，不返回凭证或私有路径。

### 4.5 项目连接、心跳和下行队列

以下产品行为已确认：项目后台主动保持 Cloud 连接；在线变化立即推送；每 10 秒通过心跳核对 Cloud → 本地进度并补漏。心跳不传文件。本地 → Cloud 由本地变化主动触发，失败持久排队重试，不等待心跳。

以下字段和接口为本轮提案，尚未实现。统一路径前缀建议为 `/v1/projects/{projectId}/sync`，所有接口都要求验证项目权限；Session 清单还需逐项验证归属。

| 编号 | 方法与相对路径 | 用途 | 成功响应 |
| --- | --- | --- | --- |
| IF-13 | POST /heartbeat | 每 10 秒汇总所绑定 Session 的已处理进度，检查连接和下行差距 | heartbeatId、各队列 latestSeq、ackedSeq、hasPending、连接状态 |
| IF-14 | GET /events | 一条项目级 SSE 连接，通知哪些 Session 队列有新数据 | queue.available 通知，含 Session/generation 和 latestSeq |
| IF-15 | GET /sessions/{sessionId}/commands | 按 afterSeq、generation、limit、maxBytes 分批补读 | 有序 commands、nextAfterSeq、hasMore、latestSeq |
| IF-16 | POST /sessions/{sessionId}/ack | 提交连续操作的持久处理结果 | Cloud 已保存的 ackedSeq；可安全重试 |

传输提案采用 HTTPS 请求 + 项目级 SSE，复用现有 SSE 基础；不额外引入 WebSocket。一个长期通知连接不等于所有文件和请求挤在同一条字节流里。无需依赖 SSE 通知完整重放：通知只是提示，持久命令队列与心跳负责补漏。

心跳请求示意：

```json
{
  "heartbeatId": "unique-heartbeat-id",
  "deviceId": "paired-device",
  "connectionEpoch": 3,
  "sessions": [
    { "sessionId": "actual-session", "generation": 1, "settledSeq": 42 }
  ]
}
```

响应示意：

```json
{
  "heartbeatId": "unique-heartbeat-id",
  "sessions": [
    {
      "sessionId": "actual-session",
      "generation": 1,
      "latestSeq": 45,
      "ackedSeq": 42,
      "hasPending": true
    }
  ]
}
```

- `latestSeq`：Cloud 已持久接收的命令最大序号，不是时间戳或 Map 版本。
- `settledSeq`：本地已有持久结果的最大连续序号；收到、下载或放进内存不算执行完成。通常为成功执行，显式终止的命令必须有失败/取消回执，不能伪装成功。
- `ackedSeq`：Cloud 已持久保存结果回执的最大连续序号。心跳上报不能替代 `/ack` 的结果校验，也不能据此删除队列。
- 正常 `ackedSeq ≤ settledSeq ≤ latestSeq`。本地领先 ack 时重发回执，Cloud 领先 settled 时补读命令。出现回退、超界、generation 不符时暂停该队列并对账，不能简单取最大值。
- 操作按 Session/generation 分配连续序号；有多个 Session 时心跳批量携带少量进度元数据。很多 Session 的分页/分帧大小由协商限额控制，不把完整状态塞入心跳。
- 同一心跳周期不叠加无限请求；建议连续两次超时标记连接异常并启动退避重连，休眠恢复立即对账。其他请求和执行不能阻塞心跳调度。

### 4.6 读取、执行与确认

1. Cloud 将用户命令和初始回执原子持久化，才显示“Cloud 已保存”，随后发出通知。
2. 项目后台收到通知或心跳发现差距，调度对应 Session 从已处理位置分批补读。对同一队列合并重复拉取请求。
3. 先保存到本地 inbox，再由该 Session 的执行器串行校验和应用；不允许一个 Session 的未处理命令因另一个 Session 前进而被跳过。
4. 本地业务变更与去重回执使用可恢复事务关联。进程在写入后、确认前退出时，重启可查到原结果，不重复修改。
5. `/ack` 发送 commandId、seq、结果状态、resultVersion 和 receiptId；Cloud 验证作用域、连接代次、连续性与原命令，持久化后返回 ackedSeq。
6. 状态变更数据通过关联 commandId 的上行通道保存到 Cloud；只有回执和对应状态均齐全，前端才显示“已同步”。回执先到不能让 Cloud 页面提前冒充最新状态。

补充边界：

- nextAfterSeq 只表示本批返回位置，不代表执行确认。下载游标、执行进度、Cloud 确认进度不得混用。
- 临时失败自动退避；冲突保留命令并阻塞该 Session 后续相关修改。不能无限忙重试或悄悄跳过；其他 Session 继续运行。
- 永久无效命令可以写入明确失败回执；如果后续命令依赖它，必须一并标记受阻。取消/跳过需显式规则和审计，不把失败变成成功。
- 问题命令完成可靠宿主投递后可记录“已交付”，回答作为独立任务结果继续流转，不要求整个地图队列等待模型生成结束。宿主不提供去重/回执能力时，结果标记未知或不支持，不承诺恰好执行一次。
- 队列命令含原始 commandId；本地应用后上行是该命令的结果事件，不再包装成新的 Cloud 用户命令，避免同步回环。
- Cloud 待执行编辑需绑定其依赖命令或基础版本；连续编辑不能假装都基于同一旧快照。依赖冲突时保留草稿，具体前端合并方案待细化。
- 活跃 generation 中未确认命令不能被静默清除。Session 关闭/合并时若有待处理命令，必须拒绝收口或显式解决，不能把旧命令投递到新 generation。

### 4.7 大数据与资源预算

已确认目标：心跳轻量、文件与操作分离、不占用过多电脑资源。以下数值是待实测的初始建议，不是性能保证：

- 单批命令最多 100 条且编码后不超过 256 KiB，以先触及的限制为准；请求不能通过放大 limit 绕过服务端上限。
- 超限单条操作返回明确错误或使用已验证的大载荷引用，不能返回空批却一直 hasMore，造成死循环。
- 附件单独初始化上传、分块上传、完整性确认和下载；建议块大小 1 MiB，同一项目最多 2 个大数据传输。带宽上限可配置，默认值待测。
- 大载荷引用必须是同项目/Session 授权的 blobId、摘要和长度，不接受任意远程 URL 或本地绝对路径。所需附件未完整可用时命令显示等待，不标记执行完成。
- 命令按需分页落盘，不将全部历史加载到内存；项目最多 2 个 Session 同时处理批次，Session 内顺序执行，批次间公平轮转。
- 通知可合并为每队列最高 latestSeq，但业务命令不能任意合并删除。云端接收前的连续文字编辑可节流，明确提交的操作不因节流丢失。
- 心跳和小消息与文件传输分开调度；重连使用指数退避并加随机偏移，封顶建议 60 秒；鉴权失效停止忙重试并引导重新登录。
- 测量空闲、持续编辑、积压恢复的 CPU、内存、网络与磁盘开销，并同时测 Cloud → 本地延迟。正式上限在基准测试后确认。

### 4.8 Todo／Bug 任务契约（本轮提案）

范围：用户已明确 Cloud 主要用于分配 Todo/Bug。本节定义候选业务接口，不能仅因写入草案就认定 Agent 可以自动执行任何任务。

#### 数据归属与标识

- 项目任务收件箱是工作调度数据，不是 Cloud Main 基线的一部分；从 Main 节点发起任务仅保存 nodeId/mainVersion 引用，不直接修改 Main。此收件箱归属方案待审核。
- 未分配任务留在项目收件箱，不广播给全部 Session，也不自动新建 Session。
- 一个任务使用稳定 workItemId，kind 为 todo 或 bug；展示编号与内部 ID 分离，避免不同 Session 自增编号碰撞。
- title、description、验收条件、nodeId 和附件属于需求修订 revision。Bug 另有复现步骤、预期结果、实际结果和适用环境；信息不足可保存，但执行前须明确补充或调查范围。
- 分配记录使用 assignmentId、目标 sessionId/generation 和 assignmentRevision；一次执行使用 runId，并固定 workItemRevision。
- 第一版建议一个任务同时只有一个执行归属，历史执行记录只追加、不覆盖。多 Agent 协作及任务拆分另行设计。

#### 接口与权限

路径暂不固定，业务动作通过既有命令信封与队列传递，不额外建立一套无回执通道。

| 编号 | 动作 | 输入要点 | 成功含义 | 授权主体 |
| --- | --- | --- | --- | --- |
| IF-17 | work-item.create | kind、title、description、验收条件、可选节点/附件、commandId | Cloud 保存任务并返回 ID/revision；不代表已分配或开始执行 | 有任务创建权的用户/Agent |
| IF-18 | work-item.assign | workItemId、expectedRevision、目标 Session/generation | 分配与下行命令原子保存；返回 assignmentId 和 seq | 有分配权限的主体 |
| IF-19 | work-item.revise | ID、expectedRevision、显式字段变更及原因 | 保存新需求修订，通知当前执行方；不覆盖其已固定的旧修订 | 有需求编辑权限的主体 |
| IF-20 | work-item.cancel | ID、assignmentId、expectedAssignmentRevision、原因 | 保存取消请求；是否停止由本地确认，不提前显示已停止 | 有取消权限的主体 |
| IF-21 | work-item.progress | assignmentId、runId、workItemRevision、eventId、进度序号和状态 | Cloud 幂等保存执行状态并推送前端 | 当前受权 Session 执行器 |
| IF-22 | work-item.result | 执行身份、结果摘要、测试证据引用、可选 PR 引用 | 保存待验收结果；不自动合并 Main 或宣告人工验收通过 | 当前受权 Session 执行器 |
| IF-23 | work-item.review | ID、runId、固定结果版本、接受/需修改及原因 | 保存与本次结果绑定的验收决定 | 独立验收权限 |

主体必须由服务端鉴权确定；Agent 能创建任务不意味着能给其他 Session 分配、取消任务或批准自己的成果。凭证权限矩阵后续确认。

#### 三种状态不能混为一谈

| 维度 | 示例 | 表达什么 |
| --- | --- | --- |
| 传输 | Cloud 已保存 → 本地已接收 → 宿主已接收 | 指令到了哪里 |
| 执行 | 待执行 → 分析中 → 执行中 → 阻塞/失败/结果已提交 | 本次 run 做到哪里 |
| 验收 | 待验收 → 接受/需修改 | 对固定结果的判断 |

- 本地持久收到分配命令就可以确认“任务已接收”，代码尚未完成；不让一个长任务占住下行读取队列。
- 宿主能力不足或无法唤醒时显示“等待宿主/不支持”，不能将工作台接收当成模型接收。
- 正在执行时收到新需求，保存成新 revision 并提示“执行基于旧需求”；何时暂停/采纳由明确的执行策略决定，不悄悄替换正在执行的要求。
- 已完成任务被补充要求，保留原 run 和验收记录，新增修订并进入待处理；不把旧成功结果改写成从未完成。
- 进度事件携带单调序号，旧的“执行中”不能覆盖较新的终态；失败/取消后恢复需要明确的新 run，不能靠迟到事件复活。
- result 证据只传允许的摘要或授权引用，不上传密钥、原始完整日志或源码目录。允许内容清单仍待制定。

#### 取消、改派与断线

- 取消是请求，不是立即终止承诺。未开始的任务可持久取消；运行中的任务由适配器在可安全停止处确认，保留已产生的修改，不自动执行 git reset 或删除文件。
- 取消后到达的已完成结果照实归档，显示“完成早于停止确认”等实际结果，不能丢弃证据或伪称已停止。
- 改派需要先确认旧执行器停止/释放归属，再生成新 assignment；电脑离线时默认保持“改派待确认”，不能让两个 Agent 同时继续同一任务。
- 授权撤销不能排在被阻塞的普通任务后面；连接鉴权应独立拒绝旧身份的后续请求。撤销网络权限不保证离线电脑上的模型立即停止，UI 必须区分这两件事。
- 队列顺序保证的是命令交付/状态更新顺序，不是让每个任务完整开发结束后才读取下一条。每个 Session 的任务执行并发第一版建议为 1；项目后台仍可并行收取其他 Session 的指令。
- 同 Session 连续要求变更、取消与进度回传都使用 revision/assignment/run 身份检查。这里解决的是任务状态和需求版本冲突，不是云端代码与本地代码的合并。

## 5. 两条合并通道

### GitHub

Session 分支 → PR → CI/审核/文件过滤 → GitHub 合并回执。

GitHub Main 禁止普通 Session 直推。开发记录、凭证、缓存和临时文件不能借 PR、附件或构建产物进入公开仓库。沿用已有安全规则。

### Cloud（提案）

Session 已确认版本 → Cloud 合并请求 → 审核 → 合并服务 → Cloud Main 新版本。

- 候选由服务端从固定的 Session 版本生成，包含可视化变更和经验等内容的显式清单；清单类型未定，不启用任意目录上传。
- 请求至少固定 Session/generation/version、baseMainVersion、内容摘要、来源信息和相关 GitHub PR/提交引用（适用时）。
- 状态建议：draft → submitted → approved → merged；另有 changesRequested、conflicted、rejected、cancelled。
- 提交审核后修改候选，形成新修订并使旧批准失效；审核通过后不能偷偷追加内容。
- 合并时重新检查权限、批准对应的摘要、目标 Main 版本和所需 GitHub 结果。目标变化先重新计算差异，禁止整份覆盖其他 Session 成果。
- Main 数据、合并回执和审计事件原子持久化；重试返回同一结果。历史记录不可因合并而清空。
- 两个系统不能假装是一次数据库事务：一边成功另一边失败时明确标记待完成并安全重试，不自动撤销已经合并的 GitHub PR。
- 是否所有 Cloud 合并都必须等待 GitHub PR、仅经验/可视化改动如何处理、自动审核与人工审核条件，均待用户决定。
- 合并后的本地临时文件和 Session 工作区清理是独立流程，不由普通同步或合并请求自动授权；清单、保留和恢复策略后续制定。

## 6. 版本与升级契约（提案）

- 握手协商接口主/次版本和能力；内部 buildId 仅用于诊断，不能单独代表兼容性。
- 写入不兼容时失败关闭；可验证的只读兼容模式可以保留，不能把未知字段丢弃后写回。
- 前端缓存、后端、Cloud 和数据格式分别校验。升级保留项目身份、Session 绑定、未确认命令、游标和权限。
- 升级顺序：检查 → 保存/冻结边界 → 备份 → 替换 → 迁移 → 验证 → 恢复服务。不能为了升级而静默丢弃浏览器草稿。
- 数据迁移失败保留备份和新数据，明确恢复步骤；禁止仅回退二进制后宣称数据也已回滚。
- 保留一份明确的兼容矩阵；支持几个历史版本、自动升级窗口和回滚条件待确认。

## 7. 源码对照与缺口

| 现有代码 | 已有基础 | 与目标的差距 |
| --- | --- | --- |
| prototype/workbench-sync.mjs | apiBase、view、状态读取和提交适配 | 可复用适配层，但不是完整远程 Session 交互协议 |
| scripts/workbench/server.mjs | state/commit/events/changes/operation、附件和访问控制 | 本地管理接口不能全部暴露到 Cloud；需统一契约和能力表 |
| scripts/workbench/server.mjs 的 session-message | Codex 已存在任务/Bug 的发送 | 不等于任意提问、全宿主支持和回答事件流 |
| scripts/cloud/server.mjs | 项目/Session 页面、地图提交、事件和 publication | Cloud 未覆盖本地附件/消息等全部操作；当前直接修改云端快照 |
| scripts/workbench/sync-coordinator.mjs | Map 队列、云端事件、冲突处理 | 不是全部前后端交互的传输层；还有已记录的同步缺陷 |
| scripts/cloud/memory.mjs | 版本校验、发布、历史和幂等回执 | 发布不等于具备候选冻结/审批的 Cloud 合并请求；现有管理员写恢复通道需与“Main 只合并”政策明确隔离 |
| scripts/workbench/runtime.mjs、cli.mjs | 能力检测、旧版迁移 | 尚需产品化连接、升级指引与跨版本验收 |

## 8. 契约验收清单（待编写，未通过）

| 编号 | 必须验证 |
| --- | --- |
| CONTRACT-01 | 同一组 Session 读写用例对本地前端与 Cloud 前端语义一致；本地前端关闭仍可工作 |
| CONTRACT-02 | Cloud 编辑到本地文件、本地修改到两端页面均收到正确结果，无串 Session/worktree |
| CONTRACT-03 | 超时、丢回执、重复请求、乱序通知、重启和游标缺口不丢已接收业务操作 |
| CONTRACT-04 | 用户提问只送到正确宿主任务，排队/执行/回答/不支持状态可区分 |
| CONTRACT-05 | 普通 Session 无法通过任何变更路由直接写 Main；越权请求无副作用 |
| CONTRACT-06 | 审核后候选变化、Main 推进、重复合并、部分系统失败均安全处理 |
| CONTRACT-07 | 附件完整性、所有权、未就绪引用和上传失败可恢复 |
| CONTRACT-08 | 新旧前后端兼容、迁移中断、恢复和未确认队列延续 |
| CONTRACT-09 | 仓库自动匹配、登录/撤销/过期、失效实例及凭证不泄露 |
| CONTRACT-10 | 丢失即时通知后，10 秒心跳能发现 Cloud 队列差距；本地无变化也会补读 |
| CONTRACT-11 | 心跳不推进确认或删除队列；收到但未执行、已执行丢回执均可恢复 |
| CONTRACT-12 | 多 Session 分发隔离、公平调度；一个冲突或大文件不堵其他队列和心跳 |
| CONTRACT-13 | 超限单条操作、分块中断、附件缺失和大量积压可恢复且不无限循环 |
| CONTRACT-14 | 创建/分配重复投递不重复建任务或启动 run；指令不会路由到错误 worktree |
| CONTRACT-15 | 执行中改需求、完成后补要求保留原修订和结果；过期进度不能覆盖终态 |
| CONTRACT-16 | 离线取消/改派不冒充已停止，不产生两个有效执行归属；长任务不堵取消指令接收 |
| CONTRACT-17 | Cloud 指令不能提交源码补丁或任意路径写入；任务收件箱变更不直接写 Main |

上述编号是验收需求编号，不代表已有 CI 测试编号。实现时再关联正式测试文件和案例。

## 9. 首先需要确认的决定

1. 已确认：本地离线时 Cloud 持久排队；每项目一个后台，10 秒心跳核对 Cloud → 本地进度，本地上行主动触发。4.5–4.7 的具体字段、批量限额和失败处理为待审提案。
2. 哪些 Cloud 合并必须关联已合并的 GitHub PR？纯经验改动是否允许独立请求？
3. 可视化共享范围是否包含布局、选中节点、未提交输入？建议业务状态共享，私人视图与草稿默认独立。
4. 任务收到后的执行策略：自动开始分析/计划，还是等待开始指令？计划是否需要审核，取消是否可自动停止，分别由明确权限与策略决定；本轮不预先授权。

继续确认其余产品决定，并审核本轮路径与字段提案，再产出正式 JSON schema、状态转换和权限矩阵。
