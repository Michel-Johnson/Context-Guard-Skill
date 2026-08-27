# OpenClaw jump 耗时

夹具：`fixtures/openclaw`。每条跑 5 次，看中位数。

- 卡 53 张，坏例 25 条，任务 12 份，会话 30 行，路径归属 55 条。

| 怎么查 | 中位 ms | 最快 | 最慢 |
| --- | --- | --- | --- |
| `python3 -c pass` | 8.2 | 8.1 | 9.4 |
| `python3 scripts/map_owns.py jump --root fixtures/openclaw --path src/gateway/server.ts` | 28.3 | 26.6 | 29.7 |
| `python3 scripts/map_owns.py jump --root fixtures/openclaw --bug B20` | 25.9 | 25.7 | 26.0 |
| `python3 scripts/map_owns.py jump --root fixtures/openclaw --bug 配对` | 26.0 | 25.5 | 27.5 |
| `python3 scripts/map_owns.py jump --root fixtures/openclaw --task J5` | 26.1 | 25.6 | 27.7 |
| `python3 scripts/map_owns.py jump --root fixtures/openclaw --task 隧道` | 25.8 | 25.6 | 27.1 |
| `python3 scripts/map_owns.py jump --root fixtures/openclaw --last` | 25.5 | 25.4 | 25.6 |
| `in-process jump {'path': 'src/gateway/server.ts'}` | 0.3 | 0.3 | 0.5 |
| `in-process jump {'bug': '配对'}` | 0.1 | 0.1 | 0.1 |
| `in-process jump {'last': True}` | 0.0 | 0.0 | 0.0 |

子进程那几行包含 Python 启动。同进程调用（in-process）才是查索引本身。
一次子进程 jump 中位约 26ms（其中 `python3 -c pass` 约 8ms）。同进程查索引 <1ms。慢主要在每次起 Python，不在这套 OpenClaw 文件的体量。
