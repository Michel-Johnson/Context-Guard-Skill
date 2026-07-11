#!/usr/bin/env python3
"""Utilities for Context Guard project context folders."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import webbrowser
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse


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
        "[context-guard] refusing to use the Context Guard skill directory as a project context root. "
        "Run again from the opened Codex workspace or pass an explicit project `--root`.",
        file=sys.stderr,
    )
    return 2


def context_dir(root: Path) -> Path:
    return root / ".codex" / "context"


def roadmap_output_dir(root: Path) -> Path:
    return context_dir(root) / "roadmap"


def test_hub_dir(root: Path) -> Path:
    return context_dir(root) / "test-hub"


def subagent_assignments_path(root: Path) -> Path:
    return context_dir(root) / "subagents" / "assignments.json"


def load_subagent_assignments(root: Path) -> dict[str, object]:
    path = subagent_assignments_path(root)
    if not path.exists():
        return {"version": 1, "assignments": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "assignments": {}}
    if not isinstance(data, dict):
        return {"version": 1, "assignments": {}}
    assignments = data.get("assignments")
    if not isinstance(assignments, dict):
        data["assignments"] = {}
    data.setdefault("version", 1)
    return data


def write_subagent_assignments(root: Path, data: dict[str, object]) -> Path:
    path = subagent_assignments_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def resolve_registered_subagent_root(control_root: Path, agent_id: str) -> Path | None:
    safe_agent = agent_id.strip()
    if not safe_agent:
        return None
    assignments = load_subagent_assignments(control_root).get("assignments", {})
    if not isinstance(assignments, dict):
        return None
    item = assignments.get(safe_agent)
    if not isinstance(item, dict):
        return None
    value = str(item.get("project_root", "")).strip()
    if not value:
        return None
    path = Path(value).expanduser().resolve()
    return path if path.exists() else None


def register_subagent_assignment(control_root: Path, agent_id: str, project_root: Path, task: str = "") -> Path:
    safe_agent = agent_id.strip()
    if not safe_agent:
        raise ValueError("subagent-register requires --agent-id")
    project_root = project_root.expanduser().resolve()
    if not project_root.exists():
        raise ValueError(f"subagent project root does not exist: {project_root}")
    if is_context_guard_skill_path(project_root):
        raise ValueError("subagent project root cannot be the Context Guard skill directory")
    init_context(control_root)
    init_context(project_root)
    data = load_subagent_assignments(control_root)
    assignments = data.setdefault("assignments", {})
    assert isinstance(assignments, dict)
    previous = assignments.get(safe_agent)
    registered_at = datetime.now().isoformat(timespec="seconds")
    if isinstance(previous, dict):
        registered_at = str(previous.get("registered_at") or registered_at)
    record = dict(previous) if isinstance(previous, dict) else {}
    record.update({
        "agent_id": safe_agent,
        "project_root": str(project_root),
        "task": " ".join(task.strip().split())[:500],
        "status": "running",
        "registered_at": registered_at,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    })
    assignments[safe_agent] = record
    path = write_subagent_assignments(control_root, data)
    print(f"[context-guard] subagent registered: {safe_agent}")
    print(f"[context-guard] subagent project root: {project_root}")
    print(f"[context-guard] assignment registry: {path}")
    return path


def unique_run_id() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S-%f")


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
        "last_updated": today or datetime.now().strftime("%Y-%m-%d"),
        "note": "Set with: context_guard.py set-language --language <language>",
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


def preferred_display_language(ctx: Path) -> str:
    preferences = read_preferences(ctx)
    configured = str(preferences.get("display_language") or preferences.get("record_language") or "auto")
    return display_language_code(configured)


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
        ctx / "task-cases",
        ctx / "bad-case-tests",
        ctx / "test-hub",
        ctx / "roadmap",
        ctx / "exports",
        ctx / "archive",
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
        ctx / "index.md": f"""# Context Index

This is a dynamic queue of active and recently parked folder context. Keep it short.

## Quick Scan

- Current: none
- Latest roadmap node: none
- Hot bad-case tags: none
- Resume candidate: none

## Current

None yet.

## Parked / Resume Candidates

None.

## Archived

Keep only concise summaries here. Move detailed stale context to `.codex/context/archive/`.

Last initialized: {today}
""",
        ctx / "user-messages.md": f"""# User Message Memory

This file preserves concise user wording that future Codex turns may need. It is agent-readable context, not a public transcript.

## Recent User Signals

None yet.

## Durable User Constraints

None yet.

## Secret Pointers

Raw secrets must stay only in `.codex/context/private/` or an OS credential store. This file may contain redacted pointers, never plaintext secrets.

Last initialized: {today}
""",
        ctx / "roadmap.md": f"""# Context Roadmap

This is the mainline route through the task. Keep nodes concise. Do not record every tiny action.

## Nodes

No nodes yet.

Last initialized: {today}
""",
        ctx / "bad-cases.md": f"""# Bad Case Register

This register tracks bad cases found during development and the guards that prevent them from recurring.

## Active Cases

None.

## Resolved History

None.

Last initialized: {today}
""",
        ctx / "preferences.json": json.dumps(default_preferences(today), ensure_ascii=False, indent=2) + "\n",
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


def export_roadmap(root: Path, output_format: str = "html") -> Path:
    ctx = context_dir(root)
    init_context(root)
    source = ctx / "roadmap.md"
    out_dir = roadmap_output_dir(root)
    out_dir.mkdir(parents=True, exist_ok=True)
    suffix = "html" if output_format == "html" else "md"
    dest = out_dir / f"roadmap.{suffix}"
    roadmap = source.read_text(encoding="utf-8")
    index = (ctx / "index.md").read_text(encoding="utf-8")
    bad_cases = (ctx / "bad-cases.md").read_text(encoding="utf-8")
    if output_format == "html":
        detail_dest = out_dir / "roadmap-details.html"
        for old_html in out_dir.glob("*.html"):
            if old_html not in {dest, detail_dest}:
                old_html.unlink()
        (out_dir / "roadmap.md").write_text(render_roadmap_markdown(ctx, index, roadmap, bad_cases), encoding="utf-8")
        (out_dir / "roadmap.json").write_text(
            json.dumps(build_agent_roadmap_index(ctx, index, roadmap, bad_cases), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        dest.write_text(render_roadmap_html(ctx, index, roadmap, bad_cases), encoding="utf-8")
        detail_dest.write_text(render_roadmap_details_html(ctx, index, roadmap, bad_cases), encoding="utf-8")
        return dest
    dest.write_text(render_roadmap_markdown(ctx, index, roadmap, bad_cases), encoding="utf-8")
    return dest


def show_roadmap(root: Path, open_browser: bool = False) -> Path:
    dest = export_roadmap(root, "html")
    uri = dest.resolve().as_uri()
    print(f"[context-guard] roadmap html: {dest}")
    print(f"[context-guard] roadmap url: {uri}")
    if open_browser:
        webbrowser.open(uri)
    return dest


def render_roadmap_markdown(ctx: Path, index: str, roadmap: str, bad_cases: str) -> str:
    return "\n".join(
        [
            "# Agent-readable context roadmap",
            "",
            f"- Source folder: `{ctx}`",
            f"- Exported: {datetime.now().isoformat(timespec='seconds')}",
            "- Source of truth: `index.md`, `roadmap.md`, `bad-cases.md`, and task context files",
            "- Human-facing view: `roadmap.html`",
            "",
            "## Quick Scan",
            "",
            extract_section(index, "## Quick Scan"),
            "",
            "## Roadmap",
            "",
            roadmap,
            "",
            "## Bad Case Tags And Links",
            "",
            extract_bad_case_scan(bad_cases),
            "",
        ]
    )


def build_agent_roadmap_index(ctx: Path, index: str, roadmap: str, bad_cases: str) -> dict[str, object]:
    nodes = parse_roadmap_nodes(roadmap)
    cards = parse_bad_case_cards(bad_cases)
    route_groups = group_nodes_by_branch(nodes)
    case_by_id = {bad_case_id(card): card for card in cards if bad_case_id(card)}

    indexed_nodes: list[dict[str, object]] = []
    for source_number, node in enumerate(nodes, 1):
        linked_ids = linked_bad_case_ids_for_node(node, cards)
        indexed_nodes.append(
            {
                "id": node_id(node),
                "source_number": source_number,
                "title": human_title(node.get("title", f"Node {source_number}")),
                "status": node.get("status", "unknown"),
                "level": node_level(node),
                "branch": branch_name(node),
                "parent": normalized_parent_id(node.get("parent", "")),
                "date": node.get("date", ""),
                "task": strip_wrapping_backticks(node.get("task", "")),
                "outcome": human_text(node.get("outcome", "")),
                "linked_bad_cases": linked_ids,
                "test_chain": human_text(node.get("test chain", "")),
            }
        )

    indexed_cases = [
        {
            "id": cid,
            "title": human_title(card.get("title", cid)),
            "status": card.get("status", "unknown"),
            "roadmap_nodes": node_ids_from_text(card.get("roadmap nodes", "")),
            "tags": parse_tags(card.get("tags", "")),
            "phenomenon": human_text(card.get("phenomenon", "")),
            "trigger": human_text(card.get("trigger / reproduction", "")),
            "guard": human_text(card.get("guard / verification", "")),
            "reusable_guard_path": strip_wrapping_backticks(card.get("reusable guard path", "")),
        }
        for cid, card in case_by_id.items()
    ]

    return {
        "schema": "context-guard-roadmap-v1",
        "source_folder": str(ctx),
        "source_files": {
            "index": "index.md",
            "roadmap": "roadmap.md",
            "bad_cases": "bad-cases.md",
        },
        "quick_scan": extract_section(index, "## Quick Scan"),
        "routes": [
            {
                "branch": branch,
                "nodes": [node_id(node) for _, node in items],
            }
            for branch, items in route_groups
        ],
        "nodes": indexed_nodes,
        "bad_cases": indexed_cases,
    }


def language_script(title_key: str, default_lang: str = "auto") -> str:
    default_lang = default_lang if default_lang in {"zh", "en"} else "auto"
    return f"""<script>
const DEFAULT_LANG = "{default_lang}";
const I18N = {{
  en: {{
    roadmapTitle: "Context Roadmap",
    roadmapDetails: "Roadmap Details",
    humanView: "Human-facing view",
    humanDetailView: "Human detail view",
    updatedLabel: "Updated:",
    roadmap: "Roadmap",
    viewMode: "Roadmap view",
    cardView: "Card view",
    compactView: "Compact overview",
    backToRoadmap: "Back to roadmap",
    mainRoute: "Main Route",
    badCases: "Bad Cases",
    testChain: "Test Chain",
    routeFocus: "Route Details",
    emptyRoadmap: "No roadmap nodes recorded yet.",
    noLinkedBadCases: "No linked bad cases.",
    noBadCases: "No bad cases recorded.",
    checkpointsInDetails: "{{count}} checkpoints in details",
    levelMajor: "Major",
    levelCheckpoint: "Checkpoint",
    summary: "Summary:",
    route: "Route:",
    parentRoute: "Parent route:",
    outcome: "Outcome:",
    decision: "Decision:",
    avoidGoingBack: "Avoid going back:",
    next: "Next:",
    phenomenon: "Phenomenon:",
    trigger: "Trigger:",
    rootCause: "Root cause:",
    fix: "Fix:",
    guardType: "Guard type:",
    guard: "Guard:",
    redCondition: "Red condition:",
    greenCondition: "Green condition:",
    expectedFailureReason: "Expected failure reason:"
  }},
  zh: {{
    roadmapTitle: "项目路线图",
    roadmapDetails: "路线图详情",
    humanView: "人类视图",
    humanDetailView: "人类详情视图",
    updatedLabel: "更新：",
    roadmap: "路线图",
    viewMode: "路线图视图",
    cardView: "卡片视图",
    compactView: "紧凑总览",
    backToRoadmap: "返回路线图",
    mainRoute: "主要路线",
    badCases: "问题案例",
    testChain: "测试链路",
    routeFocus: "路线详情",
    emptyRoadmap: "还没有路线节点。",
    noLinkedBadCases: "无关联 bad case。",
    noBadCases: "还没有 bad case。",
    checkpointsInDetails: "{{count}} 个检查点在详情页",
    levelMajor: "主节点",
    levelCheckpoint: "检查点",
    summary: "概括：",
    route: "路线：",
    parentRoute: "父路线：",
    outcome: "结果：",
    decision: "决策：",
    avoidGoingBack: "避免回头：",
    next: "下一步：",
    phenomenon: "现象：",
    trigger: "触发：",
    rootCause: "根因：",
    fix: "修复：",
    guardType: "防线类型：",
    guard: "防线：",
    redCondition: "红灯条件：",
    greenCondition: "绿灯条件：",
    expectedFailureReason: "预期失败原因："
  }}
}};

function resolveLang() {{
  const query = new URLSearchParams(window.location.search).get("lang");
  if (query === "zh" || query === "en") return query;
  if (DEFAULT_LANG === "zh" || DEFAULT_LANG === "en") return DEFAULT_LANG;
  const saved = localStorage.getItem("contextGuardLang");
  if (saved === "zh" || saved === "en") return saved;
  return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}}

function applyLang(lang) {{
  const dictionary = I18N[lang] || I18N.en;
  document.documentElement.lang = lang;
  document.title = dictionary["{title_key}"] || document.title;
  localStorage.setItem("contextGuardLang", lang);
  document.querySelectorAll("[data-i18n]").forEach((element) => {{
    const key = element.dataset.i18n;
    let value = dictionary[key] || I18N.en[key] || element.textContent;
    if (element.dataset.count) value = value.replace("{{count}}", element.dataset.count);
    element.textContent = value;
  }});
  document.querySelectorAll("[data-i18n-text]").forEach((element) => {{
    const value = lang === "zh" ? element.dataset.zh : element.dataset.en;
    if (value) element.textContent = value;
  }});
  document.querySelectorAll("[data-i18n-aria]").forEach((element) => {{
    const value = dictionary[element.dataset.i18nAria] || element.getAttribute("aria-label") || "";
    if (value) {{
      element.setAttribute("aria-label", value);
      element.setAttribute("title", value);
    }}
  }});
}}

function connectorAnchor(element) {{
  return element.querySelector(".lane-main .status-dot") || element.querySelector(".status-dot") || element;
}}

function dotConnectorPoint(element, stackRect, stack) {{
  const anchor = connectorAnchor(element);
  const rect = anchor.getBoundingClientRect();
  return {{
    x: rect.left + rect.width / 2 - stackRect.left + stack.scrollLeft,
    y: rect.top + rect.height / 2 - stackRect.top + stack.scrollTop,
  }};
}}

function connectorPoint(element, stackRect, stack, side = "center") {{
  const anchor = connectorAnchor(element);
  if (anchor !== element) return dotConnectorPoint(element, stackRect, stack);
  const rect = element.getBoundingClientRect();
  const y = rect.top + rect.height / 2 - stackRect.top + stack.scrollTop;
  let x = rect.left + rect.width / 2;
  if (side === "left") x = rect.left;
  if (side === "right") x = rect.right;
  if (side === "bottom") {{
    x = rect.left + rect.width / 2;
    return {{ x: x - stackRect.left + stack.scrollLeft, y: rect.bottom - stackRect.top + stack.scrollTop }};
  }}
  return {{ x: x - stackRect.left + stack.scrollLeft, y }};
}}

function cardConnectorPoint(element, stackRect, stack, side = "center") {{
  const cardRect = element.getBoundingClientRect();
  const anchorRect = connectorAnchor(element).getBoundingClientRect();
  const y = anchorRect.top + anchorRect.height / 2 - stackRect.top + stack.scrollTop;
  let x = cardRect.left + cardRect.width / 2;
  if (side === "left") x = cardRect.left;
  if (side === "right") x = cardRect.right;
  return {{ x: x - stackRect.left + stack.scrollLeft, y }};
}}

function createConnectorPath(svg, d, className, attrs = {{}}) {{
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("class", className);
  Object.entries(attrs).forEach(([key, value]) => path.setAttribute(key, value));
  svg.appendChild(path);
  return path;
}}

function drawRouteConnectors(stack, svg, stackRect) {{
  stack.querySelectorAll(".route-group").forEach((section) => {{
    const cards = Array.from(section.querySelectorAll(".track-column.route-column[data-overview-node-id]"));
    const routeLine = getComputedStyle(section).getPropertyValue("--route-line").trim() || "var(--line)";
    cards.forEach((card, index) => {{
      const next = cards[index + 1];
      if (!next) return;
      const compact = document.querySelector("[data-roadmap-board]")?.dataset.roadmapView === "compact";
      const start = compact ? dotConnectorPoint(card, stackRect, stack) : cardConnectorPoint(card, stackRect, stack, "right");
      const end = compact ? dotConnectorPoint(next, stackRect, stack) : cardConnectorPoint(next, stackRect, stack, "left");
      const handle = Math.max(28, (end.x - start.x) * 0.45);
      const d = `M ${{start.x}} ${{start.y}} C ${{start.x + handle}} ${{start.y}} ${{end.x - handle}} ${{end.y}} ${{end.x}} ${{end.y}}`;
      createConnectorPath(svg, d, "route-connector", {{
        stroke: routeLine,
        "data-route-link": `${{card.dataset.overviewNodeId}}:${{next.dataset.overviewNodeId}}`,
      }});
    }});
  }});
}}

function branchCorridorX(source, target, stackRect, stack) {{
  const parentRoute = source.closest(".route-group");
  const cards = parentRoute ? Array.from(parentRoute.querySelectorAll(".track-column.route-column[data-overview-node-id]")) : [];
  const index = cards.indexOf(source);
  const sourceRect = source.getBoundingClientRect();
  const previous = index > 0 ? cards[index - 1] : null;
  if (previous) {{
    const previousRect = previous.getBoundingClientRect();
    return (previousRect.right + sourceRect.left) / 2 - stackRect.left + stack.scrollLeft;
  }}
  return sourceRect.left - stackRect.left + stack.scrollLeft - 24;
}}

