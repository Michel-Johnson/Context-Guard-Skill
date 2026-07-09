#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-approved-tests-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" set-language --language zh --root "$ROOT" >/dev/null

CTX="$ROOT/.codex/context"
cat > "$CTX/roadmap.md" <<'MD'
# Context Roadmap

## Nodes

### NODE-20260701-001: 主线阶段

- Date: 2026-07-01
- Status: done
- Level: major
- Branch: Main
- Display title: 主线阶段
- Outcome: 主线阶段完成。
- Linked bad cases: BC-20260701-001

### NODE-20260701-002: 支线阶段

- Date: 2026-07-01
- Status: done
- Level: major
- Branch: 支线
- Parent: NODE-20260701-001
- Display title: 支线阶段
- Outcome: 支线阶段完成。
- Linked bad cases: BC-20260701-002
MD

cat > "$CTX/bad-cases.md" <<'MD'
# Bad Case Register

### BC-20260701-001: 普通 bad case guard 不应显示为测试
- Status: resolved
- Roadmap nodes: NODE-20260701-001
- Tags: #roadmap-ux
- Phenomenon: 普通 bad case guard 被误当成用户测试。
- Guard / verification: 这是普通复发检查，不是用户批准测试。

### BC-20260701-002: 用户批准测试也不应显示在概览
- Status: resolved
- Roadmap nodes: NODE-20260701-002
- Tags: #roadmap-ux
- Phenomenon: 用户批准的测试不应在路线图概览下方形成第二行卡片。
- Guard / verification: 运行用户确认的测试。
- Run policy: every-dev-completion
MD

python3 "$SCRIPT" show-roadmap --root "$ROOT" >/dev/null
HTML="$CTX/roadmap/roadmap.html"
BODY="$(python3 - "$HTML" <<'PY'
from pathlib import Path
import sys
html = Path(sys.argv[1]).read_text()
print(html.split("</style>", 1)[1])
PY
)"

python3 - <<'PY' "$HTML"
from pathlib import Path
import sys
import re
html = Path(sys.argv[1]).read_text()
body = html.split("</style>", 1)[1]
notes = re.findall(r'<a class="route-test-note"[^>]*>(.*?)</a>', body, re.S)
joined = "\n".join(notes)
if "普通 bad case guard 不应显示为测试" in joined:
    raise SystemExit("ordinary linked bad-case guard appeared as a test route item")
if "用户批准测试也不应显示在概览" in joined:
    raise SystemExit("approved test appeared as a compact overview route item")
if notes:
    raise SystemExit(f"overview should not render compact route test notes, got {len(notes)}")
if 'class="route-test-line' in body:
    raise SystemExit("overview should not render compact route test line containers")
PY
