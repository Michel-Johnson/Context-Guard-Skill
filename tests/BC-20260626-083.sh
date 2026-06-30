#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-node-detail-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" set-language --language zh --root "$ROOT" >/dev/null

CTX="$ROOT/.codex/context"
cat > "$CTX/roadmap.md" <<'MD'
# Context Roadmap

## Nodes

### NODE-20260626-001: 加入 Task Case 设计确认和 goal 阶段门控

- Date: 2026-06-26
- Status: done
- Level: major
- Branch: Main
- Parent: none
- Task: `CTX-20260626-test-chain`
- Outcome: Context Guard 要求复杂 Task Case 先给用户确认测试设计；goal 模式下把 Task Case 作为阶段门控。
- Decision / reason: 用户指出测试 case 应该是任务导向，而不是为每个 bug 造很多零散脚本。
- Avoid going back: 不要让 agent 静默创建大批未经确认的测试 case。
- Next: 继续观察 goal 模式下是否按阶段记录测试 checkpoint。
- Linked bad cases: BC-20260626-999
- Test chain: 节点详情页应显示用户问题、相关问题案例、采取方法和当前进度。
MD

cat > "$CTX/bad-cases.md" <<'MD'
# Bad Case Register

## Active Cases

### BC-20260626-999: 测试链路变成碎片化脚本

- Status: resolved
- First observed: 2026-06-26
- Last checked: 2026-06-26
- Scope: test-chain design
- Roadmap nodes: NODE-20260626-001
- Tags: #test-chain #context-bloat
- Phenomenon: agent 为每个 bug 创建零散脚本，真实任务流反而看不清。
- Trigger / reproduction: 让 agent 为多个历史 bad case 设计测试。
- Root cause: 测试链路没有以真实任务为单位组织。
- Fix method: 引入 task case 草案确认和阶段 checkpoint。
- Guard / verification: 检查节点详情页的相关问题案例和测试链路说明聚合在节点页面内。
MD

python3 "$SCRIPT" show-roadmap --root "$ROOT" >/dev/null
DETAIL="$CTX/roadmap/roadmap-details.html"

grep -q '用户提出的问题' "$DETAIL"
grep -q '相关问题案例' "$DETAIL"
grep -q '采取方法' "$DETAIL"
grep -q '当前进度' "$DETAIL"
grep -q '测试链路变成碎片化脚本' "$DETAIL"
grep -q '引入 task case 草案确认和阶段 checkpoint' "$DETAIL"

if grep -q '<h2 data-i18n="badCases">Bad Cases</h2>' "$DETAIL"; then
  echo "detail page still renders a global bad-case list instead of node-scoped sections" >&2
  exit 1
fi
