> 历史报告的公开归档版。凭据、完整历史、原始会话文件和本机路径未上传。文中原始文件名用于说明当时的证据；本分支公开复核数据见 `../results/`，复现入口见 `../README.md`。

# GLM Web Search 分身耗时实验

范围：原本地 GLM 实验版的当前保存代码和配置，在隔离目录调用真实 GLM-5.3 与已有 Web Search MCP。不是云端 Claude Lab，也不是浏览器端到端计时。未更改产品代码、页面或正式会话。

## 本轮结论

计划12组，已有终态记录 11 组，最后正在执行的一组在搜索服务持续报错后主动中断；其 events.jsonl 保留，但不计作完成。第 7 组开始出现 SEARCH_PROVIDER_ERROR，之后多组没有任何搜索结果。后半段的快速报错回复不能当成正常联网答案，也不能混入性能结论。

以下仅列持续服务报错前的配对记录；它们也存在官方证据不足、搜索解析失败和分身步数耗尽，不代表等质量答案。

| 任务 | 轮次 | 不分身/秒 | 分身/秒 | 差异 |
| --- | ---: | ---: | --- | --- |
| 单产品官方文档查询 | 1 | 43.9 | 53.7 | 慢 9.7 秒 |
| 单产品官方文档查询 | 2 | 54.7 | 180秒未完成，取消 | 至少慢 125.4 秒 |
| 双产品官方文档对比 | 1 | 31.5 | 116.7 | 慢 85.2 秒；分身失败后主会话补查 |

本轮未观察到执行分身提速，但有效配对少且质量不等价，不能概括所有联网任务。建议先提高搜索证据可用性、限制无效重复搜索，再比较单会话并行搜索与执行分身。当前接待分身提案尚未实测。

## 方法

- 计划两道题，每种策略每题三次，成对交替先后顺序；已记录 11/12 组终态，其余中断。无中途追问。
- 单产品：联网查询 Codex CLI 会话恢复与分叉，最多3点并附官方链接。
- 双产品：分别联网查询 Codex CLI、Claude Code 的上述能力，各最多2点并附官方链接。
- 同一份提问前 20 条历史、50088 字节，thinking disabled，maxTokens 8192。
- 不分身：原 direct 工具集合。分身：首轮只暴露 fork_task 并设置 tool_choice，由真实模型生成委派，随后恢复原工具集合和正常运行循环。单产品要求1个分身，双产品要求2个。这是受控实际分身对比，不是默认自适应触发率试验。
- 主会话真实分派与最终汇总均计时；分身创建、模型、搜索分别记录。每组新建搜索连接，供应商缓存不清除。组间串行，分身保留并发。
- 首个预试验仅设置 tool_choice，但模型仍选择了搜索，已中断，证据保存在同级 1790536914609。它不计为分身样本，也不混入正式均值。
- 每组上限180秒；模型/工具失败与空结果保留。均值包括这些样本，不能据此宣称答案质量相同。

## 全部记录汇总（含服务故障，不用于正常性能结论）

超时样本属于右截断：不能把180秒当成完成耗时。下表“有文本返回”包括搜索失败通知，不等于交付答案；同时保留所有组的结束/截断耗时与超时数。

| 问题 | 策略 | n | 有文本返回均值秒（数量） | 结束/截断均值秒 | 超时 | 模型调用 | 搜索次数 | 实际分身组数 |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 单产品 | 不分身 | 3 | 35.8 (3) | 35.8 | 0 | 7.0 | 6.0 | 0/3 |
| 单产品 | 分身 | 3 | 36.2 (2) | 84.2 | 1 | 9.3 | 9.7 | 3/3 |
| 双产品 | 不分身 | 3 | 19.5 (3) | 19.5 | 0 | 3.7 | 4.3 | 0/3 |
| 双产品 | 分身 | 2 | 93.2 (2) | 93.2 | 0 | 26.5 | 30.0 | 2/2 |

## 耗时与证据

- 113 次真实模型请求，平均 5.0 秒；120 次搜索，平均 1.1 秒。模型时间包含网络和供应商处理，不能再区分推理和排队。
- 7 个真实分身，创建平均 2.7 毫秒；失败分身 4 个。
- 搜索空结果 33 次；搜索错误 36 次；166 条返回结果中 122 条 URL 只有根路径。首页链接并不自动代表错误，但对定位具体文档的证据不足。
- 当前 engine 的同一会话工具列表使用 for...of 逐个 await；同一模型响应中的多次搜索也串行。不同分身才能通过现有路径并发搜索。
- 分身同时增加父会话分派/汇总，可能重复查询或因搜索结果不足反复改词。判断收益需要比较总历时，不能把并发搜索或模型时长相加当成用户等待。
- 现有工具仅返回搜索摘要和链接，没有打开网页全文的工具；本实验不等于核读了完整官方文档。

