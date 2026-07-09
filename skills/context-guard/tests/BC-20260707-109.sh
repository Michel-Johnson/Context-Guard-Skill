#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-test-hub-feature-policy-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/out.txt"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" show-test-hub --root "$ROOT" >"$OUT"
HTML_PATH="$(tail -1 "$OUT")"
if grep -q "检查点策略" "$HTML_PATH"; then
  cat "$HTML_PATH"
  exit 1
fi

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
  --bad-case "BC-20260707-109" \
  --check "grafana_url 不为空" >/dev/null

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "前端打开监控页" \
  --bad-case "BC-20260707-109" \
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

python3 "$SCRIPT" show-test-hub --root "$ROOT" >"$OUT"
HTML_PATH="$(tail -1 "$OUT")"

grep -q "检查点策略：1 必跑 / 1 可选" "$HTML_PATH"
grep -q "后端返回监控 URL" "$HTML_PATH"
grep -q "前端打开监控页" "$HTML_PATH"
grep -q "浏览器环境才运行" "$HTML_PATH"
