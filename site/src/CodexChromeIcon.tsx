// 桌面窗口里的静态控件；不连接宿主 App。
export function CodexChromeIcon({ name, size = 16 }: {
  name: "panel" | "bell" | "compose" | "chat" | "folder" | "share" | "voice" | "shield";
  size?: number;
}) {
  const paths = {
    panel: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM9 4v16",
    bell: "M9 20h6M5 16h14l-2-3V9a5 5 0 0 0-10 0v4ZM12 2v2",
    compose: "M12 4H6a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3v-6M14 4l3 3M9 15l4-1 8-8a2.1 2.1 0 0 0-3-3l-8 8Z",
    chat: "M8 19l-5 2 1-5a9 9 0 1 1 4 3ZM8 11h8M12 7v8",
    folder: "M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8ZM3 10h18",
    share: "M12 15V3m-4 4 4-4 4 4M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6",
    voice: "M3 10v4M7 6v12M11 3v18M15 8v8M19 5v14M23 10v4",
    shield: "M12 3 4 6v6c0 4 4 7 8 9 4-2 8-5 8-9V6ZM12 8v5m0 3v.1",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
