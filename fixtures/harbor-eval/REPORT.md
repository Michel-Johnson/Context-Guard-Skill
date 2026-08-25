# Harbor 检索实验

同一份 Harbor 地图和坏例，投影成不同落盘，用同一组问题模拟 Agent 读盘。
`index` 是为了找到答案扫过的字节（例如整份 map.json）；`payload` 是会进模型上下文的切片。
假仓在 `fixtures/harbor/`，布局在 `fixtures/harbor-eval/layouts/`。

## 问法

- `edit-session`（edit-file）文件编辑：要拿到本节点裁剪规则和祖先「会话只由 Gateway 打开」
- `edit-auth`（edit-file）精确 owns 应打到 N121，不要停在 apps/gateway/ 目录主人 M1
- `edit-webchat`（edit-file）目录主人是 apps/control/，文件主人应赢
- `edit-linux-connect`（edit-file）三层目录 owns：nodes/ vs linux/ vs 文件
- `edit-canvas`（edit-file）inbox 里的 renderCard 没有 owns；改 canvas.ts 不应自动灌入子函数记忆
- `edit-shell-slot`（edit-file）槽文件有自己的卡；沙箱坏例在 N512，改槽不应默认打开 B-escape
- `edit-sandbox`（edit-file）真正改沙箱时才加载逃逸坏例
- `edit-handbook`（edit-file）没有 owns 的文档：查找应失败，而不是退回根上把整仓记忆灌进来
- `edit-drain`（edit-file）长记忆：切片加载只要这一段，整图加载会把所有节点散文一起读进来
- `symptom-none`（symptom）按现象搜：owns 帮不上，要能扫坏例正文/短记忆
- `symptom-tunnel`（symptom）中文现象词应打到 webchat 卡，而不是整份登记册
- `symptom-pairing`（symptom）一词多例：应拿到两条坏例，而不是整个渠道模块的入站适配器

## 汇总（平均 payload 字节 / 平均 index 字节 / 记忆召回 / 坏例召回 / inbox 泄漏）

| 策略 | payload 字节 | index 字节 | payload 文件 | 记忆召回 | 坏例召回 | inbox 泄漏 |
|---|---:|---:|---:|---:|---:|---:|
| A-all | 45227 | 0 | 1.0 | 0.92 | 0.92 | 1 |
| A-owns-slice | 953 | 45227 | 0.7 | 0.75 | 0.75 | 0 |
| B-owns+files | 734 | 37775 | 1.2 | 0.75 | 0.75 | 0 |
| B-hybrid | 900 | 38949 | 1.8 | 1.00 | 1.00 | 0 |
| C-all | 35153 | 0 | 3.0 | 0.92 | 0.92 | 1 |
| C-grep | 5870 | 7827 | 1.5 | 0.92 | 1.00 | 1 |
| D-owns+nodes | 747 | 27328 | 2.7 | 0.75 | 0.75 | 0 |
| E-index+files | 1276 | 6868 | 3.8 | 0.75 | 0.75 | 0 |

## 分题

### edit-session
文件编辑：要拿到本节点裁剪规则和祖先「会话只由 Gateway 打开」

| 策略 | payload | index | 记忆召回 | 坏例召回 | 多出来的记忆 | 多出来的坏例 | 泄漏 |
|---|---:|---:|---:|---:|---|---|---|
| A-all | 45227 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-dm, B-drain-race, B-escape, B-lines | — |
| A-owns-slice | 1842 | 45227 | 1.00 | 1.00 | R-root | — | — |
| B-owns+files | 1368 | 37775 | 1.00 | 1.00 | R-root | — | — |
| B-hybrid | 1368 | 37775 | 1.00 | 1.00 | R-root | — | — |
| C-all | 35153 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-dm, B-drain-race, B-escape, B-lines | — |
| C-grep | 7827 | 7827 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-dm, B-drain-race, B-escape, B-lines | — |
| D-owns+nodes | 1387 | 27328 | 1.00 | 1.00 | R-root | — | — |
| E-index+files | 2484 | 6868 | 1.00 | 1.00 | R-root | — | — |

### edit-auth
精确 owns 应打到 N121，不要停在 apps/gateway/ 目录主人 M1

