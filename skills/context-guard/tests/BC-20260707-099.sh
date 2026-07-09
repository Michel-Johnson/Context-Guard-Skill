#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-validate-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/validate.out"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

ADD_OUTPUT="$(python3 "$SCRIPT" feature-chain-add \
  --root "$ROOT" \
  --title "Markdown 公式预览" \
  --entry "用户输入 Markdown 公式" \
  --exit-check "预览区显示 MathJax 渲染结果" \
  --command-text "printf 'ok\n'")"

CHAIN_ID="$(printf '%s\n' "$ADD_OUTPUT" | sed -n 's/.*feature chain: //p')"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" "$CHAIN_ID" <<'PY'
from pathlib import Path
import json
import sys
path = Path(sys.argv[1])
chain_id = sys.argv[2]
data = json.loads(path.read_text(encoding="utf-8"))
chain = next(item for item in data["chains"] if item["id"] == chain_id)
chain["status"] = "approved"
chain["type"] = "command"
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

if python3 "$SCRIPT" validate-feature-chains --root "$ROOT" >"$OUT" 2>&1; then
  cat "$OUT"
  exit 1
fi
grep -q "approved every-dev-completion chain must have at least one checkpoint node" "$OUT"

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "MathJax 渲染完成" \
  --bad-case "BC-20260707-099" \
  --check "预览区包含渲染后的公式且没有空白" >/dev/null

python3 "$SCRIPT" validate-feature-chains --root "$ROOT" >"$OUT"
grep -q "feature-chain validation passed: 1 chain(s), 0 warning(s)" "$OUT"
