#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-/Users/bytedance/.agents/skills/context-guard/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-marker-test-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" set-language --language zh --root "$ROOT" >/dev/null

CTX="$ROOT/.codex/context"
cat > "$CTX/roadmap.md" <<'MD'
# Context Roadmap

## Nodes

### NODE-20260618-001: 标记测试节点

- Date: 2026-06-18
- Status: done
- Level: major
- Branch: Main
- Parent: none
- Task: `CTX-20260618-marker`
- Outcome: 检查问题案例标题行标记布局。
- Decision / reason: 标记不能单独占一行。
- Avoid going back: 不要把状态点放在标题前面。
- Next: none
- Linked bad cases: BC-20260618-999
- Test chain: none
MD

cat > "$CTX/bad-cases.md" <<'MD'
# Bad Case Register

## Active Cases

### BC-20260618-999: 这是一个很长的问题案例标题用于触发换行但标记不能单独成行

- Status: resolved
- First observed: 2026-06-18
- Last checked: 2026-06-18
- Scope: roadmap marker layout
- Context task: `CTX-20260618-marker`
- Roadmap nodes: NODE-20260618-001
- Tags: #roadmap-ux
- Frequency: repeated-2
- Phenomenon: 状态点和频率点不应该单独一行。
- Trigger / reproduction: 生成 roadmap 并检查 badcase-head。
- Root cause: 标记位于标题前，窄列时容易变成单独一行。
- Fix method: 将标记移到标题右侧的 inline marker 容器。
- Guard / verification: 本脚本检查 HTML 结构。
- Reusable guard path: none
- Test chain: none
MD

python3 "$SCRIPT" show-roadmap --root "$ROOT" >/dev/null
HTML="$CTX/roadmap/roadmap.html"

grep -q 'class="badcase-markers"' "$HTML"
grep -q '.badcase-head { display: grid; grid-template-columns: minmax(0, 1fr) auto;' "$HTML"
if grep -q '<div class="badcase-head"><span class="status-dot' "$HTML"; then
  echo "badcase marker still starts a separate title row" >&2
  exit 1
fi
grep -q '<a class="detail-link" href="#case-1">' "$HTML"
