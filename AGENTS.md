# Context Guard 开发指南

本文面向修改本仓库的开发 Agent，介绍项目、源码位置和开发入口。开始任务先读 [当前开发方向](development-docs/current-focus.md)，再读 [RULE.md](RULE.md)；开发流程、权限和交付要求以 RULE 为准。

## 项目概览

Context Guard 帮助不同编码 Agent 共享项目上下文。Map 按模块组织项目结构、记忆、关系和 Bug/TODO；Coordinator 与用户讨论需求，Executor 执行任务，Tester 验证结果。角色提示词不等于接口权限，仓库开发 Agent 的身份也不自动赋予产品角色权限。

本仓库是 Skill 核心产品：维护 Map、共享协议、工作台 UI、CLI、本地后端与客户端接入。[Cloud](https://github.com/Michel-Johnson/Context-Guard-Cloud) 是可选扩展，负责云端托管、账号与权限、多设备服务、云端模型和 Slack。UI 部署在 Cloud 不改变源码归属：共享内容在 Skill 修改和发布，Cloud 固定版本消费，不维护第二份源码。

当前主线是 Map、**本机对话型 Coordinator**、Claude Code CLI 与 Cursor 接入。Codex Hook、会话记录同步及 Cloud 自动派发等暂缓；已授权的两仓库边界调整可修改 Cloud 构建与依赖，但不恢复自动派发。完整范围见当前开发方向，历史待办不构成继续开发旧链路的授权。

## 架构与源码位置

运行入口以 Node.js 和 Python 为主；JavaScript 模块主要使用 ESM，工作台使用 HTML、CSS 和浏览器 JavaScript。正式测试使用 node:test 与 Playwright。

| 位置 | 职责 |
| --- | --- |
| `bin/` | CLI 启动器、Skill 安装与运行时构建检查 |
| `scripts/shared/` | Map、记忆格式、共享协议、事务和公共 I/O |
| `scripts/workbench/` | 本地 HTTP 服务、项目与会话绑定、权限、上下文读取和 Claude/Cursor 运行适配 |
| `scripts/*.py`、`hooks.json`、`agents/` | Python 命令、宿主 Hook 配置与 Agent 元数据 |
| `prototype/` | 本地与 Cloud 共用的 Map 和对话工作台 UI |
| `roles/` | 产品角色入口与 Coordinator、Executor、Tester 运行提示词，不是仓库开发规则 |
| `tests/`、`.github/` | 正式测试、测试清单、CI、安全检查和发布工具 |
| `skill-reference/` | 随 Skill 分发的产品设计、操作指南与协议机器契约 |
| `development-docs/` | 仓库开发、测试和发布说明；`shots/` 放文档配图 |

修改时先定位所属层，再看调用方和相邻测试。例如，上下文读取从 `scripts/workbench/context.mjs` 与 `tests/executor-context.test.mjs` 开始；Map 交互从 `prototype/` 及对应 Map/浏览器测试开始。Cloud 维护 `scripts/cloud/`、`plugins/slack/`、`deploy/` 及云端专有设计；其 `scripts/shared/` 和 `prototype/` 是固定 Skill 包的生成副本。完整职责见 [两仓库边界](development-docs/repository-boundaries.md)。

## 本地开发

需要 Node.js 18+、Python 3.9+、Git 和 tar。浏览器开发需要 Node.js 20+，客户端兼容检查需要 Node.js 22+；CI 使用 Node.js 24。Windows 子进程与路径处理要遵守已有跨平台实现。

在仓库根目录准备依赖并核对运行时源码：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:runtime
```

`--ignore-scripts` 避免 postinstall 改动个人 Skill。当前 `build:runtime` 检查 Skill 自有核心、UI 和参考文件，不下载旧 Cloud 包，也不重新生成或覆盖源码。

首次参与仓库开发时，按 [安全配置说明](development-docs/ci.md#首次开发配置) 配置扫描器与开发 Git Hook；已有自定义 Hook 不自动覆盖。这与产品的 Claude/Cursor 生命周期 Hook 是两套机制。

源码 CLI 入口为 `node bin/context-guard-skill.js`。例如，先检查真实项目和会话的绑定状态：

```sh
node bin/context-guard-skill.js workbench --binding-status --root <项目路径> --session <真实会话标识>
```

工作台绑定、启动与连接步骤见 [SKILL.md](SKILL.md)。复用已有项目与工作台，不为排除报错重建空 Map；源码运行、用户安装与 Cloud 部署是不同验收对象。

## 测试与验证

以下是现有入口，不是每个任务都执行一遍的清单。先用相关模块定位问题；必须执行的检查和 PR 门禁由 RULE、[检查标准](development-docs/ci.md) 与影响选择器决定，不能照搬其他项目的免检规则。

| 命令 | 验证范围 |
| --- | --- |
| `node --test tests/executor-context.test.mjs` | 上下文模块的定向测试示例；其他模块使用对应正式测试文件 |
| `npm test` | 安全、进程与工作流、测试治理、Node 套件及安装边界冒烟；不含完整浏览器验收 |
| `npm run test:browser` | 工作台、日志恢复和 Cursor 对话的浏览器回归 |
| `npm run test:cursor-browser` | Cursor 对话界面的独立浏览器回归 |
| `npm run test:clients -- --client cursor --tools <工具目录> --evidence <证据目录>` | 已准备客户端工具的无对话兼容检查，准备步骤见检查标准 |
| `npm run test:cd` | 隔离环境的打包、安装和升级演练，不实际发布 |
| `npm run security:staged` | 实际暂存内容的安全扫描 |

浏览器测试首次需安装锁定的 Chromium：`npx --no-install playwright install chromium`。正式测试归属由 `tests/test-manifest.json` 管理，新增测试须核对清单和实际执行入口；仅被登记不等于已经运行。

模拟协议、函数测试和无对话兼容检查不能证明真实模型、原生 Hook 或安装后入口通过。缺少的验收记录在 [CI_todo.md](CI_todo.md)，真实客户端步骤见 [客户端验收](development-docs/ci.md#真实客户端对话验收)。

## 开发约定

- 先看相邻模块的代码和测试，复用现有权限、版本、事务、回执与 I/O 工具；不要在 UI 或适配层另写一套业务判断。
- 修改共享核心、UI 或角色时改 Skill 源码；Cloud 更新固定包和锁文件，不手改其消费副本。安装副本也不是开发源码。
- Map 的共享基线、任务草稿与本地会话笔记是不同数据。正文、索引和事项文件保持 [fs-v2.1](skill-reference/design/design-memory-filesystem-v1.0.1.md)；会话笔记只保存在本地，Cloud 上下文读取与收工检查保留。
- 涉及持久化时核对版本冲突、幂等、并发与重启；涉及服务和子进程时核对启动、停止及资源释放，不以进程退出代替最终状态验证。
- 测试使用隔离目录和合成数据，不依赖个人登录或已运行的工作台。真实消息只在指定测试频道验证；失败现场保留，成功后按 RULE 清理自有资源。
- 文档使用中文，代码与协议标识保持原值。私有 `.codex/`、凭据、运行数据及临时产物不进入 Git 或公开制品；临时脚本放根目录 `temp/`。

## 按需资料与特殊分支

- 项目记忆怎么写：看 [记忆撰写规范](skill-reference/design/design-memory-definition-v0.2.0.md)；底层文件格式另见 fs-v2.1，不把索引模板当作记忆正文。
- 上下文、权限和接口：从 [设计目录](skill-reference/design/README.md) 与 [文档入口](development-docs/README.md) 查找本次涉及的专项，不要求通读全部设计。
- 需求到交付的流程：看 [开发流程](development-docs/engineering/README.md)；设计文档创建、分支/PR、发布和收口要求看 RULE，不在本页维护第二份。
- 临时测试分支 `cursor/test-layout-f54e` 从产品分支合入变更，只修改 `tests/`，模拟仓库放 `tests/eval/`；临时测试和模拟仓库不合回 main。发现的产品 Bug 在产品分支修复，再同步到测试分支。
