#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-feature-chain-candidates-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
OUT="$ROOT/out.txt"

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
cat >"$ROOT/.codex/context/bad-cases.md" <<'MD'
# Bad Case Register

### BC-20260707-116: Roadmap 卡片标题看不懂

- Status: resolved
- Tags: #roadmap-ux #readability
- Display summary: 路线图卡片标题像实现日志，不像用户任务。

### BC-20260707-117: Roadmap 详情页太啰嗦

- Status: resolved
- Tags: #roadmap-ux #readability
- Display summary: 点击节点后看到太多字段，无法快速理解任务。

### BC-20260707-118: Context 没有在新会话恢复

- Status: resolved
- Tags: #context-loss
- Display summary: 新会话不知道之前已经讨论过的路线。

### BC-20260707-119: Context 写到远程服务器路径

- Status: resolved
- Tags: #context-loss #remote
- Display summary: SSH 开发时 context 被写到远程路径。

### BC-20260707-120: 已覆盖的 roadmap 旧问题

- Status: resolved
- Tags: #roadmap-ux
- Display summary: 已经挂到功能链的旧路线图问题。
MD

ADD_OUTPUT="$(python3 "$SCRIPT" feature-chain-add \
  --root "$ROOT" \
  --title "路线图展示体验" \
  --entry "打开 roadmap.html" \
  --exit-check "用户能快速看懂路线图节点")"
CHAIN_ID="$(printf '%s\n' "$ADD_OUTPUT" | sed -n 's/.*feature chain: //p')"
python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$CHAIN_ID" \
  --node-title "路线图卡片可读" \
  --bad-case "BC-20260707-120" \
  --check "卡片标题能直接说明任务" >/dev/null

BEFORE="$(cat "$ROOT/.codex/context/test-hub/feature-chains.json")"
python3 "$SCRIPT" feature-chain-candidates --root "$ROOT" --min-cases 2 >"$OUT"
AFTER="$(cat "$ROOT/.codex/context/test-hub/feature-chains.json")"

grep -q "feature-chain candidates" "$OUT"
grep -q "candidate chain: 路线图展示体验 / 可读性 | 2 unassigned bad cases | new coverage: 2 | tags: #roadmap-ux, #readability" "$OUT"
grep -q "candidate chain: Context 持久化 | 2 unassigned bad cases | new coverage: 2 | tags: #context-loss" "$OUT"
grep -q "confirmation prompt: 测试创建识别" "$OUT"
grep -q "BC-20260707-116" "$OUT"
grep -q "BC-20260707-117" "$OUT"
grep -q "BC-20260707-118" "$OUT"
grep -q "BC-20260707-119" "$OUT"
if grep -q "BC-20260707-120" "$OUT"; then
  cat "$OUT"
  exit 1
fi
if grep -q "candidate chain: 路线图展示体验 | 2 unassigned bad cases | tags: #roadmap-ux" "$OUT"; then
  cat "$OUT"
  exit 1
fi
test "$BEFORE" = "$AFTER"
