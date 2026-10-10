# 产品设计与格式指南

按当前任务查对应主题，不要求通读全部设计。每个主题只保留一份当前说明；文档版本、产品版本、接口协议和文件格式分别管理。本目录不作为功能已实现、已部署或已验收的证明。

## 产品设计

| 要了解什么 | 文档 |
| --- | --- |
| 开工读什么、开发中何时查询、收工如何查变化 | [Executor 上下文流程](design-context-v1.0.0.md) |
| Coordinator 如何讨论需求、推荐并确认主节点 | [Coordinator 需求讨论](design-coordinator-dialogue-v0.1.0.md) |
| Cursor CLI 与 Cloud Agent 如何接入 | [Cursor 接入](design-cursor-workbench-v0.2.0.md) |
| 谁能调用什么、如何启动绑定、读写和恢复 | [工作台与 Agent 接口](design-interface-v1.2.1.md) |
| 项目和节点记忆写什么、由谁维护 | [记忆撰写规范](design-memory-definition-v0.2.0.md) |
| Main / Session 目录如何组织、文件如何生成 | [底层文件结构](design-memory-filesystem-v1.0.1.md) |
| Cloud 如何连接、同步、隔离和发布 Map | [Cloud Map](design-memory-server-v1.1.0.md) |

记忆正文只指 `memory.md`；索引和事项 Markdown 是底层文件结构的一部分，不是记忆正文。文件格式保持 `fs-v2.1`，事务格式保持 `v2`。

## 模板与格式

| 要查什么 | 文档 |
| --- | --- |
| 节点索引、Bug、TODO、Idea 的字段、角色分工和示例 | [索引与事项文件模板](../formats/file-templates.md) |
| 本地开发笔记的保存位置、归档格式和示例 | [会话记录格式](../formats/session-record.md) |

各角色共用同一份格式，不维护角色版或重复英文版；本地会话笔记不是 Cloud Session Map，也不上传 Cloud。

## 操作与开发资料

产品角色见 [角色入口](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/roles/README.md)。Map 读取与挂载见 [Map 操作](../map-read.md)，交接、审核与测试结论见 [交接指南](../agent-handoff.md)，回复见 [回复指南](../user-reply.md)，Claude 投递见 [运行指南](../claude-runtime.md)。机器字段与示例见 [接口契约](../interface-contract-v2.json)。

仓库源码归属见 [仓库边界](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/development-docs/repository-boundaries.md)，开发优先级见 [当前开发方向](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/development-docs/current-focus.md)，文档创建、版本和交付要求见 [RULE](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/RULE.md)。Cloud 专有模型、Slack 与附件设计从 [Cloud 设计目录](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/references/design/README.md) 查找，不在这里复制。
