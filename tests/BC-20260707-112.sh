#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-bc-query-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/out.txt"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
cat >"$ROOT/.codex/context/bad-cases.md" <<'MD'
# Bad Case Register

### BC-20260707-112: GPU 监控点击没有打开页面

- Status: resolved
- Tags: #gpu #grafana #ui
- Display summary: 点击 GPU 监控按钮后，前端没有打开包含 grafana_url 的监控页。
- Phenomenon: 用户点击 GPU 监控后页面卡住，或者跳转 URL 为空。
- Trigger / reproduction: job payload 缺少 grafana_url，前端仍把它当成可打开的监控入口。
- Root cause: 前端把 job 数据当成 GPU URL 的唯一来源，没有检查后端返回值是否有效。
MD

ADD_OUTPUT="$(python3 "$SCRIPT" feature-chain-add \
  --root "$ROOT" \
  --title "GPU 监控按钮" \
  --entry "点击 GPU 监控按钮" \
  --exit-check "打开包含有效 grafana_url 的监控页")"
CHAIN_ID="$(printf '%s\n' "$ADD_OUTPUT" | sed -n 's/.*feature chain: //p')"

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "前端打开 Grafana 监控页" \
  --bad-case "BC-20260707-000" \
  --check "点击后进入 grafana_url 页面" >/dev/null

BEFORE="$(cat "$ROOT/.codex/context/test-hub/feature-chains.json")"
python3 "$SCRIPT" feature-chain-suggest --root "$ROOT" --query "BC-20260707-112" >"$OUT"
AFTER="$(cat "$ROOT/.codex/context/test-hub/feature-chains.json")"

grep -q "query expanded from bad-case register: BC-20260707-112 GPU 监控点击没有打开页面" "$OUT"
grep -q "$CHAIN_ID" "$OUT"
grep -q "GPU 监控按钮" "$OUT"
grep -q "checkpoint candidate: 前端打开 Grafana 监控页" "$OUT"
test "$BEFORE" = "$AFTER"
