# 文档入口

先区分现行接口、未来设计和历史证据；设计文档存在不代表功能已实现。

## 现行规则与接口

| 要查什么 | 入口 |
| --- | --- |
| 开发、PR、交付规则 | [RULE.md](../RULE.md) |
| 需求到复盘的完整流程、风险与证据 | [开发流程规范](engineering/README.md)、[最小模板](engineering/templates.md) |
| 已验证范围与未完成验收 | [CI_todo.md](../CI_todo.md)；历史条目不覆盖后续替代说明 |
| 文件归属与依赖边界 | [仓库布局](repository-layout.md) |
| Agent 使用入口 | [SKILL.md](../SKILL.md) |
| 设备 / Session 消息格式 | [接口 v2](interface-contract-v2.md)、[机器可读契约](interface-contract-v2.json) |
| 数据对象与示例 | [数据契约](interface-data-contracts.md)、[JSON 示例](interface-json-examples.md) |
| Map / CLI / 计划与归档 | [工作台接口](../references/workbench-interface.md) |
| 私有 Main / Session 记忆及发布 | [服务器记忆](../references/server-memory.md) |
| Map-only 兼容同步 | [Cloud Sync](../references/cloud-sync-interface.md)；不是新 Session 的默认连接方式 |
| 部署、发布、安全、测试 | [Cloud 部署](../references/cloud-deployment.md)、[npm 发布](npm-release-runbook.md)、[安全](development-security.md)、[测试治理](test-governance.md) |

同一功能只在对应契约维护定义，其他文档引用它；接口变更同时标明实现、测试和部署范围，不用“本轮”“最新”替代版本证据。

## 分级 Agent：角色设计，不等于已接通流程

[角色入口](../roles.md)及 [Coordinator](../Coordinator.md)、[Developer](../Developer.md)、[Tester](../Tester.md) 保留独立设计。
目标是 Coordinator 理解需求、组织节点和任务，执行 Session 按需读取 Map，流程结束后沉淀经验；不把项目知识永久绑定到某个 Session。
当前 Cloud 通信实现与未来角色编排分开维护，不能因角色文档已合并就宣称自动多 Agent 已实现。

## 设计草案与历史证据

- [文件与记忆设计](design/file-design.md)：设计方向与合成实验，不是已实施的存储布局。
- [工作台设计画廊](design/workbench-gallery/index.html)：独立静态设计资料；不随生产页面或 Skill 分发。使用 `?gallery=add|trash|chip` 切换分类。
- [接口讨论](design/interface-design-discussion.md)、[Session 接口历史草案](design/session-workbench-interface-draft.md)：保留背景，不叠加为现行规则。
- [可靠性 Review](reliability-review.md)、[消融 Review](ablation-review.md)、[Hook 验收记录](hook-closure-validation.md)：历史证据，当前限制查 CI_todo。
- [客户端 CI](client-ci.md)、[工作台 CI](workbench-ci.md)、[真实客户端验收](real-client-acceptance.md)：专项验证说明。

开发私有记忆、真实数据与凭据不进入本目录；项目记忆仍由配置的私有服务器管理。
