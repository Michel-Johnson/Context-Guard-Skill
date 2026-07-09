#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-overlap-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/overlap.out"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "Markdown 公式预览" \
  --entry "编辑器输入 Markdown 公式" \
  --exit-check "预览完成 MathJax 渲染" \
  --node-title "公式渲染回归" \
  --bad-cases "BC-20260707-901" \
  --check "单行、多行和矩阵公式都被 MathJax 正常排版" >/dev/null

python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "Markdown 数学公式渲染" \
  --entry "编辑器输入 Markdown 公式" \
  --exit-check "预览完成 MathJax 渲染" \
  --node-title "数学公式预览稳定" \
  --bad-cases "BC-20260707-902" \
  --check "公式预览不会显示原始文本" >/dev/null

python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "GPU 监控链接" \
  --entry "点击 GPU 监控按钮" \
  --exit-check "打开对应 Grafana 页面" \
  --node-title "监控 URL 可用" \
  --bad-cases "BC-20260707-903" \
  --check "按钮跳转到真实 grafana_url" >/dev/null

REGISTRY="$ROOT/.codex/context/test-hub/feature-chains.json"
BEFORE="$(shasum "$REGISTRY" | awk '{print $1}')"
python3 "$SCRIPT" feature-chain-overlap --root "$ROOT" --min-score 4 >"$OUT"
AFTER="$(shasum "$REGISTRY" | awk '{print $1}')"

test "$BEFORE" = "$AFTER"
grep -q "feature-chain overlap audit" "$OUT"
grep -q "chains: 3" "$OUT"
grep -q "overlapping candidates: 1" "$OUT"
grep -q "Markdown 公式预览" "$OUT"
grep -q "Markdown 数学公式渲染" "$OUT"
grep -q "match evidence:" "$OUT"
grep -q "next: review whether one workflow should absorb the other before approving automation" "$OUT"
grep -q "next: merge or extend an existing feature chain" "$OUT"
if grep -q "with: .*GPU 监控链接" "$OUT"; then
  echo "unrelated GPU chain should not be flagged as an overlap" >&2
  cat "$OUT" >&2
  exit 1
fi

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$ROOT/dev-complete.out"
grep -q "no approved every-dev-completion tests" "$ROOT/dev-complete.out"
