#!/usr/bin/env python3
"""Resolve a repo-relative path to the map node that owns it.

owns = source ownership (file or directory prefix ending in /).
files on a node remain evidence attachments, not ownership.

Longest match wins. Exact file beats a parent directory.
"""
from __future__ import annotations

import argparse
import json
import hashlib
import uuid
from context_guard import run_node_workbench
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
    "N41": ["scripts/context_guard.py"],
    "N43": ["scripts/context_guard_hook.py"],
    "M4": ["scripts/"],
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

    extra_bugs = []
    nid = node.get("id")
    for n, _ in walk_nodes(root):
        if n.get("id") == nid:
            continue
        for b in n.get("bugs") or []:
            if not isinstance(b, dict) or b.get("status") == "dormant":
                continue
            if nid in also_ids(b):
                extra_bugs.append(
                    {
                        "id": b.get("id"),
                        "title": b.get("title"),
                        "status": b.get("status"),
                        "record": b.get("record"),
                        "home": n.get("id"),
                    }
                )
    extra_mems = []
    for n, _ in walk_nodes(root):
        if n.get("id") == nid:
            continue
        for m in n.get("memories") or []:
            if not isinstance(m, dict):
                continue
            if nid in also_ids(m):
                extra_mems.append(
                    {
                        "id": m.get("id"),
                        "text": m.get("text"),
                        "state": m.get("state"),
                        "record": m.get("record"),
                        "home": n.get("id"),
                    }
                )

    return {
        "path": file,
        "node_id": node.get("id"),
        "title": node.get("title"),
        "kind": node.get("kind"),
        "owns": node.get("owns") or [],
        "conflict": len({n.get("id") for n in ties}) > 1,
        "tie_ids": [n.get("id") for n in ties] if len(ties) > 1 else [],
        "memories": mem_rows(node),
        "also_memories": extra_mems,
        "bugs": bug_rows(node),
        "also_bugs": extra_bugs,
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


def also_ids(obj) -> list[str]:
    raw = (obj or {}).get("also") or []
    if isinstance(raw, str):
        raw = [p.strip() for p in raw.replace("，", ",").split(",") if p.strip()]
    return [str(x) for x in raw if x]


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
    write_cards(root)
    return root / ".codex" / "context" / "owns-index.json"


def stamp_map(root: Path) -> Path:
    snapshot = run_node_workbench(["map", "read", "--root", str(root)])
    doc = snapshot["doc"]
    operations = []
    for node, _ in walk_nodes(doc["root"]):
        owns = CG_OWNS.get(node["id"])
        if owns is not None and owns != node.get("owns"):
            operations.append({"type": "update", "id": node["id"], "fields": {"owns": owns}})
    if operations:
        run_node_workbench(["map", "apply", "--root", str(root)], {
            "baseVersion": snapshot["version"], "operationId": str(uuid.uuid4()), "operations": operations})
    return root / ".codex" / "context" / "map.json"


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
            extra = also_ids(m)
            tag = f" · 也挂 {', '.join(extra)}" if extra else ""
            mems.append(f"- {m.get('text')}{tag}")
    ideas = []
    for m in node.get("ideas") or []:
        if isinstance(m, dict) and m.get("text"):
            ideas.append(f"- {m.get('text')}")
    bugs = []
    for b in node.get("bugs") or []:
        if not isinstance(b, dict) or b.get("status") == "dormant":
            continue
        bid = b.get("id")
        extra = also_ids(b)
        tag = f" · 也挂 {', '.join(extra)}" if extra else ""
        bugs.append(
            f"- [{bid}](../bugs/{bid}.md) → [经验](../fixes/{bid}.md) {b.get('title') or ''}{tag}"
        )
    tree = doc.get("root") or doc
    for n, _ in walk_nodes(tree):
        if n.get("id") == nid or n.get("proposal") == "cancelled":
            continue
        for m in n.get("memories") or []:
            if isinstance(m, dict) and nid in also_ids(m) and m.get("text"):
                mems.append(f"- （主卡 {n.get('id')}）{m.get('text')}")
        for b in n.get("bugs") or []:
            if not isinstance(b, dict) or b.get("status") == "dormant":
                continue
            if nid in also_ids(b):
                bid = b.get("id")
                bugs.append(
                    f"- [{bid}](../bugs/{bid}.md) → [经验](../fixes/{bid}.md) {b.get('title') or ''} · 主卡 {n.get('id')}"
                )
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
        f"- card: .codex/context/cards/{nid}.md",
        "",
        "## 记忆",
        "",
        "\n".join(mems) if mems else "（无）",
        "",
    ]
    if ideas:
        lines.extend(["## Idea", "", "\n".join(ideas), ""])
    lines.extend([
        "## Bug",
        "",
        "\n".join(bugs) if bugs else "（无）",
        "",
        "## 孩子",
        "",
        "\n".join(kids) if kids else "（无）",
        "",
    ])
    return "\n".join(lines)


