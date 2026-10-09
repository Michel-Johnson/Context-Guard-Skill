// Illustrative Map, not extracted runtime dependencies or real OpenClaw issues.
// Paths were checked against this immutable public repository revision.
export const openclawSource = Object.freeze({
  repository: 'https://github.com/openclaw/openclaw',
  commit: '594335a38e5acc60d75b44d98a3d2f5331958f66',
  architecture: 'https://docs.openclaw.ai/concepts/architecture',
});
// Localized presentation is separate from canonical architecture records.
export function createOpenclawDisplayTranslations(currentMap=createOpenclawMap()) {
  const english={
    T0:['OpenClaw · Multilevel Mock','4 levels / 32 nodes · Illustrative architecture, not live runtime state'],
    CLIENTS:['Client interfaces','Control UI, CLI and device entry points'],
    CONTROL:['Control UI','Example grouping for the browser workbench'],
    'CONTROL-PAGES':['UI components','Pages and reusable UI components'],
    'CONTROL-API':['UI API','Browser API client'],
    CLI:['CLI entry point','Command parsing and Gateway operations'],
    'NODE-HOST':['Device nodes','Example device capability integration'],
    GATEWAY:['Gateway service','Control plane for connections, requests and events'],
    CONNECTION:['Protocol connections','Example grouping for transport and connection policies'],
    WEBSOCKET:['WebSocket connections','Client connections and lifecycle'],
    RECEIVER:['Message receiver','Receive and process connection data'],
    'ORIGIN-POLICY':['Origin policy','Connection origin checks'],
    RPC:['Request methods','Gateway request handling'],
    HEALTH:['Health checks','Status and health monitoring'],
    AGENTS:['Agent runtime','Execution loop, runtime context and tools'],
    RUNNER:['Execution loop','Example embedded Agent execution'],
    RUNTIME:['Runtime context','Runtime context and state'],
    RECOVERY:['Session recovery','Main session recovery path'],
    TOOLS:['Tool capabilities','Agent tool entry points'],
    COMPUTER:['Device operation tools','Example device tool calls'],
    SANDBOX:['Execution sandbox','Isolated tool execution'],
    CHANNELS:['Channels and plugins','Messaging core and external channel adapters'],
    'CHANNEL-CORE':['Channel core','Example grouping for ingress and transport'],
    INBOUND:['Inbound messages','Channel message ingress'],
    TRANSPORT:['Message transport','Message transport support'],
    ADAPTERS:['Channel adapters','Replaceable external channels'],
    SLACK:['Slack adapter','Slack messaging channel'],
    DISCORD:['Discord adapter','Discord messaging channel'],
    STATE:['Session and model state','Examples of sessions, memory and model failover'],
    SESSIONS:['Session management','Session index and persistent state'],
    MEMORY:['Memory retrieval','Memory and retrieval support'],
    FAILOVER:['Model failover','Example model failure recovery'],
  };
  const map=createOpenclawMap(),nodes={};
  function visit(node){
    const values=english[node.id];
    if(!values)throw new Error(`Missing OpenClaw display translation: ${node.id}`);
    nodes[node.id]={title:{source:node.title,en:values[0]},purpose:{source:node.purpose,en:values[1]}};
    node.children.forEach(visit);
  }
  visit(map.root);
  // Retained preview data also contains nodes created by manual regression runs.
  // Match authored test titles, not generated IDs; never relabel unknown content.
  const previewTitles={
    '本地回归：新增模块':'Local regression: add module',
    '回归模块：拖动后添加':'Regression module: add after dragging',
    '回归节点：拖动后添加':'Regression node: add after dragging',
    '回归模块：自动定位':'Regression module: automatic positioning',
    '回归节点：自动定位':'Regression node: automatic positioning',
    '本地测试模块':'Local test module',
    '本地测试节点':'Local test node',
    '刷新验证模块':'Refresh verification module',
    '刷新验证节点':'Refresh verification node',
    'Enter 新增验证':'Enter-to-add verification',
    '同级新增验证':'Add at current level',
  };
  function visitRetained(node){
    if(!Object.hasOwn(nodes,node.id) && Object.hasOwn(previewTitles,node.title)){
      nodes[node.id]={title:{source:node.title,en:previewTitles[node.title]}};
    }
    (node.children||[]).forEach(visitRetained);
  }
  if(currentMap.project===map.project)visitRetained(currentMap.root);
  return {projectTitle:map.project,nodes};
}
export function createOpenclawMap() {
  const node=(id,title,purpose,owns,children=[])=>({
    id,title,purpose,owns,children,kind:'module',state:'dirty',
    memories:[],ideas:[],todos:[],bugs:[],dormant:[],files:[],
    memoryDocument:`# ${title}\n\n${purpose}\n\n这是 UI Mock，不是官方模块划分、实际依赖提取或真实工作事项。\n\n参考目录：${owns.join('、') || '项目概览'}\n\n来源：[OpenClaw 固定版本](${openclawSource.repository}/tree/${openclawSource.commit})。连接表示说明性关系；并行、回流及重试用于测试绘图。`,
  });
  const clients=node('CLIENTS','接入端','控制界面、命令行与设备入口',['ui/src','src/cli','src/node-host'],[
    node('CONTROL','控制界面','浏览器工作台的示例分组',['ui/src'],[
      node('CONTROL-PAGES','界面组件','页面与复用 UI 组件',['ui/src/pages','ui/src/components']),
      node('CONTROL-API','界面接口','浏览器 API 客户端',['ui/src/api']),
    ]),
    node('CLI','命令行入口','命令解析与 Gateway 操作',['src/cli']),
    node('NODE-HOST','设备节点','设备能力接入示例',['src/node-host']),
  ]);
  const gateway=node('GATEWAY','网关服务','连接、请求与事件控制平面',['src/gateway'],[
    node('CONNECTION','协议连接','传输与连接策略的示例分组',['src/gateway/server'],[
      node('WEBSOCKET','WebSocket 连接','客户端连接与生命周期',['src/gateway/server/ws-connection.ts']),
      node('RECEIVER','消息接收','接收并处理连接数据',['src/gateway/server/ws-receiver.ts']),
      node('ORIGIN-POLICY','来源策略','连接来源检查',['src/gateway/server/ws-origin-policy.ts']),
    ]),
    node('RPC','请求方法','Gateway 请求处理',['src/gateway/server-methods']),
    node('HEALTH','健康检查','状态和健康观测',['src/gateway/health']),
  ]);
  const agents=node('AGENTS','Agent 运行时','执行循环、运行上下文与工具',['src/agents'],[
    node('RUNNER','执行循环','嵌入式 Agent 执行示例',['src/agents/embedded-agent-runner'],[
      node('RUNTIME','运行上下文','运行时上下文与状态',['src/agents/runtime']),
      node('RECOVERY','会话恢复','主会话恢复路径',['src/agents/main-session-recovery']),
    ]),
    node('TOOLS','工具能力','Agent 工具入口',['src/agents/tools'],[
      node('COMPUTER','设备操作工具','设备工具调用示例',['src/agents/tools/computer-tool.ts']),
      node('SANDBOX','执行沙箱','工具执行隔离',['src/agents/sandbox']),
    ]),
  ]);
  const channels=node('CHANNELS','通道与插件','消息核心与外部通道适配',['src/channels','extensions/slack','extensions/discord'],[
    node('CHANNEL-CORE','通道核心','接入与传输示例分组',['src/channels'],[
      node('INBOUND','入站消息','通道消息接入',['src/channels/inbound-event']),
      node('TRANSPORT','消息传输','消息传输支持',['src/channels/transport']),
    ]),
    node('ADAPTERS','通道适配器','可替换外部通道',['src/channels/plugins'],[
      node('SLACK','Slack 适配器','Slack 消息通道',['extensions/slack']),
      node('DISCORD','Discord 适配器','Discord 消息通道',['extensions/discord']),
    ]),
  ]);
  const state=node('STATE','会话与模型状态','会话、记忆及模型回退示例',['src/sessions','src/memory','src/agents/failover'],[
    node('SESSIONS','会话管理','会话索引和持久状态',['src/sessions','src/agents/sessions']),
    node('MEMORY','记忆检索','记忆与检索支持',['src/memory']),
    node('FAILOVER','模型回退','模型失败恢复示例',['src/agents/failover']),
  ]);
  gateway.children[0].children[0].bugs=[{id:'B-mock-reconnect',title:'示例：断线后重复消息',status:'open',executionMode:'manual',sessions:[]}];
  gateway.children[0].children[1].todos=[{id:'TD-mock-schema',title:'示例：补充消息校验测试',desc:'示例：补充消息校验测试',status:'pending',executionMode:'manual',sessions:[]}];
  agents.children[1].children[1].todos=[{id:'TD-mock-sandbox',title:'示例：检查沙箱权限边界',desc:'示例：检查沙箱权限边界',status:'pending',executionMode:'manual',sessions:[]}];
  const edge=(from,to,label)=>({from,to,label});
  const map={v:1,project:'OpenClaw · 多层 Mock',bootstrap:'ready',root:node('T0','OpenClaw · 多层 Mock','4 层 / 32 节点 · 说明性架构数据，非真实运行状态',[],[clients,gateway,agents,channels,state]),flows:[
    edge('CONTROL-PAGES','CONTROL-API','界面请求'),edge('CONTROL-API','WEBSOCKET','WebSocket 请求'),
    edge('CLI','WEBSOCKET','命令请求'),edge('NODE-HOST','WEBSOCKET','设备连接'),
    edge('GATEWAY','CONNECTION','连接控制'),edge('CONNECTION','WEBSOCKET','管理连接'),
    edge('WEBSOCKET','ORIGIN-POLICY','检查来源'),edge('ORIGIN-POLICY','RECEIVER','通过后接收'),
    edge('RECEIVER','RPC','请求分发'),edge('RECEIVER','HEALTH','健康请求分支'),
    edge('RPC','RUNNER','执行 Agent'),edge('RUNNER','RUNTIME','准备上下文'),
    edge('RUNTIME','SESSIONS','读取会话'),edge('RUNTIME','MEMORY','检索记忆'),
    edge('SESSIONS','TOOLS','示例：上下文汇合'),edge('MEMORY','TOOLS','示例：检索汇合'),
    edge('TOOLS','SANDBOX','隔离执行'),edge('TOOLS','COMPUTER','设备操作'),edge('COMPUTER','NODE-HOST','调用设备能力'),
    edge('SLACK','INBOUND','通道接入'),edge('DISCORD','INBOUND','通道接入'),edge('INBOUND','RPC','消息路由'),
    edge('RUNNER','TRANSPORT','发送输出'),edge('TRANSPORT','SLACK','消息投递'),edge('TRANSPORT','DISCORD','消息投递'),
    edge('RUNNER','FAILOVER','示例：模型失败'),edge('FAILOVER','RECOVERY','示例：恢复会话'),
    edge('RECOVERY','RUNNER','示例：恢复后继续'),edge('WEBSOCKET','WEBSOCKET','示例：断线重试'),
  ]};
  map.root.memoryDocument+=`\n\n根节点算第 1 层，共 5 个领域、32 个节点和 29 条显式关系。节点分类是便于 UI 验收的人工抽象，未完整分析 OpenClaw 调用链。所有 TODO/Bug 均虚构。`;
  return map;
}
