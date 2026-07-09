#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-summary-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/summary.out"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

cat >"$ROOT/.codex/context/bad-cases.md" <<'MD'
### BC-20260707-901: Markdown 公式预览没有渲染

- Status: resolved
- First observed: 2026-07-07
- Last checked: 2026-07-07
- Scope: Markdown editor preview
- Tags: #feature-chain #mathjax
- Display summary: Markdown 编辑器里的公式没有被 MathJax 正常渲染。
- Phenomenon: 单行、多行或矩阵公式在预览里显示为原始文本。
- Trigger / reproduction: 在编辑器输入 Markdown 公式并打开预览。
- Root cause: 预览渲染链路没有触发 MathJax 排版。
- Fix method: 确保预览更新后执行 MathJax typeset。
- Guard / verification: 功能链 checkpoint 应验证公式预览已渲染。
- Red condition: 预览仍显示原始公式文本。
- Green condition: 预览显示排版后的公式。
- Expected failure reason: 如果公式渲染回归，功能链 checkpoint 会失败。

### BC-20260707-902: Markdown 公式换行错乱

- Status: resolved
- First observed: 2026-07-07
- Last checked: 2026-07-07
- Scope: Markdown editor preview
- Tags: #feature-chain #mathjax
- Display summary: 多行公式和矩阵公式在预览里换行错乱。
- Phenomenon: 多行公式和矩阵公式没有保持正确排版。
- Trigger / reproduction: 输入包含矩阵公式的 Markdown 并打开预览。
- Root cause: 渲染后没有等待 MathJax 完成排版。
- Fix method: 等待 MathJax 渲染完成再判定预览稳定。
- Guard / verification: 功能链 checkpoint 应验证多行公式和矩阵公式。
- Red condition: 多行公式或矩阵公式排版错乱。
- Green condition: 多行公式和矩阵公式排版稳定。
- Expected failure reason: 如果异步排版回归，功能链 checkpoint 会失败。
MD

python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "Markdown 公式预览" \
  --entry "编辑器输入 Markdown" \
  --exit-check "预览正确渲染" \
  --node-title "公式渲染回归" \
  --bad-cases "BC-20260707-901,BC-20260707-902" \
  --check "单行、多行和矩阵公式都被 MathJax 正常排版" >/dev/null

python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "Markdown 图片预览" \
  --entry "编辑器插入图片" \
  --exit-check "预览正确显示图片" \
  --node-title "图片资源加载" \
  --coverage-pending-reason "用户先确认图片预览流程，后续遇到具体图片 bad case 再挂到 checkpoint" \
  --check "图片链接在预览里加载成功" >/dev/null

REGISTRY="$ROOT/.codex/context/test-hub/feature-chains.json"
BEFORE="$(shasum "$REGISTRY" | awk '{print $1}')"
python3 "$SCRIPT" feature-chain-summary --root "$ROOT" >"$OUT"
AFTER="$(shasum "$REGISTRY" | awk '{print $1}')"

test "$BEFORE" = "$AFTER"
grep -q "feature-chain summary" "$OUT"
grep -q "chains: 2" "$OUT"
grep -q "approved every-dev-completion: 0" "$OUT"
grep -q "proposed: 2" "$OUT"
grep -q "covered bad cases: 2" "$OUT"
grep -q "pending checkpoints: 1" "$OUT"
grep -q "coverage density: 2.0 bad case(s) per covered chain" "$OUT"
grep -q "reuse signal: one workflow covers up to 2 bad case(s)" "$OUT"
grep -q "chain: FC-" "$OUT"
grep -q "next: prefer extending this workflow before creating another test for similar symptoms" "$OUT"
grep -q "Markdown 公式预览没有渲染" "$OUT"
grep -q "Markdown 公式换行错乱" "$OUT"
grep -q "coverage pending: 用户先确认图片预览流程" "$OUT"
grep -q "next: attach the first matching real bad case here before approval" "$OUT"
grep -q "next: review pending checkpoints before proposing new chains" "$OUT"

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$ROOT/dev-complete.out"
grep -q "no approved every-dev-completion tests" "$ROOT/dev-complete.out"
