#!/usr/bin/env python3
"""Utilities for Context Guard project context folders."""

from __future__ import annotations

import argparse
import html
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
    }
    for path, content in files.items():
        if write_if_missing(path, content):
            created.append(path)
    return created


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


def render_roadmap_html(ctx: Path, index: str, roadmap: str, bad_cases: str) -> str:
    nodes = parse_roadmap_nodes(roadmap)
    bad_case_cards = parse_bad_case_cards(bad_cases)
    exported = datetime.now().isoformat(timespec="seconds")
    case_anchor_map = build_case_anchor_map(bad_case_cards)
    route_groups = group_nodes_by_branch(nodes)
    route_items = "\n".join(render_route_group(branch, items, bad_case_cards, case_anchor_map) for branch, items in route_groups)
    if not route_items:
        route_items = '<section class="empty">No roadmap nodes recorded yet.</section>'
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Context Roadmap Human View</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #20242a;
      --muted: #69707d;
      --line: #d9dee7;
      --accent: #2563eb;
      --accent-soft: #e8f0ff;
      --warn: #b45309;
      --warn-soft: #fff5df;
      --ok: #047857;
      --danger: #dc2626;
      --quiet: #94a3b8;
      --shadow: 0 8px 24px rgba(31, 41, 55, 0.08);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }}
    header {{
      padding: 22px 32px 14px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }}
    h1 {{ margin: 0 0 4px; font-size: 24px; letter-spacing: 0; }}
    .meta {{ color: var(--muted); display: flex; gap: 16px; flex-wrap: wrap; }}
    .shell {{
      padding: 16px 32px 30px;
    }}
    h2 {{ margin: 0 0 12px; font-size: 16px; }}
    .track-board {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 16px;
    }}
    .route-stack {{
      display: grid;
      gap: 18px;
    }}
    .route-group {{
      min-width: 0;
    }}
    .route-head {{
      display: flex;
      align-items: center;
      gap: 9px;
      margin-bottom: 10px;
    }}
    .route-mark {{
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 0 4px var(--accent-soft);
    }}
    .route-title {{
      font-size: 13px;
      font-weight: 760;
    }}
    .route-pill {{
      border-radius: 999px;
      background: #f1f5f9;
      color: var(--muted);
      font-size: 11px;
      font-weight: 680;
      padding: 1px 7px;
    }}
    .route-strip {{
      overflow: auto;
      padding-bottom: 2px;
    }}
    .track-grid {{
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(220px, 280px);
      gap: 14px;
      min-height: 430px;
      align-items: stretch;
    }}
    .track-column {{
      display: grid;
      grid-template-rows: minmax(130px, auto) minmax(120px, auto) minmax(90px, auto);
      gap: 12px;
    }}
    .lane {{
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fff;
      min-width: 0;
    }}
    .lane-main {{ border-top: 4px solid var(--accent); }}
    .lane-bad-cases {{ border-top: 4px solid var(--warn); }}
    .lane-test-chain {{ border-top: 4px solid var(--ok); }}
    .lane-label {{
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
      margin-bottom: 8px;
      text-transform: uppercase;
    }}
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
      background: var(--accent); color: white; font-weight: 700;
    }}
    .lane h3 {{ margin: 0; font-size: 15px; line-height: 1.35; }}
    .node-meta {{ display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }}
    .pill {{
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 8px;
      background: var(--accent-soft);
      color: #1d4ed8;
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
    .empty {{ color: var(--muted); padding: 18px; border: 1px dashed var(--line); border-radius: 8px; }}
    @media (max-width: 980px) {{
      .shell {{ padding: 16px; }}
      .quick {{ grid-template-columns: 1fr 1fr; }}
      .track-grid {{ grid-auto-columns: minmax(260px, 82vw); }}
      header {{ padding: 22px 16px 14px; }}
    }}
    @media (max-width: 560px) {{
      h1 {{ font-size: 22px; }}
    }}
  </style>
</head>
<body>
  <header>
    <h1>Context Roadmap</h1>
    <div class="meta">
      <span>Human-facing view</span>
      <span>Updated: {html.escape(exported)}</span>
    </div>
  </header>
  <div class="shell">
    <main class="track-board">
      <h2>Roadmap</h2>
      <div class="route-stack">{route_items}</div>
    </main>
  </div>
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
        node_sections = '<section class="detail-card">No roadmap nodes recorded yet.</section>'
    case_sections = "\n".join(render_case_detail(card, case_anchor_map.get(card.get("title", ""), f"case-{i}")) for i, card in enumerate(cards, 1))
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
    h1 {{ margin: 0 0 4px; font-size: 24px; }}
    h2 {{ margin-top: 28px; }}
    h3 {{ margin: 0 0 8px; font-size: 18px; }}
    .meta, .muted {{ color: #69707d; }}
    .detail-card {{ background: #fff; border: 1px solid #d9dee7; border-radius: 8px; padding: 16px; margin: 14px 0; }}
    .field {{ margin: 8px 0; }}
    .field b {{ color: #69707d; }}
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
    <h1>Roadmap Details</h1>
    <div class="meta">Human detail view · Updated: {html.escape(exported)} · <a href="roadmap.html">Back to roadmap</a></div>
  </header>
  <main>
    <h2>Main Route</h2>
    {node_sections}
    <h2>Bad Cases</h2>
    {case_sections or '<p class="muted">No bad cases recorded.</p>'}
  </main>
</body>
</html>
"""


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
            current[key.strip().lower()] = value.strip()
    if current:
        nodes.append(current)
    return nodes


def node_id(node: dict[str, str]) -> str:
    title = node.get("title", "")
    match = re.match(r"(NODE-\d{8}-\d+)", title)
    return match.group(1) if match else title.split(":", 1)[0].strip()


def branch_name(node: dict[str, str]) -> str:
    return human_text(node.get("branch", "Main")).strip() or "Main"


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


def human_title(title: str) -> str:
    return re.sub(r"^(?:NODE|BC)-\d{8}-\d+:\s*", "", title).strip() or title


def human_text(text: str) -> str:
    text = re.sub(r"`?CTX-\d{8}-[\w-]+`?", "this task", text)
    text = re.sub(r"`?NODE-\d{8}-\d+`?", "a roadmap node", text)
    text = re.sub(r"`?BC-\d{8}-\d+`?", "a linked bad case", text)
    return text


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


def render_tags(tags: list[str], limit: int | None = None) -> str:
    if limit is not None:
        visible = tags[:limit]
        hidden = len(tags) - len(visible)
    else:
        visible = tags
        hidden = 0
    pieces = [
        f'<span class="tag {tag_class(tag)}"><span class="tag-emoji" aria-hidden="true">{html.escape(tag_emoji(tag))}</span>{html.escape(tag)}</span>'
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


def render_route_group(
    branch: str,
    items: list[tuple[int, dict[str, str]]],
    bad_case_cards: list[dict[str, str]],
    case_anchor_map: dict[str, str],
) -> str:
    columns = "\n".join(render_track_column(node, number, bad_case_cards, case_anchor_map) for number, node in items)
    label = html.escape(branch)
    count = len(items)
    return f"""<section class="route-group">
  <div class="route-head">
    <span class="route-mark" aria-hidden="true"></span>
    <span class="route-title">{label}</span>
    <span class="route-pill">{count}</span>
  </div>
  <div class="route-strip">
    <div class="track-grid">{columns}</div>
  </div>
</section>"""


def render_track_column(
    node: dict[str, str],
    number: int,
    bad_case_cards: list[dict[str, str]],
    case_anchor_map: dict[str, str],
) -> str:
    title = html.escape(human_title(node.get("title", f"Node {number}")))
    status = node.get("status", "unknown")
    date = html.escape(node.get("date", "undated"))
    outcome = html.escape(short_text(node.get("outcome", "No outcome recorded.")))
    test_chain = html.escape(short_text(node.get("test chain", "No test chain recorded."), 70))
    cases = bad_cases_for_node(node, bad_case_cards)
    case_items = "\n".join(render_bad_case_summary(card, case_anchor_map.get(card.get("title", ""), "case-1")) for card in cases)
    if not case_items:
        case_items = '<p class="muted">No linked bad cases.</p>'
    return f"""<section class="track-column">
  <article class="lane lane-main" data-lane="main">
    <a class="lane-link" href="roadmap-details.html#node-{number}">
      <div class="lane-label">Main Route</div>
      <div class="node-heading">
        <div class="node-number">{number}</div>
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
    <div class="lane-label">Bad Cases</div>
    {case_items}
  </article>
  <article class="lane lane-test-chain" data-lane="test-chain">
    <div class="lane-label">Test Chain</div>
    <a class="detail-link" href="roadmap-details.html#node-{number}">{test_chain}</a>
  </article>
</section>"""


def render_node_detail(
    node: dict[str, str],
    number: int,
    bad_case_cards: list[dict[str, str]],
    case_anchor_map: dict[str, str],
) -> str:
    title = html.escape(human_title(node.get("title", f"Node {number}")))
    status = node.get("status", "unknown")
    date = html.escape(node.get("date", "undated"))
    outcome = html.escape(human_text(node.get("outcome", "No outcome recorded.")))
    reason = html.escape(human_text(node.get("decision / reason", "No decision reason recorded.")))
    avoid = html.escape(human_text(node.get("avoid going back", "No avoided path recorded.")))
    next_step = html.escape(human_text(node.get("next", "No next step recorded.")))
    test_chain = html.escape(human_text(node.get("test chain", "none")))
    branch = html.escape(branch_name(node))
    parent = html.escape(human_text(node.get("parent", "")))
    cases = bad_cases_for_node(node, bad_case_cards)
    case_links = ", ".join(
        f'<a href="#{case_anchor_map.get(card.get("title", ""), "case-1")}">{html.escape(human_title(card.get("title", "Bad case")))}</a>'
        for card in cases
    ) or "None"
    return f"""<section class="detail-card" id="node-{number}">
  <h3>{number}. {title}</h3>
  <div class="visual-meta">{status_dot(status)}<span class="muted">{date}</span></div>
  <p class="field"><b>Route:</b> {branch}</p>
  {f'<p class="field"><b>Parent route:</b> {parent}</p>' if parent else ''}
  <p class="field"><b>Outcome:</b> {outcome}</p>
  <p class="field"><b>Decision:</b> {reason}</p>
  <p class="field"><b>Avoid going back:</b> {avoid}</p>
  <p class="field"><b>Next:</b> {next_step}</p>
  <p class="field"><b>Bad cases:</b> {case_links}</p>
  <p class="field"><b>Test chain:</b> {test_chain}</p>
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
            current[key.strip().lower()] = value.strip()
    if current:
        cards.append(current)
    return cards


def render_bad_case_summary(card: dict[str, str], anchor: str) -> str:
    title = html.escape(human_title(card.get("title", "Bad case")))
    status = card.get("status", "unknown")
    frequency = card.get("frequency", "")
    tags = parse_tags(card.get("tags", ""))
    tag_html = render_tags(tags, limit=3)
    return f"""<article class="badcase">
  <div class="badcase-head">{status_dot(status)}{frequency_dot(frequency)}<a class="detail-link" href="roadmap-details.html#{html.escape(anchor)}">{title}</a></div>
  {f'<div class="tags">{tag_html}</div>' if tag_html else ''}
</article>"""


def render_case_detail(card: dict[str, str], anchor: str) -> str:
    title = html.escape(human_title(card.get("title", "Bad case")))
    status = card.get("status", "unknown")
    frequency = card.get("frequency", "unknown")
    phenomenon = html.escape(human_text(card.get("phenomenon", "")))
    trigger = html.escape(human_text(card.get("trigger / reproduction", "")))
    cause = html.escape(human_text(card.get("root cause", "")))
    fix = html.escape(human_text(card.get("fix method", "")))
    guard = html.escape(human_text(card.get("guard / verification", "")))
    tags = parse_tags(card.get("tags", ""))
    tag_html = render_tags(tags)
    optional = "\n".join(
        line
        for line in [
            f'  <p class="field"><b>Phenomenon:</b> {phenomenon}</p>' if phenomenon else "",
            f'  <p class="field"><b>Trigger:</b> {trigger}</p>' if trigger else "",
            f'  <p class="field"><b>Root cause:</b> {cause}</p>' if cause else "",
            f'  <p class="field"><b>Fix:</b> {fix}</p>' if fix else "",
            f'  <p class="field"><b>Guard:</b> {guard}</p>' if guard else "",
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
    parser.add_argument("command", choices=["init", "export-roadmap", "show-roadmap"])
    parser.add_argument("--format", choices=["html", "md"], default="html")
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
    if args.command == "show-roadmap":
        show_roadmap(root, args.open)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
