import type { ReactNode } from "react";
import type { Client } from "./clients";
import "./native-client.css";
import { CursorFrame } from "./CursorFrame";
import { CodexAppFrame } from "./CodexAppFrame";
import { CodexCliFrame } from "./CodexCliFrame";

type NativeIconName = "folder" | "close";

function NativeIcon({ name, size = 14 }: { name: NativeIconName; size?: number }) {
  const paths: Record<NativeIconName, ReactNode> = {
    folder: <path d="M3 6h7l2 2h9v12H3z" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function ClaudeFrame({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="native-client-frame native-claude">
      <div className="native-claude-titlebar" aria-hidden="true">
        <span className="native-claude-sidebar-toggle">≡</span>
        <NativeIcon name="folder" size={14} />
        <span>demo-project</span><span className="native-claude-title-separator">/</span><span className="native-claude-session-title">{title}</span>
        <span className="native-claude-close"><NativeIcon name="close" size={13} /></span>
      </div>
      <div className="native-chat-slot" data-native-chat>{children}</div>
    </div>
  );
}

export function NativeClientFrame({ client, children, title }: { client: Client; children: ReactNode; title: string }) {
  if (client.id === "cursor") return <CursorFrame title={title}>{children}</CursorFrame>;
  if (client.id === "claude") return <ClaudeFrame title={title}>{children}</ClaudeFrame>;
  if (client.id === "codex-app") return <CodexAppFrame title={title}>{children}</CodexAppFrame>;
  if (client.id === "codex-cli") return <CodexCliFrame>{children}</CodexCliFrame>;
  return null;
}
