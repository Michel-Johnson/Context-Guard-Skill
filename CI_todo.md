# CI TODO

状态阅读规则：最新专项验收优先；历史实现记录不自动代表当前部署或完整端到端通过。文档入口见 [docs/README.md](docs/README.md)。

## Claude 隔离实验与 Coordinator（开发中，未交付）

- [ ] Coordinator 对话体验与任务入口：安全 Markdown、聊天排版、折叠内部事件；新增 TODO/Bug 主动对接；Cloud 发起本机新 Session。各能力分别验收，不能把界面渲染当成派单能力完成。
  - 聊天界面开发分支已通过正式浏览器回归：列表/代码/表格/链接、拒绝 HTML 执行与外部图片请求、折叠运行记录；尚未合并部署。

- [x] Claude 官方配置目录优先、角色提示词随包安装；安装隔离回归通过，保留其他宿主配置。
- [x] 本地控制接口允许有界的大 Map/历史响应，超限明确报错；回归覆盖超过旧 1 MiB 上限的成功响应。
- [x] 原生 Claude 实验复现并修复未绑定 Stop 提示反复触发模型、Session 名称丢失；正式回归通过，隔离安装入口已有原生启动/工具/停止证据。
- [x] Claude 本地投递适配器的串行、准确 Session 恢复、丢失确认与重复投递回归；隔离 Cloud 工作台已实际唤起原生 Claude，并收到开始/完成回报。不代表开发、CI 和合并闭环通过。
- [x] Coordinator 模型传输层验证固定模型、超时、响应限制和持久工具操作身份；真实模型工具调用已验证，不代表 Cloud 工具接线完成。
- [ ] Cloud Coordinator 的持久对话、受限工具、页面确认与审核、CI 委托接线。
  - PR #181/#182 已合并并部署，实验项目已启用真实模型；规范名称枚举及受限别名兼容已通过原失败请求的真实恢复验收。模型已读取 Main 并产出两个真实节点提案。
  - 节点批量审核入口开发中：同版本提案原子提交、浏览器权限、拒绝反馈、重启重放与既有 Coordinator 自动通知；真实提案确认与后续开发仍待验收。
  - PR #183 已部署并通过真实批量节点确认：两个节点落入 Main，自动准备需求、模拟人工批准后唤起 Claude，真实 Plan 已提交。发现审核工具 taskId 复制错误后对话锁住；确定参数错误反馈与人工纠正入口正在修复，尚未进入代码开发。
  - 开发分支已加入受限会话发现、持久问答、显式重试和需求确认入口；9 项 Coordinator 回归与真实浏览器功能开关、文本安全、刷新重试回归通过。HTTP 验证需求确认只接受浏览器权限、绑定原需求版本且可重复重放；节点挂载确认、审核后自动推进和 CI 委托未完成，尚未部署。
- [ ] Claude 启动/失败/压缩/退出 Hook 完整覆盖，CI 测试授权与准确 SHA 隔离，原生中断恢复。
  - 真实开发超时后缺少继续入口：开发本机显式恢复同一 Session，保留原交付与恢复回执，旧进程未退出时拒绝；真实恢复及 Cloud 任务收口仍待验证。
  - 开发分支新增：现有协议队列自动通知 Coordinator，重启与丢失消费确认不重复启动模型；CI 的设备归属、独立 worktree、证据命名空间、准确 SHA/源码未改校验和精确测试命令授权已通过定向测试。原生 Claude CI 完整交付、CLI Plan/handoff 的端到端验收和中断恢复仍未完成。
  - 独立 Claude CI 已通过真实启动并加载指定模型/Skill；原生工具失败、PreCompact/PostCompact 和 SessionEnd 已观察到。API 失败 Hook 的独立故障注入仍在验证，不把安装了事件算作原生验收。
  - 修正已识别旧版本被目录误标为 legacy 的自举阻塞；修正 CI 结束与清理之间短暂残留授权。人工验收绑定当前 CI 版本，拒绝后按原反馈返工，未验收时禁止完成；接口定向测试通过，完整浏览器闭环尚未完成。
- [ ] 实验工作台首次发布后 Session 视图恢复；已观察到 Session 快照关闭后的 `UNKNOWN_VIEW`，不能把心跳在线当作地图可编辑。
- [ ] 两 Bug 两 TODO 的真实开发、Plan/CI/验收拒绝返工、GitHub CI/合并/归档可信闭环。
  - 返工提示补充 Cloud 已保存的原始拒绝理由；正式回归覆盖人类验收拒绝和 CI 失败，不以模板回归代替真实 Claude 返工验收。
  - 开发分支补充真实 GitHub PR/Required Check 只读校验与服务器发布回执关联；锁定仓库、分支、准确 SHA、Check App 身份和验收→合并→归档顺序。不采信 Agent 自述，未配置校验时继续拒绝关闭。定向回归通过，私有仓库凭证配置、真实合并与关闭回报仍待端到端验收。
