#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-multi-chain-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
mkdir -p "$ROOT/.codex/context/test-hub/fixtures"

cat >"$ROOT/.codex/context/bad-cases.md" <<'MD'
### BC-20260708-960: 晚间清单漏勾仍显示完成

- Status: resolved
- First observed: 2026-07-08
- Last checked: 2026-07-08
- Scope: Evening reset checklist
- Tags: #feature-chain #life
- Display summary: 晚间收纳清单不能在漏勾时显示完成。
- Phenomenon: 用户只勾选部分事项，页面仍显示今晚重置完成。
- Trigger / reproduction: 打开晚间重置清单，少勾一项后点击完成。
- Root cause: 完成判断只看点击事件，没有检查全部事项。
- Fix method: 完成前检查所有事项。
- Guard / verification: 功能链 checkpoint 检查提前完成被阻止。
- Red condition: 漏勾仍显示完成。
- Green condition: 漏勾时提示未完成。
- Expected failure reason: 完成判断回归时，生活清单功能链会失败。

### BC-20260708-961: 晚间清单完成后没有保存

- Status: resolved
- First observed: 2026-07-08
- Last checked: 2026-07-08
- Scope: Evening reset checklist
- Tags: #feature-chain #life #persistence
- Display summary: 晚间收纳清单完成后必须保存结果。
- Phenomenon: 页面显示完成，但刷新或读取状态时没有保存完成记录。
- Trigger / reproduction: 勾选全部事项并点击完成。
- Root cause: UI 状态更新后没有写入 localStorage。
- Fix method: 完成时写入 completed/count/total。
- Guard / verification: 功能链 checkpoint 检查完成结果已保存。
- Red condition: 完成后没有保存状态。
- Green condition: 完成后保存 completed=true 且数量正确。
- Expected failure reason: 保存回归时，生活清单功能链会失败。

### BC-20260708-962: 角色卡空白名字生成空主角

- Status: resolved
- First observed: 2026-07-08
- Last checked: 2026-07-08
- Scope: Story character card generator
- Tags: #feature-chain #creative
- Display summary: 角色卡生成器不能把空白名字直接写成空主角。
- Phenomenon: 用户没填角色名时，生成文本出现空主角字段。
- Trigger / reproduction: 只填写少量线索并点击生成角色卡。
- Root cause: 输入规范化缺失。
- Fix method: 空白角色名使用可读默认名。
- Guard / verification: 功能链 checkpoint 检查输入被规范化。
- Red condition: 空白角色名进入最终文本。
- Green condition: 空白角色名被规范化为可读默认名。
- Expected failure reason: 输入规范化回归时，创作工具功能链会失败。

### BC-20260708-963: 角色卡重复生成不稳定

- Status: resolved
- First observed: 2026-07-08
- Last checked: 2026-07-08
- Scope: Story character card generator
- Tags: #feature-chain #creative #determinism
- Display summary: 相同线索重复生成角色卡时输出应稳定。
- Phenomenon: 用户用相同线索重复点击生成，角色卡文本不断变化。
- Trigger / reproduction: 相同输入连续点击生成角色卡。
- Root cause: 输出生成缺少稳定规则。
- Fix method: 对同一输入使用确定性结构。
- Guard / verification: 功能链 checkpoint 检查最终文本稳定可复制。
- Red condition: 同一输入重复生成不同结果。
- Green condition: 同一输入重复生成完全一致。
- Expected failure reason: 稳定性回归时，创作工具功能链会失败。
MD

propose_life="$ROOT/propose-life.out"
python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "晚间收纳重置" \
  --entry "勾选晚间收纳事项并点击完成" \
  --exit-check "页面显示 3/3 完成并保存状态" \
  --node-title "阻止提前完成" \
  --bad-cases "BC-20260708-960" \
  --check "漏勾任一事项时不能显示完成" >"$propose_life"
life_id="$(grep 'feature chain proposed:' "$propose_life" | awk '{print $NF}')"
test -n "$life_id"

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$life_id" \
  --node-title "保存完成结果" \
  --bad-case "BC-20260708-961" \
  --check "完成后必须保存 completed=true 且 count=3 total=3" >/dev/null

propose_story="$ROOT/propose-story.out"
python3 "$SCRIPT" feature-chain-propose \
  --root "$ROOT" \
  --title "故事角色卡生成" \
  --entry "填写线索并点击生成角色卡" \
  --exit-check "生成稳定、完整、可复制的角色卡" \
  --node-title "输入被规范化" \
  --bad-cases "BC-20260708-962" \
  --check "空白角色名必须被规范化为可读默认名" >"$propose_story"
story_id="$(grep 'feature chain proposed:' "$propose_story" | awk '{print $NF}')"
test -n "$story_id"

