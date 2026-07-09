#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-from-to-intake-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/plan.out"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

python3 "$SCRIPT" feature-chain-plan \
  --root "$ROOT" \
  --query "创建一个测试任务：从编辑器输入 Markdown 到预览正确渲染，主要验证公式渲染回归" >"$OUT"

grep -q "action: propose-new-chain" "$OUT"
grep -q "confirmation prompt: 测试创建识别" "$OUT"
grep -q "从「编辑器输入 Markdown」到「预览正确渲染」" "$OUT"
grep -q "主要验证「公式渲染回归」" "$OUT"
grep -q "suggested checkpoint after confirmation: 公式渲染回归" "$OUT"
grep -q "after-confirmation command: .*feature-chain-propose" "$OUT"
grep -q -- "--entry '编辑器输入 Markdown'" "$OUT"
grep -q -- "--exit-check '预览正确渲染'" "$OUT"
grep -q -- "--node-title '公式渲染回归'" "$OUT"
grep -q -- "--check '<confirmed checkpoint check>'" "$OUT"
grep -q -- "--coverage-pending-reason '<confirmed reason this chain has no linked bad case yet>'" "$OUT"
if grep -q "after-confirmation command: .*feature-chain-add" "$OUT"; then
  cat "$OUT"
  exit 1
fi

if grep -q "从「创建一个测试任务" "$OUT"; then
  cat "$OUT"
  exit 1
fi
if grep -q "相关入口到用户可见的正确结果" "$OUT"; then
  cat "$OUT"
  exit 1
fi
if grep -q "<confirmed user-visible entry>" "$OUT"; then
  cat "$OUT"
  exit 1
fi
if grep -q "<confirmed strict final green condition>" "$OUT"; then
  cat "$OUT"
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
