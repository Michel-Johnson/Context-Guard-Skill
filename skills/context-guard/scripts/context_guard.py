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
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    suffix = "html" if output_format == "html" else "md"
    dest = ctx / "exports" / f"roadmap-{stamp}.{suffix}"
    roadmap = source.read_text(encoding="utf-8")
    index = (ctx / "index.md").read_text(encoding="utf-8")
    bad_cases = (ctx / "bad-cases.md").read_text(encoding="utf-8")
    if output_format == "html":
        dest.write_text(render_roadmap_html(ctx, index, roadmap, bad_cases), encoding="utf-8")
        return dest
    dest.write_text(
        "\n".join(
            [
                "# Exported Context Roadmap",
                "",
                f"- Source folder: `{ctx}`",
                f"- Exported: {datetime.now().isoformat(timespec='seconds')}",
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
        ),
        encoding="utf-8",
    )
    return dest


def show_roadmap(root: Path, open_browser: bool = False) -> Path:
    dest = export_roadmap(root, "html")
    uri = dest.resolve().as_uri()
    print(f"[context-guard] roadmap html: {dest}")
    print(f"[context-guard] roadmap url: {uri}")
    if open_browser:
        webbrowser.open(uri)
    return dest


def render_roadmap_html(ctx: Path, index: str, roadmap: str, bad_cases: str) -> str:
    quick_scan = parse_bullets(extract_section(index, "## Quick Scan"))
    nodes = parse_roadmap_nodes(roadmap)
    bad_case_cards = parse_bad_case_cards(bad_cases)
    exported = datetime.now().isoformat(timespec="seconds")
    quick_items = "\n".join(
        f"<li><span>{html.escape(k)}</span><strong>{html.escape(v)}</strong></li>"
        for k, v in quick_scan
    ) or "<li><span>Status</span><strong>No quick scan entries</strong></li>"
    node_items = "\n".join(render_node(node, i) for i, node in enumerate(nodes, 1))
    if not node_items:
        node_items = '<section class="empty">No roadmap nodes recorded yet.</section>'
    bad_case_items = "\n".join(render_bad_case(card) for card in bad_case_cards)
    if not bad_case_items:
        bad_case_items = '<p class="muted">No bad-case tags recorded yet.</p>'
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Context Roadmap</title>
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
      padding: 28px 32px 16px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }}
    h1 {{ margin: 0 0 6px; font-size: 28px; letter-spacing: 0; }}
    .meta {{ color: var(--muted); display: flex; gap: 16px; flex-wrap: wrap; }}
    .layout {{
      display: grid;
      grid-template-columns: minmax(220px, 280px) minmax(0, 1fr) minmax(220px, 300px);
      gap: 20px;
      padding: 20px 32px 36px;
      align-items: start;
    }}
    aside, main {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }}
    aside {{ padding: 16px; position: sticky; top: 16px; }}
    main {{ padding: 18px 20px 24px; }}
    h2 {{ margin: 0 0 12px; font-size: 16px; }}
    .quick {{ list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }}
    .quick li {{ border-bottom: 1px solid var(--line); padding-bottom: 10px; }}
    .quick li:last-child {{ border-bottom: 0; padding-bottom: 0; }}
    .quick span {{ display: block; color: var(--muted); font-size: 12px; }}
    .quick strong {{ display: block; margin-top: 2px; overflow-wrap: anywhere; }}
    .timeline {{ position: relative; display: grid; gap: 18px; }}
    .node {{
      position: relative;
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 14px;
    }}
    .node-number {{
      width: 34px; height: 34px; border-radius: 50%;
      display: grid; place-items: center;
      background: var(--accent); color: white; font-weight: 700;
      margin-top: 4px;
    }}
    .node-card {{
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      background: #fff;
    }}
    .node-card h3 {{ margin: 0 0 8px; font-size: 18px; }}
    .node-meta {{ display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }}
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
    .field {{ margin: 8px 0; }}
    .field b {{ color: var(--muted); font-weight: 600; }}
    .avoid {{ border-left: 3px solid var(--warn); background: var(--warn-soft); padding: 8px 10px; border-radius: 6px; }}
    .badcase {{ border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 10px; }}
    .badcase h3 {{ margin: 0 0 8px; font-size: 14px; }}
    .tags {{ display: flex; gap: 6px; flex-wrap: wrap; }}
    .tag {{ background: #eef2f7; color: #334155; border-radius: 999px; padding: 2px 7px; font-size: 12px; }}
    .muted {{ color: var(--muted); }}
    .empty {{ color: var(--muted); padding: 18px; border: 1px dashed var(--line); border-radius: 8px; }}
    @media (max-width: 980px) {{
      .layout {{ grid-template-columns: 1fr; padding: 16px; }}
      aside {{ position: static; }}
      header {{ padding: 22px 16px 14px; }}
    }}
  </style>
</head>
<body>
  <header>
    <h1>Context Roadmap</h1>
    <div class="meta">
      <span>Source: <code>{html.escape(str(ctx))}</code></span>
      <span>Exported: {html.escape(exported)}</span>
    </div>
  </header>
  <div class="layout">
    <aside>
      <h2>Quick Scan</h2>
      <ul class="quick">{quick_items}</ul>
    </aside>
    <main>
      <h2>Main Route</h2>
      <div class="timeline">{node_items}</div>
    </main>
    <aside>
      <h2>Bad Cases</h2>
      {bad_case_items}
    </aside>
  </div>
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


def render_node(node: dict[str, str], number: int) -> str:
    title = html.escape(node.get("title", f"Node {number}"))
    status = html.escape(node.get("status", "unknown"))
    date = html.escape(node.get("date", "undated"))
    task = html.escape(node.get("task", "unlinked"))
    outcome = html.escape(node.get("outcome", "No outcome recorded."))
    reason = html.escape(node.get("decision / reason", "No decision reason recorded."))
    avoid = html.escape(node.get("avoid going back", "No avoided path recorded."))
    next_step = html.escape(node.get("next", "No next step recorded."))
    linked = html.escape(node.get("linked bad cases", "none"))
    test_chain = html.escape(node.get("test chain", "none"))
    return f"""<section class="node">
  <div class="node-number">{number}</div>
  <article class="node-card">
    <h3>{title}</h3>
    <div class="node-meta">
      <span class="pill">{status}</span>
      <span class="pill">{date}</span>
      <span class="pill">{task}</span>
    </div>
    <p class="field"><b>Outcome:</b> {outcome}</p>
    <p class="field"><b>Decision:</b> {reason}</p>
    <p class="field avoid"><b>Avoid going back:</b> {avoid}</p>
    <p class="field"><b>Next:</b> {next_step}</p>
    <p class="field"><b>Bad cases:</b> {linked}</p>
    <p class="field"><b>Test chain:</b> {test_chain}</p>
  </article>
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


def render_bad_case(card: dict[str, str]) -> str:
    title = html.escape(card.get("title", "Bad case"))
    nodes = html.escape(card.get("roadmap nodes", "unlinked"))
    frequency = html.escape(card.get("frequency", "unknown"))
    tags = re.findall(r"#[\\w-]+", card.get("tags", ""))
    tag_html = "".join(f'<span class="tag">{html.escape(tag)}</span>' for tag in tags) or '<span class="tag">untagged</span>'
    return f"""<article class="badcase">
  <h3>{title}</h3>
  <p class="muted">Nodes: {nodes}</p>
  <p class="muted">Frequency: {frequency}</p>
  <div class="tags">{tag_html}</div>
</article>"""


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
