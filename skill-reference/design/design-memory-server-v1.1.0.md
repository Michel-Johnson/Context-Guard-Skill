# Cloud Map：连接、同步与发布

文档 v1.1.0。仅项目明确选 Cloud 时适用，本仓库在 RULE 选择；其他项目不继承地址/绑定。范围为结构化 Map、权限/发布，非本地笔记；文件 [fs-v2.1](design-memory-filesystem-v1.0.1.md)，笔记 [本地格式](../formats/session-record.md)。是否已部署以证据为准。

## 文件系统 v2 的读取边界

Main/各 Session Map 独立投影。启用项目路由 GET /v1/projects/`<id>`/filesystem/main/`<path>` 或 /filesystem/sessions/`<session-id>`/`<path>`，可带 ?version=`<observed-version>`；CLI context-guard memory file --scope main|session --path `<relative-path>` [--version `<revision>`]，Session 须真实 --session。过期失败，不混版本、不启用/迁移旧项目。

默认 map read --context 定位、index.md 展开；不整树扫描，Idea 普通 Agent 禁读，Coordinator 可信通道可读。快照 API 仅兼容，runtime-state.json/legacy-records/ 仅事务/迁移/回滚，旧 bugs/tasks/jump/owns JSON 索引非新接口入口。运行排除未验前调用者显式守边界，不假定响应已过滤。

## 服务配置

CONTEXT_GUARD_MEMORY_CONFIG 指未跟踪私有 JSON，含绝对 dataDir、adminToken、projects。Cloud scripts/cloud/server.mjs 同进程/HTTPS 来源提供服务；独立 memory.mjs 只回环测试、拒非回环。项目 ID 映射 token、管理员镜像 root/ref、可选 remote 和公开仓库标识。

TLS 反代/SSH 回环隧道；客户端拒非回环明文、URL/查询凭据及重定向。服务可读受保护配置/镜像、可写 dataDir；只读检出省 remote，由部署更新镜像，不为 fetch 授广泛写权。

completion.experiments 管理员登记 {taskId,sessionId,generation,sourceSha}，四项全匹配才实验豁免，否则正常合并。Coordinator 读 completionPolicy，实验以 gitReceiptRef:"experiment-only"、当前 CI 作 archiveReceiptRef，保版本化独立测试/人审及宿主关闭，不 Git 合并/发布 Main，保 Session 历史。

## 连接与设备授权

首次 context-guard workbench connect --root `<project>` --url `<cloud-origin>` --session `<actual-session-id>` --wait，显示 URL/码，由人在浏览器确认项目/设备；凭据仅后端。无 --wait 返回链接，批准后原命令领取。后续 workbench --session 复用项目连接，不另 daemon，不把 Session 指 Main。

X-Context-Guard-Device-Grant: persistent-v1 协商持久等待：persistent:true、expiresAt/ expiresIn:null。旧客户端十分钟预算不使服务端请求过期，需升级继续等待；每 HTTP 15 秒，本地有限预算非绝对时钟。停止只停等待，再运行复用原私有请求，不自动新码。

批准后领取窗口、表单票据、Cookie/凭据仍各自有效期。领取未知保请求报失败，不新凭据/请求；拒绝/过期或已消费回复丢失重新授权，不重放消费授权。兼容 --input `<private-file|->` 仅 password JSON，但不索聊天密码写命令/文件，不宣称完整 OAuth。

Cloud 核 GitHub 仓库返项目 ID/device-memory，设备凭据用于消息/记忆，后续不再索 Token/项目 ID；显式注册不依赖 Hook，后端运行才能心跳。设备只读 Main/偏好，读写自身绑定 Session，不能发布/恢复/历史/Cloud 管理。Token 旧客户端兼容至明确登录迁移，设备拒绝不能静默回退 Token；memory configure 私有输入 url/projectId/token，登录备份原配置。凭据不入命令/Map/日志/Git，浏览器独立 HttpOnly Cookie。

## 版本化写入与历史恢复

/main、/preferences、/sessions/`<id>`、/publish、/history、/restore 须项目鉴权，公开路由不暴露。Session 携 operationId/baseVersion/baseMainVersion/sourceCommit/memory:{map,records}；项目锁下 fsync 原子提交快照/回执，同 ID 异内容失败。私有/运行路径严格白名单拒绝，记录保留不按期限裁剪，服务器时间戳，不上传秘密。

删 Bug 同事务删活跃旧 Bug/修复并保删除标记；陈旧上传/发布不复活、不复用 ID。授权 Main 历史恢复另按版本。memory.display 可含 name/platform（上限200/30字符），取宿主已登记标题、不猜；缺省用已有生命周期名，非权限。

每确认写入留历史。Session 完整快照保留；Main 仅最近5份完整，旧快照含重试副本删除，版本/时间/操作者/操作 ID 留审计/幂等。memory history --scope main|session:`<id>`；memory restore --input `<private-request>` 含 operationId/scope/baseVersion/targetVersion，创建新版本不倒退，过期拒绝。Main/偏好恢复需管理员。

## Map 同步与冲突

memory prepare 取版本化 Map，保冲突编辑；Hook/归档笔记仅本地，memory sync 仅 Map。旧含记录队列 RECORD_SYNC_DISABLED，暂停不删不重放，服务器旧历史保留。

memory rebase 合并不重叠并备旧图，重叠拒绝交协调；无 Main 祖先的旧 Session 先审草稿再显式 --adopt-main，已有祖先不可借此覆盖，不用于笔记同步。

### 队列与回执

