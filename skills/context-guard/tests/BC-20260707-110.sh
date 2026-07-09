#!/usr/bin/env bash
set -euo pipefail

SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$SKILL_ROOT/scripts/context_guard.py"
HOOK="$SKILL_ROOT/scripts/context_guard_hook.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-summary-XXXXXX")"
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
  --bad-case "BC-20260707-110" \
  --check "grafana_url 不为空" >/dev/null

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "前端打开监控页" \
  --bad-case "BC-20260707-110" \
  --check "点击后进入监控页" >/dev/null

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" "$CHAIN_ID" <<'PY'
from pathlib import Path
import json
import sys
path = Path(sys.argv[1])
chain_id = sys.argv[2]
data = json.loads(path.read_text(encoding="utf-8"))
chain = next(item for item in data["chains"] if item["id"] == chain_id)
chain["status"] = "approved"
chain["type"] = "command"
chain["command"] = "printf 'CG_CHECKPOINT:后端返回监控 URL:PASS\\n'"
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

if python3 "$SCRIPT" dev-complete --root "$ROOT" >"$OUT" 2>&1; then
  cat "$OUT"
  exit 1
fi

grep -q "missing checkpoint marker: 前端打开监控页" "$OUT"
grep -q "\\[log: " "$OUT"

PYTHONPATH="$SKILL_ROOT/scripts" python3 - "$ROOT" "$HOOK" <<'PY'
from pathlib import Path
import importlib.util
import sys

root = Path(sys.argv[1])
hook_path = Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("context_guard_hook", hook_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

details = module.completion_test_failure_details(root)
assert "failed: GPU 监控按钮" in details
assert "missing checkpoint marker: 前端打开监控页" in details
assert "test-hub/runs/" in details
PY
