# B-tool-orphan 工具事件找不到 session

- node: N112
- status: open
- 现象: 工具已执行，渠道收不到 final。
- 触发: tools.ts 写回时 session id 被换成 run id。
- 根因: 工具结果必须写回打开它的那条 session，不能另开 transcript。
- 修复: 
- 守卫: 工具事件的 session id 必须等于 inbound 消息的 session id。
- 证据: 
