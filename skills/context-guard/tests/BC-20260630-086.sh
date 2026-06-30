#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-user-request-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" set-language --language zh --root "$ROOT" >/dev/null

CTX="$ROOT/.codex/context"
python3 "$SCRIPT" checkpoint-roadmap-node \
  --root "$ROOT" \
  --title "改善节点详情可读性" \
  --branch "Main" \
  --level major \
  --user-request "用户希望节点详情里的问题摘要直接来自用户输入，不要由 Codex 自由发挥。" \
  --outcome "节点详情页现在优先展示 User request 字段。" \
  --decision "这是内部实现决策，不应该冒充用户提出的问题。" \
  --next-step "继续保持用户问题摘要和实现复盘分离。" >/dev/null

python3 "$SCRIPT" show-roadmap --root "$ROOT" >/dev/null
DETAIL="$CTX/roadmap/roadmap-details.html"

grep -q -- "- User request: 用户希望节点详情里的问题摘要直接来自用户输入" "$CTX/roadmap.md"
grep -q "用户希望节点详情里的问题摘要直接来自用户输入，不要由 Codex 自由发挥" "$DETAIL"

python3 - "$DETAIL" <<'PY'
from pathlib import Path
import re
import sys

html = Path(sys.argv[1]).read_text(encoding="utf-8")
match = re.search(r'<h4>.*?用户提出的问题.*?</h4>\s*<div>(?P<body>.*?)</div>', html, re.S)
assert match, "user-question section should render"
body = match.group("body")
assert "用户希望节点详情里的问题摘要直接来自用户输入" in body
assert "内部实现决策" not in body
assert "Outcome" not in body
PY

python3 "$SCRIPT" checkpoint-roadmap-node \
  --root "$ROOT" \
  --title "历史节点没有用户请求字段" \
  --branch "Main" \
  --level major \
  --outcome "历史节点没有 User request 字段。" >/dev/null

python3 "$SCRIPT" show-roadmap --root "$ROOT" >/dev/null
grep -q "这个历史节点没有记录用户原始请求" "$DETAIL"
