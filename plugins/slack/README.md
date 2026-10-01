# Slack 插件

独立 Node 服务，通过 Socket Mode 连接 Jerry Family 的 Slack；只调用 Cloud 的本机插件网关。Cloud 不加载 Slack SDK，停止本服务不会停止 Coordinator。使用普通消息、Block Kit、Home 和文件 API，适用于免费工作区，不依赖 Lists 或付费 Assistant API。

## 安装

要求 Node >= 22.19.0、npm >= 9.6.4。在插件目录执行 `npm ci --ignore-scripts`；依赖和 lockfile 与根包分开，下载地址固定为 npm 官方仓库。用 `app-manifest.json` 创建自建 Slack App，打开 Socket Mode，生成带 `connections:write` 的 App-level token，并将 App 安装到 Jerry Family。机器人只响应它能访问的频道，请把它邀请到使用的频道。

复制 `.env.example` 的字段到 **checkout 外**的私有 EnvironmentFile，文件权限设为 0600；配置 bot token、app token、独立插件网关 token、Cloud origin 和独立状态目录。不要把凭据填入仓库模板。先启用 Cloud 的可选 loopback 网关，再执行 `npm start`。

`deploy/context-guard-slack.service` 是 system service，沿用 `context-guard` 账号：源码位于 `/opt/context-guard-cloud/repository/plugins/slack`，独立 Node 22 runtime 位于 `/opt/context-guard-slack/runtime/bin/node`；私有配置位于 `/etc/context-guard-slack.env`，状态位于 `/var/lib/context-guard-slack`，均在 checkout 外。源码或 runtime 路径不同的安装需要修改 unit。服务与 Cloud 分别启动、停止、备份和恢复。

## 使用

- App Home：选择项目，查看节点 ID、TODO/Bug 与已有 Session 的公开状态，创建或编辑事项和节点 `memory.md`。
- 私聊：先在 Home 选择项目，每条顶层消息建立独立线程；线程内连续回复复用同一 Cloud 对话。
- 频道：用 `/cg` 关联频道和项目，再 `@Coordinator` 开始线程；已关联线程的回复不用重复 @。`/cg ask <问题>` 也可开始新线程。
- 关联已有 Cloud 对话：在关联表单填写项目、频道 ID、线程的 Slack 时间戳、Cloud 对话 ID。已有自动执行工作必须先结束；已关联线程不能切换项目或对话。
- 快捷操作：全局或消息菜单创建 TODO/Bug；问题可用选项或自由回答；brief 可确认或退回；确认后从卡片导出执行提示文件。
- 文本或截图附件：支持单份 UTF-8 文本（256 KiB）及 PNG/JPEG/WebP；每条消息最多六份附件，**图片合计上限 5 MiB**。完整消息在插件中先校验，再把附件存到受保护的 Cloud 附件存储，模型只接收授权引用。
- Map 链接：只预览配置中的 Cloud origin、当前关联项目；通知仅发到明确关联的线程。Slack 原始用户消息不会再反向复制回同一线程。

事项和记忆表单遵守 Main 的版本校验；冲突会报错，并保留服务器端插件草稿，不覆盖新版本。Slack 表单正文最多 2900 字符；更长的现有记忆/事项必须在工作台编辑，插件不会静默截断。

## 可靠性与边界

每个 envelope 写入独立私有状态文件并 fsync 后才 ack；Socket 重投、BUSY 和重启沿用同一业务操作 ID。交互事件走快速处理通道，避免等待模型或附件下载导致 modal trigger 过期。线程、频道、用户选择、表单草稿、消息镜像和出站回执均保存在 `state.json`；同一目录只允许一个进程。

每个频道写消息/更新至少间隔一秒。429 遵守 Retry-After，单次最多重试两次；暂时失败退避，最多八次后进入 attention 状态。发送结果不明时通过自己机器人的 metadata 或导出文件的唯一文件名核对线程历史；无法确认则保留不确定状态，不盲目补发。Slack 删除/编辑事件、机器人消息、reaction 不作为需求或审批。

执行提示导出使用与 SDK `filesUploadV2` 相同的三阶段官方 API，并独立保存 file ID 与进度。申请 URL、上传字节和完成共享的 429 均有界处理 Retry-After；已知拒绝与结果不明分别记录。完成共享的结果不明或进程中断后，只在原线程核对同一 file ID/唯一文件名，不再次分配或发布新文件。

停用时用 `sudo systemctl stop context-guard-slack.service`，只关闭 Socket 和插件进程；恢复时启动同一 unit 并保留私有状态目录。备份必须包含 `state.json`，不得用空目录替换已有回执。attention/unknown 条目需要在工作区按原线程、操作 ID 核对；核对前不删回执或重新发送同一需求。应用凭据与日志不参与 Map、Git 或 npm 分发，启动错误日志只输出错误代码，不输出响应正文。

Slack 免费版的历史保留与应用数量有限，长期项目记录在 Map 和 Cloud。此插件不启动 Executor、Tester、worktree 或自动派发；人工 brief 确认只写 Main 事项并生成粘贴提示。更多节点和超长内容可通过 Home 的完整 Map 链接查看。

## 验证

执行 `npm test`：覆盖持久 ack、重投、私聊/频道独立线程、原任务 ID、CAS 冲突、人工 brief、附件、消息镜像、流式转最终回复、限流和未知发送核对。测试使用假的 gateway 和 Slack Web API，不是已安装工作区的真实验收。

真实验收需完成 App 安装、token 配置、Cloud 网关部署，并在 Slack 中检查 Home、两端线程接续、事项/brief/提示、图片轮次和服务重启。保持本服务停用时，工作台正常运行也需实测。

官方资料：[Socket Mode](https://docs.slack.dev/tools/node-slack-sdk/socket-mode/)、[消息 metadata](https://docs.slack.dev/reference/methods/chat.postMessage/)、[文件上传](https://docs.slack.dev/reference/methods/files.getUploadURLExternal/)。
