# Idea.md 格式

Idea 只由 Coordinator 读写。是否转成 Todo 由用户与 Coordinator 在对话中决定，不记录在 Idea.md。

## 格式

```md
# <Idea ID> <标题>

Status: <Proposed|Accepted>

## 1. 想法

<想法正文>

## 2. 讨论与结论

- <时间或轮次>：<讨论结论>
```

## 示例

```md
# I002 反馈时附带当前节点信息

Status: Proposed

## 1. 想法

用户从节点内创建反馈时，自动附带当前节点 ID 和标题，减少手工描述问题位置。

## 2. 讨论与结论

- C1：保留原始节点 ID；标题只用于显示，避免重命名后失去关联。
- C2：尚未决定是否实施，继续作为 Idea 保留。
```
