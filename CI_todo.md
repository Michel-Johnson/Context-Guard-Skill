# CI 待验证

## CURSOR-WORKBENCH-01 · 分阶段接入（进行中）

- [x] Skill #466/#467 已按准确 Required 合入 main `cee8e4e`，三平台官方 no-hooks 安装各100文件与该main一致，原安装完整副本保留、Hook/config字节不变。Doctor 不再崩溃，但本任务项目缺有效Map/Session/绑定仍未就绪；未重建项目。Cloud #33 当前准确组合完整468项/466pass/0fail/2skip及独立2/2、Required通过并正常合并，不代表生产部署或厂商验收。
- [x] 安装0.8.2后恢复原Session再次实际403：Cursor加载用户Claude兼容Hook，pre/post-tool-use带platform:claude覆盖真实Cursor身份。官方第三方Hook契约与本地现场一致，未禁用或修改用户Hook。正式注册表及公共HTTP两目标先实际失败；创建来源/宿主/根路径匹配时固定原生平台，冲突创建来源显示unknown，CLI-only与普通Hook不伪造身份；保留活动、停止、时间。候选Skill0.8.3，core/UI与依赖不变；准确回归、独立Review、Required、安装后原Session恢复待完成。

- [x] `2ccae20` 真实 installed Cursor 工作台创建原生会话并实际生成 multiply 文件，但调用 plan-start 后 sessions.jsonl 的通用 platform:cli 覆盖原生Cursor身份，GET回显返回403；本次验收 failed，关闭本任务backend后原生job为interrupted。失败日志与现场保留，未宣称完成或重建替代会话。
- [x] 正式公共HTTP加入后到cli活动先实际失败；保留原生平台仅针对已有 codex/cursor/claude 与 cli活动，不从只有cli的记录伪造宿主。新平台/时间/活动测试与HTTP两个目标实际2/2 exit0。Skill候选0.8.2，shared包与依赖不变；独立Review/完整回归/Required/安装后的原Session恢复待完成。
- [x] PR #464 准确 `44a86ab` Required 与跨平台检查通过，正常合入 main `2ccae20`；该 main 完整 CI `37828684419` 全部通过。从最新 main 官方安装器更新三平台，逐字节核对各 100 文件，core2.2.0/UI1.2.0；旧安装完整副本保留，客户端 Hook/config 哈希未变，未清理用户项目或其他 worktree。共享包精确 43/14 文件安全扫描通过；尚不表示 Cloud 真实任务、安装入口或项目上下文已验收。
- [x] 合并后 installed Cursor/Claude doctor 实际抛 TypeError：诊断返回项目绑定错误时没有 runtime 字段。新增两项正式安装入口回归先失败，最小字段保护后实际 2/2、exit0；保持 unknown、原有 required 规则和 not-ready 结果，不修复/替换失效绑定。Skill 候选补丁0.8.1，core/UI与依赖不变；此修订的全量、独立Review、Required、main安装待完成。

- [x] 最新 Skill main `1fa3859` 创建独立 `codex/cursor-workbench` 分支；旧目录、个人修改、第三方 Hook 和 PATH 的 Grok `agent` 均未替换。官方 Cursor CLI 2026.10.01-e373342 解压到本任务新建 temp，未执行会删除既有软链接的官方安装器。
- [x] 本地 ACP 传输、持久投递、同原生会话追问、凭据白名单、本机配置权限及精确工作树约束已实现。协议测试 11/11；配置/持久化测试 3/3；公共 HTTP 权限入口 1/1，均实际退出 0。以上使用合成协议提供方，不是 Cursor 真实模型验收。
- 首轮 ACP 测试取消夹具遗漏请求编号，旧进程被明确停止后实际 10/11、退出 1；补齐替身编号并增加取消等待上限后 11/11、退出 0。保留首次失败，不将其改记通过。
- [x] 首批 ACP/Runtime 源码完整 `npm test` 实际退出 0：501 项、499 通过、0 失败、2 个既有跳过；安全、治理与 30 项安装边界冒烟通过，Node 部分 80022.720792 ms。该结果不覆盖后来增加的 UI/原生消息/创建入口。首次缺少扫描器提前退出 1，安装锁定扫描器后才重跑；两份日志保留于 temp。不代替独立 Review、Required 和合并/安装。
- [x] 官方 Cursor CLI 已通过真实 ACP initialize，协议 1 / loadSession:true；官方浏览器登录成功，认证存储由 Cursor 管理，没有读取或输出 token。
- [x] 真实 Cursor 在本任务隔离目录新增 add.mjs / add.test.mjs，同一原生会话连续两轮：创建函数和测试，再只读解释负数加法。两轮 stopReason 均 end_turn；本方再运行真实 node:test 2/2、退出 0，实际源码与测试已检查。Cursor 输出包含 WritableIterable closed 诊断，保留原记录；没有将此模块探测当作三条工作台路径已验收。
- [x] 已补原生 prompt/result 的配对设备回显、同会话消息入口和明确 CLI 创建；正式协议/Runtime/ACP 22 项、公共 HTTP 一项通过。Cursor 工具接收边界仍用替身，默认权限未放宽；本地直聊也拒绝覆盖配对设备已分配的任务。失败预览保留，限制 40000 字符且不切断表情，私人原始输出不截断。
- [x] 正式 Chromium 四项通过：60 字分段/纯文本输出、晚到回复会话隔离、暂停更新后的键盘发送、320px reflow/Escape/焦点恢复。前两次测试页面没有 UTF-8，中文按钮名乱码导致定位失败；修正夹具编码后通过，首次失败页面与证据保留。不以 UI 替身测试代替厂商验收。
- [x] 真实源码工作台在隔离项目完成 multiply.mjs / multiply.test.mjs，并回显同一原生会话追问；本方 node:test 2/2、退出 0。首轮实际发现 ACP 空 Session 没有 store.db、冷加载拒绝，而有真实输出的会话冷加载成功；官方 create-chat 也不创建 ACP store，未采用该绕路。改为保留创建的原生连接至首个真实任务，不注入付费初始化消息、不篡改 Cursor 数据库。修订时首次配置保护误判也已保留并修复。成功私有证据 `temp/cursor-workbench-native-Vqufku/run-s1TEXX/`，厂商 WritableIterable closed 输出原样保留；这不是安装后或用户项目验收。
- [x] 扩展后准确源码完整 `npm test` 实际退出 0：509 项、507 通过、0 失败、2 个既有跳过，Node 83777.820084 ms；安全/治理与 30 项安装边界通过。日志 `temp/cursor-workbench-npm-test-expanded-20261009.log`。Cloud 自有接口测试另行记录，不将旧共享包消费说成新协议已交付。
- [ ] 本次宿主私有工作台绑定失效，Cloud 上下文与收工检查无法验证；未重建空项目。Claude/Cursor 原生 Hook 信任与安装后入口仍未验收，Codex Hook 按最新 main 暂缓。
- [ ] Cloud 到配对本地 Cursor 的完整工作台回显、Cursor Cloud REST 适配、真实 Cloud 任务及最终三条路径验收未完成；不宣称目标达成。
- [x] 同步 main `52d3ad8`，保留双方台账与新本地记录规范；候选 core 2.2.0 / UI 1.2.0 / Skill 0.8.0，依赖不变。v24 新增 Cursor 能力，正式旧 v23 检测用例通过，沿已有安全升级路径保留数据；候选包尚未发布。
- [x] 新状态回归先确实失败（生命周期 active 覆盖接收器 stopped），修正配置 Cursor 的原生状态优先级后，状态与公共 HTTP 两目标实际 2/2、退出 0；Claude 原有时间优先级不变。旧全量结果不覆盖本次合并与修正，当前准确修订完整回归/独立审查/制品测试待完成。
- [x] 准确冻结 Skill `35393a3` 完整 npm test 实际退出 0：513 项、511 通过、0 失败、2 既有跳过，Node 83725.721916 ms；完整 Browser 56 项、恢复入口及 Cursor 四项通过。独立只读检查 Skill 23/23、Cloud 8/8 通过，但 Review failed：CLI 直聊绕过任务门禁，界面未确认请求阻止后续发送；未将测试通过等同于审查通过。
- [x] 两项正式回归保留首次失败：CLI 实际 200、应 409；旧界面在已接受但回执正文不可解析、刷新确认后无法追问。共用 native.prompt 门禁，按 Session 隔离请求、匹配已接受消息后解除、显式原编号重试；接口/状态 2/2、Cursor Chromium 六项实际退出 0。首次仅断开复用 socket 被 Chromium 透明重投，改用截断 JSON 回执夹具后稳定复现；不将夹具失败算成缺陷已验证。修订后的完整回归和独立复查仍待完成。
- [x] `f19a776` 复查保留新重放缺陷：旧 native.prompt 成功回执绕过后来任务检查，失败投递可再次启动。正式用例先确实失败；HTTP 首夹具根路径未规范化导致 ID_REUSED，纠正为真实绑定路径后准确旧源码实际 200、应 409。将任务检查移到回执重放之前，保留原回执、失败投递字节与请求编号；任务关闭后可继续读取原回执。协议模块 4/4、HTTP/状态/重放三个目标实际退出 0；新修订的完整回归、独立 Review 与发布门禁仍待完成。
- [x] `34a5ba7` 第三次独立 Review passed，三个目标实际 3/3、exit 0；准确源码完整 npm test 实际 513 项、511 通过、0 失败、2 既有跳过、73772.151583 ms。候选 core 精确 43 文件/UI 14 文件安全检查通过。Skill Draft PR #464、Cloud Draft PR #33 已创建，尚未合并或发布。
- [ ] PR #464 首轮远端 Browser `37827680476` 保留失败：原有 56 项页面检查通过，但新增 Cursor 套件在干净 checkout 的证据目录 mkdtemp 返回 ENOENT。新增入口先创建忽略的 temp 父目录，不改产品逻辑、断言或等待上限；准确修订的 clean-checkout 浏览器、Required 尚待验证。
- [ ] Cursor 空会话退出后端后的明确失败与现有会话再加载仍需安装入口核对，不静默替换；Cloud 必须固定消费已发布共享包后再验证完整回显，不能复制相邻源码。
- 本次最终门槛只有连接、通讯、完成任务；复杂恢复、丰富卡片与自动归档后续再做。用户要求不删除本地文件，新增测试现场保留。

## COORDINATOR-SHORT-TEST-LABELS-01 · 测试标签与日期短名称（2026-10-09）

- [x] 保留真实遗留失败：Cloud 1.3.1 / Slack 0.2.1 默认 TODO 已保留七项、共同状态只报一次、无节点 ID 或未问 Bug，但仍原样展示一条测试标签与日期编号标题；旧成功结果不代替短名称效果。
- [x] 基于最新 main `1fa3859faaeed634ea3bfade208ed82c111f1442`，仅原位替换 canonical `Coordinator.md` 两 profile 的既有短名段：测试标签/编号/日期不限位置，用途不明不猜，同名可识别；明确索要技术编号及工具参数/URL/代码/命令/回执/执行提示仍保留原值。每段仍不超过原 107 字符，不增加静态规则，不改 Main 标题、Cloud context、生成角色或最终正文。
- [x] 开发后一次既有 `.github/scripts/shared-package.test.mjs` 四目标窄验证，Node 24 actual exit 0、4/4 passed、0 failed/skipped/cancelled、146.4949 ms；日志 `temp/coordinator-short-test-labels-executor-1fa3859-20261009.log`。每段 107→107 字符，自动/人工 profile 2619/1278 不增加；规则匹配与分发映射只能证明静态合同，不证明真实模型必然改写。
- [x] 独立静态 P2 阻断旧候选：泛称去日期可能误删业务期限/版本；旧四项通过与日志/hash仍对应旧文字，不改写为最终通过。返工仅原位缩短两段，删除对象明确为测试标签及其编号/日期和内部 ID/哈希，必要业务日期/版本保留；省去具体样例、不根据标签猜用途，其他门禁及工具真值不变。
- [x] P2 更正开发后一次同四项目验证，实际 terminal chunk `6fb8a3`、exit 0、4/4 passed、0 failed/skipped/cancelled、116.2749 ms；新日志 `temp/coordinator-short-test-labels-p2-executor-1fa3859-20261009.log`，两段94/94字符、auto2606/manual1265。旧结果保留旧语境，文字匹配仍不证明真实模型遵循。Root 同期准备 core2.1.3 / Skill0.7.4 发布元数据，无依赖变更；本轮 Executor 未打包或发布。
- [x] 独立 Tester 最终冻结六文件、HEAD `1fa3859` 前后 hash 全同；唯一正式四项目 actual exit 0、4/4 passed、0 failed/skipped、140.3759 ms，日志 `temp/coordinator-short-test-labels-p2-independent-1fa3859-20261009.log`。静态消除 P2、两段各94字符、唯一核心角色映射及 Skill0.7.4/core2.1.3/锁元数据一致；未打包或声称模型语义验收。
- [ ] Required/正常合并/公开固定 core/Skill/Cloud 消费由 Coordinator 统一完成。本轮 Executor 不打包、提交、发布或部署。
- [ ] 合并后安装/doctor 与新版本真实 Slack 默认 TODO 验收：保留七项及用途、无逐项相同状态/测试标签/日期编号；未知用途不得编造，同名和用户明确要技术详情仍能识别。当前未绑定产品任务，不伪造 Map Main、审批或完成回执。

## LOCAL-RECORDS-01 · 原生客户端验收

- [ ] 在已登录的 Claude Code CLI 与 Cursor 中验证完整生命周期：会话笔记落在本地，归档、压缩及结束均无笔记上传；Cloud 上下文读取与收工检查仍可用。公共 CLI、Hook 函数和隔离归档已有正式回归，不能替代原生宿主验收。

## COORDINATOR-REPLY-FOLLOWUP-01 · 清单前缀与共同状态（2026-10-08）

- [x] 保留实际验收缺口：上一版已发布角色的真实默认 TODO 回复仍带 E2E / IF11 前缀、重复 pending；不能用旧模块 / 发布通过宣称回复效果已过。
- [x] 基于 main `51e0b2193b42bb0d50eb50b972cfaa9cd5374fef`，只替换自动 / 人工模式既有四段：同状态只报一次、不漏事项；用 `E2E/IF11 登录复测` → `登录复测` 紧凑例子说明对人短名称不含测试或日期前缀。保留工具参数、URL、代码、命令、回执、brief 原值与详细 / 风险例外和原审批结束门禁，无服务端 displayRegex 或硬截断。
- [x] 静态 profile 自动 2622→2619、人工 1279→1278，原上限与人工少于自动一半不变。候选 core `2.1.2` / Skill `0.7.3`；UI `1.1.6` 和依赖不变。
- [x] 开发后仅一次既有 `shared-package.test.mjs` 正式套件，实际 exit 0、4/4 passed、0 failed / skipped / cancelled、137.9853 ms；没有全量或真实模型测试。
- [x] 一次 `release-shared.mjs`（含 buildRuntime / 精确包清单）实际 exit 0；core 包安全扫描实际 exit 0、41 文件、SHA-256 `e4f229b0b3a686b16af2b93a2cb11ac870b228df50dc5526e9575c5dc992e5bd`。正式 tar 工具回读角色与 canonical 字节完全一致；本地制品未发布。
- [x] 独立 Tester 核验准确源 / 角色 / 包与前缀、共同状态、完整性保护；不代替对应 PR Required、合并、公开 core / npm / Cloud 固定消费。
  - HEAD51e0b219+五源码版本/正式test/coretar冻结hash前后相同，Node24唯一次现有3Coordinator目标chunkfdebb2 actualexit0，3/3、0fail/skip、118.3739ms；log `temp/coordinator-reply-followup-independent-51e0b219-20261008.log` SHA256 `b9bea21ebacf7f8013d707aceef90165aa8f4306e96d2e98ed47ea1b5501cb64`。一次只读真实core2.1.2tar角色8900bytes与canonical完全相等，chunkc275a4 actualexit0，auto2619/manual1278；paritylog SHA256 `1a1148781b561163237b1ed80169b0cf35ff94207aa878be0eb3fc301c350415`。完整hash/命令/限制见同名`.md`，未全量/Git/安装/真实模型或生产，不把static字面规则通过当作原聊天缺口已修复。
- [ ] 对应 PR Required、合并、公开 core / npm / Cloud 固定消费由 Coordinator 完成。
- [ ] 合并后安装 / doctor、真实默认 TODO 短回复与混合表情正常继续仍待验收；本轮没有产品绑定、Map、Hook、模型或权限改动，不能声明真实效果已经通过。

## COORDINATOR-PLAIN-REPLY-01 · 短回复与真实值保留（2026-10-08）

- [x] 从最新 main `98ed9287178806a80409d9a59dbf01cefe55a52a` 开发，只原位替换 Coordinator 自动 / 人工模式各三段回复风格；保留最新资料、审批、核验、完整 brief 和人工 replyComplete 门禁。不引入外部 Skill、模型轮次或服务端文本截断。
- [x] 默认约 50–100 字、通常不超 150 字；TODO 概览保留总数与可识别短名称，不逐项重复相同状态、不附未问 Bug。必要事实、不确定性、完整清单 / 详情 / 风险确认例外保留；工具参数、代码、命令、URL、回执真实值不变。
- [x] 复用唯一根角色分发映射；core 候选 `2.1.1`，Skill 候选 `0.7.2`，UI `1.1.6` 与依赖不变。静态自动 profile 2622 字符、人工 1279，人工小于自动一半；文字与大小检查不证明模型实际合规。
- [x] 开发后一次正式模块验证：`node --test .github/scripts/shared-package.test.mjs tests/build-runtime.test.mjs`，实际 exit 0、8/8 通过、0 失败 / 跳过 / 取消、1327.1489 ms；未运行全量。
- [x] 一次既有 `release-shared.mjs` 入口（包含 build:runtime 与精确包清单验证）实际 exit 0。core tarball 中 `roles/Coordinator.md` 经 tar 回读，与 canonical 8916 字节逐字节一致，角色 SHA-256 `e28a3c4abbe9fe1664950779bb2b39a7d97ea30d8d8e5b3d2f761b66bb69976e`；本地制品未发布。
- [x] 独立 Tester 核验准确修订、两个 profile、保真 / 例外 / 门禁和对应制品；不以此模块结果代替 PR Required / main / 标签 CI。
  - HEAD98ed928+冻结源码/正式测试/版本及tar哈希前后不变；Node24唯一定向3/3、0fail/skip、chunkc982a0 actualexit0，103.8895ms，日志 `temp/coordinator-plain-reply-independent-98ed928-20261008.log` SHA256 `b24e8a42ea132c9af85a26a66600413b3654c5cb9f38bc0d0bcfed97edcb8c60`。独立唯一只读tar角色parity chunk2cdd1a actualexit0，真实core2.1.1内8916字节与canonical相同，自动2622/人工1279字符；parity log SHA256 `76def62a998764d554dc608dd06f9508198ea12621ae0320f19e3e34d024758c`。完整hash/命令/限制见同名`.md`。未重跑全量/gates/打包/安装或调用真实模型，不证明真实聊天风格与Cloud已消费。
- [ ] PR Required / main / 标签 CI 按原规则完成，不以独立窄模块结果代替。
- [ ] core 固定公开 Release、Skill npm CD 与 Cloud 固定依赖交付待完成；合并后最新 main 安装、doctor 和安装入口验收待完成，未做生产模型或真实短回复验证。
- [ ] 当前宿主 Session 在该 worktree 未绑定、runtime stopped，无法校验 Cloud 挂载上下文；未建立虚假任务或将 Git sourceSha 当作 Main 记忆版本。

## EXECUTOR-CONTEXT-UPGRADE-01 · 旧进程能力识别（2026-10-08）

- [x] 保留复现：旧 v22 健康响应缺少上下文能力，却被 `compatibleRuntime` 接受；正确断言先返回 `true !== false`，不是修改断言求绿。
- [x] v23 增加 `executor-on-demand-context` 能力，旧 v22 进入既有安全升级路径；不改协议 2、结构版本 4、数据格式、退出门禁或认证。Skill 补丁版本 0.7.1，core 2.1.0 不变。
- [x] 原功能已通过 Skill #458 Required 并合入 main `cfe658e`；core 2.1.0 精确 41 文件、客户端 0.7.0 精确 99 文件从该 main 发布。Cloud 已用公开固定制品通过 6 项真实 loopback HTTP / CLI 闭环，仍未部署生产。
- [x] 三平台安装的 95 个文件与该 main 逐字节一致；doctor 的 Codex Hook 信任与宿主执行证据不足保留为未完成，不绕过信任。
- [ ] 本补丁准确修订的回归 / Required、main 合并、0.7.1 固定客户端和合并后安装待完成。
- [x] Cloud 完整回归在 0.7.0 客户端发现旧 Session 基线拒绝被跳过（实际 200、应为 409）；恢复旧入口的原检查，仅显式 `workbench --context` 延迟加载。无已确认基线的旧缓存仍拒绝新流程，保留草稿，不做隐式迁移。
- [x] 新 Git 启动测试还暴露主工作台初始化拉取 `/main`；改为按需启动时延迟加载 Main，实际完整 Map 读取时仍走原接口。正式测试验证启动只访问薄上下文端点且未创建 Session Map，并验证旧未确认缓存继续拒绝。

## EXECUTOR-CONTEXT-01 · 按需上下文与收工检查（2026-10-08）

- [x] 正式 `tests/executor-context.test.mjs` 15 项通过：导航、缓存、挂载 / 已读 / 关联 / 全局变化、权限与事项隔离、断连、分页、并发确认、真实 CLI / 本机工作台、Plan 启动与 Session 归档。Cloud 客户端契约使用合成 HTTP 提供方，不冒充真实 Cloud。
- [x] 本地完整 `npm test` 退出 0：Node 482 项，480 通过、0 失败、2 跳过；安全、治理与 30 项安装边界冒烟通过。最新 Plan 启动断言另已定向通过。
- [x] 本地 Chromium 工作台 56 项及日志恢复浏览器入口通过；不使用生产数据或外部模型。
- [x] Cloud 薄接口 5 项真实 loopback HTTP 场景通过；本地候选包不代表公开固定依赖已交付。
- [ ] 准确修订的 Required、两仓库 main、固定共享包 / 客户端制品与 Cloud 全量回归待完成。
- [ ] 合并后安装核对、doctor 和安装入口验收待完成；原生 Hook 信任 / 宿主证据不足时保留未完成，不绕过信任。
- [ ] 生产 Cloud 升级与真实项目验收未执行，不在本次部署范围内，不宣称用户线上已可用。

## MIGRATE-SHARED-01 · 旧本地修复合入后的分发更新（2026-10-08）

- [x] Cloud #19 保存恢复、#20 名称展示、#21 自有任务退出按顺序合入 main `b39c190`；三个 PR 及最终 main CI `37736048118` 的六项检查和 Required 均通过。
- [x] 保留 #21 首次最低运行时的 Hook 记忆读取 `MEMORY_UNAVAILABLE`；根因未决，未修改 Hook、记忆接口或超时，准确修订 CI `37735742081` 全量通过。旧 submit 实现未合入。
- [x] 从该 main 打包 core 2.0.1（40 文件）、UI 1.1.5（13 文件），精确清单和安全检查通过；只发布独立共享资产，不发布 Skill npm、不部署生产。
- [x] 本地工作台迁入暂时忙恢复的浏览器回归：前三个忙响应为替身，随后通过真实本地保存端点回读落盘；原 operationId 不变、旧草稿清理，不点击重试或刷新。不把此场景称为生产故障复现。
- [x] 包管理器从公开 URL 生成 core 2.0.1、UI 1.1.5 的 SHA-512 锁文件；与实际发布制品一致，没有其他依赖变化。构建已生成 51 个文件。
- [ ] 准确修订的完整 Skill CI、精确打包及安装与 Required 尚待通过；本地不额外运行功能测试。
- [ ] 合并后从准确 main 更新本机三平台 Skill，核对文件与 doctor；原生 Hook 未受信任或没有实际执行证据时保留未完成状态，不绕过信任。
- [ ] 两个旧主目录作为完整可恢复备份保留，关联工作树只修复 Git 指针；原路径换为新检出的最新 main，保留私有记忆及配置，不删除共享 temp 或旧未提交内容。

## DOC-LAYOUT-01 · 中文规范与设计文档迁移（2026-10-08）

