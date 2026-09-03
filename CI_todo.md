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
- [x] Map/工作台的私有读取鉴权、HTTPS 反代配置和公开入口隔离（`tests/cloud-workbench.test.mjs`、`tests/ci-smoke.mjs`）
- [ ] 后续完整服务器记忆接口的逐记录读取鉴权与受保护传输
- [ ] 本地记忆备份、迁移验证、缓存/待同步队列和断线恢复；未同步或基线滞后不得显示已完成

## 项目命名工作台

- [x] 命名入口 Host/Origin/令牌隔离、读写、5 个 session/SSE、原生 Python SessionStart 处理函数、自动打开去重（`tests/named-workbench.test.mjs`）
- [x] 并发启动共享代理、名称冲突不接管、后端端口复用身份校验、代理重启及项目退出隔离、损坏路由文件拒绝覆盖
- [x] 同一 Git 仓库的显式 worktree 绑定、保留原 Map、拒绝跨仓库绑定；许可证随包及 Skill 安装验证
- [ ] 各宿主应用实际投递 SessionStart、桌面浏览器启动失败反馈；处理函数测试不等于所有宿主端到端验收
- [ ] macOS/Windows/Linux 浏览器的 `.localhost` DNS 解析与受管网络策略兼容；正式精简实现的长期 CPU/内存/物理 I/O 基准
- [ ] 多 worktree 的 Cloud Sync 工作范围隔离及完整服务器记忆能力；当前绑定仅针对本地 Map，不能当作服务器实现
- [ ] 启动器强制终止后空/损坏启动锁及遗留 reclaim 锁的显式恢复工具；当前失败关闭，不擅自删除未知锁
