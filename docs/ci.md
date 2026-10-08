# 检查怎样算通过

安全、工作台、三个客户端、自动化覆盖，原来是四篇，现已合成这一篇。改本文件时，七项检查全部跑。`docs/test-governance.md` 和 CI 配置一改，同样全跑。

## 安全

### 不得进入 Git 与分发包的内容

整个 `.codex/`、输出、缓存、真实环境文件、私钥和凭据文件不得进入源码提交或 npm 包。只保留公开模板与空 `.env.example`，示例仍扫密钥。不得将私有记忆复制到其他跟踪目录或作为 PR / CI 附件公开；必要产品文档和验证摘要允许保留。

开发记忆遵守 [服务器记忆](../references/design/design-memory-server-v1.1.0.md)：私有服务器为准，本地只缓存或待同步草稿。不因此允许上传凭据或机器运行状态。服务器读写都须授权，公开只读不算私有；连接信息不放公开源码。

私有记忆后端 / 客户端已有自动验收及一次生产部署 / 迁移验证，证据和限制见契约与 `CI_todo.md`；进一步迁移单独批准。原生 Hook 信任、真实宿主投递分别验收，仅同步 Map 不是私有记忆存储。

产品分支保留已批准 `.github/` 检查和 `tests/test-manifest.json` 明列的跨平台产品测试。`scripts/branch_guard.py` 从暂存区读该清单，不再维护 Python 白名单。

临时实验、fixture、模拟仓库只在测试分支，本地临时脚本在忽略的 `temp/`。临时测试和模拟仓库留 `cursor/test-layout-f54e`，不合 main；产品修复在产品分支。既有分支守卫仍参与 pre-commit。

从 Git 移除跟踪记录不等于清磁盘。旧检出应用移除前，先在非 Git 跟踪位置备份并验证 `.codex`，更新后必要时恢复本地记录。旧提交、标签、PR 引用、fork、下载仍含历史数据；协调其他分支迁移，不重置脏工作树方便删除。

### 首次开发配置

要求：Node >= 18、Python >= 3.9、Git、tar（现代 Windows 已包含）。

```sh
npm run dev:setup
npm run hooks:status
npm test
```

配置从官方 GitHub 发布下载 Gitleaks 8.30.1，按固定 SHA-256 验证平台压缩包；仅安装到忽略的 `.security-tools/`，不全局安装。仓库 hooksPath 用绝对路径指向本检出的 `.githooks`，避免关联 worktree 在旧分支静默失去检查；保留该检出，移动后重跑配置。无关自定义 Hook 不覆盖而拒绝，需明确集成。

普通用户 `npm install` / `npx` 不安装开发 Hook 或扫描器；Skill 创建用户本地 `.codex/context` 的行为不变。

### 合并后本机验收

产品 PR 合入 GitHub 不等于交付。实施 Agent 须立即获取合并后的 `origin/main`，从包含合并的源码更新本机全局 Skill，证明安装副本与源码一致，再运行 `context-guard doctor`，经安装入口而非开发检出重复功能验收。

记录合并提交、安装来源、版本 / 哈希比对及运行输出。明确实现或合并已授权正常交付步骤，不重复询问。原生 Hook 信任仍是宿主安全边界，未完成如实报告，不危险绕过。

仓库专用文档不影响分发或运行时，可按 RULE.md 以证据将安装 / 运行验收记 N/A；不免除 `npm test`、Required、安全、适用协议收口或已有产品验收。工作流和治理文档仍需审核行为影响。

### 检查运行阶段

| 阶段 | 输入 | 结果 |
| --- | --- | --- |
| pre-commit | 实际暂存区快照，再检查现有分支政策 | 拒绝私有路径或检出的密钥 |
| pre-push | 每个待推送提交头及提交范围 | 检出推送前曾加入后又删除的密钥 |
| CI | 检出树及 push / PR 提交范围 | 安全检查成功才可通过 Required |
| CI/CD 打包 | 安全解包的精确 tarball | 上传前拒绝异常文件或密钥内容 |

首次推送尽量比较已知 main 合并基线，否则扫提交头完整历史。对象缺失、浅历史、扫描器失败或超时均拒绝放行。扫描包含跟踪文档和测试代码，不设整目录密钥豁免；包装器不允许 `gitleaks:allow` 或未审核指纹忽略压制结果。

待推送历史也查新增私有路径，即使后来删除。全历史首次推送仅以已知迁移前提交 `011682f7b640a7db3cf2ab1c9b6e01674266c0e4` 作为旧路径边界，不豁免密钥扫描，也不声称旧公开记录已删除。

最终包须精确匹配 `.github/scripts/package-contract.mjs`，仅含普通文件，扫描期间字节不变。产物哈希保证安装和 npm 发布复用同包。CD 仍由版本标签触发并用 OIDC，不增加长期 npm Token。

