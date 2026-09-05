# 接口设计：按工作台分类的数据格式草案

> 本文为 draft-1 历史稿。当前重新设计以 [接口规范 v2](interface-contract-v2.md) 和 [消息格式清单](interface-contract-v2.json) 为准，不再叠加执行两版规范。

状态：待审核，未实现。分类沿用用户工作台：本地-cloud、云端agent-cloud、agent-本地。不改变节点层级。本文定义传输字段，不定义任务说明或 Plan 的写作模板。

本历史稿包含 24 个消息示例，仅供设计比较；当前消息格式以 v2 为准，不代表接口已实现。

节点按传输方向组织：第 1 节分别归入“本地上行cloud”和“cloud下行本地”；第 2 节在“云端agent-cloud”下分为“Agent 上行 Cloud”和“Cloud 下行 Agent”两个模块；第 3 节目前涉及云端调度和审核的完整链路，归入“agent-本地 / 有云端需求”。“无云端需求”保留，其独立调度、审批格式尚待制定，不复制云端流程冒充已确定。

## 0. 共同消息格式

每个具体接口的完整 JSON 示例见 [接口 JSON 示例](interface-json-examples.md)，与 Cloud 对应节点一一匹配。示例是待审核草案，不代表接口已经实现。

所有业务消息使用以下信封。HTTP 路径、认证协议及完整 JSON Schema 留待审核；身份来自已认证连接，不信任正文声明的角色。

| 字段 | 类型 | 要求 |
| --- | --- | --- |
| schemaVersion | string | 必填；本草案为 `draft-1`，不是现有运行协议 |
| messageId | string | 必填，唯一；相同 ID/相同载荷重试返回原结果，不重复执行 |
| type | string | 必填，取对应分类列出的消息类型；未知类型拒绝 |
| repository | object | 必填，含 host:string、id:string；id 为 GitHub 仓库数字 ID 的十进制字符串 |
| sessionId | string | Session 消息必填；项目级心跳不填，通过 payload.sessions 指定 |
| generation | integer | Session 消息必填，最小 1，拒绝旧代次请求 |
| taskId | string | 任务相关消息必填；心跳不填 |
| correlationId | string | 响应/进度必填，关联原请求 messageId；独立首发消息可省略 |
| payload | object | 必填，按 type 校验 |

主分支引用 `refs/heads/main` 与提交 SHA 是版本定位字段，不是项目 ID。仓库身份自动查询；仓库识别不能代替访问授权。不同 GitHub 主机用 host 区分。

响应 payload 固定含 status:string，取 accepted、rejected；accepted 仅说明本阶段持久接收，不代表开发完成。拒绝时 error 必填：code:string、message:string、retryable:boolean；不得回显密钥或本机私有路径。执行结果通过独立消息报告。

载荷中除明确可选字段外均必填；省略与 null 不等价，未明确允许 null 的字段拒绝 null。变更使用显式字段操作，不能把未传字段解释为删除。大小、ID 长度上限及枚举扩展策略仍待定，不声称已可直接用于生产校验。

## 1. 本地-cloud

节点用途建议：项目后台与 Cloud 之间传递任务消息、工作台变化及处理回执；不传源码补丁。

已确认：每项目一个后台，各 Session 独立进度；本地离线时 Cloud 持久排队。下行即时通知与 10 秒心跳核对并用；上行主动发送，不等心跳。

下表 seq 均为非负安全整数，generation 为正整数；sessions/results/commands 为数组。

| type | 方向 | payload 字段 |
| --- | --- | --- |
| sync.heartbeat | 本地→Cloud | connectionId:string，sessions:[{sessionId:string,generation:integer,settledSeq:integer}] |
| sync.heartbeat.result | Cloud→本地 | sessions:[{sessionId:string,generation:integer,latestSeq:integer,ackedSeq:integer,hasPending:boolean}] |
| sync.available | Cloud→本地 | latestSeq:integer；Session 由信封确定 |
| sync.read | 本地→Cloud | afterSeq:integer，limit:integer，maxBytes:integer |
| sync.batch | Cloud→本地 | commands:[{seq:integer,message:业务消息信封}]，nextAfterSeq:integer，hasMore:boolean |
| sync.ack | 本地→Cloud | results:[{seq:integer,messageId:string,outcome:string,receiptId:string}]；outcome 取 applied、rejected、cancelled |
| sync.ack.result | Cloud→本地 | ackedSeq:integer |
| workbench.changed | 本地→Cloud | eventId:string，baseVersion:string，version:string，operations:array；操作 schema 后续逐项定义 |
| task.interrupted | 本地→Cloud | eventId:string，runId:string，stage:string，reason:string，occurredAt:string（RFC3339），可选 recoveryRef:string |

