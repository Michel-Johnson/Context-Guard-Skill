#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
HOOK="$(cd "$(dirname "$SCRIPT")" && pwd)/context_guard_hook.py"
SMALL_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-auto-chain-small-XXXXXX")"
LARGE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-auto-chain-large-XXXXXX")"
trap 'rm -rf "$SMALL_ROOT" "$LARGE_ROOT"' EXIT

python3 "$SCRIPT" init --root "$SMALL_ROOT" >/dev/null
cat >"$SMALL_ROOT/.codex/context/bad-cases.md" <<'MD'
### BC-20260708-970: 次日没有自动重置

- Status: resolved
- First observed: 2026-07-08
- Last checked: 2026-07-08
- Scope: 晚间收纳重置清单
- Tags: #life #reset
- Display summary: 第二天打开清单时必须恢复为未完成状态。
- Phenomenon: 昨天完成后，今天打开仍显示已完成。
- Trigger / reproduction: 完成清单后把日期切到第二天再打开页面。
- Root cause: 日期变化没有触发状态重置。
- Fix method: 启动时比较日期并重置勾选状态。
- Guard / verification: 自动功能链草案应把该问题归入收纳重置流程。
- Red condition: 跨天后仍显示已完成。
- Green condition: 跨天后清单恢复未完成。
- Expected failure reason: 次日重置回归时，收纳重置功能链会失败。

### BC-20260708-971: 连续天数被错误清零

- Status: resolved
- First observed: 2026-07-08
- Last checked: 2026-07-08
- Scope: 晚间收纳重置清单
- Tags: #life #reset
- Display summary: 第二天未完成前不能清零连续天数。
- Phenomenon: 用户第二天刚打开页面，连续完成天数立刻归零。
- Trigger / reproduction: 昨天完成清单，今天打开但还没操作。
- Root cause: 重置勾选状态时误清空 streak。
- Fix method: 只重置当天勾选，不在未完成前清空 streak。
- Guard / verification: 自动功能链草案应把该问题归入收纳重置流程。
- Red condition: 次日打开立刻清零 streak。
- Green condition: 次日未完成前保留昨天 streak。
- Expected failure reason: 连续天数逻辑回归时，收纳重置功能链会失败。
MD

(cd "$SMALL_ROOT" && printf '{"cwd":"%s"}' "$SMALL_ROOT" | python3 "$HOOK" stop >/tmp/context-guard-hook-small.out 2>/tmp/context-guard-hook-small.err)
grep -q "created proposed chains: 1" /tmp/context-guard-hook-small.err
grep -q "next: ask the user to confirm" /tmp/context-guard-hook-small.err

python3 - "$SMALL_ROOT/.codex/context/test-hub/feature-chains.json" <<'PY'
from pathlib import Path
import json
import sys

path = Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
chains = data.get("chains", [])
assert len(chains) == 1, chains
chain = chains[0]
assert chain["status"] == "proposed", chain
assert chain["auto_proposed"] is True, chain
assert chain["confirmation_required"] is True, chain
assert not chain.get("command"), chain
assert chain["source"] == "feature-chain-auto-propose", chain
refs = chain["nodes"][0]["bad_cases"]
assert refs == ["BC-20260708-970", "BC-20260708-971"], refs
checks = chain["nodes"][0].get("checks", [])
assert checks and "次日没有自动重置" in checks[0], chain["nodes"][0]
PY

python3 "$SCRIPT" validate-feature-chains --root "$SMALL_ROOT" >"$SMALL_ROOT/feature-chain-validation.out"
grep -q "0 warning" "$SMALL_ROOT/feature-chain-validation.out"

python3 "$SCRIPT" dev-complete --root "$SMALL_ROOT" >"$SMALL_ROOT/dev-complete.out"
grep -q "no approved every-dev-completion tests" "$SMALL_ROOT/dev-complete.out"

(cd "$SMALL_ROOT" && printf '{"cwd":"%s"}' "$SMALL_ROOT" | python3 "$HOOK" stop >/tmp/context-guard-hook-small-second.out 2>/tmp/context-guard-hook-small-second.err)
python3 - "$SMALL_ROOT/.codex/context/test-hub/feature-chains.json" <<'PY'
from pathlib import Path
import json
import sys

chains = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")).get("chains", [])
assert len(chains) == 1, chains
PY

python3 "$SCRIPT" init --root "$LARGE_ROOT" >/dev/null
{
  for idx in $(seq -w 1 13); do
    printf '### BC-20260708-9%s: 历史问题 %s\n\n' "$idx" "$idx"
    printf -- '- Status: resolved\n- Tags: #legacy #bulk\n- Display summary: 历史问题 %s。\n- Phenomenon: 历史记录。\n- Guard / verification: 历史验证。\n- Red condition: 历史红线。\n- Green condition: 历史绿线。\n- Expected failure reason: 历史失败原因。\n\n' "$idx"
  done
} >"$LARGE_ROOT/.codex/context/bad-cases.md"

(cd "$LARGE_ROOT" && printf '{"cwd":"%s"}' "$LARGE_ROOT" | python3 "$HOOK" stop >/tmp/context-guard-hook-large.out 2>/tmp/context-guard-hook-large.err)
grep -q "historical baseline established: 13 bad cases" /tmp/context-guard-hook-large.err
test ! -f "$LARGE_ROOT/.codex/context/test-hub/feature-chains.json"
python3 - "$LARGE_ROOT/.codex/context/test-hub/feature-chain-auto-state.json" <<'PY'
from pathlib import Path
import json
import sys

state = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert len(state.get("seen_bad_cases", [])) == 13, state
PY
