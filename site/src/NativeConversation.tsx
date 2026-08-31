import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion, useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import { Icon } from "./components";
import { invocationPrompt, type Client } from "./clients";
import { typedText, conversationTiming, type Usage } from "./app-usage";
import { CodexCliConversation } from "./CodexCliConversation";
import { CodexChromeIcon } from "./CodexChromeIcon";
import { useLanguage } from "./i18n";

function requestFor(client: Client, usage: Usage) {
  return usage.continuation ? usage.request : invocationPrompt(client, usage.request);
}

function inputFor(client: Client, usage: Usage, elapsed: number) {
  const timing = conversationTiming(usage, client);
  return usage.continuation ? typedText(usage.request, elapsed, timing.typing, timing.textInterval)
    : typedText(client.invocation, elapsed, timing.command, timing.commandInterval)
      + typedText(requestFor(client, usage).slice(client.invocation.length), elapsed, timing.typing, timing.textInterval);
}

// 只在字符或可见阶段变化时更新对话；静态窗口不跟着每个 rAF 重渲染。
export function conversationFrameKey(client: Client, usage: Usage, elapsed: number) {
  const timing = conversationTiming(usage, client);
  return [
    inputFor(client, usage, elapsed).length,
    typedText(usage.response, elapsed, timing.response, timing.textInterval).length,
    elapsed >= timing.selected, elapsed >= timing.sent, elapsed >= timing.response, elapsed >= timing.result,
    Math.max(0, Math.min(usage.activity.length, Math.floor((elapsed - timing.reading) / timing.activityInterval) + 1)),
    client.id === "codex-cli" ? `${typedText("codex", elapsed, 160, 55).length}:${elapsed >= 620}` : "",
  ].join(":");
}

type ConversationProps = {
  client: Client;
  usage: Usage;
  history?: readonly Usage[];
  workbenchLink?: boolean;
  linkPointer?: ReactNode;
  onSeek: (at: number) => void;
  onOpen: () => void;
};

export function AnimatedNativeConversation({ clock, resetToken = 0, reduced = false, ...props }: ConversationProps & {
  clock: MotionValue<number>; resetToken?: number; reduced?: boolean;
}) {
  const [frame, setFrame] = useState({ usage: props.usage, resetToken, elapsed: clock.get() });
  const elapsed = frame.usage === props.usage && frame.resetToken === resetToken
    ? frame.elapsed : reduced ? conversationTiming(props.usage, props.client).end : 0;
  const lastFrame = useRef("");
  const container = useRef<HTMLDivElement>(null);
  const previousScrollTime = useRef(clock.get());
  // 换轮次时保留 DOM 与滚动位置，尚未发送的消息不占据聊天区。
  useLayoutEffect(() => {
    lastFrame.current = "";
    setFrame({ usage: props.usage, resetToken, elapsed: reduced ? conversationTiming(props.usage, props.client).end : 0 });
  }, [props.usage, resetToken, reduced]);
  useMotionValueEvent(clock, "change", (current) => {
    const next = conversationFrameKey(props.client, props.usage, current);
    if (next !== lastFrame.current) {
      lastFrame.current = next;
      setFrame({ usage: props.usage, resetToken, elapsed: current });
    }
  });
  function followScroll(now: number) {
    const scroll = container.current?.querySelector<HTMLElement>(".native-chat-content");
    if (!scroll) return;
    const target = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    // 连续跟随新增行，不为每个字符重启一次滚动补间。
    const delta = Math.min(80, Math.max(0, now - previousScrollTime.current));
    previousScrollTime.current = now;
    scroll.scrollTop = reduced ? target : scroll.scrollTop + (target - scroll.scrollTop) * (1 - Math.exp(-delta / 95));
  }
  useMotionValueEvent(clock, "change", followScroll);
  useLayoutEffect(() => {
    const flow = container.current?.querySelector<HTMLElement>(".native-chat-flow");
    const scroll = container.current?.querySelector<HTMLElement>(".native-chat-content");
    const observer = new ResizeObserver(() => followScroll(clock.get()));
    if (flow) observer.observe(flow);
    if (scroll) observer.observe(scroll);
    followScroll(clock.get());
    return () => observer.disconnect();
  }, [clock, reduced]);
  return <div className="native-conversation" ref={container}><NativeConversation {...props} elapsed={elapsed}
    linkPointer={props.workbenchLink ? <NativeLinkPointer clock={clock} starts={conversationTiming(props.usage, props.client).result} /> : undefined} /></div>;
}

function NativeLinkPointer({ clock, starts }: { clock: MotionValue<number>; starts: number }) {
  const move = (value: number) => Math.min(1, Math.max(0, (value - starts - 80) / 520));
  const x = useTransform(clock, (value) => 65 * (1 - move(value)));
  const y = useTransform(clock, (value) => 40 * (1 - move(value)));
  const opacity = useTransform(clock, (value) => value >= starts + 80 ? 1 : 0);
  const scale = useTransform(clock, (value) => value >= starts + 640 && value < starts + 780 ? .82 : 1);
  return <motion.svg className="native-link-pointer" width="22" height="28" viewBox="0 0 24 30" fill="none" style={{ x, y, opacity, scale }} aria-hidden="true">
    <path d="M3 2L20 17L12 18L8 26L3 2Z" fill="#171717" stroke="#eee" strokeWidth="1.6" strokeLinejoin="round" />
  </motion.svg>;
}

function AttachIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m8 14 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10a2 2 0 0 1 3 3L7 15" /></svg>;
}

function MicrophoneIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v3M9 21h6" /></svg>;
}

