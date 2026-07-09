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
grep -q "游戏流程存在未验证的状态风险" "$ROOT/.codex/context/bad-cases.md"

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
