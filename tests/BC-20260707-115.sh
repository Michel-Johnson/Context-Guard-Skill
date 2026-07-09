#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-plan-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
STRONG_OUT="$ROOT/strong.txt"
WEAK_OUT="$ROOT/weak.txt"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
cat >"$ROOT/.codex/context/bad-cases.md" <<'MD'
# Bad Case Register

### BC-20260707-115: GPU 监控点击没有打开 Grafana 页面

- Status: resolved
- Tags: #gpu #grafana #ui
- Display summary: 点击 GPU 监控按钮后，前端没有打开包含 grafana_url 的监控页。
- Phenomenon: 用户点击 GPU 监控后页面卡住，或者跳转 URL 为空。
- Trigger / reproduction: job payload 缺少 grafana_url，前端仍把它当成可打开的监控入口。

### BC-20260707-116: Worker keepalive 状态丢失

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
  --node-title "前端打开 Grafana 监控页" \
  --bad-case "BC-20260707-115" \
  --check "点击后进入 grafana_url 页面" >/dev/null

BEFORE="$(cat "$ROOT/.codex/context/test-hub/feature-chains.json")"
python3 "$SCRIPT" feature-chain-plan --root "$ROOT" --query "BC-20260707-115" >"$STRONG_OUT"
python3 "$SCRIPT" feature-chain-plan --root "$ROOT" --query "BC-20260707-116" >"$WEAK_OUT"
AFTER="$(cat "$ROOT/.codex/context/test-hub/feature-chains.json")"

grep -q "action: review-existing-chain" "$STRONG_OUT"
grep -q "chain: $CHAIN_ID" "$STRONG_OUT"
grep -q "checkpoint: 前端打开 Grafana 监控页" "$STRONG_OUT"
grep -q "match evidence:" "$STRONG_OUT"
grep -q "after-confirmation command: .*feature-chain-attach-bc" "$STRONG_OUT"
grep -q -- "--bad-case BC-20260707-115" "$STRONG_OUT"
grep -q "tighten checkpoint based on confirmed symptom" "$STRONG_OUT"
grep -q "next: if the user confirms the match" "$STRONG_OUT"

grep -q "action: propose-new-chain" "$WEAK_OUT"
grep -q "confirmation prompt: 测试创建识别" "$WEAK_OUT"
grep -q "Worker keepalive 状态丢失" "$WEAK_OUT"
grep -q "after-confirmation command: .*feature-chain-propose" "$WEAK_OUT"
grep -q "confirmed feature title" "$WEAK_OUT"
grep -q -- "--node-title 'Worker keepalive 状态丢失'" "$WEAK_OUT"
grep -q -- "--bad-cases BC-20260707-116" "$WEAK_OUT"
if grep -q "after-confirmation command: .*feature-chain-add" "$WEAK_OUT"; then
  cat "$WEAK_OUT"
  exit 1
fi
if grep -q "从「BC-20260707-116」相关入口" "$WEAK_OUT"; then
  cat "$WEAK_OUT"
  exit 1
fi
if grep -q "action: review-existing-chain" "$WEAK_OUT"; then
  cat "$WEAK_OUT"
  exit 1
fi

test "$BEFORE" = "$AFTER"
