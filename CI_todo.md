# CI TODO

## 接口 1.0（开发中，尚未完成 Cloud 联调）

- [x] IF-001～IF-005：25 种消息的公共格式、字段白名单、Session 代次、大小和失败证据校验（`tests/interface-protocol.test.mjs`）。仅格式验证，不代表 25 种业务均已实现。
- [x] IF-006～IF-009：并发重试去重、写盘失败原子回滚、连续确认、身份隔离与重新鉴权（`tests/interface-store.test.mjs`）。
- [x] IF-010～IF-014：HTTP 凭证和 Origin、旧服务器响应拒绝、Cloud-only 变更触发读取、先持久处理后确认、本地后端 Session 绑定与读取（`tests/interface-transport.test.mjs`）。本地隔离测试，不等于真实 Cloud 验收。
- [x] IF-015：Session 内对象不可变版本、CAS 更新、重启读取和禁止伪造审核对象（`tests/interface-store.test.mjs`）；授权审核签发见 IF-027。
- [x] IF-016：旧记忆请求对 HTML、空白、截断 JSON、未登录分别明确失败，保留未知写入结果（`tests/interface-memory-errors.test.mjs`）。
- [x] IF-017～IF-018：1/10/50 Session 只读心跳不写盘、打印局部 CPU/内存/响应大小测量；一个 Session 卡住不阻塞其他 Session 的确认（`tests/interface-store.test.mjs`、`tests/interface-transport.test.mjs`）。不是整机长期性能验收。
- [x] IF-019：分块附件重启续传、重复块校验、总哈希、未完成不可读、Range 与项目/Session 隔离；IF-014 同时覆盖本地二进制 HTTP 上传/下载（`tests/interface-blobs.test.mjs`、`tests/interface-transport.test.mjs`）；Cloud 二进制入口见 IF-024。
- [x] IF-020～IF-021：Cloud v2 短期凭证持久化/过期/退出/登记撤销，本地启动实际 Cloud 服务测试登录、已登记 Session 绑定及拒绝伪造（`tests/interface-auth.test.mjs`）。未部署生产 Cloud。
- [x] IF-022～IF-023：密码只授权后端设备、设备登记 Agent、丢失回复后重启重放、本地与 Cloud 绑定版本转换（`tests/interface-device.test.mjs`）。
- [x] IF-024～IF-026：Cloud 二进制 HTTP 上传/Range/鉴权、上行恢复保持 Session 顺序且隔离失败、一个 Cloud 事件连接通知多个自有 Session（`tests/interface-auth.test.mjs`、`tests/interface-device.test.mjs`）。均为本地隔离 Cloud 服务验收。
- [x] IF-027～IF-028：任务状态机要求人确认说明、主 Agent 审核 Plan、CI 后保持 busy、可信合并/归档回执后才关闭；不同调用方的消费确认互不覆盖（`tests/interface-workflow.test.mjs`、`tests/interface-store.test.mjs`）。真实宿主投递、工作台接线和合并回执验证尚未完成；未配置验证器时明确拒绝收口。
- [x] IF-029～IF-030：宿主投递先持久保存意图；未知结果不重复调用；页面重试/刷新保留交付编号、旧后端不支持时拒绝冒险重发（`tests/interface-delivery.test.mjs`）；HTTP 按钮接线见 `tests/workbench-sync.test.mjs`。
- [x] IF-031：只读状态缓存检测其他进程写入，冻结缓存防止只读操作修改数据（`tests/interface-store.test.mjs`）。
- [x] IF-032～IF-033：本地隔离 Cloud 的项目级事件流/心跳、事件停滞补漏、收件箱重启去重、附件经本地代理上传/Range、拒绝异常事件和停滞连接（`tests/interface-events.test.mjs`）。已接入本地后端生命周期。
- [x] IF-034～IF-036：工作台固定快照分页与撤权、上行新请求不越过旧未知请求、Map 修改复用事务回执、保留旧字段及稳定记录目标（`tests/interface-snapshots.test.mjs`、`tests/interface-device.test.mjs`、`tests/interface-map.test.mjs`）；本地读取/写入 HTTP 接线见 IF-014。
- [x] IF-037～IF-038：私有 Cloud Map 版本纳入项目心跳，协调器停止自己的事件连接；节点顺序经过同步适配器后保持一致（`tests/interface-events.test.mjs`、`tests/interface-map.test.mjs`）。旧服务不支持时保留旧入口；仍需完整多 Session/断线实际环境验收。
- [x] IF-039：GitHub 数字 ID 核验、同源仓库重定向、Cloud 项目不匹配时拒绝保存凭证（`tests/interface-repository.test.mjs`）；密码输入 UI 不保存密码（`tests/workbench-browser.mjs`）。
- [x] IF-040～IF-042：并发过期锁恢复、消息/关系/人类访问控制、固定 Map/队列屏障恢复及不伪造执行确认（`tests/interface-store.test.mjs`、`tests/interface-map.test.mjs`、`tests/interface-snapshots.test.mjs`）。IF-014 同时覆盖 CLI stdin 入口、人类撤权及拒绝未完成附件引用。
- [x] IF-043～IF-045：任务交付保持需求/节点/Main 版本，中断 Hook 重试原始信号，记忆传输失败不阻塞已授权源码准备而权限/冲突仍阻塞（`tests/interface-delivery.test.mjs`）。IF-027 增加 CI TODO 完整覆盖校验与原记录打勾、关联测试编号，不删除原项。
- [x] IF-046：同一真实本地后端绑定两个 Session，使用隔离 Cloud 服务验证 Map 不串线、人类确认说明后原生队列投递、重复请求不再投递、脚本中断上报与 Main 查询（`tests/interface-events.test.mjs`）。原生队列适配器使用可计数测试替身，不代表启动真实模型。
- [x] IF-047～IF-048：关系修改回执保留旧/新端点权限，旧关系首次编辑建立稳定编号并保留自定义字段（`tests/interface-map.test.mjs`）；IF-046 同时验证 Cloud 不向执行方分发无权读取的节点。
- [x] 现有 Map 协调器在支持能力的 Cloud 上由项目消息泵驱动；旧 Cloud 保留兼容入口。
- [x] 同一已授权 Session 内跨角色对象共享、任务/Plan/审核/CI 交接、工作台变更、固定快照分页、附件续传与兼容入口已接线。暂时性记忆传输失败保留待同步状态，授权与冲突门禁不放松。
- [ ] 未确定 Cloud Main 合并白名单与可信归档验证器，实际合并/最终关闭保持拒绝；不把测试注入的验证器当作生产合并实现。Cursor/Claude 提供显式 CLI 拉取入口，尚无自动唤醒适配器。
- [ ] 全量本地回归、GitHub CI、隔离真实 Cloud 与安装入口验收；合并包内容白名单未确定前拒绝实际合并。

