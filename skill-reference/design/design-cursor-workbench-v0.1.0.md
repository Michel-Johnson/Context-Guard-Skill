# Cursor 工作台接入设计

版本：0.1.0。用户已批准分阶段实施；本文不表示真实验收已通过。

## 目标与边界

首版只验收连接、通讯、完成任务。三条路径均须跑通：本地工作台到 Cursor CLI；Cloud 工作台到配对的本地 Cursor CLI；Cloud 工作台到 Cursor Cloud Agent。

保持原有项目、Session、批准与凭据边界。复杂队列、中断自动恢复、问题卡片、完整归档自动化后续再做，不增加首版门槛。

共享 UI、协议及本地适配由 Skill 维护。Cursor Cloud 的凭据、REST 适配和云端路由由 Cloud 维护；不在 Cloud 修改共享生成物。

## 本地适配

使用官方 `agent acp`，通过标准输入输出传输 JSON-RPC 2.0。模型循环、文件工具和对话历史由 Cursor 管理，不另造 Agent harness。

流程为 initialize、authenticate、session/load（既有会话）或 session/new（明确创建）、session/prompt。session/update 提供本轮输出；session/cancel 取消本轮。

新建的空 ACP 会话在首次输出前可能只有元数据，不能从新进程加载。工作台保留原生连接至首个真实任务结束；之后加载同一原生 ID，不注入初始化模型消息，不操作厂商私有数据库。空会话在后端退出后失去连接时明确失败，不静默新建替代会话。

已有工作台 Session 默认加载同名原生会话。若需要不同原生 ID，操作者显式配置；不从浏览器 URL 猜身份，不把 generation_id 当作 conversation_id。

`CursorRuntime` 复用 ProtocolDelivery 的投递编号。持久化原生 ID、精确工作树、投递指纹、运行状态和结果。重复编号不同内容拒绝；未知接收状态不自动重投模型。

配置只允许本机 CLI 管理权限，拒绝浏览器 Origin、其他角色令牌和非 Cursor 绑定。命令必须是绝对路径，避免 PATH 的 `agent` 名称冲突；凭据只从私有文件或官方登录读取。

CLI 与网页直接发消息共用 `native.prompt` 检查和投递编号；管理配置权限不允许绕过已分配任务。检查在旧成功回执重放之前执行，不用旧接收记录批准后来的模型调用。界面按 Session 保留未确认请求，匹配服务端消息后才能解除；未知时只显式重试原编号与原内容，不影响其他 Session。

默认拒绝工具授权。操作者显式设置 `permissionPolicy:allow-once` 且 `permissionsApproved:true` 后，仅选择厂商提供的 allow_once 选项。厂商 Plan 或问题不能被静默批准；首版未连接的交互明确取消。

已有 Hook 不替换。只终止自己创建的进程，不清理用户文件。子进程 stderr 不进入 API 错误；私有执行输出不进入 Git。

`received` 只代表本地接受投递；`end_turn` 只代表厂商本轮结束。它们不等于业务任务完成、人验收通过或 PR 已合入。

## Cloud 适配

使用官方 REST v1 创建 Agent 和 Run、发送同 Agent 的后续 Run、读取状态/输出与结果。不假定 v1 Webhook 已可用。

Agent、Run 与 Context Guard Session 分开保存。Cloud 工作台到本地 CLI 复用现有配对设备与投递协议，不通过网页直接启动本机进程。

Cloud Agent 不共享本机私有配置。API 密钥留在云端私有配置，授权与仓库范围在请求前确定；不直接推 main，不将厂商 FINISHED 当成人工验收。

## 分阶段与验收

1. 核对环境、最新 main、分支、绑定与凭据。
2. 本地 ACP 适配与正式测试。
3. Cursor Cloud REST 适配与正式测试。
4. 双向通讯、输出回显和同会话追问。
5. 三条路径各完成一个真实小任务。
6. 正常测试、Review、PR、安装/部署与最终验收。

最终每条路径只看三项：连接到正确环境；发送并收到真实回复、可继续追问；完成一个小任务并能查看实际结果。细节功能不作此次交付门槛。

替身协议测试、本机 HTTP 测试、真实 Cursor 验收分别记录。真实账号、Cloud 密钥或生产权限未具备时保持未完成，不能用 Mock 通过代替。

## 官方依据

- [Cursor ACP](https://cursor.com/docs/cli/acp)
- [Cursor Cloud API](https://cursor.com/docs/cloud-agent/api/endpoints)
