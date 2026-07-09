#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-method-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

ADD_OUTPUT="$(python3 "$SCRIPT" feature-chain-add \
  --root "$ROOT" \
  --title "Markdown 公式预览" \
  --entry "用户输入包含单行和多行公式的 Markdown" \
  --exit-check "预览区展示 MathJax 渲染结果且没有空白或报错")"

CHAIN_ID="$(printf '%s\n' "$ADD_OUTPUT" | awk '/feature chain:/ {print $NF}')"
test -n "$CHAIN_ID"

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "公式输入进入预览流程" \
  --bad-case "BC-20260706-001" \
  --check "输入包含 $ 和 $$ 公式时预览流程没有丢弃公式文本" >/dev/null

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "MathJax 渲染完成" \
  --bad-case "BC-20260706-002" \
  --check "渲染完成后页面不显示原始 LaTeX、空白或错误占位" >/dev/null

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "MathJax 渲染完成" \
  --bad-case "BC-20260706-003" \
  --check "重复开发后单行、多行、矩阵公式仍共用同一预览链路验证" >/dev/null

COMMAND="tmp=.codex/context/test-hub/feature-chain-evidence.tmp; printf 'CG_CHECKPOINT:公式输入进入预览流程:PASS\nCG_CHECKPOINT:MathJax 渲染完成:PASS\n' > \"\$tmp\"; cat \"\$tmp\"; rm -f \"\$tmp\""
python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --command-text "$COMMAND" >/dev/null

python3 "$SCRIPT" feature-chain-list --root "$ROOT" | grep -q "covers BC-20260706-001, BC-20260706-002, BC-20260706-003"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" "$CHAIN_ID" <<'PY'
from pathlib import Path
import json
import sys

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
chain = next(item for item in data["chains"] if item["id"] == sys.argv[2])
assert chain["title"] == "Markdown 公式预览"
assert len(chain["nodes"]) == 2
covered = sorted(bc for node in chain["nodes"] for bc in node["bad_cases"])
assert covered == ["BC-20260706-001", "BC-20260706-002", "BC-20260706-003"]
assert chain["run_policy"] == "every-dev-completion"
assert chain["status"] == "approved"
PY

RUN_OUTPUT="$(python3 "$SCRIPT" dev-complete --root "$ROOT")"
printf '%s\n' "$RUN_OUTPUT" | grep -q "1 passed, 0 failed, 0 blocked"
printf '%s\n' "$RUN_OUTPUT" | grep -q "success artifacts cleaned"
test ! -e "$ROOT/.codex/context/test-hub/feature-chain-evidence.tmp"
