# 宣传站分支

宣传站源码、字体、演示、锁文件和站点测试维护在 [website/site](https://github.com/Michel-Johnson/Context-Guard-Skill/tree/website/site)。main 保留产品工作台 `prototype/`、产品运行代码和 `docs/design/` 测试画廊。

## 构建依赖与维护

website 从 main `1cf1fb4e6fb41a4a53d8b6be1a2715ec359c719f` 创建，保留完整站点与所需源码快照。`site/scripts/prepare-workbench.mjs` 读取该分支的 `prototype/workbench.html`、`workbench.css`、`workbench-data.js` 和 `workbench-app.js`，嵌入本地字体、许可与站点合成数据。它不启动产品服务。

产品 UI 更新不会自动同步到 website。维护者须将这四个文件的相关产品改动带到 website，重新运行站点构建与测试；不要将 main 的站点删除提交合入 website。宣传站变更以 website 为目标，产品变更继续以 main 为目标。

```sh
# 在 website 分支
cd site
npm ci --ignore-scripts
npm run build
npm test
```

Node.js 要求为 22.12+，仅发布 `site/dist/`。main 的 `tests/fixtures/workbench-fixtures.js` 为产品浏览器测试独立保留的合成夹具，不是宣传站。

## 部署切换尚未完成

迁移检查时 GitHub Pages 的 `build_type` 为 `workflow`，`source.branch` 为 `main`，网址为 https://michel-johnson.github.io/Context-Guard-Skill/ 。原 `site-pages.yml` 在 main 变更时构建并部署，迁移 PR 将移除该 workflow。已有线上制品不随源码删除而重建；此结论不代表实际线上验收。

website 的 `Promotion site` workflow 在 push/PR 时只构建并测试，不自动部署。部署 job 仅接受 website 分支上显式手动选择 `deploy=true`；本次不调用它，不修改 Pages 设置或 `github-pages` 环境。

**合并迁移 PR 前**，只读检查确认 `github-pages` 环境使用自定义分支许可，当前仅允许 `main`。负责人须确认 website 的构建并授权调整该外部许可；获得生产切换授权后，手动运行 website 的部署并核对中英文页面、工作台示例及静态资源。未切换前保持 PR 为 Draft，避免失去 main 的自动更新入口。回退来源为上述 main 基线及已部署制品；未进行实际部署或回退演练。
