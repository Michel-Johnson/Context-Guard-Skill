#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-single-route-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" set-language --language zh --root "$ROOT" >/dev/null

CTX="$ROOT/.codex/context"
cat > "$CTX/roadmap.md" <<'MD'
# Context Roadmap

## Nodes

### NODE-20260630-001: 收敛到模型记忆定位问题

- Date: 2026-06-30
- Status: done
- Level: major
- Branch: Main
- User request: 用户明确核心研究问题是模型的哪些层或部分能够记住目标数据，而不是训练流程本身。
- Outcome: 用户明确核心研究问题是模型的哪些层或部分能够记住目标数据，需要让路线图摘要完整可读。
- Next: 继续推进单主线。
- Linked bad cases: none

### NODE-20260630-002: 完成本地按需启动聊天原型

- Date: 2026-06-30
- Status: done
- Level: major
- Branch: Main
- User request: 用户希望完成本地 Web 聊天原型，并把相关问题案例和测试链路挂到节点下。
- Outcome: 创建了本地 Web 聊天原型，前端页面可调用 Qwen3-1.7B-Base。
- Next: 观察 worker 长时间运行问题。
- Linked bad cases: BC-20260630-001, BC-20260630-002
MD

cat > "$CTX/bad-cases.md" <<'MD'
# Bad Case Register

### BC-20260630-001: Base 模型回复重复对话模板
- Status: resolved
- Roadmap nodes: NODE-20260630-002
- Tags: #chat #model
- Phenomenon: Base 模型可能重复输出对话模板。
- Guard / verification: 运行短聊天请求，确认不会重复 continued chat transcript。

### BC-20260630-002: 默认生成长度导致 worker 长时间运行
- Status: resolved
- Roadmap nodes: NODE-20260630-002
- Tags: #runtime
- Phenomenon: 默认生成长度过长导致 worker 持续运行。
- Guard / verification: 运行短请求，确认响应能在合理时间返回。
MD

python3 "$SCRIPT" show-roadmap --root "$ROOT" >/dev/null
HTML="$CTX/roadmap/roadmap.html"

grep -q 'class="route-stack"' "$HTML"
if grep -q 'class="route-stack branch-map"' "$HTML"; then
  echo "single-route roadmap should not use branch-map layout" >&2
  exit 1
fi
grep -q '.route-stack:not(.branch-map) .track-grid' "$HTML"
grep -q 'min-height: auto;' "$HTML"
grep -q 'single-mainline' "$HTML"
grep -q '.track-column.route-column.no-test-line' "$HTML"
grep -q -- '-webkit-line-clamp: 3;' "$HTML"

if grep -q 'min-height: 430px;' "$HTML"; then
  echo "single-route roadmap still reserves a large empty canvas" >&2
  exit 1
fi

BODY="$(python3 - "$HTML" <<'PY'
from pathlib import Path
import sys
html = Path(sys.argv[1]).read_text()
print(html.split("</style>", 1)[1])
PY
)"

if grep -q 'track-label-column' <<<"$BODY"; then
  echo "single-route roadmap should not show a left lane label column" >&2
  exit 1
fi

if grep -q 'data-lane="bad-cases"' <<<"$BODY"; then
  echo "single-route roadmap should not render bad-case lanes in the overview" >&2
  exit 1
fi

if grep -q 'data-lane="test-chain"' <<<"$BODY"; then
  echo "single-route roadmap should not render test-chain lanes in the overview" >&2
  exit 1
fi

if grep -q 'route-test-line' <<<"$BODY"; then
  echo "single-route roadmap should not render the compact test route" >&2
  exit 1
fi
