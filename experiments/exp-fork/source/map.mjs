const node = (id, title, purpose, files, children = []) => ({ id, title, purpose, kind: children.length ? 'module' : 'work',
  state: 'untested', files, owns: files, children, memories: [], ideas: [], todos: [], bugs: [], dormant: [] });

export function codexMap(commit) {
  return { v: 1, bootstrap: 'ready', project: 'Codex CLI', flows: [], root: node('codex', 'Codex CLI',
    `OpenAI 的本地编程 Agent。先从入口了解交互方式，再沿运行循环、模型与工具、会话存储阅读。源码固定于 ${commit}；这是学习导航图，具体实现需结合引用的源码。`,
    ['README.md', 'codex-rs/Cargo.toml'], [
      node('entry', '入口与用户交互', '用户命令如何进入 Codex，以及终端界面和非交互运行的分工。', ['codex-rs/cli/src/main.rs'], [
        node('cli', '命令入口', '解析子命令，并分派到 TUI、exec、app-server 等入口。', ['codex-rs/cli/src/main.rs', 'codex-cli/bin/codex.js']),
        node('tui', '终端工作台', '终端中的输入、消息呈现、历史浏览与交互状态。', ['codex-rs/tui/src/lib.rs', 'codex-rs/tui/src/app.rs']),
        node('exec', '非交互执行', '供脚本和自动化使用的执行入口；可沿事件输出追踪一次任务。', ['codex-rs/exec/src/lib.rs']),
      ]),
      node('runtime', 'Agent 运行与分身', '一次请求如何形成 turn、调度执行，以及如何创建和管理子 Agent。', ['codex-rs/core/src/lib.rs'], [
        node('session', '会话与执行循环', '会话内状态、turn 生命周期和模型与工具的交替执行。', ['codex-rs/core/src/session/mod.rs', 'codex-rs/core/src/codex_thread.rs']),
        node('thread-manager', '会话管理', '创建、恢复和管理多个 Codex 会话的入口。', ['codex-rs/core/src/thread_manager.rs']),
        node('agents', '分身创建与控制', '子 Agent 的创建、上下文继承、控制与运行状态。', ['codex-rs/core/src/agent/control/spawn.rs', 'codex-rs/core/src/agent/types.rs']),
        node('context', '上下文组织', '系统说明、世界状态等信息如何组织为模型可用的上下文。', ['codex-rs/core/src/context/mod.rs']),
      ]),
      node('model-tools', '模型与工具', '模型请求、工具定义和工具执行环境之间的连接。', ['codex-rs/core/src/client.rs'], [
        node('model', '模型请求', '客户端请求与响应处理，以及模型服务通信。', ['codex-rs/core/src/client.rs', 'codex-rs/core/src/model_request.rs', 'codex-rs/codex-api/src/lib.rs']),
        node('tools', '工具系统', '工具实现及注册组织；从这里定位某个模型工具的执行逻辑。', ['codex-rs/tools/README.md', 'codex-rs/tools/src/lib.rs']),
        node('execution', '命令与补丁', '命令运行、执行服务和 apply-patch 的实现边界。', ['codex-rs/exec-server/src/lib.rs', 'codex-rs/apply-patch/src/lib.rs']),
        node('mcp', 'MCP 与扩展', '外部工具连接和技能扩展的相关组件。', ['codex-rs/rmcp-client/src/lib.rs', 'codex-rs/skills/src/lib.rs']),
      ]),
      node('history', '历史与上下文存储', '运行记录、历史查询、会话 fork 和长期记忆。', ['codex-rs/thread-store/README.md'], [
        node('rollout', '运行记录 Rollout', '会话事件的持久化记录与加载。', ['codex-rs/rollout/src/recorder.rs', 'codex-rs/rollout/src/lib.rs']),
        node('fork', '前缀引用 Fork', '分页历史分支的具体实现；重点阅读固定历史边界和父子记录关系。', ['codex-rs/thread-store/src/local/paginated_fork.rs', 'codex-rs/thread-store/README.md']),
        node('state', '状态数据库', '会话索引和持久状态的数据库层。', ['codex-rs/state/src/lib.rs']),
        node('memory', '长期记忆', '记忆读写相关组件的职责与入口。', ['codex-rs/memories/README.md']),
      ]),
      node('policy', '配置与权限', '配置加载、执行策略和不同平台的隔离边界。', ['codex-rs/config/src/lib.rs'], [
        node('config', '配置与身份', '配置结构、模型服务选择和登录相关入口。', ['codex-rs/config/src/lib.rs', 'codex-rs/login/src/lib.rs']),
        node('sandbox', '沙箱与执行策略', '命令许可、沙箱选择和网络代理相关实现。', ['codex-rs/execpolicy/src/lib.rs', 'codex-rs/sandboxing/src/lib.rs', 'codex-rs/network-proxy/src/lib.rs']),
      ]),
      node('integration', '应用接口与 SDK', '外部客户端如何调用和订阅 Codex 会话。', ['codex-rs/app-server/README.md'], [
        node('server', 'App Server', '面向客户端的服务入口、请求处理和事件发送。', ['codex-rs/app-server/src/lib.rs', 'codex-rs/app-server/README.md']),
        node('protocol', '会话协议', 'thread 与 turn 等接口的数据类型和对外契约。', ['codex-rs/app-server-protocol/src/protocol/v2/thread.rs', 'codex-rs/protocol/src/protocol.rs']),
        node('sdk', 'TypeScript 与 Python SDK', 'SDK 的使用入口与线程抽象。', ['sdk/typescript/README.md', 'sdk/typescript/src/thread.ts', 'sdk/python/README.md']),
      ]),
    ]) };
}