| 策略 | payload | index | 记忆召回 | 坏例召回 | 多出来的记忆 | 多出来的坏例 | 泄漏 |
|---|---:|---:|---:|---:|---|---|---|
| A-all | 45227 | 0 | 1.00 | 1.00 | R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted, R-clip | B-caps, B-clip, B-dm, B-drain-race, B-escape, B-lines | — |
| A-owns-slice | 1655 | 45227 | 1.00 | 1.00 | R-gw-only, R-root | — | — |
| B-owns+files | 1295 | 37775 | 1.00 | 1.00 | R-gw-only, R-root | — | — |
| B-hybrid | 1295 | 37775 | 1.00 | 1.00 | R-gw-only, R-root | — | — |
| C-all | 35153 | 0 | 1.00 | 1.00 | R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted, R-clip | B-caps, B-clip, B-dm, B-drain-race, B-escape, B-lines | — |
| C-grep | 7827 | 7827 | 1.00 | 1.00 | R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted, R-clip | B-caps, B-clip, B-dm, B-drain-race, B-escape, B-lines | — |
| D-owns+nodes | 1243 | 27328 | 1.00 | 1.00 | R-gw-only, R-root | — | — |
| E-index+files | 2211 | 6868 | 1.00 | 1.00 | R-gw-only, R-root | — | — |

### edit-webchat
目录主人是 apps/control/，文件主人应赢

| 策略 | payload | index | 记忆召回 | 坏例召回 | 多出来的记忆 | 多出来的坏例 | 泄漏 |
|---|---:|---:|---:|---:|---|---|---|
| A-all | 45227 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | — |
| A-owns-slice | 1649 | 45227 | 1.00 | 1.00 | R-root | — | — |
| B-owns+files | 1225 | 37775 | 1.00 | 1.00 | R-root | — | — |
| B-hybrid | 1225 | 37775 | 1.00 | 1.00 | R-root | — | — |
| C-all | 35153 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | — |
| C-grep | 5078 | 7827 | 0.00 | 1.00 | — | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | — |
| D-owns+nodes | 1243 | 27328 | 1.00 | 1.00 | R-root | — | — |
| E-index+files | 2179 | 6868 | 1.00 | 1.00 | R-root | — | — |

### edit-linux-connect
三层目录 owns：nodes/ vs linux/ vs 文件

| 策略 | payload | index | 记忆召回 | 坏例召回 | 多出来的记忆 | 多出来的坏例 | 泄漏 |
|---|---:|---:|---:|---:|---|---|---|
| A-all | 45227 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | — |
| A-owns-slice | 833 | 45227 | 1.00 | 1.00 | R-root | — | — |
| B-owns+files | 543 | 37775 | 1.00 | 1.00 | R-root | — | — |
| B-hybrid | 543 | 37775 | 1.00 | 1.00 | R-root | — | — |
| C-all | 35153 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | — |
| C-grep | 0 | 7827 | 1.00 | 1.00 | — | — | — |
| D-owns+nodes | 701 | 27328 | 1.00 | 1.00 | R-root | — | — |
| E-index+files | 1025 | 6868 | 1.00 | 1.00 | R-root | — | — |

### edit-canvas
inbox 里的 renderCard 没有 owns；改 canvas.ts 不应自动灌入子函数记忆

| 策略 | payload | index | 记忆召回 | 坏例召回 | 多出来的记忆 | 多出来的坏例 | 泄漏 |
|---|---:|---:|---:|---:|---|---|---|
| A-all | 45227 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-caps-one, R-cdp-untrusted, R-clip, R-cron-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | R-card |
| A-owns-slice | 973 | 45227 | 1.00 | 1.00 | R-root | — | — |
| B-owns+files | 639 | 37775 | 1.00 | 1.00 | R-root | — | — |
| B-hybrid | 639 | 37775 | 1.00 | 1.00 | R-root | — | — |
| C-all | 35153 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-caps-one, R-cdp-untrusted, R-clip, R-cron-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | R-card |
| C-grep | 2749 | 7827 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-caps-one, R-cdp-untrusted, R-clip, R-cron-untrusted | B-drain-race | R-card |
| D-owns+nodes | 804 | 27328 | 1.00 | 1.00 | R-root | — | — |
| E-index+files | 1204 | 6868 | 1.00 | 1.00 | R-root | — | — |

