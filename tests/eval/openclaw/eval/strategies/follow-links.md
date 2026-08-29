# 策略：跟记录里的跳转走

1. 从 `FIND.md` 或一张 `cards/` / 一份 `bugs/` 开始。
2. 只跟 Markdown 链接（`[文字](相对路径)`）和字段里的纯路径跳到下一份。
3. 禁止 Grep 整个 context 目录。
4. 禁止打开 `*-index.json`、`jump-index.json`、`map.json`。
5. 禁止跑 `python3 scripts/map_owns.py`。
6. 禁止读 `tests/eval/openclaw/eval/gold.json`。

如果从索引以外找不到入口，可以读 `sessions.jsonl` 末尾几行当入口，然后继续跟链接。
