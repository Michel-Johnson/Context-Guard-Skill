# 服务器托管的开发记忆

文档版本：v1.0.1。

读者：产品角色 Agent（项目选用私有记忆时）；仓库开发 Agent 只把本仓库「选用该模式」写在 `RULE.md`，产品契约以本文为准。

只有项目明确选择使用私有记忆服务器时，才适用本契约。Context Guard 开发仓库在 `RULE.md` 中选择了这一模式；其他项目不会因此继承它的服务器地址或绑定关系。

当前存储设计版本：[`fs-v2.2`](design-memory-current-v1.0.1.md)；文件投影格式仍是 fs-v2.1。

**状态：私有记忆服务与客户端实现、自动化验收，以及生产环境的文件系统 v2 迁移已经验证。** 节点、模块和工作项的文档契约见 [记忆文件系统 v2.1](design-memory-filesystem-v1.0.1.md)。运行兼容层仍保留旧记录；默认从 API 和上下文中排除这些记录，仍是 `CI_todo.md` 中明确列出的验收项，不能仅凭文档就认为已实现。Agent 首先打开哪套目录（FIND.md / snapshot，还是 v2 Markdown）**尚未决定**。后续安装和迁移仍需明确批准。配置 `CONTEXT_GUARD_MEMORY_CONFIG` 后，常规 Cloud 进程会在同一个 HTTPS 来源下提供这组 API；没有这项显式配置，就不会启用私有记忆路由。运行时接入和迁移事项仍记录在 `CI_todo.md` 中。

## 文件系统 v2 的读取边界

Cloud Main 和每个 Session 各自拥有独立的文件系统 v2 投影。已启用 fs-v2 的服务器提供明确、带版本的单文档读取路由：`GET /v1/projects/<id>/filesystem/main/<path>` 或 `GET /v1/projects/<id>/filesystem/sessions/<session-id>/<path>`，可附加 `?version=<observed-version>`。对应 CLI 用法为 `context-guard memory file
--scope main|session --path <relative-path> [--version <revision>]`；读取 Session 范围时，还须使用实际的 `--session`。指定版本已经过期时，请求应失败，而不是混合不同版本的文档。这个路由不会启用或迁移旧项目。接口可用后，Agent 沿相关节点或模块的 `index.md` 链接读取 Bug、Todo、测试或 Session 文档，不扫描整棵目录树。普通 Agent 的读取结果不包含 Idea 条目，并拒绝读取 Idea 文档；Coordinator 的可信服务器端通道仍可访问 Idea。默认先打开哪套目录仍未决定。原始快照 API 仅用于兼容同步，不是 Agent 阅读文档的入口。Coordinator 的完整节点索引包含 Related、Sub、Bug、Todo 和 Idea；面向 Agent 的索引切片省略 Idea。当前没有 JSON 工作项索引。

`runtime-state.json` 是事务兼容状态文件。`legacy-records/` 用于迁移与回滚。二者都不是 Agent 的常规读取入口；`bugs-index.json`、`tasks-index.json`、`jump-index.json` 和 `owns-index.json` 等文件，不得用于新的接口分析。在 `CI_todo.md` 中的运行时排除项完成之前，调用方必须显式遵守这一边界，不能假定 API 响应已经不含旧记录。

## 运行接口

将 `CONTEXT_GUARD_MEMORY_CONFIG` 指向一个不纳入源码版本控制的私有 JSON 配置文件。配置包含绝对路径 `dataDir`、`adminToken` 和 `projects`。`scripts/cloud/server.mjs` 随后通过同一个进程、同一个 HTTPS 来源同时提供 Cloud 和记忆服务。独立入口 `scripts/cloud/memory.mjs` 仍可用于仅监听本机回环地址的测试，并拒绝非回环监听。每个项目将其 ID 映射到限定作用域的 `token`，以及管理员配置的仓库镜像 `root`、权威 Git 引用 `ref`、可选的发布时拉取远端 `remote` 和公开仓库标识。使用 TLS 反向代理或 SSH 回环隧道；客户端拒绝非回环地址的明文 HTTP、URL 中的凭据、重定向和查询参数中的凭据。

| 完成策略配置 | 契约 |
| --- | --- |
| `completion.experiments` | 可选的服务器管理员列表，用于登记人指定的实验运行：`{taskId, sessionId, generation, sourceSha}`。四项必须全部匹配；缺失或不匹配时，仍适用正常的合并门禁。 |
| 实验任务收口 | Coordinator 读取 `read_task.completionPolicy`，然后将 `gitReceiptRef: "experiment-only"` 和当前 CI 引用作为 `archiveReceiptRef` 提交。服务器保留带版本的 CI 与人工审核证据，并要求对应宿主的关闭报告。不进行 GitHub 合并或 Main 发布；保留现有 Session 历史。 |