function Activity({ client, item, shown = true }: { client: Client; item: Usage["activity"][number]; shown?: boolean }) {
  return <div className={item.kind === "status" ? "native-process-note" : "native-tool-read"} data-shown={shown}>
    {item.kind === "status" ? item.text : <><Icon name="chevron" size={11} />
      {item.kind === "command" ? "Run" : client.id === "cursor" ? "Explored" : "Read"} <code>{item.text}</code></>}
  </div>;
}

const ConversationExchange = memo(function ConversationExchange({ client, usage, elapsed, current, workbenchLink, linkPointer, onOpen }: {
  client: Client; usage: Usage; elapsed: number; current: boolean;
  workbenchLink?: boolean; linkPointer?: ReactNode; onOpen: () => void;
}) {
  const { t } = useLanguage();
  const timing = conversationTiming(usage, client);
  if (elapsed < timing.sent) return null;
  return <div className="native-conversation-turn" data-current-turn={current || undefined}>
    <div className="native-message-user">{requestFor(client, usage)}</div>
    <div className="native-message-assistant">
      {usage.activity.map((item, index) => elapsed >= timing.reading + index * timing.activityInterval
        && <Activity key={item.text} client={client} item={item} />)}
      {elapsed >= timing.response && <p>{typedText(usage.response, elapsed, timing.response, timing.textInterval)}</p>}
      {(usage.opensWorkbench || workbenchLink) && elapsed >= timing.result && <button type="button" className="native-workbench-link"
        onClick={onOpen}>{t("打开当前项目工作台")} ↗{current && linkPointer}</button>}
    </div>
  </div>;
});

export function NativeConversation({ client, usage, elapsed, history = [], workbenchLink, linkPointer, onSeek, onOpen }: ConversationProps & { elapsed: number }) {
  const { t } = useLanguage();
  if (client.id === "codex-cli") return <CodexCliConversation client={client} usage={usage} history={history} elapsed={elapsed} onSeek={onSeek} onOpen={onOpen} />;
  const timing = conversationTiming(usage, client);
  const sent = elapsed >= timing.sent;
  const selected = elapsed >= timing.selected;
  const prompt = requestFor(client, usage);
  const placeholder = client.id === "cursor" ? "Plan, Build, / for skills, @ for context"
    : client.id === "codex-app" ? t("随心输入") : "Type / for commands";
  const invocation = typedText(client.invocation, elapsed, timing.command, timing.commandInterval);
  const showMenu = !usage.continuation && client.id === "cursor" && Boolean(invocation) && !selected;
  // 命令和后续需求都逐字输入；阶段切换不能补入未打完的命令。
  const request = inputFor(client, usage, elapsed);

  return <>
    <div className="native-chat-content">
      <div className="native-chat-flow">
        {[...history, usage].map((turn, index) => <ConversationExchange key={turn.title} client={client} usage={turn}
          current={index === history.length} elapsed={index === history.length ? elapsed : conversationTiming(turn, client).end}
          workbenchLink={index === history.length && workbenchLink} linkPointer={linkPointer} onOpen={onOpen} />)}
      </div>
    </div>
    <div className="native-composer">
      {client.id === "cursor" && <div className="native-skill-menu" data-shown={showMenu} inert={!showMenu}>
        <div className="native-skill-menu-heading">Skills</div>
        <button type="button" className="native-skill-menu-item is-selected" onClick={() => onSeek(invocation === client.invocation ? timing.selected : elapsed)}>
          <span><strong>/context-guard</strong><small>Keep folder-scoped project memory</small></span>
        </button>
      </div>}
      <div className="native-input-area" role="textbox" aria-label={client.app + " " + t("演示输入框")} aria-readonly="true">
        {sent || !request ? <span className="native-placeholder">{placeholder}</span> : request}
        {!sent && request && <span className="native-caret" aria-hidden="true" />}
      </div>
      <div className="native-composer-toolbar">
        {client.id === "cursor" ? <>
          <span className="native-mode" aria-hidden="true">∞ Agent⌄</span>
          <span aria-hidden="true">Cursor Grok 4.6 High⌄</span>
          <span className="native-toolbar-spacer" />
          <span aria-hidden="true"><AttachIcon /></span>
        </> : client.id === "codex-app" ? <>
          <span aria-hidden="true"><Icon name="plus" size={17} /></span>
          <span className="codex-permission" aria-hidden="true"><CodexChromeIcon name="shield" size={15} />{t("完全访问")}</span>
          <span className="native-toolbar-spacer" /><span className="codex-model" aria-hidden="true">5.6 Sol <span>Ultra</span>⌄</span>
          <span aria-hidden="true"><MicrophoneIcon /></span>
        </> : <>
          <span aria-hidden="true">Auto accept edits⌄</span>
          <span aria-hidden="true"><AttachIcon /></span><span aria-hidden="true">＋</span><span aria-hidden="true"><MicrophoneIcon /></span>
          <span className="native-toolbar-spacer" />
          <span aria-hidden="true">Opus 4.6⌄</span>
        </>}
        {request && !sent ? <button type="button" className="native-composer-send" aria-label={t("演示发送请求")} disabled={request !== prompt}
          onClick={() => onSeek(timing.sent)}><Icon name="arrow" size={15} /></button>
          : client.id === "codex-app" ? <span className={`native-input-idle codex-input-state${sent && elapsed < timing.result ? " is-running" : ""}`} aria-hidden="true">
            {sent && elapsed < timing.result ? <span className="codex-stop-square" /> : <Icon name="arrow" size={15} />}
          </span> : <span className="native-input-idle" aria-hidden="true">{client.id === "cursor" ? <MicrophoneIcon /> : "◔"}</span>}
      </div>
    </div>
  </>;
}