```text
<project-shared-dir>/session-memory/<session-hash>/remote-sync/
  state.json
  server-base.json
  outbox.json
  conflict.json
```

本地编辑持久队列，Cloud 事件/心跳恢复，按 Session 隔离；未知投递保原操作 ID，重叠保基线/本地/远端供审。

### 命令与确认

```bash
context-guard sync status --root <project> --session <actual-session-id>
context-guard sync ensure --root <project> --session <actual-session-id>
context-guard sync prepare --root <project> --session <actual-session-id>
context-guard sync checkpoint --root <project> --session <actual-session-id>
context-guard sync finish --root <project> --session <actual-session-id>
```

status 是已保存状态非新回执、不打印凭据；ensure 复用后端，prepare/pull/checkpoint 原协调通道，finish 服务器确认后 confirmed:true，仅 Map，非 Main 发布/人验/plan-finish。旧 sync track/connect/serve 不启动旧传输，鉴权 workbench connect。

### 升级与绑定冲突

旧 private/cloud-sync/ 及共享配置仅只读查。未确认/变草稿/不可读/冲突为 UPGRADE_REQUIRED:legacy-sync-state-pending，保数据不猜归属；仅配置残留不阻当前连接，若唯一连接 legacy-sync-reconnect 要浏览器授权。网络失败保队列退避，冲突显式协调，不改 ID/清状态/以在线报成功。Session 服务按授权路由、代次执行。

#### Session 绑定冲突

session.bind 经 POST /api/v2/messages 登真实宿主。跨设备 HTTP409，CONFLICT/retryable:false/details.reason:session-bound-elsewhere，不返旧设备身份/版本；同设备原规则不变。确定拒绝保回执/数据，停止盲重试，请新建真实宿主会话，独立 ID/队列，不改名复用/继承任务/接管。旧迁移仅一般冲突，不推设备身份。

## Main 发布与 Session 代次

可信人/审核路径须确认精确 {sessionId,generation,sessionVersion,sourceCommit}；上传、心跳、初始 HEAD 已在 Main 非完成证明，后续快照/Map/恢复使证明失效，迁移不能伪造。

鉴权完成持久化，任务 CI 不证明后来的 Map。管理员 POST /v1/projects/`<id>`/sessions/`<session-id>`/complete 带上述字段及 operationId，Agent/设备不自批；memory complete --session `<actual-id>` --input `<private-request>` 仅提交，不自动归档/同步调用，不支持保 Session 报能力错误。

Cloud 刷权威 Git ref，完成证明当前代的源码已在该 ref，或 squash 后每改动路径与 Main 字节一致才发布；后续重叠拒绝。浏览器无手动发布按钮，CI→合并原门禁不变。恢复 memory publish 仅 operationId/baseVersion/sessionId/sessionVersion/expectedMainSha，不交任意 Main；事务重核管理员/镜像/ref、祖先/证明/任务实验策略及最新记忆协调。无权威 ref、Main 前进、未合并、并发发布均失败不改基线。

人通过页面 Main 版本乐观写入，事件/时间/回执同事务；Coordinator 仅 Main 结构非人入口 edit_map/mapWrite、coordinator 审计，developer 白名单非例外。普通 Agent 写 Session，Main/偏好恢复管理员。工作台每30秒刷新，过期/不可用显示状态保最后有效快照。

页面区分待审核/Git、就绪、冲突、不可用、已发布；人可直接保存 Main TODO/注释。发布同事务仅关闭/移除当前活跃代，历史/回执/源码/代/Main版本留审计。

同真实 Session 可下一代完整快照 baseVersion:null、baseMainVersion 最新 Main，旧基线拒绝；补丁前未完整重开 SESSION_REOPEN_REQUIRED。后台重开/不重叠重基，重叠显冲突；旧代 ID 重放仅原回执，不改新代。

## 数据权威来源与存储

GitHub 管源码/文档/正式测试；整个 .codex/ 不公开。Cloud 项目结构化知识服务器权威，本地仅版本缓存/草稿/待写，不用 mtime 判最新；笔记/事件不上传。凭据、dump、机器状态不是项目记忆，连接信息未跟踪私有配置，SSH 非 API URL/绑定/初始化证据。

## Session 与 Main 的隔离

Git 项目一个服务身份，真实 Session 绑项目/worktree，各作用域隔离；读历史保来源/版本，不覆盖另一树。All Sessions 仅已发布 Main，以权威仓库/分支/源码SHA/记忆版本识别；上传/finish 非发布，不提升未合并/无关工作。Git 前进但未发布标过期/待发布；权威远端/分支不唯一让人明确选择。

## 按需读取与断连

每提示核真实绑定，缺失不从历史猜。Executor [按需流程](design-context-v1.0.0.md) 复用缓存但读实际源码，其他角色权威规则不变。Map 写用版本/稳定 ID，确认前保变更，不目录覆盖；Cloud 断连可缓存继续但交付“无法检查”，不造空项目/假最新/上传私有 Git。笔记本地保存非同步失败。

## 隐私与迁移

项目授权、受保护传输，服务器数据/备份在源码外；公开 Map 仍公开，公开接口不泄私有。浏览器密码/HttpOnly Cookie 独立于 Agent/发布者 Token，服务器存加盐哈希及独立 Cookie Token；HTML 未认证跳登录，API JSON401。

迁移另批计划：盘点/备份/正确作用域导入/核内容版本/切源，健康不证明迁移，不先删本地。[部署手册](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/references/cloud-deployment.md) 的只 Map 推送不能替代本契约。
