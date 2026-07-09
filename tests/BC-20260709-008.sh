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

ROOT_LEGACY="$(mktemp -d "${TMPDIR:-/tmp}/cg-risk-audit-legacy-chain.XXXXXX")"
trap 'rm -rf "$ROOT" "$ROOT_LOW" "$ROOT_LEGACY"' EXIT
python3 "$SCRIPT" init --root "$ROOT_LEGACY" >/dev/null
mkdir -p "$ROOT_LEGACY/.codex/context/test-hub"
cat >"$ROOT_LEGACY/.codex/context/bad-cases.md" <<'MD'
# Bad Case Register

## Active Cases

### BC-20260709-101: 状态切换风险未验证

- Status: open
- Scope: 状态切换
- Tags: #状态流程 #回放 #risk-audit #subagent
- Display summary: Subagent 本轮开发涉及状态切换和回放，但没有对应功能链节点。
- Phenomenon: 练习模式和普通模式来回切换后状态可能串线。
- Trigger / reproduction: 切换练习模式后退出，再继续普通模式。
- Guard / verification: 运行游戏入口，检查练习模式和普通模式状态互不污染。

### BC-20260709-102: 重置撤销风险未验证

- Status: open
- Scope: 状态切换
- Tags: #状态流程 #重置 #risk-audit #subagent
- Display summary: Subagent 本轮开发涉及重置撤销，但没有对应功能链节点。
- Phenomenon: 重置确认取消后仍可能清空游戏进度。
- Trigger / reproduction: 点击重置全部进度，再取消确认。
- Guard / verification: 运行游戏入口，检查取消重置后进度仍保留。
MD
cat >"$ROOT_LEGACY/.codex/context/test-hub/feature-chains.json" <<'JSON'
{
  "version": 1,
  "chains": [
    {
      "id": "FC-20260709-001",
      "title": "Context Guard subagent completion risk audit",
      "status": "proposed",
      "run_policy": "every-dev-completion",
      "entry": "触发内部审计",
      "exit_check": "内部审计通过",
      "command": "",
      "timeout_seconds": 300,
      "artifact_policy": "cleanup-on-pass",
      "resource": "local",
      "created": "2026-07-09",
      "source": "feature-chain-auto-propose",
      "auto_proposed": true,
      "auto_group_key": "#risk-audit|#subagent",
      "confirmation_required": true,
      "nodes": [
        {
          "id": "FC-20260709-001-N1",
          "title": "状态切换风险未验证",
          "bad_cases": ["BC-20260709-101"],
          "checks": ["检查练习模式和普通模式状态互不污染"]
        },
        {
          "id": "FC-20260709-001-N2",
          "title": "重置撤销风险未验证",
          "bad_cases": ["BC-20260709-102"],
          "checks": ["检查取消重置后进度仍保留"]
        }
      ]
    }
  ]
}
JSON

python3 "$SCRIPT" feature-chain-auto-propose --root "$ROOT_LEGACY" >/tmp/risk-audit-legacy-refresh.out

python3 - "$ROOT_LEGACY/.codex/context/test-hub/feature-chains.json" <<'PY'
from pathlib import Path
import json
import sys

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
chain = data["chains"][0]
assert chain["title"] == "状态切换", chain
assert "risk-audit" not in chain.get("auto_group_key", ""), chain
assert "subagent" not in chain.get("auto_group_key", ""), chain
assert "#状态流程" in chain.get("auto_group_key", ""), chain
assert chain["entry"] == "触发「状态切换」相关用户流程", chain
assert chain["exit_check"] == "「状态切换」相关结果保持用户可见的正确状态", chain
PY
