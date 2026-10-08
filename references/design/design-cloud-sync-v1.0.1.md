# Cloud Session 同步

文档版本：v1.0.1。

项目已连接 Cloud，或需要处理保留的同步冲突时，读取本文。数据权威和发布规则仍由 [服务器记忆](design-memory-server-v1.0.1.md) 定义。

## 一次连接，Session 隔离

用 `context-guard workbench connect --url <origin> --root <project> --session
<actual-session-id> --wait` 发起浏览器授权。连接后，普通 `workbench --root <project> --session <actual-session-id>` 复用项目连接。工作台负责后台连接，不另启项目级 Map daemon，也不让 Session 指向 Main 来绕过发布。

当前 Cloud 保留待处理的浏览器设备批准请求，直到人作出决定。CLI 显式协商此能力；命令停止后或稍后重试，复用同一私有请求，显示的验证码不会仅因经过十分钟而过期。每个 HTTP 请求仍限时 15 秒。停止 CLI 即停止等待，再运行同一连接命令继续等待。已批准请求有独立、有限的领取窗口；旧 Cloud 仍使用其实际的有限有效期。持续等待需要升级旧 Skill。

领取结果不确定时，不自动创建新请求或签发新凭据；保留原请求并报告失败。明确拒绝或已领取回执后，稍后的显式连接命令才重新申请浏览器批准，不能绕过人工决定。这不改变 Session 身份、设备现有权限、凭据续期或原生 Hook 信任。

本地编辑进入持久化发件队列；Cloud 变更通过事件读取，并由心跳恢复。回执、队列与游标按 Session 隔离：

```text
<project-shared-dir>/session-memory/<session-hash>/remote-sync/
  state.json
  server-base.json
  outbox.json
  conflict.json
```

这些是私有数据，不是仓库文件。工作台保留投递结果不确定的请求，并重试原操作 ID；独立编辑可以合并，重叠编辑保留基线、本地和远端文档供审核。

## 命令与确认

```bash
context-guard sync status --root <project> --session <actual-session-id>
context-guard sync ensure --root <project> --session <actual-session-id>
context-guard sync prepare --root <project> --session <actual-session-id>
context-guard sync checkpoint --root <project> --session <actual-session-id>
context-guard sync finish --root <project> --session <actual-session-id>
```

`status` 读取已保存的 Session 同步状态，不打印凭据，也不是新的服务器回执。`ensure` 复用工作台。`prepare`、`pull`、`checkpoint` 使用当前记忆读取与协调通道。`finish` 通过持久化记忆通道上传 Session，只有取得服务器快照版本才返回 `confirmed: true`。这些命令都不发布 Main，也不记录人工验收；生命周期 `plan-finish` 仍执行归档与审核门禁。

已淘汰的项目级开发窗口不再支持。Plan 范围保留在生命周期计划中；`sync track`、`sync connect`、`sync serve` 不得启动旧传输。鉴权使用 `workbench connect`。

## 升级与冲突

对旧 `.codex/context/private/cloud-sync/` 数据和共享 `cloud-sync/` 配置只读检查。未确认工作、已变化草稿、不可读状态或冲突，返回 `UPGRADE_REQUIRED`，原因为 `legacy-sync-state-pending`。保留并协调记录，不删除，也不猜旧项目 Map 属于哪个 Session。仅剩配置的残留不会阻止已连接的当前客户端；若它是唯一连接，`legacy-sync-reconnect` 要求当前浏览器授权。

网络失败时队列保留在磁盘，重连按退避策略重试；冲突必须显式协调。不编造新请求 ID、不清空私有状态，也不因连接存活就报告成功。

明确的 Session 绑定拒绝会停止自动绑定重试。Session 若属于另一设备，在宿主新建真实对话，并用宿主签发的新 Session ID 连接。不接管旧 Session，不改名或替换其 ID，不丢弃失败回执，也不迁移其任务或队列到新对话。旧绑定冲突回执不能证明 Session 的所属设备，同样要求新宿主对话，而不是盲目重试。

私有 Session 服务使用已授权的 `/v1/projects/:project/sessions/` 读取、变更 / 事件和 Map 写入。Session 代次与服务器授权仍须遵守；凭据不得进入 Map、日志或生成的 HTML。
