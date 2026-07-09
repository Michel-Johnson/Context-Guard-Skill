#!/usr/bin/env bash
set -euo pipefail

SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${1:-$SKILL_ROOT/scripts/context_guard.py}"
HOOK="$(cd "$(dirname "$SCRIPT")" && pwd)/context_guard_hook.py"
HOOKS_TEMPLATE="$SKILL_ROOT/hooks.json"
if [[ ! -f "$HOOKS_TEMPLATE" ]]; then
  HOOKS_TEMPLATE="$SKILL_ROOT/../../hooks.json"
fi
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-subagent-hooks-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 - "$HOOKS_TEMPLATE" <<'PY'
from pathlib import Path
import json
import sys

hooks = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["hooks"]
assert "SubagentStart" in hooks, hooks.keys()
assert "SubagentStop" in hooks, hooks.keys()

def has_event(event, token):
    return any(
        token in hook.get("command", "")
        for group in hooks[event]
        for hook in group.get("hooks", [])
    )

assert has_event("SubagentStart", "subagent-start"), hooks["SubagentStart"]
assert has_event("SubagentStop", "subagent-stop"), hooks["SubagentStop"]
PY

(cd "$ROOT" && printf '{"cwd":"%s"}' "$ROOT" | python3 "$HOOK" subagent-start >"$ROOT/subagent-start.out" 2>"$ROOT/subagent-start.err")
grep -q "subagent context" "$ROOT/subagent-start.err"
test -f "$ROOT/.codex/context/index.md"
test -f "$ROOT/.codex/context/roadmap.md"

mkdir -p "$ROOT/.codex/context/test-hub"
cat >"$ROOT/.codex/context/test-hub/subagent-pass.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'subagent test passed\n'
SH
chmod +x "$ROOT/.codex/context/test-hub/subagent-pass.sh"

python3 "$SCRIPT" test-hub-add \
  --root "$ROOT" \
  --title "Subagent 完成冒烟测试" \
  --command-text "bash .codex/context/test-hub/subagent-pass.sh" >/dev/null

(cd "$ROOT" && printf '{"cwd":"%s"}' "$ROOT" | python3 "$HOOK" subagent-stop >"$ROOT/subagent-stop.out" 2>"$ROOT/subagent-stop.err")
grep -q "SubagentStop checkpoint" "$ROOT/subagent-stop.err"
grep -q "test hub: 1 passed, 0 failed, 0 blocked" "$ROOT/subagent-stop.err"
grep -q "final answer must include Test Hub summary: all approved tests passed (1 passed, 0 failed, 0 blocked)" "$ROOT/subagent-stop.err"
test -f "$ROOT/.codex/context/test-hub/last-run.json"
python3 - "$ROOT/.codex/context/test-hub/last-run.json" <<'PY'
from pathlib import Path
import json
import sys

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
statuses = [item["status"] for item in data["results"]]
assert statuses == ["passed"], data
PY

cat >"$ROOT/.codex/context/test-hub/subagent-pass.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'subagent test failed\n'
exit 3
SH
chmod +x "$ROOT/.codex/context/test-hub/subagent-pass.sh"

(cd "$ROOT" && printf '{"cwd":"%s"}' "$ROOT" | python3 "$HOOK" subagent-stop >"$ROOT/subagent-stop-fail.out" 2>"$ROOT/subagent-stop-fail.err" || true)
grep -q "test hub: 0 passed, 1 failed, 0 blocked" "$ROOT/subagent-stop-fail.err"
grep -q "TEST HUB BLOCKER" "$ROOT/subagent-stop-fail.err"
grep -Eq '"decision"[[:space:]]*:[[:space:]]*"block"' "$ROOT/subagent-stop-fail.out"
test -d "$ROOT/.codex/context/test-hub/runs"
