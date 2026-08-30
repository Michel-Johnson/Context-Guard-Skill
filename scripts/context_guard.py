#!/usr/bin/env python3
"""Context Guard CLI: initialize project memory and run its local workbench."""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


def configure_stdio() -> None:
    """Use UTF-8 for client JSON and logs even on legacy Windows code pages."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")


PARKED = (
    "export-roadmap",
    "create-branch-task",
    "checkpoint-roadmap-node",
    "subagent-register",
    "subagent-complete",
    "validate-bad-cases",
    "validate-roadmap-maintenance",
    "validate-feature-chains",
    "test-hub-add",
    "test-hub-list",
    "test-hub-enable",
    "test-hub-disable",
    "test-hub-set-policy",
    "test-hub-remove",
    "feature-chain-add",
    "feature-chain-propose",
    "feature-chain-auto-propose",
    "feature-chain-attach-bc",
    "feature-chain-approve",
    "feature-chain-dry-run",
    "feature-chain-set-policy",
    "feature-chain-set-checkpoint",
    "feature-chain-suggest",
    "feature-chain-plan",
    "feature-chain-list",
    "feature-chain-summary",
    "feature-chain-overlap",
    "feature-chain-coverage",
    "feature-chain-candidates",
    "show-test-hub",
    "serve-test-hub",
    "dev-complete",
)

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
4. Map — workbench writes `map.json`; agent uses `owns-index.json` and `cards/`

Do not paste `map.json` or `jump-index.json`. Do not Grep this whole folder.
After the map changes: `python3 scripts/map_owns.py cards`.
"""

