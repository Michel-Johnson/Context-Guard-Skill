# Bug.md 格式

## 状态

- `Open`：已记录，尚未开始处理。
- `InProgress`：Developer 与 Tester 的处理流程尚未结束。
- `Pending`：测试已完成，等待人类验收。
- `Resolved`：人类验收通过。
- `Unfixable`：修不好，流程结束，保留这条记录。不是延期，也不是「以后再做」。

**没有延期。** 禁止 `Deferred`。不需要修 → **删除该 Bug 文件**（索引中消失），不要写成 `WontFix` 留着挂起。

图片等二进制文件单独存储，只在本文挂引用链接。

迁移生成器把历史 `deferred` 投影为 `Unfixable`，历史 `wontfix` 不生成文件。二者都不会变成 `Open`。

归因轮次只使用 `Confirmed` 和 `Refuted`。新归因在本轮证据支持时写 `Confirmed`；后续轮次推翻后改为 `Refuted`，并补充 `RefutedBy` 和原因。

## 格式

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

测试区不记录人类验收。Session 区只放链接，不复制 Trace 内容。

## 四轮复杂示例

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