function drawBranchConnectors() {{
  const stack = document.querySelector("[data-route-map-overview]");
  if (!stack) return;
  const svg = stack.querySelector(":scope > .branch-connector-layer");
  if (!svg) return;
  const stackRect = stack.getBoundingClientRect();
  const width = Math.max(stack.scrollWidth, stackRect.width);
  const height = Math.max(stack.scrollHeight, stackRect.height);
  svg.setAttribute("viewBox", `0 0 ${{width}} ${{height}}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.innerHTML = "";
  drawRouteConnectors(stack, svg, stackRect);
  stack.querySelectorAll(".route-group.route-branch[data-parent-anchor-id]").forEach((section) => {{
    const parentId = section.dataset.parentAnchorId;
    const source = parentId ? stack.querySelector(`[data-overview-node-id="${{CSS.escape(parentId)}}"]`) : null;
    const target = section.querySelector(".track-column.route-column[data-overview-node-id]") || section.querySelector("[data-route-anchor]");
    if (!source || !target) return;
    const start = dotConnectorPoint(source, stackRect, stack);
    const end = dotConnectorPoint(target, stackRect, stack);
    const corridorX = branchCorridorX(source, target, stackRect, stack);
    const handle = Math.max(18, Math.abs(start.x - corridorX) * 0.45);
    const verticalHandle = Math.max(32, Math.abs(end.y - start.y) * 0.22);
    const routeLine = getComputedStyle(section).getPropertyValue("--route-line").trim() || "var(--line)";
    const d = [
      `M ${{start.x}} ${{start.y}}`,
      `C ${{start.x - handle}} ${{start.y}} ${{corridorX}} ${{start.y}} ${{corridorX}} ${{start.y + verticalHandle}}`,
      `C ${{corridorX}} ${{end.y - verticalHandle}} ${{end.x - handle}} ${{end.y}} ${{end.x}} ${{end.y}}`,
    ].join(" ");
    createConnectorPath(svg, d, "branch-connector", {{
      stroke: routeLine,
      "data-parent-anchor-id": parentId,
      "data-child-route": section.dataset.routeGroup || "",
      "data-branch-corridor-x": String(Math.round(corridorX)),
    }});
  }});
}}

function setupInlineDetails() {{
  const panel = document.querySelector("[data-inline-details]");
  if (!panel) return;
  const cards = Array.from(panel.querySelectorAll(".detail-card[id]"));
  const closeLinks = Array.from(panel.querySelectorAll("[data-detail-close]"));
  const hidePanel = () => {{
    cards.forEach((card) => card.classList.remove("is-active"));
    panel.classList.remove("is-open");
    panel.hidden = true;
  }};
  const showFromHash = () => {{
    const id = decodeURIComponent((window.location.hash || "").replace(/^#/, ""));
    const target = id ? cards.find((card) => card.id === id) : null;
    if (!target) {{
      hidePanel();
      return;
    }}
    cards.forEach((card) => card.classList.toggle("is-active", card === target));
    panel.hidden = false;
    panel.classList.add("is-open");
    target.setAttribute("tabindex", "-1");
    requestAnimationFrame(() => target.focus({{ preventScroll: false }}));
  }};
  closeLinks.forEach((link) => link.addEventListener("click", () => setTimeout(hidePanel, 0)));
  window.addEventListener("hashchange", showFromHash);
  showFromHash();
}}

function setupRoadmapViews() {{
  const board = document.querySelector("[data-roadmap-board]");
  if (!board) return;
  const buttons = Array.from(board.querySelectorAll("[data-roadmap-view-button]"));
  if (!buttons.length) return;
  const valid = (mode) => mode === "cards" || mode === "compact";
  const applyView = (mode, persist = true) => {{
    const next = valid(mode) ? mode : "cards";
    board.dataset.roadmapView = next;
    document.body.dataset.roadmapView = next;
    buttons.forEach((button) => {{
      button.setAttribute("aria-pressed", button.dataset.roadmapViewButton === next ? "true" : "false");
    }});
    if (persist) localStorage.setItem("contextGuardRoadmapView", next);
    requestAnimationFrame(drawBranchConnectors);
  }};
  const query = new URLSearchParams(window.location.search).get("view");
  const saved = localStorage.getItem("contextGuardRoadmapView");
  const visibleCount = Number(board.dataset.visibleNodeCount || "0");
  const initial = valid(query) ? query : (valid(saved) ? saved : (visibleCount > 16 ? "compact" : "cards"));
  applyView(initial, false);
  buttons.forEach((button) => button.addEventListener("click", () => {{
    const mode = button.dataset.roadmapViewButton;
    const url = new URL(window.location.href);
    url.searchParams.set("view", mode);
    window.history.replaceState(null, "", url);
    applyView(mode);
  }}));
}}

document.addEventListener("DOMContentLoaded", () => {{
  const initial = resolveLang();
  applyLang(initial);
  setupRoadmapViews();
  const routeButtons = Array.from(document.querySelectorAll("[data-route-filter]"));
  const routeExists = (route) => routeButtons.some((button) => button.dataset.routeFilter === route);
  const applyRoute = (route) => {{
    if (!routeExists(route)) return;
    localStorage.setItem("contextGuardRoute", route);
    routeButtons.forEach((button) => {{
      button.setAttribute("aria-pressed", button.dataset.routeFilter === route ? "true" : "false");
    }});
  }};
  const routeQuery = new URLSearchParams(window.location.search).get("route");
  const savedRoute = localStorage.getItem("contextGuardRoute");
  const firstRoute = routeButtons[0] && routeButtons[0].dataset.routeFilter;
  if (routeButtons.length) applyRoute(routeExists(routeQuery) ? routeQuery : (routeExists(savedRoute) ? savedRoute : firstRoute));
  routeButtons.forEach((button) => {{
    button.addEventListener("click", () => {{
      const route = button.dataset.routeFilter;
      const url = new URL(window.location.href);
      url.searchParams.set("route", route);
      window.history.replaceState(null, "", url);
      applyRoute(route);
    }});
  }});
  drawBranchConnectors();
  window.addEventListener("resize", drawBranchConnectors);
  const stack = document.querySelector("[data-route-map-overview]");
  if (stack) stack.addEventListener("scroll", drawBranchConnectors, {{ passive: true }});
  setupInlineDetails();
}});
</script>"""


def initial_html_language(preferred_lang: str) -> str:
    return preferred_lang if preferred_lang in {"zh", "en"} else "en"


def initial_html_title(title_key: str, preferred_lang: str) -> str:
    if preferred_lang == "zh":
        return "路线图详情" if title_key == "roadmapDetails" else "项目路线图"
    return "Context Roadmap Details" if title_key == "roadmapDetails" else "Context Roadmap Human View"


def render_roadmap_html(ctx: Path, index: str, roadmap: str, bad_cases: str) -> str:
    nodes = parse_roadmap_nodes(roadmap)
    bad_case_cards = parse_bad_case_cards(bad_cases)
    case_anchor_map = build_case_anchor_map(bad_case_cards)
    route_groups = group_nodes_by_branch(nodes)
    node_lookup = {node_id(node): node for _, items in route_groups for _, node in items}
    branch_mode = len(route_groups) > 1
    route_offsets = build_route_offsets(route_groups, node_lookup) if branch_mode else {}
    route_parent_anchors = build_route_parent_anchors(route_groups, node_lookup) if branch_mode else {}
    route_depths = build_route_depths(route_groups, node_lookup) if branch_mode else {}
    route_nav = render_route_filter(route_groups) if branch_mode else ""
    route_items = "\n".join(
        render_route_group(
            branch,
            items,
            bad_case_cards,
            case_anchor_map,
            branch_mode,
            node_lookup,
            route_offsets.get(branch.lower(), 0),
            route_depths.get(branch.lower(), 0),
            route_parent_anchors.get(branch.lower(), ("", ""))[0],
            route_parent_anchors.get(branch.lower(), ("", ""))[1],
        )
        for i, (branch, items) in enumerate(route_groups)
    )
    inline_details = render_inline_details(nodes, bad_case_cards, case_anchor_map)
    if not route_items:
        route_items = '<section class="empty" data-i18n="emptyRoadmap">No roadmap nodes recorded yet.</section>'
    connector_layer = (
        '<svg class="branch-connector-layer" aria-hidden="true" focusable="false"></svg>'
        if branch_mode
        else ""
    )
    preferred_lang = preferred_display_language(ctx)
    html_lang = initial_html_language(preferred_lang)
    html_title = initial_html_title("roadmapTitle", preferred_lang)
    return f"""<!doctype html>
<html lang="{html_lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(html_title)}</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f4f7ef;
      --panel: #fffff8;
      --card: #fffef7;
      --ink: #243125;
      --muted: #64705d;
      --line: #cddcc5;
      --accent: #37745b;
      --accent-soft: #e4f2e8;
      --warn: #b0733f;
      --warn-soft: #f8ead9;
      --ok: #2f7d63;
      --ok-soft: #dff1e7;
      --danger: #b94c4c;
      --quiet: #99a78f;
      --shadow: 0 14px 34px rgba(51, 83, 57, 0.12);
      --radius: 8px;
      --font-body: "Avenir Next", "Gill Sans", "PingFang SC", "Hiragino Sans GB", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-heading: "Iowan Old Style", "Charter", "Songti SC", "STSong", Georgia, serif;
      --card-border-width: 1px;
      --card-transform: none;
      --board-texture: radial-gradient(circle at 20% 15%, rgba(93, 135, 83, 0.12), transparent 24%), radial-gradient(circle at 82% 4%, rgba(183, 143, 92, 0.12), transparent 20%);
      --board-texture-size: auto;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font: 14px/1.58 var(--font-body);
      text-rendering: optimizeLegibility;
    }}
    header {{
      padding: 22px 32px 14px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }}
    h1 {{ margin: 0 0 4px; font-family: var(--font-heading); font-size: 24px; letter-spacing: 0; }}
    .header-row {{ display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }}
    .shell {{
      padding: 16px 32px 30px;
    }}
    h2 {{ margin: 0 0 12px; font-family: var(--font-heading); font-size: 16px; }}
    .roadmap-title-row {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }}
    .roadmap-title-row h2 {{ margin: 0; }}
    .view-switch {{
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 3px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: color-mix(in srgb, var(--panel) 86%, var(--accent-soft));
    }}
    .view-switch button {{
      width: 30px;
      height: 28px;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      padding: 0;
    }}
    .view-switch button:hover {{ color: var(--accent); }}
    .view-switch button[aria-pressed="true"] {{
      background: var(--panel);
      color: var(--accent);
      box-shadow: 0 1px 4px rgba(51, 83, 57, 0.14);
    }}
    .view-icon {{ width: 15px; height: 15px; display: grid; gap: 2px; }}
    .view-icon i {{ display: block; border-radius: 1px; background: currentColor; }}
    .view-icon-cards {{ grid-template-rows: repeat(2, 1fr); }}
    .view-icon-compact {{ grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); }}
    .route-filter {{
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin: 0 0 14px;
    }}
    .route-filter-label {{
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
      margin-right: 2px;
    }}
    .route-filter button {{
      border: 1px solid var(--line);
      border-radius: 999px;
      background: color-mix(in srgb, var(--panel) 82%, var(--accent-soft));
      color: var(--muted);
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 760;
      padding: 5px 11px;
    }}
    .route-filter button[aria-pressed="true"] {{
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
      box-shadow: 0 0 0 4px var(--accent-soft);
    }}
    .track-board {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 16px;
      background-image: var(--board-texture);
      background-size: var(--board-texture-size);
    }}
    .route-stack {{
      display: grid;
      gap: 14px;
    }}
    .route-stack.branch-map {{
      overflow-x: auto;
      padding-bottom: 4px;
      position: relative;
      isolation: isolate;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }}
    .route-stack.branch-map::-webkit-scrollbar, .route-strip::-webkit-scrollbar {{
      width: 0;
      height: 0;
      display: none;
    }}
    .branch-connector-layer {{
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: visible;
      z-index: 0;
    }}
    .branch-connector, .route-connector {{
      fill: none;
      stroke: var(--line);
      stroke-width: 1.7;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.58;
    }}
    .route-connector {{
      stroke-width: 1.25;
      opacity: 0.36;
    }}
    .route-group {{
      min-width: 0;
    }}
    .route-stack.branch-map .route-group {{
      min-width: max-content;
      position: relative;
      z-index: 1;
    }}
    .track-board[data-roadmap-view="compact"] .route-stack.branch-map .route-group {{
      min-width: max-content;
    }}
    body[data-roadmap-view="compact"] header {{ padding: 12px 32px 8px; }}
    body[data-roadmap-view="compact"] h1 {{ font-size: 20px; }}
    .track-board[data-roadmap-view="compact"] {{ padding: 11px 14px 13px; }}
    .track-board[data-roadmap-view="compact"] .roadmap-title-row {{
      justify-content: flex-end;
      margin-bottom: 3px;
    }}
    .track-board[data-roadmap-view="compact"] .roadmap-title-row h2,
    .track-board[data-roadmap-view="compact"] .route-filter {{ display: none; }}
    .track-board[data-roadmap-view="compact"] .route-stack {{ gap: 7px; }}
    .track-board[data-roadmap-view="compact"] .route-head {{ margin-bottom: 3px; }}
    .track-board[data-roadmap-view="compact"] .route-head-grid {{ margin-bottom: 3px; }}
    .track-board[data-roadmap-view="compact"] .checkpoint-strip {{ margin: -1px 0 3px; }}
    .route-group.route-branch {{
      position: relative;
      padding-right: var(--branch-drift, 0px);
    }}
    .route-branch .route-head-grid, .route-branch .route-strip {{
      transform: translateX(var(--branch-drift, 0px));
    }}
    .route-head {{
      display: flex;
      align-items: center;
      gap: 9px;
      margin-bottom: 7px;
      flex-wrap: wrap;
    }}
    .route-head-grid {{
      min-height: auto;
      margin-bottom: 9px;
      align-items: start;
    }}
    .route-head-cell {{
      min-width: 0;
      position: relative;
      z-index: 1;
    }}
    .route-head-cell .route-head {{
      margin-bottom: 6px;
    }}
    .route-head-cell .checkpoint-strip {{
      margin: 0;
    }}
    .route-mark {{
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--route-accent, var(--accent));
      box-shadow: 0 0 0 4px var(--route-soft, var(--accent-soft));
    }}
    .route-title {{
      font-size: 13px;
      font-family: var(--font-heading);
      font-weight: 760;
    }}
    .route-pill {{
      border-radius: 999px;
      background: color-mix(in srgb, var(--route-soft, var(--accent-soft)) 62%, #fff);
      color: var(--muted);
      font-size: 11px;
      font-weight: 680;
      padding: 1px 7px;
    }}
    .route-parent {{
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      background: color-mix(in srgb, var(--warn-soft) 68%, #fff);
      color: var(--muted);
      font-size: 11px;
      font-weight: 680;
      padding: 2px 8px;
      max-width: min(520px, 100%);
    }}
    .checkpoint-strip {{
      display: flex;
      align-items: center;
      gap: 5px;
      color: var(--muted);
      font-size: 11px;
      margin: -4px 0 9px;
    }}
    .checkpoint-dot {{
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--quiet);
    }}
    .route-strip {{
      overflow: auto;
      padding-bottom: 2px;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }}
    .route-stack.branch-map .route-strip {{
      overflow: visible;
    }}
    .track-grid {{
      display: grid;
      grid-template-columns: 56px;
      grid-auto-flow: column;
      grid-auto-columns: minmax(220px, 280px);
      gap: 14px;
      min-height: auto;
      align-items: stretch;
    }}
    .route-stack:not(.branch-map) .track-grid {{
      grid-auto-columns: minmax(240px, 300px);
      align-items: start;
    }}
    .track-grid.route-only {{
      grid-template-columns: none;
      grid-auto-columns: minmax(180px, 230px);
      min-height: 104px;
    }}
    .track-grid.single-mainline {{
      grid-auto-columns: minmax(240px, 300px);
      min-height: 0;
    }}
    .track-board[data-roadmap-view="compact"] .track-grid.route-only {{
      grid-template-columns: none;
      grid-auto-flow: column;
      grid-auto-columns: 132px;
      gap: 10px;
      min-height: 0;
    }}
    .route-head-grid.track-grid.route-only {{
      min-height: 0;
    }}
    .route-spacer {{
      min-height: 1px;
      pointer-events: none;
    }}
    .track-column, .track-label-column {{
      display: grid;
      grid-template-rows: auto auto auto;
      gap: 12px;
    }}
    .track-column.route-column {{
      grid-template-rows: auto minmax(18px, auto);
      position: relative;
    }}
    .track-column.route-column.no-test-line {{
      grid-template-rows: auto;
    }}
    .track-label-column {{
      position: sticky;
      left: 0;
      z-index: 2;
      background: color-mix(in srgb, var(--panel) 88%, transparent);
      backdrop-filter: blur(6px);
    }}
    .track-label-cell {{
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px 0;
      min-width: 0;
    }}
    .lane {{
      border: var(--card-border-width) solid var(--line);
      border-radius: var(--radius);
      padding: 12px;
      background: var(--card);
      min-width: 0;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.75), var(--shadow);
      transform: var(--card-transform);
    }}
    .branch-map .lane {{
      padding: 10px 12px;
      min-height: 92px;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.72), 0 8px 20px rgba(51, 83, 57, 0.08);
    }}
    .track-board[data-roadmap-view="compact"] .lane {{
      height: 96px;
      min-height: 96px;
      padding: 0;
      border: 0;
      background: transparent;
      box-shadow: none;
      position: relative;
    }}
    .track-board[data-roadmap-view="compact"] .lane-link {{ height: 100%; position: relative; }}
    .track-board[data-roadmap-view="compact"] .lane-link:hover h3 {{ color: var(--route-accent, var(--accent)); }}
    .branch-map .route-test-line {{
      min-height: 18px;
      border-top: 2px solid color-mix(in srgb, var(--ok) 56%, transparent);
      padding-top: 7px;
      margin: 0 10px;
    }}
    .branch-map .route-test-empty {{
      opacity: 0.3;
    }}
    .route-test-note {{
      display: grid;
      gap: 2px;
      border-left: 3px solid var(--ok);
      border-radius: 9px;
      background: color-mix(in srgb, var(--ok-soft) 68%, var(--card));
      color: var(--accent);
      padding: 6px 8px;
      text-decoration: none;
      box-shadow: 0 6px 16px rgba(51, 83, 57, 0.06);
    }}
    .route-test-note span {{
      color: var(--accent);
      font-size: 12px;
      font-weight: 760;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }}
    .route-test-note small {{
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }}
    .route-test-more {{
      display: inline-flex;
      align-items: center;
      width: fit-content;
      border-radius: 999px;
      background: var(--route-soft, var(--accent-soft));
      color: var(--route-accent, var(--accent));
      font-size: 11px;
      font-weight: 760;
      margin-top: 5px;
      padding: 1px 7px;
    }}
    .lane-main {{ border-top: 4px solid var(--route-accent, var(--accent)); }}
    .lane-bad-cases {{ border-top: 4px solid var(--warn); }}
    .lane-test-chain {{ border-top: 4px solid var(--ok); }}
    .lane-empty {{
      display: none;
      border-color: transparent;
      background: transparent;
      box-shadow: none;
      pointer-events: none;
    }}
    .lane-label {{
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
      line-height: 1.15;
      margin: 0;
      text-transform: none;
      white-space: nowrap;
      writing-mode: vertical-rl;
      text-orientation: mixed;
    }}
    html[lang="zh"] .lane-label {{ text-orientation: upright; }}
    .lane-link {{
      color: inherit;
      text-decoration: none;
      display: block;
    }}
    .lane-link:hover h3, .detail-link:hover {{ color: var(--accent); }}
    .summary {{
      color: var(--muted);
      font-size: 13px;
      margin: 8px 0 0;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }}
    .route-stack:not(.branch-map) .lane-main {{
      min-height: 0;
    }}
    .route-stack:not(.branch-map) .lane h3 {{
      font-size: 14px;
      line-height: 1.32;
    }}
    .branch-map .summary {{
      display: none;
    }}
    .track-board[data-roadmap-view="compact"] .summary {{ display: none; }}
    .node-heading {{
      display: flex;
      gap: 8px;
      align-items: flex-start;
      margin-bottom: 8px;
    }}
    .branch-map .node-heading {{
      margin-bottom: 6px;
    }}
    .track-board[data-roadmap-view="compact"] .node-heading {{
      position: absolute;
      left: 0;
      right: 0;
      align-items: flex-start;
      gap: 5px;
      margin: 0;
      padding: 0 4px;
    }}
    .track-board[data-roadmap-view="compact"] .step-up .node-heading {{ bottom: 57px; align-items: flex-end; }}
    .track-board[data-roadmap-view="compact"] .step-down .node-heading {{ top: 57px; }}
    .node-number {{
      flex: 0 0 auto;
      width: 28px; height: 28px; border-radius: 50%;
      display: grid; place-items: center;
      background: var(--route-accent, var(--accent)); color: white; font-weight: 760;
      box-shadow: 0 0 0 4px var(--route-soft, var(--accent-soft));
    }}
    .track-board[data-roadmap-view="compact"] .node-number {{
      width: auto;
      height: auto;
      display: inline;
      color: var(--route-accent, var(--accent));
      background: transparent;
      box-shadow: none;
      font-size: 10px;
      line-height: 1.3;
    }}
    .lane h3 {{ margin: 0; font-family: var(--font-heading); font-size: 15px; line-height: 1.35; }}
    .branch-map .lane h3 {{ font-size: 14px; line-height: 1.28; }}
    .track-board[data-roadmap-view="compact"] .lane h3 {{
      font-family: var(--font-body);
      font-size: 11px;
      line-height: 1.28;
      font-weight: 680;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }}
    .node-meta {{ display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }}
    .branch-map .node-meta {{ margin-bottom: 0; }}
    .track-board[data-roadmap-view="compact"] .node-meta {{
      position: absolute;
      top: 43px;
      left: 50%;
      right: auto;
      transform: translate(-50%, -50%);
      margin: 0;
      z-index: 2;
    }}
    .track-board[data-roadmap-view="compact"] .node-meta .pill {{ display: none; }}
    .track-board[data-roadmap-view="compact"] .node-meta .status-dot {{ width: 8px; height: 8px; }}
    .pill {{
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 8px;
      background: var(--route-soft, var(--accent-soft));
      color: var(--route-accent, var(--accent));
      font-size: 12px;
      font-weight: 600;
    }}
    .status-dot, .freq-dot {{
      flex: 0 0 auto;
      width: 11px;
      height: 11px;
      border-radius: 999px;
      display: inline-block;
      position: relative;
      box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.16);
    }}
    .status-ok {{ background: var(--ok); }}
    .status-active {{ background: var(--accent); }}
    .status-warn {{ background: var(--warn); }}
    .status-bad {{ background: var(--danger); }}
    .status-muted {{ background: var(--quiet); }}
    .freq-dot {{ width: 9px; height: 9px; background: var(--warn); box-shadow: 0 0 0 3px var(--warn-soft); }}
    .badcase {{ border-bottom: 1px solid var(--line); padding-bottom: 10px; margin-bottom: 10px; }}
    .badcase:last-child {{ border-bottom: 0; padding-bottom: 0; margin-bottom: 0; }}
    .badcase-head {{ display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 8px; }}
    .badcase-markers {{ display: inline-flex; align-items: center; gap: 8px; margin-top: 4px; }}
    .badcase h3 {{ margin: 0 0 8px; font-size: 14px; }}
    .test-note {{
      border-bottom: 1px solid var(--line);
      padding-bottom: 10px;
      margin-bottom: 10px;
    }}
    .test-note:last-child {{
      border-bottom: 0;
      padding-bottom: 0;
      margin-bottom: 0;
    }}
    .test-note p {{
      color: var(--muted);
      margin: 5px 0 0;
      font-size: 13px;
    }}
    .test-note code {{
      color: var(--route-accent, var(--accent));
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 12px;
      white-space: normal;
      overflow-wrap: anywhere;
    }}
    .tags {{ display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }}
    .tag {{
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 650;
      white-space: nowrap;
    }}
    .tag-emoji {{ margin-right: 3px; }}
    .tag-blue {{ background: #dbeafe; color: #1e40af; }}
    .tag-amber {{ background: #fef3c7; color: #92400e; }}
    .tag-green {{ background: #dcfce7; color: #166534; }}
    .tag-rose {{ background: #ffe4e6; color: #9f1239; }}
    .tag-slate {{ background: #eef2f7; color: #334155; }}
    .tag-more {{ background: #f1f5f9; color: #64748b; }}
    .muted {{ color: var(--muted); }}
    .detail-link {{ color: var(--accent); font-weight: 650; text-decoration: none; font-size: 13px; }}
    .inline-details {{
      margin-top: 18px;
    }}
    .inline-details[hidden] {{
      display: none !important;
    }}
    .inline-details.is-open {{
      display: block;
    }}
    .inline-details h2 {{
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }}
    .detail-card {{
      display: none;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 14px;
      box-shadow: var(--shadow);
      scroll-margin-top: 18px;
    }}
    .detail-card.is-active {{
      display: block;
      outline: 3px solid color-mix(in srgb, var(--accent) 22%, transparent);
      border-color: var(--accent);
    }}
    .detail-card h3 {{ margin: 0 0 8px; font-family: var(--font-heading); font-size: 17px; }}
    .field {{ margin: 7px 0; }}
    .field b {{ color: var(--muted); }}
    .detail-list {{ margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }}
    .detail-list li {{ margin: 0; padding-left: 12px; border-left: 3px solid var(--line); }}
    .level-chip {{ display: inline-block; border-radius: 999px; padding: 1px 7px; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 650; }}
    .visual-meta {{ display: flex; align-items: center; gap: 9px; min-height: 16px; margin: 4px 0 10px; }}
    .inline-top {{ display: inline-block; margin-top: 8px; color: var(--accent); font-weight: 650; text-decoration: none; }}
    .empty {{ color: var(--muted); padding: 18px; border: 1px dashed var(--line); border-radius: 8px; }}
    @media (max-width: 980px) {{
      .shell {{ padding: 16px; }}
      .quick {{ grid-template-columns: 1fr 1fr; }}
      .track-grid {{ grid-auto-columns: minmax(260px, 82vw); }}
      header {{ padding: 22px 16px 14px; }}
      body[data-roadmap-view="compact"] header {{ padding: 11px 16px 7px; }}
      .track-board[data-roadmap-view="compact"] .track-grid.route-only {{ grid-auto-columns: 118px; }}
    }}
    @media (max-width: 560px) {{
      h1 {{ font-size: 22px; }}
    }}
  </style>
</head>
<body>
  <header>
    <div class="header-row">
      <div>
        <h1 data-i18n="roadmapTitle">Context Roadmap</h1>
      </div>
    </div>
  </header>
  <div class="shell">
    <main class="track-board" id="roadmap-overview" data-roadmap-board data-visible-node-count="{sum(len(display_items_for_route(items)) for _, items in route_groups)}">
      <div class="roadmap-title-row">
        <h2 data-i18n="roadmap">Roadmap</h2>
        <div class="view-switch" role="group" data-i18n-aria="viewMode" aria-label="Roadmap view">
          <button type="button" data-roadmap-view-button="cards" data-i18n-aria="cardView" aria-label="Card view" aria-pressed="false">
            <span class="view-icon view-icon-cards" aria-hidden="true"><i></i><i></i></span>
          </button>
          <button type="button" data-roadmap-view-button="compact" data-i18n-aria="compactView" aria-label="Compact overview" aria-pressed="false">
            <span class="view-icon view-icon-compact" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
          </button>
        </div>
      </div>
      {route_nav}
      <div class="route-stack{' branch-map' if branch_mode else ''}"{' data-route-map-overview' if branch_mode else ''}>{connector_layer}{route_items}</div>
    </main>
    {inline_details}
  </div>
  {language_script("roadmapTitle", preferred_lang)}
</body>
</html>
"""


def render_roadmap_details_html(ctx: Path, index: str, roadmap: str, bad_cases: str) -> str:
    nodes = parse_roadmap_nodes(roadmap)
    cards = parse_bad_case_cards(bad_cases)
    case_anchor_map = build_case_anchor_map(cards)
    exported = datetime.now().isoformat(timespec="seconds")
    detail_items = human_detail_node_items(nodes)
    node_sections = "\n".join(render_node_detail(node, i, cards, case_anchor_map) for i, node in detail_items)
    if not node_sections:
        node_sections = '<section class="detail-card" data-i18n="emptyRoadmap">No roadmap nodes recorded yet.</section>'
    preferred_lang = preferred_display_language(ctx)
    html_lang = initial_html_language(preferred_lang)
    html_title = initial_html_title("roadmapDetails", preferred_lang)
    return f"""<!doctype html>
<html lang="{html_lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(html_title)}</title>
  <style>
    body {{ margin: 0; background: #f8faf6; color: #223126; font: 15px/1.68 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    header {{ background: #fbfcf7; border-bottom: 1px solid #c9dcc8; padding: 22px 32px; }}
    main {{ max-width: 1040px; margin: 0 auto; padding: 22px 18px 44px; }}
    .header-row {{ display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }}
    h1 {{ margin: 0 0 4px; font-size: 24px; }}
    h2 {{ margin-top: 0; }}
    h3 {{ margin: 0 0 14px; font-size: 21px; }}
    h4 {{ margin: 0 0 8px; font-size: 14px; color: #2f7d60; letter-spacing: .02em; }}
    .meta, .muted {{ color: #687466; }}
    .detail-card {{ background: #fffefa; border: 1px solid #c9dcc8; border-left: 4px solid #2f7d60; border-radius: 8px; padding: 20px; margin: 16px 0; box-shadow: 0 12px 30px rgba(47, 80, 54, .08); }}
    .detail-grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }}
    .detail-section {{ border-top: 1px solid #dbe8d7; padding-top: 12px; min-width: 0; }}
    .detail-section p {{ margin: 0; }}
    .detail-section.wide {{ grid-column: 1 / -1; }}
    .detail-list {{ margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }}
    .detail-list li {{ margin: 0; padding-left: 12px; border-left: 3px solid #dbe8d7; }}
    .node-case {{ border: 1px solid #dbe8d7; border-radius: 8px; padding: 10px 12px; margin: 8px 0; background: #fbfcf7; }}
    .node-case-title {{ margin: 0 0 4px; font-weight: 750; color: #2f7d60; }}
    .node-case p {{ margin: 0; }}
    .field {{ margin: 8px 0; }}
    .field b {{ color: #687466; }}
    .level-chip {{ display: inline-block; border-radius: 999px; padding: 1px 7px; background: #f1f5f9; color: #475569; font-size: 12px; font-weight: 650; }}
    .visual-meta {{ display: flex; align-items: center; gap: 9px; min-height: 16px; margin: 4px 0 12px; }}
    .status-dot, .freq-dot {{ flex: 0 0 auto; border-radius: 999px; display: inline-block; }}
    .status-dot {{ width: 11px; height: 11px; box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.16); }}
    .freq-dot {{ width: 9px; height: 9px; background: #b45309; box-shadow: 0 0 0 3px #fff5df; }}
    .status-ok {{ background: #047857; }}
    .status-active {{ background: #2563eb; }}
    .status-warn {{ background: #b45309; }}
    .status-bad {{ background: #dc2626; }}
    .status-muted {{ background: #94a3b8; }}
    .tags {{ display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }}
    .tag {{ display: inline-block; border-radius: 999px; padding: 2px 7px; font-size: 12px; font-weight: 650; }}
    .tag-emoji {{ margin-right: 3px; }}
    .tag-blue {{ background: #dbeafe; color: #1e40af; }}
    .tag-amber {{ background: #fef3c7; color: #92400e; }}
    .tag-green {{ background: #dcfce7; color: #166534; }}
    .tag-rose {{ background: #ffe4e6; color: #9f1239; }}
    .tag-slate {{ background: #eef2f7; color: #334155; }}
    .tag-more {{ background: #f1f5f9; color: #64748b; }}
    a {{ color: #2563eb; text-decoration: none; font-weight: 650; }}
  </style>
</head>
<body>
  <header>
    <div class="header-row">
      <div>
        <h1 data-i18n="roadmapDetails">Roadmap Details</h1>
        <div class="meta"><span data-i18n="humanDetailView">Human detail view</span> · <span data-i18n="updatedLabel">Updated:</span> {html.escape(exported)} · <a href="roadmap.html" data-i18n="backToRoadmap">Back to roadmap</a></div>
      </div>
    </div>
  </header>
  <main>
    {node_sections}
  </main>
  {language_script("roadmapDetails", preferred_lang)}
</body>
</html>
"""


def render_inline_details(
    nodes: list[dict[str, str]],
    cards: list[dict[str, str]],
    case_anchor_map: dict[str, str],
) -> str:
    detail_items = human_detail_node_items(nodes)
    node_sections = "\n".join(render_node_detail(node, i, cards, case_anchor_map) for i, node in detail_items)
    if not node_sections:
        node_sections = '<section class="detail-card" data-i18n="emptyRoadmap">No roadmap nodes recorded yet.</section>'
    return f"""<section class="inline-details" hidden data-inline-details aria-label="Roadmap details">
  <h2 data-i18n="roadmapDetails">Roadmap Details</h2>
  {node_sections}
  <a class="inline-top" href="#roadmap-overview" data-detail-close data-i18n="backToRoadmap">Back to roadmap</a>
</section>"""


def parse_bullets(text: str) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("- "):
            continue
        body = stripped[2:]
        if ":" in body:
            key, value = body.split(":", 1)
            items.append((key.strip(), value.strip()))
        else:
            items.append(("Item", body.strip()))
    return items


def parse_roadmap_nodes(text: str) -> list[dict[str, str]]:
    nodes: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for line in text.splitlines():
        if line.startswith("### "):
            if current:
                nodes.append(current)
            title = line[4:].strip()
            current = {"title": title}
            continue
        if current is None:
            continue
        stripped = line.strip()
        if stripped.startswith("- ") and ":" in stripped:
            key, value = stripped[2:].split(":", 1)
            normalized_key = canonical_node_key(key)
            if normalized_key in {"id", "node id"}:
                continue
            if normalized_key == "title" and "title" in current:
                continue
            current[normalized_key] = value.strip()
    if current:
        nodes.append(current)
    if nodes:
        return nodes
    return parse_loose_roadmap_nodes(text)


def canonical_node_key(key: str) -> str:
    normalized = key.strip().lower().replace("_", " ")
    aliases = {
        "id": "id",
        "node id": "id",
        "node": "id",
        "title": "title",
        "name": "title",
        "display title": "display title",
        "display": "display title",
        "human title": "display title",
        "user title": "display title",
        "date": "date",
        "status": "status",
        "level": "level",
        "branch": "branch",
        "route": "branch",
        "parent": "parent",
        "task": "task",
        "user request": "user request",
        "user prompt": "user request",
        "user input": "user request",
        "user question": "user request",
        "user asked": "user request",
        "progress": "progress summary",
        "current progress": "progress summary",
        "progress summary": "progress summary",
        "human progress": "progress summary",
        "method": "method summary",
        "method summary": "method summary",
        "human method": "method summary",
        "approach": "method summary",
        "outcome": "outcome",
        "summary": "outcome",
        "decision": "decision / reason",
        "reason": "decision / reason",
        "decision / reason": "decision / reason",
        "avoid going back": "avoid going back",
        "next": "next",
        "linked bad cases": "linked bad cases",
        "bad cases": "linked bad cases",
        "test chain": "test chain",
        "tests": "test chain",
    }
    return aliases.get(normalized, normalized)


def split_loose_field(body: str) -> tuple[str, str] | None:
    if ":" not in body:
        return None
    key, value = body.split(":", 1)
    key = canonical_node_key(key)
    if key not in {
        "id",
        "title",
        "display title",
        "date",
        "status",
        "level",
        "branch",
        "parent",
        "task",
        "user request",
        "progress summary",
        "method summary",
        "outcome",
        "decision / reason",
        "avoid going back",
        "next",
        "linked bad cases",
        "test chain",
    }:
        return None
    return key, value.strip()


def loose_node_title(node: dict[str, str]) -> str:
    title = node.get("title", "").strip()
    identifier = node.pop("id", "").strip()
    if not title:
        title = identifier or "Untitled roadmap node"
    elif identifier and not title.startswith(identifier):
        title = f"{identifier}: {title}"
    return title


def commit_loose_node(nodes: list[dict[str, str]], current: dict[str, str] | None) -> None:
    if not current:
        return
    if "title" not in current and "id" not in current:
        return
    current["title"] = loose_node_title(current)
    nodes.append(current)


def parse_loose_roadmap_nodes(text: str) -> list[dict[str, str]]:
    nodes: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        body = ""
        if stripped.startswith("- "):
            body = stripped[2:].strip()
        elif current and re.match(r"^[A-Za-z][A-Za-z _/-]+:\s+", stripped):
            body = stripped
        else:
            continue

        node_line = re.match(r"^(NODE-\d{8}-\d+)\s*:\s*(.+)$", body)
        if node_line:
            commit_loose_node(nodes, current)
            current = {"id": node_line.group(1), "title": node_line.group(2).strip()}
            continue

        field = split_loose_field(body)
        if not field:
            continue
        key, value = field
        if key == "id" and re.search(r"NODE-\d{8}-\d+", value):
            commit_loose_node(nodes, current)
            current = {"id": re.search(r"NODE-\d{8}-\d+", value).group(0)}
            trailing = value.replace(current["id"], "", 1).strip(" -:")
            if trailing:
                current["title"] = trailing
            continue
        if current is None:
            current = {}
        current[key] = value
    commit_loose_node(nodes, current)
    return nodes


def node_id(node: dict[str, str]) -> str:
    title = node.get("title", "")
    match = re.match(r"(NODE-\d{8}-\d+)", title)
    return match.group(1) if match else title.split(":", 1)[0].strip()


def branch_name(node: dict[str, str]) -> str:
    return human_text(node.get("branch", "Main")).strip() or "Main"


def node_level(node: dict[str, str]) -> str:
    level = node.get("level", "major").strip().lower()
    if level in {"checkpoint", "minor", "detail"}:
        return "checkpoint"
    return "major"


def human_level(node: dict[str, str]) -> str:
    return "Checkpoint" if node_level(node) == "checkpoint" else "Major"


def group_nodes_by_branch(nodes: list[dict[str, str]]) -> list[tuple[str, list[tuple[int, dict[str, str]]]]]:
    groups: list[tuple[str, list[tuple[int, dict[str, str]]]]] = []
    index: dict[str, int] = {}
    for number, node in enumerate(nodes, 1):
        branch = branch_name(node)
        key = branch.lower()
        if key not in index:
            index[key] = len(groups)
            groups.append((branch, []))
        groups[index[key]][1].append((number, node))
    return groups


def display_items_for_route(items: list[tuple[int, dict[str, str]]]) -> list[tuple[int, dict[str, str]]]:
    major_items = [(number, node) for number, node in items if node_level(node) == "major"]
    return major_items or items


def human_detail_node_items(nodes: list[dict[str, str]]) -> list[tuple[int, dict[str, str]]]:
    items = list(enumerate(nodes, 1))
    major_items = [(number, node) for number, node in items if node_level(node) == "major"]
    return major_items or items


def linked_cases_for_detail_items(
    items: list[tuple[int, dict[str, str]]],
    cards: list[dict[str, str]],
) -> list[dict[str, str]]:
    linked: list[dict[str, str]] = []
    seen: set[str] = set()
    for _, node in items:
        for card in bad_cases_for_node(node, cards):
            title = card.get("title", "")
            if title in seen:
                continue
            seen.add(title)
            linked.append(card)
    return linked


def external_parent_id(
    branch: str,
    items: list[tuple[int, dict[str, str]]],
    node_lookup: dict[str, dict[str, str]],
) -> str:
    if branch.strip().lower() == "main":
        return ""
    for _, node in items:
        raw_parent = node.get("parent", "").strip()
        if raw_parent and raw_parent.lower() not in {"none", "n/a", "null"}:
            match = re.search(r"NODE-\d{8}-\d+", raw_parent)
            candidate = match.group(0) if match else raw_parent
            parent_node = node_lookup.get(candidate, {})
            if branch_name(parent_node).strip().lower() != branch.strip().lower():
                return candidate
    return ""


def build_visible_route_positions(
    route_groups: list[tuple[str, list[tuple[int, dict[str, str]]]]],
) -> tuple[dict[str, tuple[str, int]], dict[str, tuple[str, int]], dict[str, list[tuple[int, str, int]]]]:
    visible_positions: dict[str, tuple[str, int]] = {}
    source_positions: dict[str, tuple[str, int]] = {}
    visible_by_branch: dict[str, list[tuple[int, str, int]]] = {}
    for branch, items in route_groups:
        branch_key = branch.lower()
        visible_by_branch[branch_key] = []
        for source_number, node in items:
            source_positions[node_id(node)] = (branch_key, source_number)
        for display_index, (source_number, node) in enumerate(display_items_for_route(items)):
            nid = node_id(node)
            visible_positions[nid] = (branch_key, display_index)
            visible_by_branch[branch_key].append((source_number, nid, display_index))
    return visible_positions, source_positions, visible_by_branch


def parent_visible_offset(
    parent_id: str,
    visible_positions: dict[str, tuple[str, int]],
    source_positions: dict[str, tuple[str, int]],
    visible_by_branch: dict[str, list[tuple[int, str, int]]],
) -> int:
    if parent_id in visible_positions:
        return visible_positions[parent_id][1]
    parent_source = source_positions.get(parent_id)
    if not parent_source:
        return 0
    parent_branch, parent_number = parent_source
    candidates = [
        display_index
        for source_number, _, display_index in visible_by_branch.get(parent_branch, [])
        if source_number <= parent_number
    ]
    return max(candidates) if candidates else 0


def parent_visible_anchor_id(
    parent_id: str,
    visible_positions: dict[str, tuple[str, int]],
    source_positions: dict[str, tuple[str, int]],
    visible_by_branch: dict[str, list[tuple[int, str, int]]],
) -> str:
    if parent_id in visible_positions:
        return parent_id
    parent_source = source_positions.get(parent_id)
    if not parent_source:
        return ""
    parent_branch, parent_number = parent_source
    candidates = [
        (source_number, display_index, nid)
        for source_number, nid, display_index in visible_by_branch.get(parent_branch, [])
        if source_number <= parent_number
    ]
    if not candidates:
        return ""
    return max(candidates, key=lambda item: (item[0], item[1]))[2]


def build_route_offsets(
    route_groups: list[tuple[str, list[tuple[int, dict[str, str]]]]],
    node_lookup: dict[str, dict[str, str]],
) -> dict[str, int]:
    visible_positions, source_positions, visible_by_branch = build_visible_route_positions(route_groups)
    offsets: dict[str, int] = {}
    for branch, items in route_groups:
        parent_id = external_parent_id(branch, items, node_lookup)
        offsets[branch.lower()] = (
            parent_visible_offset(parent_id, visible_positions, source_positions, visible_by_branch)
            if parent_id
            else 0
        )
    return offsets


def build_route_parent_anchors(
    route_groups: list[tuple[str, list[tuple[int, dict[str, str]]]]],
    node_lookup: dict[str, dict[str, str]],
) -> dict[str, tuple[str, str]]:
    visible_positions, source_positions, visible_by_branch = build_visible_route_positions(route_groups)
    anchors: dict[str, tuple[str, str]] = {}
    for branch, items in route_groups:
        parent_id = external_parent_id(branch, items, node_lookup)
        anchor_id = (
            parent_visible_anchor_id(parent_id, visible_positions, source_positions, visible_by_branch)
            if parent_id
            else ""
        )
        anchors[branch.lower()] = (parent_id, anchor_id)
    return anchors


def build_route_depths(
    route_groups: list[tuple[str, list[tuple[int, dict[str, str]]]]],
    node_lookup: dict[str, dict[str, str]],
) -> dict[str, int]:
    group_map = {branch.lower(): (branch, items) for branch, items in route_groups}
    memo: dict[str, int] = {}

    def depth_for(branch_key: str, seen: set[str] | None = None) -> int:
        if branch_key in memo:
            return memo[branch_key]
        seen = set(seen or set())
        if branch_key in seen or branch_key == "main":
            memo[branch_key] = 0
            return 0
        seen.add(branch_key)
        branch, items = group_map.get(branch_key, ("", []))
        parent_id = external_parent_id(branch, items, node_lookup) if branch else ""
        parent_node = node_lookup.get(parent_id, {})
        parent_branch_key = branch_name(parent_node).lower() if parent_node else ""
        if not parent_branch_key or parent_branch_key == branch_key:
            memo[branch_key] = 0
        else:
            memo[branch_key] = depth_for(parent_branch_key, seen) + 1
        return memo[branch_key]

    for branch, _ in route_groups:
        depth_for(branch.lower())
    return memo


def route_color_vars(depth: int) -> str:
    palette = [
        ("#2f7d63", "#dff1e7", "#c2d8c8"),
        ("#197a8a", "#d8eef2", "#9fc9d2"),
        ("#2b55b3", "#dfe8fb", "#adc2eb"),
        ("#6542b8", "#e9e2fb", "#c4b4ec"),
    ]
    accent, soft, line = palette[min(max(depth, 0), len(palette) - 1)]
    return f"--route-accent: {accent}; --route-soft: {soft}; --route-line: {line};"


def route_slug(branch: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", branch.lower()).strip("-")
    return slug or "main"


def human_title(title: str) -> str:
    return re.sub(r"^(?:NODE|BC)-\d{8}-\d+:\s*", "", title).strip() or title


def node_display_title(node: dict[str, str], fallback: str) -> str:
    """Return the short human-facing title, keeping source titles for agent context."""
    return human_title(node.get("display title", "").strip() or node.get("title", "").strip() or fallback)


def human_text(text: str) -> str:
    parts = re.split(r"(`[^`]*`)", text)
    cleaned: list[str] = []
    for part in parts:
        if part.startswith("`") and part.endswith("`"):
            cleaned.append(part)
            continue
        part = re.sub(r"CTX-\d{8}-[\w-]+", "this task", part)
        part = re.sub(r"NODE-\d{8}-\d+", "a roadmap node", part)
        part = re.sub(r"BC-\d{8}-\d+", "a linked bad case", part)
        cleaned.append(part)
    return "".join(cleaned)


ZH_TEXT: dict[str, str] = {
    "Main": "主线",
    "Roadmap UX": "路线图体验",
    "Documentation": "文档支线",
    "Identify Superpowers as workflow baseline": "将 Superpowers 作为工作流基线",
    "Create initial bad-case regression guard": "创建初始 bad case 回归防线",
    "Rename and widen scope to Context Guard": "重命名并扩展为 Context Guard",
    "Add dynamic task index and interruption handling": "添加动态任务索引和中断处理",
    "Add folder-scoped roadmap model": "添加文件夹级路线图模型",
    "Export roadmap as HTML": "将路线图导出为 HTML",
    "Add direct show-roadmap behavior and global fallback": "添加直接展示路线图和全局兜底",
    "Enforce concise context and roadmap display": "强制精简 context 和路线图展示",
    "Switch roadmap to three horizontal tracks": "切换为三条横向轨道",
    "Keep roadmap export files stable": "保持路线图导出文件稳定",
    "Separate human roadmap view from Codex context sources": "区分人类路线图视图和 Codex context 源",
    "Hide internal IDs in human roadmap": "在人类路线图中隐藏内部 ID",
    "Split roadmap into compact overview and detail page": "拆分路线图为简洁概览和详情页",
    "Replace roadmap metadata text with visual cues": "用视觉提示替代路线图元数据文字",
    "Add tag chips to roadmap display": "为路线图添加标签胶囊",
    "Add emoji cues to tag chips": "为标签胶囊添加表情提示",
    "Support branch-aware roadmap routes": "支持分支感知的路线图路线",
    "Coarsen main route node granularity": "放粗主路线节点粒度",
    "Add multilingual roadmap display": "添加多语言路线图显示",
    "Add goal-mode context checkpoints": "添加 goal 模式 context 检查点",
    "Move lane titles to left label column": "将轨道标题移到左侧标签列",
    "Use vertical labels and Chinese record text": "使用竖排标签和中文记录文本",
    "Add repository README": "添加仓库 README",
    "Rebalance roadmap routes and numbering": "重整路线图路线和编号",
    "Explore roadmap visual theme options": "探索路线图视觉主题选项",
    "Use Botanical and route-focused drilldown": "使用 Botanical 和路线聚焦详情",
    "Main base": "主线起点",
    "Main later checkpoint": "主线后续检查点",
    "No source user request recorded for this historical node.": "这个历史节点没有记录用户原始请求。",
    "Bad cases would only live in chat": "Bad case 只存在聊天里",
    "Scope drift toward scripting every bad case": "范围漂移到为每个 bad case 写脚本",
    "Interrupted design context could be lost": "被中断的设计 context 可能丢失",
    "Context bound to thread instead of folder": "Context 绑定在线程而不是文件夹",
    "Markdown roadmap is uncomfortable for humans": "Markdown 路线图不适合人类阅读",
    "Roadmap request answered with instructions instead of display": "路线图请求被回答成说明而不是直接展示",
    "Context Guard may not activate without explicit mention": "未显式提及时 Context Guard 可能不会激活",
    "Roadmap nodes were not recorded during this skill's development": "开发这个 skill 时没有记录路线节点",
    "Context records could become too verbose": "Context 记录可能变得过于冗长",
    "Roadmap display could use the wrong mental model": "路线图展示可能使用错误模型",
    "Roadmap files could accumulate endlessly": "路线图文件可能无限堆积",
    "HTML roadmap could be mistaken for Codex context source": "HTML 路线图可能被误当成 Codex context 源",
    "Human roadmap exposes internal IDs": "人类路线图暴露内部 ID",
    "User roadmap overview could become too verbose": "用户路线图概览可能过于冗长",
    "Roadmap metadata labels create visual noise": "路线图元数据标签造成视觉噪声",
    "User roadmap lacks tag semantics and feels stiff": "用户路线图缺少标签语义且显得生硬",
    "Roadmap tags lack emoji cues": "路线图标签缺少表情提示",
    "Roadmap assumes a single main route": "路线图假设只有一条主线",
    "Main route cards are too granular": "主路线卡片粒度过细",
    "Roadmap chrome only supports English": "路线图界面只支持英文",
    "Goal-mode work may lag context updates": "Goal 模式工作可能滞后更新 context",
    "Lane titles repeat inside every node card": "轨道标题在每个节点卡片里重复",
    "Lane label column is not vertical": "轨道标签列没有竖排",
    "Chinese mode leaves record content in English": "中文模式下记录内容仍是英文",
    "Visible roadmap numbering skips hidden checkpoints": "路线图可见编号跳过隐藏检查点",
    "forked from": "从",
    "Skill may not activate without explicit mention": "未显式提及时 skill 可能不会激活",
    "Roadmap nodes were not recorded during this skill's own development": "开发这个 skill 时没有记录路线节点",
    "Reviewed Superpowers and installed it for stronger engineering workflow discipline.": "已查看 Superpowers 并安装，用于强化工程工作流纪律。",
    "Verified Superpowers symlink and skill discovery paths.": "已验证 Superpowers 符号链接和 skill 发现路径。",
    "Created a skill to record bad cases, fixes, verification methods, and recurrence analysis.": "创建 skill，用于记录 bad case、修复方法、验证方法和复现分析。",
    "Ran `quick_validate.py` and passed.": "已运行 `quick_validate.py` 并通过。",
    "Renamed skill to `context-guard` and changed default storage to `.codex/context/`.": "将 skill 重命名为 `context-guard`，并把默认存储改为 `.codex/context/`。",
    "Validated skill after rename.": "重命名后已验证 skill。",
    "Added `.codex/context/index.md`, task folders, parked/resume-candidate states, and resume prompts.": "添加 `.codex/context/index.md`、任务文件夹、停放/候选恢复状态和恢复提示。",
    "Added hooks for `UserPromptSubmit` and `Stop`; dry run passed.": "添加 `UserPromptSubmit` 和 `Stop` hooks，并通过 dry run。",
    "Added folder-level `.codex/context/roadmap.md`, route nodes, bad-case links, frequency tags, and test-chain notes.": "添加文件夹级 `.codex/context/roadmap.md`、路线节点、bad case 链接、频率标签和测试链路备注。",
    "Plugin validation and hook dry runs passed.": "插件验证和 hook dry run 已通过。",
    "Changed roadmap export from Markdown to a human-friendly single-file HTML view.": "将路线图导出从 Markdown 改为更适合人类阅读的单文件 HTML 视图。",
    "`context_guard.py export-roadmap` generated valid HTML with Quick Scan, Main Route, and Bad Cases.": "`context_guard.py export-roadmap` 已生成包含 Quick Scan、主要路线和 Bad Case 的有效 HTML。",
    "Added `show-roadmap`, updated skill instructions so Codex displays HTML directly, and added global AGENTS/hook fallback for cases where the skill is not explicitly invoked.": "添加 `show-roadmap`，更新 skill 说明让 Codex 直接展示 HTML，并加入全局 AGENTS/hook 兜底以处理未显式调用 skill 的情况。",
    "`show-roadmap` generated file URL; global hook dry run initialized context and detected task switch/bad case prompts.": "`show-roadmap` 已生成文件 URL；全局 hook dry run 能初始化 context 并识别任务切换或 bad case 提示。",
    "Added a conciseness contract and compact HTML roadmap defaults.": "添加精简契约和紧凑 HTML 路线图默认规则。",
    "Compact HTML assertion passed; skill/plugin validation passed; pushed commit `5ca87e2`.": "紧凑 HTML 断言通过，skill/plugin 验证通过，并推送 commit `5ca87e2`。",
    "Context could drift into a transcript instead of key nodes and bad cases.": "Context 可能变成流水账，而不是关键节点和 bad case。",
    "Let templates invite full decisions, commands, and details into every node.": "模板会把完整决策、命令和细节引入每个节点。",
    "Conciseness was a preference, not a hard contract.": "精简只是偏好，不是强约束。",
    "Added concise-context rules, compact templates, and folded HTML details.": "添加精简 context 规则、紧凑模板和折叠 HTML 详情。",
    "Run compact HTML assertion and skill/plugin validation.": "运行紧凑 HTML 断言和 skill/plugin 校验。",
    "Solved bad cases could be forgotten after the conversation moved on.": "已解决的 bad case 可能在对话推进后被遗忘。",
    "Continue development without a project-level bad-case register.": "在没有项目级 bad case 登记表的情况下继续开发。",
    "No durable folder-scoped memory.": "缺少持久的文件夹级记忆。",
    "Added `.codex/context/bad-cases.md` and task-local bad-case support.": "添加 `.codex/context/bad-cases.md` 和任务内 bad case 支持。",
    "The skill direction drifted toward wrapping every bad case in scripts.": "skill 方向漂移成把每个 bad case 都封装成脚本。",
    "Treat verification reuse as script generation by default.": "默认把复用验证等同于生成脚本。",
    "Overemphasis on automation instead of context maintenance.": "过度强调自动化，而忽略 context 维护。",
    "Reworded skill so context is primary and scripts are optional durable guards.": "重写 skill 说明，明确 context 是核心，脚本只是可选的持久防线。",
    "A design discussion could be interrupted by an urgent bug and never resumed.": "设计讨论可能被紧急 bug 打断，并且之后没有恢复。",
    "User switches to an unrelated urgent issue mid-design.": "用户在设计过程中切换到不相关的紧急问题。",
    "No parked task queue.": "缺少可停放的任务队列。",
    "Added dynamic index states: current, parked, resume-candidate, done, archived.": "添加动态索引状态：当前、已停放、候选恢复、完成、归档。",
    "Context could be tied to a thread even though Codex work is folder-based.": "Context 可能绑定在线程上，但 Codex 工作实际以文件夹为边界。",
    "Open a different thread in the same folder.": "在同一个文件夹中打开另一个线程。",
    "No explicit folder-scoped context root.": "缺少明确的文件夹级 context 根目录。",
    "Defined `.codex/context/` as folder-scoped and added SessionStart initialization.": "定义 `.codex/context/` 为文件夹级目录，并添加 SessionStart 初始化。",
    "Markdown route map is agent-readable but not pleasant for human roadmap review.": "Markdown 路线图适合 agent 读取，但不适合人类舒服地查看路线。",
    "User asks to see roadmap and receives Markdown-style output.": "用户要求查看路线图时收到 Markdown 风格输出。",
    "Export format optimized for agent, not human.": "导出格式偏向 agent，而不是人类阅读。",
    "Added HTML export with Quick Scan, Main Route, and Bad Cases columns.": "添加包含快速扫描、主要路线和 Bad Case 列的 HTML 导出。",
    "User expected `$context-guard 展示 roadmap` to display roadmap directly, not explain commands.": "用户期望 `$context-guard 展示 roadmap` 直接展示路线图，而不是解释命令。",
    "User asks how to view roadmap.": "用户询问如何查看路线图。",
    "Added `show-roadmap` and skill instructions to open/display generated HTML.": "添加 `show-roadmap` 和 skill 说明，用于打开或展示生成的 HTML。",
    "Without `$context-guard`, Codex might not load the skill and might skip context intake/checkpoint.": "没有 `$context-guard` 时，Codex 可能不会加载 skill，从而跳过 context 读取和检查点。",
    "User asks a context-worthy question without explicit skill mention.": "用户提出需要 context 的问题，但没有显式提到 skill。",
    "Skill body only loads after activation; implicit activation is not guaranteed.": "skill 内容只有激活后才会加载，隐式激活并不可靠。",
    "Added global AGENTS fallback protocol and user-level hooks.": "添加全局 AGENTS 兜底协议和用户级 hooks。",
    "The user asked why current skill development had no roadmap nodes; `.codex/context/roadmap.md` was empty.": "用户询问为什么当前 skill 开发没有路线节点；`.codex/context/roadmap.md` 为空。",
    "Run `show-roadmap` after developing the skill and inspect empty roadmap.": "开发 skill 后运行 `show-roadmap` 并看到空路线图。",
    "Context Guard was created late and not retroactively applied to the ongoing development process.": "Context Guard 创建得较晚，没有回填到正在进行的开发过程。",
    "Backfilled roadmap nodes and bad-case register for the current skill development.": "为当前 skill 开发回填路线节点和 bad case 登记。",
    "Open `roadmap.html`, switch to Chinese, and inspect main route, bad-case, test-chain, and detail text.": "打开 `roadmap.html`，切换到中文，并检查主路线、bad case、测试链路和详情文本。",
    "Vertical label and Chinese record assertion checks localized overview records and localized detail records.": "竖排标签和中文记录断言检查本地化概览记录和本地化详情记录。",
    "Roadmap display now uses node columns with Main Route, Bad Cases, and Test Chain lanes.": "路线图现在使用节点列，并包含主要路线、Bad Case、测试链路三条轨道。",
    "Roadmap could appear as a three-column dashboard instead of three horizontal tracks.": "路线图可能显示成三列仪表盘，而不是三条横向轨道。",
    "Generate HTML with separate Quick Scan/Main Route/Bad Case columns.": "生成带独立 Quick Scan、主要路线和 Bad Case 列的 HTML。",
    "Display model did not encode horizontal mainline plus vertical node-linked lanes.": "展示模型没有表达横向主线和按节点竖向关联的轨道。",
    "Render node columns with Main Route, Bad Cases, and Test Chain lanes.": "渲染节点列，并包含主要路线、Bad Case 和测试链路轨道。",
    "Three-track HTML assertion passed; generated roadmap had 9 main/bad-case/test-chain lane sets and no old layout; pushed commit `4c31abd`.": "三轨 HTML 断言通过；生成的路线图包含 9 组主线/bad case/测试链路线，且不再出现旧布局；已推送 commit `4c31abd`。",
    "Roadmap display now targets stable HTML files instead of timestamped exports.": "路线图展示现在写入稳定 HTML 文件，而不是时间戳导出文件。",
    "Stable export assertion passed; current folder has stable HTML files and no timestamped roadmap HTML; pushed commit `13be025`; later route added stable details page.": "稳定导出断言通过；当前文件夹只有稳定 HTML 文件，没有时间戳路线图 HTML；已推送 commit `13be025`；后续路线加入了稳定详情页。",
    "Clarified that `roadmap.html` is only the user-facing view, while Codex reads source context files.": "明确 `roadmap.html` 只是用户视图，Codex 读取源 context 文件。",
    "Artifact-role assertion passed; skill/plugin validation passed; generated HTML/Markdown carry role markers; pushed commit `ef9a18f`.": "产物角色断言通过，skill/plugin 验证通过，生成的 HTML/Markdown 都带有角色标记；已推送 commit `ef9a18f`。",
    "User-facing roadmap now shows concise natural-language node and bad-case labels.": "面向用户的路线图现在显示简洁自然语言节点和 bad case 标签。",
    "Human-label assertion passed; real HTML contains no internal IDs while Markdown keeps them; pushed commit `4049b32`.": "人类标签断言通过；真实 HTML 不含内部 ID，Markdown 保留内部 ID；已推送 commit `4049b32`。",
    "Roadmap overview now shows sparse labels and links detailed fields to a stable detail page.": "路线图概览现在只显示精简标签，并把详细字段链接到稳定详情页。",
    "Compact overview assertion passed; real HTML links to detail page and hides verbose fields; pushed commit `f5fb2b2`.": "精简概览断言通过；真实 HTML 链接到详情页，并隐藏冗长字段；已推送 commit `f5fb2b2`。",
    "Compact overview assertion checks no verbose fields or Quick Scan panel on the overview and confirms detail links exist.": "精简概览断言检查概览页没有冗长字段或 Quick Scan 面板，并确认详情链接存在。",
    "User-facing roadmap now uses color markers for status/frequency and hides empty tag fallback text.": "面向用户的路线图现在用颜色标记表示状态/频率，并隐藏空标签兜底文本。",
    "Visual cue assertion checks no raw metadata words and confirms status markers exist; pushed commit `bd19ce6`.": "视觉提示断言检查无原始元数据文字，并确认状态标记存在；已推送 commit `bd19ce6`。",
    "Bad-case tags now render as compact colored chips in overview and detail views.": "Bad case 标签现在在概览和详情中渲染为紧凑彩色胶囊。",
    "Tag rendering assertion checks overview tags, detail tags, visual tag classes, and no fallback tag text; pushed commit `0d238cb`.": "标签渲染断言检查概览标签、详情标签、视觉标签类，并确认无兜底标签文本；已推送 commit `0d238cb`。",
    "Tag chips now include small emoji cues mapped from tag semantics.": "标签胶囊现在包含按标签语义映射的小表情提示。",
    "Emoji tag assertion checks emoji spans, semantic emoji mappings, and no fallback tag text; pushed commit `48e21b1`.": "表情标签断言检查 emoji 片段、语义映射和无兜底标签文本；已推送 commit `48e21b1`。",
    "Roadmap HTML now groups nodes by route branch, so forked or parallel mainlines do not collapse into one line.": "路线图 HTML 现在按路线分支分组，分叉或并行主线不会被压成一条线。",
    "Branch rendering assertion checks route groups, branch labels, separate horizontal grids, parent route detail, hidden internal IDs, and real HTML export; pushed commit `61506ca`.": "分支渲染断言检查路线组、分支标签、独立横向网格、父路线详情、隐藏内部 ID 和真实 HTML 导出；已推送 commit `61506ca`。",
    "Roadmap overview now shows only major milestones as main route cards and folds smaller updates into details.": "路线图概览现在只把重要里程碑显示为主路线卡片，并将较小更新折叠到详情中。",
    "Major-node granularity assertion checks checkpoint hiding, compact checkpoint summary, detail retention, and level labels; pushed commit `5af24f5`.": "主节点粒度断言检查隐藏 checkpoint、紧凑 checkpoint 摘要、详情保留和等级标签；已推送 commit `5af24f5`。",
    "Roadmap overview and details now support Chinese/English UI chrome in the same stable HTML files.": "路线图概览和详情现在在同一组稳定 HTML 文件中支持中英文界面。",
    "i18n assertion checks language toggles, Chinese/English labels, URL parameter support, and details page labels; pushed commit `085479a`.": "i18n 断言检查语言切换、中英文标签、URL 参数支持和详情页标签；已推送 commit `085479a`。",
    "Context Guard now tells Codex to keep roadmap and bad-case memory updated during goal-mode work.": "Context Guard 现在要求 Codex 在 goal 模式工作中持续更新路线图和 bad case 记忆。",
    "Goal-mode assertion checks skill rules, `get_goal`/`update_goal` constraints, hook hints, and template maintenance rules; pushed commit `8d9c064`.": "Goal 模式断言检查 skill 规则、`get_goal`/`update_goal` 约束、hook 提示和模板维护规则；已推送 commit `8d9c064`。",
    "Roadmap overview now renders Main Route, Bad Cases, and Test Chain labels once in a left-side column for each route group.": "路线图概览现在为每个路线组在左侧列中只显示一次主要路线、Bad Case 和测试链路标签。",
    "Lane header column assertion checks one left label column and no lane labels inside node cards; pushed commit `2169387`.": "轨道标题列断言检查左侧只有一列标题，并且节点卡片内没有轨道标题；已推送 commit `2169387`。",
    "Roadmap labels use a vertical left column and Chinese mode localizes record titles, summaries, bad cases, and test snippets.": "路线图标签使用左侧竖排列，中文模式会本地化记录标题、摘要、bad case 和测试片段。",
    "Main overview route is coarser, Roadmap UX and Documentation appear as branch routes, and visible overview numbers are consecutive per route group.": "主概览路线更粗粒度，路线图体验和文档以支线显示，并且每个路线组的可见编号连续。",
    "Roadmap overview briefly supported visual theme comparison in the same stable HTML file.": "路线图概览曾在同一个稳定 HTML 文件中支持视觉主题对比。",
    "Roadmap overview now uses Botanical as the only style and switches multi-route displays to route-first drilldown.": "路线图概览现在使用 Botanical 作为唯一样式，并将多路线展示切换为路线优先详情。",
    "Added a root README explaining Context Guard purpose, installation, hooks, usage, context files, bad-case rules, roadmap model, and verification.": "添加仓库 README，说明 Context Guard 目标、安装、hooks、用法、context 文件、bad case 规则、路线图模型和验证方法。",
    "Main route starts.": "主线开始。",
    "Main route references prior main node but is not a branch.": "主线引用前序主节点，但不是支线。",
    "Consecutive numbering assertion, branch route assertion, real roadmap export, and stable file assertion.": "连续编号断言、分支路线断言、真实路线图导出和稳定文件断言。",
    "i18n assertion checks language toggles, Chinese/English labels, URL parameter support, and details page labels.": "i18n 断言检查语言切换、中英文标签、URL 参数支持和详情页标签。",
    "Goal-mode assertion checks skill rules, `get_goal`/`update_goal` constraints, hook hints, and template maintenance rules.": "Goal 模式断言检查 skill 规则、`get_goal`/`update_goal` 约束、hook 提示和模板维护规则。",
    "Lane header column assertion checks one left label column and no lane labels inside node cards.": "轨道标题列断言检查左侧只有一列标题，并且节点卡片内没有轨道标题。",
    "Vertical label and Chinese record assertion checks lane writing mode, localized overview records, and localized detail records.": "竖排标签和中文记录断言检查轨道书写方向、概览记录本地化和详情记录本地化。",
    "Vertical label and Chinese record assertion checks lane writing mode, localized overview records, localized detail records, and stable roadmap files.": "竖排标签和中文记录断言检查轨道书写方向、本地化概览记录、本地化详情记录和稳定路线图文件。",
    "Vertical label and Chinese record assertion checks `writing-mode: vertical-rl` in generated overview CSS.": "竖排标签和中文记录断言检查生成的概览 CSS 中保留 `writing-mode: vertical-rl`。",
    "Vertical label and Chinese record assertion passed.": "竖排标签和中文记录断言已通过。",
    "User said lane labels should be vertical and Chinese mode should show Chinese records, not only Chinese UI chrome.": "用户要求轨道标签竖排，并且中文模式应显示中文记录，而不只是中文 UI 外壳。",
    "User said 轨道标签 should be vertical and Chinese mode should show Chinese records, not only Chinese UI chrome.": "用户要求轨道标签竖排，并且中文模式应显示中文记录，而不只是中文 UI 外壳。",
    "Do not treat multilingual roadmap support as only translating static interface labels.": "不要把多语言路线图支持只当成翻译静态界面标签。",
    "Keep localized record text concise and sourced from the single context projection.": "保持本地化记录文本精简，并来自同一份 context 投影。",
    "Vertical label and Chinese record assertion checks lane writing mode, localized overview records, localized detail records, and stable roadmap files; pushed commit `18b4209`.": "竖排标签和中文记录断言检查轨道书写方向、本地化概览记录、本地化详情记录和稳定路线图文件；已推送 commit `18b4209`。",
    "User asked for a README for the current skill so humans can understand and install it from the GitHub repository.": "用户要求为当前 skill 添加 README，让人类可以理解并从 GitHub 仓库安装它。",
    "Do not leave skill usage knowledge only inside `SKILL.md` or chat history.": "不要把 skill 使用知识只留在 `SKILL.md` 或聊天历史里。",
    "Keep README updated when install, hook, roadmap, or bad-case behavior changes.": "安装、hook、路线图或 bad-case 行为变化时保持 README 更新。",
    "README covers purpose, installation, AGENTS/hook setup, usage, context layout, bad-case rules, roadmap model, and verification.": "README 覆盖目标、安装、AGENTS/hook 设置、用法、context 布局、bad-case 规则、路线图模型和验证方法。",
    "Skill lacked explicit show-roadmap workflow.": "skill 缺少明确的 show-roadmap 工作流。",
    "Inspect context folder and skill instructions.": "检查 context 文件夹和 skill 说明。",
    "Read Context Evidence and Guards section.": "阅读 context 证据和守卫规则章节。",
    "Inspect `.codex/context/index.md` template.": "检查 `.codex/context/index.md` 模板。",
    "Run context hook session-start dry run.": "运行 context hook 的 session-start dry run。",
    "Run `context_guard.py export-roadmap` and inspect HTML.": "运行 `context_guard.py export-roadmap` 并检查 HTML。",
    "Run `context_guard.py show-roadmap`.": "运行 `context_guard.py show-roadmap`。",
    "Inspect `~/.codex/AGENTS.md` and `~/.codex/hooks.json`; run hook dry run.": "检查 `~/.codex/AGENTS.md` 和 `~/.codex/hooks.json`；运行 hook dry run。",
    "Re-run `show-roadmap` and confirm nodes appear.": "重新运行 `show-roadmap` 并确认节点出现。",
    "Run compact HTML assertion plus skill/plugin validators.": "运行紧凑 HTML 断言和 skill/plugin 校验。",
    "Three-track HTML assertion checks track board, all three lanes, and no old layout class.": "三轨 HTML 断言检查 track board、三条轨道以及无旧布局 class。",
    "Stable export assertion checks repeated exports return stable paths and no timestamped HTML files exist.": "稳定导出断言检查重复导出会返回稳定路径，并且不会生成带时间戳的 HTML 文件。",
    "Human-label assertion checks HTML hides internal IDs while keeping natural titles.": "人类标签断言检查 HTML 隐藏内部 ID，同时保留自然语言标题。",
    "Visual cue assertion checks no raw metadata words in generated human HTML and confirms status markers exist.": "视觉提示断言检查生成的人类 HTML 不显示原始元数据词，并确认状态标记存在。",
    "Tag rendering assertion checks overview tags, detail tags, visual tag classes, and no fallback tag text.": "标签渲染断言检查概览标签、详情标签、视觉标签类，并确认没有兜底标签文本。",
    "Emoji tag assertion checks emoji spans, semantic emoji mappings, and no fallback tag text.": "表情标签断言检查 emoji span、语义映射，并确认没有兜底标签文本。",
    "Overview cards show source node numbers with gaps, such as 3, 5, 7, when checkpoints are hidden.": "隐藏检查点后，概览卡片会显示带跳号的源节点编号，例如 3、5、7。",
    "The renderer uses the source node index as both the visible overview number and the detail anchor number.": "渲染器同时把源节点序号用作可见概览编号和详情锚点编号。",
    "Split source detail anchors from visible overview display numbers; overview cards now enumerate display items after checkpoint filtering.": "将源详情锚点和可见概览编号分离；概览卡片现在在过滤检查点后重新编号。",
    "Red case reproduced visible numbers `1, 3`; green assertion confirms overview shows `1, 2` while links still target source detail anchors.": "红灯用例复现了可见编号 `1, 3`；绿灯断言确认概览显示 `1, 2`，同时链接仍指向源详情锚点。",
    "The left lane label column renders horizontally and can crowd or crop roadmap cards on narrow screens.": "左侧轨道标签列横向渲染，在窄屏上会挤压或裁切路线图卡片。",
    "Chinese mode changes UI chrome but leaves node titles, summaries, bad-case titles, and test-chain text in English.": "中文模式只切换界面文字，但节点标题、摘要、bad case 标题和测试链路仍是英文。",
    "Lane labels were styled like normal horizontal text after moving them to the left column.": "轨道标签移到左侧列后仍按普通横排文本样式渲染。",
    "Record fields were emitted as escaped static text rather than language-aware text spans.": "记录字段被输出为转义后的静态文本，而不是支持语言切换的文本片段。",
    "Render lane labels with vertical writing mode and narrow sticky label cells.": "用竖排书写模式和窄粘性标签格渲染轨道标签。",
    "Wrap human-facing record strings in `data-i18n-text` spans with English and Chinese variants.": "将面向用户的记录字符串包进带英文和中文版本的 `data-i18n-text` 片段。",
}


ZH_REPLACEMENTS: list[tuple[str, str]] = [
    ("Stop hook", "结束钩子"),
    ("stop condition", "停止条件"),
    ("stop hook", "结束钩子"),
    ("red signal", "红色信号"),
    ("post-fix", "修复后"),
    ("Context Evidence and Guards section", "context 证据和守卫规则章节"),
    ("Chinese mode should show Chinese records", "中文模式应显示中文记录"),
    ("Chinese UI chrome", "中文 UI 外壳"),
    ("static interface labels", "静态界面标签"),
    ("localized record text", "本地化记录文本"),
    ("single context projection", "同一份 context 投影"),
    ("lane writing mode", "轨道书写方向"),
    ("localized overview records", "本地化概览记录"),
    ("localized detail records", "本地化详情记录"),
    ("stable roadmap files", "稳定路线图文件"),
    ("current skill", "当前 skill"),
    ("GitHub repository", "GitHub 仓库"),
    ("chat history", "聊天历史"),
    ("Roadmap overview and details", "路线图概览和详情"),
    ("Roadmap overview", "路线图概览"),
    ("Roadmap display", "路线图展示"),
    ("roadmap display", "路线图展示"),
    ("roadmap overview", "路线图概览"),
    ("roadmap", "路线图"),
    ("record titles", "记录标题"),
    ("record content", "记录内容"),
    ("record strings", "记录文本"),
    ("summaries", "摘要"),
    ("summary", "摘要"),
    ("test snippets", "测试片段"),
    ("test-chain text", "测试链路文本"),
    ("node titles", "节点标题"),
    ("Main Route", "主要路线"),
    ("Bad Cases", "Bad Case"),
    ("Test Chain", "测试链路"),
    ("bad-case memory", "bad case 记忆"),
    ("bad cases", "bad case"),
    ("bad case", "bad case"),
    ("goal-mode", "goal 模式"),
    ("goal mode", "goal 模式"),
    ("Chinese/English", "中英文"),
    ("HTML files", "HTML 文件"),
    ("stable", "稳定"),
    ("assertion checks", "断言检查"),
    ("context folder", "context 文件夹"),
    ("skill instructions", "skill 说明"),
    ("instructions", "说明"),
    ("template", "模板"),
    ("nodes appear", "节点出现"),
    ("old layout class", "旧布局 class"),
    ("all three lanes", "三条轨道"),
    ("Inspect ", "检查 "),
    ("Read ", "阅读 "),
    ("Re-run ", "重新运行 "),
    ("Run ", "运行 "),
    (" and inspect ", " 并检查 "),
    (" and confirm ", " 并确认 "),
    (" and ", " 和 "),
    ("language toggles", "语言切换"),
    ("URL parameter support", "URL 参数支持"),
    ("details page labels", "详情页标签"),
    ("node cards", "节点卡片"),
    ("lane labels", "轨道标签"),
    ("left lane label column", "左侧轨道标签列"),
    ("left label column", "左侧标签列"),
    ("vertical", "竖排"),
    ("horizontally", "横向"),
    ("horizontal", "横向"),
    ("narrow screens", "窄屏"),
    ("writing mode", "书写方向"),
    ("left-side column", "左侧列"),
    ("labels", "标签"),
    ("updated", "更新"),
    ("support", "支持"),
    ("supports", "支持"),
    ("User said ", "用户要求"),
    ("User asked for ", "用户要求"),
    ("should be ", "应"),
    ("not only ", "不只是"),
    ("Do not treat ", "不要把"),
    (" as only translating ", "只当成翻译"),
    ("Keep ", "保持"),
    (" concise", "精简"),
    (" and sourced from ", "，并来自"),
    (" covers ", " 覆盖"),
    (" so humans can understand", "，让人类可以理解"),
    (" and install it from ", "并从"),
    ("Do not leave ", "不要把"),
    (" only inside ", "只留在"),
    (" when ", "当"),
    (" changes", "变化时"),
    ("purpose", "目标"),
    ("installation", "安装"),
    ("setup", "设置"),
    ("usage", "用法"),
    ("layout", "布局"),
    ("rules", "规则"),
    ("model", "模型"),
    ("verification", "验证"),
]


DETAIL_ZH_REWRITES: list[tuple[str, str]] = [
    (
        "用户反馈 skill 又陷入测试循环，说明验证预算还不够，需要明确停止条件",
        "用户发现 Context Guard 又把时间耗在反复补测试上，因此需要给验证流程设置明确的停止条件",
    ),
    (
        "Context Guard 现在承认用户截图、日志、复现和已定位根因可作为红色信号",
        "现在只要有截图、日志、复现步骤或明确根因，就可以确认问题已经成立",
    ),
    (
        "证据足够时应停止补测试并进入实现",
        "证据足够时，先修复问题，再做最小验证",
    ),
    (
        "后续观察 结束钩子 是否能让 Codex 在根因明确后先修复，再做一个最小 修复后 检查",
        "下一步观察结束钩子能否提醒 Codex：根因明确后先修复，再做一次最小检查",
    ),
    (
        "后续观察结束钩子是否能让 Codex 在根因明确后先修复，再做一个最小修复后检查",
        "下一步观察结束钩子能否提醒 Codex：根因明确后先修复，再做一次最小检查",
    ),
    (
        "不要把 TDD 惯性套到每个 bugfix",
        "不要每个修复都强行套用先写红测的流程",
    ),
    (
        "可信证据存在时不要继续制造红测",
        "已有可靠证据时，不再继续补红测",
    ),
    (
        "可信证据存在时仍制造红测导致测试循环",
        "已有可信证据时仍继续补红测，导致陷入测试循环",
    ),
]


def has_cjk(text: str) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", text))


def apply_zh_replacements(text: str) -> str:
    parts = re.split(r"(`[^`]*`)", text)
    translated_parts: list[str] = []
    for part in parts:
        if part.startswith("`") and part.endswith("`"):
            translated_parts.append(part)
            continue
        translated = part
        for source, target in ZH_REPLACEMENTS:
            translated = translated.replace(source, target)
        translated_parts.append(translated)
    return "".join(translated_parts)


def clean_zh_term_spacing(text: str) -> str:
    text = re.sub(r"([\u3400-\u9fff])\s+(停止条件|结束钩子|红色信号|修复后)", r"\1\2", text)
    text = re.sub(r"(停止条件|结束钩子|红色信号|修复后)\s+([\u3400-\u9fff])", r"\1\2", text)
    return text


def zh_text(text: str) -> str:
    text = human_text(text)
    normalized = " ".join(text.split())
    if normalized in ZH_TEXT:
        return ZH_TEXT[normalized]
    return clean_zh_term_spacing(apply_zh_replacements(normalized))


def polish_detail_zh(text: str) -> str:
    polished = zh_text(text)
    for source, target in DETAIL_ZH_REWRITES:
        polished = polished.replace(source, target)
    polished = re.sub(r"\s+", " ", polished).strip()
    polished = polished.replace(" ，", "，").replace(" 。", "。").replace(" ：", "：")
    return polished


def localized_text(text: str) -> str:
    en = human_text(text)
    zh = zh_text(en)
    return (
        f'<span data-i18n-text data-en="{html.escape(en, quote=True)}" '
        f'data-zh="{html.escape(zh, quote=True)}">{html.escape(en)}</span>'
    )


def localized_short_text(text: str, limit: int = 92) -> str:
    en = short_text(text, limit)
    zh = short_text(zh_text(text), limit)
    return (
        f'<span data-i18n-text data-en="{html.escape(en, quote=True)}" '
        f'data-zh="{html.escape(zh, quote=True)}">{html.escape(en)}</span>'
    )


def localized_detail_text(text: str, limit: int = 132) -> str:
    en = short_text(text, limit)
    zh = short_text(polish_detail_zh(text), limit)
    return (
        f'<span data-i18n-text data-en="{html.escape(en, quote=True)}" '
        f'data-zh="{html.escape(zh, quote=True)}">{html.escape(en)}</span>'
    )


def short_text(text: str, limit: int = 92) -> str:
    text = " ".join(human_text(text).split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "..."


def visual_status_class(status: str) -> str:
    normalized = status.strip().lower()
    if normalized in {"done", "resolved", "passed", "complete", "completed"}:
        return "status-ok"
    if normalized in {"active", "current", "planned", "open"}:
        return "status-active"
    if normalized in {"deferred", "superseded", "superseded-by-route-change"}:
        return "status-muted"
    if normalized in {"recurred", "failed", "failing", "blocked"}:
        return "status-bad"
    if normalized in {"warning", "warn", "at-risk"}:
        return "status-warn"
    return "status-muted"


def status_dot(status: str) -> str:
    return f'<span class="status-dot {visual_status_class(status)}" aria-hidden="true"></span>'


def frequency_dot(frequency: str) -> str:
    normalized = frequency.strip().lower()
    if normalized.startswith("repeated") or normalized in {"high-frequency", "hot"}:
        return '<span class="freq-dot" aria-hidden="true"></span>'
    return ""


def parse_tags(text: str) -> list[str]:
    tags = re.findall(r"#[A-Za-z0-9_-]+", text or "")
    seen: set[str] = set()
    unique: list[str] = []
    for tag in tags:
        key = tag.lower()
        if key not in seen:
            seen.add(key)
            unique.append(tag)
    return unique


def tag_class(tag: str) -> str:
    normalized = tag.lower()
    if any(key in normalized for key in ["ux", "ui", "label", "roadmap", "display"]):
        return "tag-blue"
    if any(key in normalized for key in ["risk", "hot", "flaky", "trigger", "missed"]):
        return "tag-amber"
    if any(key in normalized for key in ["resolved", "guard", "context", "source"]):
        return "tag-green"
    if any(key in normalized for key in ["loss", "bloat", "noise", "data"]):
        return "tag-rose"
    return "tag-slate"


def tag_emoji(tag: str) -> str:
    normalized = tag.lower()
    if any(key in normalized for key in ["risk", "hot", "flaky", "trigger", "missed"]):
        return "⚠️"
    if any(key in normalized for key in ["roadmap", "route", "layout"]):
        return "🧭"
    if any(key in normalized for key in ["ux", "ui", "display", "label"]):
        return "✨"
    if any(key in normalized for key in ["context", "source", "folder"]):
        return "🧠"
    if any(key in normalized for key in ["loss", "bloat", "noise", "data", "storage"]):
        return "🧹"
    if any(key in normalized for key in ["guard", "resolved", "test"]):
        return "✅"
    if "tag" in normalized:
        return "🏷️"
    return "🏷️"


TAG_LABELS_ZH: dict[str, str] = {
    "bad-case-lag": "bad case 延迟",
    "bad-case-link": "bad case 链接",
    "branch-support": "分支支持",
    "context-bloat": "context 膨胀",
    "context-loss": "context 丢失",
    "context-source": "context 源",
    "data-loss": "数据丢失",
    "display": "展示",
    "folder-scope": "文件夹范围",
    "goal-mode": "目标模式",
    "hot": "高频",
    "i18n": "多语言",
    "install-sync": "安装同步",
    "language-pref": "语言偏好",
    "layout-model": "布局模型",
    "label-noise": "标签噪声",
    "numbering": "编号",
    "overview-clutter": "概览拥挤",
    "parser": "解析",
    "process-drift": "流程漂移",
    "projection-integrity": "投影完整性",
    "roadmap-node": "路线节点",
    "roadmap-ux": "路线图体验",
    "route-risk": "路线风险",
    "skill-packaging": "skill 打包",
    "skill-trigger-risk": "skill 触发风险",
    "tag-support": "标签支持",
    "typography": "字体",
    "visual-design": "视觉设计",
}


TAG_PARTS_ZH: dict[str, str] = {
    "bad": "bad",
    "case": "case",
    "context": "context",
    "display": "展示",
    "flaky": "不稳定",
    "folder": "文件夹",
    "goal": "目标",
    "guard": "防线",
    "hot": "高频",
    "i18n": "多语言",
    "label": "标签",
    "lag": "延迟",
    "language": "语言",
    "layout": "布局",
    "link": "链接",
    "loss": "丢失",
    "mode": "模式",
    "node": "节点",
    "noise": "噪声",
    "overview": "概览",
    "packaging": "打包",
    "parser": "解析",
    "pref": "偏好",
    "projection": "投影",
    "roadmap": "路线图",
    "route": "路线",
    "risk": "风险",
    "source": "源",
    "support": "支持",
    "sync": "同步",
    "tag": "标签",
    "test": "测试",
    "trigger": "触发",
    "ux": "体验",
}


def tag_slug(tag: str) -> str:
    return tag.strip().lstrip("#").lower()


def tag_label_en(tag: str) -> str:
    return tag_slug(tag).replace("_", "-").replace("-", " ")


def tag_label_zh(tag: str) -> str:
    slug = tag_slug(tag)
    if slug in TAG_LABELS_ZH:
        return TAG_LABELS_ZH[slug]
    parts = [TAG_PARTS_ZH.get(part, part) for part in re.split(r"[-_]+", slug) if part]
    return " ".join(parts) if parts else tag_label_en(tag)


def localized_tag_label(tag: str) -> str:
    en = tag_label_en(tag)
    zh = tag_label_zh(tag)
    return (
        f'<span data-i18n-text data-en="{html.escape(en, quote=True)}" '
        f'data-zh="{html.escape(zh, quote=True)}">{html.escape(en)}</span>'
    )


def render_tags(tags: list[str], limit: int | None = None) -> str:
    if limit is not None:
        visible = tags[:limit]
        hidden = len(tags) - len(visible)
    else:
        visible = tags
        hidden = 0
    pieces = [
        f'<span class="tag {tag_class(tag)}"><span class="tag-emoji" aria-hidden="true">{html.escape(tag_emoji(tag))}</span>{localized_tag_label(tag)}</span>'
        for tag in visible
    ]
    if hidden > 0:
        pieces.append(f'<span class="tag tag-more">+{hidden}</span>')
    return "".join(pieces)


def build_case_anchor_map(cards: list[dict[str, str]]) -> dict[str, str]:
    return {card.get("title", ""): f"case-{i}" for i, card in enumerate(cards, 1)}


def node_ids_from_text(text: str) -> list[str]:
    return re.findall(r"NODE-\d{8}-\d+", text or "")


def bad_case_id(card: dict[str, str]) -> str:
    title = card.get("title", "")
    match = re.match(r"(BC-\d{8}-\d+)", title)
    return match.group(1) if match else title.split(":", 1)[0].strip()


def normalized_parent_id(value: str) -> str:
    value = strip_wrapping_backticks((value or "").strip())
    if not value or value.lower() in {"none", "n/a", "null"}:
        return ""
    match = re.search(r"NODE-\d{8}-\d+", value)
    return match.group(0) if match else value


def linked_bad_case_ids_for_node(node: dict[str, str], cards: list[dict[str, str]]) -> list[str]:
    direct = re.findall(r"BC-\d{8}-\d+", node.get("linked bad cases", ""))
    linked: list[str] = []
    for cid in direct:
        if cid not in linked:
            linked.append(cid)
    nid = node_id(node)
    for card in cards:
        cid = bad_case_id(card)
        if cid and nid and nid in card.get("roadmap nodes", "") and cid not in linked:
            linked.append(cid)
    return linked


def bad_cases_for_node(node: dict[str, str], cards: list[dict[str, str]]) -> list[dict[str, str]]:
    nid = node_id(node)
    linked = set(re.findall(r"BC-\d{8}-\d+", node.get("linked bad cases", "")))
    matched: list[dict[str, str]] = []
    for card in cards:
        card_nodes = card.get("roadmap nodes", "")
        card_id = card.get("title", "").split(":", 1)[0].strip()
        if nid and nid in card_nodes:
            matched.append(card)
        elif card_id in linked:
            matched.append(card)
    return matched


def render_route_filter(route_groups: list[tuple[str, list[tuple[int, dict[str, str]]]]]) -> str:
    buttons = []
    for i, (branch, items) in enumerate(route_groups):
        major_count = len([node for _, node in items if node_level(node) == "major"]) or len(items)
        slug = html.escape(route_slug(branch))
        pressed = "true" if i == 0 else "false"
        buttons.append(
            f'<button type="button" data-route-filter="{slug}" aria-pressed="{pressed}">'
            f'{localized_text(branch)} <span aria-hidden="true">{major_count}</span></button>'
        )
    return (
        '<div class="route-filter" aria-label="Routes">'
        '<span class="route-filter-label" data-i18n="routeFocus">Route Focus</span>'
        + "".join(buttons)
        + "</div>"
    )


def render_route_group(
    branch: str,
    items: list[tuple[int, dict[str, str]]],
    bad_case_cards: list[dict[str, str]],
    case_anchor_map: dict[str, str],
    branch_mode: bool = False,
    node_lookup: dict[str, dict[str, str]] | None = None,
    route_offset: int = 0,
    route_depth: int = 0,
    parent_node_id: str = "",
    parent_anchor_id: str = "",
) -> str:
    major_items = [(number, node) for number, node in items if node_level(node) == "major"]
    hidden_count = len(items) - len(major_items)
    display_items = display_items_for_route(items)
    route_offset = max(0, route_offset)
    route_spacers = render_route_spacers(route_offset) if branch_mode else ""
    if branch_mode:
        columns = "\n".join(
            render_route_column(
                node,
                source_number,
                display_number,
                bad_case_cards,
                case_anchor_map,
                branch_start=branch_mode and display_number == 1 and route_offset > 0,
                show_test_line=False,
            )
            for display_number, (source_number, node) in enumerate(display_items, 1)
        )
    else:
        columns = "\n".join(
            render_route_column(
                node,
                source_number,
                display_number,
                branch_start=False,
                show_test_line=False,
            )
            for display_number, (source_number, node) in enumerate(display_items, 1)
        )
    label = localized_text(branch)
    count = len(major_items) if major_items else len(items)
    parent_note = render_route_parent_note(branch, items, node_lookup or {}) if branch_mode else ""
    checkpoint_strip = ""
    if hidden_count > 0:
        checkpoint_strip = (
            f'<div class="checkpoint-strip"><span class="checkpoint-dot" aria-hidden="true"></span>'
            f'<span data-i18n="checkpointsInDetails" data-count="{hidden_count}">{hidden_count} checkpoints in details</span></div>'
        )
    label_column = """<section class="track-label-column" aria-hidden="true">
  <div class="track-label-cell"><span class="lane-label" data-i18n="mainRoute">Main Route</span></div>
  <div class="track-label-cell"><span class="lane-label" data-i18n="badCases">Bad Cases</span></div>
  <div class="track-label-cell"><span class="lane-label" data-i18n="testChain">Test Chain</span></div>
</section>"""
    label_column = ""
    grid_class = "track-grid route-only" if branch_mode else "track-grid route-only single-mainline"
    branch_class = " route-branch" if parent_note else ""
    route_head = f"""<div class="route-head">
    <span class="route-mark" aria-hidden="true"></span>
    <span class="route-title">{label}</span>
    <span class="route-pill">{count}</span>
    {parent_note}
  </div>"""
    if branch_mode:
        head_start_class = " branch-start" if route_offset > 0 and parent_note else ""
        route_anchor_attr = " data-route-anchor" if head_start_class else ""
        route_header = f"""<div class="route-head-grid {grid_class}">{route_spacers}<div class="route-head-cell{head_start_class}"{route_anchor_attr}>
  {route_head}
  {checkpoint_strip}
</div></div>"""
    else:
        route_header = f"""{route_head}
  {checkpoint_strip}"""
    route_vars = route_color_vars(route_depth)
    branch_drift = 0
    if branch_mode and parent_note:
        branch_drift = 44 + max(route_depth, 1) * 10
        route_vars = f"{route_vars} --branch-drift: {branch_drift}px;"
    offset_attrs = (
        f' data-route-offset="{route_offset}" data-route-depth="{route_depth}" style="{route_vars}"'
        if branch_mode
        else f' data-route-depth="{route_depth}" style="{route_vars}"'
    )
    if branch_mode and parent_note and parent_node_id and parent_anchor_id:
        offset_attrs = (
            f' data-route-offset="{route_offset}" data-route-depth="{route_depth}"'
            f' data-branch-drift="{branch_drift}"'
            f' data-parent-node-id="{html.escape(parent_node_id)}"'
            f' data-parent-anchor-id="{html.escape(parent_anchor_id)}"'
            f' style="{route_vars}"'
        )
    return f"""<section class="route-group{branch_class}" data-route-group="{html.escape(route_slug(branch))}"{offset_attrs}>
  {route_header}
  <div class="route-strip">
    <div class="{grid_class}">{label_column}{route_spacers}{columns}</div>
  </div>
</section>"""


def render_route_spacers(count: int) -> str:
    if count <= 0:
        return ""
    return "".join('<div class="route-spacer" aria-hidden="true"></div>' for _ in range(count))


def render_route_parent_note(
    branch: str,
    items: list[tuple[int, dict[str, str]]],
    node_lookup: dict[str, dict[str, str]],
) -> str:
    parent_id = external_parent_id(branch, items, node_lookup)
    if not parent_id:
        return ""
    parent_node = node_lookup.get(parent_id, {})
    parent_label = node_display_title(parent_node, parent_id)
    return f'<span class="route-parent" data-route-parent>{localized_text("forked from")} {localized_text(parent_label)}</span>'


def render_route_column(
    node: dict[str, str],
    source_number: int,
    display_number: int,
    bad_case_cards: list[dict[str, str]] | None = None,
    case_anchor_map: dict[str, str] | None = None,
    branch_start: bool = False,
    show_test_line: bool = False,
) -> str:
    title = localized_text(node_display_title(node, f"Node {source_number}"))
    status = node.get("status", "unknown")
    date = html.escape(node.get("date", "undated"))
    outcome = localized_short_text(node.get("outcome", "No outcome recorded."))
    branch_class = " branch-start" if branch_start else ""
    overview_id = html.escape(node_id(node))
    test_line = ""
    mainline_only_class = " no-test-line"
    step_class = " step-up" if display_number % 2 else " step-down"
    return f"""<section class="track-column route-column{branch_class}{mainline_only_class}{step_class}" data-overview-node-id="{overview_id}">
  <article class="lane lane-main" data-lane="main">
    <a class="lane-link" href="#node-{source_number}">
      <div class="node-heading">
        <div class="node-number">{display_number}</div>
        <h3>{title}</h3>
      </div>
      <div class="node-meta">
        {status_dot(status)}
        <span class="pill">{date}</span>
      </div>
      <p class="summary">{outcome}</p>
    </a>
  </article>
  {test_line}
</section>"""


def route_has_approved_tests(
    items: list[tuple[int, dict[str, str]]],
    bad_case_cards: list[dict[str, str]],
) -> bool:
    return any(approved_test_cases_for_node(node, bad_case_cards) for _, node in items)


def approved_test_cases_for_node(
    node: dict[str, str],
    bad_case_cards: list[dict[str, str]],
) -> list[dict[str, str]]:
    return [card for card in bad_cases_for_node(node, bad_case_cards) if has_approved_test_policy(card)]


def has_approved_test_policy(card: dict[str, str]) -> bool:
    policy = strip_wrapping_backticks(card.get("run policy", "")).strip().lower()
    if not policy:
        return False
    if policy in {"proposed", "pending", "disabled", "disabled-with-reason", "none", "n/a", "null"}:
        return False
    return True


def render_track_column(
    node: dict[str, str],
    source_number: int,
    display_number: int,
    bad_case_cards: list[dict[str, str]],
    case_anchor_map: dict[str, str],
) -> str:
    title = localized_text(node_display_title(node, f"Node {source_number}"))
    status = node.get("status", "unknown")
    date = html.escape(node.get("date", "undated"))
    outcome = localized_short_text(node.get("outcome", "No outcome recorded."))
    cases = bad_cases_for_node(node, bad_case_cards)
    case_items = "\n".join(render_bad_case_summary(card, case_anchor_map.get(card.get("title", ""), "case-1")) for card in cases)
    case_lane = (
        f"""<article class="lane lane-bad-cases" data-lane="bad-cases">
    {case_items}
  </article>"""
        if case_items
        else '<article class="lane lane-empty" data-lane="bad-cases" aria-hidden="true"></article>'
    )
    test_items = "\n".join(
        render_bad_case_test_note(card, case_anchor_map.get(card.get("title", ""), "case-1"))
        for card in cases
    )
    test_lane = (
        f"""<article class="lane lane-test-chain" data-lane="test-chain">
    {test_items}
  </article>"""
        if test_items
        else '<article class="lane lane-empty" data-lane="test-chain" aria-hidden="true"></article>'
    )
    return f"""<section class="track-column">
  <article class="lane lane-main" data-lane="main">
    <a class="lane-link" href="#node-{source_number}">
      <div class="node-heading">
        <div class="node-number">{display_number}</div>
        <h3>{title}</h3>
      </div>
      <div class="node-meta">
        {status_dot(status)}
        <span class="pill">{date}</span>
      </div>
      <p class="summary">{outcome}</p>
    </a>
  </article>
  {case_lane}
  {test_lane}
</section>"""


def render_node_detail(
    node: dict[str, str],
    number: int,
    bad_case_cards: list[dict[str, str]],
    case_anchor_map: dict[str, str],
) -> str:
    title = localized_text(node_display_title(node, f"Node {number}"))
    cases = bad_cases_for_node(node, bad_case_cards)
    user_problem = node.get("user request", "").strip()
    if not user_problem:
        user_problem = "No source user request recorded for this historical node."
    method_items = node_method_items(node, cases)
    progress_items = node_progress_items(node)
    case_html = render_node_case_list(cases, case_anchor_map)
    return f"""<section class="detail-card" id="node-{number}">
  <h3>{number}. {title}</h3>
  <div class="detail-grid">
    {render_node_detail_section("User question", "用户提出的问题", localized_detail_text(user_problem or "No question recorded.", 240))}
    {render_node_detail_section("Current progress", "当前进度", render_detail_item_list(progress_items, "No progress recorded.", "没有记录当前进度。"))}
    {render_node_detail_section("Bad cases to solve", "相关问题案例", case_html, wide=True)}
    {render_node_detail_section("Method", "采取方法", render_detail_item_list(method_items, "No method recorded.", "没有记录采取方法。"), wide=True)}
  </div>
</section>"""


def localized_label(en: str, zh: str) -> str:
    return (
        f'<span data-i18n-text data-en="{html.escape(en, quote=True)}" '
        f'data-zh="{html.escape(zh, quote=True)}">{html.escape(en)}</span>'
    )


def render_node_detail_section(label_en: str, label_zh: str, body: str, wide: bool = False) -> str:
    wide_class = " wide" if wide else ""
    return f"""<section class="detail-section{wide_class}">
      <h4>{localized_label(label_en, label_zh)}</h4>
      <div>{body}</div>
    </section>"""


def render_detail_item_list(items: list[str], empty_en: str, empty_zh: str, limit: int = 132) -> str:
    cleaned = [item for item in items if meaningful_bad_case_value(item)]
    if not cleaned:
        return f'<p class="muted">{localized_label(empty_en, empty_zh)}</p>'
    lines = "\n".join(f"<li>{localized_detail_text(item, limit)}</li>" for item in cleaned[:4])
    return f'<ul class="detail-list">\n{lines}\n</ul>'


def split_detail_items(text: str) -> list[str]:
    raw = human_text(text)
    parts: list[str] = []
    buf: list[str] = []
    in_code = False
    for char in raw:
        if char == "`":
            in_code = not in_code
            buf.append(char)
            continue
        if not in_code and char in {"；", ";", "。"}:
            part = "".join(buf).strip(" ：:，, ")
            if meaningful_bad_case_value(part):
                parts.append(part)
            buf = []
            continue
        buf.append(char)
    tail = "".join(buf).strip(" ：:，, ")
    if meaningful_bad_case_value(tail):
        parts.append(tail)
    return [part.strip(" ：:，, ") for part in parts if meaningful_bad_case_value(part.strip())]


def node_method_items(node: dict[str, str], cases: list[dict[str, str]]) -> list[str]:
    preferred = node.get("method summary", "").strip()
    if preferred:
        return split_detail_items(preferred)[:4]
    methods: list[str] = []
    for card in cases:
        fix = first_nonempty(card.get("fix method", ""), card.get("guard / verification", ""))
        for item in split_detail_items(fix):
            if item not in methods:
                methods.append(item)
    for value in [node.get("avoid going back", ""), node.get("decision / reason", "")]:
        for item in split_detail_items(value):
            if item not in methods:
                methods.append(item)
    return methods[:4]


def node_progress_items(node: dict[str, str]) -> list[str]:
    preferred = node.get("progress summary", "").strip()
    if preferred:
        return split_detail_items(preferred)[:4]
    parts = []
    for value in [node.get("outcome", ""), node.get("next", "")]:
        for item in split_detail_items(value):
            if item not in parts:
                parts.append(item)
    return parts[:4]


def render_node_case_list(cases: list[dict[str, str]], case_anchor_map: dict[str, str]) -> str:
    if not cases:
        return f'<p class="muted">{localized_label("No linked bad cases.", "没有关联问题案例。")}</p>'
    items = []
    for card in cases:
        title = localized_text(human_title(card.get("title", "Bad case")))
        summary_raw = first_nonempty(
            card.get("display summary", ""),
            card.get("phenomenon", ""),
            card.get("root cause", ""),
            card.get("fix method", ""),
        )
        summary = localized_short_text(summary_raw or "No summary recorded.", 180)
        tags = render_tags(parse_tags(card.get("tags", "")), limit=3)
        items.append(
            f"""<article class="node-case">
        <p class="node-case-title">{title}</p>
        <p>{summary}</p>
        {f'<div class="tags">{tags}</div>' if tags else ''}
      </article>"""
        )
    return "\n".join(items)


def parse_bad_case_cards(text: str) -> list[dict[str, str]]:
    cards: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for line in text.splitlines():
        if line.startswith("### "):
            if current:
                cards.append(current)
            current = {"title": line[4:].strip()}
            continue
        if current is None:
            continue
        stripped = line.strip()
        if stripped.startswith("- ") and ":" in stripped:
            key, value = stripped[2:].split(":", 1)
            normalized_key = canonical_bad_case_key(key)
            if normalized_key in {"id", "title"}:
                continue
            current[normalized_key] = value.strip()
    if current:
        cards.append(current)
    if cards:
        return cards
    return parse_loose_bad_case_cards(text)


def canonical_bad_case_key(key: str) -> str:
    normalized = key.strip().lower().replace("_", " ")
    aliases = {
        "id": "id",
        "case id": "id",
        "bad case id": "id",
        "bc": "id",
        "title": "title",
        "name": "title",
        "status": "status",
        "first observed": "first observed",
        "last checked": "last checked",
        "scope": "scope",
        "context task": "context task",
        "task": "context task",
        "roadmap nodes": "roadmap nodes",
        "nodes": "roadmap nodes",
        "linked nodes": "roadmap nodes",
        "node": "roadmap nodes",
        "tags": "tags",
        "frequency": "frequency",
        "display summary": "display summary",
        "human summary": "display summary",
        "case summary": "display summary",
        "summary": "display summary",
        "phenomenon": "phenomenon",
        "trigger": "trigger / reproduction",
        "reproduction": "trigger / reproduction",
        "trigger / reproduction": "trigger / reproduction",
        "root cause": "root cause",
        "cause": "root cause",
        "fix": "fix method",
        "fix method": "fix method",
        "guard type": "guard type",
        "guard kind": "guard type",
        "guard category": "guard type",
        "guard": "guard / verification",
        "guard / verification": "guard / verification",
        "verification": "guard / verification",
        "red condition": "red condition",
        "red signal": "red condition",
        "red-capable signal": "red condition",
        "green condition": "green condition",
        "green signal": "green condition",
        "expected failure reason": "expected failure reason",
        "failure reason": "expected failure reason",
        "expected red reason": "expected failure reason",
        "reusable guard path": "reusable guard path",
        "guard reuse rule": "guard reuse rule",
        "test chain": "test chain",
        "tests": "test chain",
        "high-frequency note": "high-frequency note",
        "recurrence analysis": "recurrence analysis",
        "evidence": "evidence",
        "状态": "status",
        "标题": "title",
        "名称": "title",
        "标签": "tags",
        "范围": "scope",
        "作用域": "scope",
        "现象": "phenomenon",
        "问题": "phenomenon",
        "触发": "trigger / reproduction",
        "复现": "trigger / reproduction",
        "根因": "root cause",
        "原因": "root cause",
        "修复": "fix method",
        "解决": "fix method",
        "方法": "fix method",
        "验证": "guard / verification",
        "防护": "guard / verification",
        "测试链路": "test chain",
        "测试": "test chain",
        "红线": "red condition",
        "绿线": "green condition",
    }
    return aliases.get(normalized, normalized)


def split_loose_bad_case_field(body: str) -> tuple[str, str] | None:
    body = body.replace("：", ":", 1)
    if ":" not in body:
        return None
    key, value = body.split(":", 1)
    key = canonical_bad_case_key(key)
    if key not in {
        "id",
        "title",
        "status",
        "first observed",
        "last checked",
        "scope",
        "context task",
        "roadmap nodes",
        "tags",
        "frequency",
        "display summary",
        "phenomenon",
        "trigger / reproduction",
        "root cause",
        "fix method",
        "guard type",
        "guard / verification",
        "red condition",
        "green condition",
        "expected failure reason",
        "reusable guard path",
        "guard reuse rule",
        "test chain",
        "high-frequency note",
        "recurrence analysis",
        "evidence",
    }:
        return None
    return key, value.strip()


def parse_loose_bad_case_inline_fields(body: str) -> tuple[str, dict[str, str]]:
    title_parts: list[str] = []
    fields: dict[str, str] = {}
    for segment in [part.strip() for part in body.split("|") if part.strip()]:
        field = split_loose_bad_case_field(segment)
        if field:
            key, value = field
            fields[key] = value
            continue
        if segment:
            title_parts.append(segment.strip(" -:："))
    return " ".join(part for part in title_parts if part).strip(), fields


def loose_bad_case_title(card: dict[str, str]) -> str:
    title = card.get("title", "").strip()
    identifier = card.pop("id", "").strip()
    if not title:
        title = first_nonempty(
            card.get("display summary", ""),
            card.get("phenomenon", ""),
            card.get("root cause", ""),
            card.get("fix method", ""),
        )
    if not title:
        title = identifier or "Untitled bad case"
    elif identifier and not title.startswith(identifier):
        title = f"{identifier}: {title}"
    return title


def commit_loose_bad_case(cards: list[dict[str, str]], current: dict[str, str] | None) -> None:
    if not current:
        return
    if "title" not in current and "id" not in current:
        return
    current["title"] = loose_bad_case_title(current)
    cards.append(current)


def parse_loose_bad_case_cards(text: str) -> list[dict[str, str]]:
    cards: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        body = ""
        if stripped.startswith("- "):
            body = stripped[2:].strip()
        elif current and re.match(r"^[\w\u4e00-\u9fff][\w\u4e00-\u9fff _/-]+[:：]\s+", stripped):
            body = stripped
        else:
            continue

        case_line = re.match(r"^(BC-\d{8}-\d+)\s*(?::|：|\|)\s*(.*)$", body)
        if case_line:
            commit_loose_bad_case(cards, current)
            trailing_title, fields = parse_loose_bad_case_inline_fields(case_line.group(2).strip())
            current = {"id": case_line.group(1), **fields}
            if trailing_title and "title" not in current:
                current["title"] = trailing_title
            continue

        field = split_loose_bad_case_field(body)
        if not field:
            continue
        key, value = field
        if key == "id" and re.search(r"BC-\d{8}-\d+", value):
            commit_loose_bad_case(cards, current)
            current = {"id": re.search(r"BC-\d{8}-\d+", value).group(0)}
            trailing = value.replace(current["id"], "", 1).strip(" -:")
            if trailing:
                current["title"] = trailing
            continue
        if current is None:
            current = {}
        current[key] = value
    commit_loose_bad_case(cards, current)
    return cards


def render_bad_case_summary(card: dict[str, str], anchor: str) -> str:
    title = localized_text(human_title(card.get("title", "Bad case")))
    status = card.get("status", "unknown")
    frequency = card.get("frequency", "")
    tags = parse_tags(card.get("tags", ""))
    tag_html = render_tags(tags, limit=3)
    markers = f"{status_dot(status)}{frequency_dot(frequency)}"
    return f"""<article class="badcase">
  <div class="badcase-head"><a class="detail-link" href="#{html.escape(anchor)}">{title}</a><span class="badcase-markers" aria-hidden="true">{markers}</span></div>
  {f'<div class="tags">{tag_html}</div>' if tag_html else ''}
</article>"""


def render_bad_case_test_note(card: dict[str, str], anchor: str) -> str:
    title = localized_short_text(human_title(card.get("title", "Bad case")), 58)
    guard = first_nonempty(
        card.get("guard / verification", ""),
        card.get("guard", ""),
        card.get("green condition", ""),
        card.get("red condition", ""),
        card.get("trigger / reproduction", ""),
        card.get("trigger", ""),
        card.get("phenomenon", ""),
    )
    guard_text = localized_short_text(guard or "No guard recorded.", 110)
    reusable = card.get("reusable guard path", "").strip()
    reusable_html = ""
    if reusable and reusable.lower() not in {"none", "n/a", "null"}:
        reusable_html = f"<p><code>{html.escape(strip_wrapping_backticks(reusable))}</code></p>"
    return f"""<article class="test-note">
  <a class="detail-link" href="#{html.escape(anchor)}">{title}</a>
  <p>{guard_text}</p>
  {reusable_html}
</article>"""


def render_route_test_note(card: dict[str, str], anchor: str) -> str:
    title = localized_short_text(human_title(card.get("title", "Test")), 38)
    guard = first_nonempty(
        card.get("guard / verification", ""),
        card.get("green condition", ""),
        card.get("red condition", ""),
        card.get("trigger / reproduction", ""),
    )
    guard_text = localized_short_text(guard or "No guard recorded.", 64)
    return f"""<a class="route-test-note" href="#{html.escape(anchor)}">
    <span>{title}</span>
    <small>{guard_text}</small>
  </a>"""


def first_nonempty(*values: str) -> str:
    for value in values:
        if value and value.strip():
            return value.strip()
    return ""


def strip_wrapping_backticks(value: str) -> str:
    value = value.strip()
    if value.startswith("`") and value.endswith("`") and len(value) >= 2:
        return value[1:-1]
    return value


def render_case_detail(card: dict[str, str], anchor: str) -> str:
    title = localized_text(human_title(card.get("title", "Bad case")))
    summary_raw = first_nonempty(
        human_text(card.get("phenomenon", "")),
        human_text(card.get("root cause", "")),
        human_text(card.get("fix method", "")),
        human_text(card.get("title", "")),
    )
    summary = localized_short_text(summary_raw or "No summary recorded.", 150)
    tags = parse_tags(card.get("tags", ""))
    tag_html = render_tags(tags)
    return f"""<section class="detail-card" id="{html.escape(anchor)}">
  <h3>{title}</h3>
  <p class="field"><b data-i18n="summary">Summary:</b> {summary}</p>
  {f'<div class="tags">{tag_html}</div>' if tag_html else ''}
</section>"""


def meaningful_bad_case_value(value: str | None) -> bool:
    if value is None:
        return False
    normalized = strip_wrapping_backticks(value).strip().lower()
    if not normalized:
        return False
    return normalized not in {"none", "n/a", "na", "null", "unknown", "unset", "tbd", "todo", "待定", "无", "未知"}


def bad_case_status(card: dict[str, str]) -> str:
    return card.get("status", "").strip().lower().replace("_", "-")


def is_recently_checked(card: dict[str, str]) -> bool:
    today = datetime.now().strftime("%Y-%m-%d")
    return card.get("last checked", "").strip() == today


def validate_bad_case_guards(root: Path, strict: bool = False, verbose: bool = False) -> int:
    ctx = context_dir(root)
    path = ctx / "bad-cases.md"
    if not path.exists():
        print(f"[context-guard] no bad-case register found: {path}")
        return 0

    cards = parse_bad_case_cards(path.read_text(encoding="utf-8"))
    if not cards:
        print("[context-guard] no bad cases recorded.")
        return 0

    required_for_resolved = [
        "guard type",
        "guard / verification",
        "red condition",
        "green condition",
        "expected failure reason",
    ]
    errors: list[str] = []
    warnings: list[str] = []
    for index, card in enumerate(cards, 1):
        title = human_title(card.get("title", f"bad case {index}"))
        status = bad_case_status(card)
        if status in {"resolved", "recurred"}:
            missing = [field for field in required_for_resolved if not meaningful_bad_case_value(card.get(field))]
            if missing:
                message = f"{title}: missing {', '.join(missing)}"
                if strict or status == "recurred":
                    errors.append(message)
                elif is_recently_checked(card):
                    warnings.append(f"newly checked resolved case {message}")
                else:
                    warnings.append(f"legacy resolved case {message}")
        elif status in {"open", "deferred"}:
            for field in ["phenomenon", "trigger / reproduction"]:
                if not meaningful_bad_case_value(card.get(field)):
                    warnings.append(f"{title}: {status} case has no {field}")
        if "high-frequency" in card.get("frequency", "").lower() and not meaningful_bad_case_value(card.get("high-frequency note")):
            warnings.append(f"{title}: high-frequency case has no high-frequency note")

    shown_warnings = warnings if verbose else warnings[:8]
    for warning in shown_warnings:
        print(f"[context-guard] warning: {warning}")
    if len(warnings) > len(shown_warnings):
        print(f"[context-guard] warning: {len(warnings) - len(shown_warnings)} more warning(s); rerun with --verbose to show all.")
    if errors:
        print("[context-guard] bad-case guard validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    mode = "strict" if strict else "default"
    print(f"[context-guard] bad-case guard validation passed ({mode}): {len(cards)} case(s) checked.")
    return 0


def trailing_checkpoint_count(items: list[tuple[int, dict[str, str]]]) -> int:
    count = 0
    for _, node in reversed(items):
        if node_level(node) == "major":
            break
        count += 1
    return count


def validate_roadmap_maintenance(root: Path, max_hidden_checkpoints: int = 8) -> int:
    ctx = context_dir(root)
    roadmap_path = ctx / "roadmap.md"
    if not roadmap_path.exists():
        print(f"[context-guard] no roadmap found: {roadmap_path}")
        return 0

    nodes = parse_roadmap_nodes(roadmap_path.read_text(encoding="utf-8"))
    if not nodes:
        print("[context-guard] no roadmap nodes recorded.")
        return 0

    errors: list[str] = []
    warnings: list[str] = []
    for branch, items in group_nodes_by_branch(nodes):
        major_count = len([node for _, node in items if node_level(node) == "major"])
        trailing = trailing_checkpoint_count(items)
        if major_count == 0:
            errors.append(f"{branch}: no visible major node")
        if trailing > max_hidden_checkpoints:
            errors.append(
                f"{branch}: {trailing} checkpoint(s) after the latest visible node; promote or add a major route node"
            )
        elif trailing > 0:
            warnings.append(f"{branch}: {trailing} checkpoint(s) after latest visible node")

    latest = nodes[-1]
    if node_level(latest) == "checkpoint":
        warnings.append(f"latest node is hidden in overview: {human_title(latest.get('title', 'Untitled roadmap node'))}")

    for warning in warnings[:8]:
        print(f"[context-guard] warning: {warning}")
    if len(warnings) > 8:
        print(f"[context-guard] warning: {len(warnings) - 8} more warning(s).")
    if errors:
        print("[context-guard] roadmap maintenance validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"[context-guard] roadmap maintenance validation passed: {len(nodes)} node(s), {len(group_nodes_by_branch(nodes))} route(s).")
    return 0


def extract_section(text: str, heading: str) -> str:
    lines = text.splitlines()
    try:
        start = lines.index(heading) + 1
    except ValueError:
        return "No quick scan section."
    collected: list[str] = []
    for line in lines[start:]:
        if line.startswith("## "):
            break
        collected.append(line)
    return "\n".join(collected).strip() or "No quick scan entries."


def extract_bad_case_scan(text: str) -> str:
    interesting: list[str] = []
    for line in text.splitlines():
        lower = line.lower()
        if line.startswith("### ") or "tags:" in lower or "frequency:" in lower or "roadmap nodes:" in lower:
            interesting.append(line)
    return "\n".join(interesting).strip() or "No bad-case links recorded."


def ascii_slug(value: str, fallback: str = "branch") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or fallback


def next_task_id(ctx: Path, title: str, branch: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d")
    base = f"CTX-{stamp}-{ascii_slug(branch or title)}"
    task_root = ctx / "tasks"
    candidate = base
    suffix = 2
    while (task_root / candidate).exists():
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


def next_roadmap_node_id(roadmap: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d")
    numbers = [int(value) for value in re.findall(rf"NODE-{stamp}-(\d+)", roadmap)]
    return f"NODE-{stamp}-{(max(numbers) if numbers else 0) + 1:03d}"


def parse_current_index_entry(index: str) -> dict[str, str]:
    entry: dict[str, str] = {}
    match = re.search(r"(?ms)^## Current\s*\n\n(.*?)(?=\n## |\Z)", index)
    block = match.group(1).strip() if match else ""
    for line in block.splitlines():
        stripped = line.strip()
        if not stripped.startswith("- ") or ":" not in stripped:
            continue
        key, value = stripped[2:].split(":", 1)
        entry[key.strip().lower()] = value.strip()
    quick_current = re.search(r"(?m)^- Current:\s*(.+)$", index)
    if quick_current and "id" not in entry:
        entry["id"] = quick_current.group(1).strip()
    return entry


def rewrite_quick_scan(index: str, task_id: str, node_id_value: str, resume_id: str) -> str:
    replacements = {
        "Current": task_id,
        "Latest roadmap node": node_id_value,
        "Resume candidate": resume_id or "none",
    }
    for label, value in replacements.items():
        pattern = rf"(?m)^- {re.escape(label)}:\s*.*$"
        line = f"- {label}: {value}"
        if re.search(pattern, index):
            index = re.sub(pattern, line, index)
        else:
            index = index.replace("## Quick Scan\n\n", f"## Quick Scan\n\n{line}\n", 1)
    return index


def render_current_index_block(task_id: str, title: str, task_folder: str, branch: str, parent_node: str, zh: bool) -> str:
    today = datetime.now().strftime("%Y-%m-%d")
    if zh:
        summary = f"支线任务已创建，路线为“{branch}”，父节点为 {parent_node or 'none'}。"
        next_step = "在该支线内继续推进，并把相关 bad case 与测试链路链接到后续节点。"
    else:
        summary = f"Branch task created for {branch}; parent node is {parent_node or 'none'}."
        next_step = "Continue inside this branch and link related bad cases and recurrence checks to later nodes."
    return "\n".join(
        [
            f"- ID: {task_id}",
            f"- Title: {title}",
            "- State: current",
            f"- Folder: `{task_folder}`",
            f"- Last updated: {today}",
            f"- Summary: {summary}",
            f"- Next step: {next_step}",
        ]
    )


def render_parked_index_entry(previous: dict[str, str], zh: bool) -> str:
    previous_id = previous.get("id", "").strip()
    if not previous_id or previous_id.lower() in {"none", "none yet."}:
        return ""
    today = datetime.now().strftime("%Y-%m-%d")
    title = previous.get("title", previous_id)
    folder = previous.get("folder", f"`.codex/context/tasks/{previous_id}/`")
    if zh:
        parked = "因为用户显式创建支线任务，原当前任务暂存为可恢复任务。"
        prompt = f"是否回到“{title}”？"
    else:
        parked = "Parked because the user explicitly created a branch task."
        prompt = f"Resume {title}?"
    return "\n".join(
        [
            f"### {previous_id}",
            "",
            f"- Title: {title}",
            "- State: resume-candidate",
            f"- Folder: {folder}",
            f"- Parked because: {parked}",
            f"- Resume prompt: {prompt}",
            f"- Last updated: {today}",
        ]
    )


def update_index_for_branch_task(
    ctx: Path,
    task_id: str,
    title: str,
    branch: str,
    parent_node: str,
    node_id_value: str,
) -> tuple[str, str]:
    index_path = ctx / "index.md"
    index = index_path.read_text(encoding="utf-8")
    previous = parse_current_index_entry(index)
    previous_id = previous.get("id", "").strip()
    zh = preferred_display_language(ctx) == "zh"
    task_folder = f".codex/context/tasks/{task_id}/"
    current_block = render_current_index_block(task_id, title, task_folder, branch, parent_node, zh)
    index = rewrite_quick_scan(index, task_id, node_id_value, previous_id)
    index = re.sub(r"(?ms)(^## Current\s*\n\n).*?(?=\n## |\Z)", rf"\1{current_block}\n", index, count=1)
    parked_entry = render_parked_index_entry(previous, zh)
    if parked_entry and previous_id not in extract_section(index, "## Parked / Resume Candidates"):
        parked_match = re.search(r"(?ms)(^## Parked / Resume Candidates\s*\n\n)(.*?)(?=\n## |\Z)", index)
        if parked_match:
            body = parked_match.group(2).strip()
            body = "" if body == "None." else body
            new_body = f"{parked_entry}\n\n{body}".strip()
            index = index[: parked_match.start(2)] + new_body + "\n" + index[parked_match.end(2) :]
    index_path.write_text(index, encoding="utf-8")
    return previous_id, task_folder


def write_branch_task_context(
    ctx: Path,
    task_id: str,
    title: str,
    branch: str,
    parent_node: str,
    parent_task: str,
) -> Path:
    zh = preferred_display_language(ctx) == "zh"
    today = datetime.now().strftime("%Y-%m-%d")
    task_dir = ctx / "tasks" / task_id
    task_dir.mkdir(parents=True, exist_ok=True)
    if zh:
        content = f"""# {title}

- State: current
- Branch: {branch}
- Parent task: {parent_task or 'none'}
- Parent roadmap node: {parent_node or 'none'}
- Last updated: {today}

## Objective

维护这条支线的关键进展、相关 bad case 和复现检查，避免把支线内容混回主线。

## Key Context

- 用户显式要求创建或处理支线任务。
- 后续路线节点需要继续使用 `Branch: {branch}`。
- 如果该支线产生 bad case，必须把 bad case 链接到对应路线节点。

## Next Step

继续推进支线，并在完成前运行相关 bad-case guard。
"""
    else:
        content = f"""# {title}

- State: current
- Branch: {branch}
- Parent task: {parent_task or 'none'}
- Parent roadmap node: {parent_node or 'none'}
- Last updated: {today}

## Objective

Maintain this branch route's key progress, related bad cases, and recurrence checks without mixing it back into the mainline.

## Key Context

- The user explicitly requested a branch or side route.
- Later roadmap nodes should keep using `Branch: {branch}`.
- Branch bad cases must link back to their roadmap nodes.

## Next Step

Continue the branch and run relevant bad-case guards before completion.
"""
    path = task_dir / "context.md"
    path.write_text(content, encoding="utf-8")
    return path


def append_branch_roadmap_node(
    ctx: Path,
    task_id: str,
    title: str,
    branch: str,
    parent_node: str,
) -> str:
    roadmap_path = ctx / "roadmap.md"
    roadmap = roadmap_path.read_text(encoding="utf-8")
    node_id_value = next_roadmap_node_id(roadmap)
    today = datetime.now().strftime("%Y-%m-%d")
    zh = preferred_display_language(ctx) == "zh"
    if zh:
        outcome = f"创建“{branch}”支线任务，后续进展与风险独立记录。"
        decision = "用户显式说明这是支线，不能继续混入当前主线。"
        avoid = "不要只写 hook 提醒而不创建支线任务文件夹和路线节点。"
        next_step = "在该支线内推进，并把相关 bad case 与测试链路链接到节点。"
        test_chain = "运行支线任务创建 guard，确认 index、task 文件夹、Branch/Parent 节点和 roadmap 导出打通。"
    else:
        outcome = f"Created the {branch} branch task so later progress and risks stay separate."
        decision = "The user explicitly marked the work as a branch, so it must not continue as mainline-only context."
        avoid = "Do not only print hook reminders without creating the task folder and route node."
        next_step = "Continue inside this branch and link related bad cases and recurrence checks."
        test_chain = "Run the branch task guard to verify index, task folder, Branch/Parent node, and roadmap export."
    node = f"""
### {node_id_value}: {title}

- Date: {today}
- Status: active
- Level: major
- Branch: {branch}
- Parent: {parent_node or 'none'}
- Task: `{task_id}`
- Display title: {title}
- User request: {title}
- Outcome: {outcome}
- Decision / reason: {decision}
- Avoid going back: {avoid}
- Next: {next_step}
- Linked bad cases: none
- Test chain: {test_chain}
"""
    roadmap = roadmap.replace("\nNo nodes yet.\n", "\n", 1)
    roadmap = roadmap.rstrip() + "\n" + node
    roadmap_path.write_text(roadmap, encoding="utf-8")
    return node_id_value


def quick_scan_value(index: str, label: str, fallback: str = "none") -> str:
    match = re.search(rf"(?m)^- {re.escape(label)}:\s*(.+)$", index)
    return match.group(1).strip() if match else fallback


def strip_markdown_path(value: str) -> str:
    return value.strip().strip("`")


def infer_current_branch(ctx: Path, explicit_branch: str | None) -> str:
    if explicit_branch and explicit_branch.strip():
        return explicit_branch.strip()
    index = (ctx / "index.md").read_text(encoding="utf-8")
    current = parse_current_index_entry(index)
    folder = strip_markdown_path(current.get("folder", ""))
    if folder:
        task_context = ctx.parent.parent / folder / "context.md" if folder.startswith(".codex/") else Path(folder) / "context.md"
        if task_context.exists():
            match = re.search(r"(?m)^- Branch:\s*(.+)$", task_context.read_text(encoding="utf-8"))
            if match and match.group(1).strip():
                return match.group(1).strip()
    return "Main"


def update_current_index_checkpoint(ctx: Path, node_id_value: str, outcome: str, next_step: str) -> None:
    index_path = ctx / "index.md"
    index = index_path.read_text(encoding="utf-8")
    current_id = parse_current_index_entry(index).get("id", quick_scan_value(index, "Current"))
    resume_id = quick_scan_value(index, "Resume candidate")
    index = rewrite_quick_scan(index, current_id or "none", node_id_value, resume_id)
    match = re.search(r"(?ms)^## Current\s*\n\n(.*?)(?=\n## |\Z)", index)
    if match:
        today = datetime.now().strftime("%Y-%m-%d")
        block = match.group(1).strip()
        lines = block.splitlines() if block else []
        fields = {
            "Last updated": today,
            "Summary": outcome,
            "Next step": next_step,
        }
        seen: set[str] = set()
        rewritten: list[str] = []
        for line in lines:
            stripped = line.strip()
            replaced = False
            for label, value in fields.items():
                if stripped.startswith(f"- {label}:"):
                    rewritten.append(f"- {label}: {value}")
                    seen.add(label)
                    replaced = True
                    break
            if not replaced:
                rewritten.append(line)
        for label, value in fields.items():
            if value and label not in seen:
                rewritten.append(f"- {label}: {value}")
        new_block = "\n".join(rewritten).strip()
        index = index[: match.start(1)] + new_block + "\n" + index[match.end(1) :]
    index_path.write_text(index, encoding="utf-8")


def append_checkpoint_roadmap_node(
    ctx: Path,
    title: str,
    branch: str,
    level: str,
    outcome: str,
    display_title: str = "",
    user_request: str = "",
    progress_summary: str = "",
    method_summary: str = "",
    decision: str = "",
    avoid: str = "",
    next_step: str = "",
    linked_bad_cases: str = "",
    test_chain: str = "",
    parent_node: str = "",
) -> str:
    if not title.strip():
        raise ValueError("checkpoint-roadmap-node requires a non-empty --title")
    if level not in {"major", "checkpoint"}:
        raise ValueError("--level must be major or checkpoint")
    roadmap_path = ctx / "roadmap.md"
    roadmap = roadmap_path.read_text(encoding="utf-8")
    node_id_value = next_roadmap_node_id(roadmap)
    today = datetime.now().strftime("%Y-%m-%d")
    index = (ctx / "index.md").read_text(encoding="utf-8")
    task_id = parse_current_index_entry(index).get("id", quick_scan_value(index, "Current"))
    zh = preferred_display_language(ctx) == "zh"
    default_next = "继续维护相关路线、bad case 和测试链路。" if zh else "Keep the route, bad cases, and recurrence checks updated."
    outcome = outcome.strip() or ("完成一次路线维护 checkpoint。" if zh else "Recorded a route checkpoint.")
    next_step = next_step.strip() or default_next
    lines = [
        f"### {node_id_value}: {title.strip()}",
        "",
        f"- Date: {today}",
        "- Status: done",
        f"- Level: {level}",
        f"- Branch: {branch.strip() or 'Main'}",
    ]
    if parent_node.strip():
        lines.append(f"- Parent: {parent_node.strip()}")
    if task_id and task_id.lower() not in {"none", "none yet."}:
        lines.append(f"- Task: `{task_id}`")
    if display_title.strip():
        lines.append(f"- Display title: {display_title.strip()}")
    if user_request.strip():
        lines.append(f"- User request: {user_request.strip()}")
    if progress_summary.strip():
        lines.append(f"- Progress summary: {progress_summary.strip()}")
    if method_summary.strip():
        lines.append(f"- Method summary: {method_summary.strip()}")
    lines.append(f"- Outcome: {outcome}")
    if decision.strip():
        lines.append(f"- Decision / reason: {decision.strip()}")
    if avoid.strip():
        lines.append(f"- Avoid going back: {avoid.strip()}")
    lines.append(f"- Next: {next_step}")
    lines.append(f"- Linked bad cases: {linked_bad_cases.strip() or 'none'}")
    if test_chain.strip():
        lines.append(f"- Test chain: {test_chain.strip()}")
    node = "\n".join(lines) + "\n"
    roadmap = roadmap.replace("\nNo nodes yet.\n", "\n", 1)
    roadmap = roadmap.rstrip() + "\n\n" + node
    roadmap_path.write_text(roadmap, encoding="utf-8")
    update_current_index_checkpoint(ctx, node_id_value, outcome, next_step)
    return node_id_value


def checkpoint_roadmap_node(
    root: Path,
    title: str,
    branch: str | None,
    level: str,
    outcome: str,
    display_title: str = "",
    user_request: str = "",
    progress_summary: str = "",
    method_summary: str = "",
    decision: str = "",
    avoid: str = "",
    next_step: str = "",
    linked_bad_cases: str = "",
    test_chain: str = "",
    parent_node: str = "",
) -> str:
    init_context(root)
    ctx = context_dir(root)
    route = infer_current_branch(ctx, branch)
    node_id_value = append_checkpoint_roadmap_node(
        ctx,
        title=title,
        branch=route,
        level=level,
        outcome=outcome,
        display_title=display_title,
        user_request=user_request,
        progress_summary=progress_summary,
        method_summary=method_summary,
        decision=decision,
        avoid=avoid,
        next_step=next_step,
        linked_bad_cases=linked_bad_cases,
        test_chain=test_chain,
        parent_node=parent_node,
    )
    export_roadmap(root, "html")
    print(f"[context-guard] roadmap node: {node_id_value}")
    print(f"[context-guard] route: {route}")
    return node_id_value


APPROVED_TEST_STATUSES = {"approved", "active", "stable"}
RUN_ALWAYS_POLICY = "every-dev-completion"
FEATURE_CHAIN_COVERAGE_SUGGESTION_MIN_SCORE = 12
FEATURE_CHAIN_MATCH_EVIDENCE_STOP_TERMS = {
    "bad",
    "case",
    "bc",
    "status",
    "resolved",
    "context",
    "guard",
    "feature",
    "feature-chain",
    "chain",
    "test",
    "tests",
    "local",
    "manual",
    "command",
    "用户",
    "没有",
    "为空",
}
BLOCKER_PATTERNS = [
    "MISSING_CREDENTIAL",
    "PERMISSION_DENIED",
    "SERVICE_UNAVAILABLE",
    "NETWORK_UNAVAILABLE",
    "RESOURCE_UNAVAILABLE",
    "USER_CONFIRMATION_REQUIRED",
    "DESTRUCTIVE_CONFIRMATION_REQUIRED",
]
CHECKPOINT_MARKER_RE = re.compile(r"^CG_CHECKPOINT:(?P<name>[^:]+):(?P<status>PASS|FAIL)(?::(?P<reason>.*))?$")


def normalize_test_slug(value: str) -> str:
    slug = re.sub(r"[^\w.-]+", "-", value.strip().lower(), flags=re.UNICODE).strip("-_.")
    return slug or "test"


def test_registry_path(ctx: Path) -> Path:
    return ctx / "test-hub" / "registry.json"


def feature_chains_path(ctx: Path) -> Path:
    return ctx / "test-hub" / "feature-chains.json"


def feature_chain_auto_state_path(ctx: Path) -> Path:
    return ctx / "test-hub" / "feature-chain-auto-state.json"


def default_test_registry() -> dict[str, object]:
    return {
        "version": 1,
        "description": "Human-approved Context Guard test registry. Codex runs approved every-dev-completion tests through dev-complete.",
        "tests": [],
    }


def load_test_registry(ctx: Path) -> dict[str, object]:
    path = test_registry_path(ctx)
    if not path.exists():
        return default_test_registry()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"[context-guard] invalid test registry JSON: {path}", file=sys.stderr)
        return default_test_registry()
    if not isinstance(data, dict):
        return default_test_registry()
    tests = data.get("tests")
    if not isinstance(tests, list):
        data["tests"] = []
    data.setdefault("version", 1)
    return data


def write_test_registry(ctx: Path, registry: dict[str, object]) -> Path:
    path = test_registry_path(ctx)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def next_test_id(ctx: Path, title: str) -> str:
    today = datetime.now().strftime("%Y%m%d")
    registry = load_test_registry(ctx)
    existing = " ".join(
        str(test.get("id", "")) for test in registry.get("tests", []) if isinstance(test, dict)
    )
    numbers = [int(match.group(1)) for match in re.finditer(rf"TC-{today}-(\d+)", existing)]
    return f"TC-{today}-{(max(numbers) + 1 if numbers else 1):03d}-{normalize_test_slug(title)[:36]}"


def default_feature_chain_registry() -> dict[str, object]:
    return {
        "version": 1,
        "description": "Feature-oriented test chains. One chain should cover a real workflow and multiple linked bad-case recurrence checks.",
        "chains": [],
    }


def load_feature_chains(ctx: Path) -> dict[str, object]:
    path = feature_chains_path(ctx)
    if not path.exists():
        return default_feature_chain_registry()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"[context-guard] invalid feature-chain JSON: {path}", file=sys.stderr)
        return default_feature_chain_registry()
    if not isinstance(data, dict):
        return default_feature_chain_registry()
    chains = data.get("chains")
    if not isinstance(chains, list):
        data["chains"] = []
    data.setdefault("version", 1)
    data.setdefault("description", default_feature_chain_registry()["description"])
    return data


def write_feature_chains(ctx: Path, registry: dict[str, object]) -> Path:
    path = feature_chains_path(ctx)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def next_feature_chain_id(ctx: Path) -> str:
    today = datetime.now().strftime("%Y%m%d")
    registry = load_feature_chains(ctx)
    existing = " ".join(
        str(chain.get("id", "")) for chain in registry.get("chains", []) if isinstance(chain, dict)
    )
    numbers = [int(match.group(1)) for match in re.finditer(rf"FC-{today}-(\d+)", existing)]
    return f"FC-{today}-{(max(numbers) + 1 if numbers else 1):03d}"


def next_bad_case_id(ctx: Path) -> str:
    today = datetime.now().strftime("%Y%m%d")
    path = ctx / "bad-cases.md"
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    numbers = [int(match.group(1)) for match in re.finditer(rf"BC-{today}-(\d+)", text)]
    return f"BC-{today}-{(max(numbers) + 1 if numbers else 1):03d}"


def feature_chain_find(
    ctx: Path, chain_id: str
) -> tuple[dict[str, object], list[dict[str, object]], dict[str, object]]:
    registry = load_feature_chains(ctx)
    chains = registry.setdefault("chains", [])
    if not isinstance(chains, list):
        chains = []
        registry["chains"] = chains
    matches = [item for item in chains if isinstance(item, dict) and str(item.get("id", "")) == chain_id]
    if not matches:
        raise ValueError(f"feature chain not found: {chain_id}")
    return matches[0], chains, registry


def feature_chain_add(
    root: Path,
    title: str,
    entry: str,
    exit_check: str,
    command_text: str = "",
    run_policy: str = RUN_ALWAYS_POLICY,
    status: str = "proposed",
    timeout_seconds: int = 300,
    artifact_policy: str = "cleanup-on-pass",
    resource: str = "local",
) -> Path:
    init_context(root)
    ctx = context_dir(root)
    if not title.strip():
        raise ValueError("feature-chain-add requires --title")
    if not entry.strip():
        raise ValueError("feature-chain-add requires --entry")
    if not exit_check.strip():
        raise ValueError("feature-chain-add requires --exit-check")
    normalized_status = (status.strip() or "proposed").lower()
    normalized_policy = run_policy.strip() or RUN_ALWAYS_POLICY
    if normalized_status in APPROVED_TEST_STATUSES and normalized_policy == RUN_ALWAYS_POLICY:
        raise ValueError(
            "feature-chain-add cannot create approved every-dev-completion chains; "
            "create a proposed chain and use feature-chain-approve so the user confirmation "
            "and approval dry-run gates cannot be skipped"
        )
    registry = load_feature_chains(ctx)
    chains = registry.setdefault("chains", [])
    if not isinstance(chains, list):
        chains = []
        registry["chains"] = chains
    chain_id = next_feature_chain_id(ctx)
    now = datetime.now().isoformat(timespec="seconds")
    chains.append(
        {
            "id": chain_id,
            "title": title.strip(),
            "status": status.strip() or "proposed",
            "run_policy": normalized_policy,
            "entry": entry.strip(),
            "exit_check": exit_check.strip(),
            "type": "command" if command_text.strip() else "manual",
            "command": command_text.strip(),
            "cwd": ".",
            "resource": resource.strip() or "local",
            "timeout_seconds": int(timeout_seconds),
            "artifact_policy": artifact_policy.strip() or "cleanup-on-pass",
            "blocker_keywords": BLOCKER_PATTERNS,
            "nodes": [],
            "created_at": now,
            "updated_at": now,
            "source": "feature-chain",
        }
    )
    path = write_feature_chains(ctx, registry)
    print(f"[context-guard] feature chain: {chain_id}")
    print(f"[context-guard] registry: {path}")
    return path


def feature_chain_attach_bc(
    root: Path,
    chain_id: str,
    node_title: str,
    bad_case: str,
    check: str = "",
) -> Path:
    init_context(root)
    ctx = context_dir(root)
    if not chain_id.strip():
        raise ValueError("feature-chain-attach-bc requires --chain-id")
    if not node_title.strip():
        raise ValueError("feature-chain-attach-bc requires --node-title")
    if not bad_case.strip():
        raise ValueError("feature-chain-attach-bc requires --bad-case")
    chain, _chains, registry = feature_chain_find(ctx, chain_id.strip())
    nodes = chain.setdefault("nodes", [])
    if not isinstance(nodes, list):
        nodes = []
        chain["nodes"] = nodes
    node_slug = normalize_test_slug(node_title)
    node: dict[str, object] | None = None
    for item in nodes:
        if not isinstance(item, dict):
            continue
        if str(item.get("title", "")).strip() == node_title.strip() or str(item.get("id", "")) == node_slug:
            node = item
            break
    if node is None:
        node = {
            "id": node_slug,
            "title": node_title.strip(),
            "checks": [],
            "bad_cases": [],
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
        nodes.append(node)
    bad_cases = node.setdefault("bad_cases", [])
    if not isinstance(bad_cases, list):
        bad_cases = []
        node["bad_cases"] = bad_cases
    if bad_case.strip() not in [str(item) for item in bad_cases]:
        bad_cases.append(bad_case.strip())
    checks = node.setdefault("checks", [])
    if not isinstance(checks, list):
        checks = []
        node["checks"] = checks
    if check.strip() and check.strip() not in [str(item) for item in checks]:
        checks.append(check.strip())
    if [str(item).strip() for item in bad_cases if str(item).strip()]:
        node.pop("coverage_pending_reason", None)
    now = datetime.now().isoformat(timespec="seconds")
    node["updated_at"] = now
    chain["updated_at"] = now
    path = write_feature_chains(ctx, registry)
    print(f"[context-guard] feature chain updated: {chain_id.strip()}")
    print(f"[context-guard] node: {node_title.strip()}")
    print(f"[context-guard] bad case: {bad_case.strip()}")
    return path


def parse_bad_case_list(value: str) -> list[str]:
    items = []
    for part in re.split(r"[,;\n]+", value or ""):
        clean = part.strip()
        if clean:
            items.append(clean)
    return items


def feature_chain_propose(
    root: Path,
    title: str,
    entry: str,
    exit_check: str,
    node_title: str,
    bad_cases: list[str],
    check: str,
    coverage_pending_reason: str = "",
    run_policy: str = RUN_ALWAYS_POLICY,
    artifact_policy: str = "cleanup-on-pass",
    resource: str = "local",
) -> Path:
    init_context(root)
    ctx = context_dir(root)
    if not title.strip():
        raise ValueError("feature-chain-propose requires --title")
    if not entry.strip():
        raise ValueError("feature-chain-propose requires --entry")
    if not exit_check.strip():
        raise ValueError("feature-chain-propose requires --exit-check")
    if not node_title.strip():
        raise ValueError("feature-chain-propose requires --node-title")
    clean_bad_cases = [item.strip() for item in bad_cases if item.strip()]
    if not clean_bad_cases and not coverage_pending_reason.strip():
        raise ValueError("feature-chain-propose requires --bad-cases or --coverage-pending-reason")
    if not check.strip():
        raise ValueError("feature-chain-propose requires --check")

    registry = load_feature_chains(ctx)
    chains = registry.setdefault("chains", [])
    if not isinstance(chains, list):
        chains = []
        registry["chains"] = chains
    chain_id = next_feature_chain_id(ctx)
    now = datetime.now().isoformat(timespec="seconds")
    node_slug = normalize_test_slug(node_title)
    node: dict[str, object] = {
        "id": node_slug,
        "title": node_title.strip(),
        "checks": [check.strip()],
        "bad_cases": clean_bad_cases,
        "created_at": now,
        "updated_at": now,
    }
    if coverage_pending_reason.strip() and not clean_bad_cases:
        node["coverage_pending_reason"] = coverage_pending_reason.strip()
    chains.append(
        {
            "id": chain_id,
            "title": title.strip(),
            "status": "proposed",
            "run_policy": run_policy.strip() or RUN_ALWAYS_POLICY,
            "entry": entry.strip(),
            "exit_check": exit_check.strip(),
            "type": "manual",
            "command": "",
            "cwd": ".",
            "resource": resource.strip() or "local",
            "timeout_seconds": 300,
            "artifact_policy": artifact_policy.strip() or "cleanup-on-pass",
            "blocker_keywords": BLOCKER_PATTERNS,
            "nodes": [node],
            "created_at": now,
            "updated_at": now,
            "source": "feature-chain",
            "proposal_note": "Human-confirmed draft only; approve with an explicit command before it can run.",
        }
    )
    path = write_feature_chains(ctx, registry)
    print(f"[context-guard] feature chain proposed: {chain_id}")
    print("[context-guard] status: proposed; this chain is not executable and will not run in dev-complete.")
    if clean_bad_cases:
        print(f"[context-guard] checkpoint: {node_title.strip()} | covers {', '.join(clean_bad_cases)}")
    else:
        print(f"[context-guard] checkpoint: {node_title.strip()} | coverage pending")
        print(f"[context-guard] coverage pending reason: {coverage_pending_reason.strip()}")
    print("[context-guard] next: after the user confirms the automation, run feature-chain-approve with the approved command.")
    print(f"[context-guard] registry: {path}")
    return path


def feature_chain_approve(
    root: Path,
    chain_id: str,
    command_text: str = "",
    run_policy: str = RUN_ALWAYS_POLICY,
    timeout_seconds: int = 300,
    artifact_policy: str = "cleanup-on-pass",
    resource: str = "local",
) -> Path:
    init_context(root)
    ctx = context_dir(root)
    chain_id = chain_id.strip()
    if not chain_id:
        raise ValueError("feature-chain-approve requires --chain-id")
    chain, _chains, registry = feature_chain_find(ctx, chain_id)
    nodes = [node for node in chain.get("nodes", []) if isinstance(node, dict)]
    if not nodes:
        raise ValueError("feature-chain-approve requires at least one checkpoint node")

    covered_nodes = []
    for node in nodes:
        checks = node.get("checks", [])
        bad_cases = node.get("bad_cases", [])
        has_check = bool(
            isinstance(checks, list)
            and [str(item).strip() for item in checks if str(item).strip()]
        )
        has_bad_case = bool(
            isinstance(bad_cases, list)
            and [str(item).strip() for item in bad_cases if str(item).strip()]
        )
        if has_check and has_bad_case:
            covered_nodes.append(node)
    if not covered_nodes:
        raise ValueError("feature-chain-approve requires a checkpoint with check text and linked bad-case coverage")

    existing_command = str(chain.get("command", "")).strip()
    command = command_text.strip() or existing_command
    run_policy = run_policy.strip() or RUN_ALWAYS_POLICY
    if run_policy == RUN_ALWAYS_POLICY and not command:
        raise ValueError("feature-chain-approve requires --command-text for every-dev-completion")

    if run_policy == RUN_ALWAYS_POLICY and command:
        hub = test_hub_dir(root)
        hub.mkdir(parents=True, exist_ok=True)
        run_id = unique_run_id()
        run_dir = hub / "dry-runs" / f"{run_id}-{normalize_test_slug(chain_id)}-approval"
        run_dir.mkdir(parents=True, exist_ok=True)
        preflight = dict(chain)
        preflight["id"] = chain_id
        preflight["title"] = str(chain.get("title") or chain_id)
        preflight["source"] = "feature-chain"
        preflight["type"] = "command"
        preflight["command"] = command
        preflight["timeout_seconds"] = int(timeout_seconds)
        preflight.setdefault("cwd", ".")
        preflight["artifact_policy"] = artifact_policy.strip() or "cleanup-on-pass"
        preflight["resource"] = resource.strip() or "local"
        preflight.setdefault("blocker_keywords", BLOCKER_PATTERNS)
        result = run_one_hub_test(root, run_dir, preflight)
        summary_path = hub / "last-approval-dry-run.json"
        summary_path.write_text(
            json.dumps(
                {
                    "run_id": run_id,
                    "root": str(root),
                    "created_at": datetime.now().isoformat(timespec="seconds"),
                    "chain_id": chain_id,
                    "result": result,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        if result.get("status") != "passed":
            print(f"[context-guard] feature chain approval dry-run failed: {chain_id}", file=sys.stderr)
            if result.get("reason"):
                print(f"[context-guard] reason: {result.get('reason')}", file=sys.stderr)
            print(f"[context-guard] evidence preserved: {run_dir}", file=sys.stderr)
            print(f"[context-guard] summary: {summary_path}", file=sys.stderr)
            raise RuntimeError("feature-chain-approve requires a passing dry run before approval")
        shutil.rmtree(run_dir, ignore_errors=True)

    now = datetime.now().isoformat(timespec="seconds")
    chain["status"] = "approved"
    chain["run_policy"] = run_policy
    chain["command"] = command
    chain["type"] = "command" if command else "manual"
    chain["timeout_seconds"] = int(timeout_seconds)
    chain["artifact_policy"] = artifact_policy.strip() or "cleanup-on-pass"
    chain["resource"] = resource.strip() or "local"
    chain["updated_at"] = now
    path = write_feature_chains(ctx, registry)
    print(f"[context-guard] feature chain approved: {chain_id}")
    print(f"[context-guard] run policy: {run_policy}")
    if run_policy == RUN_ALWAYS_POLICY and command:
        print("[context-guard] approval dry-run: passed")
    print(f"[context-guard] checkpoint coverage: {len(covered_nodes)} node(s)")
    print(f"[context-guard] registry: {path}")
    return path


def feature_chain_set_policy(root: Path, chain_id: str, run_policy: str, reason: str = "") -> Path:
    init_context(root)
    ctx = context_dir(root)
    chain_id = chain_id.strip()
    run_policy = run_policy.strip()
    if not chain_id:
        raise ValueError("feature-chain-set-policy requires --chain-id")
    if not run_policy:
        raise ValueError("feature-chain-set-policy requires --run-policy")
    chain, _chains, registry = feature_chain_find(ctx, chain_id)
    chain["run_policy"] = run_policy
    if reason.strip():
        chain["policy_reason"] = reason.strip()
    if run_policy == "disabled-with-reason":
        chain["status"] = "disabled"
        chain["disabled_reason"] = reason.strip() or "disabled by user"
    chain["updated_at"] = datetime.now().isoformat(timespec="seconds")
    path = write_feature_chains(ctx, registry)
    print(f"[context-guard] feature chain policy updated: {chain_id}")
    print(f"[context-guard] run policy: {run_policy}")
    if reason.strip():
        print(f"[context-guard] reason: {reason.strip()}")
    print(f"[context-guard] registry: {path}")
    return path


def parse_required_value(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "y", "required", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "optional", "off"}:
        return False
    raise ValueError("--required must be true/false, required/optional, yes/no, or 1/0")


def feature_chain_set_checkpoint(
    root: Path,
    chain_id: str,
    node_title: str,
    required_value: str,
    reason: str = "",
) -> Path:
    init_context(root)
    ctx = context_dir(root)
    chain_id = chain_id.strip()
    node_title = node_title.strip()
    if not chain_id:
        raise ValueError("feature-chain-set-checkpoint requires --chain-id")
    if not node_title:
        raise ValueError("feature-chain-set-checkpoint requires --node-title")
    required = parse_required_value(required_value)
    chain, _chains, registry = feature_chain_find(ctx, chain_id)
    nodes = chain.get("nodes", [])
    if not isinstance(nodes, list):
        raise ValueError(f"feature chain has no checkpoint nodes: {chain_id}")

    target_slug = normalize_test_slug(node_title)
    node: dict[str, object] | None = None
    for item in nodes:
        if not isinstance(item, dict):
            continue
        item_title = str(item.get("title", "")).strip()
        item_id = str(item.get("id", "")).strip()
        if node_title in {item_title, item_id} or target_slug in {
            normalize_test_slug(item_title),
            normalize_test_slug(item_id),
        }:
            node = item
            break
    if node is None:
        raise ValueError(f"checkpoint node not found in {chain_id}: {node_title}")

    now = datetime.now().isoformat(timespec="seconds")
    node["required"] = required
    if required:
        node.pop("optional", None)
        if reason.strip():
            node["required_reason"] = reason.strip()
        node.pop("optional_reason", None)
    else:
        node["optional"] = True
        node["optional_reason"] = reason.strip() or "marked optional by user"
        node.pop("required_reason", None)
    node["updated_at"] = now
    chain["updated_at"] = now
    path = write_feature_chains(ctx, registry)
    print(f"[context-guard] feature chain checkpoint updated: {chain_id}")
    print(f"[context-guard] checkpoint: {str(node.get('title') or node.get('id') or node_title)}")
    print(f"[context-guard] required: {str(required).lower()}")
    if reason.strip():
        print(f"[context-guard] reason: {reason.strip()}")
    print(f"[context-guard] registry: {path}")
    return path


def feature_chain_list(root: Path, verbose: bool = False) -> int:
    init_context(root)
    ctx = context_dir(root)
    registry = load_feature_chains(ctx)
    chains = [item for item in registry.get("chains", []) if isinstance(item, dict)]
    if not chains:
        print("[context-guard] feature chains: none.")
        print(f"[context-guard] registry: {feature_chains_path(ctx)}")
        return 0
    print("[context-guard] feature chains:")
    for chain in chains:
        chain_id = str(chain.get("id", "unknown"))
        title = str(chain.get("title", "untitled"))
        status = str(chain.get("status", "unknown"))
        run_policy = str(chain.get("run_policy", "unset"))
        nodes = [item for item in chain.get("nodes", []) if isinstance(item, dict)]
        optional_count = sum(1 for node in nodes if is_optional_feature_checkpoint(node))
        required_count = len(nodes) - optional_count
        covered = sorted(
            {
                str(bc)
                for node in nodes
                for bc in (node.get("bad_cases", []) if isinstance(node.get("bad_cases", []), list) else [])
            }
        )
        suffix = f" | covers {', '.join(covered)}" if covered else ""
        print(
            f"- {chain_id} | {status} | {run_policy} | {title} | "
            f"{len(nodes)} node(s), {required_count} required, {optional_count} optional{suffix}"
        )
        if verbose:
            for node in nodes:
                label = str(node.get("title") or node.get("id") or "untitled").strip()
                policy = "optional" if is_optional_feature_checkpoint(node) else "required"
                reason = str(node.get("optional_reason") or node.get("required_reason") or "").strip()
                detail = f"  checkpoint: {label} | {policy}"
                if reason:
                    detail += f" | reason: {reason}"
                print(detail)
    print(f"[context-guard] registry: {feature_chains_path(ctx)}")
    return 0


def bad_case_card_id(card: dict[str, str]) -> str:
    for value in (card.get("id", ""), card.get("title", "")):
        match = re.search(r"BC-\d{8}-\d+", value)
        if match:
            return match.group(0)
    return ""


def bad_case_card_label(card: dict[str, str]) -> str:
    title = human_title(card.get("title", "bad case")).strip()
    return title or bad_case_card_id(card) or "bad case"


def feature_chain_bad_case_label(
    ref: str,
    cards_by_id: dict[str, dict[str, str]],
    cards_by_title: dict[str, dict[str, str]],
) -> str:
    clean = ref.strip()
    match = re.search(r"BC-\d{8}-\d+", clean)
    if match:
        card = cards_by_id.get(match.group(0))
        if card:
            return bad_case_card_label(card)
    card = cards_by_title.get(clean.lower())
    if card:
        return bad_case_card_label(card)
    return clean


def feature_chain_node_bad_case_refs(node: dict[str, object]) -> list[str]:
    bad_cases = node.get("bad_cases", [])
    if not isinstance(bad_cases, list):
        return []
    return [str(item).strip() for item in bad_cases if str(item).strip()]


def feature_chain_summary(root: Path, verbose: bool = False) -> int:
    init_context(root)
    ctx = context_dir(root)
    registry = load_feature_chains(ctx)
    chains = [item for item in registry.get("chains", []) if isinstance(item, dict)]
    bad_case_path = ctx / "bad-cases.md"
    cards = parse_bad_case_cards(bad_case_path.read_text(encoding="utf-8") if bad_case_path.exists() else "")
    cards_by_id = {bad_case_card_id(card): card for card in cards if bad_case_card_id(card)}
    cards_by_title = {bad_case_card_label(card).lower(): card for card in cards}

    approved_always = [
        chain
        for chain in chains
        if str(chain.get("status", "")).strip().lower() in APPROVED_TEST_STATUSES
        and str(chain.get("run_policy", "")).strip() == RUN_ALWAYS_POLICY
    ]
    proposed_count = sum(1 for chain in chains if str(chain.get("status", "")).strip().lower() == "proposed")
    covered_refs: set[str] = set()
    pending_count = 0
    covered_chain_count = 0
    max_chain_coverage = 0
    for chain in chains:
        chain_refs: set[str] = set()
        for node in chain.get("nodes", []):
            if not isinstance(node, dict):
                continue
            refs = feature_chain_node_bad_case_refs(node)
            covered_refs.update(refs)
            chain_refs.update(refs)
            if str(node.get("coverage_pending_reason", "")).strip() and not refs:
                pending_count += 1
        if chain_refs:
            covered_chain_count += 1
            max_chain_coverage = max(max_chain_coverage, len(chain_refs))

    print("[context-guard] feature-chain summary:")
    print(f"- chains: {len(chains)}")
    print(f"- approved every-dev-completion: {len(approved_always)}")
    print(f"- proposed: {proposed_count}")
    print(f"- covered bad cases: {len(covered_refs)}")
    print(f"- pending checkpoints: {pending_count}")
    if covered_chain_count:
        density = len(covered_refs) / covered_chain_count
        print(f"- coverage density: {density:.1f} bad case(s) per covered chain")
    if max_chain_coverage > 1:
        print(f"- reuse signal: one workflow covers up to {max_chain_coverage} bad case(s)")
    if not chains:
        print("[context-guard] next: no feature chains yet; use feature-chain-plan when a concrete bad case or user-confirmed test target appears.")
        print(f"[context-guard] registry: {feature_chains_path(ctx)}")
        return 0

    visible_chains = chains if verbose else chains[:6]
    for chain in visible_chains:
        chain_id = str(chain.get("id") or "unknown")
        title = str(chain.get("title") or "untitled")
        status = str(chain.get("status") or "unknown")
        run_policy = str(chain.get("run_policy") or "unset")
        nodes = [node for node in chain.get("nodes", []) if isinstance(node, dict)]
        chain_refs = [
            ref
            for node in nodes
            for ref in feature_chain_node_bad_case_refs(node)
        ]
        chain_pending = sum(
            1
            for node in nodes
            if str(node.get("coverage_pending_reason", "")).strip()
            and not feature_chain_node_bad_case_refs(node)
        )
        print(f"- chain: {chain_id} | {status} | {run_policy} | {title}")
        entry = str(chain.get("entry") or "").strip()
        exit_check = str(chain.get("exit_check") or "").strip()
        if entry:
            print(f"  entry: {entry}")
        if exit_check:
            print(f"  exit: {exit_check}")
        print(f"  coverage: {len(set(chain_refs))} bad case(s), {chain_pending} pending checkpoint(s)")
        if len(set(chain_refs)) > 1:
            print("  next: prefer extending this workflow before creating another test for similar symptoms")
        elif chain_pending:
            print("  next: attach the first matching real bad case here before approval")
        visible_nodes = nodes if verbose else nodes[:4]
        for node in visible_nodes:
            node_title = str(node.get("title") or node.get("id") or "checkpoint").strip()
            refs = feature_chain_node_bad_case_refs(node)
            print(f"  checkpoint: {node_title}")
            if refs:
                labels = [
                    feature_chain_bad_case_label(ref, cards_by_id, cards_by_title)
                    for ref in refs[:4]
                ]
                suffix = f"; +{len(refs) - 4} more" if len(refs) > 4 else ""
                print(f"    covers: {'; '.join(labels)}{suffix}")
            pending_reason = str(node.get("coverage_pending_reason", "")).strip()
            if pending_reason and not refs:
                print(f"    coverage pending: {pending_reason}")
            if verbose:
                checks = node.get("checks", [])
                check_items = [str(item).strip() for item in checks if str(item).strip()] if isinstance(checks, list) else []
                if check_items:
                    print(f"    check: {'; '.join(check_items[:3])}")
        if len(nodes) > len(visible_nodes):
            print(f"  ... {len(nodes) - len(visible_nodes)} more checkpoint(s); rerun with --verbose to show all.")
    if len(chains) > len(visible_chains):
        print(f"... {len(chains) - len(visible_chains)} more chain(s); rerun with --verbose to show all.")
    if pending_count:
        print("[context-guard] next: review pending checkpoints before proposing new chains.")
    elif covered_refs:
        print("[context-guard] next: run feature-chain-plan for new bad cases and prefer existing matching chains.")
    else:
        print("[context-guard] next: keep chains proposed until a real bad case or user-approved recurrence risk is attached.")
    print(f"[context-guard] registry: {feature_chains_path(ctx)}")
    return 0


def feature_chain_overlap_bad_case_refs(chain: dict[str, object]) -> set[str]:
    refs: set[str] = set()
    for node in chain.get("nodes", []):
        if not isinstance(node, dict):
            continue
        for ref in feature_chain_node_bad_case_refs(node):
            match = re.search(r"BC-\d{8}-\d+", ref)
            refs.add(match.group(0) if match else ref.lower())
    return refs


def feature_chain_overlap(root: Path, min_score: int = 6, verbose: bool = False) -> int:
    init_context(root)
    ctx = context_dir(root)
    registry = load_feature_chains(ctx)
    chains = [item for item in registry.get("chains", []) if isinstance(item, dict)]
    pairs: list[tuple[int, dict[str, object], dict[str, object], list[str], set[str]]] = []

    for index, left in enumerate(chains):
        left_text = feature_chain_candidate_text(left)
        left_refs = feature_chain_overlap_bad_case_refs(left)
        for right in chains[index + 1 :]:
            right_text = feature_chain_candidate_text(right)
            right_refs = feature_chain_overlap_bad_case_refs(right)
            evidence = feature_chain_match_evidence(left_text, right_text, max_terms=8)
            shared_refs = left_refs & right_refs
            score = len(evidence) * 2 + len(shared_refs) * 8
            left_entry = str(left.get("entry", "")).strip().lower()
            right_entry = str(right.get("entry", "")).strip().lower()
            left_exit = str(left.get("exit_check", "")).strip().lower()
            right_exit = str(right.get("exit_check", "")).strip().lower()
            if left_entry and left_entry == right_entry:
                score += 4
            if left_exit and left_exit == right_exit:
                score += 4
            if score >= max(1, min_score) or shared_refs:
                pairs.append((score, left, right, evidence, shared_refs))

    pairs.sort(key=lambda item: item[0], reverse=True)
    print("[context-guard] feature-chain overlap audit:")
    print(f"- chains: {len(chains)}")
    print(f"- overlapping candidates: {len(pairs)}")
    if not chains:
        print("[context-guard] next: no feature chains yet; use feature-chain-plan when a real workflow appears.")
    elif not pairs:
        print("[context-guard] next: no duplicate-chain signal; still use feature-chain-plan before creating new coverage.")
    else:
        visible_pairs = pairs if verbose else pairs[:6]
        for score, left, right, evidence, shared_refs in visible_pairs:
            left_id = str(left.get("id") or "unknown")
            right_id = str(right.get("id") or "unknown")
            left_title = str(left.get("title") or "untitled")
            right_title = str(right.get("title") or "untitled")
            print(f"- review: {left_id} | {left_title}")
            print(f"  with: {right_id} | {right_title}")
            print(f"  overlap score: {score}")
            if evidence:
                print(f"  match evidence: {', '.join(evidence)}")
            if shared_refs:
                print(f"  shared bad cases: {', '.join(sorted(shared_refs))}")
            print("  next: review whether one workflow should absorb the other before approving automation.")
        if len(pairs) > len(visible_pairs):
            print(f"[context-guard] ... {len(pairs) - len(visible_pairs)} more pair(s); rerun with --verbose to show all.")
        print("[context-guard] next: merge or extend an existing feature chain when the business workflow is the same.")
    print(f"[context-guard] registry: {feature_chains_path(ctx)}")
    return 0


def feature_chain_coverage(root: Path, verbose: bool = False) -> int:
    init_context(root)
    ctx = context_dir(root)
    bad_case_path = ctx / "bad-cases.md"
    cards = parse_bad_case_cards(bad_case_path.read_text(encoding="utf-8") if bad_case_path.exists() else "")
    registry = load_feature_chains(ctx)
    chains = [item for item in registry.get("chains", []) if isinstance(item, dict)]
    cards_by_id = {bad_case_card_id(card): card for card in cards if bad_case_card_id(card)}
    cards_by_title = {bad_case_card_label(card).lower(): card for card in cards}
    covered_ids: set[str] = set()
    unknown_refs: set[str] = set()

    print("[context-guard] feature-chain coverage:")
    print(f"- feature chains: {len(chains)}")
    print(f"- bad cases in register: {len(cards)}")

    for chain in chains:
        chain_id = str(chain.get("id") or "unknown")
        title = str(chain.get("title") or "untitled")
        status = str(chain.get("status") or "unknown")
        nodes = [node for node in chain.get("nodes", []) if isinstance(node, dict)]
        chain_refs: list[str] = []
        for node in nodes:
            bad_cases = node.get("bad_cases", [])
            if isinstance(bad_cases, list):
                chain_refs.extend(str(item).strip() for item in bad_cases if str(item).strip())
        for ref in chain_refs:
            match = re.search(r"BC-\d{8}-\d+", ref)
            if match and match.group(0) in cards_by_id:
                covered_ids.add(match.group(0))
                continue
            matched_card = cards_by_title.get(ref.lower())
            if matched_card:
                matched_id = bad_case_card_id(matched_card)
                if matched_id:
                    covered_ids.add(matched_id)
                continue
            unknown_refs.add(ref)

        if verbose:
            print(f"- {chain_id} | {status} | {title}")
            for node in nodes:
                node_title = str(node.get("title") or node.get("id") or "checkpoint").strip()
                node_bad_cases = node.get("bad_cases", [])
                refs = (
                    [str(item).strip() for item in node_bad_cases if str(item).strip()]
                    if isinstance(node_bad_cases, list)
                    else []
                )
                suffix = ", ".join(refs) if refs else "no linked bad case"
                print(f"  checkpoint: {node_title} | covers: {suffix}")

    uncovered_cards = [card for card in cards if bad_case_card_id(card) not in covered_ids]
    print(f"- covered by feature chains: {len(covered_ids)}")
    print(f"- unassigned candidates: {len(uncovered_cards)}")
    if unknown_refs:
        print(f"- unknown linked refs: {len(unknown_refs)}")
        if verbose:
            for ref in sorted(unknown_refs):
                print(f"  unknown ref: {ref}")

    if uncovered_cards:
        print("[context-guard] unassigned candidates are not mandatory tests; use them only when a workflow-level chain would reduce recurrence risk.")
        limit = len(uncovered_cards) if verbose else min(8, len(uncovered_cards))
        for card in uncovered_cards[:limit]:
            case_id = bad_case_card_id(card)
            label = bad_case_card_label(card)
            tags = card.get("tags", "").strip()
            suffix = f" | {tags}" if tags else ""
            print(f"  candidate: {case_id or '-'} | {label}{suffix}")
            match = feature_chain_best_match_for_text(bad_case_search_text(card), chains)
            if match and match[0] >= FEATURE_CHAIN_COVERAGE_SUGGESTION_MIN_SCORE:
                score, chain, node_score, node = match
                chain_id = str(chain.get("id") or "unknown")
                chain_title = str(chain.get("title") or "untitled")
                print(f"    possible chain: {chain_id} | score={score} | {chain_title}")
                if node:
                    node_title = str(node.get("title") or node.get("id") or "checkpoint")
                    print(f"    possible checkpoint: {node_title} (score={node_score})")
                evidence = feature_chain_match_evidence(
                    bad_case_search_text(card),
                    feature_chain_candidate_text(chain, node),
                )
                if evidence:
                    print(f"    match evidence: {', '.join(evidence)}")
        if len(uncovered_cards) > limit:
            print(f"  ... {len(uncovered_cards) - limit} more; rerun with --verbose to show all.")
    print(f"[context-guard] registry: {feature_chains_path(ctx)}")
    return 0


def bad_case_tags(card: dict[str, str]) -> list[str]:
    tags = re.findall(r"#[\w./:-]+", str(card.get("tags", "")), flags=re.UNICODE)
    if tags:
        return [tag for tag in tags if tag.strip()]
    plain = str(card.get("tags", "")).strip()
    if not plain:
        return []
    parts = re.split(r"[,，、;；\n]+", plain)
    normalized: list[str] = []
    seen: set[str] = set()
    for part in parts:
        raw = part.strip().strip("` ")
        if not raw:
            continue
        tag = raw if raw.startswith("#") else f"#{raw}"
        key = tag.lower()
        if key not in seen:
            seen.add(key)
            normalized.append(tag)
    return normalized


def readable_feature_tag(tag: str) -> str:
    raw = tag.strip().lstrip("#")
    if not raw:
        return "未命名功能区"
    known_labels = {
        "branch-map": "支线分叉图",
        "visual-regression": "前端视觉回归",
        "test-design": "测试设计",
        "coverage-audit": "覆盖审计",
        "context-bloat": "Context 精简",
        "skill-trigger-risk": "Skill 触发可靠性",
        "language-projection": "语言投影",
        "route-alignment": "路线对齐",
        "layout-model": "布局模型",
        "i18n": "多语言展示",
        "readability": "可读性",
        "remote": "远程开发",
        "state": "状态流程",
        "validation": "输入校验",
        "game-state": "游戏状态",
        "date-reset": "日期重置",
        "habit-streak": "连续天数",
    }
    if raw in known_labels:
        return known_labels[raw]
    label = raw.replace("-", " ").replace("_", " ").strip()
    if label == "roadmap ux":
        return "路线图展示体验"
    if label == "context loss":
        return "Context 持久化"
    if label == "feature chain":
        return "功能链测试入口"
    if label == "test hub":
        return "测试中台"
    return label


def semantic_feature_tags(card: dict[str, str]) -> list[str]:
    """Add stable feature buckets so loose human tags can still form one workflow."""
    text_parts = [
        bad_case_card_label(card),
        str(card.get("scope", "")),
        str(card.get("phenomenon", "")),
        str(card.get("trigger / reproduction", "")),
        str(card.get("guard / verification", "")),
        " ".join(bad_case_tags(card)),
    ]
    text = " ".join(part for part in text_parts if part).lower()
    buckets: list[tuple[str, tuple[str, ...]]] = [
        ("#复制反馈", ("复制", "剪贴板", "clipboard", "copy")),
        ("#空输入保护", ("空输入", "空白", "短线索", "输入", "empty", "blank", "input")),
        ("#历史恢复", ("历史", "恢复", "history", "restore")),
        ("#导出", ("导出", "markdown", "export")),
        ("#本地存储", ("本地存储", "持久化", "localstorage", "local storage", "persist")),
        ("#模板", ("模板", "template")),
        ("#重置", ("重置", "reset")),
        ("#进度", ("进度", "完成", "progress", "complete")),
        ("#回放", ("回放", "灯序", "sequence", "replay")),
        ("#得分", ("分数", "最高分", "score")),
    ]
    matched: list[str] = []
    for bucket, keywords in buckets:
        if any(keyword in text for keyword in keywords):
            matched.append(bucket)
    return matched


def feature_chain_group_tags(card: dict[str, str]) -> list[str]:
    ignored = {"feature-chain", "test-hub", "methodology", "risk-audit", "subagent"}
    tags = []
    for tag in [*bad_case_tags(card), *semantic_feature_tags(card)]:
        raw = tag.strip().lstrip("#")
        if not raw or raw in ignored:
            continue
        normalized = tag if tag.startswith("#") else f"#{tag}"
        if normalized not in tags:
            tags.append(normalized)
    return sorted(tags, key=feature_chain_tag_sort_key)


def readable_feature_tag_group(tags: tuple[str, ...]) -> str:
    labels = [readable_feature_tag(tag) for tag in tags]
    return " / ".join(label for label in labels if label.strip()) or "未命名功能区"


def auto_feature_chain_title(tags: tuple[str, ...], cards: list[dict[str, str]]) -> str:
    scope_counts: dict[str, int] = {}
    for card in cards:
        scope = human_title(str(card.get("scope", "")).strip())
        if scope:
            scope_counts[scope] = scope_counts.get(scope, 0) + 1
    if scope_counts:
        best_scope, best_count = sorted(scope_counts.items(), key=lambda item: (-item[1], len(item[0]), item[0]))[0]
        if best_count >= 2 or len(scope_counts) == 1:
            return best_scope
    return readable_feature_tag_group(tags)


def internal_auto_feature_chain_label(value: str) -> bool:
    text = str(value or "").strip()
    if not text:
        return True
    lowered = text.lower()
    internal_terms = ("context guard", "subagent", "risk audit")
    if any(term in lowered for term in internal_terms):
        return True
    return text in {"未命名功能区", "本轮功能流程"}


def internal_auto_feature_chain_tags(tags: tuple[str, ...]) -> bool:
    normalized = {tag.strip().lstrip("#").lower() for tag in tags if tag.strip()}
    return bool(normalized & {"risk-audit", "subagent", "feature-chain", "test-hub", "methodology"})


def best_auto_feature_group_tags(cards: list[dict[str, str]]) -> tuple[str, ...]:
    groups: dict[tuple[str, ...], list[dict[str, str]]] = {}
    for card in cards:
        tags = feature_chain_group_tags(card)
        if len(tags) >= 2:
            for index, first_tag in enumerate(tags):
                for second_tag in tags[index + 1 :]:
                    groups.setdefault((first_tag, second_tag), []).append(card)
        for tag in tags:
            groups.setdefault((tag,), []).append(card)
    if not groups:
        return tuple()
    best_coverage = max(len(group_cards) for group_cards in groups.values())
    candidates = [
        (tags, group_cards)
        for tags, group_cards in groups.items()
        if len(group_cards) == best_coverage
    ]
    candidates.sort(key=feature_chain_candidate_group_sort_key)
    return candidates[0][0]


def feature_group_coverage_count(tags: tuple[str, ...], cards: list[dict[str, str]]) -> int:
    if not tags:
        return 0
    required = set(tags)
    count = 0
    for card in cards:
        if required.issubset(set(feature_chain_group_tags(card))):
            count += 1
    return count


def feature_chain_tag_sort_key(tag: str) -> tuple[int, str]:
    raw = tag.strip().lstrip("#")
    priority = {
        "roadmap-ux": 0,
        "context-loss": 0,
        "feature-chain": 0,
        "test-hub": 0,
        "branch-map": 0,
        "visual-regression": 0,
        "skill-trigger-risk": 0,
        "readability": 2,
        "remote": 2,
        "test-design": 2,
        "coverage-audit": 2,
    }.get(raw, 1)
    return (priority, readable_feature_tag(tag))


def feature_chain_candidate_group_sort_key(item: tuple[tuple[str, ...], list[dict[str, str]]]) -> tuple[int, int, str]:
    tags, group_cards = item
    return (-len(tags), -len(group_cards), readable_feature_tag_group(tags))


def covered_bad_case_ids_from_feature_chains(cards: list[dict[str, str]], chains: list[dict[str, object]]) -> set[str]:
    cards_by_id = {bad_case_card_id(card): card for card in cards if bad_case_card_id(card)}
    cards_by_title = {bad_case_card_label(card).lower(): card for card in cards}
    covered_ids: set[str] = set()
    for chain in chains:
        for node in chain.get("nodes", []):
            if not isinstance(node, dict):
                continue
            bad_cases = node.get("bad_cases", [])
            refs = [str(item).strip() for item in bad_cases if str(item).strip()] if isinstance(bad_cases, list) else []
            for ref in refs:
                match = re.search(r"BC-\d{8}-\d+", ref)
                if match and match.group(0) in cards_by_id:
                    covered_ids.add(match.group(0))
                    continue
                matched_card = cards_by_title.get(ref.lower())
                if matched_card:
                    matched_id = bad_case_card_id(matched_card)
                    if matched_id:
                        covered_ids.add(matched_id)
    return covered_ids


def auto_feature_chain_node(chain_id: str, index: int, card: dict[str, str]) -> dict[str, Any]:
    case_id = bad_case_card_id(card)
    label = bad_case_card_label(card)
    check = first_nonempty(
        card.get("guard / verification", ""),
        card.get("green condition", ""),
        card.get("red condition", ""),
        card.get("trigger / reproduction", ""),
        card.get("phenomenon", ""),
        label,
    )
    return {
        "id": f"{chain_id}-N{index}",
        "title": label,
        "bad_cases": [case_id] if case_id else [],
        "checks": [check] if check else [],
        "source": "auto-proposed-from-uncovered-bad-cases",
        "requires_user_review": True,
    }


def refresh_auto_feature_chain_metadata(chain: dict[str, Any], cards_by_id: dict[str, dict[str, str]]) -> bool:
    refs: list[str] = []
    nodes = chain.get("nodes")
    if not isinstance(nodes, list):
        return False
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_refs = node.get("bad_cases", [])
        if isinstance(node_refs, list):
            refs.extend(str(ref).strip() for ref in node_refs if str(ref).strip())
    source_cards = [cards_by_id[ref] for ref in refs if ref in cards_by_id]
    if not source_cards:
        return False

    changed = False
    current_key = str(chain.get("auto_group_key") or "").strip()
    current_tags = tuple(tag for tag in current_key.split("|") if tag)
    better_tags = best_auto_feature_group_tags(source_cards)
    should_refresh_key = not current_tags or internal_auto_feature_chain_tags(current_tags)
    if better_tags and current_tags and not should_refresh_key:
        should_refresh_key = feature_group_coverage_count(better_tags, source_cards) > feature_group_coverage_count(
            current_tags, source_cards
        )
    if better_tags and should_refresh_key:
        better_key = "|".join(better_tags)
        if current_key != better_key:
            chain["auto_group_key"] = better_key
            changed = True
    tags_for_title = better_tags or current_tags
    better_title = auto_feature_chain_title(tags_for_title, source_cards)
    if better_title and internal_auto_feature_chain_label(str(chain.get("title") or "")):
        chain["title"] = better_title
        chain["entry"] = f"触发「{better_title}」相关用户流程"
        chain["exit_check"] = f"「{better_title}」相关结果保持用户可见的正确状态"
        changed = True
    return changed


def expand_auto_feature_chain_nodes(chains: list[dict[str, Any]], cards: list[dict[str, str]]) -> bool:
    cards_by_id = {bad_case_card_id(card): card for card in cards if bad_case_card_id(card)}
    any_changed = False
    for chain in chains:
        status = str(chain.get("status") or "").strip().lower()
        if chain.get("auto_proposed") is not True or status != "proposed":
            continue
        nodes = chain.get("nodes")
        if not isinstance(nodes, list):
            continue
        chain_id = str(chain.get("id") or "CHAIN").strip() or "CHAIN"
        next_index = 1
        expanded_nodes: list[dict[str, Any]] = []
        chain_changed = False
        for node in nodes:
            if not isinstance(node, dict):
                continue
            refs = [str(ref).strip() for ref in node.get("bad_cases", []) if str(ref).strip()]
            if len(refs) <= 1:
                node["id"] = f"{chain_id}-N{next_index}"
                expanded_nodes.append(node)
                next_index += 1
                continue
            for ref in refs:
                card = cards_by_id.get(ref)
                if card:
                    expanded_nodes.append(auto_feature_chain_node(chain_id, next_index, card))
                else:
                    expanded_nodes.append(
                        {
                            "id": f"{chain_id}-N{next_index}",
                            "title": ref,
                            "bad_cases": [ref],
                            "checks": [str(item) for item in node.get("checks", []) if str(item).strip()],
                            "source": "auto-proposed-from-uncovered-bad-cases",
                            "requires_user_review": True,
                        }
                    )
                next_index += 1
            chain_changed = True
        if chain_changed and expanded_nodes:
            chain["nodes"] = expanded_nodes
            any_changed = True
        if refresh_auto_feature_chain_metadata(chain, cards_by_id):
            any_changed = True
    return any_changed


def feature_chain_candidates(root: Path, min_cases: int = 2, max_groups: int = 6) -> int:
    init_context(root)
    ctx = context_dir(root)
    bad_case_path = ctx / "bad-cases.md"
    cards = parse_bad_case_cards(bad_case_path.read_text(encoding="utf-8") if bad_case_path.exists() else "")
    registry = load_feature_chains(ctx)
    chains = [item for item in registry.get("chains", []) if isinstance(item, dict)]
    existing_group_chains = {
        str(chain.get("auto_group_key") or "").strip(): chain
        for chain in chains
        if str(chain.get("auto_group_key") or "").strip()
    }
    existing_group_keys = set(existing_group_chains)
    covered_ids = covered_bad_case_ids_from_feature_chains(cards, chains)
    unassigned_cards = [card for card in cards if bad_case_card_id(card) not in covered_ids]
    groups: dict[tuple[str, ...], list[dict[str, str]]] = {}
    for card in unassigned_cards:
        tags = feature_chain_group_tags(card)
        if len(tags) >= 2:
            for index, first_tag in enumerate(tags):
                for second_tag in tags[index + 1 :]:
                    groups.setdefault((first_tag, second_tag), []).append(card)
        for tag in tags:
            groups.setdefault((tag,), []).append(card)

    candidates = [
        (tags, group_cards)
        for tags, group_cards in groups.items()
        if len(group_cards) >= max(1, min_cases) or "|".join(tags) in existing_group_keys
    ]
    specific_tags = {
        tag
        for tags, _group_cards in candidates
        if len(tags) > 1
        for tag in tags
    }
    candidates = [
        (tags, group_cards)
        for tags, group_cards in candidates
        if len(tags) > 1 or tags[0] not in specific_tags or "|".join(tags) in existing_group_keys
    ]
    candidates.sort(
        key=lambda item: (
            0 if "|".join(item[0]) in existing_group_keys else 1,
            feature_chain_candidate_group_sort_key(item),
        )
    )
    selected_candidates: list[tuple[tuple[str, ...], list[dict[str, str]], list[str]]] = []
    selected_case_ids: set[str] = set()
    for tags, group_cards in candidates:
        case_ids = [bad_case_card_id(card) for card in group_cards if bad_case_card_id(card)]
        new_case_ids = [case_id for case_id in case_ids if case_id not in selected_case_ids]
        if selected_case_ids and len(new_case_ids) < max(1, min_cases):
            continue
        selected_candidates.append((tags, group_cards, new_case_ids))
        selected_case_ids.update(new_case_ids)
    candidates = selected_candidates

    print("[context-guard] feature-chain candidates:")
    print(f"- bad cases in register: {len(cards)}")
    print(f"- already covered by feature chains: {len(covered_ids)}")
    print(f"- unassigned bad cases: {len(unassigned_cards)}")
    if not candidates:
        print("[context-guard] candidates: none")
        print("[context-guard] next: use feature-chain-plan for an individual bad case or ask the user for a concrete feature entry.")
        print(f"[context-guard] registry: {feature_chains_path(ctx)}")
        return 0

    print("[context-guard] candidates are planning hints only; ask the user before creating or approving a chain.")
    for tags, group_cards, new_case_ids in candidates[: max(1, max_groups)]:
        title = readable_feature_tag_group(tags)
        tag_label = ", ".join(tags)
        print(f"- candidate chain: {title} | {len(group_cards)} unassigned bad cases | new coverage: {len(new_case_ids)} | tags: {tag_label}")
        print(f"  confirmation prompt: 测试创建识别：建议先确认一条功能链：从「{title}」的真实入口到用户可见的正确结果，覆盖这一组复发风险。")
        print("  seed bad cases:")
        for card in group_cards[:3]:
            case_id = bad_case_card_id(card)
            label = bad_case_card_label(card)
            print(f"    - {case_id or '-'} | {label}")
        if len(group_cards) > 3:
            print(f"    ... {len(group_cards) - 3} more")
    if len(candidates) > max_groups:
        print(f"[context-guard] ... {len(candidates) - max_groups} more candidate group(s); rerun with --max-groups to show more.")
    print(f"[context-guard] registry: {feature_chains_path(ctx)}")
    return 0


def feature_chain_auto_propose(root: Path, min_cases: int = 2, max_groups: int = 3, hook_mode: bool = False) -> int:
    init_context(root)
    ctx = context_dir(root)
    bad_case_path = ctx / "bad-cases.md"
    cards = parse_bad_case_cards(bad_case_path.read_text(encoding="utf-8") if bad_case_path.exists() else "")
    all_case_ids = [bad_case_card_id(card) for card in cards if bad_case_card_id(card)]
    state_path = feature_chain_auto_state_path(ctx)
    seen_case_ids: set[str] = set()
    if hook_mode:
        try:
            state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
        except json.JSONDecodeError:
            state = {}
        if isinstance(state, dict):
            seen_case_ids = {str(item).strip() for item in state.get("seen_bad_cases", []) if str(item).strip()}
        if not state_path.exists() and len(all_case_ids) > 12:
            state_path.parent.mkdir(parents=True, exist_ok=True)
            state_path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "seen_bad_cases": sorted(all_case_ids),
                        "note": "Baseline established by hook mode to avoid auto-proposing chains from a large historical register.",
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            print("[context-guard] auto feature-chain proposal: none")
            print(f"- historical baseline established: {len(all_case_ids)} bad cases")
            print("[context-guard] reason: large existing register; future new bad cases will be considered for proposed chains.")
            print(f"[context-guard] state: {state_path}")
            return 0
    registry = load_feature_chains(ctx)
    chains = [item for item in registry.get("chains", []) if isinstance(item, dict)]
    if expand_auto_feature_chain_nodes(chains, cards):
        registry["chains"] = chains
        write_feature_chains(ctx, registry)
    existing_group_chains = {
        str(chain.get("auto_group_key") or "").strip(): chain
        for chain in chains
        if str(chain.get("auto_group_key") or "").strip()
    }
    existing_group_keys = set(existing_group_chains)
    covered_ids = covered_bad_case_ids_from_feature_chains(cards, chains)
    unassigned_cards = [card for card in cards if bad_case_card_id(card) not in covered_ids]
    can_attach_existing_group = False
    for card in unassigned_cards:
        meaningful_tags = feature_chain_group_tags(card)
        for tag in meaningful_tags:
            if tag in existing_group_keys:
                can_attach_existing_group = True
                break
        if can_attach_existing_group:
            break
        for index, first_tag in enumerate(meaningful_tags):
            for second_tag in meaningful_tags[index + 1 :]:
                if f"{first_tag}|{second_tag}" in existing_group_keys:
                    can_attach_existing_group = True
                    break
            if can_attach_existing_group:
                break
    if len(unassigned_cards) < max(1, min_cases) and not can_attach_existing_group:
        print("[context-guard] auto feature-chain proposal: none")
        print(f"- unassigned bad cases: {len(unassigned_cards)}")
        print("[context-guard] reason: not enough uncovered bad cases to form a reusable workflow candidate.")
        if hook_mode:
            state_path.parent.mkdir(parents=True, exist_ok=True)
            state_path.write_text(
                json.dumps({"version": 1, "seen_bad_cases": sorted(all_case_ids)}, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(f"[context-guard] state: {state_path}")
        print(f"[context-guard] registry: {feature_chains_path(ctx)}")
        return 0

    groups: dict[tuple[str, ...], list[dict[str, str]]] = {}
    for card in unassigned_cards:
        meaningful_tags = feature_chain_group_tags(card)
        if len(meaningful_tags) >= 2:
            for index, first_tag in enumerate(meaningful_tags):
                for second_tag in meaningful_tags[index + 1 :]:
                    groups.setdefault((first_tag, second_tag), []).append(card)
        for tag in meaningful_tags:
            groups.setdefault((tag,), []).append(card)

    candidates = [
        (tags, group_cards)
        for tags, group_cards in groups.items()
        if len(group_cards) >= max(1, min_cases) or "|".join(tags) in existing_group_keys
    ]
    specific_tags = {
        tag
        for tags, _group_cards in candidates
        if len(tags) > 1
        for tag in tags
    }
    candidates = [
        (tags, group_cards)
        for tags, group_cards in candidates
        if len(tags) > 1 or tags[0] not in specific_tags or "|".join(tags) in existing_group_keys
    ]
    candidates.sort(key=feature_chain_candidate_group_sort_key)
    if not candidates:
        print("[context-guard] auto feature-chain proposal: none")
        print(f"- unassigned bad cases: {len(unassigned_cards)}")
        print("[context-guard] reason: uncovered cases do not share enough feature tags.")
        if hook_mode:
            state_path.parent.mkdir(parents=True, exist_ok=True)
            state_path.write_text(
                json.dumps({"version": 1, "seen_bad_cases": sorted(all_case_ids)}, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(f"[context-guard] state: {state_path}")
        print(f"[context-guard] registry: {feature_chains_path(ctx)}")
        return 0

    created: list[str] = []
    attached: list[str] = []
    skipped: list[str] = []
    run_covered_ids = set(covered_ids)
    today = datetime.now().strftime("%Y-%m-%d")
    for tags, group_cards in candidates[: max(1, max_groups)]:
        group_key = "|".join(tags)
        title = auto_feature_chain_title(tags, group_cards)
        case_ids = [bad_case_card_id(card) for card in group_cards if bad_case_card_id(card)]
        if not case_ids:
            skipped.append(f"{title}: no stable bad-case IDs")
            continue
        if group_key in existing_group_keys:
            existing_chain = existing_group_chains.get(group_key) or {}
            status = str(existing_chain.get("status") or "").strip().lower()
            if existing_chain.get("auto_proposed") is True and status == "proposed":
                nodes = existing_chain.setdefault("nodes", [])
                if not isinstance(nodes, list):
                    nodes = []
                    existing_chain["nodes"] = nodes
                existing_refs: set[str] = set()
                for node in nodes:
                    if not isinstance(node, dict):
                        continue
                    refs = node.get("bad_cases", [])
                    if isinstance(refs, list):
                        existing_refs.update(str(item).strip() for item in refs if str(item).strip())
                new_case_ids = [
                    case_id
                    for case_id in case_ids
                    if case_id not in existing_refs and case_id not in run_covered_ids
                ]
                if not new_case_ids:
                    skipped.append(f"{title}: already proposed")
                    continue
                chain_id_for_node = str(existing_chain.get("id") or "CHAIN").strip() or "CHAIN"
                next_index = len([node for node in nodes if isinstance(node, dict)]) + 1
                new_case_id_set = set(new_case_ids)
                for card in group_cards:
                    if bad_case_card_id(card) not in new_case_id_set:
                        continue
                    nodes.append(auto_feature_chain_node(chain_id_for_node, next_index, card))
                    next_index += 1
                registry["chains"] = chains
                write_feature_chains(ctx, registry)
                run_covered_ids.update(new_case_ids)
                attached.append(f"{existing_chain.get('id', 'unknown')}: {title} (+{len(new_case_ids)} bad cases)")
            else:
                skipped.append(f"{title}: existing chain requires explicit review")
            continue
        case_ids = [case_id for case_id in case_ids if case_id not in run_covered_ids]
        if len(case_ids) < max(1, min_cases):
            skipped.append(f"{title}: already covered by expanded proposed chains")
            continue
        group_cards = [card for card in group_cards if bad_case_card_id(card) in set(case_ids)]
        chain_id = next_feature_chain_id(ctx)
        chain = {
            "id": chain_id,
            "title": title,
            "status": "proposed",
            "run_policy": RUN_ALWAYS_POLICY,
            "entry": f"触发「{title}」相关用户流程",
            "exit_check": f"「{title}」相关结果保持用户可见的正确状态",
            "command": "",
            "timeout_seconds": 300,
            "artifact_policy": "cleanup-on-pass",
            "resource": "local",
            "created": today,
            "source": "feature-chain-auto-propose",
            "auto_proposed": True,
            "auto_group_key": group_key,
            "confirmation_required": True,
            "nodes": [
                auto_feature_chain_node(chain_id, index, card)
                for index, card in enumerate(group_cards, 1)
                if bad_case_card_id(card)
            ],
        }
        chains.append(chain)
        registry["chains"] = chains
        write_feature_chains(ctx, registry)
        existing_group_keys.add(group_key)
        run_covered_ids.update(case_ids)
        created.append(f"{chain_id}: {title} ({len(case_ids)} bad cases)")

    print("[context-guard] auto feature-chain proposal:")
    if created:
        print(f"- created proposed chains: {len(created)}")
        for item in created:
            print(f"  - {item}")
        print("[context-guard] next: ask the user to confirm the business flow before adding automation or approving these chains.")
    else:
        print("- created proposed chains: 0")
    if attached:
        print(f"- attached to proposed chains: {len(attached)}")
        for item in attached:
            print(f"  - {item}")
    if skipped:
        print(f"- skipped: {len(skipped)}")
        for item in skipped:
            print(f"  - {item}")
    if hook_mode:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(
            json.dumps({"version": 1, "seen_bad_cases": sorted(all_case_ids)}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"[context-guard] state: {state_path}")
    print(f"[context-guard] registry: {feature_chains_path(ctx)}")
    return 0


def validate_feature_chains(root: Path, strict: bool = False, verbose: bool = False) -> int:
    init_context(root)
    ctx = context_dir(root)
    registry = load_feature_chains(ctx)
    chains = [item for item in registry.get("chains", []) if isinstance(item, dict)]
    warnings: list[str] = []
    errors: list[str] = []

    for chain in chains:
        chain_id = str(chain.get("id") or chain.get("title") or "unknown").strip()
        label = f"{chain_id}: {str(chain.get('title') or 'untitled').strip()}"
        status = str(chain.get("status", "")).strip().lower()
        run_policy = str(chain.get("run_policy", chain.get("run policy", ""))).strip()
        command = str(chain.get("command", "")).strip()
        chain_type = str(chain.get("type", "")).strip().lower()
        artifact_policy = str(chain.get("artifact_policy", "")).strip()
        nodes = [node for node in chain.get("nodes", []) if isinstance(node, dict)]

        def warn(message: str) -> None:
            warnings.append(f"{label}: {message}")

        def error(message: str) -> None:
            errors.append(f"{label}: {message}")

        if not chain_id:
            error("missing id")
        if not str(chain.get("title", "")).strip():
            error("missing title")
        if not str(chain.get("entry", "")).strip():
            error("missing entry")
        if not str(chain.get("exit_check", "")).strip():
            error("missing exit_check")
        if not run_policy:
            warn("missing run_policy")
        if artifact_policy not in {"cleanup-on-pass", "preserve-on-fail", "manual-preserve"}:
            warn("artifact_policy should be cleanup-on-pass, preserve-on-fail, or manual-preserve")
        if status in APPROVED_TEST_STATUSES and run_policy == RUN_ALWAYS_POLICY:
            if not command:
                error("approved every-dev-completion chain must have an automated command")
            if not nodes:
                error("approved every-dev-completion chain must have at least one checkpoint node")
            if chain_type == "manual":
                warn("approved every-dev-completion chain is marked manual")

        for node in nodes:
            node_label = str(node.get("title") or node.get("id") or "unknown-node").strip()
            checks = node.get("checks", [])
            bad_cases = node.get("bad_cases", [])
            checks_list = checks if isinstance(checks, list) else []
            bad_case_list = bad_cases if isinstance(bad_cases, list) else []
            optional_reason = str(node.get("optional_reason") or node.get("required_reason") or "").strip()
            if not node_label:
                error("checkpoint node missing title/id")
            if not [str(item).strip() for item in checks_list if str(item).strip()]:
                warn(f"checkpoint `{node_label}` has no check text")
            if not [str(item).strip() for item in bad_case_list if str(item).strip()]:
                pending_reason = str(node.get("coverage_pending_reason") or "").strip()
                if status == "proposed" and pending_reason:
                    warn(f"checkpoint `{node_label}` is pending bad-case coverage: {pending_reason}")
                else:
                    warn(f"checkpoint `{node_label}` has no linked bad case coverage")
            if is_optional_feature_checkpoint(node) and not optional_reason:
                warn(f"optional checkpoint `{node_label}` should record why it is not required every run")

    visible_warnings = warnings if verbose else warnings[:8]
    for item in visible_warnings:
        print(f"[context-guard] warning: feature chain {item}")
    if len(warnings) > len(visible_warnings):
        print(f"[context-guard] warning: {len(warnings) - len(visible_warnings)} more feature-chain warning(s); rerun with --verbose to show all.")
    for item in errors:
        print(f"[context-guard] error: feature chain {item}", file=sys.stderr)
    if errors or (strict and warnings):
        print(
            f"[context-guard] feature-chain validation failed: {len(errors)} error(s), {len(warnings)} warning(s).",
            file=sys.stderr,
        )
        return 1
    print(f"[context-guard] feature-chain validation passed: {len(chains)} chain(s), {len(warnings)} warning(s).")
    return 0


def feature_chain_terms(text: str) -> set[str]:
    lowered = text.lower()
    terms = set(re.findall(r"[a-z0-9_./:-]{2,}", lowered))
    for chunk in re.findall(r"[\u4e00-\u9fff]+", lowered):
        if len(chunk) < 2:
            continue
        terms.add(chunk)
        terms.update(chunk[index : index + 2] for index in range(len(chunk) - 1))
    return {term for term in terms if term.strip()}


def score_feature_chain_text(query_terms: set[str], text: str, weight: int = 1) -> int:
    if not query_terms or not text:
        return 0
    lowered = text.lower()
    text_terms = feature_chain_terms(text)
    score = 0
    for term in query_terms:
        if term in text_terms:
            score += 2 * weight
        elif term in lowered:
            score += weight
    return score


def feature_chain_match_evidence(query_text: str, target_text: str, max_terms: int = 5) -> list[str]:
    shared = feature_chain_terms(query_text) & feature_chain_terms(target_text)
    evidence: list[str] = []
    for term in sorted(shared, key=lambda item: (-len(item), item)):
        if len(evidence) >= max_terms:
            break
        if not term or term in FEATURE_CHAIN_MATCH_EVIDENCE_STOP_TERMS:
            continue
        if term.startswith("bc-") or re.fullmatch(r"\d+", term):
            continue
        if re.search(r"[\u4e00-\u9fff]", term) and len(term) > 4:
            continue
        if re.fullmatch(r"[a-z0-9_./:-]+", term) and len(term) < 3:
            continue
        evidence.append(term)
    return evidence


def feature_chain_candidate_text(chain: dict[str, object], node: dict[str, object] | None = None) -> str:
    parts = [
        str(chain.get(key, ""))
        for key in ("title", "entry", "exit_check", "resource", "source")
    ]
    if node:
        parts.extend(
            [
                str(node.get("title", "")),
                str(node.get("id", "")),
                str(node.get("coverage_pending_reason", "")),
            ]
        )
        checks = node.get("checks", [])
        bad_cases = node.get("bad_cases", [])
        if isinstance(checks, list):
            parts.extend(str(item) for item in checks)
        if isinstance(bad_cases, list):
            parts.extend(str(item) for item in bad_cases)
    return " ".join(part for part in parts if part.strip())


def feature_chain_scored_candidates(
    query_terms: set[str], chains: list[dict[str, object]]
) -> list[tuple[int, dict[str, object], list[tuple[int, dict[str, object]]]]]:
    candidates: list[tuple[int, dict[str, object], list[tuple[int, dict[str, object]]]]] = []
    for chain in chains:
        chain_text = " ".join(
            str(chain.get(key, ""))
            for key in ("title", "entry", "exit_check", "resource", "source")
        )
        chain_score = score_feature_chain_text(query_terms, chain_text, weight=2)
        node_scores: list[tuple[int, dict[str, object]]] = []
        for node in chain.get("nodes", []):
            if not isinstance(node, dict):
                continue
            node_text_parts = [
                str(node.get("title", "")),
                str(node.get("id", "")),
                str(node.get("coverage_pending_reason", "")),
            ]
            checks = node.get("checks", [])
            bad_cases = node.get("bad_cases", [])
            if isinstance(checks, list):
                node_text_parts.extend(str(item) for item in checks)
            if isinstance(bad_cases, list):
                node_text_parts.extend(str(item) for item in bad_cases)
            node_score = score_feature_chain_text(query_terms, " ".join(node_text_parts), weight=3)
            if node_score:
                node_scores.append((node_score, node))
        node_scores.sort(key=lambda item: item[0], reverse=True)
        total_score = chain_score + sum(score for score, _node in node_scores[:3])
        if total_score:
            candidates.append((total_score, chain, node_scores[:3]))
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates


def feature_chain_best_match_for_text(
    text: str, chains: list[dict[str, object]]
) -> tuple[int, dict[str, object], int, dict[str, object] | None] | None:
    candidates = feature_chain_scored_candidates(feature_chain_terms(text), chains)
    if not candidates:
        return None
    score, chain, node_scores = candidates[0]
    if node_scores:
        node_score, node = node_scores[0]
        return score, chain, node_score, node
    return score, chain, 0, None


def bad_case_search_text(card: dict[str, str]) -> str:
    fields = [
        bad_case_card_id(card),
        bad_case_card_label(card),
        card.get("tags", ""),
        card.get("display summary", ""),
        card.get("phenomenon", ""),
        card.get("trigger / reproduction", ""),
        card.get("root cause", ""),
        card.get("fix method", ""),
        card.get("guard / verification", ""),
        card.get("red condition", ""),
        card.get("expected failure reason", ""),
    ]
    return " ".join(str(item) for item in fields if str(item).strip())


def cleaned_feature_chain_subject(text: str) -> str:
    compact = " ".join(str(text).split())
    compact = re.sub(
        r"^(请|帮我|麻烦)?\s*(写|创建|生成|设计|新增|添加|建立|做)\s*(一个|一条|一套)?\s*(测试任务|测试用例|测试|test case|task case)\s*[,，:：]?\s*",
        "",
        compact,
        flags=re.IGNORECASE,
    )
    compact = re.sub(
        r"^(用来|用于|检验|验证|检查|确认|确保|覆盖)\s*(每次开发完成后|开发完成后|每次改完后|每次修改后)?\s*",
        "",
        compact,
        flags=re.IGNORECASE,
    )
    compact = re.sub(
        r"^(write|create|add|design|generate)\s+(a|an)?\s*(test|test case|task case)\s*(to|that|for)?\s*",
        "",
        compact,
        flags=re.IGNORECASE,
    )
    compact = re.sub(r"^(verify|validate|check|ensure)\s+(that\s+)?", "", compact, flags=re.IGNORECASE)
    compact = re.sub(r"^(是否|能否)", "", compact)
    return compact.replace("都能", "能").strip(" ，,:：;；")


def compact_feature_chain_subject(text: str, max_chars: int = 64) -> str:
    compact = cleaned_feature_chain_subject(text)
    if not compact:
        compact = "用户描述的功能流程"
    if len(compact) <= max_chars:
        return compact
    return compact[: max_chars - 1].rstrip() + "…"


def feature_chain_plan_subject(query: str, expanded_cards: list[dict[str, str]]) -> str:
    if not expanded_cards:
        return compact_feature_chain_subject(query)
    card = expanded_cards[0]
    label = human_title(card.get("title", "")).strip()
    summary = str(card.get("display summary", "")).strip()
    return compact_feature_chain_subject(label or summary or bad_case_card_label(card))


def clean_goal_part(text: str, max_chars: int = 44) -> str:
    cleaned = str(text).strip()
    cleaned = re.sub(r"^(这个|该|这个流程|该流程)\s*", "", cleaned)
    cleaned = cleaned.strip(" 「」\"'`，,:：;；。")
    cleaned = re.sub(r"\s+", " ", cleaned)
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[: max_chars - 1].rstrip() + "…"


def parse_feature_chain_goal(query: str, expanded_cards: list[dict[str, str]]) -> dict[str, str] | None:
    if expanded_cards:
        return None
    compact = cleaned_feature_chain_subject(query)
    if not compact:
        return None

    match = re.search(r"从\s*(?P<entry>.+?)\s*到\s*(?P<rest>.+)$", compact, flags=re.IGNORECASE)
    if match:
        entry = clean_goal_part(match.group("entry"))
        rest = match.group("rest").strip()
        risk = ""
        risk_match = re.search(
            r"(?P<exit>.+?)[,，;；。]?\s*(?:主要)?(?:验证|检验|检查|确认|确保|覆盖|防止|避免)\s*(?P<risk>.+)$",
            rest,
            flags=re.IGNORECASE,
        )
        if risk_match:
            exit_check = clean_goal_part(risk_match.group("exit"))
            risk = clean_goal_part(risk_match.group("risk"))
        else:
            exit_check = clean_goal_part(rest)
        if entry and exit_check:
            return {
                "entry": entry,
                "exit": exit_check,
                "risk": risk or "这个流程里的复发风险",
            }

    english_match = re.search(
        r"from\s+(?P<entry>.+?)\s+to\s+(?P<rest>.+)$",
        compact,
        flags=re.IGNORECASE,
    )
    if english_match:
        entry = clean_goal_part(english_match.group("entry"))
        rest = english_match.group("rest").strip()
        risk = ""
        risk_match = re.search(
            r"(?P<exit>.+?)[,;.]?\s*(?:mainly\s+)?(?:verify|validate|check|ensure|cover|prevent)\s+(?P<risk>.+)$",
            rest,
            flags=re.IGNORECASE,
        )
        if risk_match:
            exit_check = clean_goal_part(risk_match.group("exit"))
            risk = clean_goal_part(risk_match.group("risk"))
        else:
            exit_check = clean_goal_part(rest)
        if entry and exit_check:
            return {
                "entry": entry,
                "exit": exit_check,
                "risk": risk or "recurrence risk in this workflow",
            }
    return None


def feature_chain_confirmation_prompt(query: str, expanded_cards: list[dict[str, str]]) -> str:
    goal = parse_feature_chain_goal(query, expanded_cards)
    if goal:
        return (
            "测试创建识别：我会先把测试目标确认成一句话："
            f"从「{goal['entry']}」到「{goal['exit']}」，主要验证「{goal['risk']}」。"
        )
    plan_subject = feature_chain_plan_subject(query, expanded_cards)
    return (
        "测试创建识别：我会先把测试目标确认成一句话："
        f"从「{plan_subject}」相关入口到用户可见的正确结果，主要验证这个流程里的复发风险。"
    )


def feature_chain_plan_command_parts(query: str, expanded_cards: list[dict[str, str]]) -> dict[str, str]:
    goal = parse_feature_chain_goal(query, expanded_cards)
    if goal:
        return {
            "title": "<confirmed feature title>",
            "entry": goal["entry"],
            "exit": goal["exit"],
            "checkpoint": goal["risk"],
        }
    if expanded_cards:
        subject = feature_chain_plan_subject(query, expanded_cards)
        return {
            "title": "<confirmed feature title>",
            "entry": "<confirmed user-visible entry>",
            "exit": "<confirmed strict final green condition>",
            "checkpoint": subject,
        }
    return {
        "title": "<confirmed feature title>",
        "entry": "<confirmed user-visible entry>",
        "exit": "<confirmed strict final green condition>",
        "checkpoint": "<confirmed recurrence checkpoint>",
    }


def expand_feature_chain_query_from_bad_cases(ctx: Path, query: str) -> tuple[str, list[dict[str, str]]]:
    path = ctx / "bad-cases.md"
    if not path.exists():
        return query, []
    cards = parse_bad_case_cards(path.read_text(encoding="utf-8"))
    if not cards:
        return query, []

    query_lower = query.lower()
    query_ids = set(re.findall(r"BC-\d{8}-\d+", query))
    matched: list[dict[str, str]] = []
    for card in cards:
        case_id = bad_case_card_id(card)
        label = bad_case_card_label(card).lower()
        if case_id and case_id in query_ids:
            matched.append(card)
            continue
        if label and (query_lower == label or label in query_lower):
            matched.append(card)

    if not matched:
        return query, []
    expanded = " ".join([query] + [bad_case_search_text(card) for card in matched])
    return expanded, matched


def feature_chain_suggest(root: Path, query: str, max_results: int = 5) -> int:
    init_context(root)
    ctx = context_dir(root)
    query = query.strip()
    if not query:
        raise ValueError("feature-chain-suggest requires --query")
    registry = load_feature_chains(ctx)
    chains = [item for item in registry.get("chains", []) if isinstance(item, dict)]
    expanded_query, expanded_cards = expand_feature_chain_query_from_bad_cases(ctx, query)
    query_terms = feature_chain_terms(expanded_query)
    candidates = feature_chain_scored_candidates(query_terms, chains)
    print(f"[context-guard] feature-chain query: {query}")
    if expanded_cards:
        labels = ", ".join(
            f"{bad_case_card_id(card) or '-'} {bad_case_card_label(card)}".strip()
            for card in expanded_cards
        )
        print(f"[context-guard] query expanded from bad-case register: {labels}")
    if not candidates:
        print("[context-guard] feature-chain candidates: none")
        print("[context-guard] proposal-needed: no matching feature chain; draft a proposed chain and ask the user before creating durable coverage.")
        print(f"[context-guard] registry: {feature_chains_path(ctx)}")
        return 0

    print("[context-guard] feature-chain candidates:")
    for score, chain, node_scores in candidates[: max(1, max_results)]:
        chain_id = str(chain.get("id", "unknown"))
        title = str(chain.get("title", "untitled"))
        status = str(chain.get("status", "unknown"))
        entry = str(chain.get("entry", ""))
        print(f"- {chain_id} | score={score} | {status} | {title}")
        if entry:
            print(f"  entry: {entry}")
        if node_scores:
            for node_score, node in node_scores:
                node_title = str(node.get("title") or node.get("id") or "checkpoint")
                print(f"  checkpoint candidate: {node_title} (score={node_score})")
        else:
            print("  checkpoint candidate: create a proposed checkpoint under this chain after user confirmation")
    print("[context-guard] next: attach the bad case to a candidate checkpoint only when the match is semantically correct; otherwise propose a new chain.")
    print(f"[context-guard] registry: {feature_chains_path(ctx)}")
    return 0


def feature_chain_plan(root: Path, query: str, max_results: int = 3) -> int:
    init_context(root)
    ctx = context_dir(root)
    query = query.strip()
    if not query:
        raise ValueError("feature-chain-plan requires --query")
    registry = load_feature_chains(ctx)
    chains = [item for item in registry.get("chains", []) if isinstance(item, dict)]
    expanded_query, expanded_cards = expand_feature_chain_query_from_bad_cases(ctx, query)
    candidates = feature_chain_scored_candidates(feature_chain_terms(expanded_query), chains)
    script_path = str(context_guard_skill_root() / "scripts" / "context_guard.py")
    print(f"[context-guard] feature-chain plan: {query}")
    if expanded_cards:
        labels = ", ".join(
            f"{bad_case_card_id(card) or '-'} {bad_case_card_label(card)}".strip()
            for card in expanded_cards
        )
        print(f"[context-guard] query expanded from bad-case register: {labels}")

    strong_candidates = [
        (score, chain, node_scores)
        for score, chain, node_scores in candidates
        if score >= FEATURE_CHAIN_COVERAGE_SUGGESTION_MIN_SCORE
    ]
    if strong_candidates:
        print("[context-guard] action: review-existing-chain")
        print("[context-guard] meaning: a durable test may already exist; do not create a new chain unless the match is semantically wrong.")
        for score, chain, node_scores in strong_candidates[: max(1, max_results)]:
            chain_id = str(chain.get("id") or "unknown")
            title = str(chain.get("title") or "untitled")
            status = str(chain.get("status") or "unknown")
            run_policy = str(chain.get("run_policy") or "unset")
            print(f"- chain: {chain_id} | score={score} | {status} | {run_policy} | {title}")
            node: dict[str, object] | None = None
            if node_scores:
                node_score, node = node_scores[0]
                node_title = str(node.get("title") or node.get("id") or "checkpoint")
                print(f"  checkpoint: {node_title} (score={node_score})")
            evidence = feature_chain_match_evidence(
                expanded_query,
                feature_chain_candidate_text(chain, node),
            )
            if evidence:
                print(f"  match evidence: {', '.join(evidence)}")
            node_title_for_command = str((node or {}).get("title") or (node or {}).get("id") or "<confirmed checkpoint>").strip()
            expanded_ids = [bad_case_card_id(card) for card in expanded_cards if bad_case_card_id(card)]
            if expanded_ids:
                for case_id in expanded_ids:
                    command = " ".join(
                        shlex.quote(part)
                        for part in [
                            "python3",
                            script_path,
                            "feature-chain-attach-bc",
                            "--root",
                            str(root),
                            "--chain-id",
                            chain_id,
                            "--node-title",
                            node_title_for_command,
                            "--bad-case",
                            case_id,
                            "--check",
                            "<tighten checkpoint based on confirmed symptom>",
                        ]
                    )
                    print(f"  after-confirmation command: {command}")
            else:
                print("  after-confirmation command: record the bad case first, then attach it to this chain/checkpoint.")
        print("[context-guard] next: if the user confirms the match, attach the bad case to the listed checkpoint and strengthen that checkpoint; otherwise keep it unassigned and propose a new chain.")
    else:
        print("[context-guard] action: propose-new-chain")
        print("[context-guard] meaning: no strong existing feature chain matched this bad case or workflow.")
        print(
            "[context-guard] confirmation prompt: "
            f"{feature_chain_confirmation_prompt(query, expanded_cards)}"
        )
        command_parts = feature_chain_plan_command_parts(query, expanded_cards)
        if command_parts["checkpoint"] != "<confirmed recurrence checkpoint>":
            print(f"[context-guard] suggested checkpoint after confirmation: {command_parts['checkpoint']}")
        command_tokens = [
            "python3",
            script_path,
            "feature-chain-propose",
            "--root",
            str(root),
            "--title",
            command_parts["title"],
            "--entry",
            command_parts["entry"],
            "--exit-check",
            command_parts["exit"],
            "--node-title",
            command_parts["checkpoint"],
            "--check",
            "<confirmed checkpoint check>",
        ]
        expanded_ids = [bad_case_card_id(card) for card in expanded_cards if bad_case_card_id(card)]
        if expanded_ids:
            command_tokens.extend(["--bad-cases", ",".join(expanded_ids)])
        else:
            command_tokens.extend(
                [
                    "--coverage-pending-reason",
                    "<confirmed reason this chain has no linked bad case yet>",
                ]
            )
        command = " ".join(
            shlex.quote(part)
            for part in command_tokens
        )
        print(f"[context-guard] after-confirmation command: {command}")
        print("[context-guard] next: ask the user to confirm the business flow before running feature-chain-propose or writing durable automation.")
    print(f"[context-guard] registry: {feature_chains_path(ctx)}")
    return 0


def test_hub_add(
    root: Path,
    title: str,
    command_text: str,
    run_policy: str = RUN_ALWAYS_POLICY,
    status: str = "approved",
    timeout_seconds: int = 300,
    artifact_policy: str = "cleanup-on-pass",
    resource: str = "local",
) -> Path:
    init_context(root)
    ctx = context_dir(root)
    if not title.strip():
        raise ValueError("test-hub-add requires --title")
    if not command_text.strip():
        raise ValueError("test-hub-add requires --command-text")
    registry = load_test_registry(ctx)
    tests = registry.setdefault("tests", [])
    if not isinstance(tests, list):
        tests = []
        registry["tests"] = tests
    test_id = next_test_id(ctx, title)
    tests.append(
        {
            "id": test_id,
            "title": title.strip(),
            "status": status.strip() or "approved",
            "run_policy": run_policy.strip() or RUN_ALWAYS_POLICY,
            "type": "command",
            "command": command_text.strip(),
            "cwd": ".",
            "resource": resource.strip() or "local",
            "timeout_seconds": int(timeout_seconds),
            "artifact_policy": artifact_policy.strip() or "cleanup-on-pass",
            "blocker_keywords": BLOCKER_PATTERNS,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "source": "human-approved registry entry",
        }
    )
    path = write_test_registry(ctx, registry)
    print(f"[context-guard] registered test: {test_id}")
    print(f"[context-guard] registry: {path}")
    return path


def test_hub_registry_tests(ctx: Path) -> list[dict[str, object]]:
    registry = load_test_registry(ctx)
    return [item for item in registry.get("tests", []) if isinstance(item, dict)]


def test_hub_find_registry_test(ctx: Path, test_id: str) -> tuple[dict[str, object], list[dict[str, object]], dict[str, object]]:
    registry = load_test_registry(ctx)
    tests = registry.setdefault("tests", [])
    if not isinstance(tests, list):
        tests = []
        registry["tests"] = tests
    matches = [item for item in tests if isinstance(item, dict) and str(item.get("id", "")) == test_id]
    if not matches:
        raise ValueError(f"test not found in registry: {test_id}")
    return matches[0], tests, registry


def test_hub_list(root: Path) -> int:
    init_context(root)
    ctx = context_dir(root)
    registry_tests = test_hub_registry_tests(ctx)
    task_case_tests = discover_task_case_tests(ctx)
    feature_chain_tests = approved_feature_chain_tests(ctx)
    if not registry_tests and not task_case_tests and not feature_chain_tests:
        print("[context-guard] test hub: no registered tests.")
        print(f"[context-guard] registry: {test_registry_path(ctx)}")
        return 0
    if registry_tests:
        print("[context-guard] registry tests:")
        for test in registry_tests:
            test_id = str(test.get("id", "unknown"))
            title = str(test.get("title", "untitled"))
            status = str(test.get("status", "unknown"))
            run_policy = str(test.get("run_policy", test.get("run policy", "unset")))
            command = str(test.get("command", "")).strip()
            command_suffix = f" | {command}" if command else ""
            print(f"- {test_id} | {status} | {run_policy} | {title}{command_suffix}")
    if task_case_tests:
        print("[context-guard] approved task-case tests:")
        for test in task_case_tests:
            test_id = str(test.get("id", "unknown"))
            title = str(test.get("title", "untitled"))
            source = str(test.get("source", "task-cases"))
            print(f"- {test_id} | {test.get('status')} | {test.get('run_policy')} | {title} | {source}")
    if feature_chain_tests:
        print("[context-guard] approved feature-chain tests:")
        for test in feature_chain_tests:
            test_id = str(test.get("id", "unknown"))
            title = str(test.get("title", "untitled"))
            source = str(test.get("source", "feature-chain"))
            covered = test.get("covered_bad_cases", [])
            covered_suffix = ""
            if isinstance(covered, list) and covered:
                covered_suffix = f" | covers {', '.join(str(item) for item in covered)}"
            print(f"- {test_id} | {test.get('status')} | {test.get('run_policy')} | {title} | {source}{covered_suffix}")
    print(f"[context-guard] registry: {test_registry_path(ctx)}")
    return 0


def read_test_hub_last_run(root: Path) -> dict[str, object]:
    path = test_hub_dir(root) / "last-run.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def feature_chain_checkpoint_policy(test: dict[str, object]) -> dict[str, object]:
    nodes = [node for node in test.get("nodes", []) if isinstance(node, dict)]
    checkpoints: list[dict[str, object]] = []
    optional_count = 0
    for node in nodes:
        optional = is_optional_feature_checkpoint(node)
        if optional:
            optional_count += 1
        checkpoints.append(
            {
                "title": str(node.get("title") or node.get("id") or "checkpoint").strip(),
                "policy": "optional" if optional else "required",
                "reason": str(node.get("optional_reason") or node.get("required_reason") or "").strip(),
            }
        )
    return {
        "total": len(nodes),
        "required": len(nodes) - optional_count,
        "optional": optional_count,
        "checkpoints": checkpoints,
    }


def test_hub_state(root: Path) -> dict[str, object]:
    init_context(root)
    ctx = context_dir(root)
    registry_tests = test_hub_registry_tests(ctx)
    task_case_tests = discover_task_case_tests(ctx)
    feature_chain_tests = approved_feature_chain_tests(ctx)
    tests: list[dict[str, object]] = []
    for source, items in (("registry", registry_tests), ("task-case", task_case_tests), ("feature-chain", feature_chain_tests)):
        for item in items:
            status = str(item.get("status", "unknown")).strip() or "unknown"
            run_policy = str(item.get("run_policy", item.get("run policy", "unset"))).strip() or "unset"
            command = str(item.get("command", "")).strip()
            normalized = {
                "id": str(item.get("id", "")),
                "title": str(item.get("title", "untitled")),
                "status": status,
                "run_policy": run_policy,
                "type": str(item.get("type") or ("command" if command else "manual")),
                "command": command,
                "resource": str(item.get("resource", "local") or "local"),
                "source": source,
                "eligible": status.lower() in APPROVED_TEST_STATUSES and run_policy == RUN_ALWAYS_POLICY,
            }
            if source == "feature-chain":
                normalized["checkpoint_policy"] = feature_chain_checkpoint_policy(item)
            tests.append(normalized)
    last_run = read_test_hub_last_run(root)
    results = last_run.get("results", [])
    if not isinstance(results, list):
        results = []
    counts = {
        "total": len(tests),
        "eligible": sum(1 for test in tests if test.get("eligible")),
        "passed": sum(1 for item in results if isinstance(item, dict) and item.get("status") == "passed"),
        "failed": sum(1 for item in results if isinstance(item, dict) and item.get("status") == "failed"),
        "blocked": sum(1 for item in results if isinstance(item, dict) and item.get("status") == "blocked"),
    }
    return {
        "root": str(root),
        "registry": str(test_registry_path(ctx)),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "tests": tests,
        "last_run": last_run,
        "counts": counts,
    }


def test_hub_badge(text: object, class_name: str = "") -> str:
    return f'<span class="badge {class_name}">{html.escape(str(text))}</span>'


def render_test_hub_html(root: Path) -> str:
    state = test_hub_state(root)
    tests = [item for item in state["tests"] if isinstance(item, dict)]
    last_run = state.get("last_run", {})
    results = last_run.get("results", []) if isinstance(last_run, dict) else []
    result_by_id = {
        str(item.get("id", "")): item
        for item in results
        if isinstance(item, dict)
    }
    rows = []
    for test in tests:
        eligible = bool(test.get("eligible"))
        status = str(test.get("status", "unknown"))
        run_policy = str(test.get("run_policy", "unset"))
        result = result_by_id.get(str(test.get("id", "")), {})
        result_status = str(result.get("status", "未运行")) if result else "未运行"
        result_class = {
            "passed": "ok",
            "failed": "bad",
            "blocked": "warn",
            "未运行": "muted",
        }.get(result_status, "muted")
        command = str(test.get("command", "")).strip()
        command_html = f"<code>{html.escape(command)}</code>" if command else '<span class="muted">人工判断 / 未注册脚本</span>'
        checkpoint_policy = test.get("checkpoint_policy")
        checkpoint_html = ""
        if isinstance(checkpoint_policy, dict) and int(checkpoint_policy.get("total") or 0) > 0:
            checkpoints = checkpoint_policy.get("checkpoints", [])
            checkpoint_rows: list[str] = []
            if isinstance(checkpoints, list):
                for checkpoint in checkpoints:
                    if not isinstance(checkpoint, dict):
                        continue
                    title = html.escape(str(checkpoint.get("title") or "checkpoint"))
                    policy = str(checkpoint.get("policy") or "required")
                    policy_text = "可选" if policy == "optional" else "必跑"
                    policy_class = "muted" if policy == "optional" else "ok"
                    reason = str(checkpoint.get("reason") or "").strip()
                    reason_html = f'<span class="checkpoint-reason">{html.escape(reason)}</span>' if reason else ""
                    checkpoint_rows.append(
                        f'<li><span>{title}</span>{test_hub_badge(policy_text, policy_class)}{reason_html}</li>'
                    )
            if checkpoint_rows:
                checkpoint_html = f"""
              <div class="checkpoint-policy">
                <p>检查点策略：{html.escape(str(checkpoint_policy.get("required", 0)))} 必跑 / {html.escape(str(checkpoint_policy.get("optional", 0)))} 可选</p>
                <ul>{''.join(checkpoint_rows)}</ul>
              </div>
                """
        rows.append(
            f"""
            <article class="test-card">
              <div class="card-head">
                <div>
                  <h2>{html.escape(str(test.get("title", "未命名测试")))}</h2>
                  <div class="meta">
                    {test_hub_badge("每次开发后运行" if eligible else "不自动运行", "ok" if eligible else "muted")}
                    {test_hub_badge(status)}
                    {test_hub_badge(str(test.get("source", "")))}
                  </div>
                </div>
                <span class="result {result_class}">{html.escape(result_status)}</span>
              </div>
              <p class="command">{command_html}</p>
              {checkpoint_html}
              <p class="subtle">策略：{html.escape(run_policy)} · 资源：{html.escape(str(test.get("resource", "local")))}</p>
            </article>
            """
        )
    if not rows:
        rows.append(
            """
            <article class="empty">
              <h2>还没有测试</h2>
              <p>用户确认测试后，会显示在这里。未确认的 bad case guard 不会自动变成测试。</p>
            </article>
            """
        )

    last_run_text = "暂无运行记录"
    if isinstance(last_run, dict) and last_run.get("created_at"):
        counts = state.get("counts", {})
        last_run_text = (
            f"{last_run.get('created_at')} · "
            f"{counts.get('passed', 0)} 通过 / {counts.get('failed', 0)} 失败 / {counts.get('blocked', 0)} 阻塞"
        )
    state_json = json.dumps(state, ensure_ascii=False).replace("</", "<\\/")
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Context Guard 测试中台</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f4f7ef;
      --panel: #fffff8;
      --card: #fffef7;
      --ink: #243125;
      --muted: #64705d;
      --line: #cddcc5;
      --accent: #37745b;
      --accent-soft: #e4f2e8;
      --warn: #b0733f;
      --warn-soft: #f8ead9;
      --ok: #2f7d63;
      --ok-soft: #dff1e7;
      --danger: #b94c4c;
      --quiet: #99a78f;
      --shadow: 0 14px 34px rgba(51, 83, 57, 0.12);
      --radius: 8px;
      --font-body: "Avenir Next", "Gill Sans", "PingFang SC", "Hiragino Sans GB", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-heading: "Iowan Old Style", "Charter", "Songti SC", "STSong", Georgia, serif;
      --board-texture: radial-gradient(circle at 20% 15%, rgba(93, 135, 83, 0.12), transparent 24%), radial-gradient(circle at 82% 4%, rgba(183, 143, 92, 0.12), transparent 20%);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font: 14px/1.58 var(--font-body);
      text-rendering: optimizeLegibility;
    }}
    header {{
      padding: 22px 32px 14px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }}
    .header-row {{
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }}
    .shell {{
      padding: 16px 32px 30px;
    }}
    h1 {{
      margin: 0 0 4px;
      font-family: var(--font-heading);
      font-size: 24px;
      letter-spacing: 0;
    }}
    h2 {{
      margin: 0;
      font-family: var(--font-heading);
      font-size: 15px;
      line-height: 1.35;
      letter-spacing: 0;
    }}
    p {{ margin: 0; }}
    .subtle, .muted {{ color: var(--muted); }}
    .actions {{ display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }}
    .hub-board {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 16px;
      background-image: var(--board-texture);
    }}
    .board-head {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }}
    .summary {{
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }}
    .metric, .test-card, .empty {{
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.75), 0 8px 20px rgba(51, 83, 57, 0.08);
    }}
    .metric {{ padding: 10px 12px; }}
    .metric span {{ color: var(--muted); font-size: 11px; }}
    .metric strong {{
      display: block;
      margin-top: 2px;
      font-family: var(--font-heading);
      font-size: 20px;
      line-height: 1.1;
      color: var(--accent);
    }}
    .grid {{ display: grid; gap: 14px; }}
    .test-card {{
      border-top: 4px solid var(--accent);
      padding: 12px;
    }}
    .card-head {{ display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }}
    .meta {{ display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }}
    .badge {{
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 8px;
      background: color-mix(in srgb, var(--accent-soft) 62%, #fff);
      color: var(--muted);
      font-size: 11px;
      font-weight: 680;
    }}
    .badge.ok {{ background: var(--ok-soft); color: var(--ok); }}
    .badge.muted {{ color: var(--muted); }}
    .result {{
      flex: 0 0 auto;
      min-width: 58px;
      text-align: center;
      border-radius: 999px;
      padding: 3px 9px;
      font-size: 11px;
      font-weight: 760;
      background: color-mix(in srgb, var(--accent-soft) 62%, #fff);
    }}
    .result.ok {{ background: var(--ok-soft); color: var(--ok); }}
    .result.bad {{ background: #f8dfe0; color: var(--danger); }}
    .result.warn {{ background: var(--warn-soft); color: var(--warn); }}
    .result.muted {{ color: var(--muted); }}
    .command {{ margin: 12px 0 7px; }}
    .checkpoint-policy {{
      margin: 10px 0 8px;
      border-top: 1px solid var(--line);
      padding-top: 9px;
    }}
    .checkpoint-policy p {{
      margin-bottom: 5px;
      color: var(--accent);
      font-weight: 760;
      font-size: 12px;
    }}
    .checkpoint-policy ul {{
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 5px;
    }}
    .checkpoint-policy li {{
      display: flex;
      align-items: center;
      gap: 7px;
      flex-wrap: wrap;
      color: var(--ink);
      font-size: 12px;
    }}
    .checkpoint-reason {{ color: var(--muted); }}
    code {{
      display: inline-block;
      max-width: 100%;
      overflow: auto;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent-soft) 52%, #fff);
      border-radius: var(--radius);
      padding: 6px 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }}
    .empty {{ padding: 22px; text-align: center; }}
    @media (max-width: 760px) {{
      header, .shell {{ padding-left: 16px; padding-right: 16px; }}
      .header-row, .card-head, .board-head {{ flex-direction: column; align-items: flex-start; }}
      .summary {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
    }}
  </style>
</head>
<body>
  <header>
    <div class="header-row">
      <div>
        <h1>测试中台</h1>
        <p class="subtle">查看用户已确认的测试；开发结束时由 Context Guard 自动运行。</p>
      </div>
      <div class="actions">
        <p class="subtle">只读状态页</p>
      </div>
    </div>
  </header>

  <main class="shell">
    <section class="hub-board">
    <div class="board-head">
      <h2>测试列表</h2>
      <p class="subtle">上次运行：{html.escape(last_run_text)}</p>
    </div>
    <section class="summary" aria-label="测试概览">
      <div class="metric"><span>总测试</span><strong>{state["counts"]["total"]}</strong></div>
      <div class="metric"><span>自动运行</span><strong>{state["counts"]["eligible"]}</strong></div>
      <div class="metric"><span>上次通过</span><strong>{state["counts"]["passed"]}</strong></div>
      <div class="metric"><span>上次失败/阻塞</span><strong>{state["counts"]["failed"] + state["counts"]["blocked"]}</strong></div>
    </section>

    <section class="grid" aria-label="测试列表">
      {''.join(rows)}
    </section>
    </section>
  </main>
  <script>
    window.__TEST_HUB_STATE__ = {state_json};
  </script>
</body>
</html>
"""


def show_test_hub(root: Path, open_browser: bool = False) -> Path:
    init_context(root)
    hub = test_hub_dir(root)
    hub.mkdir(parents=True, exist_ok=True)
    path = hub / "test-hub.html"
    path.write_text(render_test_hub_html(root), encoding="utf-8")
    print(path)
    if open_browser:
        webbrowser.open(path.resolve().as_uri())
    return path


def serve_test_hub(root: Path, host: str, port: int, jobs: int, open_browser: bool = False) -> int:
    init_context(root)

    class TestHubHandler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def send_json(self, status: int, payload: dict[str, object]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path in {"/", "/test-hub.html"}:
                body = render_test_hub_html(root).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if path == "/api/state":
                self.send_json(200, test_hub_state(root))
                return
            self.send_json(404, {"error": "not found"})

        def do_POST(self) -> None:
            self.send_json(405, {"error": "test hub page is read-only; tests run from the Stop hook or `dev-complete`."})

    server = ThreadingHTTPServer((host, port), TestHubHandler)
    actual_host, actual_port = server.server_address[:2]
    url = f"http://{actual_host}:{actual_port}/test-hub.html"
    print(f"[context-guard] test hub: {url}")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[context-guard] test hub stopped.")
    finally:
        server.server_close()
    return 0


def test_hub_update_test(root: Path, test_id: str, **updates: object) -> Path:
    init_context(root)
    ctx = context_dir(root)
    item, _tests, registry = test_hub_find_registry_test(ctx, test_id)
    item.update({key: value for key, value in updates.items() if value is not None})
    item["updated_at"] = datetime.now().isoformat(timespec="seconds")
    path = write_test_registry(ctx, registry)
    print(f"[context-guard] updated test: {test_id}")
    print(f"[context-guard] registry: {path}")
    return path


def test_hub_remove(root: Path, test_id: str) -> Path:
    init_context(root)
    ctx = context_dir(root)
    _item, tests, registry = test_hub_find_registry_test(ctx, test_id)
    registry["tests"] = [item for item in tests if not (isinstance(item, dict) and str(item.get("id", "")) == test_id)]
    path = write_test_registry(ctx, registry)
    print(f"[context-guard] removed test: {test_id}")
    print(f"[context-guard] registry: {path}")
    return path


def parse_markdown_fields(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in text.splitlines():
        match = re.match(r"^\s*-\s*([^:]+):\s*(.*)$", line)
        if not match:
            continue
        key = " ".join(match.group(1).strip().lower().split())
        fields[key] = match.group(2).strip()
    return fields


def command_from_task_case_fields(fields: dict[str, str]) -> str:
    automation = fields.get("automation entry", "").strip().lower()
    entry = first_nonempty(fields.get("entry command/prompt", ""), fields.get("entry command", ""))
    if not entry or entry.lower() in {"none", "n/a", "manual"}:
        return ""
    if "manual" in automation or "prompt" in automation or automation == "none":
        return ""
    return strip_wrapping_backticks(entry)


def discover_task_case_tests(ctx: Path) -> list[dict[str, object]]:
    task_case_dir = ctx / "task-cases"
    if not task_case_dir.exists():
        return []
    tests: list[dict[str, object]] = []
    for path in sorted(task_case_dir.glob("*.md")):
        fields = parse_markdown_fields(path.read_text(encoding="utf-8"))
        status = fields.get("status", "").strip().lower()
        run_policy = fields.get("run policy", "").strip() or RUN_ALWAYS_POLICY
        if status not in APPROVED_TEST_STATUSES or run_policy != RUN_ALWAYS_POLICY:
            continue
        command = command_from_task_case_fields(fields)
        title = fields.get("title", "") or path.stem
        test_id = fields.get("id", "") or path.stem
        tests.append(
            {
                "id": test_id,
                "title": title,
                "status": status,
                "run_policy": run_policy,
                "type": "command" if command else "manual",
                "command": command,
                "cwd": ".",
                "resource": fields.get("resource", "local") or "local",
                "timeout_seconds": 300,
                "artifact_policy": fields.get("artifact policy", "cleanup-on-pass") or "cleanup-on-pass",
                "blocker_keywords": BLOCKER_PATTERNS,
                "source": str(path.relative_to(ctx.parent.parent)) if len(path.parts) > 2 else str(path),
            }
        )
    return tests


def approved_feature_chain_tests(ctx: Path) -> list[dict[str, object]]:
    registry = load_feature_chains(ctx)
    tests: list[dict[str, object]] = []
    for item in registry.get("chains", []):
        if not isinstance(item, dict):
            continue
        status = str(item.get("status", "")).strip().lower()
        run_policy = str(item.get("run_policy", item.get("run policy", ""))).strip()
        if status not in APPROVED_TEST_STATUSES or run_policy != RUN_ALWAYS_POLICY:
            continue
        command = str(item.get("command", "")).strip()
        nodes = [node for node in item.get("nodes", []) if isinstance(node, dict)]
        covered_bad_cases = sorted(
            {
                str(bc)
                for node in nodes
                for bc in (node.get("bad_cases", []) if isinstance(node.get("bad_cases", []), list) else [])
                if str(bc).strip()
            }
        )
        normalized = dict(item)
        normalized["id"] = str(item.get("id") or item.get("title") or "feature-chain")
        normalized["title"] = str(item.get("title") or normalized["id"])
        normalized["run_policy"] = run_policy
        normalized["type"] = "command" if command else "manual"
        normalized["command"] = command
        normalized.setdefault("cwd", ".")
        normalized.setdefault("timeout_seconds", 300)
        normalized.setdefault("artifact_policy", "cleanup-on-pass")
        normalized.setdefault("resource", "local")
        normalized.setdefault("blocker_keywords", BLOCKER_PATTERNS)
        normalized["source"] = "feature-chain"
        normalized["covered_bad_cases"] = covered_bad_cases
        tests.append(normalized)
    return tests


def approved_registry_tests(ctx: Path) -> list[dict[str, object]]:
    registry = load_test_registry(ctx)
    tests: list[dict[str, object]] = []
    for item in registry.get("tests", []):
        if not isinstance(item, dict):
            continue
        status = str(item.get("status", "")).strip().lower()
        run_policy = str(item.get("run_policy", item.get("run policy", ""))).strip()
        if status in APPROVED_TEST_STATUSES and run_policy == RUN_ALWAYS_POLICY:
            normalized = dict(item)
            normalized["run_policy"] = run_policy
            normalized.setdefault("type", "command" if normalized.get("command") else "manual")
            normalized.setdefault("timeout_seconds", 300)
            normalized.setdefault("artifact_policy", "cleanup-on-pass")
            normalized.setdefault("resource", "local")
            normalized.setdefault("blocker_keywords", BLOCKER_PATTERNS)
            tests.append(normalized)
    return tests


def approved_dev_completion_tests(ctx: Path) -> list[dict[str, object]]:
    by_id: dict[str, dict[str, object]] = {}
    for test in approved_registry_tests(ctx) + discover_task_case_tests(ctx) + approved_feature_chain_tests(ctx):
        test_id = str(test.get("id") or test.get("title") or "unnamed")
        by_id[test_id] = test
    return list(by_id.values())


def safe_relative_path(root: Path, value: str) -> Path | None:
    if not value:
        return None
    path = Path(strip_wrapping_backticks(value)).expanduser()
    if not path.is_absolute():
        path = root / path
    try:
        resolved = path.resolve()
        resolved.relative_to(root.resolve())
    except ValueError:
        return None
    return resolved


def cleanup_registered_paths(root: Path, cleanup_paths: object) -> list[str]:
    cleaned: list[str] = []
    if not isinstance(cleanup_paths, list):
        return cleaned
    for value in cleanup_paths:
        path = safe_relative_path(root, str(value))
        if not path or not path.exists():
            continue
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
        cleaned.append(str(path))
    return cleaned


def classify_test_blocker(output: str, keywords: object) -> str:
    patterns = list(BLOCKER_PATTERNS)
    if isinstance(keywords, list):
        patterns.extend(str(item) for item in keywords)
    for pattern in patterns:
        if pattern and pattern.lower() in output.lower():
            return pattern
    return ""


def parse_feature_chain_checkpoints(test: dict[str, object], output: str) -> list[dict[str, object]]:
    if str(test.get("source", "")) != "feature-chain":
        return []
    nodes = [node for node in test.get("nodes", []) if isinstance(node, dict)]
    labels: dict[str, str] = {}
    for node in nodes:
        title = str(node.get("title", "")).strip()
        node_id = str(node.get("id", "")).strip()
        if title:
            labels[title.lower()] = title
            labels[normalize_test_slug(title)] = title
        if node_id:
            labels[node_id.lower()] = title or node_id
            labels[normalize_test_slug(node_id)] = title or node_id

    checkpoints: list[dict[str, object]] = []
    for raw_line in output.splitlines():
        line = raw_line.strip()
        match = CHECKPOINT_MARKER_RE.match(line)
        if not match:
            continue
        name = match.group("name").strip()
        status = match.group("status").strip().lower()
        reason = (match.group("reason") or "").strip()
        label = labels.get(name.lower()) or labels.get(normalize_test_slug(name)) or name
        known = name.lower() in labels or normalize_test_slug(name) in labels
        checkpoints.append(
            {
                "name": name,
                "label": label,
                "status": status,
                "reason": reason,
                "known": known,
            }
        )
    return checkpoints


def is_optional_feature_checkpoint(node: dict[str, object]) -> bool:
    optional = str(node.get("optional", "")).strip().lower()
    required = str(node.get("required", "")).strip().lower()
    return optional in {"1", "true", "yes"} or required in {"0", "false", "no"}


def feature_chain_required_checkpoints(test: dict[str, object]) -> list[dict[str, object]]:
    if str(test.get("source", "")) != "feature-chain":
        return []
    required: list[dict[str, object]] = []
    for node in test.get("nodes", []):
        if not isinstance(node, dict) or is_optional_feature_checkpoint(node):
            continue
        title = str(node.get("title", "")).strip()
        node_id = str(node.get("id", "")).strip()
        label = title or node_id
        if not label:
            continue
        aliases = {label.lower(), normalize_test_slug(label)}
        if title:
            aliases.update({title.lower(), normalize_test_slug(title)})
        if node_id:
            aliases.update({node_id.lower(), normalize_test_slug(node_id)})
        required.append({"label": label, "aliases": sorted(aliases)})
    return required


def missing_feature_chain_checkpoints(
    test: dict[str, object], checkpoints: list[dict[str, object]]
) -> list[dict[str, object]]:
    required = feature_chain_required_checkpoints(test)
    if not required:
        return []
    seen: set[str] = set()
    for checkpoint in checkpoints:
        if not checkpoint.get("known"):
            continue
        for key in ("name", "label"):
            value = str(checkpoint.get(key, "")).strip()
            if value:
                seen.add(value.lower())
                seen.add(normalize_test_slug(value))
    return [item for item in required if not set(item.get("aliases", [])) & seen]


def run_one_hub_test(root: Path, run_dir: Path, test: dict[str, object]) -> dict[str, object]:
    test_id = str(test.get("id") or test.get("title") or "unnamed")
    title = str(test.get("title") or test_id)
    command = str(test.get("command") or "").strip()
    test_type = str(test.get("type") or ("command" if command else "manual")).lower()
    log_path = run_dir / f"{normalize_test_slug(test_id)}.log"
    if test_type in {"manual", "prompt"} or not command:
        result = {
            "id": test_id,
            "title": title,
            "status": "blocked",
            "reason": "user-judgment",
            "message": "No automated command is registered for this approved test.",
            "log": str(log_path),
        }
        log_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return result

    cwd_value = str(test.get("cwd") or ".")
    cwd = safe_relative_path(root, cwd_value) or root
    timeout = int(test.get("timeout_seconds") or 300)
    env = {
        **dict(os.environ),
        "CONTEXT_GUARD_PROJECT_ROOT": str(root),
        "CONTEXT_GUARD_TEST_ID": test_id,
        "CONTEXT_GUARD_TEST_RUN_DIR": str(run_dir),
    }
    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd),
            shell=True,
            text=True,
            capture_output=True,
            timeout=timeout,
            env=env,
        )
        output = (completed.stdout or "") + (completed.stderr or "")
        blocker = classify_test_blocker(output, test.get("blocker_keywords"))
        checkpoints = parse_feature_chain_checkpoints(test, output)
        unknown_checkpoints = [item for item in checkpoints if not item.get("known")]
        failed_checkpoints = [item for item in checkpoints if item.get("status") == "fail"]
        missing_checkpoints = missing_feature_chain_checkpoints(test, checkpoints)
        status = "passed" if completed.returncode == 0 else ("blocked" if blocker or completed.returncode == 78 else "failed")
        checkpoint_reason = ""
        if unknown_checkpoints:
            status = "failed"
            checkpoint_reason = f"unknown checkpoint marker: {unknown_checkpoints[0].get('name')}"
        elif failed_checkpoints:
            status = "failed"
            first_failure = failed_checkpoints[0]
            checkpoint_reason = f"checkpoint failed: {first_failure.get('label')}"
            if first_failure.get("reason"):
                checkpoint_reason += f" - {first_failure.get('reason')}"
        elif missing_checkpoints:
            status = "failed"
            checkpoint_reason = f"missing checkpoint marker: {missing_checkpoints[0].get('label')}"
        cleaned = cleanup_registered_paths(root, test.get("cleanup_paths")) if status == "passed" else []
        log_path.write_text(output or "(no output)\n", encoding="utf-8")
        return {
            "id": test_id,
            "title": title,
            "status": status,
            "returncode": completed.returncode,
            "reason": checkpoint_reason or blocker or ("exit-78" if completed.returncode == 78 else ""),
            "command": command,
            "cwd": str(cwd),
            "resource": str(test.get("resource") or "local"),
            "log": str(log_path),
            "cleaned": cleaned,
            "checkpoints": checkpoints,
            "missing_checkpoints": missing_checkpoints,
        }
    except subprocess.TimeoutExpired as exc:
        output = (exc.stdout or "") + (exc.stderr or "")
        log_path.write_text(output + f"\nTIMEOUT after {timeout}s\n", encoding="utf-8")
        return {
            "id": test_id,
            "title": title,
            "status": "failed",
            "reason": "timeout",
            "command": command,
            "cwd": str(cwd),
            "resource": str(test.get("resource") or "local"),
            "log": str(log_path),
        }


def test_hub_dev_complete(root: Path, jobs: int = 1, keep_success_artifacts: bool = False) -> int:
    init_context(root)
    ctx = context_dir(root)
    hub = test_hub_dir(root)
    hub.mkdir(parents=True, exist_ok=True)
    tests = approved_dev_completion_tests(ctx)
    if not tests:
        write_test_registry(ctx, load_test_registry(ctx))
        print("[context-guard] test hub: no approved every-dev-completion tests.")
        return 0

    run_id = unique_run_id()
    run_dir = hub / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    max_workers = max(1, int(jobs))
    results: list[dict[str, object]] = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(run_one_hub_test, root, run_dir, test) for test in tests]
        for future in as_completed(futures):
            results.append(future.result())

    results.sort(key=lambda item: str(item.get("id", "")))
    summary = {
        "run_id": run_id,
        "root": str(root),
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "jobs": max_workers,
        "results": results,
    }
    summary_path = hub / "last-run.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    failed = [item for item in results if item.get("status") == "failed"]
    blocked = [item for item in results if item.get("status") == "blocked"]
    passed = [item for item in results if item.get("status") == "passed"]
    print(f"[context-guard] test hub: {len(passed)} passed, {len(failed)} failed, {len(blocked)} blocked.")
    for item in results:
        detail = f"{item.get('status')}: {item.get('title')}"
        if item.get("reason"):
            detail += f" ({item.get('reason')})"
        if item.get("status") in {"failed", "blocked"} and item.get("log"):
            detail += f" [log: {item.get('log')}]"
        print(f"- {detail}")
    if failed or blocked:
        print(f"[context-guard] evidence preserved: {run_dir}")
        print(f"[context-guard] summary: {summary_path}")
        return 1
    if keep_success_artifacts:
        print(f"[context-guard] success artifacts kept: {run_dir}")
    else:
        shutil.rmtree(run_dir, ignore_errors=True)
        print("[context-guard] success artifacts cleaned.")
    print(f"[context-guard] summary: {summary_path}")
    return 0


def append_subagent_handoff(ctx: Path, agent_id: str, summary: str) -> Path:
    path = ctx / "subagents.md"
    now = datetime.now().isoformat(timespec="seconds")
    safe_agent = agent_id.strip() or "unknown"
    safe_summary = " ".join((summary or "").strip().split())
    if len(safe_summary) > 800:
        safe_summary = safe_summary[:797].rstrip() + "..."
    if not path.exists():
        path.write_text(
            "# Subagent Handoff Log\n\n"
            "This file records completed subagent work that the main agent pulled back through Context Guard.\n",
            encoding="utf-8",
        )
    with path.open("a", encoding="utf-8") as handle:
        handle.write(
            "\n"
            f"## {now}\n"
            f"- Agent: {safe_agent}\n"
            f"- Summary: {safe_summary or 'no summary provided'}\n"
            "- Required follow-up: Context Guard `subagent-complete` ran project context intake and Test Hub completion checks.\n"
        )
    return path


COMPLETION_EVIDENCE_KEYS = {
    "cg_bad_case": "title",
    "cg_phenomenon": "phenomenon",
    "cg_trigger": "trigger",
    "cg_cause": "cause",
    "cg_fix": "fix",
    "cg_verification": "verification",
    "cg_scope": "scope",
}


def completion_evidence_text(summary: str, evidence_file: Path | None = None) -> str:
    parts = [summary.strip()]
    if evidence_file:
        try:
            parts.append(evidence_file.expanduser().read_text(encoding="utf-8").strip())
        except OSError as exc:
            raise ValueError(f"cannot read subagent evidence file: {evidence_file}: {exc}") from exc
    return "\n".join(part for part in parts if part).strip()


def parse_structured_completion_evidence(text: str) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    current: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        match = re.match(r"^(CG_[A-Z_]+)\s*:\s*(.+)$", line, re.IGNORECASE)
        if not match:
            continue
        raw_key = match.group(1).strip().lower()
        key = COMPLETION_EVIDENCE_KEYS.get(raw_key)
        if not key:
            continue
        if key == "title" and current.get("title"):
            records.append(current)
            current = {}
        current[key] = " ".join(match.group(2).strip().split())
    if current.get("title"):
        records.append(current)
    return records


def natural_completion_fix_evidence(text: str) -> list[dict[str, str]]:
    compact = " ".join(text.strip().split())
    if not compact:
        return []
    sentences = [part.strip(" -•") for part in re.split(r"[。！？!?\n]+", text) if part.strip(" -•")]
    problem_cues = ("问题", "错误", "bug", "误删", "丢失", "失败", "污染", "回归", "不正确", "串线", "泄漏", "重复")
    fix_cues = ("修复", "修正", "改为", "改成", "避免", "解决", "不再")
    verify_cues = ("验证", "测试", "通过", "check", "pytest", "smoke")
    records: list[dict[str, str]] = []
    for index, sentence in enumerate(sentences):
        lowered = sentence.lower()
        if not any(cue in lowered for cue in fix_cues) or not any(cue in lowered for cue in problem_cues):
            continue
        title = sentence
        title = re.sub(r"^(?:同时|另外|并且|已|已经|本轮|这次)?\s*(?:修复|修正|解决)(?:了)?\s*", "", title)
        title = re.split(r"(?:，|,|；|;)(?:改为|改成|现在|并|同时)", title, maxsplit=1)[0]
        title = re.sub(r"(?:的)?问题$", "", title).strip(" ：:,，；;")
        if len(title) < 4 or title in {"问题", "相关问题", "发现的问题", "若干问题"}:
            continue
        verification = ""
        for candidate in sentences[index : index + 3]:
            if any(cue in candidate.lower() for cue in verify_cues):
                verification = candidate
                break
        records.append(
            {
                "title": title[:120],
                "phenomenon": sentence,
                "fix": sentence,
                "verification": verification,
            }
        )
    return records[:3]


def completion_fix_evidence(text: str) -> list[dict[str, str]]:
    structured = parse_structured_completion_evidence(text)
    return structured if structured else natural_completion_fix_evidence(text)


def completion_evidence_fingerprint(root: Path, agent_id: str, text: str) -> str:
    payload = "\0".join((str(root.resolve()), agent_id.strip(), text.strip())).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def completion_ledger_path(ctx: Path) -> Path:
    return ctx / "subagents" / "completions.json"


def load_completion_ledger(ctx: Path) -> dict[str, object]:
    path = completion_ledger_path(ctx)
    if not path.exists():
        return {"version": 1, "completions": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "completions": {}}
    if not isinstance(data, dict) or not isinstance(data.get("completions"), dict):
        return {"version": 1, "completions": {}}
    return data


def write_completion_ledger(ctx: Path, data: dict[str, object]) -> Path:
    path = completion_ledger_path(ctx)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def append_completion_bad_cases(ctx: Path, evidence: list[dict[str, str]]) -> list[str]:
    if not evidence:
        return []
    path = ctx / "bad-cases.md"
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    cards = parse_bad_case_cards(text)
    existing_signatures = {
        normalize_test_slug(" ".join((bad_case_card_label(card), str(card.get("phenomenon", "")))))
        for card in cards
    }
    created: list[str] = []
    blocks: list[str] = []
    today_dash = datetime.now().strftime("%Y-%m-%d")
    today_compact = datetime.now().strftime("%Y%m%d")
    existing_numbers = [int(match.group(1)) for match in re.finditer(rf"BC-{today_compact}-(\d+)", text)]
    next_number = max(existing_numbers) + 1 if existing_numbers else 1
    for item in evidence:
        title = human_title(item.get("title", "")).strip()
        phenomenon = item.get("phenomenon", "").strip() or title
        signature = normalize_test_slug(f"{title} {phenomenon}")
        if not title or any(signature and (signature in old or old in signature) for old in existing_signatures if old):
            continue
        case_id = f"BC-{today_compact}-{next_number:03d}"
        next_number += 1
        scope = item.get("scope", "").strip() or completion_risk_domain(
            " ".join(item.values()), completion_risk_buckets(" ".join(item.values()))
        )
        trigger = item.get("trigger", "").strip() or phenomenon
        cause = item.get("cause", "").strip() or "完成证据没有单独说明根因；保留真实修复现象与方法供后续追溯。"
        fix = item.get("fix", "").strip() or "Subagent 已在本轮修复该问题。"
        verification = item.get("verification", "").strip()
        status = "resolved" if verification else "open"
        guard = verification or "重新执行原始用户流程，确认该现象没有复发；形成用户批准的功能链后再复用自动化。"
        block = f"""
### {case_id}: {title}

- Status: {status}
- First observed: {today_dash}
- Last checked: {today_dash}
- Scope: {scope}
- Context task: current
- Roadmap nodes: none
- Tags: #subagent #observed-fix #feature-chain
- Frequency: first-seen
- Display summary: {phenomenon}
- Phenomenon: {phenomenon}
- Trigger / reproduction: {trigger}
- Root cause: {cause}
- Fix method: {fix}
- Guard type: completion-evidence
- Guard / verification: {guard}
- Run policy: relevant-only
- Red condition: 原始现象再次出现。
- Green condition: {guard}
- Expected failure reason: 如果本轮真实修复没有进入 bad-case register，后续功能链只能覆盖泛化风险，无法防止同一问题复发。
- Reusable guard path: pending-user-approved-feature-chain
"""
        blocks.append(block.lstrip())
        created.append(case_id)
        existing_signatures.add(signature)
        text += "\n" + block
    if not blocks:
        return []
    placeholder = "## Active Cases\n\nNone.\n"
    original = path.read_text(encoding="utf-8") if path.exists() else ""
    joined = "\n".join(blocks) + "\n"
    if placeholder in original:
        path.write_text(original.replace(placeholder, "## Active Cases\n\n" + joined, 1), encoding="utf-8")
    else:
        with path.open("a", encoding="utf-8") as handle:
            if original and not original.endswith("\n"):
                handle.write("\n")
            handle.write(joined)
    return created


RISK_AUDIT_BUCKETS: list[tuple[str, str, tuple[str, ...]]] = [
    ("状态切换", "#状态流程", ("状态", "模式", "练习模式", "暂停", "恢复", "失败", "成功", "state", "mode")),
    ("持久化", "#本地存储", ("持久化", "localstorage", "local storage", "刷新", "重启", "历史", "最高分", "streak", "score")),
    ("重置撤销", "#重置", ("重置", "撤销", "删除", "清空", "确认", "reset", "undo", "delete", "clear")),
    ("输入保护", "#空输入保护", ("空输入", "输入", "短线索", "表单", "校验", "input", "validation", "empty")),
    ("复制导出", "#复制反馈", ("复制", "剪贴板", "导出", "markdown", "copy", "clipboard", "export")),
    ("回放复盘", "#回放", ("回放", "复盘", "倒计时", "序列", "sequence", "replay", "countdown")),
    ("移动交互", "#ui", ("移动端", "按钮", "点击", "触摸", "布局", "mobile", "button", "click", "tap")),
    (
        "局部隔离",
        "#编辑隔离",
        (
            "不影响",
            "不会提前污染",
            "污染",
            "隔离",
            "独立",
            "局部",
            "单章",
            "这一章",
            "其他章节",
            "其他成员",
            "小队",
            "章节",
            "成员",
            "草稿",
            "isolation",
            "isolated",
        ),
    ),
]


def completion_risk_buckets(summary: str) -> list[tuple[str, str]]:
    text = (summary or "").lower()
    matched: list[tuple[str, str]] = []
    for label, tag, keywords in RISK_AUDIT_BUCKETS:
        if any(keyword.lower() in text for keyword in keywords):
            matched.append((label, tag))
    return matched


def completion_risk_domain(summary: str, buckets: list[tuple[str, str]]) -> str:
    text = (summary or "").lower()
    if any(word in text for word in ("灯", "游戏", "回放", "倒计时", "最高分", "sequence", "replay", "score")):
        return "游戏流程"
    if any(word in text for word in ("角色", "线索", "复制", "剪贴板", "markdown", "story", "card", "clipboard")):
        return "内容生成流程"
    if any(word in text for word in ("清单", "模板", "勾选", "收纳", "streak", "template")):
        return "清单模板流程"
    if buckets:
        return buckets[0][0]
    return "本轮功能流程"


def append_risk_audit_bad_case(ctx: Path, summary: str, buckets: list[tuple[str, str]]) -> Path | None:
    if len(buckets) < 2:
        return None
    path = ctx / "bad-cases.md"
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    cards = parse_bad_case_cards(text)
    domain = completion_risk_domain(summary, buckets)
    tags = []
    for _label, tag in buckets:
        if tag not in tags:
            tags.append(tag)
    tags.extend(tag for tag in ("#risk-audit", "#subagent") if tag not in tags)
    short_summary = " ".join((summary or "").strip().split())
    if len(short_summary) > 240:
        short_summary = short_summary[:237].rstrip() + "..."
    summary_signature = normalize_test_slug(short_summary)[:96]
    for card in cards:
        card_tags = {tag.lower() for tag in bad_case_tags(card)}
        if "#risk-audit" not in card_tags:
            continue
        card_trigger = normalize_test_slug(
            " ".join(
                [
                    str(card.get("trigger / reproduction", "")),
                    str(card.get("trigger", "")),
                    str(card.get("display summary", "")),
                ]
            )
        )
        if summary_signature and summary_signature in card_trigger:
            return None
    today_dash = datetime.now().strftime("%Y-%m-%d")
    case_id = next_bad_case_id(ctx)
    bucket_text = "、".join(label for label, _tag in buckets[:4])
    title = f"{case_id}: {domain}{bucket_text}未验证"
    block = f"""
### {title}

- Status: open
- First observed: {today_dash}
- Last checked: {today_dash}
- Scope: {domain}
- Context task: current
- Roadmap nodes: none
- Tags: {" ".join(tags)}
- Frequency: first-seen
- Display summary: Subagent 本轮开发涉及{bucket_text}，但没有对应 bad case 或功能链节点。
- Phenomenon: Subagent 完成开发并通过 smoke 后，本轮新增流程没有留下可聚合 bad case；如果这些状态、重置、持久化或复盘风险未被记录，后续功能链无法覆盖这些复发风险。
- Trigger / reproduction: {short_summary or "Subagent 完成一次开发任务，但没有留下 bad-case register。"}
- Root cause: 仅依赖 subagent 自主发现风险时，普通开发总结可能只报告完成事项和 smoke 通过，不会主动写入潜在用户风险。
- Fix method: 尚未修复；需要在下一轮开发或人工审查中确认该风险是否真实存在，并将其合并进对应功能链或关闭。
- Guard type: risk-audit
- Guard / verification: 运行真实用户入口，覆盖{bucket_text}相关路径；若风险不成立，将本条关闭并记录原因。
- Run policy: relevant-only
- Red condition: 相关入口在空状态、重复点击、失败路径、刷新/重启或重置/撤销后表现不一致。
- Green condition: 相关入口在这些边界路径下状态一致、反馈清晰，并且必要时有功能链覆盖。
- Expected failure reason: 如果没有这条风险审计记录，Context Guard 会因为没有 bad case 输入而无法建立或扩展功能链。
- Reusable guard path: pending
- Test-chain issue: missing bad-case input after subagent completion
"""
    clean_block = block.lstrip()
    placeholder = "## Active Cases\n\nNone.\n"
    if placeholder in text:
        path.write_text(text.replace(placeholder, "## Active Cases\n\n" + clean_block + "\n", 1), encoding="utf-8")
    else:
        with path.open("a", encoding="utf-8") as handle:
            if text and not text.endswith("\n"):
                handle.write("\n")
            handle.write(clean_block)
    return path


def subagent_completion_risk_audit(root: Path, summary: str) -> Path | None:
    ctx = context_dir(root)
    buckets = completion_risk_buckets(summary)
    created = append_risk_audit_bad_case(ctx, summary, buckets)
    if created:
        labels = "、".join(label for label, _tag in buckets)
        print(f"[context-guard] risk audit: created bad-case candidate for {labels}.")
        print(f"[context-guard] risk audit file: {created}")
    else:
        print("[context-guard] risk audit: no new bad-case candidate.")
    return created


def subagent_complete(
    root: Path,
    agent_id: str = "",
    summary: str = "",
    project_root: Path | None = None,
    evidence_file: Path | None = None,
    jobs: int = 1,
    keep_success_artifacts: bool = False,
) -> int:
    control_root = root.resolve()
    assigned_root = resolve_registered_subagent_root(control_root, agent_id)
    target_root = (project_root.expanduser().resolve() if project_root else assigned_root) or control_root
    if is_context_guard_skill_path(target_root):
        raise ValueError("subagent completion target cannot be the Context Guard skill directory")
    evidence_text = completion_evidence_text(summary, evidence_file)
    init_context(target_root)
    ctx = context_dir(target_root)
    fingerprint = completion_evidence_fingerprint(target_root, agent_id, evidence_text)
    ledger = load_completion_ledger(ctx)
    completions = ledger.setdefault("completions", {})
    assert isinstance(completions, dict)
    previous = completions.get(fingerprint)
    if isinstance(previous, dict) and int(previous.get("test_code", 1)) == 0:
        print(f"[context-guard] subagent completion already processed: {agent_id.strip() or 'subagent'}")
        print(f"[context-guard] subagent project root: {target_root}")
        return 0

    handoff_path = append_subagent_handoff(ctx, agent_id, evidence_text)
    short_agent = agent_id.strip() or "subagent"
    short_summary = " ".join((summary or evidence_text or "").strip().split())
    if len(short_summary) > 220:
        short_summary = short_summary[:217].rstrip() + "..."
    checkpoint_roadmap_node(
        target_root,
        title=f"Subagent completion handoff: {short_agent}",
        branch=None,
        level="checkpoint",
        outcome="Subagent 完成后由主 agent 接管 Context Guard 收尾。",
        display_title="Subagent 完成接管",
        user_request="主 agent 在 subagent 完成后自动接管 Context Guard 和 Test Hub 收尾。",
        progress_summary=short_summary or "Subagent 已完成一次开发任务，Context Guard 已记录 handoff。",
        method_summary="写入 subagent handoff 记录，随后运行 Test Hub 的 dev-complete，并尝试自动聚合功能链候选。",
        decision="Subagent 传输不保证触发项目本地 hook，因此以已注册的项目根目录和主 agent completion handoff 作为可靠兜底。",
        avoid="不要把 wait_agent 返回视为已经完成 Context Guard；必须跑 subagent-complete 或等价收尾。",
        next_step="如果 Test Hub 失败，先修复失败项；如果出现新 bad case，挂载到已有功能链或生成 proposed 链。",
        test_chain="subagent-complete runs Test Hub dev-complete and feature-chain-auto-propose.",
    )
    print(f"[context-guard] subagent handoff: {handoff_path}")
    print(f"[context-guard] subagent project root: {target_root}")
    test_code = test_hub_dev_complete(target_root, jobs=jobs, keep_success_artifacts=keep_success_artifacts)
    concrete_cases = append_completion_bad_cases(ctx, completion_fix_evidence(evidence_text))
    if concrete_cases:
        print(f"[context-guard] completion evidence: archived concrete bad case(s): {', '.join(concrete_cases)}")
    else:
        subagent_completion_risk_audit(target_root, evidence_text)
    try:
        feature_chain_auto_propose(target_root, min_cases=2, max_groups=6, hook_mode=True)
    except Exception as exc:
        print(f"[context-guard] feature-chain auto-propose warning: {exc}", file=sys.stderr)
    completions[fingerprint] = {
        "agent_id": short_agent,
        "project_root": str(target_root),
        "completed_at": datetime.now().isoformat(timespec="seconds"),
        "test_code": test_code,
        "concrete_bad_cases": concrete_cases,
    }
    write_completion_ledger(ctx, ledger)
    assignments = load_subagent_assignments(control_root)
    assignment_map = assignments.get("assignments", {})
    if isinstance(assignment_map, dict) and isinstance(assignment_map.get(short_agent), dict):
        assignment = assignment_map[short_agent]
        assignment["status"] = "completed" if test_code == 0 else "completion-blocked"
        assignment["last_completion_at"] = datetime.now().isoformat(timespec="seconds")
        assignment["last_completion_fingerprint"] = fingerprint
        assignment["last_test_code"] = test_code
        write_subagent_assignments(control_root, assignments)
    return test_code


def feature_chain_dry_run(
    root: Path,
    chain_id: str,
    command_text: str = "",
    timeout_seconds: int = 300,
    keep_success_artifacts: bool = False,
) -> int:
    init_context(root)
    ctx = context_dir(root)
    hub = test_hub_dir(root)
    hub.mkdir(parents=True, exist_ok=True)
    chain_id = chain_id.strip()
    if not chain_id:
        raise ValueError("feature-chain-dry-run requires --chain-id")
    chain, _chains, _registry = feature_chain_find(ctx, chain_id)
    command = command_text.strip() or str(chain.get("command", "")).strip()
    if not command:
        raise ValueError("feature-chain-dry-run requires --command-text or an existing chain command")

    run_id = unique_run_id()
    run_dir = hub / "dry-runs" / f"{run_id}-{normalize_test_slug(chain_id)}"
    run_dir.mkdir(parents=True, exist_ok=True)
    test = dict(chain)
    test["id"] = chain_id
    test["title"] = str(chain.get("title") or chain_id)
    test["source"] = "feature-chain"
    test["type"] = "command"
    test["command"] = command
    test["timeout_seconds"] = int(timeout_seconds or chain.get("timeout_seconds") or 300)
    test.setdefault("cwd", ".")
    test.setdefault("artifact_policy", "cleanup-on-pass")
    test.setdefault("resource", "local")
    test.setdefault("blocker_keywords", BLOCKER_PATTERNS)

    result = run_one_hub_test(root, run_dir, test)
    summary = {
        "run_id": run_id,
        "root": str(root),
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "chain_id": chain_id,
        "result": result,
    }
    summary_path = hub / "last-dry-run.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    status = str(result.get("status", "unknown"))
    print(f"[context-guard] feature-chain dry run: {status}: {test['title']}")
    if result.get("reason"):
        print(f"[context-guard] reason: {result.get('reason')}")
    checkpoints = result.get("checkpoints", [])
    if isinstance(checkpoints, list) and checkpoints:
        for checkpoint in checkpoints:
            if not isinstance(checkpoint, dict):
                continue
            label = checkpoint.get("label") or checkpoint.get("name")
            mark_status = checkpoint.get("status")
            reason = checkpoint.get("reason")
            line = f"- checkpoint {mark_status}: {label}"
            if reason:
                line += f" ({reason})"
            print(line)
    missing = result.get("missing_checkpoints", [])
    if isinstance(missing, list) and missing:
        for checkpoint in missing:
            if isinstance(checkpoint, dict):
                print(f"- missing checkpoint: {checkpoint.get('label')}")
    if status == "passed":
        if keep_success_artifacts:
            print(f"[context-guard] dry-run artifacts kept: {run_dir}")
        else:
            shutil.rmtree(run_dir, ignore_errors=True)
            print("[context-guard] dry-run success artifacts cleaned.")
    else:
        print(f"[context-guard] dry-run evidence preserved: {run_dir}")
    print(f"[context-guard] summary: {summary_path}")
    return 0 if status == "passed" else 1


def create_branch_task(root: Path, title: str, branch: str, parent_node: str = "") -> tuple[str, str, Path]:
    init_context(root)
    ctx = context_dir(root)
    if not title.strip():
        raise ValueError("create-branch-task requires a non-empty title")
    branch = branch.strip() or title.strip()
    title = title.strip()
    index = (ctx / "index.md").read_text(encoding="utf-8")
    parent_task = parse_current_index_entry(index).get("id", "")
    task_id = next_task_id(ctx, title, branch)
    task_path = write_branch_task_context(ctx, task_id, title, branch, parent_node, parent_task)
    node_id_value = append_branch_roadmap_node(ctx, task_id, title, branch, parent_node)
    update_index_for_branch_task(ctx, task_id, title, branch, parent_node, node_id_value)
    export_roadmap(root, "html")
    print(f"[context-guard] branch task: {task_id}")
    print(f"[context-guard] branch node: {node_id_value}")
    print(f"[context-guard] task context: {task_path}")
    return task_id, node_id_value, task_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Context Guard utilities")
    parser.add_argument("command", choices=["init", "set-language", "export-roadmap", "show-roadmap", "create-branch-task", "checkpoint-roadmap-node", "subagent-register", "subagent-complete", "validate-bad-cases", "validate-roadmap-maintenance", "validate-feature-chains", "test-hub-add", "test-hub-list", "test-hub-enable", "test-hub-disable", "test-hub-set-policy", "test-hub-remove", "feature-chain-add", "feature-chain-propose", "feature-chain-auto-propose", "feature-chain-attach-bc", "feature-chain-approve", "feature-chain-dry-run", "feature-chain-set-policy", "feature-chain-set-checkpoint", "feature-chain-suggest", "feature-chain-plan", "feature-chain-list", "feature-chain-summary", "feature-chain-overlap", "feature-chain-coverage", "feature-chain-candidates", "show-test-hub", "serve-test-hub", "dev-complete"])
    parser.add_argument("--format", choices=["html", "md"], default="html")
    parser.add_argument("--language", default=None, help="Folder-scoped language for future context records.")
    parser.add_argument("--title", default=None, help="Title for a branch task or roadmap checkpoint.")
    parser.add_argument("--test-id", default="", help="Test ID for test-hub management commands.")
    parser.add_argument("--command-text", default="", help="Shell command for a human-approved test registry entry.")
    parser.add_argument("--run-policy", default=RUN_ALWAYS_POLICY, help="Run policy for a test registry entry.")
    parser.add_argument("--test-status", default=None, help="Status for a test registry or feature-chain entry.")
    parser.add_argument("--reason", default="", help="Reason for disabling or changing a test policy.")
    parser.add_argument("--required", default="", help="Whether a feature-chain checkpoint is required every run: true/false or required/optional.")
    parser.add_argument("--timeout-seconds", type=int, default=300, help="Timeout for a registered test command.")
    parser.add_argument("--artifact-policy", default="cleanup-on-pass", help="Artifact policy for a registered test command.")
    parser.add_argument("--resource", default="local", help="Resource/node label for a registered test command.")
    parser.add_argument("--entry", default="", help="Human-readable entry point for a feature-chain test.")
    parser.add_argument("--exit-check", default="", help="Human-readable success condition for a feature-chain test.")
    parser.add_argument("--chain-id", default="", help="Feature chain ID for feature-chain management commands.")
    parser.add_argument("--node-title", default="", help="Feature-chain node title for attaching bad-case coverage.")
    parser.add_argument("--bad-case", default="", help="Bad-case ID or title covered by a feature-chain node.")
    parser.add_argument("--bad-cases", default="", help="Comma-separated bad-case IDs or titles covered by a proposed feature-chain checkpoint.")
    parser.add_argument("--coverage-pending-reason", default="", help="Reason a proposed feature-chain checkpoint has no linked bad case yet.")
    parser.add_argument("--check", default="", help="Checkpoint text for a feature-chain node.")
    parser.add_argument("--query", default="", help="Natural-language feature or bad-case text for feature-chain-suggest.")
    parser.add_argument("--agent-id", default="", help="Subagent identifier for subagent-complete handoff records.")
    parser.add_argument("--summary", default="", help="Subagent completion summary for subagent-complete handoff records.")
    parser.add_argument("--project-root", type=Path, default=None, help="Explicit project root assigned to a subagent.")
    parser.add_argument("--task", default="", help="Short ordinary product task recorded by subagent-register.")
    parser.add_argument("--evidence-file", type=Path, default=None, help="Exact subagent completion output containing optional CG_BAD_CASE evidence fields.")
    parser.add_argument("--jobs", type=int, default=1, help="Parallel test workers for dev-complete.")
    parser.add_argument("--host", default="127.0.0.1", help="Host for serve-test-hub.")
    parser.add_argument("--port", type=int, default=8772, help="Port for serve-test-hub.")
    parser.add_argument("--keep-success-artifacts", action="store_true", help="Keep test-hub run directory after all tests pass.")
    parser.add_argument("--from-hook", action="store_true", help="Run in hook-safe mode for automatic feature-chain proposals.")
    parser.add_argument("--branch", default=None, help="Branch/route name for a branch task or roadmap checkpoint.")
    parser.add_argument("--parent-node", default="", help="Roadmap node where the branch forks.")
    parser.add_argument("--level", choices=["major", "checkpoint"], default="checkpoint", help="Roadmap checkpoint level.")
    parser.add_argument("--outcome", default="", help="One-line result for a roadmap checkpoint.")
    parser.add_argument("--display-title", default="", help="Short human-facing title for roadmap overview cards.")
    parser.add_argument("--user-request", default="", help="Concise summary of the user's actual request for this checkpoint.")
    parser.add_argument("--progress-summary", default="", help="Readable human-facing current-progress text for node details.")
    parser.add_argument("--method-summary", default="", help="Readable human-facing method text for node details.")
    parser.add_argument("--decision", default="", help="Decision or reason for a roadmap checkpoint.")
    parser.add_argument("--avoid", default="", help="Avoid-going-back note for a roadmap checkpoint.")
    parser.add_argument("--next-step", default="", help="Next step for the active context.")
    parser.add_argument("--linked-bad-cases", default="", help="Comma-separated bad-case IDs linked to this checkpoint.")
    parser.add_argument("--test-chain", default="", help="Concise verification or recurrence-check note for this checkpoint.")
    parser.add_argument("--open", action="store_true", help="Open the generated HTML roadmap with the default browser.")
    parser.add_argument("--strict", action="store_true", help="Fail when any resolved bad case lacks red-capable guard fields.")
    parser.add_argument("--verbose", action="store_true", help="Show all validation warnings.")
    parser.add_argument("--max-hidden-checkpoints", type=int, default=8, help="Maximum checkpoints allowed after a route's latest visible node.")
    parser.add_argument("--min-cases", type=int, default=2, help="Minimum unassigned bad cases required for a feature-chain candidate group.")
    parser.add_argument("--max-groups", type=int, default=6, help="Maximum feature-chain candidate groups to show.")
    parser.add_argument("--min-score", type=int, default=6, help="Minimum overlap score for feature-chain overlap audit.")
    parser.add_argument("--root", type=Path, default=None)
    args = parser.parse_args()

    root = args.root.resolve() if args.root else folder_root(Path.cwd())
    root_guard = guard_implicit_skill_root(root, explicit_root=args.root is not None)
    if root_guard:
        return root_guard
    if args.command == "init":
        created = init_context(root)
        if created:
            print("[context-guard] initialized context:")
            for path in created:
                print(f"- {path}")
        else:
            print(f"[context-guard] context already exists: {context_dir(root)}")
        return 0
    if args.command == "export-roadmap":
        print(export_roadmap(root, args.format))
        return 0
    if args.command == "set-language":
        if not args.language:
            parser.error("set-language requires --language")
        print(set_record_language(root, args.language))
        return 0
    if args.command == "show-roadmap":
        show_roadmap(root, args.open)
        return 0
    if args.command == "create-branch-task":
        if not args.title:
            parser.error("create-branch-task requires --title")
        create_branch_task(root, args.title, args.branch or args.title, args.parent_node)
        return 0
    if args.command == "checkpoint-roadmap-node":
        if not args.title:
            parser.error("checkpoint-roadmap-node requires --title")
        checkpoint_roadmap_node(
            root,
            title=args.title,
            branch=args.branch,
            level=args.level,
            outcome=args.outcome,
            display_title=args.display_title,
            user_request=args.user_request,
            progress_summary=args.progress_summary,
            method_summary=args.method_summary,
            decision=args.decision,
            avoid=args.avoid,
            next_step=args.next_step,
            linked_bad_cases=args.linked_bad_cases,
            test_chain=args.test_chain,
            parent_node=args.parent_node,
        )
        return 0
    if args.command == "subagent-register":
        if not args.project_root:
            parser.error("subagent-register requires --project-root")
        try:
            register_subagent_assignment(root, args.agent_id, args.project_root, args.task)
        except ValueError as exc:
            parser.error(str(exc))
        return 0
    if args.command == "subagent-complete":
        return subagent_complete(
            root,
            agent_id=args.agent_id,
            summary=args.summary,
            project_root=args.project_root,
            evidence_file=args.evidence_file,
            jobs=args.jobs,
            keep_success_artifacts=args.keep_success_artifacts,
        )
    if args.command == "test-hub-add":
        if not args.title:
            parser.error("test-hub-add requires --title")
        if not args.command_text:
            parser.error("test-hub-add requires --command-text")
        test_hub_add(
            root,
            title=args.title,
            command_text=args.command_text,
            run_policy=args.run_policy,
            status=args.test_status or "approved",
            timeout_seconds=args.timeout_seconds,
            artifact_policy=args.artifact_policy,
            resource=args.resource,
        )
        return 0
    if args.command == "feature-chain-add":
        if not args.title:
            parser.error("feature-chain-add requires --title")
        if not args.entry:
            parser.error("feature-chain-add requires --entry")
        if not args.exit_check:
            parser.error("feature-chain-add requires --exit-check")
        feature_chain_add(
            root,
            title=args.title,
            entry=args.entry,
            exit_check=args.exit_check,
            command_text=args.command_text,
            run_policy=args.run_policy,
            status=args.test_status or "proposed",
            timeout_seconds=args.timeout_seconds,
            artifact_policy=args.artifact_policy,
            resource=args.resource,
        )
        return 0
    if args.command == "feature-chain-propose":
        if not args.title:
            parser.error("feature-chain-propose requires --title")
        if not args.entry:
            parser.error("feature-chain-propose requires --entry")
        if not args.exit_check:
            parser.error("feature-chain-propose requires --exit-check")
        if not args.node_title:
            parser.error("feature-chain-propose requires --node-title")
        if not args.bad_cases and not args.coverage_pending_reason:
            parser.error("feature-chain-propose requires --bad-cases or --coverage-pending-reason")
        if not args.check:
            parser.error("feature-chain-propose requires --check")
        feature_chain_propose(
            root,
            title=args.title,
            entry=args.entry,
            exit_check=args.exit_check,
            node_title=args.node_title,
            bad_cases=parse_bad_case_list(args.bad_cases),
            check=args.check,
            coverage_pending_reason=args.coverage_pending_reason,
            run_policy=args.run_policy,
            artifact_policy=args.artifact_policy,
            resource=args.resource,
        )
        return 0
    if args.command == "feature-chain-auto-propose":
        return feature_chain_auto_propose(root, min_cases=args.min_cases, max_groups=args.max_groups, hook_mode=args.from_hook)
    if args.command == "feature-chain-attach-bc":
        if not args.chain_id:
            parser.error("feature-chain-attach-bc requires --chain-id")
        if not args.node_title:
            parser.error("feature-chain-attach-bc requires --node-title")
        if not args.bad_case:
            parser.error("feature-chain-attach-bc requires --bad-case")
        feature_chain_attach_bc(
            root,
            chain_id=args.chain_id,
            node_title=args.node_title,
            bad_case=args.bad_case,
            check=args.check,
        )
        return 0
    if args.command == "feature-chain-approve":
        if not args.chain_id:
            parser.error("feature-chain-approve requires --chain-id")
        feature_chain_approve(
            root,
            chain_id=args.chain_id,
            command_text=args.command_text,
            run_policy=args.run_policy,
            timeout_seconds=args.timeout_seconds,
            artifact_policy=args.artifact_policy,
            resource=args.resource,
        )
        return 0
    if args.command == "feature-chain-dry-run":
        if not args.chain_id:
            parser.error("feature-chain-dry-run requires --chain-id")
        return feature_chain_dry_run(
            root,
            chain_id=args.chain_id,
            command_text=args.command_text,
            timeout_seconds=args.timeout_seconds,
            keep_success_artifacts=args.keep_success_artifacts,
        )
    if args.command == "feature-chain-set-policy":
        if not args.chain_id:
            parser.error("feature-chain-set-policy requires --chain-id")
        feature_chain_set_policy(root, args.chain_id, args.run_policy, reason=args.reason)
        return 0
    if args.command == "feature-chain-set-checkpoint":
        if not args.chain_id:
            parser.error("feature-chain-set-checkpoint requires --chain-id")
        if not args.node_title:
            parser.error("feature-chain-set-checkpoint requires --node-title")
        if not args.required:
            parser.error("feature-chain-set-checkpoint requires --required")
        feature_chain_set_checkpoint(
            root,
            chain_id=args.chain_id,
            node_title=args.node_title,
            required_value=args.required,
            reason=args.reason,
        )
        return 0
    if args.command == "feature-chain-suggest":
        if not args.query:
            parser.error("feature-chain-suggest requires --query")
        return feature_chain_suggest(root, query=args.query)
    if args.command == "feature-chain-plan":
        if not args.query:
            parser.error("feature-chain-plan requires --query")
        return feature_chain_plan(root, query=args.query)
    if args.command == "feature-chain-list":
        return feature_chain_list(root, verbose=args.verbose)
    if args.command == "feature-chain-summary":
        return feature_chain_summary(root, verbose=args.verbose)
    if args.command == "feature-chain-overlap":
        return feature_chain_overlap(root, min_score=args.min_score, verbose=args.verbose)
    if args.command == "feature-chain-coverage":
        return feature_chain_coverage(root, verbose=args.verbose)
    if args.command == "feature-chain-candidates":
        return feature_chain_candidates(root, min_cases=args.min_cases, max_groups=args.max_groups)
    if args.command == "test-hub-list":
        return test_hub_list(root)
    if args.command == "test-hub-enable":
        if not args.test_id:
            parser.error("test-hub-enable requires --test-id")
        test_hub_update_test(
            root,
            args.test_id,
            status=args.test_status or "approved",
            run_policy=args.run_policy or RUN_ALWAYS_POLICY,
            disabled_reason="",
        )
        return 0
    if args.command == "test-hub-disable":
        if not args.test_id:
            parser.error("test-hub-disable requires --test-id")
        test_hub_update_test(
            root,
            args.test_id,
            status="disabled",
            run_policy="disabled-with-reason",
            disabled_reason=args.reason or "disabled by user",
        )
        return 0
    if args.command == "test-hub-set-policy":
        if not args.test_id:
            parser.error("test-hub-set-policy requires --test-id")
        test_hub_update_test(
            root,
            args.test_id,
            run_policy=args.run_policy,
            policy_reason=args.reason,
        )
        return 0
    if args.command == "test-hub-remove":
        if not args.test_id:
            parser.error("test-hub-remove requires --test-id")
        test_hub_remove(root, args.test_id)
        return 0
    if args.command == "show-test-hub":
        show_test_hub(root, args.open)
        return 0
    if args.command == "serve-test-hub":
        return serve_test_hub(root, host=args.host, port=args.port, jobs=args.jobs, open_browser=args.open)
    if args.command == "dev-complete":
        return test_hub_dev_complete(root, jobs=args.jobs, keep_success_artifacts=args.keep_success_artifacts)
    if args.command == "validate-bad-cases":
        return validate_bad_case_guards(root, strict=args.strict, verbose=args.verbose)
    if args.command == "validate-roadmap-maintenance":
        return validate_roadmap_maintenance(root, max_hidden_checkpoints=args.max_hidden_checkpoints)
    if args.command == "validate-feature-chains":
        return validate_feature_chains(root, strict=args.strict, verbose=args.verbose)
    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError) as exc:
        print(f"[context-guard] error: {exc}", file=sys.stderr)
        raise SystemExit(1)
