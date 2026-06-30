#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-readable-map-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" set-language --language zh --root "$ROOT" >/dev/null

CTX="$ROOT/.codex/context"
cat > "$CTX/roadmap.md" <<'MD'
# Context Roadmap

## Nodes

### NODE-20260626-001: 主线起点

- Date: 2026-06-26
- Status: done
- Level: major
- Branch: Main
- Parent: none
- Outcome: 这是一段很长的主线摘要，过去会直接显示在多路线概览卡片里，让路线图看起来像卡片墙而不是路线骨架。
- Next: none
- Linked bad cases: none

### NODE-20260626-002: 支线入口

- Date: 2026-06-26
- Status: done
- Level: major
- Branch: 可读性支线
- Parent: NODE-20260626-001
- Outcome: 这是一段很长的支线摘要，应该留在详情里，而不是占据概览卡片的主要视觉空间。
- Next: none
- Linked bad cases: none
MD

python3 "$SCRIPT" show-roadmap --root "$ROOT" >/dev/null
HTML="$CTX/roadmap/roadmap.html"

grep -q 'class="route-stack branch-map"' "$HTML"
grep -q '.track-grid.route-only {' "$HTML"
grep -q 'grid-auto-columns: minmax(180px, 230px);' "$HTML"
grep -q '.branch-map .summary {' "$HTML"
grep -q 'display: none;' "$HTML"
grep -q -- '-webkit-line-clamp: 3;' "$HTML"