- [x] 从最新 Skill main `2f6c51a` 迁移治理与中文文档；保留拆仓库边界，不导入旧 Slack / STATE_BUSY 功能改动。
- [x] RULE 按开发流程组织，设计命名及简短版本号说明放在“实现”；安装清单、帮助路径和同步设计引用随迁移更新。
- [ ] 初次文档提交未运行功能测试。用户随后要求更新共享包并合入 main：本地不额外运行功能测试，保留合并必需的 GitHub CI，未运行检查不得写为通过。
- [x] core 固定依赖更新至 `2.0.0`，workbench 保留 `1.1.4`。Cloud PR #18 已合并为 `a475cdb`，PR CI `37731182961` 和 main CI `37731462681` 全部通过。发布包的 40 文件及安全检查通过，公开 Release 的 SHA-256 为 `2547e2d6580173ee22dda87f1dabee0da1bb3165cc402eccbfea944e386b40e3`。
- [x] 包管理器通过公开 Release URL 生成 SHA-512 锁文件，与实际发布包一致；没有其他依赖变化，不使用本机 Cloud 目录或浮动版本。
- [ ] 保留首次 Skill CI `37731988582` 失败：Node 用例 439 项，436 通过、1 失败、2 跳过；唯一失败是 `named-workbench.test.mjs` 仍断言已移除的 `references/named-workbench.md`。按已批准的新目录更新精确路径断言，保留其他条件和用例；修订后等待 CI 重验，不把首次失败记为通过。
- [ ] 第二次 CI `37732247324` 在 Node 22/最低运行时的同一用例中暴露子进程分支还保留旧路径断言；补齐该断言，并静态核查全体测试及包清单的旧路径引用。不删除用例、不放宽匹配、不修改启动行为；再次等待 CI。
- [ ] 在准确依赖和修订上完成干净构建、精确打包、安装边界、资料读取与 Required；通过后才合入 main。不发布 Skill npm、不部署生产 Cloud。
- [ ] 合并后从准确 main 构建和更新本机 Skill，核对版本与 doctor；原生 Hook 信任或实际宿主证据不足时明确保留未完成状态。

## BROWSER-CLEANUP-13: bounded fixture removal and complete-entry results (2026-10-07)

- [x] Preserve independent `7cbe870` Node 22 Browser failure: all 55 body
  checks passed with no page errors, but cleanup `rmdir` returned `EBUSY` at
  synthetic `cg-browser-ci-zgJ9Gs/project`, making the official entry exit 1.
  Journal recovery and full CD did not run; the file-lock owner is unknown.
  Log `temp/tester-7cbe-browser-node22-20261007.log` SHA-256:
  `621ebb8ebf590ab2e0d632150350bf6272030f3287bfe32dcebd3106078b775a`.
  Its artifact's earlier `passed:true` only described body assertions and
  must not be treated as complete-entry success.
- [x] Validate the existing sandbox realpath/temporary-parent/prefix guard,
  unchanged browser/backend/proxy close order, and removal with the existing
  fixture policy `maxRetries:3, retryDelay:100`. Exhaustion still throws and
  retains remaining evidence; no process kill or new watcher wait is added.
- [x] Verify results written after cleanup distinguish `bodyPassed` from
  `cleanupPassed`, with overall `passed` true only when both pass. Cleanup
  diagnostics contain only bounded code/name/syscall values; a secondary
  cleanup failure cannot replace an original body exception.
- [x] Remote CI `37521747105` passed all 13 checks including Required for
  `7cbe870`; this does not erase the separate local cleanup failure.
- [x] One approved official `npm run test:browser` on Node 24.19.0 exited 0
  (103.506 seconds): 55 checks/errors 0 plus Journal recovery passed. Final
  artifact reports `bodyPassed:true`, `cleanupPassed:true`, `passed:true`,
  `cleanupFailure:null`; exact sandbox `cg-browser-ci-KOPU6b` no longer exists.
  Browser SHA-256:
  `706f237d93c89a4e126268d07c770971906ffae38fa937b7645fc6cc2f6a712a`.
  Log `temp/browser-cleanup-final-node24-20261007.log` SHA-256:
  `2da686bba5fe25041d6147bc0dda76fd5fee241bf45b26e93da1d93a5f898ba4`.
  Official artifact:
  `output/playwright/browser-ci/1791317139549-29079a7b-d834-4231-b984-3def67f3afde`.
  Light governance and diff checks passed. This successful run does not prove
  whether removal retries were triggered or identify the original lock owner.
- [ ] Independent acceptance, remote Required and delivery on the cleanup
  revision. All earlier failures and the separately undefined legacy-copy
  preservation risk remain open.

## BROWSER-CLICK-FRAME-12: independent current-click measurement (2026-10-07)

- [x] Preserve remote CI `37516211542` Browser/Required failure at static preview:
  the earlier M1 measurement had zero dimensions and empty computed color,
  whereas the transition-start anchor was nonzero. The screenshot captured the
  live page, not this preview; the specific rerender callback remains unknown.
  Canonical and generated UI bytes match, and no UI business code is changed.
- [x] Verify the existing fixture's independent native click-capture baseline
  before the application handler, using connected/current M1 and T0 nodes,
  finite positive frames and nonempty color. All original position/root
  tolerances, color, opacity and continuous-motion assertions remain unchanged;
  no forced/synthetic click, sleeps, retries or budget changes are added.
- [x] Preserve the first local official Browser failure: exit 1 after three
  checks at `bidirectional-sync`, waiting for the current status text to include
  an old-cache warning; static preview and the second journal Browser entry had
  not run. Fixture `cg-browser-ci-MbwxMm` and official report
  `output/playwright/browser-ci/1791314899279-3f3fd8e7-95e6-4165-87f7-5e91a07dc1d0`
  remain retained. This is not attributed to the unexecuted click change,
  Git commit batching or registry writes.
- [x] Observe the same warning intent in the actual initialization/reload
  phase, with only a fixed DOM-observed boolean and immediate disconnect.
  Later SSE state updates can legitimately replace a synced status message;
  an external file update does not reload recovery or promise to emit it again.
  Keep the original real backend-title protection and strengthen the current
  UI/backend authoritative-title check, without sleeps, retries or larger waits.
- [ ] Separately define and verify preservation of the original legacy browser
  copy: canonical `persist()` and recovery export use the same old storage key,
  which presents a source-visible overwrite risk. No permanent original-copy
  guarantee is claimed or silently replaced with a pending-draft assertion;
  any product fix belongs in canonical Cloud UI, not generated Skill files.
- [x] One approved official `npm run test:browser` run on Node 24.19.0 exited 0:
  55 Browser checks with no page errors, including the original animation
  geometry/color/opacity/continuity assertions, plus the Journal recovery entry.
  Browser source SHA-256:
  `3c256662b724e4f8c212e58ecadaab4819b729407c7085fafe8827f1744ee17d`.
  Log `temp/browser-click-frame-phase-node24-20261007.log` SHA-256:
  `be706dfafc3678a944e5d595842e4f68f3c47910b1e3c0157143c3a4e66af4d8`.
  Official artifact:
  `output/playwright/browser-ci/1791315778012-49054d7e-a0d2-47ed-94db-102342eba5a5`.
  Light governance and diff checks passed; no retry, full-suite rerun,
  installation or production action was performed.
- [ ] Independent acceptance, remote Required and delivery on the new source.
  The prior `46685ed` complete CD actually passed 434 Node tests plus
  package/baseline/install/upgrade stages; that success belongs to its unchanged
  input, not this later fixture revision.

## REGISTRY-NOOP-11: fresh locked registration without redundant disk commits (2026-10-07)

- [x] Verify deep complete-record equality excluding only `updatedAt`, after
  the unchanged lock/fresh read/normalization/collision/root-union checks.
  An unchanged record must retain its bytes, mtime and timestamp with zero
  `projects.json` commits; lock acquisition/release still performs I/O.
- [x] Verify effective root/name/origin/Main/runtime/instance changes each
  commit once, arbitrary previous fields remain differences, property order
  does not create writes, and concurrent same/different-project registrations
  retain all roots/records. Corrupt JSON/duplicate identities/invalid origins
  and name collisions must still fail without overwriting data.
- [x] Frozen no-op plus two original inventory targets passed 3/3, actual exit 0,
  on Node 18.20.8 / 22.18.0 / 24.19.0 (14158.0269 / 12238.28 / 13485.8767 ms).
  Node 18 reported 35 name exclusions; Node 22/24 used the same filter without
  showing exclusions in their summaries, not complete Named modules. Actual
  target rename assertions prove initial commit 1 / unchanged commits 0 /
  effective change 1, and no-op bytes/mtime/timestamp preservation. Concurrent
  same/different-project commits each total 2 without lost roots/records;
  normalization and collision failures commit 0. Logs:
  `temp/registry-noop-node*-20261007.log`.
- [ ] Independent performance/functional acceptance. This removes a source-
  proven redundant write, not health/authentication checks or cross-operation
  identity freshness; the original full-CD timeout remains unresolved until
  a complete acceptance run actually succeeds.

## PROJECT-COMMIT-READ-10: fresh HEAD/Main read consolidation (2026-10-07)

- [x] Preserve the `de6afbd` full-CD timeout at the original 900000 ms deadline:
  333 visible passes, no complete summary and no package stage. Thirty-three
  files were discovered; 31 completed file-wrapper durations total
  1784541.9749 ms, not wall time. Dividing by concurrency two gives
  892270.98745 ms before the incomplete inbox/sync work; scheduling alone does
  not prove that the budget can be met. Public first/result observations are
  not file-child start/exit measurements.
- [x] Verify the private same-resolution HEAD/Main batch and unchanged fresh
  branch/physical identity. Accept only exactly two matching-width SHA-1/SHA-256
  records, keep commit peeling, and fall back to the original independent reads
  for missing refs, unknown options or ambiguous output. Killed/time-limit/system
  failures remain failures. No cross-operation cache or CLI/Python batch API.
- [x] Preserve the first Node 18 targeted failure (4 passed / 6 failed / 27
  name-filter exclusions, exit 1, 91948.3597 ms); Node 22/24 were not run.
  Real Git 2.49.0 echoed `--end-of-options` as a third record, so valid refs
  fell back and increased process counts. One read-only corrected command with
  `--revs-only` emitted exactly two SHA records; retain the strict two-record
  gate. Unknown-option compatibility now explicitly simulates exit 129, not a
  claimed historical Git execution. Log: `temp/project-commit-batch-node18-20261007.log`.
- [x] Corrected concentrated Node 18/22/24 formal identity/count/compatibility
  targets passed 10/10, actual exit 0 (95801.7482 / 96255.0859 / 100634.3565 ms).
  Node 18 reported 27 name exclusions; Node 22/24 omit them from the summary,
  not complete Named modules. Governance and diff checks passed. Real Git
  local/remote/default discovery counts are 3/4/6, including SHA-256, peeling,
  changes across resolves and compatibility/failure boundaries. Logs:
  `temp/project-commit-batch-final-node*-20261007.log`.
- [ ] Independent acceptance. Existing non-Git or unbound-Main Hook fixtures do
  not use this optimization; do not attribute their timing variation to it.
  The original full-CD failures and unknown causes remain open; no new full-CD
  run, delivery or release is claimed.

## NAMED-LISTEN-09: strict loopback retry and owned-listener cleanup (2026-10-07)

- [x] Preserve the `f793ad0` full-CD Named concurrent-launcher failure. Its
  cleaned fixture left only an EACCES code, not syscall/address/port evidence;
  the original cause remains unknown. One approved Node 22 original-case
  diagnostic passed 1/1, exit 0, 835.807 ms; 24 other static test names were
  excluded, not a complete Named module. Log:
  `temp/named-concurrent-diagnostic-node22-20261007.log`.
- [x] The same case now waits for all five launcher closes, retains the first
  actual failure and failed synthetic root, and verifies exact proxy ownership
  before official stop plus state/PID exit in the original shutdown window.
  Diagnostic output contains only fixed classifications and strictly anchored
  daemon-message loopback-listen fields, never capabilities or raw logs.
- [x] Frozen targeted listener/export modules passed 9/9, actual exit 0, on
  Node 18.20.8 / 22.18.0 / 24.19.0 (934.7001 / 521.0412 / 2382.5014 ms).
  Node 18 reported 117 name-filter exclusions; Node 22/24 omit those from their
  summaries, not proof of complete modules. Windows owned-server injection
  preserves native/persistent listeners, covers eleven async/sync denials then
  real HTTP success, and rejects port-zero/non-listen/address/port mismatches.
  The unchanged pure guard checks non-Windows rejection; actual non-Windows
  execution remains remote CI work. Injection is not an actual OS denial or
  proof of the original cause. Logs: `temp/named-strict-listen-node*-20261007.log`.
- [x] One complete Node 22 Named module passed 41/41, zero skips, exit 0,
  254876.4816 ms, including the original concurrent launchers, real SessionStart
  and cleanup. Log: `temp/named-strict-listen-full-node22-20261007.log`.
  Governance (34 automatic / 4 standalone / 4 helpers), hidden-process,
  workflow and diff checks passed. The isolated exact local tarball's contract,
  stable SHA-256 and package security scan passed with 101 files:
  `7d9fd171a829d2f693041010ed781054917099beda34e0cdafbfeef0172c837c`.
- [ ] Independent Tester acceptance, full CD, remote Required, installed/native
  delivery and release remain pending; older full-CD failures are not reclassified.

## NODE-RUNNER-OBSERVATION-08: scheduling and public-event timing (2026-10-07)

- [x] `e44d370` remote CI `37494809944` passed all thirteen checks including
  Required. The earlier `140fd0c` local classification failure plus unchanged
  900000 ms full-suite timeout/no summary remain failed, not reclassified.
- [x] Keep the complete discovered execution set; prioritize the two Hook
  suites, then Named, multiworktree and project tests. Concurrency two, the
  fifteen-minute child deadline, synthetic five-file set and five-second
  handshake remain unchanged. Earlier queue position does not guarantee budget.
- [x] One public `run()` stream retains original failure/exit semantics and TAP.
  Safe stderr timing contains UTC/monotonic receipt times, known relative files,
  numeric metadata and fixed enums/booleans, never raw names/messages/errors/env.
  Node 18 records ordered verdict observations; Node 22/24 use execution-ordered
  completion observations without counting both channels. First/last observations
  are not file-child spawn/exit times; unavailable boundaries and missing first
  events remain explicit. Owned-parent launch requests and child-close receipts
  are separate phases. No private API, second runner or injection is used.
- [x] Preserve two first Node 18 module failures (4/5, actual exit 1). First,
  the setup callback argument lacked `on`; use the returned public stream.
  Second, URI source paths failed plain-path matching; use standard
  `fileURLToPath`, reject malformed paths and retain the known-file whitelist.
  Node 22/24 were not run on either failed input. Logs:
  `temp/runner-observed-timing-node18-20261007.log` and
  `temp/runner-observed-timing-final-node18-20261007.log`.
- [x] Final Executor complete runner modules passed 5/5, zero skips, exit 0
  on Node 18.20.8 / 22.18.0 / 24.19.0 (5740.1243 / 6536.6821 / 11027.2312 ms).
  Actual public-event counts show file URIs on Node 18 and absolute paths on
  Node 22/24; no raw paths are recorded. Full discovery, first-wave/concurrency,
  real pass/fail/exception outcomes, all-file result observations and safe
  timing schemas are verified. Logs:
  `temp/runner-observed-timing-uri-node{18,22,24}-20261007.log`.
- [ ] Independent verification and complete CD on this final input remain
  pending. No Hook module or full CD was rerun in this Executor step; production,
  permission checks and all original budgets are unchanged.

## CI-IMPACT-HELPER-07: classify the formal Hook helper (2026-10-07)

- [x] Preserve remote `140fd0c` CI run `37491337661` failures in CI1 and minimum
  runtime: tracked-path classification found `tests/hook-test-helpers.mjs`
  unmatched. Local CD also failed that exact assertion and reached the unchanged
  900000 ms Node deadline (runner 903 seconds); 304 visible passes / one failure
  are not a complete summary. Remaining results and pack/install were incomplete.
  Log `temp/tester-140fd-cd-node22-20261006.log`, SHA-256
  `d58baaa452d8cdb016854cbe59ae494a8c592f6bfb74b2c55700eb7c9cbf5572`.
- [x] Add only the precise helper path to the existing `test-helpers` impact rule,
  retaining its test/minimum-runtime jobs. No wildcard widening or gate bypass;
  this configuration change still forces complete CI. New formal regressions
  assert the exact six-job helper-only selection and check approved manifest
  helper paths independently of Git tracking. The manifest is coverage input,
  not a source of CI job permissions; original tracked[], unknown/full-run and
  malformed-configuration assertions remain unchanged.
- [x] Executor complete selector module passed 13/13, zero skips, actual exit 0
  on Node 18.20.8 / 22.18.0 / 24.19.0 (1136.4557 / 1041.2171 / 462.4485 ms).
  Logs `temp/ci-impact-hook-helper-node{18,22,24}-20261007.log`.
- [ ] Independent verification, exact-head Required and complete CD remain
  pending. Fixing classification does not establish or resolve the separate
  full-suite timeout; historical failures and incomplete delivery stay recorded.

## HOOK-SUITE-SPLIT-06: independent lifecycle and durable-record tests (2026-10-06)

- [x] Preserve `1d910d3` full CD exit 1 at the original 900000 ms Node deadline.
  Only 22 complete PASS results were visible; ordered TAP buffering leaves the
  rest unconfirmed. Those visible Hook cases alone totaled 879124.1762 ms.
  The failed rehearsal and log `temp/tester-1d910-cd-node22-20261006.log` remain;
  log SHA-256 `b2759270bf089159ff229e891ee310ef82ca5da4517c5b7ad0f178bd1939786b`.
- [x] Partition by responsibility: 21 lifecycle/permission/Plan cases and four
  durable-record integration cases, using one formal helper without test
  registration. All 25 original names and complete case-body SHA-256 values
  match the real `1d910d3` source (line-ending/separator normalization only).
  Fifteen helper functions remain unchanged; only `freePort` candidate
  preparation changes below. Per-process HOME/registry and per-case temporary
  projects remain isolated; production code, API checks and budgets are unchanged.
- [x] Preserve the first split module run: 24/25 PASS, zero skips, exit 1 in
  432180.5445 ms. The completion-receipt CLI requested port 6668 and URL
  verification failed; the final bound port/cause were not recorded. This
  supports correcting the known browser-port input prerequisite, not assigning
  older unknown failures. Log `temp/hook-split-two-modules-node22-20261006.log`,
  SHA-256 `979927e57706d03d23843719104f308f3878188d727ae10b68406505bfda0834`.
- [x] The helper now returns one high candidate in 49152..65514, not a reserved
  port. The actual CLI retains twenty bounded follow-up binds and real URL/API
  verification; no second candidate, request retry or browser-port bypass.
  Formal isolated-import assertions cover integer/range/+20 safety and inertness.
  Runner discovery still covers every automatic file once, prioritizes only the
  two Hook modules and keeps global concurrency two and the original deadline.
- [x] Executor final runner modules passed 5/5 with zero skips and exit 0 on
  Node 18.20.8 / 22.18.0 / 24.19.0. The two real Hook modules, Node 22 concurrency
  two with the original 900000 ms bound, passed 25/25, zero skips, exit 0 in
  467587.2044 ms. Logs `temp/hook-split-runner-final-node{18,22,24}-20261006.log`
  and `temp/hook-split-two-modules-final-node22-20261006.log`; the latter SHA-256
  is `043af5275ff9ba49cbbfe404eaa6706ea1303d57ed7466b3bc7314f236941bb8`.
  Governance (34 automatic / 4 standalone / 4 helpers), hidden-process, workflow
  and diff checks passed. No full CD was rerun for these Executor module results.
- [ ] Independent Tester, exact-head Required, complete CD and delivery remain
  pending. Module partitioning is not proof of a business communication fix;
  original timeout, Hook signal, fetch and earlier failures remain recorded.

## ATTACHMENT-FETCH-FIXTURE-05: browser-compatible test URL input (2026-10-06)

- [x] Preserve `db9706c` complete CD failure: 421 tests / 420 passes / one
  failure, exit 1 in 884 seconds, not a timeout. The first direct download fetch
  failed after HTTP upload succeeded; actual port/cause were absent and the old
  fixture was deleted. Log SHA-256
  `fc352410b746c2e346c0c45d33fec4f7b0bcbb9e79c847b5eec986ae8be356ae`.
- [x] This existing case now retains failures and reports only fixed cause
  classifications, actual port and request phase before throwing the original
  error. The sole Node 22 diagnostic passed 1/1, exit 0, 718.09 ms: no failure
  cause was captured (`temp/attachment-fetch-diagnostic-node22-20261006.log`).
- [x] Correct a known input prerequisite, not a proven cause: local dynamic TCP
  ports start at 1024 and include Undici-restricted low ports. This direct-fetch
  fixture now selects one candidate in 49152..65514; actual startup retains its
  existing bounded bind fallback. No GET retry, second candidate, browser-port
  bypass, permission relaxation or production port-zero/budget change. Original
  unreferenced 404, referenced 200/body and traversal 403 assertions remain.
- [x] Complete attachment module passed 9/9, zero skips, exit 0 on Node 18.20.8,
  22.18.0 and 24.19.0 (3202.4591 / 1745.4041 / 1583.6994 ms). Logs:
  `temp/attachment-fetch-high-candidate-node{18,22,24}-20261006.log`.
- [ ] Original fetch failure remains unassigned; the diagnostic did not
  reproduce it. Independent verification, Required and complete CD remain pending.

## HOOK-SIGNAL-DIAGNOSTIC-04: missing bootstrap prompt signal (2026-10-06)

- [x] Preserve `785aea8` complete CD failure: 421 tests / 420 passes / one
  failure, exit 1 in 855.648 seconds within the original budget. The empty-graph
  record-todo case returned no matching User signal; that original fixture was
  removed by its old cleanup and is not claimed retained. Original log SHA-256:
  `1573350bc7a6dec48a4665f329dd613e5dd2162bd029449cbebf6b71ac12e60d`.
- [x] Only this existing test now emits fixed safe early-return classifications,
  a later-than-Hook binding/runtime probe and durable prompt-signal booleans on
  signal failure. It still officially stops its owned backend, retains failed
  synthetic fixtures and removes them only after functional and cleanup success.
  Original assertions, permissions, behavior and command budgets remain unchanged.
- [x] The single authorized Node 22.18.0 original-case run passed 1/1, zero skips,
  actual exit 0 including cleanup (62895.5553 ms total); no failure diagnostic
  was emitted. Log `temp/empty-graph-signal-diagnostic-node22-20261006.log`, SHA-256
  `0bfa4730c5962e0eacff60eb07d2e976a0429e4e1596db973ed862ca2616a8b0`.
- [ ] Original failure remains unassigned: this did not reproduce it or prove a
  health-timeout cause. No production Hook, health deadline or communication
  behavior was changed. Independent verification and complete CD remain pending.

## WORKBENCH-LISTEN-FIXTURE-03: remove the independent port-zero probe (2026-10-06)

- [x] Preserve the complete `66f5986` CD result: exit 1 in 888.48 seconds,
  420 tests / 419 passes / one failure, not a suite timeout. The owned-listen
  regression failed with native loopback `listen EACCES` before its assertions;
  source ordering and timing strongly support the separate unhandled port-zero
  probe as the stage, but the original log has no phase marker and does not
  establish this as a runtime observation. Retained synthetic fixture `O6heNc`
  and log SHA-256 `63a38f14d445033b08bbe92b8a583606b788dd20755e678b51bb301dbb4563e6`
  remain failure evidence; no system or unrelated process was changed.
- [x] Only test preparation changed: one high candidate in 49152..65514,
  with no preliminary server and no candidate-selection retry. The actual
  owned backend still injects eleven async denials, then must bind successfully
  within the original 12..21 attempts and serve the real authorized HTTP read.
  Native/persistent listener equality, sentinel, warning and non-Windows
  fail-closed assertions remain. Production port-zero policy and budgets did
  not change; exhausting the bounded candidate range still fails.
- [x] Executor concentrated Node 18.20.8 / 22.18.0 / 24.19.0 runs each passed
  6/6 selected cases with exit 0 (7610.5679 / 6333.4295 / 9189.5247 ms);
  Node 18 separately reports 91 name exclusions. Logs:
  `temp/listen-fixture-high-candidate-node{18,22,24}-20261006.log`.
- [ ] Independent Tester, exact-head Required and final complete CD remain
  pending. This removes a fragile test-preparation prerequisite, not evidence
  that business communication or the earlier restored `verified=false` is fixed.

## WORKBENCH-LIFECYCLE-02: failed-listen callbacks and owned Hook fixture cleanup (2026-10-06)

- [x] Failed listen attempts remove only their own error/listening callbacks;
  the existing Windows-only predicate, twenty-next-port limit and startup budget
  remain unchanged. The owned HTTP regression injects eleven async denials, then
  actually binds a later loopback port; its native plus persistent-listener
  baseline remains exactly unchanged, the sentinel fires once and no owned
  MaxListeners warning occurs. This is fault injection, not an OS denial claim.
- [x] One concentrated Executor run each on Node 18.20.8, 22.18.0 and 24.19.0
  passed 6/6 selected listener/HTTP/binding/queue cases with exit 0; Node 18 also
  reports 91 name exclusions. Preserve the first Node 22 run's 5/6 FAIL: the
  fixture incorrectly assumed one listener instead of capturing the native
  baseline. Logs: `temp/listen-callback-cleanup-node22-20261006.log` and
  `temp/listen-callback-cleanup-final-node{18,22,24}-20261006.log`.