python3 "$SCRIPT" feature-chain-attach-bc \
  --root "$ROOT" \
  --chain-id "$story_id" \
  --node-title "最终文本稳定可复制" \
  --bad-case "BC-20260708-963" \
  --check "同一输入重复生成必须输出一致" >/dev/null

life_runner="$ROOT/.codex/context/test-hub/fixtures/life_chain.sh"
story_runner="$ROOT/.codex/context/test-hub/fixtures/story_chain.sh"

cat >"$life_runner" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "CG_CHECKPOINT:阻止提前完成:PASS"
echo "CG_CHECKPOINT:保存完成结果:PASS"
SH
chmod +x "$life_runner"

cat >"$story_runner" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "CG_CHECKPOINT:输入被规范化:PASS"
echo "CG_CHECKPOINT:最终文本稳定可复制:PASS"
SH
chmod +x "$story_runner"

python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT" \
  --chain-id "$life_id" \
  --command-text "bash .codex/context/test-hub/fixtures/life_chain.sh" >"$ROOT/approve-life.out"
grep -q "approval dry-run: passed" "$ROOT/approve-life.out"

python3 "$SCRIPT" feature-chain-approve \
  --root "$ROOT" \
  --chain-id "$story_id" \
  --command-text "bash .codex/context/test-hub/fixtures/story_chain.sh" >"$ROOT/approve-story.out"
grep -q "approval dry-run: passed" "$ROOT/approve-story.out"

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$ROOT/pass-two.out"
grep -q "test hub: 2 passed, 0 failed, 0 blocked" "$ROOT/pass-two.out"
grep -q "passed: 晚间收纳重置" "$ROOT/pass-two.out"
grep -q "passed: 故事角色卡生成" "$ROOT/pass-two.out"
grep -q "success artifacts cleaned" "$ROOT/pass-two.out"

cat >"$story_runner" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "CG_CHECKPOINT:输入被规范化:PASS"
echo "CG_CHECKPOINT:最终文本稳定可复制:FAIL:相同线索重复生成了不同角色卡"
printf "story output drifted\n" > "$CONTEXT_GUARD_TEST_RUN_DIR/story-drift.txt"
SH
chmod +x "$story_runner"

if python3 "$SCRIPT" dev-complete --root "$ROOT" >"$ROOT/fail-one.out" 2>&1; then
  cat "$ROOT/fail-one.out"
  exit 1
fi
grep -q "test hub: 1 passed, 1 failed, 0 blocked" "$ROOT/fail-one.out"
grep -q "passed: 晚间收纳重置" "$ROOT/fail-one.out"
grep -q "failed: 故事角色卡生成 (checkpoint failed: 最终文本稳定可复制 - 相同线索重复生成了不同角色卡)" "$ROOT/fail-one.out"
grep -q "evidence preserved" "$ROOT/fail-one.out"

python3 - "$ROOT/.codex/context/test-hub/last-run.json" <<'PY'
from pathlib import Path
import json
import sys

run = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
results = {item["title"]: item for item in run["results"]}
assert results["晚间收纳重置"]["status"] == "passed", results
story = results["故事角色卡生成"]
assert story["status"] == "failed", story
assert story["reason"] == "checkpoint failed: 最终文本稳定可复制 - 相同线索重复生成了不同角色卡", story
assert [c["label"] for c in story["checkpoints"]] == ["输入被规范化", "最终文本稳定可复制"], story
evidence = Path(story["log"]).parent / "story-drift.txt"
assert evidence.exists(), evidence
assert "story output drifted" in evidence.read_text(encoding="utf-8")
PY

cat >"$story_runner" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "CG_CHECKPOINT:输入被规范化:PASS"
echo "CG_CHECKPOINT:最终文本稳定可复制:PASS"
SH
chmod +x "$story_runner"

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$ROOT/final-pass.out"
grep -q "test hub: 2 passed, 0 failed, 0 blocked" "$ROOT/final-pass.out"
grep -q "success artifacts cleaned" "$ROOT/final-pass.out"

python3 "$SCRIPT" feature-chain-summary --root "$ROOT" >"$ROOT/summary.out"
grep -q "chains: 2" "$ROOT/summary.out"
grep -q "covered bad cases: 4" "$ROOT/summary.out"
grep -q "coverage density: 2.0 bad case(s) per covered chain" "$ROOT/summary.out"
grep -q "reuse signal: one workflow covers up to 2 bad case(s)" "$ROOT/summary.out"

python3 "$SCRIPT" validate-feature-chains --root "$ROOT" >"$ROOT/validate.out"
grep -q "feature-chain validation passed: 2 chain(s), 0 warning(s)" "$ROOT/validate.out"
