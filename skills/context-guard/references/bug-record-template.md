# Bug 索引卡 + 经验正文

不要用 `register-template.md`（测试中台那套）。工作台只显示标题。

## 索引卡 `.codex/context/bugs/{id}.md`

```md
# {id} {title}

- node: {homeNodeId}
- status: open | fixed | deferred | wontfix
- 现象: 一句话
- keys: 用来搜的词, 逗号分隔
- fix: .codex/context/fixes/{id}.md
- card: .codex/context/cards/{homeNodeId}.md
```

## 经验正文 `.codex/context/fixes/{id}.md`

```md
# {id} 怎么修

- bug: .codex/context/bugs/{id}.md
- node: {homeNodeId}
- card: .codex/context/cards/{homeNodeId}.md
- status: open | fixed | …

## 根因
## 怎么修
## 怎么防
## 代码
- path/to/source.py
## 证据
- docs/shots/…
```

代码只记仓库相对路径，必要时几行片段。不要把源码再抄一份。

地图桩仍写 `record: .codex/context/bugs/{id}.md`。同一轮两份都要写。关键词表用 `python3 scripts/map_owns.py cards` 重生成。
