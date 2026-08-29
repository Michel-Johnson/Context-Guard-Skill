# B-pair-cli CLI 与 Control UI 改的不是同一份配对队列

- node: N421
- status: open
- 现象: dashboard 批准后 CLI 仍显示 pending。
- 触发: 一边写 packages/identity/pairing-queue.ts，一边写了渠道自己的队列副本。
- 根因: openclaw pairing approve 和 Control UI 必须改同一份队列。
- 修复: 
- 守卫: 两边读写 packages/identity/pairing-queue.ts，不存在第二份 pending 列表。
- 证据: 