- [x] The real Named Hook fixture waits for Python stdio close, officially stops
  its backend and waits for the exact project/root-matched child PID to exit
  within the original shared twelve-second shutdown window; no process is
  killed. Owned backend/proxy cleanup must finish before releasing retention.
  Only this controlled root receives canonical parent/prefix validation and
  bounded filesystem cleanup retries; failures still retain the fixture and fail.
  Preserve the first diagnostic: functional assertion PASS (104631 ms), but
  after-hook EBUSY made the actual command exit 1. Final Node 22 real SessionStart
  rerun passed 1/1, including cleanup, with exit 0 (104248 ms total). Logs:
  `temp/named-hook-restored-diagnostic-node22-20261006.log` and
  `temp/named-hook-restored-cleanup-final-node22-20261006.log`.
- [x] Governance (33 automatic / 4 standalone / 3 helpers), hidden-process and
  diff checks passed; no owned Named-fixture backend remained after the final run.
- [ ] Original `492b61c` complete CD remains FAIL (420 tests, 418 passes, two
  failures, 854 seconds). Restored SessionStart's `verified=false` did not recur
  in the two targeted observations and is still unassigned; callback cleanup
  does not establish its cause or claim that product path fixed. The separate
  Claude failure and all earlier failure evidence remain recorded.
- [ ] Independent Tester, exact-head Required, final complete CD and release /
  installed-runtime acceptance remain pending; these Executor module results
  are not independent or production acceptance.

## WORKBENCH-LISTEN-01: Windows port-denial recovery and CLI fixture lifecycle (2026-10-06)

- [x] Preserve exact `a0a6e4d` local CD failure: the unchanged 900-second suite
  completed in 874 seconds with 418 tests, 417 passes, one failure and no skips.
  Auto-binding Map read failed, without a printed CLI domain error. The first
  targeted diagnostic passed 1/1; the related three-case diagnostic then failed
  2/3 with `START_FAILED` and a real synthetic backend `listen EACCES` on a
  loopback port. Its fixture/log are retained without a copy/backup. Read-only
  inspection found that port bound by another application; nothing was stopped
  or reconfigured. This does not identify the owner at the earlier full-CD failure.
- [x] Executor source fix retries that listen-only denial on Windows only when
  syscall, loopback address and attempted port match. The existing twenty-next-
  port limit and twelve-second startup budget remain unchanged. Non-Windows,
  automatic port zero, unrelated file/auth errors and exhausted attempts fail
  closed; existing `EADDRINUSE` handling remains. No generic permission retry,
  elevation, global network or generated shared-source change.
- [x] The two CLI-started fixtures now await official backend shutdown before
  successful root cleanup; failure keeps only that fixture. Original automatic
  binding, ID, Map assertions and safe failure diagnostics remain. Formal
  classifier boundaries and an owned HTTPServer listen injection were added to
  the existing approved test file. Injection tests are not evidence of a real
  OS denial; the diagnostic above is the separate observed-denial evidence.
- [x] One concentrated regression each on Node 18.20.8, 22.18.0 and 24.19.0
  passed the nine selected cases with exit 0; Node 18 separately reports 88
  name-filter exclusions. Existing HTTP/Session-binding status and managed /
  unmanaged pending-queue regressions are included. Logs:
  `temp/windows-listen-recovery-node{18,22,24}-20261006.log`;
  failed diagnostic `temp/auto-bind-related-diagnostic-node22-20261006.log`.
  Governance, hidden-process and diff checks passed.
- [ ] Independent Tester, exact-head Required and a new complete CD acceptance
  remain pending. Original Windows CD / Claude failures stay recorded below.
- [ ] MAP-AUTO-BIND-PORT-01: Map read's recursive first-binding workbench call
  does not forward an explicitly selected port; this separate issue is not
  changed or claimed fixed by the default-listen recovery.

## BINDING-RECOVERY-01: definitive rejection and bounded connection recovery (2026-10-06)

- [x] Executor: confirmed `session.bind` rejection is read from its durable
  outcome, including the original deterministic legacy receipt. New cross-device
  reason is `session-bound-elsewhere`; the precise older migration rejection is
  only `binding-conflict`, not proof of its owner. Registration, saved CLI sync
  state and the authorized HTTP status expose only safe code/reason. No repeated
  enrollment, cache deletion, replacement request ID or old-Session takeover;
  pending Map writes, old task queues and failed receipts remain intact. The
  status endpoint does not open an inaccessible Map merely to display failure.
- [x] Browser authorization has at most three attempts with 250/500 ms backoff
  within the existing invocation/grant deadline. Poll retries only known
  pre-connection failures or trusted retryable temporary responses; reset,
  timeout, malformed replies, unknown claims and denial stop without renewal.
  Local waiting expiry preserves the displayed grant rather than treating it as
  a server denial. GitHub identity uses existing environment/gh credentials on
  its first request; bounded read retries share a forty-second budget including
  credential lookup. Repository-ID, redirect-domain and authorization checks stay.
- [x] Formal Node 18.20.8 and 24.19.0 auth/repository modules passed 22/22 each;
  public registration/status and managed/unmanaged queue preservation passed
  the three selected cases on each runtime (Node 18 reports 92 name exclusions).
  Governance verified 33 automatic tests, four standalone suites and three
  helpers; hidden-process and diff checks passed. Logs:
  `temp/binding-recovery-auth-repository-node{18,24}-final-20261006.log` and
  `temp/binding-recovery-sync-node{18,24}-ownedproxy-20261006.log`.
- [x] Preserve first auth module failure (20/21): local expiry erased the grant,
  fixed by distinguishing waiting expiry from server rejection. Preserve Node 18
  HTTP-module exit failure: all three assertions passed but an unowned spawned
  test proxy raced registry cleanup (`ENOTEMPTY`). The fixture now owns/closes an
  in-process proxy; production proxy behavior and original assertions/budgets
  are unchanged. Original logs: `temp/binding-recovery-auth-repository-node24-20261006.log`
  and `temp/binding-recovery-sync-node18-final-20261006.log`.
  - [x] Independent Tester: exact clean source
    `d2c33e530fb2449ea77195db708512f96e514166` was reviewed and tested on Windows.
    Six runtime and four formal-test SHA-256 values matched the Executor freeze
    before and after execution; no source, assertion or timeout was changed.
    Node 18.20.8 and 24.19.0 each passed auth/repository 22/22 with zero skips
    (17038.9088 / 14900.3491 ms). The original filtered HTTP/status and
    managed/unmanaged synchronization cases each passed 3/3 with actual exit 0
    (3466.1753 / 7439.2488 ms); Node 18 additionally reports 92 name exclusions,
    not a full-module pass. All four command invocations exited 0.
    Real loopback registration and authorized `/api/cloud-sync` reads returned
    safe reasons without opening an inaccessible Map (`mapReads == 0`); repeated
    registration sent only one bind and retained the rejected receipt unchanged.
    Deterministic legacy and indexed new rejection recovery survived restart,
    preserved the old pending task/outbox, and did not give a new synthetic
    Session the old task. TTL, no-renewal, unknown-claim, bounded retry and GitHub
    identity/authorization checks passed; governance (33/4/3), hidden-process
    verification and diff check passed. Log names:
    `temp/tester-binding-recovery-node{18,24}-auth-repository-20261006.log` and
    `temp/tester-binding-recovery-node{18,24}-http-sync-20261006.log`.
    SHA-256 in Node 18 auth, Node 24 auth, Node 18 HTTP, Node 24 HTTP order:
    `a7a66fd22042f7f3c8a00cf7bc300a52362fecbd9cfd4a1d94dac165c744f5ec`,
    `0cea73a49150a4a5d69c7db0dfae1a25ee58fe71dcdda244b88e432cab69becc`,
    `1e4ed197dacd81f75a971bef1328a537a2ae19440ec5693b553bc98959324316`,
    `b2f3f05072798e08bba69934c1ef176d6b0ccf54c3635925cb34b07265549d63`.
    This is source-level technical acceptance with fixed shared Core/UI 1.1.1,
    not a finished 1.1.2-dependent package, new UI, real host Session or production
    connection. The first TTL failure, Node 18 cleanup failure and historical
    Windows CD/watchdog failures remain recorded, not reclassified.
  - [x] Final frozen dependency/browser/package acceptance at
    `49e46d15c66cdcf0616d7786562a80d7793e00d0`, Skill 0.6.4 with the official
    Core/UI 1.1.2 fixed URLs and SHA-512 lock. Cloud source is
    `2af5beadb982a463ec04c31ff4e2ddf6de536f64`; generated manifest SHA-256
    `4718f3c58a61ffd4aa2a0349b08d8305f87f7a72b60b919ebad4f66d8b2ec283`.
    The six reviewed Skill runtime files retained their prior hashes; generated
    canonical UI matches Cloud 1.1.2 (`51d96a006973e56f77813cc857cf0c1026eea357f3c393d319c56777445e9355`).
    One unchanged formal `npm run test:browser` passed with actual exit 0 on
    Node 22.18.0 / Python 3.13.7: workbench 55 checks with no page errors, plus
    journal recovery. Evidence: `output/playwright/browser-ci/1791259282459-80d41f1f-3013-43d1-beaa-a9739075506d/`,
    log `temp/tester-skill064-final-browser-20261006.log`, SHA-256
    `615a160b6b4fa7811ece1af45deec5004847ab90be3baa4b408d2f59e056aa74`.
    No new browser fixture, force, skip or timeout change was used. The new
    binding-reason visible integration is not covered by this browser run;
    canonical VM and real loopback HTTP/status checks remain distinct evidence.
  - [x] Local standalone exact tarball passed the 100-file package contract and
    security scan; 632945 bytes, SHA-256
    `5add3f2bbcc29533876dbe466ba87c747e2e8bf1af8e178c346d6b0a0877c127`.
    Existing `smoke-npm-package.mjs` passed on Windows / Node 22.18.0 using this
    tarball in isolated global-prefix and npm-exec installations. Both installed
    Workbench runtime checks passed startup, health, packaged assets, authorized
    state and unauthorized rejection. All 96 installed-contract files matched
    the frozen source SHA-256 values; isolated npm package metadata is 0.6.4.
    Install log: `temp/tester-skill064-exactpkg-20261006/install.log`, SHA-256
    `bb9cac41de741cc267b251c5acdadbdbff8aca548e1b8a3dca70233ac4273227`.
    These results do not prove registry publication, a user's installation or
    actual host pairing. An extra read-only diagnostic initially looked for
    package.json in the Skill-copy target, where the installation contract does
    not include it; correct installed-file/npm-prefix checks passed without
    changing the contract or files.
  - [ ] Preserve final local CD FAIL: the only Node 22.18.0 `npm run test:cd`
    invocation began 2026-10-06 04:09:58.0608503 UTC and ended 04:26:58.2051231
    UTC, exit 1. npm ci, materialization (55 files), security (39 checks), hidden
    process/workflow/governance checks passed. The unchanged two-file Node suite
    hit its 900000 ms deadline, reporting 901 seconds. Complete log parsing
    finds 216 visible passing TAP cases and one failure, with no final summary;
    do not infer completion from the last TAP index 217. The failure is
    `.github/scripts/workbench-project.test.mjs:195`, All Sessions baseline
    invalidation, `fetch failed` at line 211 (16744.5408 ms). Failure-test SHA-256
    is `b186a0d3c239e13065e3db93d29101b720b3224b719ed2f3f87501ebe3a19ca9`.
    Last completed case: completion receipts require evidence/scope/all files/
    fresh content (42332.2763 ms). Timeout interrupted the following human-review
    archive case. Remaining suite results, ci-smoke and this CD invocation's
    final pack/install/upgrade stages are unconfirmed, not passed by the separate
    standalone package test. Failed rehearsal directory remains
    `context-guard-cd-rehearsal-RSw93P` in the system temp directory.
    Log `temp/tester-skill064-final-cd-node22-20261006.log`, SHA-256
    `355c456492a4f6069dde337e1c226b455fb6134f952023667d65031246d595cb`.
    No full rerun, budget increase, assertion weakening or historical failure
    removal followed this result. Scope/source/package/manifest inputs stayed
    byte-identical. The cutoff's owned fixture initialization process had no
    registered state/lock or listener; official diagnose reported stopped and
    official stop returned `stopped:false`. Any remaining owned process cleanup
    is reported separately. Root-approved normal `taskkill /PID` after exact
    identity recheck failed because Windows requires force for this console
    process. The residual is preserved; no force/tree fallback or unknown/user
    backend termination was used.
  - [ ] Final exact-head Required/CD,
    installation and real new host-Session connection remain pending. Old Windows
    CD timeouts and the Node 22 Claude watchdog failure below are not erased or
    reclassified. These Tester checks did not change personal Hook configuration
    or production data; isolated checks do not attest a real user connection.

## SESSION-SWITCH-FIXTURE-01: target preflight and browser rollback fixture

- [x] Preserve PR #451 run `37311320171` initial failure: Node 24 functional
  reported 401 tests, 398 passes, one failure and two skips; Node 18 failed the
  same Session-switch case. The Node-only fixture lacked browser globals after
  shared UI added URL capture and target-snapshot preflight. Existing local
  Node 22 Claude watchdog failure and all full-CD timeouts below remain open.
- [x] Executor changed only the formal failed-switch fixture: test-scoped
  location/history save and restore original descriptors; replaceState really
  updates the synthetic URL. A valid target snapshot is returned only for the
  exact GET `/api/state`, view `session:next`. Reload must run once, change the
  canvas/version/baseTree and URL, then throw; original identity/map/version
  assertions remain, with complete document/tree and URL rollback checks added.
  No runtime, generated shared source, canonical Cloud source or budget changed.
- [x] One targeted run each on Node 18.20.8 and 24.19.0 passed 1/1, zero
  failures. Node 18 reports 80 other cases excluded by the name filter; Node 24
  reports only the selected case. Command: `node --test --test-name-pattern="failed Session switch restores canvas, version and identity together" tests/workbench-sync.test.mjs`.
  Logs: `temp/session-switch-fixture-node18-20261006.log` and
  `temp/session-switch-fixture-node24-20261006.log`. Governance verified 33
  automatic tests, four standalone suites and three helpers; diff check passed.
- [x] Independent Tester confirmed reached preflight/reload and complete rollback,
  with test-scoped globals restored. Node 18.20.8 and Node 24.19.0 each passed the
  selected case 1/1, exit 0; Node 18's 80 name-filter exclusions are not a full
  module acceptance. Test SHA-256 remained
  `d55d3384acbedb12dbe56526b09a149be693a0837dcad01c7d7e0756aa6acfb5`.
  Logs `temp/tester-session-switch-fixture-node{18,24}-20261005.log`; SHA-256:
  `092a4a355e1f38272c2a6fd70c665ce1f0d192bd8b34bb86fb6999227c5cb94e`
  and `193f62731f8c3a03a45e0c9215c6485a71e534788e1093354ebe7b0602c4336d`.
- [ ] Exact revised-head GitHub Required remains pending. These focused results
  do not replace full CI/CD or resolve the separately recorded Claude runtime
  failure.

## Final delivery status (2026-10-05)

- [x] Merged: Skill #449 → `3773aa9`, #450 → `4ae1788eb93cc8d0b62e60e376d4387843abce43`; Cloud #1 → `2b47df759ee567e8d53f569cc56a50c19f616a47`. Official npm **0.6.2** CD run `37271755297` completed successfully: three-OS install/upgrade, OIDC publication, exact downloaded bytes and registry-latest npx acceptance. The old 0.6.1 CD4 failure below remains historical evidence.
- [x] Codex/Cursor/Claude local Skill copies were explicitly installed from official npm 0.6.2 with `--no-hooks`; launcher, SKILL.md and Hook-script hashes match the official package. All three host Hook configuration files remained unchanged; this is not proof of native Hook trust or actual context delivery.
- [x] Cloud 1.1.0 / Slack 0.1.14 deployed from Cloud Main `2b47df7`; business mirror HEAD `4ae1788`. Both formal services are active, candidate services disabled. Existing Main/Session/closed/history hashes are unchanged. Shared Core/UI remain 1.1.0; Cloud's public GitHub **Skill fixture 0.6.1** is intentionally separate from official npm 0.6.2 and was not overwritten.
- [x] Production Slack state structurally matches the verified pre-release business backup: same stateVersion, inbox 327, threads 9, channels 2, preferences 1, drafts 3 and outgoing 105; all old IDs and thread project/conversation bindings remain. Detailed verification is in Cloud CI_todo; no private IDs/content are published and no claim is made about every payload or execution effect. User-confirmed candidate source/disabled-unit cleanup is now complete, with formal PIDs/health and all runtime/data/config paths preserved; no source backup was created.
- [ ] Live user bidirectional connection and host delivery: the actual host Session is now verified against the linked `browser-device-login` worktree and its shared local backend, with Coordinator role. Cloud browser-device approval is still pending; local binding is not Cloud synchronization evidence. Real Slack E2E also remains incomplete (`authenticated:true`, `usersRead:false`); deployment and isolated browser success do not close these items.

### Follow-up source fixes awaiting delivery

Cloud source adds the opt-in other-Session view and preserves the original map,
URL and draft when a target snapshot is unavailable. Independent Cloud browser
acceptance passed 44 checks; installed fixed GitHub Skill fixture **0.6.1** passed
the existing seven bidirectional-sync checks against the frozen isolated Cloud.
This does not prove the real installed npm **0.6.2** user connection, or deploy
the new UI. Cloud PR #2 is now merged as `29a6c9853d3bb65504757eb7219660be3850df1d`,
with all Required jobs successful, and immutable `shared-v1.1.1` assets are public.
Independent anonymous downloads match the frozen Core/UI/Cloud hashes and package
contracts. Skill dependency update and actual Cloud/install delivery remain
separate steps. Full frozen Cloud regression passed
366/368 with zero failures; the two existing skips concern separately accepted
browser approval and an unconfigured live model Provider. Separate supported-
runtime Slack passed 142/142; real Linux Store durability passed 5/5. These source
checks do not close actual user connection or real Slack interaction;
see `SESSION-VIEW-01` / `AUTO-PUB-IDLE-01` in Cloud CI_todo.

## BROWSER-AUTH-WAIT-01: bounded browser approval waiting (2026-10-05)

- [x] Executor source fix: one monotonic ten-minute invocation budget, capped by
  the first displayed grant's remaining TTL. Sleep and start/poll requests use
  only remaining time; expiry never silently renews a code. A competing pending
  grant causes an explicit conflict. First-command retry of an expired cache,
  healthy connection reuse, denial and private credential storage remain intact.
- [x] Formal `tests/browser-login.test.mjs` is in the product manifest and the
  automatic Node runner. Node 24.19.0 module acceptance passed 10/10; governance
  verified 33 automatic files, four standalone suites and three helpers;
  `git diff --check` passed. The public project connection entry used an actual
  isolated HTTP fixture with a one-second grant and saved no connection/config.
- [x] Actual negative control: the same formal expiry case against the unmodified
  pre-fix module failed (`device/start` count 2, expected 1). Its shared imports
  used the real relative dependencies, not a replacement implementation.
  The first module run was 9/10: its public-entry timing assertion included
  pre-authorization project resolution. Timing now starts at the displayed
  prompt; the one-second TTL, no-renewal and no-saved-connection assertions remain.
- [x] Independent Tester: the formal authorization module passed 10/10 on
  Node 18.20.8 and 10/10 on Node 24.19.0 with unchanged source hashes; the actual
  pre-fix negative control fails the no-renewal assertion.
- [ ] Exact-package CD rehearsal: the Node 24 run failed after 901 seconds at
  the existing 900000 ms Node-suite deadline. The log contains 209 passed tests,
  not a complete final count; package/install/upgrade stages were not reached.
  Preserve `temp/tester-skill063-cd-20261005.log` (SHA-256
  `d1299a0eec671dc56f8c9529213a2ec2a270000c06d20cab3d98de46d1da4265`).
  Diagnose the slow Hook lifecycle commands before another full rehearsal;
  do not increase budgets or skip assertions. Public shared Core/UI 1.1.1
  download/build succeeded; Skill 0.6.3
  installation, registry publication and a real human-approved connection are
  separate pending acceptance, not implied by synthetic approval tests.

## PROJECT-RESOLVE-01: explicit-binding Git discovery (2026-10-05)

- [x] Executor A fix only: valid stored Main bindings bypass unused automatic
  origin/default-branch discovery. Selected remote URL and Git metadata are read
  concurrently, fresh on every invocation. Invalid binding validation, default
  discovery, server-side binding checks, permission checks and timeouts remain.
  No CLI/Python batching, identity cache or generated shared code was added.
- [x] Formal Node 24.19.0 targeted acceptance passed 5/5: four real-Git identity
  cases plus the existing linked-worktree/server/Hook public-entry regression.
  Command: `node --test --test-name-pattern="project identity|explicit linked-worktree binding" tests/named-workbench.test.mjs`.
  Governance verified 33 automatic files, four standalone suites and three helpers;
  `git diff --check` passed. Log: `temp/project-identity-fixed.log`. Final formal
  helper is fixed to actual source with no environment override; its four cases
  passed again (4/4), log `temp/project-identity-frozen.log`.
- [x] Actual HEAD `4ae1788` negative control used the same formal four cases and
  real shared dependencies: two pass, two fail on the intended count assertions.
  Explicit local Git calls changed 8 → 6; selected remote 9 → 7; automatic default
  stays 9 and invalid stored binding stays 2. Resolve-only wall samples, old/new:
  local 3234/2445 ms, remote 4864/2471 ms. Separate synthetic fixtures and scheduling
  variability mean these samples do not prove a universal speedup or the whole
  Plan/CD bottleneck. Old source fixture was removed and the controlled temporary
  source selector was removed from formal tests; log `temp/project-identity-old-head.log`
  preserves both expected failures. HEAD/branch/Main SHA/selected URL freshness,
  missing Main ref and invalid-binding non-recreation are asserted.
- [x] Independent Tester: the unchanged formal Hook plan-extension case passed
  1/1, zero skips, on Node 24.19.0 against frozen A source. Total elapsed time
  changed from 109.2 to 89.5 seconds; successful Plan commands changed from
  33.6/33.8 to 30.6/25.8 seconds. These single-run traces show a targeted benefit,
  not proof that the full CD deadline is met. Log:
  `temp/tester-hook-plan-extension-node24-A-20261005.log`, SHA-256
  `c5dfaca4bd1b2e7a56a1873f3ade57f39661e0188902d65bd2c324afc4e71cc2`.
  The original 901-second CD failure remains above; budgets/concurrency and all
  assertions are unchanged. The final A-only CD rehearsal also exited 1 after
  901 seconds at the original 900000 ms deadline. It contains 210 visible passes,
  zero visible assertion failures and no final summary; package/install/upgrade
  stages were not reached. The last completed accept-layer case took 93.5 seconds;
  the following empty-graph task-signal case was interrupted. Log:
  `temp/tester-skill063-cd-final-A-20261005.log`, SHA-256
  `1c79decf780e96cb672ab5b165d4dd004520957922149554e76e91f161a5e5aa`.
  Runner-owned subprocess cleanup completed and frozen source hashes match.
  The proposed same-invocation snapshot reuse was rejected. The fresh physical
  directory query below is the only additional approved optimization; no
  increased budget, identity cache or skipped assertion is approved.

## PROJECT-PHYSICAL-01: fresh batched Git directories (2026-10-05)

- [x] Executor D source fix only: one fresh `rev-parse` obtains top-level,
  common and administrative directories. Only exactly three nonempty absolute
  records without CR are accepted; only Git's final LF is removed, not directory
  whitespace. Ambiguous/relative/unsupported output uses the old individual
  resolver, including its common-directory fallback. Git environment, timeout,
  error classification and identity hashes are unchanged. HEAD/branch/Main are
  still read freshly. No CLI/server change, snapshot reuse, cache, B or C.
- [x] Frozen Node 24.19.0 formal module passed 8/8, zero skips:
  `node --test --test-name-pattern="project identity" tests/named-workbench.test.mjs`.
  Real Git 2.49.0.windows.1 fixtures cover normal/subdir/junction/linked/detached,
  moved and reused worktree paths, empty-HEAD/unborn Git, one-call folder/bare,
  selected remote/HEAD/Main freshness and invalid-binding non-recreation.
  The normal observer forwards actual Git; compatibility modes deliberately
  change arguments and the killed-error case is injected classification evidence,
  not an actual ten-second timeout. Governance and `git diff --check` passed.
- [x] Existing linked-worktree/server/Hook public-entry regression also passed
  1/1, zero skips, against frozen D (16.1 seconds total), without changed
  assertions: `temp/project-physical-D-linked-entry.log`.
- [x] Actual A-only source SHA-256 `d18b558113b3368f43c13e57e143734128072dc5931b1b8a18bc0f1c0dcadd8a`
  was used by an ignored temporary copy of the same four count cases with real
  dependencies. All four failed their intended assertions: local 6 → 4, remote
  7 → 5, automatic GitHub 9 → 7, invalid binding 2 → 1. Supported non-Git/bare
  remains one call. Both temporary source/test copies were deleted; formal
  source selection is fixed, with no module/environment override.
