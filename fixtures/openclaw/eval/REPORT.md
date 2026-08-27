# OpenClaw 难任务：四种找法

题目：外面打开控制台，页面出了、消息发不出。要同时交出根因、配置键、命令、卡上短规矩。
这四样分别在 `fixes/B70.md`、`tasks/J5.md`、`cards/N7p.md`，索引关键词对不上配置键。

夹具体量：context 122 个文件、115817 字节；三份必读正文 1225 字节。
耗时是受试 Agent 从创建到交卷的墙钟。读入字节按它自称打开的文件合计；估 token = 字节/4。

| 找法 | 四问 | 打开文件 | 读入 | 估 token | 墙钟 |
| --- | --- | --- | --- | --- | --- |
| grep-all | 4/4 | 8 | 3326 B | 831 | 60.3s |
| index-only | 4/4 | 8 | 17017 B | 4254 | 61.4s |
| jump-json | 4/4 | 6 | 2101 B | 525 | 157.2s |
| follow-links | 4/4 | 30 | 15278 B | 3819 | 184.3s |

## 结论

四种找法**都能答对**。差的是走了多少路、读了多少字。

- **只靠索引**和 **Grep 整目录**最快（约 1 分钟），打开约 8 个文件。这套夹具只有一百来个文件，Grep 还撑得住；仓库再大，Grep 会把不相关的坏例一并扫进来。
- **一次 jump --json** 读得最少（6 个文件、约 2KB）。墙钟反而更长（约 2.6 分钟）：Agent 要先想查询、跑脚本、再打开返回的文件。`--last` 还多打开了无关的 `J9.md`。
- **只跟记录里的链接**最亏：30 个文件、约 15KB、约 3 分钟。没有索引当入口，它从会话和 FIND 瞎跳，路过 B10/B12/B32/B81 一串无关卡才落到 B70。链接给人点可以，不当 Agent 的主找法。
- 索引本身也有体积：`index-only` 读入约 17KB，主要是两份 JSON 索引加会话目录，并不比跟链接省多少字。对 Agent 更省的是 **jump 只返回该打开的路径**，不要把索引整份贴进对话。
- 配置键写在经验正文里，四路都不用打开源码。记录时把「答案」写进坏例/任务/卡，比在记录里堆超链接更有用。

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
