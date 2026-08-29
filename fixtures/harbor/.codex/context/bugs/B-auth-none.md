# B-auth-none 非 loopback 误开 auth.mode=none

- node: N121
- status: open
- 现象: 把 Gateway 绑到局域网后，共享密钥整段被关掉。
- 触发: auth.mode=none 且监听地址不是 127.0.0.1。
- 根因: none 只允许 loopback；私有入口一旦非回环就必须校验。
- 修复: 
- 守卫: 非 loopback 启动时拒绝 none，或启动日志出现明确拒绝。
- 证据: 