def write_cards(root: Path) -> Path:
    run_node_workbench(["map", "projections", "--root", str(root), "--wait"])
    return root / ".codex" / "context" / "cards"


def parse_md_fields(text: str) -> dict:
    fields: dict[str, str] = {}
    for i, line in enumerate(text.splitlines()):
        if i == 0 and line.startswith("# "):
            fields["_title"] = line[2:].strip()
            continue
        if line.startswith("- ") and ":" in line:
            key, _, val = line[2:].partition(":")
            fields[key.strip()] = val.strip()
    return fields


def write_bugs_index(root: Path) -> Path:
    write_cards(root)
    return root / ".codex" / "context" / "bugs-index.json"


def write_tasks_index(root: Path) -> Path:
    write_cards(root)
    return root / ".codex" / "context" / "tasks-index.json"


def write_jump_index(root: Path) -> Path:
    write_cards(root)
    return root / ".codex" / "context" / "jump-index.json"


def load_packed(root: Path) -> dict:
    ctx = ctx_dir(root)
    version = hashlib.sha256((ctx / "map.json").read_bytes()).hexdigest()
    status = read_json(ctx / "projection-status.json", {})
    if status.get("status") != "ready" or status.get("sourceVersion") != version:
        write_cards(root)
    packed = read_json(ctx / "jump-index.json", {})
    current = hashlib.sha256((ctx / "map.json").read_bytes()).hexdigest()
    if packed.get("sourceVersion") != current:
        raise ValueError("Map changed while reading indexes; read the current node with context-guard map read")
    return packed


def lookup_owns(rows: list, file: str) -> dict | None:
    file = norm_repo_path(file)
    best = None
    score = 0
    ties: list[dict] = []
    for row in rows or []:
        s = own_score(row.get("path") or "", file)
        if not s:
            continue
        if s > score:
            score = s
            best = row
            ties = [row]
        elif s == score and best and row.get("node") != best.get("node"):
            ties.append(row)
    if not best:
        return None
    if len(ties) > 1:
        ties.sort(key=lambda r: (0 if r.get("kind") == "work" else 1, -len(str(r.get("node") or ""))))
        best = ties[0]
    return best


def find_bug_card(doc: dict, bug_id: str) -> dict | None:
    root = doc.get("root") or doc
    for node, chain in walk_nodes(root):
        for b in node.get("bugs") or []:
            if isinstance(b, dict) and b.get("id") == bug_id:
                return {"bug": b, "node": node, "chain": chain}
    return None


def ctx_dir(root: Path) -> Path:
    return root / ".codex" / "context"


def read_json(path: Path, default):
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def best_index_match(query: str, index: dict) -> str | None:
    q = (query or "").strip().lower()
    if not q:
        return None
    if q in {k.lower(): k for k in index}:
        for k in index:
            if k.lower() == q:
                return k
    best, score = None, 0
    for kid, row in index.items():
        s = 0
        title = str(row.get("title") or "").lower()
        if q == kid.lower():
            return kid
        if q in title:
            s += 3
        for key in row.get("keys") or []:
            kl = str(key).lower()
            if kl == q:
                s += 5
            elif kl in q or q in kl:
                s += 2
        if s > score:
            best, score = kid, s
    return best if score else None


def as_query_list(value) -> list[str]:
    if value is None or value is False:
        return []
    if isinstance(value, (list, tuple)):
        return [str(x).strip() for x in value if str(x).strip()]
    text = str(value).strip()
    return [text] if text else []


def parse_jump_json(raw: str) -> dict:
    text = (raw or "").strip()
    if text.startswith("@"):
        text = Path(text[1:]).expanduser().read_text(encoding="utf-8")
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("jump --json must be a JSON object")
    return data


def jump_many(root: Path, queries: dict | None = None) -> dict:
    queries = queries or {}
    packed = load_packed(root)
    hits = []
    for item in as_query_list(queries.get("path")):
        hits.append(jump(root, path=item, packed=packed))
    for item in as_query_list(queries.get("bug")):
        hits.append(jump(root, bug=item, packed=packed))
    for item in as_query_list(queries.get("task")):
        hits.append(jump(root, task=item, packed=packed))
    if queries.get("last"):
        hits.append(jump(root, last=True, packed=packed))
    if not hits:
        return {
            "error": "jump --json needs path, bug, task, or last",
            "hits": [],
            "open": [],
            "then": [],
        }
    open_files: list[str] = []
    then: list[str] = []
    seen: set[str] = set()

    def absorb(items, dest):
        for item in items or []:
            if item and item not in seen:
                seen.add(item)
                dest.append(item)

    for hit in hits:
        absorb(hit.get("open"), open_files)
        absorb(hit.get("then"), then)
    return {"hits": hits, "open": open_files, "then": then}


