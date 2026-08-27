# 底层：第一版四块

跳转说明书：`.codex/context/FIND.md`。字段怎么写：`.codex/context/FORMAT.md`。Agent 先读小索引（`owns-index.json` / `bugs-index.json` / `tasks-index.json` / `sessions.jsonl`），再打开命中文件。不靠点超链接，也不要把 `jump-index.json` 或 `map.json` 整份读进对话。

一条记忆挂多张卡，等真遇到再做。

## 第一版（已定）

1. **会话** — `sessions.jsonl` 目录，太长才另写 `sessions/某次.md`
2. **坏例** — `bugs/` 索引 + `fixes/` 怎么修（代码只记路径）
3. **任务** — `tasks/` 一类活怎么走（地图链路、命令、代码路径）
4. **地图** — `map.json` 给人看；Agent 走 `owns-index.json` 和 `cards/`

经验：跟 bug 的进 `fixes/`；跟某块软件的短规矩进那张卡；同类任务怎么走进 `tasks/`。会话一行只当目录。代码不抄第二份。

## 以后（现在不做）

清单在 `.codex/context/TODO.md`：首次建图（最难也最要紧）、优化检索、CI/CD 测试（第五块）。仓库里旧的 Test Hub / 功能链 / Stop-hook 先不动、不扩。