还从完整性固定的 npm `latest` 验证升级，不改用户设置、项目上下文或第三方 Hook。发布后 npm tarball 须匹配发布前 SHA-256，结果记录 Actions 摘要。

### 排查阻断

包装器不打印扫描器原始输出、命中源码行、密钥值或路径（路径也可能含密钥）。结果含规则、行号、已知提交 ID、文件 ID；文件 ID 为使用 `/` 的扫描根相对路径 SHA-256 前 16 位十六进制。在本机用候选路径解析，不向 Actions 或 issue 上传原文件或未脱敏报告。

`npm run security:staged` 重查暂存区；`npm run security:audit` 扫本地全部分支 / 标签历史，先获取目标引用并记录覆盖。未检出只代表没匹配模式，不证明无密钥。确认泄露先撤销或轮换，再单独规划历史清理；不为发布加宽泛基线或静默删可疑内容。

### 限制与证据

Git 忽略只影响未跟踪文件。Hook 可绕过，不是服务器访问控制；CI 在 GitHub 上传后才运行。保留 GitHub 密钥扫描和推送保护；此机制不控制云盘或其他应用。历史删除及强推另需授权。

`npm run security:test` 使用运行时合成凭据，覆盖干净 / 拒绝暂存内容、历史密钥、真实 Hook、安全压缩包处理和脱敏输出，也包含在 `npm test`。成功清理自有临时目录，失败只保留合成证据。

`npm run test:cd` 用同打包安全门禁和当前 npm `latest` 真实升级演练发布，不实际发布。不得上传故意不安全的测试包。

### 要点速查

- 首次开发运行 `npm run dev:setup`，用 `npm run hooks:status` 确认已启用。
- 提交前检查暂存区；推送前检查提交历史；CI 决定可否合并；CD 检查最终包后才上传。
- 整个 `.codex/` 不进 Git 或分发产物；开发记忆以私有服务器为准，本地仅缓存/待同步。凭据和本机运行状态不作为记忆上传；迁移前保留本地文件，历史不会自动清除。
- 正式测试留在源码仓库、不进 npm；普通用户安装不带扫描器或开发 hooks。
- 命中后停止并修复，不绕过、不输出原密钥；误报只接受精确、经审查的规则调整。

## 工作台

`CI` 工作流处理分支 / 标签推送及目标 main 的 PR。PR 总运行安全和确定性影响选择器；用合并基线差异及 `.github/ci-impact.json` 选择相关功能、打包、安装、最低运行时、浏览器、客户端任务。未知路径、CI 配置、本文或 `docs/test-governance.md` 变化执行完整检查。main 和标签推送始终全跑，作为结果监听和验证。

`Required` 对比实际任务结果与选择计划：选中任务须成功，未选须跳过。选中任务失败、取消或跳过都不是通过。计划作为短期产物保留并在 Actions 摘要显示。此工作流不发布 npm 或调用 AI 模型。

### 本地运行

产品检查需 Node 18+ 和 Python 3。固定的仅开发 Playwright 依赖要求浏览器开发 Node 20+，CI 用 Node 24。

```sh
npm test
npm ci --ignore-scripts --no-audit --no-fund
npx --no-install playwright install chromium
npm run test:browser
```

