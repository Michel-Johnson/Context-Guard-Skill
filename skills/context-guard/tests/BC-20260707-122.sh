#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-add-approved-bypass.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

SCRIPT="/Users/bytedance/.agents/skills/context-guard/scripts/context_guard.py"
OUT="$ROOT/out.txt"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

set +e
python3 "$SCRIPT" feature-chain-add \
  --root "$ROOT" \
  --title "GPU 监控按钮" \
  --entry "点击 GPU 监控按钮" \
  --exit-check "打开监控页" \
  --command-text "printf 'CG_CHECKPOINT:后端返回监控 URL:PASS\n'" \
  --test-status approved >"$OUT" 2>&1
STATUS=$?
set -e

test "$STATUS" -ne 0
grep -q "feature-chain-add cannot create approved every-dev-completion chains" "$OUT"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" <<'PY'
from pathlib import Path
import json
import sys
path = Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"chains": []}
assert data["chains"] == [], data
PY

python3 "$SCRIPT" feature-chain-add \
  --root "$ROOT" \
  --title "GPU 监控按钮" \
  --entry "点击 GPU 监控按钮" \
  --exit-check "打开监控页" >"$OUT"
grep -q "feature chain:" "$OUT"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" <<'PY'
import json
import sys
chain = json.load(open(sys.argv[1], encoding="utf-8"))["chains"][0]
assert chain["status"] == "proposed", chain
assert chain["command"] == "", chain
PY
