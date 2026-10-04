# 仓库文件归属

源码分为 [Skill](https://github.com/Michel-Johnson/Context-Guard-Skill) 与
[Cloud](https://github.com/Michel-Johnson/Context-Guard-Cloud) 两个仓库。
本表描述 Skill 仓库；生成到工作目录不代表该文件由 Skill 独立维护。

| 位置 | 归属与职责 |
| --- | --- |
| README / RULE / CI_todo / SKILL | Skill 用户入口、开发规则、验证台账和 Agent 入口 |
| `bin/` | Skill 安装器、命令入口及共享运行时构建 |
| `scripts/workbench/` | 本地服务、绑定、宿主适配、可靠交付和 Session 同步 |
| `scripts/*.py`、`hooks.json`、`agents/` | 本地 Agent/Hook 工具与宿主配置 |
| `references/cloud-sync-interface.md` | Skill 维护的当前 Session 同步与旧状态升级说明 |
| `scripts/shared/` | 从固定 Cloud core 包生成；协议、Map/记忆模型、事务与公共 I/O |
| `prototype/` | 从固定 Cloud workbench 包生成；Cloud 与离线本地工作台共用 UI |
| 根目录 roles / Coordinator / Executor / Tester | 从 Cloud core 包生成；不维护第二份角色规范 |
| `references/` 其余内容 | 从 Cloud core 包生成；随 Skill 分发的按需参考 |
| `docs/` | Skill 仓库开发、测试、安装和发布说明；接口定义由 Cloud 仓库维护 |
| `tests/`、`.github/`、`.githooks/` | Skill 正式回归、包边界、CI/CD 与开发安全 |
| `.runtime-generated.json` | 生成文件来源与内容记录；非业务记忆，不提交 |
| `.codex/`、`output/`、`temp/`、依赖目录 | 私有状态、产物与临时资源；不进入产品源码或发布包 |

## 共享运行时只有一个源码来源

开发检出后先运行：

```bash
npm ci --ignore-scripts
npm run build:runtime
```

core 与 workbench 依赖固定到 Cloud 的明确发布版本，并由锁文件约束。
构建生成共享代码、UI、角色和参考文档；这些目录不提交到 Skill Git，
但需要按安装清单包含在最终 npm/Skill 产物中，使安装后的本地工作台可独立运行。

需要修改共享内容时，在 Cloud 仓库修改源文件、发布新版本，再更新 Skill
依赖及锁文件重新构建。不要直接编辑生成物、复制第二份源码，或用
`latest`、浮动分支、另一个本地 checkout 的相对路径替代固定依赖。
构建发现已编辑的生成物时停止；先核对其来源，不覆盖丢弃修改。

## 已迁出和已淘汰内容

- Cloud 服务、Coordinator 服务端、Slack 插件、部署模板和接口文档只在 Cloud 仓库维护。
- Cloud 专属测试及两仓库联调由 Cloud 测试入口维护，Skill 保留本地和安装边界回归。
- 旧 `scripts/legacy/map-sync.mjs`、`scripts/sync/client.mjs` 与其路径工具已淘汰。
  公开 `sync` 命令转到现行工作台 Session 通道，不再启动项目级 Map-only daemon。
- 旧待发数据、回执、冲突和配置不属于源码删除目标；检测到未确认状态时明确阻止升级。
- 不创建源码备份副本。业务数据、凭据及既有数据备份机制保留；源码历史由 Git 管理。

Coordinator／Executor／Tester 分工不变：Executor 做模块测试并写编号
`CI_todo`，Tester 对准确修订做独立验证。暂停功能不是删除依据。

宣传站源码与独立依赖仍在
[`website` 分支](https://github.com/Michel-Johnson/Context-Guard-Skill/tree/website/site)，
不属于 Cloud 拆分范围，见 [宣传站分支](website.md)。

## 分支与工作树

远端分支、本地分支、跟踪引用和 worktree 分开清点。删除前核对未提交内容、
独有提交、运行进程和项目 Git 镜像引用；squash 合并须核对 PR 与实际内容。
任何发布都需要记录两个仓库及共享包的准确版本，不能用目录名称代替版本证据。
