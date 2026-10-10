# Cursor 工作台接入设计

版本0.2.0。用户已批准 Cursor Executor/Tester 接入；下述接线不等于角色闭环、部署或真实验收，缺口见 CI_todo。

## 目标与边界

三路验收：本地工作台→本地 CLI，Cloud→配对本地 CLI，Cloud→Cursor Cloud Agent。人仅 Coordinator 沟通，不另聊天/业务状态机/harness；默认无独立 Cursor 按钮或启动聊天面板，旧组件/API/会话数据兼容保留。

复用原任务、Plan、人审、handoff/CI。通用自动派发暂缓，本批准不扩队列/自动恢复/问题卡/归档自动化。共享 UI/协议/本地适配归 Skill，Cloud REST/凭据/路由归 Cloud，不改生成副本。

## 角色闭环

Coordinator 交已批需求，Executor 交 Plan、等指定审核再开发/验证/交准确 sourceSha。Tester 逻辑/原生Session/worktree均不同，Cloud 用新 Agent、固定交接提交，自测/同Agent追问非独立。

Tester仅授权引用、声明测试、自身证据/原任务结果，无业务写、需求/Plan审批或Main权。失败/问题回原任务，不从 end_turn/FINISHED/自然语言造批准/通过/关闭；缺Plan/交接/测试不报完成。原生账本仅厂商通讯，业务由协议决定。

## 本地适配

官方 agent acp、stdio JSON-RPC2：initialize→认证→load既有/new明确创建→prompt，update输出、cancel本轮。Cursor 管模型/工具/历史，工作台保逻辑UUID与原生ID映射：原生连接用native，任务投递/角色用logical。

非空 CURSOR_API_KEY/CURSOR_AUTH_TOKEN 预认证时不重复浏览器 authenticate(cursor_login)，无凭据保留登录；不自证key有效/回退建会话。显式私有凭据仅CLI子进程 AGENT_CLI_CREDENTIAL_STORE=memory，无显式则保厂商方式，不接受父任意store，不复制/持久厂商token（只核2026.10.01，不外推旧版）。

空new首次真实任务前可能不可重载，保原连接、不发初始化模型消息/改数据库；后端退出丢空连接明确失败不替建。既有默认同名load，native不同须操作者配置，不猜URL/generation_id。Hook/CLI经持久映射核树，导入Claude Hook不改变宿主，正文/环境/role不授身份；多映射/根错/创建未知保回执拒绝。

本机操作者显式模板可沿原工厂建独立树，非开发批准。CursorRuntime复用ProtocolDelivery编号，保存native/树/指纹/状态/结果，同ID异内容拒、接收未知不重投模型。

配置仅本机管理，拒浏览器Origin/他角色Token/非Cursor绑定；command绝对路径，秘密私有文件/厂商登录。CLI/页面 native.prompt 共原权限/编号，旧成功重放前也核任务，未知请求保同ID/内容到匹配回应，不影响他Session。

默认拒工具。Executor仅 permissionPolicy:allow-once 且 permissionsApproved:true 后选择官方allow_once。Tester不继承，含旧磁盘宽权；ACP描述不能证明argv/cwd/路径，不从标题猜，拒宿主授权不是OS沙箱。

CI读取仅派发固定references版本及自身evidence，不因同Executor得其他任务权限；Cloud原任务事务另验。

### 本地独立 Tester 的受限工具

用户已批四工具窄MCP；ACP唯一模型循环、原任务唯一业务权威。完整Agent凭据留后端，首次held用内存callback，后续自有Node用私有IPC：固定context、受限exchange、host commit，无URL/凭据/任意方法/自报身份。父ChildProcess PID固定归属，模型无IPC。

能力固定投递指纹、逻辑/native身份、树、Task/source/ref版本、owningPID、Tester绑定版本/epoch及初始期限；每await后/返回前重核，重绑/关闭/到期/晚回复永久撤权。重复/越界/过大/并发超限IPC闭通道，不续期/重签/重投。

仅新建固定支持身份held profile可执行。缺native、管理员策略、同HostProof或原transport报 CI_NATIVE_ISOLATION_REQUIRED 等，不调模型、不冷load/替空ID；Executor不加此门禁。

