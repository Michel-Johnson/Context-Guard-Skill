# 文档入口

`development-docs/` 放仓库开发、测试和发布说明；`skill-reference/` 放随 Skill 分发的产品设计、接口契约和操作指南。产品角色从 [SKILL.md](../SKILL.md) 进入，源码位置见 [AGENTS.md](../AGENTS.md#架构与源码位置)。

## 仓库开发

| 要查什么 | 入口 |
| --- | --- |
| Skill 与 Cloud 的源码归属、共享包边界 | [仓库边界](repository-boundaries.md) |
| 当前主线与暂缓范围 | [当前开发方向](current-focus.md) |
| 权限、分支、PR 与交付要求 | [RULE.md](../RULE.md) |
| 开发步骤、风险判断与任务模板 | [开发流程](engineering/README.md) |
| 测试入口、质量要求与真实客户端验收 | [检查怎样算通过](ci.md) |
| 已实现模块的测试缺口 | [CI_todo.md](../CI_todo.md) |
| npm、共享包发布与失败恢复 | [发布手册](npm-release-runbook.md) |

## 产品资料

设计从 [设计目录](../skill-reference/design/README.md) 按主题查找；角色分工只在 [角色入口](../roles/README.md) 维护。Map 读取与挂载见 [Map 操作](../skill-reference/map-read.md)，交接、审核和测试结论见 [交接指南](../skill-reference/agent-handoff.md)。协议字段与示例见 [接口设计](../skill-reference/design/design-interface-v1.2.1.md) 和 [机器契约](../skill-reference/interface-contract-v2.json)。

共享核心、UI、角色与通用资料在 Skill 维护；Cloud 固定版本使用。Cloud 专有部署见其 [部署手册](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/references/cloud-deployment.md)。源码存在或文档写明，不等于客户端、Cloud 或 Slack 已部署验收。

## 资源与历史

`shots/workbench/` 保存 README 的产品截图，不是产品前端源码或设计规范。旧文档和已完成测试记录从 Git 历史查看；失败证据及未完成验收不能因整理文档丢失。私有开发记忆、真实数据与凭据不进入本目录。
