#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-display-title-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" set-language --language zh --root "$ROOT" >/dev/null

CTX="$ROOT/.codex/context"
python3 "$SCRIPT" checkpoint-roadmap-node \
  --root "$ROOT" \
  --title "用用户请求字段驱动节点详情" \
  --display-title "按用户原话解释节点" \
  --branch "Main" \
  --level major \
  --user-request "用户希望节点标题和详情问题摘要更接近自己的原话。" \
  --outcome "路线图节点现在可以用独立的人类展示标题。" \
  --decision "source title 可以服务检索，但 overview 标题必须先服务阅读。" \
  --next-step "后续创建节点时同时填写 Display title 和 User request。" >/dev/null

python3 "$SCRIPT" show-roadmap --root "$ROOT" >/dev/null

grep -q -- "- Display title: 按用户原话解释节点" "$CTX/roadmap.md"
grep -q "按用户原话解释节点" "$CTX/roadmap/roadmap.html"
grep -q "按用户原话解释节点" "$CTX/roadmap/roadmap-details.html"

if grep -q "用用户请求字段驱动节点详情" "$CTX/roadmap/roadmap.html"; then
  echo "human roadmap should not expose the implementation-oriented source title" >&2
  exit 1
fi
