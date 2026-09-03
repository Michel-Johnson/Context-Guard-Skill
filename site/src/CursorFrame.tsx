import type { ReactNode } from "react";
import { CursorIcon, CursorPanelIcon } from "./CursorIcon";

const shortcuts = [
  ["New Agent", ["Ctrl", "Shift", "L"]],
  ["Show Terminal", ["Ctrl", "J"]],
  ["Search Files", ["Ctrl", "P"]],
  ["Open Browser", ["Ctrl", "Shift", "B"]],
  ["Maximize Chat", ["Ctrl", "Alt", "E"]],
  ["Add Folder", ["Ctrl", "Alt", "A"]],
] as const;

function CursorWatermark() {
  return <div className="native-cursor-watermark">
    <CursorIcon name="cursor" size={80} className="native-cursor-letterpress" />
    <div className="native-cursor-shortcuts">
      {shortcuts.map(([label, keys]) => <div className="native-cursor-shortcut" key={label}>
        <span>{label}</span><span className="native-cursor-keybinding">{keys.map((key, index) =>
          <span key={key}>{index > 0 && <span className="native-cursor-key-plus">+</span>}<kbd>{key}</kbd></span>)}</span>
      </div>)}
    </div>
  </div>;
}

export function CursorFrame({ children, title, workspace }: { children: ReactNode; title: string; workspace?: ReactNode }) {
  return <div className="native-client-frame native-cursor">
    <div className="native-cursor-menubar" aria-hidden="true">
      <CursorIcon name="cursor" size={13} className="native-cursor-mark" />
      <div className="native-cursor-menu-items">{["File", "Edit", "Selection", "View", "Go", "Run", "Terminal", "Help"].map((label) => <span key={label}>{label}</span>)}</div>
      <div className="native-cursor-title-navigation"><CursorPanelIcon side="left" /><CursorIcon name="arrow-left" /><CursorIcon name="arrow-right" className="is-muted" /></div>
      <span className="native-cursor-window-title">demo-project - Cursor</span>
      <div className="native-cursor-title-tools"><CursorPanelIcon side="bottom" /><CursorIcon name="chat" /><CursorIcon name="settings-gear" />
        <span className="native-cursor-agents-window">Agents Window <CursorIcon name="arrow-up-right" size={11} /></span>
      </div>
      <div className="native-cursor-window-actions">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 5h8" /></svg>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1h8v8H1z" /></svg>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="m1 1 8 8M9 1 1 9" /></svg>
      </div>
    </div>
    <div className={`native-cursor-body${workspace ? " has-workbench" : ""}`}>
      <aside className="native-cursor-explorer" aria-hidden="true">
        <div className="native-cursor-activity">
          <span className="is-selected"><CursorIcon name="files" size={15} /></span><span><CursorIcon name="search" size={15} /></span>
          <span><CursorIcon name="source-control" size={15} /></span><span><CursorIcon name="extensions" size={15} /></span><span><CursorIcon name="chevron-down" size={13} /></span>
        </div>
        <div className="native-cursor-project"><CursorIcon name="chevron-down" size={12} /><strong>DEMO-PROJECT</strong></div>
        <div className="native-cursor-tree">
          {[".codex", ".cursor", "src"].map((folder) => <span key={folder}><CursorIcon name="chevron-right" size={12} /><span>{folder}</span></span>)}
          <span className="native-cursor-file"><CursorIcon name="readme" size={14} /><span>README.md</span></span>
        </div>
        <div className="native-cursor-outline"><span><CursorIcon name="chevron-right" size={12} />OUTLINE</span><span><CursorIcon name="chevron-right" size={12} />TIMELINE</span></div>
      </aside>
      {workspace ? <div className="native-cursor-workbench">{workspace}</div> : <>
      <div className="native-cursor-editor" aria-hidden="true"><CursorWatermark /></div>
      <div className="native-cursor-chat" data-native-chat>
        <div className="native-cursor-chat-tabs" aria-hidden="true">
          <span className="native-cursor-active-tab"><CursorIcon name="chat" size={13} /><span>{title}</span><CursorIcon name="close" size={13} /></span>
          <div className="native-cursor-chat-actions"><CursorIcon name="add-two" size={14} /><CursorIcon name="history-two" size={14} /><CursorIcon name="ellipsis-two" size={14} /><CursorPanelIcon side="right" /></div>
        </div>
        <div className="native-chat-slot">{children}</div>
      </div>
      </>}
    </div>
    <div className="native-cursor-status" aria-hidden="true">
      <CursorIcon name="remote" size={13} /><span>demo-project</span><span className="native-cursor-problems"><CursorIcon name="error" size={12} />0<CursorIcon name="warning" size={12} />0</span>
      <span className="native-cursor-status-right">Cursor Tab</span><CursorIcon name="bell-dot" size={12} />
    </div>
  </div>;
}
