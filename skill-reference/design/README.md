# 产品设计与格式指南

按任务查一份；各主题只维护当前版，文档/产品/协议/格式版本独立。文档存在不证明实现、部署或验收。

## 产品设计

| 问题 | 权威说明 |
| --- | --- |
| Executor 按需读取/收工 | [上下文](design-context-v1.0.0.md) |
| Coordinator 需求/主节点 | [需求讨论](design-coordinator-dialogue-v0.1.0.md) |
| Cursor CLI/Cloud 角色 | [Cursor 接入](design-cursor-workbench-v0.2.0.md) |
| 权限、绑定、读写、恢复 | [接口](design-interface-v1.2.1.md) |
| memory.md 写什么/谁维护 | [记忆规范](design-memory-definition-v0.2.0.md) |
| 目录/生成与 fs-v2.1 | [文件结构](design-memory-filesystem-v1.0.1.md) |
| Cloud 配对/同步/发布 | [Cloud Map](design-memory-server-v1.1.0.md) |

只有 memory.md 是记忆正文；index.md 与事项是导航/记录。文件 fs-v2.1、事务 v2 不变。

## 模板与格式

[索引/Bug/TODO/Idea 模板](../formats/file-templates.md) 含字段和角色分工；[本地会话格式](../formats/session-record.md) 含保存路径/归档示例。各角色共用格式，不复制角色版/英文版，笔记不是 Cloud Session Map，也不上传。

## 操作与开发资料

从 [SKILL](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/SKILL.md) 转 [角色](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/roles/README.md)、[Map 操作](../map-read.md)、[交接](../agent-handoff.md)、[回复](../user-reply.md)、[Claude](../claude-runtime.md)；字段以 [机器契约](../interface-contract-v2.json) 为准。

仓库边界、当前方向和规则见 [开发文档](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/development-docs/README.md)。Cloud 专有模型/Slack/附件见 [Cloud 设计目录](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/references/design/README.md)，不复制到 Skill。
