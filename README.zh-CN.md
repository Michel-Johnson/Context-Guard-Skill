[官网与交互演示](https://michel-johnson.github.io/Context-Guard-Skill/?lang=zh)

# Context Guard

语言：[English](README.md) | **中文**

**下一代人与编码 Agent 的协作层。**

多数工具仍把 *对话* 当成工作场所。线程即记忆、即审批面、即项目。对话一结束，下一个 Agent 从零开始。聊天里的一句「好」既不是授权，也不是发布，更不是可复用的记录。

Context Guard 把 **项目** 当成工作场所：

1. **一张共享 Map** — 模块、职责、Bug、待办和验证落在同一份耐久结构上。
2. **隔离的 Session** — 每次 Agent 运行写自己的 Session Map。对话不是 Main。
3. **在工作台里由人确认** — 普通提案、授权和发布发生在已鉴权的页面，而不是聊天附和。
4. **显式授权** — Agent 只读被允许的切片。灰色卡片不在范围内。
5. **发布进 Main** — 只有经过验证的工作进入已提交的 main 基线。Session 草稿仍是草稿。

它作为 Skill 和生命周期 Hook 安装到 **Codex**、**Cursor** 和 **Claude**。

[仓库文档与文件布局](docs/README.md) · [一页 Skill](SKILL.md)

## 为什么这是另一种范式

| 把对话当工作场所 | Context Guard |
| --- | --- |
| 历史在线程里 | 结构在 Map 上 |
| 下一轮从零开始 | 下一轮打开同一张 Map |
| 聊天里说「看起来可以」 | 人在工作台确认 |
| Agent 看见什么取决于粘贴了什么 | Agent 看见被授权的节点 |
| 记忆是对文件的检索 | 记忆是带版本与发布的项目状态 |

这不是又一份 prompt 包、RAG 目录，或「记住这个」插件。它是软件工作的 **人–Agent 操作环**：定位节点、确认意图、在 Session 中执行、验证，然后发布。

Coordinator / Developer / Tester 的角色提示词用于拆开规划、实现和检查。角色文本不等于协议权限。自动多 Agent 编排仍在推进；产品本身是协作契约（Map、Session、授权、人确认、Main）。

## 看工作台

人在工作台里看 Map。Agent 读小范围已授权索引，不操作画布。

**云端：** 配置 Cloud 后，它是唯一的人类工作台前端。本地服务负责同步和宿主投递。私有部署需要浏览器登录。设备每个项目登录一次，新 Session 复用该连接。

**本地：** 校验真实 Session 绑定并复用项目已有服务。首次配置、身份歧义和工作树迁移才需要人选择；已连接项目的新 Session 不必再选。

### 总览

第一页 4–8 张主干模块卡。点一张进入。未修 Bug 在右侧列表。

![工作台总览](docs/shots/workbench/overview.png)

### 进入模块

开工单元挂在模块下面，只画从属实线。

![模块内部](docs/shots/workbench/module.png)

### 模块关系

「关系」高亮生产/消费伙伴，其余变暗，不会进入该模块。

![模块关系](docs/shots/workbench/relations.png)

### 会话流动

点一条挂了会话的 Bug。从根到该节点的链路亮起来，当前会话沿线流动。

![会话流动](docs/shots/workbench/session-flow.png)

### 授权模式

「授权模式」标出这次会话 Agent 能读哪一段。灰色卡片未授权。

![授权模式](docs/shots/workbench/auth-mode.png)

顶栏最右 **设置** 里切界面语言和主题。地图上的标题、用途、记忆仍按写入时的语言。

## 安装

使用 npx 安装。安装器会检测 Codex、Cursor 和 Claude，把 Skill 与生命周期 Hook 一起安装并安全合并现有配置：

```bash
npx @michelj/context-guard install
```

也可以全局安装：

```bash
npm install -g @michelj/context-guard --registry=https://registry.npmjs.org
```

强制安装到三类客户端：

```bash
npx @michelj/context-guard install --platform all
```

默认会安装 Hook。只要 Skill：

```bash
npx @michelj/context-guard install --no-hooks
```

默认目录分别是 `~/.codex/skills/context-guard`、`~/.cursor/skills/context-guard` 和 `~/.claude/skills/context-guard`。安装器会备份并合并现有 Hook/Settings；对 Codex 还会启用 `[features] hooks = true`。

npm 包正式发布前：

```bash
npx github:Michel-Johnson/Context-Guard-Skill install
```

安装后，相应客户端应能在上述 Skill 目录发现 `SKILL.md`。

然后，在真实项目里：

```bash
context-guard workbench --root /path/to/project --session <真实-session-id>
context-guard doctor --platform cursor --root /path/to/project
```

本地入口默认是 `http://项目名.localhost:1355`。绑定钉住命名 URL、Git 项目、后端和 Session；不会因为更新的任务自动切换。见 [命名工作台](references/named-workbench.md)。

## 一轮怎么走

1. **打开 Map** — 首次使用：人和 Agent 一起锁定第一层（卡名要一眼能看懂），再拆第二层、第三层。之后的 Session 打开这张图。
2. **绑定 Session** — `context-guard workbench --root <项目> --session <真实-session-id>`。
3. **授权切片** — 人标出这次 Session 可以读什么。
4. **开工** — Agent 用 `map read` 读，用 `map apply` 写，必须带真实会话、基准版本和稳定操作编号。聊天附和不会写 Map。
5. **确认** — 普通提案在工作台等待。
6. **发布** — 经过验证的 Session 工作可以进入 Main。Session 草稿不是 Main。

第一次 Session 若记录语言仍未设定，Hook 会要求 Agent 先问「中文还是 English」，保存后后续 Session 不再问。

```text
Use $context-guard. 共享 Map、隔离 Session、人确认、发布进 Main。
```

常用命令：

```bash
context-guard workbench --binding-status --root /path/to/project --session <真实-session-id>
context-guard workbench --list --root /path/to/project
context-guard map read --root /path/to/project --session <真实-session-id> --node <id>
context-guard doctor --platform codex --root /path/to/project
```

`record-bad-case` / `record-bad-case-fix` 关闭失败/修复闭环。`archive-session` 把耐久的 Session 结果写到 `owns` 覆盖且已确认的 Map 节点上；没有归属的文件保持未分类，直到人确认归属。

Codex 安装 11 个生命周期 Hook（不含 `SessionEnd`）。它们在推理边界投递真实 Map、授权、待办/Bug 和其他 Session 的变更。用户的新要求写成 Map TODO。`TODO.md` 只由人维护。

## 云端

配置 Cloud 后，它是唯一的人类工作台前端。同步基于事件（项目级 SSE），不是定时全量覆盖。开发前 `sync prepare`，验证后 `sync finish`。不相交的变更会重放；重叠的节点、字段或文件返回 `WORK_IMPACT` 并保持未验证。

服务器安装、项目凭据和宿主迁移：[Cloud 部署](references/cloud-deployment.md)。协议：[Cloud Sync](references/cloud-sync-interface.md)。记忆权威：[服务器记忆](references/server-memory.md)。

## 文档

| 主题 | 入口 |
| --- | --- |
| Skill（一页，给 Agent） | [SKILL.md](SKILL.md) |
| 文档索引 | [docs/README.md](docs/README.md) |
| 工作台 / Map CLI | [工作台接口](references/workbench-interface.md) |
| 角色（Coordinator / Developer / Tester） | [roles.md](roles.md) |
| npm 发布 | [发布手册](docs/npm-release-runbook.md) |

本仓库把 **源码** 放在 GitHub `main`，把 **开发记忆** 放在用户指定的私有服务器。整个 `.codex/` 不进 Git 或 npm。其他项目不会继承本仓库的服务器配置。见 [RULE.md](RULE.md)。

本地 `.codex/context/` 是兼容缓存和草稿，不是第二份权威。Cloud Agent 阅读面正迁向 [Memory Filesystem v2](references/memory-filesystem-v2/README.md) 的 node/module Markdown；在该投影真正暴露之前，不要假装能直接读取服务器私有文件。
