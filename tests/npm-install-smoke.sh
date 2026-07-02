#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-npm-install-XXXXXX")"
ROOT="$(cd "$ROOT" && pwd)"
trap 'rm -rf "$ROOT"' EXIT
NODE_BIN="${NODE:-node}"

"$NODE_BIN" bin/context-guard-skill.js --help >/dev/null
"$NODE_BIN" bin/context-guard-skill.js install --target "$ROOT/skill" >/dev/null

test -f "$ROOT/skill/SKILL.md"
test -f "$ROOT/skill/scripts/context_guard.py"
test -f "$ROOT/skill/README.zh-CN.md"

CODEX_HOME="$ROOT/codex-home" "$NODE_BIN" bin/context-guard-skill.js install >/dev/null
test -f "$ROOT/codex-home/skills/context-guard/SKILL.md"

npm_config_global=true CODEX_HOME="$ROOT/global-codex-home" "$NODE_BIN" bin/postinstall.js >/dev/null
test -f "$ROOT/global-codex-home/skills/context-guard/SKILL.md"

PROJECT="$ROOT/project"
"$NODE_BIN" bin/context-guard-skill.js init --root "$PROJECT" >/dev/null
test -f "$PROJECT/.codex/context/index.md"

HOOKS="$ROOT/hooks.json"
"$NODE_BIN" bin/context-guard-skill.js install --target "$ROOT/skill-with-hooks" --with-hooks --hooks-target "$HOOKS" >/dev/null
grep -Fq "$ROOT/skill-with-hooks/scripts/context_guard_hook.py" "$HOOKS"
