# 宣传站 QA

这份文件只记录当前有效的验收范围。旧版本的逐轮截图、资源哈希和修复过程保留在 Git 历史中，不再堆叠到当前文档。

## 自动检查

在 `site/` 目录运行：

```bash
npm run test:camera
node --experimental-strip-types --test scripts/client-timing.test.mjs scripts/native-camera.test.mjs
npm run build
```

当前基线：

- 镜头检查 7 项通过。
- 客户端时序与结构检查 8 项通过。
- TypeScript 检查和 Vite 生产构建通过。
- 根目录 `npm test` 通过，保证宣传站没有破坏产品、安装包和安全边界。

这些检查覆盖：

- 工作台六章连续播放、暂停、恢复、手动体验和减少动态。
- Codex App、Codex CLI、Cursor、Claude Code 的预设输入时序。
- 输入完成后的停顿、回复取景、Unicode 文本和不同采样频率。
- 页面顺序、工作台与客户端分屏、窄屏选择器和无横向溢出。
- 中英文工作台由同一产品 HTML 生成；宣传站不维护另一套产品界面。
- npm 包和 Agent Skill 不包含 `site/`。

## 产品边界

- 演示只使用预设数据，不会给真实 Agent 发消息，也不会修改用户项目。
- 工作台 iframe 禁止同源、文件系统、下载、弹窗和顶层导航；CSP 禁止外部连接。
- `scripts/prepare-workbench.mjs` 从产品工作台生成隔离副本，不直接改写 `prototype/workbench.html`。
- GitHub Pages 只发布 `site/dist`。是否已上线以 `Promotion site` Action 为准，不能从本地构建推断。

## 仍需人工验收

自动测试通过不代表以下项目已经完成：

- 在真实 DPR 1.25 和 DPR 2 屏幕上检查文字清晰度、边框和镜头停稳状态。
- 在真实浏览器后台、标签页隐藏、最小化和恢复场景中检查暂停与续播。
- 对照当前版本 Codex App、Cursor 和 Claude Code，检查未拍摄状态及像素差异。
- 在真实手机或触摸设备上检查滑动、点击和横向拖动；现有移动检查使用浏览器视口模拟。
- 人工感受长回复跟随、快速切章、叠化和低性能设备上的流畅度。

发现新问题时，先写可重复的正式测试；只能人工验证的项目保留在本节，不把临时脚本或截图当作 CI。

## 发布前清单

1. 运行上面的三条站点命令。
2. 在仓库根目录运行 `npm test`。
3. 确认普通构建未开启 QA 性能采样。
4. 确认 `site/dist` 不含 `.codex/`、真实会话、密钥或本机路径。
5. 合入 `main` 后查看 `Promotion site` Action 的实际部署结果。
