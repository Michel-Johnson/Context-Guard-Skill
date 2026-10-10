# npm 发布与恢复手册

Skill npm 发布、共享包发布、Cloud 部署是三个独立动作，不自动互相部署。源码归属见 [仓库边界](repository-boundaries.md)，测试见 [CI 标准](ci.md)，权限与交付见 [RULE](../RULE.md)。

## 两仓库的构建与发布边界

`npm run pack:shared` 从同一 Skill 提交打包 core / workbench，核精确白名单后发布至 Skill GitHub Releases。先发布可下载、可校验的共享包，再更新 Cloud 的固定 URL 与锁文件；记录双方提交、版本、哈希，双方 Required 分别通过。不从其他本地检出补文件或修改 Cloud 生成物。

## 在 Actions 中区分 CI 与 CD

| 操作 | CI | CD |
| --- | --- | --- |
| 本地提交；无目标 main PR 的普通分支推送 | 不运行 | 不运行 |
| 推送 main 或更新目标 main 的 PR | 运行 | 不运行 |
| 推送稳定 `vX.Y.Z` 标签 | 运行 | 运行 |

以 [ci.yml](../.github/workflows/ci.yml) 和 [npm-publish.yml](../.github/workflows/npm-publish.yml) 为准，其他 workflow 独立判断。CI 不发布；CD 包含打包、Ubuntu/macOS/Windows 安装验收、发布和 npm 回读。

## 发布契约

- 标签为 `vX.Y.Z`，与 `package.json` 一致，提交已属于 main；版本未发布且严格高于 npm 稳定 `latest`。
- CD 在打包前和发布前核同一提交的最新匹配 push CI（main 或当前标签），要求完整运行及唯一 `Required` 成功；等待最多 30 分钟。失败、取消、跳过、API 错误、超时均阻止发布。
- 只构建一个 tarball，记录 SHA-256；三系统安装与发布复用它。升级从经 SHA-512/SHA-256 校验的 `latest` 进行，覆盖全局及 npm-exec 升级，保留设置、项目上下文与第三方 Hook。
- 安装验收从 npm/npx 产物启动隔离 Workbench，核健康、页面、静态资源、授权读取及越权拒绝，结束后停止。它不代替真实浏览器、客户端对话或生产 Cloud 验收；真实对话另见 [手动验收](ci.md#真实客户端对话验收)。
- 只有 `publish` job 有 `id-token: write`，使用 Trusted Publishing，不保存长期 `NPM_TOKEN`；发布前再次检查 registry 版本竞争。
- 发布后下载 npm tarball，核同一 SHA-256 并写 Actions Summary，验证精确版本全局安装和无版本 `npx @michelj/context-guard install`。

## 一次性配置

复用已有 npm Trusted Publisher；本地 npm 登录不是正常发布前提。新建或修复绑定时填写：

```text
Organization or user: Michel-Johnson
Repository: Context-Guard-Skill
Workflow filename: npm-publish.yml
Environment: 留空
Allowed actions: npm publish
```

验证 OIDC 后设 Publishing access 为 **Require two-factor authentication and disallow tokens**。main 要求 PR、唯一 `Required`，禁止强推和删除；`v*` 仅管理员可创建、更新或删除。不改工作流文件名破坏 Publisher 绑定。

## 正常发布

1. 依次运行 `npm ci --ignore-scripts`、`npm run build:runtime`、`npm run test:cd`。
2. 通过 PR 更新稳定版本，等待 Required 并合入 main。
3. 在该 main 提交创建、推送 `vX.Y.Z`。
4. 等待 **CD | npm 发布** 完成，再核 `npm view @michelj/context-guard@X.Y.Z version` 和 `npm view @michelj/context-guard@latest version`。

## 失败与恢复

### npm 发布前

临时 GitHub/npm 故障重跑原失败 run，复用不可变标签源码。代码、元数据或打包错误则修复 main，升新 patch，创建新标签；不移动或删除旧标签。

### npm 发布后

npm 版本不可覆盖，不重新发布同一版本：

1. `npm view @michelj/context-guard@X.Y.Z --json` 核精确版本。
2. 包正确但 latest 错：`npm dist-tag add @michelj/context-guard@X.Y.Z latest`。
3. 包有缺陷：`npm deprecate @michelj/context-guard@X.Y.Z "Use X.Y.Z+1"`，将 latest 指回已知可用版，再发新 patch。
4. 不默认 `npm unpublish`，已有用户和 lockfile 可能依赖旧版。

Trusted Publishing 只认证 `npm publish`；dist-tag / deprecate 由维护者另行登录并满足 2FA。成功测试临时产物和失败证据按 RULE 处理。
