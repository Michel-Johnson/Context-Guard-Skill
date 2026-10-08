# 文档入口

读者：Skill 仓库开发 Agent。产品角色从 [SKILL.md](../SKILL.md) 进入。
共享核心、UI、角色和参考是本仓库源码；干净检出执行 `npm ci --ignore-scripts` 和 `npm run build:runtime`。

## 现行规则与接口

设计文档按主题独立编号，不等于产品、API 或记忆格式版本；命名与升版规则见 [RULE.md](../RULE.md#3-实现)。共享设计在 Skill 的 `references/design/` 维护；Cloud 专有设计在 Cloud 的 `references/design/` 维护，不复制第二份。

共享核心和 UI 由本仓库打包，Cloud 消费固定发布版本；源码、发布、安装和部署分别验收，见 CI_todo。

| 要查什么 | 入口 |
| --- | --- |
| 当前开发方向、模式和暂缓范围 | [当前开发方向](current-focus.md) |
| 开发、PR 与交付规则 | [RULE.md](../RULE.md)、[开发流程](engineering/README.md) |
| 验证记录与待 Tester 项 | [CI_todo.md](../CI_todo.md)；历史证据不代表新版本验收 |
| 源码与生成物边界 | [仓库布局](repository-layout.md) |
| Skill 安装与 npm 发布 | [npm 发布](npm-release-runbook.md) |
| 检查标准与责任分工 | [检查怎样算通过](ci.md)、[测试治理](test-governance.md) |
| Session 同步、连接与旧数据升级 | [Cloud Sync](../references/design/design-cloud-sync-v1.0.1.md)，由 Skill 维护 |
| 协议消息、字段和示例 | 共享 [接口设计](../references/design/design-interface-v1.2.1.md)、[机器契约](interface-contract-v2.json) |
| Cloud 和 Slack 部署 | Cloud 的 [部署手册](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/references/cloud-deployment.md)、[Slack 接入](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/references/design/design-slack-integration-v1.0.0.md) |
| 当前记忆存储与文件格式 | [当前记忆规范](../references/design/design-memory-current-v1.0.1.md) |
| Map / CLI / 计划与归档 | [工作台接口](../references/design/design-workbench-interface-v1.0.1.md) |
| 私有 Main / Session 与发布 | [服务器记忆](../references/design/design-memory-server-v1.0.1.md) |
| 节点及事项文件格式 | [Memory Filesystem v2.1](../references/design/design-memory-filesystem-v1.0.1.md) |
| 记忆定义与维护职责 | [记忆规范](../references/design/design-memory-definition-v0.2.0.md) |

定位共享源码读取 Skill main；判断实际客户端能力须核对安装版本，Cloud 能力须核对其固定包与运行版本。文档或源码存在，不等于已部署或已验收。

## 产品角色

[角色入口](../roles.md)与 [Coordinator](../Coordinator.md)、
[Executor](../Executor.md)、[Tester](../Tester.md) 在本仓库维护，并随 Skill 与 core 包分发。
Coordinator 对齐需求和审核计划；Executor 实现与模块测试，写编号 CI_todo；
Tester 独立验证。拆仓库不改变这套流程，也不将人类审批写成自动通过。

## 历史和验收

历史审查与实验保留在 Git 中；尚未完成的事项继续留在 CI_todo，
完成项打勾并附测试证据，不删除历史。设计草案不代替当前产品规范。

[真实客户端验收](real-client-acceptance.md) 说明模型宿主和安装入口的验证边界。
Cloud 专属用例及跨仓库联调在 Cloud 仓库执行；Skill 源码测试通过不代表
生产 Cloud、Slack 或第三方 Agent 已连通。

私有开发记忆、真实数据与凭据不进入本目录；规范文档也不是用户的项目记忆。