### edit-shell-slot
槽文件有自己的卡；沙箱坏例在 N512，改槽不应默认打开 B-escape

| 策略 | payload | index | 记忆召回 | 坏例召回 | 多出来的记忆 | 多出来的坏例 | 泄漏 |
|---|---:|---:|---:|---:|---|---|---|
| A-all | 45227 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | — |
| A-owns-slice | 985 | 45227 | 1.00 | 1.00 | R-root | — | — |
| B-owns+files | 700 | 37775 | 1.00 | 1.00 | R-root | — | — |
| B-hybrid | 700 | 37775 | 1.00 | 1.00 | R-root | — | — |
| C-all | 35153 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | — |
| C-grep | 7827 | 7827 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | — |
| D-owns+nodes | 816 | 27328 | 1.00 | 1.00 | R-root | — | — |
| E-index+files | 1297 | 6868 | 1.00 | 1.00 | R-root | — | — |

### edit-sandbox
真正改沙箱时才加载逃逸坏例

| 策略 | payload | index | 记忆召回 | 坏例召回 | 多出来的记忆 | 多出来的坏例 | 泄漏 |
|---|---:|---:|---:|---:|---|---|---|
| A-all | 45227 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-lines | — |
| A-owns-slice | 1506 | 45227 | 1.00 | 1.00 | R-root | — | — |
| B-owns+files | 1201 | 37775 | 1.00 | 1.00 | R-root | — | — |
| B-hybrid | 1201 | 37775 | 1.00 | 1.00 | R-root | — | — |
| C-all | 35153 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-lines | — |
| C-grep | 7827 | 7827 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-lines | — |
| D-owns+nodes | 1162 | 27328 | 1.00 | 1.00 | R-root | — | — |
| E-index+files | 2033 | 6868 | 1.00 | 1.00 | R-root | — | — |

### edit-handbook
没有 owns 的文档：查找应失败，而不是退回根上把整仓记忆灌进来

| 策略 | payload | index | 记忆召回 | 坏例召回 | 多出来的记忆 | 多出来的坏例 | 泄漏 |
|---|---:|---:|---:|---:|---|---|---|
| A-all | 45227 | 0 | 0.00 | 0.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | — |
| A-owns-slice | 0 | 45227 | 1.00 | 1.00 | — | — | — |
| B-owns+files | 0 | 37775 | 1.00 | 1.00 | — | — | — |
| B-hybrid | 0 | 37775 | 1.00 | 1.00 | — | — | — |
| C-all | 35153 | 0 | 0.00 | 0.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | — |
| C-grep | 0 | 7827 | 1.00 | 1.00 | — | — | — |
| D-owns+nodes | 0 | 27328 | 1.00 | 1.00 | — | — | — |
| E-index+files | 0 | 6868 | 1.00 | 1.00 | — | — | — |

### edit-drain
长记忆：切片加载只要这一段，整图加载会把所有节点散文一起读进来

| 策略 | payload | index | 记忆召回 | 坏例召回 | 多出来的记忆 | 多出来的坏例 | 泄漏 |
|---|---:|---:|---:|---:|---|---|---|
| A-all | 45227 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-escape, B-lines | — |
| A-owns-slice | 1997 | 45227 | 1.00 | 1.00 | R-gw-only, R-root | — | — |
| B-owns+files | 1838 | 37775 | 1.00 | 1.00 | R-gw-only, R-root | — | — |
| B-hybrid | 1838 | 37775 | 1.00 | 1.00 | R-gw-only, R-root | — | — |
| C-all | 35153 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-escape, B-lines | — |
| C-grep | 7827 | 7827 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-escape, B-lines | — |
| D-owns+nodes | 1604 | 27328 | 1.00 | 1.00 | R-gw-only, R-root | — | — |
| E-index+files | 2879 | 6868 | 1.00 | 1.00 | R-gw-only, R-root | — | — |

### symptom-none
按现象搜：owns 帮不上，要能扫坏例正文/短记忆

