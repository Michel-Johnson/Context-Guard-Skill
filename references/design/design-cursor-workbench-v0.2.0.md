# Cursor 工作台接入设计

版本：0.2.0。用户已确认 Cursor 作为 Coordinator 的 Executor 或 Tester 接入。当前分阶段开发，不表示角色闭环或真实验收已通过。

## 目标与边界

首版只验收连接、通讯、完成任务。三条路径均须跑通：本地工作台到 Cursor CLI；Cloud 工作台到配对的本地 Cursor CLI；Cloud 工作台到 Cursor Cloud Agent。

人只与 Coordinator 对话。Cursor 不是额外聊天入口；原生 Session 和 Cloud Agent 是任务执行环境，不另建业务状态机。

复用已存在的任务、Plan 审核、交接与 CI 协议。仓库当前方向暂缓通用自动派发；本次用户明确授权 Cursor 角色接入，不据此扩建通用队列或恢复系统。

## 角色闭环

Coordinator 交付已批准需求。Executor 先提交 Plan，等待 Coordinator 审核；收到对应批准版本后再实现、验证和交接准确 `sourceSha`。

Tester 使用不同逻辑 Session、原生会话与工作树。Cloud Tester 使用新的 Agent，固定到交接提交；不能用 Executor 自测或同 Agent 的追问替代独立测试。

Tester 只读取授权引用、运行声明测试、保存自己的 CI 证据并回报原任务。它没有需求批准、Plan 审核、Main 写入或业务源码修改权限。

Plan、结果、问题与测试失败都回到原 Coordinator 任务。用户不用另开 Cursor 对话或复制结果。缺 Plan、缺交接或测试失败不能展示任务完成。

原生会话账本只记录厂商通讯。业务完成仍由现有协议决定，不从自然语言、`end_turn` 或 `FINISHED` 生成批准及测试通过回执。

保持原有项目、Session、批准与凭据边界。复杂队列、中断自动恢复、问题卡片、完整归档自动化后续再做，不增加首版门槛。

共享 UI、协议及本地适配由 Skill 维护。Cursor Cloud 的凭据、REST 适配和云端路由由 Cloud 维护；不在 Cloud 修改共享生成物。

## 本地适配

使用官方 `agent acp`，通过标准输入输出传输 JSON-RPC 2.0。模型循环、文件工具和对话历史由 Cursor 管理，不另造 Agent harness。

流程为 initialize、authenticate、session/load（既有会话）或 session/new（明确创建）、session/prompt。session/update 提供本轮输出；session/cancel 取消本轮。

新建的空 ACP 会话在首次输出前可能只有元数据，不能从新进程加载。工作台保留原生连接至首个真实任务结束；之后加载同一原生 ID，不注入初始化模型消息，不操作厂商私有数据库。空会话在后端退出后失去连接时明确失败，不静默新建替代会话。

已有工作台 Session 默认加载同名原生会话。若需要不同原生 ID，操作者显式配置；不从浏览器 URL 猜身份，不把 generation_id 当作 conversation_id。

Coordinator 可先保留逻辑 Session UUID，官方 ACP 再返回原生 ID。两者分别持久化；原生连接加载使用原生 ID，工作台投递、角色和任务使用逻辑 ID。

Hook 和 CLI 只通过后端持久映射解析身份，同时核对工作树。导入的 Claude Hook 不改变 Cursor 宿主；正文、环境变量或自行声明的角色不能授予新身份。

原生 ID 对应多个逻辑 Session、根目录错配或创建结果不确定时拒绝继续，保留原回执。不重建替代会话，不改厂商数据库。

本地操作者显式启用 Executor 模板后，Coordinator 创建请求可沿用现有工厂生成独立工作树。模板允许创建不等于允许开发，仍须走任务与 Plan 审核。

`CursorRuntime` 复用 ProtocolDelivery 的投递编号。持久化原生 ID、精确工作树、投递指纹、运行状态和结果。重复编号不同内容拒绝；未知接收状态不自动重投模型。

配置只允许本机 CLI 管理权限，拒绝浏览器 Origin、其他角色令牌和非 Cursor 绑定。命令必须是绝对路径，避免 PATH 的 `agent` 名称冲突；凭据只从私有文件或官方登录读取。

CLI 与网页直接发消息共用 `native.prompt` 检查和投递编号；管理配置权限不允许绕过已分配任务。检查在旧成功回执重放之前执行，不用旧接收记录批准后来的模型调用。界面按 Session 保留未确认请求，匹配服务端消息后才能解除；未知时只显式重试原编号与原内容，不影响其他 Session。

