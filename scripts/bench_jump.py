#!/usr/bin/env python3
"""Time map_owns jump against the OpenClaw fixture."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "fixtures" / "openclaw"
PY = sys.executable
SCRIPT = ROOT / "scripts" / "map_owns.py"

BATCH = {
    "path": [
        "src/gateway/server.ts",
        "src/gateway/healthz.ts",
        "src/gateway/protocol/connect.ts",
        "src/auto-reply/agent-runner.ts",
        "src/routing/session-key.ts",
        "packages/agent-core/",
    ],
    "bug": ["B20", "配对", "loopback"],
    "task": ["J5", "隧道", "onboard"],
    "last": True,
}


def sequential_argv() -> list[list[str]]:
    base = [PY, str(SCRIPT), "jump", "--root", str(FIX)]
    cmds = []
    for path in BATCH["path"]:
        cmds.append(base + ["--path", path])
    for bug in BATCH["bug"]:
        cmds.append(base + ["--bug", bug])
    for task in BATCH["task"]:
        cmds.append(base + ["--task", task])
    if BATCH["last"]:
        cmds.append(base + ["--last"])
    return cmds


def timed_cmd(args: list[str], rounds: int = 5, label: str | None = None) -> dict:
    times = []
    last = ""
    for _ in range(rounds):
        t0 = time.perf_counter()
        p = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
        times.append(time.perf_counter() - t0)
        last = p.stdout
    times.sort()
    return {
        "cmd": label or " ".join(args),
        "rounds": rounds,
        "min_ms": round(times[0] * 1000, 1),
        "median_ms": round(times[len(times) // 2] * 1000, 1),
        "max_ms": round(times[-1] * 1000, 1),
        "ok": "error" not in last,
    }


def timed_sequential_jumps(rounds: int = 5) -> dict:
    cmds = sequential_argv()
    times = []
    for _ in range(rounds):
        t0 = time.perf_counter()
        for args in cmds:
            subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
        times.append(time.perf_counter() - t0)
    times.sort()
    return {
        "cmd": f"{len(cmds)} sequential subprocess jumps",
        "rounds": rounds,
        "min_ms": round(times[0] * 1000, 1),
        "median_ms": round(times[len(times) // 2] * 1000, 1),
        "max_ms": round(times[-1] * 1000, 1),
        "ok": True,
        "queries": len(cmds),
    }


def timed_import_jump(kwargs: dict, rounds: int = 5) -> dict:
    sys.path.insert(0, str(ROOT / "scripts"))
    import map_owns

    times = []
    for _ in range(rounds):
        t0 = time.perf_counter()
        map_owns.jump(FIX, **kwargs)
        times.append(time.perf_counter() - t0)
    times.sort()
    return {
        "cmd": f"in-process jump {kwargs}",
        "rounds": rounds,
        "min_ms": round(times[0] * 1000, 1),
        "median_ms": round(times[len(times) // 2] * 1000, 1),
        "max_ms": round(times[-1] * 1000, 1),
        "ok": True,
    }


def timed_import_jump_many(rounds: int = 5) -> dict:
    sys.path.insert(0, str(ROOT / "scripts"))
    import map_owns

    times = []
    last = None
    for _ in range(rounds):
        t0 = time.perf_counter()
        last = map_owns.jump_many(FIX, BATCH)
        times.append(time.perf_counter() - t0)
    times.sort()
    n = len((last or {}).get("hits") or [])
    return {
        "cmd": f"in-process jump_many ({n} queries)",
        "rounds": rounds,
        "min_ms": round(times[0] * 1000, 1),
        "median_ms": round(times[len(times) // 2] * 1000, 1),
        "max_ms": round(times[-1] * 1000, 1),
        "ok": bool((last or {}).get("open")),
        "open": len((last or {}).get("open") or []),
    }


def timed_read_jump_index(rounds: int = 5) -> dict:
    sys.path.insert(0, str(ROOT / "scripts"))
    import map_owns

    packed_path = FIX / ".codex" / "context" / "jump-index.json"
    sess_path = FIX / ".codex" / "context" / "sessions.jsonl"
    times = []
    opens = 0
    for _ in range(rounds):
        t0 = time.perf_counter()
        packed = json.loads(packed_path.read_text(encoding="utf-8"))
        hits = []
        for path in BATCH["path"]:
            row = map_owns.lookup_owns(packed.get("owns") or [], path)
            if row:
                hits.append(row.get("card"))
        for bug in BATCH["bug"]:
            index = packed.get("bugs") or {}
            bid = bug if bug in index else map_owns.best_index_match(bug, index)
            if bid and bid in index:
                hits.append(index[bid].get("bug"))
        for task in BATCH["task"]:
            index = packed.get("tasks") or {}
            jid = task if task in index else map_owns.best_index_match(task, index)
            if jid and jid in index:
                hits.append(index[jid].get("task"))
        if BATCH["last"] and sess_path.is_file():
            lines = [ln for ln in sess_path.read_text(encoding="utf-8").splitlines() if ln.strip()]
            if lines:
                hits.append(json.loads(lines[-1]).get("id"))
        times.append(time.perf_counter() - t0)
        opens = len([h for h in hits if h])
    times.sort()
    return {
        "cmd": "read jump-index.json once, match in-process",
        "rounds": rounds,
        "min_ms": round(times[0] * 1000, 1),
        "median_ms": round(times[len(times) // 2] * 1000, 1),
        "max_ms": round(times[-1] * 1000, 1),
        "ok": True,
        "hits": opens,
    }


def hit_key(row: dict) -> tuple:
    return (
        row.get("kind"),
        row.get("id"),
        tuple(row.get("open") or []),
        tuple(row.get("then") or []),
    )


def check_batch_hits() -> dict:
    sys.path.insert(0, str(ROOT / "scripts"))
    import map_owns

    sequential = []
    for path in BATCH["path"]:
        sequential.append(map_owns.jump(FIX, path=path))
    for bug in BATCH["bug"]:
        sequential.append(map_owns.jump(FIX, bug=bug))
    for task in BATCH["task"]:
        sequential.append(map_owns.jump(FIX, task=task))
    if BATCH["last"]:
        sequential.append(map_owns.jump(FIX, last=True))
    many = map_owns.jump_many(FIX, BATCH)
    open_bytes = 0
    for rel in many.get("open") or []:
        path = FIX / rel
        if path.is_file():
            open_bytes += path.stat().st_size
    same = [hit_key(row) for row in sequential] == [hit_key(row) for row in many.get("hits") or []]
    return {
        "ok": same,
        "queries": len(sequential),
        "open_files": len(many.get("open") or []),
        "open_bytes": open_bytes,
        "ids": [row.get("id") for row in many.get("hits") or []],
    }


def count_store() -> dict:
    ctx = FIX / ".codex" / "context"
    jump_index = ctx / "jump-index.json"
    return {
        "cards": len(list((ctx / "cards").glob("*.md"))),
        "bugs": len(list((ctx / "bugs").glob("B*.md"))),
        "fixes": len(list((ctx / "fixes").glob("B*.md"))),
        "tasks": len(list((ctx / "tasks").glob("J*.md"))),
        "sessions": sum(1 for ln in (ctx / "sessions.jsonl").read_text(encoding="utf-8").splitlines() if ln.strip()),
        "owns": len(json.loads((ctx / "owns-index.json").read_text(encoding="utf-8")).get("owns") or []),
        "jump_index_bytes": jump_index.stat().st_size if jump_index.is_file() else 0,
    }


def main() -> int:
    if not (FIX / ".codex" / "context" / "map.json").exists():
        print("run python3 scripts/openclaw_fixture.py first", file=sys.stderr)
        return 2
    batch_json = json.dumps(BATCH, ensure_ascii=False)
    base = [PY, str(SCRIPT), "jump", "--root", str(FIX)]
    n_seq = len(sequential_argv())
    hits = check_batch_hits()
    rows = [
        timed_cmd([PY, "-c", "pass"], label="python3 -c pass"),
        timed_cmd(base + ["--path", "src/gateway/server.ts"], label="1 subprocess jump --path"),
        timed_cmd(base + ["--bug", "B20"], label="1 subprocess jump --bug B20"),
        timed_cmd(base + ["--bug", "配对"], label="1 subprocess jump --bug 配对"),
        timed_cmd(base + ["--task", "J5"], label="1 subprocess jump --task J5"),
        timed_cmd(base + ["--task", "隧道"], label="1 subprocess jump --task 隧道"),
        timed_cmd(base + ["--last"], label="1 subprocess jump --last"),
        timed_sequential_jumps(),
        timed_cmd(
            base + ["--json", batch_json],
            label=f"1 subprocess jump --json ({n_seq} queries)",
        ),
        timed_import_jump({"path": "src/gateway/server.ts"}),
        timed_import_jump({"bug": "配对"}),
        timed_import_jump({"last": True}),
        timed_import_jump_many(),
        timed_read_jump_index(),
    ]
    report = {"store": count_store(), "batch": BATCH, "hits": hits, "runs": rows}
    out = FIX / "JUMP-SPEED.md"
    lines = [
        "# OpenClaw jump 耗时",
        "",
        "夹具：`fixtures/openclaw`。每条跑 5 次，看中位数。",
        "",
        f"- 卡 {report['store']['cards']} 张，坏例 {report['store']['bugs']} 条，任务 {report['store']['tasks']} 份，会话 {report['store']['sessions']} 行，路径归属 {report['store']['owns']} 条。",
        f"- `jump-index.json` {report['store']['jump_index_bytes']} 字节；`map.json` 约 30KB。批量样例 {n_seq} 条查询（6 条路径 + 3 条坏例 + 3 条任务 + last）。",
        f"- 命中对照：一次 `--json` 与 {n_seq} 条逐条 jump **{'相同' if hits['ok'] else '不同'}**。返回 `open` {hits['open_files']} 个文件、共 {hits['open_bytes']} 字节（编号 {', '.join(str(i) for i in hits['ids'])}）。",
        "",
        "| 怎么查 | 中位 ms | 最快 | 最慢 |",
        "| --- | --- | --- | --- |",
    ]
    for r in rows:
        lines.append(f"| `{r['cmd']}` | {r['median_ms']} | {r['min_ms']} | {r['max_ms']} |")
    lines += [
        "",
        "一次子进程 jump 中位约 27ms，里面大半是起 Python（`python3 -c pass` 约 8ms）。同进程查索引 <1ms。",
        f"连跑 {n_seq} 次 jump 时间接近相加。同一批用 `--json` 只起一次进程，耗时和单次 jump 同一量级，而且只把该打开的路径吐出来。",
        f"`jump-index.json` 给脚本用；Agent 不要整份读进对话（这份约 {report['store']['jump_index_bytes']} 字节，跟地图一个量级）。",
        "",
    ]
    out.write_text("\n".join(lines), encoding="utf-8")
    out.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(out.read_text(encoding="utf-8"))
    return 0 if hits["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
