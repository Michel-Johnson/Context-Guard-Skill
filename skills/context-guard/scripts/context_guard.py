#!/usr/bin/env python3
"""Utilities for Context Guard project context folders."""

from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import webbrowser
from datetime import datetime
from pathlib import Path


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


def context_dir(root: Path) -> Path:
    return root / ".codex" / "context"


def roadmap_output_dir(root: Path) -> Path:
    return context_dir(root) / "roadmap"


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


def init_context(root: Path) -> list[Path]:
    today = datetime.now().strftime("%Y-%m-%d")
    ctx = context_dir(root)
    created: list[Path] = []
    for directory in [
        ctx,
        ctx / "tasks",
        ctx / "bad-case-tests",
        ctx / "roadmap",
        ctx / "exports",
        ctx / "archive",
    ]:
        if not directory.exists():
            directory.mkdir(parents=True, exist_ok=True)
            created.append(directory)

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
    backToRoadmap: "Back to roadmap",
    mainRoute: "Main Route",
    badCases: "Bad Cases",
    badCasesField: "Bad cases:",
    testChain: "Test Chain",
    testChainField: "Test chain:",
    routeFocus: "Route Details",
    emptyRoadmap: "No roadmap nodes recorded yet.",
    noLinkedBadCases: "No linked bad cases.",
    noBadCases: "No bad cases recorded.",
    checkpointsInDetails: "{{count}} checkpoints in details",
    levelMajor: "Major",
    levelCheckpoint: "Checkpoint",
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
    guard: "Guard:"
  }},
  zh: {{
    roadmapTitle: "Context 路线图",
    roadmapDetails: "路线图详情",
    humanView: "人类视图",
    humanDetailView: "人类详情视图",
    updatedLabel: "更新：",
    roadmap: "路线图",
    backToRoadmap: "返回路线图",
    mainRoute: "主要路线",
    badCases: "Bad Case",
    badCasesField: "Bad case：",
    testChain: "测试链路",
    testChainField: "测试链路：",
    routeFocus: "路线详情",
    emptyRoadmap: "还没有路线节点。",
    noLinkedBadCases: "无关联 bad case。",
    noBadCases: "还没有 bad case。",
    checkpointsInDetails: "{{count}} 个检查点在详情页",
    levelMajor: "主节点",
    levelCheckpoint: "检查点",
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
    guard: "防线："
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
}}

