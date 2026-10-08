# 文档入口

读者：Skill 仓库开发 Agent。产品角色从 [SKILL.md](../SKILL.md) 进入。
共享角色与参考文档由固定 Cloud 包生成；干净源码检出先执行
`npm ci --ignore-scripts` 和 `npm run build:runtime`，不要因尚未构建而创建同名规范副本。

## 现行规则与接口

设计文档按主题独立编号，不等于产品、API 或记忆格式版本；命名与升版规则见 [RULE.md](../RULE.md#3-实现)。共享设计源码在 Cloud 的 `scripts/shared/references/design/`，安装后为 `references/design/`，不要复制另一份。

新文档布局使用 Cloud core 2.0.0，工作台 UI 仍固定为 1.1.4。构建须从已发布的精确 URL 读取并校验锁文件；源码和包存在不等于安装已验收，实际证据见 CI_todo。

| 要查什么 | 入口 |
| --- | --- |
| 当前开发方向、模式和暂缓范围 | [当前开发方向](current-focus.md) |
| 开发、PR 与交付规则 | [RULE.md](../RULE.md)、[开发流程](engineering/README.md) |
| 验证记录与待 Tester 项 | [CI_todo.md](../CI_todo.md)；历史证据不代表新版本验收 |
| 源码与生成物边界 | [仓库布局](repository-layout.md) |
| Skill 安装与 npm 发布 | [npm 发布](npm-release-runbook.md) |
| 检查标准与责任分工 | [检查怎样算通过](ci.md)、[测试治理](test-governance.md) |
| Session 同步、连接与旧数据升级 | [Cloud Sync](../references/design/design-cloud-sync-v1.0.1.md)，由 Skill 维护 |
| 协议消息、字段和示例 | Cloud 的 [接口设计](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/scripts/shared/references/design/design-interface-v1.2.1.md)、[机器契约](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/docs/interface-contract-v2.json) |
| Cloud 和 Slack 部署 | Cloud 的 [部署手册](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/references/cloud-deployment.md)、[Slack 接入](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/scripts/shared/references/design/design-slack-integration-v1.0.0.md) |
| 当前记忆存储与文件格式 | [当前记忆规范](../references/design/design-memory-current-v1.0.1.md)（生成参考） |
| Map / CLI / 计划与归档 | [工作台接口](../references/design/design-workbench-interface-v1.0.1.md)（生成参考） |
| 私有 Main / Session 与发布 | [服务器记忆](../references/design/design-memory-server-v1.0.1.md)（生成参考） |
| 节点及事项文件格式 | [Memory Filesystem v2.1](../references/design/design-memory-filesystem-v1.0.1.md)（生成参考） |
| 记忆定义与维护职责 | [记忆规范](../references/design/design-memory-definition-v0.2.0.md)（生成参考） |

在线 Cloud main 文档用于定位源码；判断已安装客户端实际支持什么，须核对
Skill 锁定的共享包和服务器能力。文档或源码存在，不等于已部署或已验收。

## 产品角色

[角色入口](../roles.md)与 [Coordinator](../Coordinator.md)、
[Executor](../Executor.md)、[Tester](../Tester.md) 由 Cloud core 包生成并随 Skill 分发。
Coordinator 对齐需求和审核计划；Executor 实现与模块测试，写编号 CI_todo；
Tester 独立验证。拆仓库不改变这套流程，也不将人类审批写成自动通过。

## 历史和验收

历史审查与实验保留在 Git 中；尚未完成的事项继续留在 CI_todo，
完成项打勾并附测试证据，不删除历史。设计草案不代替当前产品规范。

[真实客户端验收](real-client-acceptance.md) 说明模型宿主和安装入口的验证边界。
Cloud 专属用例及跨仓库联调在 Cloud 仓库执行；Skill 源码测试通过不代表
生产 Cloud、Slack 或第三方 Agent 已连通。

私有开发记忆、真实数据与凭据不进入本目录；生成参考文档也不是用户的项目记忆。
