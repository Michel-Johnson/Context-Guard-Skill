#!/usr/bin/env python3
"""Normalize Codex, Cursor, and Claude lifecycle hooks for Context Guard."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path, PureWindowsPath

from context_guard import append_session_event
from context_guard import context_dir as context_folder
from context_guard import folder_root, init_context, is_context_guard_skill_path
from context_guard import read_preferences, start_workbench


WORKSPACE_KEYS = {
    "cwd",
    "current_working_directory",
    "working_directory",
    "workspace",
    "workspace_root",
    "workspaceFolder",
    "workspace_folder",
    "workspace_roots",
    "workspaceRoots",
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
    "CURSOR_PROJECT_DIR",
    "CURSOR_WORKSPACE_ROOT",
    "CLAUDE_PROJECT_DIR",
    "CLAUDE_WORKSPACE_ROOT",
    "WORKSPACE_ROOT",
    "PROJECT_ROOT",
    "PWD",
]


def possible_workspace_paths(value: object) -> list[Path]:
    paths: list[Path] = []

    def add_path(candidate: object) -> None:
        if isinstance(candidate, list):
            for item in candidate:
                add_path(item)
            return
        if not isinstance(candidate, str):
            return
        text = os.path.expandvars(os.path.expanduser(candidate.strip()))
        if not text:
            return
        is_absolute = Path(text).is_absolute() or PureWindowsPath(text).is_absolute()
        if not is_absolute:
            return
        path = Path(text)
        if path.exists():
            paths.append(path if path.is_dir() else path.parent)

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
        for path in possible_workspace_paths({"root": value}):
            candidates.append((path, f"${key}"))
    candidates.append((cwd, "process cwd"))
    for path, source in candidates:
        root = folder_root(path)
        if not is_context_guard_skill_path(root):
            return root, source
    return folder_root(cwd), "process cwd"


def read_stdin() -> str:
    try:
        return sys.stdin.buffer.read().decode("utf-8", errors="replace")
    except Exception:
        try:
            return sys.stdin.read()
        except Exception:
            return ""


def hook_log(message: str) -> None:
    print(message, file=sys.stderr)


HOOK_EVENT_NAMES = {
    "session-start": "SessionStart",
    "subagent-start": "SubagentStart",
    "user-prompt-submit": "UserPromptSubmit",
    "stop": "Stop",
    "subagent-stop": "SubagentStop",
}


def hook_response(platform: str, event: str, additional_context: str = "") -> int:
    payload: dict[str, object] = {}
    if additional_context:
        if platform == "cursor":
            payload["additional_context"] = additional_context
        else:
            payload["hookSpecificOutput"] = {
                "hookEventName": HOOK_EVENT_NAMES.get(event, event),
                "additionalContext": additional_context,
            }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def payload_value(payload: object, keys: tuple[str, ...]) -> str:
    if not isinstance(payload, dict):
        return ""
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def session_id(payload: object, platform: str) -> str:
    value = payload_value(
        payload,
        ("session_id", "sessionId", "conversation_id", "conversationId", "generation_id"),
    )
    if value:
        return value
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{platform}-{stamp}-{os.getpid()}"


def language_setup_context(root: Path, ctx: Path) -> str:
    language = str(read_preferences(ctx).get("record_language", "unset"))
    if language and language != "unset":
        return ""
    quoted_root = '"' + str(root).replace('"', '\\"') + '"'
    return (
        "Context Guard first-session setup is incomplete. Before substantive project work, "
        "ask the user whether project context should be recorded in 中文 or English; do not infer it. "
        "After the user answers, run `context-guard set-language --root "
        f"{quoted_root} --language <zh-or-en>` and then continue in that language."
    )


def lifecycle_context(root: Path, workbench_url: str | None) -> str:
    quoted_root = '"' + str(root).replace('"', '\\"') + '"'
    workbench = f" Workbench: {workbench_url}." if workbench_url else ""
    return (
        f"Context Guard is active for {root}.{workbench} "
        "Record a credible bad case with `context-guard record-bad-case --root "
        f"{quoted_root} --title <title> --phenomenon <what-failed> --trigger <trigger> "
        "--cause <cause-or-pending> --guard <regression-guard> --keys <comma-separated>`; "
        "never store secrets in project context."
    )


def prompt_text(raw: str) -> str:
    payload = parse_hook_payload(raw)
    return payload_value(payload, ("prompt", "user_prompt", "userPrompt", "text", "content"))


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
    parser = argparse.ArgumentParser(description="Context Guard hook adapter")
    parser.add_argument("event", nargs="?", default="unknown")
    parser.add_argument("--platform", choices=["codex", "cursor", "claude"], default="codex")
    args, _unknown = parser.parse_known_args()
    event = args.event
    platform = args.platform
    raw = read_stdin()
    payload = parse_hook_payload(raw)
    root, root_source = event_root(raw, Path.cwd())
    ctx = context_folder(root)
    current_session_id = session_id(payload, platform)

    if is_context_guard_skill_path(root):
        hook_log("[context-guard] apparent root is the skill directory; skipping writes.")
        return hook_response(platform, event)

    if event in {"session-start", "subagent-start"}:
        created = init_context(root)
        append_session_event(
            root,
            event,
            platform,
            current_session_id,
            {"root_source": root_source},
        )
        url = None
        if event == "session-start" and not (
            isinstance(payload, dict) and payload.get("is_background_agent") is True
        ):
            start_reason = payload_value(payload, ("source", "reason", "session_start_type")).lower()
            url = start_workbench(
                root,
                open_browser=start_reason not in {"resume", "clear", "compact"},
            )
        hook_log(
            f"[context-guard] {'initialized' if created else 'ready'} {ctx} ({root_source})"
        )
        contexts = [language_setup_context(root, ctx), lifecycle_context(root, url)]
        return hook_response(platform, event, "\n\n".join(item for item in contexts if item))

    if event == "user-prompt-submit":
        init_context(root)
        status = append_user_message(ctx, prompt_text(raw))
        append_session_event(
            root,
            event,
            platform,
            current_session_id,
            {"message_status": status},
        )
        hook_log(f"[context-guard] user-messages: {status}")
        return hook_response(platform, event)

    if event in {"stop", "subagent-stop"}:
        init_context(root)
        append_session_event(root, event, platform, current_session_id)
        hook_log(
            "[context-guard] if this turn mattered, append sessions.jsonl and update bugs/tasks. "
            "Do not run Test Hub or Roadmap HTML."
        )
        return hook_response(platform, event)

    hook_log(f"[context-guard] ignored event: {event}")
    return hook_response(platform, event)


if __name__ == "__main__":
    raise SystemExit(main())
