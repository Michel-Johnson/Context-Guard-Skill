# B-caps Android node caps 策略来源不一致

- node: N321
- status: open
- 现象: 同一条 required-commands，policy-config 与 policy-source 一个过一个不过。
- 触发: Android node 配对后执行受限命令。
- 根因: 两套策略文件对 required-commands 判断分叉。
- 修复: 
- 守卫: 同一 fixtures 命令在两套策略下结论相同。
- 证据: 
