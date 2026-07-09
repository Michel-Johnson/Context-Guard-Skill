#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-list-policy-XXXXXX")"
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
  --bad-case "BC-20260707-108" \
  --check "grafana_url 不为空" >/dev/null

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "前端打开监控页" \
  --bad-case "BC-20260707-108" \
  --check "点击后进入监控页" >/dev/null

python3 "$SCRIPT" feature-chain-set-checkpoint \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "前端打开监控页" \
  --required optional \
  --reason "浏览器环境才运行" >/dev/null

python3 "$SCRIPT" feature-chain-list --root "$ROOT" >"$OUT"
grep -q "2 node(s), 1 required, 1 optional" "$OUT"
if grep -q "checkpoint:" "$OUT"; then
  cat "$OUT"
  exit 1
fi

python3 "$SCRIPT" feature-chain-list --root "$ROOT" --verbose >"$OUT"
grep -q "2 node(s), 1 required, 1 optional" "$OUT"
grep -q "checkpoint: 后端返回监控 URL | required" "$OUT"
grep -q "checkpoint: 前端打开监控页 | optional | reason: 浏览器环境才运行" "$OUT"