### CI 原生配置准备（创建阶段）

创建前固定预留logical、独占意图，首次响应保存native；配置失败/未知保意图不重建/覆盖。logical root批准Tester树，native cwd为Git外私有空目录，源码只读准确SHA快照，不将工作树/快照作配置发现root。

独立HOME/config/data/temp，显式Windows/XDG路径，只明示provider变量、凭据内存；不传Core凭据、用户Hook/任意MCP或父秘密。仅四CI工具及宿主能力，官方mcp enable后核endpoint/header/全部server，多余拒绝。allowlist/Read/Shell/Write/WebFetch拒绝不是OS或Task隔离证明。

初始30分钟不续。私有文件、目录、MCP准确字节/宿主策略每次核，权限/链接/漂移/到期永久无效，不修复/重学；Windows ACL及实际工具边界未验。

支持身份不是version自报：宿主私有闭包有界流式核完整分发清单/内容、canonical父、inode/owner/权限/链接及读取漂移。仅已验证官方2026.10.01-e373342 darwin-arm64固定完整摘要可激活，其余只准备。未签SEA被系统终止，不重签改厂商；version/MCP/ACP用同包canonical Node+绝对index.js，禁编译缓存/PATH替身/launcher环境，前后重核，alias/helper/chunk/node_modules或文件目录变永久撤权。

version探测无provider，在独立version-home重定配置（厂商会初始化默认）；不删探测/以默认覆盖独占策略。拒非sticky他人可写父、非当前用户/root所有者；非同UID防御/OS attestation。完整stat清单只原闭包，record/immutable manifest存版本、准确入口/摘要，旧JSON/合成不能恢复，verifyNative复用原profile/期限，verify也核漂移。

新格式3保创建时全配置审计及宿主固定策略，不因厂商new/隐私缓存改全文而重学；格式2/旧profile不升级重建。CI仅未指定/default/auto→default，其他模型意图前拒；不传--model default，Executor仍显式模型。

核权限/allowlist及已知默认展示/交互/空参数，可补默认，不许新可执行statusLine、模型/子模型、搜索自动批准或网络覆盖。隐私缓存缺省ghost=true，或严格ghost=true/合法枚举/有界时间，不伪造/降隐私/改能力期限。

POSIX CI进程启动内umask077，固定shell只mask+exec绝对命令、argv单传，保PID/stdio/信号；不改父mask或事后chmod漂移，Executor/Windows不外推。HOME新增已知Hook/规则/commands/agents/plugins/第三方Skill根拒绝，保文件非动态加载防护。

只在新CI私有HOME装官方工具拦截，不替既有/普通Executor Hook。preToolUse/subagentStart/beforeMCPExecution均failClosed:true、有界全匹配无循环豁免。固定绝对Node先核复制guard摘要再执行核过字节；immutable manifest固定record不可变投影/位置/endpoint/期限，仅nativeID一次绑定，Hook/manifest不随绑定改。

guard核NOFOLLOW/单链接/私有权限/有界UTF8 JSON/canonical父及同FD/inode前后变化；每Hook核原nativeID/nativecwd/唯一workspace，缺失/子agent/漂移/到期拒绝，不信新增verified、不回显输入/定位/秘密，放行前再核期限（Hook5秒不延期）。

官方ACP preToolUse四MCP可能无cwd，仅准确四工具可缺，出现须匹配；其他身份/workspace仍强制。hookWorkspaceRoot由已核cursor-config.Xq/workspace-paths.r_规则：私有DATA/projects中，nativecwd非ASCII字母数字变连字符、折叠裁边；原manifest固定，不学观测/旧记录。它仅Hook存储槽，nativecwd/逻辑源码权分开。预建私有canonical槽，transcript/store允许，可执行配置根新增撤权不修。

preToolUse仅四MCP:context_guard_*，其他Read/Grep/List/ReadLints/Glob/Shell/Write/Task拒；beforeMCPExecution再核tool、context-guard-ci、原URL双字段，缺失/stdio command拒；subagentStart全拒。guard非激活权、同UID/OS/CloudVM证明，真实旁路及工具边界仍待验。

