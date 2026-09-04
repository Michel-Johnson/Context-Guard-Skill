#!/usr/bin/env python3
"""Context Guard CLI: initialize project memory and run its local workbench."""

from __future__ import annotations

import argparse
import errno
import functools
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import webbrowser
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

WINDOWS_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


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
4. Map — `context-guard map read/apply` uses the authoritative map and a page synchronization checkpoint. `archive-session --files ...` records completed work on owning nodes. Unowned files stay unclassified unless `--input` explicitly assigns them or supplies an evidence-backed node proposal.

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
            creationflags=WINDOWS_NO_WINDOW,
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
    root = root.resolve()
    binding_file = root / ".codex/context/private/project-binding.json"
    if not binding_file.exists():
        return root / ".codex" / "context"
    binding = json.loads(binding_file.read_text(encoding="utf-8"))
    target = Path(binding.get("projectRoot", ""))
    if binding.get("version") != 1 or not target.is_absolute():
        raise ValueError("Invalid workbench project binding")
    target = target.resolve(strict=True)
    if target == root or (target / ".codex/context/private/project-binding.json").exists():
        raise ValueError("Workbench binding chains are not supported")
    def git_common(folder: Path) -> Path:
        result = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=folder,
                                text=True, capture_output=True, check=True, timeout=5,
                                creationflags=WINDOWS_NO_WINDOW)
        return (folder / result.stdout.strip()).resolve(strict=True)
    if git_common(root) != git_common(target) or not (target / ".codex/context/map.json").is_file():
        raise ValueError("Bound worktree must reference an existing Map in the same Git repository")
    # A legacy project binding selects the service, never another worktree's
    # Session storage. Preserve the source records and registration evidence.
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


