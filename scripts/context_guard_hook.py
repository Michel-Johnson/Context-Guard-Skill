#!/usr/bin/env python3
"""Lightweight lifecycle reminders for the Context Guard plugin.

The hook initializes folder-scoped context on session start and nudges Codex to
use the context-guard skill at the two moments where omission is most costly:
prompt intake and turn stop.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from context_guard import approved_dev_completion_tests, context_dir, init_context


SKILL_ROOT = Path(__file__).resolve().parents[1]
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


def is_inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def is_context_guard_skill_path(path: Path) -> bool:
    return is_inside(path, SKILL_ROOT)


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

    def walk(obj: object, key_hint: str = "") -> None:
        if isinstance(obj, dict):
            for key, child in obj.items():
                if key in WORKSPACE_KEYS:
                    add_path(child)
                walk(child, key)
        elif isinstance(obj, list):
            for child in obj:
                walk(child, key_hint)

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
        root = git_root(path)
        if not is_context_guard_skill_path(root):
            return root, source

    root = git_root(cwd)
    return root, "process cwd"


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


def run_test_hub_completion(root: Path) -> tuple[int, str]:
    ctx = context_dir(root)
    tests = approved_dev_completion_tests(ctx)
    if not tests:
        return 0, "[context-guard] test hub: no approved every-dev-completion tests."

    hook_log(f"[context-guard] test hub: running {len(tests)} approved every-dev-completion test(s).")
    completed = subprocess.run(
        [
            sys.executable,
            str(SKILL_ROOT / "scripts" / "context_guard.py"),
            "dev-complete",
            "--root",
            str(root),
        ],
        text=True,
        capture_output=True,
        timeout=900,
    )
    output = "\n".join(part for part in [completed.stdout.strip(), completed.stderr.strip()] if part)
    return completed.returncode, output


def completion_test_summary(output: str, code: int) -> str:
    if "no approved every-dev-completion tests" in output:
        return "no approved every-dev-completion tests"
    for line in output.splitlines():
        if "[context-guard] test hub:" in line and " passed," in line and " failed," in line and " blocked" in line:
            summary = line.split("test hub:", 1)[1].strip().rstrip(".")
            if code == 0:
                return f"all approved tests passed ({summary})"
            return f"approved tests are not all passing ({summary})"
    return "test hub status unknown; inspect `.codex/context/test-hub/last-run.json`"


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


def looks_like_remote_work(text: str) -> bool:
    lowered = text.lower()
    markers = [
        "ssh",
        "remote server",
        "remote host",
        "dev server",
        "jump host",
        "服务器",
        "远程",
        "开发机",
        "跳板机",
        "通过ssh",
        "通过 ssh",
    ]
    return any(marker in lowered for marker in markers)


def looks_like_test_creation(text: str) -> bool:
    lowered = text.lower()
    creation_markers = [
        "create",
        "write",
        "generate",
        "design",
        "add",
        "创建",
        "建立",
        "写",
        "生成",
        "设计",
        "新增",
        "加一个",
        "做一个",
    ]
    test_markers = [
        "test case",
        "task case",
        "test task",
        "testing task",
        "测试case",
        "测试 case",
        "测试任务",
        "测试用例",
        "测评任务",
        "测评case",
        "测评 case",
        "测试链路",
        "测试",
    ]
    return any(marker in lowered for marker in creation_markers) and any(marker in lowered for marker in test_markers)


def looks_like_explicit_branch(text: str) -> bool:
    lowered = text.lower()
    markers = [
        "branch task",
        "side task",
        "side route",
        "fork this",
        "create a branch",
        "new branch",
        "as a branch",
        "支线",
        "分支",
        "开一个分支",
        "开一条支线",
        "创建支线",
        "创建分支",
        "作为支线",
    ]
    return any(marker in lowered for marker in markers)


def looks_like_route_drift(text: str) -> bool:
    lowered = text.lower()
    drift_markers = [
        "significantly diverge",
        "diverge from",
        "different architecture",
        "new architecture",
        "new direction",
        "refactor direction",
        "偏离",
        "显著偏离",
        "新的架构",
        "新方向",
        "重构方向",
        "主线架构",
    ]
    return any(marker in lowered for marker in drift_markers)


def bad_case_blocks(text: str) -> list[dict[str, str]]:
    blocks: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for line in text.splitlines():
        heading = line.startswith("### BC-")
        if heading:
            if current:
                blocks.append(current)
            identifier, _, title = line.removeprefix("### ").partition(":")
            current = {"id": identifier.strip(), "title": title.strip()}
            continue
        if current is None or not line.startswith("- ") or ":" not in line:
            continue
        key, _, value = line[2:].partition(":")
        current[key.strip().lower()] = value.strip()
    if current:
        blocks.append(current)
    return blocks


def unresolved_bad_cases(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    resolved_statuses = {"resolved", "done", "superseded-by-route-change"}
    cases = bad_case_blocks(path.read_text(encoding="utf-8"))
    return [
        case
        for case in cases
        if case.get("status", "").strip().lower() not in resolved_statuses
    ]


def format_unresolved_bad_cases(cases: list[dict[str, str]], limit: int = 5) -> str:
    if not cases:
        return "none"
    parts = []
    for case in cases[:limit]:
        status = case.get("status", "unknown") or "unknown"
        title = case.get("title", "Untitled bad case")
        phenomenon = case.get("phenomenon", "").strip()
        summary = f"{title} ({status})"
        if phenomenon:
            summary += f" - {phenomenon}"
        parts.append(summary)
    if len(cases) > limit:
        parts.append(f"{len(cases) - limit} more unresolved bad cases")
    return "; ".join(parts)


def main() -> int:
    event = sys.argv[1] if len(sys.argv) > 1 else "unknown"
    raw = read_stdin()
    root, root_source = event_root(raw, Path.cwd())
    context_dir = root / ".codex" / "context"
    index_path = context_dir / "index.md"
    roadmap_path = context_dir / "roadmap.md"
    bad_cases_path = context_dir / "bad-cases.md"
    text = prompt_text(raw)

    if is_context_guard_skill_path(root):
        hook_log(
            "[context-guard] detected Context Guard skill directory as the apparent root; "
            "skipping project context writes. Open the target Codex folder or pass an explicit local `--root` "
            "when showing/updating a roadmap."
        )
        hook_log(f"[context-guard] apparent root source: {root_source}; apparent root: {root}")
        return hook_response()

    if event == "session-start":
        created = init_context(root)
        if created:
            hook_log(f"[context-guard] initialized folder context: {context_dir}")
        else:
            hook_log(f"[context-guard] folder context ready: {context_dir}")
        hook_log(f"[context-guard] project root: {root} ({root_source})")
        hook_log("[context-guard] context location rule: save project context only under `<opened local Codex project root>/.codex/context/`.")
        hook_log("[context-guard] use .codex/context/index.md for quick scan and .codex/context/roadmap.md for route nodes.")
        return hook_response()

    if event == "user-prompt-submit":
        hints: list[str] = []
        if looks_like_goal_mode(text):
            hints.append("goal mode: align active goal with current context and record roadmap/bad-case checkpoints during long-running work")
        if looks_like_remote_work(text):
            hints.append("remote/SSH work: keep `.codex/context` in the local Codex workspace; record remote host/path as metadata and do not initialize roadmap context on the server unless explicitly requested")
        if looks_like_test_creation(text):
            hints.append("explicit test creation: start the user-visible response with `测试创建识别：...`, summarize the test target from state A to state B, and only create durable tests after the user's design is clear or confirmed")
        if looks_like_explicit_branch(text):
            hints.append("explicit branch task: create/select a branch task by running `context_guard.py create-branch-task --title <task title> --branch <branch name> --parent-node <parent NODE id>` before implementation; verify the roadmap node has Branch: and Parent:")
        elif looks_like_route_drift(text):
            hints.append("possible route drift: ask whether to create a branch before moving away from the current mainline architecture")
        if looks_like_task_switch(text):
            hints.append("possible task switch: park current context in .codex/context/index.md before switching")
        if looks_like_bad_case(text):
            hints.append("possible bad case: record/update .codex/context/bad-cases.md or task-local bad-cases.md")
        if not hints:
            hints.append("run Context Guard intake: continue current context or note no active context")
        hook_log("[context-guard] " + "; ".join(hints))
        hook_log(f"[context-guard] root source: {root_source}")
        hook_log(f"[context-guard] project root: {root}")
        hook_log(f"[context-guard] context folder: {context_dir}")
        hook_log(f"[context-guard] context index: {index_path}")
        hook_log(f"[context-guard] route map: {roadmap_path}")
        return hook_response()

    if event == "stop":
        hook_log("[context-guard] run turn-end checkpoint before finalizing or updating a goal: update index, route map nodes, parked/resume tasks, and relevant bad-case/test-chain links.")
        hook_log("[context-guard] COMPLETION RELIABILITY GATE: use existing user screenshots/logs/reproductions as red evidence when available; implement once the cause is clear, then run the smallest real post-fix check. Default budget is one primary check plus at most two highly relevant bad-case guards.")
        hook_log("[context-guard] BAD-CASE GUARD GATE: newly checked resolved or recurred BC entries need Guard type, Red condition, Green condition, Expected failure reason, and a red-capable Guard / verification; run `context_guard.py validate-bad-cases` only after register/schema/renderer edits, or `--strict` when intentionally migrating/checking all resolved cases.")
        hook_log("[context-guard] GUARD SELECTION GATE: do not run every historical guard and do not manufacture new red tests when credible evidence already exists. Select guards by changed files, feature area, route branch, tags, and original user-visible symptom; skip unrelated resolved cases.")
        hook_log("[context-guard] TEST HUB GATE: Stop hook runs `context_guard.py dev-complete --root <project>` so the hub executes every human-approved `every-dev-completion` test, cleans success artifacts, and preserves failed/blocked evidence. Do not treat ordinary bad-case guards or roadmap Test chain notes as registered tests.")
        hook_log("[context-guard] TASK-CASE GATE: when a workflow has multiple phases, prefer one relevant task case from `.codex/context/task-cases/` with phase/checkpoint logs over many isolated bug-level tests; report the failed phase/checkpoint if it breaks.")
        hook_log("[context-guard] TEST BLOCKER GATE: if approved tests are blocked by credentials, external service outage, permission denial, hardware/resource limits, network, destructive-risk confirmation, or user-only judgment, stop and ask/warn the user with the exact blocker and evidence path.")
        hook_log("[context-guard] TASK-CASE DESIGN GATE: before writing a new durable task-case script for a complex workflow, ask the user to confirm a short business-facing proposal: from what state to what state, main task, and major risk; keep technical details inside the task-case file, or keep it `proposed` if unavailable.")
        hook_log("[context-guard] GOAL-MODE TEST GATE: in goal mode, use task cases as phase gates; log current phase progress and run the smallest approved path before claiming goal completion instead of silently creating broad new tests.")
        hook_log("[context-guard] ROADMAP CHECKPOINT GATE: assess whether this turn deserves a roadmap node. Create one only for meaningful progress, a route decision, a fix, a branch/fork, a user-visible milestone, or stale hidden checkpoints; otherwise say no roadmap node was needed and why.")
        hook_log("[context-guard] If a node is needed, run `context_guard.py checkpoint-roadmap-node --title <short title> --branch <Main or route> --level <major|checkpoint> --outcome <one-line progress> --next-step <next>` and include linked BC/test-chain notes when relevant.")
        hook_log("[context-guard] ROADMAP MAINTENANCE GATE: run `context_guard.py validate-roadmap-maintenance` after route updates; do not let mainline/branch overview stay stale while important work is hidden as checkpoints.")
        hook_log("[context-guard] If frontend/UI/HTML/CSS/layout/browser behavior changed, inspect with browser/screenshot or state the exact blocker; do not claim fixed without this evidence.")
        hook_log("[context-guard] Branch task gate: if the user explicitly asked for a branch, ensure `context_guard.py create-branch-task --title <task title> --branch <branch name> --parent-node <parent NODE id>` has created the task folder, index current entry, and Branch/Parent roadmap node; if the work significantly drifts from the mainline architecture, ask whether to create a branch before finalizing.")
        hook_log("[context-guard] final answer must include verification evidence and must not say done/fixed/passing unless the gate above was satisfied.")
        hook_log(f"[context-guard] root source: {root_source}")
        hook_log(f"[context-guard] project root: {root}")
        hook_log(f"[context-guard] context folder: {context_dir}")
        hook_log(f"[context-guard] bad-case register: {bad_cases_path}")
        try:
            test_code, test_output = run_test_hub_completion(root)
            for line in test_output.splitlines():
                hook_log(line)
            hook_log(
                "[context-guard] final answer must include Test Hub summary: "
                + completion_test_summary(test_output, test_code)
            )
            if test_code != 0:
                reason = (
                    "Context Guard Test Hub found failed or blocked approved tests. "
                    "Read `.codex/context/test-hub/last-run.json` and preserved run evidence, "
                    "then fix or report the blocker before finalizing."
                )
                hook_log(f"[context-guard] TEST HUB BLOCKER: {reason}")
                return hook_response(decision="block", reason=reason)
        except subprocess.TimeoutExpired:
            reason = "Context Guard Test Hub timed out after 900s; report this blocker and evidence before finalizing."
            hook_log(f"[context-guard] TEST HUB BLOCKER: {reason}")
            return hook_response(decision="block", reason=reason)
        except Exception as exc:
            hook_log(f"[context-guard] test hub hook warning: {exc}")
        open_cases = unresolved_bad_cases(bad_cases_path)
        hook_log("[context-guard] final answer must include BC summary: archived/updated BC this turn, and current unresolved BC.")
        hook_log(f"[context-guard] current unresolved BC: {format_unresolved_bad_cases(open_cases)}")
        return hook_response()

    hook_log("[context-guard] unknown hook event; use the context-guard skill if context changed.")
    return hook_response()


if __name__ == "__main__":
    raise SystemExit(main())
