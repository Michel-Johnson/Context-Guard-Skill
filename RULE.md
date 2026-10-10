# RULE.md

Context Guard 仓库开发规范，适用于各平台的仓库开发 Agent。与其他仓库文档冲突时以本文为准，并在交付中说明；产品角色权限仍按产品契约，不由仓库身份取得。

## 1. 全程底线

- 文档统一中文，代码、命令、路径和协议标识保留原值；第三方许可保留原文并附中文说明。同一规范只维护一份，不复制英文版或角色版。
- 整个 `.codex/`、凭据、`.env`、真实 dump 不进入任何 GitHub 分支、附件、CI 产物或 npm/Skill 包，不通过改名绕过。公开摘要不含私有记忆，不绕过密钥扫描。
- 有 Cloud 以 Cloud Map 为准，无 Cloud 以本地 Map 为准；本仓库选用私有 Cloud。按需读取，正文见 [撰写规范](skill-reference/design/design-memory-definition-v0.2.0.md)，格式见 [fs-v2.1](skill-reference/design/design-memory-filesystem-v1.0.1.md)。
- 开发笔记由归档工具写本地 `sessions/<会话标识>.md`，路径以返回值为准，记录摘要、决策、改动、验证和后续事项，见 [模板](skill-reference/formats/session-record.md)。不追加 Map 记忆，不上传 Cloud；Cloud 读取、收工检查和 Main 审核发布保留。
- Coordinator 是 Main 结构唯一非人写入者；白名单 developer 不例外，仓库开发 Agent 只写自己的 Session。
- 服务器连接信息只存未跟踪配置；本仓库以 `.codex/context/private/memory-server.md` 交接。不把规范获批、源码存在或测试通过说成已部署、已读服务器。

## 2. 任务准备

- 先读 [当前开发方向](development-docs/current-focus.md)；历史待办不授权恢复暂缓功能，既有安全门禁和必要回归保留。
- 开工用 `map read --context` 取轻量导航、项目说明：有 Cloud 从 Cloud 取，无 Cloud 从本地取，不复制完整 Map。用 `--node` 按需读；旧 FIND / snapshot 仅迁移或恢复使用。
- 核 [源码归属](development-docs/repository-boundaries.md)：共享核心/UI 改 Skill，云端专有改 Cloud，不修改消费生成物。
- 按 [开发流程](development-docs/engineering/README.md) 准备、实现、验证、Review 和交付；风险等级不降低安全、测试或合并要求。
- 用户明确要求开发、修复、执行或合并，授权该任务及正常交付，不重复索要确认。范围不明、设计文档创建、破坏性操作或新外部权限另行确认；修改设计先确认方案，未批准草案标“未生效”。
- 仓库授权不替代产品 Coordinator 的人审和收工协议。
- 拉取最新 main 后在自己的 `codex/…`、`cursor/…` 等平台分支开发；同主题允许多平台并行。

## 3. 实现

- 已读内容用缓存；新模块或明确刷新时查询对应 Cloud / 本地来源。未实现功能、需求和阻塞交 Coordinator。
- 创建设计文档（含草案、新版本）前，单独确认主题、用途、范围；开发批准不等于建文档批准。
- 设计在 `skill-reference/design/`，入口 [设计目录](skill-reference/design/README.md)，命名 `design-主题-vX.Y.Z.md`，主题为英文小写连字符，正文版本一致。main 每主题仅当前版，历史查 Git；导航、运行和部署指南保留入口。
- X 表示不兼容重大变更，Y 表示兼容功能新增，Z 表示兼容修复。
- 临时测试、脚本和草稿只放根 `temp/`，写入 `.gitignore`，不上传或冒充正式测试。
- 源码、产品文档、正式测试及已批准 CI/CD 通过下述 PR 流程进入 main。

## 4. 验证

- Executor 交付前 `map context-check` 对比最新 Cloud / 本地 Map；有变化再读差异，处理重查，需求/设计冲突交 Coordinator。
- 已配置 Cloud 但断连仍属 Cloud 模式；缓存可继续开发，收工报告“无法检查”，不拿本地结果代替 Cloud。hash 不代替测试、审核和发布。
- 真实消息只在指定测试频道验证，不在正常工作频道测试。
- `CI_todo.md` 只记录已实现模块的测试缺口，不记需求；缺文件则创建。验收通过立即删除条目，准确版本、入口和结果留 Git / PR，同时清理自有成功测试临时文件。正式测试、未完成实验和失败证据保留，临时草稿不能作删除待验收项的依据。

## 5. 提交与合并

- 禁止直推 main，所有变更经 PR；一个 PR 一个意图，未就绪保持 Draft。
- 开工、收工检查 Draft 并提醒用户；需推进的及时同步 main、通过检查后合并，不长期落后。人确认需求作废后关闭 PR，清理对应分支。
- 合并前同步最新 main，在自己的分支解决冲突，不改其他平台 PR。
- PR 写实际测试与 CI_todo 缺口；安全和 selector 必跑，Required 核所选检查。检查不通过不得合并；未知路径或 CI/治理规则变更全跑，main 与标签始终完整 CI。
- PR 合入后清理对应远程分支，以及本任务无用的本地分支、worktree、临时文件和测试消息；保留未合入修改、待验收资源、未完成实验和失败证据，不动其他任务。
- 删除先核精确目标与授权；不确定就保留并说明，不递归删除共享 temp，清理后项目仍可运行。测试线程删全部提问与回复，不只主消息，非测试线程不动。

## 6. 交付与收口

合入 main 不等于交付，依次执行：

1. 核最新 `origin/main` 包含本次提交，安装/构建从这份源码进行，不用旧分支、worktree 或缓存冒充。
2. 核验对象版本及真实入口：
   - Skill 分发/本机运行：更新本机 Skill，运行 `context-guard doctor` 和安装入口验收。
   - 仅 Cloud：验云端服务及受影响功能，不要求本机更新。
   - 共享核心/UI：验 Skill 包及 Cloud 固定消费；影响本机/分发时也验安装。
3. 汇报合并提交、来源、版本一致性和真实结果。
4. 必需验收全部通过才按任务协议归档、`plan-finish`；此前进行中，失败或未完成不报交付成功。

纯仓库文档只有确认不影响分发/运行才可记安装、运行 N/A，并说明依据；仍核适用性及 Required。治理修改还须审行为影响，不豁免产品验收或归档。

本阶段客户端验收仅 Claude Code CLI / Cursor，Codex Hook 后续再做；任何宿主 Hook 信任不可绕过。服务器仅保留最近 5 份完整可恢复备份，核保留备份后立即删除更早备份。
