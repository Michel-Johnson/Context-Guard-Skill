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

## Harbor 实验：不同落盘对 Agent 的影响

假仓 `fixtures/harbor/`（约 59 个节点、42 个源文件、27 条记忆、12 条坏例），同一份语料投影到 `fixtures/harbor-eval/layouts/`。评测把 **index**（为了找到答案扫过的字节）和 **payload**（会进模型的切片）分开。复现：

```bash
python3 scripts/harbor_recall.py project
python3 scripts/harbor_recall.py eval
```

完整表在 `fixtures/harbor-eval/REPORT.md`。跑出来的形状是：

| 策略 | 改文件 | 按现象搜 | payload | index | 问题 |
|---|---|---|---|---|---|
| 整份 `map.json` 塞进上下文（A-all） | 召回高 | 召回高 | ~45KB | 0 | 噪声极大；没有 owns 的 `docs/handbook.md` 也会灌进全仓记忆；inbox 子函数记忆泄漏 |
| 扁平 `memories.md` + `bad-cases.md`（C-all / C-grep） | grep 命中往往是**整份登记册** | 能搜中文 | 5–35KB | 整册 | 一词多例互相污染；不能当第二份真相 |
| 只按 `owns` 切片（A/B/D/E 的 edit-file） | 召回完整 | **空** | ~0.5–2KB | 见下 | `owns` 不看中文症状 |
| **B-hybrid：改文件走 owns，现象扫 `bugs/` + 短记忆** | 完整 | 完整 | ~0.9KB | 仍要扫 map 或 bug 文件 | 推荐的 Agent 读法 |
| 镜像 `nodes/{id}.md`（D） | 与 B 接近 | 空（除非再 grep） | 与 B 接近 | 仍要走一遍 map | 文件多、易和 map 漂移 |
| `owns-index.json` + 祖先卡片（E） | 与 B 接近 | 空 | 略大 | **~7KB vs B 的 ~37KB map** | 图变大之后值得生成；不要手写 |

其它观察：

1. **短记忆进节点、胖坏例进 `bugs/{id}.md` 是对的。** 改 `session.ts` 时 B 的 payload 大约 1.4KB，A-all 是 45KB。长记忆（drain 关闭顺序）拆到 `memories/R-drain-order.md` 后，切片仍然只带这一段。
2. **不要把整份 map 当上下文。** map 当索引扫一遍可以（B 的 index ~37KB），但 payload 只能是命中节点 + 祖先短记忆 + 对应正文。
3. **按现象搜必须能扫 `bugs/*.md`。** 只做 owns 的策略在 `symptom-*` 上召回为 0。扁平登记册能搜到，但一次返回整册。
4. **inbox 里没有 owns 的子函数，改文件时不该被加载。** A-all / C 会漏出 `R-card`；owns 切片不会。这是产品语义，不是漏检。
5. **祖先记忆会带上根口号（`R-root`）。** 根节点记忆必须极短，否则每条文件编辑都吃一句空话。
6. **图变大后生成 `owns-index.json`。** `python3 scripts/map_owns.py index`。E 布局证明它把 index 从整图的几万字节降到几千。活地图仍是 `map.json`；index 是投影，改 owns 后重生成。
7. **lookup 必须带上祖先记忆。** 改 `session.ts` 需要本节点的裁剪规则，也需要 Gateway 上「会话只由它打开」。`scripts/map_owns.py lookup` 已返回 `ancestors[].memories`。

Agent 读本仓的约定因此收成两条：

- 改源码：`lookup --path` → 节点短记忆 + 祖先短记忆 + 未修 `bugs/{id}.md`（有 `record` 再打开长记忆）。
- 对现象 / 用户报错：在 `.codex/context/bugs/` 里搜，不要把 `bad-cases.md` 或整份 `map.json` 贴进上下文。

## 还没做（等人确认后再开）

- 检查器点标题打开 / 预览 `bugs/{id}.md`
- 从 map 生成 `bad-cases.md` 目录（实验已证明不要把它当真相）
- 本仓记忆仍短，不必建 `memories/`；Harbor 夹具里已演示长记忆拆文件
- 把 `owns-index.json` 做成工作台写回时自动投影
- Test Hub、feature chain、Stop-hook、`validate-bad-cases`
- 把旧 `BC-…` 登记册迁进 `bugs/`