- [ ] 30 分钟心跳与故障恢复观察，以及产品 Required CI、合并后的安装副本和 Cloud 真实验收。
  - 首轮开发期观察记录 180 次采样：本地后端显式重启期间出现 2 次离线，最大心跳年龄 44.7 秒，之后自动恢复。此轮包含故障操作，不作为无故障稳定性验收。

## 仓库整理

- [x] 第一阶段：设计草案集中到 `docs/design/`，建立文档入口与现有文件职责表；不改 Hook、角色设计和运行接口。
- [x] 第二阶段源码整理与本地回归：生产/演示分离、公共协议归位、旧同步兼容区迁移、重复 I/O 与清单去重。合并与安装/生产验收另按 RULE 执行并归档，不用源码测试代替。
  - PR #178（`7d9b215`）画廊迁移已通过 CI、安装一致性与真实 Cloud 页面验收。
  - PR #179（`437c385`）完成共享层、演示隔离与清单去重；Required CI、65 文件安装一致性和 Cloud 部署完成。
  - 上线复核补充：删除服务端读取失败后回退静态地图的路径；字体延后加载。正式 Cloud 浏览器测试覆盖截断响应不串图、字体停滞不阻塞启动及重试恢复。
  - 演示地图、示例 Session/Bug 和预设项目移到 `site/demo/`；生产仅加载空白数据结构，浏览器回归验证初始化不写入演示模块。
  - Map/记忆校验、消息协议、事务/工作流、快照/附件与 I/O 位于 `scripts/shared/`；正式测试限制共享层反向依赖服务，并检查 Cloud 不再导入 workbench 实现。
  - 旧 Map-only 实现迁入 `scripts/legacy/`，保留 `scripts/sync/client.mjs` 薄兼容入口；正常工作台仅复用共享路径工具。旧调用仍有使用者，不删除功能或更改传输契约。
  - 安装/npm 文件清单复用、测试批准清单集中到 test-manifest；正式回归检查暂存策略、目录覆盖与演示数据不分发。Hook 和角色设计不变。

## Bug 计数与测试数据清理

- [x] Bug 按未解决数量计数；已解决/验收通过/不修复不计数，待人类验收与验收拒绝仍计数。正式浏览器回归通过。
- [x] PR #176（`c590066`）：未挂节点 Bug 清理的鉴权/保留正式测试、Required CI、生产部署、版本化清理及重启后读取通过；非 Bug 内容保持不变。
- Cloud 测试 Bug 清理仅针对当前项目的 Main/Session 地图；先备份再按版本提交，保留 TODO、经验和历史记录。

## 人工验收：不再为勾选派发总结（已部署，Coordinator 后续流程未实现）

- [x] Bug/TODO 共用验收接口；完成回报先带结果、证据与经验，通过时原子写入验收标签与单任务经验，拒绝时持久保存反馈，不唤醒模型。接口测试覆盖并发去重、旧版本、错会话、未完成、未认证及重启恢复。
- [x] 浏览器 ✓/✕、拒绝理由与刷新恢复；四组浏览器回归通过。补齐同步移除当前 Bug 与静态预览无后端配置时的空值处理。
- [x] 同步最新 main 后本地 `npm test`：310 通过、1 平台跳过；38 项安全检查与 29 项安装边界通过。计划扩展保留原始基线和未完验收，不以扩展掩盖已有修改。
- [x] PR #174（`16a764b`）：Required CI、Cloud 部署、安装文件一致、真实页面通过/拒绝及刷新、重启持久化验收通过；不代表原生 Hook 验收通过。
- [ ] Coordinator 的沟通、反馈消费与返工流程由用户后续设计；当前仅保留待处理反馈接口。

以下“勾选后派发总结”是历史行为，已由 PR #174 替代，仅保留当时验证证据，不再作为当前执行流程。

## Bug 真实总结与精简派单（已部署，安装入口与真实桌面验收通过）

