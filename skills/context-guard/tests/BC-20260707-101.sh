#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-proposed-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/out.txt"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

ADD_OUTPUT="$(python3 "$SCRIPT" feature-chain-add \
  --root "$ROOT" \
  --title "Markdown 公式预览" \
  --entry "用户输入 Markdown 公式" \
  --exit-check "预览区显示 MathJax 渲染结果" \
  --command-text "printf 'should not run unless approved\n'")"
CHAIN_ID="$(printf '%s\n' "$ADD_OUTPUT" | sed -n 's/.*feature chain: //p')"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" "$CHAIN_ID" <<'PY'
from pathlib import Path
import json
import sys

registry = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
chain = next(item for item in registry["chains"] if item["id"] == sys.argv[2])
assert chain["status"] == "proposed", chain
assert chain["source"] == "feature-chain", chain
PY

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$OUT"
grep -q "no approved every-dev-completion tests" "$OUT"

python3 "$SCRIPT" test-hub-add \
  --root "$ROOT" \
  --title "Context 初始化冒烟测试" \
  --command-text "printf 'ok\n'" >/dev/null

python3 - "$ROOT/.codex/context/test-hub/registry.json" <<'PY'
from pathlib import Path
import json
import sys

registry = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
test = registry["tests"][0]
assert test["status"] == "approved", test
assert test["run_policy"] == "every-dev-completion", test
PY
