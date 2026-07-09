#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${CONTEXT_GUARD_SCRIPT:-$(cd "$(dirname "$0")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-loose-bc-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT/bin"
cat >"$ROOT/bin/smoke.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
test -f index.html
grep -Fq "Evening Reset" index.html
SH
chmod +x "$ROOT/bin/smoke.sh"

cat >"$ROOT/index.html" <<'HTML'
<!doctype html>
<title>Evening Reset</title>
<main>Evening Reset</main>
HTML

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" test-hub-add \
  --root "$ROOT" \
  --title "Loose bad-case smoke" \
  --command-text "./bin/smoke.sh" \
  --run-policy every-dev-completion \
  --test-status approved >/dev/null

cat >"$ROOT/.codex/context/bad-cases.md" <<'MD'
# Bad Case Register

## Active Cases

- BC-20260709-901 | 状态：resolved | 标签：日期切换, localStorage
  - 现象：第二天打开页面时仍沿用前一天完成状态。
  - 触发：localStorage 只保存勾选状态，不比较日期。
  - 修复：保存日期并在跨天时重置当天状态。
  - 验证：跨天打开后清单恢复待完成。
- BC-20260709-902 | 状态: resolved | 标题: 部分完成刷新后进度丢失
  - 现象: 勾选两项后刷新，进度回到 0。
  - 触发: 只在最终完成时写入 localStorage。
  - 修复: 每次勾选变化都保存进度。
  - 验证: 刷新后保留已勾选项目。
  - 标签: 日期切换, localStorage
MD

python3 "$SCRIPT" subagent-complete \
  --root "$ROOT" \
  --agent-id "loose-bc-agent" \
  --summary "Subagent wrote loose bad-case register entries." >/tmp/context-guard-loose-bc.out

grep -Fq "[context-guard] test hub: 1 passed, 0 failed, 0 blocked." /tmp/context-guard-loose-bc.out
grep -Fq "created proposed chains: 1" /tmp/context-guard-loose-bc.out

python3 - "$ROOT/.codex/context/test-hub/feature-chains.json" <<'PY'
from pathlib import Path
import json
import sys

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
chains = data.get("chains", [])
assert len(chains) == 1, chains
chain = chains[0]
assert chain["status"] == "proposed", chain
assert chain["confirmation_required"] is True, chain
nodes = chain["nodes"]
assert len(nodes) == 2, nodes
refs = [ref for node in nodes for ref in node.get("bad_cases", [])]
assert refs == ["BC-20260709-901", "BC-20260709-902"], nodes
titles = [node.get("title", "") for node in nodes]
checks = [check for node in nodes for check in node.get("checks", [])]
assert any("部分完成刷新后进度丢失" in item for item in titles), nodes
assert any("刷新后保留已勾选项目" in item for item in checks), nodes
PY
