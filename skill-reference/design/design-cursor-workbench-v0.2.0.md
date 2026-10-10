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

流程为 initialize、认证、session/load（既有会话）或 session/new（明确创建）、session/prompt。session/update 提供本轮输出；session/cancel 取消本轮。

官方 CLI 已通过子进程环境中的非空 `CURSOR_API_KEY` 或 `CURSOR_AUTH_TOKEN` 预认证时，不重复调用会打开浏览器的 `authenticate(cursor_login)`；没有凭据时保留该登录步骤。客户端不校验或宣称密钥有效，实际会话和模型请求仍由 Cursor 拒绝无效身份；不回退创建会话，不增加工具权限。依据：[官方 ACP 认证说明](https://cursor.com/docs/cli/acp#authentication)。

工作台显式提供私有凭据时，仅在该 CLI 子进程设 `AGENT_CLI_CREDENTIAL_STORE=memory`，由厂商管理本次认证，避免自动化读写用户钥匙串。不复制或持久化厂商访问令牌；没有显式凭据时保留原登录存储方式，不接受父进程任意凭据存储配置。该选项依据已核验官方 CLI 2026.10.01 的实现及隔离原生实验，不推断所有旧版兼容。

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

当前本地 Tester 不继承上述 Executor 授权：包括磁盘保留的旧 `allow-once` 配置，宿主工具请求均拒绝。ACP 工具描述不能证明完整命令、工作目录和路径范围，不从标题或提示词推导权限。这只取消宿主的宽泛授权，不是厂商文件系统沙箱；原受限通道已在源码接线，仍须准确安装版本及三路径业务验收，不能用拒绝请求或本轮结束代替独立 CI 回报。

本地 CI 对象读取只接受当前派发 `references` 中固定的引用/版本及 Tester 自己的 evidence 命名空间。知道同一 Executor Session 的其他任务引用，不授予读取权限。Cloud 接收端的当前任务事务限制仍须另行验证，不能用本地检查替代服务器鉴权。

### 本地独立 Tester 的受限工具

用户已批准 CI 专用 MCP 窄工具调整。实现与验收仍进行中；原生 ACP 保持唯一模型循环，原任务协议保持唯一业务权威。

原 CI 的完整 Agent 凭据只留后端。保留的首次原生连接使用宿主内存 callback；后续自有 Node worker 使用私有 IPC，只能读取固定上下文、交换受限消息及调用宿主专用 commit，不提供 URL、凭据、任意方法或自行声明的身份。父端以自己创建的 ChildProcess PID 固定归属，子端不报告身份；Cursor 模型不能访问此 IPC。

绑定固定原投递指纹、逻辑/原生 Session、工作树、任务与源码、引用版本、实际 owning PID、Tester 绑定版本和后端 epoch。初始期限不可续期；每次原授权返回后再次核对绑定，旧回执、晚回复、关闭、到期和重绑不能恢复权限。IPC 的重复、越界、过大或并发超限请求关闭本通道，不重签或重投模型。

原 owning worker 仅对新建且具有固定支持身份的 held profile 接通受限执行。缺少原生身份、管理员策略、同一 HostProof 或原 held transport 时，仍返回 `CI_NATIVE_ISOLATION_REQUIRED` 等准备错误，不调用模型；原 ID 和 transport 不冷加载或替换。普通 Executor 不增加该门禁。

### CI 原生配置准备（创建阶段）

新 CI 创建先固定预留的逻辑 Session，保存独占准备意图。首次原生返回后才保存实际 native ID；配置失败或结果不确定时保留原意图，不重建会话或覆盖已有目录。

保留两个不同目录：工作台登记的逻辑 root 是批准的 Tester 工作树；Cursor 的 native cwd 是 Git 树外的私有空目录。源码只能经准确 SHA 快照工具读取，不能把原工作树或快照用作 CLI 配置发现目录。

宿主创建独立 HOME、配置、数据和临时目录，并显式覆盖 Windows/XDG 路径。只接受明确的 Cursor provider 环境，厂商凭据使用内存存储；Core 凭据、用户 Hook、任意 MCP 地址及其他父进程秘密不进入原生环境。

私有配置只登记四个 CI MCP 工具，使用宿主生成的能力。调用官方 `mcp enable`；随后核对原 endpoint、header 与完整服务器清单，拒绝多出的服务器。allowlist 与 Read/Shell/Write/WebFetch 拒绝配置不是操作系统沙箱，也不证明 Task 已被限制。

记录准备目录、逻辑/原生身份、配置摘要和最初 30 分钟期限。每次核验目录、私有文件、原 MCP 的准确字节及宿主固定配置策略；权限漂移、链接、关闭或到期永久失效，不自动修复、续期或重新签发能力。Windows ACL 与实际宿主工具边界仍待验证。

新 profile 的原生身份由宿主私有闭包固定整份分发目录：有界、流式读取完整文件清单与内容摘要，核 canonical 父目录、目录/文件身份、链接、权限和读取途中漂移。版本自报不能授予支持身份；目前仅接受实际已验证的官方 `2026.10.01-e373342` darwin-arm64 完整分发摘要，其他制品仍只可准备，不激活。

该支持表是对已验证制品的固定选择，不是自动学习首份文件。官方 darwin SEA 未签名，真实运行被系统终止，不重签或修改厂商文件。`--version`、MCP enable 与 ACP 使用同包 canonical Node 与绝对 index.js 参数，完整分发摘要匹配后才运行，再重核原清单；禁用编译缓存，不借 PATH 中的其他 agent 或 launcher 的环境脚本。原配置命令的 alias 及最终目标仍核原身份；版本、alias、helper、chunk、node_modules、文件身份或目录变化永久撤权，不改用户文件。

官方入口在 `--version` 时也初始化默认配置；探测使用新 profile 内独立私有 version-home，全部配置路径重定向且不传 provider 凭据。实际 turn 的权限配置仍以独占创建保存，不删除探测产物或用厂商默认值覆盖策略。非 sticky 的他人可写父目录拒绝；这不构成同 UID 攻击防御。

完整文件/stat 清单只保存在原 profile 闭包，record/immutable guard manifest 仅保存版本、准确 Node/入口参数与分发摘要作审计；旧 JSON 或合成配置不能恢复这个闭包。新 `verifyNative` 必须复用原 profile/期限核验，未知制品和旧对象没有激活权限；普通 `verify` 也检查原分发漂移。这不是同 UID 防篡改或操作系统 attestation；目录及文件所有者须为当前用户或 root，其他 UID 的制品拒绝。

官方 CLI 2026.10.01 的真实 `session/new` 会补充默认配置，后续还会更新隐私缓存。创建时的完整配置摘要保留作审计，不再以全文字节不变判断授权。新 profile 格式为 2，另保存宿主预先固定的策略摘要；不能从厂商改写后的文件重新学习基线，旧 profile 不升级或重建。

首版 CI 只支持默认模型路由，未指定、`default`、`auto` 统一为 `default`；其他模型在创建意图前拒绝。CI 启动不传 `--model default`：厂商会将其标为用户改变默认模型，违反固定策略。默认由原私有配置选择，不放宽校验；Executor 保留显式模型参数。

严格核对原权限、allowlist 和已核验的默认模型、空参数及展示/交互字段；允许补充默认值，不允许任意新字段、可执行 statusLine、其他模型/子模型、搜索自动批准或网络覆盖。

隐私缓存可缺席（厂商默认 ghost=true），或具有严格的 ghost=true、合法隐私枚举与有界更新时间；不伪造厂商缓存、不降低隐私策略。缓存更新不能改变原身份、能力、endpoint 或初始期限。此兼容修复仅针对配置校验，不证明 Task/子 agent 隔离，也不单独产生激活权。

POSIX 上，CI 专用 `mcp enable` 和 ACP 进程从启动起使用子进程内的 `umask 077`，避免厂商原子重写配置时产生 0644 文件。固定 shell 只设置 mask 并 `exec` 绝对原命令，参数单独传递，保留 PID、stdio 和信号；不修改父进程 umask、不事后 chmod 漂移文件。Executor 不启用此选项，Windows 不以 POSIX mask 宣称 ACL 隔离。

核验还拒绝私有 HOME 中新增的已知 Hook、规则、commands、agents、plugins 和第三方 Skill 配置根；不删除这些文件，不修改用户配置。检查配置漂移不等于阻止运行中的所有文件写入或厂商动态加载，不能当作操作系统隔离证明。

用户对 Cursor 接入的权限授权及本范围 P02 复核允许新 CI 私有 HOME 的官方工具拦截；不替换既有 Hook，不增加生命周期、同步或普通 Executor Hook。新 profile 格式为 3，旧记录不升级、重建或重新学习信任。宿主预置 `preToolUse`、`subagentStart` 和 `beforeMCPExecution`，均 `failClosed:true`、有界超时、全匹配、无循环豁免。

固定绝对 Node 命令先核对复制脚本摘要，再直接执行已核验字节，避免 hash 后重新 import 路径的竞态。不可变 manifest 固定原 record 的完整不变投影、文件位置、原 endpoint 与期限；仅原 record 的 native ID 可一次绑定。Hook 命令和 manifest 不随绑定更新，避免厂商缓存旧配置。

guard 对 NOFOLLOW、单链接、私有权限、有界 UTF-8 JSON、canonical 父目录和同 FD/命名 inode 前后变化作校验。每次精确核真实 Hook 输入的原 native ID、native cwd、唯一 workspace root；缺失、子 agent 身份、漂移或到期默认拒绝。固化脚本/MCP/Hook 摘要，不信正文或 record 新增的 verified 字段，不回显输入、路径或凭据。

官方 2026.10.01 ACP 本地 MCP wrapper 不给 `preToolUse` 基础载荷添加 cwd；只对准确四 MCP 允许 cwd 缺席，仍强制原 native ID 和唯一原 workspace root，出现 cwd 时必须准确匹配。不会因此放行其他工具或忽略错误 cwd；provider/URL 另在原 MCP 事件核对。

真实 ACP Hook 的唯一 `workspace_roots` 是厂商内部 DATA/projects 存储槽，不是传给 ACP 的 native cwd。新 profile 由宿主按已核验官方 `cursor-config.Xq` / `workspace-paths.r_` 规则，派生并固定 `hookWorkspaceRoot`：私有 DATA/projects 下，native cwd 的非 ASCII 字母数字替为连字符、折叠并裁两端。不能从模型或观测输入学习、接受任意私有子目录或迁移旧记录。

`hookWorkspaceRoot` 纳入原 immutable record/manifest，仅用于核 Hook 元数据；实际 ACP 启动仍用 native cwd，逻辑工作树及 Git 源码快照授权仍分开。宿主预建 projects 与准确槽位为私有目录，逐父核 canonical/非链接及权限；允许厂商 transcript/store 数据，但新增项目 Hook/MCP/规则/commands/agents/Skill 等可执行配置根会撤销原能力，保留文件而不修复。

`preToolUse` 只放行准确四个 `MCP:context_guard_*` 名称，内置 Read/Grep/List/ReadLints/Glob/Shell/Write/Task 等默认拒绝。该事件不含可靠 provider，因此另以 `beforeMCPExecution` 精确核工具、`context-guard-ci`、原 HTTP URL 双字段，缺失或 stdio command 拒绝；`subagentStart` 一律拒绝。

原 private record 的 native 关联仍依赖宿主文件边界，不是同 UID 防篡改、操作系统沙箱或远程 attestation。原宿主每次 verify 和 Core 当前授权继续生效；真实工具/Task/同名外来 MCP、fail-closed 故障及官方潜在旁路尚须验证。guard 配置本身不授予激活权，也不推断 Cursor Cloud VM 的 Hook 行为。

异步读取结束、放行前再次核最初期限，不以 Hook 的 5 秒超时延长授权。拒绝只返回固定阶段类别，不输出原输入、错误 cause 或敏感定位；诊断码不是业务证据，也不授予重试、重新绑定或激活权限。

关闭覆盖准备、连接与登记阶段；每次异步边界后重查关闭标记。准备前先完成目录规范化，再同步核关闭；调用准备与登记 Promise 之间不留 await，关闭后晚到的目录解析不能启动新 Discovery。关闭中晚到的 native ID仍保存，但不登记为就绪。已丢失的空 transport 在重启后保持创建不确定，不调用 new 或以原文件恢复业务权限。

CI 创建的 ready 回执也须核原 held transport 的错误/关闭状态与真实子进程终态、活 profile；缓存存在不证明进程活着。连接失效时关闭自有能力、保留原记录，不替换空 native。重启后不能仅凭旧成功记录报告可用。等待事件登记锁期间关闭时，不追加启动事件或写 ready；持久化期间关闭亦不返回成功。

当前已接通首次创建、元数据发现、原 held profile 的宿主准备及支持制品的一次原投递激活。后续同 profile 的 load/能力轮换尚未实现；既有未隔离空 native 不升级或替换，公开模型结果仍拒绝。

官方 CLI 的隔离元数据实验仅证明四工具可发现、原项目 MCP 不参与清单，以及用户配置摘要未变。没有模型、Task 或原任务授权，不把该实验视为独立 CI 闭环。

关闭本机 CI host 时，先恢复自有 worker 的进程引用，再断开私有 IPC，并等待已登记的真实退出回报。退出 Promise 本身不保活；关闭与 spawn 并发时，晚到 spawn 不再次取消该引用。关闭后拒绝新 CI 投递，不创建替代 worker；Executor 的既有分离运行行为不变。

Runtime 关闭共用一次操作，按对象引用去重 Profile 与 native transport。单项停止失败不阻断其余自有资源；准备、通道、原生退出与原轮次收拢的未确认结果汇总为安全阶段错误，不携带原 stderr/cause。只有确认关闭的对应对象才移除；失败和晚到的其他归属保留，不能假报全部停止或盲目重试。

准备失败只有在原 Discovery 关闭及本次 failed 记录原子保存均成功后，才由模块私有 WeakSet 标记新建的最终错误实例。无 setter，JSON、错误码或模型字段不能伪造；关闭/保存失败生成未标记的新安全错误。此确认仅用于资源收拢，不授予模型、任务或原生隔离权限；Runner 接入后仍须单独确认自有 CID 停止。

Cursor 的公开 CI 入口在宿主证明及原事务校验接通前拒绝 `ci.result`，不接受模型、请求字段或 header 的“已验证”标记。`ci:<Tester>:host:` 为宿主保留的证明命名空间，模型不能写入；Claude 原 CI 通道不变。上述阶段保护不是原生独立测试已可交付的声明。

原生 CLI 在返回 Session ID 前需要发现 MCP。CI 专用发现入口因此先提供同一四工具的固定元数据，不读取任务、不执行测试、不保存证据；不是新会话或业务状态机。已有活动入口仍沿用同一 HTTP 与工具契约。

宿主取得原生 ID、原投递及实际 owning worker PID 后，只能激活一次。激活复用原任务鉴权及完整固定身份；失败、不确定、关闭或到期后永久拒绝，不允许借相同入口更换任务或延长初始期限。激活过程中仍无业务权限，关闭会撤销晚到结果。

原 Discovery 激活入口接收宿主私有 `runTest`、`verifyResult`、`submitVerifiedResult` 三个回调。出现任一自有字段时，三者都须为自有函数字段；继承回调、缺失、undefined、非法类型或额外配置拒绝，并烧毁原能力。宿主必须整体传入同一原 HostProof 的回调；类型检查本身不能证明可信观察或一致作用域。

未提供这组回调时，Discovery 激活只开放固定上下文、批准源码与受限 `object.read`；测试、证据写入和结果回报都报 `CI_HOST_PROOF_REQUIRED`，不回退普通 `client.exchange` 写通道。完整回调不改变原 endpoint、凭据、协议、身份或最初期限；终态失 ACK 仍走原编号、正文和宿主期望，不重新激活或重跑测试。

发现与活动状态共用原 endpoint、能力与初始化协议；元数据发现不构成开发批准。原 `CursorRuntime` 已在源码接线同一 profile、Runner 和 HostProof；准确安装、owning 后端到 Cloud、真实业务与生产验收仍待完成。

工具只提供当前 CI 上下文、批准源码读取、固定 testId 执行和原 CI 消息回报。模型不能选择 argv、工作树、环境、镜像或任务身份。既有用户配置和 Hook 不替换。

测试命令由宿主代理执行。不得直接挂载活跃工作树：先从准确交接提交导出批准路径的独立源码快照，核对文件清单和内容摘要。未跟踪文件、Git 公共目录和宿主私有目录不导出；批准路径中的链接、子模块和特殊文件拒绝处理。

首版验证使用明确配置的可信本地 Docker daemon、固定完整镜像 ID及禁止拉取。只读挂载源码快照，独立 scratch 可写；只读 rootfs、非 root、network none、去 capabilities 和 no-new-privileges。不挂载宿主 HOME、凭据、daemon socket 或其他工作树。缺少已批准执行环境时拒绝，不回退到宿主 shell。

容器是测试子进程隔离，不是新的模型 harness。镜像、daemon 与内核是可信基座；Linux 容器通过不能代表 macOS/Windows 原生行为通过。容器内只读也不能代替宿主快照和准确 SHA 校验。

短期权限固定 Tester、原任务、代次、交接 SHA、引用版本与命令策略。每次调用、旧回执读取和结果提交前重查；撤权或版本变化时拒绝。执行意图持久化，未知结果只查询原容器，不盲目重跑。

本地 MCP 宿主从原 `/api/v2/execution` 读取登记的 Tester、原生会话、投递编号和 owning worker PID，固定到当前 worker。引用版本沿用协议字符串，不改为整数。源码与测试工具不接受模型自行声明的身份或命令。

普通操作通过原 `/api/v2/ci` 的固定版本读取重查当前授权。`ci.result` 自身在原事务中鉴权，并按原 ID 重放；已接受的终态回执不再用旧 testing 读取作后验判断，否则合法推进会被误报。其他工具不因此获得终态读取或写入权限。

检测到身份、引用、授权或有效期变化时，能力永久失效并中止宿主测试信号。原生 worker 必须在退出时关闭工具与确认自有测试停止；这部分接线及实际容器终止仍待验收，不把 HTTP 模块通过当作生产执行能力。

宿主采集实际退出与完整输出，证据存放在测试容器不可写的位置。取消/超时须确认自有容器终止，只终止 Docker CLI 不算停止测试。保留失败及未知现场，不清理其他容器或本地文件。

宿主核对固定命令标签、原 CI TODO 编号、当前 owning worker 与策略。执行前复核实际容器配置；配置漂移仍按准确 CID 与归属停止自有容器，不因配置错误漏停。

本机测试关闭 daemon 日志，以 `start --attach` 直接限量采集完整输出。超限不把截断尾部当作证明。挂起执行每秒重查原授权，工具能力到期会主动中止信号；取消、超时或撤权先保存停止意图，再停止和复核原容器。

首版每个原 CI 投递至多预留 20 次测试执行；相同编号复用原观察，不重复启动。不确定启动只能检查并停止原容器，缺完整输出就不生成通过证明。实际观察与 CI verdict 仍分开，原生 worker 和证明回报接线尚在开发。

关闭时从原投递的私有账本恢复自有容器；核对任务、SHA、策略、请求指纹及归属标签。停止责任不依赖授权、源码或镜像仍可读取，但必须核对可信 daemon 与原 CID。停止意图先持久化；未知或外来归属不报成功，也不删除现场。

旧 worker PID 只在清理归属比较中排除，其余身份和版本不变。新实例不得凭旧 PID 重放执行或回报；重启、撤权后的清理不意味着任务自动恢复。

测试观察经原 CI 通道回报。容器退出 0、TAP 汇总或模型本轮结束均不能自行生成 CI 通过、人工验收或任务关闭。

宿主证明发布器只能持有自有 Runner 和私有原 Core 提交 callback，不接受模型提供的观察、路径或“verified”字段。批准 Plan 的引用、版本、审核回执与准确文件集合由宿主取得；Plan 的基线 SHA 不必等于最终交接 SHA，测试快照始终固定最终源码。

owning Node worker 通过私有空参数 `hostContext` 取得原 Plan、不可变批准回执及固定版本 CI TODO。读取复用原设备连接，不扩大普通 CI 引用权限；固定云端地址和登录身份摘要，每次 await 后复核，变化后旧能力永久失效。宿主使用原 `Plan.content.paths` 整份清单导出准确 Git 快照，目录范围包含其全部安全文件，不能改用测试文件子集替代。

准备摘要仍标记 `preparation-only`，不是执行授权。本地下行投影只用于固定原引用，不等于 Cloud 当前 Task；激活和结果接收仍须在原 Core 事务内核任务、批准 Plan/回执、交接 SHA 和 TODO 版本。摘要不能代替固定原生身份，也不能恢复已关闭能力。

后端已增加原任务范围校验：私有 `hostContext` 返回前及准备后的每次操作，使用原设备连接提交固定 Task、Plan 版本与基线、批准回执、交接 SHA 和 TODO 版本。`X-Context-Guard-CI-Task` 只是收窄期望，不是凭据、隔离证明或新的 CI 通过权；模型正文和公开 IPC 参数不能自行提供这些值。

原 Core 操作成功后才返回 `X-Context-Guard-CI-Task-Authorized` 的准确范围摘要。范围传输必须核此确认；旧服务忽略 header、缺失或错误确认均报不可用，不记成功或确定拒绝。准备先执行只读校验，失败永久关闭私有通道；已发写入不确定时仍保留原编号与 wire，不据此补写或声称没有效果。

Cloud 在原 Core authorize 中核当前 Task 与已发批准，新写入把范围摘要及 CI/Executor 绑定版本同业务效果、原回执一起持久化。旧编号省略范围、替换范围、重绑或改内容均不能重放；普通 CI 未使用该范围时保持原契约，旧接受记录不能升级为新范围。

本机私有通道不直接返回缓存成功，而是经固定原范围重放原编号及 durable wire，取得云端原回执；已确定拒绝不重投。终态 `ci.result` 只允许对应 `awaiting-merge`/`ci-failed` 的原接受事实，返工或新阶段不能沿用；其他读写仍要求当前 testing。该接线的真实安装与完整 owning 后端到 Cloud 验证仍待完成，不解除原生隔离或公开结果拒绝。

首版通过观察只接受固定 Node 入口、`--test --test-reporter=tap` 和批准快照中的文件。完整输出须非零测试、计数一致、无失败/取消/跳过/TODO；退出非零记录失败，其他不完整输出不升级为通过。它只证明声明测试的实际观察，不自动证明需求完整或批准来源真实。

测试工具先将宿主观察以稳定编号写入保留的 host evidence，确认原 Core 的引用/版本后才交给模型。模型回报只能引用这些已确认观察；宿主不改写模型的原 `ci.result` 编号、载荷或结论。提交意图及终态回执先持久保存，失 ACK 只重放原编号，不能重启测试或模型。

MCP 用私有 `submitVerifiedResult` callback 发布经核验的结果，不增加公开工具或绕过普通模型结果拒绝。正式测试已覆盖产品 MCP HTTP、Runner 与 Core 事务组合；Docker、任务批准为合成依赖，不代表原生角色闭环。

原 Discovery 到同一 HostProof 的组合回归也核对终态已接受但 ACK 丢失、原编号恢复、单次 Runner 执行、改提案、撤权和初始期限到期。Docker 与批准仍为合成前提；这些正式回归不证明原生工具隔离，支持制品之外的 worker 仍硬停。

私有提交还携带宿主保存的证据引用、准确版本与内容摘要。接收 callback 必须在原 Core 的同一事务 authorize 中核验这些期望，确保 reducer 读取的 latest 就是该观察；不能用提交前网络回读替代。模块内测试使用 `assertCursorCiHostEvidence`，Cloud 自有接收器使用 `authorizeCursorCiHostEvidence`，不反向导入本地工作台源码。

宿主发送器和 Cloud 接收器已增加 `X-Context-Guard-CI-Evidence` 的 canonical 范围传输，仅用于带原 Task 期望的 `ci.result`。证据必须来自本 Tester 的 host 命名空间，逐项匹配准确版本、内容摘要、Task 与最终 SHA；failed 的 reproductionRef 只能复用该 evidenceRef，其他状态不得夹带额外 reproductionRef。该 header 只是收窄原设备委托，不证明原生执行、宿主隔离或观察真实性。

原事务将 evidenceHash 与 Task 范围、原结果回执共同提交。既有编号不能升级、省略或修改 proof；终态同编号也继续核原证据 latest/内容。成功才返回 `X-Context-Guard-CI-Evidence-Authorized`，发送器须同时确认 Task 与 Evidence 两个准确摘要。缺失、错误或旧服务忽略 proof header 时保持未知，不换编号或改正文。两个新增 header 的编码长度合计至多 12288 字节，各自至多 8192 字节。

上述发送/接收模块及 owning worker 私有证明调用已在源码接线；准确安装与 Cloud 组合仍待完成。期望不进入模型消息，不改变原编号/载荷；公开模型结果拒绝继续保留，不能由独立 sender/HTTP 测试推断真实任务闭环。

私有 commit 只接受当前 Task/source/session 的本 Tester host evidence 或带 mandatory expectedEvidence 的原 ci.result，普通 exchange 仍拒这两种提交。准备及 callback 缺失时不开放结果上下文；context({ciResult:true}) 只免旧 testing 读取，仍核原身份、owning PID、投递、绑定、指纹和最初期限，不产生写权。

原 Task 的 DeviceConnection 在发送结果前保存完整消息指纹、固定作用域及原 proof 元数据，每次实际传输和缓存重验都读取同一私有记录；缺记录、损坏、链接、换 proof 或借旧 durable wire 补造记录均拒绝。记录锁在 send 前释放，不形成传输取锁自死锁。未知 ACK 保留原编号、正文与 proof，后端不借此调用新模型或重跑测试。

证据写仍在普通 testing 授权前后检查；结果提交由 Cloud 原 ci.result 事务鉴权，回执后只核本地固定身份，不再读旧 testing TODO。晚到响应时重绑或撤权仍永久关闭；本地未确认不能解释为远端没有效果。该私有路由不是 Runner 真实性证明，不能单独产生原生执行权。

已持久保存的终态回执只确认当次 Core 接受的历史事实；先核当前身份/授权/固定快照，不产生新业务写入，也不证明后来 evidence latest 未变。没有本地确认回执的失 ACK 重放仍走同一原事务与原证据期望。原 ciResult 已保存的引用版本不会随 evidence 新版改写。

原管理员配置可指定 CI 专用 `ciRunnerPolicyFile`；文件必须是 Git/linked worktree/common Git 外的 canonical 私有单链接常规文件，NOFOLLOW、有界 JSON。摘要由宿主配置时生成，外部 JSON 不能提供 `ciRunnerPolicySha256`；每次读取同 FD 核身份、权限及原摘要，不从新文件重设信任基线。Executor 不接受该选项，网页和模型不能配置。

原 held profile/ACP 的 owning turn 已组装完整批准 Plan.paths、准确最终交接 SHA 的只读快照、固定 Runner 与同一 HostProof/私有 commit。准备仅检查可信 daemon/镜像元数据，并保存原 Task/Plan/TODO/PID/策略/快照摘要；不激活 Discovery、不调用模型、不创建或启动容器、不保存业务证据。Plan 基线与最终源码保持分开。

异步准备后重查原 profile、原绑定/Task、固定策略与 owning transport。冷 Node worker 不能借旧 profile 恢复权限；没有策略时保持原硬停。有策略但缺原 held 归属、策略或身份漂移均拒绝。Runner 关闭未确认时保留原 active job、资源引用与 unknown，不自动清空或重试；其他自有 native/profile 的关闭仍继续尝试。

支持制品的原 owning worker 在核对同一 profile、native ID、完整快照、管理员策略与 HostProof 后，先持久化原激活意图，再激活同一 Discovery。各阶段复核原授权及停止信号；running/PID 保存后，紧邻 prompt 再查原 scoped Task，匹配初始上下文后仅同步核停止与期限，再发送一次原 prompt，不延长最初期限。

Discovery 到期、撤权或私有通道中止，立即关闭原能力并分别停止原 native 与 Runner。清理 Promise 在同步 abort 前固定，只调用一次；任何停止失败都不阻断其他自有资源。先收拢资源，再等待已进入的宿主证明/提交回执及账本保存，不让晚 ACK 被清理吞掉。

只有原 HostProof 私有提交取得 Core 回执并保存 proof ledger，且停止确认完成，原 job 才能 finished 并释放 active。原 CI verdict 保留 passed/failed/incomplete；finished 仅表示该投递收拢，不等于任务通过。模型 end_turn、文本或公开字段不能产生宿主结果。

激活尝试后未确认结果、丢 ACK、保存失败或停止不确定，保留原 job/active/ownership 与 unknown，不重投模型、重建 Session 或激活新能力。关闭不重试原失败资源；冷 worker、旧 JSON、缺策略/闭包或未知制品仍硬停。

正式 Runtime 回归覆盖上述原回调、停止与竞态，厂商 ACP、Docker 和批准为合成依赖。另有官方 CLI、实际 Docker、原 Runtime/HostProof/Core 的隔离实验；其任务/批准仍为合成前提，不代替原 Coordinator、DeviceConnection、Cloud、安装和三路径业务验收。真实项目批准读取及后续同 profile 能力轮换仍待完成。

本轮合成容器正反控制已运行；准确提交快照、MCP 接线、撤权/重放和原生角色闭环仍须分别验证。历史宽泛工具授权及旧沙箱探针不能作为这些项目的通过证据。

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
- [Cursor Hook 来源](https://cursor.com/docs/hooks)
- [Cursor Cloud API](https://cursor.com/docs/cloud-agent/api/endpoints)
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [GitHub workflow run 事实](https://docs.github.com/en/rest/actions/workflow-runs)
- [GitHub workflow job 与步骤事实](https://docs.github.com/en/rest/actions/workflow-jobs)
