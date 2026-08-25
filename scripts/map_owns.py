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
    path = root / ".codex" / "context" / "map.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("root"):
        stamp_owns(doc["root"], CG_OWNS)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="Map path ownership for Context Guard")
    parser.add_argument("command", choices=["lookup", "stamp", "index"])
    parser.add_argument("--path", default="", help="Repo-relative file to look up")
    parser.add_argument("--root", type=Path, default=None)
    args = parser.parse_args()
    root = (args.root or Path.cwd()).resolve()
    if args.command == "stamp":
        dest = stamp_map(root)
        print(dest)
        return 0
    if args.command == "index":
        dest = write_owns_index(root)
        print(dest)
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