- [x] 派单只保留一次任务内容和 start/finish 短命令；脚本从当前 Session 的持久收件箱补齐消息身份，覆盖越权、未知编号、空总结与重复回报（`tests/interface-events.test.mjs`、`tests/interface-delivery.test.mjs`）。
- [x] 用户确认 Bug 解决后，在原 Session 的 Cloud 队列派发总结任务；成功回报前不生成经验，刷新后可读取真实总结（`tests/interface-events.test.mjs`、`tests/cloud-sync-browser.mjs`，隔离环境）。
- [x] 同一 Bug 并发确认去重，失败保留并可重试，刷新显示真实总结（接口与浏览器隔离测试）。
- [x] PR #171/#172 已合并并更新全局 Skill 与完整 Cloud；安装文件逐字节一致。两个真实 Bug 总结由原桌面 Session 执行并在 Cloud 展示；第一次总结在服务重启后保留，第二次确认无重复保存冲突。
- [x] 状态通知不再取消用户主动重读；完整浏览器回归覆盖输入法草稿冲突后的恢复（`tests/workbench-browser.mjs`）。

## 设备级通讯精简（已部署，已加载桌面 Session 派单验收通过）

- [x] 地图/任务处理阻塞时独立发送心跳（`tests/interface-transport.test.mjs`）。
- [x] 地图同步与同 Session 消息确认分离；混合心跳隔离失效绑定，Cloud 只登记通过鉴权的条目（`tests/interface-transport.test.mjs`、`tests/interface-store.test.mjs`、`tests/interface-events.test.mjs`）。
- [x] 心跳携带宿主执行状态，Cloud API 区分连接在线与 active/stopped/unknown；隔离服务验证状态转换（`tests/interface-events.test.mjs`）。真实桌面派单及总结过程中已观察执行状态，结束后回到空闲。
- [x] Cloud Session 深链接保留全部 Session 和 Main 入口（`tests/cloud-workbench-browser.mjs`）。
- [x] Cloud 模式下损坏的本地日志自动备份恢复，保留地图与操作去重回执；损坏的待提交事务仍单独保护（`tests/workbench-journal-recovery.test.mjs`）。
- [x] 设备公共服务汇总项目心跳，同 Cloud 一次请求，项目凭据隔离；本地项目移除独立 Cloud 心跳/事件调度（`tests/interface-auth.test.mjs`、`tests/interface-transport.test.mjs`、`tests/interface-events.test.mjs`）。安装入口、服务升级恢复及下述 30 分钟持续心跳验收通过，不代表任意长时间网络故障均已验证。
- [x] 页面区分在线/执行中/空闲及任务完成结果；删除设备连接类中已被替代的项目级心跳、重试定时器和 Cloud SSE 循环（`tests/interface-events.test.mjs`、浏览器回归）。旧 Map-only 独立产品命令不属于设备 v2 调度路径。
- [x] Session 执行回报与代码发布分离，服务端递增序号维持 FIFO；完成/失败/取消释放队列，重复回报与重启保持幂等（`tests/interface-workflow.test.mjs`）。
- [x] 安装入口向已加载的真实“测试”Session 派发 2 Bug + 2 TODO；复用现有桌面实例，Cloud FIFO 逐项执行且四项均返回 completed，无临时 App Server 辅助。未加载 Session 的冷启动仍单列如下。
- [x] 安装入口与 Cloud 部署版本一致；真实设备持续心跳观测 30 分钟，178 次采样无失败、最大心跳年龄 8.6 秒。该项不代表原生派单已通过。
- [ ] 桌面唤醒差异收口：`codex queue` 已通过复用现有桌面的真实执行验收；此前未加载会话出现只入队、不执行。需对齐成功调用的入口及宿主状态并补未加载场景回归，不能推断桌面不支持，也不能把打开会话后的成功或另起 App Server 算作该场景通过。
- [x] macOS 原会话公开链接加载接入本地派单脚本；正式适配器测试覆盖加载先于投递、加载超时不入队、非法 Session ID、重启重放不重复加载/投递、投递结果未知保护。测试替身不等于实机自动打开验收。
- [ ] macOS 安装入口自动加载未加载会话并处理 Cloud 任务的实机验收；人工点击公开链接已验证 notLoaded → idle，不替代脚本自动调用证据。Windows/Linux 自动加载未实现，本轮不声称覆盖。

本轮证据：PR #156/#157/#171/#172 的 Required CI 均通过；最终功能版本 `aac5d27`，本地 `npm test` 305 通过、1 平台跳过，29 项安装边界和两组浏览器回归通过。Hooks 按用户要求保持关闭，doctor 的 Hook 信任汇总/执行/注入证据未通过，不作为本轮已验收能力。

- [x] Cloud 保存失败时在顶栏直接展示结构化错误码与简短原因，完整诊断仍保留在“同步与恢复”中。

