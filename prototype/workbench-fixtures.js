(function(global){
function inferOwnPath(title){
  const t = String(title||"").trim();
  const m = t.match(/((?:src|apps|packages|scripts|prototype|extensions|skills|\.codex|ui)\/[^\s，。；、]+)/);
  if(!m) return "";
  let p = m[1].replace(/[.,;:]+$/,"");
  if(!/\.[A-Za-z0-9]+$/.test(p) && !p.endsWith("/")) p += "/";
  return p;
}
function U(id, title, purpose, children, extra){
  extra = extra || {};
  const kind = extra.kind || (String(id).charAt(0)==="M" ? "module" : "work");
  const inferred = inferOwnPath(title);
  const node = {
    id, title, kind, purpose: purpose || "",
    state: extra.state || "dirty",
    memories: extra.memories || [],
    ideas: extra.ideas || [],
    todos: extra.todos || [],
    bugs: extra.bugs || [],
    dormant: extra.dormant || [],
    children: children || [],
    files: extra.files || [],
    owns: extra.owns ? extra.owns.slice() : (inferred ? [inferred] : [])
  };
  if(extra.origin) node.origin = extra.origin;
  if(extra.proposal) node.proposal = extra.proposal;
  if(extra.isNew) node.isNew = extra.isNew;
  return node;
}
/* 导图数据来自 github.com/openclaw/openclaw。点进 L1 先看到子模块卡；用途必须点名文件。文件挂在子模块下，不要在一张卡下摊开十几份，也不要 CLI/TUI/UI 空壳。 */
const OPENCLAW_MAP = {
  id:"T0", title:"OpenClaw", kind:"module", purpose:"自己设备上的个人助手：Gateway 管会话、工具、渠道", state:"dirty", files:[], memories:[
    {text:"定位：跑在自己设备上的个人助手，在已有聊天渠道里见面", state:"success"},
    {text:"形态：一个 Gateway 管会话、工具、事件和渠道连接", state:"success"},
    {text:"仓库：pnpm workspace；核心 TypeScript，附带 macOS/iOS/Android 伴侣应用", state:"success"}
  ], bugs:[], dormant:[],
  flows:[
    {from:"M3", to:"M1", label:"入站消息"},
    {from:"M32", to:"M13", label:"配对放行"},
    {from:"M1", to:"M2", label:"调度 agent"},
    {from:"M2", to:"M1", label:"stream / final"},
    {from:"M1", to:"M3", label:"出站 send"},
    {from:"M4", to:"M2", label:"模型与供应商"},
    {from:"M5", to:"M23", label:"工具注册进 runtime"},
    {from:"M6", to:"M1", label:"node caps"},
    {from:"M7", to:"M1", label:"人操作 Gateway"},
    {from:"M8", to:"M1", label:"握手与暴露"},
    {from:"M8", to:"M7", label:"远程同隧道"},
    {from:"M12", to:"M13", label:"协议帧 → 调度"},
    {from:"M13", to:"M21", label:"runner 进 loop"},
    {from:"M21", to:"M22", label:"loop 读写 memory"},
    {from:"M21", to:"M23", label:"loop 调工具"},
    {from:"M14", to:"M73", label:"同端口静态资源"},
    {from:"M41", to:"M21", label:"解析后的模型"},
    {from:"M52", to:"M23", label:"MCP 并入 tool 路径"},
    {from:"M71", to:"M1", label:"CLI 改状态"},
    {from:"M72", to:"M1", label:"TUI 连 WS"},
    {from:"M73", to:"M1", label:"Control UI WS"},
    {from:"N12", to:"N13", label:"握手后才有帧"},
    {from:"N14", to:"N12", label:"schema 约束 connect"},
    {from:"N14", to:"N13", label:"schema 约束帧"},
    {from:"N13", to:"N15", label:"agent 帧进 runner"},
    {from:"N16", to:"N17", label:"sessionKey 进队列"},
    {from:"N17", to:"N15", label:"队列喂 runner"},
    {from:"N31b", to:"N16", label:"入站映射会话"},
    {from:"N38", to:"N39", label:"未匹配进配对"},
    {from:"N39", to:"N3a", label:"人批准后放行"},
    {from:"N25", to:"N23", label:"转录进压缩"},
    {from:"N23", to:"N22", label:"压缩卡进 admitted"},
    {from:"N24", to:"N22", label:"截断结果进 admitted"},
    {from:"N22", to:"N26", label:"admitted 进 prompt"},
    {from:"N26", to:"N21", label:"prompt 进 loop"},
    {from:"N21", to:"N29", label:"loop 调 host 工具"},
    {from:"N21", to:"N27", label:"loop 读写 memory"},
    {from:"N43", to:"N21", label:"默认模型"},
    {from:"N52", to:"N29", label:"插件工具进派发"},
    {from:"N58", to:"N29", label:"MCP 合流"},
    {from:"N62", to:"N14", label:"Swift 模型从 schema 生成"},
    {from:"N68a", to:"N12", label:"Linux node 走 connect"},
    {from:"N69", to:"N29", label:"远程命令经 host 派发"},
    {from:"N6g", to:"N7f", label:"nodes 列表看 caps"},
    {from:"N7j", to:"N12", label:"TUI 走 connect"},
    {from:"N7p", to:"N12", label:"Control UI 走 connect"}
  ],
  children:[

    U("M1", "Gateway 控制面", "本机长驻进程：WebSocket 协议、会话、工具、事件、渠道连接的唯一入口", [
      U("M11", "进程与绑定", "src/gateway 绑 127.0.0.1:18789；healthz 与 loopback 校验", [
      U("N11", "src/gateway 服务入口", "默认绑 127.0.0.1:18789；macOS / CLI / Web / Node 都连同一条 WS", [
        U("N11a", "bind 与 loopback 校验", "非 loopback 禁止把 auth.mode 整段关掉", []),
        U("N11b", "hello-ok methods/events", "连上后发现协议面，不是另开 REST 目录", [])
      ], {memories:[{text:"每台主机一个 Gateway；渠道会话只由它打开", state:"success"}], bugs:[{id:"B10", title:"非 loopback 误开 auth.mode=none", desc:"私有入口的 none 模式若暴露到公网，共享密钥校验被整段关掉", status:"open"}]}),
      ]),
      U("M12", "WebSocket 协议", "connect 首帧、req/res/event、TypeBox schema", [
      U("N12", "src/gateway/protocol/connect.ts", "首帧必须是 connect；非 JSON 或非 connect 直接断开", [
        U("N12a", "connect 握手", "设备签名与 challenge 在这一帧完成", []),
        U("N12b", "非 connect 断开", "协议门卫，不是日志提示", [])
      ]),
      U("N13", "req / res / event 帧", "副作用方法（send、agent）要求幂等键；event 不重放", [
        U("N13a", "帧序号与缺口刷新", "客户端发现序号缺口必须自己刷新", []),
        U("N13b", "幂等键 send / agent", "服务端短时去重", []),
        U("N13c", "event:agent 流式分片", "stream 之后才是 final", [])
      ], {memories:[{text:"探索：event 不重放，缺口必须客户端自己补", state:"dirty"}]}),
      U("N14", "packages/gateway-protocol TypeBox", "协议用 TypeBox 建模，生成 JSON Schema 和 Swift 模型", [
        U("N14a", "TypeBox schema 源", "协议字段只在这里改", []),
        U("N14b", "JSON Schema 导出", "给 Web / 文档 / 校验", []),
        U("N14c", "Swift 客户端模型生成", "macOS/iOS 不手写对等类型", [])
      ]),
      ]),
      U("M13", "会话与 agent 调度", "agent-runner、sessionKey、每会话队列", [
      U("N15", "src/auto-reply/agent-runner.ts", "一轮 agent turn：accepted → stream → final", [
        U("N15a", "req:agent accepted + runId", "先 ack 再推流", []),
        U("N15b", "stream → final 事件序", "UI 按这条组装气泡", []),
        U("N15c", "取消 / abort 传播", "TUI、Control UI、渠道共用", [])
      ], {memories:[{text:"探索：把 runtime execution lineage 从 gateway 调度里拆清", state:"dirty"}], bugs:[{id:"B11", title:"关闭时 active session 排空竞态", desc:"shutdown drain 与新 agent 请求交错，偶发丢 final 事件", status:"open", sessions:["S-0819"]}]}),
      U("N16", "src/routing sessionKey", "会话键是一等公民：持久化、并发、上下文恢复都靠它", []),
      U("N17", "每会话命令队列", "同会话串行，跨会话有并发上限", [
        U("N17a", "每会话队列", "避免同一聊天交错 tool-call", []),
        U("N17b", "跨会话并发上限", "一台主机不是无限 agent", []),
        U("N17c", "shutdown drain", "关掉 Gateway 前先排空", [])
      ]),
      U("P1", "Computer-use harness 加强", "下一优先：computer-use 与 agent harness 在 Gateway 侧留稳定 node caps 合同", [], {origin:"agent", proposal:"proposed", isNew:true, memories:[{text:"Agent 提议理由：computer-use 需要稳定的 node caps 合同，不要散落在各端", state:"dirty"}]})
      ]),
      U("M14", "同端口 HTTP", "canvas / a2ui / Control UI 静态资源，不另起服务", [
        U("N18", "/__openclaw__/canvas/", "与 WS 同端口托管 widget 文档", []),
        U("N19", "/__openclaw__/a2ui/", "A2UI 渲染面，不是另起 HTTP 服务", []),
        U("N1a", "Control UI 静态资源", "Vite 产物由 Gateway 同端口端出", []),
        U("N1b", "/healthz", "守护进程和 doctor 探活", [])
      ]),
    ]),

    U("M5", "Plugins · Skills · MCP", "core 保持瘦；能力默认做插件。代码插件改运行时，bundle 插件装技能/MCP", [
        U("M51", "插件运行时", "plugin-sdk hook、工具表、配置合同、ClawHub、安装签名", [
        U("N51", "packages/plugin-sdk 生命周期", "hook：load / register / dispose，不是业务堆头", []),
        U("N52", "工具注册表", "插件往这里挂 tool，loop 只看表", []),
        U("N53", "插件配置 schema 合同", "core doctor 不改插件私有键", []),
        U("N54", "ClawHub org publisher", "官方插件走受审 org", []),
        U("N55", "安装 / 更新 / 签名", "分发面，core 文档只写扩展点", []),
        ]),
        U("M52", "MCP", "自己当 server、接外部 client、与 tool 路径合流", [
        U("N56", "MCP server 暴露 tools", "OpenClaw 自己当 MCP server", []),
        U("N57", "MCP client 接入外部 server", "外部工具并进同一 tool 路径", []),
        U("N58", "与 runtime tool 路径合流", "避免再复制一套 agent/tool", []),
        ]),
        U("M53", "Skills 加载", "基线 UX、workspace→bundled 覆盖序", [
        U("N59", "skills/ 基线 UX 清单", "只留基线；新技能不进 core", []),
        U("N5a", "workspace → 个人 → managed → bundled 加载序", "高优先级覆盖，不合并冲突技能", []),
        U("P2", "向 core 合入新 skill", "已取消：VISION 写明新 skill 走 ClawHub", [], {origin:"agent", proposal:"cancelled", isNew:false, memories:[{text:"Agent 提议把常用 skill 放进 core。已取消：VISION 写明新 skill 走 ClawHub", state:"dirty"}]})
        ])
    ], {memories:[{text:"新技能先上 ClawHub，不默认合进 core", state:"success"},{text:"同一种能力出现多次，就在 core/SDK 落合同，再把捆绑实现迁到合同上", state:"success"}]}),

    U("M2", "Agent Runtime", "一次 agent 调用如何取上下文、选模型、跑工具、写记忆", [
      U("M21", "循环与上下文裁剪", "packages/agent-core loop 和进 prompt 前的压缩/截断", [
      U("N21", "packages/agent-core 循环", "一轮 tool-call 循环，不是聊天 UI", [
        U("N21a", "src/runtime 或 packages/agent-core loop", "stop / max-turns 在这里", []),
        U("N21b", "tool-call 解析与重试", "坏 JSON 不能直接炸 run", [])
      ], {memories:[{text:"src/auto-reply/agent-runner.ts 调这条循环，Gateway 只调度", state:"dirty"}]}),
      U("N22", "admitted-run-context", "一次 run 能看见哪些工具和记忆，在进 loop 前裁剪", []),
      U("N23", "会话卡片压缩", "不把全部历史塞进 prompt", []),
      U("N24", "轨迹 / 工具结果截断", "长 tool 输出必须切，否则单次调用超时", []),
      U("N25", "转录窗口", "渠道消息进 prompt 的窗口，不是全文", []),
      U("N26", "system prompt 拼装", "技能说明、工具表、会话卡在这里拼", []),
      ]),
      U("M22", "Memory 槽", "memory-host-sdk 单槽；默认文件 memory", [
      U("N27", "memory-host-sdk", "host 对 memory 插件的 load / search / write；同时只能激活一个", [
        U("N27a", "load / search / write API", "合同在 SDK，不在某个文件 memory 里", []),
        U("N27b", "单槽互斥", "两种 memory 实现不能同时写", [])
      ]),
      U("N28", "默认文件 memory", "当前 bundled 实现；切换实现不改 loop", []),
      ]),
      U("M23", "工具与沙箱", "host 派发、sandbox、fs/shell、computer-use", [
      U("N29", "host 工具派发", "主会话工具默认在宿主机跑", []),
      U("N2a", "sandbox 开关与策略", "暴露 Gateway 或连上其他人之前必须先开", []),
      U("N2b", "文件系统 / shell 工具", "和工作区绑定，不是抽象 REPL", []),
      U("N2c", "browser / computer-use 工具", "走 node caps，不在 loop 里写死浏览器", [])
      ]),
    ], {bugs:[{id:"B20", title:"长会话上下文膨胀", desc:"transcripts 未裁剪时单次 agent 调用超时", status:"open"},{id:"B21", title:"未沙箱时工具等同本机权限", desc:"连上其他用户或把 Gateway 暴露出去之前必须先读 sandbox 指南", status:"open"}]}),

    U("M6", "伴侣应用与 Nodes", "macOS / iOS / Android / Linux 以 role:node 连上 Gateway；有界面的报 camera/screen，Linux 只报 headless caps 并跑远程命令", [
        U("M61", "macOS 伴侣", "菜单栏客户端、Swift 协议模型、canvas widget，分面开工不要摊成三个文件胶囊", [
          U("M611", "菜单栏客户端", "apps/macos 连本机 Gateway WS，显示会话状态", [
            U("N61", "apps/macos Gateway 客户端", "菜单栏伴侣进程，不是另一个 Gateway", [
              U("N61a", "本机 WS 连接", "默认 127.0.0.1，走同一套 connect 握手", []),
              U("N61b", "菜单栏会话状态", "当前 session / 未读，不自己存一份记忆", [])
            ])
          ]),
          U("M612", "Swift 协议模型", "从 gateway-protocol JSON Schema 生成，禁止手写对等类型", [
            U("N62", "Swift 模型生成", "macOS/iOS 共用生成物", [
              U("N62a", "Schema → Swift", "协议字段只改 TypeBox 源", [])
            ])
          ]),
          U("M613", "Canvas widget", "macOS 画布控件命令，文档由 Gateway 同端口托管", [
            U("N63", "canvas.* widget 命令", "在 node 上画，不在 Gateway 进程里渲染", [])
          ])
        ]),
        U("M62", "iOS / Android node", "移动端以 role:node 报 camera/screen/location；Android 策略源不能分叉", [
          U("M621", "iOS node", "apps/ios：摄像头、屏幕、定位 caps", [
            U("N64", "apps/ios node", "camera.* / screen.record / location.get", [
              U("N64a", "connect 报 mobile caps", "按设备配对，不按 Apple ID", [])
            ])
          ]),
          U("M622", "Android node", "同一套 caps；policy-config 与 policy-source 必须同判", [
            U("N65", "apps/android node", "caps 合同与 iOS 对齐", []),
            U("N67", "Android policy-config vs policy-source", "required-commands 判断不能分叉", [
              U("N67a", "required-commands 单一来源", "两份策略文件禁止各算各的", [])
            ])
          ]),
          U("M623", "设备 caps 合同", "connect 里声明能力，Gateway 只按声明派发", [
            U("N66", "camera / screen / location caps", "connect 声明，按设备批准", [])
          ])
        ]),
        U("M63", "Linux node", "无桌面：headless 进程以 role:node 连上，只报 shell/fs caps，命令跑在这台 Linux 上", [
          U("M631", "headless 进程与连接", "无窗口 node host：握手、报 caps、断线重连", [
            U("N68", "apps/linux 或 src/nodes/headless 入口", "无 GUI 进程，只连 Gateway", [
              U("N68a", "role:node connect", "设备身份与 challenge 签名，和 macOS node 同一协议", []),
              U("N68b", "headless caps 清单", "声明 shell / fs；不报 camera 或菜单栏 UI", [])
            ]),
            U("N68c", "设备配对", "Gateway 按设备批准这台 Linux，不是按用户会话", []),
            U("N68d", "断线重连", "Gateway 重启后 node 自己回来，不丢 device id", [])
          ]),
          U("M632", "远程命令执行", "exec 发生在 Linux node 上，stdout 回流当前 turn；不是 Gateway 本机 shell", [
            U("N69", "node shell runner", "cwd、env、超时都在 node 侧", [
              U("N69a", "stdout/stderr 回流", "流式贴回 Gateway 当前 agent turn", []),
              U("N69b", "取消时杀子进程", "Gateway abort 必须落到 node 上的 exec", [])
            ]),
            U("N69c", "文件读写工具", "只动声明过的工作区根，不默认整盘", []),
            U("N69d", "cwd 与 sandbox 边界", "caps 里写允许的根目录，越界拒绝", [])
          ]),
          U("M633", "安装与常驻", "无显示器也要挂着：user systemd + Gateway 侧能看见这台 node", [
            U("N6e", "openclaw node install", "写出 systemd --user 单元并 enable", []),
            U("N6f", "systemd --user 常驻", "登录后自动 connect，不依赖桌面会话", []),
            U("N6g", "Gateway nodes 列表", "src/commands/nodes.ts / Control UI Nodes 看到 caps", [])
          ])
        ], {memories:[{text:"Linux node 没有菜单栏。第一层先拆连接 / 远程命令 / 常驻，再挂入口文件，不要两个胶囊了事", state:"success"}]}),
        U("M64", "Canvas / A2UI", "widget 文档由 Gateway 同端口托管；绘制发生在 node 上", [
          U("M641", "同端口文档路由", "HTTP 与 WS 共用 Gateway 端口", [
            U("N6a", "canvas 文档路由", "Gateway HTTP 与 WS 同端口", [])
          ]),
          U("M642", "A2UI 渲染", "托管 widget 文档，不另起静态站点", [
            U("N6b", "A2UI 渲染", "托管 widget 文档", [])
          ])
        ])
      ], {memories:[{text:"Node 在 connect 里声明 caps/commands；配对按设备而不是按用户会话", state:"success"},{text:"点进 Linux node 应先看到连接、远程命令、常驻三张子模块卡，再进到入口文件", state:"success"}], bugs:[{id:"B60", title:"Android node caps 策略来源不一致", desc:"policy-config 与 policy-source 对 required-commands 判断分叉", status:"open"}]}),

    U("M3", "Channels 消息渠道", "把助手接到 WhatsApp / Telegram / Slack / Discord / Signal / iMessage 等已有聊天里", [
      U("M31", "已接聊天渠道", "whatsapp/baileys、telegram/grammy，以及 slack/discord/signal/imessage 各自实现目录", [
      U("N31", "src/channels/whatsapp/baileys.ts", "每台主机一个 Baileys 会话，只由 Gateway 打开", [
        U("N31a", "auth 状态落盘", "扫码会话必须能复活", []),
        U("N31b", "入站消息 → sessionKey", "渠道消息进 Gateway 会话", []),
        U("N31c", "出站 send 与媒体", "图片/语音走同一 send 路径", [])
      ], {memories:[{text:"不变量：每台主机只有一个 Baileys 会话，且只由 Gateway 打开", state:"success"}], dormant:[{title:"多实例抢同一 WhatsApp session", exp:"第二台 Gateway 再开 Baileys 会互踢；修复：单主机单 Gateway 不变量写进协议文档。"}]}),
      U("N32", "src/channels/telegram/grammy.ts", "grammY bot：webhook 或 long-poll，chat id 映射", [
        U("N32a", "webhook vs long-poll", "本机默认 poll，服务器才 webhook", []),
        U("N32b", "chat/user id 映射", "和 sessionKey 对齐", [])
      ]),
      U("N33", "src/channels/slack", "Events API、线程、mention 策略", []),
      U("N34", "src/channels/discord", "gateway intents 与频道/线程", []),
      U("N35", "src/channels/googlechat", "Google Chat app，不是 webhook 包装", []),
      U("N36", "src/channels/signal", "本机身份渠道，不能多开", []),
      U("N37", "src/channels/imessage", "iMessage / BlueBubbles 桥", []),
      ]),
      U("M32", "入站配对", "allowlist、pairing 队列、pairing approve", [
      U("N38", "allowlist 匹配", "能私聊的渠道默认要配对未知发送者", []),
      U("N39", "pairing 队列", "未知发送者先卡住，不进 agent", []),
      U("N3a", "openclaw pairing approve", "CLI 和 Control UI 改同一份队列", []),
      U("P3", "再包一层已有渠道的 wrapper", "已取消：不收无能力/安全缺口的 wrapper channel", [], {origin:"agent", proposal:"cancelled", isNew:false, memories:[{text:"Agent 提议给已支持渠道再做包装通道。已取消：不收无能力/安全缺口的 wrapper channel", state:"dirty"}]})
      ]),
    ], {memories:[{text:"渠道把入站消息当不可信输入；能私聊的渠道默认要配对未知发送者", state:"success"}], bugs:[{id:"B30", title:"DM 渠道默认配对提示易被忽略", desc:"操作者以为渠道一连上就能聊，实际消息卡在 pairing 队列", status:"open"}]}),

    U("M7", "控制面 UI", "人操作 Gateway：命令、终端会话、浏览器面板、远程隧道分面开工，不是把所有文件摊在一张卡下", [
        U("M71", "CLI 命令", "src/entry.ts → run-main.ts → src/commands/*：终端里改 Gateway 的那一组命令", [
          U("M711", "进程入口", "entry 设环境，run-main 按复数名词注册子命令", [
            U("N70", "src/entry.ts", "CLI 进程入口，设环境后交给 run-main", []),
            U("N71", "src/cli/run-main.ts", "注册全部子命令；名词用复数", [])
          ]),
          U("M712", "安装与守护", "第一次把助手装上：onboard / daemon / gateway / doctor", [
            U("N72", "src/commands/onboard.ts", "openclaw onboard：模型、工作区、可选 --install-daemon", [
              U("N72a", "模型 / 工作区问卷", "第一次把助手装上", []),
              U("N72b", "失败回 doctor", "向导不是一次性脚本", [])
            ]),
            U("N73", "src/commands/daemon.ts", "install-daemon：launchd / systemd 入口", []),
            U("N74", "src/commands/gateway.ts", "gateway start / stop / status / restart / --bind", []),
            U("N78", "src/commands/doctor.ts", "doctor --fix 是配置迁移主路径，不是可选项", [])
          ]),
          U("M713", "会话与模型", "命令行发 agent、列会话、改默认模型", [
            U("N75", "src/commands/agent.ts", "命令行发一轮 agent，拿 runId", []),
            U("N76", "src/commands/sessions.ts", "列会话、补发消息、看历史", []),
            U("N77", "src/commands/models.ts", "模型列表、默认模型、扫描供应商", [])
          ]),
          U("M714", "渠道与配置", "channels / pairing / plugins / config，和 Control UI 改同一份状态", [
            U("N79", "src/commands/channels.ts", "渠道连接向导，和 Control UI 向导改同一份状态", []),
            U("N7a", "src/commands/pairing.ts", "pairing approve / 列表，放行未知发送者", []),
            U("N7b", "src/commands/plugins.ts", "插件与技能安装、更新", []),
            U("N7c", "src/commands/config.ts", "config get/set，对齐当前 schema", [])
          ]),
          U("M715", "运维命令", "logs / cron / nodes / dashboard：用 token 打开 Control UI", [
            U("N7d", "src/commands/logs.ts", "经 RPC 拉 Gateway 文件日志", []),
            U("N7e", "src/commands/cron.ts", "定时任务走 Gateway scheduler", []),
            U("N7f", "src/commands/nodes.ts", "设备节点列表与 caps", []),
            U("N7g", "src/commands/dashboard.ts", "用当前 token 打开 Control UI", [])
          ])
        ]),
        U("M72", "TUI", "src/tui/tui.ts 主循环：连已有 Gateway，或 --local 嵌入式跑 agent", [
          U("N7h", "src/cli/tui-cli.ts", "注册 tui，别名 terminal / chat；--local 才嵌入式", []),
          U("N7i", "src/tui/tui.ts", "终端会话主循环：header / chat log / status / editor", [
            U("N7i1", "pi-tui 组件树", "布局和渲染循环", []),
            U("N7i2", "editor 组件", "输入、补全、粘贴", [])
          ]),
          U("N7j", "GatewayChatClient", "TUI 连已有 Gateway 的 WS 后端", []),
          U("N7k", "EmbeddedBackend --local", "无 Gateway 时在进程内跑 agent；chat/terminal 别名默认走这条", []),
          U("N7l", "src/tui 流式组装", "把 event:agent 分片拼成气泡，含 tool-call 可视化", []),
          U("N7m", "src/tui/commands.ts slash", "/status /agent /session /model /auth；随当前 agent 变", []),
          U("N7n", "TUI 会话与 agent 切换", "session scope、mainKey、多 agent", []),
          U("N7o", "createLocalShellRunner", "!command 走本机 PTY，不是把输出当普通文本贴进去", [])
        ]),
        U("M73", "Control UI", "ui/src/chat/*：浏览器里的会话、向导、Nodes、终端坞，Gateway 同端口", [
          U("N7p", "ui/src 会话侧栏", "浏览器里的会话列表，走 Gateway WS", []),
          U("N7q", "ui/src/chat/transcript", "流式气泡与工具调用展示", []),
          U("N7r", "ui/src/chat/composer", "发送、附件、会话内覆盖模型", []),
          U("N7s", "Control UI 渠道接入向导", "在浏览器完成渠道连接，不是只丢 CLI", []),
          U("N7t", "Control UI Nodes 面板", "摄像头/屏幕 node 的配对与 caps", []),
          U("N7u", "Control UI skills / 模型 / 配置", "和 CLI 改同一份 schema", []),
          U("N7v", "Control UI 日志 / Cron", "事件日志和定时任务", []),
          U("N7w", "OpenClawTerminalPanel", "浏览器终端坞接到 Gateway PTY", [])
        ]),
        U("M74", "远程鉴权与隧道", "设 --url 时不回落本地凭据；WebChat 必须和 Gateway 走同一条 SSH/Tailscale", [
          U("N7x", "远程 token / password / TLS fingerprint", "设 --url 时不回落到配置里的凭据", []),
          U("N7y", "SSH / Tailscale 同隧道", "远程 Control UI 必须和 Gateway 走同一条隧道", [])
        ])
      ], {memories:[{text:"openclaw onboard --install-daemon 做模型、工作区、Gateway；dashboard 打开 Control UI", state:"success"},{text:"点进控制面 UI 应先看到 CLI / TUI / Control UI / 远程 四张子模块卡，再进到具体 ts。既不要三张空壳，也不要一张卡下摊开全部文件", state:"success"}], bugs:[{id:"B70", title:"远程 Control UI 必须与 Gateway 同隧道", desc:"WebChat 在远程环境下要走同一条 SSH/Tailscale，漏配就会连错端口", status:"open"}]}),

    U("M4", "Models 与供应商", "模型目录、选择器、托管/本地供应商，核心只认当前配置 schema", [
      U("M41", "目录与选择器", "catalog schema、别名、默认/覆盖/回退", [
      U("N41", "model-catalog JSON schema", "当前 schema 下的目录；改名必须走 doctor", []),
      U("N42", "别名与弃用项", "旧模型名不能默默失效", []),
      U("N43", "默认模型解析", "一次 run 的起点", []),
      U("N44", "会话级模型覆盖", "TUI / Control UI / 渠道都能改", []),
      U("N45", "失败回退链", "主模型挂了走下一家，不是直接红", []),
      ]),
      U("M42", "供应商适配", "extensions/anthropic、vertex、ollama、网关代理", [
      U("N46", "extensions/anthropic", "官方 API 适配", []),
      U("N47", "extensions/vertex", "Vertex 适配，不堆进 core", []),
      U("N48", "ollama / 本地", "本机模型走 extensions", []),
      U("N49", "cloudflare-ai-gateway", "网关型供应商与主 picker 的优先级", []),
      U("N4a", "copilot-proxy", "代理供应商，优先级写进 picker 而不是 if-else", [])
      ]),
    ], {memories:[{text:"配置改名必须带 doctor 迁移：检测旧形态、备份、改写成规范格式", state:"success"}]}),

    U("M8", "安全、配对、部署", "默认安全但不阉割能力；危险路径必须显式、由操作者打开", [
        U("M81", "握手与配对", "connect.challenge、pairing v3、loopback vs Tailnet", [
        U("N81", "connect.challenge 签名", "设备握手必须签名", []),
        U("N82", "pairing v3 platform / deviceFamily", "按设备族绑，不按用户会话", []),
        U("N83", "loopback 自动配对", "本机可免批准", []),
        U("N84", "Tailnet/LAN 人工批准", "非 loopback 必须人点", []),
        ]),
        U("M82", "暴露与沙箱", "docs/security、exposure-runbook、sandboxing 指南", [
        U("N85", "docs/security", "暴露前必读", []),
        U("N86", "exposure-runbook", "把 Gateway 给别人之前的检查单", []),
        U("N87", "sandboxing 指南", "工具权限与宿主机隔离", []),
        ]),
        U("M83", "部署与 doctor", "launchd/systemd/Docker/fly；core vs 插件 doctor", [
        U("N88", "launchd plist", "macOS 守护", []),
        U("N89", "systemd unit", "Linux 守护", []),
        U("N8a", "Dockerfile / compose", "容器部署", []),
        U("N8b", "fly.toml", "Fly 部署", []),
        U("N8c", "core doctor --fix", "修 core 配置，迁移前备份", []),
        U("N8d", "插件 doctor 合同", "插件配置由该插件自己的 doctor 修", [])
        ])
      ], {memories:[{text:"无使用分析、无跟踪，除非操作者自己打开", state:"success"},{text:"loopback 可自动配对；Tailnet/LAN 必须人工批准", state:"success"}]}),
  ]
};

const CONTEXT_GUARD_MAP = {
  "id": "T0",
  "title": "Context Guard",
  "kind": "module",
  "purpose": "人与 Agent 共用的项目记忆，活在仓库里",
  "state": "untested",
  "files": [],
  "memories": [
    {
      "text": "第一层由人锁定：工作台、冷启动、底层文件系统、hook、CI/CD。安装并进冷启动。",
      "state": "success",
      "files": []
    },
    {
      "text": "SKILL.md 合同挂在根上：无图才商量；有图则打开；不贴整图。",
      "state": "success",
      "files": []
    },
    {
      "text": "本仓开发：产品分支改产品、合 main；测试分支只改 tests/（可有假仓）；测试里发现问题回产品分支修。见 tasks/J2.md。",
      "state": "success",
      "files": []
    }
  ],
  "bugs": [],
  "dormant": [],
  "flows": [
    {
      "from": "M2",
      "to": "M1",
      "label": "建图在工作台点头"
    },
    {
      "from": "M2",
      "to": "M3",
      "label": "init 写出骨架"
    },
    {
      "from": "M2",
      "to": "M4",
      "label": "安装时可选 hooks"
    },
    {
      "from": "M1",
      "to": "M3",
      "label": "确认后写回地图"
    },
    {
      "from": "M3",
      "to": "M1",
      "label": "打开已有图"
    },
    {
      "from": "M4",
      "to": "M2",
      "label": "SessionStart 触发冷启动"
    },
    {
      "from": "M5",
      "to": "M3",
      "label": "失败回到坏例"
    }
  ],
  "children": [
    {
      "id": "M1",
      "title": "工作台",
      "kind": "module",
      "purpose": "人在浏览器看图、改记忆、确认提议、授权切片",
      "state": "untested",
      "files": [],
      "memories": [
        {
          "text": "prototype/workbench.html 单文件原型；人点头不在 CLI。",
          "state": "success",
          "files": []
        }
      ],
      "bugs": [
        {
          "id": "B20",
          "title": "原生 prompt 会打断看图",
          "desc": "检查器编辑和建图确认必须留在页面里",
          "status": "open",
          "files": [],
          "sessions": ["S-live"],
          "record": ".codex/context/bugs/B20.md"
        },
        {
          "id": "B40",
          "title": "顶栏还没人认领",
          "desc": "待处理：没有 Session",
          "status": "open",
          "files": [],
          "sessions": [],
          "record": ".codex/context/bugs/B40.md"
        },
        {
          "id": "B41",
          "title": "发出去了但没送到",
          "desc": "待处理 · 发送失败",
          "status": "open",
          "files": [],
          "sessions": [],
          "dispatch": {"status": "failed", "at": "2026-09-01T00:00:00.000Z"},
          "record": ".codex/context/bugs/B41.md"
        },
        {
          "id": "B42",
          "title": "当前窗口正在改检查器",
          "desc": "处理中 · 活着的会话",
          "status": "open",
          "files": [],
          "sessions": ["S-live"],
          "record": ".codex/context/bugs/B42.md"
        },
        {
          "id": "B43",
          "title": "昨晚那次做完人走了",
          "desc": "待接手：会话已停",
          "status": "open",
          "files": [],
          "sessions": ["S-dead"],
          "record": ".codex/context/bugs/B43.md"
        },
        {
          "id": "B44",
          "title": "两个会话都还挂着",
          "desc": "处理中 · 一个活一个停",
          "status": "open",
          "files": [],
          "sessions": ["S-live", "S-dead"],
          "record": ".codex/context/bugs/B44.md"
        },
        {
          "id": "B45",
          "title": "修完在写记忆",
          "desc": "收尾中",
          "status": "pending",
          "files": [],
          "sessions": [],
          "record": ".codex/context/bugs/B45.md"
        },
        {
          "id": "B46",
          "title": "测试已经过了",
          "desc": "已修复",
          "status": "fixed",
          "files": [],
          "sessions": [],
          "record": ".codex/context/bugs/B46.md"
        },
        {
          "id": "B47",
          "title": "人点过可以关",
          "desc": "已解决",
          "status": "resolved",
          "files": [],
          "sessions": [],
          "record": ".codex/context/bugs/B47.md"
        },
        {
          "id": "B48",
          "title": "这期先不做",
          "desc": "已延期",
          "status": "deferred",
          "files": [],
          "sessions": [],
          "record": ".codex/context/bugs/B48.md"
        },
        {
          "id": "B49",
          "title": "设计如此不改",
          "desc": "不处理",
          "status": "wontfix",
          "files": [],
          "sessions": [],
          "record": ".codex/context/bugs/B49.md"
        },
        {
          "id": "B50",
          "title": "手机竖屏时抽屉把手被底栏挡住，标题折成两行看点和分配会不会挤掉",
          "desc": "长标题",
          "status": "open",
          "files": [],
          "sessions": ["S-live"],
          "record": ".codex/context/bugs/B50.md"
        }
      ],
      "dormant": [],
      "children": [
        {
          "id": "N400",
          "title": "前端设计",
          "kind": "module",
          "origin": "human",
          "state": "untested",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [
            {
              "id": "N405",
              "title": "顶栏",
              "kind": "work",
              "origin": "human",
              "state": "untested",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N406",
              "title": "右边栏",
              "kind": "work",
              "origin": "human",
              "state": "untested",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N407",
              "title": "按钮",
              "kind": "work",
              "origin": "human",
              "state": "untested",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N409",
              "title": "授权模式",
              "kind": "module",
              "origin": "human",
              "state": "untested",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N410",
              "title": "Bug",
              "kind": "module",
              "origin": "human",
              "state": "untested",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N411",
              "title": "已取消",
              "kind": "module",
              "origin": "human",
              "state": "untested",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N412",
              "title": "鼠标/移动",
              "kind": "work",
              "origin": "human",
              "state": "untested",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            }
          ],
          "proposal": "accepted",
          "isNew": false
        },
        {
          "id": "N401",
          "title": "session连接",
          "kind": "module",
          "origin": "human",
          "state": "untested",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "accepted",
          "isNew": false
        },
        {
          "id": "N402",
          "title": "模块授权",
          "kind": "module",
          "origin": "human",
          "state": "untested",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "accepted",
          "isNew": false
        },
        {
          "id": "N403",
          "title": "debug",
          "kind": "module",
          "origin": "human",
          "state": "dirty",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "accepted",
          "isNew": false
        },
        {
          "id": "N404",
          "title": "底层连接",
          "kind": "module",
          "origin": "human",
          "state": "untested",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "accepted",
          "isNew": false
        }
      ],
      "proposal": "accepted",
      "isNew": false,
      "origin": "human",
      "owns": [
        "prototype/",
        "docs/shots/"
      ],
      "ideas": []
    },
    {
      "id": "M2",
      "title": "冷启动",
      "kind": "module",
      "purpose": "skill 怎么进机器、第一次怎么建图：安装、init、语言、层对层商量",
      "state": "untested",
      "files": [],
      "memories": [
        {
          "text": "npx/init/set-language 属于冷启动，不是 hook。",
          "state": "success",
          "files": []
        }
      ],
      "bugs": [],
      "dormant": [],
      "children": [
        {
          "id": "N413",
          "title": "多平台一键安装",
          "kind": "module",
          "origin": "human",
          "state": "success",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [
            {
              "id": "N414",
              "title": "codex",
              "kind": "module",
              "origin": "human",
              "state": "dirty",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "cancelled",
              "isNew": false
            },
            {
              "id": "N415",
              "title": "codex",
              "kind": "work",
              "origin": "human",
              "state": "success",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N416",
              "title": "claude code",
              "kind": "work",
              "origin": "human",
              "state": "success",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N417",
              "title": "grok",
              "kind": "module",
              "origin": "human",
              "state": "dirty",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "cancelled",
              "isNew": false
            },
            {
              "id": "N418",
              "title": "grok",
              "kind": "work",
              "origin": "human",
              "state": "dirty",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [
                {
                  "id": "N419",
                  "title": "cursor",
                  "kind": "work",
                  "origin": "human",
                  "state": "dirty",
                  "purpose": "",
                  "memories": [],
                  "ideas": [],
                  "bugs": [],
                  "dormant": [],
                  "files": [],
                  "owns": [],
                  "children": [],
                  "proposal": "cancelled",
                  "isNew": false
                }
              ],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N420",
              "title": "cursor",
              "kind": "work",
              "origin": "human",
              "state": "success",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [
                {
                  "id": "N421",
                  "title": "dsh",
                  "kind": "work",
                  "origin": "human",
                  "state": "dirty",
                  "purpose": "",
                  "memories": [],
                  "ideas": [],
                  "bugs": [],
                  "dormant": [],
                  "files": [],
                  "owns": [],
                  "children": [],
                  "proposal": "cancelled",
                  "isNew": false
                }
              ],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N422",
              "title": "dsh",
              "kind": "work",
              "origin": "human",
              "state": "dirty",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N423",
              "title": "kimi",
              "kind": "work",
              "origin": "human",
              "state": "dirty",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N424",
              "title": "doubao",
              "kind": "work",
              "origin": "human",
              "state": "dirty",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            }
          ],
          "proposal": "accepted",
          "isNew": false
        },
        {
          "id": "N425",
          "title": "初次使用动画引导",
          "kind": "module",
          "origin": "human",
          "state": "untested",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "accepted",
          "isNew": false
        },
        {
          "id": "N426",
          "title": "新仓库建图",
          "kind": "module",
          "origin": "human",
          "state": "dirty",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "accepted",
          "isNew": false
        },
        {
          "id": "N427",
          "title": "已有仓库建图",
          "kind": "module",
          "origin": "human",
          "state": "untested",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "accepted",
          "isNew": false
        }
      ],
      "proposal": "accepted",
      "isNew": false,
      "origin": "human",
      "owns": [
        "SKILL.md",
        "bin/",
        "package.json",
        "scripts/context_guard.py",
        "references/",
        "agents/"
      ],
      "ideas": []
    },
    {
      "id": "M3",
      "title": "底层文件系统",
      "kind": "module",
      "purpose": "会话、坏例、任务、地图怎么写、怎么跳",
      "state": "success",
      "files": [],
      "memories": [
        {
          "text": "先读 FIND.md，再只打开命中的 1–2 个 Markdown。",
          "state": "success",
          "files": []
        }
      ],
      "bugs": [],
      "dormant": [],
      "children": [
        {
          "id": "N428",
          "title": "session",
          "kind": "module",
          "origin": "human",
          "state": "success",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [
            {
              "id": "N432",
              "title": "user message",
              "kind": "work",
              "origin": "human",
              "state": "success",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            }
          ],
          "proposal": "accepted",
          "isNew": false
        },
        {
          "id": "N429",
          "title": "bad case",
          "kind": "module",
          "origin": "human",
          "state": "success",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "accepted",
          "isNew": false
        },
        {
          "id": "N430",
          "title": "map",
          "kind": "module",
          "origin": "human",
          "state": "success",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "accepted",
          "isNew": false
        },
        {
          "id": "N431",
          "title": "index",
          "kind": "module",
          "origin": "human",
          "state": "success",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "accepted",
          "isNew": false
        },
        {
          "id": "N433",
          "title": "Readme.md",
          "kind": "work",
          "origin": "human",
          "state": "success",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "accepted",
          "isNew": false
        },
        {
          "id": "N434",
          "title": "task",
          "kind": "module",
          "origin": "human",
          "state": "untested",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "accepted",
          "isNew": false
        }
      ],
      "proposal": "accepted",
      "isNew": false,
      "origin": "human",
      "owns": [
        ".codex/context/",
        "scripts/map_owns.py"
      ],
      "ideas": []
    },
    {
      "id": "M4",
      "title": "hook",
      "kind": "module",
      "purpose": "当前开发进程的生命周期提醒，把 skill 挂到打开的仓库",
      "state": "untested",
      "files": [],
      "memories": [],
      "bugs": [],
      "dormant": [],
      "children": [
        {
          "id": "N435",
          "title": "start hook",
          "kind": "module",
          "origin": "human",
          "state": "success",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [
            {
              "id": "N437",
              "title": "User Prompt",
              "kind": "work",
              "origin": "human",
              "state": "success",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N438",
              "title": "System Prompt",
              "kind": "work",
              "origin": "human",
              "state": "success",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N439",
              "title": "Bad Case Check",
              "kind": "work",
              "origin": "human",
              "state": "dirty",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N440",
              "title": "Task Check",
              "kind": "work",
              "origin": "human",
              "state": "dirty",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N444",
              "title": "Ask User",
              "kind": "work",
              "origin": "human",
              "state": "success",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            }
          ],
          "proposal": "accepted",
          "isNew": false
        },
        {
          "id": "N436",
          "title": "stop hook",
          "kind": "module",
          "origin": "human",
          "state": "untested",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [
            {
              "id": "N441",
              "title": "Summary",
              "kind": "work",
              "origin": "human",
              "state": "dirty",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N442",
              "title": "Record Bad Case",
              "kind": "work",
              "origin": "human",
              "state": "dirty",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            },
            {
              "id": "N443",
              "title": "Update Map",
              "kind": "work",
              "origin": "human",
              "state": "dirty",
              "purpose": "",
              "memories": [],
              "ideas": [],
              "bugs": [],
              "dormant": [],
              "files": [],
              "owns": [],
              "children": [],
              "proposal": "accepted",
              "isNew": false
            }
          ],
          "proposal": "accepted",
          "isNew": false
        }
      ],
      "proposal": "accepted",
      "isNew": false,
      "origin": "human",
      "owns": [
        "hooks.json",
        "scripts/context_guard_hook.py"
      ],
      "ideas": []
    },
    {
      "id": "M5",
      "title": "CI/CD",
      "kind": "module",
      "purpose": "以后怎么自动验；第一版不做测试中台，夹具和冒烟挂在这里",
      "state": "untested",
      "files": [],
      "memories": [
        {
          "text": "第一版不做 Test Hub / 功能链；人设计测试，Agent 只提草案。",
          "state": "success",
          "files": []
        }
      ],
      "bugs": [],
      "dormant": [],
      "children": [
        {
          "id": "N445",
          "title": "npm install smoke",
          "kind": "module",
          "origin": "human",
          "state": "dirty",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "cancelled",
          "isNew": false
        },
        {
          "id": "N446",
          "title": "CI",
          "kind": "module",
          "origin": "human",
          "state": "success",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "accepted",
          "isNew": false
        },
        {
          "id": "N447",
          "title": "CD",
          "kind": "module",
          "origin": "human",
          "state": "untested",
          "purpose": "",
          "memories": [],
          "ideas": [],
          "bugs": [],
          "dormant": [],
          "files": [],
          "owns": [],
          "children": [],
          "proposal": "accepted",
          "isNew": false
        }
      ],
      "proposal": "accepted",
      "isNew": false,
      "origin": "human",
      "owns": [
        ".github/"
      ],
      "ideas": []
    }
  ],
  "owns": [],
  "ideas": [],
  "proposal": "accepted",
  "isNew": false
};
const CG_OWNS = {
  M1:["prototype/","docs/shots/"],
  M2:["SKILL.md","bin/","package.json","scripts/context_guard.py","references/","agents/"],
  M3:[".codex/context/","scripts/map_owns.py"],
  M4:["hooks.json","scripts/context_guard_hook.py"],
  M5:[".github/"]
};
function stampOwns(n, table){
  if(!n) return;
  if(table[n.id]) n.owns = table[n.id].slice();
  else if(!Array.isArray(n.owns)) n.owns = [];
  (n.children||[]).forEach(c=>stampOwns(c, table));
  (n._inbox||[]).forEach(c=>stampOwns(c, table));
}
stampOwns(CONTEXT_GUARD_MAP, CG_OWNS);

const OPENCLAW_NOTES = `# OpenClaw 架构笔记（演示稿 · 未调用 Agent）

分析对象：openclaw/openclaw。不是目录树，也不是「CLI / TUI / Control UI」三句口号。
粒度：接下来改代码时会打开哪一个文件、哪一条命令。真做时先和人商量第一层怎么切（可以先给几种拆法），定了再往下拆。卡名要一眼能看懂。

## 第一层（商量之后的定稿，不是一上来倒出的整棵树）

L1 数量视仓库而定，建议 4–8，不写死成 4。OpenClaw 体量大，这一页确认 8 张卡：

Gateway 控制面 · Agent Runtime · Channels · Models 与供应商 · Plugins/Skills/MCP · 伴侣 Nodes · 控制面 UI · 安全/配对/部署

小仓库可以只留 4 张主干；大仓库把真正独立的开工面提到第一层，而不是为了“看起来整齐”强行塞进 4 张伞卡。命令和文件是开工单元：点进分支才看到下一截。规则、记忆、Bug 不是节点。

## Gateway 控制面（可改文件）

- src/gateway 服务入口，默认 127.0.0.1:18789；非 loopback 禁止 auth.mode=none
- src/gateway/protocol/connect.ts：首帧 connect，否则断开
- req/res/event 帧、幂等键、序号缺口刷新
- packages/gateway-protocol TypeBox → JSON Schema → Swift
- src/auto-reply/agent-runner.ts：accepted + runId → stream → final → abort
- src/routing sessionKey；每会话队列；shutdown drain
- /__openclaw__/canvas/ 、 /__openclaw__/a2ui/ 、 Control UI 静态资源、/healthz

## Agent Runtime

- packages/agent-core 循环（tool-call loop，不是聊天 UI）
- admitted-run-context、max-turns、tool-call 重试
- 会话卡片压缩、轨迹截断、转录窗口、system prompt 拼装
- memory-host-sdk：load/search/write，单槽互斥
- host 工具派发 vs sandbox；browser/computer-use 走 node caps

## Channels

- src/channels/whatsapp/baileys.ts：单主机单会话、auth 落盘、媒体 send
- src/channels/telegram/grammy.ts：webhook vs long-poll
- slack / discord / googlechat / signal / imessage 各自实现目录
- allowlist、pairing 队列、openclaw pairing approve

## 控制面 UI（先建子模块，再挂文件）

点进「控制面 UI」应先看到四张子模块卡，而不是二十几个文件胶囊：

- CLI 命令：entry.ts → run-main.ts → src/commands/*（安装、会话、渠道、运维再分组）
- TUI：tui-cli.ts、tui.ts、GatewayChatClient / EmbeddedBackend、slash、PTY
- Control UI：ui/src/chat/*、渠道向导、Nodes、终端坞
- 远程鉴权与隧道：token/TLS；必须与 Gateway 同 SSH/Tailscale

## Models / Plugins / Nodes / 安全

- catalog schema、picker 默认/覆盖/回退；extensions/anthropic、vertex、ollama、网关代理
- packages/plugin-sdk hook、工具注册表、ClawHub、MCP server/client 合流、skills 加载序
- apps/macos、ios、android、linux；Swift 由协议生成；Android policy-config 与 policy-source 不能分叉
- Linux node 不是两个胶囊：先拆 headless 连接 / 远程命令 / systemd 常驻，再挂入口文件
- connect.challenge 签名、pairing v3、launchd/systemd、Dockerfile、fly.toml、core vs 插件 doctor
`;

const CONTEXT_GUARD_NOTES = `# Context Guard 架构笔记（演示稿 · 未调用 Agent）

分析对象：本仓库。真做时先商量第一层怎么切，定了再往下拆。下面是定稿后的第一层。开发粒度是工作台里的函数/文件，不是「工作台」三个字。

## 第一层
Skill 合同 · 工作台 · skill文件结构 · CLI 与 Hook · 仓库拆图 · 会话授权与提议 · 遗留测试中台

## 工作台（prototype/workbench.html）
- renderNode 模块卡（标题 + 一句用途，不印文件）
- visibleChildren：根目录只铺 L1。模块一次只画一层；开工链（最多两岔）默认展开。多于两个分支的开工节点晋升为模块。父子用曲线相连，同级不相连
- 检查器 contenteditable、记忆 / Idea / Bug 区块、+ 号
- 左右/上下只排模块内部的开工树；根目录隐藏该开关
- 仓库切换与每仓 map_bootstrap
- 首次分析叠层（标明未调用 Agent）
- 活地图 .codex/context/map.json（记忆在节点上）；localStorage 只当缓存；asProposal 递归子模块卡，只把开工单元内部收进 inbox

## 仓库拆图怎么做
- 先拿出几种第一层拆法或较多候选；人和 Agent 定了再拆第二层、第三层
- 卡名和那一句用途要让人几秒内知道这是啥
- 信号：README、包边界、docs、运行时入口（不是一文件一卡）
- 产出：architecture.md（整仓笔记）+ map.json（活地图：树、记忆、生产/消费）
- 反例：控制面 UI → CLI / TUI / UI 三张空壳；同样反例：一张卡下摊开全部文件
- 以后会话打开已有图，除非人要求重分析
`;

global.__CG_WORKBENCH_FIXTURES = { OPENCLAW_MAP, CONTEXT_GUARD_MAP, CG_OWNS, OPENCLAW_NOTES, CONTEXT_GUARD_NOTES, U };
})(window);
