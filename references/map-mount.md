# 挂载 Map

读者：产品角色 Agent。意图清楚后打开本文，学会怎么调用。第一次挂载或忘记时通读。用户说挂错了时再打开。

Executor 写入自己的 Session Map，不是 Main。非人写 Main 结构只有 Coordinator：通过 `edit_map` / `mapWrite` 创建、改名、更新、移动或删除节点，也可删除指定节点上的 TODO/Bug，并以 `coordinator` 身份审计；可以先草稿，进 Main 再过门禁。版本校验、幂等回执和根节点保护由服务端强制执行，不能借此修改权限或记忆。不要把白名单 developer 客户端当成现行例外。命令细节以 [workbench-interface.md](workbench-interface.md) 为准。

## 挂到哪

节点定位由 Coordinator 完成，方式见 [读取 Map](map-read.md)。按需求读取已发布 Main 的导航、候选节点职责与 owns，推荐现有节点并用一句话解释依据；不要要求用户描述节点名称、ID 或代码路径。

需求不清楚时，只问缺失的业务信息。例如“测试实验”应问想验证什么功能，而不是问挂到哪里。存在多个候选时比较职责后给出推荐，只就影响选择的业务差异提问。没有匹配节点时说明已查范围并提出新节点建议。Coordinator 可先建草稿节点，进 Main 仍走门禁；Executor 仍按提案交人类在 Coordinator 会话里确认，不编造节点或自行批准。

## 需求

使用本次 Prompt 的 signal，不要编造。

```sh
context-guard record-todo --root "<project>" --session "<session-id>" \
  --signal "<signal-id>" --node <id> --title "<title>" --description "<acceptance>"
```

## Bug

```sh
context-guard record-bad-case --root "<project>" --session "<session-id>" \
  --signal "<signal-id>" --node <id> --title "<title>" --phenomenon "<what-failed>"
```

## 新节点

Executor 需要新职责时用 `map apply` 提交 create，带上 `owns` 与 `proposalEvidence`，由 Coordinator 会话里的人确认。Coordinator 使用注入目录中的稳定父节点 ID、记录所属 `nodeId` 与当前 Main 版本调用 `edit_map`；可以先草稿，进 Main 再过门禁。页面收到提交事件后负责渲染节点和动效。两者都不能直接改 `map.json`，冲突后先重读权威 Main，再按原操作身份核对回执。

## 挂错了

用户说挂错了：重新读取相关节点，自行检查职责与 owns，给出修订建议和依据，不要求用户找出正确节点。只有需求范围仍有歧义时才问业务问题。改完把挂载与摘要再交给用户审核；需要新节点时仍走提案，不得自己确认。
