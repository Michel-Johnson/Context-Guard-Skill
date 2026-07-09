#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-pending-feature-chain-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/propose.out"
APPROVE_ERR="$ROOT/approve.err"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "Markdown 公式预览" \
  --entry "编辑器输入 Markdown" \
  --exit-check "预览正确渲染" \
  --node-title "公式渲染回归" \
  --check "单行、多行和矩阵公式都被 MathJax 正常排版" \
  --coverage-pending-reason "用户先确认功能测试，后续遇到 bad case 再挂到 checkpoint" >"$OUT"

grep -q "feature chain proposed:" "$OUT"
grep -q "status: proposed; this chain is not executable" "$OUT"
grep -q "checkpoint: 公式渲染回归 | coverage pending" "$OUT"
grep -q "coverage pending reason: 用户先确认功能测试" "$OUT"

CHAIN_ID="$(grep 'feature chain proposed:' "$OUT" | awk '{print $NF}')"
test -n "$CHAIN_ID"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" "$CHAIN_ID" <<'PY'
from pathlib import Path
import json
import sys

path = Path(sys.argv[1])
chain_id = sys.argv[2]
data = json.loads(path.read_text(encoding="utf-8"))
chains = data.get("chains", [])
assert len(chains) == 1, data
chain = chains[0]
assert chain["id"] == chain_id, chain
assert chain["status"] == "proposed", chain
assert chain["type"] == "manual", chain
assert chain["command"] == "", chain
node = chain["nodes"][0]
assert node["title"] == "公式渲染回归", node
assert node["bad_cases"] == [], node
assert "用户先确认功能测试" in node["coverage_pending_reason"], node
PY

if python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --command-text "printf 'CG_CHECKPOINT:公式渲染回归:PASS\n'" 2>"$APPROVE_ERR"; then
  cat "$APPROVE_ERR"
  exit 1
fi
grep -q "requires a checkpoint with check text and linked bad-case coverage" "$APPROVE_ERR"

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$ROOT/dev-complete.out"
grep -q "no approved every-dev-completion tests" "$ROOT/dev-complete.out"

python3 "$SCRIPT" validate-feature-chains --root "$ROOT" >"$ROOT/validate.out"
grep -q "feature-chain validation passed: 1 chain" "$ROOT/validate.out"
grep -q "pending bad-case coverage" "$ROOT/validate.out"
