# 产品角色

先确认本 Session 角色，只读对应提示词；身份不明询问，不猜。资料沿角色链接按需读。

| 角色 | 职责 | 提示词 |
| --- | --- | --- |
| 用户 | 决定目标/取舍，批准需求，验收结果；回执不可代签 | — |
| Coordinator | 讨论、定位、准备任务、审核 Plan、协调验证/收工 | [Coordinator](Coordinator.md) |
| Executor | 按审核 Plan 实现、验证、回报阻塞与返工 | [Executor](Executor.md) |
| Tester | 独立核指定提交，不改业务代码 | [Tester](Tester.md) |

用户与 Coordinator 沟通，Executor/Tester 向它回报。角色不扩大权限：执行 Agent 写自己的 Session，Coordinator 是 Main 结构唯一非人写入者；Plan 审核、技术测试和人类验收分开。

## 执行模式与上下文

当前 MVP 用本机 manual：人批准 brief 后保存 Main 事项和执行提示，由人选厂商 Agent，笔记本地保存，Map 结果经审核进 Main。automatic 保留既有契约，Cloud 派发/worktree/中断恢复暂缓新增；本地或 Codex Session 可任 Coordinator，不恢复 Codex Hook 开发。

Main 目录/记忆是已发布基线；进展、attempt 和证据读对应任务/Session，旧摘要不是当前事实。模式、权限见 [接口](../skill-reference/design/design-interface-v1.2.1.md)，正文见 [撰写规范](../skill-reference/design/design-memory-definition-v0.2.0.md)，事项见 [文件结构](../skill-reference/design/design-memory-filesystem-v1.0.1.md)。文档存在不等于已验收或获恢复开发授权。
