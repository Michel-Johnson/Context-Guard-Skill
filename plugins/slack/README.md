# Slack 插件

独立 Node 服务，通过 Socket Mode 连接 Jerry Family 的 Slack；只调用 Cloud 的本机插件网关。Cloud 不加载 Slack SDK，停止本服务不会停止 Coordinator。使用普通消息、Block Kit、Home 和文件 API，适用于免费工作区，不依赖 Lists 或付费 Assistant API。

## 安装

要求 Node >= 22.19.0、npm >= 9.6.4。在插件目录执行 `npm ci --ignore-scripts`；依赖和 lockfile 与根包分开，下载地址固定为 npm 官方仓库。用 `app-manifest.json` 创建自建 Slack App，打开 Socket Mode，生成带 `connections:write` 的 App-level token，并将 App 安装到 Jerry Family。机器人只响应它能访问的频道，请把它邀请到使用的频道。

复制 `.env.example` 的字段到 **checkout 外**的私有 EnvironmentFile，文件权限设为 0600；配置 bot token、app token、独立插件网关 token、Cloud origin 和独立状态目录。不要把凭据填入仓库模板。先启用 Cloud 的可选 loopback 网关，再执行 `npm start`。

`deploy/context-guard-slack.service` 是 system service，沿用 `context-guard` 账号：源码位于 `/opt/context-guard-cloud/repository/plugins/slack`，独立 Node 22 runtime 位于 `/opt/context-guard-slack/runtime/bin/node`；私有配置位于 `/etc/context-guard-slack.env`，状态位于 `/var/lib/context-guard-slack`，均在 checkout 外。源码或 runtime 路径不同的安装需要修改 unit。服务与 Cloud 分别启动、停止、备份和恢复。

## 使用

- App Home：选择项目，查看 Map、TODO/Bug 与已有 Session 状态；点击事项、TODO/Bug 或记忆入口，直接开始 Coordinator 对话，不填节点 ID、标题或状态。
- 私聊：直接说需求；未关联时在原消息选择项目。每条顶层消息建立独立线程，线程内连续回复复用同一 Cloud 对话。
- 首次私聊或明确 `@Coordinator`：未关联时直接显示开放项目按钮，选择后继续原问题，无需先寻找 Home 或记住命令。频道选择会关联当前频道；只能由原提问者在原消息选择，旧选项不会覆盖后来的关联。没有开放项目时明确说明配置缺失。
- 频道：也可用 `/cg` 开始讨论，未关联时直接选择项目。未 @ 的消息先按项目概览及有限线程上下文判断，需要 Coordinator 参与才回复，闲聊或明确问别人时保持安静；已有线程也会判断。明确 `@Coordinator` 或 `/cg ask <问题>` 可直接开始线程。
- Slack 线程首次建立后固定项目及 Cloud 对话，工作台可继续同一对话。公开入口不再要求手填已有 Cloud 对话 ID；升级前的关联草稿仍可按原校验提交，不改已有线程绑定。
- 快捷操作：全局或消息菜单进入 TODO/Bug 讨论，不直接写 Map。提问与修改意见直接在线程回复；brief 可明确确认或退回，确认后从卡片导出执行提示文件。
- 回复以纯文本呈现：去掉 Markdown 格式标记，保留正文、换行、代码和链接，不触发模型文本中的 Slack 提及。只改变 Slack 展示，不改 Cloud 历史或导出文件；Coordinator 系统提示默认每轮约 100–200 字，除非用户明确要求详细内容。
- 文本或截图附件：支持单份 UTF-8 文本（256 KiB）及 PNG/JPEG/WebP；每条消息最多六份附件，**图片合计上限 5 MiB**。完整消息在插件中先校验，再把附件存到受保护的 Cloud 附件存储，模型只接收授权引用。
- Map 链接：只预览配置中的 Cloud origin、当前关联项目；通知仅发到明确关联的线程。Slack 原始用户消息不会再反向复制回同一线程。

事项和记忆修改由 Coordinator 在同一对话处理，仍遵守 Main 版本校验和人工确认。不再从公开入口打开表单；升级前已打开的未提交草稿保留，旧草稿提交仍受原版本与操作者校验，不覆盖新版本。

## 可靠性与边界

每个 envelope 写入独立私有状态文件并 fsync 后才 ack；Socket 重投、BUSY 和重启沿用同一业务操作 ID。交互事件走快速处理通道，避免等待模型或附件下载导致 modal trigger 过期。线程、频道、用户选择、表单草稿、消息镜像和出站回执均保存在 `state.json`；同一目录只允许一个进程。

每个频道写消息/更新至少间隔一秒。429 遵守 Retry-After，单次最多重试两次；暂时失败退避，最多八次后进入 attention 状态。发送结果不明时通过自己机器人的 metadata 或导出文件的唯一文件名核对线程历史；无法确认则保留不确定状态，不盲目补发。Slack 删除/编辑事件、机器人消息、reaction 不作为需求或审批。

执行提示导出使用与 SDK `filesUploadV2` 相同的三阶段官方 API，并独立保存 file ID 与进度。申请 URL、上传字节和完成共享的 429 均有界处理 Retry-After；已知拒绝与结果不明分别记录。完成共享的结果不明或进程中断后，只在原线程核对同一 file ID/唯一文件名，不再次分配或发布新文件。

停用时用 `sudo systemctl stop context-guard-slack.service`，只关闭 Socket 和插件进程；恢复时启动同一 unit 并保留私有状态目录。备份必须包含 `state.json`，不得用空目录替换已有回执。attention/unknown 条目需要在工作区按原线程、操作 ID 核对；核对前不删回执或重新发送同一需求。应用凭据与日志不参与 Map、Git 或 npm 分发，启动错误日志只输出错误代码，不输出响应正文。

Slack 免费版的历史保留与应用数量有限，长期项目记录在 Map 和 Cloud。此插件不启动 Executor、Tester、worktree 或自动派发；人工 brief 确认只写 Main 事项并生成粘贴提示。更多节点和超长内容可通过 Home 的完整 Map 链接查看。

## 验证

执行 `npm test`：覆盖持久 ack、重投、私聊/频道独立线程、原任务 ID、CAS 冲突、人工 brief、附件、消息镜像、流式转最终回复、限流和未知发送核对。测试使用假的 gateway 和 Slack Web API，不是已安装工作区的真实验收。

相关性判断的决定和原请求在私有 journal 中保存；重启和重投沿用原 ID、原输入，不因线程后来编辑而重新指向其他项目。失败不当作相关，也不向未 @ 的频道刷报错。回归覆盖这一可靠性边界，语义准确率仍需真实模型和 Slack 验收。

真实验收需完成 App 安装、token 配置、Cloud 网关部署，并在 Slack 中检查 Home、两端线程接续、事项/brief/提示、图片轮次和服务重启。保持本服务停用时，工作台正常运行也需实测。

官方资料：[Socket Mode](https://docs.slack.dev/tools/node-slack-sdk/socket-mode/)、[消息 metadata](https://docs.slack.dev/reference/methods/chat.postMessage/)、[文件上传](https://docs.slack.dev/reference/methods/files.getUploadURLExternal/)。
