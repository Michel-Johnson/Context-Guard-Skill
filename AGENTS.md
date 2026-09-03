# This repository

动手前先读仓库根目录的 `RULE.md` 和 `CI_todo.md`。

Product vs test branches and security checks: `docs/development-security.md`.

- **Product / main**: workbench, skill, product scripts, and approved CI/CD automation. Keep `tests/ci-smoke.mjs` and `.github/`; exclude them from the npm package through `package.json.files` and the package contract.
- **Temporary test branch** (`cursor/test-layout-f54e`): merge product in, change only `tests/`. Fake repos live in `tests/eval/`; do not merge temporary tests or fake repos back into main.
- Bugs found while testing: fix on the product branch, then merge product back into test.

```bash
npm run dev:setup
```

All `.codex/` records stay out of Git commits and distribution artifacts.
This repository uses the user-designated private server as the authority for all
development memory; read `references/server-memory.md` before memory-dependent
work. Local context is only a versioned cache or unsynced draft. Keep Session
memory separate from the server's committed-main baseline; never silently fall
back to stale local memory. Connection details stay in the untracked local handoff
file named by `RULE.md`. Server-memory implementation and migration are still
pending in `CI_todo.md`; do not claim they are operational.
Preserve local files when removing them from tracking. Run `npm test` before
delivery. Never bypass a secret finding or replace an existing user hook without
explicit review.
