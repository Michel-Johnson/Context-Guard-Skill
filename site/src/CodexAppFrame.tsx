import type { ReactNode } from "react";
import { Icon } from "./components";
import { CodexChromeIcon } from "./CodexChromeIcon";
import { useLanguage } from "./i18n";
import "./codex-client.css";

// 对照 26.825.5331.0 的本机窗口截图（96 DPI）与只读布局资源。
// 采用工作区面板关闭的会话布局；项目、任务和用户均为虚构数据。
export function CodexAppFrame({ children, title }: { children: ReactNode; title: string }) {
  const { t } = useLanguage();
  return <div className="native-client-frame native-codex-app">
    <div className="codex-window-bar" aria-hidden="true">
      <CodexChromeIcon name="panel" size={15} /><Icon name="back" size={16} /><span className="codex-forward"><Icon name="arrow" size={16} /></span>
      <span>{t("文件")}</span><span>{t("编辑")}</span><span>{t("视图")}</span><span>{t("帮助")}</span>
      <div className="codex-window-actions"><span>−</span><span>□</span><span>×</span></div>
    </div>
    <div className="codex-app-body">
      <aside className="codex-app-sidebar" aria-label={t("演示项目与任务")}>
        <div className="codex-sidebar-heading" aria-hidden="true">
          <strong>Codex <span>⌄</span></strong><Icon name="search" size={15} /><CodexChromeIcon name="bell" size={15} />
        </div>
        <div className="codex-new-chat" aria-hidden="true"><CodexChromeIcon name="compose" size={15} />{t("新对话")}<CodexChromeIcon name="chat" size={14} /></div>
        <div className="codex-project"><CodexChromeIcon name="folder" size={15} />demo-project</div>
        <div className="codex-task is-current">{title}</div>
        <div className="codex-sidebar-bottom" aria-hidden="true"><span className="codex-profile">C</span><span>{t("演示用户")}</span><span className="codex-voice"><CodexChromeIcon name="voice" size={17} />{t("语音")}</span></div>
      </aside>
      <div className="codex-app-main">
        <div className="codex-task-toolbar"><CodexChromeIcon name="folder" size={16} /><strong>{title}</strong><span aria-hidden="true">⋯</span>
          <div className="codex-task-actions" aria-hidden="true"><span><CodexChromeIcon name="share" size={15} />{t("分享")}</span><Icon name="settings" size={16} /></div>
        </div>
        <div className="native-chat-slot" data-native-chat>{children}</div>
      </div>
    </div>
  </div>;
}
