#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/cg-risk-audit.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

SCRIPT="/Users/bytedance/.agents/skills/context-guard/scripts/context_guard.py"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

python3 "$SCRIPT" subagent-complete \
  --root "$ROOT" \
  --agent-id "risk-audit-smoke" \
  --summary "加入练习模式、关闭倒计时选项、失败复盘里的逐步回放，以及最高分重置确认；smoke 通过。" \
  >"$ROOT/out-risk.txt"

grep -q "risk audit: created bad-case candidate" "$ROOT/out-risk.txt"
grep -q "risk-audit" "$ROOT/.codex/context/bad-cases.md"
grep -q "游戏流程.*未验证" "$ROOT/.codex/context/bad-cases.md"

python3 "$SCRIPT" subagent-complete \
  --root "$ROOT" \
  --agent-id "risk-audit-duplicate" \
  --summary "加入练习模式、关闭倒计时选项、失败复盘里的逐步回放，以及最高分重置确认；smoke 通过。" \
  >"$ROOT/out-duplicate.txt"

grep -q "risk audit: no new bad-case candidate" "$ROOT/out-duplicate.txt"
if [[ "$(grep -c '^### BC-' "$ROOT/.codex/context/bad-cases.md")" != "1" ]]; then
  echo "duplicate risk-audit summary should not create a second similar bad case" >&2
  exit 1
fi

python3 "$SCRIPT" subagent-complete \
  --root "$ROOT" \
  --agent-id "risk-audit-same-tags-new-step" \
  --summary "继续加入关卡包切换和暂停恢复，失败后展示本轮序列复盘；smoke 通过。" \
  >"$ROOT/out-same-tags-new-step.txt"

grep -q "risk audit: created bad-case candidate" "$ROOT/out-same-tags-new-step.txt"
if [[ "$(grep -c '^### BC-' "$ROOT/.codex/context/bad-cases.md")" != "2" ]]; then
  echo "same-tag but different long-flow step should create another bad case candidate" >&2
  exit 1
fi

python3 "$SCRIPT" subagent-complete \
  --root "$ROOT" \
  --agent-id "risk-audit-distinct" \
  --summary "加入复制结果和导出 Markdown，空输入时显示校验提示；smoke 通过。" \
  >"$ROOT/out-distinct.txt"

grep -q "risk audit: created bad-case candidate" "$ROOT/out-distinct.txt"
if [[ "$(grep -c '^### BC-' "$ROOT/.codex/context/bad-cases.md")" != "3" ]]; then
  echo "distinct risk-audit summary should create a second bad case candidate" >&2
  exit 1
fi

python3 "$SCRIPT" subagent-complete \
  --root "$ROOT" \
  --agent-id "risk-audit-edit-isolation" \
  --summary "新增角色小队的章节计划，重生成单章时不影响其他章节，导出 Markdown 包含章节计划；smoke 通过。" \
  >"$ROOT/out-edit-isolation.txt"

grep -q "risk audit: created bad-case candidate" "$ROOT/out-edit-isolation.txt"
grep -q "局部隔离" "$ROOT/.codex/context/bad-cases.md"
if [[ "$(grep -c '^### BC-' "$ROOT/.codex/context/bad-cases.md")" != "4" ]]; then
  echo "long-flow edit isolation should create a risk-audit bad case candidate" >&2
  exit 1
fi

ROOT_LOW="$(mktemp -d "${TMPDIR:-/tmp}/cg-risk-audit-low.XXXXXX")"
trap 'rm -rf "$ROOT" "$ROOT_LOW"' EXIT
python3 "$SCRIPT" init --root "$ROOT_LOW" >/dev/null
python3 "$SCRIPT" subagent-complete \
  --root "$ROOT_LOW" \
  --agent-id "risk-audit-low" \
  --summary "更新 README 文案并修正两个错别字；smoke 通过。" \
  >"$ROOT_LOW/out-low.txt"

grep -q "risk audit: no new bad-case candidate" "$ROOT_LOW/out-low.txt"
if grep -q "risk-audit" "$ROOT_LOW/.codex/context/bad-cases.md"; then
  echo "low-risk summary should not create risk-audit bad case" >&2
  exit 1
fi
