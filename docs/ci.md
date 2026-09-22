# 检查怎样算通过

安全、工作台、三个客户端、自动化覆盖，原来是四篇，现已合成这一篇。改本文件时，七项检查全部跑。`docs/test-governance.md` 和 CI 配置一改，同样全跑。

## 安全

### What stays out of Git and releases

The entire `.codex/` tree, output, caches, real environment files, private keys
and credential files do not belong in source commits or npm packages. Keep public
templates and empty `.env.example` files only; examples are still scanned for
secrets. Do not copy private memory into another tracked directory or publish it
as PR/CI attachments. Necessary product documentation and verification summaries
remain allowed.

This repository's development memory is governed by
[`references/server-memory.md`](../references/server-memory.md): the private
server is its authority, while local records are caches or pending drafts. This
does not permit uploading credentials or machine runtime state as memory. Server
reads and writes both need authorization; public read-only access is not private.
Connection details stay out of public source. The private memory backend/client
has automated acceptance and one verified production deployment/migration; see
the memory contract and `CI_todo.md` for evidence and remaining limits. Further
migrations require separate approval. Native Hook trust and actual host delivery
remain separate acceptance items; Map-only sync alone is not the private memory store.

Product branches retain approved `.github/` checks and the cross-platform product
tests explicitly listed in `tests/test-manifest.json`. `scripts/branch_guard.py`
reads that manifest from the index; do not maintain a second test allowlist in
Python. Temporary experiments, fixtures, and fake repositories still belong only
on the test branch (local temporary scripts stay in ignored `temp/`).
Temporary tests and fake repositories remain on `cursor/test-layout-f54e`; do not
merge them into main. Product fixes belong on product branches. The existing
`scripts/branch_guard.py` remains part of pre-commit validation.

Removing tracked records is NOT a disk cleanup. Before applying the removal on
an older checkout, back up `.codex` outside Git-tracked content, verify the backup,
and restore local records after updating if needed. Old commits, tags, PR refs,
forks and downloads still retain historical data. Coordinate migration of other
branches; never reset a dirty worktree to make the removal easier.

### One-time developer setup

Requirements: Node >= 18, Python >= 3.9, Git and tar (included with modern Windows).

```sh
npm run dev:setup
npm run hooks:status
npm test
```

Setup downloads Gitleaks 8.30.1 from its official GitHub release and verifies the
platform archive against a pinned SHA-256. It installs only into ignored
`.security-tools/`; it does not globally install a package. The repository-local
hooksPath points to this checkout's `.githooks` using an absolute path so sibling
worktrees cannot silently lose the check on old branches. Keep that checkout
available; rerun setup after relocating it. Setup refuses unrelated custom hooks
rather than overwriting them. Integrate custom hooks explicitly if refusal occurs.

Consumer `npm install` / `npx` does not install developer hooks or the scanner.
Normal Skill creation of a user's local `.codex/context` remains unchanged.

### Post-merge local acceptance

A Context Guard product PR is not delivered merely because GitHub merged it.
The implementing Agent must immediately fetch the merged `origin/main`, update
the local global Skill from a checkout containing that merge, and prove that the
installed Skill/runtime matches the merged source. Then run `context-guard doctor`
and repeat the feature-specific acceptance through the installed entry point,
not the development checkout. Record the main merge commit, install source,
version/hash comparison, and runtime output. An explicit request to implement or
merge already authorizes these normal delivery steps; do not ask again. Native
Hook trust is still a host security boundary: report it when pending and never
use a dangerous trust bypass.

Repository-only documentation changes that do not affect distributed content or
runtime behavior may record installation/runtime acceptance as N/A with evidence,
under `RULE.md`. This does not waive `npm test`, Required, security, applicable
protocol closure, or any pre-existing product acceptance. Workflow and governance
documents still require review of their behavioral impact.

### When checks run

| Stage | Input | Result |
| --- | --- | --- |
| pre-commit | Actual index snapshot, then existing branch policy | Reject private paths or detected secrets |
| pre-push | Each outgoing head and its commit range | Catch secrets added then removed before push |
| CI | Checked-out tree and push/PR commit range | Security must succeed for Required |
| CI/CD package | Exact tarball, safely extracted | Reject unexpected files or secret content before artifact upload |

