import { conversationTiming, usages, type Usage } from "./app-usage.ts";
import { localizeData, type Language } from "./locale.ts";

// 同一个示例用户、同一个项目。Cursor 在窗口内接续工作台，其他客户端仍使用独立工作台页。
const first = usages[0];
function followUp(id: string, request: string, response: string, activity: Usage["activity"]): Usage {
  return { ...first, title: id, continuation: true, request, response, activity };
}

export const firstUseTurns: readonly Usage[] = [
  first,
  followUp("确认记录语言", "用中文记录。", "已设为中文，后续沿用这个项目的记录语言。接下来可以打开工作台，一起讨论第一层。", [
    { kind: "command", text: 'context-guard set-language --root "." --language zh' },
  ]),
  { ...followUp("打开工作台", "打开当前项目的工作台。", "工作台已准备好。先打开它；第一层还没有确认，画布从项目根节点开始。", [
    { kind: "status", text: "检查当前项目与本次会话的工作台地址。" },
    { kind: "command", text: 'context-guard workbench --root "."' },
  ]), opensWorkbench: true },
];

export const firstUseChapters = [
  { id: "invoke", title: "调用 Skill", detail: "说明需求，确认记录语言", kind: "app", turn: 0, duration: conversationTiming(firstUseTurns[0]).end },
  { id: "language", title: "确认语言", detail: "示例用户回复，再记录偏好", kind: "app", turn: 1, duration: conversationTiming(firstUseTurns[1]).end },
  { id: "prepare", title: "准备工作台", detail: "从当前客户端继续打开工作台", kind: "app", turn: 2, duration: conversationTiming(firstUseTurns[2]).end },
] as const;

const englishTurns: readonly Usage[] = localizeData("en", firstUseTurns).map((turn) => ({ ...turn, language: "en" }));
const localizedStories = {
  zh: { chapters: firstUseChapters, turns: firstUseTurns },
  en: {
    chapters: localizeData("en", firstUseChapters).map((chapter) => ({
      ...chapter,
      duration: conversationTiming(englishTurns[chapter.turn]).end,
    })),
    turns: englishTurns,
  },
};
export const getFirstUseStory = (language: Language) => localizedStories[language];
