# Architecture Map

Status: ready（整张活图已从 8877 工作台收回）
Source: 人定切法，不是目录罗列
Later sessions: 打开这张图。除非人要求重建，否则不要重拆。

根：Context Guard  
用途：人与 Agent 共用的项目记忆。Agent 记录；人在 HTML 工作台确认。

Skill 合同（`SKILL.md`）挂在根上，不单独占第一层：何时启动、只记四块、无图才商量、有图则打开。

## 已定第一层（5）

人 2026-08-28 锁定。安装（npx / init / set-language）并进冷启动，不另开卡。

- 工作台 — 人在浏览器看图、改记忆、确认提议、授权切片
- 冷启动 — skill 怎么进机器、第一次怎么建图：安装、init、语言、层对层商量第一层
- 底层文件系统 — `.codex/context/` 四块怎么写、怎么跳；`map_owns` 复印件
- hook — 当前开发进程的生命周期提醒（SessionStart 等），不是安装本身
- CI/CD — 以后怎么自动验；第一版产品不做测试中台，仓库里的夹具/冒烟挂在这里

## 人在工作台写下的下一层（2026-08-28）

从 Cursor Simple Browser 的活图收回，不是 Agent 猜的。已取消的卡不列在这里。

**工作台**
- 前端设计：顶栏、右边栏、按钮、授权模式、Bug、已取消、鼠标/移动
- session连接
- 模块授权
- debug
- 底层连接

**冷启动**
- 多平台一键安装：codex、claude code、grok、cursor、dsh、kimi、doubao
- 初次使用动画引导
- 新仓库建图
- 已有仓库建图

**底层文件系统**
- session（含 user message）
- bad case
- map
- index
- Readme.md
- task

**hook**
- start hook：User Prompt、System Prompt、Bad Case Check、Task Check、Ask User
- stop hook：Summary、Record Bad Case、Update Map

**CI/CD**
- CI
- CD

