#!/usr/bin/env python3
"""Context Guard CLI: initialize project memory and run its local workbench."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import webbrowser
from datetime import datetime, timezone
from pathlib import Path


def configure_stdio() -> None:
    """Use UTF-8 for client JSON and logs even on legacy Windows code pages."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")


INDEX_MD = """# Context Index

- Current: none
- Map: `.codex/context/map.json` (human workbench)
- How to jump: `.codex/context/FIND.md`

Last initialized: {today}
"""

USER_MESSAGES_MD = """# User Message Memory

## Recent User Signals

None yet.

## Durable User Constraints

None yet.

## Secret Pointers

None.

Last initialized: {today}
"""

FIND_MD = """# Four stores — jump small, then open one file

1. Sessions — `sessions.jsonl` (append-only) and `sessions/{id}.md`
2. Bugs — `bugs-index.json`, then `bugs/{id}.md` and `fixes/{id}.md`
3. Tasks — `tasks/{id}.md`
4. Map — `context-guard map read/apply` uses the authoritative map and a page synchronization checkpoint. `archive-session --files ...` records completed work on owning nodes and proposes nodes for uncovered files.

Do not paste `map.json` or `jump-index.json`. Do not Grep this whole folder. Do not read or update a legacy `roadmap.md`.
Before using cards/indexes, verify projection-status.json matches the current map version. Generate with `python3 scripts/map_owns.py cards --root <project>`, or read the current node through the Node CLI. See the installed skill references/workbench-interface.md.
"""

ARCHITECTURE_MD = """# Architecture Map

Status: pending
Later sessions: use `context-guard map read --root <project> --session <actual-session-id> --node <id>`. Do not re-analyze unless asked.

Last initialized: {today}
"""


def context_guard_skill_root() -> Path:
    return Path(__file__).resolve().parents[1]


def is_inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def is_context_guard_skill_path(path: Path) -> bool:
    return is_inside(path, context_guard_skill_root())


def folder_root(cwd: Path) -> Path:
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


def guard_implicit_skill_root(root: Path, explicit_root: bool) -> int:
    if explicit_root or not is_context_guard_skill_path(root):
        return 0
    print(
        "[context-guard] refusing to use the skill directory as a project root. "
        "Pass --root <opened project>.",
        file=sys.stderr,
    )
    return 2


def context_dir(root: Path) -> Path:
    return root / ".codex" / "context"


def normalize_record_language(language: str) -> str:
    value = " ".join((language or "").strip().split())
    lowered = value.lower().replace("_", "-")
    aliases = {
        "zh": "zh",
        "zh-cn": "zh",
        "zh-hans": "zh",
        "cn": "zh",
        "chinese": "zh",
        "中文": "zh",
        "简体中文": "zh",
        "en": "en",
        "en-us": "en",
        "english": "en",
        "英文": "en",
    }
    return aliases.get(lowered, value or "unset")


def display_language_code(language: str) -> str:
    normalized = normalize_record_language(language)
    return normalized if normalized in {"zh", "en"} else "auto"


def default_preferences(today: str | None = None) -> dict[str, str]:
    return {
        "record_language": "unset",
        "display_language": "auto",
        "map_bootstrap": "pending",
        "last_updated": today or datetime.now().strftime("%Y-%m-%d"),
    }


def read_json(path: Path, default: object) -> object:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_preferences(ctx: Path) -> dict[str, str]:
    data = read_json(ctx / "preferences.json", {})
    return data if isinstance(data, dict) else {}


def write_preferences(ctx: Path, preferences: dict[str, str]) -> None:
    write_json(ctx / "preferences.json", preferences)


