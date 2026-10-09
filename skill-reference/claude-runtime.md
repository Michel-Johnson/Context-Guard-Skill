# 托管 Claude CLI 接收器

Claude 使用 `CLAUDE_CONFIG_DIR` 存放设置和已安装 Skill，安装器优先读取此变量，再以 `CLAUDE_HOME` 作旧兼容备用。Executor 与 CI 配置及真实 Session ID 必须分开；共用项目后端与设备心跳服务，不在每个 Hook 中设定时器。

## Cloud 创建的 Executor Session

操作者可在私有运行配置设置 `allowSessionCreation:true`，允许现有 Executor 接收器创建 Session；Cloud 还须把该接收器 Session ID 列入项目 `coordinator.sessionTemplates`。两项同时启用才有效，不启用权限绕过，也不向 Codex 配置安装内容。

人从“Coordinator → 新建执行会话”选择模板并命名。Cloud 保存请求和生成 UUID，由已有设备心跳传输。后端从注册 Main 引用创建独立 Git worktree 和私有 Claude 配置，只含模板已安装 Skill 及已审核设置，不复制旧聊天。

只有原生启动绑定会将请求改为 `registered`，此状态不证明任务执行或当前在线。准备失败通过同一心跳报告，持久重试直到确认。

新 Executor 使用模板已有的独立 CI 接收器，接收器保持串行。每次交接和 CI 能力仍指定真实 Executor Session 和精确 SHA。Cloud 校验持久创建关系及当前设备 / worktree 绑定；撤销模板启用就撤销继承委派。创建 Session 不会自动分配任务。

## 配置现有接收器

真实 Claude Session 已发出原生启动 Hook 并绑定项目后，本机操作者可配置接收器：

```sh
context-guard workbench claude --root <worktree> --session <uuid> --input <private-runtime.json>
```

私有输入含绝对 `command`、`root`、`configDir`、`environmentFile` 路径，可选命令前缀 `args`，及 `name`、`model`、`role`（`executor` 或 `ci`）。原生 Session 已有持久对话时必须 `resumeExisting:true`。`systemPromptFile` 指向已安装角色提示。role 只标识本机运行器，不授予 Cloud CI 或 Coordinator 能力。

CI 还需配置 `executorSessionId` 与精确 `ciCommands` 白名单，例如 `npm test`、`npm run build`。CI 与 Executor worktree 不同。Cloud 私有 Coordinator 配置须声明 `ciReceivers[ciSessionId] = {executorSessionId, worktreeId}`，请求体字段或本地角色标签不能授予权限。后端复用设备登录和持久传输，不再启心跳。

`ci.request` 时，仅在干净 CI worktree 检出交接 SHA。`map ci context` 返回逻辑 Executor Session、任务、精确 SHA、不可变引用版本和允许命令。`map ci exchange --input -` 接受正常协议 JSON；后端提供逻辑 Session，不改原生 CI Session 身份。

只允许 `object.read`、证据用途 `object.put`（引用前缀 `ci:<ciSessionId>:`）及对应任务 / SHA 的 `ci.result`。HEAD 变化或工作树脏时禁止结果。无 Plan 时 CI Hook 只允许配置的测试命令；业务源码写入与开发 Plan 仍禁止。

## 已审核的 Executor 任务

`map task plan --input <file>` 接受 `{operationId,content:{paths,steps}}`，在实际 HEAD 记录不可变 Plan 并请求 Coordinator 审核。响应不明保留操作 ID，修订 Plan 用新 ID。批准指定精确任务、Plan 版本与源码 SHA；读取 `map execution`，将其 `taskId`、`planRef`、`planVersion` 加到正常 `plan-start` 输入。

提交交付源码后，`map task handoff --input <file>` 接受 `{operationId,ciTodo:{items:[...]},unitTests:[...],experiences:[...]}`。测试证据描述真实运行，无可复用经验时 experiences 可空。命令拒绝脏工作树，保存不可变对象，并带精确提交 SHA 报引用；不宣称 CI 成功、人工验收或合并。

交接期间本地 Plan 保持活动，先交接再由 Tester / 人验收；人工审核后才归档和 `plan-finish`。Coordinator 消费已有协议日志获取 brief 决定、Plan 提交、CI 结果；模型失败保持暂停，直到明确重试。

`environmentFile` 是私有 JSON，只含必需 `ANTHROPIC_*` 供应商字段及可选 `CLAUDE_CODE_SUBAGENT_MODEL`、`CLAUDE_CODE_ATTRIBUTION_HEADER`。凭据不进入运行参数、提示、日志或 Map。`permissionMode:"bypassPermissions"` 仅在 `isolated:true` 时接受，操作者须真实提供隔离执行环境；标记本身不安装或创建沙箱。

任务排序仍由 Cloud 负责。本机接收器每 Session 仅允许一个原生轮次；繁忙时下一通知留已有 inbox。已接受调用有持久身份；本地后端重启可从保存意图恢复丢失确认，不重复启动提示。原生工作进程可跨后端重启存活，不拥有另一个心跳服务。

`timeoutMs` 限制静默，`maxTurnMs` 限制整个原生轮次，默认 30 分钟。任一超时都保留中断投递，供同 Session 恢复，不能把时间流逝当任务完成。

Claude 安装器除启动、工具、停止事件外，还安装失败、权限、压缩前后、SessionEnd Hook。非决策事件只记状态，不重启模型生成。原生约定见 [Claude Hook 文档](https://code.claude.com/docs/en/hooks)。信号 ID 从 `plan-status.pending_signals` 读取，不从生命周期事件 ID 推断。

中断或结果不明的原生轮次保持可见，不自动重执行，不删除保存意图重试。受控恢复及 CI 委派验证前，不能宣称完整生命周期支持。原生轮次结束不等于任务成功、人工验收、GitHub 合并或归档。

用户明确要求继续中断轮次时，本机操作者可执行 `workbench claude --recover --root <worktree> --session <uuid> --input
<private-json>`。输入 `{operationId,deliveryId,message}` 指定精确中断投递及继续内容。两个旧进程都须已退出；恢复不杀死存活或状态不明进程。

保留原记录，新持久续执行恢复同一原生 Session。响应不明复用同 ID 和内容。原有任务、Plan、CI 权限仍适用；不视为批准，也不授权重复已完成工作。不新增后台恢复循环。
