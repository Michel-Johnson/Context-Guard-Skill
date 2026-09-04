# npm Release Runbook / npm 发布与恢复手册

This package is delivered through npm. GitHub Releases are not used.

本项目只通过 npm 交付，不使用 GitHub Release。

## Finding CI and CD in Actions / 在 Actions 中区分 CI 与 CD

The Actions sidebar lists **CI | 代码与功能检查** (code and behavior checks) and **CD | npm 发布** (npm delivery) separately. Run titles identify the branch, PR, or version tag instead of repeating the commit message. CI never publishes to npm; CD contains its own package acceptance checks before and after publication.

Actions 左侧分别显示 **CI | 代码与功能检查** 和 **CD | npm 发布**。运行标题直接写明分支、PR 或版本标签，不再只显示提交说明。CI 不发布 npm；CD 自己包含发布前后的安装包验收，并非只有“发布到 npm”一步属于 CD。

| Event / 操作 | CI | CD |
| --- | --- | --- |
| Local commit only / 仅本地提交 | No / 不运行 | No / 不运行 |
| Push a branch, including main / 推送分支，包括合入 main | Yes / 运行 | No / 不运行 |
| Open, update, or reopen a PR targeting main / 创建、更新代码或重新打开目标为 main 的 PR | Yes / 运行 | No / 不运行 |
| Push a version tag such as v0.4.5 / 推送版本标签 | Yes / 运行 | Yes / 运行 |

Tag-triggered CI and CD are separate runs, not a chained CI-to-CD workflow. This naming cleanup preserves the existing triggers and every test. A tag outside the stable `vX.Y.Z` format, a version mismatch, or a commit outside `main` is rejected by CD before publication.

标签触发的 CI 和 CD 是独立运行，不是“本次 CI 完成后再启动 CD”。本次命名整理保留原触发规则和全部测试。CD 会在发布前拒绝非稳定 `vX.Y.Z` 标签、版本不一致或不属于 `main` 的提交。

- **CI 1**: functionality and package-content checks; **CI 2**: parallel Ubuntu/macOS/Windows functionality and installation checks; **Required**: aggregate the CI results for the merge gate. The name `Required` stays unchanged because main branch protection uses it.
- **CD 1**: validate release identity and package; **CD 2**: parallel Ubuntu/macOS/Windows package-install acceptance; **CD 3**: publish only after all acceptance jobs pass; **CD 4**: download and verify the published package.

- **CI 1**：功能测试与包内容检查；**CI 2**：Ubuntu/macOS/Windows 并行功能与安装测试；**Required**：汇总 CI 结果，作为合并门槛。`Required` 名称保持不变，因为 main 分支保护绑定了它。
- **CD 1**：发布校验与打包；**CD 2**：Ubuntu/macOS/Windows 并行安装包验收；**CD 3**：全部验收通过后发布；**CD 4**：从 npm 下载并验证已发布版本。

The numbered labels describe dependencies, not scheduled intervals. New names apply to future runs; existing run titles and job records are not rewritten. `npm-publish.yml` keeps its filename so the npm Trusted Publisher binding remains valid.

阶段编号表示依赖顺序，不是定时间隔。新名称用于后续运行，已有运行的标题和任务记录不会被重写。`npm-publish.yml` 文件名不变，保留现有 npm Trusted Publisher 绑定。

## Dependabot auto-merge / Dependabot 自动合并

**依赖维护 | Dependabot 自动合并** is a separate maintenance workflow, not CI or CD. Dependabot checks GitHub Actions dependencies weekly. When it opens, reopens, updates, or marks a PR ready for review, the maintenance workflow reads verified Dependabot metadata. Same-repository, non-draft Dependabot PRs targeting `main` that update GitHub Actions dependencies by a patch, minor, or major version are eligible. Unknown update types, other ecosystems, and ordinary feature PRs are not enrolled in auto-merge.

**依赖维护 | Dependabot 自动合并** 是独立的维护工作流，不属于 CI 或 CD。Dependabot 每周检查 GitHub Actions 工具更新；它创建、重新打开、更新 PR 或把 PR 标为可审核时，维护工作流读取经过验证的 Dependabot 元数据。本仓库内、目标为 `main`、非草稿的 Dependabot GitHub Actions 更新，无论补丁、小版本还是大版本，都可登记自动合并。未知更新类型、其他依赖生态和普通功能 PR 不会被自动登记。

Version updates are grouped in `.github/dependabot.yml`: the single `actions` group combines patch, minor, and major upgrades. `open-pull-requests-limit: 1` limits open version-update PRs to one. Dependabot performs the scheduled check; the PR branch is created only when updates exist, not kept as a permanent checking branch. Group names are organizational labels, not authorization: the maintenance workflow still checks verified update metadata and all existing merge requirements. Security-update grouping is unchanged, and security-update PRs are not covered by the version-update limit.

