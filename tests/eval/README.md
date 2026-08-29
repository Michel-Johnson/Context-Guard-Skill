# eval/

检索对照用的假仓，不是产品，也不进 npm 包。

- `openclaw/` — 测 jump / 小索引跳法
- `harbor/` + `harbor-eval/` — 测记录怎么存、Agent 怎么找

```bash
python3 tests/eval/openclaw_fixture.py
python3 tests/eval/bench_jump.py
python3 tests/eval/harbor_recall.py project
python3 tests/eval/harbor_recall.py eval
```

合并到命令分支时，这一夹可以整夹丢掉。
