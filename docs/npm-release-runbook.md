# npm 发布与恢复手册

Skill 通过 npm 交付。Cloud 独立部署；Skill 构建依赖的固定共享运行时产物由 Cloud GitHub Releases 提供。Skill 的 npm 发布不会部署 Cloud，也不会把服务端代码放入安装包。

## 拆分后的构建边界

在干净的 Skill 源码检出中先执行：

```bash
npm ci --ignore-scripts
npm run build:runtime
```

`@michelj/context-guard-core` 和 `@michelj/context-guard-workbench` 使用明确的 Cloud 发布版本及锁文件，不跟随 `main` 或 `latest`。`build:runtime` 将共享协议、工作台 UI、角色与多数 references 生成到原运行路径；`references/design/design-cloud-sync-v1.0.1.md` 仍由 Skill 维护，不得被生成物覆盖。

`scripts/shared/`、`prototype/`、角色文件及生成参考不提交进 Skill Git；它们须进入最终安装产物，安装后的本地工作台不能依赖另一个 Cloud 源码目录。不要直接修生成物；在 Cloud 源码修复、发布新共享包，再更新 Skill 依赖与锁文件。构建检测到生成物被手工修改时应停止，保留修改待核对，不能强行覆盖。

首次拆分发布顺序是：Cloud 共享包的准确版本可下载并通过校验 → Skill 锁文件确定该版本 → 干净构建 → 原有测试和 tarball 安装验收 → Skill npm 发布。共享包不可下载、锁文件不符、产物缺失或夹带 Cloud/Slack 服务端都阻止发布；不从本机旧目录补文件求通过。

记录 Cloud 源码 SHA、共享包版本/锁文件校验和 Skill 提交及产物哈希。两个仓库各自通过 Required；跨仓库验收绑定这些版本，不能沿用拆分前的测试结果冒充新发布成功。Cloud 部署与服务版本核验见 [独立部署手册](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/references/cloud-deployment.md)。

## 超时与清理

Windows 测试使用已验证 Python 3 和经 Node 调用的 npm CLI，不使用未验证的 Store 别名或直接 spawn `npm.cmd`。Node 套件总超时 15 分钟、两文件并发；超时判失败，仅终止本任务子进程树。多 worktree 和 Cloud 集成 CLI 限 120 秒。

Hook 计划命令允许 180 秒，因为子工作台 HTTP 本身可等 40 秒；旧 30 秒父命令曾中断有效请求。CD 演练外层 `npm test` 限 30 分钟，包含安全及 Node 套件外打包冒烟。`CONTEXT_GUARD_TEST_TRACE=1` 输出 Hook 耗时，不转储环境。

测试宿主目录和 Git 用户配置隔离，避免读取个人客户端历史或触发个人配置。清理顺序是停止入口、等待后台任务/文件操作完成、再删除本用例的临时目录；Windows 残余文件锁只做有界重试，失败仍报错。Cloud 的 `close()` 等待已开始的自动发布和 HTTP 处理，Hook fixture 通过官方停止入口解析普通目录及 Git 共享目录。普通非 Git 目录只探测一次，不再启动三个注定无效的 Git 元数据子进程。

单次重跑成功不能证明偶发超时已解决；验收需保留首次失败，重复定向用例、比较串行/并发，再运行完整 `npm test` 和实际 tarball 安装/升级。正在运行其他测试时的耗时属于负载证据，不作为独占环境性能基准。以上不改变 CI/CD 触发条件，也不跳过任何断言或 Required 门禁。

## 在 Actions 中区分 CI 与 CD

Actions 左侧分别显示 **CI | 代码与功能检查** 和 **CD | npm 发布**。运行标题直接写明分支、PR 或版本标签，不再只显示提交说明。CI 不发布 npm；CD 自己包含发布前后的安装包验收，并非只有“发布到 npm”一步属于 CD。

| 操作 | CI | CD |
| --- | --- | --- |
| 仅本地提交 | 不运行 | 不运行 |
| 推送 main，包括合并 | 运行 | 不运行 |
| 推送其他分支且无目标 main 的 PR | 不运行 | 不运行 |
| 创建、更新或重新打开目标 main 的 PR | 运行 | 不运行 |
| 推送 v0.4.5 等版本标签 | 运行 | 运行 |

上表以 `ci.yml` 为准：分支 push 仅匹配 `main`；更新目标为 `main` 的 PR 触发 PR 检查。其他 workflow 单独判断。下文历史分支推送案例不代表当前普通功能分支的触发配置。

