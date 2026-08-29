# OpenClaw 夹具怎么跳

这是假的 OpenClaw 记忆，用来测检索速度。不要把整份 map 读进来。

同时查很多东西时，一次 `--json`，不要连跑 N 次 jump，也不要把 `jump-index.json` 整份读进对话。

```
python3 scripts/map_owns.py jump --root tests/eval/openclaw --json '{"path":["src/gateway/server.ts"],"bug":["配对"],"task":["隧道"],"last":true}'
python3 scripts/map_owns.py jump --root tests/eval/openclaw --path src/gateway/server.ts
python3 scripts/map_owns.py jump --root tests/eval/openclaw --bug 配对
python3 scripts/map_owns.py jump --root tests/eval/openclaw --task 隧道
python3 scripts/map_owns.py jump --root tests/eval/openclaw --last
```

耗时见 `JUMP-SPEED.md`。重新生成：`python3 tests/eval/openclaw_fixture.py`
