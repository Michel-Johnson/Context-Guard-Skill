# 官方规范阅读记录

阶段二，访问日期：2026-09-12。只采用官方公开资料，不代表掌握各公司的全部内部规则。下表逐项说明实际阅读范围；长手册只精读相关章节，未通读部分不作为依据。摘要是简述，不转载原文；项目决策见 [采纳表](adoption.md)。

## Google

| ID / 官方来源 | 阅读范围与语境 | 提炼、例外与成本 |
|---|---|---|
| G01 [Review 标准](https://google.github.io/eng-practices/review/reviewer/standard.html) | 全文；工程健康与评审裁决 | 有依据的改进优先于追求完美；偏好不等于阻塞项。代价是需要明确严重性与争议裁决。 |
| G02 [Review 内容](https://google.github.io/eng-practices/review/reviewer/looking-for.html) | 全文；设计、行为、复杂性、测试、命名、文档 | 不只看风格，也问测试能否识别错误实现。复杂并发可能需要专项能力；不能把局部自检叫完整独立审查。 |
| G03 [小变更](https://google.github.io/eng-practices/review/developer/small-cls.html) | 全文；原子、可工作的变更 | 按一个完整意图拆分，不按固定行数拆。生成物、必要配套测试可较大；拆分不能制造不能运行的中间版本。 |
| G04 [TypeScript Guide](https://google.github.io/styleguide/tsguide.html) | 导言、文件结构、导入/导出与可见性；不是全文 | 原文以 Google 环境为背景，示例的可选格式不能当规则。借鉴收紧模块接口；不因此把本项目 JS 迁移成 TS。 |
| G05 [Python Guide](https://google.github.io/styleguide/pyguide.html#24-exceptions) | 2.4 Exceptions、2.5 Mutable Global State | 缩小异常捕获范围，明确隔离点，清理资源；业务校验不能依赖 assert。不是禁止测试断言，也不是禁止边界捕获。 |
| G06 [Testing Enough](https://testing.googleblog.com/2021/06/how-much-testing-is-enough.html) | 正文，2021；不采用评论区 | 单元、集成与关键用户旅程互补；非功能风险另测。完整旅程成本较高，不能用大量 E2E 替代接口回归。 |
| G07 [E2E 与测试金字塔](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html) | 正文，2015；重点为 Testing Pyramid | 70/20/10 是起始建议，不是统一配额；选能发现目标缺陷的较小测试层。不能据标题取消 E2E。 |
| G08 [SRE 复盘](https://sre.google/sre-book/postmortem-culture/) | Chapter 15 全章，书中历史实践 | 复盘解释成因并形成经审查的改进；不追责式描述，不泄露用户信息。需要预先定义触发条件与后续负责人，避免只增加文书。 |

## Microsoft ISE

这是 ISE Engineering Fundamentals Playbook，不应写成“所有微软团队强制执行”。页面示例不自动成为我们的阈值或部署授权。

| ID / 官方来源 | 阅读范围与语境 | 提炼、例外与成本 |
|---|---|---|
| M01 [Design Decision Log](https://microsoft.github.io/code-with-engineering-playbook/design/design-reviews/decision-log/) | 全部正文；页面标注更新 2024-08-26 | 重要决定记录背景、选择、后果、状态与替代关系；深度随决策影响调整。不要为微小修字写 ADR，也不要用巨型文档埋没决定。 |
| M02 [Test Planning](https://microsoft.github.io/code-with-engineering-playbook/automated-testing/test-planning/) | 正文的用例设计、测试计划类型与分组 | 设计阶段把验收转成前提、动作、预期和正反场景。人工/自动均可列出；样例登录指标不是本项目 SLO。 |
| M03 [Definition of Done](https://microsoft.github.io/code-with-engineering-playbook/agile-development/team-agreements/definition-of-done/) | 全部正文；页面标注更新 2025-09-26 | 团队明确完成条件，区分任务、迭代与发布。采用适用的验收证据，不机械增加每个示例角色的签字。 |
| M04 [Continuous Integration](https://microsoft.github.io/code-with-engineering-playbook/CI-CD/continuous-integration/) | Build Definition、Build Automation、环境依赖、配置验证、Integration Validation、Git Driven Workflow 的相关段落 | 命令入口独立于 IDE，配置也要验证，失败不能伪装成功。文中的云资源模式、覆盖率示例不原样采用；审查可在 CI 运行期间开展，合并仍必须全绿。 |
| M05 [Credential Scanning](https://microsoft.github.io/code-with-engineering-playbook/CI-CD/dev-sec-ops/secrets-management/credential_scanning/) | 全部正文；页面标注更新 2024-08-22 | 凭据与源码分离，本地与 CI 分层扫描，历史不能遗漏。沿用仓库现有工具，不为对齐文档再装第二套扫描器。 |

## Alibaba

[p3c 仓库](https://github.com/alibaba/p3c) README 标注黄山版 PDF 发布于 2022-02-03。本轮精读的是其公开 `p3c-gitbook` 以下章节，**不声称 GitBook 与该 PDF 同版，也不声称是 2026 年内部规范**。

| ID / 官方来源 | 阅读范围 | 提炼、例外与成本 |
|---|---|---|
| A01 [单元测试](https://github.com/alibaba/p3c/blob/master/p3c-gitbook/单元测试.md) | 全章 | 自动、独立、可重复；测试边界/正确/设计/错误情形，开发者负责维护。Java 测试目录与推荐覆盖率不适用于现有 Node/Python 布局。 |
| A02 [异常处理](https://github.com/alibaba/p3c/blob/master/p3c-gitbook/异常日志/异常处理.md) | 全章 | 不吞错，区分错误类别，资源释放不覆盖原失败。Java 预检查习惯不机械移植到 Python I/O；预先判断存在不消除文件系统竞争。 |
| A03 [注释规约](https://github.com/alibaba/p3c/blob/master/p3c-gitbook/编程规约/注释规约.md) | 全章 | 接口意图和约束应可理解，代码变化同步改注释。保留现有语言，不加重复代码的注释；作者/日期由 Git 追踪，不强制每类注释。 |

## Uber 与 AWS

| ID / 官方来源 | 阅读范围与语境 | 提炼、例外与成本 |
|---|---|---|
| U01 [Uber Go Guide](https://github.com/uber-go/guide/blob/master/style.md) | Handle Errors Once；Don't fire-and-forget goroutines 及子节；Performance 导言 | 错误处理有边界，后台工作要能停止并等到退出，性能优化限定热点。转成 JS/Python 生命周期要求，不引入 Go 工具或语法。 |
| W01 [AWS 安全部署](https://d1.awsstatic.com/builderslibrary/pdfs/automating-safe-hands-off-deployments-clareliguori.pdf) | 2020 年文章，14 页全部正文；典型 AWS 服务，不是本项目现状 | 发布前验证兼容，限制扩散，观察后再推进，准备可信回退；紧急操作仍有约束。多区域分波、观察时长与比例依赖规模；本项目尚无通用自动回滚，不宣称无人值守。 |

## 阅读结论

共同方向是让需求、接口、测试、审查和交付证据彼此对应，而非增加术语或文件数量。本项目额外约束来自自身：Agent 权限、私有记忆、Session 隔离、多 worktree、原生宿主、npm 分发。这些约束的具体规则不能冒充外部来源结论。

本次未扩展到 Java/MySQL 全量规约、Google 全部语言指南、微软全部云架构手册。若未来引入对应技术，在专项设计时再精读，不以厂商名代替论证。