| 策略 | payload | index | 记忆召回 | 坏例召回 | 多出来的记忆 | 多出来的坏例 | 泄漏 |
|---|---:|---:|---:|---:|---|---|---|
| A-all | 45227 | 0 | 1.00 | 1.00 | R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted, R-clip | B-caps, B-clip, B-dm, B-drain-race, B-escape, B-lines | — |
| A-owns-slice | 0 | 45227 | 0.00 | 0.00 | — | — | — |
| B-owns+files | 0 | 37775 | 0.00 | 0.00 | — | — | — |
| B-hybrid | 486 | 42470 | 1.00 | 1.00 | — | — | — |
| C-all | 35153 | 0 | 1.00 | 1.00 | R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted, R-clip | B-caps, B-clip, B-dm, B-drain-race, B-escape, B-lines | — |
| C-grep | 7827 | 7827 | 1.00 | 1.00 | R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted, R-clip | B-caps, B-clip, B-dm, B-drain-race, B-escape, B-lines | — |
| D-owns+nodes | 0 | 27328 | 0.00 | 0.00 | — | — | — |
| E-index+files | 0 | 6868 | 0.00 | 0.00 | — | — | — |

### symptom-tunnel
中文现象词应打到 webchat 卡，而不是整份登记册

| 策略 | payload | index | 记忆召回 | 坏例召回 | 多出来的记忆 | 多出来的坏例 | 泄漏 |
|---|---:|---:|---:|---:|---|---|---|
| A-all | 45227 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | — |
| A-owns-slice | 0 | 45227 | 0.00 | 0.00 | — | — | — |
| B-owns+files | 0 | 37775 | 0.00 | 0.00 | — | — | — |
| B-hybrid | 542 | 42470 | 1.00 | 1.00 | — | — | — |
| C-all | 35153 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | — |
| C-grep | 7827 | 7827 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-dm, B-drain-race, B-escape | — |
| D-owns+nodes | 0 | 27328 | 0.00 | 0.00 | — | — | — |
| E-index+files | 0 | 6868 | 0.00 | 0.00 | — | — | — |

### symptom-pairing
一词多例：应拿到两条坏例，而不是整个渠道模块的入站适配器

| 策略 | payload | index | 记忆召回 | 坏例召回 | 多出来的记忆 | 多出来的坏例 | 泄漏 |
|---|---:|---:|---:|---:|---|---|---|
| A-all | 45227 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-drain-race, B-escape, B-lines | — |
| A-owns-slice | 0 | 45227 | 0.00 | 0.00 | — | — | — |
| B-owns+files | 0 | 37775 | 0.00 | 0.00 | — | — | — |
| B-hybrid | 966 | 42470 | 1.00 | 1.00 | — | — | — |
| C-all | 35153 | 0 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-drain-race, B-escape, B-lines | — |
| C-grep | 7827 | 7827 | 1.00 | 1.00 | R-auth-none, R-browser-untrusted, R-canvas, R-caps-one, R-card, R-cdp-untrusted | B-auth-none, B-caps, B-clip, B-drain-race, B-escape, B-lines | — |
| D-owns+nodes | 0 | 27328 | 0.00 | 0.00 | — | — | — |
| E-index+files | 0 | 6868 | 0.00 | 0.00 | — | — | — |

## 怎么读这张表

- `A-all` / `C-all`：Agent 把整份索引当上下文。召回高，噪声也高；没有 owns 的文件（handbook）也会灌进全仓记忆。
- `A-owns-slice` / `B-owns+files` / `D-owns+nodes`：按文件找卡。改代码这条路对；按现象搜（`symptom-*`）这条路空，因为 owns 不看中文症状。
- `B-hybrid`：改文件走 owns，按现象扫 `bugs/` 和节点短记忆。这是推荐的 Agent 读法。
- `C-grep`：扁平登记册能按词命中，但命中的是整份 `bad-cases.md`，多例会互相污染。
- `E-index+files`：不打开整图，只打开 `owns-index.json` 和祖先卡片。index 字节应明显小于 B 的整份 map。

可复现：

```bash
python3 scripts/harbor_recall.py project
python3 scripts/harbor_recall.py eval
```

