# B-escape 沙箱外的插件 shell 等同本机权限

- node: N512
- status: open
- 现象: 未沙箱插件可以读到 vault 文件。
- 触发: permissions 未挂上就加载 shell 插件。
- 根因: 插件 stdout 不可信；没有 sandbox 就不能碰身份目录。
- 修复: 
- 守卫: 无 sandbox 时拒绝加载 shell 类插件，或 vault 路径对插件不可见。
- 证据: 
