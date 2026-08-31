# Codex 客户端参考与边界

核对日期：2026-09-01。宣传站仅重建界面和预设过程，不启动 Agent、不发送对话、不执行演示中的命令。

## Codex App

- 本机安装包：`OpenAI.Codex 26.825.5331.0`。只读布局资源；用户明确要求自行写脚本截图、不用 Computer Use 后，使用 Win32 窗口枚举与 `CopyFromScreen` 截取同版本可见窗口。未激活、移动、缩放窗口，未输入或发送会话。
- 2026-08-31 实拍参考：1936×1096 PNG、96 DPI，含最大化外框与底部任务栏遮挡。仅核对可见的约240px侧栏、35px系统菜单区、46px会话栏、搜索/通知、新对话、任务缩进、主题颜色和输入工具栏。实际项目与会话内容不用于宣传。
- 按实拍改为中文菜单、侧栏顶部搜索/通知、项目下任务列表，输入栏为左侧权限与右侧模型/麦克风；移除旧的 `New chat / Search / Plugins` 三行和 `GPT-5.6 / Medium / Local` 排列。颜色取自截图无文字区域；会话内容最大宽度48rem同时核对安装包样式。
- 1280×800 是固定的演示画布，保留约240px侧栏及768px会话内容宽度，外层只等比缩放。参考窗口当时打开了右侧私人文档面板；演示采用面板关闭的会话布局，没有重建或发布该私人面板。不是完整窗口逐像素复刻。
- 自然语言明确提及 Skill 的方式参照[产品介绍](https://openai.com/index/introducing-the-codex-app/)及[Skills & Plugins](https://learn.chatgpt.com/docs/skills-and-plugins)。当前 App 内菜单与文档历史版本存在差别，因此没有补画未经核实的 `/skills` 或 `@` 选择器。
- 2026-08-31 英文版本续进：规定 Browser 工具已直接允许访问预览，App英文完整首用、全窗播放/暂停保持与两种短场景已实测，证据见 `QA.md` 最新节；未绕过前轮安全拒绝。英文菜单为同一参考结构的本地化，并非另有英文原生窗口实拍。
- 2026-09-01 新的同版本只读实拍补到右对齐用户气泡和完整运行中输入栏，白色停止按钮、麦克风和底部边界可见。同版本气泡样式明确为70%宽度上限、10/16px内边距、22px圆角；原演示88%/12×18px/18px已纠正。气泡与输入栏背景由原生空白像素核对为 `#2f2f2f` / `#2a2a2a`。证据为忽略目录 `codex-app-native-message-reference.json`，私人截图仍只在OS temp。
- 剩余原生参考边界：空闲输入按钮未在本次原生画面显示，真实DPR1.25/2与系统后台恢复仍未覆盖。不将网页截图替代原生实拍，也不声称完整窗口逐像素复刻。当前App通过明确提及Skill调用，没有绘制展开选择器，因此不把未使用的菜单当作新增实现或验收缺口。

## Codex CLI

- 本机 npm 版本：0.151.0；取材固定到官方 `rust-v0.151.0` 源码，未启动真实 CLI 会话或会话 Hook。
- [`skill_popup.rs`](https://github.com/openai/codex/blob/rust-v0.151.0/codex-rs/tui/src/bottom_pane/skill_popup.rs)：Skill 列表与提示。
- [Skills 菜单快照](https://github.com/openai/codex/blob/rust-v0.151.0/codex-rs/tui/src/chatwidget/snapshots/codex_tui__chatwidget__tests__skills_menu_default_mentions_shortcut.snap)：`$` 直接打开 Skill 列表，`/skills` 是另一个入口。
- [会话头部快照](https://github.com/openai/codex/blob/rust-v0.151.0/codex-rs/tui/src/history_cell/snapshots/codex_tui__history_cell__tests__session_header_halfwidth_directory.snap)：版本、模型、目录的文本布局。
- [输入选择快照](https://github.com/openai/codex/blob/rust-v0.151.0/codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__chat_composer__tests__skill_popup_accepts_digit_leading_skill.snap)：输入 `$`、选择后插入、Enter/Esc 提示。
- [CLI 命令文档](https://learn.chatgpt.com/docs/developer-commands?surface=cli)：恢复客户端会话与 Skill 读取文件中的项目记忆是不同操作。
- 1040×800 终端窗口、PowerShell 标签、`E:\demo-project` 目录和模型值为演示设定；会话、工具输出和项目数据都是预设，不是本机运行结果。未复制用户终端或私人数据。

## 资源与发布

只读安装包摘取和本地验收图放在工作树 `output/client-refinement/`，已加入忽略规则，不进入 `site/public`、`site/dist` 或 Pages。客户端界面用 DOM/CSS/SVG 绘制，不发布安装包资源或低清截图。

App/CLI 的展示 ID 分别为 `codex-app`、`codex-cli`，两者安装平台仍是 `codex`。当前安装器使用 `~/.codex/skills`，所查新文档使用 `~/.agents/skills`；演示前提为当前客户端已经发现 Skill，不声称所有客户端版本均已完成安装兼容性验证。
