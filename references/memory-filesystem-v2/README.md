# Memory Filesystem v2

读者：产品角色 Agent（格式与阅读面）；仓库开发 Agent（生成器与迁移缺口）。

**版本：`fs-v2`（当前设计版本）**  
从何而来：已评审的 Cloud Main / Session 记忆文件结构。  
确认：现行存储法只认这一版。下一版必须另开版本号。入口见 [当前设计版本](../design-current.md)。  
`docs/design/file-design.md` 不是本版本，不得当存储法。

这是 Cloud Main 与 Session 记忆的已评审目标文件结构。启用 fs-v2 的服务器提供按版本读取单份 Markdown 的显式 API，Agent 可通过 `context-guard memory file` 读取获授权的文档；这不是本地私有 `content/` 磁盘路径。未启用 fs-v2 的项目不能使用该入口，旧记录仍只作兼容传输。Agent 打开模块时默认读哪套目录（FIND.md / snapshot 与本投影如何切换）尚未拍板，不得在本文里选边。

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

Todo/Bug 的显式 `attempts` 依附工作项保存在版本化 Map 事务快照中；数组顺序生成 A1…An、`CurrentAttempt`、反证关系、测试和 Session 链接。每轮包含 `status`（`Confirmed|Refuted`）；`Refuted` 必须指向更晚轮次并写明原因。可选字段为 `event`/`eventSource`、Bug 的 `reproduction`/`cause`/`resolution`、Todo 的 `acceptance`/`solution`，以及 `codeIndex`、`test`、`sessionIds`。生成的 Markdown 是投影，不是手工持久化入口；重建时从事务快照恢复。

旧 Todo 若没有方案证据，迁移投影仍保留未判定的 A1 并在报告标记 `TODO_ATTEMPT_UNCLASSIFIED`；不能擅自判为 `Confirmed`。该旧项需要后续审核补齐显式 Attempt，完成前不得把它称为完全符合模板。

生成器完整复制对应 Bug 现象、Todo 需求或 Idea 正文的首段，不由 Agent 重写，也不按字符数截断。详细内容仍以链接文档为准。

## 兼容边界

`legacy-records/` 和 `runtime-state.json` 仅用于迁移、事务兼容与回滚。普通 Agent 上下文、接口分析和项目导航不得读取它们。需要核对历史迁移时必须显式说明兼容目的。