- [x] Preserve initial 7/8 failure in `temp/project-physical-D.log`: the test
  observer's promisify wrapper omitted Node's original stdout/stderr error fields,
  making the folder probe incorrectly fall back to a second call. The observer
  was corrected; the production classifier and one-call assertion were not
  relaxed. Final log: `temp/project-physical-D-frozen.log` (SHA-256
  `6d5fce8e8854403326c368a20942215dc6fbed064dcfaadc3e898ce5b3d541bb`);
  expected negative log: `temp/project-physical-A-negative.log` (SHA-256
  `a50f72eff6f928bdb140e0446fb4ad6b0d36a88762a1038f9bf9cd1c71793b95`).
- [x] Independent Tester: the frozen eight identity/boundary cases passed 8/8,
  zero skips, in 62.235 seconds. The unchanged original Hook plan-extension
  case passed 1/1, zero skips, in 69.456 seconds total, versus the A-only sample's
  89.466 seconds. Initial/extended Plan traces took 20.439/20.131 seconds;
  single-run timings do not prove universal performance or full-CD success.
  Source/test hashes remained unchanged. Logs:
  `temp/tester-project-identity-D-20261005.log`, SHA-256
  `e1981b545edbe757beadc69c92ec80fcc766ef2794e34d9a431f5f4c10888956`;
  `temp/tester-hook-plan-extension-node24-D-20261005.log`, SHA-256
  `516cb5e7e28c5e9a84c67aaa8149d41b39081ca204a9f7f0909cd280dbe3ec74`.
  Compatibility probes use current Git with controlled flags, not an installed
  old Git; Windows did not execute a real POSIX LF/CR-containing pathname. The
  legacy resolver's historical trimming/optional-miss limits are not claimed
  fixed. Existing 901-second full-CD failures and original budgets remain.
- [ ] Full frozen D Node 24.19.0 CD rehearsal exited 1 after 901 seconds at the
  original 900000 ms deadline: 211 visible passes, one visible fixture failure,
  no final suite summary; package/install/upgrade stages were not reached.
  Log `temp/tester-skill063-cd-final-D-20261005.log`, SHA-256
  `5aebb24c77e292304ffd0c644fed2403044269d72310320e396d596c17ddd91f`.
  This third local Node 24 timeout remains a failure, not an acceptance.
- [x] The failed `.github/scripts/project-resolution.test.mjs` non-Git mock
  supplied only code 128 and empty stderr, causing legitimate legacy fallback
  and two probes. Its Error now contains empty stdout and real fatal-not-repo
  stderr; the callback carries identical values. The original one-call/six-empty-
  metadata assertion, production classifier and ten-second child deadline are
  unchanged. Repository review found no other affected Git execFile mock;
  SQLite executors and Python Hook fixtures do not enter this resolver.
  The formal module passed 1/1 with zero skips on Node 18.20.8, 22.18.0 and
  24.19.0; governance and `git diff --check` passed. Logs:
  `temp/project-resolution-fixture-node{18,22,24}.log`; fixture SHA-256
  `b2a8d0ba4ba522942b3adb369ea6cb85248844fcfae4514596ee835345193f84`.
- [x] Independent Node 24 verification of the corrected formal non-Git fixture
  passed 1/1, zero skips, with the frozen source and original assertions.
- [ ] The one final Node 22.18.0 full CD rehearsal also exited 1 after 903 seconds
  at the original 900000 ms Node-suite deadline. There are 212 visible passes,
  one assertion failure and no final summary; ci-smoke, packaging,
  installation and upgrade were not reached. Log:
  `temp/tester-skill063-cd-node22-D-fixedfixture-20261005.log`, SHA-256
  `c505eb6866210daca42afd3bf18aee9ca0cbda01cab13de8f00e9894df9d2b17`.
  The failed original Claude long-active/silent-runtime case expected
  `CLAUDE_TURN_LIMIT` but received `CLAUDE_TIMEOUT_OR_INTERRUPTED` at
  `tests/claude-runtime.test.mjs:227`. This is a real failed assertion, not
  proven to be an environment-only issue; its source and budgets are unchanged.
  This is a failure, not a replacement Node 24 acceptance. No additional local
  full-suite retry, budget increase or production identity abstraction is made.
  The normal exact-commit GitHub Required and official CD, including all selected
  tests and three-platform package installation/upgrade, remain mandatory before
  delivery; this recorded local timeout does not waive those gates.

## Independent CD4 registry-npx acceptance (2026-10-05)

- Original release run `37269736295` published 0.6.1 successfully but its final
  npx check failed with exit 127 inside the same-name package checkout. That
  failure remains recorded; this acceptance does not declare a new remote CD
  run or 0.6.2 publication successful.
- Independent review of the frozen six-file patch on `codex/npm-published-npx`
  (base `3773aa9`) confirms only isolated npm-exec cwd, explicit registry latest,
  corresponding mutation guards and the 0.6.2 metadata bump. Exact artifact
  hash checks, same-commit Required CI, OIDC, three-platform installation and
  pinned-baseline upgrade gates remain unchanged. Core/UI remain fixed at 1.1.0.
- `node --test .github/scripts/cd-checks.test.mjs`: 24/24 passed, including
  checkout-cwd, implicit-package and missing-latest mutations. Workflow verifier
  exited 0. Logs: `temp/tester-cd4-checks-20261005.log` and
  `temp/tester-cd4-workflows-20261005.log`.
- Anonymous npm 0.6.1 tarball SHA-256 is
  `a39b2c9010991a84d184d671435b43076c1b90c2f475d0805911b8be10c72a89`;
  its bytes exactly match the validated artifact downloaded from the original
  release run. This registry artifact is not the earlier GitHub fixture tarball.
  From an empty OS-temp directory outside the checkout, real registry
  `npm exec --yes --prefer-online --package @michelj/context-guard@latest -- context-guard install --no-hooks`
  succeeded using Node 24.19.0. The installed launcher/help, `memory complete`
  help and installed Workbench startup/health/assets/authentication-denial probe
  passed. Logs: `temp/tester-registry-npx-outside-20261005.log` and
  `temp/tester-cd4-npx-installed-runtime-20261005.log`.
- The changed official `smoke-npm-package.mjs` ran against that exact downloaded
  registry tarball with an OS-temp workspace and disposable Codex home. Global
  and fresh npx installation, required/forbidden file contract, init and both
  installed runtime probes passed. Log: `temp/tester-cd4-fixed-smoke-20261005.log`.
  Real user homes, disabled Hooks, production data and immutable release assets
  were not modified. No unrelated full product regression was repeated.
- Reviewed input SHA-256: npm-publish workflow
  `13a0dd2226bd5b3058e30927e192ed2ce91deb3192227f5ce36908eda3c18c4f`;
  package-smoke `0608dc7156c889472990328ae7a73c771e8aa267529aa06c4b66154eb748e5ec`;
  workflow verifier `4f16ecab795d26ca316351cb071915e2f9af5da32d8708eb50627397394d9e65`;
  CD checks `e2344051262bf3e83c98362aab7a91a7ed3b7045a9207598dd51146603e35ab7`.

## Independent immutable-package follow-up (2026-10-05)

- Public Core/UI 1.1.0 and Skill 0.6.0 were downloaded anonymously; exact
  SHA-256 values match their release evidence. The actual Skill tarball passed
  the 100-file package/security contract. Node 24.19.0 isolated global and npx
  installs, startup/health, packaged assets, authorized state and denial passed;
  the installed launcher exposes `memory complete`, and installed memory/CLI/UI
  hashes match the reviewed runtime. Real user homes and disabled Hooks were
  not modified by these disposable-home tests.
- Windows Node 18.20.8 installation of that same 0.6.0 tarball failed: the
  `fs.cpSync` bin filter received a namespaced path, rejected its source root,
  and omitted the installed launcher. npm reported postinstall exit 0. This is
  a real installer defect, not a passing minimum-runtime acceptance; 0.6.1
  artifact retesting remains pending. Logs: `temp/tester-release-node18-20261005.log`
  and `temp/tester-release-node24-20261005.log`.
- Remote run 37267153672 failed at the obsolete editable-memory accordion.
  Updating that assertion exposed a second old fixture that attached files to
  now-read-only historical memory cards. Both fixtures now assert the current
  node document/readonly history and exercise the same drop, upload, held-receipt
  removal and paste boundaries on editable Idea attachments; legacy evidence
  remains unchanged. No product UI was modified to satisfy the fixture.
- Final `node tests/workbench-browser.mjs` exited 0: 55 checks, no page errors,
  existing timeouts unchanged. Evidence: `temp/tester-memory-doc-attachment-final-20261005.log`
  and `output/playwright/browser-ci/1791178389914-08f29371-d3bf-4418-bc3a-3e057e0123c7`.
  Earlier failing logs remain available. These checks cover the repaired source
  fixture, not publication of 0.6.1, production deployment or live Slack.

Final fixed artifact: public 0.6.1 at `8f144fb1de7f0de1fb024cb744fc154ea5ed834f`
was anonymously downloaded. SHA-256
`0b3af28b1957a76ae763f26e1660b7c6187bae75272c91dff035f7d26cd9cf8e`
and SHA-512 matched the immutable release and Cloud lock exactly; actual package
contract/security passed 100 files. Both Windows Node 18.20.8 and Node 24.19.0
passed official isolated global/npx install, startup, health, packaged assets,
authorized state and denied access. Separate explicit `install --no-hooks`
targets retained the launcher, started correctly and exposed `memory complete`
without creating Hook/configuration files. Runtime probes use the official
isolated environment and Git ceiling; the first manual probe without those
guards failed and is not counted as a product failure or passing evidence.
Logs: `temp/tester061-{node18,node24,nohooks-node18,nohooks-node24}-20261005.log`.
New fixed 0.6.1 Cloud browser synchronization passed both UI directions, disk
and refresh persistence, Main isolation and timestamps under original budgets;
Cloud artifacts `session-sync-1791178932502-cd7996cb-0f2f-443e-be78-20df7fb75d93`.
The package was not substituted by sibling source; user homes/disabled Hooks
were not changed. Remote Required, deployed revisions and live Slack remain
pending independent gates.

## Session completion source acceptance (2026-10-05)

- [x] Independent Tester, Windows / Node 24.19.0, working tree based on
  `6973d182`: `tests/cloud-sync-client.test.mjs` covers exact Session mismatch,
  missing binding, old Cloud 404 capability failure, device 403 rejection,
  original proof/operation-ID replay and side-effect-free `memory --help`.
  Existing related modules passed 94/94; augmented client suite passed 14/14,
  then the added CLI-help assertion passed 1/1. Workflow, hidden-process and
  test-governance checks passed. Runtime input SHA-256:
  `memory.mjs` = `3bf6828c0a7e6539e321c095e23c6aa329505ad12060284307365880e7b03037`;
  `cli.mjs` = `79e2f23141c1f4f86bd603fd393c14ee6a0f86401d8c94456e5449e29eaf8c20`.
- [x] New immutable runtime release, installed entry-point acceptance and
  production deployment: see Final delivery status above; source tests alone did not establish them.

## Slack 可插拔接入（用户专项授权）

- [x] 隔离回归：独立 loopback 网关的工作区/项目/动作校验、幂等与 SSE 退出；Slack/工作台共用人工执行对话及版本审批，确认后只保存 Main TODO/Bug 和执行提示，不创建执行 Session。
- [x] 隔离模型回归：图片轮次固定配置的视觉模型、重试不换模型；附件提交前校验 UTF-8/hash/总量及请求大小，历史只读摘要和受保护引用。Slack Web API 使用替身，不能代替真实工作区验收。
- [ ] 真实 Jerry Family：App 安装及 Socket 凭据、Home、私聊、两并发线程、两端接续、TODO/Bug、brief 与执行提示导出、记忆编辑、附件/Flash 截图理解、Map 预览、通知、重启去重及停用后工作台正常运行。
- [x] 合并、安装入口核验及 Cloud/独立插件部署：见本页 Final delivery status；未扩大项目配置，真实 Slack E2E 仍待上项验收。自动派发仍暂缓，本专项不恢复旧 Cloud 编排队列。

## CI-AUTH-001 · 浏览器授权连接

- [x] Executor：实现 Cloud 设备授权、网页登录确认、CLI 凭证保存与旧私有输入兼容；单模块测试见 `tests/interface-auth.test.mjs` 的 AUTH-001～003，认证套件通过。
- [x] Tester：独立验收 `tests/browser-device-login.test.mjs` BDA-001～015（14 项通过、浏览器项单独执行）；`node tests/browser-device-login-runner.mjs` 真 Chromium 登录、允许连接、读取 Main 通过。覆盖跨站/CSRF、拒绝/过期/撤权、重启、并发一次领取、回复丢失后重新授权、Session 隔离。先复现后修复浏览器 Origin:null 误拒和撤销缓存假连接；证据基于 ef112a5 上本次代码，生产仍待下项验收。
- [x] 真实 Cloud（2026-09-30）：#432/#433 Required 全绿后合并并部署业务版本 `eb00c8f7a9f99139e065f583065f16c4a43f44d6`，本地 Codex Skill 同源安装（保留用户关闭的 Hooks）。完整备份 `/var/backups/context-guard-cloud/pre-browser-auth-20260930T122852Z.tar.zst` 已校验。真实 HTTPS Chromium 授权页点击允许 → 安装入口保存凭证 → `map main read` 返回同一 Main 版本 → 复用连接鉴权通过；仅使用已授权浏览器身份模拟点击，密码输入在隔离浏览器用例覆盖，不冒称第三方模型宿主完成验收。测试凭证随后撤销，Main/Session 地图未改动。

生产联调发现服务器比本地快约 33 秒：绝对过期时间的 610 秒校验误拒首次授权。已改用 `expiresIn`（1～600 秒）本地计时，保留 Cloud 的最终过期判断；独立回归 BDA-016/017 通过并完成重新部署验收。Windows 完整 Node 回归的三项既有失败已在 ef112a5 原始代码复现；GitHub #432/#433 最终 Required、完整功能及浏览器检查通过。安装 doctor 的 Hook trust/execution 和隔离开发目录 Map 项仍不满足，不将认证验收写成所有 Hooks 或真实模型已就绪。

读者：**仓库开发 Agent**。这是本仓库验收台账，不是产品角色的操作手册。历史条目不覆盖后面的替代说明，也不覆盖 [当前设计版本](references/design-current.md)。

## 当前唯一开发队列（2026-09-30）

以 [当前开发方向](docs/current-focus.md) 为准；下面的历史条目是证据，不是继续投入旧链路的指令。**暂缓**表示保留代码和未完成事实，但停止新增功能、专项联调与优化；安全修复及 PR Required 不豁免。

- [ ] 本机 Coordinator 快聊 / brief 双模式：按需取 Map 小切片、提前 compact、缓存 Main 前缀；真实 Bug + attempt 问答首次有意义回复 ≤2 秒，连续 5–10 轮准确且不让用户等待。
- [ ] 拍板 Agent 打开模块的唯一默认目录，随后同步 Skill + hooks 的读法；fs-v2.1 格式与用户所有的 Map 不变。
- [ ] 人确认 brief 后建立 Main TODO，生成带 Map 切片和读写路径的跨客户端可粘贴执行提示。人批准 brief 后由系统创建执行 Session 并派发；挂载不写入 Main，也不在挂载时创建 Session。不新增心跳、耐久队列、自动 worktree 或中断恢复。
- [ ] 在自己的真实项目录屏验证本机闭环，与 Cursor Projects 用同一任务比较到“用户无需再改的任务”的耗时、修订次数及等待时间。
- [ ] 仅在录屏证明价值后改 README 首句，突出“能和你对话的项目 coordinator”。

## Slack 插件（用户明确批准的接入专项，不恢复自动派发）

- B154本地0.1.13候选：Map预览优先读取同channel、thread_ts或根message_ts的既有项目绑定，频道/用户改选不让旧线程串项目；未绑定仍沿用原选择规则。正式三项基线2FAIL/1PASS，修后含旧origin过滤4/4，插件126/126，Cloud/网关49/49。独立复审4/4及126/126、冻结npm test退出0（基础672项668PASS/4SKIP，插件126/126，安装边界30与smoke通过）；待实验部署，不改核心网关、Coordinator模型或自动派发。
- 真实R20开启unfurl_app_links后仍无link_shared，Bot安装的links:read/write已确认；一次受控现有handler调用被Slack拒绝cannot_unfurl_message，未自动重试/注入事件/伪造回执。该受控调用不是实际自动事件路径，预览仍未通过；实际原生Mac确认锁屏，Home及按钮验收未执行。原项目Main全部字段与25执行Session哈希未变。
- R20后续定位为测试消息的裸URL被发送入口转换成rich_text的text节点，实际link节点为0，不能作为自动预览失败反例。保留原失败记录，另发R21明确链接后真实link_shared为done，正确App预览附件1个、链接与Main版本均正确；无受控回调或假事件注入，0.1.12实际自动链路通过，未代替原生客户端视觉验收或尚未部署的B154跨项目修复。R19/R20/R21的Main地图、记忆、事项及25执行Session全部哈希一致。
- 07dcdeb/0.1.13已完整备份后部署实验候选，双服务active/health3，Socket本次PID1604942初始连接就绪；真实R22收到link_shared并回读正确App卡片与Main版本，无注入事件或手动回调。原Main与25执行Session及三条停止错误哈希不变；未扩大项目配置、未推GitHub、PR仍Draft。真实频道与线程当前同项目，B154跨项目切换只由正式隔离用例覆盖，不夸大为真实场景已验收。
- [ ] B155：真实R20明确“不用回复”仍被相关性判断为respond=true并进入Coordinator；R21/R22同目的正确静默，但不能掩盖原失败。只读分类/提交回读确认，无注入事件或重新调用模型。待补回复意愿与项目相关性的语义边界；原生Slack窗口当前获取失败，客户端Home/按钮/视觉、附件/导出与永久main交付均未完成，2秒仍FAIL。
- B155本地候选只补integration-gateway.mjs的模型判定说明：当前明确不需要回复才静默，预览/通知/只读/不修改本身不等于不用回复；引用、历史、文件不覆盖当前意图。不加关键词规则或接口。提示词契约反例1FAIL→PASS，独立审查收窄预览歧义后网关28/28、关联50/50；最终原glm-5.3在原R20 Main检查点上的5项实际分类（原失败消息、只读问题、引用、预览提问、历史静默）5/5，Main与对话读取状态未变。它是供应商分类诊断，不是Slack事件E2E、性能AB或整体准确率；等待冻结全量及实验部署。
- B155最终冻结回归npm test退出0：基础673项669PASS/4SKIP、插件126/126、安装边界30及smoke通过，独立复审通过。待部署后分别验证静默与只读问答；原生两份Slack窗口均无法获取、Chrome浏览器控制未开放，未绕过限制，不把接口回读冒充原生操作通过。
- B151真实只读流诊断：同一R18静止检查点，原glm-5.3完整输入与15个native工具、不执行工具、不写对话；disabled配置仍出现44个thinking_delta及1个signature_delta，headers4.005s、首正文4.920s。仅诊断设置enabled+reasoning_effort=low的同输入回放headers4.002s、首正文5.569s，正确答未修复/open；两次缓存条件不同，不是严谨AB，不能宣称参数生效或更快。对话文件哈希未变，线上配置未改，B151仍未解决。
- B151诊断保真补注：回放使用相同历史与Main检查点，但省略Slack专用轮次后缀；它不是实际原请求的完整重放或性能/质量验收。类型/长度观察仍成立，不把该参数对照当作业务效果证明。
- B152/B153本地0.1.12候选：修复私有thinking/signature增量丢失及错误流不取消；两项原始正式反例2FAIL→2PASS，独立复审另发现起始字段/JSON绕过和开放错误流残留，两项追加反例各FAIL后已补修。当前六项新正式测试加原transport/deadline定向9/9，覆盖Unicode分块、精确签名、工具后第二轮、重启、公开不泄漏、起始/JSON异常和取消拒绝/挂起不遮蔽原错误。等待冻结源码的独立复审、全量及真实候选部署，不作为2秒或完整业务验收通过。
- 0.1.12冻结源码最终回归：准确npm test退出0，基础672项中668PASS/4SKIP、插件123/123、安装边界30和smoke通过。独立复审11/11、完整Coordinator87项86PASS/1真实模型SKIP；真实本机HTTP+native fetch仍开非法流的服务端close=1、signal已abort且保持MODEL_INVALID_RESPONSE，工具重试/重载回传私有块与原operationId精确。以上分别为隔离和真实本机传输，不冒充真实GLM/Slack；候选仍待实验部署，线上配置未改、旧丢失历史未重建。
- 随后已备份部署138c380d/0.1.12实验候选，备份pre-slack-candidate-20261002T235337Z.tar.zst校验通过（SHA-256：4ee81ae11e65fcf3ad76fe5c7e26edcbcaac814548cb7d52dac91533a220f392）；双服务active/health3，本次Socket PID1512029初始就绪后才提交R19。真实原glm-5.3实际read_map读取BLOG-ENG-SCRIPTS，两个模型轮次后56字纯文本正确答Bug未修复；Slack正文9.298s、从首模型启动至正文8.565s，不和之前零工具样本混成AB。Main地图/记忆/事项/25执行Session及三条旧停止错误哈希未变。私有块观察器退出1：本轮provider没有返回thinking块，私有签名实际往返未触发，结果UNKNOWN而非通过，不归因为产品丢失。B152/B153的解析/资源缺陷已在开发Session记修复，真实私有块链路、2秒、原生客户端/附件/导出与永久main交付仍未完成；PR保持Draft且无GitHub推送。
- 已完整备份后部署0ad47fe/插件0.1.10即时通知候选，双服务active/health3。R16首次只读查询45秒观察FAIL，随后只补回唯一正确81字答复，但真实Slack首条正文65.746秒；模型首段4.798秒、单glm-5.3轮/零工具，不把冷启动失败删除。启动日志表明首次发送尚未完成Socket启动，另记B149：active不能代替Slack就绪；事件投递等待仍未完全归因。确认本次启动成功后新R17只读问答：Slack5.321秒、模型首段4.701秒、78字正确、单轮零工具；2秒仍FAIL，条件不同不做严格AB/普遍提速结论。
- B149 本地只读上线门禁候选0.1.11：限定已安装Slack unit，按current boot的本次MainPID与启动monotonic代次核对Socket初始成功日志；旧PID/旧代次/active无日志不能通过，超时/读权限错误明确失败，日志正文不输出，不另开Socket。不将“曾初始连接”说成持续在线证明，仍要求真实问答。正式4/4隔离用例通过，尚未部署该门禁；不是Socket网络故障根因修复。
- B150 独立审查阻断未部署的首版门禁：systemctl读42后journal期间重启为43，仍误认旧42为ready。补正式命令边界反例后6项4PASS/2FAIL；修为日志后再次核对active/PID/monotonic代次，变化继续等待，三个命令共享剩余预算。门禁6/6、插件123/123，非法CLI真实退出1且只输出code。上一快照全量退出0、154.706s但仅覆盖121插件项，不代替最终修复快照；待独立复审与新全量/实际门禁核验。
- 最终0.1.11门禁候选：独立复审复跑6/6、插件123/123，并额外证明同PID换代、换PID、变inactive、耗尽预算不继续第三命令及新代次重试通过。准确快照全量退出0、151.552s，基础666项中662PASS/4SKIP、插件123PASS、安装30和smoke通过。候选尚未部署；上线核验使用审核后的root-owned临时operator副本，不以root执行service-writable源码。PR保持Draft，没有推GitHub或合并。
- 上述候选随后已部署为7528e627/插件0.1.11，仅原实验项目；完整备份pre-slack-candidate-20261002T233155Z.tar.zst校验通过，SHA-256为063be841eda010a164a0abaa89e2f35852905ee21d4a2e6b0eeccc451a8b0d8a。上线前与R18后门禁均核对本次PID1490165的initial-socket-start；不将初始连接证明当持续在线保证。R18实际无@只读Bug查询正确路由原glm-5.3，单轮零工具、49字纯文本：Slack首条正文9.917秒，模型首段6.814秒，同服务相关性/提交确认2.617秒、上下文25ms；2秒目标仍FAIL，不是严格AB或稳定性能结论。Main地图、记忆、事项与25个执行Session哈希全未变，三条历史停止错误原文件未改。实验分支部署不等于main永久部署；PR仍Draft且未推GitHub，原生Slack按钮、文件完整链路与最终安装验收仍未完成。
- 已部署实验候选8d8a3f5/插件0.1.10：完整备份校验后双服务active、health协议3；真实R11显式@、R12无@相关、R14 Bug状态问答均单轮原glm-5.3、零工具、纯文本78/78/50字，Slack首条正文7.183/6.969/7.511秒，2秒均FAIL。R13无关晚餐问题被判不相关、未进入Coordinator、未广播到Cloud。Main全部字段及25个执行Session哈希不变。这是有限样本，不是严格A/B或整体相关性准确率证明。
- 真实停用/恢复实验：停用独立Slack插件后，Cloud进程PID未变，实际工作台在同一Coordinator Session49提交R15并获得正确未修复结论；启动插件后只补回该用户消息与模型回复各一次，旧帖子时间戳/内容哈希未变。再观察两个目标线程各完成后续mirror轮次，全部bot帖子哈希/数量仍不变；没有重跑模型或重复回复。原生Slack窗口仍不可访问，不把API回读和工作台UI当原生客户端验收。
- B148 即时状态通知本地候选：实际Coordinator持久化后只唤醒同project/conversation订阅，保留定时fallback；网关读取单飞，握手及在途read收到通知会补读，事件暴发合并。首次两项反例基线2FAIL；目前网关27/27、Coordinator81项中80通过/1跳过。observer返回永不完成Promise或拒绝不阻塞模型；持久化失败不通知。没有新增wire字段/动作/权限，不改文字或图片模型。候选未部署，等待独立审查与准确源码全量，不能宣称2秒已达标。
- B148 独立复审未发现本轮阻断：真实隔离HTTP另验证跨项目/跨对话不唤醒、100notify合并、握手与held read补读、close后不再读取，atomicWrite失败不通知。准确源码全量退出0、151.880s：基础666项中662通过/4跳过，插件117/117、安装30和smoke通过。待实验部署实测；固定poll及外部Main更新兜底仍保留，非所有业务事务实时事件化。
- 只读provider floor诊断未完成：原glm-5.3/thinking disabled的21-token无项目“你好”首段1.846秒，仅作非等价底线样本。后续完整上下文样本没有结果；远端诊断node已不存在而本机SSH观察连接滞留21分钟，核对精确PID后仅终止该连接，退出255。保留部分日志、完整轮次结果UNKNOWN，不归因为模型超时，不重跑求绿，也不把“你好”当真实项目查询通过。
- B144/B145/B146 新订阅候选0.1.10：独立插件消费既有 `/v1/events`，最多四条明确关联的活动线程；失败保留轮询、重连退避、停止等待释放、缓存仅内存。网关本身仍轮询，不宣称真正实时或两秒。协议20项实现首轮4个Accept/媒体类型边界失败→20/20；生命周期初始9项6通过/3失败，另补退出等待、旧running覆盖final及旧完成轮取消新浏览器轮反例，各有失败基线，最终12/12、插件117/117。现有网关另修正常背压误断流、握手停机及握手容量漏计，真实HTTP反例均FAIL→PASS、核心网关22/22。最终准确源码全量退出0、150.549s：基础661项中657通过/4跳过、插件117/117、安装30与smoke通过；中途新增反例前的两轮全量也通过但不代替最终快照。等待独立审查及实验部署实测，不代表原生Slack性能通过。
- B147 阻断候选切换：ee42650复审以真实CoordinatorService→Plugin链证明，context前receivedAt并非context后提交顺序；合法B先完成、A后追加时，原保护丢弃A。该源码未部署。正式反例1FAIL→PASS；改用已有public user requestId追加历史和accepted关系，保留同turn结束保护，legacy缺身份不猜顺序；核心23/23、插件117/117。首轮新形状回归出现3失败：新增浏览器user应被镜像，修正过期post计数Oracle；两条旧回归因legacy缺历史而被误过滤，修生产兼容边界，不改原断言。全部失败证据保留；最后准确快照全量退出0、155.464s，基础662项中658通过/4跳过、插件117/117、安装30和smoke通过，独立复审无本轮剩余阻断。仍待实验部署和真实Slack性能，不沿用ee42650部署。

