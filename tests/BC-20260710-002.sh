#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="${CONTEXT_GUARD_SCRIPT:-$ROOT_DIR/scripts/context_guard.py}"
HOOK="${CONTEXT_GUARD_HOOK:-$ROOT_DIR/scripts/context_guard_hook.py}"
BASE="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-subagent-root-XXXXXX")"
trap 'rm -rf "$BASE"' EXIT
CONTROL="$BASE/control"
CHILD="$BASE/child-product"
mkdir -p "$CONTROL" "$CHILD"
CONTROL="$(realpath "$CONTROL")"
CHILD="$(realpath "$CHILD")"

cat >"$CHILD/verify.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
test -f product.txt
grep -Fq "ready" product.txt
SH
chmod +x "$CHILD/verify.sh"
printf 'ready\n' >"$CHILD/product.txt"

python3 "$SCRIPT" subagent-register \
  --root "$CONTROL" \
  --agent-id "root-agent" \
  --project-root "$CHILD" \
  --task "完善本地商品流程" >"$BASE/register.out"

grep -Fq "subagent project root: $CHILD" "$BASE/register.out"
python3 "$SCRIPT" test-hub-add \
  --root "$CHILD" \
  --title "商品流程" \
  --command-text "./verify.sh" \
  --run-policy every-dev-completion \
  --test-status approved >/dev/null

cat >"$BASE/evidence.txt" <<'TXT'
CG_BAD_CASE: 商品状态切换后没有保存
CG_PHENOMENON: 切换商品状态并刷新后，页面恢复旧状态。
CG_TRIGGER: 修改状态后刷新页面。
CG_CAUSE: 状态切换没有写入本地存储。
CG_FIX: 状态变更后立即持久化。
CG_VERIFICATION: 修改状态后刷新，仍显示新状态。
CG_SCOPE: 商品状态管理
TXT

python3 - "$CONTROL" "$BASE/evidence.txt" <<'PY' | \
  (cd "$CONTROL" && python3 "$HOOK" subagent-stop) >"$BASE/hook.out" 2>"$BASE/hook.err"
from pathlib import Path
import json
import sys

print(json.dumps({
    "agent_id": "root-agent",
    "cwd": sys.argv[1],
    "last_assistant_message": Path(sys.argv[2]).read_text(encoding="utf-8"),
}, ensure_ascii=False))
PY

grep -Fq "project root: $CHILD" "$BASE/hook.err"
grep -Fq "test hub: 1 passed, 0 failed, 0 blocked" "$BASE/hook.err"
test -f "$CHILD/.codex/context/test-hub/last-run.json"
grep -Fq "completion evidence: archived concrete bad case(s)" "$BASE/hook.err"

python3 "$SCRIPT" subagent-complete \
  --root "$CONTROL" \
  --agent-id "root-agent" \
  --evidence-file "$BASE/evidence.txt" >"$BASE/complete.out"

grep -Fq "subagent project root: $CHILD" "$BASE/complete.out"
grep -Fq "subagent completion already processed" "$BASE/complete.out"
grep -Fq "商品状态切换后没有保存" "$CHILD/.codex/context/bad-cases.md"
grep -Fq "Subagent completion handoff" "$CHILD/.codex/context/roadmap.md"
[[ "$(grep -c 'Subagent completion handoff' "$CHILD/.codex/context/roadmap.md")" == "1" ]]
[[ "$(grep -c '^### BC-' "$CHILD/.codex/context/bad-cases.md")" == "1" ]]
if grep -Fq "Subagent completion handoff" "$CONTROL/.codex/context/roadmap.md"; then
  echo "completion checkpoint leaked into the control workspace" >&2
  exit 1
fi

python3 - "$CONTROL/.codex/context/subagents/assignments.json" "$CHILD" <<'PY'
from pathlib import Path
import json
import sys

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
item = data["assignments"]["root-agent"]
assert item["project_root"] == sys.argv[2], item
assert item["status"] == "completed", item
assert item["last_test_code"] == 0, item
PY

python3 "$SCRIPT" subagent-register \
  --root "$CONTROL" \
  --agent-id "root-agent" \
  --project-root "$CHILD" \
  --task "继续下一轮商品流程" >/dev/null

python3 - "$CONTROL/.codex/context/subagents/assignments.json" <<'PY'
from pathlib import Path
import json
import sys

item = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["assignments"]["root-agent"]
assert item["status"] == "running", item
assert item["last_test_code"] == 0, item
assert item.get("last_completion_fingerprint"), item
PY

echo "BC-20260710-002 passed"
