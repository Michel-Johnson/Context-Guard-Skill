# CI TODO

- [x] Cloud Map 成功响应前持久化事件、地图与回执；中断恢复、重启恢复、服务器时间和多项目并发均有正式测试（`tests/cloud-workbench.test.mjs`）
- [x] Cloud 项目总览重建时保留人工编辑、TODO 和自定义字段，重启后仍可恢复（`tests/cloud-workbench.test.mjs`）
- [x] Cloud 与私有 Main/Session 记忆 API 可由同一进程、同一 Origin 提供，且 Session 不覆盖公共/Main Map（`tests/cloud-workbench.test.mjs`）
- [ ] `sync serve/ensure` 长驻进程、断线重连和 SSE 游标恢复
- [ ] `sync checkpoint` 独立行为
- [x] 已配置 Cloud 时的 `PreToolUse` / `PostToolUse` / `Stop` Hook 完整流程（`tests/hook-lifecycle.test.mjs`）
- [ ] 工作台 Cloud 状态图标：同步中、已同步、冲突
- [ ] 首次连接冲突时的 `connect --pull` / `connect --push`

## 工作树绑定与私有记忆

实现与实际部署分开验收。规范见 `references/server-memory.md`；自动化用例在 `.github/scripts/multiworktree.test.mjs`。

- [x] 显式 Session 绑定、共享项目语言、单服务与独立 Git Session 地图；重新绑定使旧令牌失效
- [x] Session 绑定先验证工作台 URL、项目/实例/runtime，再原子提交；命名入口与直连入口均返回可核验回执
- [x] Git worktree 使用稳定管理目录标识，支持移动且拒绝路径复用误绑定；页面固定到 URL 指定 Session，不按活跃度自动跳转
- [x] 多来源活动状态按事件时间合并，较新的停止/失败/取消终态不会被旧 active 覆盖；未知状态不显示工作中转圈
- [x] 旧版/重复工作台只诊断不自动替换；显式迁移先在 Git 公共私有目录备份，再按精确 pid:instance 温和退出
- [x] 私有记忆接口：鉴权、CAS、原子快照/回执、主分支祖先验证；公开 Map 接口隔离
- [ ] 用户服务器真实部署、TLS/隧道及仓库镜像刷新验收
- [ ] 历史记忆清点、备份、迁移、版本覆盖核验及实际切换（需单独批准）
- [ ] 原生 Codex UI 中安装新版本、审阅 Hook 后验证实际上下文投递；doctor 只能证明输出已生成

## 项目命名工作台

- [x] 命名入口 Host/Origin/令牌隔离、读写、5 个 session/SSE、原生 Python SessionStart 处理函数、自动打开去重（`tests/named-workbench.test.mjs`）
- [x] 并发启动共享代理、名称冲突不接管、后端端口复用身份校验、代理重启及项目退出隔离、损坏路由文件拒绝覆盖
- [x] 同一 Git 仓库的显式 worktree 绑定、保留原 Map、拒绝跨仓库绑定；许可证随包及 Skill 安装验证
- [x] 命名入口与 Session 隔离兼容、未绑定不启动、跨 worktree 重启保留项目命名入口
- [ ] 各宿主应用实际投递 SessionStart、桌面浏览器启动失败反馈；处理函数测试不等于所有宿主端到端验收
- [ ] macOS/Windows/Linux 浏览器的 `.localhost` DNS 解析与受管网络策略兼容；正式精简实现的长期 CPU/内存/物理 I/O 基准
- [ ] 旧 Map-only Cloud Sync 与多个 worktree 的联调；旧服务目标绑定不代表服务器迁移完成
- [ ] 启动器强制终止后空/损坏启动锁及遗留 reclaim 锁的显式恢复工具；当前失败关闭，不擅自删除未知锁