First pushes compare to a known main merge base where possible, otherwise scan
the head's full history. Missing objects, shallow history, scanner failure and
timeouts fail closed. Source scans include tracked documentation and test code;
there are no directory-wide secret exemptions. `gitleaks:allow` comments and
unreviewed fingerprint ignores cannot suppress a result through this wrapper.

Outgoing commit history is also checked for newly added private paths, even if
removed in a later commit. For a full-history first push, the repository's known
pre-migration commit `011682f7b640a7db3cf2ab1c9b6e01674266c0e4` is the legacy PATH
boundary only. It does not exempt any secret content from scanning, and does not
claim the records in older public commits have been removed.

The final package must match `.github/scripts/package-contract.mjs`, contain only
regular files and remain byte-identical during scanning. Existing artifact hashes
preserve the same package through installation tests and npm publication. CD
continues to run on version tags and uses OIDC; no long-lived npm token is added.
It also verifies an upgrade from the integrity-pinned npm `latest` without changing
user settings, project context, or third-party hooks. After publication, the npm
tarball must match the pre-publish SHA-256 and the result is recorded in the
Actions summary.

### Investigating a block

The wrapper never prints raw scanner stdout/stderr, matching source lines, secret
values or file paths (paths may themselves contain secrets). Findings contain a
rule, line number, commit ID when known, and a file ID: first 16 hexadecimal digits
of SHA-256 of the scan-root-relative file path using `/`. Resolve IDs against candidate paths locally;
do not upload original files or unredacted reports to Actions or issue comments.

Run `npm run security:staged` to recheck the index. `npm run security:audit` scans
all locally available branch/tag history; fetch intended refs first and record
coverage. A clean scan means no patterns were detected, not a proof of no secrets.
Rotate/revoke a confirmed leaked credential before separately planning history
cleanup. Do not add broad baselines or delete suspect content silently to publish.

### Limits and evidence

Git ignore rules only affect untracked files. Hooks can be bypassed and are not
server-side access control; CI runs after the GitHub upload. Keep GitHub secret
scanning/push protection enabled. This does not control cloud drives or other
applications. Historical removal/force pushes require separate authorization.

`npm run security:test` covers clean and rejected staged content, historical
secrets, actual hooks, safe archive handling and sanitized output using synthetic
credentials generated at runtime. It is also part of `npm test`; successful tests
clean their own temporary directory. Failures retain only synthetic test evidence.
`npm run test:cd` exercises the release rehearsal with the same package security
gate and a real upgrade from the current npm `latest`, without publishing. Never
upload a deliberately unsafe test package.

### 中文速查

- 首次开发运行 `npm run dev:setup`，用 `npm run hooks:status` 确认已启用。
- 提交前检查暂存区；推送前检查提交历史；CI 决定可否合并；CD 检查最终包后才上传。
- 整个 `.codex/` 不进 Git 或分发产物；开发记忆以私有服务器为准，本地仅缓存/待同步。凭据和本机运行状态不作为记忆上传；迁移前保留本地文件，历史不会自动清除。
- 正式测试留在源码仓库、不进 npm；普通用户安装不带扫描器或开发 hooks。
- 命中后停止并修复，不绕过、不输出原密钥；误报只接受精确、经审查的规则调整。

## 工作台

The `CI` workflow runs on branch/tag pushes and pull requests targeting `main`.
Pull requests always run security and deterministic impact selection; the selector
uses the merge-base diff and `.github/ci-impact.json` to run only relevant
functional, package, installation, minimum-runtime, browser, client and site jobs.
Unknown paths, CI config, this file, and `docs/test-governance.md` fail closed to the complete workflow.
Pushes to `main` and tags always run every job as the result listener/canary.

`Required` compares every job's actual result with the selector plan: selected
jobs must succeed and unselected jobs must be skipped. An arbitrary failed,
cancelled or skipped selected job is not a pass. The plan is retained as a
short-lived artifact and rendered in the Actions summary. This workflow does not
publish npm packages or call AI models.

### Run locally

Product checks require Node 18+ and Python 3. Browser development requires Node
20+ (CI uses Node 24) for the pinned dev-only Playwright dependency.

```sh
npm test
npm ci --ignore-scripts --no-audit --no-fund
npx --no-install playwright install chromium
npm run test:browser
```

