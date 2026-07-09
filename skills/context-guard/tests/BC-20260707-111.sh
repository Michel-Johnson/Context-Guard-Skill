#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-coverage-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/out.txt"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
cat >"$ROOT/.codex/context/bad-cases.md" <<'MD'
# Bad Case Register

### BC-20260707-111: GPU 监控按钮没有打开

- Status: resolved
- Tags: #gpu #ui
- Display summary: 点击 GPU 监控后没有进入监控页。

### BC-20260707-112: 后端没有返回 grafana URL

- Status: resolved
- Tags: #gpu #backend
- Display summary: job payload 里缺少 grafana_url。

### BC-20260707-113: Worker keepalive 丢失

- Status: resolved
- Tags: #worker #lifecycle
- Display summary: 空闲 worker 没有进入 keepalive_running。
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
  --node-title "后端返回监控 URL" \
  --bad-case "BC-20260707-112" \
  --check "grafana_url 不为空" >/dev/null

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "前端打开监控页" \
  --bad-case "BC-20260707-111" \
  --check "点击后进入监控页" >/dev/null

BEFORE="$(cat "$ROOT/.codex/context/test-hub/feature-chains.json")"
python3 "$SCRIPT" feature-chain-coverage --root "$ROOT" >"$OUT"
AFTER="$(cat "$ROOT/.codex/context/test-hub/feature-chains.json")"

grep -q "feature chains: 1" "$OUT"
grep -q "bad cases in register: 3" "$OUT"
grep -q "covered by feature chains: 2" "$OUT"
grep -q "unassigned candidates: 1" "$OUT"
grep -q "BC-20260707-113" "$OUT"
if grep -q "BC-20260707-111" "$OUT" && grep -q "candidate: BC-20260707-111" "$OUT"; then
  cat "$OUT"
  exit 1
fi
test "$BEFORE" = "$AFTER"

python3 "$SCRIPT" feature-chain-coverage --root "$ROOT" --verbose >"$OUT"
grep -q "checkpoint: 后端返回监控 URL | covers: BC-20260707-112" "$OUT"
grep -q "checkpoint: 前端打开监控页 | covers: BC-20260707-111" "$OUT"