- [x] Cloud Map 成功响应前持久化事件、地图与回执；中断恢复、重启恢复、服务器时间和多项目并发均有正式测试（`tests/cloud-workbench.test.mjs`）
- [x] Cloud 项目总览重建时保留人工编辑、TODO 和自定义字段，重启后仍可恢复（`tests/cloud-workbench.test.mjs`）
- [x] Cloud 与私有 Main/Session 记忆 API 可由同一进程、同一 Origin 提供，且 Session 不覆盖公共/Main Map（`tests/cloud-workbench.test.mjs`）
- [x] Cloud 工作台切换并编辑独立 Session Map，刷新恢复且不覆盖 Main（`tests/cloud-workbench-browser.mjs`）
- [x] Hook 在 SessionStart/UserPromptSubmit/PostCompact 直接同步当前 Session；首次断线后由下一生命周期事件自动补偿，不依赖常驻进程；Cloud 页面可等待尚未注册的 Session 并在服务端落盘后无刷新自动进入（`.github/scripts/multiworktree.test.mjs`、`tests/hook-lifecycle.test.mjs`、`tests/cloud-workbench-browser.mjs`）
- [x] Cloud 未登录首页展示密码登录页；密码哈希、持久安全 Cookie、退出、错误限速及浏览器登录流程（`tests/cloud-workbench.test.mjs`、`tests/cloud-workbench-browser.mjs`）
- [x] 私有记忆写入保留带服务器时间的完整历史；恢复生成新版本并用 CAS 阻止静默覆盖（`tests/cloud-workbench.test.mjs`）
- [x] 工作台托管的 Session Map 后台同步：事件驱动上传/接收、持久 outbox、断线与冷启动恢复、SSE 游标续传、响应丢失幂等、字段级合并和三方冲突保留（`tests/workbench-sync.test.mjs`、`tests/cloud-workbench.test.mjs`、`tests/cloud-sync-browser.mjs`）
- [ ] 删除或迁移旧 Map-only `sync serve/connect/pull` 协议；当前带 Session 的 `sync ensure/status` 已转交工作台，旧命令仍为兼容入口
- [x] `sync serve/ensure` 长驻进程、断线重连和 SSE 游标恢复（`tests/cloud-sync-client.test.mjs`）
- [x] `sync checkpoint` 独立检查冲突但不发布 Session Map（`tests/cloud-sync-client.test.mjs`）
- [x] 显式 `plan-start` / 工具观察 / Map 归档 / `plan-finish` / Stop 流程；Cloud 成功与完成后本地回执丢失重试（`tests/hook-lifecycle.test.mjs`）
- [x] 工作台 Cloud 状态图标：编辑立即离开“已同步”，服务器确认后恢复“已同步”，并发覆盖显示“冲突”且保留草稿（`tests/cloud-workbench-browser.mjs`）
- [x] 首次连接冲突时的 `connect --pull` / `connect --push`（`tests/cloud-sync-client.test.mjs`）
- [x] 多意图 signal 拆分、TODO/坏例幂等、分类冲突不写 Map、未分类信号保留（`tests/hook-lifecycle.test.mjs`）
- [x] 归档缺文件、缺验证/评估/范围复核/子 Agent 复核、归档后文件变化均不能完成；已有脏文件再次修改可识别（同上）
- [x] 跨 session inbox 通知、CLI 路径别名入口、空响应及同步失败/冲突拒绝；Windows 不再跳过跨 session 断言（同上）
- [ ] 真实 Codex/Claude/Cursor 完整对话的原生 Hook 触发与交互验收；脚本已覆盖 Codex 静默延期、下一轮恢复及其他宿主不泄露内部标识，但脚本模拟不等同于客户端验收
- [x] 同一 session 并行 Hook/CLI 以进程锁串行，崩溃自动释放；损坏状态保留并失败关闭（`tests/hook-runtime-concurrency.test.mjs`）
- [ ] 任意脚本越出声明目录的实际修改追踪；当前明确标记范围未知并要求 Agent 复核，不声称已自动校验
- [ ] 模型提供的分类、测试证据、节点评估的语义真实性：当前校验必填信息和成功回执，不能证明模型判断正确
- [x] Bad Case 本地多文件与远端 Map 的跨进程崩溃事务恢复：持久事务日志、幂等重放、signal 收口及 occurrence/fix 中断测试（`tests/hook-lifecycle.test.mjs`）

