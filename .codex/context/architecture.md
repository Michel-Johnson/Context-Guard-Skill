# Architecture Map

Status: proposed (analysis done, awaiting human confirmation)
Source: this repository, not a directory dump
Later sessions: open this map. Do not re-analyze unless the human asks to rebuild.

This file is the analysis, not a slogan list. L1 is only the confirmation gate.
The live tree, memories, and produce/consume flows live in `map.json`.
Clicking an L1 card enters it. If that module would fan out more than about eight
work units, cluster them into submodule cards first. Files hang under those
submodules. Inbox holds internals of work units, not the work units themselves.

Root: Context Guard  
Purpose: 人与 Agent 共用的项目记忆。Agent 记录，人在 HTML 工作台确认、改写、授权。

## Proposed first layer

- Skill 合同 — 何时启动、记什么、什么必须等人确认
- 工作台 — 看图、改记忆、确认提议、切换仓库
- 项目 Context 目录 — `.codex/context/`，公开记录可进 git
- CLI 与 Hook — init、语言、导图；当前开发进程也要加载本 skill
- 仓库拆图 — 已有项目变成地图：先写笔记，再投影 L1；进入后再看子模块和文件
- 会话授权与提议 — 新会话默认很小；Agent 提议节点灰色半透明虚线，看起来像草稿。点一次右上角绿点变成转圈，再点一次才变成实节点。不要「再点一次加入」文案。
- 遗留测试中台 — 仓库里还有，当前主线先不扩

## Development grain (on the map, not buried)

### Skill 合同
- `SKILL.md` 启动时机（首次 / 看图 / 改方向 / park-resume / 编码调试评审）
- 首次建图合同：无图才分析；有图则打开
- `architecture.md` 必须先写，粒度对齐真实开工单元
- 简洁合同：导航不是逐字稿

### 工作台
- `prototype/workbench.html` 单文件原型
- `renderNode` 模块卡（标题 + 一句用途，不印文件清单）
- `visibleChildren`：根目录只铺 L1。模块一次只画一层，不展开子模块。开工节点若后面还有开工节点或模块（最多两岔）则默认展开；多于两个分支才晋升为模块。画布节点右侧「＋」在该节点后接入模块，不因此把开工节点升成模块。已取消节点不画、也不展开孩子。开工节点第一次点击只选中；第二次才进入并 unpack `_inbox`。模块仍是一点就进入。检查器「删除」必须先丢掉未提交的子节点草稿，不能把草稿变成新节点。删除后检查器跟到父节点（活节点），不要停在已取消节点的「恢复」上。画布点击用节点对象本身，不用可能撞车的 id 查找。提议的模块和开工节点右上角绿点 = Agent 生成、尚未人批；点一次变成转圈表示准备加入，再点一次加入。提议模块第一次也不进入。提议模块不挂锁。每一层视图都可以「＋ 模块」。画布节点右侧「＋」和检查器「＋ 模块」都挂在点中的那个节点后面，不要挂到当前页第一个模块上。
- 根和「孩子全是子模块」的视图用网格目录；左右/上下只排模块内部的开工树
- 检查器只留标题、两行用途、必要按钮（含删除）。不要「未授权 / 已隐藏」这类说明句，也不要文件系统/GitHub 预览说明、连接仓库解释段、产出/消费列表。记忆/Bug 是区块名，不可改。开工节点默认不贴「探索中」芯片。Bug 只显示标题。提议节点更短：标题、用途、加入/隐藏。检查器里可编辑行要有正常行高和内边距，空记忆/空标题不能塌成一条缝。
- 顶栏不显示会话芯片。面包屑链路单行，超出就横向滚。画布、检查器、Bug 面板的 `top` 跟真实顶栏高度走（`--chrome-top`），不要写死 49px。顶栏背景不透明。导图在顶栏和检查器让出的区域内居中，不要默认贴左上角。
- 当前会话读不到的节点整卡灰色（带锁）；选中仍用黄底
- 记忆 / Bug / 节点 / 休眠经验可附文件或图片：只存仓库相对路径，不存二进制，不弹 `window.prompt`。本地 Chrome 用 File System Access 把粘贴/选中的文件写入仓库 `docs/shots/`，地图只记相对路径。不要拷进 `.codex/context/`。GitHub htmlpreview 不必能写盘。
- 仓库切换与每仓 `map_bootstrap`
- 首次分析叠层（标明未调用 Agent）
- 活地图是 `.codex/context/map.json`：树、生产/消费、节点上的记忆和 Bug 同一份文件。`localStorage`（`cg-workbench-maps-v12`）只是没连仓库时的缓存。连接本机仓库后读写 `map.json`。
- 生产/消费默认不画虚线。打开「关系」后模块拉开；点击任意节点只高亮它的生产/消费对端，其余变暗，不会进入下一页。用顶栏面包屑进入模块。
- 未修 Bug 在右侧面板。点一条只展示从根到该节点的链路，其余隐藏，不走分级进入。本会话或多会话可同时在修；链路上用电流表示谁在修。列表只留 Bug 标题。
- L1 确认门数量 4–8，按仓库体量定，不强制恰好 4 张
- 伴侣/Linux node 这类模块要多层子模块（连接 / 远程命令 / 常驻），不能只有一级两个胶囊
- `asProposal` 递归子模块卡，只把开工单元内部收进 inbox
- `unpackInbox`：进入开工节点后再展开文件内部

### 项目 Context 目录
- `map.json` — 活地图（树 + `flows` + 节点上的 memories/bugs/files/`owns`）。`owns` 是源码归属（仓库相对路径，目录以 `/` 结尾）；`files` 只是附件。人改和工作台写回都落这里。不要另存一份平行的记忆清单。Agent 改文件时用 `scripts/map_owns.py lookup --path` 落到节点，只读该节点和已授权祖先的记忆。
- `architecture.md` — 首次分析笔记，不是活树
- `index.md` / `preferences.json`（含 `map_bootstrap`）/ `user-messages.md` / `private/`
- 附件二进制在 `docs/shots/`，context 里只记相对路径

### CLI 与 Hook
- `scripts/context_guard.py init`
- `show-roadmap`
- SessionStart：当前开发进程也要加载 skill
- 禁止把 skill 安装目录当项目根

### 仓库拆图
- 信号源：README、包边界、docs、运行时入口（不是一文件一卡）
- L1 确认门；进入模块先看子模块卡，文件挂在子模块下
- 反例：控制面 UI → CLI / TUI / Control UI 三个空壳
- 同样反例：控制面 UI 下一次性摊开 cron.ts、tui.ts、transcript 等全部文件

### 会话授权与提议
- `sessionAuth` 可读切片、虚线点两次加入、已取消托盘

### 遗留测试中台
- 先不扩；人设计测试、Agent 只提草案

Do not treat L1 as confirmed until the human accepts it in the workbench.
The root canvas is a module grid. Depth lives in `map.json`; `architecture.md` is the analysis essay. Each view answers one question.
