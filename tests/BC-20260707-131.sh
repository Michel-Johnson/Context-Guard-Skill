#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-lifecycle-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
mkdir -p "$ROOT/.codex/context/test-hub/fixtures"

PROPOSE_OUT="$ROOT/propose.out"
PLAN_OUT="$ROOT/plan.out"
ATTACH_OUT="$ROOT/attach.out"
SUMMARY_OUT="$ROOT/summary.out"
OVERLAP_OUT="$ROOT/overlap.out"
APPROVE_OUT="$ROOT/approve.out"
COMPLETE_OUT="$ROOT/dev-complete.out"

python3 "$SCRIPT" feature-chain-plan \
  --root "$ROOT" \
  --query "创建一个测试任务：从编辑器输入 Markdown 到预览正确渲染，主要验证公式渲染回归" >"$PLAN_OUT"

grep -q "after-confirmation command: .*feature-chain-propose" "$PLAN_OUT"
grep -q -- "--coverage-pending-reason" "$PLAN_OUT"

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
### BC-20260707-940: Markdown 公式预览没有渲染

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

python3 "$SCRIPT" feature-chain-plan --root "$ROOT" --query "BC-20260707-940" >"$PLAN_OUT"
grep -q "action: review-existing-chain" "$PLAN_OUT"
grep -q "$CHAIN_ID" "$PLAN_OUT"
grep -q "checkpoint: 公式渲染回归" "$PLAN_OUT"
grep -q "after-confirmation command: .*feature-chain-attach-bc" "$PLAN_OUT"

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "公式渲染回归" \
  --bad-case "BC-20260707-940" \
  --check "公式预览必须触发 MathJax 排版" >"$ATTACH_OUT"

python3 "$SCRIPT" feature-chain-summary --root "$ROOT" >"$SUMMARY_OUT"
grep -q "chains: 1" "$SUMMARY_OUT"
grep -q "covered bad cases: 1" "$SUMMARY_OUT"
grep -q "Markdown 公式预览没有渲染" "$SUMMARY_OUT"
grep -q "coverage density:" "$SUMMARY_OUT"
if grep -q "coverage pending" "$SUMMARY_OUT"; then
  cat "$SUMMARY_OUT"
  exit 1
fi

python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "Markdown 数学公式渲染" \
  --entry "编辑器输入 Markdown" \
  --exit-check "预览正确渲染" \
  --node-title "数学公式预览稳定" \
  --bad-cases "BC-20260707-941" \
  --check "公式预览不会显示原始文本" >/dev/null

python3 "$SCRIPT" feature-chain-overlap --root "$ROOT" --min-score 4 >"$OVERLAP_OUT"
grep -q "overlapping candidates: 1" "$OVERLAP_OUT"
grep -q "Markdown 公式预览" "$OVERLAP_OUT"
grep -q "Markdown 数学公式渲染" "$OVERLAP_OUT"

cat >"$ROOT/.codex/context/test-hub/fixtures/markdown_preview_chain.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "CG_CHECKPOINT:公式渲染回归:PASS"
SH
chmod +x "$ROOT/.codex/context/test-hub/fixtures/markdown_preview_chain.sh"

python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --command-text "bash .codex/context/test-hub/fixtures/markdown_preview_chain.sh" >"$APPROVE_OUT"

grep -q "feature chain approved: $CHAIN_ID" "$APPROVE_OUT"
grep -q "approval dry-run: passed" "$APPROVE_OUT"

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$COMPLETE_OUT"
grep -q "test hub: 1 passed, 0 failed, 0 blocked" "$COMPLETE_OUT"
grep -q "passed: Markdown 公式预览" "$COMPLETE_OUT"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" "$ROOT/.codex/context/test-hub/last-run.json" "$CHAIN_ID" <<'PY'
from pathlib import Path
import json
import sys

chains_path = Path(sys.argv[1])
run_path = Path(sys.argv[2])
chain_id = sys.argv[3]

chains = json.loads(chains_path.read_text(encoding="utf-8"))["chains"]
chain = next(item for item in chains if item["id"] == chain_id)
assert chain["status"] == "approved", chain
assert chain["run_policy"] == "every-dev-completion", chain
node = chain["nodes"][0]
assert node["title"] == "公式渲染回归", node
assert "BC-20260707-940" in node["bad_cases"], node
assert "coverage_pending_reason" not in node, node

last_run = json.loads(run_path.read_text(encoding="utf-8"))
results = last_run.get("results", [])
assert len(results) == 1, last_run
result = results[0]
assert result["status"] == "passed", result
assert any(item.get("label") == "公式渲染回归" and item.get("status") == "pass" for item in result.get("checkpoints", [])), result
PY

python3 "$SCRIPT" validate-feature-chains --root "$ROOT" >"$ROOT/validate.out"
grep -q "feature-chain validation passed: 2 chain(s), 0 warning(s)" "$ROOT/validate.out"
