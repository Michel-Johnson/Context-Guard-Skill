# Memory Filesystem v2

这是 Cloud Main 与 Session 记忆的已评审目标文件结构。当前服务器已经生成该投影，但 Cloud API 与 Hook 尚未把服务器私有 Markdown 作为 Agent 阅读面；只有活动接口明确提供投影后，Agent 才按本目录导航。在此之前，旧记录仍是兼容传输，不得声称已经能够读取私有 `content/` 路径。

## 目录

```text
filesystem-v2/
|-- FORMAT
|-- runtime-state.json                 # 事务兼容状态，不是 Agent 阅读入口
`-- content/
    |-- storage.json
    |-- main/
    |   |-- map.json                   # 代码导航表
    |   |-- nodes/
    |   |   `-- <name>-module|node/
    |   |       |-- index.md
    |   |       |-- bugs/<id>.md
    |   |       |-- todos/<id>.md
    |   |       `-- ideas/<id>.md
    |   |-- manifest.json
    |   `-- migration-report.json
    `-- sessions/<session-hash>/        # 与 Main 同构，彼此隔离
```

节点的 Bug、Todo、Idea 索引直接生成在该节点的 `index.md` 中，不再创建 `bugs-index.json`、`tasks-index.json` 或 Idea JSON 索引。

## 文档

- [Node / Module index](Node_Module_Index.md) · [English](Node_Module_Index.en.md)
- [Bug](Bug.md) · [English](Bug.en.md)
- [Todo](Todo.md) · [English](Todo.en.md)
- [Idea](Idea.md) · [English](Idea.en.md)
- Bug 模式：[Coordinator](Bug_Coordinater.md) · [Developer](Bug_Developer.md) · [Tester](Bug_Tester.md)
- Todo 模式：[Coordinator](Todo_Coordinater.md) · [Developer](Todo_Developer.md) · [Tester](Todo_Tester.md)

## 代码生成职责

目标实现由代码生成目录名、文档 ID、整体状态、`CurrentAttempt`、A1/A2 轮次编号、Related/Sub、节点 `index.md` 中的 Bug/Todo/Idea 条目、测试链接、Session 链接、`map.json`、`manifest.json` 和迁移报告。

当前运行时只会重建 A1 投影，多轮 Attempt 的持久化与生成尚未实现；Todo A1 也尚未生成 `Confirmed/Refuted` 状态。实现完成前，这些格式用于评审和后续开发，不得把当前迁移投影视为完全符合模板，也不得把手工写入投影目录的 A2/A3 内容视为可持久保存的数据。

目标实现完整复制对应 Bug 现象、Todo 需求或 Idea 正文的首段，不由 Agent 重写。当前迁移投影仍把 Todo/Idea 摘要截断为 20 个 Unicode 字符；在生成器改造完成前，Agent 必须打开链接文档确认全文，不能把索引摘录当成完整需求。

## 兼容边界

`legacy-records/` 和 `runtime-state.json` 仅用于迁移、事务兼容与回滚。普通 Agent 上下文、接口分析和项目导航不得读取它们。需要核对历史迁移时必须显式说明兼容目的。