## 工作树绑定与私有记忆

实现与实际部署分开验收。规范见 `references/server-memory.md`；自动化用例在 `.github/scripts/multiworktree.test.mjs`。

- [x] 显式 Session 绑定、共享项目语言、单服务与独立 Git Session 地图；重新绑定使旧令牌失效
- [x] Session 绑定先验证工作台 URL、项目/实例/runtime，再原子提交；命名入口与直连入口均返回可核验回执
- [x] Git worktree 使用稳定管理目录标识，支持移动且拒绝路径复用误绑定；页面固定到 URL 指定 Session，不按活跃度自动跳转
- [x] 多来源活动状态按事件时间合并，较新的停止/失败/取消终态不会被旧 active 覆盖；未知状态不显示工作中转圈
- [x] 旧版/重复工作台只诊断不自动替换；显式迁移先在 Git 公共私有目录备份，再按精确 pid:instance 温和退出
- [x] 私有记忆接口：鉴权、CAS、原子快照/回执、主分支祖先验证；公开 Map 接口隔离
- [x] 用户服务器真实部署、TLS、仓库镜像刷新、SSE 快速重启及重启后持久化验收（`tests/cloud-workbench.test.mjs`；生产验收记录在私有 Session 记忆）
- [x] 历史记忆清点、备份、迁移、版本覆盖核验及实际切换（生产验收记录在私有 Session 记忆）
- [x] 同一真实 Session 发布后可从最新 Main 自动开启下一代 Session Map；旧回执保持幂等，过期基线和重叠改动明确冲突（`tests/cloud-workbench.test.mjs`、`tests/workbench-sync.test.mjs`）
- [ ] 原生 Codex UI 中安装新版本、审阅 Hook 后验证实际上下文投递；doctor 只能证明输出已生成

