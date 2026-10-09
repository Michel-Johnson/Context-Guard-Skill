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

### 完整示例

```md
# Bug按钮

提交当前节点的缺陷反馈。

## 关联模块与节点

### Related

#### [侧边栏](../../侧边栏-module/index.md)
提供模块导航与切换。

### Sub

NULL

## Bug

### [B002 连续点击产生重复反馈](bugs/B002.md)
连续点击提交时生成重复记录。

Status: Pending

## Todo

### [T002 补充反馈提交中的状态](todos/T002.md)
提交期间显示进度并阻止重复提交。

Status: InProgress

## Idea

### [I002 反馈时附带当前节点信息](ideas/I002.md)
减少用户手工描述问题位置。

Status: Proposed
```

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

### 四轮复杂示例

```md
# B002 连续点击产生重复反馈

Reporter: Human
Status: Pending
CurrentAttempt: A4

## 1. 现象

一次提交尚未结束时再次点击，会生成两条内容相同的反馈。

## 2. 后续纠正事件

- A1 / Human：快速双击仍重复，验收不通过；禁用按钮不能覆盖事件队列中的第二次提交。
- A2 / Human：弱网超时后重试仍重复，验收不通过；同步锁只覆盖单个窗口。
- A3 / Agent B：第二轮修复后，同一草稿在多个窗口同时提交仍重复，旧的请求键方案不能防并发创建。
- A4 / Tester B：并发、重试和冲突回归通过，等待人类验收。

## 3. 复现

### A1
填写反馈，连续双击提交按钮。

### A2
将首个请求延迟到超时，在界面重试。

### A3
服务端创建成功后丢弃响应，再用相同请求键重试。

### A4
两个窗口同时提交同一草稿；再以同键同内容和同键不同内容分别重试。

## 4. 原因与代码改动

### 当前有效结论
单窗口同步锁阻止界面重入；服务端原子唯一约束保证跨窗口及网络重试只创建一条记录，同键不同内容明确冲突。

### A1
Status: Refuted
RefutedBy: A2
Reason: 事件队列中的第二次点击发生在按钮禁用生效前。

原因：怀疑提交按钮允许重复点击。

#### code index
- `src/ui/FeedbackForm.tsx`
  提交开始时禁用按钮。

### A2
Status: Confirmed

原因：界面状态更新前存在重入窗口。

#### code index
- `src/ui/submitFeedback.ts`
  在提交入口增加同步锁，结束时释放。

### A3
Status: Refuted
RefutedBy: A4
Reason: 请求键查重与插入不是原子操作，并发请求可同时通过检查。

原因：超时重试未复用已创建反馈；复用请求键即可防止重复。

#### code index
- `src/server/createFeedback.ts`
  创建前查询请求键并返回已有记录。

### A4
Status: Confirmed

原因：查重与插入不原子，并发请求会同时通过检查。

#### code index
- `src/storage/migrations/004_feedback_unique_key.sql`
  为用户与请求键建立组合唯一约束。
- `src/server/createFeedback.ts`
  原子创建；唯一键冲突时返回已有记录，同键不同内容返回冲突。

## 5. 测试

- [A1](tests/B002-A1.md)：连续点击仍可复现。
- [A2](tests/B002-A2.md)：单窗口通过，弱网重试失败。
- [A3](tests/B002-A3.md)：顺序重试通过，并发提交失败。
- [A4](tests/B002-A4.md)：并发、超时重试和冲突回归通过。

## 6. 修复 Session 索引

- [A1](traces/B002-A1.md)
- [A2](traces/B002-A2.md)
- [A3](traces/B002-A3.md)
- [A4](traces/B002-A4.md)
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

### 三轮示例

```md
# T002 补充反馈提交中的状态

Reporter: Human
Status: InProgress
CurrentAttempt: A3

## 1. 需求

反馈提交期间显示明确状态，并阻止同一提交重复执行。

## 2. 后续调整事件

- A1 / Human：按钮禁用后无法取消，要求保留取消操作。
- A2 / Human：多个窗口仍会重复提交，范围扩展到跨窗口一致性。
- A3 / Executor B：采用服务端请求键，补充同键不同内容的冲突规则。

## 3. 验收标准

### A1
提交中显示进度；重复点击不产生第二个请求；用户可以取消。

### A2
两个窗口提交同一草稿时只创建一条记录。

### A3
同键同内容返回同一记录；同键不同内容返回冲突；取消后允许新请求。

## 4. 方案与代码改动

### 当前有效方案
客户端状态机负责进度与取消，服务端请求键和唯一约束负责跨窗口幂等。

### A1
Status: Refuted
RefutedBy: A2
Reason: 仅禁用按钮不能满足取消和跨窗口一致性。

方案：提交时禁用按钮并显示加载状态。

#### code index
- `src/ui/FeedbackForm.tsx`
  增加提交中状态。

### A2
Status: Confirmed

方案：使用可取消状态机管理单窗口提交。

#### code index
- `src/ui/feedbackSubmission.ts`
  管理 idle、submitting、cancelling 状态。

### A3
Status: Confirmed

方案：服务端以用户和请求键保证原子幂等。

#### code index
- `src/server/createFeedback.ts`
  校验请求键并处理唯一键冲突。
- `src/storage/migrations/004_feedback_unique_key.sql`
  增加组合唯一约束。

## 5. 测试

- [A1](tests/T002-A1.md)：进度通过，取消失败。
- [A2](tests/T002-A2.md)：单窗口通过，跨窗口失败。
- [A3](tests/T002-A3.md)：状态、取消、跨窗口与冲突回归通过。

## 6. 实现 Session 索引

- [A1](traces/T002-A1.md)
- [A2](traces/T002-A2.md)
- [A3](traces/T002-A3.md)
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

### 示例

```md
# I002 反馈时附带当前节点信息

Status: Proposed

## 1. 想法

用户从节点内创建反馈时，自动附带当前节点 ID 和标题，减少手工描述问题位置。

## 2. 讨论与结论

- C1：保留原始节点 ID；标题只用于显示，避免重命名后失去关联。
- C2：尚未决定是否实施，继续作为 Idea 保留。
```
