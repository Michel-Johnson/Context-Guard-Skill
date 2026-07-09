#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-natural-test-intake-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/plan.out"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

python3 "$SCRIPT" feature-chain-plan \
  --root "$ROOT" \
  --query "写一个测试，检验每次开发完成后 Markdown 编辑器里的单行、多行和矩阵公式都能正常渲染" >"$OUT"

grep -q "action: propose-new-chain" "$OUT"
grep -q "confirmation prompt: 测试创建识别" "$OUT"
grep -q "Markdown 编辑器里的单行、多行和矩阵公式能正常渲染" "$OUT"
grep -q "after-confirmation command: .*feature-chain-propose" "$OUT"
grep -q -- "--node-title '<confirmed recurrence checkpoint>'" "$OUT"
grep -q -- "--coverage-pending-reason '<confirmed reason this chain has no linked bad case yet>'" "$OUT"
if grep -q "after-confirmation command: .*feature-chain-add" "$OUT"; then
  cat "$OUT"
  exit 1
fi

if grep -q "confirmation prompt: .*从「写一个测试" "$OUT"; then
  cat "$OUT"
  exit 1
fi
if grep -q "confirmation prompt: .*每次开发完成后 Markdown" "$OUT"; then
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
