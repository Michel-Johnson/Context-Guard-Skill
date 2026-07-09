#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT_BAD="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-marker-bad-XXXXXX")"
ROOT_GOOD="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-marker-good-XXXXXX")"
trap 'rm -rf "$ROOT_BAD" "$ROOT_GOOD"' EXIT
OUT="$ROOT_BAD/out.txt"

create_chain() {
  local root="$1"
  local mode="${2:-proposed}"
  local command_text="${3:-}"
  python3 "$SCRIPT" init --root "$root" >/dev/null
  local add_output
  add_output="$(python3 "$SCRIPT" feature-chain-add \
    --root "$root" \
    --title "GPU 监控按钮" \
    --entry "点击 GPU 监控按钮" \
    --exit-check "打开包含有效 grafana_url 的监控页")"
  local chain_id
  chain_id="$(printf '%s\n' "$add_output" | sed -n 's/.*feature chain: //p')"
  python3 "$SCRIPT" feature-chain-attach-bc \
    --root "$root" \
    --chain-id "$chain_id" \
    --node-title "后端返回监控 URL" \
    --bad-case "BC-20260707-105" \
    --check "grafana_url 不为空" >/dev/null
  python3 "$SCRIPT" feature-chain-attach-bc \
    --root "$root" \
    --chain-id "$chain_id" \
    --node-title "前端打开监控页" \
    --bad-case "BC-20260707-105" \
    --check "点击后进入监控页" >/dev/null
  if [[ "$mode" == "direct-approved" ]]; then
    python3 - "$root/.codex/context/test-hub/feature-chains.json" "$chain_id" "$command_text" <<'PY'
from pathlib import Path
import json
import sys
path = Path(sys.argv[1])
chain_id = sys.argv[2]
command = sys.argv[3]
data = json.loads(path.read_text(encoding="utf-8"))
chain = next(item for item in data["chains"] if item["id"] == chain_id)
chain["status"] = "approved"
chain["type"] = "command"
chain["command"] = command
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
  fi
  printf '%s' "$chain_id"
}

CHAIN_ID="$(create_chain "$ROOT_BAD" direct-approved "printf 'CG_CHECKPOINT:未登记检查点:PASS\n'")"
python3 - "$ROOT_BAD/.codex/context/test-hub/feature-chains.json" "$CHAIN_ID" <<'PY'
from pathlib import Path
import json
import sys

chain = next(
    item
    for item in json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["chains"]
    if item["id"] == sys.argv[2]
)
nodes = chain["nodes"]
assert len(nodes) == 2, nodes
ids = [node["id"] for node in nodes]
assert len(set(ids)) == 2, ids
assert "test" not in ids, ids
PY

if python3 "$SCRIPT" dev-complete --root "$ROOT_BAD" >"$OUT" 2>&1; then
  cat "$OUT"
  exit 1
fi
grep -q "unknown checkpoint marker: 未登记检查点" "$OUT"

python3 - "$ROOT_BAD/.codex/context/test-hub/last-run.json" <<'PY'
from pathlib import Path
import json
import sys

result = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["results"][0]
assert result["status"] == "failed"
assert result["reason"] == "unknown checkpoint marker: 未登记检查点"
assert result["checkpoints"][0]["known"] is False
PY

OUT="$ROOT_GOOD/out.txt"
CHAIN_ID="$(create_chain "$ROOT_GOOD")"
python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT_GOOD" \
  --chain-id "$CHAIN_ID" \
  --command-text "printf 'CG_CHECKPOINT:后端返回监控 URL:PASS\nCG_CHECKPOINT:前端打开监控页:PASS\n'" >/dev/null

python3 "$SCRIPT" dev-complete --root "$ROOT_GOOD" >"$OUT"
grep -q "1 passed, 0 failed, 0 blocked" "$OUT"
grep -q "success artifacts cleaned" "$OUT"

python3 - "$ROOT_GOOD/.codex/context/test-hub/last-run.json" <<'PY'
from pathlib import Path
import json
import sys

result = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["results"][0]
assert result["status"] == "passed"
assert [item["known"] for item in result["checkpoints"]] == [True, True]
assert [item["label"] for item in result["checkpoints"]] == ["后端返回监控 URL", "前端打开监控页"]
PY