进度定义：latestSeq 是 Cloud 已保存的最大序号；settledSeq 是本地有持久结果的最大连续序号；ackedSeq 是 Cloud 已保存结果回执的最大连续序号。单纯收到数据不能推进执行进度；心跳不能替代 ack。

拒绝/取消回执不是执行成功，必须保留原因，依赖该命令的后续操作不能照常执行。断线、重复或丢回执安全补读。中断由 Hook/脚本自动入队上报，不依赖模型；强杀无法捕获时只报告失联，不编造中断原因。

文件不放进心跳。附件用 blob 引用：blobId:string、sha256:string（64 位十六进制）、sizeBytes:integer、mediaType:string；完整性、归属验证后才能使用。分块消息格式及限额待定。

待写入节点摘要：一个项目一个同步后台；Cloud 下行即时通知，10 秒心跳核对各 Session 连续处理序号并补漏；本地变化主动上传。读到不等于执行，执行不等于 Cloud 已确认。中断脚本自动上报，大文件走独立通道。详见本文第 1 节。

## 2. 云端agent-cloud

上行模块（Agent → Cloud）：`brief.submit`、`task.dispatch`、`plan.review.result`、`ci.result`。

下行模块（Cloud → Agent）：`brief.decision`、`plan.review.request`、`ci.handoff`、`executor.state`。其中执行方状态指调度服务向 Agent 订阅方发送的通知，不改变原消息格式。

节点用途建议：云端主 Agent/CI Agent 与 Cloud 调度服务交换已批准任务、审核结果、测试和合并状态；不绑定具体 harness。

| type | 方向 | payload 字段 |
| --- | --- | --- |
| brief.submit | 主 Agent→Cloud | briefId:string，revision:integer，text:string，contentHash:string |
| brief.decision | Cloud→主 Agent | briefId:string，revision:integer，contentHash:string，decision:approved或rejected |
| task.dispatch | 主 Agent→Cloud | briefId:string，briefRevision:integer，briefHash:string，approvalId:string，targetSessionId:string |
| plan.review.request | Cloud→主 Agent | planId:string，planRevision:integer，planHash:string，briefRevision:integer，planRef:string，rulesVersion:string |
| plan.review.result | 主 Agent→Cloud | planId:string，planRevision:integer，planHash:string，decision:approved或changesRequested，issues:array（元素为 {ruleId:string,reason:string}） |
| ci.handoff | Cloud→CI Agent | runId:string，sourceSha:string，briefRevision:integer，planRevision:integer，ciTodoRef:string，unitTestEvidenceRefs:string[] |
| ci.result | CI Agent→Cloud | runId:string，sourceSha:string，verdict:passed或failed或incomplete，checks:array |
| executor.state | 调度服务→订阅方 | agentId:string，state:busy或idle；busy 时 activeTaskId:string 必填，idle 时省略 |

brief.decision 必须来源于 Cloud 验证的人类确认记录；主 Agent 不能自己生成批准。获批后发送给执行方的正文必须与人看到的版本及 hash 相同。text 长度限制待共同确定。

ci.result 的 checks 元素建议为 {testId:string,ciTodoId:string,status:passed|failed|notRun,evidenceRef:string}，失败时增加 reproductionRef:string。CI_todo 完成标记与测试编号保留，不删除条目。

CI Agent 主动读取 GitHub 检查状态，不要求 GitHub 主动发送。证据需绑定准确 SHA 与检查运行标识；没有结果、运行中或查询失败不等于通过。检查证据的完整对象格式待定。