## 项目命名工作台

- [x] 兼容旧 Cloud 的 Session 同步：事件流无数据/响应头停滞时超时重连；独立心跳补读 Cloud-only 修改；心跳单飞、无变化不写盘、v2 接管停用旧心跳（`tests/workbench-sync.test.mjs` 的 Legacy sync/heartbeat 用例）
- [ ] 生产网络下长时间断流与恢复观察；隔离故障测试通过不等于所有生产断连原因已经消除

- [x] 命名入口 Host/Origin/令牌隔离、读写、5 个 session/SSE、原生 Python SessionStart 处理函数、自动打开去重（`tests/named-workbench.test.mjs`）
- [x] 并发启动共享代理、名称冲突不接管、后端端口复用身份校验、代理重启及项目退出隔离、损坏路由文件拒绝覆盖
- [x] 同一 Git 仓库的显式 worktree 绑定、保留原 Map、拒绝跨仓库绑定；许可证随包及 Skill 安装验证
- [x] 命名入口与 Session 隔离兼容、未绑定不启动、跨 worktree 重启保留项目命名入口
- [x] 全局运行态清单合并项目注册表、命名路由和后端探测；区分 ready/stopped/legacy/duplicate/unknown，跨 worktree 按实例去重，未绑定 Hook 复用同项目命名地址（`tests/named-workbench.test.mjs`）
- [x] 项目首次绑定仍需确认；后续真实 Session 按 Session ID 自动绑定唯一已建立工作台，并自动恢复兼容的停止服务；歧义、错配和真实迁移继续要求确认（`tests/named-workbench.test.mjs`、`tests/ci-smoke.mjs`）
- [x] 新 Session 默认动态拥有自己的完整工作台权限（含未来节点），人工可收窄、撤销和恢复；Main 写入、发布和管理权限始终隔离（`.github/scripts/multiworktree.test.mjs`、`tests/workbench-sync.test.mjs`、`tests/hook-lifecycle.test.mjs`）
- [ ] 各宿主应用实际投递 SessionStart、桌面浏览器启动失败反馈；处理函数测试不等于所有宿主端到端验收
- [ ] macOS/Windows/Linux 浏览器的 `.localhost` DNS 解析与受管网络策略兼容；正式精简实现的长期 CPU/内存/物理 I/O 基准
- [ ] 旧 Map-only Cloud Sync 与多个 worktree 的联调；旧服务目标绑定不代表服务器迁移完成
- [ ] 启动器强制终止后空/损坏启动锁及遗留 reclaim 锁的显式恢复工具；当前失败关闭，不擅自删除未知锁

## 架构与测试治理

- [x] 明确开发请求不重复索要计划确认；Context Guard 控制命令可经 Node/Python 正式入口和字面量 stdin 安全通道自举；PR 合入 main 后强制从合并版本更新本机 Skill，并通过安装入口执行真实功能验收（`tests/hook-lifecycle.test.mjs`）
- [x] 将 `prototype/workbench.html` 的样式、演示数据和交互逻辑分层，并同时覆盖本地 CSP、Cloud 静态路由和官网演示构建（`prototype/workbench.css`、`prototype/workbench-fixtures.js`、`prototype/workbench-app.js`）
- [x] 消融删除硬编码的伪用户记忆，并补充旧缓存迁移提示断言（`docs/ablation-review.md`、`tests/workbench-browser.mjs`）
- [x] Session 下拉框按 ID 去重且不展示原始 ID，URL 固定当前会话，发布/关闭项移除、失效项禁用；关系模式默认关闭并在 Session 切换时退出（`tests/workbench-browser.mjs`、`tests/cloud-workbench-browser.mjs`）
- [x] 用统一清单约束自动测试、独立套件与 helper，禁止遗漏和 `.only`，并明确开发/Review/E2E 的责任边界（`tests/test-manifest.json`、`docs/test-governance.md`）
