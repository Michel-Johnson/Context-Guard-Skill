# User Message Memory

## Recent User Signals

- 已有项目拆成 map 是需要的功能。
- 架构图可以竖着也可以横着。
- 从仓库建立 map 应该是用户第一次使用 Context Guard skill 的时候。
- 希望点击标题后可以切换仓库。
- 希望当前的开发过程也加载 Context Guard skill。
- 如果做过任何 PR / MR，应该要通知用户。
- 为啥每次点进来都要重新构建。
- 初始建图不是瞬间的，需要 Agent 去理解、分析整个架构。
- 现在的架构分析太简单，真实项目不会停在这一层。下面必须有大量具体节点。
- 首次加载需要让 Agent 做 markdown 一类的整仓分析；可以先做确认门，再谈 markdown 格式。
- 追求速度导致没有细拆整仓，只列了简单架构，对不上真实开发粒度。
- 点击分析后要写明这是演示，没有真实 Agent 在读仓。

## Durable User Constraints

- Agent 记录，人确认/置顶/丢弃。
- 人在 HTML 里操作，不在 CLI。
- 不做 Test Hub / 功能链 / Stop-hook 门禁，直到工作台交互正确。
- 不要用 `window.prompt` / `confirm`。
- 模块卡只要标题和一句用途。
- Bug 是节点内容，不是子节点。
- 新会话默认很小，不要一次加载全部共享记忆。
- 回复使用中文。
- 之后会话直接打开已有地图，不要每次进来都重拆。
- 首次建图需要 Agent 理解架构，不是瞬间出图，也不是目录树。
- 分析粒度必须对齐真实开发单元；空壳三节点没有意义。
- 首次分析先写 architecture.md；地图 L1 只是确认门，下层已在笔记和 inbox 里。

## Secret Pointers

None.

Last updated: 2026-08-23
