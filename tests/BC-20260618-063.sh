#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/context_guard.py}"

python3 - "$SCRIPT" <<'PY'
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

script = Path(sys.argv[1])
root = Path(tempfile.mkdtemp(prefix="context-guard-branch-test-"))

try:
    subprocess.run(["python3", str(script), "init", "--root", str(root)], check=True, capture_output=True, text=True)
    subprocess.run(["python3", str(script), "set-language", "--language", "zh", "--root", str(root)], check=True, capture_output=True, text=True)

    ctx = root / ".codex" / "context"
    (ctx / "index.md").write_text(
        """# Context Index

## Quick Scan

- Current: CTX-20260618-main
- Latest roadmap node: NODE-20260618-001
- Hot bad-case tags: none
- Resume candidate: none

## Current

- ID: CTX-20260618-main
- Title: 主线任务
- State: current
- Folder: `.codex/context/tasks/CTX-20260618-main/`
- Last updated: 2026-06-18
- Summary: 正在推进主线任务。
- Next step: 继续主线。

## Parked / Resume Candidates

None.

## Archived

None.
""",
        encoding="utf-8",
    )
    (ctx / "roadmap.md").write_text(
        """# Context Roadmap

## Nodes

### NODE-20260618-001: 主线起点

- Date: 2026-06-18
- Status: done
- Level: major
- Branch: Main
- Parent: none
- Task: `CTX-20260618-main`
- Outcome: 主线已经建立。
- Decision / reason: 作为支线父节点。
- Avoid going back: 不要把支线写回主线。
- Next: 等待支线。
- Linked bad cases: none
- Test chain: none
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            "python3",
            str(script),
            "create-branch-task",
            "--root",
            str(root),
            "--title",
            "后端状态机设计",
            "--branch",
            "后端状态机",
            "--parent-node",
            "NODE-20260618-001",
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    output = result.stdout + result.stderr
    assert "CTX-20260618-" in output, output
    assert "NODE-20260618-" in output, output

    index = (ctx / "index.md").read_text(encoding="utf-8")
    roadmap = (ctx / "roadmap.md").read_text(encoding="utf-8")
    exports = json.loads((ctx / "roadmap" / "roadmap.json").read_text(encoding="utf-8"))

    assert "- Current: CTX-20260618-main" not in index, index
    assert "后端状态机设计" in index, index
    assert "主线任务" in index and "resume-candidate" in index, index
    assert "- Branch: 后端状态机" in roadmap, roadmap
    assert "- Parent: NODE-20260618-001" in roadmap, roadmap
    assert "- Task: `CTX-20260618-" in roadmap, roadmap
    assert any(route["branch"] == "后端状态机" for route in exports["routes"]), exports

    task_dirs = list((ctx / "tasks").glob("CTX-20260618-*"))
    assert any((path / "context.md").exists() and "后端状态机设计" in (path / "context.md").read_text(encoding="utf-8") for path in task_dirs), task_dirs
finally:
    shutil.rmtree(root, ignore_errors=True)
PY
