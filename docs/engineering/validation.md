# 六阶段验证记录

阶段六，2026-09-12，源码基线 `284823a7`。本记录区分历史证据、当次执行与待执行步骤，不是生产工作台验收。没有挂载真实工作台、读取私有记忆、调用付费模型或部署生产。

## 阶段出口

| 阶段 | 交付与检查 |
|---|---|
| 1 现状 | [baseline](baseline.md)：规则/入口/责任，B01–B08 缺口，当前执行与声明边界 |
| 2 精读 | [sources](sources.md)：五家公司的 18 个来源条目，阅读范围、语境、例外与成本 |
| 3 取舍 | [adoption](adoption.md)：15 项采纳/调整/暂缓/拒绝决定 |
| 4 流程 | [主流程](README.md)：P00–P10、R0–R3、输入输出与责任、失败路径 |
| 5 落地 | [模板](templates.md)、[自动化映射](automation.md)，连接现有文档并修正状态/触发/发现/清理说明 |
| 6 验证 | 下列历史任务回放、隔离反例与当前文档变更的实际验证；远端交付在对应 PR 留准确提交证据 |

## 真实任务回放

这是对已合并 PR 的流程适用性回放，不冒充重新完成历史需求或生产部署。读取了 GitHub PR 的文件/描述/Required 结果，并核对对应源码差异。

