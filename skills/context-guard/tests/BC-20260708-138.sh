#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"
HOOK="$(cd "$(dirname "$SCRIPT")" && pwd)/context_guard_hook.py"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/context-guard-multi-chain-hook-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

python3 "$SCRIPT" init --root "$ROOT" >/dev/null
cat >"$ROOT/.codex/context/bad-cases.md" <<'MD'
### BC-20260708-981: 未勾完也能完成清单

- Status: resolved
- Scope: 晚间重置流程
- Tags: #checklist #completion
- Display summary: 三项未勾完时不能写入完成记录。
- Phenomenon: 只勾两项时仍能显示完成。
- Trigger / reproduction: 勾选两项后点击完成。
- Root cause: 完成入口缺少状态层校验。
- Fix method: 完成前校验三项都为 true。
- Guard / verification: 晚间重置流程功能链。
- Guard type: feature-chain
- Red condition: 两项勾选时写入完成。
- Green condition: 三项全勾才完成。
- Expected failure reason: 完成检查点应失败。

### BC-20260708-982: 完成后没有保存当天状态

- Status: resolved
- Scope: 晚间重置流程
- Tags: #checklist #completion
- Display summary: 完成三项后必须保存当天完成状态。
- Phenomenon: 刷新页面后进度丢失。
- Trigger / reproduction: 完成三项后刷新。
- Root cause: 成功路径没有写入持久化状态。
- Fix method: 完成后写入 localStorage。
- Guard / verification: 晚间重置流程功能链。
- Guard type: feature-chain
- Red condition: 刷新后回到未完成。
- Green condition: 刷新后仍显示今天已完成。
- Expected failure reason: 保存检查点应失败。

### BC-20260708-983: 空角色名仍生成角色卡

- Status: resolved
- Scope: 角色卡输入校验
- Tags: #story-card #validation
- Display summary: 空角色名不能生成可复制卡片。
- Phenomenon: 空角色名提交后出现旧卡片。
- Trigger / reproduction: 先生成有效卡，再清空角色名提交。
- Root cause: 无效输入没有清空旧结果。
- Fix method: 校验失败时清空 latestCard 并禁用复制。
- Guard / verification: 角色卡输入校验功能链。
- Guard type: feature-chain
- Red condition: 空角色名仍有可复制内容。
- Green condition: 空角色名只显示错误且复制禁用。
- Expected failure reason: 输入校验检查点应失败。

### BC-20260708-984: 缺少章节仍生成角色卡

- Status: resolved
- Scope: 角色卡输入校验
- Tags: #story-card #validation
- Display summary: 缺少章节不能生成不完整角色卡。
- Phenomenon: 章节为空时仍生成卡片。
- Trigger / reproduction: 填角色名和线索但不填章节。
- Root cause: 章节没有纳入必填校验。
- Fix method: 章节与角色名、线索同级校验。
- Guard / verification: 角色卡输入校验功能链。
- Guard type: feature-chain
- Red condition: 章节为空仍生成卡片。
- Green condition: 章节为空返回错误且无卡片。
- Expected failure reason: 章节校验检查点应失败。
MD

(cd "$ROOT" && printf '{"cwd":"%s"}' "$ROOT" | python3 "$HOOK" stop >"$ROOT/hook-propose.out" 2>"$ROOT/hook-propose.err")
grep -q "created proposed chains: 2" "$ROOT/hook-propose.err"

SCRIPT_PATH="$SCRIPT" ROOT_PATH="$ROOT" python3 - <<'PY'
from pathlib import Path
import json
import os
import subprocess
import sys

script = os.environ["SCRIPT_PATH"]
root = Path(os.environ["ROOT_PATH"])
registry_path = root / ".codex/context/test-hub/feature-chains.json"
data = json.loads(registry_path.read_text(encoding="utf-8"))
chains = data.get("chains", [])
assert len(chains) == 2, chains
assert {chain["status"] for chain in chains} == {"proposed"}, chains
assert {chain["title"] for chain in chains} == {"晚间重置流程", "角色卡输入校验"}, chains

hub = root / ".codex/context/test-hub"
for chain in chains:
    node_title = chain["nodes"][0]["title"]
    script_path = hub / f"run-{chain['id']}.sh"
    script_path.write_text(
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        f"echo 'running {chain['title']}'\n"
        f"echo 'CG_CHECKPOINT:{node_title}:PASS'\n",
        encoding="utf-8",
    )
    script_path.chmod(0o755)
    subprocess.run(
        [
            sys.executable,
            script,
            "feature-chain-approve",
            "--root",
            str(root),
            "--chain-id",
            chain["id"],
            "--command-text",
            f"bash .codex/context/test-hub/run-{chain['id']}.sh",
            "--timeout-seconds",
            "30",
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

data = json.loads(registry_path.read_text(encoding="utf-8"))
chains = data.get("chains", [])
assert len(chains) == 2, chains
assert {chain["status"] for chain in chains} == {"approved"}, chains
assert all(chain.get("command") for chain in chains), chains
PY

python3 "$SCRIPT" validate-feature-chains --root "$ROOT" >"$ROOT/validate-approved.out"
grep -q "2 chain(s), 0 warning" "$ROOT/validate-approved.out"

python3 "$SCRIPT" dev-complete --root "$ROOT" >"$ROOT/dev-complete.out"
grep -q "test hub: 2 passed, 0 failed, 0 blocked" "$ROOT/dev-complete.out"
grep -q "success artifacts cleaned" "$ROOT/dev-complete.out"

(cd "$ROOT" && printf '{"cwd":"%s"}' "$ROOT" | python3 "$HOOK" stop >"$ROOT/hook-run.out" 2>"$ROOT/hook-run.err")
grep -q "test hub: 2 passed, 0 failed, 0 blocked" "$ROOT/hook-run.err"
grep -q "final answer must include Test Hub summary: all approved tests passed (2 passed, 0 failed, 0 blocked)" "$ROOT/hook-run.err"
grep -q "unassigned bad cases: 0" "$ROOT/hook-run.err"

ROOT_PATH="$ROOT" python3 - <<'PY'
from pathlib import Path
import json
import os

root = Path(os.environ["ROOT_PATH"])
data = json.loads((root / ".codex/context/test-hub/feature-chains.json").read_text(encoding="utf-8"))
first = data["chains"][0]
node_title = first["nodes"][0]["title"]
script_path = root / ".codex/context/test-hub" / f"run-{first['id']}.sh"
script_path.write_text(
    "#!/usr/bin/env bash\n"
    "set -euo pipefail\n"
    f"echo 'CG_CHECKPOINT:{node_title}:FAIL:intentional regression'\n",
    encoding="utf-8",
)
script_path.chmod(0o755)
PY

(cd "$ROOT" && printf '{"cwd":"%s"}' "$ROOT" | python3 "$HOOK" stop >"$ROOT/hook-fail.out" 2>"$ROOT/hook-fail.err" || true)
grep -q "test hub: 1 passed, 1 failed, 0 blocked" "$ROOT/hook-fail.err"
grep -q "TEST HUB BLOCKER" "$ROOT/hook-fail.err"
grep -Eq '"decision"[[:space:]]*:[[:space:]]*"block"' "$ROOT/hook-fail.out"