标签触发的 CI 和 CD 仍分别显示，但 CD 在打包前和发布前都会查询同一提交对应的 `ci.yml` 最新匹配 push 运行（main 或当前发布标签），要求整个运行及唯一的 `Required` job 均成功。CI 未出现或未结束时最多等待 30 分钟；失败、取消、跳过、API 错误或超时均阻止发布。非稳定标签、版本不一致和不属于 main 的提交也会被拒绝。API 契约见 [GitHub 工作流运行接口](https://docs.github.com/en/rest/actions/workflow-runs) 和 [工作流任务接口](https://docs.github.com/en/rest/actions/workflow-jobs)。

安装验收不仅检查文件，还从 npm/npx 安装后的 Skill 加载 Workbench，在隔离项目和临时端口启动，检查健康接口、页面与静态资源内容、授权状态读取和未授权拒绝，结束后关闭服务。这属于包运行验收，不代替真实浏览器交互、AI 客户端对话或生产 Cloud 部署验收；npm 发布不会自动更新生产 Cloud。

- **CI 1**：功能测试与包内容检查；**CI 2**：Ubuntu/macOS/Windows 并行功能与安装测试；**Required**：汇总 CI 结果，作为合并门槛。`Required` 名称保持不变，因为 main 分支保护绑定了它。
- **CD 1**：发布校验与打包；**CD 2**：Ubuntu/macOS/Windows 并行安装包验收；**CD 3**：全部验收通过后发布；**CD 4**：从 npm 下载并验证已发布版本。

阶段编号表示依赖顺序，不是定时间隔。新名称用于后续运行，已有运行的标题和任务记录不会被重写。`npm-publish.yml` 文件名不变，保留现有 npm Trusted Publisher 绑定。

## Dependabot 自动合并

**依赖维护 | Dependabot 自动合并** 是独立的维护工作流，不属于 CI 或 CD。Dependabot 每周检查 GitHub Actions 工具更新；它创建、重新打开、更新 PR 或把 PR 标为可审核时，维护工作流读取经过验证的 Dependabot 元数据。本仓库内、目标为 `main`、非草稿的 Dependabot GitHub Actions 更新，无论补丁、小版本还是大版本，都可登记自动合并。未知更新类型、其他依赖生态和普通功能 PR 不会被自动登记。

`.github/dependabot.yml` 只保留一个 `actions` 组，补丁、小版本、大版本集中到同一个 PR；`open-pull-requests-limit: 1` 将同时待合并的版本更新 PR 限为一个。每周检查由 Dependabot 服务执行，有更新才创建临时 PR 分支，不需要保留一个常驻检查分支。组名只用于整理，不代表合并权限；维护工作流仍验证更新元数据，并要求原有合并条件全部满足。安全更新分组不变，安全更新 PR 不受这个版本更新数量上限约束。

大版本自动合并是用户明确选择的策略：可能包含现有 CI 没有检测到的破坏性变更。所有版本都等待 `Required` 与分支保护满足，不能绕过失败/取消的检查、未同步主分支或冲突；不因更新为大版本额外要求人工确认。本规则替代原来的“仅补丁/小版本自动合并”。

一次性开启 **Settings → General → Pull Requests → Allow auto-merge**。工作流针对 PR 的确切提交请求 GitHub 原生自动合并，不绕过分支保护、不代替人工批准。保留必需的 `Required` 检查以及分支必须同步 main 的要求；CI 失败、冲突或其他审核/保护条件未满足时不能合并。仓库开关只代表允许使用自动合并，并不意味着所有 PR 都自动合并。

有写权限的 `pull_request_target` 工作流不检出 PR 代码、不下载 PR 产物；使用 GitHub 内置 Token，将元数据 Action 固定到完整提交 SHA，并保留作者及提交验证。不新增 PAT、npm 凭据、自动版本标签或 npm 发布。原 CI/CD 触发配置不变；`GITHUB_TOKEN` 产生的事件可能不会启动后续工作流。自动合并使用现有的 **Required** 门禁：分支和 PR 的检查目前同名，不代表必须分别等两轮全部结束。已核验的 #26 时间线中，分支 Required 先通过并触发自动合并，PR Required 随后完成；不能假设合并后还会额外再跑一次 CI。

需要停止时，可禁用这个维护工作流；禁用工作流不会撤销已经登记的 PR 自动合并，需要逐个取消。也可以关闭仓库的 Allow auto-merge 开关，不必停用 CI 或 CD。

官方说明：[Dependabot 自动化](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions)、[更新分组](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#groups)、[元数据验证](https://github.com/dependabot/fetch-metadata)、[GITHUB_TOKEN 触发事件](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)。

## 发布契约

需要调用模型的三客户端真实对话验收是独立的手动 workflow，不属于每次发布的自动 CD，也不默认阻塞 `Required`。配置方法和验收边界见 [`docs/real-client-acceptance.md`](real-client-acceptance.md)。

- 稳定标签必须使用 `vX.Y.Z`，并与 `package.json` 完全一致。
- 目标版本必须尚未发布，并且严格高于 npm 当前稳定的 `latest` 版本。
- 标签指向的提交必须已经属于 `main`。
- `.github/workflows/npm-publish.yml` 只构建一个 tarball，校验精确内容并记录 SHA-256；Ubuntu、macOS、Windows 安装测试和 npm 发布复用同一份产物。
- 每个系统还会从经过 SHA-512/SHA-256 校验的 npm 当前 `latest` 升级，确认用户设置、项目 `.codex` 上下文和第三方 Hook 不被改写，并覆盖 npm 全局升级与 npm-exec 升级。
- 只有 `publish` job 拥有 `id-token: write`。npm 认证使用 Trusted Publishing，不保存长期 `NPM_TOKEN`。
- 真正发布前会再次执行 registry 版本门禁，避免打包与发布之间发生版本竞争。
- 发布后会从 npm 下载 tarball，与发布前 SHA-256 精确比对并写入 Actions Summary 凭证；随后验证精确版本全局安装及无版本 `npx @michelj/context-guard install`。

## 一次性配置

本仓库的 v0.4.2 和 v0.4.3 已通过该 workflow 使用 OIDC 发布。优先复用已有绑定，本地 npm 登录不是发布前置条件；只有新建绑定或修复已确认的授权错误时，才需要配置以下字段。

在 npm 包设置中按以下精确值配置 GitHub Actions Trusted Publisher：

```text
Organization or user: Michel-Johnson
Repository: Context-Guard-Skill
Workflow filename: npm-publish.yml
Environment: 留空
Allowed actions: npm publish
```

Trusted Publishing 验证成功后，把 npm 的 **Publishing access** 设置为 **Require two-factor authentication and disallow tokens**。OIDC workflow 仍可发布，但长期写入 Token 不能绕过该链路。

保护 `main`：要求通过 Pull Request、要求唯一状态检查 `Required`、禁止强推和删除。保护 `v*` 标签：只有仓库管理员可以创建、更新或删除。

## 正常发布

1. 本地依次运行 `npm ci --ignore-scripts`、`npm run build:runtime`、`npm run test:cd`。
2. 通过 Pull Request 把 `package.json` 更新到下一个稳定版本。
3. 等待 `Required` 通过并合入 `main`。
4. 在该 `main` 提交上创建 `vX.Y.Z`，然后推送标签。
5. 等待 `CD | npm 发布` workflow 完成。
6. 用 `npm view @michelj/context-guard@X.Y.Z version` 和 `npm view @michelj/context-guard@latest version` 复核。

## 失败与恢复

### npm 发布前

- 如果只是 GitHub/npm 临时故障，重新运行同一个失败的 workflow run，继续使用不可变的标签源码。
- 如果是代码、元数据或打包契约失败，不移动也不删除版本标签；修复 `main`，升级新的 patch 版本，再创建新标签。

### npm 发布后

npm 版本不可覆盖，不要尝试重新发布同一版本。

1. 用 `npm view @michelj/context-guard@X.Y.Z --json` 检查精确版本。
2. 包本身正确但 `latest` 错误时，运行 `npm dist-tag add @michelj/context-guard@X.Y.Z latest` 恢复标签。
3. 包有缺陷时，运行 `npm deprecate @michelj/context-guard@X.Y.Z "Use X.Y.Z+1"` 标记弃用，把 `latest` 指回最后一个已知可用版本，再发布新 patch。
4. 不默认使用 `npm unpublish`；已有用户和 lockfile 可能已经依赖该版本。

Trusted Publishing 只认证 `npm publish`。`npm dist-tag`、`npm deprecate` 等人工恢复命令需要维护者另行登录，并满足相应 2FA 要求。
