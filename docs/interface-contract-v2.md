# 接口规范 v2（精简草案）

待审核，未实现。本版替代 draft-1 的消息分类；不改变现有运行API。本地-cloud、云端agent-cloud、agent-本地及上下行模块保留。

## 公共格式（只定义一次）

通信使用 UTF-8 JSON。拟定 HTTP 入口 POST /api/v2/messages；本地宿主适配器可用标准输入输出传同一JSON。不绑定模型harness。

```json
{"v":2,"id":"request-1","type":"sync.read","session":{"id":"session-1","generation":1},"payload":{"afterSeq":10,"limit":50}}
```

v、id、type、payload必填；auth.open/auth.close、项目心跳和session.bind省略session，其余Session操作必填。session={id:string,generation:正整数}只在这里定义，节点示例不重复。仓库和设备/调用身份绑定鉴权连接。session.bind由后端核验worktreeId与agentId并返回Session代次；不能靠猜到ID访问别人的Session。任务ID只放payload。id用于重试去重：相同ID同内容返回原回执，不同内容报ID_REUSED。

统一成功与失败（请求立即返回；通知不递归生成通知）：

```json
{"id":"request-1","ok":true,"data":{"version":"v11"}}
```

```json
{"id":"request-1","ok":false,"error":{"code":"CONFLICT","message":"版本已变化","retryable":false}}
```

成功表示本次操作持久完成，queued/received不表示整个任务完成。通知使用同一信封，payload明确业务结果；可靠投递通过sync.ack确认，不另建每类result接口。独立最终结果仍保留，例如merge.result。

字段未标可选即必填，不接受未声明null。ID为非空字符串，最长128字符；所有version及以Version结尾的字段统一为后端生成的不透明字符串，不能大小比较。仅创建对象/首次绑定的baseVersion或expectedBindingVersion允许空字符串；分页cursor也允许空字符串。generation是正整数，seq/offset/size是非负安全整数；v为数字2。普通消息最大256KiB，读取limit 1–100，超大对象传附件；text/summary/reason最多2000字符。未知type、非法字段、越权对象、旧代次拒绝。错误码：INVALID_ARGUMENT、UNAUTHORIZED、FORBIDDEN、NOT_FOUND、CONFLICT、ID_REUSED、CURSOR_EXPIRED、TOO_LARGE、UNAVAILABLE、STALE_SESSION；仅暂时不可用允许原ID重试。限额仍为待审核提案。

## 连接、安全及离线

Cloud仅HTTPS。auth.open按Git remote自动解析GitHub仓库数字ID，不让人填ID；仓库存在不等于有权限。密码只发鉴权入口、不进日志与消息队列；首版返回项目范围短期凭证，本地保存于私有配置，浏览器用HttpOnly/Secure Cookie并验证Origin。到期重新登录，auth.close立即撤销。Agent权限由服务端已有注册记录决定，不能提交role给自己升级；无人值守云端Agent预配置受限凭证，不使用人类批准身份。

每个项目一个本地后台，Session分队列；10秒心跳保证Cloud到本地补漏，本地变化立即上报。事件流 /api/v2/events 发送sync.event，payload={latestSeq:integer}，公共信封标明Session；只作提醒。断流仍靠心跳读取；sync.read内每条message也包含完整信封。按消息id去重，sync.ack只确认已有持久处理结果的连续序号，不能因收到通知就推进。重连不覆盖未确认本地编辑。

无云端模式复用同一任务、审核、对象和工作台格式，由本地后端承担存储与排队；不连接Cloud。不存在主Agent时plan留待审核，不能默认通过或偷偷启动模型。具体采用何种本地主Agent仍由后续产品决定。

## 工作台变更字段

changes最多100项：op=create/update/delete，id稳定不变。create/update带fields，delete只带id/kind。create拒绝已存在ID，update/delete拒绝缺失ID（重试用原回执去重）。只更新显式字段，其余保留；任一项失败整批不写。删除有子节点或仍被引用的对象报冲突，不默认递归删除。kind与fields如下（对象字段可分次update；create须满足对象完整性）：

