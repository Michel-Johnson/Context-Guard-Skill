# 第一版文件格式（已定）

编码一律 UTF-8。路径一律仓库相对路径，不要前导 `./`。Markdown 里可以写超链接给人点，但字段值仍写纯路径，方便脚本和 Agent 打开。Agent 先读小索引再打开命中文件，不要靠点链接，也不要把 `jump-index.json` 或 `map.json` 整份读进对话。

手改：`sessions.jsonl`、`sessions/*.md`、`bugs/*.md`、`fixes/*.md`、`tasks/*.md`、`map.json`（工作台写）。  
机器生成、不要手改：`cards/`、`owns-index.json`、`bugs-index.json`、`tasks-index.json`、`jump-index.json`。生成命令：`python3 scripts/map_owns.py cards`。

编号：会话 `2026-08-26-a`（日期 + 当天字母）；坏例 `B20`；任务 `J1`；卡号跟地图（`M2`、`N21`）。

坏例状态只用：`open` / `fixed` / `deferred` / `wontfix`。

## 会话 `sessions.jsonl`

JSONL：一行一个 JSON，只追加，不改旧行。每行必有这些键，没有就写空数组：

```json
{"id":"2026-08-26-a","human":"人这轮说了什么（摘要）","agent":"Agent 这轮干了什么（一份摘要）","files":["path/to/file"],"bugs":["B20"],"tasks":["J1"]}
```

原文太长才另建 `sessions/{id}.md`：

```md
# {id}

- session: {id}

## 人说了什么
## 附件
- path/to/file
```

## 坏例索引卡 `bugs/{id}.md`

```md
# {id} {标题}

- node: M2
- status: open
- 现象: 一句话
- keys: 词1, 词2
- fix: .codex/context/fixes/{id}.md
- card: .codex/context/cards/M2.md
```

`keys` 逗号分隔。`fix` / `card` 写完整相对路径，不要反引号。

## 经验正文 `fixes/{id}.md`

```md
# {id} 怎么修

- bug: .codex/context/bugs/{id}.md
- node: M2
- card: .codex/context/cards/M2.md
- status: open

## 根因
## 怎么修
## 怎么防
## 代码
- path/to/source
## 证据
- docs/shots/foo.png
```

未修时「怎么修」写 `未修`。「代码」只列路径，必要时下面跟几行片段。

## 任务说明书 `tasks/{id}.md`

```md
# {id} {标题}

- keys: 词1, 词2
- chain: T0 > M3 > N36
- card: .codex/context/cards/N36.md
- session: 2026-08-26-a

## 这是哪类活
## 命令
- `python3 scripts/map_owns.py cards`
## 代码
- scripts/map_owns.py
```

`chain` 只写卡号，用 ` > ` 连接。`session` 没有可省略。

## 三份 JSON 索引（生成）

`bugs-index.json` 每个编号：`title`、`keys`（数组）、`status`、`bug`、`fix`、`card`。  
`tasks-index.json` 每个编号：`title`、`keys`、`task`、`chain`（卡号数组）、`card`。  
`owns-index.json`：`owns` 数组，每项 `path`、`node`、`kind`、`title`。

`jump-index.json` 把上面三份合成一份，给 `jump --json` 一次读完：`owns`（`path`、`node`、`kind`、`card`、`chain` 祖先卡号）、`bugs`、`tasks`。不要手改，也不要整份贴进对话。

## 地图复印件 `cards/{id}.md`（生成）

头字段：`kind`、`parent`、`chain`、`owns`、`related`、`card`。下面：记忆、Idea（有才写）、Bug、孩子。不要手改。

`map.json` 仍是工作台那份活图，第一版不另定 Agent 手写格式。短规矩写在节点的记忆里，随复印件进卡。Idea 也是节点上的短句，未定的想法，不进记忆、也不另开仓库。
