#!/usr/bin/env python3
"""Lightweight lifecycle reminders for the Context Guard plugin.

The hook initializes folder-scoped context on session start and nudges Codex to
use the context-guard skill at the two moments where omission is most costly:
prompt intake and turn stop.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from context_guard import context_dir, init_context


def git_root(cwd: Path) -> Path:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=str(cwd),
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=2,
        ).strip()
        if out:
            return Path(out)
    except Exception:
        pass
    return cwd


def read_stdin() -> str:
    try:
        return sys.stdin.read()
    except Exception:
        return ""


def prompt_text(raw: str) -> str:
    if not raw.strip():
        return ""
    try:
        data = json.loads(raw)
    except Exception:
        return raw
    pieces: list[str] = []

    def walk(value: object) -> None:
        if isinstance(value, str):
            pieces.append(value)
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            for key in ("prompt", "message", "text", "content", "input"):
                if key in value:
                    walk(value[key])

    walk(data)
    return "\n".join(pieces)


def looks_like_bad_case(text: str) -> bool:
    lowered = text.lower()
    markers = [
        "bug",
        "bad case",
        "regression",
        "broken",
        "error",
        "failed",
        "failing",
        "doesn't work",
        "not working",
        "紧急",
        "报错",
        "失败",
        "坏例",
        "复现",
        "回归",
        "不对",
        "有问题",
    ]
    return any(marker in lowered for marker in markers)


def looks_like_task_switch(text: str) -> bool:
    lowered = text.lower()
    markers = [
        "urgent",
        "instead",
        "switch",
        "pause",
        "later",
        "different",
        "unrelated",
        "先",
        "暂停",
        "等下",
        "换个",
        "另一个",
        "紧急",
        "回头",
        "先不",
    ]
    return any(marker in lowered for marker in markers)


def looks_like_goal_mode(text: str) -> bool:
    lowered = text.lower()
    markers = [
        "goal mode",
        "goal模式",
        "goal 模式",
        "active goal",
        "long-running",
        "autonomous",
        "目标模式",
        "长期目标",
        "持续执行",
        "自动继续",
    ]
    return any(marker in lowered for marker in markers)


def main() -> int:
    event = sys.argv[1] if len(sys.argv) > 1 else "unknown"
    root = git_root(Path.cwd())
    context_dir = root / ".codex" / "context"
    index_path = context_dir / "index.md"
    roadmap_path = context_dir / "roadmap.md"
    bad_cases_path = context_dir / "bad-cases.md"
    text = prompt_text(read_stdin())

    if event == "session-start":
        created = init_context(root)
        if created:
            print(f"[context-guard] initialized folder context: {context_dir}")
        else:
            print(f"[context-guard] folder context ready: {context_dir}")
        print("[context-guard] use .codex/context/index.md for quick scan and .codex/context/roadmap.md for route nodes.")
        return 0

    if event == "user-prompt-submit":
        hints: list[str] = []
        if looks_like_goal_mode(text):
            hints.append("goal mode: align active goal with current context and record roadmap/bad-case checkpoints during long-running work")
        if looks_like_task_switch(text):
            hints.append("possible task switch: park current context in .codex/context/index.md before switching")
        if looks_like_bad_case(text):
            hints.append("possible bad case: record/update .codex/context/bad-cases.md or task-local bad-cases.md")
        if not hints:
            hints.append("run Context Guard intake: continue current context or note no active context")
        print("[context-guard] " + "; ".join(hints))
        print(f"[context-guard] context index: {index_path}")
        print(f"[context-guard] route map: {roadmap_path}")
        return 0

    if event == "stop":
        print("[context-guard] run turn-end checkpoint before finalizing or updating a goal: update index, route map nodes, parked/resume tasks, and relevant bad-case/test-chain links.")
        print(f"[context-guard] context folder: {context_dir}")
        print(f"[context-guard] bad-case register: {bad_cases_path}")
        return 0

    print("[context-guard] unknown hook event; use the context-guard skill if context changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
