# B-tunnel 远程 WebChat 必须与 Gateway 同隧道

- node: N222
- status: open
- 现象: 远程打开 Control UI 后连错端口，聊天发不出去。
- 触发: SSH/Tailscale 只转了 dashboard，没转 Gateway WS。
- 根因: WebChat 与 Gateway 必须走同一条隧道。
- 修复: 
- 守卫: 远程 WebChat 的 WS 与 Gateway 同 host/隧道；漏配则明确报错。
- 证据: docs/shots/tunnel-mismatch.png