## 接口 1.0（历史逐项验证记录，当前生产范围见上方专项）

以下“未部署”“待验收”描述各项最初记录时的范围，不能用于推断当前全部 Cloud 未部署。设备连接、人工验收等已有后续专项证据；尚未覆盖的授权审核/最终关闭等条目继续保留，不因文档整理统一打勾。

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
- [x] IF-049：Cloud 工作台使用稳定交付编号提交已批准的 TODO/Bug；服务端一次事务保存任务说明、人工批准和任务分配，重复提交只返回原结果（`tests/interface-events.test.mjs`、`tests/cloud-sync-browser.mjs`）。
- [x] IF-050：执行 Agent 忙碌时任务留在 Cloud 队列；前一任务可信关闭后按先入先出自动激活下一任务，工作台读取真实的排队、收到、待确认和执行状态（`tests/interface-workflow.test.mjs`、`tests/interface-events.test.mjs`）。
- [x] IF-051：宿主明确拒绝时保留同一交付编号重试；接收结果不确定时停止自动重投，避免重复触发模型；浏览器中的最终完成/解决状态覆盖传输状态（`tests/interface-delivery.test.mjs`、`tests/workbench-browser.mjs`）。
- [x] IF-052：项目统一消息泵接管连接时仍先初始化并重新开启已发布的 Session；Main 与本地已有相同变更时不误报冲突（`tests/workbench-sync.test.mjs`）。
- [x] IF-053：首次登记 Session 时直接携带本地任务名称与平台，不依赖 Hook 后续补写（`tests/workbench-sync.test.mjs`）。
- [x] IF-054：统一协调器为旧 Session 补齐显示名称时保留原地图、记录、基线和源码提交（`tests/workbench-sync.test.mjs`）。
- [x] IF-055：活跃或短期过期的本地 Cloud 凭证自动续期且不保存密码；明确拒绝后本地立即退出“已连接”状态（`tests/interface-auth.test.mjs`、`tests/interface-device.test.mjs`）。
- [x] 现有 Map 协调器在支持能力的 Cloud 上由项目消息泵驱动；旧 Cloud 保留兼容入口。
- [x] 同一已授权 Session 内跨角色对象共享、任务/Plan/审核/CI 交接、工作台变更、固定快照分页、附件续传与兼容入口已接线。暂时性记忆传输失败保留待同步状态，授权与冲突门禁不放松。
- [ ] 未确定 Cloud Main 合并白名单与可信归档验证器，实际合并/最终关闭保持拒绝；不把测试注入的验证器当作生产合并实现。Cursor/Claude 提供显式 CLI 拉取入口，尚无自动唤醒适配器。
- [ ] GitHub CI、生产 Cloud 与安装入口验收；本地全量 `npm test`、完整浏览器回归和隔离 Cloud 真人点击流程已通过。合并包内容白名单未确定前拒绝实际合并。

- [x] Cloud Map 成功响应前持久化事件、地图与回执；中断恢复、重启恢复、服务器时间和多项目并发均有正式测试（`tests/cloud-workbench.test.mjs`）
- [x] Cloud 项目总览重建时保留人工编辑、TODO 和自定义字段，重启后仍可恢复（`tests/cloud-workbench.test.mjs`）
- [x] Cloud 与私有 Main/Session 记忆 API 可由同一进程、同一 Origin 提供，且 Session 不覆盖公共/Main Map（`tests/cloud-workbench.test.mjs`）
- [x] Cloud 工作台切换并编辑独立 Session Map，刷新恢复且不覆盖 Main（`tests/cloud-workbench-browser.mjs`）
- [x] Hook 在 SessionStart/UserPromptSubmit/PostCompact 直接同步当前 Session；首次断线后由下一生命周期事件自动补偿，不依赖常驻进程；Cloud 页面可等待尚未注册的 Session 并在服务端落盘后无刷新自动进入（`.github/scripts/multiworktree.test.mjs`、`tests/hook-lifecycle.test.mjs`、`tests/cloud-workbench-browser.mjs`）
- [x] Cloud 未登录首页展示密码登录页；密码哈希、持久安全 Cookie、退出、错误限速及浏览器登录流程（`tests/cloud-workbench.test.mjs`、`tests/cloud-workbench-browser.mjs`）
- [x] 私有记忆写入保留带服务器时间的完整历史；恢复生成新版本并用 CAS 阻止静默覆盖（`tests/cloud-workbench.test.mjs`）
- [x] 工作台托管的 Session Map 后台同步：事件驱动上传/接收、持久 outbox、断线与冷启动恢复、SSE 游标续传、响应丢失幂等、字段级合并和三方冲突保留（`tests/workbench-sync.test.mjs`、`tests/cloud-workbench.test.mjs`、`tests/cloud-sync-browser.mjs`）
- [x] 旧 Map-only `sync serve/connect/pull` 实现已迁到 `scripts/legacy/map-sync.mjs`；带 Session 的 `sync ensure/status` 继续转交工作台，旧路径为薄兼容入口，现有 Hook/CLI 消费者保留回归。
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

