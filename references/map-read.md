# 读取 Map

第一次使用时通读本文，学会怎么调用。以后直接读已发布 Main。需要或忘记时再打开本文。

Map 是整个项目的记忆。命令细节以 [workbench-interface.md](workbench-interface.md) 为准。

## 读哪一张图

Ask user 与路由只读**已发布 Main**。Session 草稿不是项目事实，不得用来判断意图或挂载节点。

没有已发布 Main 时如实说明，不得用未发布图顶替。项目选用服务器记忆时，权威来源见 [server-memory.md](server-memory.md)。

## 怎么读

先读足以定位职责的导航（节点标题与职责），再读目标节点上的记忆、Idea、Todo、Bug。按需读取，不要把整张 Map 贴进对话。不要 Grep 整个 `.codex/context/`。

已知节点时，从该节点读起。未知节点时，沿 Map 的模块与职责定位，不得猜测一个不存在的节点。专用检索是可选加速，不是必经步骤。

事项当前所在节点只是检索起点，不自动等于最终执行节点。Coordinator 应根据需求读取候选节点的职责与 owns 后推荐挂载位置，不把查图工作交给用户。

指定节点时，只取该节点及其直接相关记录，不自动展开子树，不读取邻接节点的未授权内容。

## 命令

本地：

```sh
context-guard map read --root "<project>" --session "<session-id>" --node <id>
context-guard map changes --root "<project>" --session "<session-id>" --cursor "<last-cursor>"
```

`map read` 返回该时刻的权威内容与 `version`。缺少 cursor 表示读取当前状态，不是「没有变化」。错误码与页面草稿门禁见 [workbench-interface.md](workbench-interface.md)。

Cloud 读取已发布 Main 使用 `workbench.read`，`scope=main`。省略 version 时取当前已发布版本，随后分页与路由必须固定该版本。字段与拒绝条件见 [interface-contract-v2.md](../docs/interface-contract-v2.md)。

## 版本

记下本次读取的 Main 版本。后续挂载、交接与审计划都使用这一版，不得改口成「最新」。指定的历史版本不可用时失败，不得偷偷换成另一版。
