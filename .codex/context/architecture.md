# Architecture Map

Status: proposed (analysis done, awaiting human confirmation)
Source: this repository, not a directory dump
Later sessions: open this map. Do not re-analyze unless the human asks to rebuild.

This file is the analysis, not a slogan list. L1 is the confirmation gate. Nested bullets are development-grain nodes that already belong in each module's inbox.

Root: Context Guard  
Purpose: 人与 Agent 共用的项目记忆。Agent 记录，人在 HTML 工作台确认、改写、授权。

## Proposed first layer

- Skill 合同 — 何时启动、记什么、什么必须等人确认
- 工作台 — 看图、改记忆、确认提议、切换仓库
- 项目 Context 目录 — `.codex/context/`，公开记录可进 git
- CLI 与 Hook — init、语言、导图；当前开发进程也要加载本 skill
- 仓库拆图 — 已有项目变成地图：先写笔记，再投影 L1
- 会话授权与提议 — 新会话默认很小，虚线提议等人点两次
- 遗留测试中台 — 仓库里还有，当前主线先不扩

## Development grain (already analyzed)

### Skill 合同
- 启动时机（首次 / 看图 / 改方向 / park-resume / 编码调试评审）
- 首次建图合同：无图才分析；有图则打开；分析必须写 architecture.md
- 简洁合同：导航不是逐字稿

### 工作台
- 模块卡（标题 + 一句用途）
- 检查器（标题、用途、记忆、Bug 作为内容）
- 左右 / 上下布局
- 仓库切换与每仓 bootstrap
- 首次分析叠层（步骤日志 + 正在写的 markdown）
- 本地持久化（刷新不丢图；重分析必须是人点的）

### 项目 Context 目录
- index.md / preferences.json / architecture.md / private/

### CLI 与 Hook
- init 骨架
- show-roadmap
- SessionStart：当前开发进程也要加载 skill

### 仓库拆图
- 信号源：README、包边界、docs、运行时入口（不是一文件一卡）
- L1 确认门 + inbox 里的 L2/L3
- architecture.md 产出：整仓笔记，粒度必须能开工
- 反例：控制面 UI → CLI / TUI / Control UI 三个空壳，没有意义

### 会话授权与提议
- 可读切片、虚线双击加入、已取消托盘

### 遗留测试中台
- 先不扩；人设计测试、Agent 只提草案

Do not treat L1 as confirmed until the human accepts it in the workbench.
The nested nodes above are part of the analysis even before they appear on the canvas.
