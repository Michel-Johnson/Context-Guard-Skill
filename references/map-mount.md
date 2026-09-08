# 挂载 Map

意图清楚后打开本文，学会怎么调用。第一次挂载或忘记时通读。用户说挂错了时再打开。

你写入自己的 Session Map，不是 Main。挂载结果与摘要交给用户审核。命令细节以 [workbench-interface.md](workbench-interface.md) 为准。

## 挂到哪

先在已发布 Main 上定位节点，方式见 [读取 Map](map-read.md)。没有对应节点就问用户，不得猜测。需要新节点时提交提案，不得自己确认。

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

需要新职责时用 `map apply` 提交 create，带上 `owns` 与 `proposalEvidence`。使用刚才 `map read` 的 `baseVersion` 和稳定 `operationId`。不要直接改 `map.json`。冲突则重读再提交同一 `operationId`。字段与错误码见 [workbench-interface.md](workbench-interface.md)。

## 挂错了

用户说挂错了：问清正确节点后改挂。没有指出则问，不得另猜。改完把挂载与摘要再交给用户审核。需要新节点时仍走提案，不得自己确认。
