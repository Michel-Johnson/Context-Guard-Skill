# 三个真实客户端对话验收

`.github/workflows/real-client-acceptance.yml` 是一套独立、手动触发的验收，不替代日常 CI。它会消耗模型额度并使用测试凭据，因此不会在 push、PR、定时任务或 `pull_request_target` 上自动运行，也不会自动加入 `Required` 合并门禁。

## 验收范围

三个并行 Ubuntu Job 分别运行真实的 Codex、Cursor 和 Claude CLI。它们安装同一个经过内容契约、安全扫描和 SHA-256 校验的 npm tarball，然后完成四轮真实会话：

1. 首次进入空项目，确认 Hook 初始化上下文且助手询问中文或 English，而不是擅自推断。
2. 恢复同一原生会话并选择中文，确认语言持久化。
3. 新建会话，确认旧会话仍存在、语言不重复询问、工作台进程被复用。
4. 报告一个明确问题，确认 bug 卡、索引和地图关联真正落盘。

每轮还检查原生 session ID、`session-start` / `user-prompt-submit` / `stop` 事件、用户消息标记、工作台 HTTP 健康状态和正确项目根目录。模型声称“成功”不能让测试通过，所有结论来自文件或进程状态。

Codex 使用提交 SHA 固定的官方 `openai/codex-action` 隔离 API Key。Cursor 与 Claude 复用仓库现有的锁定版本安装器。测试仅在 GitHub-hosted Ubuntu 的一次性环境运行，本机执行 `npm run test:real-clients` 会主动拒绝。

## 一次性配置和运行

在 GitHub 仓库创建名为 `skill-client-tests` 的 Environment，并在其中配置：

- `OPENAI_API_KEY`
- `CURSOR_API_KEY`
- `ANTHROPIC_API_KEY`

可选变量 `CODEX_CI_MODEL`、`CURSOR_CI_MODEL`、`CLAUDE_CI_MODEL` 用于指定测试模型。不要把凭据写入仓库、普通 Actions 变量或聊天记录。

在 Actions 中选择 **验收 | 三个真实客户端对话**，选择已经审核的分支后点击 **Run workflow**。查看 `真实对话 | codex/cursor/claude` 三个 Job；只有三者和打包 Job 全部成功，`真实客户端验收结果` 才会通过。

失败时，每个客户端只上传白名单内且已脱敏的 JSONL、stderr、阶段报告、会话和 bug 证据，保留 3 天。客户端 HOME、认证文件、环境变量、npm cache 和 `.codex/context/private` 不会上传。首次在 GitHub 上实际跑通前，只能说验收工具已构建，不能声称三个真实客户端已通过。
