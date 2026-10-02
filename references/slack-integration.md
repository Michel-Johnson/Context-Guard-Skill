# Slack 插件网关

读者：Cloud 管理员和插件开发者。Slack 服务与 Cloud 分开运行；安装和使用见 [插件 README](../plugins/slack/README.md)。网关默认关闭，只监听本机，不配置公网代理。Slack SDK 只安装在插件包中。

## 受保护配置

在 checkout 外建立权限 `0600` 的 JSON，Cloud 环境设置 `CONTEXT_GUARD_INTEGRATIONS_CONFIG` 指向该文件。先只开放实验项目；凭据须与 Cloud/浏览器/私有记忆凭据不同。

```json
{
  "host": "127.0.0.1",
  "port": 8790,
  "token": "<独立随机凭据，至少32字节>",
  "teamId": "T0BRW7G4Q6P",
  "projectIds": ["context-guard-claude-lab"],
  "visionProviderFile": "/etc/context-guard-cloud/slack-vision.json"
}
```

`actions` 可指定下一节动作子集；不填时允许全部列出的动作。不新增用户角色体系，真实 Slack 用户 ID 持久写入操作回执。插件凭据是服务信任边界，不能下发给用户或执行 Agent。

视觉供应商 JSON 使用现有 `baseUrl/model/token` 格式，模型必须配置为 `glm-5.3-flash`；可配置 `protocol: "openai"`（baseUrl 为 API 根路径）或默认 Anthropic 协议。凭据仅放该私有文件。图片轮次缺少有效视觉配置时明确失败，不改用文本模型；文字轮次沿用项目原供应商。正式开放前必须真实验证模型可用性。

## 请求与状态

`POST /v1/command` 使用 `Authorization: Bearer <插件凭据>` 和 JSON：

```json
{
  "id": "slack-event:<稳定事件ID>",
  "teamId": "T0BRW7G4Q6P",
  "userId": "<真实Slack用户ID>",
  "projectId": "context-guard-claude-lab",
  "conversationId": "<已关联对话ID>",
  "type": "conversation.submit",
  "payload": {"text": "讨论这个模块", "attachments": [{"id": "<已上传附件ID>"}]}
}
```

| 动作 | payload / 结果 |
| --- | --- |
| `project.list` / `project.read` | 开放项目目录 / Main Map、版本和公开 Session 状态 |
| `conversation.create` / `conversation.bind` | 创建人工执行对话 / 关联无活动自动执行工作的对话；关联后项目及执行模式不变 |
| `conversation.state` / `conversation.submit` | 公共消息、问题、审批及状态 / 提交文本、附件、问题答案或原 ID 重试 |
| `conversation.relevance` | `text`（最多 10000 字符）、`context`（最多 6 条 `{speaker,text}`，每条文本 800 字符）、`files`（最多 6 个 `{name,mimeType}`）；可不带对话 ID。返回 `{respond,reason,mainVersion}`，网关按原 ID 保存判断回执；不创建对话、不写 Map、不调用业务工具 |
| `map.write` | `baseVersion`、`operations`；复用 Main 事务校验，新 TODO/Bug 显式标记人工执行，包含数组、直接 Bug 操作和未归属 Bug；后续编辑必须保留已有人工执行标记，拒绝时不写 Main 或事件 |
| `brief.review` | `proposalId`、`version`、`decision`、`reason`；指定版本确认或拒绝；确认不调用派发器 |
| `prompt.read` | `proposalId`；读取已批准 brief 的完整执行提示 |
| `attachment.upload` / `attachment.read` | filename、MIME、base64 / 项目隔离的附件引用及原文；不接受任意磁盘路径 |

成功回执为 `{id,ok:true,data}`，失败为 `{id,ok:false,error:{code,message}}`，HTTP 状态与失败对应。写操作同 ID、同操作者、同输入返回原回执；换输入或身份返回冲突。收到请求或入队不代表模型已完成。

私聊、`/cg ask` 或明确 @ 正常进入对话。已绑定项目频道内未 @ 的消息先做相关性判断，已有线程同样判断；插件按 cursor 获取同线程的最近六条先前文本，不扫描频道历史，不纳入当前消息后的内容。单次最多四页、每页 100 条；超出或分页不完整返回 `RELEVANCE_CONTEXT_INCOMPLETE`，不拿早期上下文冒充最近上下文。无关消息不建对话、不上传附件、不发回复或表情；判断失败在私有 journal 留下错误，不向频道刷报错。图片内容仍在确认进入对话后由 Flash 理解，文件名不当作视觉证据。

未 @ 消息使用最多两个后台判定槽，不把模型等待串到其他线程的明确 @、私聊和对话镜像前面。同一线程按接收顺序处理，后续消息不越过此前的分类或 BUSY 重试；停用插件仍等待已启动处理和 journal 持久化完成。

`GET /v1/events?teamId=…&userId=…&projectId=…&conversationId=…` 使用相同 Bearer 凭据，返回该关联对话的 SSE `state` 快照；断线重新读取状态并按稳定消息 ID 去重。未关联私人对话不向 Slack 广播。

## 发布与恢复

按 [Cloud 部署手册](cloud-deployment.md) 备份完整 checkout、Cloud/记忆数据和受保护配置。插件另备份状态目录与 EnvironmentFile；原消息和发送回执不得丢弃。先从准确 main 更新完整仓库，再安装插件独立依赖和服务；不把源码零散复制到运行目录。

停用插件只停止 `context-guard-slack.service`，工作台与 Coordinator 应继续工作；移除 Cloud 配置可关闭网关。恢复时使用同一私有状态目录。发送结果未知时先核对原消息或文件，不盲目重发。回滚须同时恢复对应源码与配置，不能通过覆盖新数据伪造成功。