执行方只暴露 busy/idle 两种状态：从任务分配开始，到所需 Main 合并及收口完成之前始终 busy，包括 Plan 审核、CI 和返工；移交 CI 不释放。连接在线情况另行记录，不引入第三种执行方状态。Cloud 持有唯一任务调度队列。

待写入节点摘要：主 Agent 在 Cloud 运行，harness 待定；简短任务说明先经人确认，再发送执行方。主 Agent 审核固定版本 Plan；CI Agent 主动查询 GitHub CI。执行方只有忙/闲，直到必要合并及收口完成才释放。详见本文第 2 节。

## 3. agent-本地

“有云端需求”和“无云端需求”下均按模块区分 **Agent → 本地后端（上行）** 与 **本地后端 → Agent（下行）**。无云端模块目前只保留方向结构，尚未确定的独立审批和调度消息不照搬云端流程。

有云端需求的上行接口：`task.received`、`plan.submit`、`task.progress`、`task.handoff`。其中宿主适配器视为 Agent 侧。

有云端需求的下行接口：`task.deliver`、`plan.decision`、`task.rework`。

统一展示约束：双方通信按方向分模块，每个具体接口只保留一条规范记录：一句用途、包含 type 和 payload 的 JSON，以及已确定的后续消息类型。公共身份字段及校验规则集中写在本文，不逐节点重复；完整消息示例保留在示例文档。精简展示不改变传输字段，也不增加新机制。

节点用途建议：本地后端和 Agent 宿主适配器交接任务、Plan、进度及 CI 材料；代码仅由执行 Agent 在绑定 worktree 中修改。

| type | 方向 | payload 字段 |
| --- | --- | --- |
| task.deliver | 本地后端→Agent | assignmentId:string，briefId:string，briefRevision:integer，briefHash:string，text:string，contextRefs:string[] |
| task.received | 宿主适配器→本地后端 | assignmentId:string，deliveryId:string；表示宿主已接收，不代表完成 |
| plan.submit | Agent→本地后端 | assignmentId:string，planId:string，planRevision:integer，briefRevision:integer，sourceSha:string，planRef:string，planHash:string |
| plan.decision | 本地后端→Agent | planId:string，planRevision:integer，planHash:string，decision:approved或changesRequested，reviewReceiptId:string |
| task.progress | Agent→本地后端 | runId:string，progressSeq:integer，stage:string，summary:string |
| task.handoff | Agent→本地后端 | runId:string，sourceSha:string，ciTodoRef:string，unitTestEvidenceRefs:string[]，experienceRefs:string[] |
| task.rework | 本地后端→Agent | runId:string，sourceSha:string，ciResultRef:string，failedTestIds:string[] |

任务说明批准、Plan 审批由后端验证真实回执，不能靠正文声称已获批。contextRefs/planRef 等仅允许访问授权范围内的资料，不接受任意本地路径或远程 URL。

stage 是进度描述，不是执行方第三种状态。进度枚举建议 analyzing、planning、waitingReview、implementing、unitTesting、waitingCI、reworking、waitingMerge、closing；尚待审核。

本地只缓存当前任务和未确认消息，不另建一份待分配任务队列。CI 失败返回原任务的执行方；无法投递或宿主不支持时返回明确错误，不伪称模型已收到。

待写入节点摘要：执行 Agent 接收人已批准的任务说明，读取代码并提交 Plan；收到主 Agent 对同一版本的批准后开发。回传单模块测试、CI_todo 和经验引用，CI 失败继续原任务。脚本交付、模型执行和最终收口分别确认。详见本文第 3 节。

## 4. 尚未定稿的数据格式

- Cloud 合并包的允许内容、差异格式、审核和合并回执。
- 连接配对、凭证更新/撤销与执行实例绑定。
- 附件分块、状态快照、可视化 operations 的完整 schema。
- 对象引用解析规则、错误码全集、字段长度和消息大小上限。
- 将所有示意字段落成机器可校验的 JSON Schema 和契约测试。

以上是未完成项，不以 Agent 规范或模板替代。旧架构草案中的“移交 CI 后释放”“本地任务排队”等提案若与本文件冲突，以本文件记录的最新用户决定为准；旧稿后续统一整理。
