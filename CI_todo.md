# CI 待验证

仅记录已实现模块的测试缺口。[ ] 为未完成；验收通过立即删条目，准确版本、入口和结果留 Git/PR。失败、跳过或证据不足不删除，源码/替身测试不代替准确安装、真实客户端和人工验收。

以下是待验清单，不表示重新验证。原记录与首次失败索引见 [整理前记录](https://github.com/Michel-Johnson/Context-Guard-Skill/blob/eccac10f40aa97d6f135f7d0958927c06c7e08b1/CI_todo.md)，本地失败现场保留。公共边界以 RULE 和专项契约为准，不在每项重复。

## Map 与文件读取

### CONTEXT-NAV-REFRESH-01 · 显式导航刷新

- [ ] 合并后安装入口：真实 Cloud 的 map read --context --refresh 取得新导航/说明，保留开工基线与旧正文、未确认变化；断网或错版本/根/Session 不替换缓存，不动其他项目或恢复派发。
- [ ] Windows NTFS ACL：验证其他账户读取隔离；POSIX 0600 不证明 Windows ACL，目录可读写也不等于隐私通过。

### MAP-WORKBENCH-BETA-01 · 新版 Map

- [ ] 最新安装及 Cloud 同一固定 UI 包：Beta 开关、关系、键盘、稳定面板收起和深链恢复。
- [ ] 真实客户端中文输入法、移动触控，非合成浏览器操作。

### FILESYSTEM-READ-01 · 读取边界

- [ ] 已启用 fs-v2.1 项目：导航→index.md→记忆/Bug/TODO/attempt，验证过期、未判定轮次、未启用拒绝，格式不变。
- [ ] 默认阅读不含 legacy-records/runtime-state/旧 JSON 索引，普通 Agent 隔离 Idea；旧完整快照不是新版隔离证据。

### BROWSER-CLICK-FRAME-12 · 旧浏览器副本保护

- [ ] persist() 和恢复导出不覆盖旧浏览器副本；共用存储键风险不能只凭草稿断言关闭。

## Coordinator

### COORDINATOR-BADCASE-20261010 · 短回复、挂载与选项

- [ ] 冻结 Map/Chrome Slack，各新需求、旧事项、普通追问三段十轮：短段、整轮单问题、唯一主节点确认、旧按钮失效及 ✅ 送达。
- [ ] 人工核可读性、事实与挂载；有意义正文目标 2 秒，非表情/进度。正式入口 tests/coordinator-reply.test.mjs、tests/workbench-browser.mjs。

### COORDINATOR-DIALOGUE-01 · 真实讨论

- [ ] 真实模型/工作台/Bug 5–10 轮，核模块/Bug/attempt 引用及有意义正文 ≤2 秒；旧样本未达标。
- [ ] 同任务与 Cursor Projects 对照：可直接执行任务耗时、修订、等待；无对照/人验不宣称更快。
- [ ] 真实工具节点推荐/完整路径，唯一主节点人确认、按需展开，不复制全 Map。

### COORDINATOR-PLAIN-REPLY-01 · 回复与摘要

- [ ] TODO 完整清单不丢事项，共同状态只说一次、短名清楚；去测试标签，保留业务日期/版本及索要的技术原值，不截断求短。
- [ ] 真实长对话压缩后保留作者、引用和未决事项；工具/重试后不重复答复，静态提示词不关闭旧作者误判。

### MANUAL-BRIEF-01 · 人确认后的交接

- [ ] 模型 brief→人审→正确 Main 事项/执行提示→已登录 Claude/Cursor 完成；重复不重写、过期拒绝，manual 不建执行 Session/派发。

## 客户端与上下文

### CURSOR-WORKBENCH-01 · 安装后的 Cursor

各项须从准确安装制品验证原 owning 后端/真实任务及三条连接路径。合成批准、Docker、ACP，源码隔离实验及分开的 HTTP/IPC 测试不代替完整业务验收；未知制品/缺宿主证明硬停，公开模型结果拒绝保留。

- [ ] 新 profile：固定支持制品、canonical Node/index.js、完整分发与漂移撤权；版本自报/旧 JSON 不激活，不重签 SEA、不改用户命令；另验其他 UID 制品拒绝。
- [ ] 格式 3 官方 guard：四工具放行，内置/Task/同名外来 MCP 拒绝；缺失、篡改、崩溃、超时、无输出/非法输出 fail-closed，核真实调用及无越界，不外推厂商旁路、OS/Windows ACL、Cloud VM。
- [ ] hookWorkspaceRoot 与 native cwd、逻辑源码根分离；存储槽不授权文件/Task，不从旧记录学习新根，核元数据误拒和可执行配置漂移。
- [ ] held CI：管理员 Runner、完整 Plan.paths、同一 HostProof 和一次原 Discovery 激活；核 daemon/镜像/Task/Coordinator 归属，未知激活/停止保留 active/ownership，不重跑模型。
- [ ] Runtime 单次关闭：独立停止全部自有资源，晚 ACK/ledger 保存前不释放；核停止失败、到期/撤权/预先 abort、远端 Task 撤权且无本地 abort 时零 prompt；未确认不报停止成功。
- [ ] Discovery 完整 HostProof 回调/无回调只读：原编号失 ACK、单次执行、撤权/最初期限；激活不延长授权并等待私有结果。
- [ ] 格式 3 默认配置：native ID/MCP/默认模型/最初期限不变，默认补齐不重新学习信任，隐私降级和未知配置拒绝，格式 2 不升级。
- [ ] owning 后端→Cloud Task 范围校验：固定设备/缓存重验、批准版本、重绑及失 ACK，不以拆开的 HTTP/IPC 用例代替组合。
- [ ] 私有 profile/MCP/Runner/宿主证据发布器：真实原生工具范围、实际观察不可覆盖、终态回执及独立 Tester。
- [ ] sender/Cloud 同事务 proof：版本/内容/范围摘要及双 ACK，固定制品、worker commit、未知回执恢复与实际观察；生产调用未接通，不把模块接线记为生产通过。
- [ ] owning Node IPC：宿主专用 commit、mandatory proof 传输、终态上下文，实际 HostProof producer 与 profile/MCP/Runner→Cloud 事务组合。
- [ ] hostContext：原 Plan/不可变批准/TODO、固定连接/版本和读取漂移拒绝；完整 Plan.paths 快照，preparation-only 不等于当前 Task 授权。
- [ ] 发布共享包及 Cloud 固定消费：planSourceSha 持久化、返工/重放，sourceSha 为最终源码，旧记录不猜基线，不产生批准或权限。
- [ ] 最新安装恢复原会话：CLI/Claude Hook 不覆盖 Cursor 身份，读写无 403；doctor 不崩溃与绑定就绪分别验。
- [ ] 空会话失连接明确失败；既有会话重载，同原生会话完成任务/继续追问/回显，不用模拟 ACP 代替。
- [ ] 已实现 Cloud→配对本地 Cursor：权限、原会话连续通讯和任务结果；未实现 Cloud REST 不计测试项。

### LOCAL-RECORDS-01 · 原生 Hook 与本地记录

- [ ] 已登录 Claude/Cursor 经信任 Hook 触发启动、工具、压缩、结束/归档，本地 Markdown/事件全程不上传。
- [ ] 安装 doctor、Hook 信任、实际上下文送达和浏览器启动失败反馈分别验；Codex Hook 不在当前范围。

### EXECUTOR-CONTEXT-01 · 按需读取与收工检查

- [ ] 无 Cloud 安装入口：轻量导航/节点、缓存复用、最新本地检查，只显示变化名称/类型。
- [ ] 真实授权 Cloud：导航/按需/挂载、已读/关联/全局变化、差异确认；断连“无法检查”，缓存非最新。
- [ ] 旧能力识别、安全升级、未确认基线拒绝；旧记录队列暂停原样保留，不删数据/重建空项目/隐式迁移求通过。

Cloud 绑定失效先恢复有效绑定再验功能；绑定失败不等于这些功能通过或失败。

## 测试基础设施与安装

### GATE-05 · Windows 长链路

- [ ] 当前源码 Windows 完整 CD/浏览器 Hook，保留总时限/断言；原 900 秒及 20 秒 bootstrap 超时不能由局部通过关闭。
- [ ] Claude 冷启动、持续输出、静默、限额：区分未就绪/运行期限，不将前提修正记作生产超时修复。

### WORKBENCH-LIFECYCLE-02 · 未归因的启动与读取失败

- [ ] 原现场 SessionStart verified=false、空图缺 User 信号；定向通过未复现，根因未确认。
- [ ] 附件读取/All Sessions 基线的 fetch failed：核端口、阶段、原异常，改测试端口不证明旧根因已修。

### BROWSER-CLEANUP-13 · 清理与退出结果

- [ ] 正文和清理均成功才通过，EBUSY 重试耗尽失败；原 55 项正文通过但清理退出 1 保留。
- [ ] 三系统安装产物的停止、状态/锁释放、自有进程无残留；Windows 暂时 EPERM 与持续拒绝分开，不删未知锁。

### PROJECT-COMMIT-READ-10 · 性能与跨平台

- [ ] Git/HEAD/Main 合并读取、无变化不写盘、runner 调度的独立功能/耗时，保留身份新鲜度、并发、错误回退和完整测试发现。
- [ ] 三系统真实浏览器/受管网络的 .localhost，长期 CPU/内存/I/O，不以一次短测推断稳定。

### SPLIT-INSTALL-01 · 共享包与安装入口

- [ ] 文档整理产物：core 根机器契约、Cloud 兼容资料标识、角色/README/安装链接；正式产品断言保留，完整 CI/安装回归待验。
- [ ] roles/ 新装/升级：旧绝对提示词兼容且不改用户配置，共享 core、Claude 读取及正式回归。
- [ ] 干净检出 Skill 独立构建、Cloud 固定消费：锁文件/精确清单/字节/许可，下载失败或篡改拒绝，不借相邻源码。
- [ ] 三系统新版新装/升级：读写/刷新、权限拒绝、版本一致，保留 Map/队列/设置/第三方 Hook，不重启已关闭 Hook。

## 清单之外的事项

未实现需求交 Coordinator；GATE-01/02 及静态检查/恢复缺口见 [CI 标准](development-docs/ci.md#明确待实现)。暂缓范围见 [当前方向](development-docs/current-focus.md)，移出不等于验收通过。

Cloud/Slack 旧 Home/按钮、附件、跨端/项目预览、身份摘要、标题、不接话等专项见 [Cloud 台账](https://github.com/Michel-Johnson/Context-Guard-Cloud/blob/main/CI_todo.md)，未经新版验证不宣称通过。PR/发布/部署/清理按 [RULE](RULE.md)，不另记 CI 待办。
