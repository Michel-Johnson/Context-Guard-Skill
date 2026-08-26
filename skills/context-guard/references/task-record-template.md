# 任务说明书

`.codex/context/tasks/{id}.md`。编号 `J1`、`J2`。不是测试中台的功能链。

```md
# {id} {标题}

- keys: 用来搜的词, 逗号分隔
- chain: T0 > M3 > N36
- card: .codex/context/cards/{homeNodeId}.md
- session: 2026-08-26-a

## 这是哪类活
一句话。

## 命令
- `python3 scripts/map_owns.py cards`

## 代码
- path/to/source
```

`chain` 只写卡号。代码只记路径。完整格式见 `.codex/context/FORMAT.md`。