def jump(root: Path, *, path="", bug="", task="", last=False, packed=None) -> dict:
    ctx = ctx_dir(root)
    packed = packed if packed is not None else load_packed(root)
    if last:
        lines = []
        sess = ctx / "sessions.jsonl"
        if sess.is_file():
            lines = [ln for ln in sess.read_text(encoding="utf-8").splitlines() if ln.strip()]
        if not lines:
            return {"kind": "session", "open": [], "then": []}
        row = next((value for value in (json.loads(line) for line in reversed(lines)) if value.get("event") != "maintenance"), {})
        open_files: list[str] = []
        then: list[str] = []
        for tid in row.get("tasks") or []:
            open_files.append(f".codex/context/tasks/{tid}.md")
        for bid in row.get("bugs") or []:
            open_files.append(f".codex/context/bugs/{bid}.md")
            then.append(f".codex/context/fixes/{bid}.md")
        then.extend(row.get("files") or [])
        if not open_files:
            open_files = then[:2]
            then = then[2:]
        if not open_files and row.get("session_id"):
            session_file = ctx / "sessions" / f"{row['session_id']}.md"
            if session_file.is_file():
                open_files = [f".codex/context/sessions/{row['session_id']}.md"]
        return {
            "kind": "session",
            "id": row.get("session_id") or row.get("id"),
            "open": open_files[:3],
            "then": then[:6],
        }
    if bug:
        index = packed.get("bugs") or {}
        bid = bug.strip()
        if bid not in index:
            bid = best_index_match(bug, index) or ""
        if not bid or bid not in index:
            return {"kind": "bug", "query": bug, "open": [], "then": []}
        row = index[bid]
        open_files = [p for p in (row.get("bug"), row.get("fix")) if p]
        then = [row["card"]] if row.get("card") else []
        return {"kind": "bug", "id": bid, "open": open_files, "then": then}
    if task:
        index = packed.get("tasks") or {}
        jid = task.strip()
        if jid not in index:
            jid = best_index_match(task, index) or ""
        if not jid or jid not in index:
            return {"kind": "task", "query": task, "open": [], "then": []}
        row = index[jid]
        open_files = [p for p in (row.get("task"),) if p]
        then = [f".codex/context/cards/{nid}.md" for nid in (row.get("chain") or [])]
        if row.get("card") and row["card"] not in then:
            then.append(row["card"])
        return {"kind": "task", "id": jid, "open": open_files, "then": then}
    if path:
        row = lookup_owns(packed.get("owns") or [], path)
        if not row:
            return {"kind": "path", "query": path, "open": [], "then": []}
        nid = row.get("node")
        card = row.get("card") or f".codex/context/cards/{nid}.md"
        ancestors = [a for a in (row.get("chain") or []) if a and a != nid]
        then = [f".codex/context/cards/{a}.md" for a in reversed(ancestors)][:3]
        return {"kind": "path", "id": nid, "open": [card], "then": then}
    return {"error": "jump needs --path, --bug, --task, --last, or --json", "open": [], "then": []}


def main() -> int:
    parser = argparse.ArgumentParser(description="Map path ownership for Context Guard")
    parser.add_argument(
        "command",
        choices=["lookup", "stamp", "index", "cards", "where", "bugs-index", "tasks-index", "jump-index", "jump"],
    )
    parser.add_argument("--path", default="", help="Repo-relative file to look up")
    parser.add_argument("--bug", default="", help="Bug id such as B20, or a keyword")
    parser.add_argument("--task", default="", help="Task id such as J1, or a keyword")
    parser.add_argument("--last", action="store_true", help="Jump from the latest sessions.jsonl line")
    parser.add_argument(
        "--json",
        default="",
        dest="jump_json",
        help='Batch queries JSON or @file: {"path":[...],"bug":[...],"task":[...],"last":true}',
    )
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
    if args.command == "bugs-index":
        print(write_bugs_index(root))
        return 0
    if args.command == "tasks-index":
        print(write_tasks_index(root))
        return 0
    if args.command == "jump-index":
        print(write_jump_index(root))
        return 0
    if args.command == "jump":
        if args.jump_json:
            try:
                result = jump_many(root, parse_jump_json(args.jump_json))
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                result = {"error": str(exc), "hits": [], "open": [], "then": []}
        else:
            result = jump(
                root, path=args.path, bug=args.bug, task=args.task, last=args.last
            )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1 if result.get("error") or not (result.get("open") or result.get("then")) else 0
    if args.command == "where":
        doc = load_map(root)
        if args.bug:
            hit = find_bug_card(doc, args.bug)
            if not hit:
                print(json.dumps({"bug": args.bug, "card": None}, ensure_ascii=False, indent=2))
                return 1
            nid = hit["node"].get("id")
            also = also_ids(hit["bug"])
            print(
                json.dumps(
                    {
                        "bug": args.bug,
                        "bug_file": f".codex/context/bugs/{args.bug}.md",
                        "fix_file": f".codex/context/fixes/{args.bug}.md",
                        "node_id": nid,
                        "card": f".codex/context/cards/{nid}.md",
                        "also": also,
                        "also_cards": [f".codex/context/cards/{x}.md" for x in also],
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
