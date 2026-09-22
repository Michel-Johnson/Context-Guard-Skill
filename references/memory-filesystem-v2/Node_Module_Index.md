# Node / Module index 格式

## 格式

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
```

没有内容时写 `NULL`。Related 只放相关节点，Sub 只放直接下级。Bug/Todo/Idea 区块全部由代码生成。

## 完整示例

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
