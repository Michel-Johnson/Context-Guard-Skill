#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-plan-propose-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
NATURAL_OUT="$ROOT/natural.out"
BAD_CASE_OUT="$ROOT/bad-case.out"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

python3 "$SCRIPT" feature-chain-plan \
  --root "$ROOT" \
  --query "创建一个测试任务：从编辑器输入 Markdown 到预览正确渲染，主要验证公式渲染回归" >"$NATURAL_OUT"

grep -q "action: propose-new-chain" "$NATURAL_OUT"
grep -q "confirmation prompt: 测试创建识别" "$NATURAL_OUT"
grep -q "从「编辑器输入 Markdown」到「预览正确渲染」" "$NATURAL_OUT"
grep -q "主要验证「公式渲染回归」" "$NATURAL_OUT"
grep -q "after-confirmation command: .*feature-chain-propose" "$NATURAL_OUT"
grep -q -- "--node-title '公式渲染回归'" "$NATURAL_OUT"
grep -q -- "--check '<confirmed checkpoint check>'" "$NATURAL_OUT"
grep -q -- "--coverage-pending-reason '<confirmed reason this chain has no linked bad case yet>'" "$NATURAL_OUT"
if grep -q "feature-chain-add" "$NATURAL_OUT"; then
  cat "$NATURAL_OUT"
  exit 1
fi

cat >"$ROOT/.codex/context/bad-cases.md" <<'MD'
# Bad Case Register

### BC-20260707-930: Markdown 公式预览没有渲染

- Status: resolved
- Tags: #markdown #formula
- Display summary: Markdown 编辑器预览区没有渲染公式。
- Phenomenon: 输入公式后预览仍显示原始文本。
- Trigger / reproduction: 用户在编辑器输入公式，预览区没有经过 MathJax 渲染。
MD

python3 "$SCRIPT" feature-chain-plan --root "$ROOT" --query "BC-20260707-930" >"$BAD_CASE_OUT"

grep -q "query expanded from bad-case register: BC-20260707-930 Markdown 公式预览没有渲染" "$BAD_CASE_OUT"
grep -q "action: propose-new-chain" "$BAD_CASE_OUT"
grep -q "confirmation prompt: 测试创建识别" "$BAD_CASE_OUT"
grep -q "after-confirmation command: .*feature-chain-propose" "$BAD_CASE_OUT"
grep -q -- "--node-title 'Markdown 公式预览没有渲染'" "$BAD_CASE_OUT"
grep -q -- "--bad-cases BC-20260707-930" "$BAD_CASE_OUT"
if grep -q -- "--coverage-pending-reason" "$BAD_CASE_OUT"; then
  cat "$BAD_CASE_OUT"
  exit 1
fi
if grep -q "feature-chain-add" "$BAD_CASE_OUT"; then
  cat "$BAD_CASE_OUT"
  exit 1
fi

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" <<'PY'
from pathlib import Path
import json
import sys

path = Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"chains": []}
assert data.get("chains", []) == [], data
PY

DEV_OUT="$(python3 "$SCRIPT" dev-complete --root "$ROOT")"
printf '%s\n' "$DEV_OUT" | grep -q "test hub: no approved every-dev-completion tests"
