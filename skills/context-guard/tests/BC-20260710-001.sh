#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${CONTEXT_GUARD_SCRIPT:-$(cd "$(dirname "$0")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-completion-evidence-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
cat >"$ROOT/evidence.txt" <<'TXT'
完成了跨空间移动和复制功能。
CG_BAD_CASE: 跨空间移动会误删同名物品
CG_PHENOMENON: 把一个物品移动到另一个空间时，源空间里名称相同但 ID 不同的物品也会被删除。
CG_TRIGGER: 在源空间建立两个同名物品，只移动其中一个。
CG_CAUSE: 删除源数据时使用名称匹配，而不是本次移动记录的物品 ID。
CG_FIX: 移动完成后只按本次移动成功的 item.id 删除源物品。
CG_VERIFICATION: 建立两个同名物品后移动其中一个，目标空间新增一项，源空间仍保留另一项。
CG_SCOPE: 跨空间复制与移动
TXT

python3 "$SCRIPT" subagent-complete \
  --root "$ROOT" \
  --agent-id "evidence-agent" \
  --summary "完成跨空间移动功能。" \
  --evidence-file "$ROOT/evidence.txt" >"$ROOT/first.out"

grep -Fq "completion evidence: archived concrete bad case(s)" "$ROOT/first.out"
grep -Fq "跨空间移动会误删同名物品" "$ROOT/.codex/context/bad-cases.md"
grep -Fq -- "- Status: resolved" "$ROOT/.codex/context/bad-cases.md"
grep -Fq "只按本次移动成功的 item.id 删除源物品" "$ROOT/.codex/context/bad-cases.md"
if grep -Fq "risk-audit" "$ROOT/.codex/context/bad-cases.md"; then
  echo "concrete completion evidence must win over generic risk audit" >&2
  exit 1
fi

python3 "$SCRIPT" subagent-complete \
  --root "$ROOT" \
  --agent-id "evidence-agent" \
  --summary "完成跨空间移动功能。" \
  --evidence-file "$ROOT/evidence.txt" >"$ROOT/repeat.out"

grep -Fq "subagent completion already processed" "$ROOT/repeat.out"
[[ "$(grep -c '^### BC-' "$ROOT/.codex/context/bad-cases.md")" == "1" ]]
[[ "$(grep -c 'Subagent completion handoff' "$ROOT/.codex/context/roadmap.md")" == "1" ]]

NATURAL_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-natural-evidence-XXXXXX")"
trap 'rm -rf "$ROOT" "$NATURAL_ROOT"' EXIT
python3 "$SCRIPT" init --root "$NATURAL_ROOT" >/dev/null
python3 "$SCRIPT" subagent-complete \
  --root "$NATURAL_ROOT" \
  --agent-id "natural-evidence-agent" \
  --summary "修复了跨空间移动会按名称误删同名物品的问题，改为按 item.id 精确删除；验证两个同名物品只移动目标项。" \
  >"$NATURAL_ROOT/out.txt"

grep -Fq "completion evidence: archived concrete bad case(s)" "$NATURAL_ROOT/out.txt"
grep -Fq "跨空间移动会按名称误删同名物品" "$NATURAL_ROOT/.codex/context/bad-cases.md"
if grep -Fq "risk-audit" "$NATURAL_ROOT/.codex/context/bad-cases.md"; then
  echo "natural concrete repair evidence must not become generic risk audit" >&2
  exit 1
fi

echo "BC-20260710-001 passed"
