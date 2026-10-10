# 托管 Claude CLI 接收器

CLAUDE_CONFIG_DIR 优先，CLAUDE_HOME 旧兼容。Executor/CI 私有配置和真实 Session 分开，共用设备/项目后端，不在 Hook 新设心跳。

## Cloud 创建的 Executor Session

须操作者私有 allowSessionCreation:true 与 Cloud coordinator.sessionTemplates 中模板 ID 同时启用，不绕权限、不装入 Codex。人选模板/名称，Cloud 存 UUID/请求，经现有心跳传输；后端从注册 Main 建独立 worktree 和只含已安装 Skill/审核设置的私有配置，不拷旧聊天。

只有原生启动绑定记 registered，非在线/任务成功。准备失败持久报告到确认。新 Executor 复用独立串行 CI 接收器，每次权限固定真实 Session/精确 SHA；Cloud 核创建关系/设备/worktree，撤模板撤继承委派，创建非派单。

## 配置现有接收器

真实启动 Hook/绑定后，本机操作者执行：

```sh
context-guard workbench claude --root <worktree> --session <uuid> --input <private-runtime.json>
```

输入绝对 command/root/configDir/environmentFile，可选 args/name/model/role(executor|ci)，既有对话须 resumeExisting:true，systemPromptFile 指已安装角色。role 非 Cloud CI/Coordinator 权限。

CI 另 executorSessionId/精确 ciCommands、独立 worktree；Cloud 私有 ciReceivers[ciSessionId]={executorSessionId,worktreeId}，请求字段不授委派。ci.request 仅干净树检准确 SHA；map ci context 返回逻辑 Executor/任务/SHA/不可变版本/允许命令，map ci exchange --input - 保留正常 JSON，不改原生 CI 身份。

仅 object.read、证据 object.put（ci:`<ciSessionId>`:）及任务/SHA ci.result；HEAD 变/脏树禁结果。无 Plan Hook 仅允许测试白名单，不写业务/开发 Plan。

## 已审核的 Executor 任务

map task plan --input `<file>` 用 {operationId,content:{paths,steps}} 固定实际 HEAD、请求 Coordinator 批指定任务/Plan版本/SHA。未知结果原 ID，修订新 ID；map execution 的 taskId/planRef/planVersion 加到正常 plan-start。

提交后 map task handoff --input `<file>` 用 {operationId,ciTodo:{items:[...]},unitTests:[...],experiences:[...]}，经验可空、证据真实；干净树、不可变对象/准确 SHA，不报 CI、人验或合并。Plan 保持活动，Tester/人审后归档结束，Coordinator 消费原日志；模型失败暂停到明确重试。

environmentFile 仅必需 ANTHROPIC_* 及可选 CLAUDE_CODE_SUBAGENT_MODEL/CLAUDE_CODE_ATTRIBUTION_HEADER，秘密不入 argv/提示/日志/Map。bypassPermissions 只在 isolated:true 接受，操作者实际提供隔离，标记不造沙箱。

Cloud 排序，原生每 Session 一轮，忙则 inbox；已接受投递持久，后端重启恢复确认不重启提示，worker 可存活但不另心跳。timeoutMs 限静默，maxTurnMs 限整轮（默认30分钟），超时保中断供同会话恢复，非任务完成。

既有安装含启动/工具/停止及失败/权限/压缩前后/SessionEnd，非决策事件只记状态；[原生约定](https://code.claude.com/docs/en/hooks)。信号只取 plan-status.pending_signals，不推生命周期 ID。

未知/中断不自动重跑、不删意图；生命周期与 CI 委派验收前不报完整支持。本机操作者经用户明确继续，可 workbench claude --recover --root `<worktree>` --session `<uuid>` --input `<private-json>`，输入 {operationId,deliveryId,message} 固定原投递/继续内容。两个旧进程须已退出，存活或未知不杀；保原记录，同 Session 续执行，未知结果原 ID/内容，权限/Plan/CI 不变，不新增恢复循环或重复已完成工作。
