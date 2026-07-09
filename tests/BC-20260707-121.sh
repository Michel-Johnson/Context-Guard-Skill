#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-approval-preflight.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

SCRIPT="/Users/bytedance/.agents/skills/context-guard/scripts/context_guard.py"
OUT="$ROOT/out.txt"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" set-language --root "$ROOT" --language zh >/dev/null

python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "Markdown 公式预览" \
  --entry "在编辑器输入公式" \
  --exit-check "预览区正确渲染公式" \
  --node-title "公式渲染完成" \
  --bad-cases "BC-TEST-001" \
  --check "确认公式进入渲染结果" >/dev/null

set +e
python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT" \
  --chain-id FC-20260707-001 \
  --command-text "true" >"$OUT" 2>&1
STATUS=$?
set -e

test "$STATUS" -ne 0
grep -q "approval dry-run failed" "$OUT"
grep -q "missing checkpoint marker: 公式渲染完成" "$OUT"
grep -q "requires a passing dry run before approval" "$OUT"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" <<'PY'
import json
import sys
chain = json.load(open(sys.argv[1], encoding="utf-8"))["chains"][0]
assert chain["status"] == "proposed", chain
assert chain["type"] == "manual", chain
assert chain["command"] == "", chain
PY

python3 "$SCRIPT" dev-complete --root "$ROOT" | grep -q "no approved every-dev-completion tests"
test -f "$ROOT/.codex/context/test-hub/last-approval-dry-run.json"

python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT" \
  --chain-id FC-20260707-001 \
  --command-text "printf 'CG_CHECKPOINT:公式渲染完成:PASS\n'" >"$OUT"

grep -q "feature chain approved" "$OUT"
grep -q "approval dry-run: passed" "$OUT"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" <<'PY'
import json
import sys
chain = json.load(open(sys.argv[1], encoding="utf-8"))["chains"][0]
assert chain["status"] == "approved", chain
assert chain["type"] == "command", chain
assert "CG_CHECKPOINT:公式渲染完成:PASS" in chain["command"], chain
PY

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$OUT"
grep -q "1 passed, 0 failed, 0 blocked" "$OUT"
grep -q "success artifacts cleaned" "$OUT"
