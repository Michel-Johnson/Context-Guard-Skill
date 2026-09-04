import { localizeData, type Language } from "./locale.ts";

export const repository =
  "https://github.com/Michel-Johnson/Context-Guard-Skill";
export const chapters = [
  {
    id: "explore",
    label: "项目地图",
    steps: ["项目总览", "进入工作台", "进入前端设计", "返回总览"],
    captions: [
      "从一张地图，看清项目。",
      "进入模块，找到相关记忆。",
      "继续下钻，定位开工的位置。",
      "沿面包屑，回到全局。",
    ],
  },
  {
    id: "memory",
    label: "记忆与想法",
    steps: ["查看记忆", "写入记忆", "添加想法", "再次查看"],
    captions: [
      "决定和想法，跟着模块走。",
      "在原位写下这一次的决定。",
      "留下一个下次可以继续的想法。",
      "再回来，记录还在这里。",
    ],
  },
  {
    id: "relations",
    label: "模块关系",
    steps: ["项目总览", "打开关系", "选择模块", "进入模块"],
    captions: [
      "不只看到模块，也看到联系。",
      "打开关系模式。",
      "点选模块，突出生产与消费关系。",
      "确认关联，再进入模块。",
    ],
  },
  {
    id: "map",
    label: "逐层建图",
    steps: ["空白项目", "打开候选", "挑选四个主干", "定稿并加入"],
    captions: [
      "从第一层开始，和 Agent 一起划分。",
      "候选摆在画布上，等待你的选择。",
      "逐个选入四张主干卡片。",
      "通过校验，确认这一层。",
    ],
  },
  {
    id: "proposals",
    label: "提议确认",
    steps: ["待定提议", "查看提议", "加入工作台", "隐藏另一提议"],
    captions: [
      "Agent 提议，你来决定。",
      "先看职责，再决定是否加入。",
      "加入工作台，进入下一层。",
      "暂不需要的提议，收进已取消。",
    ],
  },
  {
    id: "auth",
    label: "会话范围",
    steps: ["当前范围", "开启授权", "选择工作台", "取消选择"],
    captions: [
      "看清本次会话的工作范围。",
      "切换到授权模式。",
      "选择工作台及其子节点。",
      "再次点选，收回这个范围。",
    ],
  },
] as const;
export type WorkbenchChapterId = (typeof chapters)[number]["id"];
const localizedChapters = { zh: chapters, en: localizeData("en", chapters) };
export const getChapters = (language: Language) => localizedChapters[language];
export type ChapterId = WorkbenchChapterId | "debug";
export const debugSteps = [
  "查看 Bug",
  "定位链路",
  "看处理状态",
  "查看条目",
  "勾选处理",
  "转为休眠",
];
export const debugCaptions = [
  "找到尚未处理的问题。",
  "沿链路定位到所属模块。",
  "徽章和色点标出谁在处理、卡在哪一步。",
  "在模块里查看问题条目。",
  "勾选后进入原型的沉淀状态。",
  "转为休眠条目，等待下一次检索。",
];
