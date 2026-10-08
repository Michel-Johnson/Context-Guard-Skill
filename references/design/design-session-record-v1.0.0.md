# 本地会话记录：格式与示例

文档版本：v1.0.0。

会话记录是 Agent 的开发笔记，不是 Map 记忆，也不是 Cloud 的 Session Map。一个宿主会话可包含多个任务；每次归档追加一段，不覆盖旧记录。

## 保存位置

归档工具返回实际文件路径，通常为 `.codex/context/sessions/<会话标识>.md`。关联工作树可能共用绑定目录，以返回路径为准，不自行拼路径。

文件名只保留字母、数字、点、下划线和连字符，其他字符替换为连字符，最多 120 个字符。Hook 的事件明细另存 `sessions.jsonl`。这两个文件都只保存在本地，不上传到 Cloud 或 Git。

## 现有格式

保留以下格式标识，兼容已有记录；正文用中文，不改变文件格式。

| 标识 | 内容 |
| --- | --- |
| `Session`、`platform`、`started` | 宿主会话标识、客户端、开始时间 |
| `Events` | Hook 自动追加的事件，不手工填写 |
| `Archive` | 一次归档及其时间 |
| `Summary`、`Decisions`、`Next` | 工作摘要、关键决策、后续事项 |
| `Verification and assessment` | 验证证据及是否提出结构变更 |
| `Files`、`Map` | 改动文件与文件归属检查结果；不是 Main 发布回执 |

只写有内容的部分。活跃 Plan 的审核、验证和文件归属检查仍按原门禁执行；归档成功仅表示本地记录已保存。

## 示例

```md
# Session claude-example

- platform: claude
- started: 2026-10-09T01:00:00Z

## Events

（由 Hook 追加）

## Archive 2026-10-09T01:30:00Z

### Summary

修复重复点击提交按钮产生两条任务的问题。

### Decisions

提交过程中禁用按钮，保留失败后的重试入口。

### Next

请 Coordinator 确认真实项目的验收结果。

### Files

- src/task-form.js
```

使用 `context-guard archive-session --root <项目> --session <真实会话标识> --summary <摘要> --decisions <决策> --next <后续事项> --files <改动文件>` 归档。需要验证与评估时通过 `--input` 提供原有字段，不手工伪造审核或服务器回执。
