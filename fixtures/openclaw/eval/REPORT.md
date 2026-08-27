# OpenClaw 难任务：四种找法

题目：外面打开控制台，页面出了、消息发不出。要同时交出根因、配置键、命令、卡上短规矩。
这四样分别在 `fixes/B70.md`、`tasks/J5.md`、`cards/N7p.md`，索引关键词对不上配置键。

夹具体量：context 122 个文件、115817 字节；三份必读正文 1225 字节。
墙钟是受试 Agent 从创建到交卷。自称打开 = 它交卷时列的文件。转写核对 = 实际工具次数和工具返回的字符数（更接近进模型的量）。

| 找法 | 四问 | 自称打开 | 自称读入 | 墙钟 | 实际工具 | 工具返回 |
| --- | --- | --- | --- | --- | --- | --- |
| grep-all | 4/4 | 8 | 3326 B | 60.3s | 12（含 1 次 Grep + 1 次 Glob） | 54264 字 |
| index-only | 4/4 | 8 | 17017 B | 61.4s | 10（全是 Read） | 20526 字 |
| jump-json | 4/4 | 6 | 2101 B | 157.2s | 24（2 次 jump，另 Grep 4 + Glob 3） | 52524 字 |
| follow-links | 4/4 | 30 | 15278 B | 184.3s | 35（33 次 Read） | 28743 字 |

## 结论

四种找法**都能答对**。看转写之后，排序变了。

- **只靠索引最干净。** 约 1 分钟，10 次 Read，工具返回约 20KB。它真的先读了两份小索引和会话目录，再打开 B70 / J5 / N7p。没有 Grep 扫盘。
- **Grep 整目录看起来也快，但并不省字。** 交卷只列了 8 个文件，工具返回却有约 54KB：一次 Glob/Grep 把目录打进来了。夹具小还能撑；仓库再大会更亏。
- **jump --json 没有按说明书用。** 它先用人的原话当关键词（「消息发不出去」「浏览器」）查空，再改成「Control UI / 远程」才命中。中间还 Grep、读了 `map_owns.py`、README、计时报告。所以墙钟 2.6 分钟、工具返回约 52KB，并不比 Grep 省。脚本本身不慢，慢的是 Agent 要想出对的词、还会顺手乱翻。
- **只跟链接最迷路。** 35 次工具、30 份文件、约 3 分钟。从会话和 FIND 一路点下去，路过 B10/B12/B32/B81 才落到 B70。链接给人点，不当 Agent 主找法。
- **记录时把答案写进坏例/任务/卡**，四路都不用打开源码。堆超链接帮不上；索引关键词要对得上人的话，否则 jump 第一次会查空。

## 各问

### grep-all
- root_cause **对**：UI 和 Gateway 走了两条隧道。
- config **对**：claw.tunnel.share=gateway-18789
- command **对**：ssh -L 18789:127.0.0.1:18789 user@host
- card_rule **对**：远程页只许走 Gateway 已占用的那条跳
- 打开：FIND.md, bugs/B70.md, fixes/B70.md, cards/N7p.md, tasks/J5.md, cards/M7.md, cards/M8.md, cards/N82.md
- 墙钟：60.3s

### index-only
- root_cause **对**：UI 和 Gateway 走了两条隧道。
- config **对**：claw.tunnel.share=gateway-18789
- command **对**：ssh -L 18789:127.0.0.1:18789 user@host
- card_rule **对**：远程页只许走 Gateway 已占用的那条跳
- 打开：.codex/context/bugs-index.json, .codex/context/tasks-index.json, .codex/context/sessions.jsonl, .codex/context/bugs/B70.md, .codex/context/fixes/B70.md, .codex/context/cards/N7p.md, .codex/context/tasks/J5.md, .codex/context/cards/N82.md
- 墙钟：61.4s

### jump-json
- root_cause **对**：UI 和 Gateway 走了两条隧道。
- config **对**：claw.tunnel.share=gateway-18789
- command **对**：ssh -L 18789:127.0.0.1:18789 user@host
- card_rule **对**：远程页只许走 Gateway 已占用的那条跳
- 打开：.codex/context/tasks/J9.md, .codex/context/bugs/B70.md, .codex/context/fixes/B70.md, .codex/context/tasks/J5.md, .codex/context/cards/N7p.md, .codex/context/cards/N82.md
- 墙钟：157.2s

### follow-links
- root_cause **对**：UI 和 Gateway 走了两条隧道。
- config **对**：claw.tunnel.share=gateway-18789
- command **对**：ssh -L 18789:127.0.0.1:18789 user@host
- card_rule **对**：远程页只许走 Gateway 已占用的那条跳
- 打开：.codex/context/FIND.md, .codex/context/sessions.jsonl, .codex/context/bugs/B10.md, .codex/context/bugs/B12.md, .codex/context/bugs/B32.md, .codex/context/bugs/B81.md, .codex/context/cards/N11.md, .codex/context/fixes/B10.md, .codex/context/fixes/B81.md, .codex/context/cards/N3a.md, .codex/context/cards/M11.md, .codex/context/cards/M1.md, .codex/context/cards/T0.md, .codex/context/fixes/B32.md, .codex/context/cards/M7.md, .codex/context/cards/M8.md, .codex/context/cards/M12.md, .codex/context/cards/N11b.md, .codex/context/cards/N7p.md, .codex/context/cards/N82.md, .codex/context/cards/N81.md, .codex/context/cards/N78.md, .codex/context/cards/N72.md, .codex/context/bugs/B70.md, .codex/context/fixes/B70.md, .codex/context/bugs/B72.md, .codex/context/fixes/B72.md, .codex/context/cards/N7i.md, .codex/context/cards/N7e.md, .codex/context/tasks/J5.md
- 墙钟：184.3s
