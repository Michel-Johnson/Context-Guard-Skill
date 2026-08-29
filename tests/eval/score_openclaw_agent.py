#!/usr/bin/env python3
"""Score OpenClaw hard-task agent answers against gold.json."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OPENCLAW = Path(__file__).resolve().parents[1] / "openclaw"
GOLD_PATH = OPENCLAW / "eval" / "gold.json"
CTX = OPENCLAW / ".codex" / "context"


def resolve_openclaw_path(rel: str) -> Path | None:
    text = str(rel or "").replace("\\", "/").strip()
    for prefix in ("tests/eval/openclaw/", "fixtures/openclaw/"):
        if prefix in text:
            text = text.split(prefix, 1)[1]
            break
    if text.startswith("./"):
        text = text[2:]
    if text.startswith("/"):
        path = Path(text)
        return path if path.is_file() else None
    candidates = [OPENCLAW / text, CTX / text]
    if not text.startswith(".codex/"):
        candidates.append(CTX / text.lstrip("/"))
    for path in candidates:
        if path.is_file():
            return path
    return None


def load_gold() -> dict:
    return json.loads(GOLD_PATH.read_text(encoding="utf-8"))


def needles_hit(text: str, needles: list[str]) -> bool:
    blob = text or ""
    return all(n in blob for n in needles)


def score_answer(answer: dict, files: list[str] | None = None) -> dict:
    gold = load_gold()
    fields = {}
    hits = 0
    for name, spec in gold["fields"].items():
        blob = " ".join(
            str(answer.get(k) or "")
            for k in (name, "root_cause", "config", "command", "card_rule")
            if k == name or name in ("root_cause", "config", "command", "card_rule")
        )
        # Prefer the dedicated key.
        blob = str(answer.get(name) or "")
        if name == "root_cause":
            blob = str(answer.get("root_cause") or "")
        elif name == "config":
            blob = str(answer.get("config") or answer.get("config_key") or "")
        elif name == "command":
            blob = str(answer.get("command") or "")
        elif name == "card_rule":
            blob = str(answer.get("card_rule") or answer.get("rule") or "")
        ok = needles_hit(blob, spec["needles"])
        fields[name] = {"ok": ok, "got": blob, "needles": spec["needles"]}
        hits += int(ok)
    opened = files if files is not None else list(answer.get("files_opened") or [])
    opened_norm = []
    for item in opened:
        text = str(item).replace("\\", "/")
        for prefix in ("tests/eval/openclaw/", "fixtures/openclaw/"):
            if prefix in text:
                text = text.split(prefix, 1)[1]
                break
        if text.startswith("./"):
            text = text[2:]
        opened_norm.append(text)
    must = gold["must_files"]
    file_hits = [p for p in must if any(p in o or o.endswith(p.split("/")[-1]) for o in opened_norm)]
    return {
        "field_hits": hits,
        "field_total": len(gold["fields"]),
        "fields": fields,
        "must_file_hits": len(file_hits),
        "must_file_total": len(must),
        "files_opened": opened_norm,
        "opened_count": len(opened_norm),
    }


def parse_answer_blob(text: str) -> dict:
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {"_raw": text}
    return data if isinstance(data, dict) else {"_raw": text}


def store_sizes() -> dict:
    files = list(CTX.rglob("*"))
    bytes_all = sum(p.stat().st_size for p in files if p.is_file())
    gold_bytes = 0
    for rel in load_gold()["must_files"]:
        path = resolve_openclaw_path(rel)
        if path:
            gold_bytes += path.stat().st_size
    return {
        "context_files": sum(1 for p in files if p.is_file()),
        "context_bytes": bytes_all,
        "gold_payload_bytes": gold_bytes,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: score_openclaw_agent.py <answer.json> [files...]", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    answer = json.loads(path.read_text(encoding="utf-8")) if path.suffix == ".json" else parse_answer_blob(path.read_text(encoding="utf-8"))
    files = sys.argv[2:] or answer.get("files_opened")
    result = score_answer(answer, files)
    result["store"] = store_sizes()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["field_hits"] == result["field_total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
