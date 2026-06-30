#!/usr/bin/env bash
set -euo pipefail

SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$SKILL_ROOT/scripts/context_guard.py"
HOOK="$SKILL_ROOT/scripts/context_guard_hook.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-root-selection-XXXXXX")"
ROOT="$(cd "$ROOT" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT/project"
git -C "$ROOT/project" init --quiet >/dev/null

if (cd "$SKILL_ROOT" && python3 "$SCRIPT" show-roadmap >/tmp/context-guard-implicit-skill-root.out 2>&1); then
  echo "show-roadmap unexpectedly accepted the skill directory as implicit project root" >&2
  exit 1
fi
grep -q 'refusing to use the Context Guard skill directory' /tmp/context-guard-implicit-skill-root.out

rm -rf "$SKILL_ROOT/.codex"
printf '{"cwd":"%s/project","prompt":"show roadmap"}' "$ROOT" | (
  cd "$SKILL_ROOT"
  python3 "$HOOK" session-start
) >/tmp/context-guard-hook-root.out

test -f "$ROOT/project/.codex/context/index.md"
test -f "$ROOT/project/.codex/context/roadmap.md"
if test -e "$SKILL_ROOT/.codex/context/roadmap.md"; then
  echo "hook wrote project context into the skill directory" >&2
  exit 1
fi
grep -q "$ROOT/project/.codex/context" /tmp/context-guard-hook-root.out
