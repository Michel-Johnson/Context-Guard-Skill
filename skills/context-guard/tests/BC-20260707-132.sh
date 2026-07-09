#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-rerun-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
mkdir -p "$ROOT/.codex/context/test-hub/fixtures"

cat >"$ROOT/.codex/context/bad-cases.md" <<'MD'
### BC-20260707-950: Markdown 公式输入没有进入预览流程

- Status: resolved
- First observed: 2026-07-07
- Last checked: 2026-07-07
- Scope: Markdown editor preview
- Tags: #feature-chain #mathjax #input
- Display summary: 公式输入后预览流程没有被触发。
- Phenomenon: 用户输入公式后，预览仍停在旧内容。
- Trigger / reproduction: 在编辑器输入包含公式的 Markdown。
- Root cause: 输入事件没有触发预览更新。
- Fix method: 预览链路监听输入并进入渲染流程。
- Guard / verification: 功能链 checkpoint 检查公式输入进入预览流程。
- Red condition: 输入公式后预览流程没有执行。
- Green condition: 输入公式后预览流程开始并进入渲染阶段。
- Expected failure reason: 输入阶段回归时，功能链第一 checkpoint 会失败。

### BC-20260707-951: Markdown 公式预览仍显示原始文本

- Status: resolved
- First observed: 2026-07-07
- Last checked: 2026-07-07
- Scope: Markdown editor preview
- Tags: #feature-chain #mathjax #rendering
- Display summary: 公式预览没有完成 MathJax 渲染。
- Phenomenon: 预览区显示原始 LaTeX 文本，而不是排版后的公式。
- Trigger / reproduction: 输入单行、多行或矩阵公式并打开预览。
- Root cause: 渲染阶段没有执行 MathJax 排版。
- Fix method: 预览更新后执行 MathJax typeset。
- Guard / verification: 功能链 checkpoint 检查公式预览已渲染。
- Red condition: 预览仍显示原始公式文本。
- Green condition: 预览显示排版后的公式。
- Expected failure reason: 渲染阶段回归时，功能链第二 checkpoint 会失败。
MD

PROPOSE_OUT="$ROOT/propose.out"
python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "Markdown 公式预览" \
  --entry "编辑器输入 Markdown 公式" \
  --exit-check "预览区显示排版后的公式" \
  --node-title "公式输入进入预览流程" \
  --bad-cases "BC-20260707-950" \
  --check "输入公式后预览流程必须开始" >"$PROPOSE_OUT"

CHAIN_ID="$(grep 'feature chain proposed:' "$PROPOSE_OUT" | awk '{print $NF}')"
test -n "$CHAIN_ID"

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "公式预览完成渲染" \
  --bad-case "BC-20260707-951" \
  --check "单行、多行和矩阵公式都必须完成 MathJax 排版" >/dev/null

RUNNER="$ROOT/.codex/context/test-hub/fixtures/markdown_formula_flow.sh"
cat >"$RUNNER" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "CG_CHECKPOINT:公式输入进入预览流程:PASS"
echo "CG_CHECKPOINT:公式预览完成渲染:PASS"
SH
chmod +x "$RUNNER"

python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --command-text "bash .codex/context/test-hub/fixtures/markdown_formula_flow.sh" >"$ROOT/approve.out"
grep -q "approval dry-run: passed" "$ROOT/approve.out"

cat >"$RUNNER" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "CG_CHECKPOINT:公式输入进入预览流程:PASS"
echo "CG_CHECKPOINT:公式预览完成渲染:FAIL:预览仍显示原始公式文本"
printf "raw formula still visible\n" > "$CONTEXT_GUARD_TEST_RUN_DIR/render-evidence.txt"
SH
chmod +x "$RUNNER"

if python3 "$SCRIPT" dev-complete --root "$ROOT" >"$ROOT/fail.out" 2>&1; then
  cat "$ROOT/fail.out"
  exit 1
fi
grep -q "test hub: 0 passed, 1 failed, 0 blocked" "$ROOT/fail.out"
grep -q "checkpoint failed: 公式预览完成渲染 - 预览仍显示原始公式文本" "$ROOT/fail.out"
grep -q "evidence preserved" "$ROOT/fail.out"

python3 - "$ROOT/.codex/context/test-hub/last-run.json" <<'PY'
from pathlib import Path
import json
import sys

run = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
result = run["results"][0]
assert result["status"] == "failed", result
assert result["reason"] == "checkpoint failed: 公式预览完成渲染 - 预览仍显示原始公式文本", result
labels = [item["label"] for item in result["checkpoints"]]
assert labels == ["公式输入进入预览流程", "公式预览完成渲染"], labels
log_path = Path(result["log"])
assert log_path.exists(), log_path
evidence = log_path.parent / "render-evidence.txt"
assert evidence.exists(), evidence
assert "raw formula" in evidence.read_text(encoding="utf-8")
PY

cat >"$RUNNER" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "CG_CHECKPOINT:公式输入进入预览流程:PASS"
echo "CG_CHECKPOINT:公式预览完成渲染:PASS"
printf "temporary success artifact\n" > "$CONTEXT_GUARD_TEST_RUN_DIR/success.tmp"
SH
chmod +x "$RUNNER"

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$ROOT/pass.out"
grep -q "test hub: 1 passed, 0 failed, 0 blocked" "$ROOT/pass.out"
grep -q "success artifacts cleaned" "$ROOT/pass.out"

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" "$ROOT/.codex/context/test-hub/last-run.json" "$CHAIN_ID" <<'PY'
from pathlib import Path
import json
import sys

chains = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["chains"]
chain = next(item for item in chains if item["id"] == sys.argv[3])
assert chain["status"] == "approved", chain
assert chain["run_policy"] == "every-dev-completion", chain
covered = sorted(bc for node in chain["nodes"] for bc in node["bad_cases"])
assert covered == ["BC-20260707-950", "BC-20260707-951"], covered

last_run = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
result = last_run["results"][0]
assert result["status"] == "passed", result
assert result["missing_checkpoints"] == [], result
assert all(item["status"] == "pass" for item in result["checkpoints"]), result
PY

python3 "$SCRIPT" validate-feature-chains --root "$ROOT" >"$ROOT/validate.out"
grep -q "feature-chain validation passed: 1 chain(s), 0 warning(s)" "$ROOT/validate.out"
