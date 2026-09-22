# This repository

读者：**仓库开发 Agent**。动手前先读 `RULE.md`、`CI_todo.md` 和 [当前设计版本](references/design-current.md)（`fs-v2`）。

End-to-end development flow and evidence: `docs/engineering/README.md`.

Product vs test branches and security checks: `docs/ci.md`.

- **Product / main**: workbench, skill, product scripts, and approved CI/CD automation. Keep `tests/ci-smoke.mjs` and `.github/`; exclude them from the npm package through `package.json.files` and the package contract.
- **Temporary test branch** (`cursor/test-layout-f54e`): merge product in, change only `tests/`. Fake repos live in `tests/eval/`; do not merge temporary tests or fake repos back into main.
- Bugs found while testing: fix on the product branch, then merge product back into test.

```bash
npm run dev:setup
```

All `.codex/` records stay out of Git commits and distribution artifacts.
This repository uses the user-designated private server as the authority for
**this repo's** development memory. Product memory law lives in
`references/server-memory.md` and `references/design-current.md`. Local context
is only a versioned cache or unsynced draft. Connection details stay in the
untracked local handoff file named by `RULE.md`. Historical evidence in
`CI_todo.md` does not prove current operation. Preserve local files when
removing them from tracking. Run `npm test` before delivery. Never bypass a
secret finding or replace an existing user hook without explicit review.
