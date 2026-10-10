# Skill 与 Cloud 各自负责什么

| 仓库 | 唯一维护的源码 |
| --- | --- |
| Skill | Map、共享协议、工作台 UI、角色与通用资料、CLI、hooks、本地后端及客户端接入 |
| Cloud | 云端托管、账号权限、多设备服务、云端模型、Slack 与部署配置 |

共享功能改 Skill 并发布 core / workbench 包；Cloud 固定版本消费，更新依赖与锁文件后再构建。Cloud 的 `scripts/shared/` 与 `prototype/` 是生成副本，不手改、不维护第二份源码。

UI 部署在 Cloud 不改变源码归属；Skill 可独立安装运行。Cloud 生产服务不加载 Skill 安装器、hooks 或本地服务，仅集成测试可使用固定 Skill fixture。云端专有文档留在 Cloud。

迁移不改变权限、数据权威或协议版本。旧包不可覆盖，回退使用记录的提交、固定依赖与校验值，不删除用户数据。发布、部署与验收按 [RULE](../RULE.md) 分别核实；门禁失败不能宣称完成。
