#!/usr/bin/env python3
"""v1 Context Guard CLI: init a folder, set language, point humans at the workbench."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path


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

1. Sessions — `sessions.jsonl` (append-only)
2. Bugs — `bugs/{id}.md` then `fixes/{id}.md`
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


def read_preferences(ctx: Path) -> dict[str, str]:
    path = ctx / "preferences.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def write_preferences(ctx: Path, preferences: dict[str, str]) -> None:
    ctx.mkdir(parents=True, exist_ok=True)
    (ctx / "preferences.json").write_text(
        json.dumps(preferences, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


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


def show_roadmap(root: Path) -> None:
    init_context(root)
    workbench = context_guard_skill_root() / "prototype" / "workbench.html"
    print("[context-guard] the human map is the workbench, not a generated HTML roadmap.")
    print(f"[context-guard] live map: {context_dir(root) / 'map.json'}")
    if workbench.exists():
        print(f"[context-guard] workbench: {workbench}")
    print("[context-guard] serve the repo root and open prototype/workbench.html")


def parked_command(name: str) -> int:
    print(
        f"[context-guard] `{name}` is parked. v1 is sessions / bugs / tasks / map. "
        "See .codex/context/TODO.md. Do not expand Test Hub or Roadmap HTML.",
        file=sys.stderr,
    )
    return 2


def main() -> int:
    parser = argparse.ArgumentParser(description="Context Guard v1 utilities")
    parser.add_argument("command", choices=["init", "set-language", "show-roadmap", *PARKED])
    parser.add_argument("--root", type=Path, default=None)
    parser.add_argument("--language", default=None)
    parser.add_argument("--open", action="store_true", help="Ignored; kept so old wrappers do not crash.")
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
    if args.command == "show-roadmap":
        show_roadmap(root)
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