- [x] B140/B142 候选真实复验：dbba5d2/插件0.1.9 完整备份校验后部署、双服务active及协议3；实际Main工作台刷新并进入工程/脚本、展开记忆后，版本、全部事项、地图、其他记忆与25个执行Session哈希全未变。open/manual Bug显示待处理，旧resolved仍已解决。原B142混合编辑与空格附件正式反例已关闭，开发Session记录resolved；不代表main交付、真实Slack原生附件或冻结Quark旁路通过。三条旧停止错误文件哈希未变，历史数据不清理。PR仍Draft，未推GitHub。
- 025ff59/插件0.1.9 已完整部署实验候选，Cloud/插件active、health协议3，部署前备份完整校验，三条历史停止错误文件哈希不变；基础647项中643通过/4跳过，插件85/85、安装30及smoke通过。没有推GitHub或合并，永久main部署仍未完成。
- B139 真实纠正轮：Slack同线程自然语言请求后，原模型先read_map再edit_map，无工具错误；仅保留脚本记忆标题及进展，两条逐字不变，单条47字回复、22.274s，速度仍FAIL。该Coordinator事务的历史逐字段差异只有memoryDocument，其他记忆和25个执行Session未变。此为已有文档纠正，不代替原空文档首次写入场景，B139不关闭。
- B142 首次失败记录：025ff59 页面显示safeJoin的open/manual Bug为“待处理”，旧resolved Bug仍“已解决”，B140标签真实呈现正确；但随后human/cloud-workbench事务给两条Bug增加历史closed dispatch及files空数组，Main事项哈希变化，整体只读不变量FAIL。历史已分离确认不是模型edit_map越权。源码中任务分配投影带旧dispatch，fileList渲染会改owner.files，renderAll最终persist；不通过改原Bug状态或删除历史掩盖。后续修复与真实复验见上方dbba5d2记录。
- B142 第一版候选：附件展示改纯读取，人工事项不接收自动派发投影，实际新增/上传/删除显式写入。正式基线3项中1通过/2失败，修复3/3；关联159项中158通过/1跳过。增加真实隔离Cloud+Chromium只读Main检查，39项通过；首跑选择器同时匹配隐藏面板和详情导致测试构造失败，保留日志后收窄详情定位重跑，不伪称产品故障。准确快照全量退出0、154.493s：基础650项中646通过/4跳过，插件85/85、安装30与smoke通过。独立审查仍复现两个残留：同节点manual编辑整组bugs时可把另一普通事项的读投影带入Main；带空格的历史附件已存在路径在resumeAttachment核验失败。未部署这一版，不关闭B142，继续补写边界和真实上传/删除回归。
- B142 最终源码：普通Main工作台整组事项编辑，在现有CAS/原请求幂等事务内保留既有dispatch，事件记录有效操作，不能由请求体取消该内部策略；Coordinator/验收真实回执写入默认入口不改。接口人类事项行先展示diff再补规范，未新增HTTP字段。真实隔离HTTP反例基线FAIL→PASS（业务编辑、混合事项、回放、有效事件、伪造开关及可信运行回执）；实际附件处理器9项基线7通过/2失败→9/9，DOM及传输替身，不算真实Slack文件。准确快照总入口退出0、158.156s：基础658项中654通过/4跳过，插件85/85、安装30及smoke通过；Cloud浏览器39项通过。独立复审关联119项中118通过/1跳过、额外HTTP拒绝/事务/CAS8/8，无本轮阻断；真实候选部署复验仍待做。
- [ ] 暂缓｜B143 旧Quark Main附件publish旁路：隔离实际函数链证明展示投影经attachmentPatch整组bugs调用默认写入口，把未编辑普通Bug的dispatch持久化；没有跑真实Quark上传。与B142普通/api/commit及当前本地附件UI保护分开，本专项不恢复Quark，不宣称所有附件入口已隔离展示投影。
- B133 新样本：025ff59原文字模型的真实无@项目用途查询R10，单次模型/零工具，正文78字，Slack首条4.930s、模型首段1.349s，上下文20ms；输入14696/缓存2944 tokens。该样本内容及短回复通过但2秒FAIL；插件接收事件至Coordinator接收请求同机约2.427s，含相关性判断和提交等边界，不能单独归因模型计算，也不能跨Slack/服务器时钟相减。Main未变，非严格A/B或总体提速结论。
- [ ] 真实 Jerry Family 验收：App 已安装、私有 Token 已配置，插件真实认证及 Socket 启动成功，Slack 已收到未关联项目的真实引导回复。仍需验证 Home、DM、双端接续、并发线程、自然语言事项/记忆讨论、brief/执行提示、附件、Map 预览及插件重启/停用边界；引导回复不算模型对话闭环。
- [ ] B121 未 @ 消息相关性：已合并并部署只读模型入口与持久判断，隔离回归覆盖相关消息新建对话、无关消息静默、失败不写业务状态、原 ID 重放及跨项目拒绝；真实模型的正反语义判断、延迟和 Slack 结果仍待验收。
- [ ] B122/B123 首次项目选择：真实 Slack 复现仅返回命令文本、没有选项；补原消息内项目按钮和原请求接续。Review 复现的选择并发倒序及 `/cg ask` 双根须由统一耐久 FIFO、逐次执行前复查及真实根时间戳修复；隔离回归与部署后的真实按钮接续分别验收。
- [ ] B124 自然语言入口：用户真实复现 TODO/Bug 弹出节点 ID 等表单；公开 Home、快捷操作、`/cg`、问题回答和 brief 退回改为对话。只保留项目选择及明确确认，旧未提交草稿不丢弃；部署后先验收直接聊天，再验收事项闭环。
- [ ] B125 对话引用稳定性：Review 复现 BUSY 重试把旧消息改成新问题的回答、消息快捷操作误切原线程项目、问题选项文字丢失。补持久空回答引用、原线程绑定优先及纯文本选项；隔离回归通过，真实多轮场景仍待验收。
- [ ] B126/B127 真实展示：首次项目选择已接续真实模型回复；Home 因重复 action_id 被 Slack 拒绝，模型 Markdown 原样显示。补唯一按钮 ID、纯文本呈现及简短回复系统提示；候选运行验证中，不以源码回归或旧首轮回复代替新版验收。
- [x] B129/B130 候选验证：修复推理元数据误拒绝与多段回复倒序。候选 0.1.6/8ad9bb8 真实模型分类 5/5；Slack 两次未 @ 模块追问均接续原对话，闲聊判定不参与；私聊同轮两段正文按 Cloud 顺序显示。隔离回归另覆盖旧 slot 旋转和中断重启；尚未合入 main，不等于完整 Slack 验收通过。
- [ ] B131 简短回复：候选 0.1.6 的真实私聊先输出 342 字再输出 177 字同义总结，普通职责追问主动展开 TODO。强化 system prompt 为一份最终答复、通常 100/最多 200 字、工具中途一句进度且不展开未问内容；需继续真实多轮验收，不截断历史或完整 brief。
- [x] B132 候选验证：a14c0ae 真实 R4 被分类为“之前回答过”而不回应；20dc1aa 真实 R5 重提同一文章列表问题，成功接续原 Cloud 对话并收到 168 字正文。NEG2 午饭闲聊判定不参与，未提交业务轮次或回复；隔离入口与分类回归通过。候选未合入 main，不代表整个 Slack 计划验收完成。
- [ ] B133 简单查询延迟：a14c0ae 真实私聊“我们目前有哪些todo”上下文准备 19ms；两轮模型（list_tasks → 回答），首段正文 17.945s、完成 20.399s，最后输入 9252 tokens。原输入两组只读模型重放：工具决策 6.126/7.476s，第二轮首段 4.884/3.998s；供应商缓存命中 8320/9216 tokens，非真实 Slack E2E。补私有逐轮计时及有界 Main 事项概览，定向 84 项中 83 通过、1 真实供应商用例跳过。真实提速/正确性对比仍待验收，不能以占位回复或一次最快结果宣称 2 秒达标。
- 64918ba 候选真实首轮：同一 Slack 私聊及原模型，Main 概览命中、单轮模型/零工具，模型首段 5.403s、Slack 首条正文 6.835s（两套时钟各自计算耗时，不直接混减）。正确列出 Main 的 6 条 TODO，但附了 3 条 Bug，正文 271 字，B131 仍 FAIL。全量基础 622 项中 618 通过/4 跳过；独立插件 71/71，安装边界 30 项及 smoke 通过。补本轮 Slack system 输出策略；多轮正确性与耗时继续验收，不推 PR。
- 20dc1aa 候选真实复验：TODO 查询首条 Slack 正文 10.838s/208 字（不再混 Bug），职责查询 5.591s/223 字；未 @ 重问 9.377s/168 字。三轮均单次模型、零工具；原供应商存在波动，不能把不同问题混为同一 A/B 样本或以最快轮次宣称 2 秒达标。B131/B133 保持未完成。准确源码全量基础 623 项中 619 通过/4 跳过，独立插件 71/71；安装边界及 smoke 通过，PR 仍 Draft。
- 原模型最小输入只读诊断（无项目/历史/工具，49 输入 token）：两次首段 1.577/1.725s，46/58 字、完整结束。仅用于分离模型基线，不是项目聊天 E2E；先前低输出预算组一次 MODEL_INVALID_RESPONSE 已保留，不通过截断回复求快。继续缩小有效上下文/验证早 compact，不删除原历史或擅自换文字模型。
- [ ] B133 提前 compact 候选：仅人工执行对话阈值 8192 实际输入 tokens（含缓存），至少 8 个人类轮次后后台压缩，保留最新 4 轮原文；普通执行仍为 500k。1069295 真实同一 DM 同问题：压缩前/后输入 10691/6559 tokens（减少 38.65%），模型首段 6.159/6.423s，Slack 正文 7.102/8.901s；原 24 条消息逐条哈希不变，保留 4 个人类轮次，Main 版本不变。未提速，2 秒和短回复均未通过；两次样本不足以判定总体性能。全量基础 625 项中 621 通过、4 跳过，独立插件 71/71、安装边界 30 项及 smoke 通过。
- [ ] B134 历史摘要身份保真：1069295 的真实摘要把正文 Sent using 转发账号写成用户，并简写部分关键引用。原文和真实 actor 未丢失，但摘要质量 FAIL；新增服务端身份元数据和禁止从正文猜作者规则，隔离回归已验证摘要输入，真实后续摘要仍待验收。公开对话/工具定义/审批契约不变。
- 5631ad3 摘要身份修复候选：真实原模型只读续接诊断正确改用服务端 actor，明确否定正文转发账号是身份依据；10.981s、2950 输入 tokens、完整结束且摘要短于历史。未提交真实 checkpoint，仍延续旧摘要的简写引用，B134 保持未完成。交替两个操作者与二次摘要位置、缩短保护、CAS/配对/失败回退定向 7/7，独立审查含所有权 8/8；全量基础 626 项中 622 通过/4 跳过、独立插件 71/71、安装边界 30 项及 smoke 通过。部署后真实 TODO 复验 6 条正确、不混 Bug；输入 6731/缓存 6528 tokens，模型首段 7.209s、Slack 首条 8.846s/208 字。缓存命中约 97% 仍未达到 2 秒，B131/B133 继续未完成。下一步分离人工聊天固定指令与旧自动派发流程，按业务质量继续比较，不擅自换文字模型。
- [ ] B131/B133 人工聊天短角色候选：按宿主执行模式只加载 Coordinator.md 的人工对话段，普通模式原指令逐字不变；保留全部 15 份人工工具 native JSON Schema、记忆/导航、版本审批和完整历史，未以文字说明代替工具或擅自换模型。旧指南兼容、CRLF、空/重复配置、公共 HTTP 入口及重启选择定向 12/12 通过；真实短回复、业务理解与速度待验收，尚不推 PR。
- 955c9d5 真实原模型固定输入 ABBA 4 次：原问题/历史/快照/工具/Slack 后缀一致，不执行工具和写对话；旧/短角色输入 6731/5955 tokens，减少 11.53%，首段旧 5.117/1.686s、新 5.329/4.109s。4 次完整返回、6 条 TODO 正确，均 216 原文字符；各版仅两次且缓存不同，不宣称提速。真实 Slack R7 7.144s/208字，R8 4.869s/216字（其私有模型计时已被另一请求覆盖，标 UNKNOWN，不混计），R9 5.047s/190字但位于澄清回答流程。实验移到独立频道线程，未继续干扰真实新建 TODO 澄清。
- [ ] B131 展示后重复答复：955c9d5 独立真实线程先给 57 字职责答案并 show_nodes，再请求模型重述 79 字；首条正文 4.762s、第二条 12.497s，Main 未改。审查阻断了“有文本即结束”的初稿（进度会误结束，Slack 未呈现节点动作），该初稿未部署。修正候选仅人工模式、展示工具显式 replyComplete=true、完整文本且全 UI 成功后结束，保留工具配对/原回执，并渲染可信项目节点链接。标记缺失/false、无文本/失败/读写/混合/普通模式仍继续；真实复验待执行。首次正文仍须独立验证 2 秒，不能将省掉第二轮当作首次正文达标。
- 5662759/插件 0.1.7 已部署实验候选：真实独立线程 R2 展示两个正确 Main 节点入口，replyComplete=true、单模型/一次 show_nodes、单条 65 字正文，Slack 6.848s；R3 普通职责问答单模型/零工具、单条 62 字，6.812s；R4 六条 TODO 全部正确且不混 Bug，但 284 字、6.890s，短回复仍 FAIL。三轮请求与计时 ID 均匹配，Main 版本均未变，原文字模型不变。模型首段分别 5.623/5.723/5.075s，R4 命中 4672/4798 输入 tokens 缓存仍慢；2 秒 0/3，不以不同输入/缓存的三次抽样宣称严格 A/B 或普遍提速。重复展示的路径验收通过，但 B131/B133 均不关闭。准确源码 npm test 基础 631 项中 627 通过/4 跳过、插件 74/74、安装边界 30 项及 smoke 通过；独立审查修正 18 节点静默截断，超 60 显式说明余量/完整 Map 入口、最多 49 Block Kit 块。部署前完整备份验证；预检区分三个已停止旧错误与运行轮次，旧错误文件哈希前后不变。未推 GitHub、未推进 Draft PR 或更改正式 main 永久服务。

## 最新 Slack 候选验收（2026-10-03，尚未合入 main）

- [ ] B140 人工事项标签候选：真实页面把 Main open/manual Bug 显示“已解决”，原 UI 函数加真实 WorkbenchSync.projectTaskState 复现旧 closed 覆盖 Main；TODO pending 同类。仅在 bugProgress/todoProgress 最先识别 executionMode=manual，标签读取 Main status，不读旧任务/派发/验收/总结/Session 推断完成；全部历史字段保留，普通模式仍沿原逻辑。历史只读 Bug pending、handling/inprogress/recurred 和旧终态兼容，不扩大可写状态。正式四项基线1通过/3失败，修复4/4（含16状态组合与普通模式）；关联123项中122通过/1跳过。标签真实部署复验仍待做；地图动画对历史sessions的读取是另外的未验证呈现边界，不称整页执行信息已隔离。
- B140 Cloud浏览器回归退出0、38项/无页面错误，隔离Cloud和Chromium真实执行、附件提供者为替身，不算Slack或真实文件链路通过。B139/B140组合首次全量在工作树Hook恢复用例约936599ms后被900s runner终止，记录仍归B141、完整统计缺失。私有诊断中两次全量失败结束时均对应Mac DarkWake，存在系统Sleep/Wake；当前是暂停影响假设、非已证实产品死锁或完结归因。改用只随测试进程存续的临时caffeinate断言对照，不改永久电源设置或解锁；工作树全套10/10、12.545s。最终组合源码全量退出0、146.230s：基础647项中643通过/4跳过/0失败，插件85/85、安装30及smoke通过。保留所有首次失败证据，B141不因单次受控通过关闭；真实候选部署与复验另记，不代表main交付。
- B139 最终说明快照全量已准确退出0：基础643项中639通过/4跳过/0失败，插件85/85、安装30及smoke通过；独立审查最终描述边界4/4。首次900s超时仍保留、B141原因 UNKNOWN。B140 后续 UI 变更另跑总入口，不沿用这次B139统计。
- [ ] B139 真实记忆范围：104d5a4 的 Slack 自然语言仅要求空脚本节点记忆写“进展”，实际生成全部六部分；首个 edit_map 还传入未声明字段 memoryDocument.md，FORBIDDEN 后才读目标节点并成功写入。Map 其余内容、其他记忆、TODO/Bug 全字段及执行 Session 清单哈希未变，但局部范围 FAIL；5 次模型请求、首条正文 36.855s/142 字。已补人工角色和 native 工具说明（先读目标全文/版本、只改指定章节、空文档只写适用内容、字段不是文件名）；两项新断言基线 0/2。源码回归和真实复验分别记录，未部署前不关闭该项；原服务没有通过 read_map 授予写权限，不把 FORBIDDEN 推断为读取授权不足。
- B139 新说明定向检查 41/41；本轮 npm test 在旧 worktree 迁移测试运行约 898769ms 后被 900000ms runner 超时中止，记录 B141，完整统计缺失、归因待核对，不能引用上一部署的全量通过作为本轮通过。另发现实际 Main Bug status=open、工作台却显示“已解决”，记录 B140；事项全字段哈希未变，不归因于记忆写入，也不将原 Bug 改为已解决。
- B141 后续隔离：原迁移单例 1/1（约2.3秒）、完整 multiworktree 套件10/10；同快照第二次全量已通过该项（2.039秒），其余套件仍运行，首次超时原因 UNKNOWN、不关闭。B139 独立审查要求 edit_map 总说明收窄到既有节点记忆更新，保留新建/事项动作语义；当前说明仅是候选，不以断言字符串通过代替真实模型行为。B140 原 bugProgress 加真实 WorkbenchSync.projectTaskState 的旧 closed 状态复现错误，TODO 同类；计划仅改 manual 展示映射，不改冻结派发链或原事项状态。
- B139 第二次全量准确退出0：基础643项中639通过/4跳过/0失败，插件85/85、安装边界30及smoke通过；仍保留首次超时，B141根因 UNKNOWN。随后按独立审查仅收窄 native edit_map 描述并增加边界断言，最终定向结果另记；本次全量是该描述修订前快照，不冒充最终源码全量。未提交/部署新候选或推 GitHub，B139真实复验、B140修复继续待做。
- [x] B138 候选验证：1c7de60 的真实 Slack B2 要求复用 `B399679682924`，模型只传 taskId/kind=bug，持久卡却为新 TODO；确认前 Oracle 失败，未批准、Main 未改。104d5a4 补人工 native 身份说明、拒绝 kind=bug 缺 itemId，并关闭独立审查复现的焦点覆盖绕过：仅身份全缺省才继承可信焦点，显式局部身份拒绝，不按 taskId/正文猜关联。两项单测及四项 Cloud 基线均 FAIL，修复后契约 39/39；准确全量基础 641 项中 637 通过、4 跳过、0 失败，插件 85/85、安装边界 30 项及 smoke 通过；独立复审无剩余阻断。候选完整部署后通过正常工作台入口退回旧错误卡，历史保留；真实 B3 原模型正确传入完整身份，持久审批为同一 Bug。工作台模拟确认指定版本后仅为原 Bug 增加 approvedBrief/manual 标记，原标题、attempt、其余字段及其他 Map 内容哈希不变，TODO 9/Bug 4 与执行 Session 25 项/哈希不变；1313 字符执行提示回读正确，确认结果同步到原 Slack 线程。实验 Bug 修复本身未实施，模拟确认不是人类最终验收，也不代替 Slack 原生按钮/文件导出。该轮 14.911s/207 字，速度和短回复仍未达标；未合入 main，普通模式、Executor/Tester/hooks 不改。
- [x] 旧 brief 冲突工作台验收：在实际 Main 已更新后，从历史 Session 46 点击旧测试 brief 的确认，页面显示 VERSION_CONFLICT。前后回读 Main 版本/Map 哈希、TODO 数量、执行 Session 清单/哈希、对话内容哈希均一致，原提案仍未批准；没有新增事项或执行 Session。此项验证工作台真实入口，不代替 Slack 原生旧按钮验收；锁屏时页面视口宽高为零，截图无法取得，保留 AX 与服务端回读证据，不伪造截图。
- 104d5a4 冲突复验：确认 Bug 后对旧 Session 46 提案再次点击，明确显示 VERSION_CONFLICT；前后 Map/事项/Session/对话哈希仍一致。为零尺寸 IAB 设置临时 1280×900 测试视口后取得真实冲突与 Bug 确认截图，结束恢复默认视口；Mac 原生锁屏未解除，不能据此称 Slack 客户端入口已通过。完整候选备份已校验，三条旧停止错误文件哈希不变，GitHub #445 回读仍 OPEN/Draft、head=e9c420a；未推本轮源码到 GitHub。
- [x] B136 候选真实验证：1c7de60 / 插件 0.1.9 重跑自然语言问答，指定标题进入 text 首行；通过真实工作台模拟确认对应 brief 版本，Main 新增唯一测试 TODO `TD0b284918059700c0f4b5ef3d`，标题“SLACK-NL-1003-A：主页文章列表增加空列表提示”正确，1535 字符执行提示已持久化并回读，包含真实节点切片与 fs-v2.1 读写路径。结果同步到原 Slack 线程；执行 Session 清单 25 项及哈希不变，没有自动派发。测试 TODO 保留，未实施博客功能；模拟按钮操作不是人类最终审核，也不是 Slack 原生确认或文件导出通过。早期未部署/待重跑记录由本条更新，不代表 main 交付完成。
- [x] B137 候选真实验证：同一准确部署版本的新 Slack B 线程实际 read_map 后仅出现有内容的答案，不再发送空“Coordinator 回复”。Cloud 工具配对和旧 Slack 失败历史不删除。最终基础 635 项中 631 通过、4 跳过、0 失败；插件 85/85、契约 33/33、安装边界 30 项及 smoke 通过。隔离与真实验证分开记录；早期“尚未部署”是历史状态，不覆盖本条。
- [ ] B131/B133 仍未通过：该版 A1 需求澄清 4.618s/203 字，B1 Bug 查询 8.419s/283 字，均未达到 2 秒及普通回复 200 字生成目标；A2 brief 形成首条正文 12.739s，不混作简单查询性能样本。文字模型保持原 glm-5.3，不截断输出求快。
- [ ] 整体交付仍待验收：a53 的真实两线程并发、插件停用时工作台继续答复及恢复后原线程同步/旧消息去重已通过；不冒充 1c 已全部重跑。Home、Slack 原生确认/导出、记忆修改、文本/截图完整链路、Map 原生预览、状态通知及完整冲突/重投递场景仍待完成。真实链接消息正确保持静默，但未观察到 link_shared，预览结论 UNKNOWN；不据此推断插件故障。PR #445 仍 Draft，未推 GitHub；Required、main 合并后安装/doctor/真实验收及永久部署未完成。
- 候选 1c7de60 完整部署与健康验证通过；部署前完整备份校验成功，三个历史停止错误文件哈希未变。只有实验项目开放，继续使用临时候选 unit。核心本轮只调整 `coordinator-manual.mjs` 人工工具字段说明，普通模式及验证契约不变；插件过滤纯读取空步骤，Executor、Tester、hooks 不改。

