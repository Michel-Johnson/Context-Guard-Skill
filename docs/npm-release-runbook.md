# npm Release Runbook / npm 发布与恢复手册

This package is delivered through npm. GitHub Releases are not used.

本项目只通过 npm 交付，不使用 GitHub Release。

## Release contract / 发布契约

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
5. Wait for the `Publish npm package` workflow to finish.
6. Verify `npm view @michelj/context-guard@X.Y.Z version` and `npm view @michelj/context-guard@latest version`.

1. 本地运行 `npm run test:cd`。
2. 通过 Pull Request 把 `package.json` 更新到下一个稳定版本。
3. 等待 `Required` 通过并合入 `main`。
4. 在该 `main` 提交上创建 `vX.Y.Z`，然后推送标签。
5. 等待 `Publish npm package` workflow 完成。
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
