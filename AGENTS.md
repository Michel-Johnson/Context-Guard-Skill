# This repository

Product vs test branches. Full playbook: `.codex/context/tasks/J2.md`.

- **Product / main**: workbench, skill, product scripts, and approved CI/CD automation. Keep `tests/ci-smoke.mjs` and `.github/`; exclude them from the npm package through `package.json.files` and the package contract.
- **Temporary test branch** (`cursor/test-layout-f54e`): merge product in, change only `tests/`. Fake repos live in `tests/eval/`; do not merge temporary tests or fake repos back into main.
- Bugs found while testing: fix on the product branch, then merge product back into test.

```bash
git config core.hooksPath .githooks
```
