# 仓库文件归属

Skill 是核心产品，Cloud 是可选云端扩展。唯一设计见 [两仓库边界](../references/design/design-repository-v1.0.0.md)。

| Skill 位置 | 职责 |
| --- | --- |
| scripts/shared/ | Map、记忆格式、共享协议、事务与公共 I/O |
| prototype/ | 本地与 Cloud 共用的工作台 UI |
| roles.md、Coordinator.md、Executor.md、Tester.md | 共享角色运行提示 |
| references/、docs/interface-contract-v2.json | 通用设计、操作指南和协议机器契约 |
| bin/、scripts/workbench/、hooks.json、agents/、scripts/*.py | 安装、CLI、本地后端、客户端同步、宿主适配与 hooks |
| .github/、tests/、docs/ | 本仓库构建、验证、发布与工程说明 |

Cloud 维护 scripts/cloud/、plugins/slack/、deploy/ 与云端专有设计；其中 scripts/shared/ 与 prototype/ 是固定 Skill 包生成的消费副本，不是源码。

修改共享内容先改 Skill 并发布明确版本，Cloud 再更新依赖与锁文件。不得双向复制或形成运行时依赖环。两个仓库均保留独立测试、安全检查和 Required。

.codex/、环境配置、运行数据、output/、temp/ 与 node_modules/ 不进入 Git 或公开制品。既有工作树、私有数据和恢复回执不属于本次源码迁移的删除目标。

宣传站仍在 website 分支，见 [宣传站说明](website.md)。
