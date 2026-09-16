# Todo.md 格式

## 状态

- `Open`：已记录，尚未开始。
- `InProgress`：Developer 与 Tester 的流程尚未结束。
- `Done`：当前需求已经验收完成。

方案轮次使用 `Confirmed` 和 `Refuted`。后续需求或证据推翻旧方案时，更新旧轮次并写明 `RefutedBy` 与原因。

迁移兼容说明：当前生成器的 Todo A1 可能缺少 `Status`。这是尚未符合本格式的旧投影，不是第三种归因状态；修复生成器前不得自行补写或把缺失状态当成 `Confirmed`。

## 格式

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

## 三轮示例

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
- A3 / Developer B：采用服务端请求键，补充同键不同内容的冲突规则。

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
