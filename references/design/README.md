# 项目设计目录

这里维护 Skill 自有的共享设计。Cloud 从固定 core 包使用这些文档，不维护副本；云端专有设计留在 Cloud。文档版本与产品、API 和记忆格式版本分别管理。

记忆正文怎么写，见记忆撰写规范；目录、索引和事项怎么存，见底层文件结构规范。文件格式为 fs-v2.1，底层事务格式为 v2，不另设版本指引。

每个主题只保留当前文档，旧版从 Git 历史查看。升版要求见 [RULE.md 的实现规范](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/RULE.md#3-实现)；README.md 只是导航入口，不使用设计文件命名格式。投入优先级以[Skill 当前开发方向](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/docs/current-focus.md) 为准，Cloud 自动派发等暂缓范围不因文档搬迁而恢复。

## 设计说明

| 主题 | 当前文档 | 内容 |
| --- | --- | --- |
| 仓库边界 | [design-repository-v1.0.0.md](design-repository-v1.0.0.md) | 核心、云端扩展与共享包的源码归属 |
| Executor 上下文 | [design-context-v1.0.0.md](design-context-v1.0.0.md) | 开工导航、按需读取、本地缓存与收工变化检查 |
| 接口 | [design-interface-v1.2.1.md](design-interface-v1.2.1.md) | Agent、Human、Host、Cloud 的能力与调用边界 |
| Agent | [design-agent-v1.0.1.md](design-agent-v1.0.1.md) | 角色职责、协作边界和运行提示入口 |
| 底层文件结构 | [design-memory-filesystem-v1.0.1.md](design-memory-filesystem-v1.0.1.md) | Main / Session 目录、索引、事项文件与生成规则 |
| 记忆撰写 | [design-memory-definition-v0.2.0.md](design-memory-definition-v0.2.0.md) | 仅规定项目与节点 memory.md 的内容、格式和维护 |
| 服务器记忆 | [design-memory-server-v1.1.0.md](design-memory-server-v1.1.0.md) | 服务器数据权威、权限、同步和发布规则 |
| 工作台接口 | [design-workbench-interface-v1.1.0.md](design-workbench-interface-v1.1.0.md) | Map 操作、计划、归档、通知和恢复契约 |
| 本机工作台 | [design-workbench-v1.0.1.md](design-workbench-v1.0.1.md) | 项目命名、Session 绑定和进程复用 |
| Cloud 同步 | [design-cloud-sync-v1.0.1.md](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/references/design/design-cloud-sync-v1.0.1.md) | Session 同步、兼容传输、冲突和授权 |
| Coordinator 压缩 | [design-coordinator-compaction-v1.0.0.md](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/references/design/design-coordinator-compaction-v1.0.0.md) | 普通 Cloud 对话的历史压缩与原文保留 |
| Slack 插件 | [design-slack-integration-v1.1.0.md](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/references/design/design-slack-integration-v1.1.0.md) | 插件隔离、网关、自然语言对话和人工执行模式 |
| Cloud 附件 | [design-cloud-attachments-v1.0.0.md](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/references/design/design-cloud-attachments-v1.0.0.md) | 夸克附件权限、持久流程和失败边界；继续暂缓 |

## 索引与事项记录格式

以下是底层索引和事项记录的模板，不是记忆正文模板，也不是手工持久化入口。

| 模板 | 当前中文规范 |
| --- | --- |
| 节点 / 模块索引 | [节点索引格式](design-memory-node-index-v1.0.1.md) |
| Bug | [Bug 格式与角色分工](design-memory-bug-v1.0.1.md) |
| TODO | [TODO 格式与角色分工](design-memory-todo-v1.0.1.md) |
| Idea | [Idea 格式](design-memory-idea-v1.0.0.md) |

所有角色共用同一事项格式；Coordinator、Executor、Tester 的职责分别列在 Bug / TODO 正文中，不维护独立格式或重复英文版。

## 设计之外的入口

Agent 运行提示仍从 [roles.md](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/roles.md) 进入；Map 操作、回复、交接、审核和测试结论指南仍在 references 根目录按需读取。Cloud 安装、升级和恢复使用 [部署手册](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/references/cloud-deployment.md)，Claude 托管执行使用 [运行指南](../claude-runtime.md)。不要用设计说明替代执行授权或操作回执。