运行服务的用户必须能读取受保护的配置和仓库镜像，并能读写 `dataDir`。如果源码检出目录刻意设为只读，例如 systemd 使用 `ProtectSystem=strict`，应省略 `remote`：由部署流程更新镜像，发布时只验证配置的 `ref`。不得仅为了让服务执行 `git fetch`，就授予广泛的源码检出目录写权限。

首次连接使用 `context-guard workbench connect --root <project> --url
<cloud-origin> --session <actual-session-id> --wait`。CLI 显示验证 URL 和验证码；人登录 Cloud，并在浏览器确认项目与设备。等待中的后端保存设备凭据，不向 Agent 暴露凭据或密码。不带 `--wait` 时立即返回链接，批准后重跑同一命令完成连接。

待处理请求保留到人允许或拒绝；已鉴权项目的工作台工具提供设备连接请求入口，不是宿主的工具执行审批。新客户端协商 `X-Context-Guard-Device-Grant: persistent-v1`，待处理时收到 `persistent:true`、`expiresAt:null`、`expiresIn:null`。旧客户端只有有限等待预算，可能十分钟后停止，但不会使服务器请求过期或消失；需升级客户端以持续等待。已批准请求仍有有限的一次性领取窗口；决策表单票据、浏览器登录 Cookie 和设备凭据各自保留有效期及授权规则。有限等待预算在本地计时，不要求电脑时钟与服务器绝对 `expiresAt` 一致。

被拒绝或领取过期时重新申请；已领取的回复若在保存前丢失，也须重新授权，不能重放已消费授权。这是浏览器设备配对流程，不代表完整 OAuth 互操作能力。`--input <private-file|->` 仍是兼容登录方式，JSON 只含 `password`，`-` 从标准输入读取，不强制创建密码文件。不得要求 Agent 把聊天密码复制进命令或文件。

Cloud 依据已验证的 GitHub 仓库确定项目，返回项目 ID 和 `device-memory` 能力。后端保存同时用于消息与私有记忆的设备凭据；后续 Session 调用 `workbench --session`，不再需要登录、Token 或项目 ID。显式入口注册不依赖 Hooks，Hooks 也不是后端心跳调度器；后端进程须保持运行才能发送心跳。

设备凭据可以读取 Main 和偏好设置，并且只能读写绑定到该设备的 Session。它们不能发布、恢复、查看历史或管理 Cloud。现有基于 Token 的客户端保持兼容，直到通过登录明确迁移；设备凭据被拒绝时，绝不能静默回退到旧 Token。旧的 `memory configure --input <private-file>` 流程仍用于独立记忆服务器，输入包含 `url`、`projectId` 和 `token`。登录会把先前配置保存到私有恢复文件中。不得将凭据放入命令行、节点、Session 记录或 Git。浏览器仍使用独立的 HttpOnly Cookie。

需要鉴权的 API 包括 `/v1/projects/<id>/main`、`/preferences`、`/sessions/<session-id>`、`/publish`、`/history` 和 `/restore`。公开 Cloud 路由不暴露这些记录。Session 写入携带 `operationId`、`baseVersion`、`baseMainVersion`、`sourceCommit` 和 `memory:{map,records}`。快照与幂等回执在每项目独立锁的保护下，通过执行 fsync 的原子替换一并提交。同一操作 ID 若携带不同内容，必须失败。私有路径和运行时路径通过严格的记录白名单予以拒绝；记录应保留，不按保留期限裁剪。Session 快照包含服务器写入时间。不得上传秘密内容。

从 Main 或 Session Map 删除 Bug 时，必须在同一事务中删除其活跃的旧版 Bug/修复记录，并持久化内部删除标记。陈旧的 Session 上传和发布不得恢复这些记录，也不得复用已删除的 Bug ID。Main 只保留最近五份可恢复快照；更早的条目保留审计元数据，但不能恢复。经授权恢复保留的 Main 快照，是独立且须检查版本的操作。

`memory.display` 可以为当前 Session 携带 `{name, platform}`。客户端读取宿主中已登记的任务标题，不根据提示词猜测。两个字段分别限制为 200 和 30 个字符。缺少元数据时，Cloud 使用该 Session 已有的生命周期名称作为后备值；显示信息不授予任何权限。

