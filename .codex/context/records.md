# Context Guard 记录文件怎么存、怎么挂到 map

这是给工作台主线用的落盘方案。`map.json` 是唯一索引；Context Guard 自己记下的东西按「短的进节点、胖的进文件」拆。人在 HTML 里只看标题；Agent 按节点去打开正文。

旧的 `.codex/context/bad-cases.md` 整册登记、以及 `register-template.md` 那套 40 字段 / Test Hub，**不再当这份产品的真相**。可执行 always-run 守卫以后再说。

## 三种角色

| 角色 | 放哪 | 干什么 |
|------|------|--------|
| **索引** | `.codex/context/map.json` | 树、节点上的短记忆、Bug **桩**、源码 `owns`、附件路径 |
| **正文** | `.codex/context/bugs/{id}.md` | 现象 / 触发 / 根因 / 守卫。检查器不展示 |
| **证据** | `docs/shots/…`（或仓库里其它已有路径） | 截图、日志。只把相对路径写进桩上的 `files`。二进制永不进 `.codex/context/` |

另外两份全局文件不算节点记录：

- `user-messages.md`：人话流水。变成某个子系统的硬约束后，再 promote 成该节点的一条短记忆。
- `architecture.md`：首次分析长文，不是活树，不进检查器。

长记忆目录 `.codex/context/memories/` **先不建**。现在记忆都够短，只活在节点的 `memories[]` 里。真出现需要步骤、反例、长约束的条目时，再按 `memories/{nodeId}-{slug}.md` 拆，节点上留一句摘要 + `record` 路径。

## 节点上挂什么

```json
{
  "id": "N21",
  "owns": ["prototype/workbench.html"],
  "memories": [
    { "text": "一两句话的规则", "state": "success" }
  ],
  "bugs": [
    {
      "id": "B20",
      "title": "原生 prompt 会打断看图",
      "status": "open",
      "sessions": ["S-0812"],
      "files": [{ "path": "docs/shots/example.png" }],
      "record": ".codex/context/bugs/B20.md"
    }
  ],
  "files": []
}
```

四个字段不要混：

| 字段 | 含义 | 不是 |
|------|------|------|
| `owns` | 这个节点负责哪些**源码**（文件，或以 `/` 结尾的目录） | 不是截图，不是 bad case 正文 |
| `files`（节点 / 记忆 / Bug 上） | **证据附件**的仓库相对路径 | 不是所有权 |
| `memories[].text` | 人在检查器里能改的短句 | 不是 bad case 正文 |
| `bugs[].record` | 这篇坏例的正文文件 | 缺省也可按约定找 `.codex/context/bugs/{id}.md`；推荐写明，少漂移 |

`bugs[].desc` 逐步作废：工作台本来就不展示它。现象写进 `bugs/{id}.md`。

ID 用 map 上的 `B20`，不要再用 `BC-YYYYMMDD-001`。后者是旧登记册 / Test Hub 的编号。

## 短的进 map，胖的进文件

- **记忆 ≤ 两行**：只写在 `map.json` 该节点上。不另建文件。
- **Bug**：map 上只留桩（`id` / `title` / `status` / `sessions` / 证据 `files` / `record`）。现象、触发、根因、修复、守卫一律进 `bugs/{id}.md`。
- **检查器 / 右侧 Bug 面板**：永远只显示标题。不要把正文、模板字段、守卫命令灌进 HTML。

## `bugs/{id}.md` 写什么

用瘦字段，不要抄 `references/register-template.md`。模板见 `skills/context-guard/references/bug-record-template.md`。

```md
# B20 原生 prompt 会打断看图

- node: M2
- status: open
- 现象: …
- 触发: …
- 根因: …
- 修复: （未修可空）
- 守卫: 人能复述的检查，一句话；不是 Test Hub 脚本
- 证据: docs/shots/…
```

`node` 写挂桩的那个节点 id（模块或开工节点）。守卫先记成文字；不要在这里登记 `every-dev-completion`、feature chain、Stop-hook。

## 和 map 怎么配合

两件不同的事，串在同一张卡上：

```
改源码 X
    │
    ├─ owns 查找（scripts/map_owns.py lookup --path X）
    │     → 落到节点 N（以及更具体的 owns；没有主人就停在已授权祖先，不要发明节点）
    │
    └─ 在 N 上读 Context Guard 记下的东西
          1. N.memories 短句（已在 map.json）
          2. N.bugs 里 status=open 的桩（标题）
          3. 若存在 bugs/{id}.md（或桩上的 record），打开正文
          4. 同样读「已授权祖先」的短记忆 + 未修坏例正文（项目级约束）
          5. 不要读整张图，也不要把 bad-cases.md 当第二份清单
```

人侧：

```
工作台检查器、右侧面板 = 只标题
点标题打开 bugs/{id}.md = 以后再说，本方案不改 UI
```

Agent **记一条坏例**时一次写两处，不要只改其一：

1. 在责任节点的 `bugs[]` 推入桩（含 `record`）
2. 新建或更新 `.codex/context/bugs/{id}.md`
3. 截图落到 `docs/shots/`，路径进桩的 `files`

修完：桩 `status` 改成 `fixed`（或以后要的其它状态），正文里补修复和守卫；文件留着，不要从 map 上删桩，否则右侧面板和查找会丢历史。

## 全局文件怎么摆

| 文件 | 还干嘛 |
|------|--------|
| `map.json` | 活地图 + 短记忆 + Bug 桩。人改和工作台写回都在这里 |
| `bugs/*.md` | 坏例正文。一篇一例，文件名 = 桩 id |
| `docs/shots/` | 证据二进制 |
| `user-messages.md` | 全局人约束；子系统规则 promote 到节点记忆 |
| `architecture.md` | 首次分析 |
| `bad-cases.md` | **兼容入口**：只指向 map + `bugs/`，不再手写 Active Cases |
| `index.md` / `roadmap.md` | 遗留任务/路线图；主线坏例不往那里堆 |

不要：

- 在 `.codex/context/` 里再做一份平行记忆清单
- 把 `bad-cases.md` 和节点 `bugs[]` 同时维护成两份真相
- 把截图拷进 context 目录
- 为了这份方案去 bump 工作台 `STORE_KEY`（`record` 是可选字段，有就原样写回）

## 本仓库的样例

Context Guard 自己的图上已有两条桩，按本方案挂了正文：

- `B20` → `.codex/context/bugs/B20.md`（挂在工作台模块 M2）
- `B22` → `.codex/context/bugs/B22.md`（挂在 N22 `renderNode`）

OpenClaw 演示图里的 Bug 桩可以暂时只有标题，直到那条真是本仓要记的坏例。

## 还没做（等这版方案被接受后再开）

- 检查器点标题打开 / 预览 `bugs/{id}.md`
- 从 map 生成 `bad-cases.md` 目录
- `memories/` 长记忆拆文件
- Test Hub、feature chain、Stop-hook、`validate-bad-cases`
- 把旧 `BC-…` 登记册迁进 `bugs/`