document.addEventListener("DOMContentLoaded", () => {{
  const initial = resolveLang();
  applyLang(initial);
  const routeButtons = Array.from(document.querySelectorAll("[data-route-filter]"));
  const routeExists = (route) => routeButtons.some((button) => button.dataset.routeFilter === route);
  const applyRoute = (route) => {{
    if (!routeExists(route)) return;
    localStorage.setItem("contextGuardRoute", route);
    document.querySelectorAll("[data-route-panel]").forEach((panel) => {{
      panel.hidden = panel.dataset.routePanel !== route;
    }});
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
}});
</script>"""


def render_roadmap_html(ctx: Path, index: str, roadmap: str, bad_cases: str) -> str:
    nodes = parse_roadmap_nodes(roadmap)
    bad_case_cards = parse_bad_case_cards(bad_cases)
    case_anchor_map = build_case_anchor_map(bad_case_cards)
    route_groups = group_nodes_by_branch(nodes)
    node_lookup = {node_id(node): node for _, items in route_groups for _, node in items}
    branch_mode = len(route_groups) > 1
    route_offsets = build_route_offsets(route_groups, node_lookup) if branch_mode else {}
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
        )
        for i, (branch, items) in enumerate(route_groups)
    )
    route_panels = (
        '<div class="route-drilldowns">'
        + "\n".join(
            render_route_drilldown(branch, items, bad_case_cards, case_anchor_map, active=i == 0)
            for i, (branch, items) in enumerate(route_groups)
        )
        + "</div>"
        if branch_mode and route_groups
        else ""
    )
    inline_details = render_inline_details(nodes, bad_case_cards, case_anchor_map)
    if not route_items:
        route_items = '<section class="empty" data-i18n="emptyRoadmap">No roadmap nodes recorded yet.</section>'
    preferred_lang = preferred_display_language(ctx)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Context Roadmap Human View</title>
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
      gap: 18px;
    }}
    .route-stack.branch-map {{
      overflow-x: auto;
      padding-bottom: 4px;
    }}
    .route-group {{
      min-width: 0;
    }}
    .route-stack.branch-map .route-group {{
      min-width: max-content;
    }}
    .route-group.route-branch {{
      position: relative;
    }}
    .route-head {{
      display: flex;
      align-items: center;
      gap: 9px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }}
    .route-head-grid {{
      min-height: auto;
      margin-bottom: 9px;
      align-items: start;
    }}
    .route-head-cell {{
      min-width: 0;
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
      min-height: 430px;
      align-items: stretch;
    }}
    .track-grid.route-only {{
      grid-template-columns: none;
      grid-auto-columns: minmax(230px, 300px);
      min-height: 190px;
    }}
    .route-spacer {{
      min-height: 1px;
      pointer-events: none;
    }}
    .track-column, .track-label-column {{
      display: grid;
      grid-template-rows: minmax(130px, auto) minmax(120px, auto) minmax(90px, auto);
      gap: 12px;
    }}
    .track-column.route-column {{
      grid-template-rows: minmax(160px, auto);
      position: relative;
    }}
    .route-group.route-branch .track-column.branch-start::before {{
      content: "";
      position: absolute;
      left: 0;
      top: -62px;
      height: 62px;
      border-left: 2px solid var(--route-line, var(--line));
      pointer-events: none;
    }}
    .route-group.route-branch .track-column.branch-start::after {{
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      width: 18px;
      border-top: 2px solid var(--route-line, var(--line));
      border-top-left-radius: 14px;
      pointer-events: none;
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
    .lane-main {{ border-top: 4px solid var(--route-accent, var(--accent)); }}
    .lane-bad-cases {{ border-top: 4px solid var(--warn); }}
    .lane-test-chain {{ border-top: 4px solid var(--ok); }}
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
    }}
    .node-heading {{
      display: flex;
      gap: 8px;
      align-items: flex-start;
      margin-bottom: 8px;
    }}
    .node-number {{
      flex: 0 0 auto;
      width: 28px; height: 28px; border-radius: 50%;
      display: grid; place-items: center;
      background: var(--route-accent, var(--accent)); color: white; font-weight: 760;
      box-shadow: 0 0 0 4px var(--route-soft, var(--accent-soft));
    }}
    .lane h3 {{ margin: 0; font-family: var(--font-heading); font-size: 15px; line-height: 1.35; }}
    .node-meta {{ display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }}
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
    .badcase-head {{ display: flex; align-items: center; gap: 8px; }}
    .badcase h3 {{ margin: 0 0 8px; font-size: 14px; }}
    .route-drilldowns {{
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
    }}
    .route-drilldown {{
      display: grid;
      grid-template-columns: minmax(240px, 1fr) minmax(240px, 1fr);
      gap: 14px;
    }}
    .route-drilldown[hidden] {{ display: none; }}
    .drill-card {{
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--card) 88%, var(--accent-soft));
      padding: 13px;
      min-width: 0;
    }}
    .drill-card h3 {{
      margin: 0 0 10px;
      font-family: var(--font-heading);
      font-size: 15px;
    }}
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
      display: grid;
      gap: 14px;
    }}
    .inline-details h2 {{ margin: 8px 0 2px; }}
    .detail-card {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 14px;
      box-shadow: var(--shadow);
      scroll-margin-top: 18px;
    }}
    .detail-card:target {{
      outline: 3px solid color-mix(in srgb, var(--accent) 22%, transparent);
      border-color: var(--accent);
    }}
    .detail-card h3 {{ margin: 0 0 8px; font-family: var(--font-heading); font-size: 17px; }}
    .field {{ margin: 7px 0; }}
    .field b {{ color: var(--muted); }}
    .level-chip {{ display: inline-block; border-radius: 999px; padding: 1px 7px; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 650; }}
    .visual-meta {{ display: flex; align-items: center; gap: 9px; min-height: 16px; margin: 4px 0 10px; }}
    .inline-top {{ display: inline-block; margin-top: 8px; color: var(--accent); font-weight: 650; text-decoration: none; }}
    .empty {{ color: var(--muted); padding: 18px; border: 1px dashed var(--line); border-radius: 8px; }}
    @media (max-width: 980px) {{
      .shell {{ padding: 16px; }}
      .quick {{ grid-template-columns: 1fr 1fr; }}
      .track-grid {{ grid-auto-columns: minmax(260px, 82vw); }}
      .route-drilldown {{ grid-template-columns: 1fr; }}
      header {{ padding: 22px 16px 14px; }}
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
    <main class="track-board" id="roadmap-overview">
      <h2 data-i18n="roadmap">Roadmap</h2>
      {route_nav}
      <div class="route-stack{' branch-map' if branch_mode else ''}"{' data-route-map-overview' if branch_mode else ''}>{route_items}</div>
      {route_panels}
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
    node_sections = "\n".join(render_node_detail(node, i, cards, case_anchor_map) for i, node in enumerate(nodes, 1))
    if not node_sections:
        node_sections = '<section class="detail-card" data-i18n="emptyRoadmap">No roadmap nodes recorded yet.</section>'
    case_sections = "\n".join(render_case_detail(card, case_anchor_map.get(card.get("title", ""), f"case-{i}")) for i, card in enumerate(cards, 1))
    preferred_lang = preferred_display_language(ctx)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Context Roadmap Details</title>
  <style>
    body {{ margin: 0; background: #f6f7f9; color: #20242a; font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    header {{ background: #fff; border-bottom: 1px solid #d9dee7; padding: 22px 32px; }}
    main {{ max-width: 980px; margin: 0 auto; padding: 22px 18px 40px; }}
    .header-row {{ display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }}
    h1 {{ margin: 0 0 4px; font-size: 24px; }}
    h2 {{ margin-top: 28px; }}
    h3 {{ margin: 0 0 8px; font-size: 18px; }}
    .meta, .muted {{ color: #69707d; }}
    .detail-card {{ background: #fff; border: 1px solid #d9dee7; border-radius: 8px; padding: 16px; margin: 14px 0; }}
    .field {{ margin: 8px 0; }}
    .field b {{ color: #69707d; }}
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
    <h2 data-i18n="mainRoute">Main Route</h2>
    {node_sections}
    <h2 data-i18n="badCases">Bad Cases</h2>
    {case_sections or '<p class="muted" data-i18n="noBadCases">No bad cases recorded.</p>'}
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
    node_sections = "\n".join(render_node_detail(node, i, cards, case_anchor_map) for i, node in enumerate(nodes, 1))
    if not node_sections:
        node_sections = '<section class="detail-card" data-i18n="emptyRoadmap">No roadmap nodes recorded yet.</section>'
    case_sections = "\n".join(
        render_case_detail(card, case_anchor_map.get(card.get("title", ""), f"case-{i}"))
        for i, card in enumerate(cards, 1)
    )
    return f"""<section class="inline-details" aria-label="Roadmap details">
  <h2 data-i18n="roadmapDetails">Roadmap Details</h2>
  {node_sections}
  <h2 data-i18n="badCases">Bad Cases</h2>
  {case_sections or '<p class="muted" data-i18n="noBadCases">No bad cases recorded.</p>'}
  <a class="inline-top" href="#roadmap-overview" data-i18n="backToRoadmap">Back to roadmap</a>
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
            normalized_key = key.strip().lower()
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
        "date": "date",
        "status": "status",
        "level": "level",
        "branch": "branch",
        "route": "branch",
        "parent": "parent",
        "task": "task",
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
        "date",
        "status",
        "level",
        "branch",
        "parent",
        "task",
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
        ("#23664f", "#d8eadf", "#b3ceb9"),
        ("#184d3c", "#d1e3d8", "#9dbbaa"),
        ("#10392f", "#cadbd2", "#8aa895"),
    ]
    accent, soft, line = palette[min(max(depth, 0), len(palette) - 1)]
    return f"--route-accent: {accent}; --route-soft: {soft}; --route-line: {line};"


def route_slug(branch: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", branch.lower()).strip("-")
    return slug or "main"


def human_title(title: str) -> str:
    return re.sub(r"^(?:NODE|BC)-\d{8}-\d+:\s*", "", title).strip() or title


def human_text(text: str) -> str:
    text = re.sub(r"`?CTX-\d{8}-[\w-]+`?", "this task", text)
    text = re.sub(r"`?NODE-\d{8}-\d+`?", "a roadmap node", text)
    text = re.sub(r"`?BC-\d{8}-\d+`?", "a linked bad case", text)
    return text


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
    "Roadmap display now uses node columns with Main Route, Bad Cases, and Test Chain lanes.": "路线图现在使用节点列，并包含主要路线、Bad Case、测试链路三条轨道。",
    "Three-track HTML assertion passed; generated roadmap had 9 main/bad-case/test-chain lane sets and no old layout; pushed commit `4c31abd`.": "三轨 HTML 断言通过；生成的路线图包含 9 组主线/bad case/测试链路线，且不再出现旧布局；已推送 commit `4c31abd`。",
    "Roadmap display now targets stable HTML files instead of timestamped exports.": "路线图展示现在写入稳定 HTML 文件，而不是时间戳导出文件。",
    "Stable export assertion passed; current folder has stable HTML files and no timestamped roadmap HTML; pushed commit `13be025`; later route added stable details page.": "稳定导出断言通过；当前文件夹只有稳定 HTML 文件，没有时间戳路线图 HTML；已推送 commit `13be025`；后续路线加入了稳定详情页。",
    "Clarified that `roadmap.html` is only the user-facing view, while Codex reads source context files.": "明确 `roadmap.html` 只是用户视图，Codex 读取源 context 文件。",
    "Artifact-role assertion passed; skill/plugin validation passed; generated HTML/Markdown carry role markers; pushed commit `ef9a18f`.": "产物角色断言通过，skill/plugin 验证通过，生成的 HTML/Markdown 都带有角色标记；已推送 commit `ef9a18f`。",
    "User-facing roadmap now shows concise natural-language node and bad-case labels.": "面向用户的路线图现在显示简洁自然语言节点和 bad case 标签。",
    "Human-label assertion passed; real HTML contains no internal IDs while Markdown keeps them; pushed commit `4049b32`.": "人类标签断言通过；真实 HTML 不含内部 ID，Markdown 保留内部 ID；已推送 commit `4049b32`。",
    "Roadmap overview now shows sparse labels and links detailed fields to a stable detail page.": "路线图概览现在只显示精简标签，并把详细字段链接到稳定详情页。",
    "Compact overview assertion passed; real HTML links to detail page and hides verbose fields; pushed commit `f5fb2b2`.": "精简概览断言通过；真实 HTML 链接到详情页，并隐藏冗长字段；已推送 commit `f5fb2b2`。",
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
    "Vertical label and Chinese record assertion checks `writing-mode: vertical-rl` in generated overview CSS.": "竖排标签和中文记录断言检查生成的概览 CSS 中保留 `writing-mode: vertical-rl`。",
    "Vertical label and Chinese record assertion passed.": "竖排标签和中文记录断言已通过。",
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
]


def has_cjk(text: str) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", text))


def zh_text(text: str) -> str:
    text = human_text(text)
    normalized = " ".join(text.split())
    if has_cjk(normalized):
        return normalized
    if normalized in ZH_TEXT:
        return ZH_TEXT[normalized]
    translated = normalized
    for source, target in ZH_REPLACEMENTS:
        translated = translated.replace(source, target)
    return translated


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
                branch_start=branch_mode and display_number == 1 and route_offset > 0,
            )
            for display_number, (source_number, node) in enumerate(display_items, 1)
        )
    else:
        columns = "\n".join(
            render_track_column(node, source_number, display_number, bad_case_cards, case_anchor_map)
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
    label_column = "" if branch_mode else label_column
    grid_class = "track-grid route-only" if branch_mode else "track-grid"
    branch_class = " route-branch" if parent_note else ""
    route_head = f"""<div class="route-head">
    <span class="route-mark" aria-hidden="true"></span>
    <span class="route-title">{label}</span>
    <span class="route-pill">{count}</span>
    {parent_note}
  </div>"""
    if branch_mode:
        route_header = f"""<div class="route-head-grid {grid_class}">{route_spacers}<div class="route-head-cell">
  {route_head}
  {checkpoint_strip}
</div></div>"""
    else:
        route_header = f"""{route_head}
  {checkpoint_strip}"""
    route_vars = route_color_vars(route_depth)
    offset_attrs = (
        f' data-route-offset="{route_offset}" data-route-depth="{route_depth}" style="{route_vars}"'
        if branch_mode
        else f' data-route-depth="{route_depth}" style="{route_vars}"'
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
    parent_label = human_title(parent_node.get("title", parent_id))
    return f'<span class="route-parent" data-route-parent>{localized_text("forked from")} {localized_text(parent_label)}</span>'


def render_route_column(
    node: dict[str, str],
    source_number: int,
    display_number: int,
    branch_start: bool = False,
) -> str:
    title = localized_text(human_title(node.get("title", f"Node {source_number}")))
    status = node.get("status", "unknown")
    date = html.escape(node.get("date", "undated"))
    outcome = localized_short_text(node.get("outcome", "No outcome recorded."))
    branch_class = " branch-start" if branch_start else ""
    return f"""<section class="track-column route-column{branch_class}">
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
</section>"""


def render_route_drilldown(
    branch: str,
    items: list[tuple[int, dict[str, str]]],
    bad_case_cards: list[dict[str, str]],
    case_anchor_map: dict[str, str],
    active: bool = False,
) -> str:
    seen_cases: set[str] = set()
    case_items: list[str] = []
    test_items: list[str] = []
    for source_number, node in items:
        for card in bad_cases_for_node(node, bad_case_cards):
            title = card.get("title", "")
            if title in seen_cases:
                continue
            seen_cases.add(title)
            case_items.append(render_bad_case_summary(card, case_anchor_map.get(title, "case-1")))
            test_items.append(render_bad_case_test_note(card, case_anchor_map.get(title, "case-1")))
    cases_html = "\n".join(case_items) or '<p class="muted" data-i18n="noLinkedBadCases">No linked bad cases.</p>'
    tests_html = "\n".join(test_items) or '<p class="muted" data-i18n="noLinkedBadCases">No linked bad cases.</p>'
    hidden = "" if active else " hidden"
    return f"""<section class="route-drilldown" data-route-panel="{html.escape(route_slug(branch))}"{hidden}>
  <article class="drill-card">
    <h3 data-i18n="badCases">Bad Cases</h3>
    {cases_html}
  </article>
  <article class="drill-card">
    <h3 data-i18n="testChain">Test Chain</h3>
    {tests_html}
  </article>
</section>"""


def render_track_column(
    node: dict[str, str],
    source_number: int,
    display_number: int,
    bad_case_cards: list[dict[str, str]],
    case_anchor_map: dict[str, str],
) -> str:
    title = localized_text(human_title(node.get("title", f"Node {source_number}")))
    status = node.get("status", "unknown")
    date = html.escape(node.get("date", "undated"))
    outcome = localized_short_text(node.get("outcome", "No outcome recorded."))
    cases = bad_cases_for_node(node, bad_case_cards)
    case_items = "\n".join(render_bad_case_summary(card, case_anchor_map.get(card.get("title", ""), "case-1")) for card in cases)
    if not case_items:
        case_items = '<p class="muted" data-i18n="noLinkedBadCases">No linked bad cases.</p>'
    test_items = "\n".join(
        render_bad_case_test_note(card, case_anchor_map.get(card.get("title", ""), "case-1"))
        for card in cases
    )
    if not test_items:
        test_items = '<p class="muted" data-i18n="noLinkedBadCases">No linked bad cases.</p>'
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
  <article class="lane lane-bad-cases" data-lane="bad-cases">
    {case_items}
  </article>
  <article class="lane lane-test-chain" data-lane="test-chain">
    {test_items}
  </article>
</section>"""


def render_node_detail(
    node: dict[str, str],
    number: int,
    bad_case_cards: list[dict[str, str]],
    case_anchor_map: dict[str, str],
) -> str:
    title = localized_text(human_title(node.get("title", f"Node {number}")))
    status = node.get("status", "unknown")
    date = html.escape(node.get("date", "undated"))
    outcome = localized_text(node.get("outcome", "No outcome recorded."))
    reason = localized_text(node.get("decision / reason", "No decision reason recorded."))
    avoid = localized_text(node.get("avoid going back", "No avoided path recorded."))
    next_step = localized_text(node.get("next", "No next step recorded."))
    test_chain = localized_text(node.get("test chain", "none"))
    branch = localized_text(branch_name(node))
    level_key = "levelCheckpoint" if node_level(node) == "checkpoint" else "levelMajor"
    level = html.escape(human_level(node))
    parent_raw = human_text(node.get("parent", ""))
    parent = localized_text(parent_raw) if parent_raw else ""
    cases = bad_cases_for_node(node, bad_case_cards)
    case_links = ", ".join(
        f'<a href="#{case_anchor_map.get(card.get("title", ""), "case-1")}">{localized_text(human_title(card.get("title", "Bad case")))}</a>'
        for card in cases
    ) or "None"
    return f"""<section class="detail-card" id="node-{number}">
  <h3>{number}. {title}</h3>
  <div class="visual-meta">{status_dot(status)}<span class="muted">{date}</span></div>
  <p class="field"><span class="level-chip" data-i18n="{level_key}">{level}</span></p>
  <p class="field"><b data-i18n="route">Route:</b> {branch}</p>
  {f'<p class="field"><b data-i18n="parentRoute">Parent route:</b> {parent}</p>' if parent else ''}
  <p class="field"><b data-i18n="outcome">Outcome:</b> {outcome}</p>
  <p class="field"><b data-i18n="decision">Decision:</b> {reason}</p>
  <p class="field"><b data-i18n="avoidGoingBack">Avoid going back:</b> {avoid}</p>
  <p class="field"><b data-i18n="next">Next:</b> {next_step}</p>
  <p class="field"><b data-i18n="badCasesField">Bad cases:</b> {case_links}</p>
  <p class="field"><b data-i18n="testChainField">Test chain:</b> {test_chain}</p>
</section>"""


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
        "phenomenon": "phenomenon",
        "trigger": "trigger / reproduction",
        "reproduction": "trigger / reproduction",
        "trigger / reproduction": "trigger / reproduction",
        "root cause": "root cause",
        "cause": "root cause",
        "fix": "fix method",
        "fix method": "fix method",
        "guard": "guard / verification",
        "guard / verification": "guard / verification",
        "verification": "guard / verification",
        "reusable guard path": "reusable guard path",
        "guard reuse rule": "guard reuse rule",
        "test chain": "test chain",
        "tests": "test chain",
        "high-frequency note": "high-frequency note",
        "recurrence analysis": "recurrence analysis",
        "evidence": "evidence",
    }
    return aliases.get(normalized, normalized)


def split_loose_bad_case_field(body: str) -> tuple[str, str] | None:
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
        "phenomenon",
        "trigger / reproduction",
        "root cause",
        "fix method",
        "guard / verification",
        "reusable guard path",
        "guard reuse rule",
        "test chain",
        "high-frequency note",
        "recurrence analysis",
        "evidence",
    }:
        return None
    return key, value.strip()


def loose_bad_case_title(card: dict[str, str]) -> str:
    title = card.get("title", "").strip()
    identifier = card.pop("id", "").strip()
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
        elif current and re.match(r"^[A-Za-z][A-Za-z _/-]+:\s+", stripped):
            body = stripped
        else:
            continue

        case_line = re.match(r"^(BC-\d{8}-\d+)\s*:\s*(.+)$", body)
        if case_line:
            commit_loose_bad_case(cards, current)
            current = {"id": case_line.group(1), "title": case_line.group(2).strip()}
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
    return f"""<article class="badcase">
  <div class="badcase-head">{status_dot(status)}{frequency_dot(frequency)}<a class="detail-link" href="#{html.escape(anchor)}">{title}</a></div>
  {f'<div class="tags">{tag_html}</div>' if tag_html else ''}
</article>"""


def render_bad_case_test_note(card: dict[str, str], anchor: str) -> str:
    title = localized_short_text(human_title(card.get("title", "Bad case")), 58)
    guard = first_nonempty(
        card.get("guard / verification", ""),
        card.get("guard", ""),
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
    status = card.get("status", "unknown")
    frequency = card.get("frequency", "unknown")
    phenomenon_raw = human_text(card.get("phenomenon", ""))
    trigger_raw = human_text(card.get("trigger / reproduction", ""))
    cause_raw = human_text(card.get("root cause", ""))
    fix_raw = human_text(card.get("fix method", ""))
    guard_raw = human_text(card.get("guard / verification", ""))
    phenomenon = localized_text(phenomenon_raw) if phenomenon_raw else ""
    trigger = localized_text(trigger_raw) if trigger_raw else ""
    cause = localized_text(cause_raw) if cause_raw else ""
    fix = localized_text(fix_raw) if fix_raw else ""
    guard = localized_text(guard_raw) if guard_raw else ""
    tags = parse_tags(card.get("tags", ""))
    tag_html = render_tags(tags)
    optional = "\n".join(
        line
        for line in [
            f'  <p class="field"><b data-i18n="phenomenon">Phenomenon:</b> {phenomenon}</p>' if phenomenon else "",
            f'  <p class="field"><b data-i18n="trigger">Trigger:</b> {trigger}</p>' if trigger else "",
            f'  <p class="field"><b data-i18n="rootCause">Root cause:</b> {cause}</p>' if cause else "",
            f'  <p class="field"><b data-i18n="fix">Fix:</b> {fix}</p>' if fix else "",
            f'  <p class="field"><b data-i18n="guard">Guard:</b> {guard}</p>' if guard else "",
        ]
        if line
    )
    return f"""<section class="detail-card" id="{html.escape(anchor)}">
  <h3>{title}</h3>
  <div class="visual-meta">{status_dot(status)}{frequency_dot(frequency)}</div>
{optional}
  {f'<div class="tags">{tag_html}</div>' if tag_html else ''}
</section>"""


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


def main() -> int:
    parser = argparse.ArgumentParser(description="Context Guard utilities")
    parser.add_argument("command", choices=["init", "set-language", "export-roadmap", "show-roadmap"])
    parser.add_argument("--format", choices=["html", "md"], default="html")
    parser.add_argument("--language", default=None, help="Folder-scoped language for future context records.")
    parser.add_argument("--open", action="store_true", help="Open the generated HTML roadmap with the default browser.")
    parser.add_argument("--root", type=Path, default=None)
    args = parser.parse_args()

    root = args.root.resolve() if args.root else folder_root(Path.cwd())
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
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
