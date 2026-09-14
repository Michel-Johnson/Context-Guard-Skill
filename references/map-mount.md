# 挂载 Map

意图清楚后打开本文，学会怎么调用。第一次挂载或忘记时通读。用户说挂错了时再打开。

普通开发 Agent 写入自己的 Session Map，不是 Main。Cloud Coordinator 若项目配置显式启用 `mapWrite`，可以通过受限服务端工具直接创建、改名或移动 Main 节点，并以 `coordinator` 身份审计；它不能删除节点或借此修改权限、记忆、任务和 Bug。命令细节以 [workbench-interface.md](workbench-interface.md) 为准。

## 挂到哪

节点定位由 Coordinator 完成，方式见 [读取 Map](map-read.md)。按需求读取已发布 Main 的导航、候选节点职责与 owns，推荐现有节点并用一句话解释依据；不要要求用户描述节点名称、ID 或代码路径。

需求不清楚时，只问缺失的业务信息。例如“测试实验”应问想验证什么功能，而不是问挂到哪里。存在多个候选时比较职责后给出推荐，只就影响选择的业务差异提问。没有匹配节点时说明已查范围并提出新节点建议，按提案流程交人类确认，不编造节点或自行批准。

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

普通开发 Agent 需要新职责时用 `map apply` 提交 create，带上 `owns` 与 `proposalEvidence`。Coordinator 使用注入目录中的稳定父节点 ID 与当前 Main 版本调用 `edit_map`；页面收到提交事件后负责渲染节点和动效。两者都不能直接改 `map.json`，冲突后先重读权威 Main，再按原操作身份核对回执。

## 挂错了

用户说挂错了：重新读取相关节点，自行检查职责与 owns，给出修订建议和依据，不要求用户找出正确节点。只有需求范围仍有歧义时才问业务问题。改完把挂载与摘要再交给用户审核；需要新节点时仍走提案，不得自己确认。