def read_input_json(input_path: str) -> object:
    """Read CLI JSON as UTF-8 bytes so Windows console encodings cannot corrupt it."""
    if input_path == "-":
        return json.loads(sys.stdin.buffer.read().decode("utf-8"))
    return json.loads(Path(input_path).resolve().read_text(encoding="utf-8"))


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def write_json(path: Path, value: object) -> None:
    atomic_write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def read_preferences(ctx: Path) -> dict[str, str]:
    local = ctx / "preferences.json"
    data = json.loads(local.read_text(encoding="utf-8")) if local.exists() else {}
    if not isinstance(data, dict):
        raise ValueError("Invalid preferences; repair the file instead of repeating setup")
    shared = run_node_workbench(["preferences", "--root", str(ctx.parent.parent)])
    return {**data, **shared}


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
    normalized = normalize_record_language(language)
    run_node_workbench(["preferences", "--root", str(root), "--language", normalized])
    init_context(root)
    ctx = context_dir(root)
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
    recorded_at = utc_now()
    record: dict[str, object] = {
        "at": recorded_at,
        "occurred_at": recorded_at,
        "recorded_at": recorded_at,
        "event_id": str(uuid.uuid4()),
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
        handle.write(f"- {record['at']} · {event} · {record['event_id']}\n")
    return session_path


def hook_runtime_path(root: Path, session_id: str) -> Path:
    digest = hashlib.sha256(session_id.encode("utf-8")).hexdigest()
    return context_dir(root) / "private" / "hook-runtime" / f"{digest}.json"


_HOOK_RUNTIME_LOCKS: dict[str, dict[str, object]] = {}


class _HookRuntimeLockLease:
    def __init__(self, key: str):
        self.key = key
        self.closed = False

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        state = _HOOK_RUNTIME_LOCKS.get(self.key)
        if not state:
            return
        count = int(state["count"]) - 1
        if count > 0:
            state["count"] = count
            return
        handle = state["handle"]
        try:
            if os.name == "nt":
                import msvcrt
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()
            _HOOK_RUNTIME_LOCKS.pop(self.key, None)

    def __enter__(self) -> "_HookRuntimeLockLease":
        return self

    def __exit__(self, _type: object, _value: object, _traceback: object) -> None:
        self.close()

    def __del__(self) -> None:
        self.close()


def acquire_hook_runtime_lock(root: Path, session_id: str, timeout: float = 10.0) -> _HookRuntimeLockLease:
    """Acquire a crash-safe, re-entrant process lock for one Session runtime."""
    target = hook_runtime_path(root, session_id)
    lock_path = target.with_suffix(".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    key = str(lock_path.resolve())
    held = _HOOK_RUNTIME_LOCKS.get(key)
    if held:
        held["count"] = int(held["count"]) + 1
        return _HookRuntimeLockLease(key)

    handle = lock_path.open("a+b")
    if os.name == "nt":
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"\0")
            handle.flush()
    deadline = time.monotonic() + timeout
    while True:
        try:
            if os.name == "nt":
                import msvcrt
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except (BlockingIOError, OSError) as exc:
            if isinstance(exc, OSError) and exc.errno not in {None, errno.EACCES, errno.EAGAIN}:
                handle.close()
                raise
            if time.monotonic() >= deadline:
                handle.close()
                raise TimeoutError(f"timed out waiting for hook runtime lock: {lock_path}") from exc
            time.sleep(0.02)
    _HOOK_RUNTIME_LOCKS[key] = {"handle": handle, "count": 1}
    return _HookRuntimeLockLease(key)


@contextmanager
def hook_runtime_lock(root: Path, session_id: str, timeout: float = 10.0):
    lease = acquire_hook_runtime_lock(root, session_id, timeout)
    try:
        yield
    finally:
        lease.close()


def serialize_hook_runtime(session_arg: int):
    """Serialize a CLI operation that performs a runtime read-modify-write."""
    def decorate(function):
        @functools.wraps(function)
        def wrapped(*args, **kwargs):
            root = args[0] if args else kwargs["root"]
            session_id = args[session_arg] if len(args) > session_arg else kwargs.get("session_id", "")
            if not session_id:
                return function(*args, **kwargs)
            with hook_runtime_lock(root, str(session_id)):
                return function(*args, **kwargs)
        return wrapped
    return decorate


def serialize_named_lock(name: str):
    """Serialize a project-wide registry update independently of Session IDs."""
    def decorate(function):
        @functools.wraps(function)
        def wrapped(*args, **kwargs):
            root = args[0] if args else kwargs["root"]
            with hook_runtime_lock(root, f"registry:{name}"):
                return function(*args, **kwargs)
        return wrapped
    return decorate


def read_hook_runtime(root: Path, session_id: str) -> dict[str, object]:
    target = hook_runtime_path(root, session_id)
    if not target.exists():
        value: object = {}
    else:
        try:
            value = json.loads(target.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            raise ValueError(f"hook runtime is unreadable; preserve and repair {target}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"hook runtime must be a JSON object: {target}")
    recorded_session = value.get("session_id")
    if recorded_session not in {None, session_id}:
        raise ValueError(f"hook runtime belongs to another Session: {target}")
    if "signals" in value and not isinstance(value["signals"], list):
        raise ValueError(f"hook runtime signals must be a list: {target}")
    value.setdefault("v", 1)
    value.setdefault("session_id", session_id)
    value.setdefault("signals", [])
    return value


def write_hook_runtime(root: Path, session_id: str, value: dict[str, object]) -> Path:
    value["v"] = 1
    value["session_id"] = session_id
    value["updated_at"] = utc_now()
    target = hook_runtime_path(root, session_id)
    atomic_write_text(target, json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    return target


def prompt_signal_id(session_id: str, turn_id: str, prompt: str) -> str:
    digest = hashlib.sha256(
        json.dumps([session_id, turn_id, prompt], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"SIG-{digest[:20]}"


@serialize_hook_runtime(1)
def add_prompt_signal(root: Path, session_id: str, turn_id: str, prompt: str) -> dict[str, object]:
    runtime = read_hook_runtime(root, session_id)
    signals = runtime.get("signals")
    if not isinstance(signals, list):
        signals = []
        runtime["signals"] = signals
    signal_id = prompt_signal_id(session_id, turn_id, prompt)
    existing = next((item for item in signals if isinstance(item, dict) and item.get("id") == signal_id), None)
    if existing:
        return existing
    signal: dict[str, object] = {
        "id": signal_id,
        "turn_id": turn_id,
        "created_at": utc_now(),
        "prompt_hash": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        "preview": " ".join(prompt.split())[:400],
        "status": "pending",
    }
    signals.append(signal)
    if len(signals) > 100:
        unresolved = [item for item in signals if isinstance(item, dict) and item.get("status") == "pending"]
        resolved = [item for item in signals if isinstance(item, dict) and item.get("status") != "pending"][-50:]
        runtime["signals"] = unresolved + resolved
    write_hook_runtime(root, session_id, runtime)
    return signal


@serialize_hook_runtime(1)
def resolve_prompt_signal(
    root: Path,
    session_id: str,
    signal_id: str,
    kind: str,
    node_id: str = "",
    record_id: str = "",
) -> dict[str, object]:
    runtime = read_hook_runtime(root, session_id)
    signals = runtime.get("signals")
    if not isinstance(signals, list):
        raise ValueError("hook runtime has no prompt signals")
    signal = next((item for item in signals if isinstance(item, dict) and item.get("id") == signal_id), None)
    if not signal:
        raise ValueError(f"unknown prompt signal: {signal_id}")
    previous = str(signal.get("kind") or "")
    if signal.get("status") == "resolved" and previous and previous != kind:
        raise ValueError(f"prompt signal is already resolved as {previous}")
    signal.update({
        "status": "resolved",
        "kind": kind,
        "resolved_at": utc_now(),
        "node_id": node_id or None,
        "record_id": record_id or None,
    })
    write_hook_runtime(root, session_id, runtime)
    return signal


@serialize_hook_runtime(1)
def split_signal(root: Path, session_id: str, signal_id: str, items: object) -> list[dict]:
    """The Agent separates meanings; the hook never guesses from keywords."""
    if not isinstance(items, list) or not 2 <= len(items) <= 20 or not all(isinstance(item, str) and item.strip() for item in items):
        raise ValueError("split-signal needs 2–20 nonempty text items")
    runtime = read_hook_runtime(root, session_id)
    parent = next((item for item in runtime["signals"] if item.get("id") == signal_id), None)
    if not parent:
        raise ValueError("unknown parent signal")
    normalized = [item.strip() for item in items]
    digest = hashlib.sha256(json.dumps(normalized, ensure_ascii=False).encode()).hexdigest()
    if parent.get("status") == "resolved":
        if parent.get("kind") == "split" and parent.get("split_hash") == digest:
            return [item for item in runtime["signals"] if item.get("parent_id") == signal_id]
        raise ValueError("parent signal already resolved; cannot replace its classification")
    children = [{"id": prompt_signal_id(session_id, f"{signal_id}:{index}", text), "parent_id": signal_id,
                 "turn_id": parent.get("turn_id"), "created_at": utc_now(), "preview": text[:400],
                 "prompt_hash": hashlib.sha256(text.encode()).hexdigest(), "status": "pending"}
                for index, text in enumerate(normalized)]
    parent.update({"status": "resolved", "kind": "split", "resolved_at": utc_now(), "split_hash": digest})
    runtime["signals"].extend(children)
    write_hook_runtime(root, session_id, runtime)
    append_session_event(root, "signal-split", session_platform(root, session_id), session_id,
                         {"signal_id": signal_id, "child_ids": [item["id"] for item in children]})
    return children


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


@serialize_hook_runtime(1)
def archive_session(
    root: Path,
    session_id: str,
    summary: str,
    decisions: str,
    next_steps: str,
    files: str,
    input_path: str = "",
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
    governance: dict[str, object] = {}
    runtime = read_hook_runtime(root, session_id)
    plan = runtime.get("active_plan")
    closure: dict[str, object] = {}
    if input_path:
        raw_governance = read_input_json(input_path)
        if not isinstance(raw_governance, dict):
            raise ValueError("archive-session --input needs a JSON object")
        unsupported = set(raw_governance) - {"assignments", "proposal", "verification", "assessment", "scope_review", "failure_review", "subagent_review"}
        if unsupported:
            raise ValueError(f"archive-session --input has unsupported fields: {', '.join(sorted(unsupported))}")
        governance = {key: value for key, value in raw_governance.items() if key in {"assignments", "proposal"}}
        closure = {key: value for key, value in raw_governance.items() if key not in governance}
    current_snapshot = None
    if isinstance(plan, dict):
        from context_guard_hook import scope_snapshot
        assessment = closure.get("assessment")
        if not summary.strip() or not isinstance(closure.get("verification"), str) or not closure["verification"].strip():
            raise ValueError("active plan archive needs summary and verification evidence in --input")
        if not isinstance(assessment, dict) or assessment.get("decision") not in {"reuse", "propose", "none"} or not str(assessment.get("reason") or "").strip():
            raise ValueError("archive needs assessment {decision:reuse|propose|none, reason}")
        if (assessment["decision"] == "propose") != bool(governance.get("proposal")):
            raise ValueError("proposal input must agree with the node/module assessment")
        for flag, field in (("scope_review_required", "scope_review"), ("failure_review_required", "failure_review")):
            if plan.get(flag) and not str(closure.get(field) or "").strip():
                raise ValueError(f"archive needs {field}: explain actual scope or failed tool recovery")
        reviews = closure.get("subagent_review") or {}
        for agent_id, agent in (runtime.get("subagents") or {}).items():
            if agent.get("plan_id") == plan["id"] and (not isinstance(reviews, dict) or not str(reviews.get(agent_id) or "").strip()):
                raise ValueError(f"archive needs subagent_review for {agent_id}: verify or explicitly discard its result")
        current_snapshot = scope_snapshot(root, plan["paths"])
        baseline = plan.get("baseline") or {}
        changed = {file for file in set(baseline) | set(current_snapshot) if baseline.get(file) != current_snapshot.get(file)}
        if changed - set(file_list):
            raise ValueError("archive omitted changed files: " + ", ".join(sorted(changed - set(file_list))))
        if set(file_list) - (changed | set(plan.get("actual_paths") or [])):
            raise ValueError("archive includes files not observed changed by the plan")
    if governance and not file_list:
        raise ValueError("archive-session --input needs --files")
    if file_list or isinstance(plan, dict):
        map_result = run_node_workbench(
            ["map", "reconcile", "--root", str(root), "--session", session_id],
            {
                "summary": summary.strip(),
                "decisions": decisions.strip(),
                "next": next_steps.strip(),
                "files": file_list,
                **({"nodeIds": plan["node_ids"] if not file_list else [], "planId": plan["id"],
                    "verification": closure["verification"], "assessment": closure["assessment"]} if isinstance(plan, dict) else {}),
                **governance,
            },
        )
    reconciliation = map_result.get("reconciliation", {})
    if not isinstance(reconciliation, dict):
        reconciliation = {}
    if isinstance(plan, dict) and (map_result.get("committed") is not True or reconciliation.get("unclassified") or reconciliation.get("uncovered")):
        raise ValueError("plan archive incomplete: assign uncovered files to existing nodes or submit an evidence-backed proposal")
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
    if closure:
        lines.extend(["### Verification and assessment", "", json.dumps(closure, ensure_ascii=False, indent=2), ""])
    if file_list:
        lines.extend(["### Files", "", *[f"- {item}" for item in file_list], ""])
        mapped = reconciliation.get("mapped") or {}
        unclassified = reconciliation.get("unclassified") or reconciliation.get("uncovered") or []
        lines.extend([
            "### Map",
            "",
            "- status: synced",
            f"- existing nodes: {', '.join(mapped) if isinstance(mapped, dict) and mapped else 'none'}",
            f"- proposed node: {proposed_id or 'none'}",
            f"- unclassified files: {', '.join(unclassified) if isinstance(unclassified, list) and unclassified else 'none'}",
            f"- version: {map_result.get('version') or 'unchanged'}",
            "",
        ])
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines).rstrip() + "\n")
    if isinstance(plan, dict):
        # A successful Map write plus local archive is the receipt; a reminder or
        # an attempted write can never stand in for it.
        latest = read_hook_runtime(root, session_id)
        active = latest.get("active_plan") or {}
        if active.get("id") != plan["id"] or active.get("revision") != plan.get("revision"):
            raise ValueError("plan changed during archive; Map write succeeded but completion receipt needs revalidation")
        plan["archive"] = {"at": utc_now(), "revision": plan.get("revision"), "snapshot": current_snapshot,
                           "map_version": map_result.get("version"), "node_ids": node_ids, **closure}
        latest["active_plan"] = plan
        write_hook_runtime(root, session_id, latest)
    print(f"[context-guard] archived session: {session_id} ({path})")
    if file_list:
        print(
            "[context-guard] map synchronized: "
            f"{len(reconciliation.get('mapped') or {})} existing node(s), "
            f"{len(reconciliation.get('unclassified') or reconciliation.get('uncovered') or [])} unclassified file(s), "
            f"{'1 proposed node' if proposed_id else 'no node proposal'}"
        )
    memory = run_node_workbench(["memory", "status", "--root", str(root), "--session", session_id])
    if memory.get("current"):
        receipt = run_node_workbench(["memory", "sync", "--root", str(root), "--session", session_id])
        print(f"[context-guard] server archive acknowledged: {receipt.get('snapshot', {}).get('version')}")
    else:
        print("[context-guard] server memory not configured; local archive remains unsynced")
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
    value = read_input_json(input_path)
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


@serialize_hook_runtime(4)
def record_todo(
    root: Path,
    title: str,
    description: str,
    node_id: str,
    session_id: str,
    signal_id: str,
) -> dict[str, object]:
    init_context(root)
    if not title.strip() or not node_id.strip() or not signal_id.strip():
        raise ValueError("record-todo needs --title, --node, and --signal")
    known = {str(item.get("session_id")) for item in session_records(root)}
    if not session_id or session_id not in known:
        raise ValueError("record-todo needs a session previously recorded by a lifecycle hook")
    runtime = read_hook_runtime(root, session_id)
    signals = runtime.get("signals") if isinstance(runtime.get("signals"), list) else []
    signal = next((item for item in signals if isinstance(item, dict) and item.get("id") == signal_id), None)
    if not signal:
        raise ValueError(f"unknown prompt signal: {signal_id}")
    if signal.get("status") == "resolved" and signal.get("kind") not in {None, "", "todo"}:
        raise ValueError(f"prompt signal is already resolved as {signal.get('kind')}")
    map_doc = read_json(context_dir(root) / "map.json", {})
    if find_map_node(map_doc.get("root") if isinstance(map_doc, dict) else None, node_id) is None:
        raise ValueError(f"unknown map node: {node_id}")
    todo_id = "TD-" + hashlib.sha256(f"{session_id}\0{signal_id}".encode("utf-8")).hexdigest()[:16]
    result = run_node_workbench(
        ["record-todo", "--root", str(root), "--session", session_id],
        {
            "id": todo_id,
            "node": node_id,
            "signalId": signal_id,
            "title": title.strip(),
            "description": description.strip(),
            "at": str(signal.get("created_at") or utc_now()),
        },
    )
    resolve_prompt_signal(root, session_id, signal_id, "todo", node_id, todo_id)
    append_session_event(
        root,
        "todo-recorded",
        session_platform(root, session_id),
        session_id,
        {
            "signal_id": signal_id,
            "node_ids": [node_id],
            "record_id": todo_id,
            "map_version": result.get("version"),
        },
    )
    print(f"[context-guard] recorded todo: {todo_id} ({node_id})")
    return {"id": todo_id, "node": node_id, "version": result.get("version"), "duplicate": bool(result.get("duplicate"))}


@serialize_hook_runtime(1)
def resolve_signal(root: Path, session_id: str, signal_id: str, kind: str) -> dict[str, object]:
    if kind not in {"task", "ignore"}:
        raise ValueError("resolve-signal --kind must be task or ignore; use record-todo/record-bad-case for durable records")
    signal = resolve_prompt_signal(root, session_id, signal_id, kind)
    append_session_event(
        root,
        "signal-resolved",
        session_platform(root, session_id),
        session_id,
        {"signal_id": signal_id, "signal_kind": kind, "turn_id": signal.get("turn_id")},
    )
    print(f"[context-guard] resolved signal: {signal_id} ({kind})")
    return signal


def run_node_workbench(args: list[str], payload: object = None) -> dict:
    command = ["node", str(Path(__file__).resolve().parent / "workbench" / "cli.mjs"), *args]
    completed = subprocess.run(command, input=json.dumps(payload, ensure_ascii=False) if payload is not None else None,
        text=True, encoding="utf-8", capture_output=True, timeout=30,
        creationflags=WINDOWS_NO_WINDOW)
    try:
        result = json.loads(completed.stdout)
    except ValueError as exc:
        raise RuntimeError(completed.stderr or completed.stdout or "Node interface failed") from exc
    if completed.returncode or result.get("error"):
        raise RuntimeError(json.dumps(result, ensure_ascii=False))
    return result


def attach_bug_to_map(ctx: Path, bug: dict[str, object], node_id: str, session_id: str) -> None:
    if not node_id:
        return
    args = ["attach-bug", "--root", str(ctx.parent.parent)]
    if session_id:
        args.extend(["--session", session_id])
    run_node_workbench(args, {"node": node_id, "bug": bug})


def bad_case_transaction_dir(ctx: Path) -> Path:
    return ctx / "private" / "bad-case-transactions"


def bad_case_failpoint(stage: str) -> None:
    if os.environ.get("CONTEXT_GUARD_TESTING") == "1" and os.environ.get("CONTEXT_GUARD_BAD_CASE_FAILPOINT") == stage:
        os._exit(91)


def remove_durable_file(path: Path) -> None:
    path.unlink(missing_ok=True)
    if os.name != "nt" and path.parent.exists():
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)


def bad_case_transaction_path(ctx: Path, transaction_id: str) -> Path:
    digest = hashlib.sha256(transaction_id.encode("utf-8")).hexdigest()
    return bad_case_transaction_dir(ctx) / f"{digest}.json"


def apply_bad_case_transaction(root: Path, transaction: dict[str, object], journal: Path) -> None:
    ctx = context_dir(root)
    operation = str(transaction.get("operation") or "")
    bug_id = str(transaction.get("bug_id") or "")
    session_id = str(transaction.get("session_id") or "")
    if operation not in {"occurrence", "fix"} or not re.fullmatch(r"B\d+", bug_id):
        raise ValueError(f"invalid bad-case recovery journal: {journal}")

    bug_path = ctx / "bugs" / f"{bug_id}.md"
    fix_path = ctx / "fixes" / f"{bug_id}.md"
    atomic_write_text(bug_path, str(transaction["bug_text"]))
    bad_case_failpoint("after-bug-file")
    atomic_write_text(fix_path, str(transaction["fix_text"]))
    bad_case_failpoint("after-fix-file")

    index = read_json(ctx / "bugs-index.json", {})
    if not isinstance(index, dict):
        index = {}
    index[bug_id] = transaction["index_entry"]
    write_json(ctx / "bugs-index.json", index)
    bad_case_failpoint("after-index")

    map_bug = transaction.get("map_bug")
    if operation == "occurrence" and isinstance(map_bug, dict):
        attach_bug_to_map(ctx, map_bug, str(transaction.get("node") or ""), session_id)
    elif operation == "fix":
        update_bug_on_map(ctx, bug_id, str(transaction.get("status") or "fixed"), session_id)
    bad_case_failpoint("after-map")

    events = read_json(ctx / "bad-case-events.json", [])
    if not isinstance(events, list):
        events = []
    event = transaction.get("event")
    transaction_id = str(transaction.get("transaction_id") or "")
    if isinstance(event, dict) and not any(isinstance(item, dict) and item.get("transaction_id") == transaction_id for item in events):
        events.append(event)
        write_json(ctx / "bad-case-events.json", events)
    bad_case_failpoint("after-event")

    signal_id = str(transaction.get("signal_id") or "")
    if operation == "occurrence" and signal_id:
        with hook_runtime_lock(root, session_id):
            resolve_prompt_signal(root, session_id, signal_id, "bad-case", str(transaction.get("node") or ""), bug_id)
    remove_durable_file(journal)


def recover_bad_case_transactions(root: Path) -> None:
    ctx = context_dir(root)
    directory = bad_case_transaction_dir(ctx)
    for journal in sorted(directory.glob("*.json")) if directory.exists() else []:
        transaction = read_json(journal, None)
        if not isinstance(transaction, dict):
            raise ValueError(f"bad-case recovery journal is unreadable; preserve and repair {journal}")
        apply_bad_case_transaction(root, transaction, journal)


@serialize_named_lock("bad-case-registry")
@serialize_hook_runtime(9)
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
    signal_id: str = "",
) -> tuple[str, Path]:
    init_context(root)
    ctx = context_dir(root)
    recover_bad_case_transactions(root)
    events = read_json(ctx / "bad-case-events.json", [])
    if not isinstance(events, list):
        events = []
    if signal_id:
        prior = next((item for item in events if isinstance(item, dict) and item.get("signal_id") == signal_id), None)
        if prior and re.fullmatch(r"B\d+", str(prior.get("case") or "")):
            existing_id = str(prior["case"])
            existing_path = ctx / "bugs" / f"{existing_id}.md"
            if existing_path.is_file():
                print(f"[context-guard] recorded bad case: {existing_id} ({existing_path}) [duplicate]")
                return existing_id, existing_path
        runtime = read_hook_runtime(root, session_id)
        signals = runtime.get("signals") if isinstance(runtime.get("signals"), list) else []
        signal = next((item for item in signals if isinstance(item, dict) and item.get("id") == signal_id), None)
        if not signal:
            raise ValueError(f"unknown prompt signal: {signal_id}")
        if signal.get("status") == "resolved" and signal.get("kind") not in {None, "", "bad-case"}:
            raise ValueError(f"prompt signal is already resolved as {signal.get('kind')}")
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
    bug_text = "\n".join(lines) + "\n"
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
    fix_text = "\n".join(fix_lines) + "\n"

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
    transaction_id = f"bad-case:{bug_id}:occurrence"
    event = {
        "at": utc_now(),
        "event": "occurrence",
        "case": bug_id,
        "status": status,
        "session_id": session_id or None,
        "phenomenon": phenomenon.strip(),
        "trigger": trigger.strip(),
        "signal_id": signal_id or None,
        "transaction_id": transaction_id,
    }
    transaction: dict[str, object] = {
        "v": 1,
        "transaction_id": transaction_id,
        "operation": "occurrence",
        "bug_id": bug_id,
        "node": node,
        "session_id": session_id,
        "signal_id": signal_id,
        "status": status,
        "bug_text": bug_text,
        "fix_text": fix_text,
        "index_entry": entry,
        "map_bug": {
            "id": bug_id,
            "title": title.strip(),
            "desc": phenomenon.strip(),
            "status": status,
            "files": "",
            "sessions": [session_id] if session_id else [],
            "record": f".codex/context/bugs/{bug_id}.md",
        },
        "event": event,
    }
    journal = bad_case_transaction_path(ctx, transaction_id)
    write_json(journal, transaction)
    apply_bad_case_transaction(root, transaction, journal)
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


@serialize_named_lock("bad-case-registry")
@serialize_hook_runtime(5)
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
    recover_bad_case_transactions(root)
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
    fix_text = re.sub(r"(?m)^- status: .*?$", f"- status: {status}", fix_path.read_text(encoding="utf-8"), count=1)
    fix_text = replace_markdown_section(fix_text, "怎么修", method)
    fix_text = replace_markdown_section(fix_text, "证据", evidence)
    index = read_json(ctx / "bugs-index.json", {})
    if not isinstance(index, dict) or not isinstance(index.get(bug_id), dict):
        raise ValueError(f"bad case is missing from bugs-index.json: {bug_id}")
    index[bug_id]["status"] = status
    if session_id:
        sessions = index[bug_id].setdefault("sessions", [])
        if isinstance(sessions, list) and session_id not in sessions:
            sessions.append(session_id)
    transaction_id = f"bad-case:{bug_id}:fix:{hashlib.sha256(json.dumps([status, method.strip(), evidence.strip()], ensure_ascii=False).encode('utf-8')).hexdigest()[:16]}"
    event = {
        "at": utc_now(),
        "event": "fix",
        "case": bug_id,
        "status": status,
        "session_id": session_id or None,
        "method": method.strip(),
        "evidence": evidence.strip(),
        "transaction_id": transaction_id,
    }
    transaction: dict[str, object] = {
        "v": 1,
        "transaction_id": transaction_id,
        "operation": "fix",
        "bug_id": bug_id,
        "session_id": session_id,
        "status": status,
        "bug_text": bug_text,
        "fix_text": fix_text,
        "index_entry": index[bug_id],
        "event": event,
    }
    journal = bad_case_transaction_path(ctx, transaction_id)
    write_json(journal, transaction)
    apply_bad_case_transaction(root, transaction, journal)
    print(f"[context-guard] recorded bad case fix: {bug_id} ({fix_path})")
    return fix_path


def validate_workbench_host(host: str) -> None:
    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("workbench host must be 127.0.0.1 or localhost")


def serve_workbench(root: Path, host: str, port: int) -> int:
    validate_workbench_host(host)
    init_context(root)
    return subprocess.call(["node", str(Path(__file__).resolve().parent / "workbench" / "cli.mjs"),
        "serve", "--root", str(root), "--host", host, "--port", str(port)],
        creationflags=WINDOWS_NO_WINDOW)


def maybe_open_browser(url: str, enabled: bool) -> None:
    if not enabled or os.environ.get("CONTEXT_GUARD_HEADLESS") == "1" or os.environ.get("CI"):
        return
    try:
        webbrowser.open(url, new=2)
    except Exception:
        pass


def start_workbench(root: Path, host: str = "127.0.0.1", port: int = 8877, open_browser: bool = True, raise_errors: bool = False,
                    session_id: str = "") -> str | None:
    validate_workbench_host(host)
    if os.environ.get("CONTEXT_GUARD_DISABLE_WORKBENCH") == "1":
        return None
    init_context(root)
    try:
        should_open = open_browser and os.environ.get("CONTEXT_GUARD_HEADLESS") != "1" and not os.environ.get("CI")
        result = run_node_workbench([
            "workbench", "--root", str(root), "--port", str(port),
            *(["--session", session_id] if session_id else []),
            *(["--claim-open"] if should_open else []),
        ])
        url = result["url"]
        maybe_open_browser(url, should_open and result.get("shouldOpen", False))
        return url
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print(f"[context-guard] Node workbench: {exc}", file=sys.stderr)
        if raise_errors:
            raise
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
            "record-bad-case-fix", "record-todo", "resolve-signal", "archive-session",
            "write-candidates",
            "plan-start", "plan-finish", "plan-status", "split-signal",
        ],
    )
    parser.add_argument("--root", type=Path, default=None)
    parser.add_argument("--language", default=None)
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--foreground", action="store_true")
    parser.add_argument("--stop", action="store_true")
    parser.add_argument("--binding-status", action="store_true")
    parser.add_argument("--workbench-url")
    parser.add_argument("--bind-main")
    parser.add_argument("--local-main")
    parser.add_argument("--remote", default="origin")
    parser.add_argument("--rebind", action="store_true")
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
    parser.add_argument("--description", default="")
    parser.add_argument("--signal", default="")
    parser.add_argument("--kind", default="")
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
    if args.command == "split-signal":
        try:
            data = read_input_json(args.input)
            if not isinstance(data, dict):
                raise ValueError("split-signal input needs an items array")
            print(json.dumps(split_signal(root, resolve_session_id(root, args.session), args.signal, data.get("items")), ensure_ascii=False))
            return 0
        except (OSError, RuntimeError, ValueError) as exc:
            print(f"[context-guard] split-signal failed: {exc}", file=sys.stderr)
            return 1
    if args.command.startswith("plan-"):
        try:
            from context_guard_hook import plan_command
            data = read_input_json(args.input) if args.input else {}
            if not isinstance(data, dict):
                raise ValueError("plan input must be an object")
            print(json.dumps(plan_command(root, resolve_session_id(root, args.session), args.command, data), ensure_ascii=False))
            return 0
        except (OSError, RuntimeError, ValueError) as exc:
            print(f"[context-guard] {args.command} failed: {exc}", file=sys.stderr)
            return 1
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
                args.signal,
            )
            return 0
        except (OSError, RuntimeError, ValueError) as exc:
            print(f"[context-guard] record-bad-case failed: {exc}", file=sys.stderr)
            return 1
    if args.command == "record-todo":
        try:
            record_todo(
                root, args.title, args.description, args.node,
                resolve_session_id(root, args.session), args.signal,
            )
            return 0
        except (OSError, RuntimeError, ValueError) as exc:
            print(f"[context-guard] record-todo failed: {exc}", file=sys.stderr)
            return 1
    if args.command == "resolve-signal":
        try:
            resolve_signal(root, resolve_session_id(root, args.session), args.signal, args.kind)
            return 0
        except (OSError, RuntimeError, ValueError) as exc:
            print(f"[context-guard] resolve-signal failed: {exc}", file=sys.stderr)
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
                args.decisions, args.next_steps, args.files, args.input,
            )
            return 0
        except (OSError, RuntimeError, ValueError) as exc:
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
        if args.binding_status or args.bind_main or args.local_main or args.session:
            command = ["workbench", "--root", str(root)]
            for key, value in [("binding-status", args.binding_status), ("workbench-url", args.workbench_url), ("bind-main", args.bind_main), ("local-main", args.local_main), ("remote", args.remote), ("session", args.session), ("rebind", args.rebind)]:
                if value:
                    command.append("--" + key)
                    if value is not True:
                        command.append(str(value))
            result = run_node_workbench(command)
            print(json.dumps(result, ensure_ascii=False))
            if result.get("url"):
                maybe_open_browser(result["url"], not args.no_open)
            return 0
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