`.github/dependabot.yml` 只保留一个 `actions` 组，补丁、小版本、大版本集中到同一个 PR；`open-pull-requests-limit: 1` 将同时待合并的版本更新 PR 限为一个。每周检查由 Dependabot 服务执行，有更新才创建临时 PR 分支，不需要保留一个常驻检查分支。组名只用于整理，不代表合并权限；维护工作流仍验证更新元数据，并要求原有合并条件全部满足。安全更新分组不变，安全更新 PR 不受这个版本更新数量上限约束。

Major-version auto-merge is an explicit maintainer policy: it can include breaking changes that the existing CI does not detect. All versions wait for `Required` and branch protection; a failed or cancelled check, stale base, or conflict must not be bypassed. No separate manual approval is added solely because an update is major. This replaces the former minor/patch-only policy.

大版本自动合并是用户明确选择的策略：可能包含现有 CI 没有检测到的破坏性变更。所有版本都等待 `Required` 与分支保护满足，不能绕过失败/取消的检查、未同步主分支或冲突；不因更新为大版本额外要求人工确认。本规则替代原来的“仅补丁/小版本自动合并”。

Enable **Settings → General → Pull Requests → Allow auto-merge** once. The workflow requests GitHub's native auto-merge for the exact PR head; it does not bypass branch protection or approve reviews. Keep `Required` mandatory and the branch up-to-date requirement enabled. CI failures, conflicts, or any unmet review/protection requirement prevent merging. The repository switch only allows auto-merge; it does not automatically enable it for every PR.

一次性开启 **Settings → General → Pull Requests → Allow auto-merge**。工作流针对 PR 的确切提交请求 GitHub 原生自动合并，不绕过分支保护、不代替人工批准。保留必需的 `Required` 检查以及分支必须同步 main 的要求；CI 失败、冲突或其他审核/保护条件未满足时不能合并。仓库开关只代表允许使用自动合并，并不意味着所有 PR 都自动合并。

The privileged `pull_request_target` workflow never checks out PR code or downloads PR artifacts. It uses the built-in GitHub token, pins the metadata Action by commit SHA, and retains author/commit verification. No PAT, npm credential, automatic version tag, or npm publication is added. CI/CD triggers remain unchanged. Events caused by `GITHUB_TOKEN` may not start follow-up workflows. The gate is the existing **Required** check: push and PR runs currently expose the same name, so this does not independently require both runs to finish. In the verified #26 timeline, push Required succeeded before auto-merge, while PR Required completed afterward; do not assume an extra post-merge run.

有写权限的 `pull_request_target` 工作流不检出 PR 代码、不下载 PR 产物；使用 GitHub 内置 Token，将元数据 Action 固定到完整提交 SHA，并保留作者及提交验证。不新增 PAT、npm 凭据、自动版本标签或 npm 发布。原 CI/CD 触发配置不变；`GITHUB_TOKEN` 产生的事件可能不会启动后续工作流。自动合并使用现有的 **Required** 门禁：分支和 PR 的检查目前同名，不代表必须分别等两轮全部结束。已核验的 #26 时间线中，分支 Required 先通过并触发自动合并，PR Required 随后完成；不能假设合并后还会额外再跑一次 CI。

To stop this automation, disable its workflow. Disabling the workflow does not cancel auto-merge already enabled on a PR; cancel those requests individually. The repository-wide Allow auto-merge switch can also be turned off. None of these actions requires disabling CI or CD.

需要停止时，可禁用这个维护工作流；禁用工作流不会撤销已经登记的 PR 自动合并，需要逐个取消。也可以关闭仓库的 Allow auto-merge 开关，不必停用 CI 或 CD。