ARCHITECTURE_MD = """# Architecture Map

Status: pending
Later sessions: open `.codex/context/map.json`. Do not re-analyze unless asked.

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
                "root": None,
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


def attach_bug_to_map(ctx: Path, bug: dict[str, object], node_id: str) -> None:
    path = ctx / "map.json"
    document = read_json(path, {})
    if not isinstance(document, dict):
        return
    root = document.get("root")
    target = find_map_node(root, node_id) if node_id else (root if isinstance(root, dict) else None)
    if not isinstance(target, dict):
        unassigned = document.get("unassigned_bugs")
        if not isinstance(unassigned, list):
            unassigned = []
            document["unassigned_bugs"] = unassigned
        unassigned[:] = [item for item in unassigned if not isinstance(item, dict) or item.get("id") != bug["id"]]
        unassigned.append(bug)
    else:
        bugs = target.get("bugs")
        if not isinstance(bugs, list):
            bugs = []
            target["bugs"] = bugs
        bugs[:] = [item for item in bugs if not isinstance(item, dict) or item.get("id") != bug["id"]]
        bugs.append(bug)
    document["updated"] = datetime.now().strftime("%Y-%m-%d")
    write_json(path, document)


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
) -> tuple[str, Path]:
    init_context(root)
    ctx = context_dir(root)
    bug_id = next_bug_id(ctx)
    key_list = [item.strip() for item in keys.split(",") if item.strip()]
    bug_path = ctx / "bugs" / f"{bug_id}.md"
    card_path = f".codex/context/cards/{node}.md" if node else ""
    lines = [
        f"# {bug_id} {title.strip()}",
        "",
        f"- node: {node or 'unassigned'}",
        f"- status: {status}",
        f"- 现象: {phenomenon.strip()}",
        f"- 触发: {trigger.strip()}",
        f"- 原因: {cause.strip() or '待确认'}",
        f"- guard: {guard.strip() or '待补充'}",
        f"- keys: {', '.join(key_list)}",
    ]
    if card_path:
        lines.append(f"- card: {card_path}")
    bug_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    index = read_json(ctx / "bugs-index.json", {})
    if not isinstance(index, dict):
        index = {}
    entry: dict[str, object] = {
        "title": title.strip(),
        "keys": key_list,
        "status": status,
        "bug": f".codex/context/bugs/{bug_id}.md",
        "fix": f".codex/context/fixes/{bug_id}.md",
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
            "sessions": "",
            "record": f".codex/context/bugs/{bug_id}.md",
        },
        node,
    )
    print(f"[context-guard] recorded bad case: {bug_id} ({bug_path})")
    return bug_id, bug_path


def workbench_state_path(root: Path) -> Path:
    return context_dir(root) / "private" / "workbench.json"


def workbench_health(url: str, timeout: float = 0.5, report_error: bool = False) -> dict[str, object] | None:
    health_url = url.split("/prototype/", 1)[0].rstrip("/") + "/__context_guard/health"
    try:
        with urllib.request.urlopen(health_url, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
            return data if isinstance(data, dict) else None
    except (OSError, ValueError, urllib.error.URLError) as exc:
        if report_error:
            print(f"[context-guard] health request failed: {exc}", file=sys.stderr)
        return None


def running_workbench(root: Path) -> dict[str, object] | None:
    state = read_json(workbench_state_path(root), {})
    if not isinstance(state, dict) or not isinstance(state.get("url"), str):
        return None
    health = workbench_health(str(state["url"]))
    if not health or health.get("root") != str(root.resolve()):
        return None
    return state


def first_available_port(host: str, preferred: int) -> int:
    for port in range(preferred, preferred + 21):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((host, port))
            except OSError:
                continue
            return port
    raise OSError(f"no available port from {preferred} to {preferred + 20}")


class WorkbenchHandler(SimpleHTTPRequestHandler):
    server_version = "ContextGuardWorkbench/1.0"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        if urlsplit(self.path).path == "/__context_guard/health":
            body = json.dumps(
                {"ok": True, "root": str(self.server.project_root), "pid": os.getpid()},
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if urlsplit(self.path).path == "/":
            self.send_response(302)
            self.send_header("Location", "/prototype/workbench.html")
            self.end_headers()
            return
        super().do_GET()

    def translate_path(self, request_path: str) -> str:
        raw_path = unquote(urlsplit(request_path).path).replace("\\", "/")
        parts = [part for part in raw_path.split("/") if part not in {"", ".", ".."}]
        if parts and parts[0] == "prototype":
            base = self.server.skill_root.resolve()
        elif parts[:2] == [".codex", "context"] and parts[2:] in [
            ["map.json"],
            ["preferences.json"],
            ["l1-candidates.json"],
        ]:
            base = self.server.project_root.resolve()
        else:
            return str(self.server.project_root / ".codex" / "context" / "__not_found__")
        candidate = base.joinpath(*parts).resolve()
        try:
            candidate.relative_to(base)
        except ValueError:
            return str(base / "__not_found__")
        return str(candidate)


class WorkbenchServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], root: Path):
        self.project_root = root.resolve()
        self.skill_root = context_guard_skill_root()
        super().__init__(address, WorkbenchHandler)


def workbench_url(host: str, port: int) -> str:
    return f"http://{host}:{port}/prototype/workbench.html"


def validate_workbench_host(host: str) -> None:
    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("workbench host must be 127.0.0.1 or localhost")


def serve_workbench(root: Path, host: str, port: int) -> int:
    validate_workbench_host(host)
    init_context(root)
    print(f"[context-guard] binding workbench at {host}:{port}", flush=True)
    server = WorkbenchServer((host, port), root)
    actual_port = int(server.server_address[1])
    url = workbench_url(host, actual_port)
    state = {"pid": os.getpid(), "root": str(root.resolve()), "url": url, "started": utc_now()}
    write_json(workbench_state_path(root), state)
    print(f"[context-guard] workbench: {url}", flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        current = read_json(workbench_state_path(root), {})
        if isinstance(current, dict) and current.get("pid") == os.getpid():
            workbench_state_path(root).unlink(missing_ok=True)
    return 0


def maybe_open_browser(url: str, enabled: bool) -> None:
    if not enabled or os.environ.get("CONTEXT_GUARD_HEADLESS") == "1" or os.environ.get("CI"):
        return
    try:
        webbrowser.open(url, new=2)
    except Exception:
        pass


def start_workbench(
    root: Path,
    host: str = "127.0.0.1",
    port: int = 8877,
    open_browser: bool = True,
) -> str | None:
    validate_workbench_host(host)
    if os.environ.get("CONTEXT_GUARD_DISABLE_WORKBENCH") == "1":
        return None
    init_context(root)
    current = running_workbench(root)
    if current:
        url = str(current["url"])
        maybe_open_browser(url, open_browser)
        return url

    port = first_available_port(host, port)
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "workbench",
        "--root",
        str(root.resolve()),
        "--host",
        host,
        "--port",
        str(port),
        "--foreground",
        "--no-open",
    ]
    kwargs: dict[str, object] = {
        "cwd": str(root),
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True
    log_path = workbench_state_path(root).with_suffix(".log")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("w", encoding="utf-8") as log_file:
        kwargs["stdout"] = log_file
        kwargs["stderr"] = log_file
        process = subprocess.Popen(command, **kwargs)
    url = workbench_url(host, port)
    deadline = time.monotonic() + 10
    health = None
    while time.monotonic() < deadline:
        health = workbench_health(url, timeout=0.2)
        if health and health.get("root") == str(root.resolve()):
            maybe_open_browser(url, open_browser)
            return url
        if process.poll() is not None:
            break
        time.sleep(0.1)
    exit_code = process.poll()
    workbench_health(url, report_error=True)
    if exit_code is None:
        process.terminate()
    detail = log_path.read_text(encoding="utf-8", errors="replace").strip()
    print(
        f"[context-guard] workbench startup failed; exit={exit_code}; "
        f"health={health!r}; state={read_json(workbench_state_path(root), {})!r}; "
        f"expected_root={str(root.resolve())!r}; log: {log_path}"
        + (f"\n{detail[-2000:]}" if detail else ""),
        file=sys.stderr,
    )
    return None


def stop_workbench(root: Path) -> bool:
    state = running_workbench(root)
    if not state:
        workbench_state_path(root).unlink(missing_ok=True)
        return False
    pid = state.get("pid")
    if not isinstance(pid, int) or pid == os.getpid():
        return False
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return False
    for _ in range(20):
        if not workbench_health(str(state["url"]), timeout=0.1):
            break
        time.sleep(0.1)
    workbench_state_path(root).unlink(missing_ok=True)
    return True


def show_roadmap(root: Path, should_open: bool) -> int:
    url = start_workbench(root, open_browser=should_open)
    if not url:
        print("[context-guard] workbench could not be started", file=sys.stderr)
        return 1
    print(f"[context-guard] live map: {context_dir(root) / 'map.json'}")
    print(f"[context-guard] workbench: {url}")
    return 0


def parked_command(name: str) -> int:
    print(
        f"[context-guard] `{name}` is parked. v1 is sessions / bugs / tasks / map. "
        "See TODO.md at the repo root. Do not expand Test Hub or Roadmap HTML.",
        file=sys.stderr,
    )
    return 2


def main() -> int:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Context Guard v1 utilities")
    parser.add_argument(
        "command",
        choices=["init", "set-language", "show-roadmap", "workbench", "record-bad-case", *PARKED],
    )
    parser.add_argument("--root", type=Path, default=None)
    parser.add_argument("--language", default=None)
    parser.add_argument("--open", action="store_true")
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
    parser.add_argument("--status", choices=["open", "fixed", "deferred", "wontfix"], default="open")
    parser.add_argument("--keys", default="")
    args, _unknown = parser.parse_known_args()
    explicit = args.root is not None
    root = (args.root or folder_root(Path.cwd())).resolve()
    blocked = guard_implicit_skill_root(root, explicit)
    if blocked:
        return blocked
    if args.command in PARKED:
        return parked_command(args.command)
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
        )
        return 0
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
    if args.command == "show-roadmap":
        return show_roadmap(root, args.open and not args.no_open)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
