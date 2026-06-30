#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-hidden-details-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" set-language --language zh --root "$ROOT" >/dev/null

CTX="$ROOT/.codex/context"
cat > "$CTX/roadmap.md" <<'MD'
# Context Roadmap

## Nodes

### NODE-20260626-001: 可点击路线节点

- Date: 2026-06-26
- Status: done
- Level: major
- Branch: Main
- Parent: none
- Outcome: 这个节点的详细概括只能在点击节点后显示，不能默认铺在 roadmap 下方。
- Next: none
- Linked bad cases: none
MD

python3 "$SCRIPT" show-roadmap --root "$ROOT" >/dev/null
HTML="$CTX/roadmap/roadmap.html"

grep -q '<a class="lane-link" href="#node-1">' "$HTML"
grep -q '<section class="inline-details" hidden data-inline-details' "$HTML"
grep -q 'function setupInlineDetails()' "$HTML"
grep -q 'class="detail-card" id="node-1"' "$HTML"

if grep -q '<section class="inline-details" aria-label="Roadmap details">' "$HTML"; then
  echo "inline details are visible by default" >&2
  exit 1
fi
