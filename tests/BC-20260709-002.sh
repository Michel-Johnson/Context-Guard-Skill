#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${CONTEXT_GUARD_SCRIPT:-$(cd "$(dirname "$0")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-subagent-complete-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT/bin"
cat >"$ROOT/bin/subagent-smoke.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "CG_CHECKPOINT:subagent smoke:PASS"
SH
chmod +x "$ROOT/bin/subagent-smoke.sh"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" test-hub-add \
  --root "$ROOT" \
  --title "Subagent smoke approved test" \
  --command-text "./bin/subagent-smoke.sh" \
  --run-policy every-dev-completion \
  --test-status approved >/dev/null

python3 "$SCRIPT" subagent-complete \
  --root "$ROOT" \
  --agent-id "agent-smoke-001" \
  --summary "Created a small static page and completed local validation." >/tmp/subagent-complete.out

grep -Fq "[context-guard] subagent handoff:" /tmp/subagent-complete.out
grep -Fq "[context-guard] test hub: 1 passed, 0 failed, 0 blocked." /tmp/subagent-complete.out
test -f "$ROOT/.codex/context/subagents.md"
test -f "$ROOT/.codex/context/test-hub/last-run.json"
grep -Fq "agent-smoke-001" "$ROOT/.codex/context/subagents.md"
grep -Fq "Subagent completion handoff" "$ROOT/.codex/context/roadmap.md"

python3 - "$ROOT/.codex/context/test-hub/last-run.json" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text())
results = data.get("results", [])
assert len(results) == 1, results
assert results[0].get("status") == "passed", results
PY

cat >"$ROOT/bin/subagent-smoke.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "CG_CHECKPOINT:subagent smoke:FAIL:forced failure"
exit 1
SH
chmod +x "$ROOT/bin/subagent-smoke.sh"

if python3 "$SCRIPT" subagent-complete \
  --root "$ROOT" \
  --agent-id "agent-smoke-002" \
  --summary "Forced failing handoff." >/tmp/subagent-complete-fail.out 2>&1; then
  echo "subagent-complete should fail when approved Test Hub tests fail" >&2
  exit 1
fi
grep -Fq "[context-guard] test hub: 0 passed, 1 failed, 0 blocked." /tmp/subagent-complete-fail.out
grep -Fq "[context-guard] evidence preserved:" /tmp/subagent-complete-fail.out
