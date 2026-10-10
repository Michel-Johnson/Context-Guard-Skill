# 底层文件结构与生成规范

文档 v1.0.1；文件 fs-v2.1，事务 v2。记忆正文仅 memory.md，写法见 [记忆规范](design-memory-definition-v0.2.0.md)；index.md 是导航，bugs/todos/ideas 是事项，Map/manifest 是生成数据。

## 记忆与文件结构的区别

正文、索引、事项不能混用；事项模板见下文，不把 Markdown 扩展名当记忆正文。

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

服务器逻辑目录，不在源码仓库手建；Main/Session 同构且隔离。

## 索引与事项文件的模板与格式

统一用 [索引](../formats/file-templates.md#节点索引)、[Bug](../formats/file-templates.md#bug)、[TODO](../formats/file-templates.md#todo)、[Idea](../formats/file-templates.md#idea) 模板，角色共用，不另建版本。

## 保存与生成

- memoryDocument 有正文才生成 memory.md。人/Coordinator 修改，E/T 按权限读取；项目首轮、节点/历史按需。
- 目录名、索引、ID、状态、轮次、关系、测试/Session 链接、Map/清单/迁移报告由代码生成，不手改；事项索引直接入 index.md，不另建 JSON 索引。
- Map attempts 数组依序生成 A1…An/CurrentAttempt，状态仅 Confirmed/Refuted；推翻指向更晚轮次并说明。重建读事务快照。
- 旧 Todo 无方案证据保未判定 A1、TODO_ATTEMPT_UNCLASSIFIED，审核前非 Confirmed/模板合规。
- 索引取 Bug 现象/Todo 需求/Idea 原文完整首段，不改写截断，详情链接。

## 读取与兼容

启用项目用带版本接口或 context-guard memory file，非直接磁盘；未启用仍旧传输，不启用/迁移。默认 map read --context 定位，事项沿 index.md；FIND/snapshot 仅迁移恢复。

legacy-records/、runtime-state.json 仅迁移/事务兼容/回滚，非日常入口。旧 memories[] 预览保原文、附件、提案依据，人明确整理保存才更新，不自动归类/追加/删历史或生成记忆；版本冲突保草稿。

[本地会话笔记](../formats/session-record.md) 不属此目录、不上传 Cloud。

## Session 发布条件

统一按 [Cloud 发布规则](design-memory-server-v1.1.0.md#main-发布与-session-代次)，文件生成/上传不是发布。

## 待确认

分发包无法访问仓库 development-docs 链接时的文档提供方式仍待确认。
