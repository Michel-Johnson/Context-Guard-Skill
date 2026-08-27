# 四跳：先打开小索引，再打开 1–2 个文件

**第一版就这四块：会话、坏例、任务、地图。** 以后要做的三件事在 `TODO.md`：首次建图（最难也最要紧）、优化检索、CI/CD 测试。现在都不做。

人改图仍写 `map.json`。Agent 不要把整份地图、全部会话、全部坏例、全部任务说明书一次读进来。

地图上那条路只是「这次活走过哪些卡」；下次怎么走、用哪些命令，写在 `tasks/`。

## 文件树

```
.codex/context/
  FIND.md              本页（怎么跳）
  FORMAT.md            第一版每个文件怎么写
  TODO.md              第一版之后要做的（首次建图、检索、CI/CD）
  sessions.jsonl       会话目录 · JSONL，每行一个 JSON
  sessions/某次.md     可选 · Markdown，只有这轮原文太长才建
  bugs-index.json      坏例关键词表 · JSON
  bugs/B20.md          坏例索引卡 · Markdown
  fixes/B20.md         经验正文 · Markdown
  tasks-index.json     任务关键词表 · JSON
  tasks/J1.md          一类活怎么走 · Markdown
  map.json             软件图 · JSON，工作台写
  owns-index.json      源码路径 → 卡号 · JSON
  jump-index.json      三份索引合成一份 · JSON，给脚本一次读完，不要整份贴进对话
  cards/N21.md         一张卡 · Markdown，从地图复印
```

图改过之后：`python3 scripts/map_owns.py cards` 重写 `cards/`、`owns-index.json`、`bugs-index.json`、`tasks-index.json`、`jump-index.json`。本页手改，脚本不覆盖。

**Agent 怎么跳：** 不要指望点 Markdown 超链接。文件里的链接给人看。

同时要查很多路径 / 坏例 / 任务时，**不要连跑 N 次 jump**。慢的是每次起 Python。用一次命令查完：

```
python3 scripts/map_owns.py jump --json '{"path":["src/a.ts","src/b.ts"],"bug":["B20","对话框"],"task":["J1"],"last":true}'
```

只打开返回的 `open`；需要再打开 `then`。不要把 `jump-index.json` 整份读进对话——那是给脚本用的合成表，体量和地图差不多。

单查一条仍可用：

```
python3 scripts/map_owns.py jump --path <文件>
python3 scripts/map_owns.py jump --bug B20
python3 scripts/map_owns.py jump --bug 对话框
python3 scripts/map_owns.py jump --task J1
python3 scripts/map_owns.py jump --task 找卡
python3 scripts/map_owns.py jump --last
```

`jump-index.json` 怎么对：脚本按 `owns` 里 `path` 最长前缀命中（精确文件优先于目录）；`bugs` / `tasks` 按编号，或用 `keys` / 标题对上人的词。Agent 不要自己扫这份文件。

## 链路 1：改某个源码

`owns-index.json` → `cards/卡号.md` → 需要时按卡片里的 `chain` 打开上面几层 `cards/`。多查时让 `jump --json` 去对 `jump-index.json`。

卡上的 Bug 链接先到 `bugs/B20.md`（是不是这条），再到 `fixes/B20.md`（怎么修过）。卡上的记忆就是还生效的短规矩。

## 链路 2：人报了个 bug / 报错

`bugs-index.json` 按 `keys` 找编号 → `bugs/B20.md` 看现象是不是这条 → `fixes/B20.md` 看怎么修 → 正文「代码」下列的路径再走链路 1。多查同样走 `jump --json`。

## 链路 3：问上次说过什么

只看 `sessions.jsonl` 末尾几行，或按词搜这一文件。一行里的 `bugs` / `files` / `tasks` 再跳到对应文件。太长才打开 `sessions/某次.md`。

## 链路 4：做和上次同类的活

人说「再做一次某某 / 按这个任务来」→ `tasks-index.json` 按 `keys` 找编号 → 只打开那一份 `tasks/J1.md` → 按里面的 `chain` 打开那几张 `cards/` → 复用「命令」和「代码」路径。不要重画一遍，也不要把命令堆在会话日记里。多查走 `jump --json`。

## 各文件里靠哪跳

| 打开 | 类型 | 里面哪个字段往哪跳 |
| --- | --- | --- |
| `sessions.jsonl` 一行 | JSONL | `files` → `owns`；`bugs` → 坏例索引/经验；`tasks` → `tasks/编号.md` |
| `jump-index.json` | JSON | 脚本一次读完；Agent 不要整份贴进对话 |
| `bugs-index.json` | JSON | `keys` 用来搜；`bug` → 索引卡；`fix` → 经验正文 |
| `bugs/B20.md` | Markdown | `fix` → `fixes/B20.md`；`card` → `cards/卡号.md` |
| `fixes/B20.md` | Markdown | `bug` → 索引卡；「代码」→ 仓库源码；`card` → 那张卡 |
| `tasks-index.json` | JSON | `keys` 用来搜；`task` → 说明书；`chain` → 那几张 `cards/` |
| `tasks/J1.md` | Markdown | `chain` / `card` → 走过的卡；「命令」当场复用；「代码」→ 仓库路径 |
| `owns-index.json` | JSON | `path` → `node` → `cards/node.md` |
| `cards/N21.md` | Markdown | `parent` / `chain` → 别的卡；`owns` → 源码；Bug 列表 → `bugs/` 再 → `fixes/` |

格式细节：`.codex/context/FORMAT.md`。

禁止：把整份 `map.json`、`jump-index.json`、全部 `sessions/`、全部 `bugs/`、全部 `fixes/`、全部 `tasks/` 一次读进下一轮。连跑很多次 `jump` 也不要。
