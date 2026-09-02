import type { WorkbenchChapterId } from "./storyboard";
import type { Client } from "./clients";
import { localizeData, type Language } from "./locale.ts";

export type Usage = {
  id: "first" | "resume" | "debug";
  title: string;
  detail: string;
  request: string;
  activity: readonly { kind: "read" | "status" | "command"; text: string }[];
  response: string;
  resultTitle: string;
  result: string;
  linkLabel: string;
  target: "#workbench" | "#debug";
  chapter?: WorkbenchChapterId;
  continuation?: boolean;
  opensWorkbench?: boolean;
  language?: Language;
};

// 对话内容均为公开示例，行为依据仓库 SKILL.md；不执行 Agent 请求。
export const usages: readonly Usage[] = [
  {
    id: "first",
    title: "第一次使用",
    detail: "完整流程，也可分章查看",
    request: "了解这个项目，先和我确定第一层架构。",
    activity: [{ kind: "read", text: "preferences.json" }, { kind: "status", text: "先确认项目记录语言。" }],
    response: "开始前，项目上下文用中文还是 English 记录？确认后，再一起讨论第一层模块。",
    resultTitle: "语言确认后，再逐层建图",
    result: "Agent 提出第一层候选，你来确认；不会直接锁定整棵架构树。",
    linkLabel: "体验逐层建图",
    target: "#workbench",
    chapter: "map",
  },
  {
    id: "resume",
    title: "接续上次工作",
    detail: "同一个项目，新一段对话",
    request: "继续这个项目。先回顾上次进度、未完成事项和下一步。",
    activity: [{ kind: "read", text: "FIND.md" }, { kind: "read", text: "sessions.jsonl" }, { kind: "status", text: "只读最近记录，再按需打开命中项。" }],
    response: "上次已确认四个第一层模块，并在“工作台”留下了职责边界和下一步。接下来先讨论工作台的第二层，再逐层确认。",
    resultTitle: "从项目记录接着做",
    result: "先查小索引，再读命中的记录；不需要加载全部聊天历史。",
    linkLabel: "查看项目记忆",
    target: "#workbench",
    chapter: "memory",
  },
  {
    id: "debug",
    title: "反馈与排查 Bug",
    detail: "描述现象，保留排查依据",
    request: "切换模块后内容没有更新。先记录这个问题，再查已有坏例和相关模块，确认复现后排查。",
    activity: [{ kind: "status", text: "先记录已报告的现象，原因待确认。" }, { kind: "read", text: "bugs-index.json" }, { kind: "read", text: "owns-index.json" }],
    response: "先把切换后的异常记为坏例，原因标为待确认。接着检索已有经验、定位相关模块，再复现、修复和验证。",
    resultTitle: "问题有记录，排查有来路",
    result: "工作台可查看、关联和处理 Bug 条目；勾选状态不等于代码已经修复。",
    linkLabel: "体验工作台 Debug",
    target: "#debug",
  },
];

const localizedUsages: Record<Language, readonly Usage[]> = {
  zh: usages,
  en: localizeData("en", usages).map((usage) => ({ ...usage, language: "en" })),
};
export const getUsages = (language: Language) => localizedUsages[language];

const conversationPace = {
  cameraStart: 150,
  cameraFrequency: 10,
  replyCameraDelay: 1000,
  replyCameraFrequency: 6,
  replyContentDelay: 600,
  command: 280,
  commandInterval: 28,
  textInterval: 24,
  activityInterval: 180,
} as const;

export type ConversationTiming = { [K in keyof typeof conversationPace]: number } & {
  selected: number; typing: number; inputComplete: number; sent: number; replyCameraAt: number; reading: number;
  response: number; result: number; end: number;
};

export function conversationTiming(usage: Usage, client?: Client): ConversationTiming {
  // 英文用更多字符表达同一内容；字符节奏单独适配，动作仍等待整句完成。
  const textInterval = usage.language === "en" ? 14 : conversationPace.textInterval;
  const command = usage.continuation ? 180 : client?.id === "codex-cli" ? 800 : conversationPace.command;
  const selected = usage.continuation ? 0 : command + (client?.invocation ?? "/context-guard").length * conversationPace.commandInterval + 100;
  const typing = usage.continuation ? command : selected + 100;
  // 动作跟随文字完成时间，不让短回复也等待固定的长片段结束。
  const inputComplete = typing + (Array.from(usage.request).length + (usage.continuation ? 0 : 1)) * textInterval;
  const sent = inputComplete + 180;
  // 最后一个字符出现后保留完整一秒，再缓慢从输入区移向回复区。
  const replyCameraAt = inputComplete + conversationPace.replyCameraDelay;
  const reading = replyCameraAt + conversationPace.replyContentDelay;
  const response = reading + Math.max(0, usage.activity.length - 1) * conversationPace.activityInterval + 180;
  const result = response + Array.from(usage.response).length * textInterval + 120;
  const hold = usage.opensWorkbench ? 1000 : Math.max(700, Math.min(1200, usage.response.length * 8));
  return { ...conversationPace, textInterval, command, selected, typing, inputComplete, sent, replyCameraAt, reading, response, result, end: result + hold };
}

export const usageTiming = conversationTiming(usages[0]);

export function typedText(text: string, elapsed: number, start: number, speed: number = usageTiming.textInterval) {
  return Array.from(text).slice(0, Math.max(0, Math.floor((elapsed - start) / speed))).join("");
}
