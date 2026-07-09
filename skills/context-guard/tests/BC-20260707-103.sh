#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-policy-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/out.txt"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
ADD_OUTPUT="$(python3 "$SCRIPT" feature-chain-add \
  --root "$ROOT" \
  --title "GPU 监控按钮" \
  --entry "点击 GPU 监控按钮" \
  --exit-check "打开包含有效 grafana_url 的监控页")"
CHAIN_ID="$(printf '%s\n' "$ADD_OUTPUT" | sed -n 's/.*feature chain: //p')"

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "后端返回监控 URL" \
  --bad-case "BC-20260707-103" \
  --check "grafana_url 不为空" >/dev/null

python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --command-text "printf 'CG_CHECKPOINT:后端返回监控 URL:PASS\n'" >/dev/null

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$OUT"
grep -q "1 passed, 0 failed, 0 blocked" "$OUT"

python3 "$SCRIPT" feature-chain-set-policy \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --run-policy "relevant-only" \
  --reason "用户要求只在修改 GPU 监控流程时运行" >"$OUT"
grep -q "feature chain policy updated" "$OUT"

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
assert chain["run_policy"] == "relevant-only"
assert "GPU 监控" in chain["policy_reason"]
PY

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$OUT"
grep -q "no approved every-dev-completion tests" "$OUT"
if grep -q "后端返回监控 URL" "$OUT"; then
  cat "$OUT"
  exit 1
fi
