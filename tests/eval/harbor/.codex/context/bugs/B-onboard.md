# B-onboard onboard 装了 daemon 却没打开 dashboard

- node: N211
- status: open
- 现象: 用户以为 CLI 装完就能在浏览器聊。
- 触发: cli onboard --install-daemon 成功后没有提示 dashboard URL。
- 根因: onboard 负责模型、工作区、Gateway；dashboard 是下一步。
- 修复: 
- 守卫: onboard 成功输出里必须有 dashboard 打开方式。
- 证据: 