每次已确认的写入都会追加一条带服务器时间戳的历史记录。Session 历史保留完整快照；Main 历史只保留最近五个版本的完整快照，并去除更早版本的快照内容，包括重试回执中的副本。较早的 Main 条目仍保留版本、时间和操作者供审计，其操作 ID 仍用于防止重复写入。`memory history --scope main` 或 `--scope session:<id>` 用于读取可用历史。`memory restore --input
<private-request>` 根据 `targetVersion` 创建新版本，绝不倒退版本计数。请求必须包含 `operationId`、`scope`、`baseVersion` 和 `targetVersion`。`baseVersion` 过期时应失败，而不是覆盖人或 Agent 的较新编辑。恢复 Main 或偏好设置需要管理员凭据。

`memory prepare` 读取带版本的 Main/Session 记录，并保留冲突的本地编辑。`memory sync` 只上传到当前绑定的 Session；投递结果不确定时，先重放持久化队列中的操作，再生成新操作。`memory rebase` 合并互不重叠的 Main 变更，备份旧 Map；遇到重叠变更则拒绝，等待明确协调。旧 Session 没有记录 Main 祖先版本时，不得猜测：先审核保留的草稿，再显式运行 `memory rebase --adopt-main`，完成备份并用已发布的 Main Map 初始化 Session。同一项带版本检查的操作会在保留记录的同时替换服务器 Session 快照，然后对齐工作台 Coordinator 基线，避免较旧的远端快照立即覆盖刚采用的 Map。一旦已有正常祖先版本，命令就拒绝执行这种破坏性策略。归档时，若已配置同步，则调用同步；失败时保留本地草稿并报告，不能当作成功。

Main 在审核完成后自动发布。可信的人或明确的可信审核路径须确认精确的 `{sessionId, generation, sessionVersion, sourceCommit}`。普通上传、心跳或初始 HEAD 已在 Main 上都不能生成完成证明；之后的快照、Map 编辑或恢复会使证明失效。缺少证明的既有 Session 继续等待，迁移不能伪造审核。

浏览器的鉴权完成动作使用持久化辅助入口；任务 CI 验收本身不能证明后来的 Map 版本。独立管理员恢复通过 `POST /v1/projects/<id>/sessions/<session-id>/complete` 提交上述四个字段及稳定 `operationId`；Agent / 设备凭据不能自行批准。可选客户端 `memory complete --session <actual-id> --input <private-request>` 仅提交该请求，不在归档或同步时自动运行，也不绕过审核。Cloud 不支持时报告能力错误并保留 Session。

Cloud 服务定期刷新配置的权威 Git 引用，只有已完成 Session 这一代的源码提交已出现在该引用上，或 squash 合并后该 Session 修改的每个路径都与权威 Main 逐字节一致时，才发布这一代 Session。后续出现任何重叠变更时，必须拒绝发布。仓库规则要求 CI 通过后才能合并，因此合并后的权威 Git 引用就是发布门禁；浏览器不提供手动发布控件。底层的 `memory publish --input
<private-request>` 恢复命令仍受限制，只接受 `operationId`、`baseVersion`、`sessionId`、`sessionVersion` 和 `expectedMainSha`，不能提交任意 Main 内容。服务器保护管理员凭据，检查实际配置的镜像与 Git 引用，验证 Session 源码提交的祖先关系，在共享发布事务中再次核对完成证明及任务 / 实验策略，并要求 Session 已与当前 Main 记忆版本协调一致。已登录的人可以在工作台直接编辑 Main Map。每次编辑以页面显示的 Main 版本作为乐观并发控制的基准，并将时间戳、事件和幂等回执一并原子持久化。普通项目作用域的 Agent 凭据仍不能直接写 Main。Main **结构**唯一的非人写入者是 Coordinator，使用 `edit_map` / `mapWrite`，审计操作者为 `coordinator`。不得把白名单开发者客户端写成当前产品的例外通道。恢复 Main 或偏好设置仍需管理员授权。Main 已前进、源码未合并或存在并发发布时，操作应失败且不改变基线。工作台每 30 秒刷新一次基线；过期或不可用时显示对应状态，而不是覆盖最后一份有效快照。未配置权威 Git 引用的仓库不能发布。

项目页面显示的发布状态包括：等待审核完成或 Git 合并、已就绪、存在冲突、不可用或已发布。普通 Agent 的开发变更写入 Session Map；已登录的人所做的 TODO、项目注释等编辑，可以直接保存到权威 Main 视图。

