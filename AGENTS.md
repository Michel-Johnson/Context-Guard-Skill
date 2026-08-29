# This repository

Product vs test branches. Full playbook: `.codex/context/tasks/J2.md`.

- **Product / main**: workbench, skill, product scripts. No tests, no fake repos.
- **Test branch** (`cursor/test-layout-f54e`): merge product in, change only `tests/`. Fake repos live in `tests/eval/`.
- Bugs found while testing: fix on the product branch, then merge product back into test.

```bash
git config core.hooksPath .githooks
```
