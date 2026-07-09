#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-pending-chain-attach-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
PROPOSE_OUT="$ROOT/propose.out"
PLAN_OUT="$ROOT/plan.out"
ATTACH_OUT="$ROOT/attach.out"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "Markdown 公式预览" \
  --entry "编辑器输入 Markdown" \
  --exit-check "预览正确渲染" \
  --node-title "公式渲染回归" \
  --check "单行、多行和矩阵公式都被 MathJax 正常排版" \
  --coverage-pending-reason "用户先确认功能测试，后续遇到 MathJax 公式渲染 bad case 再挂到 checkpoint" >"$PROPOSE_OUT"

CHAIN_ID="$(grep 'feature chain proposed:' "$PROPOSE_OUT" | awk '{print $NF}')"
test -n "$CHAIN_ID"

cat >"$ROOT/.codex/context/bad-cases.md" <<'MD'
### BC-20260707-900: Markdown 公式预览没有渲染

- Status: resolved
- First observed: 2026-07-07
- Last checked: 2026-07-07
- Scope: Markdown editor preview
- Tags: #feature-chain #mathjax #rendering
- Display summary: Markdown 编辑器里的公式没有被 MathJax 正常渲染。
- Phenomenon: 单行、多行或矩阵公式在预览里显示为原始文本。
- Trigger / reproduction: 在编辑器输入 Markdown 公式并打开预览。
- Root cause: 预览渲染链路没有触发 MathJax 排版。
- Fix method: 确保预览更新后执行 MathJax typeset。
- Guard / verification: 功能链 checkpoint 应验证公式预览已渲染。
- Red condition: 预览仍显示原始公式文本。
- Green condition: 预览显示排版后的公式。
- Expected failure reason: 如果公式渲染回归，功能链 checkpoint 会失败。
MD

python3 "$SCRIPT" feature-chain-plan \
  --root "$ROOT" \
  --query "BC-20260707-900" >"$PLAN_OUT"

grep -q "action: review-existing-chain" "$PLAN_OUT"
grep -q "$CHAIN_ID" "$PLAN_OUT"
grep -q "checkpoint: 公式渲染回归" "$PLAN_OUT"
grep -q "after-confirmation command: .*feature-chain-attach-bc" "$PLAN_OUT"
grep -q -- "--bad-case BC-20260707-900" "$PLAN_OUT"

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "公式渲染回归" \
  --bad-case "BC-20260707-900" \
  --check "公式预览必须触发 MathJax 排版" >"$ATTACH_OUT"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" "$CHAIN_ID" <<'PY'
from pathlib import Path
import json
import sys

path = Path(sys.argv[1])
chain_id = sys.argv[2]
data = json.loads(path.read_text(encoding="utf-8"))
chain = next(item for item in data["chains"] if item["id"] == chain_id)
node = chain["nodes"][0]
assert "BC-20260707-900" in node["bad_cases"], node
assert "coverage_pending_reason" not in node, node
assert "公式预览必须触发 MathJax 排版" in node["checks"], node
PY

python3 "$SCRIPT" validate-feature-chains --root "$ROOT" >"$ROOT/validate.out"
grep -q "feature-chain validation passed: 1 chain(s), 0 warning(s)" "$ROOT/validate.out"

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$ROOT/dev-complete.out"
grep -q "no approved every-dev-completion tests" "$ROOT/dev-complete.out"