| kind | fields |
|---|---|
| node | parentId?:string、title:string、purpose?:string、kind:module/work、state:dirty/untested/success/failed、order?:integer、proposal?:proposed/accepted/cancelled |
| todo | nodeId:string、title:string、status:pending/processing/done、description?:string |
| bug | nodeId:string、title:string、status:open/resolved、reproduction?:string |
| message | nodeId?:string、text:string |
| memory / idea | nodeId:string、text:string、refs?:{ref:string,version:string}[] |
| relation | from:string、to:string、label?:string |
| access | nodeId:string、agentId:string、allow:read/write/none |

?表示可选。关系端点必须存在；移动节点用parentId更新并拒绝成环。提案确认和access只能由有权限的人提交；Agent不能给自己授权。撤销权限立刻阻止新的受限读写。视图缩放、选中节点等个人UI偏好不是共享业务数据，不纳入此接口。这些是传输对象，不规定文件名或目录。

Cloud网页与本地网页使用相同workbench.read/patch格式；Cloud人类写入校验后加入对应Session下行队列，回传本地的同一变更ID不重复广播。版本由接收后端生成，调用方只提供baseVersion，不自造新版本。全量恢复分页固定快照，不混不同版本页面。

## task.report 的 data

- planReady：{planRef:string,planVersion:string,sourceSha:string}。
- progress：{seq:integer,summary:string}，同任务seq单调递增，重复不覆盖较新状态。
- interrupted：{reason:string,occurredAt:RFC3339}，脚本记录；失联不能伪造中断。
- handoff：{sourceSha:string,ciTodoRef:string,unitTestRefs:string[],experienceRefs:string[]}。

- cancelled/resumed：{controlId:string}；执行端确认停止或恢复，不能仅因取消请求已排队就释放执行方。
- closed：{controlId:string,closeReceiptId:string}；只有调度服务验证收口回执后才允许idle。

## 任务控制与引用

### 路由节点与查询 Main

task.assign增加nodeIds:string[]（必填、非空、去重、最多100个）和mainVersion:string（必填）。单节点也用数组，不另设nodeId。主Agent基于此Main版本路由；Cloud校验节点存在且执行方有读取权限，任务、需求版本、节点与Main版本逐跳原样交付。没有已发布Main或节点不存在则拒绝，不猜测映射。路由不授予额外权限，也不覆盖Session工作稿。

执行Agent → 本地后端 → Cloud复用workbench.read；主Agent也可直接向Cloud调用。payload字段：scope:main/session（必填）、nodeIds?:string[]、version?:string、cursor:string、limit:integer、recovery?:boolean。scope=main读取已发布Main，公共信封session仅标调用方。旧v2示例没写scope的原意是session，新请求必须明确。

返回scope、version、items、nextCursor。指定节点时返回节点及直接关联的记忆、Idea、Todo、Bug、留言和可见关系，不自动展开子树、不泄露邻接节点资料。指定节点不存在或无权访问则整次失败；省略nodeIds按授权范围分页。游标绑定scope、nodeIds、version和调用方，各页重新鉴权；中途改查询条件报INVALID_ARGUMENT。

首次省略version读取最新已发布版本，随后分页固定该版本；执行任务时必须传task.assign.mainVersion。指定历史版本不可用返回NOT_FOUND，不偷偷换最新。本地缓存仅在版本匹配且授权有效时可用，否则UNAVAILABLE。无云端模式读本地已确认Main基线，没有则NOT_FOUND。

scope=main禁止recovery=true，不返回Session队列。scope=session且recovery=true沿用完整恢复快照，不允许nodeIds过滤。workbench.patch仍只写当前Session，传scope=main返回FORBIDDEN；Main查询不授予Main写权限，合并仍走merge.request。

task.control的action与data：cancel={reason:string}；resume={reason:string}；complete={gitReceiptRef?:string,cloudReceiptRef?:string,archiveReceiptRef:string}。expectedVersion是最新任务版本令牌。哪些合并回执必填由任务创建时的模式决定，调用方不能临时省略来跳过门禁。取消后等待执行端停止并确认本轮记录已归档再释放；恢复已释放任务须重新排队取得执行权，不覆盖另一项busy任务。强杀未确认时保持待处理，不伪造执行结果。

review.result提交不带自造receiptId；后端鉴权、持久化后返回receiptId/version。后端转发已批准结果时携带同一receiptId，接收方用object.read校验其kind、ref、version、decision与签发主体，无法核验不执行。brief审核不需要requirementsRef等Plan专用字段。

