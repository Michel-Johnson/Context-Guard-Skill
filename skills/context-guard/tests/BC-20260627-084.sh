#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-readable-detail-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
python3 "$SCRIPT" set-language --language zh --root "$ROOT" >/dev/null

CTX="$ROOT/.codex/context"
cat > "$CTX/roadmap.md" <<'MD'
# Context Roadmap

### NODE-20260627-001: 重构节点详情阅读页
- Date: 2026-06-27
- Status: done
- Level: major
- Branch: Main
- Outcome: Context Guard 现在承认用户截图、日志、复现和已定位根因可作为 red signal；证据足够时应停止补测试并进入实现。
- Decision / reason: 用户反馈旧详情页像列表堆料，不利于浏览；详情页应该围绕当前节点，而不是全局展开 bad case 列表；按 `；`、`;` 拆成长字段短条目时不能切碎代码片段；采取方法需要短行展示，不能把多个决策塞进一个段落。用户反馈 skill 又陷入测试循环，说明验证预算还不够，需要明确 stop condition。
- Avoid going back: 不要在节点详情里渲染全局 Bad Cases 长列表；不要把测试命令日志混入当前进度区；不要把采取方法渲染成一整段文字墙。
- Next: 保持节点详情只呈现当前节点的关键内容。
- Linked bad cases: BC-20260627-084
MD

cat > "$CTX/bad-cases.md" <<'MD'
# Bad Case Register

### BC-20260627-084: 节点详情采取方法像文字墙
- Status: resolved
- Roadmap nodes: NODE-20260627-001
- Tags: #roadmap-ux #readability
- Phenomenon: 节点详情的采取方法把多个长句拼成一段，用户很难扫读。
- Fix method: 将采取方法拆成短列表；相关问题案例留在当前节点内；进度区不混入测试命令日志。
- Guard / verification: 检查详情 HTML 中采取方法和当前进度使用 compact list。
MD

python3 "$SCRIPT" show-roadmap --root "$ROOT" >/dev/null
HTML="$CTX/roadmap/roadmap.html"
DETAIL="$CTX/roadmap/roadmap-details.html"

python3 - "$SCRIPT" <<'PY'
import importlib.util
import sys

script = sys.argv[1]
spec = importlib.util.spec_from_file_location("context_guard_under_test", script)
module = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(module)
items = module.split_detail_items("第一条；按 `；`、`;` 拆成长字段短条目时不能切碎代码片段；第三条。")
assert items == [
    "第一条",
    "按 `；`、`;` 拆成长字段短条目时不能切碎代码片段",
    "第三条",
], items
assert module.polish_detail_zh(
    "后续观察 stop hook 是否能让 Codex 在根因明确后先修复，再做一个最小 post-fix 检查。"
) == "下一步观察结束钩子能否提醒 Codex：根因明确后先修复，再做一次最小检查。"
PY

grep -q 'class="detail-list"' "$HTML"
grep -q 'class="detail-list"' "$DETAIL"
grep -q '<li>.*不要在节点详情里渲染全局 Bad Cases 长列表' "$DETAIL"
grep -q '<li>.*将采取方法拆成短列表' "$DETAIL"
grep -q '用户发现 Context Guard 又把时间耗在反复补测试上，因此需要给验证流程设置明确的停止条件' "$DETAIL"
grep -q '现在只要有截图、日志、复现步骤或明确根因，就可以确认问题已经成立' "$DETAIL"
grep -q '证据足够时，先修复问题，再做最小验证' "$DETAIL"

if grep -q '不要在节点详情里渲染全局 Bad Cases 长列表；不要把测试命令日志混入当前进度区；不要把采取方法渲染成一整段文字墙' "$DETAIL"; then
  echo "method detail is still rendered as one paragraph wall" >&2
  exit 1
fi
