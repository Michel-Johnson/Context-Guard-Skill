#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT_FAIL="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-closed-loop-fail-XXXXXX")"
ROOT_PASS="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-closed-loop-pass-XXXXXX")"
trap 'rm -rf "$ROOT_FAIL" "$ROOT_PASS"' EXIT
OUT="$ROOT_FAIL/out.txt"

create_chain() {
  local root="$1"
  local command_text="$2"
  local mode="${3:-approve}"
  python3 "$SCRIPT" init --root "$root" >/dev/null
  local add_output
  add_output="$(python3 "$SCRIPT" feature-chain-add \
    --root "$root" \
    --title "Markdown 公式预览" \
    --entry "输入包含单行、多行和矩阵公式的 Markdown" \
    --exit-check "预览区完成 MathJax 渲染且没有空白或错误占位")"
  local chain_id
  chain_id="$(printf '%s\n' "$add_output" | sed -n 's/.*feature chain: //p')"
  test -n "$chain_id"

  python3 "$SCRIPT" feature-chain-attach-bc \
    --root "$root" \
    --chain-id "$chain_id" \
    --node-title "公式输入进入预览流程" \
    --bad-case "BC-20260707-118-input" \
    --check "单行、多行和矩阵公式都进入同一预览流程" >/dev/null

  python3 "$SCRIPT" feature-chain-attach-bc \
    --root "$root" \
    --chain-id "$chain_id" \
    --node-title "MathJax 渲染完成" \
    --bad-case "BC-20260707-118-render" \
    --check "预览区展示渲染后的公式且没有空白或错误占位" >/dev/null

  if [[ "$mode" == "direct-approved" ]]; then
    python3 - "$root/.codex/context/test-hub/feature-chains.json" "$chain_id" "$command_text" <<'PY'
from pathlib import Path
import json
import sys
path = Path(sys.argv[1])
chain_id = sys.argv[2]
command = sys.argv[3]
data = json.loads(path.read_text(encoding="utf-8"))
chain = next(item for item in data["chains"] if item["id"] == chain_id)
chain["status"] = "approved"
chain["type"] = "command"
chain["command"] = command
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
  else
    python3 "$SCRIPT" feature-chain-approve \
      --root "$root" \
      --chain-id "$chain_id" \
      --command-text "$command_text" >/dev/null
  fi

  python3 "$SCRIPT" validate-feature-chains --root "$root" | grep -q "feature-chain validation passed"
}

FAIL_COMMAND='printf "CG_CHECKPOINT:公式输入进入预览流程:PASS\nCG_CHECKPOINT:MathJax 渲染完成:FAIL:预览区为空\n"; printf "render empty\n" > "$CONTEXT_GUARD_TEST_RUN_DIR/render-diagnostic.txt"'
create_chain "$ROOT_FAIL" "$FAIL_COMMAND" direct-approved

if python3 "$SCRIPT" dev-complete --root "$ROOT_FAIL" >"$OUT" 2>&1; then
  cat "$OUT"
  exit 1
fi
grep -q "0 passed, 1 failed, 0 blocked" "$OUT"
grep -q "checkpoint failed: MathJax 渲染完成 - 预览区为空" "$OUT"
grep -q "evidence preserved" "$OUT"

python3 - "$ROOT_FAIL/.codex/context/test-hub/last-run.json" <<'PY'
from pathlib import Path
import json
import sys

run = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
result = run["results"][0]
assert result["status"] == "failed"
assert result["reason"] == "checkpoint failed: MathJax 渲染完成 - 预览区为空"
assert [item["label"] for item in result["checkpoints"]] == ["公式输入进入预览流程", "MathJax 渲染完成"]
log_path = Path(result["log"])
run_dir = log_path.parent
assert run_dir.exists(), run_dir
assert (run_dir / "render-diagnostic.txt").exists()
PY

PASS_COMMAND='tmp=.codex/context/test-hub/feature-chain-closed-loop.tmp; printf "CG_CHECKPOINT:公式输入进入预览流程:PASS\nCG_CHECKPOINT:MathJax 渲染完成:PASS\n" > "$tmp"; cat "$tmp"; rm -f "$tmp"'
create_chain "$ROOT_PASS" "$PASS_COMMAND"

python3 "$SCRIPT" dev-complete --root "$ROOT_PASS" >"$OUT"
grep -q "1 passed, 0 failed, 0 blocked" "$OUT"
grep -q "success artifacts cleaned" "$OUT"
test ! -e "$ROOT_PASS/.codex/context/test-hub/feature-chain-closed-loop.tmp"
if find "$ROOT_PASS/.codex/context/test-hub/runs" -mindepth 1 -maxdepth 1 2>/dev/null | grep -q .; then
  find "$ROOT_PASS/.codex/context/test-hub/runs" -mindepth 1 -maxdepth 1
  exit 1
fi

python3 - "$ROOT_PASS/.codex/context/test-hub/feature-chains.json" "$ROOT_PASS/.codex/context/test-hub/last-run.json" <<'PY'
from pathlib import Path
import json
import sys

registry = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
chain = registry["chains"][0]
covered = sorted(bc for node in chain["nodes"] for bc in node["bad_cases"])
assert covered == ["BC-20260707-118-input", "BC-20260707-118-render"]
result = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))["results"][0]
assert result["status"] == "passed"
assert result["missing_checkpoints"] == []
PY