发布成功时，在同一个持久化服务器事务中，只关闭并移除该 Session Map 的当前活跃代。不可变历史、发布回执、源码提交、代编号和生成的 Main 版本仍保留供审计。同一个真实 Session ID 可以开启后续一代：提交完整快照，设置 `baseVersion:null`，并让 `baseMainVersion` 等于最新发布的 Main 版本。过期基线必须被拒绝。在完整重新开启之前提交 Map 补丁，会返回 `SESSION_REOPEN_REQUIRED`；工作台后台 Coordinator 负责重新开启，并自动重基合并互不重叠的 Main 变更。重叠变更仍显示为冲突。重放较旧一代的操作 ID 时，返回原回执，绝不改变当前活跃代。

## 数据权威来源与存储

- GitHub 是源码、产品文档和正式测试的权威来源。继续遵守现有分支、PR、测试和密钥检查规则。项目的整个 `.codex/` 不进入源码提交、公开附件或发布制品。
- 私有服务器是全部开发记忆的权威来源，包括 Main 基线、Session、用户消息、任务、Bug 与修复记录、Map、索引和记录偏好设置。保留这些记录，不按长期或临时价值裁剪。这不意味着私钥、Token、原始数据转储或机器运行状态也属于记忆；不得盲目复制 `.codex/context/private/`。
- 本地 `.codex/context/` 文件仅作为带版本的缓存、工作副本和待提交写入。按需获取服务器上的相关索引和记录，不在每次回复时读取全部历史。不得根据本地文件最新修改时间判断其是否为权威数据。
- 连接信息保存在不纳入版本控制的本地配置中，不放在公开文档或分发的 Skill 默认配置里。SSH 主机是部署信息，不是 API URL、项目绑定，也不能证明记忆服务已初始化。

## Session 与 Main 的隔离

一个 Git 项目对应一个服务器端项目和一个工作台身份。每个真实 Session 都明确绑定到该项目及自己的工作树。不同 Session 的工作记忆作用域彼此独立；经授权读取历史时，必须保留来源 Session 和版本，不能静默覆盖到另一棵工作树。

All Sessions（全部会话）视图只读取服务器已发布的 Main 基线。通过权威仓库、分支、Main 提交 SHA 和记忆版本识别基线。Session 上传或 `sync finish` 不等于 Main 发布。确认相应源码改动已经合并到配置的 Main 分支后，协调对应记忆并原子发布完整基线。保留其他 Session 的记录，不提升无关、未合并的变更。如果发布完成前 GitHub main 已前进，应把最后确认的基线标为过期或待发布，而不是声称它仍是最新。无法确定唯一的 Main 分支时，让用户选择作为权威来源的远端与分支，或本地分支。

## 读写规则

1. 每次收到人的提示，在依赖开发历史之前，先核对真实 Session、项目与工作树绑定，以及服务器记忆版本。绑定缺失或不明确时，需要用户选择，不能通过发现历史 Session 来猜测。
2. 从服务器读取相关 Main 基线和该 Session 的记录。只有与服务器核对版本后，本地缓存才能作为当前数据使用。检查源码时，仍读取实际工作树。
3. 使用版本检查和可安全重试的操作标识，将新记忆归档到服务器上的 Session 作用域。在服务器回执确认已持久化之前，保留待提交的本地数据；不得通过未经检查的目录复制覆盖并发记录。同步失败不能报告为成功。
4. 未配置、断连或能力不受支持时，说明缺失能力，并将本地草稿标为未同步。不得创建空项目作为替代、静默相信陈旧历史，或把记录上传到 GitHub 作为后备。仅依赖当前用户输入和已检查源码的任务可以继续；依赖记忆的决定须等待确认的数据来源或明确指示。

## 隐私与迁移

读写都必须经过项目作用域授权。公开只读的 Map 仍然是公开数据；现有 Cloud 公开接口不得暴露私有记忆。使用受保护的传输方式，将服务器数据和备份存放在源码检出目录之外。凭据，以及机器特有的访问、端口和进程状态，不进入记忆快照。

人通过浏览器访问时，使用 Cloud 密码登录和工作台的 HttpOnly Cookie，不复用 Agent、项目记忆或发布者 Token。受保护的服务器配置中只保存加盐密码哈希和独立的 Cookie Token。未认证的 HTML 页面访问跳转到登录页；未认证的 API 请求继续返回 JSON `401` 错误响应。

迁移需要单独批准的部署计划：盘点本地记录、保留备份、导入正确的项目与 Session 作用域、验证内容和版本覆盖，再将读取来源切换到服务器。不能仅因服务健康检查接口有响应，就删除本地数据或宣称迁移已完成。Cloud 的现有安装步骤遵循 [部署手册](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/references/cloud-deployment.md)，但不能用它只同步 Map 的连接与推送流程代替本契约。
