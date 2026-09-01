import { conversationTiming, typedText, type Usage } from "./app-usage";
import { invocationPrompt, type Client } from "./clients";
import { useLanguage } from "./i18n";

// CLI 的字形、会话头与选择提示对照 rust-v0.151.0 的 TUI 快照。
// 只渲染同一时钟派生的文本，不启动终端或 CLI 进程。
export function CodexCliConversation({ client, usage, history, elapsed, onSeek, onOpen }: {
  client: Client; usage: Usage; history: readonly Usage[]; elapsed: number;
  onSeek: (at: number) => void; onOpen: () => void;
}) {
  const { t } = useLanguage();
  const timing = conversationTiming(usage, client);
  const launching = !usage.continuation && elapsed < 620;
  const sent = elapsed >= timing.sent;
  const invocation = usage.continuation ? "" : typedText(client.invocation, elapsed, timing.command, timing.commandInterval);
  const prompt = usage.continuation ? usage.request : invocationPrompt(client, usage.request);
  const input = usage.continuation ? typedText(usage.request, elapsed, timing.typing, timing.textInterval)
    : invocation + typedText(" " + usage.request, elapsed, timing.typing, timing.textInterval);
  const picker = Boolean(invocation) && elapsed < timing.selected;
  return <>
    <div className="native-chat-content">
      <div className="native-chat-flow">
        <div className="cli-shell-line"><span>PS E:\demo-project&gt; </span>{usage.continuation ? "codex" : typedText("codex", elapsed, 160, 55)}{launching && <b className="cli-block-caret" />}</div>
        {!launching && <>
          <div className="cli-session-header"><strong>&gt;_ OpenAI Codex <span>(v0.151.0)</span></strong><br />
            <div><span>model:　　</span>gpt-5.6　<span>/model to change</span></div>
            <div><span>directory:</span> E:\demo-project</div>
          </div>
          {[...history, usage].map((turn, index) => {
            const current = index === history.length;
            const times = conversationTiming(turn, client);
            const at = current ? elapsed : times.end;
            if (at < times.sent) return null;
            return <div className="native-conversation-turn cli-exchange" data-current-turn={current || undefined} key={turn.title}>
              <div className="cli-request"><span>›</span>{turn.continuation ? turn.request : invocationPrompt(client, turn.request)}</div>
              <div className="cli-reply">
                {turn.activity.map((item, i) => at >= times.reading + i * times.activityInterval && <div className="cli-activity" key={item.text}>
                  <span>•</span>{item.kind === "read" ? "Explored " : item.kind === "command" ? "Ran " : ""}{item.text}
                </div>)}
                {at >= times.response && <div className="cli-answer"><span>•</span><p>{typedText(turn.response, at, times.response, times.textInterval)}</p></div>}
                {turn.opensWorkbench && at >= times.result && <button type="button" className="native-workbench-link" onClick={onOpen}>{t("打开当前项目工作台")} ↗</button>}
              </div>
            </div>;
          })}
        </>}
      </div>
    </div>
    {!launching && <div className="native-composer cli-composer">
      <div className="cli-prompt"><span>›</span><div className="native-input-area" role="textbox" aria-label={"Codex CLI " + t("演示输入框")} aria-readonly="true">
        {sent ? <span className="native-placeholder">Ask for follow-up changes</span> : input}<b className="cli-block-caret" />
      </div></div>
      {picker ? <div className="cli-skill-picker">
        <button type="button" onClick={() => onSeek(timing.selected)} disabled={invocation !== client.invocation}>
          <strong>context-guard</strong><span>[Skill] Keep folder-scoped project memory</span>
        </button>
        <p>Press enter to insert or esc to close</p>
      </div> : <div className="cli-footer">
        <span>{sent && elapsed < timing.result ? "• Working" : "? for shortcuts"}</span>
        {!sent && input === prompt && <button type="button" onClick={() => onSeek(timing.sent)} aria-label={t("演示发送请求")}>enter ↵</button>}
      </div>}
    </div>}
  </>;
}
