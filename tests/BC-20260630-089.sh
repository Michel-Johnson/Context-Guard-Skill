#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-detail-summary-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" set-language --language zh --root "$ROOT" >/dev/null

CTX="$ROOT/.codex/context"
python3 "$SCRIPT" checkpoint-roadmap-node \
  --root "$ROOT" \
  --title "新增详情摘要字段并调整渲染优先级" \
  --display-title "节点详情读起来更顺" \
  --branch "Main" \
  --level major \
  --user-request "用户希望节点详情里的进度、问题案例和方法都读起来通顺。" \
  --progress-summary "已经让节点详情优先显示人类进度摘要，避免把 schema、CLI 和 HTML 投影说明直接展示给用户。" \
  --method-summary "把 agent 源字段和用户阅读字段分开；有摘要时优先显示摘要，没有摘要时才回退到旧字段。" \
  --outcome "roadmap node schema、CLI 和 HTML projection now support human-readable detail summaries." \
  --decision "The renderer used raw source fields, which sounded like implementation logs." \
  --linked-bad-cases "BC-20260630-089" >/dev/null

cat >> "$CTX/bad-cases.md" <<'EOF'

### BC-20260630-089: 节点详情字段拼接导致阅读不顺

- Status: resolved
- First observed: 2026-06-30
- Last checked: 2026-06-30
- Scope: roadmap details
- Roadmap nodes: NODE-20260630-001
- Tags: #roadmap-ux #readability
- Display summary: 详情页把实现记录直接展示出来，用户读起来像在看流水账。
- Phenomenon: User-facing detail sections reused roadmap outcome, decision, avoid, and bad-case phenomenon fields directly, creating stiff implementation prose.
- Fix method: Prefer human-written progress, method, and case display summaries before falling back to source fields.
- Guard / verification: Run this script and inspect node detail output.
EOF

python3 "$SCRIPT" show-roadmap --root "$ROOT" >/dev/null
DETAIL="$CTX/roadmap/roadmap-details.html"

grep -q -- "- Progress summary: 已经让节点详情优先显示人类进度摘要" "$CTX/roadmap.md"
grep -q -- "- Method summary: 把 agent 源字段和用户阅读字段分开" "$CTX/roadmap.md"
grep -q -- "- Display summary: 详情页把实现记录直接展示出来" "$CTX/bad-cases.md"

python3 - "$DETAIL" <<'PY'
from pathlib import Path
import re
import sys

html = Path(sys.argv[1]).read_text(encoding="utf-8")
card = re.search(r'<section class="detail-card" id="node-1">(?P<body>.*?)</section>\s*</div>\s*</section>', html, re.S)
assert card, "node detail card should exist"
body = card.group("body")
assert "已经让节点详情优先显示人类进度摘要" in body
assert "把 agent 源字段和用户阅读字段分开" in body
assert "详情页把实现记录直接展示出来，用户读起来像在看流水账" in body
assert "roadmap node schema、CLI 和 HTML projection" not in body
assert "The renderer used raw source fields" not in body
assert "User-facing detail sections reused" not in body
PY