## 历史未完成项与暂缓范围

- [ ] B135 Slack 插件额外等待：5662759 正式隔离复现 20 个休眠旧槽位使到期新答案在当轮不读取，以及已读表情请求悬挂阻塞已生成正文，2/2 FAIL；另独立审查复现后台提交与旧停止快照镜像竞态，使提交成功后再等约 15 秒。候选按到期/等待答复优先并保持四次预算、组内最旧截止时间和普通名额；成功 ACK 同事务重置 nextPoll，表情最多八个后台槽并纳入停机收拢，默认轮询 1 秒。插件隔离 80/80、网关/公开 Cloud 契约 29/29 通过，真实提速/停用验证待执行，未宣称 2 秒达标或替代原文字模型。
- a53ee42 / 插件 0.1.8 已部署实验候选：真实 Slack R5 职责问答 5.819s/61 字，R6 六条 TODO 4.590s/174 字，R7 无 @ 同线程续聊 7.426s/88 字；均单模型、零工具、单条纯文本正文、请求 ID 匹配且 Main 版本不变。三轮内容正确、短回复通过，2 秒 0/3；不同输入/历史/缓存不是严格 A/B，不宣称普遍提速或 B135 的真实故障压力/停用验收完成。独立原模型传输诊断带全工具两次响应头等待 4.099/3.699s，包含网络与服务端等待，不能单独归因模型计算；去工具仅诊断未部署。准确源码全量基础 631 项中 627 通过/4 跳过、插件 80/80、安装边界 30 项及 smoke 通过。完整备份验证、三条旧停止错误文件哈希不变；原文字模型不变，未推 GitHub 或推进 Draft PR，B131/B133/B135 保持未完成。
- a53ee42 真实功能补测：SLACK-NL-1003-A/B 两个线程使用不同 Cloud 对话，模型执行时间实际重叠；A 自然语言澄清后 prepare_task 生成手动 brief 卡，Main 未改。仅停用并恢复 Slack 候选插件，Cloud PID 不变；停用期间通过真实工作台选中 B 同一对话、输入只读 B2 并完成回复，恢复后真实 Slack 只新增对应工作台输入和答案，A 原有三条消息及未批准 brief 版本/线程绑定不变，B 原有两条消息哈希不变。已完成的镜像周期后核对，不以固定睡眠推断；UI 操作为测试模拟输入，不冒充人类批准。原文字模型及 Main 版本不变。Slack 桌面锁屏、备用网页未登录，Home/原生确认和导出按钮真实点击仍未执行；不将工作台或接口验收算成 Slack 按钮通过。
- [ ] B136 人工 brief 标题承诺失真：SLACK-NL-1003-A2 要求标题带测试前缀，模型只将前缀写入 taskId，text 首行与持久审批卡无前缀，却声称标题已保存；未确认、未写 Main。候选仅补人工 native Schema 描述：新 TODO 标题取 text 首行；taskId 不决定 Main ID/标题；既有 TODO/Bug 保留原标题。普通模式和字段校验不变；兼容无 Schema 的旧工具清单。正式基线 2 例中说明断言 FAIL、真实首行持久行为 PASS；独立审查纠正初稿兼容异常和既有标题承诺。最终契约 32/32；准确源码全量基础 634 项中 630 通过/4 跳过、插件 80/80、安装边界 30 项及 smoke 通过。真实模型指定标题重跑/最终确认仍待验收。
- [ ] B137 Slack 空读取消息：真实 B 线程 read_map 的无正文步骤单独发出“Coordinator 回复”，随后才给答案。独立审查发现当前公共投影实际是 node-read，初稿仅 map-read 的替身通过不能证明修复；补真实 coordinatorStep→createCoordinatorExecutor→publicMessages→mirror 正式回归，原生反例 1/1 FAIL 后才修正两种标签。候选过滤纯 node-read/旧 map-read 且无文本/问题/附件的步骤，不删除 Cloud 工具配对、公共读取动作或旧 Slack 历史；带可见内容及实际节点动作仍呈现，stream 槽位判断一致。直接/stream 两种标签、重启与混合内容回归通过，插件 85/85、核心契约 33/33；准确组合源码全量基础 635 项中 631 通过/4 跳过、插件 85/85、安装边界 30 项及 smoke 通过。独立审查无剩余阻断，尚未部署此修复，真实新线程重跑待执行。

- [ ] 暂缓｜宣传站分支迁移（2026-09-30）：website 保留完整站点和工作台构建依赖；main 清理站点专属源码及 CI，产品前端、docs/design 画廊不动。站点构建及 21 项测试、影响选择器 11 项、工作流与测试治理检查通过；产品本地浏览器 55 项通过。Cloud 工作台与日志恢复浏览器、npm 打包及 CLI smoke（29 项安装边界）通过。双向 Cloud 同步浏览器在 `tests/cloud-sync-browser.mjs:94` 初始 Session 选择等待 12 秒超时。完整 Node 产品回归已发现既有 Claude CI 精确 handoff SHA 校验和 filesystem scoped Markdown 用例失败；最终全量结论待收口，不宣称全绿。首次 `npm test` 因默认缓存 EPERM 停止，隔离缓存重跑的安全套件通过；首次 Cloud 浏览器 vendor 字节断言受 Windows checkout 换行影响，仅恢复工作区为原 Git blob 后通过。日志保留在本任务 `temp/`。Pages 环境当前仅允许 main；未授权切换，迁移 PR 保持 Draft，部署步骤见 [宣传站分支](docs/website.md)。

- [ ] Filesystem v2 运行时闭环仍待验收：已新增受限、按版本的单文档 API/CLI，但尚未裁定或切换 Hook 的默认阅读入口；旧 Todo 缺少方案证据时仍为未判定 A1，报告标记 `TODO_ATTEMPT_UNCLASSIFIED`，待审核补齐，不能臆造 `Confirmed`。**Agent 打开模块时读哪套目录尚未拍板**，不得把「默认只暴露 Markdown」写成已经裁定的产品法。仍不得把 `legacy-records`、`bugs-index.json`、`tasks-index.json`、`jump-index.json`、`owns-index.json` 推荐成当前索引。现行 Bug 文件契约禁止延期：不需要修就删除文件；修不好用 `Unfixable` 结束。生成器把历史 `deferred` 投影为 `Unfixable`、把历史 `wontfix` 从投影中删除，二者都不得变成 `Open`。

- [ ] Idea 阅读隔离尚未完成：执行 Agent 的 v2 workbench 快照已过滤 Idea、普通 Agent 写入已拒绝；新 fs-v2 单文档接口对普通凭据过滤索引中的 Idea 并拒绝 Idea 文件。兼容用的私有 Main/Session 原始快照接口仍返回完整 Map，完成前不得宣称普通 Agent 无法从任何兼容入口读取 Idea。

- [x] Coordinator 节点挂载拒绝按钮不再依赖浏览器原生 `prompt`，点击即提交稳定拒绝并通知模型重新提案；PR #287（`f4f3c79`）Required 全绿并部署，Cloud 浏览器回归覆盖真实拒绝请求。生产原审核卡已不再处于待审核状态，无法对同一提案重复拒绝。

- [ ] 暂缓｜真实 Cloud 联调已复现挂载后的接续丢失与旧 Main 版本错误循环；已修复自动接续、原轮次停止和受限静态纠错提示。真实新建本地 Session、Plan/CI/验收/合并归档仍在推进，不能以单元回归替代原生闭环。

- [ ] 暂缓｜每个独立 Coordinator 任务采用项目级需求审批，后台按并发额度创建独立 Claude Session/worktree，就绪后派发；同任务恢复和返工沿用原执行环境。生产真实创建、设备离线恢复与完整 Plan/CI/验收链路待核验。
- 本轮项目任务持久化/原子额度/审批绑定/幂等及真实 Cloud HTTP 创建派发集成通过（合成设备心跳）；本机全量出现 Codex SQLite 发现、未绑定 Hook 用例失败，尚不能声明全量通过或生产交付。
- 新执行 Session 完成独立 worktree 注册后直接进入耐久派发队列，不再复用旧 Session 的 `stopped` 空闲门槛。PR #283（`bea80a3`）Required 全绿并部署；生产 TD1 已进入新 Session 的唯一 `task.assign`，本地 Claude delivery 为 running。
- [x] Coordinator 普通对话发起的新 Session 任务，按唯一同 ID 的 Main TODO/Bug 投影当前执行状态，不再继续展示旧 Session 派单；重复 ID 拒绝猜测。PR #285（`201cc37`）Required 全绿并部署，生产页面刷新后 TD1 已由“等待前序任务完成”变为“执行中”。

- [ ] Coordinator 已移除展示层 120 字硬截断；**现行法是生成目标，没有字数硬上限**，不得重新引入字符裁切。待补语义压缩方案。历史「强制 120 字」证据不覆盖这条。
- [ ] 暂缓｜Cloud Coordinator 的 500k 输入 token 对话 compact 已有模拟供应商用量、后台竞态、原文保留、工具配对和续接回归；真实 DeepSeek 达阈值后的摘要质量、长请求传输及首次压缩耗时仍待生产专项验收，不能用模拟测试声称已验证。
- 2026-09-23 本机 `npm test`：509 项中 505 通过、1 失败、3 跳过；失败为既有 `.github/scripts/codex-exec-session.test.mjs` 的 Codex SQLite 会话注册返回 `UNKNOWN_SESSION`（403），单独重跑同样失败。本次 Coordinator 定向 58 通过、1 个需真实供应商凭据的测试跳过；不把本机全量称为通过。
- 2026-09-23 后续修复该 403：Codex 数据库存储的工作树可经符号链接指向工作台规范化后的同一目录；单会话查找现核验真实路径，不放行其他项目。独立主线分支定向 3 项通过；本机 `npm test` 共 516 项，513 通过、3 跳过、0 失败，安装边界与 CI smoke 通过。上条失败记录作为修复前证据保留。
- [ ] 暂缓｜Coordinator 自动将 `acceptance-rejected` 原任务推进到返工、`read_task` 返回权威阻塞任务且不再询问用户执行 Session；本轮按用户要求直接开发，未新增或运行测试。
- [ ] 暂缓｜恢复控制重复投递：保存 Cloud 已确认的 resumed 回执，重启后抑制同控制再次唤起模型；新控制正常交付，任务/代次隔离。实现已随 `638acd3d` 部署，正式 delivery/workflow 及合并后的全量 438 项通过；真实断线恢复专项仍未执行，不能据此宣称全部通过。
- [x] 旧测试基线 Windows Python 启动失败：复用 main 已有 `python-command.mjs` 与测试，不再写死 python3；Python 探测与真实 Codex SQLite 注册共 4 项通过。原全量失败日志保留，本项通过不代表全量通过。
- [x] 旧联调基线 IF-046 父进程提前超时：复用 main a4e7c627 的有界 CLI 调用与进程树清理，保持全部业务断言；interface-events 6 项通过，其中真实跨 Session 用例约88秒。原全量393项391通过2失败保留，修复后的全量结果仍待核验。

## Cloud 夸克附件

- [x] 附件 Map 写入短暂锁竞争的有界重试、恢复保护锁失败关闭、脱敏阶段证据保留；总览/未配置项目上传入口按能力关闭。定向 17 项通过，Cloud 浏览器覆盖空文件、分享失败后重试且不重复上传、移动端按钮不换行、链接及刷新恢复。模拟供应商通过不代表外部网盘账户始终可用。
- [ ] 暂缓｜2026-09-27 GUI 首次转存失败的精确原始异常未被旧代码留存，只能定位到上传前的 Map 写入阶段；人工重试后后台完成。新修复的生产 GUI 复验及真实下载哈希待补齐；供应商鉴权、账户限制需单独核验，历史下载成功证据不覆盖当前限制。

- [x] 独立 kuake v1.5.0 在 Linux 服务器无 Agent 环境下完成合成 PDF 上传、下载 SHA-256 一致及受提取码保护的分享；首次下载 FILE_NOT_FOUND，稍后同文件补查成功。只证明隔离 CLI 能力，不等于线上 Cloud 验收。
- [x] kuake 生产适配、服务账户私密凭据配置及发布门禁：PR #242 的 12 项 GitHub 检查通过，`638acd3d` 已以干净 Linux Git 工作树部署；凭据位于仓库外的服务账户私密文件，CLI 固定 SHA-256。
- [x] 上线前置条件：服务器原有 CI 接收器及任务恢复差异已先进入同一发布分支和 main，再执行整仓替换；旧仓库、配置及中间发布目录均保留于时间戳回滚点。

- [x] Cloud 真实 HTTP/Map 转存链路、浏览器拖放与刷新恢复、并发/幂等/分享失败/崩溃回执保护和包内容验证；末轮 15 项定向测试通过。本机真实 Codex 宿主下，合成 PDF 经 Cloud 上传、下载哈希核验及暂存清理通过，不等于生产验收。
- [ ] 暂缓｜Quark 1.0.20 在普通无 Agent 环境返回 `-104`；生产需确认官方支持的服务器宿主和授权方式，不伪造标识绕过限制。
- [x] 服务器专用账户安装与授权固定 kuake v1.5.0；生产 Cloud HTTP/Map 链路完成合成 PDF 上传、ready 卡片持久化、受提取码保护分享、下载 SHA-256 一致及测试卡片清理，外部分享页返回 HTTP 200。浏览器交互由合并前自动化覆盖，本项不冒充生产人工拖放验收；配置与失败边界见 `docs/cloud-attachments.md`。
- [ ] 暂缓｜不确定上传结果的管理员对账入口、磁盘容量告警及历史/失败任务人工清理流程；当前保留文件并停止盲目重传。

## 工程治理待办

