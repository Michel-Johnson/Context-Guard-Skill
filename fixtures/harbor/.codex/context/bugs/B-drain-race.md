# B-drain-race 关闭时 active session 排空竞态

- node: N122
- status: open
- 现象: 重启 Gateway 后偶发丢 final 事件。
- 触发: shutdown drain 与新的 agent 请求交错。
- 根因: drain 未先拒绝新请求。
- 修复: 
- 守卫: 关闭期间新请求失败；已有 session 的 final 仍送达。
- 证据: 
