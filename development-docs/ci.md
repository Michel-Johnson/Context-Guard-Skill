# 检查怎样算通过

测试入口与通过条件在本页；权限、PR/交付/清理见 [RULE](../RULE.md)，发布见 [手册](npm-release-runbook.md)。

## 首次开发配置

运行时/依赖见 [本地开发](../AGENTS.md#本地开发)。首次执行：

```sh
npm run dev:setup
npm run hooks:status
```

扫描器位于 .security-tools/，已有自定义 Git Hook 不覆盖；开发 Git Hook 与产品生命周期 Hook 分开。

## 常用检查

| 范围 | 命令 |
| --- | --- |
| 定向模块 | `node --test tests/<模块>.test.mjs` |
| 安全、治理、Node、包/安装冒烟 | `npm test` |
| 工作台/恢复/Cursor 浏览器 | `npm run test:browser` |
| Cursor 独立浏览器 | `npm run test:cursor-browser` |
| Cursor CI Docker 隔离 | `npm run test:cursor-ci-docker` |
| 无对话客户端兼容 | `npm run test:clients -- --client cursor --tools <工具目录> --evidence <证据目录>` |
| 隔离打包/新装/升级，不发布 | `npm run test:cd` |
| 暂存区扫描 | `npm run security:staged` |

浏览器准备 `npx --no-install playwright install chromium`；客户端准备 `node .github/scripts/install-ci-client.mjs cursor <工具目录>`（Claude 换 claude）。配置隔离，不复制个人登录。

## 测试质量与责任

开发者补单元/接口/回归，跨模块核公共入口到最终状态；正常、边界、非法、重试、幂等、并发/重启均按影响验证。回归先证明旧错误失败，不能只核退出码。

新测试同时登记 test-manifest.json 并核真实 runner；默认 Node runner 仅 tests/、.github/scripts/ 顶层 *.test.mjs，其他套件须入口。禁止 .only，skip 写名称/原因，关键路径不永久跳过。隔离数据/进程，Windows 子进程不弹窗。

记录准确源码/命令/环境/退出码/结果；首次失败保留，重跑不抹掉，成功清自有 fixture。Mock、源码、无对话测试不替代模型/原生 Hook/安装验收，自检不冒充独立 Review。

### 超时与清理

Node 套件 15 分钟、两文件并发；worktree/Cloud 集成 CLI 120 秒，Hook 计划 180 秒（子 HTTP 40 秒），CD 演练 npm test 30 分钟。超时失败，只停自有子进程树；CONTEXT_GUARD_TEST_TRACE=1 记耗时不转储环境。

Windows 用已验证 Python 3 和 Node 调用的 npm CLI，不用 Store 别名/直接 spawn npm.cmd。隔离 HOME/Git 配置，先停止入口、等后台/文件完成再清自有目录；锁重试有界，失败仍报错。负载耗时非独占基准，偶发超时须定向重复、串并行比较及完整测试/实际包验证，非一次重跑关闭。

## 安全

禁入项按 RULE；暂存、历史、CI 提交范围及最终包分别扫描，缺工具/对象、超时或失败均拒绝，不加豁免，泄露先轮换凭据。精确包清单/哈希核同一制品，升级保留数据/配置/第三方 Hook；无检出不证明绝无密钥，本机 Hook 不替代服务器保护。

## CI 与合并

每 PR 安全/selector 必跑，.github/ci-impact.json 选其他检查；未知、CI/治理及本文件变更全跑，main/标签完整。Required 核当前 head 的计划与结果：选中项全部成功，失败/取消/跳过不合并，不拼不同 SHA 的绿灯。CI 不调模型、不发布；触发以 [ci.yml](../.github/workflows/ci.yml) 为准。

### Dependabot 自动合并

独立维护 workflow 每周核真实 Dependabot 元数据，仅本仓库目标 main、非 Draft 的 GitHub Actions 更新（含大版本）登记原生自动合并；普通 PR/其他生态/未知类型不登记。一个 actions 组、open-pull-requests-limit: 1，安全更新上限另计。

须启用 Allow auto-merge，仍满足 Required、最新 main、冲突及审核保护，不因大版本额外索人审；大版本有未被 CI 检出的破坏风险。有写权的 pull_request_target 不检出代码/下载 PR 产物，元数据 Action 固定 SHA，不增 PAT/npm 凭据或标签。GITHUB_TOKEN 事件不保证续跑工作流；同名分支/PR Required 不代表两轮都等。

停用 workflow 不取消已登记合并，须逐个取消或关闭仓库 Allow auto-merge。配置权威为 .github/dependabot.yml 和对应维护 workflow。

## 真实客户端对话验收

当前 Claude/Cursor，Codex Hook 暂缓、既有回归保留。无对话只证启动/配置/握手；真实模型走 [手动 workflow](../.github/workflows/real-client-acceptance.yml)，人选已审分支，凭据仅 skill-client-tests Environment，消耗额度，不默认 Required，本机不运行 test:real-clients。

首次进入、同会话恢复、新会话和 Bug 落盘核真实 Session/Hook/HTTP/持久数据，不信模型自报。现 workflow 三客户端汇总按当前两客户端分别报；变量/白名单以 workflow 为准，脱敏证据留 3 天。

## 交付与缺口

安装/运行/发布授权见 RULE。测试缺口在 [CI_todo](../CI_todo.md)，未实现需求交 Coordinator，不把规范、接线或暂缓记为通过。

### 明确待实现

GATE-01/02 的清单/runner 发现尚未统一，聚焦/跳过检测不完整，Review 核真实入口与 skip。GATE-05 Windows 长链路仍未验，不一概归因环境。统一静态检查、发布观察及自动回滚未实现，不报全仓 lint/无人恢复。
