# Harbor recall fixture

一座比本仓更密的假项目，用来比较 Context Guard 记录怎么存、Agent 怎么找。不要把这里当成产品演示仓。

```bash
python3 scripts/harbor_recall.py project
python3 scripts/harbor_recall.py eval
```

- 假仓源码：`fixtures/harbor/`（活 context 用 B：map 桩 + `bugs/*.md`）
- 对照布局：运行 `project` 后写到 `fixtures/harbor-eval/layouts/`（已 gitignore）
- 题目：`queries.json`
- 存法对照：`REPORT.md`
- 修 bug 顺着哪条线走：`python3 scripts/harbor_recall.py eval-graph` → `GRAPH.md`

结论写在仓库 `.codex/context/records.md` 的「Harbor 实验」一节。
