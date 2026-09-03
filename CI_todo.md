# CI TODO

- [ ] `sync serve/ensure` 长驻进程、断线重连和 SSE 游标恢复
- [ ] `sync checkpoint` 独立行为
- [x] 已配置 Cloud 时的 `PreToolUse` / `PostToolUse` / `Stop` Hook 完整流程（`tests/hook-lifecycle.test.mjs`）
- [ ] 工作台 Cloud 状态图标：同步中、已同步、冲突
- [ ] 首次连接冲突时的 `connect --pull` / `connect --push`

## 服务器记忆：规范已确认，尚未实现或验收

以下是待开发项，不代表已有功能已经完成。规范见 `references/server-memory.md`。

- [ ] 完整开发记忆的服务器存储、读取、归档与并发版本校验；每次回复验证 Session/项目/工作树绑定和服务器版本
- [ ] Session 记忆隔离，以及按已合并主分支提交发布 main 基线；All Sessions 从服务器读取基线，不要求 Git 存储 `.codex/context/map.json`
- [ ] 私有记忆读取鉴权、受保护传输和现有公开只读入口的隔离
- [ ] 本地记忆备份、迁移验证、缓存/待同步队列和断线恢复；未同步或基线滞后不得显示已完成
