export type DesignQuestion = {
  id: string;
  title: string;
  question: string;
  answer: string;
  reason: string;
  trail: readonly string[];
  example: string;
};

export const designQuestions: readonly DesignQuestion[] = [
  {
    id: "nodes",
    title: "用节点组织上下文",
    question: "为什么用节点图，而不是一篇长文或聊天摘要？",
    answer: "上下文的价值不在于保存更多文字，而在于快速找到正确的位置和关系。",
    reason: "节点把模块、决定、任务和问题放回项目结构里。下一次工作只读取命中的局部，不必重读整段历史。",
    trail: ["找到模块", "看见关系", "继续工作"],
    example: "修改工作台缩放时，从“工作台”节点直接进入动画策略、已知问题和相关验证。",
  },
  {
    id: "todos",
    title: "TODO 挂在节点上",
    question: "为什么 TODO 不是一个简单清单，而要挂载到节点上？",
    answer: "清单只告诉你要做什么，节点还说明在哪里做、为什么做、会影响什么。",
    reason: "TODO 与所属模块、相关决定和 Bug 共享位置。任务完成后，解决方法也能留在原处，成为下一次工作的上下文。",
    trail: ["待办事项", "所属节点", "相关决定"],
    example: "“修复缩放抖动”挂在“工作台 / 动画”节点，同时保留相机策略与回归验证。",
  },
  {
    id: "layers",
    title: "逐层确认结构",
    question: "为什么不一次生成整张项目地图？",
    answer: "项目结构需要人的判断；先确认边界，再展开细节，地图才会贴合真实工作方式。",
    reason: "一次铺开容易复制目录树，也容易把猜测固化。逐层确认让人先决定第一层，再让 Agent 沿着已确认的方向继续。",
    trail: ["提出候选", "人工确认", "向下展开"],
    example: "先确认“工作台、冷启动、项目文件”等第一层模块，再分别讨论它们的子节点。",
  },
  {
    id: "lessons",
    title: "问题留在发生处",
    question: "为什么 Bug、修复和验证也要挂在节点上？",
    answer: "修复一个问题还不够，项目需要记住它为什么发生，以及怎样防止再次发生。",
    reason: "问题与模块绑定后，后续修改同一区域时可以同时看到症状、原因和验证方法，减少重复踩坑。",
    trail: ["记录症状", "定位原因", "保留验证"],
    example: "再次调整动画相机时，工作台节点会提醒检查清晰度、帧间隔和缩放连续性。",
  },
];
