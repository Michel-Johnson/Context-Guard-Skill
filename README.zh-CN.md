# Context Guard Skill

语言：[English](README.md) | **中文**

Context Guard 是一个给 Codex 用的项目记忆 skill。它把任务主线、支线、bad case 和验证链路保存在项目自己的 `.codex/context/` 里，让 Codex 在不同 session 之间也能知道“现在做到哪里、踩过哪些坑、下次怎么检查”。

## 能做什么

- **四块**：会话、坏例、任务、地图，都在当前项目的 `.codex/context/`
- **首次建图**：人和 Agent 先商量第一层怎么切（可以先给几种拆法或较多候选），定了再拆第二层、第三层。卡名要一眼能看懂。之后会话打开这张图
- **人看工作台**：`prototype/workbench.html`。Agent 读小索引，不读整张地图
- **用户原话**：写进 `user-messages.md`；密钥只在 `private/`
- **记录语言**：按文件夹选中文或英文

第一版**没有** Roadmap HTML、测试中台、功能链。

## 工作台

人在 `prototype/workbench.html` 里看图、点头。Agent 读 `.codex/context/` 里的小索引，不操作画布。

**当前工作台（本分支）：** [prototype/workbench.html](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/cursor/first-use-interactive-f54e/prototype/workbench.html) · [浏览器打开](https://raw.githack.com/Michel-Johnson/Context-Guard-Skill/cursor/first-use-interactive-f54e/prototype/workbench.html)

第一次打开可能会看到 GitHack 的提示页（它只是中转，没审过页面内容）。点 **Open the page** 就进工作台。

要自己定第一层：顶栏点仓库名，切到 **OpenClaw**（首次使用），点「看几种第一层切法」，选一种才上画布。仍是演示卡名，但切法是你定的。

顶栏 **中 / EN** 切界面语言。地图上的标题、用途、记忆仍按写入时的语言，不整页翻译。

本地从仓库根起一个静态服务，页面才能读到 `.codex/context/map.json`：

```bash
python3 -m http.server 8877
# 打开 http://127.0.0.1:8877/prototype/workbench.html
```

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

使用 npx 安装：

```bash
npx @michelj/context-guard install
```

也可以全局安装，让 npm 包自动把 skill 复制到 Codex 的 skill 目录：

```bash
npm install -g @michelj/context-guard --registry=https://registry.npmjs.org
```

只有当你明确希望安装 Codex 生命周期 hook 提醒时，才加 `--with-hooks`：

```bash
npx @michelj/context-guard install --with-hooks
```

该命令也会在 `~/.codex/config.toml` 中启用当前的 `[features] hooks = true`，并把已弃用的 `codex_hooks` 别名安全迁移，同时保留其他配置。

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
  SKILL.md README.md README.zh-CN.md agents references scripts tests \
  ~/.codex/skills/context-guard/
```

安装后 Codex 应该能发现：

```text
~/.codex/skills/context-guard/SKILL.md
```

## Context 保存在哪里

Context 必须保存在当前打开的本地项目里：

```text
<Codex 打开的项目根目录>/.codex/context/
```

不要把 context 写到：

- skill 安装目录
- chat/thread 名称对应的目录
- 临时目录
- SSH 远程服务器路径

对后续工作有价值的短用户消息会保存在：

```text
<Codex 打开的项目根目录>/.codex/context/user-messages.md
```

如果用户提供了后续需要复用的凭据，Context Guard 只会在公开 context 中记录脱敏指针。原始凭据必须只保存在本地私有目录：

```text
<Codex 打开的项目根目录>/.codex/context/private/
```

如果手动运行脚本：

```bash
python3 scripts/context_guard.py init --root /path/to/project
python3 scripts/context_guard.py set-language --root /path/to/project --language 中文
```

人看 `prototype/workbench.html`。`show-roadmap` 只打印这条路径。

## 常用方式

```text
Use $context-guard. 四块：会话、坏例、任务、地图。
```

```bash
python3 scripts/context_guard.py init --root /path/to/project
python3 scripts/context_guard.py set-language --root /path/to/project --language 中文
```

打开 `prototype/workbench.html` 看图。

## 主要文件

```text
.codex/context/
|-- FIND.md
|-- sessions.jsonl
|-- bugs/ 和 fixes/
|-- tasks/
|-- map.json
|-- owns-index.json 和 cards/   # 生成
|-- preferences.json
|-- user-messages.md
`-- private/                     # gitignored
```

见 [`SKILL.md`](SKILL.md)（一页）和 `.codex/context/FIND.md`。
