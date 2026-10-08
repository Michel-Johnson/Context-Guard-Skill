# 本仓库开发说明

读者：**仓库开发 Agent**。开始任务先读 [当前开发方向](docs/current-focus.md)，再读 `RULE.md`；怎样才算通过见 `docs/ci.md`。当前存储设计为 [`fs-v2.1`](references/design/design-memory-current-v1.0.1.md)。

当前只投入 Map、**本机对话型** Coordinator、跨客户端 Skill + hooks。Cloud 自动派发等链路暂缓；当前已授权的两仓库边界迁移允许修改 Cloud 构建与依赖，不恢复自动派发。`CI_todo.md` 的历史记录不构成继续开发旧链路的授权。

- **推广网站**：源码和构建依赖放在 `website` 分支，见 `docs/website.md`。产品前端与 `docs/design/` 保留在 main。
- **临时测试分支**（`cursor/test-layout-f54e`）：从产品分支合入变更，只修改 `tests/`。模拟仓库放在 `tests/eval/`；不得将临时测试或模拟仓库合回 main。
- 测试发现的 Bug 应在产品分支修复，再将修复合入测试分支。

源码归属见 [仓库边界设计](references/design/design-repository-v1.0.0.md)：共享核心和 UI 在 Skill；Cloud 固定版本使用，不维护第二份。
