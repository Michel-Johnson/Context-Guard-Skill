# This repository

读者：**仓库开发 Agent**。规则见 `RULE.md`。怎样才算通过见 `docs/ci.md`。

- **Promotion website**: source and build dependencies live on `website`; see `docs/website.md`. Keep the product frontend and `docs/design/` on main.
- **Temporary test branch** (`cursor/test-layout-f54e`): merge product in, change only `tests/`. Fake repos live in `tests/eval/`; do not merge temporary tests or fake repos back into main.
- Bugs found while testing: fix on the product branch, then merge product back into test.
