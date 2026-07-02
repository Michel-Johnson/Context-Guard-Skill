#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

ADD_OUTPUT="$(python3 "$SCRIPT" feature-chain-add \
  --root "$ROOT" \
  --title "GPU 监控按钮" \
  --entry "点击 GPU 监控按钮" \
  --exit-check "打开包含有效 grafana_url 的监控页" \
  --command-text "printf 'feature-chain-ok\n'" \
  --test-status approved)"

CHAIN_ID="$(printf '%s\n' "$ADD_OUTPUT" | awk '/feature chain:/ {print $NF}')"
test -n "$CHAIN_ID"

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "后端返回监控 URL" \
  --bad-case "BC-20260702-000" \
  --check "grafana_url 不为空，前端不会卡住" >/dev/null

python3 "$SCRIPT" feature-chain-list --root "$ROOT" | grep -q "BC-20260702-000"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" "$CHAIN_ID" <<'PY'
from pathlib import Path
import json
import sys

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
chain = next(item for item in data["chains"] if item["id"] == sys.argv[2])
assert chain["entry"] == "点击 GPU 监控按钮"
assert chain["exit_check"] == "打开包含有效 grafana_url 的监控页"
assert chain["nodes"][0]["bad_cases"] == ["BC-20260702-000"]
assert "grafana_url 不为空" in chain["nodes"][0]["checks"][0]
PY

RUN_OUTPUT="$(python3 "$SCRIPT" dev-complete --root "$ROOT")"
printf '%s\n' "$RUN_OUTPUT" | grep -q "1 passed, 0 failed, 0 blocked"
printf '%s\n' "$RUN_OUTPUT" | grep -q "success artifacts cleaned"