- [x] 项目一次登录复用设备凭据读取记忆，新 Session 经 CLI 自动登记；Cloud 仅返回统一前端地址；持久化 Session ID/名称，重启后先离线再由后台心跳恢复（`tests/interface-events.test.mjs`）。
- [ ] 新机器首次密码登录及安装副本连接生产 Cloud 的人工验收；隔离接口测试不代表生产部署已完成。

- [ ] 本轮未按用户要求运行测试：验证 Cloud 不再渲染或接受人工发布 Main，合入权威 main 后由服务器自动发布；验证旧的非空 mode-less Session 授权升级为动态 `all`，明确 `explicit` 收窄不受影响；验证已配置 Cloud 时 Hook 只返回 Cloud 前端地址而本地服务仅作后台。

- [ ] 本轮开发待集中验收：Hook 动态全权限与显式撤权一致；Cloud 从本 Session 生命周期记录读取任务名称；页面 Session 切换失败提示、后端重启自动恢复、10秒轻量版本补读。需安装副本与真实 Cloud 页面验收，不以源码存在代替已部署。

- [x] 兼容旧 Cloud 的 Session 同步：事件流无数据/响应头停滞时超时重连；独立心跳补读 Cloud-only 修改；心跳单飞、无变化不写盘、v2 接管停用旧心跳（`tests/workbench-sync.test.mjs` 的 Legacy sync/heartbeat 用例）
- [x] Cloud 当前状态读取合并并发冷读，缓存排除历史与回执；外部文件替换失效、写入失败不发布缓存、保留完整磁盘历史；64 MiB 堆下50并发读取回归（`tests/cloud-workbench.test.mjs`）
- [ ] 历史与回执继续增长时的分片存储及历史查询/写入峰值内存；本次不删减历史，热读缓存不等于消除无限存储增长
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
- [ ] 本轮按用户要求未在本地运行测试：验证认证浏览器可直接编辑私有 Main Map，刷新后仍从服务器权威文件读取；验证重复 `operationId` 幂等、复用 ID 被拒绝、过期 `baseVersion` 返回冲突，同时项目令牌仍不能直写 Main
- [ ] 本轮按用户要求未在本地运行测试：验证真实 Hook 上传在 Cloud Session 被人工编辑后执行三方合并；重叠字段和缺失共同基线时写入 `remote-sync/conflict.json` 并停止上传，断线重放先持久化回执
- [ ] 本轮按用户要求未在本地运行测试：验证线上 Session 最近活动两分钟内显示运行中、明确 Stop/完成显示已完成、没有新生命周期事件则转为断联/未知，旧 `SessionStart` 不再永久转圈
- [ ] 本轮按用户要求未在本地运行测试：验证普通 merge 与 squash merge 均能触发自动 Main 发布；squash 后同路径再被修改时必须保持 waiting，源提交不可达时不得误发布

## 架构与测试治理

- [x] 明确开发请求不重复索要计划确认；Context Guard 控制命令可经 Node/Python 正式入口和字面量 stdin 安全通道自举；PR 合入 main 后强制从合并版本更新本机 Skill，并通过安装入口执行真实功能验收（`tests/hook-lifecycle.test.mjs`）
- [x] 将 `prototype/workbench.html` 的样式、演示数据和交互逻辑分层，并同时覆盖本地 CSP、Cloud 静态路由和官网演示构建（`prototype/workbench.css`、`prototype/workbench-fixtures.js`、`prototype/workbench-app.js`）
- [x] 消融删除硬编码的伪用户记忆，并补充旧缓存迁移提示断言（`docs/ablation-review.md`、`tests/workbench-browser.mjs`）
- [x] Session 下拉框按 ID 去重且不展示原始 ID，URL 固定当前会话，发布/关闭项移除、失效项禁用；关系模式默认关闭并在 Session 切换时退出（`tests/workbench-browser.mjs`、`tests/cloud-workbench-browser.mjs`）
- [x] 用统一清单约束自动测试、独立套件与 helper，禁止遗漏和 `.only`，并明确开发/Review/E2E 的责任边界（`tests/test-manifest.json`、`docs/test-governance.md`）
