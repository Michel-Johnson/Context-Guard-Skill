# B-clip 长会话未裁剪导致超时

- node: N111
- status: open
- 现象: 一次 agent 调用卡住，直到 Gateway 超时。
- 触发: 同一渠道会话连续工具调用，transcripts 未裁剪。
- 根因: session.ts 在进入 tool loop 前没有按 token 预算切片。
- 修复: 
- 守卫: 超过预算的会话进入 tool loop 前必须先 clip；用超长 transcript 夹具可复现超时。
- 证据: docs/shots/session-timeout.png
