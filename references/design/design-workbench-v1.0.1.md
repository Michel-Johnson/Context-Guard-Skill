# 项目命名的本机工作台

文档版本：v1.0.1。

`context-guard workbench --root /path/to/project` 输出 HTTP URL，例如 `http://my-project.localhost:1355/prototype/workbench.html`；SessionStart 使用同一入口。无需全局安装 Portless、修改 DNS、安装证书、管理员权限或额外 npm 运行依赖。

名称来自 Map 项目名，规范为小写 DNS 字母、数字和连字符（`Context_Guard` 变为 `context-guard`）。全为非 ASCII 的名称采用稳定 `project-<id>` 备用名。可显式设置易读名称：

```sh
context-guard workbench --root /path/to/project --name my-project
```

不同项目不能占用同一已注册名称，即使原后端已停止；应换名，命令不会杀死另一项目。运行路由是私有本地状态，不是项目记忆，也不应提交。

## 多 Session 与 worktree

关联 Git worktree 共用项目服务。绑定以真实 Session ID 为键，不以分支为键；同分支两个 Session 仍独立。项目已有工作台时，新未绑定 Session 自动复用唯一匹配的注册实例。仅首次建立、候选歧义或不匹配、明确迁移已有绑定 Session 时要求人确认。旧服务目标绑定命令仍可用：

```sh
context-guard workbench bind --root /path/to/second-worktree --project-root /path/to/map-worktree
```

两个路径必须有相同本地 Git 公共目录；无关克隆、同名文件夹、不同仓库不能静默合并，禁止绑定链。先保存第二 worktree 草稿并停止其服务。目标 Map 必须已存在，命令不创建 Map。

第二 worktree 已有 Map 时，除非明确给出 `--keep-local`，否则绑定失败。该参数只原样保留文件，不合并或删除数据，也不授权 Session 绑定。

目标只决定服务；Python 生命周期记录留在源 worktree，服务按 Session / worktree 身份隔离 Map，旧记录不迁移到目标。首次使用或歧义 Hook 询问确认，不猜服务或开浏览器；唯一已有绑定自动复用。所有会话视图仍是只读已发布 main 基线，不是目标 worktree 未合并 Map。私有记忆部署及发布边界见 `design-memory-server-v1.0.1.md`。

命名入口和项目身份保存在 Git 公共目录。用户私有全局注册表 `~/.context-guard/named-workbench/projects.json` 记录已有本地项目、已知 worktree 根目录及规范 URL；位于可替换 Skill 目录之外，重装或升级不清除绑定或新增工作台。从另一关联 worktree 重启后端仍保留项目 URL。

用 `context-guard workbench --list --root /path/to/current/project` 查看已知项目，不启停服务。历史注册不等于存活：命令探测后端和路由，纳入仅有路由的旧实例，跨 worktree 去重，分别返回 `registeredCount`、`runningCount`、`readyCount`、`stoppedCount`、`attentionCount`。

项目项展示易读名称、规范 URL 和状态（`ready`、`direct-only`、`legacy`、`duplicate`、`route-stale`、`route-mismatch`、`stopped`、`unknown`），不向用户展示 Session、Git 或实例标识。`unknown` 指记录的所有者仍存活但未响应限时探测，不可视为已停止或自动替换。

请求打开页面时，由后端原子领取打开权。现有活动页面会抑制重复打开；并行首次启动共享 5 秒打开窗口，因此浏览器启动失败也可能延迟 5 秒再试。显式 CLI 仍输出 URL 供手动打开。无界面、CI、恢复或压缩 Hook 不开浏览器；SessionStart 校验绑定并注入 URL，不自动再开页面。

## 进程生命周期与兼容

多个项目共用一个仅回环监听的 HTTP 代理，与后端独立。关闭一个项目不关闭代理或其他项目。代理不轮询目录，不处理证书，不暴露局域网或隧道。SSE 流式传输；明确不支持 WebSocket。

默认代理端口 1355。若被其他应用（含完整 Portless）占用，在随后 20 个端口选空闲端口并返回实际 URL，不接管原监听器；URL 仍带端口。代理或后端崩溃在下次 `workbench` / SessionStart 调用恢复，不设持续轮询监督进程。意外退出后重跑；仍存活但不健康的所有者明确报错，不强杀。

每次转发在发送能力凭据前校验后端实例身份，并检查 Host、Origin 和转发凭据；Agent 授权和跨项目 Token 隔离仍有效。这是本机单用户保护，不防具有该用户全部文件权限的其他进程。

识别出的旧后端或命名代理，在下一次绑定生命周期或 `workbench` 命令原位升级。代理保留路由存储，替换前须确认经过认证的停止。旧后端须先确认同步屏障并释放项目锁，否则返回 `UPGRADE_PENDING`，不启动替代实例。未知旧运行时及重复所有者仍须明确诊断或迁移。浏览器恢复存储保持稳定项目来源，正常兼容升级不改变存储边界。

- `CONTEXT_GUARD_NAMED_WORKBENCH=0` 或 `--direct`：使用旧回环直连 URL。
- `CONTEXT_GUARD_NAMED_STATE_DIR`：隔离私有代理状态目录，默认 `~/.context-guard/named-workbench`；不得跨操作系统用户共享。
- `CONTEXT_GUARD_NAMED_PORT`：首选代理端口，默认 1355。

## 来源与测试范围

精简路由存储派生自 Apache-2.0 许可的 Portless 0.15.6。`THIRD_PARTY_NOTICES.md` 和 `licenses/Portless-Apache-2.0.txt` 随 npm 包及 Skill 分发。代理与适配器是 Context Guard 自有实现，不是内置完整 Portless CLI。

`tests/named-workbench.test.mjs` 属于 `npm test`，覆盖授权、Origin / Host、读写、五个 Session / SSE 流、打开权领取、名称冲突、后端身份 / 端口复用、代理重启、多项目隔离、损坏路由、并发启动、隔离测试注册表、持久全局注册表、已识别后端 / 代理升级、旧路由修复、显式 Git worktree 绑定以及真实 Python SessionStart 处理器。不能据此证明每种桌面宿主、操作系统或浏览器都已完成投递验证。剩余覆盖记录在 `CI_todo.md`。