| 案例与历史提交 | 按新流程推演 | 发现及判定 |
|---|---|---|
| [#136 文件/记忆设计](https://github.com/Michel-Johnson/Context-Guard-Skill/pull/136)，`d654a77f` | R0：只新增设计资料，不改变现行 schema；验收是准确区分设计、实验与实现，不复制私有数据 | Required 为 SUCCESS，PR 仅一个 MD；安装 N/A 有范围依据。证明小文档不必造运行验收；旧资料当前位于 `docs/design/file-design.md`，不能按历史路径建立第二份权威。 |
| [#233 刷新后草稿恢复](https://github.com/Michel-Johnson/Context-Guard-Skill/pull/233)，`284823a7` | R3：虽仅少量文件，涉及恢复/重放和覆盖风险；验收应包括同版本恢复、陈旧草稿冲突、重复请求与持久结果 | diff 同时改实现与本地/Cloud 浏览器回归，历史 Required 为 SUCCESS。PR 描述未给旧版本失败证据，不能倒推已做；新模板要求补明。这次运行当前基线的隔离浏览器套件，结果见下。 |
| [#179 共享层/演示隔离](https://github.com/Michel-Johnson/Context-Guard-Skill/pull/179)，`437c385` | R2：源码归属调整虽多文件，仍应围绕同一行为边界；需公共接口、旧入口兼容、包边界与运行升级 | diff 有共享依赖和包清单断言，历史 Required 为 SUCCESS；PR 自述曾有浏览器重跑中，不能把那句当最终通过。本次重跑当前协议回归，不宣称重演旧发布或当下生产。 |

回放促成的修订：风险看行为不看扩展名；明确历史路径/版本；安装 N/A 不等于任务协议 N/A；文档只指向当前状态来源，避免旧总结覆盖后续专项。

## 可执行反例

在本任务 `temp/` 内建立合成目录，调用基线真实 checker/runner，未改产品脚本或正式测试。Node `v22.18.0`，Windows。构造说明足以在空白临时目录重现：

1. 创建 `.github/scripts/`、`tests/`，`package.json` 的 scripts 为空。清单 schemaVersion 为 1，roots 为这两个目录，suffix 为 `.test.mjs`，excluded/standaloneSuites/helpers/separatePackages 为空；productFiles 列出清单自身及所建测试。
2. 顶层 `tests/control.test.mjs` 导入 `node:test` 并运行一个通过用例；嵌套 `tests/nested/failure.test.mjs` 则在用例中抛出 `intentional nested failure`。
3. 以该合成目录为 cwd，分别调用真实 `verify-test-governance.mjs`、`run-node-tests.mjs` 的绝对路径，再直接 `node --test tests/nested/failure.test.mjs`。
4. 另建独立目录，把唯一测试改为 `test.skip('ordinary feature', () => {})`；再次单独改为 `test('ordinary feature', { only: true }, () => {})`。分别调用 checker。

| 反例 | 实际结果 | 证明范围 |
|---|---|---|
| 顶层通过 + 嵌套故意失败 | checker 退出 0，称发现 2；runner 退出 0，只执行 1；直接执行嵌套文件退出 1 | GATE-01 的集合不一致真实可复现，不证明当前仓库已有漏跑嵌套测试 |
| 只有名称、无理由的 skip | checker 退出 0 | GATE-02 不能判断有效理由；不是允许无理由跳过 |
| 选项式 only | checker 退出 0 | 此形式不会被现有文本检查阻止；不推断所有 Node 启动模式都会因此漏跑 |

实际脚本 SHA-256：

```text
checker 8267718fa6e0910f8073d55465d6dde192923a16b63a5b1a1e2baf236e27af1e
runner  9fd9a1ffbceb637f59584459b29642cde4758773b32b307382daa082861e5756
```

这些只是文档结论的诊断实验，不是新增产品测试，也不算 GATE-01/02 已修复。合成失败证据留在本任务忽略目录，不上传本机绝对路径或原始日志。

## 本次交付验证

| 项目 | 结果 |
|---|---|
| 依赖与安全工具 | `npm ci --ignore-scripts --no-audit --no-fund` 成功；首次 hooks:status 因本 worktree 尚无扫描器而失败，`security:setup` 校验本地固定版本后 status 成功；未覆盖 Hook 或全局安装 |
| 协议/模块回归 | `node --test tests/interface-protocol.test.mjs`，7/7 通过 |
| 反例实验 | 三项按预期复现，实验驱动脚本退出 0；上述被测嵌套用例退出 1 是期望证据 |
| 总入口 | 本机 `npm test` 退出 1：39 项安全检查通过，静态/清单检查通过；Node 共享 runner 中有 Python 别名错误、Hook 超时，最终触及 15 分钟上限；未到达末尾 CI smoke。不是完整通过 |
| 隔离浏览器 | 三次均在 isolated-hook-bootstrap 的 20 秒期限超时，尚未进入草稿恢复断言；包括默认 Node 22.18.0/Python 3.13.7 和另一套 Node 24.19.0/Python 3.12.14 环境。保留失败，根因未定，不记为通过 |
| 文档/包范围 | 14 个 Markdown 文件、85 个本地链接目标通过解析检查；均不在 packedFiles/installedFiles 中；`git diff --check` 通过。模板内部示例不当链接解析，不验证远端服务运行 |
| PR / Main | 本页冻结提交前的验证事实，不预填远端成功；准确 head、Required 运行链接、合并与合并后核对结果以该变更 PR 的最终交付记录为准 |

本次是 R2 治理变更，不是 R0 修字。未改产品代码、格式、接口、依赖、workflow 或远端保护设置。独立人工审核尚未提供；本地检查属于同一 Agent 自检，不冒充独立 Review。未完成的生产/原生宿主专项与 GATE 待办继续保留。

首轮本地总测试中，Codex SQLite 用例因硬编码 `python3` 解析到 Windows 商店别名而失败。采用系统已有 Python Launcher 的临时副本，仅向该测试子进程 PATH 提供 `python3`，不改源码或全局环境；定向重跑该文件 2/2 通过（Python 3.13.7）。这不替代总入口最终结果。

单独对未绑定 Hook 的隔离诊断返回正确提示，总耗时约 6.5 秒；这没有解释完整浏览器 bootstrap 的失败，不能据此归咎于 Python 或证明绑定后的 Hook 已通过。Windows 完整回归和超时归因登记为 GATE-05。文档适用性已验证，不代表现有产品在这台机器上全部通过；远端全量 CI 仍必须完成，不因本机问题绕过合并门禁。
