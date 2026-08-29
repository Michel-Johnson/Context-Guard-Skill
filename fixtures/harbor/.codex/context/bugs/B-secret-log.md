# B-secret-log 失败日志打印了 vault 原文

- node: N73
- status: open
- 现象: 排障日志里出现 token 明文。
- 触发: obs/logs 在插件失败分支 dump error.cause。
- 根因: 身份材料只能在 vault，日志只留脱敏指针。
- 修复: 
- 守卫: 失败日志不得出现 vault 目录下的密钥形态字符串。
- 证据: 