- [ ] GATE-01：清单校验与 Node runner 统一发现/排除逻辑，防止嵌套测试仅被登记却未执行。
- [ ] GATE-02：完善聚焦与跳过测试检查；当前文本检测不等于完整语义校验。两项验收定义见 [检查怎样算通过](docs/ci.md#明确待实现)。本次规范交付不表示工具已实现。
- [ ] GATE-05：Windows 全量测试已修复并通过（见下方证据）；隔离浏览器 Hook 的 20 秒 bootstrap 超时仍需专项验收，不能用 Node/CD 通过替代浏览器结果。[历史验证记录](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/c708dce44794f16edcdf5c53a51d0dcd7e0b2578/docs/engineering/validation.md) 保留原失败。

## CD 发布门禁与安装运行验收

- [x] 同提交 `ci.yml`/`Required` 发布门禁：错误 SHA、其他 workflow/仓库、取消/失败/跳过、旧绿灯、分页、等待及 API 错误均有正式测试；通过 GitHub 只读 API 核验 main 的真实成功运行。
- [x] 从实际 tarball 经 npm/npx 安装后启动 Workbench，验证健康、页面/资源、授权读取和未授权拒绝；缺失资源/依赖反例、Windows 空格路径、三客户端升级保留测试通过。
- [ ] 合并后由 GitHub runner 验证新增运行验收的 Ubuntu/macOS/Windows 矩阵；下一次授权版本标签发布时验证 CI 等待、OIDC 发布及安装后回验完整链路。本轮不发布 npm、不部署生产 Cloud。
- [x] Windows Python 商店别名：正式测试使用有界探测且验证版本的 Python 3 启动器；真实 SQLite 回归和失败/别名/旧版本反例通过。
- [x] Cloud 关闭等待后台发布及 HTTP 写入完成；暂停后台读取/写入的反例证明旧关闭逻辑会提前返回，修复后重启保留写入结果。测试清理通过官方停止入口处理 Git 共享状态，不再忽略停止失败，再有界重试目录删除。
- [x] 修复父子超时预算倒置：计划命令由 30 秒改为 180 秒，跨工作树及 Cloud 集成 CLI 有界为 120 秒；保留 Node 总套件 15 分钟上限和所有断言，超时结束本测试进程树。普通非 Git 目录探测由 4 次降为 1 次，保留同样的空元数据契约。
- [x] Windows 独立 `tests/ci-smoke.mjs` 改用 `npmInvocation`，完整包、三客户端、Hook、语言、Workbench、Session 和 Bug 记录冒烟已通过。
- [x] 2026-09-12 Windows / Node 22.18.0 / Python 3.13.7：`npm run test:cd` 退出 0，内部完整 `npm test` 通过 39 项安全检查、413 项 Node 测试（0 失败/跳过/取消，约 424 秒）和完整 CI 安装冒烟。重点旧失败用例至少 3 次通过，含串行与并发；新增事务路径、Cloud 集成失败也各有两次定向通过及最终全量通过。只做自检，无独立 Reviewer。
- [x] 最终 CD 演练：86 个精确包文件、敏感信息扫描、npm/npx 安装与安装后 Workbench、从 npm 0.4.4 升级到同版本本地候选的三客户端配置/数据/第三方 Hook 保留均通过。候选 SHA-256：`bccddd1de7fe97bace44b3f873f6afa2c2e8ee65ea682a1206afae48e4634e80`。280 文件源码快照扫描通过；没有发布 npm 或部署 Cloud。
- 首次失败仍保留：原 Node 15 分钟超时，以及修复中一次 408/410（隔离层加深引发 Windows 路径过长、Cloud 集成父进程 15 秒期限）；未删断言或跳过失败。临时层级已恢复并补正式回归。最终日志位于本任务工作树忽略目录 `temp/cd-rehearsal-timeout-final.log`，重点复测及反例日志同目录保留。
- [x] PR #238 浏览器缓存隔离回归：首次 GitHub 浏览器任务因 HOME 隔离改变 Playwright 工具缓存路径而启动失败。隔离层现保留原浏览器缓存及显式配置，个人配置继续隔离；默认/显式/npm/包内浏览器路径回归和本地隔离 Chromium 启动通过，GitHub run `34678409084` 的完整浏览器任务通过。首次失败 run `34678011731` 保留；最终提交的完整 Required 仍由 PR 门禁核验。

## 当前专项验收

- [ ] 暂缓｜Windows 托管 Claude 的原任务自动派发/恢复闭环：保留必要系统环境并自动定位 Git Bash；定向 8 项通过，安装后真实恢复已包含并执行 Bash。Plan 提示明确文件路径/stdin，原任务结果闭环与全量回归仍在验收，不代表已交付。普通跨客户端 Skill + hooks 验证仍属当前主线。
- 恢复中再次中断保留原业务阶段的修复已部署 Cloud，备份后仅修复一条实验任务；真实 Claude 已回报 resumed，任务恢复 assigned，但尚无完整任务成功证据。后续发现旧拒绝回执重放和过期控制重复交付；已补充明确拒绝与未知结果的重试提示，9 项投递测试通过，过期控制过滤仍待完成。
- Linux Node 18 全量两次均为 384 通过、2 失败、3 跳过：Codex SQLite 发现（环境没有内置 SQLite 或 sqlite3）和 legacy silent-headers 重连超时；后者单独运行通过，需继续定位全量运行差异。不得称全量绿色。
- [ ] 暂缓｜原生中断恢复与 Cloud `resuming` 控制衔接：阶段修复已部署，备份后修复指定实验任务；真实 Claude 自行回报 resumed、提交 Plan、收到自动审核并交接结果。完整 CI/验收仍未完成。
- [x] 网络未知后收到同 ID 权威明确拒绝时，保留拒绝回执并解除写队列阻塞；18 项设备/传输测试通过，安装版真实 Claude 的 Plan 重试成功。
- [ ] 暂缓｜CI 请求前匹配独立接收器：缺失、跨执行 Session、不同设备、共用工作树均拒绝进入 testing；保留已注册模板的受控继承及已经鉴权的 CI 主动请求。防护已部署，内外网健康检查正常；线上真实配置检查确认实验任务无匹配接收器。Windows 67 项定向通过，Linux 66 项通过、1 项 Windows 专用跳过；线上历史任务仍待匹配 CI 接收器，不能标记成功。
- 本轮 Windows 全量 `npm test` 未通过：安全 39 项通过，Node runner 在 15 分钟上限以 `ETIMEDOUT` 退出，未执行到最终安装烟测。保留 GATE-05，未放宽期限或跳过检查；21 项修复定向测试通过不能替代全量结果。
- 补充安装验收：直接运行烟测因缺少 npm 运行环境报 `spawnSync npm ENOENT`；随后 `npm exec --offline -- node tests/ci-smoke.mjs` 使用缓存的 Node 26.8.1，29 项安装边界及包、客户端、Hook、语言、工作台、Session、Bad Case 烟测通过。该结果不替代 Node 22.18.0 全量超时，也不代表 Cloud 已部署。

- 暂缓｜人工验收通过释放执行占用并推进同 Session FIFO；合并归档与最终关闭校验不变，旧任务晚到关闭不得释放正在执行的新任务。状态机、重启与真实安装入口回归中。

- Coordinator 独立问题卡片原位回答、持久问题/答案关联与回复状态；自由对话保留，回答不审批。接口、浏览器与部署验收中。

- 推荐节点跳转保留 Coordinator 面板展开与输入草稿；浏览器定位、无审批副作用回归中。

- Coordinator 结构化选择按钮与自由补充；回答复用普通消息通道，不授予审批；成功提问后等待回答，不再追加重复总结。定向、浏览器与真实模型验收中。
- [ ] 暂缓｜Cloud Coordinator 聊天中明确的「验收通过」或「验收不通过：原因」由已登录页面代提交当前唯一待验收任务的人工回执；模糊语句、缺理由和多候选不提交，按钮继续可用。本地浏览器回归覆盖上述边界；生产 Cloud 真人指令、断线后回执核对与模型后续返工仍待验收，合并不等于已上线。
- 2026-09-24 本轮第一次本机 `npm test` 为 539 项中 535 通过、1 失败、3 跳过；失败是既有 `Cloud requirement confirmation uses browser authority...` 用例清理临时目录时的 `ENOTEMPTY`，该用例单独重跑通过。保留首次失败证据；修正该用例先关闭服务再删除目录后，第二次完整 `npm test` 为 536 通过、0 失败、3 跳过，安装边界和 CI smoke 通过；本轮功能浏览器回归另已通过。

- Coordinator 聊天移除常态状态文字、逐条角色标签与装饰分隔线；保留错误提示、消息气泡及审核/重试交互。浏览器回归验收中。

- Coordinator 回复中的已知 Main 节点名称可点击定位；按服务端节点 ID 跳转，不触发挂载审批或派单，同名歧义保留文字。已通过接口与浏览器回归。

- Coordinator 聊天移除运行记录、新建执行会话和顶部对话选择器；保留每个事项的对话入口与草稿隔离，后台接口和历史不删除。浏览器回归与部署验收中。

- Coordinator 提示词升级只在新轮次生效；旧版本在首次模型调用前报 PROMPT_CHANGED 的请求可原号重试，已有工具执行的中途轮次仍拒绝换版。正式回归及部署验收中。

- [ ] Coordinator 自行查找并推荐节点，只澄清缺失的业务信息；优先用本机真实项目与首轮延迟/准确率验收。原 Cloud 部署验收暂缓。

- [x] Coordinator 按 TODO/Bug 独立持久化对话与任务路由，保留历史总对话；单项目消息泵、暂停隔离、分页重启和页面切换的正式回归通过。合并后的 Cloud 实际验收另行记录，不代表实验开发闭环完成。

- 工作台工具入口：布局、关系、授权收进一个默认折叠按钮；保留原控制逻辑，浏览器回归和部署验收待完成。

状态阅读规则：最新专项验收优先；历史实现记录不自动代表当前部署或完整端到端通过。文档入口见 [docs/README.md](docs/README.md)。

## Claude 隔离实验与 Coordinator（开发中，未交付）

- Cloud 新建会话 Main ref 修复 PR #195 已合并、部署并安装验收：实际网页创建独立 Claude worktree/profile，原生启动绑定，名称与空闲心跳正确；子会话真实任务及 CI 联动仍待完成。
- 真实 TODO/Bug 创建已触发模型读取和 `ask_user`，但问题正文被公共消息投影丢弃。补充成功提问的聊天正文投影，保持其他工具参数隐藏；重启恢复和浏览器可见性回归，部署验收仍待完成。

- [ ] 暂缓｜旧 Cloud Coordinator 对话与自动派发复合入口：安全 Markdown、聊天排版、折叠内部事件；新增 TODO/Bug 主动对接；Cloud 发起本机新 Session。历史能力分别验收，不能把界面渲染当成派单能力完成。本机快聊/brief 另见当前唯一开发队列。
- [ ] 暂缓｜Coordinator 节点详情与事项面板中的人工“分配/认领 Session”入口已删除；仅完成语法检查，待 Cloud 浏览器回归确认。
  - 聊天界面已合并部署并核验实际 Cloud 页面：列表/代码/表格/链接、拒绝 HTML 执行与外部图片请求、折叠运行记录。
  - Main 新建事项先澄清入口：已通过消费游标重启/丢失回复去重及浏览器 TODO/Bug 保存不派单回归；尚待 Required CI、部署及真实模型主动提问验收。Session Map 内的创建入口及新建本机 Session 尚未接通。
  - Cloud 新建 Claude Session 开发中：持久创建请求、设备隔离、独立 worktree/profile、原生绑定回执、Coordinator 动态会话名单和页面重试入口已接线。相关单元、失败回报经心跳补传、模板 CI 接收方委托及模拟浏览器用例通过；尚缺真实创建、真实 CI 联动及部署验收，不视为已交付。

- [x] Claude 官方配置目录优先、角色提示词随包安装；安装隔离回归通过，保留其他宿主配置。
- [x] 本地控制接口允许有界的大 Map/历史响应，超限明确报错；回归覆盖超过旧 1 MiB 上限的成功响应。
- [x] 原生 Claude 实验复现并修复未绑定 Stop 提示反复触发模型、Session 名称丢失；正式回归通过，隔离安装入口已有原生启动/工具/停止证据。
- [x] Claude 本地投递适配器的串行、准确 Session 恢复、丢失确认与重复投递回归；隔离 Cloud 工作台已实际唤起原生 Claude，并收到开始/完成回报。不代表开发、CI 和合并闭环通过。
- [x] Coordinator 模型传输层验证固定模型、超时、响应限制和持久工具操作身份；真实模型工具调用已验证，不代表 Cloud 工具接线完成。
- [ ] 暂缓｜Cloud Coordinator 的持久对话、受限工具、页面确认与审核、CI 委托接线。
  - PR #181/#182 已合并并部署，实验项目已启用真实模型；规范名称枚举及受限别名兼容已通过原失败请求的真实恢复验收。模型已读取 Main 并产出两个真实节点提案。
  - 节点批量审核入口开发中：同版本提案原子提交、浏览器权限、拒绝反馈、重启重放与既有 Coordinator 自动通知；真实提案确认与后续开发仍待验收。
  - PR #183 已部署并通过真实批量节点确认：两个节点落入 Main，自动准备需求、模拟人工批准后唤起 Claude，真实 Plan 已提交。发现审核工具 taskId 复制错误后对话锁住；确定参数错误反馈与人工纠正入口正在修复，尚未进入代码开发。
  - 开发分支已加入受限会话发现、持久问答、显式重试和需求确认入口；9 项 Coordinator 回归与真实浏览器功能开关、文本安全、刷新重试回归通过。HTTP 验证需求确认只接受浏览器权限、绑定原需求版本且可重复重放；节点挂载确认、审核后自动推进和 CI 委托未完成，尚未部署。
- [ ] 暂缓｜Cloud 执行链上的 Claude 启动/失败/压缩/退出 Hook 补强、CI 测试授权与准确 SHA 隔离、原生中断恢复。跨客户端 Map 读写所需的现有 hooks 仍属当前主线。
  - 真实开发超时后缺少继续入口：开发本机显式恢复同一 Session，保留原交付与恢复回执，旧进程未退出时拒绝；真实恢复及 Cloud 任务收口仍待验证。
  - 开发分支新增：现有协议队列自动通知 Coordinator，重启与丢失消费确认不重复启动模型；CI 的设备归属、独立 worktree、证据命名空间、准确 SHA/源码未改校验和精确测试命令授权已通过定向测试。原生 Claude CI 完整交付、CLI Plan/handoff 的端到端验收和中断恢复仍未完成。
  - 独立 Claude CI 已通过真实启动并加载指定模型/Skill；原生工具失败、PreCompact/PostCompact 和 SessionEnd 已观察到。API 失败 Hook 的独立故障注入仍在验证，不把安装了事件算作原生验收。
  - 修正已识别旧版本被目录误标为 legacy 的自举阻塞；修正 CI 结束与清理之间短暂残留授权。人工验收绑定当前 CI 版本，拒绝后按原反馈返工，未验收时禁止完成；接口定向测试通过，完整浏览器闭环尚未完成。
- [ ] 暂缓｜实验工作台首次发布后 Session 视图恢复；已观察到 Session 快照关闭后的 `UNKNOWN_VIEW`，不能把心跳在线当作地图可编辑。
- [ ] 暂缓｜两 Bug 两 TODO 的真实开发、Plan/CI/验收拒绝返工、GitHub CI/合并/归档可信闭环。
  - 返工提示补充 Cloud 已保存的原始拒绝理由；正式回归覆盖人类验收拒绝和 CI 失败，不以模板回归代替真实 Claude 返工验收。
  - 开发分支补充真实 GitHub PR/Required Check 只读校验与服务器发布回执关联；锁定仓库、分支、准确 SHA、Check App 身份和验收→合并→归档顺序。不采信 Agent 自述，未配置校验时继续拒绝关闭。定向回归通过，私有仓库凭证配置、真实合并与关闭回报仍待端到端验收。
- [ ] 暂缓｜30 分钟心跳与故障恢复观察，以及旧派发链的产品 Required CI、合并后的安装副本和 Cloud 真实验收。当前 PR 的 Required 仍必须通过。
  - 首轮开发期观察记录 180 次采样：本地后端显式重启期间出现 2 次离线，最大心跳年龄 44.7 秒，之后自动恢复。此轮包含故障操作，不作为无故障稳定性验收。

- [ ] 暂缓｜B1 Session 状态三层重构：连接、原生执行器和任务队列分别投影；Cloud 凭证过期或心跳超时不得继续显示绿色，queued 任务需明确等待本地接收并提供可恢复状态。

## 仓库整理

- [x] 第一阶段：设计草案集中到 `docs/design/`，建立文档入口与现有文件职责表；不改 Hook、角色设计和运行接口。
- [x] 第二阶段源码整理与本地回归：生产/演示分离、公共协议归位、旧同步兼容区迁移、重复 I/O 与清单去重。合并与安装/生产验收另按 RULE 执行并归档，不用源码测试代替。
  - PR #178（`7d9b215`）画廊迁移已通过 CI、安装一致性与真实 Cloud 页面验收。
  - PR #179（`437c385`）完成共享层、演示隔离与清单去重；Required CI、65 文件安装一致性和 Cloud 部署完成。
  - 上线复核补充：删除服务端读取失败后回退静态地图的路径；字体延后加载。正式 Cloud 浏览器测试覆盖截断响应不串图、字体停滞不阻塞启动及重试恢复。
  - 演示地图、示例 Session/Bug 和预设项目原移到 `site/demo/`（宣传站迁移后，main 的浏览器测试从 `tests/fixtures/` 读取同一合成数据）；生产仅加载空白数据结构，浏览器回归验证初始化不写入演示模块。
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
- [ ] 暂缓｜旧 Cloud 自动反馈消费与返工流程由用户后续设计；当前仅保留待处理反馈接口。本机对话与 brief 收敛见当前唯一开发队列。

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
- [ ] 暂缓｜桌面唤醒差异收口：`codex queue` 已通过复用现有桌面的真实执行验收；此前未加载会话出现只入队、不执行。需对齐成功调用的入口及宿主状态并补未加载场景回归，不能推断桌面不支持，也不能把打开会话后的成功或另起 App Server 算作该场景通过。
- [x] macOS 原会话公开链接加载接入本地派单脚本；正式适配器测试覆盖加载先于投递、加载超时不入队、非法 Session ID、重启重放不重复加载/投递、投递结果未知保护。测试替身不等于实机自动打开验收。
- [ ] 暂缓｜macOS 安装入口自动加载未加载会话并处理 Cloud 任务的实机验收；人工点击公开链接已验证 notLoaded → idle，不替代脚本自动调用证据。Windows/Linux 自动加载未实现，本轮不声称覆盖。

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
- [ ] 暂缓｜未确定 Cloud Main 合并白名单与可信归档验证器，实际合并/最终关闭保持拒绝；不把测试注入的验证器当作生产合并实现。Cursor/Claude 提供显式 CLI 拉取入口，尚无自动唤醒适配器。
- [ ] 暂缓｜旧自动派发链的 GitHub CI、生产 Cloud 与安装入口验收；本地全量 `npm test`、完整浏览器回归和隔离 Cloud 真人点击流程已通过。合并包内容白名单未确定前拒绝实际合并。当前 PR 的 CI 仍照常执行。

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
- [ ] 暂缓｜新机器首次密码登录及安装副本连接生产 Cloud 的人工验收；隔离接口测试不代表生产部署已完成。

- [ ] 暂缓｜本轮未按用户要求运行测试：验证 Cloud 不再渲染或接受人工发布 Main，合入权威 main 后由服务器自动发布；验证旧的非空 mode-less Session 授权升级为动态 `all`，明确 `explicit` 收窄不受影响；验证已配置 Cloud 时 Hook 只返回 Cloud 前端地址而本地服务仅作后台。

- [ ] 暂缓｜本轮旧 Cloud 接线待集中验收：Hook 动态全权限与显式撤权一致；Cloud 从本 Session 生命周期记录读取任务名称；页面 Session 切换失败提示、后端重启自动恢复、10秒轻量版本补读。需安装副本与真实 Cloud 页面验收，不以源码存在代替已部署。Map 本地权限正确性仍属当前主线。

- [x] 兼容旧 Cloud 的 Session 同步：事件流无数据/响应头停滞时超时重连；独立心跳补读 Cloud-only 修改；心跳单飞、无变化不写盘、v2 接管停用旧心跳（`tests/workbench-sync.test.mjs` 的 Legacy sync/heartbeat 用例）
- [x] Cloud 当前状态读取合并并发冷读，缓存排除历史与回执；外部文件替换失效、写入失败不发布缓存、保留完整磁盘历史；64 MiB 堆下50并发读取回归（`tests/cloud-workbench.test.mjs`）
- [ ] 暂缓｜Cloud 历史与回执继续增长时的分片存储及历史查询/写入峰值内存；本次不删减历史，热读缓存不等于消除无限存储增长
- [ ] 暂缓｜生产网络下长时间断流与恢复观察；隔离故障测试通过不等于所有生产断连原因已经消除

- [x] 命名入口 Host/Origin/令牌隔离、读写、5 个 session/SSE、原生 Python SessionStart 处理函数、自动打开去重（`tests/named-workbench.test.mjs`）
- [x] 并发启动共享代理、名称冲突不接管、后端端口复用身份校验、代理重启及项目退出隔离、损坏路由文件拒绝覆盖
- [x] 同一 Git 仓库的显式 worktree 绑定、保留原 Map、拒绝跨仓库绑定；许可证随包及 Skill 安装验证
- [x] 命名入口与 Session 隔离兼容、未绑定不启动、跨 worktree 重启保留项目命名入口
- [x] 全局运行态清单合并项目注册表、命名路由和后端探测；区分 ready/stopped/legacy/duplicate/unknown，跨 worktree 按实例去重，未绑定 Hook 复用同项目命名地址（`tests/named-workbench.test.mjs`）
- [x] 项目首次绑定仍需确认；后续真实 Session 按 Session ID 自动绑定唯一已建立工作台，并自动恢复兼容的停止服务；歧义、错配和真实迁移继续要求确认（`tests/named-workbench.test.mjs`、`tests/ci-smoke.mjs`）
- [x] 新 Session 默认动态拥有自己的完整工作台权限（含未来节点），人工可收窄、撤销和恢复；Main 写入、发布和管理权限始终隔离（`.github/scripts/multiworktree.test.mjs`、`tests/workbench-sync.test.mjs`、`tests/hook-lifecycle.test.mjs`）
- [ ] 各宿主应用实际投递 SessionStart、桌面浏览器启动失败反馈；处理函数测试不等于所有宿主端到端验收
- [ ] macOS/Windows/Linux 浏览器的 `.localhost` DNS 解析与受管网络策略兼容；正式精简实现的长期 CPU/内存/物理 I/O 基准
- [ ] 暂缓｜旧 Map-only Cloud Sync 与多个 worktree 的联调；旧服务目标绑定不代表服务器迁移完成
- [ ] 启动器强制终止后空/损坏启动锁及遗留 reclaim 锁的显式恢复工具；当前失败关闭，不擅自删除未知锁
- [ ] 暂缓｜本轮按用户要求未在本地运行测试：验证认证浏览器可直接编辑私有 Main Map，刷新后仍从服务器权威文件读取；验证重复 `operationId` 幂等、复用 ID 被拒绝、过期 `baseVersion` 返回冲突，同时项目令牌仍不能直写 Main
- [ ] 暂缓｜本轮按用户要求未在本地运行测试：验证真实 Hook 上传在 Cloud Session 被人工编辑后执行三方合并；重叠字段和缺失共同基线时写入 `remote-sync/conflict.json` 并停止上传，断线重放先持久化回执
- [ ] 暂缓｜本轮按用户要求未在本地运行测试：验证线上 Session 最近活动两分钟内显示运行中、明确 Stop/完成显示已完成、没有新生命周期事件则转为断联/未知，旧 `SessionStart` 不再永久转圈
- [ ] 暂缓｜本轮按用户要求未在本地运行测试：验证普通 merge 与 squash merge 均能触发自动 Main 发布；squash 后同路径再被修改时必须保持 waiting，源提交不可达时不得误发布

## 架构与测试治理

- [x] Coordinator 默认回复由服务端出口强制限制为 3 句、120 字；历史消息、流式预览、开放问题、直答与工具调用后回答共用同一契约，显式要求详细时放宽。正式测试覆盖模拟调用全链，另提供使用服务器私有 provider 文件的真实 DeepSeek 直答与工具调用烟测（`tests/cloud-coordinator.test.mjs`）。
- [x] 明确开发请求不重复索要计划确认；Context Guard 控制命令可经 Node/Python 正式入口和字面量 stdin 安全通道自举；PR 合入 main 后强制从合并版本更新本机 Skill，并通过安装入口执行真实功能验收（`tests/hook-lifecycle.test.mjs`）
- [x] 将 `prototype/workbench.html` 的样式、演示数据和交互逻辑分层，并同时覆盖本地 CSP、Cloud 静态路由和官网演示构建（`prototype/workbench.css`、`prototype/workbench-fixtures.js`、`prototype/workbench-app.js`）
- [x] 消融删除硬编码的伪用户记忆，并补充旧缓存迁移提示断言（[历史消融记录](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/c708dce44794f16edcdf5c53a51d0dcd7e0b2578/docs/ablation-review.md)、`tests/workbench-browser.mjs`）
- [x] Session 下拉框按 ID 去重且不展示原始 ID，URL 固定当前会话，发布/关闭项移除、失效项禁用；关系模式默认关闭并在 Session 切换时退出（`tests/workbench-browser.mjs`、`tests/cloud-workbench-browser.mjs`）
- [x] Coordinator TODO/Bug 自动路由：删除手动 Session 选择与认领入口，新事项保留 `itemId/nodeId/kind` 和稳定 `taskId`，后台按项目任务为每项创建独立执行 Session；定向协议 84 项通过、两套浏览器回归通过。生产 E2E 待线上部署恢复后复跑；本轮线上 502 记录为 B108。
- [x] 用统一清单约束自动测试、独立套件与 helper，禁止遗漏和 `.only`，并明确开发/Review/E2E 的责任边界（`tests/test-manifest.json`、`docs/test-governance.md`）

## Cloud／Skill 拆分验收（2026-10-04；替代旧同仓库与 Map-only 说明）

本节是本次明确授权的交接，历史记录全部保留。上文旧 `sync serve/connect`、legacy 路径和同仓库部署的 `[x]` 仅表示当时的验证，不要求恢复已淘汰实现；未完成的 Cloud 专项在独立 Cloud 仓库继续追踪，不因移动文件而视为通过。manual 审批保存 Main 事项与执行提示，automatic 审批后新建执行 Session；两者挂载均不写 Main。Coordinator／Executor／Tester 分工不变。

### SPLIT-SYNC-01 · 当前 Session 同步与旧状态保护

- [x] Executor：淘汰旧 Map-only daemon/兼容入口，CLI、Hook 转当前 Session 记忆接口；finish 需要服务端快照回执。只读检查旧待发、冲突、活动窗口和旧进程，返回 `UPGRADE_REQUIRED`，不删除私有数据；只有旧配置时要求当前连接，已有当前连接不会被无待发的旧配置阻塞。
- [x] Executor 定向证据（测试迁移前）：22 项首轮 21 通过，Hook 夹具先后暴露空 sourceCommit 与未带人工审核记录两项失败；修正真实 Git/审核夹具后该项通过，新增后端启动不能绕过 pending guard 单项通过。保留失败经过，不将它写成未经返工的全绿。未运行生产验收。
- [ ] Tester：对最终 Skill SHA、Cloud SHA 和共享包版本复验 CLI status/ensure、Hook prepare/finish、回执丢失重试、待发数据逐字保留、配置残留重连及后端启动防绕过；覆盖另一 worktree/Session 出错时的隔离，不只验证直接调用函数。
- [ ] Tester：重跑拆分后的正式用例：Skill `tests/cloud-sync-client.test.mjs`、`tests/hook-lifecycle.test.mjs`、`tests/named-workbench.test.mjs`；Cloud `tests/session-sync-cloud.test.mjs`、`tests/workbench-cloud-sync.test.mjs`、`tests/multiworktree-cloud.test.mjs`、`tests/hook-cloud.test.mjs`。原 SSE 停滞/心跳补漏与双向断网/冲突断言必须保留，迁移前结果不代替迁移后执行。

### SPLIT-BUILD-01 · 固定共享包与独立构建

- [ ] Tester：从没有生成物和另一个本地 checkout 的干净检出执行 `npm ci --ignore-scripts`、`npm run build:runtime`；核对共享包明确版本、锁文件完整性及可重复构建，依赖不可下载或被篡改时必须失败。
- [ ] Tester：核对 `scripts/shared/`、`prototype/`、角色文件和生成 references 来自固定 Cloud 包，手改生成物不得被静默覆盖；`references/cloud-sync-interface.md` 始终由 Skill 维护。不得靠本机旧文件、浮动 main/latest 或跨仓库相对路径通过。
- [x] Tester：两个仓库独立 CI 与 Required 通过；Skill 产物含完整本地运行依赖/UI，却不含 Cloud 服务端、Slack SDK、部署配置、凭据或私有记忆；运行时包中的第三方许可保留。最终两仓库 SHA、共享版本与正式发布见 Final delivery status；精确包哈希及边界输出见上方独立制品验收和 CD run `37271755297`。

### SPLIT-INSTALL-01 · 安装后的真实入口与升级

- [x] Tester：Ubuntu/macOS/Windows 从准确 tarball 新装及升级，校验源码版本、生成运行时版本与安装文件一致；用户设置、项目 Map、未发队列及第三方 Hook 不变，用户关闭的 Hook 不被重新启用。最终证据为 official npm 0.6.2 CD run `37271755297` 的三平台安装/升级与下载验收；三本机显式 `--no-hooks` 安装另见 Final delivery status。
- [ ] Tester：安装后的入口在无 Cloud 模式启动本地工作台、读取/编辑/刷新；在授权实验项目使用浏览器设备授权连接真实 Cloud，确认双向可见、Session 隔离和重启恢复，不把源码或替身测试当成真实联调。
- [ ] Tester：安装入口的 `doctor`、宿主 Hook 信任与实际上下文投递分别记录；无法验证的宿主/场景标为 incomplete。完成后保留本节编号、打勾并关联准确测试和证据，不删除条目。

### SPLIT-STOP-01 · 停止确认后的 Windows 文件删除竞争（2026-10-05）

- [x] Executor：仅在 `/api/stop` 已确认后的原 12 秒等待窗口，重试 `EBUSY` 与 Windows `EPERM`；读取失败不等于实例已释放，不全局忽略权限异常、不删除锁、不延长截止时间。
- [x] Executor 定向验证：`node --test --test-timeout=30000 --test-name-pattern="stop acknowledgement:" tests/named-workbench.test.mjs`，Windows 9/9 通过（3.09 秒）；覆盖正常释放、state/lock 短暂占用后释放、持续占用或同实例未释放仍失败、其他权限异常及确认前异常不重试。首轮夹具在已删除文件上拦截 readFile 未触发（readJSON 先 stat），修正为拦截实际文件检查入口后通过；未改变业务断言。此为故障注入，不代替安装 smoke。
- [ ] Tester：对最终 SHA 重跑安装产物 `tests/ci-smoke.mjs` 的 Python `workbench --stop`，并在 Windows/Linux/macOS 复验上述正式回归。此前 367/367 Node 用例及 29 安装边界通过不代表整轮 `npm test` 成功：Windows smoke 的锁读取 `EPERM` 导致整体退出 1；现场锁/state 后来消失只支持删除竞争推断，不证明永远不存在权限问题。

- [x] Tester 本地 Windows 定向验收（2026-10-05，Node 22.18.0）：基线 `efad812eda59a6b713d0b355e6b3ba2bfbeb4b7a` 加本节未提交修复；`cli.mjs` SHA256 `dc086c92ca3075588fa5cdd30ecaf9e2daaf0cdcc9c71204875365fb6771359c`，`named-workbench.test.mjs` SHA256 `43bdc659a0a11633c31b05f85660705747b748e1d2d6f21f3e5b4eaa59c0aa86`。独立审查未发现阻断；上述正式定向命令 9/9 passed（3.25 秒，运行输出 `543fad`）；`node tests/ci-smoke.mjs` passed（运行 `57163`，最终退出 0），29 安装边界通过，实际 npm tarball 安装后的工作台启动、复用及两处 Python `workbench --stop` 均完成。未重跑全量、未接触其他工作台；Linux/macOS 与最终提交 SHA 验证仍为 incomplete，故上一项保留未勾选。故障注入不证明前次失败瞬间的唯一成因。
- 本次安装烟测打包后 Coordinator 另行补充 Ready 分发许可、重打 UI 包及更新锁文件；运行 `57163` 仅证明当次停止修复安装链路通过，不作为后续许可和包清单变更的最终产物证据。最终包冻结后另做必要安装验收。

### SPLIT-LOCAL-CI-01 · 本地集中回归（2026-10-05）

- 首轮 `efad812` Windows `npm test`：367/367 Node 用例、29/29 安装边界通过，安装烟测停止入口出现 `EPERM`，整体退出 1；修复与独立复验见 SPLIT-STOP-01，不把部分通过当作整轮成功。
- 本地 `npm run security:test` 39 项通过，`npm run test:browser` 退出 0。共享 UI 增加经用户授权的 Ready 归属声明后重新生成，固定包 SHA256 为 `8590f3292c312e93b6db8c680b8943b7002df7103feff6b6660ce44d117472e9`；Core 包未变。新 Skill 包精确 100 文件清单及安全扫描通过。
- [ ] Tester：最终提交的全量、干净安装与跨平台 CI、安装后的真实 Cloud 联调；本地结果不替代 Required 或生产验收。

### SPLIT-EOL-01 · 跨平台制品字节一致性

- 独立 Tester 在 `86db875` 的干净 Git 归档构建成功，但产物 SHA256 与 Windows 工作树打包不同；100 文件中的 12 个仅存在 CRLF/LF 差异。旧包的安装烟测通过，不代表可重复构建通过。
- 两仓库固定 `text=auto eol=lf`、PNG 保持二进制；只机械规范已跟踪文本的换行，不改变 Git 中业务源码内容。共享 Core/UI 重新打包并更新锁完整性，生成物由正式 materializer 更新。
- 此修复使在跑的最终全量输入过期，已仅终止本任务测试进程树并保留输出，记录为取消而非通过；不清理其他工作台或失败证据。最终干净包逐字节比较、浏览器与集中全量仍待复验。
- 独立 Tester 对 `f6637d74c6c2231fd8718dacedc926a2ae3cb4ce` 的新 Git 归档，在只预填精确完整性制品的私有缓存下执行未改依赖 URL 的 `npm ci → build:runtime → pack`；100 文件包逐字节相同，SHA256 `55a065ee5bdece9210f6219c00d602edd3add768498c7e4a0f06e9efcdfb351c`。最终安装 smoke 在 Node 24.19.0 退出 0，29 安装边界通过。Node 18.20.8 正式构建测试 8/8、最终 Core 十个模块导入通过。预填缓存不证明发布地址可下载。
- `f6637d7` 本机 Node 24.19.0 默认全量在 901 秒触发整批 900 秒上限，整体退出 1；可确认 196 项通过、无断言失败，剩余 180 项没有完整结果，不能认为未运行或通过。本轮未进入安装烟测；独立安装结果不是该整轮结果。慢项横跨 worktree、绑定、客户端和 Hook，且期间有隔离 smoke 并行，不能将变慢唯一归因于 Node 版本。保留原时间限制与失败证据。

### SPLIT-MERGE-01 · Session 相同字段同值不应误报冲突（2026-10-05）

- 独立 Tester 首轮：Node 22 全 `workbench-sync` 81/81 通过（23 秒）；Node 18 为 80 通过、1 项预期 SQLite 跳过，但 after 清理夹具发生 `ENOTEMPTY`，整体退出 1，不能记为通过。现场最后只余空 private 目录且未发现对应活进程，不据此断言早期失败的唯一原因。
- [x] Executor：仅为已验证系统临时目录及 `cg-sync-` 前缀的夹具清理增加 `maxRetries: 5`、`retryDelay: 100`；重试耗尽仍抛错，不改业务、断言或测试时限。
- [x] Tester：独立复跑 Node 18.20.8 全 `tests/workbench-sync.test.mjs`，80 通过、0 失败、1 项既有 SQLite 版本限制跳过，24.82 秒，进程退出 0。业务 SHA256 `b88895c446815ae3af72d8a14f020f7627f1744a3ae77a5797544d6e535050b5`；测试 SHA256 `d0f5ee93bfd9078901a9dd90db634ec0b1bf6251590a666d128bd27fc1434788`。审查确认异步关闭被等待、安全路径校验不变、重试耗尽仍失败；未放宽断言或时限。此前 Node 22 全套 81/81 通过；最终提交与安装链路仍另行验收。
- [x] Executor：证实旧逻辑把 `base.title=A / local.title=B / remote.title=B` 加远端独立 purpose 修改误判为 `REMOTE_AND_LOCAL_CHANGED`。同步协调器改为复用既有 `mergeSessionDocuments`；只将 `MEMORY_CONFLICT` 保存为三方冲突，其他异常继续抛出。未引入第二套合并规则。
- [x] Executor：`node --test --test-timeout=30000 --test-name-pattern="Session reconcile|Session reopen merge|Session sync compares" tests/workbench-sync.test.mjs`，8/8 通过（0.49 秒）。覆盖同值合并、双方非重叠修改、本地尾部上传及回执丢失后原 ID/原内容重放一次、旧 base/outbox 的确认边界；真正不同值、删除与编辑、重复记录身份继续保留三方快照与待发内容；提交权限错误不吞掉。首轮新增夹具缺少运行时规范化的 `bootstrap:ready` 导致两条全量文档断言失败，补齐该字段后通过。
- [ ] Tester：基于最终 Skill SHA 和对应安装产物独立复验以上正式用例及真实 Cloud 双向同步；确认断网/回执未知时不丢待发内容，不能用单函数测试代替安装后的链路。
- [ ] 原 Cloud browser 的 line121 同步冲突仍未归因：两次诊断在 line95 初始 Session 选择超时，随后无重型并行任务时，未修的 f663 安装包在原 12/25 秒限制下完整通过，未捕获冲突三方快照。因此本修复只关闭已独立复现的合并误报，不宣称已经修复最初浏览器失败；保留 Cloud `temp/session-sync-diagnostic-*` 与 `temp/same-value-merge-*` 的合成取证，后续复现再关联。
- 最终本地集中回归：Windows、Node 22.18.0，`npm test` 退出 0；39 项安全检查、382/382 功能测试（815.72 秒、零失败/跳过）、29 项安装边界，以及实际 tarball 安装后的 CLI/工作台/停止烟测通过。日志 `temp/local-ci-skill-merge-final-20261005.log`。输入为 f6637d7 加上述已独立审查的同步及清理修复；未延长 runner 时限、未跳测试，跨平台 Required 与生产验收仍待完成。

### RUNNER-LIFECYCLE-ORDER-01 · 生命周期套件调度顺序（2026-10-06）

- 原 Node 22 本地 CD 约 901 秒超时记录保留：可见 216 项通过及 1 项 fetch 失败，不是整轮通过。独立检查确认 Node 18/22/24 CLI 会重新排序传入的测试文件，生命周期套件晚启动；仅调 CLI 参数顺序无效，调度改进也不保证总运行时间必定低于上限。
- [x] Executor：同一 runner 改用公共 `node:test.run` 的有序文件列表和 TAP reporter，生命周期套件进入首批并发；原自动发现集合仍为 32 个唯一文件，并发上限 2、父进程单次 900 秒、CD 外层 30 分钟和已有进程树清理均不变。默认运行全部文件，不添加过滤入口、第二测试清单或私有 Node API。
- [x] Executor：既有 `test-environment.test.mjs` 正式回归从同一 parent 入口运行隔离合成文件，检查完整执行一次、真实首批启动、并发峰值 2、成功退出 0、断言失败及模块异常退出 1、完整 TAP 汇总、惰性导入和拒绝名称过滤。Windows Node 18.20.8、22.18.0、24.19.0 的 `node --test .github/scripts/test-environment.test.mjs` 均 4/4、退出 0；治理及 `git diff --check` 通过。
- 首次 Node 18 模块检查为 3/4、退出 1：`setup` 参数不支持 `.on`，与该版文档描述存在差异。改为对 `run()` 返回的公共 TestsStream 注册监听后通过；未使用私有 API。首次失败工具输出及隔离现场 `temp/node-runner-lutOTT` 保留，不覆盖为成功。
- [ ] 独立 Tester：以本次最终提交 SHA 集中复核模块与完整 CD，保留原时限、失败历史和精确产物证据；模块通过不代表全量、安装或发布验收完成。

### CLAUDE-LIMIT-FIXTURE-01 · 分离冷启动与输出限额的测试前提（2026-10-06）

- 原 `492b61c` 完整 CD 失败保留：420 项中 418 PASS / 2 FAIL；Claude watchdog 用例期望 `CLAUDE_OUTPUT_LIMIT`，实际 `CLAUDE_TIMEOUT_OR_INTERRUPTED`。来源 `temp/tester-skill064-listen-cd-node22-20261006.log` 第 1712 行及 `temp/tester-skill064-listen-acceptance-20261006.md`；该轮并非超时，也不因随后定向通过改记成功。
- 一次 Node 22 安全取证先通过；增加显式 ready/release 后，三版本集中检查中的 Node 22 再次失败：flood 在 238ms 观察到 running、841ms 观察到 TIMEOUT，但输出 0 字节、未见 init、未释放 flood，夹具连启动记录也未写入。失败现场 `cg-claude-idle-timeout-T9enA3` 保留在本机系统临时目录。该轮 18/24 通过；22 的 TAP 为 FAIL，串行命令未单独采集它的退出码，不冒称具有独立退出码证据。这证明该失败发生在就绪前，不能通过覆盖 first-reason 来假报输出超限。
- [x] Executor：仅修改测试设计，不修改 ClaudeRuntime。active/silent 的 400ms idle 与 bounded 的 650ms turn 保持原样；**flood-only timeoutMs 从 400 改为 6000**，移除输出限额测试无关的冷启动前提。该分支仍从 deliver 前统一计算原 6000ms 端到端截止，ready 后不重置，超时检查先于终态返回。1024 字节限额、2134 字节 flood 和唯一 `CLAUDE_OUTPUT_LIMIT` 期望不变。
- [x] Executor：通过真实持久 init 释放同一子进程；就绪阶段每 50ms 至多一个 stderr 字节、最多 120 个并受同一总截止约束，init 加心跳严格小于 1024，并有正式断言。保留各阶段无正文时间/字节诊断，失败不删除夹具。没有 warmup、概率重试、新增 Runtime 参数或测试框架；不能宣称产品错误分类被修复。
- [x] Executor 最终集中定向：Windows Node 18.20.8 / 22.18.0 / 24.19.0 分别独立执行 `node --test --test-name-pattern="Claude runtime allows a long active turn but interrupts a silent native process" tests/claude-runtime.test.mjs`，各目标 1/1 PASS、独立采集退出码 0（18 另有 10 项名称排除）。用例耗时分别 4.981 / 4.463 / 4.413 秒；三轮 pre-flood 都为 87 字节。24 的真实 init 出现在 launch 后 828ms，仍在原总截止内，说明不能假设冷启动必定小于 400ms。最终测试 SHA256 `d55605d8dceae3ca1ebdb0a4f76d0a6ba6a7f634d578909df4e1cdc6c7e7cd21`。
- [ ] 独立 Tester：基于最终提交复核测试前置条件、原真实 idle/turn 限制和完整 CD。上述模块结果不代表全量/安装/生产验收通过；未就绪超过原总 6 秒仍须失败。

### CLAUDE-MONITOR-READY-01 · 分离真实子进程冷启动与监控语义（2026-10-06）

- 原 `aebc7e4` 唯一完整 CD 为 420 项中 419 PASS / 1 FAIL，约 882 秒结束、退出 1，并非整体超时。失败是 active 首分支而非 flood：starting 2ms / dispatch 150ms / running 197ms / interrupted 753ms，持久输出 0 字节、init=false、readiness=[]，首条夹具 JS 记录未执行。证据保留于 `temp/tester-aeb-acceptance-20261006.md`、`temp/tester-aeb-cd-node22-20261006.log`（SHA256 `be87ce29cb726813c37885d3dd1c52e31d858fa9a031fc2887253919441a05b5`）及系统临时目录 `cg-claude-idle-timeout-npAvyB`；此前模块通过不覆盖此次失败，也不证明操作系统或 CPU 是唯一原因。
- [x] Executor：提取原真实 child 监控为生产共用 `runClaudeTurn`，worker 仍在 spawn 后立即调用，不等待 IPC ready，不改变首输出前 idle、默认配置、first-reason、输出解析或恢复策略。spawn error 监听先于异步日志打开；顺序保持 stdin → running → child exit → 日志 flush/sync → outcome 和 Session 锁内持久化 → finally。只清理自身计时器、信号/流监听与日志资源，未引入新启动参数、warmup、替身 spawn 或额外依赖。
- [x] Executor：专门的时序用例使用同一真实 child 的 IPC ready 后调用同一个生产监控函数，隔离监控断言与冷启动前提；每分支仍从 spawn 前计原 6000ms 总截止、ready 后不重置，未就绪超期仍失败。active 保留 400ms idle、12×100ms 进度及实际进度跨度大于 400ms；silent 仍须 TIMEOUT；连续输出仍受 650ms turn 约束；flood 保留已批准的独立 6000ms 配置、1024 字节限额、持久 init 后同 child release、前缀严格小于 1024 及唯一 OUTPUT_LIMIT 期望。所有分支核对 initialized/解析结果；另正式用例验证 spawn ENOENT、未 ready 的真实进程仍受 400ms idle 和持久化回调先于清理。失败夹具保留并仅输出安全阶段/字节诊断；没有修改其他完整 deliver/restart/CI 用例。
- [x] Executor 集中模块：Windows Node 18.20.8 / 22.18.0 分别独立运行 `node --test tests/claude-runtime.test.mjs`，各 12/12、退出 0，耗时 24.160 / 22.028 秒。该时点测试 SHA256 为 `ab8db2b9c62f81743d29af7d9d7585797e66dd4a7f8ead8228c9ea4d59dacc8c`；Node 18 active 的真实 ready 在 705ms、monitor 在 716ms，随后 12 条持续进度正常完成，不能假定 native 冷启动必定小于 400ms。
- [x] Executor 最终收口：待上述两轮结束后，仅给新增 monitor 用例补充 passed 清理标志，失败保留目录；最终测试 SHA256 `39e3f2f9edb6d135c6c8fe32b5e63f6efcad9cb78b6d760b57ba5a915cd7329f`。Node 24.19.0 在最终源码完整模块 12/12、退出 0（24.087 秒）；18/22 各对受清理变更影响的 `Claude monitor catches spawn errors and retains idle limits before any native readiness` 定向 1/1、独立退出 0（18 另有 11 项名称排除），未重复全模块。三轮完整模块的生产 SHA256 均为 `faa79d32f3f3024ff15b6f89a172a9c198db9b3a13f22cbc7b20ba4ff24493e3`；治理（33 自动测试文件）、隐藏进程检查及 diff 检查通过。
- [ ] 独立 Tester：基于最终提交，在 Node 18/22/24 集中复核完整 Claude 模块，再按 Coordinator 安排运行唯一完整 CD；保留原限制与此前失败记录。这里是监控职责提取与测试前提隔离，不宣称修复了生产超时分类或完成安装、发布、真实 Cloud 验收。

### DEVICE-GRANT-PERSISTENT-CLIENT-01 · Cloud 设备申请持久等待兼容（2026-10-07）

- [x] Executor：start 通过 `X-Context-Guard-Device-Grant: persistent-v1` 协商，保留原四字段 JSON；仅 `persistent:true/status:pending/expiresAt:null/expiresIn:null` 解除等待期限，旧 Cloud 有限期限及 approved 有限领取窗口仍严格执行。每 HTTP 至多 15 秒、原轮询/有限重试不变，不新增后台任务、续期权限、Session 身份更改或 Hook 配置。
- [x] Executor：CLI 停止或 start 回复未知保留同一申请；过期旧缓存也先以原 secret 重新协商。未知 claim 不自动重试/重新 issue；确定终态保留原申请与安全失败记录，只有下一次显式连接才重新申请并再次人审。start 临时拒绝只有明确白名单终态 reason 才能结束申请，不能因通用限流 `FORBIDDEN` 换 secret；不解析任意错误文本。
- [x] Executor 正式回归：保留旧 finite deadline/并发/未知回执与公共 HTTP 入口用例，新增持久等待超过十分钟、停止调用后一天复用、start 回复丢失/旧缓存复用、12 组非法期限组合、approved 有限期、未知领取→确定终态→显式再次申请及临时 start 拒绝的同请求恢复。时间推进和调用停止为合成模块夹具，不冒充真实 CLI 进程取消或生产 Cloud。
- 初稿 Node 18.20.8 / 22.18.0 / 24.19.0 各完整 21/21、独立退出 0（18.165 / 12.447 / 11.034 秒）；初稿 runtime SHA256 `1614e762b1e7f719c838763c8c93fecba3ac6f1030f1589f9db659d62ef77091`、test `5c07cd48ee668a6c945d2ca89879c273508866558b776b365a7e62e9b1f3c08b`。随后 Review 发现 start 通用限流可能被错误归为终态，在所有测试进程结束后收窄 phase/reason 并补正式回归；不能把初稿三版结果拼为最终源码三版完整通过。
- [x] Executor 最终集中验证：Node 22.18.0 `node --test tests/browser-login.test.mjs` 为 22/22、退出 0（15.653 秒）；Node 18.20.8 / 24.19.0 分别以 `--test-name-pattern="temporary start rejection after a lost reply|uncertain claims retain their request"` 对同文件执行受影响两项，各 2/2、独立退出 0（2.157 / 2.213 秒，18 另有 20 项名称排除）。最终 runtime SHA256 `edfd169b3461e5a8ed52c096ac246907108afd569959dfc19179eb8bf6c1a686`、test `c5bac2808bd0eab91793f33c6d0a64d89ec854f4580e47d89cf6d0379fa28656`；治理、隐藏进程及 diff 检查通过，未跑整仓全量。
- [ ] 独立 Tester：最终源码与 Cloud 同一 wire 契约的公共入口联调，验证真实 CLI 取消/重启不丢 pending 或多发申请、Cloud 重启/旧记录迁移、工具 UI 人审、批准领取/过期/拒绝/未知领取保持权限与单次 issue；覆盖新旧服务和客户端限制。最终安装产物/Required/生产部署另行验收，本模块通过不代表上述链路完成。
- [x] 独立阶段验收（上述最终 runtime/test 哈希）：Node 22 完整正式模块 22/22，18/24 五个兼容目标各 5/5，分别独立退出 0；另一次隔离真实 Cloud HTTP 联调 7 项通过，覆盖真实 worker 内函数取消、Cloud 重启后同申请恢复、人类 Cookie/CSRF/项目边界、单次领取、拒绝后显式新审批、领取回复丢失和旧固定客户端兼容。两项目 Main/Session 摘要前后不变。跨仓脚本位于本机忽略的 temp，仅作独立证据，不是新增正式 CI 用例；没有公开 CLI 进程终止、安装版本或生产 Native 验收，因此上一项仍待收口。长等待来自合成时钟，不冒称长期生产观察。

### DEVICE-GRANT-PERSISTENT-RELEASE-01 · 0.6.5 分阶段发布验收（2026-10-07）

- 固定 Core/UI 1.1.3 来自 Cloud Main `5784e47d0b9c997b1652153be3cf502fee4e69ff` 的公开 `shared-v1.1.3` 制品，独立核验官方 URL、源文件字节与锁 SRI。Skill 只机械更新版本和这两项依赖；生成运行时 55 文件，不手改生成物或使用本地依赖回退。
- 唯一 Windows Node 22.18.0 完整 `npm run test:cd` **退出 1**：441/441 Node 用例、零跳过（883.596 秒），安全 39 项、治理、ci-smoke、101 文件打包契约及制品安全扫描通过；随后官方 0.6.4 基线 tar 下载触发原 20 秒超时，未进入安装升级。获批的 Node 24 原生代理基线补验也退出 1，保留两次失败；没有重跑 441 用例或扩大 900 秒/30 分钟总预算。
- [x] 必要阶段补验：Coordinator 在隔离服务器 Node 18.20.4 执行同源码原 `prepareBaseline`，保留真实官方 HTTP、20 秒/32 MiB/SRI 校验，取回官方 0.6.4 基线；独立 Tester 核实 SHA256 `70925c53f7fb4d31822c7cf28874760e5a58ac990313b1e7a005cfb6fca7ea1c` 及官方 SRI。随后仅在本地 Node 22 对原同一候选包执行正式 fresh/upgrade 入口，各保持 300 秒限制、实际退出 0；三客户端 payload、settings/context、第三方 Hooks 保留和安装后工作台检查通过。
- 同一候选 0.6.5 包 SHA256 `e889d628a13a417334439f7461adb579766691f88bbbe8451584949eb87d6312`，各阶段产品/测试/锁/生成物指纹未变，未重打包。完整报告 `temp/tester-skill065-split-final-acceptance-20261007.md`；原 CD 日志 SHA256 `0b3adbb0d2d8b3afba20dc13b89c2aa3d5fb5640a69314d36007a0a84b1e8bfe`、本地安装升级日志 `6c0e6aaf734d1036f8a567aec9988a630f6a6f4674c9ff01789b7ebd82261f31`。这是跨环境基线加同制品分阶段验收，不将原完整 CD 改记通过；本段仅在验收后追加，不影响 npm 内容。
- [ ] 精确 PR/Main/标签的 Required 与正式 npm CD、公开 exact/latest 包及摘要、个人安装和真实入口验收仍需完成。上述隔离安装不代表个人配置已升级、生产审批或 Native 链路已验收；失败证据保留，不触碰个人 Hooks 或运行中的工作台。

### DEVICE-GRANT-BROWSER-SCOPE-01 · 登录弹窗与静态预览回归（2026-10-07）

- PR #454 首轮 `37584180785`：Browser 在 `backend-password-ui` 失败、Required 因此失败；其他功能、包、最低版本、三系统安装与三客户端无对话检查通过。旧测试使用所有 dialog 中第一个 status，误选新增但未打开的设备申请弹窗，不是登录成功状态本身缺失。
- [x] Executor：仅给该正式登录测试限定当前打开的 dialog，先核唯一数量及“连接 Cloud”标题，输入、提交、状态、清空与取消均作用于该弹窗；原 10 秒等待、auth.open 消息和密码不持久化断言不变，不改产品或生成物。
- Executor 一次 Node 22.18.0 正式 `npm run test:browser` **退出 1**：修复的登录项通过，前 36 项通过；随后 `static-preview-clicks` 等待 root 节点 30 秒超时，第二 journal 入口未执行。报告的实际页面异常为读取未定义对象的 `interfaceCapabilities`；Core/UI 1.1.3 的 `installDeviceApprovals` 直接访问 `sync.config`，静态预览没有该配置。失败合成现场及浏览器结果保留，不能把本轮写为 Browser 通过，也不能在 Skill 手改生成物掩盖共享 UI 回归。
- [ ] Coordinator：修复 Cloud canonical 静态预览缺省配置并发布新的固定共享制品；之后更新 Skill 锁/生成物，交独立 Tester 复核正式 Browser 两入口及受影响发布验收。原 CI/本地失败保留，Required 未通过不得合并。
- [x] Cloud canonical 修复随正式 Core/UI 1.1.4 发布（Main `ce3b1a9b1bbce081e80141712ba44d110093fd57`），独立公开资产/source/SRI 核验通过；Skill 机械更新两固定 URL/锁并正式构建 55 文件，未手改生成物。新候选包 SHA256 `a9d4dd9faca1a8eab4315cc7f5907d4a2f76ab1fbebb2cc416da279c44b7be88`，101 文件精确契约、摘要复核和安全扫描通过。授权 runtime/test 仍为上述 `edfd169b`/`c5bac280` 指纹，旧 Node 模块证据仅对应未变源码，不冒充新版本全量通过。
- 新 1.1.4 输入上 Executor 一次 Node 22 正式 Browser **仍退出 1**：登录和静态预览修复均通过，共 51 项通过；随后 `workbench-browser.mjs:1367` 的设计 gallery 导航等待 load 30 秒超时，journal 入口未到。该报告无旧配置读取异常或其他页面 JS 错误；gallery 引用外部 Google Fonts 仅是静态线索，未据此确认超时根因。保留 `cg-browser-ci-7Kb8rH` 与自动浏览器报告，停止重复整轮，等待定向诊断及独立验收。
- 获批的唯一隔离 gallery 诊断在原 30 秒内加载成功（8.639 秒、50 条目、无页面异常），没有复现前次超时。实际本地 CSS/JS 约 1.25 秒完成，远端 Google CSS 约 3.82 秒、字体至 8.29 秒完成；不能据此声称已确定首次超时根因。随后仅在正式测试的 preview 页面进入非分发 gallery 前阻断明确的 Google Fonts CSS/字体源；不拦本地资源、不返回伪造 CSS、不改生产字体或超时。保留全部结构、颜色、尺寸、hover 和 CSS 字体声明断言；不宣称该用例验证远端字体加载或实际字形渲染。
- [x] Executor 最终一次 Node 22.18.0 `npm run test:browser` 两入口实际退出 0：工作台 55 checks、errors 为空，Journal recovery 通过。新 1.1.4 候选包及授权产品源码未变，没有重跑 441 项或完整本地 CD；前述所有失败仍保留。
- [ ] 独立 Tester：复核最终 Browser 两入口和同一 `a9d4dd9f` 候选包的原 fresh/upgrade 阶段，复用已验证的官方不可变 0.6.4 基线；随后精确 PR/Main/tag Required 和官方 npm CD 必须全部满足，仍未完成个人安装与真实入口交付。
- [x] 独立受影响验收：最终 browser SHA256 `40fde957ca9e3b62297e47da667ee607919c208743ddd7050fe9d127728d11f2`，Node 22 正式两入口实际退出 0，55 checks、errors 为空、body/cleanup/passed 均 true，Journal 通过；同一新 `a9d4dd9f` 制品的原 fresh/upgrade 阶段分别退出 0、各保留 300 秒限制，核对基线摘要/SRI、三客户端与个人设置/context/第三方 Hooks 保留。源码/锁/生成物/制品指纹前后相同，未重跑 441 用例、打包或基线下载。报告 `temp/tester-skill065-shared114-independent-acceptance-20261007.md`；Browser 日志 SHA256 `bc2d28d02305117c7732da179ebf7084f44a720caf70a040aa31e658e63f88cd`，安装升级日志 `0eab1bbd488e706e87bf85862877cb7164d765d8f8268c982451b82693a8daf2`。原失败记录不变；PR/Main/tag、官方 npm 和实际个人安装仍另行收口。

## CORE-OWNER-01：核心与 UI 归属 Skill

- 用户批准两仓库依赖反转；源码迁移及独立打包进行中。
- [x] 本地 `npm test`：467 个测试，465 通过、2 个既有跳过；39 项安全与 30 项安装边界通过。正式本地浏览器 55 checks、errors 为空，Journal recovery 通过。核心与 UI 的 24 个运行文件逐字节等于迁移前 Cloud main，未改业务实现。
- [x] 候选 core 2.0.2（40 文件）与 workbench 1.1.6（13 文件）精确清单、安全扫描通过。首次本地执行缺少扫描器及 README 缺少 Cloud 链接均保留；完成配置、补回链接后才重跑成功。企业全局 hooksPath 保留，未覆盖；暂存与待推送历史扫描单独执行通过。
- 首轮 PR CI `37752467517`：功能、最低运行时、浏览器、包检查通过；安装与客户端制品检查失败，上传目录混入 core/UI 两个包导致“Expected exactly one ... found 3”。已改为精确 Skill 包路径并加工作流断言，保留唯一包门禁，不放宽检查；最终 Required 待验证。
- 待验证：共享包白名单与安全扫描、Skill 独立安装/本地工作台、Cloud 固定包消费、双方 Required、安装后 doctor。
- 不迁移用户数据，不部署生产；原生 Hook 信任与实际触发仍须分别验收。
