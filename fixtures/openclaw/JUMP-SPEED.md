# OpenClaw jump 耗时

夹具：`fixtures/openclaw`。每条跑 5 次，看中位数。

- 卡 53 张，坏例 25 条，任务 12 份，会话 30 行，路径归属 55 条。
- `jump-index.json` 22231 字节；`map.json` 约 30KB。批量样例 13 条查询（6 条路径 + 3 条坏例 + 3 条任务 + last）。
- 命中对照：一次 `--json` 与 13 条逐条 jump **相同**。返回 `open` 15 个文件、共 5106 字节（编号 N11, N11b, N12, N15, N16, M2, B20, B30, B10, J5, J5, J1, 2026-08-02-d）。

| 怎么查 | 中位 ms | 最快 | 最慢 |
| --- | --- | --- | --- |
| `python3 -c pass` | 8.1 | 8.0 | 8.2 |
| `1 subprocess jump --path` | 26.8 | 26.5 | 27.0 |
| `1 subprocess jump --bug B20` | 26.6 | 26.5 | 26.9 |
| `1 subprocess jump --bug 配对` | 26.8 | 26.4 | 26.9 |
| `1 subprocess jump --task J5` | 26.5 | 26.4 | 26.8 |
| `1 subprocess jump --task 隧道` | 26.6 | 26.5 | 26.7 |
| `1 subprocess jump --last` | 26.8 | 26.7 | 26.9 |
| `13 sequential subprocess jumps` | 347.1 | 346.4 | 347.2 |
| `1 subprocess jump --json (13 queries)` | 27.0 | 26.9 | 27.2 |
| `in-process jump {'path': 'src/gateway/server.ts'}` | 0.2 | 0.1 | 0.2 |
| `in-process jump {'bug': '配对'}` | 0.1 | 0.1 | 0.1 |
| `in-process jump {'last': True}` | 0.1 | 0.1 | 0.2 |
| `in-process jump_many (13 queries)` | 0.4 | 0.4 | 0.4 |
| `read jump-index.json once, match in-process` | 0.3 | 0.3 | 0.3 |

一次子进程 jump 中位约 27ms，里面大半是起 Python（`python3 -c pass` 约 8ms）。同进程查索引 <1ms。
连跑 13 次 jump 时间接近相加。同一批用 `--json` 只起一次进程，耗时和单次 jump 同一量级，而且只把该打开的路径吐出来。
`jump-index.json` 给脚本用；Agent 不要整份读进对话（这份约 22231 字节，跟地图一个量级）。