关闭覆盖异步准备/连接/登记，每await重查，规范目录后同步核关闭，准备/登记间不await；晚native仍保存不ready，死空transport重启未知、不new。ready核held error/close、真实进程终态、活profile，缓存不证明在线，等登记锁/持久化关闭不回成功。

首创建/Discovery/held准备及支持制品一次激活已接线，后续同profile load/轮换未实现，不升级旧空native。元数据实验仅四工具发现/不读原项目MCP/用户配置不变，非CI闭环。

CI关闭先恢复自有进程ref，断IPC并等真实退出；退出Promise不保活，晚spawn不取消保活，不替worker。Runtime单次关闭、对象去重，单项失败继续停其他，错误安全分类不含stderr/cause；仅确认对象移除，晚/失败归属保留，不盲重试。

准备失败须原Discovery关闭+failed原子保存后，私有WeakSet标最终新错误；JSON/code/模型不可伪造，关闭/保存失败新错误不标。标记仅收拢，Runner仍核CID停止。

公开Cursor ci.result 在原宿主证明/事务未接通前拒，header/模型verified不授信；ci:`<Tester>`:host:宿主保留，Claude不变。Discovery仅同四工具元数据，无Task/测试/证据。取得原native/投递/owningPID后一次激活，失败/未知/关闭/到期烧毁，原任务/身份/期限不变，晚激活撤权。

激活runTest/verifyResult/submitVerifiedResult须同HostProof三自有函数；缺/继承/undefined/额外配置拒并烧毁，类型非真实性证明。无回调仅固定context/源码/object.read，测试/写/结果 CI_HOST_PROOF_REQUIRED，不回退exchange；终态失ACK原ID/wire/期望，不重激活/模型。

#### 源码、Runner 与宿主证明

四工具仅context/批准源码/固定testId/原CI回报，模型不选argv/树/env/镜像/身份。准确交接SHA、原Plan.content.paths整份安全清单导快照，不挂活树、不导未跟踪/Git/私有目录，链接/子模块/特殊文件拒。

管理员ciRunnerPolicyFile在Git/linked/commonGit外canonical私有单链接NOFOLLOW有界JSON，宿主算摘要，外JSON不供ciRunnerPolicySha256；每次同FD核原身份/权限/摘要，不重学。Executor/网页/模型不配置。

明确可信本地Dockerdaemon、固定完整镜像ID、不pull；源码只读、scratch独写、rootfs只读、non-root、network none、drop capabilities/no-new-privileges，不挂HOME/秘密/socket/别树，无批准环境拒、不回退宿主shell。基座daemon/镜像/内核可信，非模型harness，Linux不代macOS/Windows验收。

短能力固定Tester/Task/代/SHA/ref/命令策略，每调用/旧回执/提交重查；撤权/变版本中止测试，未知只查原容器。原/api/v2/execution取native/delivery/owningPID，ref版本字符串；普通/api/v2/ci固定读核权，ci.result原事务鉴权，接受终态不再旧testing后验，其余仍testing。

宿主实际退出/完整输出保容器不可写处，daemon日志关闭，start --attach有界全输出，超限非证明。挂起每秒核权，到期主动停信号；取消/超时/撤权先持久停止意图、核原CID/实际配置并确认终态，只停Docker CLI不算停止，不清外容器。

每投递最多20次执行，同编号复用观察，未知启动只检查/停原CID，无完整输出不通过。关闭从私有ledger恢复自有CID/标签/任务/SHA/策略/指纹，停止不依赖已撤权/源码镜像可读但核daemon归属；排除旧PID仅清理，不重放执行。外来/未知保现场，不报成功。

HostProof仅自有Runner+私有Core commit，不信模型观察/路径/verified。hostContext空参数取原Plan/不可变批准/TODO，固定设备/云端地址/登录摘要，await后重核；完整Plan.paths不改测试子集，planSourceSha基线与sourceSha最终分开。preparation-only摘要非Cloud当前Task/批准/原生身份。

固定X-Context-Guard-CI-Task收窄原Task/Plan版本基线/批准回执/交接SHA/TODO/绑定，非凭据/隔离/新权限，模型/公开IPC不能提供。原Core授权才Task-Authorized准确摘要，旧服务忽略/缺错ACK为未知，不新编号/改wire；写未知保原请求。

