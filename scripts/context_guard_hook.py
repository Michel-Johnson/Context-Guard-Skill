#!/usr/bin/env python3
"""Session start initializes the folder. Stop hooks do not run Test Hub."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from context_guard import context_dir as context_folder
from context_guard import folder_root, init_context, is_context_guard_skill_path


WORKSPACE_KEYS = {
    "cwd",
    "current_working_directory",
    "working_directory",
    "workspace",
    "workspace_root",
    "workspaceFolder",
    "workspace_folder",
    "project",
    "project_root",
    "projectRoot",
    "project_path",
    "repository",
    "repo",
    "repo_path",
    "root",
}
WORKSPACE_ENV_KEYS = [
    "CODEX_WORKSPACE_ROOT",
    "CODEX_PROJECT_ROOT",
    "CODEX_CWD",
    "WORKSPACE_ROOT",
    "PROJECT_ROOT",
    "PWD",
]


def possible_workspace_paths(value: object) -> list[Path]:
    paths: list[Path] = []

    def add_path(candidate: object) -> None:
        if not isinstance(candidate, str):
            return
        text = candidate.strip()
        if not text or not text.startswith("/"):
            return
        path = Path(text).expanduser()
        if path.exists():
            paths.append(path)

    def walk(obj: object) -> None:
        if isinstance(obj, dict):
            for key, child in obj.items():
                if key in WORKSPACE_KEYS:
                    add_path(child)
                walk(child)
        elif isinstance(obj, list):
            for child in obj:
                walk(child)

    walk(value)
    return paths


def parse_hook_payload(raw: str) -> object:
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def event_root(raw: str, cwd: Path) -> tuple[Path, str]:
    payload = parse_hook_payload(raw)
    candidates: list[tuple[Path, str]] = []
    for path in possible_workspace_paths(payload):
        candidates.append((path, "hook payload"))
    for key in WORKSPACE_ENV_KEYS:
        value = os.environ.get(key, "").strip()
        if value.startswith("/"):
            path = Path(value).expanduser()
            if path.exists():
                candidates.append((path, f"${key}"))
    candidates.append((cwd, "process cwd"))
    for path, source in candidates:
        root = folder_root(path)
        if not is_context_guard_skill_path(root):
            return root, source
    return folder_root(cwd), "process cwd"


def read_stdin() -> str:
    try:
        return sys.stdin.read()
    except Exception:
        return ""


def hook_log(message: str) -> None:
    print(message, file=sys.stderr)


def hook_response(**payload: object) -> int:
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def prompt_text(raw: str) -> str:
    payload = parse_hook_payload(raw)
    if isinstance(payload, dict):
        for key in ("prompt", "user_prompt", "text", "content"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def redact(text: str) -> str:
    if len(text) > 800:
        return text[:400].rstrip() + "…"
    return text


def append_user_message(ctx: Path, text: str) -> str:
    text = (text or "").strip()
    if not text:
        return "empty"
    ctx.mkdir(parents=True, exist_ok=True)
    path = ctx / "user-messages.md"
    if not path.exists():
        path.write_text("# User Message Memory\n\n## Recent User Signals\n\n", encoding="utf-8")
    body = path.read_text(encoding="utf-8")
    line = "- " + redact(text).replace("\n", " ")
    if line in body:
        return "duplicate"
    marker = "## Recent User Signals"
    if marker in body:
        body = body.replace(marker, marker + "\n\n" + line, 1)
    else:
        body += "\n" + line + "\n"
    path.write_text(body, encoding="utf-8")
    return "recorded"


def main() -> int:
    event = sys.argv[1] if len(sys.argv) > 1 else "unknown"
    raw = read_stdin()
    root, root_source = event_root(raw, Path.cwd())
    ctx = context_folder(root)

    if is_context_guard_skill_path(root):
        hook_log("[context-guard] apparent root is the skill directory; skipping writes.")
        return hook_response()

    if event in {"session-start", "subagent-start"}:
        created = init_context(root)
        hook_log(
            f"[context-guard] {'initialized' if created else 'ready'} {ctx} ({root_source})"
        )
        return hook_response()

    if event == "user-prompt-submit":
        status = append_user_message(ctx, prompt_text(raw))
        hook_log(f"[context-guard] user-messages: {status}")
        return hook_response()

    if event in {"stop", "subagent-stop"}:
        hook_log(
            "[context-guard] if this turn mattered, append sessions.jsonl and update bugs/tasks. "
            "Do not run Test Hub or Roadmap HTML."
        )
        return hook_response()

    hook_log(f"[context-guard] ignored event: {event}")
    return hook_response()


if __name__ == "__main__":
    raise SystemExit(main())
