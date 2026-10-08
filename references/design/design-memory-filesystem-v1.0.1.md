# 底层文件结构与生成规范

文档版本：v1.0.1。

本文规定底层目录、索引和事项文件的结构，不规定记忆正文怎么写。

文件格式：`fs-v2.1`；底层事务格式：`v2`。

## 记忆与文件结构的区别

| 文件 | 用途 |
| --- | --- |
| `memory.md` | 项目或节点记忆：接手项目所需的当前知识 |
| `index.md` | 索引：节点导航和文档链接 |
| `bugs/<id>.md`、`todos/<id>.md`、`ideas/<id>.md` | 事项记录：缺陷、任务和想法 |
| `map.json`、`manifest.json` 等 | 底层数据：结构、版本和生成信息 |

只有 `memory.md` 是这里所说的记忆正文，写法见 [记忆撰写规范](design-memory-definition-v0.2.0.md)。索引和事项记录即使用 Markdown，也不是记忆正文。

## 目录

```text
filesystem-v2/
|-- FORMAT
|-- runtime-state.json                 # 事务兼容状态，不是 Agent 阅读入口
`-- content/
    |-- storage.json
    |-- main/
    |   |-- map.json                   # 代码导航表
    |   |-- memory.md                  # 项目记忆；有内容时生成
    |   |-- nodes/
    |   |   `-- <name>-module|node/
    |   |       |-- index.md
    |   |       |-- memory.md          # 节点记忆；有内容时生成
    |   |       |-- bugs/<id>.md
    |   |       |-- todos/<id>.md
    |   |       `-- ideas/<id>.md
    |   |-- manifest.json
    |   `-- migration-report.json
    `-- sessions/<session-hash>/        # 与 Main 同构，彼此隔离
```

Main 与各 Session 同构、彼此隔离。上图是服务器逻辑目录，不要求在源码仓库手建文件。

## 索引与事项文件的模板与格式

- [节点 / 模块索引模板与格式](design-memory-node-index-v1.0.1.md)
- [Bug 模板与格式](design-memory-bug-v1.0.1.md)
- [TODO 模板与格式](design-memory-todo-v1.0.1.md)
- [Idea 模板与格式](design-memory-idea-v1.0.0.md)

这些规范提供文件模板、字段说明和填写示例，不是实际事项记录。各角色共用同一格式，分工写在规范内，不另建角色版。

## 保存与生成

- `memory.md` 从节点 `memoryDocument` 生成，有正文才生成文件。人和 Coordinator 修改正文；Executor、Tester 按现有权限读取。项目记忆用于首轮上下文，节点记忆和历史按需读取。
- 索引、目录名、ID、状态、轮次、关系、测试和 Session 链接、Map、清单及迁移报告由代码生成，不手工改生成文件。事项索引直接写入节点 `index.md`，不另建 JSON 索引。
- Bug/Todo 的 `attempts` 存于版本化 Map，按数组顺序生成 A1…An 与 `CurrentAttempt`。轮次状态为 `Confirmed|Refuted`；被推翻时指向更晚轮次并说明原因。Markdown 是生成结果，重建时读取事务快照。
- 旧 Todo 没有方案证据时保留未判定 A1，标记 `TODO_ATTEMPT_UNCLASSIFIED`；审核补齐前不能判为 `Confirmed` 或宣称符合模板。
- 索引保留 Bug 现象、Todo 需求或 Idea 正文的完整首段，不改写、不截断；详情用链接。

## 读取与兼容

项目启用此结构后，通过按版本读取接口或 `context-guard memory file` 读取获授权的文件，不直接访问服务器磁盘。未启用的项目仍走旧兼容传输，不能使用此入口。

`legacy-records/` 和 `runtime-state.json` 仅用于迁移、事务兼容与回滚，不是日常阅读入口；核对迁移须说明目的。

旧 `memories[]` 只读预览保留原文、附件和提案依据。人可整理后明确保存；预览不自动归类、追加、删除历史或生成记忆。保存校验版本，冲突时保留草稿。

## Session 发布条件

可信审核路径确认 `sessionId`、`generation`、`sessionVersion`、`sourceCommit` 后，才能进入既有 Git 与任务发布流程。上传、心跳或初始 HEAD 已在 Main 上不代表完成；后续修改使完成证明失效。

## 待确认

- Agent 打开模块时优先读旧 FIND.md / snapshot，还是本规范的 Markdown 投影。
- 安装包里的仓库 `docs/` 链接不可访问时，如何提供文档。
