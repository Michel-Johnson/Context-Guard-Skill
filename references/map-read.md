# 读取 Map

第一次使用时通读本文，学会怎么调用。以后直接读已发布 Main。需要或忘记时再打开本文。

Map 用于定位模块及相关资料，不是开发过程记事本。项目知识写在记忆正文，执行过程留在 Session。命令细节以 [工作台接口](design/design-workbench-interface-v1.1.0.md) 为准。

## Executor 的三步读法

开工用 `map read --context` 取导航和项目说明；用 `--node` 按需读正文、`--mount` 记录挂载子树。开发时重复读取走本地缓存；新模块或明确 `--refresh` 时查询 Cloud。收工用 `map context-check` 看变化，有变化再读相关 `--diff`，处理后重新检查。完整约定见 [上下文读取设计](design/design-context-v1.0.0.md)。

下面的 Coordinator 路由及旧读取接口仍按原约定运行；不能把它们的每轮目录规则套用到 Executor 缓存流程。

## 读哪一张图

Ask user 与路由只读**已发布 Main**。Session 草稿不是项目事实，不得用来判断意图或挂载节点。

没有已发布 Main 时如实说明，不得用未发布图顶替。项目选用服务器记忆时，权威来源见 [服务器记忆设计](design/design-memory-server-v1.1.0.md)。

## 怎么读

先读足以定位职责的导航（节点标题与职责），再读目标节点上的记忆、Idea、Todo、Bug。按需读取，不要把整张 Map 贴进对话。不要 Grep 整个 `.codex/context/`。当活动接口已经暴露 Filesystem v2 投影时，从目标 `index.md` 跟随 Markdown 链接；链接就是跳转。Agent 打开模块时先读哪套目录（FIND.md / snapshot 与 v2）尚未拍板，不得在本文选边。

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

`map read` 返回该时刻的权威内容与 `version`。缺少 cursor 表示读取当前状态，不是「没有变化」。错误码与页面草稿门禁见 [工作台接口](design/design-workbench-interface-v1.1.0.md)。

Cloud 读取已发布 Main 使用 `workbench.read`，`scope=main`。省略 version 时取当前已发布版本，随后分页与路由必须固定该版本。见 [接口契约](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/references/design/design-interface-v1.2.1.md)。

## 版本

Cloud 每轮提供 Main 节点目录；事项对话还提供节点祖先链和分级记忆。目录用于定位，旧对话不能代替 `read_task` 等权威读取；Main 版本变化后使用新目录。

记下本次读取的 Main 版本。后续挂载、交接与审计划都使用这一版，不得改口成「最新」。指定的历史版本不可用时失败，不得偷偷换成另一版。

## 页面导航

`read_map` 会同步聚焦被读取的节点，但不修改 Map。逐层读取时按实际层级调用，不用文字声称已完成页面操作。

用户明确要求打开、进入、跳转或定位已确定的节点时，直接调用 `open_node`，不改成推荐按钮。只有同名或多个候选不能唯一定位时，才用 `ask_user.nodeIds` 澄清。

用户要求演示、展示或游览 Map 时，选 2～4 个有代表性的现有节点调用 `tour_nodes`；完成后简述展示内容，不要求用户逐个点击。演示不授予修改权限。
