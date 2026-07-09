#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-dry-run.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

SCRIPT="/Users/bytedance/.agents/skills/context-guard/scripts/context_guard.py"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" set-language --root "$ROOT" --language zh >/dev/null

python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "Markdown 公式预览" \
  --entry "在编辑器输入公式" \
  --exit-check "预览区正确渲染公式" \
  --node-title "公式渲染完成" \
  --bad-cases "BC-TEST-001, BC-TEST-002" \
  --check "确认单行和多行公式都进入渲染结果" >/dev/null

PASS_OUTPUT="$(
  python3 "$SCRIPT" feature-chain-dry-run \
    --root "$ROOT" \
    --chain-id FC-20260707-001 \
    --command-text "printf 'CG_CHECKPOINT:公式渲染完成:PASS\n'"
)"

grep -q "feature-chain dry run: passed" <<<"$PASS_OUTPUT"
grep -q "checkpoint pass: 公式渲染完成" <<<"$PASS_OUTPUT"
grep -q "dry-run success artifacts cleaned" <<<"$PASS_OUTPUT"

set +e
FAIL_OUTPUT="$(
  python3 "$SCRIPT" feature-chain-dry-run \
    --root "$ROOT" \
    --chain-id FC-20260707-001 \
    --command-text "true" 2>&1
)"
FAIL_STATUS=$?
set -e

test "$FAIL_STATUS" -ne 0
grep -q "feature-chain dry run: failed" <<<"$FAIL_OUTPUT"
grep -q "missing checkpoint marker: 公式渲染完成" <<<"$FAIL_OUTPUT"
grep -q "dry-run evidence preserved" <<<"$FAIL_OUTPUT"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" <<'PY'
import json
import sys
path = sys.argv[1]
data = json.load(open(path, encoding="utf-8"))
chain = data["chains"][0]
assert chain["status"] == "proposed", chain
assert chain["type"] == "manual", chain
assert chain["command"] == "", chain
assert chain["nodes"][0]["bad_cases"] == ["BC-TEST-001", "BC-TEST-002"], chain
PY

python3 "$SCRIPT" dev-complete --root "$ROOT" | grep -q "no approved every-dev-completion tests"
test -f "$ROOT/.codex/context/test-hub/last-dry-run.json"
