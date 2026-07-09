#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-missing-checkpoint-XXXXXX")"
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
  --bad-case "BC-20260707-106" \
  --check "grafana_url 不为空" >/dev/null

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "前端打开监控页" \
  --bad-case "BC-20260707-106" \
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

python3 - "$ROOT/.codex/context/test-hub/last-run.json" <<'PY'
from pathlib import Path
import json
import sys

result = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["results"][0]
assert result["status"] == "failed"
assert result["reason"] == "missing checkpoint marker: 前端打开监控页"
assert [item["label"] for item in result["missing_checkpoints"]] == ["前端打开监控页"]
PY

python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --command-text "printf 'CG_CHECKPOINT:后端返回监控 URL:PASS\nCG_CHECKPOINT:前端打开监控页:PASS\n'" >/dev/null

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$OUT"
grep -q "1 passed, 0 failed, 0 blocked" "$OUT"
grep -q "success artifacts cleaned" "$OUT"

python3 - "$ROOT/.codex/context/test-hub/last-run.json" <<'PY'
from pathlib import Path
import json
import sys

result = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["results"][0]
assert result["status"] == "passed"
assert [item["label"] for item in result["checkpoints"]] == ["后端返回监控 URL", "前端打开监控页"]
assert result["missing_checkpoints"] == []
PY