默认拒绝工具授权。操作者显式设置 `permissionPolicy:allow-once` 且 `permissionsApproved:true` 后，仅选择厂商提供的 allow_once 选项。Tester 还须限制到其测试范围，不能复用 Executor 的全工具授权。

厂商 Plan 或问题不能被静默批准。未连接的交互明确取消，不伪造 Coordinator 回答；交互桥接后仍与需求批准和 Plan 审核分开。

已有 Hook 不替换。只终止自己创建的进程，不清理用户文件。子进程 stderr 不进入 API 错误；私有执行输出不进入 Git。

`received` 只代表本地接受投递；`end_turn` 只代表厂商本轮结束。它们不等于业务任务完成、人验收通过或 PR 已合入。

## Cloud 适配

使用官方 REST v1 创建 Agent 和 Run、发送同 Agent 的后续 Run、读取状态/输出与结果。不假定 v1 Webhook 已可用。

Agent、Run 与 Context Guard Session 分开保存。Cloud 工作台到本地 CLI 复用现有配对设备与投递协议，不通过网页直接启动本机进程。

Cloud Agent 不共享本机私有配置。API 密钥留在云端私有配置，授权与仓库范围在请求前确定；不直接推 main，不将厂商 FINISHED 当成人工验收。

Cloud 角色适配须接入现有任务协议，独立会话账本不作为任务权威。若通过远程 MCP 回报，凭据只授权该项目、逻辑 Session、角色与任务；不把 API 密钥或人类管理凭据交给 Agent。

MCP 权限只约束 Context Guard API，不代表厂商 shell 或文件工具已被沙箱限制。工具范围、准确提交与测试真实性需要分别验证。

### 受限角色通讯

Cloud 自有适配层签发短期不透明凭据，固定项目、逻辑 Session 代次、原生 Agent、任务、角色阶段和提交。凭据不能注册 Session、派单、批准审核或写 Main。

创建前先保存待激活凭据。MCP 初始化和工具发现可先进行；厂商确认原生 Agent/Run 后才激活业务调用。未知创建结果不新建替代 Agent。

MCP 只提供固定任务上下文和协议消息交换。对象命名空间对 Actor/Task 元组做固定哈希，避免任务名含分隔符时越过任务边界。

每次消息在原任务事务内、旧回执重放前重新验证角色、绑定、阶段、批准的 Plan 与版本。过期或撤销的凭据不能靠旧成功回执恢复权限。

Executor 交接和 Tester 回报须匹配可信验证器的原生 Agent/Run、准确提交与不可变证据版本。证据变更后旧证明失效，不采信模型自述或 `FINISHED`。

独立 Tester 还必须有不同原生 Agent、逻辑身份和工作树。可信接收器从后端账本读取这三项，不使用模型自己提供的身份。

传输使用 Streamable HTTP 的 JSON 响应子集，不提供 SSE 或服务器主动请求。凭据由 Cursor 内联 MCP headers 委托；不宣称已实现 OAuth 发现或完整 MCP SDK。

以上角色通讯模块仍在开发验证。生产工厂、调度接线、真实源码/测试证明及 Coordinator 入口未完成，不视为真实任务闭环。

## 分阶段与验收

1. 核对环境、最新 main、分支、绑定与凭据。
2. 本地 ACP 适配与正式测试。
3. Cursor Cloud REST 适配与正式测试。
4. 本地与 Cloud 的 Coordinator 派单、Plan 审核、独立 Tester 和结果回报。
5. 三条路径各通过 Coordinator 完成一个真实小任务，用户不另开 Cursor 会话。
6. 正常测试、Review、PR、安装/部署与最终验收。

最终每条路径只看三项：连接到正确环境；Coordinator 与执行角色真实双向通讯；任务完成且能查看实际产物及独立测试结果。细节功能不作此次交付门槛。

历史独立聊天验收只能证明传输可用，不能证明本次 Coordinator 角色闭环。界面移除独立入口时保留旧会话及通讯数据。

替身协议测试、本机 HTTP 测试、真实 Cursor 验收分别记录。真实账号、Cloud 密钥或生产权限未具备时保持未完成，不能用 Mock 通过代替。

## 官方依据

- [Cursor ACP](https://cursor.com/docs/cli/acp)
- [Cursor Cloud API](https://cursor.com/docs/cloud-agent/api/endpoints)
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
