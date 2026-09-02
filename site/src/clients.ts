import { localizeData, type Language } from "./locale.ts";

export const clients = [
  {
    id: "codex-app",
    label: "Codex App",
    platform: "codex",
    app: "Codex App",
    surface: "本地项目 → 新任务 → 对话输入框",
    invocation: "使用 context-guard skill，",
    entry: "直接写出 Skill 名称，再说明本次需求。",
    pick: "输入 Skill 名称",
    projectPane: "项目任务",
  },
  {
    id: "codex-cli",
    label: "Codex CLI",
    platform: "codex",
    app: "Codex CLI",
    surface: "项目目录 → codex → 输入 $",
    invocation: "$context-guard",
    entry: "在项目目录启动 codex，输入 $ 选择 Context Guard，再说明需求。",
    pick: "选择 context-guard",
    projectPane: "项目终端",
  },
  {
    id: "cursor",
    platform: "cursor",
    label: "Cursor",
    app: "Cursor",
    surface: "打开项目 → Agent Chat → 输入 /",
    invocation: "/context-guard",
    entry: "在 Agent 输入框键入 /，选择 context-guard。",
    pick: "选择 /context-guard",
    projectPane: "项目文件",
  },
  {
    id: "claude",
    platform: "claude",
    label: "Claude Code",
    app: "Claude · Code",
    surface: "Code 标签 → 本地项目 → 输入 /",
    invocation: "/context-guard",
    entry: "在本地 Code 会话中输入 /，选择 context-guard。",
    pick: "选择 /context-guard",
    projectPane: "本地会话",
  },
] as const;

export type ClientId = (typeof clients)[number]["id"];
export type Client = (typeof clients)[number];
const localizedClients = { zh: clients, en: localizeData("en", clients) };
export const getClients = (language: Language) => localizedClients[language];
export function clientViewport(client: Client) {
  if (client.id === "codex-app") return { sourceWidth: 1280, focusPane: { x: 376, width: 768 } };
  if (client.id === "codex-cli") return { sourceWidth: 1040, focusPane: { x: 26, width: 988 } };
  return { sourceWidth: client.id === "claude" ? 640 : 1280 };
}
export const installCommand = (client: ClientId) =>
  `npx @michelj/context-guard install --platform ${clients.find((item) => item.id === client)!.platform}`;
export const invocationPrompt = (client: Client, request: string) =>
  `${client.invocation}${client.id === "codex-app" ? "" : " "}${request}`;
