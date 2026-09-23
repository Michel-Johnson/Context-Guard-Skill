# 文档入口

读者：仓库开发 Agent（本目录多数文件未随 Skill 分发）。产品角色请从 [当前设计版本](../references/design-current.md) 和 [SKILL.md](../SKILL.md) 进入。

先区分现行接口、未来设计和历史证据；设计文档存在不代表功能已实现。当前设计版本是 **`fs-v2`**，见 [当前设计版本](../references/design-current.md)。`docs/design/` 不是现行法。

## 现行规则与接口

| 要查什么 | 入口 |
| --- | --- |
| 当前设计版本 | [design-current.md](../references/design-current.md)（`fs-v2`） |
| 开发、PR、交付规则 | [RULE.md](../RULE.md) |
| 需求到复盘的完整流程、风险与证据 | [开发流程规范](engineering/README.md)、[最小模板](engineering/templates.md) |
| 已验证范围与未完成验收 | [CI_todo.md](../CI_todo.md)；历史条目不覆盖后续替代说明 |
| 文件归属与依赖边界 | [仓库布局](repository-layout.md) |
| Agent 使用入口 | [SKILL.md](../SKILL.md) |
| 设备 / Session 消息格式与示例 | [接口 v2](interface-contract-v2.md)、[机器可读契约](interface-contract-v2.json) |
| Map / CLI / 计划与归档 | [工作台接口](../references/workbench-interface.md) |
| 私有 Main / Session 记忆及发布 | [服务器记忆](../references/server-memory.md) |
| Cloud node/module、Bug、Todo、Idea 文件格式 | [Memory Filesystem v2](../references/memory-filesystem-v2/README.md) |
| Map-only 兼容同步 | [Cloud Sync](../references/cloud-sync-interface.md)；不是新 Session 的默认连接方式 |
| 部署、发布、安全、测试 | [Cloud 部署](../references/cloud-deployment.md)、[npm 发布](npm-release-runbook.md)、[检查怎样算通过](ci.md)、[测试治理](test-governance.md) |

同一功能只在对应契约维护定义，其他文档引用它；接口变更同时标明实现、测试和部署范围，不用“本轮”“最新”替代版本证据。

## 分级 Agent：角色设计，不等于已接通流程

[角色入口](../roles.md)及 [Coordinator](../Coordinator.md)、[Executor](../Executor.md)、[Tester](../Tester.md) 是产品角色规范（随包）。
目标是 Coordinator 理解需求、组织节点和任务，执行 Session 按需读取 Map，流程结束后沉淀经验；不把项目知识永久绑定到某个 Session。
当前 Cloud 通信实现与未来角色编排分开维护，不能因角色文档已合并就宣称自动多 Agent 已实现。

## 设计草案与历史证据

草案不是当前设计版本，禁止当存储、权限或发布协议。要升格必须按 [设计版本管理](../references/design-current.md) 开下一版。

- [工作台设计画廊](design/workbench-gallery/index.html)：浏览器测试仍加载的静态资料；不随生产页面或 Skill 分发。使用 `?gallery=add|trash|chip` 切换分类。
- [可靠性 Review](reliability-review.md)、[消融 Review](ablation-review.md)、[Hook 验收记录](hook-closure-validation.md)：历史证据，当前限制查 CI_todo。
- [检查怎样算通过](ci.md)、[真实客户端验收](real-client-acceptance.md)：专项验证说明。

开发私有记忆、真实数据与凭据不进入本目录；项目记忆仍由配置的私有服务器管理。