References / 官方说明: [Dependabot automation](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions), [update groups](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#groups), [metadata verification](https://github.com/dependabot/fetch-metadata), [GITHUB_TOKEN-triggered events](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow).

## Release contract / 发布契约

需要调用模型的三客户端真实对话验收是独立的手动 workflow，不属于每次发布的自动 CD，也不默认阻塞 `Required`。配置方法和验收边界见 [`docs/real-client-acceptance.md`](real-client-acceptance.md)。

- A stable tag must use `vX.Y.Z` and match `package.json` exactly.
- The tagged commit must already be part of `main`.
- `.github/workflows/npm-publish.yml` builds one tarball, validates its exact contents, records its SHA-256, installs that same artifact on Ubuntu, macOS, and Windows, then publishes that artifact.
- Only the `publish` job receives `id-token: write`. npm authentication uses Trusted Publishing; no long-lived `NPM_TOKEN` is required.
- After publication, the workflow waits for the exact version and `latest`, then exercises both an exact global install and the documented unversioned `npx @michelj/context-guard install` path.

- 稳定标签必须使用 `vX.Y.Z`，并与 `package.json` 完全一致。
- 标签指向的提交必须已经属于 `main`。
- `.github/workflows/npm-publish.yml` 只构建一个 tarball，校验精确内容并记录 SHA-256；Ubuntu、macOS、Windows 安装测试和 npm 发布复用同一份产物。
- 只有 `publish` job 拥有 `id-token: write`。npm 认证使用 Trusted Publishing，不保存长期 `NPM_TOKEN`。
- 发布后会等待精确版本和 `latest` 生效，然后验证精确版本的全局安装，以及文档中的无版本 `npx @michelj/context-guard install`。

## One-time configuration / 一次性配置

This repository already published v0.4.2 and v0.4.3 through this workflow using OIDC. Reuse that binding; a local npm login is not a release prerequisite. Configure the fields below only when setting up a new binding or repairing a confirmed authorization failure.

本仓库的 v0.4.2 和 v0.4.3 已通过该 workflow 使用 OIDC 发布。优先复用已有绑定，本地 npm 登录不是发布前置条件；只有新建绑定或修复已确认的授权错误时，才需要配置以下字段。

Configure the npm package's GitHub Actions Trusted Publisher with these exact values:

在 npm 包设置中按以下精确值配置 GitHub Actions Trusted Publisher：

```text
Organization or user: Michel-Johnson
Repository: Context-Guard-Skill
Workflow filename: npm-publish.yml
Environment: leave empty
Allowed actions: npm publish
```

After Trusted Publishing works, set npm **Publishing access** to **Require two-factor authentication and disallow tokens**. The OIDC workflow continues to publish, while long-lived write tokens cannot bypass it.

Trusted Publishing 验证成功后，把 npm 的 **Publishing access** 设置为 **Require two-factor authentication and disallow tokens**。OIDC workflow 仍可发布，但长期写入 Token 不能绕过该链路。

Protect `main` with the unique required check `Required`, require changes through a pull request, and block force pushes and deletion. Protect matching `v*` tags so only repository administrators can create, update, or delete them.

保护 `main`：要求通过 Pull Request、要求唯一状态检查 `Required`、禁止强推和删除。保护 `v*` 标签：只有仓库管理员可以创建、更新或删除。

## Normal release / 正常发布

1. Run `npm run test:cd` locally.
2. Update `package.json` to the next stable version through a pull request.
3. Wait for the `Required` check and merge into `main`.
4. Create `vX.Y.Z` on that exact `main` commit and push the tag.
5. Wait for the `CD | npm 发布` workflow to finish.
6. Verify `npm view @michelj/context-guard@X.Y.Z version` and `npm view @michelj/context-guard@latest version`.

1. 本地运行 `npm run test:cd`。
2. 通过 Pull Request 把 `package.json` 更新到下一个稳定版本。
3. 等待 `Required` 通过并合入 `main`。
4. 在该 `main` 提交上创建 `vX.Y.Z`，然后推送标签。
5. 等待 `CD | npm 发布` workflow 完成。
6. 用 `npm view @michelj/context-guard@X.Y.Z version` 和 `npm view @michelj/context-guard@latest version` 复核。

## Failure and recovery / 失败与恢复

### Before npm publish / npm 发布前

- For a transient GitHub/npm outage, rerun the same failed workflow run so it reuses the immutable tagged source.
- For a code, metadata, or package-contract failure, do not move or delete the version tag. Fix `main`, bump to a new patch version, and create a new tag.

- 如果只是 GitHub/npm 临时故障，重新运行同一个失败的 workflow run，继续使用不可变的标签源码。
- 如果是代码、元数据或打包契约失败，不移动也不删除版本标签；修复 `main`，升级新的 patch 版本，再创建新标签。

### After npm publish / npm 发布后

npm versions are immutable. Never try to overwrite the same version.

npm 版本不可覆盖，不要尝试重新发布同一版本。

1. Inspect the exact version with `npm view @michelj/context-guard@X.Y.Z --json`.
2. If the package is correct but `latest` is wrong, restore it with `npm dist-tag add @michelj/context-guard@X.Y.Z latest`.
3. If the package is broken, mark it with `npm deprecate @michelj/context-guard@X.Y.Z "Use X.Y.Z+1"`, point `latest` back to the last known-good version, then publish a new patch version.
4. Do not default to `npm unpublish`; existing users and lockfiles may already depend on the version.

1. 用 `npm view @michelj/context-guard@X.Y.Z --json` 检查精确版本。
2. 包本身正确但 `latest` 错误时，运行 `npm dist-tag add @michelj/context-guard@X.Y.Z latest` 恢复标签。
3. 包有缺陷时，运行 `npm deprecate @michelj/context-guard@X.Y.Z "Use X.Y.Z+1"` 标记弃用，把 `latest` 指回最后一个已知可用版本，再发布新 patch。
4. 不默认使用 `npm unpublish`；已有用户和 lockfile 可能已经依赖该版本。

Trusted Publishing authenticates `npm publish` only. Manual recovery commands such as `npm dist-tag` and `npm deprecate` require a separately authenticated maintainer session and any applicable 2FA.

Trusted Publishing 只认证 `npm publish`。`npm dist-tag`、`npm deprecate` 等人工恢复命令需要维护者另行登录，并满足相应 2FA 要求。
