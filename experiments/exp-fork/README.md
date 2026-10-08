# 分身与 Harness 实验归档

此目录只在 `exp-fork` 分支归档。它保存本地 GLM 实验代码、方法、完整样本的公开计时数据和结论，不是已启用的产品功能，不合入 `main`。

实验在 2026-09-26 至 2026-09-28 进行；本次归档日期为 2026-10-08。历史产品基线是 `48ed4a8a251f1c27b54db6ce3735277e89d55725`，研究的 Codex 固定提交是 `e72da2b53805894878023d01949a25a082e0a5cb`。归档分支从较新的 main 建立；两种版本不能混算。

## 阅读入口

- [过程与实验边界](PROCESS.md)
- [结论与下一步](CONCLUSIONS.md)
- [样本目录](results/index.json)：9批实验、76个任务样本；包含失败、取消和超时，不能全部当成成功答案。
- [原始实现文件指纹](manifest.json)：31个源码文件，以及为公开复现替换的种子标识。
- [执行与接待分离报告](reports/reception.md)
- [分身策略报告](reports/fork-strategies.md)
- [联网搜索报告](reports/web-strategies.md)
- [Harness 优化报告](reports/harness-optimization.md)

`source/` 保存实验实现及定向验证；`results/` 是白名单导出的计时、状态和匿名化调用事件；`reports/` 是去除本机路径后的历史报告。完整用户历史、会话正文、provider 文件、浏览器凭据、运行时配置、截图和 `.codex/` 内容均未上传。

## 离线核验公开归档

在此分支的仓库根目录运行：

```powershell
node "experiments/exp-fork/verify-archive.mjs"
```

该入口校验源码指纹、语法、公开样本数、结果索引及关键均值，不调用模型或搜索服务。

## 复现实验实现

最新 main 已拆出旧 Cloud 模块，`source/` 的原始相对导入依赖历史单仓库。请在独立目录检出旧基线，避免改动现有工作台：

```powershell
git clone --no-checkout "https://github.com/Michel-Johnson/Context-Guard-Skill.git" "Context-Guard-Fork-Lab"
git -C "Context-Guard-Fork-Lab" switch --detach "48ed4a8a251f1c27b54db6ce3735277e89d55725"
npm --prefix "Context-Guard-Fork-Lab" ci
```

准备一份包含固定提交的公开 Codex 源码克隆，然后使用当前归档分支中的准备入口：

```powershell
node "experiments/exp-fork/prepare.mjs" --workspace "../Context-Guard-Fork-Lab" --source-root "../codex" --family strategy --offline
```

`prepare.mjs` 只向指定旧基线的忽略目录 `temp/` 创建新实验文件；已有实验目录会拒绝覆盖。它不会自动发送模型请求。`--offline` 仅用于定向验证。

```powershell
node --test "../Context-Guard-Fork-Lab/temp/learning-lab/lab.test.mjs" "../Context-Guard-Fork-Lab/temp/learning-lab/web-search.test.mjs" "../Context-Guard-Fork-Lab/temp/learning-lab/map-controls.test.mjs"
```

真实模型复现时，用 `--provider` 代替 `--offline`，提供位于 Git 之外的私有 JSON：字段为 `baseUrl`、`model`、`token`、`maxTokens`、`thinking` 和 `timeoutMs`。示例参数是 `glm-5.3`、8192、`{"type":"disabled"}`、120000；密钥只在本机填写。

可选 `--prefix <私有JSON文件>` 提供本地消息数组。历史实验使用真实会话的20条前缀，不能公开分享；省略该参数时使用空前缀，新计时不能宣称精确重现历史数字。

准备入口的 `--family` 决定种子的工具配置，运行脚本必须与之对应：

| family | 准备后在旧基线内运行 | 用途 |
| --- | --- | --- |
| `strategy` | `node temp/learning-lab/strategy-evaluation.mjs` | direct、自适应、加强委派提示；途中追问 |
| `web` | `node temp/learning-lab/web-strategy-evaluation.mjs` | 真实执行分身与不分身的联网对照 |
| `optimization` | `node temp/learning-lab/optimization-evaluation.mjs` | 原版、证据工具、Map预取 |
| `optimization` | 上一命令追加 `--grounded` 或 `--contracts` | 探索性补测与留出问题 |
| `reception` | `node temp/learning-lab/latency-study.mjs` | 执行与接待分离 |
| `reception` | 上一命令追加 `--restricted-reception` | 接待只读进度快照 |
| `policy` | `node temp/learning-lab/probe-fork-policy.mjs` | 自适应什么时候真正fork |
| `comparison` | `node temp/learning-lab/compare-memory-query.mjs` | 同题四次对照 |
| `ui` | `node temp/learning-lab/server.mjs 0 study` | 历史本地学习工作台 |

`--offline` 的占位配置不能用于真实模型计时。每种 family 请使用新的复现目录，不覆盖已采集数据。UI 覆盖层只适用于旧基线，服务监听127.0.0.1。

原分析脚本和 `optimization-replay.mjs` 依赖完整的本地运行记录。公开归档只有白名单指标，不能直接冒充原始会话重放；先生成新的本机记录，再调用对应分析入口。此次准备和定向验证不额外运行收费模型实验。

## 验证范围

本分支只归档，没有部署、安装新版 Skill 或合并。归档时的核验记录见 [VALIDATION.md](VALIDATION.md)。历史报告中“安全扫描器缺失”的描述保留为当时的事实；本次归档重新执行安全扫描，结果另行记录。
