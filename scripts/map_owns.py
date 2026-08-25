#!/usr/bin/env python3
"""Resolve a repo-relative path to the map node that owns it.

owns = source ownership (file or directory prefix ending in /).
files on a node remain evidence attachments, not ownership.

Longest match wins. Exact file beats a parent directory.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


CG_OWNS = {
    "N11": ["SKILL.md"],
    "N21": ["prototype/workbench.html"],
    "M21": ["prototype/"],
    "N31": [".codex/context/index.md"],
    "N32": [".codex/context/preferences.json"],
    "N33": [".codex/context/architecture.md"],
    "N34": [".codex/context/user-messages.md"],
    "N35": [".codex/context/private/"],
    "N36": [".codex/context/map.json"],
    "M3": [".codex/context/"],
    "N41": ["scripts/context_guard.py", "skills/context-guard/scripts/context_guard.py"],
    "N43": ["scripts/context_guard_hook.py", "skills/context-guard/scripts/context_guard_hook.py"],
    "M4": ["scripts/", "skills/context-guard/"],
    "N51": ["README.md"],
}


def norm_repo_path(path: str) -> str:
    p = str(path or "").replace("\\", "/").strip()
    if p.startswith("./"):
        p = p[2:]
    return p.lstrip("/")


def own_score(owned: str, file: str) -> int:
    o, f = norm_repo_path(owned), norm_repo_path(file)
    if not o or not f:
        return 0
    if f == o:
        return 10000 + len(o)
    directory = o if o.endswith("/") else o + "/"
    if f.startswith(directory):
        return 1000 + len(directory)
    return 0


def walk_nodes(node, parents=None):
    if not node:
        return
    chain = (parents or []) + [node]
    yield node, chain
    for child in node.get("children") or []:
        yield from walk_nodes(child, chain)
    for child in node.get("_inbox") or []:
        yield from walk_nodes(child, chain)


def load_map(root: Path) -> dict:
    path = root / ".codex" / "context" / "map.json"
    return json.loads(path.read_text(encoding="utf-8"))


def lookup(doc: dict, file: str) -> dict | None:
    file = norm_repo_path(file)
    best = None
    score = 0
    ties: list[dict] = []
    root = doc.get("root") or doc
    for node, chain in walk_nodes(root):
        if node.get("proposal") == "cancelled":
            continue
        for owned in node.get("owns") or []:
            s = own_score(owned, file)
            if not s:
                continue
            if s > score:
                score = s
                best = (node, chain)
                ties = [node]
            elif s == score and best and best[0].get("id") != node.get("id"):
                ties.append(node)
    if not best:
        return None
    node, chain = best
    if len(ties) > 1:
        ties.sort(key=lambda n: (0 if n.get("kind") == "work" else 1, -len(str(n.get("id") or ""))))
        node = ties[0]
        chain = next(c for n, c in walk_nodes(root) if n.get("id") == node.get("id"))
    def mem_rows(n):
        return [
            {
                "id": m.get("id"),
                "text": m.get("text"),
                "state": m.get("state"),
                "record": m.get("record"),
            }
            for m in (n.get("memories") or [])
            if isinstance(m, dict)
        ]

    def bug_rows(n):
        return [
            {
                "id": b.get("id"),
                "title": b.get("title"),
                "status": b.get("status"),
                "record": b.get("record"),
            }
            for b in (n.get("bugs") or [])
            if isinstance(b, dict) and b.get("status") != "dormant"
        ]

    return {
        "path": file,
        "node_id": node.get("id"),
        "title": node.get("title"),
        "kind": node.get("kind"),
        "owns": node.get("owns") or [],
        "conflict": len({n.get("id") for n in ties}) > 1,
        "tie_ids": [n.get("id") for n in ties] if len(ties) > 1 else [],
        "memories": mem_rows(node),
        "bugs": bug_rows(node),
        "ancestors": [
            {
                "id": a.get("id"),
                "title": a.get("title"),
                "memories": mem_rows(a),
                "bugs": bug_rows(a),
            }
            for a in chain[:-1]
        ],
    }


def stamp_owns(node: dict, table: dict) -> None:
    if node.get("id") in table:
        node["owns"] = list(table[node["id"]])
    else:
        node.pop("owns", None)
    for child in node.get("children") or []:
        stamp_owns(child, table)
    for child in node.get("_inbox") or []:
        stamp_owns(child, table)


def build_owns_index(doc: dict) -> dict:
    rows = []
    root = doc.get("root") or doc
    for node, _ in walk_nodes(root):
        if node.get("proposal") == "cancelled":
            continue
        for owned in node.get("owns") or []:
            rows.append(
                {
                    "path": owned,
                    "node": node.get("id"),
                    "kind": node.get("kind"),
                    "title": node.get("title"),
                }
            )
    return {"owns": rows}


def write_owns_index(root: Path) -> Path:
    dest = root / ".codex" / "context" / "owns-index.json"
    dest.write_text(
        json.dumps(build_owns_index(load_map(root)), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return dest


def stamp_map(root: Path) -> Path:
    path = root / ".codex" / "context" / "map.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("root"):
        stamp_owns(doc["root"], CG_OWNS)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def flow_neighbors(doc: dict, nid: str) -> list[dict]:
    seen = set()
    rows = []
    for f in doc.get("flows") or []:
        a, b = f.get("from"), f.get("to")
        other = None
        if a == nid:
            other = b
        elif b == nid:
            other = a
        if not other or other in seen:
            continue
        seen.add(other)
        rows.append({"id": other, "label": f.get("label") or ""})
    return rows


def card_markdown(node: dict, chain: list, doc: dict) -> str:
    nid = str(node.get("id") or "")
    parent = chain[-2] if len(chain) > 1 else None
    chain_s = " > ".join(
        f"{n.get('id')} {n.get('title')}" for n in chain if n.get("id")
    )
    owns = node.get("owns") or []
    related = flow_neighbors(doc, nid)
    kids = []
    for c in (node.get("children") or []) + (node.get("_inbox") or []):
        if c.get("proposal") == "cancelled":
            continue
        kids.append(f"- {c.get('id')} {c.get('title')}")
    mems = []
    for m in node.get("memories") or []:
        if isinstance(m, dict) and m.get("text"):
            mems.append(f"- {m.get('text')}")
    bugs = []
    for b in node.get("bugs") or []:
        if not isinstance(b, dict) or b.get("status") == "dormant":
            continue
        bid = b.get("id")
        bugs.append(f"- [{bid}](../bugs/{bid}.md) {b.get('title') or ''}")
    rel_s = ", ".join(
        f"{r['id']}（{r['label']}）" if r.get("label") else r["id"] for r in related
    ) or "(none)"
    lines = [
        f"# {nid} {node.get('title') or ''}",
        "",
        f"- kind: {node.get('kind') or ''}",
        f"- parent: {parent.get('id') if parent else '(root)'}",
        f"- chain: {chain_s}",
        f"- owns: {', '.join(owns) if owns else '(none)'}",
        f"- related: {rel_s}",
        f"- card: `.codex/context/cards/{nid}.md`",
        "",
        "## 记忆",
        "",
        "\n".join(mems) if mems else "（无）",
        "",
        "## Bug",
        "",
        "\n".join(bugs) if bugs else "（无）",
        "",
        "## 孩子",
        "",
        "\n".join(kids) if kids else "（无）",
        "",
    ]
    return "\n".join(lines)


def write_cards(root: Path) -> Path:
    ctx = root / ".codex" / "context"
    dest = ctx / "cards"
    dest.mkdir(parents=True, exist_ok=True)
    for old in dest.glob("*.md"):
        old.unlink()
    doc = load_map(root)
    tree = doc.get("root") or doc
    for node, chain in walk_nodes(tree):
        if node.get("proposal") == "cancelled" or not node.get("id"):
            continue
        (dest / f"{node['id']}.md").write_text(
            card_markdown(node, chain, doc), encoding="utf-8"
        )
    write_owns_index(root)
    find = ctx / "FIND.md"
    find.write_text(
        "# 怎么找到该读的那一段\n\n"
        "人改图仍写 `map.json`。Agent 不要把整份 map 读进上下文。"
        "先打开小文件，再按上面的指针跳。\n\n"
        "1. **改某个源码**：打开 `owns-index.json`，找到卡号，再打开 `cards/卡号.md`。"
        "需要上面几层的规矩：看卡片里的 `chain`，按需打开那些 `cards/`。\n"
        "2. **修某个坏例**：打开 `bugs/B20.md`（里面写了挂在哪张卡），再打开那张 `cards/`。"
        "链上的记忆按 `chain` 往上走。牵到别的模块：看卡片上的 `related`，再打开那些卡。"
        "related 是能往返的邻居，不必分谁指向谁。\n"
        "3. **图改过之后**：`python3 scripts/map_owns.py cards` 重新写出 `cards/` 和 `owns-index.json`。\n",
        encoding="utf-8",
    )
    return dest


def find_bug_card(doc: dict, bug_id: str) -> dict | None:
    root = doc.get("root") or doc
    for node, chain in walk_nodes(root):
        for b in node.get("bugs") or []:
            if isinstance(b, dict) and b.get("id") == bug_id:
                return {"bug": b, "node": node, "chain": chain}
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Map path ownership for Context Guard")
    parser.add_argument("command", choices=["lookup", "stamp", "index", "cards", "where"])
    parser.add_argument("--path", default="", help="Repo-relative file to look up")
    parser.add_argument("--bug", default="", help="Bug id such as B20")
    parser.add_argument("--root", type=Path, default=None)
    args = parser.parse_args()
    root = (args.root or Path.cwd()).resolve()
    if args.command == "stamp":
        print(stamp_map(root))
        return 0
    if args.command == "index":
        print(write_owns_index(root))
        return 0
    if args.command == "cards":
        print(write_cards(root))
        return 0
    if args.command == "where":
        doc = load_map(root)
        if args.bug:
            hit = find_bug_card(doc, args.bug)
            if not hit:
                print(json.dumps({"bug": args.bug, "card": None}, ensure_ascii=False, indent=2))
                return 1
            nid = hit["node"].get("id")
            print(
                json.dumps(
                    {
                        "bug": args.bug,
                        "bug_file": f".codex/context/bugs/{args.bug}.md",
                        "node_id": nid,
                        "card": f".codex/context/cards/{nid}.md",
                        "chain": [n.get("id") for n in hit["chain"]],
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 0
        if not args.path:
            print("where needs --path or --bug", file=sys.stderr)
            return 2
        hit = lookup(doc, args.path)
        if not hit:
            print(json.dumps({"path": norm_repo_path(args.path), "card": None}, ensure_ascii=False, indent=2))
            return 1
        nid = hit["node_id"]
        hit["card"] = f".codex/context/cards/{nid}.md"
        print(json.dumps(hit, ensure_ascii=False, indent=2))
        return 0
    if not args.path:
        print("lookup needs --path", file=sys.stderr)
        return 2
    hit = lookup(load_map(root), args.path)
    if not hit:
        print(json.dumps({"path": norm_repo_path(args.path), "node_id": None}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(hit, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