On Linux CI, `playwright install --with-deps chromium` installs the required
system libraries as described in the [Playwright CI guide](https://playwright.dev/docs/ci).
`--ignore-scripts` prevents our package's postinstall from modifying a personal
Skill installation. Browser tests use bundled Chromium, not a signed-in browser.

### What is checked

- `npm test`: existing client driver/runtime checks; transactional installation
  boundaries; actual npm package contents, lifecycle hooks, language setup,
  session/message/bad-case persistence; workbench/inbox checks including
  interrupted writes, version conflicts, exact acknowledgements, project path
  aliases, linked-worktree project identity, one-service reuse, main/Session data
  isolation, shared Cloud binding, Windows short-path watchers and stop-then-restart
  behavior.
- `npm run test:browser`: a real SessionStart hook creates a synthetic session in
  an outside-checkout temporary project. The real page and public CLI check
  bidirectional persistence, human-only proposal confirmation, inbox redelivery,
  exact/idempotent ack, preservation of later edits, rejection of stale writes,
  and duplicate-operation safety. Existing editing/recovery scenarios also run.
- Browser reports identify the failed stage and completed checks. Screenshots and
  reports contain only synthetic test data. No credentials, full temporary home,
  real map, or server private state is uploaded. Success removes owned fixtures;
  failures retain the browser fixture locally for diagnosis.

The npm file allowlist and exact package contract exclude all tests, development
dependencies, CI files and reports. The browser job has no login/API secrets.
It does not prove model comprehension, native client conversations, reading
isolation, or background monitoring. Those are outside this CI's scope.

Path watchers use canonical paths to avoid the Windows short-path assertion
tracked in [libuv #5010](https://github.com/libuv/libuv/issues/5010).
Shutdown explicitly closes idle connections for [Node 18 compatibility](https://nodejs.org/download/release/v18.20.3/docs/api/http.html#servercloseidleconnections)
and waits for the project lock to be released before reporting CLI success.

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

- [OpenAI Docs：App Server](https://learn.chatgpt.com/docs/app-server)：发现查询与生成请求分离。
- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)：`--init-only` 执行 Setup/SessionStart 后退出，不开始对话。
- [Claude Hook 测试说明](https://code.claude.com/docs/en/hooks-guide)：直接输入 JSON 测试命令 Hook。
- [Cursor ACP](https://cursor.com/docs/cli/acp)：初始化、认证、创建 Session 和发送 Prompt 是不同步骤。
- [Cursor 安装](https://cursor.com/docs/cli/installation)：官方客户端分发入口。

## 自动化覆盖

阶段五。核对基线 `284823a7`，2026-09-12。下面是**源码中实际配置**，远端某次执行与分支保护是否生效仍要读取对应记录；不把本文件当自动化实现。

| 流程要求 | 现有执行入口 | 未覆盖与责任 |
|---|---|---|
| P01–P02 需求/设计/风险 | [模板](engineering/templates.md) 与 PR Review | 人工判断，无自动风险分级或 ADR 完整性门禁 |
| P03 层次与过程约束 | 既有模块回归、`verify-hidden-processes.mjs` | 指定模式检查，不证明全部进程/资源生命周期正确；Review 补充 |
| P04 测试归属 | `tests/test-manifest.json`、`verify-test-governance.mjs`、暂存区分支守卫 | 清单不证明测试实际执行或断言正确，见 GATE-01/02 |
| P05 总回归 | `npm test` | 不含完整 Browser E2E、site 包测试、所有真实宿主和付费对话 |
| P05 附加验收 | `npm run test:browser`、site 的 `npm test`、客户端与 CD 专项脚本 | 明确隔离环境；无对话客户端检查不是原生真实对话验收 |
| P06 Review | PR 审查与本地自检 | 没有通用语义审查器；独立性和范围需诚实记录 |
| P07 安全 | staged/history/package 扫描与 `.githooks` | [安全](#安全) 说明边界；未检出不等于绝无密钥 |
| P07 CI | `.github/workflows/ci.yml` 的 Required | 不允许按 R0–R3 跳过现有 needs；核对准确提交的远端结果 |
| P08 npm | `.github/workflows/npm-publish.yml`、[发布手册](npm-release-runbook.md) | 不是合并 Main 就发布；本次不执行 npm 发布 |
| P08 运行恢复 | 专项安装/部署手册、人工运行验收 | 未实现统一灰度/指标自动回滚；不声称已经无人值守 |
| P09 关闭与记忆 | [服务器契约](../references/server-memory.md) 和现有任务协议 | 真实部署与各宿主覆盖查 CI_todo；新流程不会绕过协议 |
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
