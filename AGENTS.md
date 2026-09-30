# This repository

读者：**仓库开发 Agent**。开始任务先读 [当前开发方向](docs/current-focus.md)，再读 `RULE.md`；怎样才算通过见 `docs/ci.md`。当前存储设计为 [`fs-v2.1`](references/design-current.md)。

当前只投入 Map、**本机对话型** Coordinator、跨客户端 Skill + hooks。Cloud 自动派发等链路暂缓；第 5 步前不改 Cloud 或自动派发。`CI_todo.md` 的历史记录不构成继续开发旧链路的授权。

- **Promotion website**: source and build dependencies live on `website`; see `docs/website.md`. Keep the product frontend and `docs/design/` on main.
- **Temporary test branch** (`cursor/test-layout-f54e`): merge product in, change only `tests/`. Fake repos live in `tests/eval/`; do not merge temporary tests or fake repos back into main.
- Bugs found while testing: fix on the product branch, then merge product back into test.
