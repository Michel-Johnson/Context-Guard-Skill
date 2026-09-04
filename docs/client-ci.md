# 三客户端无对话 CI

本文描述不调用模型、可重复运行的日常兼容性检查。需要真实模型对话和测试凭据的补充验收保持为独立的手动 workflow，见 [`real-client-acceptance.md`](real-client-acceptance.md)；两者的“通过”含义不同。

这个工作流不需要 AI API Key，不发送模型对话，不读取个人账号，也不代表完整客户端端到端验收。

## 测什么

| 客户端 | 真实客户端检查 | 明确未覆盖 |
| --- | --- | --- |
| Codex | App Server 的 `skills/list` 和 `hooks/list` 识别安装后的 Skill 与 11 个生命周期 Hook；移走 Skill 或删掉 SessionStart 后检查必须失败，恢复后通过 | Hook 实际执行及上下文送达：非托管 Hook 仍需用户信任，测试不绕过 |
| Claude Code | `claude --init-only` 真正触发 SessionStart；未绑定时只留下注册证据且不初始化项目；去掉 Hook 后不再产生注册证据 | AI 询问并确认工作台绑定、UserPromptSubmit 和对话 Stop 的客户端触发 |
| Cursor | 真实 `agent acp` 握手、安装文件和配置合同；确认未登录创建 Session 返回认证要求 | 客户端发现 Skill、原生 SessionStart/UserPromptSubmit/Stop：需要登录；握手通过不等于这些功能通过 |

三家的消息记录、语言提示与保存、bad case 落盘等确定性逻辑，继续由原有 `tests/ci-smoke.mjs` 的模拟事件测试验证。模拟事件不冒充真实客户端事件；AI 的语义判断和实际回复不在本轮验收内。
Claude 的无对话检查只验证真实 SessionStart 产生“需要绑定”的注册证据且不建图、不启动服务；用户确认绑定并以同一 Session ID 继续的链路由打包冒烟和浏览器测试覆盖。

## 在哪里运行

- 原有 `.github/workflows/ci.yml` 继续在 Ubuntu、Windows、macOS 运行基础测试。
- 新增 `.github/workflows/client-compatibility.yml` 在 GitHub-hosted Ubuntu 运行三个独立客户端任务。
- 推送 `main`/`codex/CI`、向 `main` 提交 PR 或手动运行触发新工作流。
- 三个任务消费同一个经过 SHA-256 校验的 npm tarball，不发布 npm。
- 客户端版本固定在 `.github/client-versions.json`；升级需要重新验证接口和认证边界。
- 不设置 Secrets 或专用凭证环境；仓库权限为只读，不继承个人 HOME、客户端配置、环境凭证或 Node 注入选项。
- `Client checks (no dialogue)` 只汇总本表的覆盖范围；任何必需检查失败或任务跳过都会失败。现有 `Required` 保护规则不变。
- 工具仅安装到测试目录，不使用全局安装器，不更改用户 PATH。Cursor 使用官方固定版本下载包及其原有 Node 入口。
- 成功清理测试项目和客户端临时配置；失败保留本地临时目录。GitHub 仅上传 `report.json`、`summary.md` 和失败时的命令错误，不上传客户端 HOME 或认证目录。

## 本地复现

需要 Node 22+、Python 3。基础 CI 仍支持项目声明的 Node 18；安装新版客户端仅要求测试机器 Node 22+。

```sh
npm test
node .github/scripts/install-ci-client.mjs codex output/client-tools/codex
npm run test:clients -- --client codex --tools output/client-tools/codex --evidence output/client-results/codex
```

分别将 `codex` 换成 `claude` 和 `cursor`。可加 `--tarball <文件>` 检查指定包；省略时从当前代码打包。不需要复制个人登录目录。

`npm test` 包括测试驱动自身的故障检测测试，但只有 `test:clients` 才启动真实客户端。报告中的 `boundaries` 必须与绿色结果一起阅读。

## 官方依据

- [OpenAI Docs：App Server](https://learn.chatgpt.com/docs/app-server)：发现查询与生成请求分离。
- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)：`--init-only` 执行 Setup/SessionStart 后退出，不开始对话。
- [Claude Hook 测试说明](https://code.claude.com/docs/en/hooks-guide)：直接输入 JSON 测试命令 Hook。
- [Cursor ACP](https://cursor.com/docs/cli/acp)：初始化、认证、创建 Session 和发送 Prompt 是不同步骤。
- [Cursor 安装](https://cursor.com/docs/cli/installation)：官方客户端分发入口。