SEARCH_PROVIDER_ERROR 是适配器归一化错误，可能来自 MCP 错误或 isError 响应。未记录供应商原始错误文本，无法确认是额度、权限还是服务故障。模型回答中“配额/权限”的说法不是本实验已验证的根因。

## 逐组记录

| # | 题目 | 策略 | 结束/截断秒 | 模型调用 | 搜索 | 分身 | 状态 |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | single | fork | 53.7 | 7 | 7 | 1 | completed |
| 2 | single | direct | 43.9 | 8 | 7 | 0 | completed |
| 3 | comparison | direct | 31.5 | 5 | 7 | 0 | completed |
| 4 | comparison | fork | 116.7 | 25 | 24 | 2 | completed-with-errors |
| 5 | single | direct | 54.7 | 10 | 9 | 0 | completed |
| 6 | single | fork | 180.0 | 16 | 19 | 1 | cancelled |
| 7 | comparison | fork | 69.7 | 28 | 36 | 2 | completed-with-errors |
| 8 | comparison | direct | 13.5 | 3 | 3 | 0 | completed |
| 9 | single | fork | 18.8 | 5 | 3 | 1 | completed |
| 10 | single | direct | 8.8 | 3 | 2 | 0 | completed |
| 11 | comparison | direct | 13.6 | 3 | 3 | 0 | completed |

## 边界

- 每格原计划只有3次，且并未全部完成有效搜索；真实搜索结果、生成路径和服务负载会变化。不是显著性证明，也不能据此概括所有联网任务。
- 机械检查仅检查回答 URL 是否出现在本组搜索返回中，不验证网页可达性或语义正确性；原始答案和搜索结果供复核。
- 未测试“空闲接待分身”方案，也未测试单会话并行工具改造。
- 本地工作台绑定显示后端停止，未验证服务器记忆版本；本实验只使用明确指定的本地实验配置，不声称代表最新云端。
- npm test 被缺失或变更的安全扫描器阻断，未绕过；实验脚本语法检查与真实调用另行记录。

## 原始答案

### 1. single / fork

联网检索未命中官方文档正文，结论多来自第三方摘要，可信度有限：

1. **恢复会话**：`codex resume`（可列出或恢复最近会话）
2. **分叉会话**：`codex fork` 可从已有会话分出分支
3. **官方文档入口**：https://developers.openai.com/（搜索仅返回索引，具体页面 URL 未命中）

第三方参考：https://docs.use-bloom.dev/ 、https://www.vibecodingacademy.ai/ 。建议直接访问 developers.openai.com/codex 核实命令细节。

未在搜索返回 URL 中匹配到的引用：https://developers.openai.com/（搜索仅返回索引，具体页面。

### 2. single / direct

联网检索结果如下（未检索到 OpenAI 官方文档页，仅第三方资料）：

