# Development and release security

## What stays out of Git and releases

The entire `.codex/` tree, output, caches, real environment files, private keys
and credential files do not belong in source commits or npm packages. Keep public
templates and empty `.env.example` files only; examples are still scanned for
secrets. Do not copy private memory into another tracked directory or publish it
as PR/CI attachments. Necessary product documentation and verification summaries
remain allowed.

This repository's development memory is governed by
[`references/server-memory.md`](../references/server-memory.md): the private
server is its authority, while local records are caches or pending drafts. This
does not permit uploading credentials or machine runtime state as memory. Server
reads and writes both need authorization; public read-only access is not private.
Connection details stay out of public source. The private memory backend/client
has local automated acceptance, while deployment, native Hook trust verification,
and historical migration remain pending in `CI_todo.md`; current Map sync alone
is insufficient.

Product branches retain approved `.github/` checks and the explicitly listed
cross-platform product tests in `scripts/branch_guard.py`. Temporary experiments,
fixtures, and fake repositories still belong only on the test branch.
The formal test inventory itself is `tests/test-manifest.json` and is approved as
product CI metadata; adding an executable test still requires the explicit branch
guard entry where applicable.
Temporary tests and fake repositories remain on `cursor/test-layout-f54e`; do not
merge them into main. Product fixes belong on product branches. The existing
`scripts/branch_guard.py` remains part of pre-commit validation.

Removing tracked records is NOT a disk cleanup. Before applying the removal on
an older checkout, back up `.codex` outside Git-tracked content, verify the backup,
and restore local records after updating if needed. Old commits, tags, PR refs,
forks and downloads still retain historical data. Coordinate migration of other
branches; never reset a dirty worktree to make the removal easier.

## One-time developer setup

Requirements: Node >= 18, Python >= 3.9, Git and tar (included with modern Windows).

```sh
npm run dev:setup
npm run hooks:status
npm test
```

Setup downloads Gitleaks 8.30.1 from its official GitHub release and verifies the
platform archive against a pinned SHA-256. It installs only into ignored
`.security-tools/`; it does not globally install a package. The repository-local
hooksPath points to this checkout's `.githooks` using an absolute path so sibling
worktrees cannot silently lose the check on old branches. Keep that checkout
available; rerun setup after relocating it. Setup refuses unrelated custom hooks
rather than overwriting them. Integrate custom hooks explicitly if refusal occurs.

Consumer `npm install` / `npx` does not install developer hooks or the scanner.
Normal Skill creation of a user's local `.codex/context` remains unchanged.

## Post-merge local acceptance

A Context Guard product PR is not delivered merely because GitHub merged it.
The implementing Agent must immediately fetch the merged `origin/main`, update
the local global Skill from a checkout containing that merge, and prove that the
installed Skill/runtime matches the merged source. Then run `context-guard doctor`
and repeat the feature-specific acceptance through the installed entry point,
not the development checkout. Record the main merge commit, install source,
version/hash comparison, and runtime output. An explicit request to implement or
merge already authorizes these normal delivery steps; do not ask again. Native
Hook trust is still a host security boundary: report it when pending and never
use a dangerous trust bypass.

## When checks run

| Stage | Input | Result |
| --- | --- | --- |
| pre-commit | Actual index snapshot, then existing branch policy | Reject private paths or detected secrets |
| pre-push | Each outgoing head and its commit range | Catch secrets added then removed before push |
| CI | Checked-out tree and push/PR commit range | Security must succeed for Required |
| CI/CD package | Exact tarball, safely extracted | Reject unexpected files or secret content before artifact upload |

First pushes compare to a known main merge base where possible, otherwise scan
the head's full history. Missing objects, shallow history, scanner failure and
timeouts fail closed. Source scans include tracked documentation and test code;
there are no directory-wide secret exemptions. `gitleaks:allow` comments and
unreviewed fingerprint ignores cannot suppress a result through this wrapper.

Outgoing commit history is also checked for newly added private paths, even if
removed in a later commit. For a full-history first push, the repository's known
pre-migration commit `011682f7b640a7db3cf2ab1c9b6e01674266c0e4` is the legacy PATH
boundary only. It does not exempt any secret content from scanning, and does not
claim the records in older public commits have been removed.

The final package must match `.github/scripts/package-contract.mjs`, contain only
regular files and remain byte-identical during scanning. Existing artifact hashes
preserve the same package through installation tests and npm publication. CD
continues to run on version tags and uses OIDC; no long-lived npm token is added.

## Investigating a block

The wrapper never prints raw scanner stdout/stderr, matching source lines, secret
values or file paths (paths may themselves contain secrets). Findings contain a
rule, line number, commit ID when known, and a file ID: first 16 hexadecimal digits
of SHA-256 of the scan-root-relative file path using `/`. Resolve IDs against candidate paths locally;
do not upload original files or unredacted reports to Actions or issue comments.

Run `npm run security:staged` to recheck the index. `npm run security:audit` scans
all locally available branch/tag history; fetch intended refs first and record
coverage. A clean scan means no patterns were detected, not a proof of no secrets.
Rotate/revoke a confirmed leaked credential before separately planning history
cleanup. Do not add broad baselines or delete suspect content silently to publish.

## Limits and evidence

Git ignore rules only affect untracked files. Hooks can be bypassed and are not
server-side access control; CI runs after the GitHub upload. Keep GitHub secret
scanning/push protection enabled. This does not control cloud drives or other
applications. Historical removal/force pushes require separate authorization.

`npm run security:test` covers clean and rejected staged content, historical
secrets, actual hooks, safe archive handling and sanitized output using synthetic
credentials generated at runtime. It is also part of `npm test`; successful tests
clean their own temporary directory. Failures retain only synthetic test evidence.
`npm run test:cd` exercises the existing release rehearsal with the same package
security gate, without publishing. Never upload a deliberately unsafe test package.

## 中文速查

- 首次开发运行 `npm run dev:setup`，用 `npm run hooks:status` 确认已启用。
- 提交前检查暂存区；推送前检查提交历史；CI 决定可否合并；CD 检查最终包后才上传。
- 整个 `.codex/` 不进 Git 或分发产物；开发记忆以私有服务器为准，本地仅缓存/待同步。凭据和本机运行状态不作为记忆上传；迁移前保留本地文件，历史不会自动清除。
- 正式测试留在源码仓库、不进 npm；普通用户安装不带扫描器或开发 hooks。
- 命中后停止并修复，不绕过、不输出原密钥；误报只接受精确、经审查的规则调整。
