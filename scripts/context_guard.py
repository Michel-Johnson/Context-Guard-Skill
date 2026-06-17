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
        for old_html in out_dir.glob("*.html"):
            if old_html != dest:
                old_html.unlink()
        (out_dir / "roadmap.md").write_text(render_roadmap_markdown(ctx, index, roadmap, bad_cases), encoding="utf-8")
        dest.write_text(render_roadmap_html(ctx, index, roadmap, bad_cases), encoding="utf-8")
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
    quick_scan = parse_bullets(extract_section(index, "## Quick Scan"))[:4]
    nodes = parse_roadmap_nodes(roadmap)
    bad_case_cards = parse_bad_case_cards(bad_cases)
    exported = datetime.now().isoformat(timespec="seconds")
    quick_items = "\n".join(
        f"<li><span>{html.escape(k)}</span><strong>{html.escape(human_text(v))}</strong></li>"
        for k, v in quick_scan
    ) or "<li><span>Status</span><strong>No quick scan entries</strong></li>"
    node_items = "\n".join(render_track_column(node, i, bad_case_cards) for i, node in enumerate(nodes, 1))
    if not node_items:
        node_items = '<section class="empty">No roadmap nodes recorded yet.</section>'
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
    .shell {{
      padding: 18px 32px 34px;
    }}
    .quick-panel {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 14px 16px;
      margin-bottom: 16px;
    }}
    h2 {{ margin: 0 0 12px; font-size: 16px; }}
    .quick {{ list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(150px, 1fr)); }}
    .quick li {{ border-right: 1px solid var(--line); padding-right: 12px; }}
    .quick li:last-child {{ border-right: 0; padding-right: 0; }}
    .quick span {{ display: block; color: var(--muted); font-size: 12px; }}
    .quick strong {{ display: block; margin-top: 2px; overflow-wrap: anywhere; }}
    .track-board {{
      overflow: auto;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 16px;
    }}
    .track-grid {{
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(280px, 340px);
      gap: 14px;
      min-height: 620px;
      align-items: stretch;
    }}
    .track-column {{
      display: grid;
      grid-template-rows: minmax(190px, auto) minmax(160px, auto) minmax(130px, auto);
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
    .lane h3 {{ margin: 0; font-size: 16px; line-height: 1.35; }}
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
    details {{ margin-top: 10px; color: var(--muted); }}
    summary {{ cursor: pointer; color: var(--ink); font-weight: 650; }}
    details .field {{ margin-left: 2px; }}
    .badcase {{ border-bottom: 1px solid var(--line); padding-bottom: 10px; margin-bottom: 10px; }}
    .badcase:last-child {{ border-bottom: 0; padding-bottom: 0; margin-bottom: 0; }}
    .badcase h3 {{ margin: 0 0 8px; font-size: 14px; }}
    .tags {{ display: flex; gap: 6px; flex-wrap: wrap; }}
    .tag {{ background: #eef2f7; color: #334155; border-radius: 999px; padding: 2px 7px; font-size: 12px; }}
    .muted {{ color: var(--muted); }}
    .empty {{ color: var(--muted); padding: 18px; border: 1px dashed var(--line); border-radius: 8px; }}
    @media (max-width: 980px) {{
      .shell {{ padding: 16px; }}
      .quick {{ grid-template-columns: 1fr 1fr; }}
      .track-grid {{ grid-auto-columns: minmax(260px, 82vw); }}
      header {{ padding: 22px 16px 14px; }}
    }}
    @media (max-width: 560px) {{
      .quick {{ grid-template-columns: 1fr; }}
      .quick li {{ border-right: 0; border-bottom: 1px solid var(--line); padding-right: 0; padding-bottom: 8px; }}
      .quick li:last-child {{ border-bottom: 0; padding-bottom: 0; }}
    }}
  </style>
</head>
<body>
  <header>
    <h1>Context Roadmap</h1>
    <div class="meta">
      <span>Human-facing view</span>
      <span>Codex source: <code>index.md</code>, <code>roadmap.md</code>, <code>bad-cases.md</code></span>
      <span>Source: <code>{html.escape(str(ctx))}</code></span>
      <span>Exported: {html.escape(exported)}</span>
    </div>
  </header>
  <div class="shell">
    <section class="quick-panel">
      <h2>Quick Scan</h2>
      <ul class="quick">{quick_items}</ul>
    </section>
    <main class="track-board">
      <h2>Roadmap Tracks</h2>
      <div class="track-grid">{node_items}</div>
    </main>
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


def node_id(node: dict[str, str]) -> str:
    title = node.get("title", "")
    match = re.match(r"(NODE-\d{8}-\d+)", title)
    return match.group(1) if match else title.split(":", 1)[0].strip()


def human_title(title: str) -> str:
    return re.sub(r"^(?:NODE|BC)-\d{8}-\d+:\s*", "", title).strip() or title


def human_text(text: str) -> str:
    text = re.sub(r"`?CTX-\d{8}-[\w-]+`?", "this task", text)
    text = re.sub(r"`?NODE-\d{8}-\d+`?", "a roadmap node", text)
    text = re.sub(r"`?BC-\d{8}-\d+`?", "a linked bad case", text)
    return text


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


def render_track_column(node: dict[str, str], number: int, bad_case_cards: list[dict[str, str]]) -> str:
    title = html.escape(human_title(node.get("title", f"Node {number}")))
    status = html.escape(node.get("status", "unknown"))
    date = html.escape(node.get("date", "undated"))
    outcome = html.escape(human_text(node.get("outcome", "No outcome recorded.")))
    reason = html.escape(human_text(node.get("decision / reason", "No decision reason recorded.")))
    avoid = html.escape(human_text(node.get("avoid going back", "No avoided path recorded.")))
    next_step = html.escape(human_text(node.get("next", "No next step recorded.")))
    test_chain = html.escape(human_text(node.get("test chain", "none")))
    cases = bad_cases_for_node(node, bad_case_cards)
    case_items = "\n".join(render_bad_case(card) for card in cases)
    if not case_items:
        case_items = '<p class="muted">No linked bad cases.</p>'
    case_summary = "No linked bad cases." if not cases else f"{len(cases)} linked bad case{'s' if len(cases) != 1 else ''}."
    return f"""<section class="track-column">
  <article class="lane lane-main" data-lane="main">
    <div class="lane-label">Main Route</div>
    <div class="node-heading">
      <div class="node-number">{number}</div>
      <h3>{title}</h3>
    </div>
    <div class="node-meta">
      <span class="pill">{status}</span>
      <span class="pill">{date}</span>
    </div>
    <p class="field"><b>Outcome:</b> {outcome}</p>
    <p class="field"><b>Next:</b> {next_step}</p>
    <p class="field"><b>Bad cases:</b> {html.escape(case_summary)}</p>
    <details>
      <summary>Details</summary>
      <p class="field"><b>Decision:</b> {reason}</p>
      <p class="field avoid"><b>Avoid going back:</b> {avoid}</p>
      <p class="field"><b>Test chain:</b> {test_chain}</p>
    </details>
  </article>
  <article class="lane lane-bad-cases" data-lane="bad-cases">
    <div class="lane-label">Bad Cases</div>
    {case_items}
  </article>
  <article class="lane lane-test-chain" data-lane="test-chain">
    <div class="lane-label">Test Chain</div>
    <p class="field">{test_chain}</p>
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
    title = html.escape(human_title(card.get("title", "Bad case")))
    status = html.escape(card.get("status", "unknown"))
    frequency = html.escape(card.get("frequency", "unknown"))
    phenomenon = html.escape(human_text(card.get("phenomenon", "")))
    tags = re.findall(r"#[\\w-]+", card.get("tags", ""))
    tag_html = "".join(f'<span class="tag">{html.escape(tag)}</span>' for tag in tags) or '<span class="tag">untagged</span>'
    phenomenon_html = f'  <p class="field">{phenomenon}</p>\n' if phenomenon else ""
    return f"""<article class="badcase">
  <h3>{title}</h3>
{phenomenon_html}  <p class="muted">Status: {status}</p>
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