object.put返回{ref,version}，可写plan/evidence/experience/ciTodo；brief.submit生成brief，ci.result返回{ref,version}供task.rework引用，review.result生成审核回执。object.read支持上述对象和reviewReceipt/ciResult。除任务内已固定版本的引用外，涉及批准、执行或合并的引用必须同时传对应Version字段；不用“最新版本”替代已批准版本。合并包可创建内容仍待白名单决定，不扩大通用object.put权限。

## 断线与冲突返回

CONFLICT附error.details={currentVersion:string}：保留草稿，读取当前状态，比对后用新请求ID和新baseVersion提交，不自动覆盖。STALE_SESSION附{currentGeneration:integer}：停止旧代次发送，重新核验绑定；不自动改到新代次继续执行旧任务。

CURSOR_EXPIRED附{recoveryRequired:true}：调用workbench.read，recovery=true、cursor为空。服务端创建固定快照并返回recovery={resumeAfterSeq:integer,pendingMessages:完整信封数组}；pendingMessages随快照分页，所有页使用同一屏障序号。该屏障之前的未处理任务必须包含，已确认结果不重复执行；屏障之后的消息从sync.read继续读取。整份快照与待处理消息持久保存后才能推进读取游标，不能直接推进执行ack。若回复过大继续分页，不丢弃消息。

执行任务的事件在任务关闭并确认前不得因日志过期丢弃；只有可从快照恢复的工作台变化可被压缩。恢复中仍有本地编辑则先比较保留，不用远端快照静默覆盖。恢复数据不完整返回UNAVAILABLE，不声称已同步。

任务被分配至必要Main合并和经验归档完成前一直busy，CI失败回原执行方。任务说明先由人确认不可变版本，执行Agent读代码写Plan，主Agent审核Plan，再开发。task.report仅报告阶段，不给调用方直接释放任务的权限。

## 附件和合并边界

附件元信息经blob.put注册，二进制PUT分块（建议每块1MiB，首版单文件最多64MiB）；服务端返回已持久连续offset，同一元信息注册重试可查询进度。GET采用Range、ETag，续传固定对象版本；不完整附件不可引用。上传和下载路径只能是当前鉴权Origin的相对路径；所有分块也验证项目与Session归属。限额为待审核提案，不提供任意远端下载代理。

GitHub代码走正常PR/CI，不增加自制源码同步。Cloud merge.request仅接收不可变内容包引用，不接收任意本机路径；合并用baseMainVersion与sessionVersion做比较，冲突不覆盖。具体经验、trace和可视化内容白名单尚未选定，是内容策略待决，不声称可实施完整合并。两个Main均按必要规则完成并确认归档后才允许收口；不自动清空本地Session。

## 收敛结果

### 本项目自身的迭代与 Cloud 更新

- 正常顺序：GitHub CI 通过、代码合入 GitHub Main，再合入 Cloud Main 的地图和经验。CI 通过不等于代码已合并。
- 内容基线与服务运行版本分开：代码以 GitHub Main SHA 为准，Cloud Main 内容记录对应 SHA；Cloud 上运行的 Context Guard 程序及其支持的协议可以暂时落后，定期升级，不要求每次合并立即部署。
- Cloud 程序较旧不自动等于数据同步失败；是否可同步要看本次消息是否兼容。客户端不得把旧服务的响应当作支持新协议的证据。
- 旧 Cloud 不支持本次接口或必需字段时，明确返回“不支持当前协议，需要升级”，保留本地待同步内容；不能静默丢字段、假装保存成功，也不能未经确认修改服务器配置或升级部署。
- GitHub Main 已前进而 Cloud Main 内容尚未合入时，显示内容基线待更新；这与 Cloud 服务程序待升级是两种不同状态。

普通回执归入统一result；相同任务交付、Plan审核在不同跳转间复用。本轮只新增session.bind、task.control、sync.event三种消息，共25种；其余缺口补在原接口字段与校验规则内。合并包内容白名单仍是明确待决项，不冒充已闭环的可执行接口。

节点只展示一句用途、type+payload、返回；公共格式不逐节点重复。旧节点标为已替代并保留历史，不移除用户Todo/Bug。本轮只制定规范，未开发接口、未修改服务器运行代码。
