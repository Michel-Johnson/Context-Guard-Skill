# Context Guard Skill

语言：[English](README.md) | **中文**

Context Guard 是一个给 Codex 用的项目记忆 skill。它把任务主线、支线、bad case 和验证链路保存在项目自己的 `.codex/context/` 里，让 Codex 在不同 session 之间也能知道“现在做到哪里、踩过哪些坑、下次怎么检查”。

## 能做什么

- **维护项目 context**：自动创建并更新 `.codex/context/`。
- **记录路线图**：维护主线、支线、分叉节点和当前进度。
- **记录 bad case**：保存问题现象、触发条件、原因、修复方式和防复发检查。
- **生成 Roadmap HTML**：给用户查看清晰的路线图，点击节点看详情。
- **区分人类视图和 agent 视图**：HTML 给人看，Markdown/JSON 给 Codex 读取。
- **支持多语言记录**：按项目偏好用中文或英文写 context。
- **处理任务切换**：遇到新方向、支线任务或中断任务时，帮助 Codex park/resume。
- **测试由人类设计**：Codex 只复用已确认检查，或提出草案等待用户确认，不静默创建长期测试。
- **默认运行已确认测试**：用户创建或确认的测试，默认每次开发结束都要运行；只有用户说明不必每次运行时才降频。
- **提供测试中台入口**：`dev-complete` 会统一运行已确认的 always-run 测试，成功清理临时产物，失败保留证据。

## 安装

使用 npx 安装：

```bash
npx context-guard install
```

只有当你明确希望安装 Codex 生命周期 hook 提醒时，才加 `--with-hooks`：

```bash
npx context-guard install --with-hooks
```

npm 包正式发布前，也可以直接从 GitHub 使用：

```bash
npx github:Michel-Johnson/Context-Guard-Skill install
```

也支持手动安装：

```bash
git clone git@github.com:Michel-Johnson/Context-Guard-Skill.git
cd Context-Guard-Skill
mkdir -p ~/.agents/skills/context-guard
rsync -a --delete skills/context-guard/ ~/.agents/skills/context-guard/
```

安装后 Codex 应该能发现：

```text
~/.agents/skills/context-guard/SKILL.md
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

如果手动运行脚本，建议显式传入项目根目录：

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py show-roadmap --root /path/to/project
```

注册一个用户已确认的自动化测试：

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py test-hub-add \
  --root /path/to/project \
  --title "Markdown 预览渲染" \
  --command-text "npm test"
```

开发完成后交给测试中台：

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py dev-complete --root /path/to/project --jobs 2
```

## 常用方式

让 Codex 启用并维护 context：

```text
Use $context-guard to maintain this task context.
```

展示当前路线图：

```text
Use $context-guard to show the roadmap.
```

初始化项目 context：

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py init --root /path/to/project
```

设置记录语言：

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py set-language --root /path/to/project --language 中文
```

生成路线图：

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py show-roadmap --root /path/to/project
```

也可以用 npm CLI 作为轻量封装：

```bash
npx context-guard show-roadmap --root /path/to/project
```

创建支线任务：

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py create-branch-task \
  --root /path/to/project \
  --title "支线任务标题" \
  --branch "支线名称" \
  --parent-node NODE-YYYYMMDD-001
```

记录路线图节点：

```bash
python3 ~/.agents/skills/context-guard/scripts/context_guard.py checkpoint-roadmap-node \
  --root /path/to/project \
  --title "给 Codex 看的源标题" \
  --display-title "给用户看的短标题" \
  --user-request "用户实际提出的问题" \
  --progress-summary "当前进展" \
  --method-summary "采取的方法" \
  --branch Main \
  --level major \
  --outcome "结果"
```

## 主要文件

```text
.codex/context/
|-- index.md              # 快速索引和当前任务
|-- roadmap.md            # agent 可读路线图
|-- bad-cases.md          # bad case 登记表
|-- preferences.json      # 语言和项目偏好
|-- roadmap/
|   |-- roadmap.html      # 用户查看的路线图
|   |-- roadmap.md        # agent 快速读取版
|   `-- roadmap.json      # 结构化索引
|-- tasks/                # 任务级 context
|-- task-cases/           # 任务导向测试 case
|-- test-hub/             # 测试注册表、最近结果和失败证据
`-- bad-case-tests/       # 可复用 bad case 检查脚本
```

## 使用原则

- 路线图只记录关键进展，不记录每个小动作。
- 用户看的标题要像人话，不要像实现日志。
- bad case 要能帮助未来避免复发。
- 测试设计权属于人类；Codex 可以执行已确认检查，或提出待确认草案。
- 用户确认的测试默认是 `every-dev-completion`；只有用户要求时，Codex 才能改成其他运行频率。
- 已确认的自动化测试应进入 `.codex/context/test-hub/registry.json`，由 `dev-complete` 统一调度。
- 测试链路优先复用已有命令、脚本、截图或人工检查。
- 不要为了每个 bad case 都新写脚本。
- 前端或 HTML 改动结束前，应实际查看页面或截图，确认没有明显视觉错误。
- 任何新的长期测试 case 都先写简短草案，让用户确认后再变成 active 测试。

详细行为规则见 [`skills/context-guard/SKILL.md`](skills/context-guard/SKILL.md)。
