[官网与交互演示](https://michel-johnson.github.io/Context-Guard-Skill/?lang=zh)

# Context Guard Skill

语言：[English](README.md) | **中文**

Context Guard 是一个面向 Codex、Cursor 和 Claude 的项目记忆 skill。它把任务主线、支线、bad case 和验证链路保存在项目自己的 `.codex/context/` 里，让 Agent 在不同 session 之间也能知道“现在做到哪里、踩过哪些坑、下次怎么检查”。

## 能做什么

- **四块**：会话、坏例、任务、地图；当前项目的 `.codex/context/` 保存本地草稿和缓存
- **首次建图**：人和 Agent 先商量第一层怎么切（可以先给几种拆法或较多候选），定了再拆第二层、第三层。卡名要一眼能看懂。之后会话打开这张图
- **人看工作台**：`prototype/workbench.html`。Agent 读小索引，不读整张地图
- **用户原话**：写进 `user-messages.md`；密钥只在 `private/`
- **记录语言**：按项目选择中文或英文，同一 Git 项目的各个工作树共享
- **生命周期**：首次 Session 自动建档、记录用户消息，并在识别到 bad case 后通过统一命令落盘

第一版**没有** Roadmap HTML、测试中台、功能链。

## 工作台

人在 `prototype/workbench.html` 里看图。Agent 读 `.codex/context/` 里的小索引，不操作画布。

**云端：** Cloud 首页只汇集多个项目入口，每个项目独立维护自己的 Map。公开页面只读；通过工作台令牌授权后的 Cloud 工作台可以编辑。项目使用独立同步令牌和事件流，不共享管理令牌。

**本地：** 每次生命周期回复先校验真实 Session 的绑定。未绑定时询问要使用哪个项目工作台，不建图、不启动服务、也不自动打开浏览器。用户确认后，同一 Git 项目的多个工作树复用一个服务，但各自 Session 视图隔离。全局私有注册表位于 Skill 安装目录之外，升级后继续复用项目域名与既有绑定；已绑定但暂时失效的 Session 会按项目身份自愈，不重复询问。

**本仓库开发规范：** 源码照原有分支/PR 规则进入 GitHub main，整个 `.codex/` 不进 Git 或分发产物。所有开发记忆从用户指定的私有服务器读取，本地仅作缓存；Session 记忆隔离，All Sessions 只读服务器上与已合并主分支对应的基线。私有服务/客户端和本地自动化验收已实现；真实部署、原生 Hook 信任验证和历史迁移仍需另行批准，见 [服务器记忆规范](references/server-memory.md)。其他项目不会自动继承本仓库的服务器配置。

```bash
context-guard workbench --binding-status --root /path/to/project --session <真实-session-id>
context-guard workbench --root /path/to/project --session <真实-session-id> --workbench-url http://项目名.localhost:1355/prototype/workbench.html
context-guard workbench --diagnose --root /path/to/project --session <真实-session-id>
# 仅在用户明确确认迁移已有绑定后使用：
context-guard workbench --root /other/worktree --session <真实-session-id> --rebind
context-guard workbench --root /path/to/project --stop
```

本地入口默认使用 `http://项目名.localhost:1355`（端口被占用时选择后续可用端口），无需安装全局 Portless。同项目共用服务，但每个 Session 仍须明确绑定。绑定先校验域名、项目、后端实例和运行时能力，成功后才落盘；返回地址带 Session 参数，其他任务变活跃不会自动切换当前页面。兼容命令 `workbench bind --root <当前工作树> --project-root <已有地图的工作树>` 只选择服务目标，不代替 Session 绑定、不合并 Map。旧或重复服务先用 `--diagnose` 清点，再按输出的精确 `pid:instance` 执行 `workbench migrate --retire ...`；迁移先做私有备份且不会强杀进程。

详见[命名工作台](references/named-workbench.md)。精简路由存储基于 Portless 0.15.6，遵循 Apache-2.0；[第三方声明](THIRD_PARTY_NOTICES.md)与许可证随安装包分发。

顶栏最右 **设置** 里切界面语言和主题。地图上的标题、用途、记忆仍按写入时的语言，不整页翻译。

### 总览

第一页 4–8 张主干模块卡。点一张进入。未修 Bug 在右侧列表。

![工作台总览](docs/shots/workbench/overview.png)

### 进入模块

开工单元挂在模块下面，只画从属实线。

![模块内部](docs/shots/workbench/module.png)

### 模块关系

点「关系」再点一张卡，只高亮它的生产/消费，其它变暗，不会进入该模块。

![模块关系](docs/shots/workbench/relations.png)

### 会话流动

点一条挂了会话的 Bug。从根到该节点的链路亮起来，当前会话沿线流动。

![会话流动](docs/shots/workbench/session-flow.png)

### 授权模式

「授权模式」标出这次会话 Agent 能读哪一段。灰色卡未授权。

![授权模式](docs/shots/workbench/auth-mode.png)

## 安装

使用 npx 安装。安装器会检测 Codex、Cursor 和 Claude，把 Skill 与生命周期 Hook 一起安装并安全合并现有配置：

```bash
npx @michelj/context-guard install
```

也可以全局安装，让 npm 包自动安装到检测到的客户端：

```bash
npm install -g @michelj/context-guard --registry=https://registry.npmjs.org
```

强制安装到三类客户端：

```bash
npx @michelj/context-guard install --platform all
```

默认会安装 Hook；如果只想复制 Skill，可以显式关闭：

```bash
npx @michelj/context-guard install --no-hooks
```

默认目录分别是 `~/.codex/skills/context-guard`、`~/.cursor/skills/context-guard` 和 `~/.claude/skills/context-guard`。安装器会备份并合并现有 Hook/Settings；Codex 同时启用 `[features] hooks = true`，并迁移旧的 `codex_hooks` 别名。

npm 包正式发布前，也可以直接从 GitHub 使用：

```bash
npx github:Michel-Johnson/Context-Guard-Skill install
```

也支持手动安装：

```bash
git clone git@github.com:Michel-Johnson/Context-Guard-Skill.git
cd Context-Guard-Skill
mkdir -p ~/.codex/skills/context-guard
rsync -a --delete \
  SKILL.md README.md README.zh-CN.md agents prototype references scripts \
  ~/.codex/skills/context-guard/
```

安装后相应客户端应该能发现：

```text
~/.codex/skills/context-guard/SKILL.md
~/.cursor/skills/context-guard/SKILL.md
~/.claude/skills/context-guard/SKILL.md
```

## 发布

这个 npm 包不使用 GitHub Release 作为交付入口。用户从 npm 安装 skill，因此正式发布由版本标签驱动：

1. 把 `package.json` 更新到下一个稳定版本，并将该提交合入 `main`。
2. 在该提交上创建完全匹配的 `vX.Y.Z` 标签。
3. 推送标签；`.github/workflows/npm-publish.yml` 会校验、打包、安装冒烟，并把同一份 tarball 发布到 npm。

该 workflow 没有手动触发入口。推送匹配的版本标签后，GitHub 会自动执行完整发布流水线；验证通过的 tarball 会作为 GitHub Actions Artifact 保留 14 天。它复用 `Michel-Johnson/Context-Guard-Skill` 已有的 npm Trusted Publisher，workflow 文件名保持 `npm-publish.yml`，允许 `npm publish` 操作；Actions 发布不需要本地登录 npm。完整步骤见 [npm 发布与恢复手册](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/main/docs/npm-release-runbook.md)。

## Context 保存在哪里

Context 必须保存在当前打开的本地项目里（不随客户端改变）：

```text
<当前项目根目录>/.codex/context/
```

不要把 context 写到：

- skill 安装目录
- chat/thread 名称对应的目录
- 临时目录
- SSH 远程服务器路径

对后续工作有价值的短用户消息会保存在：

```text
<当前项目根目录>/.codex/context/user-messages.md
```

如果用户提供了后续需要复用的凭据，Context Guard 只会在公开 context 中记录脱敏指针。原始凭据必须只保存在本地私有目录：

```text
<当前项目根目录>/.codex/context/private/
```

如果手动运行脚本：

```bash
python3 scripts/context_guard.py init --root /path/to/project
python3 scripts/context_guard.py set-language --root /path/to/project --language 中文
```

第一次 Session 若 `record_language` 仍为 `unset`，Hook 会要求 Agent 先询问“中文还是 English”，保存后后续 Session 不再重复询问。`workbench` 命令会启动本机服务并返回浏览器地址。

## 常用方式

```text
Use $context-guard. 四块：会话、坏例、任务、地图。
```

```bash
python3 scripts/context_guard.py init --root /path/to/project
python3 scripts/context_guard.py set-language --root /path/to/project --language 中文
python3 scripts/context_guard.py workbench --root /path/to/project
context-guard doctor --platform codex --root /path/to/project
```

运行 `context-guard workbench --root /path/to/project` 看图。顶栏按 `平台-thread名称` 显示（例如 `codex-basic`），设置中可切换会话；Session ID 只作为内部标识，授权会在工作台重启后保留。用带 `--session` 的 `record-bad-case` 和 `record-bad-case-fix` 完成最小坏例闭环，用 `write-candidates --input ...` 生成并校验首次建图候选。`archive-session --files ...` 会保存本 Session 的耐久结果，并把摘要写入由 `owns` 覆盖的已确认 Map 节点。没有节点覆盖的修改保持“未分类”，不会自动生成节点；只有通过 `archive-session --input ...` 显式归属配套文件，或提交带证据的新职责节点提案，才会改变 Map，提案仍需用户确认。

Codex 安装 11 个生命周期 Hook（不含 `SessionEnd`）。它们在会话开始、用户输入和压缩恢复时把真实 Map、授权、待办/坏例和其他 Session 的变更送给 Agent；在计划首次修改前只做一次云端 `prepare`，完成后检查冲突并要求 `sync finish`。用户的新要求由 Agent 按语义写入 Map TODO；`TODO.md` 只允许用户维护。所有 Hook 事件都有事件编号和发生/记录时间。

## 主要文件

```text
.codex/context/
|-- FIND.md
|-- sessions.jsonl
|-- sessions/
|-- bugs-index.json
|-- bugs/ 和 fixes/
|-- tasks/
|-- map.json
|-- owns-index.json 和 cards/   # 生成
|-- preferences.json
|-- user-messages.md
`-- private/                     # gitignored
```

见 [`SKILL.md`](SKILL.md)（一页）和 `.codex/context/FIND.md`。

## 本地工作台同步

使用 `context-guard map read` 读取权威节点，`map apply` 提交操作。请求关联真实会话、基准内容版本和稳定操作编号。浏览器缓存只保存恢复草稿，静态页面只读。Hook 和上下文初始化仍需要 Python。详细命令、错误语义与旧缓存迁移见 [接口说明](references/workbench-interface.md)。

## 云端事件同步

连接后，Cloud Sync 通过项目级 SSE 事件流接收变化，不定时扫描或全量覆盖。Agent 开发前运行 `sync prepare`，开发完成后运行 `sync finish`；期间出现不相关变化会自动重放，重叠节点、字段或文件会返回 `WORK_IMPACT` 并保持未验证。

```bash
context-guard sync connect --root /path/to/project --url http://cloud-host:8788 --project project-id --token project-token
context-guard sync prepare --root /path/to/project --session "$CODEX_THREAD_ID" --nodes N1 --paths src/example.js
context-guard sync finish --root /path/to/project --session "$CODEX_THREAD_ID"
```

详细协议见 [Cloud Sync 接口](references/cloud-sync-interface.md)。在新服务器安装、创建项目凭据、连接工作副本或迁移服务时，按 [Cloud 部署指南](references/cloud-deployment.md) 操作；云端仍属于本仓库，持久数据和密钥放在仓库外。
