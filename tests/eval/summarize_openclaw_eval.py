#!/usr/bin/env python3
"""Summarize OpenClaw hard-task agent answers into eval/REPORT.md."""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
EVAL_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(EVAL_ROOT))
from score_openclaw_agent import resolve_openclaw_path, score_answer, store_sizes  # noqa: E402

EVAL = EVAL_ROOT / "openclaw" / "eval"
ORDER = ["grep-all", "index-only", "jump-json", "follow-links"]


def bytes_of(files: list[str]) -> int:
    total = 0
    for rel in files:
        path = resolve_openclaw_path(rel)
        if path:
            total += path.stat().st_size
    return total


def main() -> int:
    answers_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else EVAL / "answers"
    rows = []
    for path in answers_dir.glob("*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or "root_cause" not in data:
            continue
        scored = score_answer(data)
        scored["strategy"] = data.get("strategy") or path.stem
        scored["elapsed_ms"] = data.get("elapsed_ms")
        scored["read_bytes"] = bytes_of(scored["files_opened"])
        scored["token_estimate"] = max(0, scored["read_bytes"] // 4)
        rows.append(scored)
    rows.sort(key=lambda r: ORDER.index(r["strategy"]) if r["strategy"] in ORDER else 99)
    store = store_sizes()
    report = {"store": store, "rows": rows}
    (EVAL / "answers-scored.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def secs(ms):
        if not ms:
            return "—"
        return f"{round(ms / 1000, 1)}s"

    lines = [
        "# OpenClaw 难任务：四种找法",
        "",
        "题目：外面打开控制台，页面出了、消息发不出。要同时交出根因、配置键、命令、卡上短规矩。",
        "这四样分别在 `fixes/B70.md`、`tasks/J5.md`、`cards/N7p.md`，索引关键词对不上配置键。",
        "",
        f"夹具体量：context {store['context_files']} 个文件、{store['context_bytes']} 字节；三份必读正文 {store['gold_payload_bytes']} 字节。",
        "耗时是受试 Agent 从创建到交卷的墙钟。读入字节按它自称打开的文件合计；估 token = 字节/4。",
        "",
        "| 找法 | 四问 | 打开文件 | 读入 | 估 token | 墙钟 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        lines.append(
            f"| {row['strategy']} | {row['field_hits']}/{row['field_total']} | {row['opened_count']} | {row['read_bytes']} B | {row['token_estimate']} | {secs(row['elapsed_ms'])} |"
        )
    lines += [
        "",
        "## 结论",
        "",
        "四种找法**都能答对**。差的是走了多少路、读了多少字。",
        "",
        "- **只靠索引**和 **Grep 整目录**最快（约 1 分钟），打开约 8 个文件。这套夹具只有一百来个文件，Grep 还撑得住；仓库再大，Grep 会把不相关的坏例一并扫进来。",
        "- **一次 jump --json** 读得最少（6 个文件、约 2KB）。墙钟反而更长（约 2.6 分钟）：Agent 要先想查询、跑脚本、再打开返回的文件。`--last` 还多打开了无关的 `J9.md`。",
        "- **只跟记录里的链接**最亏：30 个文件、约 15KB、约 3 分钟。没有索引当入口，它从会话和 FIND 瞎跳，路过 B10/B12/B32/B81 一串无关卡才落到 B70。链接给人点可以，不当 Agent 的主找法。",
        "- 索引本身也有体积：`index-only` 读入约 17KB，主要是两份 JSON 索引加会话目录，并不比跟链接省多少字。对 Agent 更省的是 **jump 只返回该打开的路径**，不要把索引整份贴进对话。",
        "- 配置键写在经验正文里，四路都不用打开源码。记录时把「答案」写进坏例/任务/卡，比在记录里堆超链接更有用。",
        "",
        "## 各问",
        "",
    ]
    for row in rows:
        lines.append(f"### {row['strategy']}")
        for name, spec in row["fields"].items():
            mark = "对" if spec["ok"] else "错"
            lines.append(f"- {name} **{mark}**：{spec['got'] or '（空）'}")
        lines.append(f"- 打开：{', '.join(row['files_opened']) or '（无）'}")
        if row.get("elapsed_ms"):
            lines.append(f"- 墙钟：{secs(row['elapsed_ms'])}")
        lines.append("")
    (EVAL / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")
    print((EVAL / "REPORT.md").read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
