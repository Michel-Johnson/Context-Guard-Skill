# Architecture Map

Status: proposed (first use, awaiting human confirmation)
Source: this repository, not a directory dump

Root: Context Guard  
Purpose: 人与 Agent 共用的项目记忆。Agent 记录，人在 HTML 工作台确认、改写、授权。

## Proposed first layer

- Skill 合同 — 何时启动、记什么、什么必须等人确认
- 工作台 — 看图、改记忆、确认提议、切换仓库
- 项目 Context 目录 — `.codex/context/`，公开记录可进 git
- CLI 与 Hook — init、语言、导图；当前开发进程也要加载本 skill
- 仓库拆图 — 已有项目变成地图：只提议一层
- 会话授权与提议 — 新会话默认很小，虚线提议等人点两次
- 遗留测试中台 — 仓库里还有，当前主线先不扩

Do not treat this file as confirmed until the human accepts the first layer in the workbench.
