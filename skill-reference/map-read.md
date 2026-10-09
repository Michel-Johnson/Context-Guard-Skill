# Map 读取与挂载

读取、定位看前半部分；确认需求后挂载或调整节点，看 [挂载 Map](#挂载-map)。首次处理相应操作时阅读，需要或版本变化时重读，不每轮加载全部资料。

Map 用于定位模块及相关资料，不是开发过程记事本。项目知识写在记忆正文；执行笔记只存本地会话文件，见 [会话记录模板](formats/session-record.md)。命令细节以 [工作台接口](design/design-interface-v1.2.1.md) 为准。

## Executor 的三步读法

默认开工用 `map read --context` 取导航和项目说明；用 `--node` 按需读正文、`--mount` 记录挂载子树。重复读取走本地缓存；新模块或明确 `--refresh` 时，有 Cloud 就查询 Cloud，无 Cloud 就读取本地 Map。收工用 `map context-check` 看变化，有变化再读相关 `--diff`，处理后重新检查。完整约定见 [上下文读取设计](design/design-context-v1.0.0.md)。

下面的 Coordinator 路由及旧读取接口仍按原约定运行；不能把它们的每轮目录规则套用到 Executor 缓存流程。

## 读哪一张图

Ask user 与路由只读**已发布 Main**。Session 草稿不是项目事实，不得用来判断意图或挂载节点。

没有已发布 Main 时如实说明，不得用未发布图顶替。项目选用服务器记忆时，权威来源见 [服务器记忆设计](design/design-memory-server-v1.1.0.md)。

## 怎么读

先用默认入口定位节点，再按权限读取记忆、Todo、Bug；Idea 仅 Coordinator 可读。不要把整张 Map 贴进对话，也不要 Grep 整个 `.codex/context/`。需要已启用的 fs-v2.1 事项文件时，从目标 `index.md` 跟随链接。旧 FIND / snapshot 只用于明确的迁移或恢复，不是第二套默认读法。

已知节点时，从该节点读起。未知节点时，沿 Map 的模块与职责定位，不得猜测一个不存在的节点。专用检索是可选加速，不是必经步骤。

事项当前所在节点只是检索起点，不自动等于最终执行节点。Coordinator 应根据需求读取候选节点的职责与 owns 后推荐挂载位置，不把查图工作交给用户。

指定节点时，只取该节点及其直接相关记录，不自动展开子树，不读取邻接节点的未授权内容。

## 命令

本地会话首次承担 Coordinator 时，用 `context-guard workbench --root <project> --session <actual-session-id> --role coordinator` 显式记录上下文身份；该标记只控制上下文投递，不授予 Main 写权。

本地：

```sh
context-guard map read --root "<project>" --session "<session-id>" --node <id>
context-guard map changes --root "<project>" --session "<session-id>" --cursor "<last-cursor>"
```

`map read` 返回该时刻的权威内容与 `version`。缺少 cursor 表示读取当前状态，不是「没有变化」。错误码与页面草稿门禁见 [工作台接口](design/design-interface-v1.2.1.md)。

Cloud 读取已发布 Main 使用 `workbench.read`，`scope=main`。省略 version 时取当前已发布版本，随后分页与路由必须固定该版本。见 [接口契约](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/skill-reference/design/design-interface-v1.2.1.md)。

## 版本

Cloud 每轮提供 Main 节点目录；事项对话还提供节点祖先链和分级记忆。目录用于定位，旧对话不能代替 `read_task` 等权威读取；Main 版本变化后使用新目录。

记下本次读取的 Main 版本。后续挂载、交接与审计划都使用这一版，不得改口成「最新」。指定的历史版本不可用时失败，不得偷偷换成另一版。

## 页面导航

`read_map` 会同步聚焦被读取的节点，但不修改 Map。逐层读取时按实际层级调用，不用文字声称已完成页面操作。

用户明确要求打开、进入、跳转或定位已确定的节点时，直接调用 `open_node`，不改成推荐按钮。只有同名或多个候选不能唯一定位时，才用 `ask_user.nodeIds` 澄清。

用户要求演示、展示或游览 Map 时，选 2～4 个有代表性的现有节点调用 `tour_nodes`；完成后简述展示内容，不要求用户逐个点击。演示不授予修改权限。

## 挂载 Map

需求清楚后使用本节；挂错时重新核对相关节点。

Executor 写入自己的 Session Map，不是 Main。非人写 Main 结构只有 Coordinator：通过 `edit_map` / `mapWrite` 创建、改名、更新、移动或删除节点，也可删除指定节点上的 TODO/Bug，并以 `coordinator` 身份审计；可以先草稿，进 Main 再过门禁。版本校验、幂等回执和根节点保护由服务端强制执行，不能借此修改权限或记忆。不要把白名单 developer 客户端当成现行例外。命令细节以 [工作台接口](design/design-interface-v1.2.1.md) 为准。

### 挂到哪

节点定位由 Coordinator 完成，方式见 [读取方法](#怎么读)。按需求读取已发布 Main 的导航、候选节点职责与 owns，推荐现有节点并用一句话解释依据；不要要求用户描述节点名称、ID 或代码路径。

需求不清楚时，只问缺失的业务信息。例如“测试实验”应问想验证什么功能，而不是问挂到哪里。存在多个候选时比较职责后给出推荐，只就影响选择的业务差异提问。没有匹配节点时说明已查范围并提出新节点建议。Coordinator 可先建草稿节点，进 Main 仍走门禁；Executor 仍按提案交人类在 Coordinator 会话里确认，不编造节点或自行批准。

### 需求

需求摘要写清“要改变什么、在哪里可见、如何验收”。用户要求部署、发布、启动服务或提供访问地址时，保留实际交付目标；只问真正缺少的环境信息，不得用源码路径或 CI 通过替代部署结果。只有用户明确要求只读检查时才采用只读任务。

推荐节点使用 Main 中的完整节点标题，通过 `show_nodes` 或 `ask_user.nodeIds` 提供可跳转引用。推荐不等于批准或派单。

Cloud 用户确认节点和事项类型后，调用 `mount_conversation` 把 Coordinator 挂到该节点，不写入 Main。执行 Session 仍须等该事项的 brief 获批后创建。用户找回旧话题时先用 `list_conversations` 定位，有歧义再澄清，不重新创建同一事项。

使用本次 Prompt 的 signal，不要编造。

```sh
context-guard record-todo --root "<project>" --session "<session-id>" \
  --signal "<signal-id>" --node <id> --title "<title>" --description "<acceptance>"
```

### Bug

```sh
context-guard record-bad-case --root "<project>" --session "<session-id>" \
  --signal "<signal-id>" --node <id> --title "<title>" --phenomenon "<what-failed>"
```

### 新节点

Executor 需要新职责时用 `map apply` 提交 create，带上 `owns` 与 `proposalEvidence`，由 Coordinator 会话里的人确认。Coordinator 使用注入目录中的稳定父节点 ID、记录所属 `nodeId` 与当前 Main 版本调用 `edit_map`；可以先草稿，进 Main 再过门禁。页面收到提交事件后负责渲染节点和动效。两者都不能直接改 `map.json`，冲突后先重读权威 Main，再按原操作身份核对回执。

### 挂错了

用户说挂错了：重新读取相关节点，自行检查职责与 owns，给出修订建议和依据，不要求用户找出正确节点。只有需求范围仍有歧义时才问业务问题。改完把挂载与摘要再交给用户审核；需要新节点时仍走提案，不得自己确认。
