# 文档入口

`development-docs/` 供仓库开发；`skill-reference/` 是分发给产品 Agent 的设计、契约与操作资料。按任务找一份，不通读所有文档。

## 仓库开发

| 查什么 | 权威入口 |
| --- | --- |
| 源码/构建归属 | [仓库边界](repository-boundaries.md) |
| 当前投入/暂缓 | [当前开发方向](current-focus.md) |
| 权限、PR、交付、清理 | [RULE](../RULE.md) |
| 开发流程/风险/证据 | [开发流程](engineering/README.md) |
| 测试入口与通过条件 | [CI 标准](ci.md) |
| 已实现模块未验项 | [CI_todo](../CI_todo.md) |
| 发布/失败恢复 | [发布手册](npm-release-runbook.md) |

## 产品资料

先读 [SKILL](../SKILL.md)，按需转 [角色](../roles/README.md)、[设计目录](../skill-reference/design/README.md)、[Map 操作](../skill-reference/map-read.md)、[交接](../skill-reference/agent-handoff.md)；字段以 [机器契约](../skill-reference/interface-contract-v2.json) 和 [接口说明](../skill-reference/design/design-interface-v1.2.1.md) 为准。源码位置见 [AGENTS](../AGENTS.md#架构与源码位置)，Cloud 专有部署见其 [手册](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/references/cloud-deployment.md)。

## 资源与历史

shots/workbench/ 为 README 配图，不是前端源码。旧说明/已完成项查 Git，未验项和失败证据保留；文档存在不证明已部署。私有记忆、数据、凭据不进入文档目录。