Linux CI 用 `playwright install --with-deps chromium` 安装系统库，见 [Playwright CI 指南](https://playwright.dev/docs/ci)。`--ignore-scripts` 防止包 postinstall 改个人 Skill。浏览器测试用自带 Chromium，不用已登录浏览器。

### 检查内容

- `npm test`：客户端驱动 / 运行时、事务安装边界、真实 npm 包内容、生命周期 Hook、语言设置、Session / 消息 / Bug 持久化；工作台和 inbox 覆盖中断写入、版本冲突、精确确认、路径别名、关联 worktree 身份、单服务复用、Main / Session 隔离、共享 Cloud 绑定、Windows 短路径监听、停止后重启。
- `npm run test:browser`：真实 SessionStart 在仓库外临时项目建合成 Session。真实页面和公共 CLI 验证双向持久化、仅人确认提案、inbox 重投、精确幂等确认、保留后来编辑、拒绝旧写入及重复操作安全，并跑既有编辑 / 恢复场景。
- 浏览器报告列失败阶段及已完成检查。截图和报告只含合成数据，不上传凭据、完整临时 HOME、真实 Map、服务器私有状态。成功删除自有 fixture，失败在本地保留浏览器 fixture 供诊断。

npm 白名单与精确包契约排除所有测试、开发依赖、CI 文件和报告。浏览器任务不含登录或 API 密钥，也不证明模型理解、原生客户端对话、读取隔离或后台监控，这些不在该 CI 范围。

路径监听用规范路径，避免 [libuv #5010](https://github.com/libuv/libuv/issues/5010) 所述 Windows 短路径断言。关闭时显式关闭空闲连接以 [兼容 Node 18](https://nodejs.org/download/release/v18.20.3/docs/api/http.html#servercloseidleconnections)，释放项目锁后才报告 CLI 成功。

## 三个客户端

本文描述不调用模型、可重复运行的日常兼容性检查。需要真实模型对话和测试凭据的补充验收保持为独立的手动 workflow，见 [`real-client-acceptance.md`](real-client-acceptance.md)；两者的“通过”含义不同。

这个工作流不需要 AI API Key，不发送模型对话，不读取个人账号，也不代表完整客户端端到端验收。

### 测什么

| 客户端 | 真实客户端检查 | 明确未覆盖 |
| --- | --- | --- |
| Codex | App Server 的 `skills/list` 和 `hooks/list` 识别安装后的 Skill 与 11 个生命周期 Hook；移走 Skill 或删掉 SessionStart 后检查必须失败，恢复后通过 | Hook 实际执行及上下文送达：非托管 Hook 仍需用户信任，测试不绕过 |
| Claude Code | `claude --init-only` 真正触发 SessionStart；未绑定时只留下注册证据且不初始化项目；去掉 Hook 后不再产生注册证据 | AI 询问并确认工作台绑定、UserPromptSubmit 和对话 Stop 的客户端触发 |
| Cursor | 真实 `agent acp` 握手、安装文件和配置合同；确认未登录创建 Session 返回认证要求 | 客户端发现 Skill、原生 SessionStart/UserPromptSubmit/Stop：需要登录；握手通过不等于这些功能通过 |

三家的消息记录、语言提示与保存、bad case 落盘等确定性逻辑，继续由原有 `tests/ci-smoke.mjs` 的模拟事件测试验证。模拟事件不冒充真实客户端事件；AI 的语义判断和实际回复不在本轮验收内。
Claude 的无对话检查只验证真实 SessionStart 产生“需要绑定”的注册证据且不建图、不启动服务；用户确认绑定并以同一 Session ID 继续的链路由打包冒烟和浏览器测试覆盖。

### 在哪里运行

- 原有 `.github/workflows/ci.yml` 继续在 Ubuntu、Windows、macOS 运行基础测试。
- 新增 `.github/workflows/client-compatibility.yml` 在 GitHub-hosted Ubuntu 运行三个独立客户端任务。
- 推送 `main`/`codex/CI`、向 `main` 提交 PR 或手动运行触发新工作流。
- 三个任务消费同一个经过 SHA-256 校验的 npm tarball，不发布 npm。
- 客户端版本固定在 `.github/client-versions.json`；升级需要重新验证接口和认证边界。
- 不设置 Secrets 或专用凭证环境；仓库权限为只读，不继承个人 HOME、客户端配置、环境凭证或 Node 注入选项。
- `Client checks (no dialogue)` 只汇总本表的覆盖范围；任何必需检查失败或任务跳过都会失败。现有 `Required` 保护规则不变。
- 工具仅安装到测试目录，不使用全局安装器，不更改用户 PATH。Cursor 使用官方固定版本下载包及其原有 Node 入口。
- 成功清理测试项目和客户端临时配置；失败保留本地临时目录。GitHub 仅上传 `report.json`、`summary.md` 和失败时的命令错误，不上传客户端 HOME 或认证目录。

### 本地复现

需要 Node 22+、Python 3。基础 CI 仍支持项目声明的 Node 18；安装新版客户端仅要求测试机器 Node 22+。

```sh
npm test
node .github/scripts/install-ci-client.mjs codex output/client-tools/codex
npm run test:clients -- --client codex --tools output/client-tools/codex --evidence output/client-results/codex
```

分别将 `codex` 换成 `claude` 和 `cursor`。可加 `--tarball <文件>` 检查指定包；省略时从当前代码打包。不需要复制个人登录目录。

`npm test` 包括测试驱动自身的故障检测测试，但只有 `test:clients` 才启动真实客户端。报告中的 `boundaries` 必须与绿色结果一起阅读。

### 官方依据

- [OpenAI App Server 文档](https://learn.chatgpt.com/docs/app-server)：发现查询与生成请求分离。
- [Claude Code 命令行参考](https://code.claude.com/docs/en/cli-reference)：`--init-only` 执行 Setup / SessionStart 后退出，不开始对话。
- [Claude Hook 测试说明](https://code.claude.com/docs/en/hooks-guide)：直接输入 JSON 测试命令 Hook。
- [Cursor ACP 文档](https://cursor.com/docs/cli/acp)：初始化、认证、创建 Session、发送 Prompt 是不同步骤。
- [Cursor 安装指南](https://cursor.com/docs/cli/installation)：官方客户端分发入口。

## 自动化覆盖

阶段五。核对基线 `284823a7`，2026-09-12。下面是**源码中实际配置**，远端某次执行与分支保护是否生效仍要读取对应记录；不把本文件当自动化实现。

| 流程要求 | 现有执行入口 | 未覆盖与责任 |
|---|---|---|
| P01–P02 需求/设计/风险 | [模板](engineering/templates.md) 与 PR Review | 人工判断，无自动风险分级或 ADR 完整性门禁 |
| P03 层次与过程约束 | 既有模块回归、`verify-hidden-processes.mjs` | 指定模式检查，不证明全部进程/资源生命周期正确；Review 补充 |
| P04 测试归属 | `tests/test-manifest.json`、`verify-test-governance.mjs`、暂存区分支守卫 | 清单不证明测试实际执行或断言正确，见 GATE-01/02 |
| P05 总回归 | `npm test` | 不含完整 Browser E2E、website 分支的宣传站包测试、所有真实宿主和付费对话 |
| P05 附加验收 | `npm run test:browser`、website 分支 `site/` 的 `npm test`、客户端与 CD 专项脚本 | 明确隔离环境；无对话客户端检查不是原生真实对话验收 |
| P06 Review | PR 审查与本地自检 | 没有通用语义审查器；独立性和范围需诚实记录 |
| P07 安全 | staged/history/package 扫描与 `.githooks` | [安全](#安全) 说明边界；未检出不等于绝无密钥 |
| P07 CI | `.github/workflows/ci.yml` 的 Required | 不允许按 R0–R3 跳过现有 needs；核对准确提交的远端结果 |
| P08 npm | `.github/workflows/npm-publish.yml`、[发布手册](npm-release-runbook.md) | 不是合并 Main 就发布；本次不执行 npm 发布 |
| P08 运行恢复 | 专项安装/部署手册、人工运行验收 | 未实现统一灰度/指标自动回滚；不声称已经无人值守 |
| P09 关闭与记忆 | [服务器契约](../references/design/design-memory-server-v1.1.0.md) 和现有任务协议 | 真实部署与各宿主覆盖查 CI_todo；新流程不会绕过协议 |
| P10 改进 | 复盘/CI_todo/PR | 尚无自动汇总项目质量指标的产品功能 |

### 明确待实现

这些是独立后续开发，不阻止本次把规范写清，也不因规范合并自动完成。

| ID | 待办与临时措施 | 将来完成的验收条件 |
|---|---|---|
| GATE-01 | 统一清单校验和 runner 的发现逻辑；当前只把顶层 `.test.mjs` 当自动执行，独立套件需可达入口 | 递归/排除/新增目录只定义一次；嵌套故意失败测试必须令总入口失败，删除/改名/重复执行有回归 |
| GATE-02 | 聚焦/跳过检测覆盖不足；Reviewer 检查所有新增聚焦形式、skip 理由和关键路径 | 对别名、选项式 `only`、计算属性等明确支持或禁止并测试；有效 skip 说明/关联问题可审计；注释/字符串不过度误报 |
| GATE-03 | 统一格式/静态检查暂缓，无全仓格式迁移 | 先盘点语言与既有风格，试运行增量范围、记录误报，再提独立 PR；不能写成当前已 lint 全绿 |
| GATE-04 | 通用发布观察与自动回滚暂缓 | 先界定部署目标、兼容和恢复限制，合成环境演练故障、指标与回退，再申请实际运行验证 |
| GATE-05 | 本机 Windows 全量/浏览器回归存在 Python 别名与 Hook 超时问题，见验证记录；根因不一概归为环境 | 统一受支持解释器发现，在未改断言/超时的前提下复现并定位；准确记录受支持 Windows 环境中的全量与隔离浏览器结果 |

GATE-01/02/05 在 [CI_todo](../CI_todo.md) 留入口；本页保存验收定义，避免复制成长篇待办。责任归后续负责测试基础设施的实施者，当前未指派具体人员。

### 迁移方式

1. 本 PR 合并后，后续任务从主流程和相关专项开始，已有在途任务只补缺少的必要证据，不重写私人历史。
2. 旧的已通过记录保留原版本语境，不追溯标成满足本次所有新规则。
3. R0 不影响分发时安装 N/A；改变规则行为仍需 R2/R3 审查。不能从“文档”推出“无需测试”。
4. 后续可先观察连续 10 个已交付 PR 的风险判定、返工、首次测试失败和遗漏验收，维护者再决定是否调整规则；这是人工改进建议，不创建定时任务或承诺已有统计结果。
