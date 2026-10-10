# 索引与事项文件：模板、格式与示例

适用文件格式：`fs-v2.1`。本文集中说明 `index.md`、Bug、TODO、Idea 的模板，不改变字段、状态或生成方式。这些文件是导航和事项记录，不是记忆正文；目录与生成规则见 [底层文件结构](../design/design-memory-filesystem-v1.0.1.md)，记忆正文见 [记忆撰写规范](../design/design-memory-definition-v0.2.0.md)。

- [节点索引](#节点索引)：节点关系、事项摘要和记忆链接。
- [Bug](#bug)：现象、复现、归因、改动与测试。
- [TODO](#todo)：需求、验收条件、方案、改动与测试。
- [Idea](#idea)：想法及讨论结论。

各角色共用同一份格式，下文分工不新增权限，也不启用暂缓的自动派发。Bug/TODO 的轮次状态只有 `Confirmed` 和 `Refuted`；后续证据或需求推翻旧结论时，补 `RefutedBy` 和原因。测试区不记录人类验收，Session 区只放链接，不复制 Trace。

## 节点索引

### 格式

```md
# <标题>

<职责简介>

## 关联模块与节点

### Related

#### [<关联标题>](<path>/index.md)
<关联职责简介>

### Sub

#### [<下级标题>](<path>/index.md)
<下级职责简介>

## Bug

### [<Bug ID> <标题>](bugs/<id>.md)
<Bug 现象原文>

Status: <Open|InProgress|Pending|Resolved|Unfixable>

## Todo

### [<Todo ID> <标题>](todos/<id>.md)
<Todo 需求原文>

Status: <Open|InProgress|Done>

## Idea

### [<Idea ID> <标题>](ideas/<id>.md)
<Idea 正文原文>

Status: <Proposed|Accepted>

## 记忆

[阅读记忆](memory.md)
```

没有内容时写 `NULL`。Related 只放相关节点，Sub 只放直接下级。Bug/Todo/Idea 区块全部由代码生成。`## 记忆` 仅在该节点有记忆文档时生成；项目根节点的链接指向项目根目录 `memory.md`。

## Bug

### 状态

- `Open`：已记录，尚未开始处理。
- `InProgress`：Executor 与 Tester 的处理流程尚未结束。
- `Pending`：测试已完成，等待人类验收。
- `Resolved`：人类验收通过。
- `Unfixable`：修不好，流程结束，保留这条记录。不是延期，也不是「以后再做」。

**没有延期。** 禁止 `Deferred`。不需要修 → **删除该 Bug 文件**（索引中消失），不要写成 `WontFix` 留着挂起。

图片等二进制文件单独存储，只在本文挂引用链接。

迁移生成器把历史 `deferred` 投影为 `Unfixable`，历史 `wontfix` 不生成文件。二者都不会变成 `Open`。

### 角色分工

| 角色 | 职责 |
| --- | --- |
| Coordinator | 创建 Bug，在 `1. 现象` 记录人或 Agent 的原始报告；明确 `Reporter`、启动 A1 并交给 Executor。旧结论被指出有误时追加 `2. 后续纠正事件`。人类未验收时启动下一轮；Executor 与 Tester 完成后推进到 `Pending`，等待人类验收。 |
| Executor | 在当前 A 轮次的 `3. 复现` 写最短可重复步骤；在 `4. 原因与代码改动` 写归因、改动摘要和 `code index`。新证据推翻旧归因时，为旧轮次补 `RefutedBy` 和原因。同一现象的不同根因保留在同一 Bug，不另拆记录。 |
| Tester | 编写当前轮测试，覆盖复现、修复验证和必要回归；结果存测试文档，`5. 测试` 只留对应 A 轮次链接和一句结果。失败保留证据、交回下一轮；测试不代替人类验收。 |

### 格式

```md
# <Bug ID> <标题>

Reporter: <Human|Agent>
Status: <Open|InProgress|Pending|Resolved|Unfixable>
CurrentAttempt: <A1...An>

## 1. 现象

<最初报告的现象，只描述可观察结果>

## 2. 后续纠正事件

- <A轮次 / Human|Agent>：<反馈或新证据>

## 3. 复现

### A1
<该轮复现方法>

## 4. 原因与代码改动

### 当前有效结论
<仍成立的原因与修复结论>

### A1
Status: <Confirmed|Refuted>
RefutedBy: <A轮次，仅 Refuted 时出现>
Reason: <推翻原因，仅 Refuted 时出现>

原因：<该轮 Agent 当时的归因>

#### code index
- `<代码路径>`
  <改动简介>

## 5. 测试

- [A1](tests/<Bug ID>-A1.md)：<一句结果>

## 6. 修复 Session 索引

- [A1](traces/<Bug ID>-A1.md)
```

## TODO

### 状态

- `Open`：已记录，尚未开始。
- `InProgress`：Executor 与 Tester 的流程尚未结束。
- `Done`：当前需求已经验收完成。

迁移兼容说明：当前生成器的 Todo A1 可能缺少 `Status`。这是尚未符合本格式的旧投影，不是第三种归因状态；修复生成器前不得自行补写或把缺失状态当成 `Confirmed`。

### 角色分工

| 角色 | 职责 |
| --- | --- |
| Coordinator | 在 `1. 需求` 记录用户确认目标；后续范围或目标变化追加到 `2. 后续调整事件`，启动新 A 轮次；协调 Executor 与 Tester，维护整体流程状态。 |
| Executor | 按需求和验收标准修改代码、实现或修复；在当前轮 `4. 方案与代码改动` 记录方案、改动摘要和 `code index`。新方案推翻旧方案时，为旧轮次补 `RefutedBy` 和原因。 |
| Tester | 完善当前轮 `3. 验收标准` 的可执行条件，编写并执行测试；`5. 测试` 只留对应 A 轮次链接和一句结果。 |

### 格式

```md
# <Todo ID> <标题>

Reporter: <Human|Agent>
Status: <Open|InProgress|Done>
CurrentAttempt: <A1...An>

## 1. 需求

<用户确认的目标>

## 2. 后续调整事件

- <A轮次 / Human|Agent>：<新增约束或范围变化>

## 3. 验收标准

### A1
<该轮可执行验收标准>

## 4. 方案与代码改动

### 当前有效方案
<仍成立的方案结论>

### A1
Status: <Confirmed|Refuted>
RefutedBy: <A轮次，仅 Refuted 时出现>
Reason: <推翻原因，仅 Refuted 时出现>

方案：<该轮方案>

#### code index
- `<代码路径>`
  <改动简介>

## 5. 测试

- [A1](tests/<Todo ID>-A1.md)：<一句结果>

## 6. 实现 Session 索引

- [A1](traces/<Todo ID>-A1.md)
```

## Idea

Idea 只由 Coordinator 读写。是否转成 Todo 由用户与 Coordinator 在对话中决定，不记录在 Idea.md。

### 格式

```md
# <Idea ID> <标题>

Status: <Proposed|Accepted>

## 1. 想法

<想法正文>

## 2. 讨论与结论

- <时间或轮次>：<讨论结论>
```

## 轮次示例

A1 被 A2 推翻：A1 保留原内容，Status 为 Refuted，并填 RefutedBy: A2 / Reason；A2 为 Confirmed。多项仍有效的原因/方案可同时 Confirmed，不因后续轮次自动删除旧结论。每轮测试与 Session 链接仍按上述模板记录，不将测试通过当人类验收。
