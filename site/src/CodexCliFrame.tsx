import type { ReactNode } from "react";
import "./codex-client.css";

export function CodexCliFrame({ children }: { children: ReactNode }) {
  return <div className="native-client-frame native-codex-cli">
    <div className="codex-terminal-bar" aria-hidden="true"><span>›_　PowerShell　×</span><span>＋　⌄</span><span>−　 □　 ×</span></div>
    <div className="native-chat-slot" data-native-chat>{children}</div>
  </div>;
}
