#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-propose-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/out.txt"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "路线图节点阅读" \
  --entry "用户点击路线图节点" \
  --exit-check "节点详情页用自然语言展示用户问题、相关 bad case、方法和进度" \
  --node-title "节点详情可读" \
  --bad-cases "BC-20260707-119-title, BC-20260707-119-detail" \
  --check "详情页能一眼看懂节点对应任务" >"$OUT"

grep -q "feature chain proposed:" "$OUT"
grep -q "status: proposed; this chain is not executable and will not run in dev-complete" "$OUT"
grep -q "checkpoint: 节点详情可读 | covers BC-20260707-119-title, BC-20260707-119-detail" "$OUT"
grep -q "next: after the user confirms the automation" "$OUT"

python3 "$SCRIPT" validate-feature-chains --root "$ROOT" >"$OUT"
grep -q "feature-chain validation passed: 1 chain(s), 0 warning(s)" "$OUT"

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$OUT"
grep -q "test hub: no approved every-dev-completion tests" "$OUT"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" <<'PY'
from pathlib import Path
import json
import sys

registry = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
chain = registry["chains"][0]
assert chain["status"] == "proposed"
assert chain["type"] == "manual"
assert chain["command"] == ""
assert chain["run_policy"] == "every-dev-completion"
assert chain["proposal_note"].startswith("Human-confirmed draft only")
node = chain["nodes"][0]
assert node["title"] == "节点详情可读"
assert node["bad_cases"] == ["BC-20260707-119-title", "BC-20260707-119-detail"]
assert node["checks"] == ["详情页能一眼看懂节点对应任务"]
PY
