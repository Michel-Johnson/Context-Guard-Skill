#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-dry-run-id-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null

cat >"$ROOT/.codex/context/bad-cases.md" <<'MD'
### BC-20260707-960: Dry-run 证据目录可能撞名

- Status: resolved
- First observed: 2026-07-07
- Last checked: 2026-07-07
- Scope: Context Guard Test Hub dry-run evidence
- Tags: #feature-chain #test-hub #artifact-policy
- Display summary: 快速连续 dry-run 不应把失败证据写到同一个目录。
- Phenomenon: 秒级 run id 可能让同一条功能链的多次 dry-run 复用同一个 evidence path。
- Trigger / reproduction: 快速连续运行两次失败的 `feature-chain-dry-run`。
- Root cause: dry-run 目录名只使用秒级时间戳。
- Fix method: dry-run/run 目录名改用微秒级唯一 run id。
- Guard / verification: 快速连续失败 dry-run 应保留两个不同 evidence 目录。
- Red condition: 两次失败 dry-run 输出相同 evidence preserved 路径。
- Green condition: 两次失败 dry-run 输出不同 evidence preserved 路径，且目录都存在。
- Expected failure reason: 证据路径撞名会覆盖或混杂失败日志，让 Codex 误判坏在哪个 checkpoint。
MD

PROPOSE_OUT="$ROOT/propose.out"
python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "Markdown 公式预览" \
  --entry "输入 Markdown 公式" \
  --exit-check "预览渲染公式" \
  --node-title "公式预览完成渲染" \
  --bad-cases "BC-20260707-960" \
  --check "公式预览必须完成渲染" >"$PROPOSE_OUT"

CHAIN_ID="$(grep 'feature chain proposed:' "$PROPOSE_OUT" | awk '{print $NF}')"
test -n "$CHAIN_ID"

set +e
python3 "$SCRIPT" feature-chain-dry-run \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --command-text "printf 'CG_CHECKPOINT:公式预览完成渲染:FAIL:第一次失败\\n'" >"$ROOT/fail-1.out" 2>&1
STATUS_ONE=$?
python3 "$SCRIPT" feature-chain-dry-run \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --command-text "printf 'CG_CHECKPOINT:公式预览完成渲染:FAIL:第二次失败\\n'" >"$ROOT/fail-2.out" 2>&1
STATUS_TWO=$?
set -e

test "$STATUS_ONE" -ne 0
test "$STATUS_TWO" -ne 0

DIR_ONE="$(sed -n 's/.*dry-run evidence preserved: //p' "$ROOT/fail-1.out" | tail -n 1)"
DIR_TWO="$(sed -n 's/.*dry-run evidence preserved: //p' "$ROOT/fail-2.out" | tail -n 1)"
test -n "$DIR_ONE"
test -n "$DIR_TWO"
test "$DIR_ONE" != "$DIR_TWO"
test -d "$DIR_ONE"
test -d "$DIR_TWO"

grep -q "第一次失败" "$DIR_ONE/$CHAIN_ID.log"
grep -q "第二次失败" "$DIR_TWO/$CHAIN_ID.log"

python3 "$SCRIPT" validate-feature-chains --root "$ROOT" >"$ROOT/validate.out"
grep -q "feature-chain validation passed: 1 chain(s), 0 warning(s)" "$ROOT/validate.out"
