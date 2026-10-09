# Cursor 工作台接入设计

版本：0.2.0。用户已确认 Cursor 作为 Coordinator 的 Executor 或 Tester 接入。当前分阶段开发，不表示角色闭环或真实验收已通过。

## 目标与边界

首版只验收连接、通讯、完成任务。三条路径均须跑通：本地工作台到 Cursor CLI；Cloud 工作台到配对的本地 Cursor CLI；Cloud 工作台到 Cursor Cloud Agent。

人只与 Coordinator 对话。Cursor 不是额外聊天入口；原生 Session 和 Cloud Agent 是任务执行环境，不另建业务状态机。

默认工作台不提供独立 Cursor 按钮，也不在启动时安装原生聊天面板。旧组件、受限读取与通讯 API 保留用于兼容，不删除历史数据。角色任务仍从原 Coordinator 入口推进，不把入口移除当作角色闭环已完成。

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

当前本地 Tester 不继承上述 Executor 授权：包括磁盘保留的旧 `allow-once` 配置，宿主工具请求均拒绝。ACP 工具描述不能证明完整命令、工作目录和路径范围，不从标题或提示词推导权限。这只取消宿主的宽泛授权，不是厂商文件系统沙箱；Cursor 自带的已授权工具仍需真实验证。受限测试执行通道尚未完成，因此不宣称本地 Tester 已能完成真实任务；独立 CI 回报仍须真实测试证据，不能用拒绝请求或本轮结束代替。

本地 CI 对象读取只接受当前派发 `references` 中固定的引用/版本及 Tester 自己的 evidence 命名空间。知道同一 Executor Session 的其他任务引用，不授予读取权限。Cloud 接收端的当前任务事务限制仍须另行验证，不能用本地检查替代服务器鉴权。

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

Cloud 工厂复用原 Coordinator 调度。显式模板只登记逻辑预留，原人审派单后才启动 Plan；独立 Tester 先预留，再由原 `ci.request` 启动。

原生回调复核当前模板、原人审、绑定与 Main 读取权限。初始化不在协议事务内等待；Cursor 配置故障只影响对应宿主，不阻断本地 Claude。

取消只作用于账本确认的自有 Agent/Run。先保存停止意图，再等待厂商终态；未知确认只查询，不重复 POST，也不自动启动替代执行。

角色工厂与公开接口已接线，仍在源码验证。源码交接已接入 Git 只读校验；原生执行、独立测试、部署及三路径任务验收尚未完成。

### 原任务源码交接

Executor 在原 MCP 通道提交交接提案。`proof-pending` 只表示提案已保存，不表示原任务已进入 CI，更不表示开发完成。收到该状态后结束当前 Run，让后台读取其最终 Git 结果。

提案固定原消息编号、任务版本、批准 Plan、原生 Agent/Run 和证据版本。只允许该调用的一份提案；重复相同请求返回原保存结果，不替换内容或自动新建模型调用。

Git 校验使用审核过的 `Plan.content.paths` 相对路径清单。核对原 Run 的仓库和 Cursor 分支、准确提交、批准基线及每次提交路径；最终净差异不能掩盖中途的越界修改。

源代码校验在角色与协议锁之外执行。读取前后均核原生 Run 身份；保存证明前重查权限、Plan 与证据版本。撤权、过期、版本漂移或网络失败时保持未完成，不补造成功证明。

验证通过后复用原编号、原内容，经原任务事务推进至 `awaiting-ci`。同一事务保存接收标记与回执；失回或并发验证只读取该标记，不因旧阶段拒绝而重复投递模型。

私有仓库可在云端角色配置指定 `githubTokenFile`。只读服务器私有文件并访问固定 GitHub API，凭据不交给 Cursor、浏览器或公开错误日志。

Git 来源证明不验证 Executor 自测是否通过。单测输出观察、独立 Tester 及可信工作流检查仍须分别验证，不将汇总计数或同名绿色检查自动映射为业务 CI 结论。

### 原任务独立 CI 回报

私有角色配置的 `ciPolicy.checks` 显式关联原 CI TODO 编号、固定测试编号及 argv。每条同时固定 GitHub Actions 检查名、App ID、工作流文件的 Git blob SHA 和实际测试步骤名。配置不是模型提案，不允许任意汇总计数自动覆盖其他 TODO。

服务器在创建独立 Tester 前核对原 TODO 覆盖及版本，并读取原交接分支的准确提交检查。只接受该分支的 `push` 运行，不使用 PR 的合并检出或其他分支结果。缺证据时只观察工作流，不启动替代模型；已有任务的策略变更明确拒绝。

检查事实须关联同一 check suite、workflow run、当前重跑次数、job 和实际测试步骤。源码中的工作流 blob 必须与私有可信版本一致。相同来源的所有匹配检查均保留，包括失败；不是只寻找一项同名绿色检查。

Skill 的普通 CI 为 `cursor/**` 源码推送运行完整检查，功能 job 显式检出 `github.sha`。main、标签、PR、Required 和安全检查保留。其他仓库须先有同等可信工作流；不能把配置检查名等同于完成这项设计。

独立 Tester 从受限上下文取得固定命令、nonce 与 TODO/testId 对应关系，实际执行一次并保存自己的证据。`ci.result` 的 `proof-pending` 只保存原提案；Tester 随后结束 Run，后台读取该 Run 的完整工具观察和准确源码的可信工作流事实。

原生输出只证明观察到命令与实际退出、测试计数，不是虚拟机的不可变源码证明。前后 Git 状态不能排除临时修改或工具环境变化，因此单独原生输出不足以批准 CI；工作流来源与测试覆盖必须独立核对。

两组事实与提案相符，且原授权、任务、TODO 与证据版本未变时，才经原协议保存 CI 结果。接收标记与原任务状态原子提交；并发及失回只读同一标记，不重发模型。CI 通过不产生人类验收、合并或任务关闭回执。

配置形状如下；占位值必须由操作者替换并审核，不能直接用于真实任务：

```json
{
  "ciPolicy": {
    "checks": [{
      "todoId": "CI-1",
      "testId": "formal-tests",
      "argv": ["node", "--test", "--test-reporter=tap", "tests/example.test.mjs"],
      "name": "CI 1 | 功能测试",
      "appId": 15368,
      "workflowPath": ".github/workflows/ci.yml",
      "workflowBlobSha": "<审核过的工作流 Git blob SHA，40 位小写十六进制>",
      "testStep": "CI | 运行功能测试"
    }]
  }
}
```

该对象位于 Cloud 私有项目配置的 `roles` 内。GitHub 读取凭据仍只在 `githubTokenFile`，不进入 MCP 上下文或公开错误。运行中的策略与工作流变化须显式处理，不静默更新旧任务的信任条件。

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
- [GitHub workflow run 事实](https://docs.github.com/en/rest/actions/workflow-runs)
- [GitHub workflow job 与步骤事实](https://docs.github.com/en/rest/actions/workflow-jobs)
