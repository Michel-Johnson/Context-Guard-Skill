#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${CONTEXT_GUARD_SCRIPT:-$(cd "$(dirname "$0")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-subagent-auto-chain-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT/bin"
cat >"$ROOT/bin/approved-smoke.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
test -f index.html
grep -Fq "Evening Reset" index.html
echo "CG_CHECKPOINT:approved smoke:PASS"
SH
chmod +x "$ROOT/bin/approved-smoke.sh"

cat >"$ROOT/index.html" <<'HTML'
<!doctype html>
<title>Evening Reset</title>
<main>Evening Reset</main>
HTML

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" test-hub-add \
  --root "$ROOT" \
  --title "Subagent approved smoke" \
  --command-text "./bin/approved-smoke.sh" \
  --run-policy every-dev-completion \
  --test-status approved >/dev/null

cat >"$ROOT/.codex/context/bad-cases.md" <<'MD'
### BC-20260709-810: 次日清单没有恢复待完成

- Status: resolved
- First observed: 2026-07-09
- Last checked: 2026-07-09
- Scope: 晚间收纳重置清单
- Tags: #evening-reset #persistence
- Display summary: 第二天打开页面时，昨晚完成的项目仍显示已完成。
- Phenomenon: 用户第二天进入页面，清单没有恢复到待完成状态。
- Trigger / reproduction: 完成三项清单后模拟跨天，再重新打开页面。
- Root cause: 持久化只保存勾选状态，没有保存并比较完成日期。
- Fix method: 保存完成日期，启动时发现日期变化就重置当天状态。
- Guard / verification: 应归入晚间收纳功能链，用跨天打开流程验证。
- Guard type: feature-chain
- Red condition: 跨天后仍显示已完成。
- Green condition: 跨天后清单显示待完成。
- Expected failure reason: 如果跨天重置回归，晚间收纳功能链会在恢复状态节点失败。

### BC-20260709-811: 部分完成刷新后进度丢失

- Status: resolved
- First observed: 2026-07-09
- Last checked: 2026-07-09
- Scope: 晚间收纳重置清单
- Tags: #evening-reset #persistence
- Display summary: 只完成一部分后刷新页面，已勾选项目被清空。
- Phenomenon: 用户完成两项后刷新，页面回到 0/3。
- Trigger / reproduction: 勾选两项，不点击最终完成，刷新页面。
- Root cause: 只在最终完成时写入 localStorage，未保存中间状态。
- Fix method: 每次勾选变化都保存进度。
- Guard / verification: 应归入晚间收纳功能链，用部分完成恢复节点验证。
- Guard type: feature-chain
- Red condition: 刷新后部分进度丢失。
- Green condition: 刷新后保留已勾选项目。
- Expected failure reason: 如果中间状态持久化回归，晚间收纳功能链会在部分完成节点失败。
MD

python3 "$SCRIPT" subagent-complete \
  --root "$ROOT" \
  --agent-id "agent-auto-chain-001" \
  --summary "Built the Evening Reset page and resolved persistence issues." >/tmp/subagent-auto-chain.out

grep -Fq "[context-guard] subagent handoff:" /tmp/subagent-auto-chain.out
grep -Fq "[context-guard] test hub: 1 passed, 0 failed, 0 blocked." /tmp/subagent-auto-chain.out
grep -Fq "created proposed chains: 1" /tmp/subagent-auto-chain.out
grep -Fq "next: ask the user to confirm" /tmp/subagent-auto-chain.out

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" <<'PY'
from pathlib import Path
import json
import sys

path = Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
chains = data.get("chains", [])
assert len(chains) == 1, chains
chain = chains[0]
assert chain["status"] == "proposed", chain
assert chain["run_policy"] == "every-dev-completion", chain
assert chain["auto_proposed"] is True, chain
assert chain["confirmation_required"] is True, chain
assert chain["source"] == "feature-chain-auto-propose", chain
assert chain.get("command", "") == "", chain
nodes = chain.get("nodes", [])
assert len(nodes) == 2, nodes
refs = [ref for node in nodes for ref in node.get("bad_cases", [])]
assert refs == ["BC-20260709-810", "BC-20260709-811"], refs
titles = [node.get("title", "") for node in nodes]
checks = [check for node in nodes for check in node.get("checks", [])]
assert any("次日清单没有恢复待完成" in title for title in titles), titles
assert any("部分完成刷新后进度丢失" in title for title in titles), titles
assert any("跨天打开流程" in check for check in checks), checks
assert any("部分完成恢复节点" in check for check in checks), checks
PY

python3 "$SCRIPT" dev-complete --root "$ROOT" >/tmp/subagent-auto-chain-dev-complete.out
grep -Fq "[context-guard] test hub: 1 passed, 0 failed, 0 blocked." /tmp/subagent-auto-chain-dev-complete.out
if grep -Fq "feature-chain" /tmp/subagent-auto-chain-dev-complete.out; then
  echo "proposed feature chain should not run before user approval" >&2
  exit 1
fi

cat >>"$ROOT/.codex/context/bad-cases.md" <<'MD'

### BC-20260709-812: 完成提示刷新后消失

- Status: resolved
- First observed: 2026-07-09
- Last checked: 2026-07-09
- Scope: 晚间收纳重置清单
- Tags: #evening-reset #persistence
- Display summary: 完成清单后刷新页面，完成提示没有保留。
- Phenomenon: 用户完成全部项目后刷新，页面不再显示完成提示。
- Trigger / reproduction: 勾选全部项目并刷新页面。
- Root cause: 完成提示没有和清单状态一起持久化。
- Fix method: 从持久化清单状态推导完成提示。
- Guard / verification: 应挂到已有晚间收纳功能链，而不是另建一条链。
- Guard type: feature-chain
- Red condition: 刷新后完成提示消失。
- Green condition: 刷新后仍能看到完成提示。
- Expected failure reason: 如果完成态持久化回归，晚间收纳功能链会在完成提示节点失败。
MD

python3 "$SCRIPT" subagent-complete \
  --root "$ROOT" \
  --agent-id "agent-auto-chain-002" \
  --summary "Fixed another persistence issue in the same Evening Reset flow." >/tmp/subagent-auto-chain-attach.out

grep -Fq "[context-guard] test hub: 1 passed, 0 failed, 0 blocked." /tmp/subagent-auto-chain-attach.out
grep -Fq "created proposed chains: 0" /tmp/subagent-auto-chain-attach.out
grep -Fq "attached to proposed chains: 1" /tmp/subagent-auto-chain-attach.out

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" <<'PY'
from pathlib import Path
import json
import sys

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
chains = data.get("chains", [])
assert len(chains) == 1, chains
nodes = chains[0]["nodes"]
assert len(nodes) == 3, nodes
refs = [ref for node in nodes for ref in node.get("bad_cases", [])]
assert refs == ["BC-20260709-810", "BC-20260709-811", "BC-20260709-812"], refs
titles = [node.get("title", "") for node in nodes]
checks = [check for node in nodes for check in node.get("checks", [])]
assert any("完成提示刷新后消失" in item for item in titles), titles
assert any("已有晚间收纳功能链" in item for item in checks), checks
PY
