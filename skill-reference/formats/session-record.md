# 本地会话记录：格式与示例

文档 v1.0.0。现有笔记格式不变；它不是 Map 记忆/Cloud Session Map。一个宿主会话可有多任务，归档追加、不覆盖。后续上下文记录方案另行讨论。

## 保存位置

以工具返回路径为准，通常 .codex/context/sessions/`<会话标识>`.md，关联 worktree 可共用绑定目录，不自行拼。文件名仅字母/数字/点/下划线/连字符，其他替连字符，最多120字符；事件另存 sessions.jsonl。均仅本地、不入 Git/Cloud。

## 现有格式

| 标识 | 内容 |
| --- | --- |
| Session / platform / started | 宿主会话、客户端、起始时间 |
| Events | Hook 自动事件，不手填 |
| Archive | 归档时间 |
| Summary / Decisions / Next | 摘要、决策、后续 |
| Verification and assessment | 验证及结构评估 |
| Files / Map | 改动/归属检查，不是发布回执 |

仅写有内容的部分，活跃 Plan 原审核/验证/归属门禁不变，本地保存不等于任务收工。

## 示例

```md
# Session claude-example

- platform: claude
- started: 2026-10-09T01:00:00Z

## Events

（Hook 追加）

## Archive 2026-10-09T01:30:00Z

### Summary

修复重复点击产生两条任务。

### Decisions

提交中禁用按钮，保留失败重试。

### Next

请 Coordinator 核真实验收。

### Files

- src/task-form.js
```

归档：context-guard archive-session --root `<项目>` --session `<真实会话标识>` --summary `<摘要>` --decisions `<决策>` --next `<后续事项>` --files `<改动文件>`。验证/评估用 --input 原字段，不伪造审核或服务器回执。
