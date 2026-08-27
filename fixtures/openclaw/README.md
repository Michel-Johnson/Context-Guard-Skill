# OpenClaw 底层夹具（测 jump 速度）

假的 OpenClaw 项目记忆，格式跟第一版一样：会话、坏例、任务、地图。
用来测检索：连跑多次 jump、一次 `--json`。`jump-index.json` 给脚本用，不要整份读进对话。

重新生成：`python3 scripts/openclaw_fixture.py`
计时：`python3 scripts/bench_jump.py`
难任务 Agent 对照：`fixtures/openclaw/eval/REPORT.md`
