# CI TODO

- [ ] `sync serve/ensure` 长驻进程、断线重连和 SSE 游标恢复
- [ ] `sync checkpoint` 独立行为
- [x] 已配置 Cloud 时的 `PreToolUse` / `PostToolUse` / `Stop` Hook 完整流程（`tests/hook-lifecycle.test.mjs`）
- [ ] 工作台 Cloud 状态图标：同步中、已同步、冲突
- [ ] 首次连接冲突时的 `connect --pull` / `connect --push`
- [ ] Cursor 的真实生命周期 Session 与 Cloud Session Map 同步验收

## 服务器记忆：规范已确认，尚未实现或验收

以下是待开发项，不代表已有功能已经完成。规范见 `references/server-memory.md`。

- [ ] 完整开发记忆的服务器存储、读取、归档与并发版本校验；每次回复验证 Session/项目/工作树绑定和服务器版本
- [x] Session Map 隔离、Session 令牌、All Sessions/Main 分离，以及验证已合并 commit 后发布 Main（`tests/session-maps.test.mjs`、`tests/cloud-sync-client.test.mjs`）
- [ ] Session Markdown、用户消息、完整 Bug/fix/task/index 记录的服务器隔离与 Main 发布
- [ ] 私有记忆读取鉴权、受保护传输和现有公开只读入口的隔离
- [ ] 本地记忆备份、迁移验证、缓存/待同步队列和断线恢复；未同步或基线滞后不得显示已完成
