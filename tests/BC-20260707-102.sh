#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-approve-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/out.txt"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
ADD_OUTPUT="$(python3 "$SCRIPT" feature-chain-add \
  --root "$ROOT" \
  --title "Markdown 公式预览" \
  --entry "用户输入 Markdown 公式" \
  --exit-check "预览区显示 MathJax 渲染结果")"
CHAIN_ID="$(printf '%s\n' "$ADD_OUTPUT" | sed -n 's/.*feature chain: //p')"

if python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --command-text "printf 'ok\n'" >"$OUT" 2>&1; then
  cat "$OUT"
  exit 1
fi
grep -q "requires at least one checkpoint" "$OUT"

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "MathJax 渲染完成" \
  --bad-case "BC-20260707-102" \
  --check "预览区包含渲染后的公式且没有空白" >/dev/null

if python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" >"$OUT" 2>&1; then
  cat "$OUT"
  exit 1
fi
grep -q "requires --command-text" "$OUT"

python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --command-text "printf 'CG_CHECKPOINT:MathJax 渲染完成:PASS\n'" >"$OUT"
grep -q "feature chain approved" "$OUT"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" "$CHAIN_ID" <<'PY'
from pathlib import Path
import json
import sys

chain = next(
    item
    for item in json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["chains"]
    if item["id"] == sys.argv[2]
)
assert chain["status"] == "approved"
assert chain["run_policy"] == "every-dev-completion"
assert chain["type"] == "command"
assert "CG_CHECKPOINT:MathJax 渲染完成:PASS" in chain["command"]
PY

python3 "$SCRIPT" validate-feature-chains --root "$ROOT" >"$OUT"
grep -q "feature-chain validation passed: 1 chain(s), 0 warning(s)" "$OUT"

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$OUT"
grep -q "1 passed, 0 failed, 0 blocked" "$OUT"
grep -q "success artifacts cleaned" "$OUT"
