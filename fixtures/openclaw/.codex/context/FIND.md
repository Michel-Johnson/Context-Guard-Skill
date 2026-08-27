# OpenClaw 夹具怎么跳

这是假的 OpenClaw 记忆，用来测 jump 速度。不要把整份 map 读进来。

```
python3 scripts/map_owns.py jump --root fixtures/openclaw --path src/gateway/server.ts
python3 scripts/map_owns.py jump --root fixtures/openclaw --bug 配对
python3 scripts/map_owns.py jump --root fixtures/openclaw --task 隧道
python3 scripts/map_owns.py jump --root fixtures/openclaw --last
```

耗时见 `JUMP-SPEED.md`。重新生成：`python3 scripts/openclaw_fixture.py`
