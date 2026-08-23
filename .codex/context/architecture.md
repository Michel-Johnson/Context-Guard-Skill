# Architecture Map

Status: proposed (analysis done, awaiting human confirmation)
Source: this repository, not a directory dump
Later sessions: open this map. Do not re-analyze unless the human asks to rebuild.

This file is the analysis, not a slogan list. L1 is only the confirmation gate.
L2 hangs directly under each module on the map (commands, files, functions).
Inbox holds internals of those work units, not the work units themselves.

Root: Context Guard  
Purpose: 人与 Agent 共用的项目记忆。Agent 记录，人在 HTML 工作台确认、改写、授权。

## Proposed first layer

- Skill 合同 — 何时启动、记什么、什么必须等人确认
- 工作台 — 看图、改记忆、确认提议、切换仓库
- 项目 Context 目录 — `.codex/context/`，公开记录可进 git
- CLI 与 Hook — init、语言、导图；当前开发进程也要加载本 skill
- 仓库拆图 — 已有项目变成地图：先写笔记，再投影 L1 + 可见的 L2
- 会话授权与提议 — 新会话默认很小，虚线提议等人点两次
- 遗留测试中台 — 仓库里还有，当前主线先不扩

## Development grain (on the map, not buried)

### Skill 合同
- `SKILL.md` 启动时机（首次 / 看图 / 改方向 / park-resume / 编码调试评审）
- 首次建图合同：无图才分析；有图则打开
- `architecture.md` 必须先写，粒度对齐真实开工单元
- 简洁合同：导航不是逐字稿

### 工作台
- `prototype/workbench.html` 单文件原型
- `renderNode` 模块卡（标题 + 一句用途）
- `visibleChildren`：根上只铺 L1；点选模块才预览开工单元
- `layout` 左右 / 上下；根上 L1 过多时上下换行
- 检查器 contenteditable、Bug 区块、`+` 号
- 仓库切换与每仓 `map_bootstrap`
- 首次分析叠层（标明未调用 Agent）
- `localStorage`（`cg-workbench-maps-v7`）
- `asProposal` 只把 L3+ 收进 inbox
- `unpackInbox`：进入开工节点后再展开文件内部

### 项目 Context 目录
- `index.md` / `preferences.json` / `architecture.md` / `user-messages.md` / `private/`

### CLI 与 Hook
- `scripts/context_guard.py init`
- `show-roadmap`
- SessionStart：当前开发进程也要加载 skill
- 禁止把 skill 安装目录当项目根

### 仓库拆图
- 信号源：README、包边界、docs、运行时入口（不是一文件一卡）
- L1 确认门；L2 已是命令/文件，挂在模块下
- 反例：控制面 UI → CLI / TUI / Control UI 三个空壳

### 会话授权与提议
- `sessionAuth` 可读切片、虚线点两次加入、已取消托盘

### 遗留测试中台
- 先不扩；人设计测试、Agent 只提草案

Do not treat L1 as confirmed until the human accepts it in the workbench.
L2 is part of the analysis. The root canvas peeks it on the selected module; it is not all expanded at once.
