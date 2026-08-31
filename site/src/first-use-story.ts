import { conversationTiming, usages, type Usage } from "./app-usage.ts";
import { localizeData, type Language } from "./locale.ts";

// 同一个示例用户、同一个项目。语言是剧本中的用户回复，不替真实用户作选择。
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
  followUp("讨论第一层", "先按开工面划分第一层，给我候选，我来选。", "建议先选这四个主干：\n工作台 · 人与 Agent 的协作界面\n冷启动 · 首次安装与初始化\n底层文件系统 · 项目记录与索引\nhook · 会话开始与结束\n\n先确认这一层，再讨论第二层。", [
    { kind: "read", text: "README.md" },
    { kind: "status", text: "候选已整理到第一层选择视图，尚未锁定。" },
  ]),
  followUp("从地图接回会话", "好，下次从工作台的第二层继续。", "已记录：第一层四个模块已确认，工作台的职责边界和下一步都留在地图中。下次回到这个项目，先读最近记录，再继续讨论第二层。", [
    { kind: "read", text: "map.json" },
    { kind: "status", text: "本次进度与下一步已记录。" },
  ]),
];

export const firstUseChapters = [
  { id: "invoke", title: "调用 Skill", detail: "说明需求，确认记录语言", kind: "app", turn: 0, duration: conversationTiming(firstUseTurns[0]).end },
  { id: "language", title: "确认语言", detail: "示例用户回复，再记录偏好", kind: "app", turn: 1, duration: conversationTiming(firstUseTurns[1]).end },
  { id: "open", title: "打开工作台", detail: "从会话进入项目画布", kind: "app", turn: 2, duration: conversationTiming(firstUseTurns[2]).end },
  { id: "empty", title: "空白项目", detail: "工作台已打开，第一层待讨论", kind: "workbench", from: 0, to: 0 },
  { id: "discuss", title: "讨论第一层", detail: "先给候选，不直接生成整棵树", kind: "app", turn: 3, duration: conversationTiming(firstUseTurns[3]).end },
  { id: "map", title: "确认并建图", detail: "挑选主干，定稿后加入", kind: "workbench", from: 1, to: 3 },
  { id: "memory", title: "留下记忆", detail: "在刚确认的模块继续协作", kind: "workbench", from: 4, to: 7 },
] as const;

// 工作台连续动作只有这份映射；跳章先恢复前置状态，连播保留原来的地图。
export const firstUseSteps = ["空白项目", "打开候选", "挑选四个主干", "定稿并加入", "进入工作台模块", "记录决定", "留下下一步", "再次查看"];
export const firstUseCaptions = [
  "工作台已打开。先回到对话，一起讨论第一层。",
  "打开刚才讨论的第一层候选。",
  "示例用户逐张选择工作台、冷启动、底层文件系统和 hook。",
  "定稿后确认加入；第一层由人锁定。",
  "进入刚刚建好的“工作台”模块。",
  "把本次确定的边界，留在这个模块。",
  "记下下一步：只细化工作台的第二层。",
  "再回来，决定和下一步仍在。后续会话从这里接上。",
];

const englishTurns: readonly Usage[] = localizeData("en", firstUseTurns).map((turn) => ({ ...turn, language: "en" }));
const localizedStories = {
  zh: { chapters: firstUseChapters, turns: firstUseTurns, steps: firstUseSteps, captions: firstUseCaptions },
  en: {
    chapters: localizeData("en", firstUseChapters).map((chapter) => chapter.kind === "app"
      ? { ...chapter, duration: conversationTiming(englishTurns[chapter.turn]).end } : chapter),
    turns: englishTurns,
    steps: localizeData("en", firstUseSteps),
    captions: localizeData("en", firstUseCaptions),
  },
};
export const getFirstUseStory = (language: Language) => localizedStories[language];