- **恢复会话**：`codex resume` 交互选择历史会话；`codex resume --last` 直接恢复最近一次；`--all` 可查看全部（来源：[kingy.ai 命令指南](https://kingy.ai/news/openai-codex-command-guide)、[computingforgeeks cheat sheet](https://computingforgeeks.com/codex-cli-cheat-sheet)）
- **分叉会话**：`codex fork`（或 `codex fork <session-id>` / `--last`）从历史会话复制出新分支继续对话（来源：[lobehub 技能页](https://lobehub.com/)）
- **限制说明**：官方 developers.openai.com、help.openai.com、github.com/openai/codex 的相关页面在本次检索中均未返回直接结果，以上为第三方转述，官方一手文档证据有限。

未在搜索返回 URL 中匹配到的引用：无。
### 3. comparison / direct

**Codex CLI**
- `codex resume` 打开会话选择器恢复历史会话，`codex fork`（或 resume picker 中的 fork 选项）可从已保存会话分叉；API 侧对应 `thread/resume` / `thread/fork`
- 官方文档：https://developers.openai.com/codex/cli 、https://developers.openai.com/codex/developer-commands

**Claude Code**
- `claude --continue` / `claude --resume` 恢复会话，加 `--fork-session`（如 `claude --continue --fork-session`）在恢复时分叉出新 session；会话内 `/branch` 也可创建分支并打印两个 session ID
- 官方文档：https://code.claude.com/ （"Manage sessions" 页，搜索结果未返回完整路径）

说明：两次检索返回的摘要信息有限，以上命令细节来自官方域名片段，未能直接打开整页核实；无官网完整 URL 时已如实标注。

未在搜索返回 URL 中匹配到的引用：无。

### 4. comparison / fork

**OpenAI Codex CLI**（官方 docs：developers.openai.com）
- 恢复会话：`codex resume`（会话内 `/resume`）重开已有会话继续对话；分叉：`codex fork` / `/fork` 基于原记录创建新会话。
- 链接：[Developer commands](https://developers.openai.com/codex/developer-commands)、[Best practices](https://developers.openai.com/codex/learn/best-practices)

**Anthropic Claude Code**（官方 docs：code.claude.com）
- 恢复会话：`claude --continue/-c` 恢复当前目录最近会话，`--resume` 选择历史会话恢复。
- 分叉：Fork 以原会话历史副本为新起点创建新会话（有独立 session ID），原会话不受影响。
- 链接：[code.claude.com](https://code.claude.com/)（搜索仅返回站点根 URL，未能获取具体页面路径）

未在搜索返回 URL 中匹配到的引用：无。

### 5. single / direct

基于公开网页检索结果（未能定位到 developers.openai.com 上的对应页面，以下链接为检索到的镜像/社区文档）：

1. **恢复会话**：`codex resume` 选择历史会话恢复；`codex resume --last` 直接恢复最近一次对话（[Codex CLI 备忘清单](https://code.itcent.cn/docs/codex-cli.html)、[阿里云 Codex CLI 速查表](https://developer.aliyun.com/article/1714675)）
2. **分叉会话**：`codex fork` 复制旧会话为新 thread，保留原上下文，便于尝试新方向（[Codex CLI 备忘清单](https://code.itcent.cn/docs/codex-cli.html)）
3. 两者与 `codex`、`codex archive` 等同属开发者命令集，详见 [Developer commands 文档](https://www.codex-docs.com/docs/developer-commands)

说明：检索未命中 OpenAI 官方域名下的直接页面，以上为搜索返回的第三方/镜像来源，可靠性有限；官方文档站应存在但未被本次检索到。

未在搜索返回 URL 中匹配到的引用：无。

### 6. single / fork

无最终答案：cancelled

未在搜索返回 URL 中匹配到的引用：无。

### 7. comparison / fork

很抱歉，本次无法完成联网查询：

- 两个分身调查均因内部步骤限制失败
- 主会话重试 `web_search` 时，搜索服务持续返回配额/权限错误

因此目前没有实际检索到的官方链接，无法给出两个产品的会话恢复与分叉结论，也不能编造来源。建议稍后再试，或我可直接基于本地固定源码（`codex resume` / `thread fork`）作答。

未在搜索返回 URL 中匹配到的引用：无。

### 8. comparison / direct

联网搜索当前不可用：搜索服务返回权限/配额错误，无法获取任何官方网页。

因此我**无法**给出基于实际检索结果的对比，也不能凭记忆编造链接。如需继续，可以稍后重试搜索，或改为基于固定源码（e72da2b）本地回答这两个产品的行为（但那只覆盖 Codex，Claude Code 源码不在本仓库）。

未在搜索返回 URL 中匹配到的引用：无。

### 9. single / fork

联网查询失败：搜索服务持续返回错误（重试 3 次均未成功），无法获取任何官方网页结果，因此不能提供实际检索到的官方链接，也不宜凭记忆编造。

建议稍后再试，或直接访问官方仓库 github.com/openai/codex 的 docs 目录查看 `codex resume` 与分叉相关文档。

未在搜索返回 URL 中匹配到的引用：无。

### 10. single / direct

联网搜索失败：搜索服务两次返回配额/权限错误（SEARCH_PROVIDER_ERROR），无法获取官方文档页面和链接。

建议：稍后重试；本地源码中确有 `codex resume` 与 fork 实现可查，需要的话我可以直接讲源码。

未在搜索返回 URL 中匹配到的引用：无。

### 11. comparison / direct

联网搜索失败了：搜索服务连续三次返回配额/权限错误（`SEARCH_PROVIDER_ERROR`），无法获取官方网页结果。

因此我目前无法给出有实际链接支撑的对比。建议稍后再让我重试；或者如果你想，我可以先从固定版本的本地源码总结 Codex CLI 的 `resume`/fork 行为（但那就不是你要的官方文档联网调研了）。

未在搜索返回 URL 中匹配到的引用：无。
