# Context Guard 宣传页

独立静态站，展示 Context Guard 的实际工作台与协作流程。本轮以 [Cursor 官网](https://cursor.com/cn) 的短文案、大幅产品演示和克制排版为参考，收敛原 04 Editor Cinematic 外层。工作台仍直接复用 `prototype/workbench.html`，不改写产品界面或添加虚构能力。

演示使用预设数据。光标移动、点击、逐字输入和镜头取景连续展示操作过程，不启动 Agent，不调用模型 API，不读写本机项目，也不执行安装、代码修复或测试。

## 本地开发

站点需要 Node.js 22.12+；Actions 使用 Node.js 24。Skill 本身的 Node.js 18+ 要求不变。

```bash
cd site
npm ci --ignore-scripts
npm run dev
```

打开终端打印的 `/Context-Guard-Skill/` 地址。默认端口 4173；被占用时可使用 `npm run dev -- --port 4186`。没有 React Fast Refresh 插件，更新可能重载页面并重置演示。

```bash
npm run build
npm run preview -- --port 4187
```

构建先生成隔离版原工作台，再检查 TypeScript 并输出静态文件。产品源码变化后须重新运行 dev/build。只发布 `site/dist/`；`node_modules`、`dist`、`public/generated` 不提交。

## 中英文版本

右上角 `EN / 中文` 切换整站语言。英文直达 `/Context-Guard-Skill/?lang=en`，中文直达 `?lang=zh`，可附加 `#clients`、`#workbench` 等原有锚点。优先级为有效 URL 参数、上次选择、浏览器语言；不支持浏览器存储时，URL 切换仍有效。

`src/locales/en.json` 集中维护英文文案；`src/locale.ts` 翻译演示数据值，保留客户端 ID、节点 ID、文件路径及安装命令。`src/i18n.tsx` 管理页面语言、标题、描述和分享元数据。切换语言会从头准备当前客户端演示，避免同一对话混入两种语言；不会修改真实项目的记录语言。

英文版覆盖四端对话、首用七章、接续与 Bug 场景、工作台示例内容、Debug、安装反馈和折叠说明。英文首用示例回答选择 English，随后展示 `--language en`。英文需求和回复按14ms/字符输入，中文24ms；调用命令仍为28ms/字符，完成整句后才发送或接续。

构建同时生成 `workbench.html` 与 `workbench-en.html`。英文副本使用产品已有英文控件，只翻译宣传示例数据，并将偏好响应设为英文；两种副本仅展示 Context Guard 示例项目。构建检查地图中每条中文都有译文；初始根节点也须本地化，因为产品 `adoptTree` 不覆盖其 purpose。正式工作台源码不变。

## 按屏翻页

站点外层分为首页、工作台、客户端使用、项目记忆、Debug 和安装六页。页面本身固定为当前视口，不使用长文档滚动；页头链接、底部前后页按钮、页码线和 `PageUp / PageDown`、上下方向键共用同一页状态。键盘焦点位于按钮、标签、输入框或选择器时不会触发外层翻页，避免抢走演示操作。

`#workbench`、`#clients`、`#memory`、`#debug`、`#install` 仍是可分享的直达链接。翻页更新 URL 历史，浏览器前进/后退会恢复对应页面；切换中英文保留当前页。隐藏页保留组件状态但移出显示与焦点序列，客户端时钟在隐藏时冻结，返回后继续。

工作台、客户端和 Debug 的展示宽度同时受视口高度约束，使标题、产品画面和必要控制位于同一屏。窄屏使用原产品画面的等比取景；客户端的七章与两个后续场景合并到移动选择器，不因适配删除功能。工作台内部的标签、缩放、拖动、自由体验和 iframe 操作仍由原控件处理。

## 演示与产品行为

| 演示 | 产品实现依据 | 预设与限制 |
| --- | --- | --- |
| 项目地图 | `onNodeClick`、`enterView`、`renderDetail` | 使用内置地图，沿模块和面包屑下钻、返回 |
| 记忆与想法 | 原生 +、内联编辑、`persist` | 在原控件逐字输入；改动仅在页面内，刷新恢复 |
| 模块关系 | 关系按钮、`flowPartners`、`renderMap` | 点选高亮关系，再通过进入操作下钻 |
| 逐层建图 | `loadLensDoc`、`enterLensMode`、`attachCandidate`、本层加入 | 内存提供同格式候选文件；选入 M1–M4 四张有效候选，通过真实校验后定稿并加入 |
| 提议确认 | `proposedTree`、`acceptProposal`、`cancelProposal`、`renderTray` | 连续加入“工作台”，再隐藏另一张“冷启动”提议，不把同一卡片的互斥结果拼在一起 |
| 会话范围 | `toggleAuth`、`moduleAuthState` | 选择或取消模块子树范围；不是操作系统权限隔离 |
| Bug | 原生列表、所属路径、认领、`crossBug` | 从 B20 进入链路与条目；勾选后的 1600ms 原型计时转为休眠，不代表完成修复或验证 |

候选搁板仍来源于产品内置地图。CI/CD 候选不能通过当前产品校验，因此自动演示不选入它，也不绕过校验。先前“五个主干全部通过”的验收判断已撤回，当前以四张有效候选的最终状态为准。

“使用演示”包含 Codex App、Codex CLI、Cursor、Claude Code 四个独立入口，共享首次使用七章、接续项目和反馈 Bug。安装位于下方独立区域。Codex App 已按同版本本机窗口截图修正可见结构；本轮英文网页回放见 `QA.md`，未实拍原生状态与环境缺口见参考清单，不宣称逐像素还原。

## 客户端使用演示

| 客户端 | 对话输入 | 官方依据 |
| --- | --- | --- |
| Codex App 本地项目 / 新任务 | `使用 context-guard skill，继续这个项目。先回顾上次进度、未完成事项和下一步。` | [Skills & Plugins](https://learn.chatgpt.com/docs/skills-and-plugins) |
| Codex CLI / 项目终端 | `codex` 启动后输入 `$context-guard 继续这个项目。先回顾上次进度、未完成事项和下一步。` | [CLI developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli) |
| Cursor Agent Chat | `/context-guard 继续这个项目，先回顾上次进度，再说明下一步。` | [Skills](https://cursor.com/docs/skills)、[Hooks](https://prod.cursor.com/docs/hooks) |
| Claude 桌面 Code 标签 / 本地项目 | `/context-guard 继续这个项目，先回顾上次进度，再说明下一步。` | [Desktop: use skills](https://code.claude.com/docs/en/desktop#use-skills) |

安装命令来自本仓库安装器。四个展示端映射到三个安装平台：App/CLI 均使用 `codex`。演示以 Skill 已安装且当前客户端能发现为前提。CLI 使用 `$` 直接选择 Skill，也可从 `/skills` 浏览；`codex resume` 恢复客户端会话，不等于 Skill 在新会话读取项目记忆。Cursor 在 Agent Chat 输入 `/`；Claude 限定桌面 Code 本地会话。App 使用自然语言显式调用，不虚构 CLI 菜单或未核实的选择器。

先前用同一套暖色聊天壳代表三客户端的方案已被用户否决，不能继续作为验收基线。当前界面依据：

- Cursor：本机 3.17.8 的1280×800实际窗口，176px文件树、640px编辑区、464px Agent 面板；现场查看底部输入框及 `/` 浮层，未发送消息。临时输入已清除，原会话保留。仅以界面结构为参照，不发布用户实际截图、会话内容或本机路径。
- Cursor 外壳再次对照真实窗口：补齐空编辑区标志、独立键帽、标题栏和页签图标，纠正文件树缩进/行高、README 图标及输入区密度。图形使用矢量轮廓，不放大截图；当前版本、取材边界及素材许可见 `docs/cursor-reference.md`。本次只读查看后恢复原最小化状态，未输入或发送消息。
- Claude：依据[官方桌面重设计公告](https://claude.com/blog/claude-code-desktop-redesign)及[官方视频画面](https://www.youtube.com/watch?v=rWaQSQEm_aY)，仅重建已看见的独立会话 pane，不补画未核对的侧栏或技能菜单；不声称完整 App 逐像素复刻或覆盖所有版本。
- Codex App：只读本机 26.825.5331.0 安装包，并按用户要求自行写脚本截取可见窗口，不使用 Computer Use。按实拍修正侧栏、菜单、配色和输入工具栏；仅使用虚构演示项目，截图和私人内容不发布。未拍到的状态与网页验收局限见 `docs/codex-reference.md`。
- Codex CLI：0.151.0 官方 TUI 源码及快照，独立等宽终端、启动提示、`$` 选择列表、输入与文本输出；终端窗口大小属于演示取景设定，不代表所有终端的固定尺寸。

教学步骤、播放方式和复制都在 App 窗口外。窗口内保留对应客户端的结构和中性配色，输入在发送后清空，工具读取是紧凑文本行；Cursor 的菜单浮在输入框上方，不使用常驻 Skill 卡。界面是依据参考编写的前端重建，对话、文件名和项目为预设，不是实际运行记录。模型与权限文字仅还原参考状态，不修改本机配置。

App / Cursor 画布1280×800、CLI1040×800、Claude会话区640×800。外层只等比取景，不挤压内部面板和字体。输入、回复和全窗共用连续镜头；长回复随聊天滚动跟进。小屏保持完整客户端比例，文字会随画面缩小，不能据此宣称小屏已具备桌面字号。浏览器访问条件和对应构建的实际截图、操作、剩余缺口见 `QA.md`，旧版通过记录不代替新版验收。

`npm run test:camera` 检查真实画布尺寸、固定取景倍率、连续移动、换章归零、暂停恢复、不同采样频率及全窗反向切换。这些是源码/数学回归，不代替真实页面的可读性与流畅度验收。

`node --experimental-strip-types --test scripts/client-timing.test.mjs scripts/native-camera.test.mjs` 检查安装映射、发送前完整输入、回复停留、Unicode字符和四端镜头边界。需要实际性能采样时用 `npm run build -- --mode qa`；仅 QA 构建将帧间隔分布、长任务、长动画帧及阻塞时长写入 `data-playback-sample`，不联网、不收集输入。指标明确列出浏览器是否支持对应API；不支持不能当作零阻塞。交付前运行普通 `npm run build` 移除采样。

App 演示只保留一份导航：首次使用七章直接展开，接续工作和 Debug 在其后。移除上方重复章节栏与独立的“打开工作台”场景；打开工作台的过程保留在第三章，之后直接进入同一播放器内的真实工作台。完整/单章播放控件也归入这份导航，当前项随自动播放同步；从其他场景可直接跳到任一首次使用章节。

桌面导航固定156px宽、间隔16px；中等宽度用网格，620px以下用章节选择框。外层只保留导航、当前步骤、必要按钮和错误反馈；官方使用条件与演示边界放入折叠说明。

首次使用七章：调用 → 确认语言 → 打开工作台 → 空白项目 → 讨论第一层 → 确认并建图 → 留下记忆。五轮客户端对话保留前文；最后从工作台回到客户端交代已记录的决定与下一步。后续输入不重复调用命令，中文版选择中文、英文版选择 English，仅为示例，不代替实际用户选择。

完整播放自动接续，到最后停止；单章播放在本章结束后暂停。任意跳章先恢复前置状态，正常从建图进入记忆则保留同一地图与 iframe。工作台通过完成事件接续，没有用固定秒数猜测加载或操作是否结束；直接操作画布会暂停导览，播放按钮恢复为重播本章。减少动态时显示当前章完成状态，用章节按钮继续。

“查看全窗 / 聚焦操作”只切换视角，不改变播放状态或进度：正在播放时继续打字并接续章节，已经暂停时仍保持暂停。两种状态都保留柔和镜头过渡，不需要因为查看全窗而重新点击播放。

工作台的暂停事件只影响当前工作台章节；隐藏或退场画面的延迟消息不能暂停App动画。排查预览问题时使用带当前构建参数的页面链接完整重载；同一地址仅变化 `#clients` 不保证重新加载脚本。资源健康检查需同时核对状态码与MIME，避免将缺失资源的HTML回退误认为有效JS。

章节不重挂聊天组件，已完成消息保留稳定 key。滚动按时间增量连续追随新增内容，不因每个字符重新启动补间。离开客户端保留完整画面，工作台发出 `prepared` 后才进行480ms叠化，过渡结束后才运行操作；完整进度跨章累计。切换客户端保留各自章节和播放意图，隐藏端冻结。

命令从首字符输入：调用命令28ms/字符，中文需求和回复24ms/字符、英文14ms/字符；CLI的启动命令也逐字出现。时序按客户端实际调用文本长度计算，发送前输入必须完整。镜头、菜单、工具记录和结果入口共用一套时序。

输入结束后180ms发送，工具记录间隔180ms，回复结束后保留700–1200ms阅读时间。工作台普通步骤450ms、写入后800ms；产品1600ms Bug原型计时保留。总时长随语言和输入长度变化，以完成事件接续，不用固定时长跳过尚未结束的动作。

客户端动画由文字、CSS 和 SVG 构成。镜头层不使用常驻 `will-change: transform`，避免把缩小后的光栅缓存继续放大；脚本缩放允许按当前比例重绘，平移按设备像素对齐。不要用固定截图、`translateZ(0)` 或新的常驻缓存提示替代此方案；清晰度与过渡性能的实际验收状态见 QA.md。

- 首次使用：先展示语言提问，再逐字播放示例用户的语言回复、设置记录语言、请求打开工作台与讨论候选。在真实工作台选入四张有效候选、定稿并确认，再在刚建立的模块记录决定与下一步；不提前生成第二层，不宣称已经保存到用户项目磁盘。
- 接续工作：查 FIND.md 和 sessions.jsonl 最近记录，再按需读取命中项；示例进度不是自动检索所有历史聊天。
- 工作台：展示在对话中请求启动或复用本地服务、取得链接的过程；本站按钮进入隔离演示，不伪造本机可用地址。实际手动入口仍为 `npx @michelj/context-guard workbench --root "."`。
- Debug：先记录已报告的现象，未知原因标待确认，再查坏例与模块归属；不展示虚构的代码修复、通过测试或一键解决结果。

兼容性提示：当前仓库安装器把 Codex Skill 写入 `~/.codex/skills`；所查最新官方文档列出 `~/.agents/skills`。不同版本发现规则需要实际核验，页面明确要求当前任务能发现 Skill，未修改安装器或声称所有版本必然可用。

## 动画与操作

- 六个功能章节与 Debug 使用同一套连续导览。可见区域播放光标移动、点击反馈、原位输入和镜头取景，整段结束后循环。
- 播放与暂停控制同一逻辑时钟。暂停保留输入进度，并冻结演示中的 Bug 状态计时和原页面 CSS 动画；离屏或隐藏标签时不推进导览时间。
- 进度条可以定位预设步骤；重播恢复该章节的预设。切换章节取消旧导览，避免旧输入或计时继续修改新场景。
- 工作台输入整句共享时间轴，向同一文本节点追加字符并保持光标；App 使用独立动画时钟，对话仅在字符/阶段变化时更新，静态窗口不随每帧重渲染。
- iframe 通过可重试握手确认就绪；字体等待最多 1 秒，可见时初始化超时 10 秒显示重新载入。重复从 App 进入工作台或 Debug 只重置场景，复用已加载窗口；消息按 iframe 和场景标识过滤。
- “亲自试试”暂停导览并显示可操作的原画布；“返回演示”恢复预设。用户直接操作会停止当前脚本，原生拖拽和缩放仍由产品处理。
- “减少动态”关闭自动播放，取景和操作展示不使用过渡动画，保留控件和说明。

演示播放器没有重复的外层跟练按钮；站点底部的上一页/下一页只负责六个功能页面之间的切换。小屏通过镜头取景展示操作；自由体验保留桌面工作台并允许在产品画布内部滚动，不另外设计一套移动产品 UI。响应式实测状态见 `QA.md`。

## 结构与隔离

- `scripts/prepare-workbench.mjs`：读取产品 HTML、抽取内置地图，生成双语隔离副本。初始化前翻译示例数据，末尾 `boot()` 返回值交给导览，避免重复初始化；英文副本另翻译一条原生空项目记忆、文档语言和语言按钮提示。产品源文件与 CSS 不改，`source.json` 记录来源 SHA256 和生成差异。
- `src/workbench-tour.js`：驱动实际控件，管理可暂停的光标、输入、目标高亮和产品原型计时。找不到控件或校验未通过时停止，不伪造成功。
- `src/Workbench.tsx`：`TourStage` 管理 iframe、镜头、章节与播放控制。`src/stage.css` 只负责外层舞台。
- `src/DebugDemo.tsx`：复用同一舞台，展示原生 Bug 流程，不包含代码编辑器、修复差异或测试日志。
- `src/ClientDemo.tsx`：四客户端与场景选择；已访问客户端保留实例，隐藏端不播放。
- `src/UsageNavigation.tsx`：连续故事和独立片段共用唯一的流程导航；七章跳转、后续场景、播放方式及使用前提集中在同一处，章节状态仍由连续播放器持有。
- `src/ClientUsagePlayer.tsx`、`src/client-demo.css`：选择连续故事或独立片段，只挂载当前播放器；复制、播放控制及响应式导航不改变原生客户端布局。
- `src/NativeClientFrame.tsx`、`src/native-client.css`：分别重建有依据的Cursor IDE结构与Claude会话pane；没有共用虚构的项目记忆侧栏。
- `src/CodexAppFrame.tsx`、`src/CodexCliFrame.tsx`、`src/CodexCliConversation.tsx`、`src/codex-client.css`：Codex桌面与CLI各自布局，共享故事和播放时钟。
- `src/NativeConversation.tsx`：原生布局中的预设输入、清空、浮层和紧凑读取记录，不执行真实请求。
- `src/NativeViewport.tsx`：按实际控件边界计算取景，订阅共享时钟直接更新镜头，停稳不重复写样式；移动时连续插值，停稳再对齐设备像素。
- `src/app-usage.ts`：首次调用、接续工作和 Debug 三组对话及动画时间点；打开工作台的对话位于 `src/first-use-story.ts`，不再重复维护独立场景。
- `src/clients.ts`：共享客户端数据、安装命令与调用提示，供调用区和安装区使用。
- `src/App.tsx`、`src/styles.css`、`src/RecordGuide.tsx`、`src/Install.tsx`：宣传页排版、四类记录说明和安装入口。演示边界合并在一条折叠说明中。

iframe 只有 `allow-scripts` 权限，没有同源、文件系统、下载、弹窗或顶层导航权限。CSP 禁止外部连接；`fetch` 只返回内存中的地图、记录语言和候选响应。目录选择、文件选择和文件拖入被隔离。这里不接入正在运行的真实工作台，不收集演示输入。

Comic Neue、Libre Baskerville 使用产品相同字体的内嵌文件，不请求 Google Fonts。`assets/fonts/` 保留 OFL 许可，产物包含 `generated/font-licenses.txt`。产品源码保留核对和本轮最终构建结果单独记录在 `QA.md`，不以视觉相似代替验证。

## GitHub Pages

独立工作流 `.github/workflows/site-pages.yml`：从 `main` 构建并部署，宣传分支和 PR 只构建。手动运行也仅在 `main` 部署。工作台源码与 `SKILL.md` 更新触发重建，发布前运行现有时序与镜头检查。部署 job 单独获得 Pages/OIDC 权限，构建 job 只有读取权限。

只上传 `site/dist`，不上传真实 `.codex/context`，不改变 npm 包、版本或发布链。Pages Source 使用 GitHub Actions，`github-pages` 环境只允许 `main` 部署。网站源码与产品代码同仓维护，修改经原 PR/Required 检查后合入 `main`；`site/` 及其依赖不进入 Skill 安装包。

站点地址为 <https://michel-johnson.github.io/Context-Guard-Skill/>；实际发布状态以 `Promotion site` Actions 的部署结果为准。英文入口加 `?lang=en`，中文入口加 `?lang=zh`。用户已于2026-09-01授权部署；先前真实缩放与系统后台恢复的验收缺口见 `QA.md`，上线不表示这些项目已经验收。

参考：[Vite 静态部署](https://vite.dev/guide/static-deploy.html)、[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
