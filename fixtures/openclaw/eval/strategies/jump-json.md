# 策略：一次 jump --json

1. 先想好人这句话里的路径 / 坏例词 / 任务词。
2. 只许跑：

```
python3 scripts/map_owns.py jump --root /workspace/fixtures/openclaw --json '{"path":[...],"bug":[...],"task":[...],"last":true}'
```

或同等的单次 `jump --path|--bug|--task|--last`。不要连跑十几次单条 jump。

3. 只打开返回的 `open`；需要时再打开 `then`。
4. 禁止 Grep 整个 context 目录。
5. 禁止把 `jump-index.json` 或 `map.json` 整份读进对话。
6. 禁止读 `fixtures/openclaw/eval/gold.json`。
