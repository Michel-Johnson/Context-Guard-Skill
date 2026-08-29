# 策略：只靠索引

1. 先读（只这些）：`bugs-index.json`、`tasks-index.json`、`sessions.jsonl`，需要时再读 `owns-index.json`。
2. 按人的词对 `keys` / 标题，只打开命中的 `bugs/`、`fixes/`、`tasks/`、`cards/`。
3. 禁止 Grep 整个 context 目录。
4. 禁止读 `map.json`、`jump-index.json`。
5. 禁止跑 `python3 scripts/map_owns.py`。
6. 禁止读 `fixtures/openclaw/eval/gold.json`。
