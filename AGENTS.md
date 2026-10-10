# Context Guard 开发指南

面向修改本仓库的 Agent。开工先读 [当前开发方向](development-docs/current-focus.md)，再读 [RULE](RULE.md)；开发流程、权限和交付以 RULE 为准，产品角色提示词不授予仓库或接口权限。

## 项目概览

Context Guard 用 Map 组织模块、记忆、关系及 Bug/TODO，供不同编码 Agent 共享上下文；Coordinator 讨论需求，Executor 实现，Tester 独立验证。

本仓库维护 Skill 核心；[Cloud](https://github.com/Michel-Johnson/Context-Guard-Cloud) 是可选扩展。共享源码只在 Skill 维护，Cloud 固定包消费，详见 [两仓库边界](development-docs/repository-boundaries.md)。当前主线与暂缓范围只在当前开发方向维护，历史待办不构成恢复开发授权。

## 架构与源码位置

Node.js / Python 为运行入口，JavaScript 使用 ESM；工作台是 HTML/CSS/浏览器 JavaScript，正式测试使用 node:test 和 Playwright。

| 位置 | 职责 |
| --- | --- |
| `bin/` | CLI、安装与运行时构建检查 |
| `scripts/shared/` | Map、格式、协议、事务和公共 I/O |
| `scripts/workbench/` | 本地 HTTP、绑定、权限、上下文及 Claude/Cursor 适配 |
| `scripts/*.py`、`hooks.json`、`agents/` | Python 命令、宿主 Hook 与 Agent 元数据 |
| `prototype/` | 共享 Map / 对话 UI |
| `roles/` | 产品角色提示词，不是仓库开发规则 |
| `tests/`、`.github/` | 正式测试、清单、CI、安全与发布工具 |
| `skill-reference/` | 随 Skill 分发的产品设计、指南和机器契约 |
| `development-docs/` | 开发、测试、发布说明；`shots/` 为文档配图 |

先定位所属层，再读调用方和相邻测试：上下文从 `scripts/workbench/context.mjs`、`tests/executor-context.test.mjs` 开始，Map 交互从 `prototype/` 及对应测试开始。Cloud 的专有源码及生成副本见两仓库边界；安装副本不是开发源码。

## 本地开发

需要 Node.js 18+、Python 3.9+、Git、tar；浏览器开发 Node.js 20+，客户端兼容检查 Node.js 22+，CI Node.js 24。遵守已有 Windows 路径与子进程封装。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:runtime
```

`--ignore-scripts` 避免 postinstall 改动个人 Skill；构建只检查自有核心、UI 和参考文件，不下载 Cloud 包或覆盖源码。首次开发按 [安全配置](development-docs/ci.md#首次开发配置) 配置扫描器与开发 Git Hook，不覆盖已有自定义 Hook；它与产品生命周期 Hook 不同。

源码 CLI 用 `node bin/context-guard-skill.js`。绑定、启动和连接步骤见 [SKILL](SKILL.md)；复用已有项目和工作台，不重建空 Map 排错。

## 测试与验证

定向示例：`node --test tests/executor-context.test.mjs`。其他入口、浏览器准备、正式测试清单及真实客户端步骤统一见 [检查标准](development-docs/ci.md)，缺口见 [CI_todo](CI_todo.md)。由 RULE 和影响选择器决定本次必跑项，不把所有命令当固定清单，也不借其他项目规则免检。

源码、Mock、无对话兼容检查不能代替真实模型、原生 Hook 或安装后的入口验收；源码运行、用户安装和 Cloud 部署分别核验。

## 开发约定

- 复用相邻模块及已有权限、版本、事务、回执和 I/O，不在 UI / 适配层重复业务判断。
- 共享 Map、任务草稿和本地会话笔记分开；保持 [fs-v2.1](skill-reference/design/design-memory-filesystem-v1.0.1.md)，本地笔记不上传，Cloud 读取与收工检查保留。
- 持久化核对版本冲突、幂等、并发和重启；服务核对启动、停止及资源释放，不用进程退出代替最终状态。
- 测试用隔离目录、合成数据和自有进程；消息只在指定测试频道验证，失败证据保留。私有数据、临时文件和凭据按 RULE 处理。

## 按需资料与特殊分支

记忆正文见 [撰写规范](skill-reference/design/design-memory-definition-v0.2.0.md)，其他专项从 [设计目录](skill-reference/design/README.md) 与 [文档入口](development-docs/README.md) 查找。需求到交付见 [开发流程](development-docs/engineering/README.md)，不要求通读所有设计。

临时测试分支 `cursor/test-layout-f54e` 从产品分支合入变更，只改 `tests/`，模拟仓库放 `tests/eval/`，不合回 main。产品 Bug 在产品分支修复，再同步到测试分支。
