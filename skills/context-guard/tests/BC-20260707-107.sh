#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-checkpoint-policy-XXXXXX")"
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
  --bad-case "BC-20260707-107" \
  --check "grafana_url 不为空" >/dev/null

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "前端打开监控页" \
  --bad-case "BC-20260707-107" \
  --check "点击后进入监控页" >/dev/null

python3 "$SCRIPT" feature-chain-set-checkpoint \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "前端打开监控页" \
  --required optional \
  --reason "浏览器环境才运行" >/dev/null

python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --command-text "printf 'CG_CHECKPOINT:后端返回监控 URL:PASS\n'" >/dev/null

python3 "$SCRIPT" validate-feature-chains --root "$ROOT" >"$OUT"
grep -q "feature-chain validation passed" "$OUT"

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$OUT"
grep -q "1 passed, 0 failed, 0 blocked" "$OUT"
grep -q "success artifacts cleaned" "$OUT"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" <<'PY'
from pathlib import Path
import json
import sys

chain = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["chains"][0]
nodes = {node["title"]: node for node in chain["nodes"]}
optional = nodes["前端打开监控页"]
assert optional["required"] is False
assert optional["optional"] is True
assert optional["optional_reason"] == "浏览器环境才运行"
PY

python3 "$SCRIPT" feature-chain-set-checkpoint \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "前端打开监控页" \
  --required required \
  --reason "用户要求恢复每次运行" >/dev/null

if python3 "$SCRIPT" dev-complete --root "$ROOT" >"$OUT" 2>&1; then
  cat "$OUT"
  exit 1
fi
grep -q "missing checkpoint marker: 前端打开监控页" "$OUT"
