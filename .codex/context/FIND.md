# 三跳：先打开小索引，再打开 1–2 个文件

人改图仍写 `map.json`。Agent 不要把整份地图、全部会话、全部坏例一次读进来。

## 文件树

```
.codex/context/
  FIND.md              本页（怎么跳）
  sessions.jsonl       会话目录 · JSONL，每行一个 JSON
  sessions/某次.md     可选 · Markdown，只有这轮原文太长才建
  bugs-index.json      坏例关键词表 · JSON
  bugs/B20.md          坏例索引卡 · Markdown
  fixes/B20.md         经验正文 · Markdown
  map.json             软件图 · JSON，工作台写
  owns-index.json      源码路径 → 卡号 · JSON
  cards/N21.md         一张卡 · Markdown，从地图复印
```

图改过之后：`python3 scripts/map_owns.py cards` 重写 `cards/`、`owns-index.json`、`bugs-index.json`。本页手改，脚本不覆盖。

## 链路 1：改某个源码

`owns-index.json` → `cards/卡号.md` → 需要时按卡片里的 `chain` 打开上面几层 `cards/`。

卡上的 Bug 链接先到 `bugs/B20.md`（是不是这条），再到 `fixes/B20.md`（怎么修过）。卡上的记忆就是还生效的短规矩。

## 链路 2：人报了个 bug / 报错

`bugs-index.json` 按 `keys` 找编号 → `bugs/B20.md` 看现象是不是这条 → `fixes/B20.md` 看怎么修 → 正文「代码」下列的路径再走链路 1。

## 链路 3：问上次说过什么

只看 `sessions.jsonl` 末尾几行，或按词搜这一文件。一行里的 `bugs` / `files` 再跳到上面两条。太长才打开 `sessions/某次.md`。

## 各文件里靠哪跳

| 打开 | 类型 | 里面哪个字段往哪跳 |
| --- | --- | --- |
| `sessions.jsonl` 一行 | JSONL | `files` → 源码路径 → `owns-index.json`；`bugs` → `bugs/编号.md` 和 `fixes/编号.md` |
| `bugs-index.json` | JSON | `B20.keys` 用来搜；`bug` → 索引卡；`fix` → 经验正文 |
| `bugs/B20.md` | Markdown | `fix` → `fixes/B20.md`；`card` → `cards/卡号.md` |
| `fixes/B20.md` | Markdown | `bug` → 索引卡；「代码」下列的路径 → 仓库源码（不抄第二份）；`card` → 那张卡 |
| `owns-index.json` | JSON | `path` → `node` → `cards/node.md` |
| `cards/N21.md` | Markdown | `parent` / `chain` → 别的卡；`owns` → 源码；`related` → 邻居卡；Bug 列表 → `bugs/` 再 → `fixes/` |

禁止：把整份 `map.json`、全部 `sessions/`、全部 `bugs/`、全部 `fixes/` 一次读进下一轮。