def write_if_missing(path: Path, content: str) -> bool:
    if path.exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def ensure_context_gitignore(root: Path) -> tuple[Path, bool]:
    codex_dir = root / ".codex"
    codex_dir.mkdir(parents=True, exist_ok=True)
    path = codex_dir / ".gitignore"
    required = [
        "context/private/",
        "context/**/*.local.json",
        "context/**/secrets*.json",
    ]
    if path.exists():
        current = path.read_text(encoding="utf-8")
        additions = [line for line in required if line not in current.splitlines()]
        if additions:
            suffix = "" if current.endswith("\n") or not current else "\n"
            path.write_text(current + suffix + "\n".join(additions) + "\n", encoding="utf-8")
            return path, True
        return path, False
    path.write_text("\n".join(required) + "\n", encoding="utf-8")
    return path, True


def init_context(root: Path) -> list[Path]:
    today = datetime.now().strftime("%Y-%m-%d")
    ctx = context_dir(root)
    created: list[Path] = []
    for directory in [
        ctx,
        ctx / "tasks",
        ctx / "bugs",
        ctx / "fixes",
        ctx / "cards",
        ctx / "sessions",
        ctx / "private",
    ]:
        if not directory.exists():
            directory.mkdir(parents=True, exist_ok=True)
            created.append(directory)
        if directory == ctx / "private":
            try:
                directory.chmod(0o700)
            except OSError:
                pass

    files = {
        ctx / "index.md": INDEX_MD.format(today=today),
        ctx / "user-messages.md": USER_MESSAGES_MD.format(today=today),
        ctx / "FIND.md": FIND_MD,
        ctx / "architecture.md": ARCHITECTURE_MD.format(today=today),
        ctx / "preferences.json": json.dumps(default_preferences(today), ensure_ascii=False, indent=2) + "\n",
        ctx / "sessions.jsonl": "",
        ctx / "bugs-index.json": "{}\n",
        ctx / "map.json": json.dumps(
            {
                "v": 1,
                "bootstrap": "pending",
                "updated": today,
                "flows": [],
                "project": root.name,
                "root": {"id": "T0", "title": root.name, "kind": "module", "state": "dirty", "children": [], "memories": [], "ideas": [], "bugs": [], "dormant": [], "files": [], "owns": []},
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
    }
    for path, content in files.items():
        if write_if_missing(path, content):
            created.append(path)
    gitignore_path, gitignore_changed = ensure_context_gitignore(root)
    if gitignore_changed and gitignore_path not in created:
        created.append(gitignore_path)
    return created


def set_record_language(root: Path, language: str) -> Path:
    init_context(root)
    ctx = context_dir(root)
    normalized = normalize_record_language(language)
    preferences = default_preferences()
    preferences.update(read_preferences(ctx))
    preferences["record_language"] = normalized
    preferences["display_language"] = display_language_code(normalized)
    preferences["last_updated"] = datetime.now().strftime("%Y-%m-%d")
    write_preferences(ctx, preferences)
    print(f"[context-guard] record language set: {normalized}")
    return ctx / "preferences.json"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def safe_identifier(value: str, fallback: str = "session") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", (value or "").strip()).strip("-._")
    return (cleaned or fallback)[:120]


def ensure_session_file(root: Path, session_id: str, platform: str) -> Path:
    init_context(root)
    path = context_dir(root) / "sessions" / f"{safe_identifier(session_id)}.md"
    write_if_missing(
        path,
        "\n".join(
            [
                f"# Session {session_id}",
                "",
                f"- platform: {platform}",
                f"- started: {utc_now()}",
                "",
                "## Events",
                "",
            ]
        ),
    )
    return path


def append_session_event(
    root: Path,
    event: str,
    platform: str,
    session_id: str,
    details: dict[str, object] | None = None,
) -> Path:
    init_context(root)
    ctx = context_dir(root)
    record: dict[str, object] = {
        "at": utc_now(),
        "event": event,
        "platform": platform,
        "session_id": session_id,
    }
    if details:
        record.update(details)
    with (ctx / "sessions.jsonl").open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    session_path = ensure_session_file(root, session_id, platform)
    with session_path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(f"- {record['at']} · {event}\n")
    return session_path


def session_records(root: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    path = context_dir(root) / "sessions.jsonl"
    if not path.exists():
        return records
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and isinstance(value.get("session_id"), str):
            records.append(value)
    return records


def resolve_session_id(root: Path, explicit: str = "") -> str:
    if explicit.strip():
        return explicit.strip()
    for key in ("CODEX_THREAD_ID", "CLAUDE_SESSION_ID", "CURSOR_SESSION_ID"):
        value = os.environ.get(key, "").strip()
        if value:
            return value
    state = read_json(context_dir(root) / "private" / "hook-sessions.json", {})
    if isinstance(state, dict):
        values = [value.strip() for value in state.values() if isinstance(value, str) and value.strip()]
        if values:
            return values[-1]
    return ""


def session_platform(root: Path, session_id: str) -> str:
    platform = "cli"
    for record in session_records(root):
        if record.get("session_id") == session_id and isinstance(record.get("platform"), str):
            platform = str(record["platform"])
    return platform


def archive_session(
    root: Path,
    session_id: str,
    summary: str,
    decisions: str,
    next_steps: str,
    files: str,
) -> Path:
    init_context(root)
    known = {str(item.get("session_id")) for item in session_records(root)}
    if not session_id or session_id not in known:
        raise ValueError("archive-session needs a session previously recorded by a lifecycle hook")
    file_list = list(dict.fromkeys(item.strip() for item in files.split(",") if item.strip()))
    map_result: dict[str, object] = {
        "committed": True,
        "reconciliation": {"files": [], "mapped": {}, "uncovered": [], "operations": []},
    }
    if file_list:
        map_result = run_node_workbench(
            ["map", "reconcile", "--root", str(root), "--session", session_id],
            {
                "summary": summary.strip(),
                "decisions": decisions.strip(),
                "next": next_steps.strip(),
                "files": file_list,
            },
        )
    reconciliation = map_result.get("reconciliation", {})
    if not isinstance(reconciliation, dict):
        reconciliation = {}
    node_ids = list((reconciliation.get("mapped") or {}).keys())
    proposed_id = str(reconciliation.get("proposedId") or "")
    if proposed_id:
        node_ids.append(proposed_id)
    path = append_session_event(
        root,
        "archive",
        session_platform(root, session_id),
        session_id,
        {
            "has_summary": bool(summary.strip()),
            "map_sync": "synced",
            "map_nodes": node_ids,
            "map_version": map_result.get("version"),
        },
    )
    lines = ["", f"## Archive {utc_now()}", ""]
    for heading, value in (
        ("Summary", summary),
        ("Decisions", decisions),
        ("Next", next_steps),
    ):
        if value.strip():
            lines.extend([f"### {heading}", "", value.strip(), ""])
    if file_list:
        lines.extend(["### Files", "", *[f"- {item}" for item in file_list], ""])
        mapped = reconciliation.get("mapped") or {}
        uncovered = reconciliation.get("uncovered") or []
        lines.extend([
            "### Map",
            "",
            "- status: synced",
            f"- existing nodes: {', '.join(mapped) if isinstance(mapped, dict) and mapped else 'none'}",
            f"- proposed node: {proposed_id or 'none'}",
            f"- version: {map_result.get('version') or 'unchanged'}",
            "",
        ])
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines).rstrip() + "\n")
    print(f"[context-guard] archived session: {session_id} ({path})")
    if file_list:
        print(
            "[context-guard] map synchronized: "
            f"{len(reconciliation.get('mapped') or {})} existing node(s), "
            f"{len(reconciliation.get('uncovered') or [])} uncovered file(s)"
        )
    return path


def validate_candidates(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or not isinstance(value.get("lenses"), list) or not value["lenses"]:
        raise ValueError("candidate input needs a non-empty lenses array")
    if len(value["lenses"]) > 12:
        raise ValueError("candidate input supports at most 12 lenses")
    lens_ids: set[str] = set()
    candidate_ids: set[str] = set()
    normalized: list[dict[str, object]] = []
    for lens in value["lenses"]:
        if not isinstance(lens, dict):
            raise ValueError("each lens must be an object")
        lens_id = safe_identifier(str(lens.get("id", "")), "")
        title = str(lens.get("title", "")).strip()
        candidates = lens.get("candidates")
        if not lens_id or lens_id in lens_ids or not title or not isinstance(candidates, list):
            raise ValueError("each lens needs a unique id, title, and candidates array")
        lens_ids.add(lens_id)
        items: list[dict[str, object]] = []
        for candidate in candidates:
            if not isinstance(candidate, dict):
                raise ValueError("each candidate must be an object")
            candidate_id = safe_identifier(str(candidate.get("id", "")), "")
            candidate_title = str(candidate.get("title", "")).strip()
            if not candidate_id or candidate_id in candidate_ids or not candidate_title:
                raise ValueError("each candidate needs a globally unique id and a title")
            owns = candidate.get("owns", [])
            if not isinstance(owns, list) or any(not isinstance(item, str) for item in owns):
                raise ValueError("candidate owns must be an array of paths")
            candidate_ids.add(candidate_id)
            items.append({
                "id": candidate_id,
                "title": candidate_title,
                "purpose": str(candidate.get("purpose", "")).strip(),
                "owns": [item.strip() for item in owns if item.strip()],
            })
        normalized.append({
            "id": lens_id,
            "title": title,
            "why": str(lens.get("why", "")).strip(),
            "candidates": items,
        })
    return {"v": 1, "generated_at": utc_now(), "lenses": normalized}


def write_candidates(root: Path, input_path: str) -> Path:
    init_context(root)
    if input_path == "-":
        value = json.load(sys.stdin)
    else:
        value = json.loads(Path(input_path).resolve().read_text(encoding="utf-8"))
    normalized = validate_candidates(value)
    path = context_dir(root) / "l1-candidates.json"
    write_json(path, normalized)
    print(f"[context-guard] candidates: {path}")
    return path


def next_bug_id(ctx: Path) -> str:
    numbers = []
    for path in (ctx / "bugs").glob("B*.md"):
        match = re.fullmatch(r"B(\d+)", path.stem)
        if match:
            numbers.append(int(match.group(1)))
    return f"B{max(numbers, default=0) + 1}"


def find_map_node(node: object, node_id: str) -> dict[str, object] | None:
    if not isinstance(node, dict):
        return None
    if str(node.get("id", "")) == node_id:
        return node
    children = node.get("children")
    if isinstance(children, list):
        for child in children:
            found = find_map_node(child, node_id)
            if found:
                return found
    return None


def run_node_workbench(args: list[str], payload: object = None) -> dict:
    command = ["node", str(Path(__file__).resolve().parent / "workbench" / "cli.mjs"), *args]
    completed = subprocess.run(command, input=json.dumps(payload, ensure_ascii=False) if payload is not None else None,
        text=True, encoding="utf-8", capture_output=True, timeout=30,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    try:
        result = json.loads(completed.stdout)
    except ValueError as exc:
        raise RuntimeError(completed.stderr or completed.stdout or "Node interface failed") from exc
    if completed.returncode or result.get("error"):
        raise RuntimeError(json.dumps(result, ensure_ascii=False))
    return result


def attach_bug_to_map(ctx: Path, bug: dict[str, object], node_id: str, session_id: str) -> None:
    args = ["attach-bug", "--root", str(ctx.parent.parent)]
    if session_id:
        args.extend(["--session", session_id])
    run_node_workbench(args, {"node": node_id, "bug": bug})


def record_bad_case(
    root: Path,
    title: str,
    phenomenon: str,
    trigger: str,
    cause: str,
    guard: str,
    node: str,
    status: str,
    keys: str,
    session_id: str,
) -> tuple[str, Path]:
    init_context(root)
    ctx = context_dir(root)
    map_doc = read_json(ctx / "map.json", {})
    map_root = map_doc.get("root") if isinstance(map_doc, dict) else None
    if node and find_map_node(map_root, node) is None:
        raise ValueError(f"unknown map node: {node}")
    if session_id:
        known = {str(item.get("session_id")) for item in session_records(root)}
        if session_id not in known:
            raise ValueError("bad-case session must first be recorded by a lifecycle hook")
    bug_id = next_bug_id(ctx)
    key_list = [item.strip() for item in keys.split(",") if item.strip()]
    bug_path = ctx / "bugs" / f"{bug_id}.md"
    fix_path = ctx / "fixes" / f"{bug_id}.md"
    card_path = f".codex/context/cards/{node}.md" if node else ""
    lines = [
        f"# {bug_id} {title.strip()}",
        "",
        f"- node: {node or 'unassigned'}",
        f"- status: {status}",
        f"- 现象: {phenomenon.strip()}",
        f"- keys: {', '.join(key_list)}",
        f"- sessions: {session_id or 'unassigned'}",
        f"- fix: .codex/context/fixes/{bug_id}.md",
    ]
    if card_path:
        lines.append(f"- card: {card_path}")
    bug_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    fix_lines = [
        f"# {bug_id} {title.strip()}",
        "",
        f"- bug: .codex/context/bugs/{bug_id}.md",
        f"- node: {node or 'unassigned'}",
        f"- status: {status}",
    ]
    if card_path:
        fix_lines.append(f"- card: {card_path}")
    fix_lines.extend([
        "", "## 触发", trigger.strip() or "待补充",
        "", "## 根因", cause.strip() or "待确认",
        "", "## 怎么修", "待记录修复方法" if status == "fixed" else "未修",
        "", "## 怎么防", guard.strip() or "待补充",
        "", "## 代码", "待补充",
        "", "## 证据", "待补充",
    ])
    fix_path.write_text("\n".join(fix_lines) + "\n", encoding="utf-8")

    index = read_json(ctx / "bugs-index.json", {})
    if not isinstance(index, dict):
        index = {}
    entry: dict[str, object] = {
        "title": title.strip(),
        "keys": key_list,
        "status": status,
        "bug": f".codex/context/bugs/{bug_id}.md",
        "fix": f".codex/context/fixes/{bug_id}.md",
        "sessions": [session_id] if session_id else [],
    }
    if card_path:
        entry["card"] = card_path
    index[bug_id] = entry
    write_json(ctx / "bugs-index.json", index)

    attach_bug_to_map(
        ctx,
        {
            "id": bug_id,
            "title": title.strip(),
            "desc": phenomenon.strip(),
            "status": status,
            "files": "",
            "sessions": [session_id] if session_id else [],
            "record": f".codex/context/bugs/{bug_id}.md",
        },
        node,
        session_id,
    )
    events = read_json(ctx / "bad-case-events.json", [])
    if not isinstance(events, list):
        events = []
    events.append({
        "at": utc_now(),
        "event": "occurrence",
        "case": bug_id,
        "status": status,
        "session_id": session_id or None,
        "phenomenon": phenomenon.strip(),
        "trigger": trigger.strip(),
    })
    write_json(ctx / "bad-case-events.json", events)
    print(f"[context-guard] recorded bad case: {bug_id} ({bug_path})")
    return bug_id, bug_path


def replace_markdown_section(text: str, heading: str, value: str) -> str:
    pattern = re.compile(rf"(?ms)(^## {re.escape(heading)}\n).*?(?=^## |\Z)")
    if pattern.search(text):
        return pattern.sub(lambda match: match.group(1) + value.strip() + "\n\n", text, count=1).rstrip() + "\n"
    return text.rstrip() + f"\n\n## {heading}\n{value.strip()}\n"


def update_bug_on_map(ctx: Path, bug_id: str, status: str, session_id: str) -> None:
    args = ["update-bug", "--root", str(ctx.parent.parent)]
    if session_id:
        args.extend(["--session", session_id])
    run_node_workbench(args, {"bug": {"id": bug_id, "status": status}})


def record_bad_case_fix(
    root: Path,
    bug_id: str,
    method: str,
    evidence: str,
    status: str,
    session_id: str,
) -> Path:
    init_context(root)
    ctx = context_dir(root)
    bug_id = bug_id.strip().upper()
    if not re.fullmatch(r"B\d+", bug_id):
        raise ValueError("case must use the B<number> identifier")
    bug_path = ctx / "bugs" / f"{bug_id}.md"
    fix_path = ctx / "fixes" / f"{bug_id}.md"
    if not bug_path.is_file() or not fix_path.is_file():
        raise ValueError(f"unknown bad case: {bug_id}")
    if not method.strip() or not evidence.strip():
        raise ValueError("record-bad-case-fix needs --method and --evidence")
    bug_text = re.sub(r"(?m)^- status: .*?$", f"- status: {status}", bug_path.read_text(encoding="utf-8"), count=1)
    bug_path.write_text(bug_text, encoding="utf-8")
    fix_text = re.sub(r"(?m)^- status: .*?$", f"- status: {status}", fix_path.read_text(encoding="utf-8"), count=1)
    fix_text = replace_markdown_section(fix_text, "怎么修", method)
    fix_text = replace_markdown_section(fix_text, "证据", evidence)
    fix_path.write_text(fix_text, encoding="utf-8")
    index = read_json(ctx / "bugs-index.json", {})
    if not isinstance(index, dict) or not isinstance(index.get(bug_id), dict):
        raise ValueError(f"bad case is missing from bugs-index.json: {bug_id}")
    index[bug_id]["status"] = status
    if session_id:
        sessions = index[bug_id].setdefault("sessions", [])
        if isinstance(sessions, list) and session_id not in sessions:
            sessions.append(session_id)
    write_json(ctx / "bugs-index.json", index)
    update_bug_on_map(ctx, bug_id, status, session_id)
    events = read_json(ctx / "bad-case-events.json", [])
    if not isinstance(events, list):
        events = []
    events.append({
        "at": utc_now(),
        "event": "fix",
        "case": bug_id,
        "status": status,
        "session_id": session_id or None,
        "method": method.strip(),
        "evidence": evidence.strip(),
    })
    write_json(ctx / "bad-case-events.json", events)
    print(f"[context-guard] recorded bad case fix: {bug_id} ({fix_path})")
    return fix_path


def validate_workbench_host(host: str) -> None:
    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("workbench host must be 127.0.0.1 or localhost")


def serve_workbench(root: Path, host: str, port: int) -> int:
    validate_workbench_host(host)
    init_context(root)
    return subprocess.call(["node", str(Path(__file__).resolve().parent / "workbench" / "cli.mjs"),
        "serve", "--root", str(root), "--host", host, "--port", str(port)])


def maybe_open_browser(url: str, enabled: bool) -> None:
    if not enabled or os.environ.get("CONTEXT_GUARD_HEADLESS") == "1" or os.environ.get("CI"):
        return
    try:
        webbrowser.open(url, new=2)
    except Exception:
        pass


def start_workbench(root: Path, host: str = "127.0.0.1", port: int = 8877, open_browser: bool = True) -> str | None:
    validate_workbench_host(host)
    if os.environ.get("CONTEXT_GUARD_DISABLE_WORKBENCH") == "1":
        return None
    init_context(root)
    try:
        result = run_node_workbench(["workbench", "--root", str(root), "--port", str(port)])
        url = result["url"]
        maybe_open_browser(url, open_browser)
        return url
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print(f"[context-guard] Node workbench: {exc}", file=sys.stderr)
        return None


def stop_workbench(root: Path) -> bool:
    result = run_node_workbench(["workbench", "--root", str(root), "--stop"])
    return bool(result.get("stopped"))


def show_roadmap(root: Path, should_open: bool) -> int:
    url = start_workbench(root, open_browser=should_open)
    if not url:
        print("[context-guard] workbench could not be started", file=sys.stderr)
        return 1
    print(f"[context-guard] live map: {context_dir(root) / 'map.json'}")
    print(f"[context-guard] workbench: {url}")
    return 0


def main() -> int:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Context Guard v1 utilities")
    parser.add_argument(
        "command",
        choices=[
            "init", "set-language", "workbench", "record-bad-case",
            "record-bad-case-fix", "archive-session", "write-candidates",
        ],
    )
    parser.add_argument("--root", type=Path, default=None)
    parser.add_argument("--language", default=None)
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--foreground", action="store_true")
    parser.add_argument("--stop", action="store_true")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8877)
    parser.add_argument("--title", default="")
    parser.add_argument("--phenomenon", default="")
    parser.add_argument("--trigger", default="")
    parser.add_argument("--cause", default="")
    parser.add_argument("--guard", default="")
    parser.add_argument("--node", default="")
    parser.add_argument("--status", choices=["open", "fixed", "resolved", "deferred", "wontfix"], default="open")
    parser.add_argument("--keys", default="")
    parser.add_argument("--session", default="")
    parser.add_argument("--case", dest="case_id", default="")
    parser.add_argument("--method", default="")
    parser.add_argument("--evidence", default="")
    parser.add_argument("--summary", default="")
    parser.add_argument("--decisions", default="")
    parser.add_argument("--next", dest="next_steps", default="")
    parser.add_argument("--files", default="")
    parser.add_argument("--input", default="")
    args, _unknown = parser.parse_known_args()
    explicit = args.root is not None
    root = (args.root or folder_root(Path.cwd())).resolve()
    blocked = guard_implicit_skill_root(root, explicit)
    if blocked:
        return blocked
    if args.command == "init":
        created = init_context(root)
        print(f"[context-guard] context: {context_dir(root)}")
        if created:
            print(f"[context-guard] created {len(created)} path(s)")
        return 0
    if args.command == "set-language":
        if not args.language:
            print("[context-guard] set-language needs --language", file=sys.stderr)
            return 2
        set_record_language(root, args.language)
        return 0
    if args.command == "record-bad-case":
        if not args.title or not args.phenomenon:
            print("[context-guard] record-bad-case needs --title and --phenomenon", file=sys.stderr)
            return 2
        try:
            record_bad_case(
                root,
                args.title,
                args.phenomenon,
                args.trigger,
                args.cause,
                args.guard,
                args.node,
                args.status,
                args.keys,
                resolve_session_id(root, args.session),
            )
            return 0
        except (OSError, RuntimeError, ValueError) as exc:
            print(f"[context-guard] record-bad-case failed: {exc}", file=sys.stderr)
            return 1
    if args.command == "record-bad-case-fix":
        try:
            record_bad_case_fix(
                root, args.case_id, args.method, args.evidence, args.status,
                resolve_session_id(root, args.session),
            )
            return 0
        except (OSError, RuntimeError, ValueError) as exc:
            print(f"[context-guard] record-bad-case-fix failed: {exc}", file=sys.stderr)
            return 1
    if args.command == "archive-session":
        if not any((args.summary.strip(), args.decisions.strip(), args.next_steps.strip(), args.files.strip())):
            print("[context-guard] archive-session needs durable --summary, --decisions, --next, or --files", file=sys.stderr)
            return 2
        try:
            archive_session(
                root, resolve_session_id(root, args.session), args.summary,
                args.decisions, args.next_steps, args.files,
            )
            return 0
        except (OSError, ValueError) as exc:
            print(f"[context-guard] archive-session failed: {exc}", file=sys.stderr)
            return 1
    if args.command == "write-candidates":
        if not args.input:
            print("[context-guard] write-candidates needs --input <json-file-or->", file=sys.stderr)
            return 2
        try:
            write_candidates(root, args.input)
            return 0
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            print(f"[context-guard] write-candidates failed: {exc}", file=sys.stderr)
            return 1
    if args.command == "workbench":
        if args.stop:
            stopped = stop_workbench(root)
            print(f"[context-guard] workbench: {'stopped' if stopped else 'not running'}")
            return 0
        try:
            if args.foreground:
                return serve_workbench(root, args.host, args.port)
            return show_roadmap(root, not args.no_open)
        except (OSError, ValueError) as exc:
            print(f"[context-guard] workbench failed: {exc}", file=sys.stderr)
            return 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
