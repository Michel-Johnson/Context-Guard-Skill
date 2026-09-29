# 当前设计版本

读者：产品角色 Agent 与仓库开发 Agent。

**当前版本：`fs-v2.1`**

现行存储与工作项文件格式是 [Memory Filesystem v2.1](memory-filesystem-v2/README.md)。v2.1 增加版本化的项目和节点 `memory.md`，不改变底层 v2 事务格式与现有单文件接口。Agent 默认只认这一份。下次改设计必须再开新版本，不能在同一份「现行」上悄悄换意思。旧版不留在 main。

未升格设计草案不是当前版本，也不是已升格的法。没升版之前，实现和 Skill 都不得拿它们当存储、权限或发布协议。

尚未拍板、本文不选边：

- Agent 打开模块时读哪套目录（FIND.md / snapshot 与 v2 Markdown 投影如何切换）
- 安装包里链到仓库 `docs/` 打不开怎么办
