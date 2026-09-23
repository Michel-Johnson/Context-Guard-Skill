# Agent 交接

Coordinator 向 Executor、Tester 发送任务时适用。Executor 接收时按同一四项核对。

一次交接必须写明：

1. 任务说明（用户已确认的那一版，不得改字）
2. 挂载节点
3. Main 版本
4. 验收条件

不得使用含糊指令，例如「适当处理」「参考相关模块」。不得在交接中授予额外节点权限，不得把 Session 草稿当作 Main。

对方可读取总体 context，执行过程中不得改写 Main。不得对人说话。Executor 先提交代码和 handoff，Coordinator 再交给 Tester；测试和人工验收前不归档或结束计划。人工验收后才归档并结束计划。
