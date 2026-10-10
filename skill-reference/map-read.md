# Map 读取与挂载

按操作读；Map 用于模块导航/项目知识，不作开发记事本，[笔记](formats/session-record.md) 只本地。命令字段以 [接口](design/design-interface-v1.2.1.md) 为准。

## Executor 的三步读法

开工 map read --context，--node 按需，--mount 挂载；缓存/刷新/收工统一见 [上下文流程](design/design-context-v1.0.0.md)。Coordinator 的每轮目录规则不套到 Executor 缓存。

## 读哪一张图

Ask user/路由仅已发布 Main，不用 Session 草稿判断意图/挂载；无 Main 明说。Cloud 来源见 [服务器契约](design/design-memory-server-v1.1.0.md)。

## 怎么读

从导航读授权的记忆/Todo/Bug，Idea 仅 Coordinator；已知节点直接读，未知沿模块职责定位，不猜节点、不 Grep 全 .codex/context、不贴全图。启用 fs-v2.1 事项沿 index.md，FIND/snapshot 仅迁移恢复，检索只是可选加速。

当前事项所在节点非最终执行归属。Coordinator 读候选职责/owns 推荐，不让人查图；指定节点只取直接相关记录，不自动展开子树/无权邻接。

## 命令

本地初任 Coordinator：context-guard workbench --root `<project>` --session `<actual-session-id>` --role coordinator，仅上下文角色，非 Main 写权。

```sh
context-guard map read --root "<project>" --session "<session-id>" --node <id>
context-guard map changes --root "<project>" --session "<session-id>" --cursor "<last-cursor>"
```

read 返权威内容/version，无 cursor 是当前状态非无变化。Cloud 用 workbench.read scope=main，省略 version 取当前，后续分页/路由固定该版；错误及草稿门禁见接口。

## 版本

Cloud 每轮给 Main 目录，事项另祖先链/分级记忆；任务阶段仍 read_task，旧对话非读取。Main 变则新目录；记下实际版本，挂载/交接/Plan 同版，不改称最新，历史不可用明确失败。

## 页面导航

read_map 同步聚焦，不修改图，按真实层级调用。人要求打开/进入/定位确定节点直接 open_node，多候选才 ask_user.nodeIds。演示选2～4个现有代表节点 tour_nodes，说明结果不逐个点；展示不授改权。

## 挂载 Map

执行 Agent 写自己 Session。Main 结构仅 Coordinator 用 edit_map/mapWrite 可创建/改名/更新/移动/删除及指定 TODO/Bug，coordinator 审计，可先草稿，进 Main 仍门禁；根保护、版本、幂等仍服务端，developer 白名单非例外，不改权限/记忆越界。

### 挂到哪

读 Main 导航/职责/owns，用一句依据推荐；只问业务歧义，不索节点名/ID/代码路径。无匹配说明已查范围，提出新节点，进 Main 人审；Executor 不能自造/自批。

### 需求

说明改变、可见位置、验收；部署/发布/服务/地址目标保留，只问缺环境，源码/CI 不代替交付。仅明确要求只读才只读。

推荐用真实完整标题及 show_nodes/ask_user.nodeIds，非批准/派单。Cloud 人确认节点/类型后 mount_conversation，不写 Main；执行 Session 等 brief 批准。旧话题先 list_conversations，歧义澄清，不重复创建。

```sh
context-guard record-todo --root "<project>" --session "<session-id>" \
  --signal "<signal-id>" --node <id> --title "<title>" --description "<acceptance>"
```

signal 使用本轮真实值，不编造。

### Bug

```sh
context-guard record-bad-case --root "<project>" --session "<session-id>" \
  --signal "<signal-id>" --node <id> --title "<title>" --phenomenon "<what-failed>"
```

### 新节点

Executor map apply create 带 owns/proposalEvidence，由 Coordinator 对话里人确认；Coordinator 用注入稳定父 ID、nodeId 和当前 Main 版本 edit_map。页面负责渲染，不直接改 map.json；冲突重读权威并核原操作回执。

### 挂错了

重新读职责/owns，自行推荐修订并给依据，仅范围不明问业务；改后挂载/摘要交人确认，新节点仍提案，不让用户找答案。
