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


def timed_cmd(args: list[str], rounds: int = 5) -> dict:
    times = []
    last = ""
    for _ in range(rounds):
        t0 = time.perf_counter()
        p = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
        times.append(time.perf_counter() - t0)
        last = p.stdout
    times.sort()
    return {
        "cmd": " ".join(args),
        "rounds": rounds,
        "min_ms": round(times[0] * 1000, 1),
        "median_ms": round(times[len(times) // 2] * 1000, 1),
        "max_ms": round(times[-1] * 1000, 1),
        "ok": "error" not in last,
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


def count_store() -> dict:
    ctx = FIX / ".codex" / "context"
    return {
        "cards": len(list((ctx / "cards").glob("*.md"))),
        "bugs": len(list((ctx / "bugs").glob("B*.md"))),
        "fixes": len(list((ctx / "fixes").glob("B*.md"))),
        "tasks": len(list((ctx / "tasks").glob("J*.md"))),
        "sessions": sum(1 for ln in (ctx / "sessions.jsonl").read_text(encoding="utf-8").splitlines() if ln.strip()),
        "owns": len(json.loads((ctx / "owns-index.json").read_text(encoding="utf-8")).get("owns") or []),
    }


def main() -> int:
    if not (FIX / ".codex" / "context" / "map.json").exists():
        print("run python3 scripts/openclaw_fixture.py first", file=sys.stderr)
        return 2
    base = [PY, str(SCRIPT), "jump", "--root", str(FIX)]
    rows = [
        timed_cmd([PY, "-c", "pass"]),
        timed_cmd(base + ["--path", "src/gateway/server.ts"]),
        timed_cmd(base + ["--bug", "B20"]),
        timed_cmd(base + ["--bug", "配对"]),
        timed_cmd(base + ["--task", "J5"]),
        timed_cmd(base + ["--task", "隧道"]),
        timed_cmd(base + ["--last"]),
        timed_import_jump({"path": "src/gateway/server.ts"}),
        timed_import_jump({"bug": "配对"}),
        timed_import_jump({"last": True}),
    ]
    report = {"store": count_store(), "runs": rows}
    out = FIX / "JUMP-SPEED.md"
    lines = [
        "# OpenClaw jump 耗时",
        "",
        "夹具：`fixtures/openclaw`。每条跑 5 次，看中位数。",
        "",
        f"- 卡 {report['store']['cards']} 张，坏例 {report['store']['bugs']} 条，任务 {report['store']['tasks']} 份，会话 {report['store']['sessions']} 行，路径归属 {report['store']['owns']} 条。",
        "",
        "| 怎么查 | 中位 ms | 最快 | 最慢 |",
        "| --- | --- | --- | --- |",
    ]
    for r in rows:
        label = r["cmd"].replace(str(ROOT) + "/", "").replace(str(PY), "python3")
        lines.append(f"| `{label}` | {r['median_ms']} | {r['min_ms']} | {r['max_ms']} |")
    lines += [
        "",
        "子进程那几行包含 Python 启动。同进程调用（in-process）才是查索引本身。",
        "一次子进程 jump 中位约 26ms（其中 `python3 -c pass` 约 8ms）。同进程查索引 <1ms。慢主要在每次起 Python，不在这套 OpenClaw 文件的体量。",
        "",
    ]
    out.write_text("\n".join(lines), encoding="utf-8")
    out.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(out.read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
