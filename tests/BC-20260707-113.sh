#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-coverage-suggest-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/out.txt"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
cat >"$ROOT/.codex/context/bad-cases.md" <<'MD'
# Bad Case Register

### BC-20260707-113: GPU 监控点击没有打开 Grafana 页面

- Status: resolved
- Tags: #gpu #grafana #ui
- Display summary: 点击 GPU 监控按钮后，前端没有打开包含 grafana_url 的监控页。
- Phenomenon: 用户点击 GPU 监控后页面卡住，或者跳转 URL 为空。
- Trigger / reproduction: job payload 缺少 grafana_url，前端仍把它当成可打开的监控入口。

### BC-20260707-114: 后端返回监控 URL 为空

- Status: resolved
- Tags: #gpu #backend
- Display summary: 后端没有给 GPU 监控按钮返回 grafana_url。

### BC-20260707-115: Worker keepalive 状态丢失

- Status: resolved
- Tags: #worker #lifecycle
- Display summary: 空闲 worker 没有进入 keepalive_running。
MD

ADD_OUTPUT="$(python3 "$SCRIPT" feature-chain-add \
  --root "$ROOT" \
  --title "GPU 监控按钮" \
  --entry "点击 GPU 监控按钮" \
  --exit-check "打开包含有效 grafana_url 的 Grafana 监控页")"
CHAIN_ID="$(printf '%s\n' "$ADD_OUTPUT" | sed -n 's/.*feature chain: //p')"

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "后端返回监控 URL" \
  --bad-case "BC-20260707-114" \
  --check "grafana_url 不为空" >/dev/null

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "前端打开 Grafana 监控页" \
  --bad-case "BC-20260707-000" \
  --check "点击后进入 grafana_url 页面" >/dev/null

BEFORE="$(cat "$ROOT/.codex/context/test-hub/feature-chains.json")"
python3 "$SCRIPT" feature-chain-coverage --root "$ROOT" >"$OUT"
AFTER="$(cat "$ROOT/.codex/context/test-hub/feature-chains.json")"

grep -q "covered by feature chains: 1" "$OUT"
grep -q "unassigned candidates: 2" "$OUT"
grep -q "candidate: BC-20260707-113 | GPU 监控点击没有打开 Grafana 页面" "$OUT"
grep -q "possible chain: $CHAIN_ID" "$OUT"
grep -q "possible checkpoint: 前端打开 Grafana 监控页" "$OUT"
grep -q "match evidence:" "$OUT"
grep -q "grafana" "$OUT"
grep -q "candidate: BC-20260707-115 | Worker keepalive 状态丢失" "$OUT"
if awk '/candidate: BC-20260707-115/{flag=1; next} flag && /possible chain/{exit 1} flag && /registry:/{exit 0}' "$OUT"; then
  :
else
  cat "$OUT"
  exit 1
fi
test "$BEFORE" = "$AFTER"
