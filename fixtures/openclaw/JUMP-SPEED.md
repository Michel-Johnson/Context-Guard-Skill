# OpenClaw jump 耗时

夹具：`fixtures/openclaw`。每条跑 5 次，看中位数。

- 卡 53 张，坏例 25 条，任务 12 份，会话 30 行，路径归属 55 条。
- `jump-index.json` 22231 字节。批量样例 13 条查询（6 条路径 + 3 条坏例 + 3 条任务 + last）。

| 怎么查 | 中位 ms | 最快 | 最慢 |
| --- | --- | --- | --- |
| `python3 -c pass` | 8.1 | 7.9 | 8.3 |
| `1 subprocess jump --path` | 27.2 | 26.7 | 27.9 |
| `1 subprocess jump --bug B20` | 27.0 | 26.5 | 27.2 |
| `1 subprocess jump --bug 配对` | 26.8 | 26.7 | 27.0 |
| `1 subprocess jump --task J5` | 27.0 | 26.9 | 27.4 |
| `1 subprocess jump --task 隧道` | 27.0 | 26.9 | 27.5 |
| `1 subprocess jump --last` | 26.9 | 26.7 | 27.3 |
| `13 sequential subprocess jumps` | 350.7 | 347.5 | 352.1 |
| `1 subprocess jump --json (13 queries)` | 27.7 | 27.5 | 27.8 |
| `in-process jump {'path': 'src/gateway/server.ts'}` | 0.2 | 0.1 | 0.3 |
| `in-process jump {'bug': '配对'}` | 0.1 | 0.1 | 0.1 |
| `in-process jump {'last': True}` | 0.2 | 0.1 | 0.2 |
| `in-process jump_many (13 queries)` | 0.4 | 0.4 | 0.4 |
| `read jump-index.json once, match in-process` | 0.3 | 0.3 | 0.3 |

一次子进程 jump 中位约 26ms，里面大半是起 Python（`python3 -c pass` 约 8ms）。同进程查索引 <1ms。
Agent 若连跑 13 次 jump，时间接近相加。同一批查询用 `--json` 只起一次进程；直接读 `jump-index.json` 再匹配，连这一次都省掉。