原事务把范围/CI和Executor绑定版/回执同效果保存；旧编号不省/换/升级范围，普通无scope原契约。私有重放经云端原ID/wire/scope，确定拒不重投；ci.result终态仅原awaiting-merge/ci-failed接受事实，不借返工/新阶段沿用。

通过观察仅固定Node --test --test-reporter=tap批准文件，完整非零且计数一致，无失败/取消/skip/TODO；非零退出失败，不完整不升级。实际观察非CI verdict/人验/关闭，测试覆盖和批准来源另核。

先稳定编号host evidence取得Core引用/版本，再给模型；模型ci.result原编号/载荷/结论不改，intent/terminal先持久，失ACK仅原重放。私有submitVerifiedResult不加公开工具，不绕拒绝。

expectedEvidence核引用/准确版本/内容，在原Core同事务authorize核 latest，非提交前回读；本机assertCursorCiHostEvidence、Cloud authorizeCursorCiHostEvidence，不反向导本地。X-Context-Guard-CI-Evidence仅带原Task期望ci.result，本Tester host namespace核Task/最终SHA；failed reproductionRef仅该evidenceRef，其他状态无额外ref。

事务同存evidenceHash/Task/结果，旧ID不能省/换/升级proof，终态仍核latest；Task/Evidence-Authorized两个准确摘要同时ACK。每header编码≤8192、合计≤12288字节。缺错/旧服务忽略为未知，不改模型消息/正文/ID，header非执行/隔离真实性。

私有commit仅本Tester当前Task/source/session host evidence或mandatory expectedEvidence原ci.result；exchange拒。缺准备/callback不开放结果context，context({ciResult:true})仅免旧testing读，仍身份/PID/指纹/绑定/期限，不授写。

DeviceConnection发前存完整指纹/固定scope/proof，实际传输/缓存重验读同记录，缺/坏/链接/换proof/旧wire补造拒；send前放记录锁。结果事务后只核本地身份，晚撤权仍烧能力，未确认非远端无效果。保存终态仅历史接受，先核当前身份/固定快照，不证明后来latest或新写权；失ACK无本地确认仍原事务。

owning held turn已组完整快照、策略、同HostProof/commit；准备只查daemon/镜像、存Task/Plan/TODO/PID/策略/摘要，不激活/模型/容器/业务证据。异步后再核profile/Task/策略/transport，冷worker/旧JSON/缺闭包或未知制品硬停，无策略亦硬停，stop未知保active/unknown。

支持worker先持久激活意图再同Discovery一次prompt；每阶段核权/信号，running/PID后紧邻prompt核原scopedTask、初始context，最后同步核stop/期限，不续期。到期/撤权断私有能力/取消native和Runner，清理Promise在abort前固定、一次调用，失败不阻其他。先停再等已进入proof/ACK/ledger，只有Core回执+proof保存+停止确认才finished/释放active；finished仅投递收拢，verdict仍passed/failed/incomplete。

激活后未知结果/失ACK/保存或停止失败保job/active/ownership，不重模型/会话/激活，关闭不重复失败资源。正式HTTP/Runtime/Discovery/Runner/Core回归含合成ACP/Docker/批准；隔离官方CLI/实际Docker实验也非原Coordinator/设备/Cloud/安装/三路业务验收。同profile轮换和真实批准读取仍待验。

厂商Plan/问题不静默批准，无桥接明确取消；既有Hook不替，只停自有进程，不删用户文件，stderr/API及私有输出不公开。received仅收投递、end_turn仅原生轮次结束。

## Cloud 适配

官方REST v1建Agent/Run、同Agent续Run、读状态/结果，不假定Webhook。nativeAgent/Run/逻辑Session分存，配对本地复原设备投递，网页不直接启动进程。

私有密钥留Cloud，请求前定角色/仓库范围，CloudAgent不共享本机配置/直推main；MCP权限非厂商shell/文件沙箱，准确源码/真实性各验。

### 受限角色通讯

短期不透明凭据固定项目、Session代/nativeAgent/Task/阶段/提交，不注册/派发/批准/Main。创建前存待激活，MCP可发现，确认Agent/Run才业务激活，未知不替建。只固定context/exchange，Actor/Task tuple哈希隔离命名空间。

