#!/usr/bin/env python3
"""Summarize OpenClaw hard-task agent answers into eval/REPORT.md."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from score_openclaw_agent import score_answer, store_sizes  # noqa: E402

EVAL = ROOT / "fixtures" / "openclaw" / "eval"
CTX = ROOT / "fixtures" / "openclaw" / ".codex" / "context"


def bytes_of(files: list[str]) -> int:
    total = 0
    for rel in files:
        path = ROOT / "fixtures" / "openclaw" / rel
        if not path.is_file():
            path = CTX.parent / rel
        if not path.is_file() and rel.startswith(".codex/"):
            path = CTX.parent / rel
        if path.is_file():
            total += path.stat().st_size
    return total


def main() -> int:
    answers_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else EVAL / "answers"
    rows = []
    for path in sorted(answers_dir.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        scored = score_answer(data)
        scored["strategy"] = data.get("strategy") or path.stem
        scored["elapsed_ms"] = data.get("elapsed_ms")
        scored["token_estimate"] = max(1, bytes_of(scored["files_opened"]) // 4)
        scored["read_bytes"] = bytes_of(scored["files_opened"])
        rows.append(scored)
    store = store_sizes()
    report = {"store": store, "rows": rows}
    (EVAL / "answers-scored.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# OpenClaw 难任务：四种找法",
        "",
        "题目：外面打开控制台，页面出了、消息发不出。要根因、配置键、命令、卡上短规矩。",
        f"仓库体量：context {store['context_files']} 个文件、{store['context_bytes']} 字节；三份必读正文约 {store['gold_payload_bytes']} 字节。",
        "",
        "| 找法 | 四问命中 | 必读文件 | 自称打开 | 读入字节 | 估 token（字节/4） |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        lines.append(
            f"| {row['strategy']} | {row['field_hits']}/{row['field_total']} | {row['must_file_hits']}/{row['must_file_total']} | {row['opened_count']} | {row['read_bytes']} | {row['token_estimate']} |"
        )
    lines += ["", "## 各问", ""]
    for row in rows:
        lines.append(f"### {row['strategy']}")
        for name, spec in row["fields"].items():
            mark = "对" if spec["ok"] else "错"
            lines.append(f"- {name} **{mark}**：{spec['got'] or '（空）'}")
        lines.append(f"- 打开：{', '.join(row['files_opened']) or '（无）'}")
        lines.append("")
    (EVAL / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")
    print((EVAL / "REPORT.md").read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
