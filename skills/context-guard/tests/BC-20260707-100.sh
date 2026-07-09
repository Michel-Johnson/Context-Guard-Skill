#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-suggest-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/suggest.out"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

ADD_OUTPUT="$(python3 "$SCRIPT" feature-chain-add \
  --root "$ROOT" \
  --title "Markdown 公式预览" \
  --entry "用户输入 Markdown 公式" \
  --exit-check "预览区显示 MathJax 渲染结果")"
CHAIN_ID="$(printf '%s\n' "$ADD_OUTPUT" | sed -n 's/.*feature chain: //p')"

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "MathJax 渲染完成" \
  --bad-case "BC-20260707-100" \
  --check "预览区包含渲染后的公式且没有空白" >/dev/null

python3 "$SCRIPT" feature-chain-add \
  --root "$ROOT" \
  --title "GPU 监控按钮" \
  --entry "点击 GPU 监控按钮" \
  --exit-check "打开包含 grafana_url 的监控页" >/dev/null

python3 "$SCRIPT" feature-chain-suggest \
  --root "$ROOT" \
  --query "Markdown 数学公式预览 MathJax 渲染空白" >"$OUT"
grep -q "Markdown 公式预览" "$OUT"
grep -q "MathJax 渲染完成" "$OUT"
grep -q "next: attach the bad case to a candidate checkpoint" "$OUT"
if grep -q "GPU 监控按钮" "$OUT"; then
  cat "$OUT"
  exit 1
fi

python3 "$SCRIPT" feature-chain-suggest \
  --root "$ROOT" \
  --query "worker lease keepalive 释放失败" >"$OUT"
grep -q "feature-chain candidates: none" "$OUT"
grep -q "proposal-needed" "$OUT"