消息原事务、旧回执前核角色/绑定/阶段/Plan版本，过期/撤权不恢复。Executor/Tester提案核可信原Agent/Run、提交/不可变证据，变证据失效，独立Tester账本不同Agent/身份/树，不信模型提供。

Streamable HTTP JSON子集，无SSE/主动请求，不宣称OAuth/全SDK；内联MCP headers委托。工厂复原Coordinator：模板逻辑预留，人审派单后启动Plan；Tester预留后原ci.request。native回调核模板/人审/绑定/Main权，初始化不在锁内等，Cursor失败不阻Claude。

取消先存意图、仅自有Agent/Run核终态，未知查询不重POST/替建。工厂/公开接口及Git交接源码已接线，原生/独立测试/部署/三路验收未完成。

### 原任务源码交接

原MCP handoff提案proof-pending仅持久提案非awaiting-ci，结束Run供后台读取Git。固定ID/Task版/Plan/native/证据，一份同调用提案，重试同结果不替/发模型。

核Plan.content.paths、Run仓库/分支、准确提交/批准基线及每次提交路径，不以净diff遮中途越界。锁外读Git，前后native核，存证明前再权限/Plan/证据，漂移/网络失败未完成。

通过复原ID/内容经原事务awaiting-ci，接收标记/回执原子，失回/并发只读标记不重模型。githubTokenFile仅云私有，只固定GitHub只读，不交Cursor/浏览器/日志。Git证明非自测通过，实际输出/独立Tester/可信workflow各验。

### 原任务独立 CI 回报

ciPolicy.checks私有固定原TODO/testId/argv、Actions名称/App ID/workflow blob SHA/step，非模型或任意计数映射。创建Tester前核TODO覆盖/版本、准确交接分支push检查，非PR合并检出/他分支；缺证据观察workflow不替模型，运行中策略变拒。

check suite/run/重跑次数/job/step同来源，可信workflow blob一致，所有匹配含失败，不只找绿。设计要求Cursor源码push可信完整CI/准确github.sha，其他仓库也须同等workflow；以实际配置验，不靠名称证明。

Tester取固定命令/nonce/TODO映射，实际一次、自身证据；ci.result proof-pending后结束Run，后台核完整工具观察及可信检查。native输出非VM不可变源码证明，前后Git不排除临时改动/环境，单独不足通过。

两组事实符提案、原授权/Task/TODO/证据未变才原事务结果，标记原子，失回不重模型。CI非人验/合并/关闭。

```json
{
  "ciPolicy": {
    "checks": [{
      "todoId": "CI-1",
      "testId": "formal-tests",
      "argv": ["node", "--test", "--test-reporter=tap", "tests/example.test.mjs"],
      "name": "CI 1 | 功能测试",
      "appId": 15368,
      "workflowPath": ".github/workflows/ci.yml",
      "workflowBlobSha": "<审核过的工作流 Git blob SHA，40 位小写十六进制>",
      "testStep": "CI | 运行功能测试"
    }]
  }
}
```

私有Cloud项目roles内，操作者替换/审核占位；githubTokenFile不入MCP/公开错误。策略/workflow变显式处理，不静默改信任。

## 分阶段与验收

环境/最新main/分支/绑定→本地ACP→Cloud REST→Coordinator派单/Plan/独立CI/结果→三路真实小任务→正常Review/PR/安装或部署及人验。

每路核正确连接、角色双向通讯、实际产物/独立测试，细节非新增门槛。历史独立聊天只传输证据，旧数据保留；替身/HTTP/真实分别记录，无账号/密钥/生产权保持未完成，不用Mock替代。

## 官方依据

- [Cursor ACP](https://cursor.com/docs/cli/acp)
- [Cursor Hook 来源](https://cursor.com/docs/hooks)
- [Cursor Cloud API](https://cursor.com/docs/cloud-agent/api/endpoints)
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [GitHub workflow run 事实](https://docs.github.com/en/rest/actions/workflow-runs)
- [GitHub workflow job 与步骤事实](https://docs.github.com/en/rest/actions/workflow-jobs)
