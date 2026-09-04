/* ================= 假数据 ================= */
// Real workbenches receive memory from their Map. Product defaults must not
// impersonate user-authored records.
const PINNED = [];

const I18N = {
  zh: {
    docTitle:"Context Guard · 工作台原型",
    archMap:"架构导图",
    switchRepo:"切换项目",
    dirLr:"左右", dirTb:"上下",
    dirTitle:"布局：点一下切换左右 / 上下",
    relations:"关系",
    relHint:"点击模块看关系，不会进入",
    relTitle:"打开后点击节点只高亮它的生产/消费，不进入。无关模块会变暗。",
    splitTitle:"拖动调整检查器宽度，双击恢复",
    splitTitlePhone:"拖动调整检查器高度，双击恢复",
    lensMode:"第一层候选",
    lensTitle:"首次建图：候选模块摆在画布上，与主节点无连线；选中一个，它才挂到主节点下。",
    lensShelfHint:"候选（无连线）· 点一个挂到根下",
    lensFinishL1:"定稿第一层",
    lensExitL1:"退出候选",
    lensNeedMin:"还差 {n} 张才到 4 张下限",
    lensTooMany:"超过 8 张了",
    lensNoPurpose:"有卡片缺一句用途",
    lensFileTitle:"有卡片标题像文件/目录名",
    lensEmptyShelf:"候选都在画布上了",
    authMode:"授权模式",
    cancelled:"已取消",
    settings:"设置",
    toolsLabel:"工具",
    themeLabel:"主题",
    langLabel:"语言",
    themeNow:"现在这版",
    themeCream:"奶油描边",
    themeWash:"淡彩分层",
    themeFlat:"无阴影扁平",
    firstKicker:"演示 · 第一次使用",
    firstHeading:"从 {name} 建立架构图",
    firstCopy:"这一步由当前会话的 Agent 真读 {name}，把多个视角的候选模块端到这里。你挑、改名、删减，拼出自己的第一层。",
    firstProduct:"第一层定稿后，Agent 再按你选的模块逐个出第二层候选，同样的池子交互，一层层往下。定稿大约 4–8 张主干，写进 architecture.md 和 map.json。",
    firstGo:"看第一层候选（多视角）",
    cutKicker:"Agent 已读仓 · 请你定第一层",
    cutHeading:"多个视角的候选，你挑自己要的",
    cutCopy:"候选来自 Agent 真读本仓库（.codex/context/l1-candidates.json）。同一块代码在不同视角会有不同名字或归类，互不互斥。勾选你要的，托盘里改名、删减，凑 4–8 张再定稿。",
    cutBack:"返回",
    lensPick:"我的第一层",
    lensFinish:"定稿第一层",
    lensAdd:"+ 加自定义卡",
    lensEmpty:"还没勾选。从上面各视角里挑你想要的模块。",
    lensRemove:"移除",
    lensNeedMin:"还差 {n} 张才到 4 张下限",
    lensTooMany:"超过 8 张了，删掉一些",
    lensNoPurpose:"有卡片缺一句用途，不能定稿",
    lensFileTitle:"有卡片标题像文件/目录名，不能定稿",
    lensOwnsHint:"这两张负责同一块代码：{a} 与 {b}",
    firstEmpty:"仓库几乎是空的",
    workKicker:"演示中 · 未调用 Agent",
    workHeading:"正在播放预置的分析过程",
    workCopy1:"浏览器在按写死的步骤和稿子走，没有模型在读 OpenClaw 或本仓库。真实 skill 启用时，才由你正在对话的那个 Agent 读代码。",
    workCopy2:"下面的笔记是预置演示稿。真做时先商量第一层怎么切，定了再往下拆；卡名必须一眼能看懂。演示里第一页仍是定稿后的 4–8 张主干。这不是这次点击实时读仓得到的。",
    trayTitle:"已取消的提议",
    trayHint:"已隐藏，后续 Agent 不会读到。可重新加入 Context Map，或永久删除。",
    openBugs:"Bug 处理状态",
    boot_ready:"已建图", boot_proposed:"待确认", boot_analyzing:"分析中", boot_pending:"首次使用",
    sessionNow:"当前会话", sessionPending:"待确认", sessionFirst:"首次使用", sessionEmpty:"空白项目",
    reanalyze:"重新选第一层切法",
    attach:"附", linkRepo:"连接仓库", linkRepoTitle:"选带 SKILL.md 的仓库根，改图可以写回 map.json", repoWrote:"已写入 map.json", repoWriteFail:"写回失败，请选带 SKILL.md 的仓库根并允许保存", repoNotRoot:"选的不是仓库根（要有 SKILL.md 的那一层）", add:"添加", cancel:"取消",
    filePathPh:"仓库相对路径，文件需已在仓库中",
    attachTitle:"附带文件或图片",
    remove:"移除", addModule:"接入模块",
    noOpenBugs:"没有未修的 Bug。", unnamedBug:"未命名 Bug",
    leave:"取消认领", claim:"由本会话处理", assignSession:"分配 Session", bugSending:"发送中", bugSendFailed:"发送失败",
    allSessions:"主工作台 · 全部 Session", globalSessionView:"仅跟随 Main", targetSession:"处理 Session", chooseSession:"请选择 Session",
    projectOverview:"项目总览",
    bugDescLabel:"Bug 描述", todoDescLabel:"TODO 描述", createAndSend:"创建并发送", authorizeAndSend:"确认授权并发送",
    scopeRequired:"该 Session 尚未获得当前节点权限。确认后将授权当前节点、所有上级和直接关联节点，共 {n} 个新节点。",
    bugWaiting:"待处理", bugProcessing:"处理中", bugHandoff:"待接手",
    bugSettling:"收尾中", bugFixed:"已修复", bugResolved:"已解决", bugDeferred:"已延期", bugWontFix:"不处理",
    exitChain:"退出链路",
    trayEmpty:"没有已取消的提议。",
    restoreMap:"↩ 重新加入 Map",
    forever:"永久删除", deleteAsk:"确定删掉？", delete:"删除",
    addOnMap:"要加模块或节点，去图上点 ＋。这里不放按钮。",
    deleteAskKids:"下面还有 {n} 个子项。一起删，还是接到上一级？",
    deleteKeepKids:"接到上一级",
    deleteWithKids:"一起删",
    wasUnder:"原属：", root:"根",
    join:"加入", hide:"隐藏", restore:"恢复",
    acceptLayer:"本层全部加入", grant:"授权", enter:"进入",
    plusModule:"＋ 模块", plusChild:"＋ 子节点",
    addChildTitle:"新增模块或节点",
    addKindModule:"模块", addKindNode:"节点",
    moduleName:"模块名称", childName:"子节点名称",
    memory:"记忆", ideas:"Idea", todos:"TODO", bugs:"Bug", inherited:"继承的", dormant:"休眠经验",
    addMem:"添加记忆", addIdea:"添加 Idea", addTodo:"添加 TODO", addBug:"添加 Bug",
    todoPending:"待处理", todoProcessing:"处理中", todoDone:"已完成", todoScopeRequired:"需要授权", todoAuthorizeAndSend:"授权并发送", todoRetry:"重新发送",
    module:"模块", cancelledChip:"已取消",
    state_dirty:"未开发", state_untested:"已做未测", state_success:"测试通过", state_failed:"测试未过",
    stateHint_dirty:"还没开始开发",
    stateHint_untested:"开发完了，还没有给这个节点生成测试",
    stateHint_success:"开发完成，测试通过",
    stateHint_failed:"开发完成，测试不通过",
    workState:"开发进度",
    pendingChip:"待批",
    proposalReason:"新增依据", proposalBasis:"提案类型", proposalFiles:"实现文件",
    summarizing:"沉淀中…",
    dormantExp:"（演示）Agent 总结：定位到根因并修复，验证方式已记录。此经验休眠，仅在同类 Bug 再现时检索。",
    doneMem:"（演示）人确认本任务完成，Agent 把过程草稿收敛成这条结论"
  },
  en: {
    docTitle:"Context Guard · workbench",
    archMap:"architecture map",
    switchRepo:"Switch project",
    dirLr:"Left–right", dirTb:"Top–down",
    dirTitle:"Layout: tap to switch left–right / top–down",
    relations:"Relations",
    relHint:"Click a module to see relations. It will not enter.",
    relTitle:"When on, clicking a node highlights produce/consume partners and dims the rest. It does not enter.",
    splitTitle:"Drag to resize the inspector. Double-click to reset.",
    splitTitlePhone:"Drag to resize the inspector height. Double-tap to reset.",
    lensMode:"L1 candidates",
    lensTitle:"First-use mapping: candidates sit on the canvas with no line to the root; picking one attaches it under the root.",
    lensShelfHint:"Candidates (no lines) · click one to attach it under the root",
    lensFinishL1:"Finish L1",
    lensExitL1:"Exit candidates",
    lensNeedMin:"{n} more to reach the minimum of 4",
    lensTooMany:"Over 8 cards",
    lensNoPurpose:"A card is missing its one-line purpose",
    lensFileTitle:"A card title looks like a file/dir name",
    lensEmptyShelf:"All candidates are on the canvas",
    authMode:"Auth mode",
    cancelled:"Cancelled",
    settings:"Settings",
    toolsLabel:"Tools",
    themeLabel:"Theme",
    langLabel:"Language",
    themeNow:"Current",
    themeCream:"Cream stroke",
    themeWash:"Wash layers",
    themeFlat:"Flat",
    firstKicker:"Demo · first use",
    firstHeading:"Build a map from {name}",
    firstCopy:"The agent you are talking to actually reads {name} and brings candidates from several lenses here. You pick, rename, and trim to build your first layer.",
    firstProduct:"After L1 is locked, the agent proposes L2 candidates module by module with the same pool interaction, layer by layer. The agreed trunk (about 4–8 cards) lands in architecture.md and map.json.",
    firstGo:"See L1 candidates (multi-lens)",
    cutKicker:"Agent read the repo · you pick L1",
    cutHeading:"Candidates from several lenses; pick yours",
    cutCopy:"Candidates come from the agent actually reading this repo (.codex/context/l1-candidates.json). The same code may appear under different names in different lenses; they are not mutually exclusive. Check what you want, rename or drop in the tray, and land 4–8 cards.",
    cutBack:"Back",
    lensPick:"My first layer",
    lensFinish:"Finish L1",
    lensAdd:"+ Add a custom card",
    lensEmpty:"Nothing picked yet. Choose modules from the lenses above.",
    lensRemove:"Remove",
    lensNeedMin:"{n} more to reach the minimum of 4",
    lensTooMany:"Over 8 cards; drop some",
    lensNoPurpose:"A card is missing its one-line purpose",
    lensFileTitle:"A card title looks like a file/dir name",
    lensOwnsHint:"These two own the same code: {a} and {b}",
    firstEmpty:"The repo is almost empty",
    workKicker:"Demo · no agent called",
    workHeading:"Playing the prepared analysis",
    workCopy1:"The browser is walking hard-coded steps. No model is reading OpenClaw or this repo. When the real skill runs, the agent you are talking to reads the code.",
    workCopy2:"The notes below are a prepared demo. Real first-use decides L1 with you, then goes deeper; titles must be instantly readable. This demo still shows the agreed 4–8 trunk cards. This is not a live read of the repo.",
    trayTitle:"Cancelled proposals",
    trayHint:"Hidden. Later agents will not read these. Restore them to the map, or delete permanently.",
    openBugs:"Bug status",
    boot_ready:"Mapped", boot_proposed:"Pending", boot_analyzing:"Analyzing", boot_pending:"First use",
    sessionNow:"Current session", sessionPending:"Pending", sessionFirst:"First use", sessionEmpty:"Empty project",
    reanalyze:"Pick a new first-layer cut",
    attach:"File", linkRepo:"Link repo", linkRepoTitle:"Pick the repo root with SKILL.md so edits can write map.json", repoWrote:"Wrote map.json", repoWriteFail:"Write failed. Pick the repo root that contains SKILL.md and allow saving.", repoNotRoot:"That folder is not the repo root (need SKILL.md at the top)", add:"Add", cancel:"Cancel",
    filePathPh:"Repo-relative path; the file must already be in the repo",
    attachTitle:"Attach a file or image",
    remove:"Remove", addModule:"Attach module",
    noOpenBugs:"No open bugs.", unnamedBug:"Untitled bug",
    leave:"Unassign", claim:"Handle in this session", assignSession:"Assign session", bugSending:"Sending", bugSendFailed:"Send failed",
    allSessions:"Main workbench · All sessions", globalSessionView:"Main branch only", targetSession:"Target session", chooseSession:"Choose a session",
    projectOverview:"Projects",
    bugDescLabel:"Bug description", createAndSend:"Create and send", authorizeAndSend:"Authorize and send",
    scopeRequired:"This session cannot access the current node. Confirm to authorize the node, its ancestors, and direct relations ({n} new nodes).",
    bugWaiting:"Waiting", bugProcessing:"In progress", bugHandoff:"Needs handoff",
    bugSettling:"Wrapping up", bugFixed:"Fixed", bugResolved:"Resolved", bugDeferred:"Deferred", bugWontFix:"Won't fix",
    exitChain:"Exit chain",
    trayEmpty:"No cancelled proposals.",
    restoreMap:"↩ Restore to map",
    forever:"Delete forever", deleteAsk:"Delete this?", delete:"Delete",
    addOnMap:"To add a module or node, tap ＋ on the map. No buttons here.",
    deleteAskKids:"This still has {n} children. Reattach them, or delete together?",
    deleteKeepKids:"Reattach",
    deleteWithKids:"Delete all",
    wasUnder:"From: ", root:"root",
    join:"Add", hide:"Hide", restore:"Restore",
    acceptLayer:"Add all in this layer", grant:"Authorize", enter:"Enter",
    plusModule:"＋ Module", plusChild:"＋ Child",
    addChildTitle:"Add a module or node",
    addKindModule:"Module", addKindNode:"Node",
    moduleName:"Module name", childName:"Child name",
    memory:"Memory", ideas:"Idea", todos:"TODO", bugs:"Bug", inherited:"Inherited", dormant:"Dormant lessons",
    addMem:"Add memory", addIdea:"Add idea", addTodo:"Add TODO", addBug:"Add bug",
    todoDescLabel:"TODO description", todoPending:"Pending", todoProcessing:"In progress", todoDone:"Completed", todoScopeRequired:"Authorization required", todoAuthorizeAndSend:"Authorize and send", todoRetry:"Retry",
    module:"Module", cancelledChip:"Cancelled",
    state_dirty:"Not started", state_untested:"Built, no tests", state_success:"Tests passed", state_failed:"Tests failed",
    stateHint_dirty:"Development has not started",
    stateHint_untested:"Built, but this node has no tests yet",
    stateHint_success:"Built, and tests passed",
    stateHint_failed:"Built, but tests failed",
    workState:"Build status",
    pendingChip:"Pending",
    proposalReason:"Reason", proposalBasis:"Proposal type", proposalFiles:"Implementation files",
    summarizing:"Settling…",
    dormantExp:"(Demo) The agent summarized the cause and fix. This lesson is dormant until a similar bug returns.",
    doneMem:"(Demo) The human marked this task done. The agent folded the draft into this memory."
  }
};
const LANG_KEY = "cg-workbench-ui-lang";
const THEME_KEY = "cg-workbench-node-theme";
const THEME_IDS = ["1","44","48","4"];
let uiLang = "zh";
function currentNodeTheme(){
  const n = window.__CG_NODE_THEME;
  return THEME_IDS.includes(n) ? n : "1";
}
function syncThemePicks(){
  const on = currentNodeTheme();
  document.querySelectorAll("#theme-picks [data-theme]").forEach(b=>{
    b.classList.toggle("on", b.dataset.theme===on);
  });
}
function applyNodeTheme(id, persist){
  const n = THEME_IDS.includes(String(id)) ? String(id) : "1";
  window.__CG_NODE_THEME = n;
  if(n==="1") document.documentElement.removeAttribute("data-node-theme");
  else document.documentElement.setAttribute("data-node-theme", n);
  if(persist!==false && !window.__CG_PREVIEW){
    try{ localStorage.setItem(THEME_KEY, n); }catch(e){}
  }
  syncThemePicks();
  if(typeof renderAll==="function" && typeof data!=="undefined" && data){
    renderAll();
    if(typeof fitView==="function") fitView();
  }
}
function t(key){
  const pack = I18N[uiLang] || I18N.zh;
  return pack[key] || I18N.zh[key] || key;
}
function applyStaticI18n(){
  document.documentElement.lang = uiLang==="en" ? "en" : "zh-CN";
  document.title = t("docTitle");
  document.querySelectorAll("[data-i18n]").forEach(el=>{ el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach(el=>{
    const v = t(el.dataset.i18nTitle);
    el.title = v;
    if(el.hasAttribute("aria-label")) el.setAttribute("aria-label", v);
  });
  document.querySelectorAll("#lang-toggle [data-lang]").forEach(b=>{
    b.classList.toggle("on", b.dataset.lang===uiLang);
  });
  syncThemePicks();
  const titleEl = document.getElementById("repo-title");
  if(titleEl && catalog[repoId]){
    titleEl.innerHTML = catalog[repoId].name+" "+t("archMap")+' <span class="caret">▾</span>';
  }
  if(typeof syncSplitChrome==="function") syncSplitChrome();
}
function readStoredUiLang(){
  try{
    const s = localStorage.getItem(LANG_KEY);
    if(s==="en"||s==="zh") return s;
  }catch(e){}
  return null;
}
function setUiLang(lang, persistPref){
  uiLang = lang==="en" ? "en" : "zh";
  try{ localStorage.setItem(LANG_KEY, uiLang); }catch(e){}
  applyStaticI18n();
  if(typeof applyRepoChrome==="function") applyRepoChrome();
  if(typeof renderAll==="function") renderAll();
  applyStaticI18n();
  const cutsEl = document.getElementById("first-use-cuts");
  if(lensMode){ renderLensShelf(); }
  if(persistPref!==false) schedulePrefLangWrite();
}

let NODE_SEQ = 400;
let BUG_SEQ = 40;
let TODO_SEQ = 1;
function bumpNodeSeq(n){
  if(!n) return;
  const m = /^N(\d+)$/.exec(String(n.id||""));
  if(m) NODE_SEQ = Math.max(NODE_SEQ, (+m[1])+1);
  (n.children||[]).forEach(bumpNodeSeq);
  (n._inbox||[]).forEach(bumpNodeSeq);
}
function uniquifyIds(n, seen){
  seen = seen || new Set();
  if(!n) return;
  bumpNodeSeq(n);
  if(!n.id || seen.has(n.id)){
    do { n.id = "N"+(NODE_SEQ++); } while(seen.has(n.id));
  }
  seen.add(n.id);
  (n.children||[]).forEach(c=>uniquifyIds(c, seen));
  (n._inbox||[]).forEach(c=>uniquifyIds(c, seen));
}
function nextNodeId(){
  let id;
  do { id = "N"+(NODE_SEQ++); } while(idTaken(id));
  return id;
}
function idTaken(id){
  let found = false;
  function scan(n){
    if(!n || found) return;
    if(n.id===id) found = true;
    (n.children||[]).forEach(scan);
    (n._inbox||[]).forEach(scan);
  }
  scan(data);
  return found;
}
const { OPENCLAW_MAP, CONTEXT_GUARD_MAP, CG_OWNS, OPENCLAW_NOTES, CONTEXT_GUARD_NOTES, U } = window.__CG_WORKBENCH_FIXTURES;

const clone = o => JSON.parse(JSON.stringify(o));
const catalog = {
  "context-guard": {
    id:"context-guard",
    name:"Context Guard",
    heading:"Context Guard 架构导图",
    source:"Michel-Johnson/Context-Guard-Skill",
    blueprint: CONTEXT_GUARD_MAP,
    live:null, auth:null, bootstrap:"proposed", firstUseOpen:false,
    notes: CONTEXT_GUARD_NOTES,
    analyze:[
      {do:"打开 README 与 SKILL.md，弄清 skill 合同", find:"人与 Agent 共用项目记忆，不是聊天摘要"},
      {do:"按包边界拆 scripts / prototype / .codex/context", find:"合同、工作台、context、skill 文件是不同开工面"},
      {do:"把工作台拆到函数：renderNode、visibleChildren、检查器、持久化", find:"prototype/workbench.html 里每一块都是可改单元"},
      {do:"把开发粒度写进 architecture.md：文件和函数，不是七句口号", find:"进入模块先看到子模块卡；文件挂在子模块下"},
      {do:"先拿出几种第一层拆法给人对，定了再往下拆", find:"卡名和用途要一眼能看懂；定稿大约 4–8 张，不是一上来倒整棵树"}
    ],
    l1Cuts:[
      {id:"surfaces", title:"按开工面切", why:"合同、工作台、文件、CLI 是不同的改法。", fromBlueprint:true},
      {id:"jobs", title:"按人要干的事切", why:"先问这次人在干什么，再落到文件。", modules:[
        {id:"C1", title:"第一次把仓库画成图", purpose:"和人商量第一层怎么切，定了再往下拆"},
        {id:"C2", title:"看图、改记忆、点头", purpose:"人在工作台里确认，不在命令行里"},
        {id:"C3", title:"Agent 按路径找卡", purpose:"小索引跳到坏例、任务、那张卡，不读整张地图"},
        {id:"C4", title:"记下坏例和一类活", purpose:"bugs/fixes 和 tasks 说明书，挂在节点上"},
        {id:"C5", title:"把 skill 装进这个仓库", purpose:"init、语言、SessionStart hook"}
      ]},
      {id:"folders", title:"按仓库目录切", why:"跟文件夹长得像。容易变成目录树，一般不该当第一层。", modules:[
        {id:"F1", title:"SKILL.md", purpose:"技能说明书"},
        {id:"F2", title:"prototype/", purpose:"工作台 HTML"},
        {id:"F3", title:".codex/context/", purpose:"会话、坏例、任务、地图文件"},
        {id:"F4", title:"scripts/", purpose:"init 和 hook"}
      ]}
    ]
  },
  openclaw: {
    id:"openclaw",
    name:"OpenClaw",
    heading:"OpenClaw 架构导图",
    source:"openclaw/openclaw",
    blueprint: OPENCLAW_MAP,
    live:null, auth:null, bootstrap:"pending", firstUseOpen:true,
    notes: OPENCLAW_NOTES,
    analyze:[
      {do:"读 README 与 pnpm-workspace，找单一运行时入口", find:"src/gateway 是控制面，不是并列微服务"},
      {do:"顺着 connect.ts、agent-runner.ts、sessionKey 把协议和调度拆开", find:"握手、turn、队列是不同文件"},
      {do:"读 packages/agent-core 循环和 memory-host-sdk", find:"loop、裁剪、memory 槽、sandbox 都要单独成节点"},
      {do:"按渠道实现文件拆（baileys.ts、grammy.ts、pairing），不要只列渠道名", find:"WhatsApp 单会话不变量写在 baileys.ts 旁边"},
      {do:"控制面先拆成 CLI / TUI / Control UI / 远程 四张子模块卡，命令文件挂在卡下", find:"点进控制面 UI 先看到子模块，不是二十几个文件平铺"},
      {do:"TUI 与 Control UI 的主循环、双后端、transcript 写进对应子模块，不要空壳也不要平铺", find:"tui.ts、GatewayChatClient、ui/src/chat 都在子模块里"},
      {do:"先拿出几种第一层拆法给人对，定了再往下拆；边写 architecture.md", find:"卡名要一眼能看懂；OpenClaw 定稿可以 8 张主干，小仓库可以只有 4 张"}
    ],
    l1Cuts:[
      {id:"runtime", title:"按运行面切", why:"人碰到的是 Gateway、聊天渠道、控制面板、手机伴侣，不是文件夹。", fromBlueprint:true},
      {id:"jobs", title:"按人要干的事切", why:"先问接下来要改哪一类活，再对文件。", modules:[
        {id:"J1", title:"接到已有聊天里", purpose:"WhatsApp / Telegram 等渠道怎么把消息送进助手"},
        {id:"J2", title:"跑完一轮对话", purpose:"选模型、调工具、写记忆，一次 agent 调用怎么走完"},
        {id:"J3", title:"在本机操作 Gateway", purpose:"CLI、终端界面、浏览器控制面，人怎么改状态"},
        {id:"J4", title:"给这台设备装伴侣", purpose:"手机和电脑以 node 连上；Linux 只跑远程命令"},
        {id:"J5", title:"谁能连上、怎么部署", purpose:"配对、默认安全、隧道和安装"}
      ]},
      {id:"folders", title:"按仓库目录切", why:"跟文件夹长得像。容易变成目录树，一般不该当第一层。", modules:[
        {id:"D1", title:"src/gateway", purpose:"Gateway 进程和协议文件"},
        {id:"D2", title:"packages/agent-core", purpose:"agent 循环和工具"},
        {id:"D3", title:"src/channels", purpose:"各聊天渠道实现"},
        {id:"D4", title:"apps", purpose:"macOS / iOS / Android / Linux"},
        {id:"D5", title:"ui", purpose:"Control UI 前端"},
        {id:"D6", title:"scripts 与 CLI", purpose:"命令行入口"}
      ]}
    ]
  }
};
let repoId = "context-guard";
const data = clone(CONTEXT_GUARD_MAP);
let selectedId = "T0";
let focusId = null;
let viewRootId = "T0";
let authMode = false;
let composingId = null;
let composingKind = "work";
let composeParent = null;
let addPickId = null;
function clearCompose(){
  workbenchSync?.setInputDraft(null); composingId = null; composingKind = "work"; composeParent = null; }
function closeAddPick(){
  if(!addPickId) return;
  addPickId = null;
  document.querySelectorAll(".node.picking").forEach(el=>el.classList.remove("picking"));
}
function canMutate(){
  return !!(workbenchSync?.ready || !window.__CG_SERVER);
}
let attaching = null;
let attachDraft = "";
function clearAttach(){ attaching = null; attachDraft = ""; }
let pendingDeleteId = null;
let deleteAskId = null;
let bugPathMode = false;
let bugFocus = null;
let bugPathReturn = null;
let foldInherited = false;
let foldDormant = false;
let foldMem = false;
let foldIdea = false;
let foldTodo = false;
let foldBug = false;
const uiLabels = ()=>({memory:t("memory"), ideas:t("ideas"), todos:t("todos"), bugs:t("bugs"), inherited:t("inherited"), dormant:t("dormant")});
const sessionAuth = new Set(["T0"]);

function parkChildren(n){
  if(n.children && n.children.length){
    n._inbox = n.children;
    n.children = [];
  }
}
function asProposal(n){
  n.proposal = "proposed";
  n.isNew = true;
  n.origin = n.origin || "agent";
  (n.children||[]).forEach(c=>{
    if(c.proposal==="cancelled") return;
    if(c.kind==="module") asProposal(c);
    else markProposedWork(c);
  });
  return n;
}
function markProposedWork(n){
  n.proposal = "proposed";
  n.isNew = true;
  n.origin = n.origin || "agent";
  const kids = (n.children||[]).filter(c=>c.proposal!=="cancelled");
  /* 开工链（1–2 岔）默认展开；更胖的结构应已晋升为模块。 */
  if(kids.length>0 && kids.length<=2 && kids.every(c=>c.kind!=="module")){
    kids.forEach(markProposedWork);
    return;
  }
  parkChildren(n);
}
function promoteFatWork(n){
  (n.children||[]).forEach(promoteFatWork);
  (n._inbox||[]).forEach(promoteFatWork);
  if(n.kind==="module") return;
  const kids = (n.children||[]).concat(n._inbox||[]).filter(c=>c.proposal!=="cancelled");
  /* 多于两个分支才晋升。开工节点后面可以接一个模块，不必因此变成模块。 */
  if(kids.length>2) n.kind = "module";
}
function workCount(n){
  let c = 0;
  function w(x){
    (x.children||[]).concat(x._inbox||[]).forEach(ch=>{ c++; w(ch); });
  }
  w(n);
  return c;
}
function esc(s){
  return String(s).replace(/[&<>]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[ch]));
}
function escAttr(s){
  return esc(s).replace(/"/g,"&quot;");
}
function filePathOf(f){
  if(!f) return "";
  return typeof f==="string" ? f.trim() : String(f.path||"").trim();
}
function fileList(owner){
  if(!owner) return [];
  if(!Array.isArray(owner.files)) owner.files = [];
  owner.files = owner.files.map(f=>typeof f==="string" ? {path:filePathOf(f)} : {...f,path:filePathOf(f)}).filter(f=>f.path);
  return owner.files;
}
function normRepoPath(p){
  return String(p||"").replace(/\\/g,"/").replace(/^\.\//,"").replace(/^\/+/,"").trim();
}
function ownsList(n){
  if(!n) return [];
  if(!Array.isArray(n.owns)) n.owns = [];
  n.owns = n.owns.map(normRepoPath).filter(Boolean);
  const seen = new Set();
  n.owns = n.owns.filter(p=>{ if(seen.has(p)) return false; seen.add(p); return true; });
  return n.owns;
}
function normalizeTree(n){
  if(!n) return;
  ownsList(n);
  fileList(n);
  if(!Array.isArray(n.memories)) n.memories = [];
  if(!Array.isArray(n.ideas)) n.ideas = [];
  if(!Array.isArray(n.todos)) n.todos = [];
  if(!Array.isArray(n.bugs)) n.bugs = [];
  if(!Array.isArray(n.dormant)) n.dormant = [];
  /* 人自己放的卡不是提议。绿点只留给 Agent 生成、尚未点头的节点。 */
  if(n.origin==="human"){
    if(n.proposal==="proposed") n.proposal = "accepted";
    n.isNew = false;
  }
  (n.children||[]).forEach(normalizeTree);
  (n._inbox||[]).forEach(normalizeTree);
}
function isImagePath(p){
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?$/i.test(p||"");
}
function fileBase(p){
  const s = String(p||"").replace(/\\/g,"/").replace(/\/+$/,"");
  const i = s.lastIndexOf("/");
  return (i>=0 ? s.slice(i+1) : s) || p;
}
function ownerOf(node, kind, key){
  if(kind==="node") return node;
  if(kind==="mem") return node.memories[+key];
  if(kind==="idea") return node.ideas[+key];
  if(kind==="todo") return (node.todos||[]).find(todo=>todo.id===key);
  if(kind==="bug") return (node.bugs||[]).find(b=>b.id===key);
  if(kind==="dorm") return node.dormant[+key];
  return null;
}
function isAttaching(kind, key){
  return !!(attaching && attaching.kind===kind && String(attaching.key)===String(key));
}
function addFilePath(node, kind, key, path){
  const p = String(path||"").replace(/^\s+|\s+$/g,"").split(/[\r\n]/)[0];
  if(!p) return false;
  const owner = ownerOf(node, kind, key);
  if(!owner) return false;
  const files = fileList(owner);
  if(files.some(f=>f.path===p)) return true;
  files.push({path:p});
  return true;
}
function canFsAccess(){ return typeof window.showDirectoryPicker==="function"; }
let repoRootHandle = null;
let repoFsOk = false;
let pendingWrite = null;
const filePreviewUrl = Object.create(null);
const SHOT_DIR = "docs/shots";
const FS_DB = "cg-workbench-fs";
function openFsDb(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(FS_DB, 1);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore("kv"); };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}
async function fsDbGet(key){
  const db = await openFsDb();
  return new Promise((resolve, reject)=>{
    const req = db.transaction("kv").objectStore("kv").get(key);
    req.onsuccess = ()=>resolve(req.result||null);
    req.onerror = ()=>reject(req.error);
  });
}
async function fsDbSet(key, val){
  const db = await openFsDb();
  return new Promise((resolve, reject)=>{
    const req = db.transaction("kv","readwrite").objectStore("kv").put(val, key);
    req.onsuccess = ()=>resolve();
    req.onerror = ()=>reject(req.error);
  });
}
async function ensureRepoPerm(){
  if(!repoRootHandle) return false;
  const opts = {mode:"readwrite"};
  try{
    if(repoRootHandle.queryPermission){
      const q = await repoRootHandle.queryPermission(opts);
      if(q==="granted") return true;
    }
    if(repoRootHandle.requestPermission){
      const q = await repoRootHandle.requestPermission(opts);
      return q==="granted";
    }
    return true;
  }catch(e){ return false; }
}
async function restoreRepoDir(){
  if(!canFsAccess()) return;
  try{
    const h = await fsDbGet("repoDir");
    if(!h) return;
    repoRootHandle = h;
    repoFsOk = await ensureRepoPerm();
  }catch(e){ repoFsOk = false; }
}
function setRepoStatus(kind){
  const el = document.getElementById("repo-status");
  if(!el) return;
  if(!kind){ el.hidden = true; el.textContent = ""; el.className = "repo-status"; return; }
  el.hidden = false;
  el.className = "repo-status" + (kind==="ok" ? " ok" : " err");
  const key = kind==="ok" ? "repoWrote" : (kind==="notRoot" ? "repoNotRoot" : "repoWriteFail");
  el.textContent = t(key);
  el.title = el.textContent;
}
async function looksLikeRepoRoot(){
  if(!repoRootHandle) return false;
  try{
    await repoRootHandle.getFileHandle("SKILL.md");
    return true;
  }catch(e){ return false; }
}
async function linkRepo(){
  if(!workbenchSync?.ready || !canFsAccess()){ workbenchSync?.setStatus("readonly"); return false; }
  try {
    const picked=await window.showDirectoryPicker({id:"context-guard-attachments",mode:"readwrite"});
    const cg=await picked.getDirectoryHandle(".codex"); const ctx=await cg.getDirectoryHandle("context");
    const handle=await ctx.getFileHandle("map.json"); const file=await handle.getFile();
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer()))).map(x=>x.toString(16).padStart(2,"0")).join("");
    const current=await workbenchSync.call("/api/state");
    if(digest!==current.version) throw new Error("所选目录的地图与当前服务不同，请选择服务显示的项目目录");
    repoRootHandle=picked; repoFsOk=await ensureRepoPerm();
    if(!repoFsOk) return false;
    await fsDbSet("repoDir",repoRootHandle);
    if(pendingWrite){ const pending=pendingWrite; pendingWrite=null; await saveBlobToOwner(pending.node,pending.kind,pending.key,pending.blob,pending.name); }
    workbenchSync.setStatus(workbenchSync.status,"附件目录已连接；地图仍由 Node 保存");
    return true;
  } catch(e){ workbenchSync.setStatus(workbenchSync.status,e.message); return false; }
}
function safeFilePart(name){
  const raw = String(name||"paste").split(/[\\/]/).pop();
  const extMatch = raw.match(/\.[a-z0-9]{1,8}$/i);
  const ext = (extMatch ? extMatch[0] : "").toLowerCase();
  let base = raw.slice(0, raw.length-ext.length).replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"");
  if(!base) base = "paste";
  return base.slice(0,40)+ext;
}
function extForBlob(blob, fileName){
  const fromName = String(fileName||"").match(/\.[a-z0-9]{1,8}$/i);
  if(fromName) return fromName[0].toLowerCase();
  const t = (blob && blob.type)||"";
  if(t==="image/jpeg") return ".jpg";
  if(t==="image/png") return ".png";
  if(t==="image/webp") return ".webp";
  if(t==="image/gif") return ".gif";
  if(t==="image/svg+xml") return ".svg";
  return ".bin";
}
function shotRel(fileName, blob){
  const now = new Date();
  const pad = n=>String(n).padStart(2,"0");
  const stamp = now.getFullYear()+pad(now.getMonth()+1)+pad(now.getDate())+"-"+pad(now.getHours())+pad(now.getMinutes())+pad(now.getSeconds());
  let name = safeFilePart(fileName);
  if(!/\.[a-z0-9]{1,8}$/i.test(name)) name += extForBlob(blob, fileName);
  return SHOT_DIR+"/"+stamp+"-"+name;
}
async function writeRepoPath(rel, blob){
  if(String(rel).replace(/\\/g,"/") === ".codex/context/map.json") throw new Error("Map writes require the Node interface");
  if(!repoRootHandle) throw new Error("no repo");
  const parts = String(rel).split("/").filter(Boolean);
  if(parts.some(part=>part==="."||part==="..")) throw new Error("bad path");
  let dir = repoRootHandle;
  for(let i=0;i<parts.length-1;i++) dir = await dir.getDirectoryHandle(parts[i], {create:true});
  const fh = await dir.getFileHandle(parts[parts.length-1], {create:true});
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}
async function readRepoFile(rel){
  if(!repoRootHandle || !repoFsOk) return null;
  try{
    const parts = String(rel).split("/").filter(Boolean);
    let dir = repoRootHandle;
    for(let i=0;i<parts.length-1;i++) dir = await dir.getDirectoryHandle(parts[i]);
    const fh = await dir.getFileHandle(parts[parts.length-1]);
    return await fh.getFile();
  }catch(e){ return null; }
}
function rememberPreview(rel, blob){
  if(filePreviewUrl[rel]) URL.revokeObjectURL(filePreviewUrl[rel]);
  filePreviewUrl[rel] = URL.createObjectURL(blob);
}
function hydrateThumbs(root){
  (root||document).querySelectorAll("img[data-repo-src]").forEach(async img=>{
    const p = img.dataset.repoSrc;
    if(filePreviewUrl[p]){ img.src = filePreviewUrl[p]; return; }
    const f = await readRepoFile(p);
    if(f){ rememberPreview(p, f); img.src = filePreviewUrl[p]; }
  });
}
async function saveBlobToOwner(node, kind, key, blob, fileName){
  if(!blob) return false;
  const name = fileName || blob.name || "paste.bin";
  if(!repoFsOk){
    pendingWrite = {node, kind, key, blob, name};
    beginAttach(kind, key, shotRel(name, blob));
    return false;
  }
  const rel = shotRel(name, blob);
  await writeRepoPath(rel, blob);
  rememberPreview(rel, blob);
  addFilePath(node, kind, key, rel);
  pendingWrite = null;
  clearAttach();
  renderAll();
  return true;
}
function repoRelPath(s){
  const p = String(s||"").trim().replace(/\\/g,"/").split(/\s/)[0];
  if(!p || p.length>240) return "";
  if(/^[a-z]+:\/\//i.test(p)) return "";
  if(p.startsWith("/") || p.startsWith("~") || p.includes("..")) return "";
  if(!p.includes("/") && !/\.\w{1,8}$/.test(p)) return "";
  return p;
}
function blobFromEvent(e){
  const dt = e.clipboardData || e.dataTransfer;
  if(!dt) return null;
  if(dt.files && dt.files[0]) return dt.files[0];
  const items = dt.items ? [...dt.items] : [];
  const it = items.find(x=>x.kind==="file");
  return it && it.getAsFile ? it.getAsFile() : null;
}
function pathFromClipboard(e){
  const dt = e.clipboardData || e.dataTransfer;
  if(!dt) return {path:"", fileName:"", blob:null};
  const text = repoRelPath(dt.getData && dt.getData("text/plain"));
  if(text && text.includes("/")) return {path:text, fileName:"", blob:null};
  const blob = blobFromEvent(e);
  if(blob) return {path:"", fileName:blob.name||"", blob};
  const items = dt.items ? [...dt.items] : [];
  const it = items.find(x=>x.kind==="file");
  if(it && it.type && it.type.startsWith("image/")){
    const ext = (it.type.split("/")[1]||"png").replace("jpeg","jpg");
    return {path:"", fileName:"image."+ext, blob:null};
  }
  if(text) return {path:"", fileName:text, blob:null};
  return {path:"", fileName:"", blob:null};
}
function beginAttach(kind, key, draft){
  attaching = {kind, key};
  attachDraft = draft || "";
  renderAll();
}
async function takeAttach(node, kind, key, e){
  const got = pathFromClipboard(e);
  if(got.path){
    if(addFilePath(node, kind, key, got.path)){
      e.preventDefault();
      clearAttach();
      renderAll();
    }
    return true;
  }
  if(got.blob){
    e.preventDefault();
    await saveBlobToOwner(node, kind, key, got.blob, got.fileName);
    return true;
  }
  if(got.fileName){
    e.preventDefault();
    beginAttach(kind, key, got.fileName);
    return true;
  }
  return false;
}
async function pickLocalFile(){
  try{
    if(window.showOpenFilePicker){
      const [h] = await window.showOpenFilePicker({multiple:false});
      return await h.getFile();
    }
  }catch(e){ return null; }
  return new Promise(resolve=>{
    const inp = document.createElement("input");
    inp.type = "file";
    inp.onchange = ()=>resolve((inp.files && inp.files[0]) || null);
    inp.click();
  });
}
function attachHtml(kind, key, owner, readonly){
  const files = fileList(owner);
  const fk = escAttr(kind), fi = escAttr(String(key));
  const chips = files.map((f,i)=>{
    const p = escAttr(f.path);
    const name = esc(fileBase(f.path));
    const img = isImagePath(f.path)
      ? `<img class="file-thumb" data-repo-src="${p}" alt="${name}" title="${p}">`
      : "";
    const rm = readonly ? "" : `<button type="button" class="file-x" data-act="rm-file" data-fk="${fk}" data-fi="${fi}" data-i="${i}" title="${escAttr(t("remove"))}">×</button>`;
    return `<span class="file-chip" title="${p}">${img}<span class="file-name">${name}</span>${rm}</span>`;
  }).join("");
  if(readonly) return files.length ? `<div class="files">${chips}</div>` : "";
  if(!files.length && !isAttaching(kind, key)) return "";
  const add = isAttaching(kind, key)
    ? `<span class="file-add">
         <input class="file-path" data-file-input data-fk="${fk}" data-fi="${fi}" value="${escAttr(isAttaching(kind, key)?attachDraft:"")}" placeholder="${escAttr(t("filePathPh"))}" autocomplete="off">
         <button type="button" class="quiet" data-act="save-file" data-fk="${fk}" data-fi="${fi}">${t("add")}</button>
         <button type="button" class="quiet" data-act="cancel-file">${t("cancel")}</button>
       </span>`
    : `<button type="button" class="clip-btn quiet" data-act="ask-file" data-fk="${fk}" data-fi="${fi}" title="${escAttr(t("attachTitle"))}">${t("attach")}</button>`;
  return `<div class="files" data-drop-files data-fk="${fk}" data-fi="${fi}">${chips}${add}</div>`;
}
function bindFileUi(el, node){
  const saveFrom = host=>{
    const kind = host.dataset.fk, key = host.dataset.fi;
    const box = el.querySelector("[data-file-input]");
    const path = box ? box.value : "";
    if(addFilePath(node, kind, key, path)){ clearAttach(); renderAll(); }
  };
  el.querySelectorAll('[data-act="ask-file"]').forEach(b=>{
    b.onclick = async ()=>{
      if(repoFsOk){
        const f = await pickLocalFile();
        if(f) await saveBlobToOwner(node, b.dataset.fk, b.dataset.fi, f, f.name);
        return;
      }
      beginAttach(b.dataset.fk, b.dataset.fi, "");
    };
  });
  el.querySelectorAll('[data-act="save-file"]').forEach(b=>{
    b.onclick = ()=>saveFrom(b);
  });
  el.querySelectorAll('[data-act="cancel-file"]').forEach(b=>{
    b.onclick = ()=>{ clearAttach(); renderAll(); };
  });
  el.querySelectorAll('[data-act="rm-file"]').forEach(b=>{
    b.onclick = e=>{
      e.preventDefault();
      const owner = ownerOf(node, b.dataset.fk, b.dataset.fi);
      if(!owner) return;
      fileList(owner).splice(+b.dataset.i, 1);
      renderAll();
    };
  });
  const inp = el.querySelector("[data-file-input]");
  if(inp){
    inp.focus();
    inp.addEventListener("keydown", e=>{
      if(e.key==="Enter"){ e.preventDefault(); saveFrom(inp); }
      if(e.key==="Escape"){ e.preventDefault(); clearAttach(); renderAll(); }
    });
  }
  el.querySelectorAll("[data-drop-files]").forEach(box=>{
    box.addEventListener("dragover", e=>{
      if(!e.dataTransfer) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      box.classList.add("is-drop");
    });
    box.addEventListener("dragleave", ()=>box.classList.remove("is-drop"));
    box.addEventListener("drop", e=>{
      e.stopPropagation();
      box.classList.remove("is-drop");
      takeAttach(node, box.dataset.fk, box.dataset.fi, e);
    });
  });
}
function unpackInbox(n){
  if(n._inbox?.length){ n.children=(n.children||[]).concat(n._inbox); n._inbox=[]; }
}
function currentRepo(){ return catalog[repoId]; }
const STORE_KEY = "cg-workbench-maps-v16";
const L1_SOFT_MAX = 8;
const L1_SOFT_MIN = 4;
function hasMap(r){
  return r.bootstrap==="proposed" || r.bootstrap==="ready" || !!(r.live && (r.live.children||[]).length);
}
function overlayOpenFor(r){
  return r.bootstrap==="pending" || r.bootstrap==="analyzing";
}
function bootstrapLabel(st){
  return t("boot_"+(st||"pending"));
}
function firstLayerConfirmed(){
  const kids = (data.children||[]).filter(c=>!isCancelled(c));
  return kids.length>0 && kids.every(c=>!isProposed(c));
}
function syncBootstrapFromTree(){
  const r = currentRepo();
  if(r.bootstrap==="pending" || r.bootstrap==="analyzing") return;
  if(firstLayerConfirmed() || ((data.children||[]).length===0 && (data.memories||[]).length)){
    r.bootstrap = "ready";
  }else if((data.children||[]).length){
    r.bootstrap = "proposed";
  }
}
let workbenchSync = null;
let applyingServerMap = false;
let renderedAccessSession = null;
let hasRenderedAccessSession = false;
function persist(){
  if(window.__CG_PREVIEW || applyingServerMap) return;
  snapshotRepo();
  const dump = {repoId, repos:{}};
  Object.values(catalog).forEach(r=>{
    dump.repos[r.id] = {
      bootstrap: r.bootstrap,
      firstUseOpen: r.firstUseOpen,
      live: r.live,
      auth: r.auth,
      selectedId: r.selectedId,
      viewRootId: r.viewRootId,
      focusId: r.focusId,
      sessionName: r.sessionName
    };
  });
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(dump)); }catch(e){}
  try{ localStorage.setItem(LANG_KEY, uiLang); }catch(e){}
  try{
    const light = {v:2, repoId, st:{}};
    Object.values(catalog).forEach(r=>{ light.st[r.id] = r.bootstrap; });
    const next = "#cg2="+encodeURIComponent(JSON.stringify(light));
    const currentHash=location.hash||"";
    if((!currentHash || currentHash.startsWith("#cg2=")) && currentHash!==next) history.replaceState(null, "", next);
  }catch(e){}
  scheduleMapWrite();
}
const MAP_FILE = ".codex/context/map.json";
const PREF_FILE = ".codex/context/preferences.json";
let diskProjectId = "context-guard";
let mapWriteTimer = null;
let mapWriteBusy = false;
let restoredFromLs = false;
function isoDay(){ return new Date().toISOString().slice(0,10); }
function mapDocFromRepo(r){
  const live = r.live || data;
  const root = clone(live);
  return {
    v: 1,
    project: r.id,
    bootstrap: r.bootstrap,
    updated: isoDay(),
    flows: clone(root.flows || []),
    root
  };
}
function applyMapDoc(doc){
  if(!doc?.root?.id) return false;
  const id = doc.project || "context-guard";
  if(!Object.hasOwn(catalog,id)) Object.defineProperty(catalog,id,{value:{...catalog["context-guard"], id, name:id, source:window.__CG_SERVER?.root || id},writable:true,enumerable:true,configurable:true});
  diskProjectId = id; repoId = id;
  const r = catalog[id]; r.live=clone(doc.root); r.bootstrap=doc.bootstrap || "ready"; r.firstUseOpen=false;
  adoptTree(doc.root);
  if(Array.isArray(doc.flows)) data.flows=clone(doc.flows);
  if(!getNode(selectedId)) selectedId=data.id;
  if(!getNode(viewRootId)) viewRootId=data.id;
  applyRepoChrome(); closeOverlay(); return true;
}
function scheduleMapWrite(){ workbenchSync?.changed(); }
async function writeMapToRepo(){
  if(!workbenchSync?.ready) return false;
  await workbenchSync.flush();
  return workbenchSync.status === "synced";
}
async function syncBootstrapFile(st){
  try{
    const f = await readRepoFile(PREF_FILE);
    let prefs = {};
    if(f){ try{ prefs = JSON.parse(await f.text())||{}; }catch(err){ prefs = {}; } }
    if(!prefs || typeof prefs!=="object") prefs = {};
    prefs.map_bootstrap = st;
    prefs.display_language = uiLang;
    prefs.last_updated = isoDay();
    await writeRepoPath(PREF_FILE, new Blob([JSON.stringify(prefs, null, 2)+"\n"], {type:"application/json"}));
  }catch(e){}
}
let prefLangTimer = null;
function schedulePrefLangWrite(){
  clearTimeout(prefLangTimer);
  prefLangTimer = setTimeout(writePrefLang, 400);
}
async function writePrefLang(){
  if(!repoFsOk) return;
  try{
    const f = await readRepoFile(PREF_FILE);
    let prefs = {};
    if(f){ try{ prefs = JSON.parse(await f.text())||{}; }catch(err){ prefs = {}; } }
    if(!prefs || typeof prefs!=="object") prefs = {};
    prefs.display_language = uiLang;
    prefs.last_updated = isoDay();
    await writeRepoPath(PREF_FILE, new Blob([JSON.stringify(prefs, null, 2)+"\n"], {type:"application/json"}));
  }catch(e){}
}
async function loadPrefsLang(){
  try{
    let prefs = null;
    if(repoFsOk){
      const f = await readRepoFile(PREF_FILE);
      if(f) prefs = JSON.parse(await f.text());
    }else{
      const res = await fetch("../.codex/context/preferences.json", {cache:"no-store"});
      if(res.ok) prefs = await res.json();
    }
    const d = prefs && (prefs.display_language || prefs.record_language);
    if(d==="en" || d==="zh"){ uiLang = d; return; }
  }catch(e){}
  const nav = String(navigator.language||"").toLowerCase();
  if(nav.startsWith("en")) uiLang = "en";
}
async function loadMapFromRepo(){
  if(!repoFsOk) return false;
  try{
    const f = await readRepoFile(MAP_FILE);
    if(!f) return false;
    return applyMapDoc(JSON.parse(await f.text()));
  }catch(e){ return false; }
}
async function loadMapFromHttp(){
  try{
    const res = await fetch("../.codex/context/map.json", {cache:"no-store"});
    if(!res.ok) return false;
    return applyMapDoc(await res.json());
  }catch(e){ return false; }
}
function applySaved(r, saved){
  if(!saved) return;
  r.bootstrap = saved.bootstrap || r.bootstrap;
  r.firstUseOpen = !!saved.firstUseOpen;
  r.live = saved.live || r.live;
  r.auth = saved.auth || r.auth;
  r.selectedId = saved.selectedId;
  r.viewRootId = saved.viewRootId;
  r.focusId = saved.focusId;
  r.sessionName = saved.sessionName;
}
function readHashState(){
  try{
    const raw = (location.hash||"").replace(/^#cg2=/, "");
    if(!raw || raw===(location.hash||"").replace(/^#/, "")) return null;
    return JSON.parse(decodeURIComponent(raw));
  }catch(e){ return null; }
}
function loadLive(r){
  const tree = r.live || proposedTree(r);
  adoptTree(tree);
  r.live = clone(data);
  authUnlockAll();
  selectedId = r.selectedId || "T0";
  viewRootId = r.viewRootId || "T0";
  focusId = r.focusId || null;
  clearCompose();
  if(viewRootId!==data.id){
    const n = getNode(viewRootId);
    if(n) unpackInbox(n);
  }
  document.getElementById("session-name").textContent = r.sessionName || (r.bootstrap==="proposed"?"S-0823 "+t("sessionPending"):t("sessionNow"));
  setOverlay(overlayOpenFor(r), r.bootstrap==="analyzing");
}
function restore(){
  restoredFromLs = false;
  let dump;
  try{ dump = JSON.parse(localStorage.getItem(STORE_KEY)||""); }catch(e){ dump = null; }
  if(dump && dump.repos){
    restoredFromLs = true;
    Object.keys(dump.repos).forEach(id=>{ if(catalog[id]) applySaved(catalog[id], dump.repos[id]); });
    if(dump.repoId && catalog[dump.repoId]) repoId = dump.repoId;
  }
  const hashed = readHashState();
  if(hashed && hashed.st){
    Object.keys(hashed.st).forEach(id=>{
      if(!catalog[id]) return;
      if(!dump || !dump.repos || !dump.repos[id]) catalog[id].bootstrap = hashed.st[id];
    });
    if(!dump && hashed.repoId && catalog[hashed.repoId]) repoId = hashed.repoId;
  }
  Object.values(catalog).forEach(r=>{
    if(r.bootstrap==="analyzing"){
      r.bootstrap = "pending";
      if(!(r.live && (r.live.children||[]).length)) r.live = null;
    }
  });
  const r = currentRepo();
  if(hasMap(r) || r.live){
    loadLive(r);
    applyRepoChrome();
    return true;
  }
  return false;
}
function demoOpenBug(id, title, desc, sessions){
  return {
    id,
    title,
    desc,
    status: "open",
    files: [],
    sessions: sessions ? sessions.slice() : [],
    record: ".codex/context/bugs/"+id+".md"
  };
}
const DEMO_OPEN_BUGS = [
  { parentId:"M1", bug: demoOpenBug("B20", "原生 prompt 会打断看图", "检查器编辑和建图确认必须留在页面里", ["S-0823"]) },
  { parentId:"N405", bug: demoOpenBug("B22", "齿轮挤", "顶栏设置按钮和旁边控件贴在一起，不好点", []) },
  { parentId:"N406", bug: demoOpenBug("B23", "手机竖屏时抽屉把手被底栏挡住，拖不到最低", "底栏升起后把手落在安全区下面", ["S-0823"]) },
  { parentId:"N407", bug: demoOpenBug("B24", "主题 44 完成度黄点看不清", "金色状态点叠在深色卡片上对比不够", ["S-0819"]) },
  { parentId:"N409", bug: demoOpenBug("B25", "锁点太小", "授权锁点击热区只有圆点本身", ["S-0823"]) },
  { parentId:"N410", bug: demoOpenBug("B26", "已取消托盘从设置打开后点空白关不掉", "托盘没有点外面关闭的路径", []) },
  { parentId:"N411", bug: demoOpenBug("B27", "GitHack 斜杠分支打不开", "带 cursor/ 的预览地址被截断", ["S-0819","S-0821"]) },
  { parentId:"N400", bug: demoOpenBug("B28", "检查器去掉模块芯片后空一截", "类型标签删了，标题上方还留着空白", ["S-0823","S-0819"]) }
];
function ensureDemoBugs(tree){
  if(!tree) return;
  DEMO_OPEN_BUGS.forEach(seed=>{
    let parent = null;
    walkAll(tree, n=>{ if(n && n.id===seed.parentId) parent = n; });
    if(!parent) return;
    parent.bugs = parent.bugs || [];
    if(parent.bugs.some(b=>b && b.id===seed.bug.id)) return;
    parent.bugs.push(clone(seed.bug));
  });
}
function adoptTree(tree){
  const src = clone(tree);
  Object.keys(data).forEach(k=>delete data[k]);
  Object.assign(data, src);
  function defaults(n){
    for(const k of ["memories","ideas","todos","bugs","dormant","files","owns","children"]){ if(!n[k]) n[k]=[]; }
    (n.children||[]).concat(n._inbox||[]).forEach(defaults);
  }
  defaults(data);
  promoteFatWork(data);
  uniquifyIds(data);
  normalizeTree(data);
  if(!window.__CG_SERVER){
    stampMapCompletion();
    ensureDemoBugs(data);
  }
}
function snapshotRepo(){
  const r = currentRepo();
  r.live = clone(data);
  r.auth = [...sessionAuth];
  r.selectedId = selectedId;
  r.viewRootId = viewRootId;
  r.focusId = focusId;
  r.sessionName = document.getElementById("session-name").textContent;
  r.firstUseOpen = document.getElementById("first-use").classList.contains("open");
  syncBootstrapFromTree();
}
function renderFirstUseCopy(){
  const r = currentRepo();
  document.getElementById("first-use-heading").textContent = t("firstHeading").replace("{name}", r.name);
  document.getElementById("first-use-copy").textContent = t("firstCopy").replace("{name}", r.name);
}
function applyRepoChrome(){
  const r = currentRepo();
  const titleEl = document.getElementById("repo-title");
  if(titleEl) titleEl.innerHTML = esc(r.name)+" "+t("archMap")+' <span class="caret">▾</span>';
  renderRepoMenu();
  renderFirstUseCopy();
}
function renderRepoMenu(){
  const el = document.getElementById("repo-menu");
  el.innerHTML = Object.values(catalog).map(r=>`
    <button type="button" data-repo="${r.id}" class="${r.id===repoId?"on":""}">
      <b>${esc(r.name)}</b>
      <span class="src">${r.source}</span>
      <span class="tag${r.bootstrap==="pending"||r.bootstrap==="analyzing"?" wait":""}">${bootstrapLabel(r.bootstrap)}</span>
      ${hasMap(r)? `<span class="reanalyze" data-reanalyze="${r.id}">${t("reanalyze")}</span>`:""}
    </button>`).join("");
  el.querySelectorAll("[data-repo]").forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    switchRepo(b.dataset.repo);
  });
  el.querySelectorAll("[data-reanalyze]").forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    reanalyzeRepo(b.dataset.reanalyze);
  });
}
function closeRepoMenu(){ document.getElementById("repo-menu").classList.remove("open"); }
function sessionIdOf(meta){
  return String(meta?.id||meta?.sessionId||"").trim();
}
function sessionTimestamp(meta){
  for(const value of [meta?.statusSeen,meta?.lastSeen,meta?.updatedAt,meta?.firstSeen]){
    const parsed=Date.parse(value||"");
    if(Number.isFinite(parsed)) return parsed;
  }
  return 0;
}
function mergeSessionMeta(left,right){
  const newer=sessionTimestamp(right)>=sessionTimestamp(left)?right:left;
  const older=newer===right?left:right;
  const merged={...older,...newer,id:sessionIdOf(newer)||sessionIdOf(older)};
  for(const key of ["name","platform","status","statusSeen","lastSeen","firstSeen","bindingState","worktreeName","worktreeRoot","branch"]){
    if(merged[key]===undefined || merged[key]===null || String(merged[key]).trim()==="") merged[key]=older[key];
  }
  return merged;
}
function isUnavailableSession(meta){
  const status=String(meta?.status||"").trim().toLowerCase();
  const binding=String(meta?.bindingState||"").trim().toLowerCase();
  return ["closed","published","expired","deleted","invalid"].includes(status)
    || ["closed","published","expired","deleted","invalid"].includes(binding);
}
function normalizeSessions(items){
  const byId=new Map();
  for(const raw of Array.isArray(items)?items:[]){
    const meta=typeof raw==="string"?{id:raw,name:"",platform:"unknown",status:"active"}:raw;
    const id=sessionIdOf(meta);
    if(!id) continue;
    const clean={...meta,id};
    byId.set(id,byId.has(id)?mergeSessionMeta(byId.get(id),clean):clean);
  }
  return [...byId.values()].filter(meta=>!isUnavailableSession(meta));
}
function browserCurrentSessionId(){
  const id=String(new URLSearchParams(location.search).get("session")||"").trim();
  return id && id!=="__all__" ? id : null;
}
function readableSessionName(meta){
  const id=sessionIdOf(meta), shortId=String(meta?.shortId||"").trim(), name=String(meta?.name||"").trim();
  const placeholder=/^(?:agent\s*[=：:·-]\s*)?(?:当前会话|current session)$/i.test(name);
  return name && name!==id && name!==shortId && !placeholder ? name : "";
}
function sessionBaseLabel(meta){
  const id=sessionIdOf(meta), shortId=String(meta?.shortId||"").trim();
  const humanValue=value=>{
    const text=String(value||"").trim();
    return text && text!==id && text!==shortId ? text : "";
  };
  const platform=String(meta?.platform||"").trim();
  const readablePlatform=platform && platform!=="unknown" ? platform : "";
  const name=readableSessionName(meta);
  const worktree=humanValue(meta?.worktreeName);
  const branch=humanValue(meta?.branch);
  if(name) return [...new Set([readablePlatform?`${readablePlatform}-${name}`:name,worktree,branch].filter(Boolean))].join(" · ");
  const context=[worktree,branch].filter((value,index,array)=>value && array.indexOf(value)===index);
  if(context.length) return [readablePlatform,...context].filter(Boolean).join(" · ");
  return `${readablePlatform||"Agent"} ${uiLang==="en"?"session":"会话"}`;
}
function sessionPrimaryLabel(meta,sessions=workbenchSync?.sessions||[]){
  if(!meta) return uiLang==="en"?"No agent session":"暂无 Agent 会话";
  const id=sessionIdOf(meta), base=sessionBaseLabel(meta);
  const peers=normalizeSessions(sessions).filter(item=>sessionBaseLabel(item)===base).sort((a,b)=>sessionIdOf(a).localeCompare(sessionIdOf(b)));
  const ordinal=peers.length>1 ? `${uiLang==="en"?"session":"会话"} ${Math.max(0,peers.findIndex(item=>sessionIdOf(item)===id))+1}` : "";
  return [base,ordinal,id===browserCurrentSessionId()?t("sessionNow"):""].filter(Boolean).join(" · ");
}
function sessionMetaLabel(meta,sessions=workbenchSync?.sessions||[]){
  return sessionPrimaryLabel(meta,sessions);
}
function sessionLifecycle(meta){
  if(String(meta?.bindingState||"").toLowerCase()==="stale") return {state:"unknown",label:"绑定已失效",disabled:true};
  const status=String(meta?.status||"").toLowerCase();
  if(["active","working","running"].includes(status)) return {state:"active",label:"工作中",disabled:false};
  if(["stopped","completed","done"].includes(status)) return {state:"stopped",label:"已完成",disabled:false};
  return {state:"unknown",label:"状态未知",disabled:false};
}
function syncSessionSelect(){
  const select=document.getElementById("cg-sync-session");
  if(!select || !workbenchSync) return;
  const sessions=normalizeSessions(workbenchSync.sessions);
  const all=document.createElement("option"); all.value="__all__"; all.textContent=t("allSessions");
  const options=sessions.map(meta=>{
    const option=document.createElement("option");
    option.value=sessionIdOf(meta); option.textContent=sessionMetaLabel(meta,sessions);
    const lifecycle=sessionLifecycle(meta); option.disabled=lifecycle.disabled;
    option.title=lifecycle.label;
    return option;
  });
  select.replaceChildren(all,...options);
  select.disabled=false;
  select.value=workbenchSync.activeSession;
}
function setWorkbenchAccess(ids,session,meta,global,main){
  sessionAuth.clear();
  ids.forEach(id=>sessionAuth.add(id));
  const sessions=normalizeSessions(workbenchSync?.sessions||[]);
  if(workbenchSync) workbenchSync.sessions=sessions;
  const activeMeta=global?null:sessions.find(item=>sessionIdOf(item)===session)||null;
  const accessKey=global?"__all__":session;
  const changedSession=hasRenderedAccessSession && renderedAccessSession!==accessKey;
  const invalidPinnedSession=!hasRenderedAccessSession && global && new URLSearchParams(location.search).has("session");
  if(changedSession || invalidPinnedSession){
    clearRelationMode();
    syncSessionQuery(accessKey);
  }
  renderedAccessSession=accessKey;
  hasRenderedAccessSession=true;
  const label=document.getElementById("session-name");
  const status=document.getElementById("session-status");
  const chip=document.getElementById("session-chip");
  const lifecycle=activeMeta?sessionLifecycle(activeMeta):{state:"empty",label:"未挂载会话",disabled:false};
  const displayName=global?t("allSessions"):sessionMetaLabel(activeMeta,sessions);
  const state=global?"empty":lifecycle.state;
  const stateLabel=global?t("globalSessionView"):lifecycle.label;
  label.textContent=displayName;
  label.title=global&&main?.branch
    ? `${stateLabel} · ${main.branch}${main.sha?` @ ${main.sha.slice(0,8)}`:""}`
    : [stateLabel,activeMeta?sessionBaseLabel(activeMeta):""].filter(Boolean).join(" · ");
  status.className=`session-status ${state}`;
  status.setAttribute("aria-label",stateLabel);
  status.title=stateLabel;
  chip.disabled=false;
  chip.setAttribute("aria-label",`切换 Agent 会话，当前 ${displayName}，${stateLabel}`);
  syncSessionSelect();
  renderSessionMenu();
  refreshCloudPublication();
  applyingServerMap=true;
  try{ if(document.activeElement?.isContentEditable) renderMap(); else renderAll(); }
  finally{ applyingServerMap=false; }
}
function positionSessionMenu(){
  const chip = document.getElementById("session-chip");
  const menu = document.getElementById("session-menu");
  if(!chip || !menu || menu.hidden) return;
  const rect = chip.getBoundingClientRect();
  const width = Math.max(210, menu.offsetWidth||0);
  menu.style.left = `${Math.max(8,Math.min(innerWidth-width-8,rect.right-width))}px`;
  menu.style.top = `${Math.min(innerHeight-(menu.offsetHeight||0)-8,rect.bottom+6)}px`;
}
function closeSessionMenu(){
  const menu = document.getElementById("session-menu");
  const chip = document.getElementById("session-chip");
  if(menu) menu.hidden = true;
  if(chip) chip.setAttribute("aria-expanded","false");
}
function renderCloudPublication(status){
  const button=document.getElementById("btn-publish-main");
  if(!button) return;
  const visible=window.__CG_SERVER?.root?.startsWith("cloud:") && window.__CG_SERVER.root!=="cloud:overview" && status && status.status!=="unavailable";
  button.hidden=!visible;
  if(!visible) return;
  const labels={empty:"Main 未发布",waiting:"待合入 Main",ready:"发布 Main",publishing:"发布中…",published:"Main 已发布",conflict:"需先同步 Main",missing:"Session 不存在",error:"发布失败"};
  button.dataset.status=status.status;
  button.textContent=labels[status.status]||"发布不可用";
  button.disabled=status.status!=="ready";
  const detail=status.reason||(status.mainSha?`main @ ${status.mainSha.slice(0,8)}`:"");
  button.title=detail;
  button.setAttribute("aria-label",detail?`${button.textContent}，${detail}`:button.textContent);
}
async function refreshCloudPublication(){
  if(!workbenchSync || !window.__CG_SERVER?.root?.startsWith("cloud:") || window.__CG_SERVER.root==="cloud:overview"){
    renderCloudPublication(null); return;
  }
  try{ renderCloudPublication(await workbenchSync.call("/api/publication")); }
  catch(error){ renderCloudPublication({status:"error",reason:error.message}); }
}
async function publishCloudMain(){
  const button=document.getElementById("btn-publish-main");
  if(!workbenchSync || !button || button.dataset.status!=="ready" || workbenchSync.isAllSessions()) return;
  if(workbenchSync.dirty()){
    await workbenchSync.flush();
    if(workbenchSync.dirty()){ workbenchSync.setStatus(workbenchSync.status,"请先保存当前 Session Map"); return; }
  }
  renderCloudPublication({status:"publishing"});
  try{
    const result=await workbenchSync.call("/api/publication",{operationId:crypto.randomUUID()});
    if(!result.committed) throw new Error("Main 发布未提交");
    await workbenchSync.selectSession("__all__");
    renderCloudPublication({status:"published",mainSha:result.snapshot?.mainSha});
  }catch(error){
    await refreshCloudPublication();
    workbenchSync.setStatus(workbenchSync.status,"Main 发布失败："+error.message);
  }
}
function renderSessionMenu(){
  const menu = document.getElementById("session-menu");
  if(!menu) return;
  const sessions = normalizeSessions(workbenchSync?.sessions||[]);
  const main=workbenchSync?.project?.main;
  const mainHint=main?.branch?`${t("globalSessionView")} · ${main.branch}${main.sha?` @ ${main.sha.slice(0,8)}`:""}`:t("globalSessionView");
  const all = `<button type="button" role="option" data-session="__all__" aria-selected="${workbenchSync?.isAllSessions?.()===true}" title="${escAttr(mainHint)}">
    <span class="session-option-name">${esc(t("allSessions"))}</span>
  </button>`;
  menu.innerHTML = all + sessions.map(meta=>{
    const lifecycle=sessionLifecycle(meta), id=sessionIdOf(meta);
    return `<button type="button" role="option" data-session="${escAttr(id)}" aria-selected="${id===workbenchSync.activeSession}" aria-disabled="${lifecycle.disabled}" ${lifecycle.disabled?"disabled":""} title="${escAttr(lifecycle.label)}">
      <span class="session-option-name">${esc(sessionMetaLabel(meta,sessions))}</span>
      <span class="session-status ${lifecycle.state}" aria-label="${lifecycle.label}"></span>
    </button>`;
  }).join("");
  menu.querySelectorAll("[data-session]").forEach(button=>{
    button.onclick = async ()=>{
      await workbenchSync?.selectSession(button.dataset.session);
      closeSessionMenu();
    };
  });
  positionSessionMenu();
}
function closeSettings(){
  const menu = document.getElementById("settings-menu");
  const btn = document.getElementById("btn-settings");
  if(menu) menu.classList.remove("open");
  if(btn){ btn.classList.remove("on"); btn.setAttribute("aria-expanded","false"); }
}
function switchRepo(id){
  if(id===repoId){ closeRepoMenu(); return; }
  persist();
  repoId = id;
  const r = currentRepo();
  closeRepoMenu();
  applyRepoChrome();
  if(hasMap(r) || r.live){
    loadLive(r);
    renderAll();
    fitView();
    persist();
    return;
  }
  emptyFirstUse();
  renderAll();
  fitView();
}
function setOverlay(open, view){
  const v = view===true ? "work" : (view||false);
  document.getElementById("first-use").classList.toggle("open", !!open);
  document.getElementById("first-use-ask").hidden = !open || !!v;
  document.getElementById("first-use-work").hidden = v!=="work";
  const cuts = document.getElementById("first-use-cuts");
  if(cuts) cuts.hidden = v!=="cuts";
}
function closeOverlay(){
  setOverlay(false, false);
  currentRepo().firstUseOpen = false;
}
function emptyFirstUse(){
  const next = clone(currentRepo().blueprint);
  adoptTree({...next, memories:[], ideas:[], todos:[], bugs:[], dormant:[], files:[], owns:[], children:[]});
  authUnlockAll();
  selectedId = "T0";
  viewRootId = "T0";
  focusId = null;
  clearCompose();
  analyzing = false;
  currentRepo().bootstrap = "pending";
  currentRepo().firstUseOpen = true;
  currentRepo().live = null;
  document.getElementById("session-name").textContent = "S-0823 "+t("sessionFirst");
  setOverlay(true, false);
  applyRepoChrome();
}
function startEmptyRoot(){
  closeOverlay();
  currentRepo().bootstrap = "ready";
  data.memories = [{text:"绿场项目：只留下根节点。有了真实模块再往下长。", state:"success"}];
  document.getElementById("session-name").textContent = "S-0823 "+t("sessionEmpty");
  renderAll();
  fitView();
  persist();
}
let analyzing = false;
function stepText(s){ return typeof s==="string" ? s : s.do; }
function stepFind(s){ return typeof s==="string" ? "" : (s.find||""); }
function renderAnalyzeLog(steps, active){
  const ul = document.getElementById("analyze-log");
  ul.innerHTML = steps.map((s,i)=>{
    const st = i<active? "done" : i===active? "on" : "wait";
    const find = stepFind(s);
    const findHtml = find && i<=active ? `<div class="find">${find}</div>` : "";
    return `<li class="${st}">${stepText(s)}${findHtml}</li>`;
  }).join("");
}
function proposedTree(r){
  const next = clone(r.blueprint);
  return {
    id: next.id,
    title: next.title,
    state: next.state,
    kind: next.kind,
    bugs: next.bugs||[],
    dormant: next.dormant||[],
    files: next.files||[],
    owns: next.owns||[],
    memories: next.memories||[],
    ideas: next.ideas||[],
    todos: next.todos||[],
    children: (next.children||[]).map(c=>asProposal(clone(c))),
    flows: clone(next.flows||[])
  };
}
function applyProposedMap(){
  const r = currentRepo();
  adoptTree(proposedTree(r));
  authUnlockAll();
  selectedId = "T0";
  viewRootId = "T0";
  focusId = null;
  clearCompose();
  r.bootstrap = "proposed";
  r.live = clone(data);
  document.getElementById("session-name").textContent = "S-0823 "+t("sessionPending");
  closeOverlay();
  renderAll();
  fitView();
  persist();
}
function revealNotes(frac){
  const pre = document.getElementById("analyze-md");
  if(!pre) return;
  const notes = currentRepo().notes || "";
  if(!notes){ pre.hidden = true; return; }
  pre.hidden = false;
  const n = Math.max(120, Math.floor(notes.length * frac));
  pre.textContent = notes.slice(0, n) + (n<notes.length ? "\n…" : "");
}
function cutModules(cut, r){
  if(cut.fromBlueprint) return (r.blueprint.children||[]).map(c=>({title:c.title, purpose:c.purpose||""}));
  return cut.modules||[];
}
/* ================= 画布候选搁板（L1） ================= */
const CAND_FILE = ".codex/context/l1-candidates.json";
let lensDoc = null;          // {lenses:[{id,title,why,candidates:[...]}]}
let lensPick = [];           // [{cid, title, purpose, owns, src, custom}]
const lensCollapsed = new Set();  // 记住每组折叠态，重渲染不丢
let lensMode = false;        // 搁板模式：候选在画布上，无连线
function lensFmt(key, vars){
  let s = t(key);
  Object.entries(vars||{}).forEach(([k,v])=>{ s = s.split("{"+k+"}").join(String(v)); });
  return s;
}
function fileLikeTitle(s){
  return /[\/\\]/.test(s) || /\.(md|json|py|js|ts|html|sh|ya?ml|toml)$/i.test(String(s).trim());
}
async function loadLensDoc(){
  if(lensDoc) return lensDoc;
  try{
    let txt = null;
    if(repoFsOk){
      const f = await readRepoFile(CAND_FILE);
      if(f) txt = await f.text();
    }else{
      const res = await fetch("../"+CAND_FILE, {cache:"no-store"});
      if(res.ok) txt = await res.text();
    }
    if(txt) lensDoc = JSON.parse(txt);
  }catch(e){ lensDoc = null; }
  return lensDoc;
}
function lensById(cid){
  for(const lens of (lensDoc&&lensDoc.lenses)||[]){
    const hit = (lens.candidates||[]).find(c=>c.id===cid);
    if(hit) return {lens, cand: hit};
  }
  return null;
}
function takenTitles(){
  return new Set((data.children||[]).filter(c=>!isCancelled(c)).map(c=>c.title));
}
const SHELF_CARD = {w:168, h:72, gx:22, gy:18};
function hashStr(s){
  let h = 0;
  for(let i=0;i<String(s).length;i++) h = ((h<<5)-h) + String(s).charCodeAt(i)|0;
  return Math.abs(h);
}
function remainingLensGroups(){
  const taken = takenTitles();
  return ((lensDoc&&lensDoc.lenses)||[]).map(lens=>({
    lens,
    cands: (lens.candidates||[]).filter(c=>!taken.has(c.title))
  })).filter(g=>g.cands.length);
}
function shelfClusterSize(n){
  const cols = n<=2 ? Math.max(n,1) : n<=5 ? 3 : 4;
  const rows = Math.ceil(n/cols) || 1;
  return {
    cols, rows,
    w: cols*SHELF_CARD.w + (cols-1)*SHELF_CARD.gx + 36,
    h: 22 + rows*SHELF_CARD.h + (rows-1)*SHELF_CARD.gy + 28
  };
}
function lensTreePad(treeW, treeH){
  if(!lensMode) return {x:0, y:0};
  const groups = remainingLensGroups();
  const sizes = groups.map(g=>shelfClusterSize(g.cands.length));
  const leftW = Math.max(sizes[0]?sizes[0].w:0, sizes[2]?sizes[2].w:0);
  const topH = Math.max(sizes[0]?sizes[0].h:0, sizes[1]?sizes[1].h:0);
  return {x: (leftW? leftW+56 : 0), y: (topH? topH+48 : 0), sizes, groups};
}
function renderLensShelf(){
  let shelf = document.getElementById("lens-shelf");
  if(!lensMode){
    if(shelf) shelf.remove();
    const bar = document.getElementById("lens-bar");
    if(bar) bar.remove();
    return;
  }
  const world = document.getElementById("world");
  if(!shelf){
    shelf = document.createElement("div");
    shelf.className = "lens-shelf";
    shelf.id = "lens-shelf";
    world.appendChild(shelf);
  }
  const groups = remainingLensGroups();
  shelf.innerHTML = groups.map(g=>
    `<span class="shelf-label" data-lens="${escAttr(g.lens.id)}">${esc(g.lens.title)}</span>` +
    g.cands.map(c=>`<button type="button" class="shelf-card" data-lens="${escAttr(g.lens.id)}" data-cand="${escAttr(c.id)}">
      <b>${esc(c.title)}</b><span class="p">${esc(c.purpose||"")}</span>
    </button>`).join("")
  ).join("");
  shelf.querySelectorAll(".shelf-card").forEach(b=>{
    b.onclick = ()=>{
      const hit = lensById(b.dataset.cand);
      if(!hit) return;
      attachCandidate(hit.lens, hit.cand);
    };
  });
  renderLensBar();
}
function layoutLensShelf(treeW, treeH, pad){
  const shelf = document.getElementById("lens-shelf");
  if(!shelf || !lensMode) return {w:treeW, h:treeH};
  const groups = pad.groups || remainingLensGroups();
  const sizes = pad.sizes || groups.map(g=>shelfClusterSize(g.cands.length));
  const ox = pad.x||0, oy = pad.y||0;
  /* 四个视角围住主图：左上 / 右上 / 左下 / 右下 */
  const origins = [
    {x:0, y:0},
    {x: ox + treeW + 56, y:0},
    {x:0, y: oy + treeH + 48},
    {x: ox + treeW + 56, y: oy + treeH + 48}
  ];
  let maxX = ox + treeW, maxY = oy + treeH;
  groups.forEach((g, gi)=>{
    const origin = origins[gi] || origins[origins.length-1];
    const sz = sizes[gi] || shelfClusterSize(g.cands.length);
    const lab = shelf.querySelector(`.shelf-label[data-lens="${g.lens.id}"]`);
    if(lab){ lab.style.left = origin.x+"px"; lab.style.top = origin.y+"px"; }
    g.cands.forEach((c, i)=>{
      const cols = sz.cols;
      const col = i % cols;
      const row = Math.floor(i / cols);
      /* 错位 + 抖动，避免组内再竖成一列 */
      const jitterX = (hashStr(c.id+"x")%29) - 14;
      const jitterY = (hashStr(c.title+"y")%21) - 10;
      const stagger = (row%2 ? 26 : 0) + (col%2 ? 12 : -8);
      const x = origin.x + col*(SHELF_CARD.w + SHELF_CARD.gx) + stagger + jitterX;
      const y = origin.y + 20 + row*(SHELF_CARD.h + SHELF_CARD.gy) + ((i*13)%17) + jitterY;
      const el = shelf.querySelector(`.shelf-card[data-cand="${c.id}"]`);
      if(el){ el.style.left = x+"px"; el.style.top = y+"px"; }
      maxX = Math.max(maxX, x + SHELF_CARD.w);
      maxY = Math.max(maxY, y + SHELF_CARD.h);
    });
  });
  const hint = shelf.querySelector('.shelf-label[data-lens="hint"]');
  if(hint) hint.remove();
  return {w:maxX, h:maxY};
}
function attachCandidate(lens, cand){
  if((data.children||[]).some(c=>!isCancelled(c) && c.title===cand.title)) return;
  const node = U("L"+(++NODE_SEQ), cand.title, cand.purpose||"", [], {owns:(cand.owns||[]).slice()});
  node.proposal = "proposed"; node.isNew = true; node.origin = "agent";
  data.children = (data.children||[]).concat([node]);
  viewRootId = data.id;
  selectedId = node.id;
  renderLensShelf();
  renderAll();
  fitView();
  persist();
}
function detachLensNode(n){
  const parentPath = findPath(n.id);
  if(!parentPath || parentPath.length<2) return;
  const parent = parentPath[parentPath.length-2];
  parent.children = (parent.children||[]).filter(c=>c!==n);
  selectedId = parent.id;
  renderLensShelf();
  renderAll();
  fitView();
  persist();
}
function lensValidate(){
  const kids = (data.children||[]).filter(c=>!isCancelled(c));
  const errs = [];
  const n = kids.length;
  if(n<4) errs.push({key:"lensNeedMin", vars:{n:4-n}});
  if(n>8) errs.push({key:"lensTooMany", vars:{}});
  if(kids.some(p=>!String(p.purpose||"").trim())) errs.push({key:"lensNoPurpose", vars:{}});
  if(kids.some(p=>fileLikeTitle(p.title))) errs.push({key:"lensFileTitle", vars:{}});
  return errs;
}
function renderLensBar(){
  let bar = document.getElementById("lens-bar");
  if(!lensMode){
    if(bar) bar.remove();
    return;
  }
  if(!bar){
    bar = document.createElement("div");
    bar.className = "lens-bar";
    bar.id = "lens-bar";
    document.getElementById("viewport").appendChild(bar);
  }
  const n = (data.children||[]).filter(c=>!isCancelled(c)).length;
  const errs = lensValidate();
  const warn = errs.length ? `<span class="warn">· ${esc(lensFmt(errs[0].key, errs[0].vars))}</span>` : "";
  bar.innerHTML = `<span class="cnt">${esc(t("lensPick"))}: ${n}/4–8</span>${warn}
    <span class="warn" style="color:var(--muted);font-weight:400">${esc(t("lensShelfHint"))}</span>
    <button type="button" id="lens-exit">${esc(t("lensExitL1"))}</button>
    <button type="button" class="primary" id="lens-finish-canvas" ${errs.length?"disabled":""}>${esc(t("lensFinishL1"))}</button>`;
  bar.querySelector("#lens-exit").onclick = ()=>exitLensMode();
  bar.querySelector("#lens-finish-canvas").onclick = ()=>{
    if(lensValidate().length) return;
    exitLensMode(false);
  };
}
async function enterLensMode(){
  const doc = await loadLensDoc();
  if(!doc){
    /* 没有候选文件时退回旧的弹窗候选池 */
    showCuts();
    return;
  }
  lensDoc = doc;
  lensMode = true;
  viewRootId = data.id;
  selectedId = data.id;
  const btn = document.getElementById("btn-lens");
  if(btn){ btn.classList.add("on"); btn.setAttribute("aria-pressed","true"); }
  renderLensShelf();
  renderAll();
  fitView();
}
function exitLensMode(keep=true){
  lensMode = false;
  const btn = document.getElementById("btn-lens");
  if(btn){ btn.classList.remove("on"); btn.setAttribute("aria-pressed","false"); }
  renderLensShelf();
  renderAll();
  fitView();
}
document.getElementById("btn-lens").onclick = ()=>{
  closeSettings();
  if(lensMode){ exitLensMode(); return; }
  if(bugPathMode) exitBugPath(true);
  if(relationMode){ relationMode = false; relAnchorId = null;
    const rb = document.getElementById("btn-rel");
    rb.classList.remove("on"); rb.setAttribute("aria-pressed","false");
    document.body.classList.remove("rel-mode");
  }
  enterLensMode();
};
function startRepoSplit(){
  enterLensMode();
}
function reanalyzeRepo(id){
  closeRepoMenu();
  if(id!==repoId){
    persist();
    repoId = id;
    applyRepoChrome();
  }
  emptyFirstUse();
  enterLensMode();
}

/* ================= 树工具 ================= */
function walk(node, fn, parents=[]){
  if(!node) return;
  fn(node, parents);
  (node.children||[]).forEach(c=>walk(c, fn, [...parents, node]));
}
function findPath(id){
  let live=null, any=null;
  walk(data,(n,ps)=>{
    if(n.id!==id) return;
    const path=[...ps,n];
    any = path;
    if(!isCancelled(n)) live = path;
  });
  return live || any;
}
function pathOf(node){
  let result=null;
  walk(data,(n,ps)=>{ if(n===node) result=[...ps,n]; });
  return result;
}
function getNode(id){ const p=findPath(id); return p? p[p.length-1] : null; }
function getNodeAny(id){
  const live = getNode(id);
  if(live) return live;
  let hit=null;
  walkAll(data, n=>{ if(!hit && n.id===id) hit=n; });
  return hit;
}
function isCancelled(n){ return n.proposal==="cancelled"; }
function isProposed(n){
  if(!n || n.proposal!=="proposed") return false;
  if(n.origin==="human") return false;
  return true;
}
function isAllSessionsView(){ return workbenchSync?.isAllSessions?.()===true; }
function isAuth(n){
  if(window.__CG_PREVIEW || !window.__CG_SERVER) return true;
  return isAllSessionsView() || sessionAuth.has(n.id);
}
function authUnlockAll(){
  sessionAuth.clear();
  walkAll(data, n=>{ if(n && n.id) sessionAuth.add(n.id); });
}
const WORK_STATES = ["dirty","untested","success","failed"];
function workDotState(n){
  const s = n && n.state;
  return WORK_STATES.indexOf(s)>=0 ? s : "dirty";
}
function workStateHint(s){
  return t("stateHint_"+s) || t("state_"+s);
}
function prefersFineHover(){
  try{ return window.matchMedia("(hover: hover) and (pointer: fine)").matches; }catch(e){ return true; }
}
function nodeDotHtml(n, extraClass){
  const st = workDotState(n);
  const hint = workStateHint(st);
  const native = prefersFineHover() ? "" : ` title="${escAttr(hint)}"`;
  return `<i class="dot ${extraClass||""} ${st}" data-hint="${escAttr(hint)}" aria-label="${escAttr(hint)}"${native}></i>`;
}
let dotHintEl = null;
function hideDotHint(){
  if(!dotHintEl) dotHintEl = document.getElementById("dot-hint");
  if(dotHintEl) dotHintEl.hidden = true;
}
function showDotHint(dot){
  const text = dot && dot.getAttribute("data-hint");
  if(!text) return;
  if(!dotHintEl) dotHintEl = document.getElementById("dot-hint");
  if(!dotHintEl) return;
  dotHintEl.textContent = text;
  dotHintEl.hidden = false;
  const r = dot.getBoundingClientRect();
  const tw = dotHintEl.offsetWidth;
  const th = dotHintEl.offsetHeight;
  let left = r.left + r.width/2 - tw/2;
  let top = r.top - th - 8;
  if(top < 52) top = r.bottom + 8;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  dotHintEl.style.left = left+"px";
  dotHintEl.style.top = top+"px";
}
function bindNodeDotHint(div){
  const dot = div.querySelector(".dot[data-hint]");
  if(!dot) return;
  dot.addEventListener("pointerenter", ()=>showDotHint(dot));
  dot.addEventListener("pointerleave", hideDotHint);
}
/* 按仓库里实际有没有做、有没有测，给节点上色。旧缓存若还是蓝点，只升不降。 */
const MAP_COMPLETION = {
  T0:"untested",
  M1:"untested", N400:"untested", N405:"untested", N406:"untested", N407:"untested",
  N409:"untested", N410:"untested", N411:"untested", N412:"untested",
  N401:"untested", N402:"untested", N403:"dirty", N404:"untested",
  M2:"untested", N413:"success", N415:"success", N416:"success", N418:"dirty",
  N420:"success", N422:"dirty", N423:"dirty", N424:"dirty",
  N425:"untested", N426:"dirty", N427:"untested",
  M3:"success", N428:"success", N432:"success", N429:"success", N430:"success",
  N431:"success", N433:"success", N434:"untested",
  M4:"untested", N435:"success", N437:"success", N438:"success",
  N439:"dirty", N440:"dirty", N444:"success",
  N436:"untested", N441:"dirty", N442:"dirty", N443:"dirty",
  M5:"untested", N446:"success", N447:"untested"
};
function stampMapCompletion(){
  walkAll(data, n=>{
    if(!n || isCancelled(n)) return;
    const want = MAP_COMPLETION[n.id];
    if(!want || want==="dirty") return;
    if(workDotState(n)==="dirty") n.state = want;
  });
}
function depthFromView(n){
  const p = findPath(n.id);
  if(!p) return 99;
  const i = p.findIndex(x=>x.id===viewRootId);
  if(i<0) return 99;
  return p.length-1-i;
}
function isCatalogView(){
  if(bugPathMode) return false;
  return viewRootId===data.id;
}
function visibleChildren(n){
  if(!n || isCancelled(n)) return [];
  if(bugPathMode && bugFocus){
    const path = findPath(bugFocus.nodeId);
    if(!path) return [];
    const idx = path.findIndex(x=>x.id===n.id);
    if(idx<0 || idx===path.length-1) return [];
    const next = path[idx+1];
    return (n.children||[]).filter(c=>c.id===next.id && !isCancelled(c));
  }
  const kids = (n.children||[]).filter(c=>!isCancelled(c));
  if(n.id===viewRootId) return kids;
  if(isCatalogView()) return [];
  /* 模块不展开。开工节点后面还可再接开工节点或一个模块（最多两岔）则默认展开。 */
  if(n.kind==="module") return [];
  if(kids.length>2) return [];
  return kids;
}
function liveViewRoot(){
  if(bugPathMode){
    viewRootId = data.id;
    return data;
  }
  let n = getNode(viewRootId) || data;
  let guard = 0;
  while(n && isCancelled(n) && n.id!==data.id && guard++<80){
    const p = pathOf(n) || findPath(n.id);
    n = (p && p.length>1) ? p[p.length-2] : data;
  }
  if(!n) n = data;
  if(n.id!==viewRootId) viewRootId = n.id;
  return n;
}
function liveSelected(){
  let n = getNode(selectedId);
  if(n && !isCancelled(n)) return n;
  const p = (n && pathOf(n)) || findPath(selectedId) || [];
  for(let i=p.length-2;i>=0;i--){
    if(p[i] && !isCancelled(p[i])){ selectedId = p[i].id; return p[i]; }
  }
  selectedId = liveViewRoot().id;
  return getNode(selectedId) || data;
}
function canEnter(n){
  if(!n || n.id===viewRootId) return false;
  if(n.kind==="module") return true;
  if(n._inbox && n._inbox.length) return true;
  const kids = (n.children||[]).filter(c=>!isCancelled(c));
  return kids.length>2;
}
function vwalk(node, fn, parents=[]){
  if(!node || isCancelled(node)) return;
  fn(node, parents);
  visibleChildren(node).forEach(c=>vwalk(c, fn, [...parents, node]));
}
function onFocusPath(id){
  if(!focusId) return true;
  const fp = findPath(focusId).map(n=>n.id);
  const p  = findPath(id).map(n=>n.id);
  return fp.includes(id) || p.includes(focusId);
}
function flowPartners(id){
  const s = new Set([id]);
  (data.flows||[]).forEach(f=>{
    if(f.from===id) s.add(f.to);
    if(f.to===id) s.add(f.from);
  });
  return s;
}
function subtreeIds(n){
  const ids=[];
  walk(n,(x)=>{ if(!isCancelled(x) && !isProposed(x)) ids.push(x.id); });
  return ids;
}
function moduleAuthState(n){
  if(isAllSessionsView()) return "all";
  const ids = subtreeIds(n);
  const inCount = ids.filter(id=>sessionAuth.has(id)).length;
  if(inCount===0) return "none";
  if(inCount===ids.length) return "all";
  return "partial";
}
function toggleAuth(n){
  if(!workbenchSync?.ready){ workbenchSync?.setStatus("readonly"); return; }
  if(isAllSessionsView()){ workbenchSync?.setStatus(workbenchSync.status,"请先选择具体 Session 再调整授权"); return; }
  if(isProposed(n)||isCancelled(n)) return;
  if(n.kind==="module"){
    const ids = subtreeIds(n);
    const st = moduleAuthState(n);
    if(st==="all"){ ids.forEach(id=>sessionAuth.delete(id)); }
    else{
      ids.forEach(id=>sessionAuth.add(id));
      /* Scope is explicit; granting a child does not grant its ancestors. */
    }
  }else{
    if(sessionAuth.has(n.id)) sessionAuth.delete(n.id);
    else{
      sessionAuth.add(n.id);
      /* Scope is explicit; granting a child does not grant its ancestors. */
    }
  }
  workbenchSync?.toggleAccess([...sessionAuth]);
  renderAll();
}
function cancelledList(){
  const out=[];
  walk(data,(n,ps)=>{ if(isCancelled(n)) out.push({node:n, parent:ps[ps.length-1]}); });
  return out;
}
function alsoIds(obj){
  const a = obj && obj.also;
  if(Array.isArray(a)) return a.map(String);
  if(typeof a==="string") return a.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  return [];
}
function bugsFor(node){
  const rows = (node.bugs||[]).filter(b=>b && b.status!=="dormant").map(b=>({bug:b, home:true, from:node.id}));
  const seen = new Set(rows.map(r=>r.bug.id));
  walkAll(data, n=>{
    if(!n || n.id===node.id || isCancelled(n)) return;
    (n.bugs||[]).forEach(b=>{
      if(!b || b.status==="dormant") return;
      if(!alsoIds(b).includes(node.id) || seen.has(b.id)) return;
      seen.add(b.id);
      rows.push({bug:b, home:false, from:n.id});
    });
  });
  return rows;
}
function memsAlsoFor(node){
  const rows=[];
  const seen=new Set();
  const anc = new Set((findPath(node.id)||[]).map(x=>x.id));
  walkAll(data, n=>{
    if(!n || n.id===node.id || isCancelled(n) || anc.has(n.id)) return;
    (n.memories||[]).forEach(m=>{
      if(!m || !alsoIds(m).includes(node.id)) return;
      const k = m.id || m.text;
      if(seen.has(k)) return;
      seen.add(k);
      rows.push({mem:m, from:n.id});
    });
  });
  return rows;
}
function findBugHome(bugId){
  let found=null;
  walkAll(data, n=>{
    if(found || isCancelled(n)) return;
    if((n.bugs||[]).some(b=>b && b.id===bugId)) found=n;
  });
  return found;
}
function walkAll(node, fn, parents=[]){
  if(!node) return;
  fn(node, parents);
  (node.children||[]).forEach(c=>walkAll(c, fn, [...parents, node]));
  (node._inbox||[]).forEach(c=>walkAll(c, fn, [...parents, node]));
}
function currentSessionId(){ return isAllSessionsView() ? null : workbenchSync?.activeSession || null; }
const bugDispatching = new Set();
const todoDispatching = new Set();
function sessionColor(name){
  const pal=["#2f7ae6","#d48b12","#6b4ea8","#2f9e44","#d23d3d"];
  let h=0;
  String(name||"").split("").forEach(ch=>{ h=(h*33+ch.charCodeAt(0))|0; });
  return pal[Math.abs(h)%pal.length];
}

function bugSessionsOf(bug){
  if(!bug) return [];
  if(!Array.isArray(bug.sessions)) bug.sessions = [];
  const seen = new Set();
  bug.sessions = bug.sessions.filter(s=>{
    const k = String(s||"").trim();
    if(!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return bug.sessions;
}
function sessionMetaOf(sessionId){
  return normalizeSessions(workbenchSync?.sessions||[]).find(item=>sessionIdOf(item)===sessionId) || null;
}
function sessionDisplayName(sessionId){
  const meta = sessionMetaOf(sessionId);
  return meta ? sessionPrimaryLabel(meta) : (uiLang==="en"?"Agent session":"Agent 会话");
}
function bugProgress(bug){
  const status = String(bug?.status||"open");
  if(status==="pending") return {kind:"settling", label:t("bugSettling"), detail:""};
  if(status==="fixed") return {kind:"fixed", label:t("bugFixed"), detail:""};
  if(status==="resolved"||status==="dormant") return {kind:"resolved", label:t("bugResolved"), detail:""};
  if(status==="deferred") return {kind:"deferred", label:t("bugDeferred"), detail:""};
  if(status==="wontfix") return {kind:"wontfix", label:t("bugWontFix"), detail:""};
  const sessions = bugSessionsOf(bug);
  if(!sessions.length){
    if(bugDispatching.has(bug?.id)) return {kind:"waiting", label:`${t("bugWaiting")} · ${t("bugSending")}`, detail:""};
    if(bug?.dispatch?.status==="failed") return {kind:"waiting", label:`${t("bugWaiting")} · ${t("bugSendFailed")}`, detail:""};
    return {kind:"waiting", label:t("bugWaiting"), detail:""};
  }
  const sentAt = Date.parse(bug?.dispatch?.at||"");
  const recentlySent = bug?.dispatch?.status==="sent" && Number.isFinite(sentAt) && Date.now()-sentAt<30000
    ? bug.dispatch.session_id
    : null;
  const active = sessions.filter(id=>sessionMetaOf(id)?.status!=="stopped" || id===recentlySent);
  const handling = active.length ? active : sessions;
  const names = handling.map(sessionDisplayName);
  const detail = names.join("、");
  const compact = names.length>1 ? `${names[0]} +${names.length-1}` : names[0];
  return {
    kind:active.length?"processing":"handoff",
    label:`${t(active.length?"bugProcessing":"bugHandoff")} · ${compact}`,
    detail
  };
}
function bugProgressHtml(bug){
  const state = bugProgress(bug);
  return `<span class="bug-status ${state.kind}"${state.detail?` title="${escAttr(state.detail)}"`:""}>${esc(state.label)}</span>`;
}
function todoSessionsOf(todo){ return bugSessionsOf(todo); }
function todoProgress(todo){
  const status = String(todo?.status||"pending");
  if(status==="done") return {kind:"resolved",label:t("todoDone"),detail:""};
  if(status==="pending"){
    if(todoDispatching.has(todo?.id)) return {kind:"waiting",label:`${t("todoPending")} · ${t("bugSending")}`,detail:""};
    if(todo?.dispatch?.status==="scope-required") return {kind:"waiting",label:`${t("todoPending")} · ${t("todoScopeRequired")}`,detail:""};
    if(todo?.dispatch?.status==="failed") return {kind:"waiting",label:`${t("todoPending")} · ${t("bugSendFailed")}`,detail:""};
    return {kind:"waiting",label:t("todoPending"),detail:""};
  }
  const sessions = todoSessionsOf(todo);
  const names = sessions.map(sessionDisplayName);
  return {kind:"processing",label:names.length?`${t("todoProcessing")} · ${names[0]}${names.length>1?` +${names.length-1}`:""}`:t("todoProcessing"),detail:names.join("、")};
}
function todoProgressHtml(todo){
  const state = todoProgress(todo);
  return `<span class="bug-status ${state.kind}"${state.detail?` title="${escAttr(state.detail)}"`:""}>${esc(state.label)}</span>`;
}
function openBugList(){
  const out=[];
  walkAll(data,(n,ps)=>{
    if(isCancelled(n)) return;
    (n.bugs||[]).forEach(b=>{
      if(!b || b.status==="dormant") return;
      out.push({bug:b, node:n, path:[...ps, n]});
    });
  });
  ((workbenchSync&&workbenchSync.doc&&workbenchSync.doc.unassigned_bugs)||[]).forEach(b=>{
    if(b && b.status!=="dormant") out.push({bug:b, node:data, path:[data], unassigned:true});
  });
  return out;
}
function revealPath(path){
  if(!path || path.length<2) return;
  for(let i=0;i<path.length-1;i++){
    const parent = path[i], child = path[i+1];
    if((parent.children||[]).some(c=>c.id===child.id)) continue;
    if((parent._inbox||[]).some(c=>c.id===child.id)) unpackInbox(parent);
  }
}
function focusedBug(){
  if(!bugFocus) return null;
  const n = getNode(bugFocus.nodeId);
  if(!n) return null;
  const b = (n.bugs||[]).find(x=>x.id===bugFocus.bugId);
  if(b) return {node:n, bug:b, unassigned:false};
  const loose = ((workbenchSync&&workbenchSync.doc&&workbenchSync.doc.unassigned_bugs)||[]).find(x=>x.id===bugFocus.bugId);
  return loose ? {node:n, bug:loose, unassigned:true} : null;
}
function clearRelationQuery(){
  const url=new URL(location.href);
  if(!url.searchParams.has("relation")) return;
  url.searchParams.delete("relation");
  history.replaceState(history.state,"",`${url.pathname}${url.search}${url.hash}`);
}
function syncSessionQuery(sessionId){
  const url=new URL(location.href);
  if(sessionId && sessionId!=="__all__") url.searchParams.set("session",sessionId);
  else url.searchParams.delete("session");
  url.searchParams.delete("relation");
  history.replaceState(history.state,"",`${url.pathname}${url.search}${url.hash}`);
}
function clearRelationMode(options={}){
  const changed=relationMode || relAnchorId!==null;
  relationMode = false;
  relAnchorId = null;
  if(options.clearDeepLink) clearRelationQuery();
  const btn = document.getElementById("btn-rel");
  if(btn){
    btn.classList.remove("on");
    btn.setAttribute("aria-pressed","false");
  }
  document.body.classList.remove("rel-mode");
  return changed;
}
function applyRelationDeepLink(){
  const relationId=String(new URLSearchParams(location.search).get("relation")||"").trim();
  if(!relationId) return false;
  const node=getNode(relationId);
  if(!node || isCancelled(node)){
    clearRelationMode({clearDeepLink:true});
    return false;
  }
  relationMode=true;
  relAnchorId=relationId;
  selectedId=relationId;
  const btn=document.getElementById("btn-rel");
  if(btn){ btn.classList.add("on"); btn.setAttribute("aria-pressed","true"); }
  document.body.classList.add("rel-mode");
  return true;
}
function enterBugPath(nodeId, bugId){
  clearRelationMode();
  let path = findPath(nodeId);
  if(!path || !path.length){
    walkAll(data,(n,ps)=>{ if(n.id===nodeId) path = [...ps, n]; });
  }
  revealPath(path||[]);
  path = findPath(nodeId);
  if(!path || !path.length) return;
  if(!bugPathMode){
    bugPathReturn = {viewRootId, selectedId};
  }
  bugPathMode = true;
  bugFocus = {nodeId, bugId};
  selectedId = nodeId;
  viewRootId = data.id;
  document.body.classList.add("bug-path-mode");
  openBugPanel(true);
  renderAll();
  fitView();
}
function exitBugPath(restore){
  if(!bugPathMode) return;
  bugPathMode = false;
  bugFocus = null;
  document.body.classList.remove("bug-path-mode");
  const ret = bugPathReturn;
  bugPathReturn = null;
  if(restore!==false && ret){
    viewRootId = ret.viewRootId || data.id;
    selectedId = ret.selectedId;
  }
  liveViewRoot();
  liveSelected();
  renderAll();
  fitView();
}
function openBugPanel(open){
  if(open) document.getElementById("tray").classList.remove("open");
  document.body.classList.toggle("bugs-open", !!open);
  document.getElementById("bug-panel").classList.toggle("open", !!open);
  document.getElementById("btn-bugs").classList.toggle("on", !!open);
}

function sessionOptionsHtml(selected, requireChoice){
  const empty = requireChoice ? `<option value="">${esc(t("chooseSession"))}</option>` : "";
  const sessions=normalizeSessions(workbenchSync?.sessions||[]);
  return empty + sessions.map(meta=>{
    const id=sessionIdOf(meta), lifecycle=sessionLifecycle(meta);
    return `<option value="${escAttr(id)}" ${id===selected?"selected":""} ${lifecycle.disabled?"disabled":""}>${esc(sessionMetaLabel(meta,sessions))}</option>`;
  }).join("");
}

function scopePreview(plan){
  const labels = (plan?.missing||[]).map(id=>getNodeAny(id)?.title||id);
  const shown = labels.slice(0,8).join("、");
  return shown + (labels.length>8?` 等 ${labels.length} 个节点`:"");
}

async function promptWorkAssignment(node, item=null, kind="bug"){
  const fixedSession = currentSessionId();
  const creating = !item;
  const todo = kind==="todo";
  const dialog = document.createElement("dialog");
  dialog.className = "bug-assign-dialog";
  dialog.innerHTML = `<form>
    ${creating?`<label>${esc(t(todo?"todoDescLabel":"bugDescLabel"))}<textarea name="desc" required maxlength="10000"></textarea></label>`:""}
    ${fixedSession
      ? `<input type="hidden" name="session" value="${escAttr(fixedSession)}">`
      : `<label>${esc(t("targetSession"))}<select name="session" required>${sessionOptionsHtml("",true)}</select></label>`}
    <div class="scope-warning" data-scope hidden></div>
    <div class="dialog-actions">
      <button type="button" data-cancel>${esc(t("cancel"))}</button>
      <button type="submit" class="primary" data-submit disabled>${esc(t("createAndSend"))}</button>
    </div>
  </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector("form");
  const select = form.elements.session;
  const warning = dialog.querySelector("[data-scope]");
  const submit = dialog.querySelector("[data-submit]");
  let plan = null, generation = 0, settled = false;
  const finish = value=>{
    if(settled) return;
    settled = true;
    dialog.close();
    dialog.remove();
    resolveDialog(value);
  };
  let resolveDialog;
  const result = new Promise(resolve=>{ resolveDialog=resolve; });
  async function updatePlan(){
    const sid = select.value;
    const turn = ++generation;
    plan = null; submit.disabled = true; warning.hidden = true;
    if(!sid) return;
    try{
      const next = await workbenchSync.accessPlan(sid,node.id);
      if(turn!==generation) return;
      plan = next;
      const count = next.missing?.length||0;
      warning.hidden = count===0;
      warning.textContent = count ? `${t("scopeRequired").replace("{n}",count)} ${scopePreview(next)}` : "";
      submit.textContent = count?t("authorizeAndSend"):t("createAndSend");
      submit.disabled = false;
    }catch(error){
      if(turn!==generation) return;
      workbenchSync?.setStatus(workbenchSync.status,"无法核对 Session 权限："+error.message);
    }
  }
  select.onchange = updatePlan;
  dialog.querySelector("[data-cancel]").onclick = ()=>finish(null);
  dialog.addEventListener("cancel",e=>{ e.preventDefault(); finish(null); });
  form.onsubmit = e=>{
    e.preventDefault();
    if(!plan || plan.sessionId!==select.value) return;
    const desc = creating ? String(form.elements.desc.value||"").trim() : "";
    const title = desc.split(/\r?\n/)[0].trim().slice(0,120);
    if(creating && !desc){ form.elements.desc.focus(); return; }
    finish({sessionId:select.value, plan, title, desc});
  };
  dialog.showModal();
  if(creating) form.elements.desc.focus();
  void updatePlan();
  return result;
}

function promptBugAssignment(node,bug=null){ return promptWorkAssignment(node,bug,"bug"); }
function promptTodoAssignment(node,todo=null){ return promptWorkAssignment(node,todo,"todo"); }

async function dispatchBugToSession(node,bug,sessionId,plan){
  if(!node || !bug || !sessionId || bugDispatching.has(bug.id)) return false;
  bugDispatching.add(bug.id);
  renderAll();
  try{
    await workbenchSync.flush();
    if(plan?.missing?.length) await workbenchSync.grantSessionScope(sessionId,plan.nodes);
    await workbenchSync.sendBug(sessionId,node.id,bug.id);
    const sessions = bugSessionsOf(bug);
    if(!sessions.includes(sessionId)) sessions.push(sessionId);
    bug.dispatch = {status:"sent",session_id:sessionId,at:new Date().toISOString()};
    return true;
  }catch(error){
    bug.dispatch = {status:"failed",session_id:sessionId,at:new Date().toISOString(),error:error?.code||"SESSION_MESSAGE_FAILED"};
    workbenchSync?.setStatus(workbenchSync.status,"Bug 信息发送失败");
    return false;
  }finally{
    bugDispatching.delete(bug.id);
    renderAll();
    await workbenchSync?.flush();
  }
}

async function createAssignedBug(node){
  const assignment = await promptBugAssignment(node);
  if(!assignment) return;
  foldBug = true;
  const bid = "B"+(BUG_SEQ++);
  const bug = {id:bid,title:assignment.title,desc:assignment.desc,status:"open",sessions:[],files:[],record:".codex/context/bugs/"+bid+".md"};
  node.bugs.push(bug);
  await dispatchBugToSession(node,bug,assignment.sessionId,assignment.plan);
}

function nextTodoId(){
  const used = new Set();
  walkAll(data,n=>(n.todos||[]).forEach(todo=>used.add(todo.id)));
  let id;
  do { id = "TD"+(TODO_SEQ++); } while(used.has(id));
  return id;
}

async function dispatchTodoToSession(node,todo,sessionId,plan){
  if(!node || !todo || !sessionId || todoDispatching.has(todo.id)) return false;
  todoDispatching.add(todo.id);
  renderAll();
  try{
    await workbenchSync.flush();
    if(plan?.missing?.length) await workbenchSync.grantSessionScope(sessionId,plan.nodes);
    await workbenchSync.sendTodo(sessionId,node.id,todo.id);
    const sessions = todoSessionsOf(todo);
    if(!sessions.includes(sessionId)) sessions.push(sessionId);
    todo.status = "processing";
    todo.dispatch = {status:"sent",session_id:sessionId,at:new Date().toISOString()};
    return true;
  }catch(error){
    todo.status = "pending";
    todo.dispatch = {status:"failed",session_id:sessionId,at:new Date().toISOString(),error:error?.code||"SESSION_MESSAGE_FAILED"};
    workbenchSync?.setStatus(workbenchSync.status,"TODO 信息发送失败");
    return false;
  }finally{
    todoDispatching.delete(todo.id);
    renderAll();
    await workbenchSync?.flush();
  }
}

async function createAssignedTodo(node){
  const assignment = await promptTodoAssignment(node);
  if(!assignment) return;
  foldTodo = true;
  const todo = {id:nextTodoId(),title:assignment.title,desc:assignment.desc,status:"pending",sessions:[]};
  node.todos.push(todo);
  await dispatchTodoToSession(node,todo,assignment.sessionId,assignment.plan);
}

async function finalizeInlineTodo(node,todo){
  const sessionId = todo?.target_session;
  if(!node || !todo || !sessionId || !todo.desc) return;
  try{
    const plan = await workbenchSync.accessPlan(sessionId,node.id);
    if(plan.missing?.length){
      todo.dispatch = {status:"scope-required",session_id:sessionId,at:new Date().toISOString()};
      renderAll();
      await workbenchSync?.flush();
      return;
    }
    await dispatchTodoToSession(node,todo,sessionId,plan);
  }catch(error){
    todo.dispatch = {status:"failed",session_id:sessionId,at:new Date().toISOString(),error:error?.code||"SESSION_MESSAGE_FAILED"};
    renderAll();
    await workbenchSync?.flush();
  }
}

async function sendPendingTodo(node,todo){
  const sessionId = todo?.target_session || currentSessionId();
  if(!sessionId) return;
  try{
    const plan = await workbenchSync.accessPlan(sessionId,node.id);
    await dispatchTodoToSession(node,todo,sessionId,plan);
  }catch(error){
    todo.dispatch = {status:"failed",session_id:sessionId,at:new Date().toISOString(),error:error?.code||"SESSION_MESSAGE_FAILED"};
    renderAll();
    await workbenchSync?.flush();
  }
}

async function advanceTodo(node,todo){
  if(!node || !todo || todo.draft || todoDispatching.has(todo.id)) return;
  if(todo.status==="done"){
    todo.status = todo.sessions?.length ? "processing" : "pending";
    renderAll();
    return;
  }
  if(todo.status==="processing"){
    todo.status = "done";
    renderAll();
    return;
  }
  const assignment = await promptTodoAssignment(node,todo);
  if(assignment) await dispatchTodoToSession(node,todo,assignment.sessionId,assignment.plan);
}

async function toggleBugSession(node, bug){
  if(!node || !bug) return;
  let sid = currentSessionId();
  const list = bugSessionsOf(bug);
  const i = sid ? list.indexOf(sid) : -1;
  if(i>=0){
    list.splice(i,1);
    if(bug.dispatch?.session_id===sid) delete bug.dispatch;
    renderAll();
    return;
  }
  let plan;
  if(sid){
    try{ plan = await workbenchSync.accessPlan(sid,node.id); }
    catch(error){ workbenchSync?.setStatus(workbenchSync.status,"无法核对 Session 权限："+error.message); return; }
  }
  if(!sid || plan?.missing?.length){
    const assignment = await promptBugAssignment(node,bug);
    if(!assignment) return;
    sid = assignment.sessionId; plan = assignment.plan;
  }
  await dispatchBugToSession(node,bug,sid,plan);
}
function renderBugPanel(){
  const list = openBugList();
  const countEl = document.getElementById("bug-count");
  if(countEl) countEl.textContent = list.length;
  const ul = document.getElementById("bug-panel-list");
  if(!ul) return;
  if(!list.length){
    ul.innerHTML = `<li class="empty">${t("noOpenBugs")}</li>`;
    return;
  }
  const sid = currentSessionId();
  ul.innerHTML = list.map(item=>{
    const title = item.bug.title || t("unnamedBug");
    const on = bugFocus && bugFocus.nodeId===item.node.id && bugFocus.bugId===item.bug.id;
    const sessions = bugSessionsOf(item.bug);
    const mine = sessions.indexOf(sid)>=0;
    const sending = bugDispatching.has(item.bug.id);
    const state = bugProgress(item.bug);
    const dot = `<i class="bug-dot ${state.kind}" title="${escAttr(state.label)}"></i>`;
    const claim = on && !item.unassigned
      ? `<button type="button" class="claim" data-claim ${sending?"disabled":""}>${sending?t("bugSending"):sid?(mine?t("leave"):t("claim")):t("assignSession")}</button>`
      : (mine ? `<span class="claim">${esc(t("claim"))}</span>` : "");
    return `<li class="${on?"on":""}" data-node="${escAttr(item.node.id)}" data-bug="${escAttr(item.bug.id)}">
      <span class="bug-copy"><span class="bug-title">${esc(title)}${item.unassigned?" · 未挂节点":""}</span>${bugProgressHtml(item.bug)}</span>
      <span class="bug-row">${dot}${claim}</span>
    </li>`;
  }).join("");
  ul.querySelectorAll("li[data-node]").forEach((li,index)=>{
    const item = list[index];
    li.onclick = e=>{
      if(e.target.closest("[data-claim]")) return;
      enterBugPath(item.node.id, item.bug.id);
    };
    const claim = li.querySelector("[data-claim]");
    if(claim) claim.onclick = async e=>{
      e.preventDefault(); e.stopPropagation();
      await toggleBugSession(item.node, item.bug);
    };
  });
}

function enterView(id, opts){
  closeAddPick();
  deleteAskId = null;
  if(bugPathMode){
    bugPathMode = false;
    bugFocus = null;
    bugPathReturn = null;
    document.body.classList.remove("bug-path-mode");
  }
  viewRootId = id; selectedId = id;
  const n = getNode(id);
  if((!opts || opts.unpack!==false) && n && id!==data.id) unpackInbox(n);
  renderAll();
  fitView();
}

/* ================= 顶部导航 / 提示条 ================= */
function canSwitchRepo(){
  return !window.__CG_SERVER && Object.keys(catalog).length>1;
}
function crumbLabel(n){
  return `${n.kind==="module"?"▣ ":""}${esc(n.title)}`;
}
function bindContextSwitch(el){
  const open = ()=>{
    closeSettings();
    closeSessionMenu();
    document.getElementById("repo-menu").classList.toggle("open");
    el.setAttribute("aria-expanded", document.getElementById("repo-menu").classList.contains("open") ? "true" : "false");
  };
  el.onclick = e=>{ e.stopPropagation(); open(); };
  el.onkeydown = e=>{
    if(e.key!=="Enter" && e.key!==" ") return;
    e.preventDefault();
    open();
  };
}
function renderNav(){
  const el = document.getElementById("nav-crumbs");
  if(bugPathMode && bugFocus){
    const hit = focusedBug();
    const tag = hit && hit.bug ? `<span class="here">${esc(hit.bug.title || "Bug")}</span>` : "";
    el.innerHTML = `<button type="button" class="bug-exit" id="btn-bug-exit">${t("exitChain")}</button>` + tag;
    const ex = document.getElementById("btn-bug-exit");
    if(ex) ex.onclick = ()=>exitBugPath(true);
    document.getElementById("tray-count").textContent = cancelledList().length;
    syncChrome();
    const here0 = el.querySelector(".here");
    if(here0) el.scrollLeft = Math.max(0, here0.offsetLeft + here0.offsetWidth - el.clientWidth);
    return;
  }
  const path = findPath(viewRootId);
  const cloudProject = window.__CG_SERVER?.root?.startsWith("cloud:") && window.__CG_SERVER.root!=="cloud:overview";
  const cloudHome = cloudProject ? `<a class="cloud-overview-link" href="/">${esc(t("projectOverview"))}</a><span class="sep">›</span>` : "";
  const switchable = canSwitchRepo();
  el.innerHTML = cloudHome + path.map((n,i)=>{
    const last = i===path.length-1;
    if(last){
      const atRoot = i===0;
      const caret = atRoot && switchable ? ` <span class="caret">▾</span>` : "";
      const cls = atRoot && switchable ? "here switch" : "here";
      const extra = atRoot && switchable
        ? ` role="button" tabindex="0" aria-haspopup="true" aria-expanded="false" title="${esc(t("switchRepo"))}"`
        : "";
      return `<span class="${cls}" id="context-card"${extra}>${atRoot ? esc(n.title) : crumbLabel(n)}${caret}</span>`;
    }
    return `<a data-id="${n.id}">${crumbLabel(n)}</a><span class="sep">›</span>`;
  }).join("");
  el.querySelectorAll("a[data-id]").forEach(a=>a.onclick=()=>enterView(a.dataset.id));
  const card = document.getElementById("context-card");
  if(card && path.length===1 && switchable) bindContextSwitch(card);
  document.getElementById("tray-count").textContent = cancelledList().length;
  syncChrome();
  const here = el.querySelector(".here");
  if(here) el.scrollLeft = Math.max(0, here.offsetLeft + here.offsetWidth - el.clientWidth);
}

/* ================= 授权模式开关 ================= */
document.getElementById("btn-auth").onclick = ()=>{
  authMode = !authMode;
  document.body.classList.toggle("auth-mode", authMode);
  document.getElementById("btn-auth").classList.toggle("on", authMode);
  renderAll();
};

/* ================= 已取消托盘 ================= */
document.getElementById("btn-tray").onclick = ()=>{
  const tray = document.getElementById("tray");
  const open = !tray.classList.contains("open");
  tray.classList.toggle("open", open);
  document.getElementById("btn-tray").classList.toggle("on", open);
  if(open) closeSettings();
};
document.getElementById("btn-link-repo").onclick = async ()=>{
  await linkRepo();
  closeSettings();
};
document.getElementById("first-use-go").onclick = ()=>enterLensMode();
document.getElementById("first-use-empty").onclick = startEmptyRoot;
document.getElementById("first-use-cut-back").onclick = ()=>{
  currentRepo().firstUseOpen = true;
  setOverlay(true, false);
};
document.addEventListener("click", ()=>{ closeRepoMenu(); closeSettings(); closeSessionMenu(); });
document.getElementById("repo-menu").onclick = e=>e.stopPropagation();
document.getElementById("settings-wrap").onclick = e=>e.stopPropagation();
document.getElementById("session-switch").onclick = e=>e.stopPropagation();
document.getElementById("session-chip").onclick = e=>{
  e.stopPropagation();
  closeRepoMenu(); closeSettings();
  const menu = document.getElementById("session-menu");
  const open = menu.hidden;
  if(!open){ closeSessionMenu(); return; }
  renderSessionMenu();
  menu.hidden = false;
  e.currentTarget.setAttribute("aria-expanded","true");
  positionSessionMenu();
};
window.addEventListener("resize",positionSessionMenu);
document.getElementById("btn-settings").onclick = e=>{
  e.stopPropagation();
  closeRepoMenu();
  closeSessionMenu();
  const menu = document.getElementById("settings-menu");
  const open = !menu.classList.contains("open");
  menu.classList.toggle("open", open);
  e.currentTarget.classList.toggle("on", open);
  e.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
};
document.getElementById("theme-picks").onclick = e=>{
  const b = e.target.closest("[data-theme]");
  if(!b) return;
  applyNodeTheme(b.dataset.theme, true);
};
function setLayoutDir(dir){
  layoutDir = dir==="tb" ? "tb" : "lr";
  document.body.classList.toggle("layout-tb", layoutDir==="tb");
  const el = document.getElementById("dir-toggle");
  if(el){
    el.dataset.dir = layoutDir;
    el.classList.toggle("is-tb", layoutDir==="tb");
    el.setAttribute("aria-pressed", layoutDir==="tb" ? "true" : "false");
    el.querySelectorAll(".dir-opt").forEach(opt=>{
      opt.classList.toggle("on", opt.dataset.dir===layoutDir);
    });
  }
  renderAll();
  fitView();
}
document.getElementById("dir-toggle").onclick = ()=>{
  setLayoutDir(layoutDir==="tb" ? "lr" : "tb");
};
document.getElementById("lang-toggle").onclick = e=>{
  e.stopPropagation();
  const b = e.target.closest("[data-lang]");
  if(b) setUiLang(b.dataset.lang);
};
document.getElementById("btn-rel").onclick = ()=>{
  if(bugPathMode) exitBugPath(true);
  if(relationMode){
    clearRelationMode({clearDeepLink:true});
    renderAll();
    fitView();
    return;
  }
  relationMode = true;
  const btn = document.getElementById("btn-rel");
  btn.classList.add("on");
  btn.setAttribute("aria-pressed", "true");
  document.body.classList.add("rel-mode");
  renderAll();
  fitView();
};
document.getElementById("btn-bugs").onclick = ()=>{
  const open = !document.body.classList.contains("bugs-open");
  if(!open && bugPathMode){ exitBugPath(true); openBugPanel(false); return; }
  openBugPanel(open);
  renderBugPanel();
  fitView();
};
function renderTray(){
  const list = cancelledList();
  const ul = document.getElementById("tray-list");
  ul.innerHTML = list.length? list.map(({node,parent})=>`
    <li>
      <div class="t-title">${esc(node.title)}<span style="font-size:11px"> · ${t("wasUnder")}${parent?parent.title:t("root")}</span></div>
      <div class="t-actions">
        <button data-restore="${node.id}">${t("restoreMap")}</button>
        ${pendingDeleteId===node.id?"":`<button data-delete="${node.id}" class="danger">${t("forever")}</button>`}
      </div>
      ${pendingDeleteId===node.id? `<div class="confirm-row">${t("deleteAsk")}
        <button data-delete-yes="${node.id}" class="danger">${t("delete")}</button>
        <button data-delete-no>${t("cancel")}</button>
      </div>`:""}
    </li>`).join("") : `<li class="empty">${t("trayEmpty")}</li>`;
  ul.querySelectorAll("[data-restore]").forEach(b=>b.onclick=()=>{
    const n = getNode(b.dataset.restore);
    n.proposal="accepted"; n.isNew=false;
    unpackInbox(n);
    sessionAuth.add(n.id);
    /* Scope is explicit; granting a child does not grant its ancestors. */
    renderAll();
  });
  ul.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>{
    pendingDeleteId = b.dataset.delete; renderTray();
  });
  ul.querySelectorAll("[data-delete-no]").forEach(b=>b.onclick=()=>{
    pendingDeleteId = null; renderTray();
  });
  ul.querySelectorAll("[data-delete-yes]").forEach(b=>b.onclick=()=>{
    const path = findPath(b.dataset.deleteYes);
    const n = path[path.length-1], parent = path[path.length-2];
    if(!parent) return;
    parent.children = parent.children.filter(c=>c.id!==n.id);
    if(selectedId===n.id) selectedId = parent.id;
    pendingDeleteId = null;
    renderAll();
  });
}

/* ================= 导图渲染 ================= */
const GAP_X = 70, GAP_Y = 14, MOD_GAP_Y = 30;
const GAP_TB = 56, GAP_TB_X = 22, MOD_GAP_X = 28;
const worldEl = document.getElementById("world");
const nodesEl = document.getElementById("nodes");
const linksEl = document.getElementById("links");
const currentsEl = document.getElementById("currents");
const flowLabsEl = document.getElementById("flow-labs");
let extents = {w:800, h:500};
let layoutDir = "lr";
let relationMode = false;
let relAnchorId = null;

function nodeHtml(n, isViewRoot, ghost){
  const openBugs = bugsFor(n).length;
  const authMark = authMode && !isProposed(n)
    ? `<span class="auth-mark ${isAuth(n)?"on":""}">${isAuth(n)?"✓":""}</span>` : "";
  const pending = isProposed(n)
    ? (n.id===selectedId && !authMode
        ? `<span class="join-spin" aria-hidden="true"></span>`
        : `<span class="new-dot"></span>`)
    : "";
  const add = ghost || isProposed(n) ? "" : `<span class="add-child" role="button" title="${escAttr(t("addChildTitle"))}" aria-haspopup="menu" aria-expanded="${addPickId===n.id?"true":"false"}">＋</span>
      <div class="add-pick" role="menu">
        <button type="button" data-add="module">${t("addKindModule")}</button>
        <button type="button" data-add="work">${t("addKindNode")}</button>
      </div>`;
  if(n.kind==="module"){
    const st = moduleAuthState(n);
    const lock = isProposed(n) || st!=="none" ? "" : `<span class="lock">🔒</span>`;
    return pending+`<div class="m-head">${authMark}${nodeDotHtml(n, "module")}<span>${esc(n.title)}</span>
        ${lock}
        ${focusId===n.id?`<span class="focus-mark">◎</span>`:""}
      </div>`+
      (n.purpose? `<div class="m-blurb">${esc(n.purpose)}</div>`:"")+
      add;
  }
  if(isProposed(n)){
    return pending+`<i class="dot proposed"></i><span>${esc(n.title)}</span>`;
  }
  return authMark+nodeDotHtml(n)+`<span>${esc(n.title)}</span>`+
    (!isAuth(n)?`<span class="lock">🔒</span>`:"")+
    (openBugs?`<span class="bug-badge">${openBugs}</span>`:"")+
    (focusId===n.id?`<span class="focus-mark">◎</span>`:"")+
    add;
}

function renderMap(){
  hideDotHint();
  if(!(data.flows && data.flows.length) && currentRepo().blueprint && currentRepo().blueprint.flows){
    data.flows = clone(currentRepo().blueprint.flows);
  }
  const root = liveViewRoot();
  const relFocus = relationMode ? relAnchorId : null;
  const relSet = relFocus ? flowPartners(relFocus) : null;

  nodesEl.innerHTML = "";
  if(currentsEl) currentsEl.innerHTML = "";
  if(flowLabsEl) flowLabsEl.innerHTML = "";
  const els = new Map();
  function mountEl(n, ghost){
    const isViewRoot = !ghost && n.id===viewRootId;
    const noauth = !isProposed(n) && !isAuth(n) &&
      !(n.kind==="module" && moduleAuthState(n)!=="none");
    const relDim = !!(relationMode && relSet && !relSet.has(n.id));
    const div = document.createElement("div");
    div.dataset.id = n.id;
    div.className = "node" + (isViewRoot?" root":"") +
      (n.kind==="module"?" module":"") +
      (n.kind==="work" && n.kind!=="module"?" work":"") +
      (isProposed(n)?" proposed":"") +
      (noauth?" noauth":"") +
      (ghost?" ghost":"") +
      (n.id===selectedId && !isCancelled(n)?" selected":"") +
      (addPickId===n.id?" picking":"") +
      (bugPathMode && bugFocus && n.id===bugFocus.nodeId?" bug-target":"") +
      (relationMode ? (relDim?" rel-dim":" rel-hot") : (bugPathMode || onFocusPath(n.id)?"":" dimmed"));
    div.innerHTML = nodeHtml(n, isViewRoot, ghost);
    bindNodeDotHint(div);
    div.style.visibility = "hidden";
    nodesEl.appendChild(div);
    els.set(n.id, div);
    div.addEventListener("click", e=>onNodeClick(e, n));
    return div;
  }
  vwalk(root,(n)=>{ mountEl(n, false); });
  const size = new Map();
  els.forEach((el,id)=>size.set(id,{w:el.offsetWidth,h:el.offsetHeight}));

  const pos = new Map();
  const tb = layoutDir==="tb";
  const hopX = bugPathMode ? 128 : (relationMode ? 148 : GAP_X);
  const hopTB = bugPathMode ? 90 : (relationMode ? 92 : GAP_TB);
  function gapY(c){
    if(relationMode) return c.kind==="module" ? 84 : GAP_Y+10;
    return c.kind==="module" ? MOD_GAP_Y : GAP_Y;
  }
  function gapX(c){
    if(relationMode) return c.kind==="module" ? 120 : GAP_TB_X+18;
    return c.kind==="module" ? MOD_GAP_X : GAP_TB_X;
  }
  function shiftSubtree(n, dx, dy){
    const p = pos.get(n.id); if(p){ p.x += dx; p.y += dy; }
    visibleChildren(n).forEach(c=>shiftSubtree(c, dx, dy));
  }
  function subtreeLR(n, x, top){
    const s = size.get(n.id);
    const kids = visibleChildren(n);
    const childX = x + s.w + hopX;
    if(!kids.length){ pos.set(n.id,{x, y:top}); return s.h; }
    let y = top;
    kids.forEach(c=>{ y += subtreeLR(c, childX, y) + gapY(c); });
    let total = y - gapY(kids[kids.length-1]) - top;
    const first = kids[0], last = kids[kids.length-1];
    const fc = pos.get(first.id), lc = pos.get(last.id);
    const cy = (fc.y + size.get(first.id).h/2 + lc.y + size.get(last.id).h/2)/2;
    let ny = cy - s.h/2;
    if(s.h > total){
      const shift = (s.h-total)/2;
      kids.forEach(c=>shiftSubtree(c, 0, shift));
      ny = top; total = s.h;
    }
    pos.set(n.id,{x, y:Math.max(ny, top)});
    return total;
  }
  function subtreeTB(n, left, y){
    const s = size.get(n.id);
    const kids = visibleChildren(n);
    const childY = y + s.h + hopTB;
    if(!kids.length){ pos.set(n.id,{x:left, y}); return s.w; }
    let x = left;
    kids.forEach(c=>{ x += subtreeTB(c, x, childY) + gapX(c); });
    let total = x - gapX(kids[kids.length-1]) - left;
    const first = kids[0], last = kids[kids.length-1];
    const fc = pos.get(first.id), lc = pos.get(last.id);
    const cx = (fc.x + size.get(first.id).w/2 + lc.x + size.get(last.id).w/2)/2;
    let nx = cx - s.w/2;
    if(s.w > total){
      const shift = (s.w-total)/2;
      kids.forEach(c=>shiftSubtree(c, shift, 0));
      nx = left; total = s.w;
    }
    pos.set(n.id,{x:Math.max(nx, left), y});
    return total;
  }
  function subtreeH(n){
    let max = pos.get(n.id).y + size.get(n.id).h;
    (function walk(x){
      visibleChildren(x).forEach(c=>{
        const p = pos.get(c.id); if(!p) return;
        max = Math.max(max, p.y + size.get(c.id).h);
        walk(c);
      });
    })(n);
    return max - pos.get(n.id).y;
  }
  const NEST_STEM = 30, NEST_GY = 16;
  function nestedMods(n){
    return visibleChildren(n).filter(c=>c.kind==="module");
  }
  function stackH(n){
    const s = size.get(n.id);
    const nested = nestedMods(n);
    if(!nested.length) return s.h;
    return s.h + NEST_STEM + nested.reduce((a,c,i)=>a+size.get(c.id).h+(i?NEST_GY:0),0);
  }
  function placeNested(n){
    const nested = nestedMods(n);
    if(!nested.length) return;
    const p = pos.get(n.id), s = size.get(n.id);
    let y = p.y + s.h + NEST_STEM;
    nested.forEach(c=>{
      const cs = size.get(c.id);
      pos.set(c.id, {x:p.x + (s.w-cs.w)/2, y});
      y += cs.h + NEST_GY;
    });
  }
  function nestBottom(n){
    const nested = nestedMods(n);
    if(!nested.length) return pos.get(n.id).y + size.get(n.id).h;
    const last = nested[nested.length-1];
    return pos.get(last.id).y + size.get(last.id).h;
  }
  function layoutCatalog(){
    const kids = visibleChildren(root);
    const rs = size.get(root.id);
    if(!kids.length){ pos.set(root.id,{x:0,y:0}); return; }
    const cellW = Math.max(...kids.map(c=>size.get(c.id).w));
    const n = kids.length;
    const cols = isPhoneLayout()
      ? Math.min(2, n)
      : relationMode
        ? (n<=2 ? n : 2)
        : (n<=2 ? n : n<=6 ? Math.min(3,n) : 4);
    const GX = relationMode ? 168 : 44;
    const GY = relationMode ? 110 : 36;
    const STEM = relationMode ? 96 : 56;
    const gridW = cols*cellW + (cols-1)*GX;
    pos.set(root.id, {x:Math.max(0,(gridW-rs.w)/2), y:0});
    const rows = Math.ceil(n/cols);
    let y = rs.h + STEM;
    for(let r=0;r<rows;r++){
      const start = r*cols;
      const inRow = Math.min(cols, n-start);
      const rowW = inRow*cellW + (inRow-1)*GX;
      const x0 = (gridW-rowW)/2;
      let rowCardH = 0;
      for(let c=0;c<inRow;c++) rowCardH = Math.max(rowCardH, size.get(kids[start+c].id).h);
      let rowTotal = 0;
      for(let c=0;c<inRow;c++){
        const kid = kids[start+c];
        const s = size.get(kid.id);
        pos.set(kid.id, {x:x0 + c*(cellW+GX) + (cellW-s.w)/2, y});
        size.set(kid.id, {w:s.w, h:rowCardH});
        placeNested(kid);
        rowTotal = Math.max(rowTotal, stackH(kid));
      }
      y += rowTotal + GY;
    }
  }
  function useSpreadGrid(){
    /* 地图根上：上下要折行，左右仍是树（孩子在右侧）。关系模式继续用散点网格。 */
    if(isCatalogView() && tb) return true;
    if(!relationMode) return false;
    const kids = visibleChildren(root);
    return kids.length>=2 && kids.every(c=>c.kind==="module");
  }
  const spreadGrid = useSpreadGrid();
  if(spreadGrid) layoutCatalog();
  else if(tb) subtreeTB(root, 0, 0);
  else subtreeLR(root, 0, 0);

  let maxX=0, maxY=0;
  pos.forEach((p,id)=>{
    const s = size.get(id); if(!p||!s) return;
    maxX = Math.max(maxX, p.x+s.w); maxY = Math.max(maxY, p.y+s.h);
  });
  const lensPad = lensMode ? lensTreePad(maxX, maxY) : {x:0,y:0};
  if(lensPad.x || lensPad.y){
    pos.forEach(p=>{ p.x += lensPad.x; p.y += lensPad.y; });
  }
  const catalogIds = spreadGrid ? new Set(visibleChildren(root).map(k=>k.id)) : null;
  els.forEach((el,id)=>{
    const p = pos.get(id), s = size.get(id);
    if(!p || !s) return;
    el.style.left = p.x+"px"; el.style.top = p.y+"px";
    el.style.height = (catalogIds && catalogIds.has(id)) ? s.h+"px" : "";
    el.style.visibility = "";
    maxX = Math.max(maxX, p.x+s.w); maxY = Math.max(maxY, p.y+s.h);
  });
  extents = {w:maxX, h:maxY};
  if(lensMode){
    renderLensShelf();
    const boxed = layoutLensShelf(maxX - (lensPad.x||0), maxY - (lensPad.y||0), lensPad);
    extents = {w:Math.max(extents.w, boxed.w), h:Math.max(extents.h, boxed.h)};
    maxX = extents.w; maxY = extents.h;
  }
  linksEl.setAttribute("width", maxX+140);
  linksEl.setAttribute("height", maxY+140);

  let paths="";
  const pathSegs=[];
  function linkClass(n,c){
    const onF = focusId && onFocusPath(n.id) && onFocusPath(c.id);
    const dim = focusId && !(onFocusPath(n.id)&&onFocusPath(c.id));
    const na = !isProposed(c) && !isAuth(c) &&
      !(c.kind==="module" && moduleAuthState(c)!=="none");
    const relOff = relationMode && relSet && (!relSet.has(n.id) || !relSet.has(c.id));
    return `link ${bugPathMode?'bug-path':''} ${dim?'dimmed':''} ${relOff?'rel-dim':''} ${onF?'focus-link':''} ${isProposed(c)?'proposed-link':''} ${na?'noauth-link':''}`;
  }
  function curveTB(n,c){
    const p = pos.get(n.id), ps = size.get(n.id);
    const q = pos.get(c.id), qs = size.get(c.id);
    if(!p || !q) return "";
    const x1 = p.x+ps.w/2, y1 = p.y+ps.h;
    const x2 = q.x+qs.w/2, y2 = q.y;
    const mid = (y1+y2)/2;
    return `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`;
  }
  function curveLR(n,c){
    const p = pos.get(n.id), ps = size.get(n.id);
    const q = pos.get(c.id), qs = size.get(c.id);
    if(!p || !q) return "";
    const x1 = p.x+ps.w, y1 = p.y+ps.h/2;
    const x2 = q.x, y2 = q.y+qs.h/2;
    const mid = (x1+x2)/2;
    return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
  }
  vwalk(root,(n)=>{
    visibleChildren(n).forEach(c=>{
      const d = (spreadGrid || tb) ? curveTB(n,c) : curveLR(n,c);
      if(d){
        pathSegs.push(d);
        paths += `<path class="${linkClass(n,c)}" d="${d}"/>`;
      }
    });
  });
  if(bugPathMode){
    const hit = focusedBug();
    const sessions = hit ? bugSessionsOf(hit.bug) : [];
    if(sessions.length && pathSegs.length){
      if(currentsEl){
        currentsEl.style.width = (maxX+140)+"px";
        currentsEl.style.height = (maxY+140)+"px";
      }
      sessions.forEach((sid, si)=>{
        const color = sessionColor(sid);
        pathSegs.forEach((d, di)=>{
          const delay = (di*0.18 + si*0.32).toFixed(2);
          paths += `<path class="current-flow" stroke="${color}" style="animation-delay:${delay}s" d="${d}"/>`;
        });
      });
    }
  }
  if(relationMode){
    const related = relSet || new Set();
    let gx = maxX + 96, gy = 8;
    related.forEach(id=>{
      if(id===relFocus) return;
      if(els.has(id) || pos.has(id)) return;
      const n = getNode(id);
      if(!n || isCancelled(n)) return;
      const div = mountEl(n, true);
      const s = {w:div.offsetWidth, h:div.offsetHeight};
      size.set(n.id, s);
      pos.set(n.id, {x:gx, y:gy});
      div.style.left = gx+"px";
      div.style.top = gy+"px";
      div.style.visibility = "";
      gy += s.h + 40;
      maxX = Math.max(maxX, gx+s.w);
      maxY = Math.max(maxY, gy);
    });
    extents = {w:maxX, h:maxY};
    linksEl.setAttribute("width", maxX+140);
    linksEl.setAttribute("height", maxY+140);
    function port(p,s,qx,qy){
      const cx=p.x+s.w/2, cy=p.y+s.h/2;
      const dx=qx-cx, dy=qy-cy;
      if(Math.abs(dx)>Math.abs(dy)) return dx>0 ? {x:p.x+s.w, y:cy} : {x:p.x, y:cy};
      return dy>0 ? {x:cx, y:p.y+s.h} : {x:cx, y:p.y};
    }
    function flowCurve(id1, id2){
      const p1 = pos.get(id1), s1 = size.get(id1);
      const p2 = pos.get(id2), s2 = size.get(id2);
      if(!p1||!p2||!s1||!s2) return null;
      const a = port(p1,s1,p2.x+s2.w/2,p2.y+s2.h/2);
      const b = port(p2,s2,p1.x+s1.w/2,p1.y+s1.h/2);
      const dx=b.x-a.x, dy=b.y-a.y;
      const dist = Math.hypot(dx,dy)||1;
      const bulge = Math.min(160, Math.max(64, dist*0.42));
      const c = {x:(a.x+b.x)/2 - (dy/dist)*bulge, y:(a.y+b.y)/2 + (dx/dist)*bulge};
      return {d:`M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`, a, b, c};
    }
    function quadAt(a,c,b,t){
      const u=1-t;
      return {x:u*u*a.x+2*u*t*c.x+t*t*b.x, y:u*u*a.y+2*u*t*c.y+t*t*b.y};
    }
    function labOverlapAmt(a,b,pad){
      const ox = (a.w+b.w)/2 + pad - Math.abs(a.x-b.x);
      const oy = (a.h+b.h)/2 + pad - Math.abs(a.y-b.y);
      if(ox<=0 || oy<=0) return null;
      return {ox, oy};
    }
    function unstackLabs(placed){
      for(let n=0; n<8; n++){
        let moved = false;
        for(let i=0; i<placed.length; i++){
          for(let j=i+1; j<placed.length; j++){
            const a = placed[i], b = placed[j];
            const hit = labOverlapAmt(a,b,6);
            if(!hit) continue;
            moved = true;
            if(hit.oy <= hit.ox){
              const s = a.y===b.y ? 1 : Math.sign(a.y-b.y);
              a.y += s * hit.oy/2;
              b.y -= s * hit.oy/2;
            }else{
              const s = a.x===b.x ? 1 : Math.sign(a.x-b.x);
              a.x += s * hit.ox/2;
              b.x -= s * hit.ox/2;
            }
          }
        }
        if(!moved) break;
      }
    }
    function measureLab(text){
      if(!flowLabsEl) return {w: Math.max(24, text.length*7), h:16};
      const probe = document.createElement("span");
      probe.className = "flow-lab";
      probe.textContent = text;
      probe.style.left = "-9999px";
      probe.style.top = "0";
      flowLabsEl.appendChild(probe);
      const w = Math.max(probe.offsetWidth, 12);
      const h = Math.max(probe.offsetHeight, 14);
      probe.remove();
      return {w, h};
    }
    paths = `<defs><marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="6.4" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6" fill="none" stroke="#5a7a62" stroke-width="1.2"/></marker></defs>` + paths;
    const pendingLabs = [];
    (data.flows||[]).forEach(f=>{
      if(f.from!==relFocus && f.to!==relFocus) return;
      if(!pos.has(f.from) || !pos.has(f.to)) return;
      const curve = flowCurve(f.from, f.to);
      if(!curve) return;
      paths += `<path class="flow hot" d="${curve.d}" marker-end="url(#flow-arrow)"/>`;
      if(f.label) pendingLabs.push({text:f.label, curve});
    });
    if(flowLabsEl){
      flowLabsEl.style.width = (maxX+140)+"px";
      flowLabsEl.style.height = (maxY+140)+"px";
      const placed = pendingLabs.map(item=>{
        const {w,h} = measureLab(item.text);
        const pt = quadAt(item.curve.a, item.curve.c, item.curve.b, 0.5);
        const mid = {x:(item.curve.a.x+item.curve.b.x)/2, y:(item.curve.a.y+item.curve.b.y)/2};
        const ox = item.curve.c.x-mid.x, oy = item.curve.c.y-mid.y;
        const olen = Math.hypot(ox,oy)||1;
        return {text:item.text, x:pt.x+(ox/olen)*10, y:pt.y+(oy/olen)*10, w, h};
      });
      unstackLabs(placed);
      placed.forEach(box=>{
        const el = document.createElement("span");
        el.className = "flow-lab";
        el.textContent = box.text;
        el.style.left = box.x+"px";
        el.style.top = box.y+"px";
        flowLabsEl.appendChild(el);
        maxX = Math.max(maxX, box.x+box.w/2);
        maxY = Math.max(maxY, box.y+box.h/2);
      });
      extents = {w:maxX, h:maxY};
      linksEl.setAttribute("width", maxX+140);
      linksEl.setAttribute("height", maxY+140);
      flowLabsEl.style.width = (maxX+140)+"px";
      flowLabsEl.style.height = (maxY+140)+"px";
    }
  }
  linksEl.innerHTML = paths;
}
function onNodeClick(e, n){
  if(!n) return;
  e.stopPropagation();
  if(window.__CG_SERVER?.root==="cloud:overview" && n.cloudProjectId){
    location.href="/projects/"+encodeURIComponent(n.cloudProjectId); return;
  }
  if(lensMode && n.id!==data.id){
    /* 搁板模式：点头上的候选挂卡 = 退回搁板；点主节点不动 */
    if(isProposed(n) && n.id!==viewRootId){ detachLensNode(n); return; }
    selectedId = n.id; renderAll(); return;
  }
  if(authMode){
    toggleAuth(n); return;
  }
  const pickBtn = e.target.closest && e.target.closest("[data-add]");
  if(pickBtn && e.target.closest(".add-pick")){
    const kind = pickBtn.dataset.add;
    addPickId = null;
    if(kind==="module") addModule(n);
    else addChild(n);
    return;
  }
  if(e.target.closest && e.target.closest(".add-child")){
    if(addPickId===n.id){ addPickId=null; renderAll(); return; }
    if(!canMutate()){ workbenchSync?.setStatus("readonly"); return; }
    addPickId = n.id;
    selectedId = n.id;
    renderAll();
    return;
  }
  if(e.target.closest && e.target.closest(".add-pick")) return;
  closeAddPick();
  if(bugPathMode){
    selectedId = n.id;
    renderAll();
    return;
  }
  if(relationMode){
    relAnchorId = n.id;
    selectedId = n.id;
    renderAll();
    fitView();
    return;
  }
  if(isProposed(n)){
    if(selectedId===n.id){ acceptProposal(n); return; }
    selectedId = n.id; renderAll(); return;
  }
  /* 模块仍是一点就进入。开工节点第一次只选中，避免为了点删除而 unpack 出隐藏子节点。 */
  if(n.kind==="module" && n.id!==viewRootId){
    enterView(n.id); return;
  }
  if(n.id!==selectedId){ selectedId = n.id; renderAll(); return; }
  if(canEnter(n) && n.id!==viewRootId) enterView(n.id);
}

function acceptProposal(n, silent){
  if(!workbenchSync?.ready){ workbenchSync?.setStatus("readonly"); return; }
  n.proposal = "accepted"; n.isNew = false;
  sessionAuth.add(n.id);
  const path = findPath(n.id);
  if(path) path.forEach(a=>sessionAuth.add(a.id));
  unpackInbox(n);
  if(silent) return;
  selectedId = n.id;
  if(!relationMode && n.kind==="module" && n.id!==viewRootId){ enterView(n.id); return; }
  renderAll();
}
function acceptLayer(node){
  if(!workbenchSync?.ready){ workbenchSync?.setStatus("readonly"); return; }
  node.children.filter(isProposed).forEach(c=>acceptProposal(c, true));
  renderAll();
}
function attachedChildren(n){
  const kids = (n.children||[]).filter(c=>c && !isCancelled(c));
  const inbox = (n._inbox||[]).filter(c=>c && !isCancelled(c));
  return kids.concat(inbox);
}
function requestDelete(node){
  if(!canMutate()){ workbenchSync?.setStatus("readonly"); return; }
  if(!node || node.id===data.id) return;
  clearCompose();
  const kids = attachedChildren(node);
  if(!kids.length){ applyDelete(node, true); return; }
  deleteAskId = node.id;
  selectedId = node.id;
  renderAll();
}
function applyDelete(node, withChildren){
  if(!canMutate()){ workbenchSync?.setStatus("readonly"); return; }
  if(!node || node.id===data.id) return;
  deleteAskId = null;
  const path = pathOf(node) || [];
  const parent = path.length>1 ? path[path.length-2] : null;
  if(!parent) return;
  if(!withChildren){
    const keep = attachedChildren(node);
    node.children = (node.children||[]).filter(c=>isCancelled(c));
    node._inbox = (node._inbox||[]).filter(c=>isCancelled(c));
    const idx = parent.children.indexOf(node);
    if(idx>=0) parent.children.splice(idx, 0, ...keep);
    else parent.children.push(...keep);
    promoteFatWork(parent);
  }
  cancelProposal(node);
}
function cancelProposal(n){
  if(!workbenchSync?.ready){ workbenchSync?.setStatus("readonly"); return; }
  if(!n || n.id===data.id) return;
  clearCompose();
  const p = pathOf(n) || [];
  n.proposal = "cancelled"; n.isNew = false;
  let parent = p.length>1? p[p.length-2] : data;
  while(parent && isCancelled(parent) && parent.id!==data.id){
    const pp = pathOf(parent) || [];
    parent = pp.length>1? pp[pp.length-2] : data;
  }
  if(!parent || isCancelled(parent)) parent = data;
  if(n.id===viewRootId || (pathOf(getNode(viewRootId))||[]).some(x=>x===n)) viewRootId = parent.id;
  liveViewRoot();
  selectedId = parent.id;
  renderAll();
}

function startCompose(node, kind){
  if(!canMutate()){ workbenchSync?.setStatus("readonly"); return; }
  if(!node) return;
  addPickId = null;
  composeParent = node;
  selectedId = node.id;
  composingId = node.id;
  composingKind = kind==="module" ? "module" : "work";
  renderAll();
  const input = document.querySelector("[data-compose]");
  if(input) input.focus();
}
function addChild(node){ startCompose(node, "work"); }
function addModule(from){
  if(!canMutate()){ workbenchSync?.setStatus("readonly"); return; }
  const target = from || getNode(selectedId);
  /* 挂在点中的节点后。不要因为提议/找不到就改挂到当前页根（看起来像最开始那个模块）。 */
  if(!target || isCancelled(target)) return;
  startCompose(target, "module");
}
function inTree(n){ return !!(n && pathOf(n)); }
function commitChild(node, title){
  if(!workbenchSync?.ready){ workbenchSync?.setStatus("readonly"); return; }
  const t = (title||"").trim();
  if(!t) return;
  let parent = composeParent;
  if(!inTree(parent) || isCancelled(parent)) parent = node;
  if(!inTree(parent) || isCancelled(parent)) return;
  const kind = composingKind==="module" ? "module" : "work";
  clearCompose();
  const child = {id:nextNodeId(), title:t, kind, origin:"human", proposal:"accepted", isNew:false, state:"dirty",
    purpose:"", memories:[], ideas:[], todos:[], bugs:[], dormant:[], files:[], owns:[], children:[]};
  if(!Array.isArray(parent.children)) parent.children = [];
  parent.children.push(child);
  sessionAuth.add(child.id);
  const createdPath = findPath(child.id);
  if(createdPath) createdPath.forEach(a=>sessionAuth.add(a.id));
  promoteFatWork(parent);
  if(kind==="module"){
    const shown = parent.id===viewRootId || visibleChildren(parent).some(c=>c.id===child.id);
    if(!shown) viewRootId = parent.id;
    selectedId = child.id;
    renderAll();
    fitView();
    return;
  }
  if(parent.kind==="module" && parent.id!==viewRootId){
    viewRootId = parent.id;
    selectedId = child.id;
    renderAll();
    fitView();
    return;
  }
  selectedId = child.id;
  renderAll();
}

/* ================= 抽屉 ================= */
const STATE_LABEL = ()=>({
  dirty:t("state_dirty"),
  untested:t("state_untested"),
  success:t("state_success"),
  failed:t("state_failed")
});
function textOf(el){ return (el.innerText||"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function bindEdit(el, commit, multiline){
  if(!el) return;
  if(window.__CG_SERVER && !workbenchSync?.ready){ el.contentEditable="false"; return; }
  el.contentEditable="true"; el.spellcheck=false;
  let composing=false;
  function draft(){ return {nodeId:selectedId, field:el.dataset.ed, index:el.dataset.i, bug:el.dataset.bug, text:el.innerText||""}; }
  function save(blur=false){
    if(composing) return;
    const v=multiline?(el.innerText||"").replace(/\u00a0/g," ").trim():textOf(el);
    if(!blur && !v){ workbenchSync?.setInputDraft(draft()); return; }
    window.__CG_INPUT_COMMIT=!blur;
    try { commit(v, blur); } finally { window.__CG_INPUT_COMMIT=false; }
    workbenchSync?.setInputDraft(el.dataset.ed==="compose-title" && composingId ? draft() : null); persist();
    if(blur) workbenchSync?.flush();
  }
  el.addEventListener("compositionstart",()=>{ composing=true; if(workbenchSync) workbenchSync.composing=true; workbenchSync?.setInputDraft(draft()); });
  el.addEventListener("compositionend",()=>{ composing=false; if(workbenchSync) workbenchSync.composing=false; save(); });
  el.addEventListener("input",()=>{ workbenchSync?.setInputDraft(draft()); save(); });
  el.addEventListener("keydown",e=>{ if(!composing && !e.isComposing && ((e.key==="Enter"&&!multiline)||e.key==="Escape")){ e.preventDefault();el.blur(); } });
  el.addEventListener("blur",()=>save(true));
}
function bindSilent(el, fn){
  if(!el) return;
  el.onmousedown = e=>e.preventDefault();
  el.onclick = fn;
}
function renderDetail(){
  liveSelected();
  let path = pathOf(getNode(selectedId)) || findPath(selectedId);
  const el = document.getElementById("detail");
  if(!path || !path.length){
    selectedId = liveViewRoot().id;
    path = findPath(selectedId) || [data];
  }
  const node = path[path.length-1];
  const isModule = node.kind==="module";
  const proposed = isProposed(node), cancelled = isCancelled(node);
  const noauth = !proposed && !cancelled && !isAuth(node) &&
    !(isModule && moduleAuthState(node)!=="none");
  const composing = composingId===node.id;

  if(bugPathMode && bugFocus){
    const hit = focusedBug();
    const bug = hit && hit.bug;
    const sid = currentSessionId();
    const sessions = bugSessionsOf(bug);
    const mine = bug && sessions.indexOf(sid)>=0;
    const sending = bug && bugDispatching.has(bug.id);
    const dots = sessions.map(s=>`<i class="sess-dot" style="background:${sessionColor(s)}"></i>`).join("");
    el.innerHTML = `
      <h2>${esc(bug && bug.title ? bug.title : "Bug")}${bugProgressHtml(bug)}</h2>
      <p class="lead">${esc(node.title)}</p>
      <div class="actions">
        ${dots}
        ${hit && hit.unassigned ? `<span class="muted">未挂节点</span>` : `<button type="button" class="quiet" data-act="claim" ${sending?"disabled":""}>${sending?t("bugSending"):sid?(mine?t("leave"):t("claim")):t("assignSession")}</button>`}
      </div>`;
    const claim = el.querySelector('[data-act="claim"]');
    if(claim) claim.onclick = async ()=>{ if(!hit?.unassigned) await toggleBugSession(hit && hit.node, bug); };
    return;
  }

  /* 提议节点：只决定加不加入。面包屑、开工标记、附件/记忆/Idea/Bug/继承都先不出现。 */
  if(proposed){
    const evidence = (node.memories||[]).map(memory=>memory&&memory.proposalEvidence).find(value=>value&&typeof value==="object");
    const evidenceFiles = evidence&&Array.isArray(evidence.files) ? evidence.files : [];
    el.innerHTML = `
      <h2>${esc(node.title)}
        <span class="state-chip proposed-chip">${t("pendingChip")}</span>
      </h2>
      ${node.purpose? `<p class="lead">${esc(node.purpose)}</p>`:""}
      ${evidence? `<div class="proposal-evidence">
        <p><b>${t("proposalReason")}：</b>${esc(evidence.reason||"")}</p>
        <p><b>${t("proposalBasis")}：</b>${esc(evidence.basis||"")}</p>
        ${evidenceFiles.length? `<p><b>${t("proposalFiles")}：</b>${evidenceFiles.map(file=>`<code>${esc(file)}</code>`).join("、")}</p>`:""}
      </div>`:""}
      <div class="actions">
        <button data-act="accept" class="primary">${t("join")}</button>
        <button data-act="cancel">${t("hide")}</button>
      </div>`;
    el.querySelector('[data-act="accept"]').onclick = ()=>acceptProposal(node);
    bindSilent(el.querySelector('[data-act="cancel"]'), ()=>{ clearCompose(); cancelProposal(node); });
    return;
  }
  if(cancelled){
    el.innerHTML = `
      <h2>${esc(node.title)}</h2>
      <div class="actions">
        <button data-act="restore" class="primary">${t("restore")}</button>
      </div>`;
    el.querySelector('[data-act="restore"]').onclick = ()=>acceptProposal(node);
    return;
  }

  const inherited = [];
  path.slice(0,-1).filter(a=>!isProposed(a)&&!isCancelled(a)).forEach(anc=>{
    anc.memories.filter(m=>m.state!=="dirty").forEach(m=>inherited.push({mem:m, from:anc.title}));
  });
  const alsoMems = memsAlsoFor(node);
  const inhCount = PINNED.length + inherited.length + alsoMems.length;
  const bugRows = bugsFor(node);
  const openBugs = bugRows.map(r=>r.bug);
  const nodeTodos = node.todos || (node.todos = []);

  const memHtml = node.memories.length
    ? `<ul class="mem-list">`+node.memories.map((m,i)=>
        `<li class="${m.state==='dirty'?'dirty-item':''}"><i class="dot ${escAttr(m.state)}"></i><div class="mem-body" data-drop-files data-fk="mem" data-fi="${i}"><span class="txt ed" data-ed="mem" data-i="${i}">${esc(m.text)}</span>${attachHtml("mem", i, m)}</div></li>`
      ).join("")+`</ul>`
    : "";
  const ideaHtml = node.ideas.length
    ? `<ul class="mem-list">`+node.ideas.map((m,i)=>
        `<li class="${m.state==='dirty'?'dirty-item':''}"><i class="dot ${escAttr(m.state)}"></i><div class="mem-body" data-drop-files data-fk="idea" data-fi="${i}"><span class="txt ed" data-ed="idea" data-i="${i}">${esc(m.text||"")}</span>${attachHtml("idea", i, m)}</div></li>`
      ).join("")+`</ul>`
    : "";
  const todoHtml = nodeTodos.length
    ? `<ul class="todo-list">`+nodeTodos.map(todo=>{
        const done = todo.status==="done";
        const needsAction = todo.dispatch?.status==="scope-required" || todo.dispatch?.status==="failed";
        return `<li class="${done?"todo-done":""}">
          <button type="button" class="todo-check ${done?"done":""}" data-todo="${escAttr(todo.id)}" title="${escAttr(todoProgress(todo).label)}">${done?"✓":""}</button>
          <div class="todo-main">
            <div class="todo-text ed" data-ed="todo-text" data-todo="${escAttr(todo.id)}">${esc(todo.desc||todo.title||"")}</div>
            ${todo.draft?"":todoProgressHtml(todo)}
            ${needsAction?`<button type="button" class="todo-inline-action" data-todo-send="${escAttr(todo.id)}">${esc(t(todo.dispatch.status==="scope-required"?"todoAuthorizeAndSend":"todoRetry"))}</button>`:""}
          </div>
        </li>`;
      }).join("")+`</ul>`
    : "";

  const bugHtml = bugRows.length
    ? `<ul class="bug-list">`+bugRows.map(row=>{
        const b = row.bug;
        const settled = ["pending","fixed","resolved","dormant"].includes(b.status);
        const title = row.home
          ? `<div class="bug-title ed" data-ed="bug-title" data-bug="${b.id}">${esc(b.title)}</div>`
          : `<div class="bug-title">${esc(b.title)}</div>`;
        const attach = row.home ? attachHtml("bug", b.id, b) : "";
        return `
        <li class="${settled?'bug-pending':''}">
          <div class="bug-check ${settled?'done':''}" data-bug="${b.id}">${settled?"✓":""}</div>
          <div class="bug-main" ${row.home ? `data-drop-files data-fk="bug" data-fi="${escAttr(b.id)}"` : ""}>
            ${title}
            ${b.status==='pending'? `<div class="summarizing">${t("summarizing")}</div>`:""}
            ${bugProgressHtml(b)}
            ${attach}
          </div>
        </li>`;
      }).join("")+`</ul>`
    : "";

  const pendingKids = node.children.filter(isProposed).length;
  const canDelete = node.id!==data.id;
  /* 蓝点是还没开工；有进度才在标题旁露芯片。 */
  const labels = uiLabels();
  const states = STATE_LABEL();
  const workSt = workDotState(node);
  const chip = cancelled? `<span class="state-chip failed">${esc(t("cancelledChip"))}</span>`
    : node.badge? `<span class="state-chip ${escAttr(node.state)}">${esc(node.badge)}</span>`
    : (workSt==="success"||workSt==="failed"||workSt==="untested")
      ? `<span class="state-chip ${workSt}">${states[workSt]}</span>`
      : "";
  const filesHtml = fileList(node).length
    ? `<div class="files-row">${attachHtml("node", node.id, node)}</div>` : "";
  const trashBtn = canDelete && !composing && deleteAskId!==node.id
    ? `<button type="button" class="trash" data-act="delete" title="${t("delete")}" aria-label="${t("delete")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g class="lid"><rect x="9" y="3.2" width="6" height="1.7" rx=".7" fill="currentColor" stroke="none"/><path d="M4.5 7.1h15"/></g><g class="can"><path d="M7 7.1v12.3a1.7 1.7 0 0 0 1.7 1.7h6.6a1.7 1.7 0 0 0 1.7-1.7V7.1"/></g><g class="rib"><path d="M10 11.2v6"/><path d="M14 11.2v6"/></g></svg></button>`
    : "";
  const actionBtns = [
    cancelled? `<button data-act="restore" class="primary">${t("restore")}</button>`:"",
    !cancelled && pendingKids? `<button data-act="accept-layer" class="primary">${t("acceptLayer")}</button>`:"",
    !cancelled && noauth? `<button data-act="grant" class="auth-primary">${t("grant")}</button>`:"",
    !cancelled && relationMode && canEnter(node)? `<button type="button" data-act="enter" class="primary">${t("enter")}</button>`:""
  ].filter(Boolean).join("");
  el.innerHTML = `
    <h2 class="detail-head"><span class="head-main"><span class="ed" data-ed="title">${esc(node.title)}</span>${chip}</span>${trashBtn}</h2>
    ${(isModule||node.kind==="work")? `<p class="lead ed" data-ed="purpose">${esc(node.purpose||"")}</p>`:""}
    ${actionBtns? `<div class="actions">${actionBtns}</div>`:""}
    ${deleteAskId===node.id? `<div class="delete-ask">
        <p>${t("deleteAskKids").replace("{n}", String(attachedChildren(node).length))}</p>
        <div class="row">
          <button type="button" data-act="delete-keep">${t("deleteKeepKids")}</button>
          <button type="button" data-act="delete-all">${t("deleteWithKids")}</button>
          <button type="button" class="quiet" data-act="delete-abort">${t("cancel")}</button>
        </div>
      </div>`:""}
    ${composing? `<div class="compose">
        <span class="ed ghost" data-ed="compose-title" data-compose>${composingKind==="module"?t("moduleName"):t("childName")}</span>
        <button type="button" data-act="compose-ok" class="primary">${t("add")}</button>
        <button type="button" data-act="compose-cancel" class="quiet">${t("cancel")}</button>
      </div>`: deleteAskId===node.id?"":`<p class="add-hint">${t("addOnMap")}</p>`}
    ${filesHtml}
    <details class="fold" data-fold="mem" ${foldMem?"open":""}>
      <summary><span>${labels.memory}${node.memories.length?" "+node.memories.length:""}</span><button type="button" class="plus-btn" data-act="add-mem" title="${escAttr(t("addMem"))}">＋</button></summary>
      ${memHtml}
    </details>
    <section class="sec-block" data-fold="idea">
      <button type="button" class="sec-add" data-act="add-idea" title="${escAttr(t("addIdea"))}">${labels.ideas}${node.ideas.length?" "+node.ideas.length:""} ＋</button>
      ${ideaHtml}
    </section>
    <section class="sec-block" data-fold="todo">
      <button type="button" class="sec-add" data-act="add-todo" title="${escAttr(t("addTodo"))}">${labels.todos}${nodeTodos.length?" "+nodeTodos.length:""} ＋</button>
      ${todoHtml}
    </section>
    <section class="sec-block" data-fold="bug">
      <button type="button" class="sec-add" data-act="add-bug" title="${escAttr(t("addBug"))}">${labels.bugs}${openBugs.length?" "+openBugs.length:""} ＋</button>
      ${bugHtml}
    </section>
    <details class="fold" data-fold="inherited" ${foldInherited?"open":""}>
      <summary>${labels.inherited} ${inhCount}</summary>
      <ul class="mem-list">
        ${PINNED.map((t,i)=>`<li><i class="dot success"></i><span class="txt ed" data-ed="pinned" data-i="${i}">${t}</span></li>`).join("")}
        ${inherited.map((m,i)=>`<li><i class="dot ${escAttr(m.mem.state)}"></i><div class="mem-body"><span class="txt ed" data-ed="inh" data-i="${i}">${esc(m.mem.text)}</span>${(m.mem.files&&m.mem.files.length)?attachHtml("inh", i, m.mem, true):""}</div></li>`).join("")}
        ${alsoMems.map(m=>`<li><i class="dot ${escAttr(m.mem.state||"success")}"></i><span class="txt">${esc(m.mem.text||"")}</span></li>`).join("")}
      </ul>
    </details>
    ${node.dormant.length? `<details class="fold" data-fold="dormant" ${foldDormant?"open":""}>
      <summary>${labels.dormant} ${node.dormant.length}</summary>
      <ul class="dormant-list">
        ${node.dormant.map((d,i)=>`<li><b class="ed" data-ed="dorm-title" data-i="${i}">${esc(d.title)}</b></li>`).join("")}
      </ul>
    </details>`:""}`;

  el.querySelectorAll(".bug-check").forEach(c=>c.onclick=()=>crossBug(node, c.dataset.bug));
  el.querySelectorAll(".todo-check").forEach(c=>c.onclick=()=>advanceTodo(node,node.todos.find(todo=>todo.id===c.dataset.todo)));
  el.querySelectorAll("[data-todo-send]").forEach(button=>button.onclick=()=>sendPendingTodo(node,node.todos.find(todo=>todo.id===button.dataset.todoSend)));
  const q = s=>el.querySelector(s);
  if(q('[data-act="accept"]'))  q('[data-act="accept"]').onclick  = ()=>acceptProposal(node);
  bindSilent(q('[data-act="cancel"]'), ()=>{ clearCompose(); cancelProposal(node); });
  if(q('[data-act="restore"]')) q('[data-act="restore"]').onclick = ()=>acceptProposal(node);
  if(q('[data-act="accept-layer"]')) q('[data-act="accept-layer"]').onclick = ()=>acceptLayer(node);
  if(q('[data-act="grant"]'))   q('[data-act="grant"]').onclick   = ()=>toggleAuth(node);
  if(q('[data-act="revoke"]'))  q('[data-act="revoke"]').onclick  = ()=>toggleAuth(node);
  if(q('[data-act="enter"]'))   q('[data-act="enter"]').onclick   = ()=>enterView(node.id);
  if(q('[data-act="child"]'))   q('[data-act="child"]').onclick   = ()=>addChild(node);
  if(q('[data-act="module"]'))  q('[data-act="module"]').onclick  = ()=>addModule(node);
  bindSilent(q('[data-act="delete"]'), ()=>{ clearCompose(); requestDelete(node); });
  bindSilent(q('[data-act="delete-keep"]'), ()=> applyDelete(node, false));
  bindSilent(q('[data-act="delete-all"]'), ()=> applyDelete(node, true));
  bindSilent(q('[data-act="delete-abort"]'), ()=>{ deleteAskId = null; renderAll(); });
  if(q('[data-act="add-mem"]')) q('[data-act="add-mem"]').onclick = (e)=>{
    e.preventDefault(); e.stopPropagation();
    foldMem = true;
    node.memories.push({text:"", state:"dirty", files:[]}); renderAll();
    const last = el.querySelector('[data-fold="mem"] .mem-list li:last-child .ed');
    if(last) last.focus();
  };
  if(q('[data-act="add-idea"]')) q('[data-act="add-idea"]').onclick = (e)=>{
    e.preventDefault(); e.stopPropagation();
    foldIdea = true;
    node.ideas.push({text:"", state:"dirty", files:[]}); renderAll();
    const last = el.querySelector('[data-fold="idea"] .mem-list li:last-child .ed');
    if(last) last.focus();
  };
  if(q('[data-act="add-todo"]')) q('[data-act="add-todo"]').onclick = async (e)=>{
    e.preventDefault(); e.stopPropagation();
    const sessionId = currentSessionId();
    if(!sessionId){ await createAssignedTodo(node); return; }
    foldTodo = true;
    node.todos.push({id:nextTodoId(),title:"",desc:"",status:"pending",sessions:[],target_session:sessionId,draft:true});
    renderAll();
    const last = el.querySelector('[data-fold="todo"] .todo-list li:last-child .todo-text');
    if(last) last.focus();
  };
  if(q('[data-act="add-bug"]')) q('[data-act="add-bug"]').onclick = async (e)=>{
    e.preventDefault(); e.stopPropagation();
    await createAssignedBug(node);
  };
  if(q('[data-act="focus"]'))   q('[data-act="focus"]').onclick   = ()=>{
    focusId = (focusId===node.id? null : node.id); renderAll(); };
  if(q('[data-act="done"]'))    q('[data-act="done"]').onclick    = ()=>{ node.state="success";
    node.memories.push({text:t("doneMem"), state:"success", files:[]}); renderAll(); };
  el.querySelectorAll("[data-work-state]").forEach(b=>{
    b.onclick = ()=>{
      node.state = b.dataset.workState;
      renderAll();
    };
  });

  el.querySelectorAll("details.fold").forEach(d=>{
    d.querySelector(":scope > summary")?.addEventListener("click",e=>{
      if(e.target.closest("button")) return;
      const next = !d.open;
      if(d.dataset.fold==="inherited") foldInherited = next;
      if(d.dataset.fold==="dormant") foldDormant = next;
      if(d.dataset.fold==="mem") foldMem = next;
      if(d.dataset.fold==="idea") foldIdea = next;
      if(d.dataset.fold==="todo") foldTodo = next;
      if(d.dataset.fold==="bug") foldBug = next;
    });
    d.addEventListener("toggle", ()=>{
      if(d.dataset.fold==="inherited") foldInherited = d.open;
      if(d.dataset.fold==="dormant") foldDormant = d.open;
      if(d.dataset.fold==="mem") foldMem = d.open;
      if(d.dataset.fold==="idea") foldIdea = d.open;
      if(d.dataset.fold==="todo") foldTodo = d.open;
      if(d.dataset.fold==="bug") foldBug = d.open;
    });
  });

  const refresh = (changedTitle)=>{
    if(changedTitle) renderAll();
  };
  el.querySelectorAll("[data-ed]").forEach(ed=>{
    const kind = ed.dataset.ed;
    const multiline = kind==="purpose" || kind==="dorm-exp" || kind==="idea" || kind==="todo-text";
    bindEdit(ed, (v,blur)=>{
      if(kind==="title"){
        if(!v || v===node.title) return;
        node.title = v; renderAll(); return;
      }
      if(kind==="purpose"){ node.purpose = v; renderAll(); return; }
      if(kind==="mem"){
        const i = +ed.dataset.i;
        if(!v){ node.memories.splice(i,1); renderAll(); return; }
        if(node.memories[i].text===v) return;
        node.memories[i].text = v; persist(); return;
      }
      if(kind==="idea"){
        const i = +ed.dataset.i;
        if(!v){ node.ideas.splice(i,1); renderAll(); return; }
        if(node.ideas[i].text===v) return;
        node.ideas[i].text = v; persist(); return;
      }
      if(kind==="todo-text"){
        const todo = node.todos.find(item=>item.id===ed.dataset.todo);
        if(!todo) return;
        if(!v){ node.todos = node.todos.filter(item=>item.id!==todo.id); renderAll(); return; }
        todo.desc = v;
        todo.title = v.split(/\r?\n/)[0].trim().slice(0,120);
        if(blur && todo.draft){
          delete todo.draft;
          setTimeout(()=>finalizeInlineTodo(node,todo),0);
        }
        persist(); return;
      }
      if(kind==="pinned"){
        const i = +ed.dataset.i;
        if(v) PINNED[i] = v; return;
      }
      if(kind==="inh"){
        const i = +ed.dataset.i;
        if(inherited[i] && v) inherited[i].mem.text = v; return;
      }
      if(kind==="bug-title"){
        const b = node.bugs.find(x=>x.id===ed.dataset.bug);
        if(!b) return;
        if(!v){ node.bugs = node.bugs.filter(x=>x.id!==b.id); renderAll(); return; }
        b.title = v; return;
      }
      if(kind==="bug-desc"){
        const b = node.bugs.find(x=>x.id===ed.dataset.bug);
        if(b) b.desc = v; return;
      }
      if(kind==="dorm-title"){
        const i = +ed.dataset.i;
        if(node.dormant[i] && v) node.dormant[i].title = v; return;
      }
      if(kind==="dorm-exp"){
        const i = +ed.dataset.i;
        if(node.dormant[i]) node.dormant[i].exp = v; return;
      }
      if(kind==="compose-title"){
        ed.dataset.value = v;
      }
    }, multiline);
  });

  const composeEl = q("[data-ed='compose-title']");
  const doCommit = ()=>{
    const parent = (inTree(composeParent) && !isCancelled(composeParent)) ? composeParent : node;
    if(!composingId || !parent) return;
    const v = composeEl ? textOf(composeEl) : "";
    if(v && v!==t("childName") && v!==t("moduleName") && v!=="子节点名称" && v!=="模块名称") commitChild(parent, v);
  };
  if(q('[data-act="compose-ok"]')) q('[data-act="compose-ok"]').onclick = doCommit;
  if(q('[data-act="compose-cancel"]')) q('[data-act="compose-cancel"]').onclick = ()=>{ clearCompose(); renderAll(); };
  if(composeEl){
    composeEl.addEventListener("keydown", e=>{
      if(e.key==="Enter"){ e.preventDefault(); e.stopPropagation(); doCommit(); }
      if(e.key==="Escape"){ e.preventDefault(); clearCompose(); renderAll(); }
    }, true);
    composeEl.focus();
  }
  bindFileUi(el, node);
  // Keep a blur-triggered detail redraw from removing the button being clicked.
  el.querySelectorAll("button").forEach(button=>button.addEventListener("mousedown",e=>e.preventDefault()));
  hydrateThumbs(el);
  el.onpaste = e=>{
    const memEd = e.target.closest('[data-ed="mem"]');
    const ideaEd = e.target.closest('[data-ed="idea"]');
    const bugEd = e.target.closest('[data-ed="bug-title"]');
    const drop = e.target.closest("[data-drop-files]");
    if(memEd) takeAttach(node, "mem", memEd.dataset.i, e);
    else if(ideaEd) takeAttach(node, "idea", ideaEd.dataset.i, e);
    else if(bugEd) takeAttach(node, "bug", bugEd.dataset.bug, e);
    else if(drop) takeAttach(node, drop.dataset.fk, drop.dataset.fi, e);
  };
}

/* ================= Bug 叉掉 → Agent 沉淀 → 休眠 ================= */
function crossBug(node, bugId){
  const home = ((node.bugs||[]).some(b=>b.id===bugId) ? node : findBugHome(bugId)) || node;
  const bug = (home.bugs||[]).find(b=>b.id===bugId);
  if(!bug || bug.status!=="open") return;
  bug.status = "pending";
  renderAll();
  setTimeout(()=>{
    bug.status = "dormant";
    home.dormant = home.dormant || [];
    home.dormant.push({
      title: bug.title,
      exp: t("dormantExp"),
      files: fileList(bug).map(f=>({path:f.path}))
    });
    if(bugPathMode && bugFocus && bugFocus.bugId===bugId) exitBugPath(true);
    else renderAll();
  }, 1600);
}

/* ================= 平移 / 缩放 / 自适应视口 ================= */
let view = {x:36, y:24, k:1};
function hideEdgeSlivers(){
  const vp = document.getElementById("viewport");
  const header = document.querySelector("header.top");
  if(!vp || window.__CG_GALLERY) return;
  const box = vp.getBoundingClientRect();
  const headerBottom = header && header.getClientRects().length ? header.getBoundingClientRect().bottom : box.top;
  const clipTop = Math.max(box.top, headerBottom);
  vp.querySelectorAll("#nodes .node").forEach(el => {
    const r = el.getBoundingClientRect();
    const above = clipTop - r.top;
    const below = r.bottom - clipTop;
    el.classList.toggle("edge-sliver", above > 1 && below < Math.max(36, r.height * 0.55));
  });
}
function applyView(){
  worldEl.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`;
  hideEdgeSlivers();
}
if(worldEl && window.MutationObserver){
  new MutationObserver(() => hideEdgeSlivers()).observe(worldEl, { attributes:true, attributeFilter:["style"] });
}
/* 导图在顶栏和检查器让出的区域内居中；顶栏变高时用 --chrome-top 让位，不要把标题盖住。 */
function chromeTop(){
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--chrome-top");
  const n = parseFloat(raw);
  return Number.isFinite(n) && n>0 ? n : 58;
}
const DRAWER_W_KEY = "cg-drawer-width";
const DRAWER_H_KEY = "cg-drawer-height";
const BUG_W_KEY = "cg-bug-panel-width";
const DRAWER_W_DEFAULT = 340;
const BUG_W_DEFAULT = 240;
const PHONE_MQ = "(max-width: 820px), (hover: none) and (pointer: coarse) and (orientation: portrait)";
function isPhoneLayout(){
  if(window.__CG_PHONE_FORCE===true) return true;
  if(window.__CG_PHONE_FORCE===false) return false;
  try{
    if(window.matchMedia(PHONE_MQ).matches) return true;
  }catch(e){}
  const short = Math.min(screen.width||0, screen.height||0);
  const tall = Math.max(screen.width||0, screen.height||0);
  const portrait = (window.innerHeight||0) >= (window.innerWidth||0) || tall >= short;
  let touch = (navigator.maxTouchPoints||0) > 0;
  try{ touch = touch || window.matchMedia("(pointer: coarse)").matches; }catch(e){}
  return !!(touch && portrait && short > 0 && short <= 820);
}
function syncPhoneClass(){
  document.documentElement.classList.toggle("cg-phone", isPhoneLayout());
}
function cssPx(name, fallback){
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(n) && n>0 ? n : fallback;
}
function drawerWidthPx(){ return cssPx("--drawer-width", DRAWER_W_DEFAULT); }
function defaultDrawerHeight(){
  return Math.round((window.innerHeight || 800) * 0.4);
}
function drawerHeightPx(){ return cssPx("--drawer-height", defaultDrawerHeight()); }
function bugPanelWidthPx(){ return cssPx("--bug-panel-width", BUG_W_DEFAULT); }
function bugsPanelOpen(){ return document.body.classList.contains("bugs-open") && !isPhoneLayout(); }
function clampDrawerWidth(px){
  const max = Math.max(280, Math.min(640, Math.floor(window.innerWidth * 0.62)));
  return Math.max(220, Math.min(max, Math.round(px)));
}
function clampBugPanelWidth(px){
  const max = Math.max(220, Math.min(560, Math.floor(window.innerWidth * 0.55)));
  return Math.max(180, Math.min(max, Math.round(px)));
}
function clampDrawerHeight(px){
  const top = chromeTop();
  const room = Math.max(220, (window.innerHeight || 0) - top);
  const max = Math.max(160, Math.min(Math.floor(room * 0.72), room - 72));
  return Math.max(132, Math.min(max, Math.round(px)));
}
function applyDrawerWidth(px, save){
  const w = clampDrawerWidth(px);
  document.documentElement.style.setProperty("--drawer-width", w+"px");
  if(save){
    try{ localStorage.setItem(DRAWER_W_KEY, String(w)); }catch(e){}
  }
  return w;
}
function applyDrawerHeight(px, save){
  const h = clampDrawerHeight(px);
  document.documentElement.style.setProperty("--drawer-height", h+"px");
  if(save){
    try{ localStorage.setItem(DRAWER_H_KEY, String(h)); }catch(e){}
  }
  return h;
}
function applyBugPanelWidth(px, save){
  const w = clampBugPanelWidth(px);
  document.documentElement.style.setProperty("--bug-panel-width", w+"px");
  if(save){
    try{ localStorage.setItem(BUG_W_KEY, String(w)); }catch(e){}
  }
  return w;
}
function restoreDrawerWidth(){
  try{
    const n = parseFloat(localStorage.getItem(DRAWER_W_KEY));
    if(Number.isFinite(n)) applyDrawerWidth(n, false);
  }catch(e){}
}
function restoreBugPanelWidth(){
  try{
    const n = parseFloat(localStorage.getItem(BUG_W_KEY));
    if(Number.isFinite(n)) applyBugPanelWidth(n, false);
  }catch(e){}
}
function restoreDrawerHeight(){
  if(!isPhoneLayout()) return;
  try{
    const n = parseFloat(localStorage.getItem(DRAWER_H_KEY));
    if(Number.isFinite(n)) applyDrawerHeight(n, false);
    else applyDrawerHeight(defaultDrawerHeight(), false);
  }catch(e){
    applyDrawerHeight(defaultDrawerHeight(), false);
  }
}
function applyDrawerLayout(){
  if(isPhoneLayout()) applyDrawerHeight(drawerHeightPx(), false);
  else applyDrawerWidth(drawerWidthPx(), false);
  syncSplitChrome();
}
function syncSplitChrome(){
  const el = document.getElementById("drawer-split");
  if(!el) return;
  const phone = isPhoneLayout();
  el.setAttribute("aria-orientation", phone ? "horizontal" : "vertical");
  el.title = t(phone ? "splitTitlePhone" : "splitTitle");
}
function finishDrawerChrome(){
  restoreDrawerWidth();
  restoreDrawerHeight();
  restoreBugPanelWidth();
  bindDrawerSplit();
  applyDrawerLayout();
  syncChrome();
}
function bindDrawerSplit(){
  const el = document.getElementById("drawer-split");
  if(!el || el.dataset.bound==="1") return;
  el.dataset.bound = "1";
  let resizing = false;
  function move(e){
    if(!resizing) return;
    if(isPhoneLayout()){
      const y = e.clientY;
      if(!Number.isFinite(y)) return;
      applyDrawerHeight(window.innerHeight - y, false);
    }else{
      const x = e.clientX;
      if(!Number.isFinite(x)) return;
      if(bugsPanelOpen()) applyBugPanelWidth(window.innerWidth - x, false);
      else applyDrawerWidth(window.innerWidth - x, false);
    }
  }
  function unbindMove(){
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("mousemove", move, true);
    window.removeEventListener("pointerup", stop, true);
    window.removeEventListener("mouseup", stop, true);
    window.removeEventListener("pointercancel", stop, true);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", stop);
    el.removeEventListener("pointercancel", stop);
    el.removeEventListener("lostpointercapture", stop);
  }
  function stop(){
    if(!resizing) return;
    resizing = false;
    document.body.classList.remove("drawer-resizing");
    unbindMove();
    if(isPhoneLayout()) applyDrawerHeight(drawerHeightPx(), true);
    else if(bugsPanelOpen()) applyBugPanelWidth(bugPanelWidthPx(), true);
    else applyDrawerWidth(drawerWidthPx(), true);
    fitView();
  }
  function start(e){
    if(e.button!=null && e.button!==0) return;
    if(resizing && e.type==="mousedown") return;
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    panning = false;
    vp.classList.remove("grabbing");
    document.body.classList.add("drawer-resizing");
    window.addEventListener("pointermove", move, true);
    window.addEventListener("mousemove", move, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("mouseup", stop, true);
    window.addEventListener("pointercancel", stop, true);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    el.addEventListener("lostpointercapture", stop);
    if(e.pointerId!=null){
      try{ el.setPointerCapture(e.pointerId); }catch(err){}
    }
  }
  el.addEventListener("pointerdown", start);
  el.addEventListener("mousedown", start);
  el.addEventListener("dblclick", e=>{
    e.preventDefault();
    if(isPhoneLayout()) applyDrawerHeight(defaultDrawerHeight(), true);
    else if(bugsPanelOpen()) applyBugPanelWidth(BUG_W_DEFAULT, true);
    else applyDrawerWidth(DRAWER_W_DEFAULT, true);
    fitView();
  });
  el.addEventListener("keydown", e=>{
    const step = e.shiftKey ? 32 : 16;
    if(isPhoneLayout()){
      if(e.key!=="ArrowUp" && e.key!=="ArrowDown") return;
      e.preventDefault();
      applyDrawerHeight(drawerHeightPx() + (e.key==="ArrowUp" ? step : -step), true);
      fitView();
      return;
    }
    if(e.key!=="ArrowLeft" && e.key!=="ArrowRight") return;
    e.preventDefault();
    const delta = e.key==="ArrowLeft" ? step : -step;
    if(bugsPanelOpen()) applyBugPanelWidth(bugPanelWidthPx() + delta, true);
    else applyDrawerWidth(drawerWidthPx() + delta, true);
    fitView();
  });
}
function syncChrome(){
  const h = document.querySelector("header.top");
  if(!h || !h.getClientRects().length) return;
  const box = h.getBoundingClientRect();
  const min = document.documentElement.classList.contains("cg-phone") ? 96 : 58;
  const px = Math.max(min, Math.round(box.bottom));
  document.documentElement.style.setProperty("--chrome-top", px+"px");
  hideEdgeSlivers();
}
function fitView(){
  const bugs = document.body.classList.contains("bugs-open");
  const phone = isPhoneLayout();
  const right = phone ? 0 : (bugs ? bugPanelWidthPx() : drawerWidthPx());
  const bottom = phone ? drawerHeightPx() : 0;
  const availW = window.innerWidth - right - 72;
  const availH = window.innerHeight - chromeTop() - bottom - 36;
  const k = Math.min(availW/Math.max(extents.w,1), availH/Math.max(extents.h,1), 1.35);
  view.k = Math.max(k, .35);
  view.x = 36 + Math.max(0, (availW - extents.w*view.k)/2);
  view.y = 24 + Math.max(0, (availH - extents.h*view.k)/2);
  applyView();
}
function onChromeResize(){
  syncPhoneClass();
  const phone = isPhoneLayout();
  const crossed = phone !== onChromeResize._phone;
  onChromeResize._phone = phone;
  if(crossed){
    if(phone) restoreDrawerHeight();
    else restoreDrawerWidth();
    if(typeof data!=="undefined" && data) renderAll();
  }else{
    applyDrawerLayout();
  }
  syncSplitChrome();
  syncChrome();
  fitView();
}
onChromeResize._phone = isPhoneLayout();
window.addEventListener("resize", onChromeResize);
window.addEventListener("orientationchange", ()=>{ setTimeout(onChromeResize, 300); });
try{
  window.matchMedia(PHONE_MQ).addEventListener("change", onChromeResize);
}catch(e){
  try{ window.matchMedia(PHONE_MQ).addListener(onChromeResize); }catch(err){}
}
const vp = document.getElementById("viewport");
let panning=false, sx=0, sy=0;
const pointers = new Map();
let pinch = null;
function panIgnore(el){
  return !!(el && (el.closest("#drawer-split") || el.closest(".node") || el.closest(".lens-bar") || el.closest(".shelf-card") || el.closest(".shelf-label")));
}
function endPointer(e){
  pointers.delete(e.pointerId);
  if(pointers.size < 2) pinch = null;
  if(pointers.size === 0){
    panning = false;
    vp.classList.remove("grabbing");
  }else if(pointers.size === 1){
    const p = [...pointers.values()][0];
    panning = true;
    sx = p.x - view.x;
    sy = p.y - view.y;
  }
}
vp.addEventListener("pointerdown", e=>{
  if(window.__CG_GALLERY) return;
  hideDotHint();
  if(!e.target.closest(".add-child") && !e.target.closest(".add-pick")) closeAddPick();
  if(document.body.classList.contains("drawer-resizing")) return;
  if(panIgnore(e.target)) return;
  if(e.pointerType==="mouse" && e.button!=null && e.button!==0) return;
  pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  try{ vp.setPointerCapture(e.pointerId); }catch(err){}
  if(pointers.size===2){
    const pts = [...pointers.values()];
    pinch = {
      d: Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y),
      k: view.k
    };
    panning = false;
    vp.classList.remove("grabbing");
    return;
  }
  panning = true;
  sx = e.clientX-view.x;
  sy = e.clientY-view.y;
  vp.classList.add("grabbing");
});
vp.addEventListener("pointermove", e=>{
  if(!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(pinch && pointers.size===2){
    const pts = [...pointers.values()];
    const d = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
    if(pinch.d>8 && view.k>0){
      const nk = Math.min(2.2, Math.max(.35, pinch.k * (d / pinch.d)));
      const rect = vp.getBoundingClientRect();
      const cx = (pts[0].x+pts[1].x)/2 - rect.left;
      const cy = (pts[0].y+pts[1].y)/2 - rect.top;
      view.x = cx - (cx-view.x)*(nk/view.k);
      view.y = cy - (cy-view.y)*(nk/view.k);
      view.k = nk;
      applyView();
    }
    return;
  }
  if(!panning || document.body.classList.contains("drawer-resizing")) return;
  view.x=e.clientX-sx; view.y=e.clientY-sy; applyView();
});
vp.addEventListener("pointerup", endPointer);
vp.addEventListener("pointercancel", endPointer);
window.addEventListener("mouseup", ()=>{ if(pointers.size===0){ panning=false; vp.classList.remove("grabbing"); } });
vp.addEventListener("wheel", e=>{
  if(window.__CG_GALLERY) return;
  e.preventDefault();
  const factor = e.deltaY<0 ? 1.08 : 1/1.08;
  const nk = Math.min(2.2, Math.max(.35, view.k*factor));
  const rect = vp.getBoundingClientRect();
  const cx = e.clientX-rect.left, cy = e.clientY-rect.top;
  view.x = cx - (cx-view.x)*(nk/view.k);
  view.y = cy - (cy-view.y)*(nk/view.k);
  view.k = nk;
  applyView();
},{passive:false});

function syncLinkRepoBtn(){
  const b = document.getElementById("btn-link-repo");
  if(!b) return;
  b.hidden = !canFsAccess();
}
function renderAll(){
  if(window.__CG_INPUT_COMMIT){ renderMap(); persist(); return; }
  liveViewRoot(); liveSelected(); renderNav(); renderTray(); renderBugPanel(); renderMap(); renderDetail();
  syncLinkRepoBtn();
  persist();
}
function bootChipGallery(){
  document.title = "状态标签 · 50 版";
  document.documentElement.classList.add("g-kind-chip");
  const bar = document.querySelector("#design-gallery .g-bar");
  if(bar){
    bar.querySelector("b").textContent = "状态标签 · 50 版";
    bar.querySelector(".hint").textContent = "往下滑动。字是黑体、正的；颜色是荧光笔涂在字上，不是胶囊。标题行跟现在检查器一样，只换这一笔。下面三粒是已做未测 / 测试未过 / 未开发。看中了把编号发我，例如「标签 11」。不用点。";
  }
  const trash = `<span class="trash" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g class="lid"><rect x="9" y="3.2" width="6" height="1.7" rx=".7" fill="currentColor" stroke="none"/><path d="M4.5 7.1h15"/></g><g class="can"><path d="M7 7.1v12.3a1.7 1.7 0 0 0 1.7 1.7h6.6a1.7 1.7 0 0 0 1.7-1.7V7.1"/></g><g class="rib"><path d="M10 11.2v6"/><path d="M14 11.2v6"/></g></svg></span>`;
  const names = [
    ["01","腰涂微斜"],["02","更斜"],["03","不斜"],["04","只涂字腰"],["05","整格涂满"],
    ["06","带对勾"],["07","淡涂"],["08","很浓"],["09","左右冒头"],["10","贴字"],
    ["11","圆头笔"],["12","方头笔"],["13","上扬"],["14","下压"],["15","两笔叠"],
    ["16","尾淡"],["17","字距松"],["18","字距紧"],["19","稍大"],["20","稍小"],
    ["21","偏下划"],["22","偏上划"],["23","荧光绿"],["24","更宽"],["25","更窄"],
    ["26","更厚"],["27","更薄"],["28","毛边"],["29","勾加字"],["30","半透明"],
    ["31","大圆角"],["32","短涂"],["33","过冲"],["34","歪圆头"],["35","左侧重"],
    ["36","右侧重"],["37","中间亮"],["38","竖向更满"],["39","底三分一"],["40","斜切角"],
    ["41","加粗字"],["42","细字"],["43","黄绿"],["44","薄荷"],["45","柠檬"],
    ["46","青柠"],["47","笔触纹理"],["48","三笔"],["49","纸上微影"],["50","最荧光"]
  ];
  const okOf = id => (id==="06"||id==="29") ? `<b>✓</b>测试通过` : "测试通过";
  const uOf = () => "已做未测";
  const fOf = () => "测试未过";
  const dOf = () => "未开发";
  document.getElementById("g-scroll").innerHTML = names.map(([id, name]) => {
    const chip = `<span class="chip">${okOf(id)}</span>`;
    const alts = `<div class="alts"><span class="chip u">${uOf()}</span><span class="chip f">${fOf()}</span><span class="chip d">${dOf()}</span></div>`;
    return `<article class="g-item" id="v${id}"><div class="g-num">${id} · ${name}</div><aside class="g-mock g-ch-mock g-ch-${id}"><div class="who"><h2>冷启动</h2>${chip}<span class="sp"></span>${trash}</div><p class="lead">skill 怎么进机器、第一次怎么建图：安装、init、语言、层对层商量</p>${alts}</aside></article>`;
  }).join("");
}
function bootTrashIconGallery(){
  document.title = "垃圾桶图标 · 50 版";
  document.documentElement.classList.add("g-kind-trash");
  const bar = document.querySelector("#design-gallery .g-bar");
  if(bar){
    bar.querySelector("b").textContent = "垃圾桶图标 · 50 版";
    bar.querySelector(".hint").textContent = "往下滑动，指针放上图标看动效。标题行跟现在检查器一样，只换垃圾桶。看中了把编号发我，例如「垃圾桶 12」。";
  }
  const s = (inner, sw) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw||1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const f = inner =>
    `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${inner}</svg>`;
  const lidH = `<g class="lid"><rect x="9" y="3.2" width="6" height="1.7" rx=".7" fill="currentColor" stroke="none"/><path d="M4.5 7.1h15"/></g>`;
  const lidLine = `<g class="lid"><path d="M4.5 7.1h15"/></g>`;
  const canR = `<g class="can"><path d="M7 7.1v12.3a1.7 1.7 0 0 0 1.7 1.7h6.6a1.7 1.7 0 0 0 1.7-1.7V7.1"/></g>`;
  const ribs2 = `<g class="rib"><path d="M10 11.2v6"/><path d="M14 11.2v6"/></g>`;
  const ribs3 = `<g class="rib"><path d="M9.5 11.2v6"/><path d="M12 11.2v6"/><path d="M14.5 11.2v6"/></g>`;
  const ring = `<circle class="ring" cx="12" cy="13" r="10" stroke-width="1.2" fill="none"/>`;
  const L = [];
  const add = (id, name, icon) => L.push({id, name, icon});
  add("01", "盖子弹起", s(lidH+canR+ribs2));
  add("02", "盖子掀开", s(lidH+canR+ribs2, 2));
  add("03", "整桶轻晃", s(lidH+canR+ribs2, 2.2));
  add("04", "轻轻放大", s(lidLine+canR+ribs2, 1.4));
  add("05", "盖子拍下", s(lidH+canR));
  add("06", "纸屑掉进", s(lidH+canR+`<g class="paper"><path d="M10 4v3M13.5 4.5v2.6"/></g>`+ribs2));
  add("07", "桶身一歪", s(`<g class="lid"><path d="M5 7h14"/></g><g class="can"><path d="M7.2 7l.6 13h8.4l.6-13"/></g>`+ribs2));
  add("08", "线条走一圈", s(lidH+canR+ribs2, 1.6));
  add("09", "空心变实心", s(lidH+`<g class="can"><path d="M7 8h10l-.9 11.2H7.9z"/></g>`+ribs2));
  add("10", "呼吸放大", s(lidH+canR+ribs3));
  add("11", "盖子飞走", s(lidH+`<g class="can"><path d="M7.4 7.1v12.2a1.4 1.4 0 0 0 1.4 1.4h6.4a1.4 1.4 0 0 0 1.4-1.4V7.1"/></g>`+ribs2));
  add("12", "弹一下", s(lidH+`<g class="can"><rect x="7" y="7.2" width="10" height="13" rx="2"/></g>`+ribs2));
  add("13", "压扁", s(lidH+canR+ribs2, 2.4));
  add("14", "拧一点", s(`<g class="lid"><rect x="10" y="2.8" width="4" height="2" rx="1" fill="currentColor" stroke="none"/><path d="M4 7h16"/></g>`+canR+ribs2));
  add("15", "纸张滑入", s(lidLine+canR+`<g class="paper"><path d="M12 3.2v5"/></g>`+ribs2));
  add("16", "竖线收起", s(lidH+canR+ribs3, 1.7));
  add("17", "圆圈围住", s(lidH+canR+ribs2+ring));
  add("18", "盖子点头", s(`<g class="lid"><rect x="8.8" y="3" width="6.4" height="2" rx="1" fill="currentColor" stroke="none"/><path d="M4 7.2h16"/></g>`+canR+ribs2));
  add("19", "轻轻闪", s(lidLine+`<g class="can"><path d="M8 7.2h8v12.4H8z"/></g>`+ribs2, 1.5));
  add("20", "左右晃", s(lidH+`<g class="can"><path d="M6.8 7.2h10.4l-1.1 12.6H7.9z"/></g>`+ribs2));
  add("21", "盖子滑开", s(`<g class="lid"><rect x="9" y="3.2" width="6" height="1.7" rx=".7" fill="currentColor" stroke="none"/><path d="M3.5 7.1h17"/></g>`+canR+ribs2));
  add("22", "桶口张开", s(lidLine+`<g class="can"><path d="M6.5 7.4l1.2 12.4h8.6l1.2-12.4"/></g>`+ribs2));
  add("23", "小块散开", s(lidH+canR+`<g class="paper"><rect class="bit" x="9" y="4" width="1.4" height="1.4" fill="currentColor" stroke="none"/><rect class="bit" x="12" y="3.2" width="1.4" height="1.4" fill="currentColor" stroke="none"/><rect class="bit" x="14.6" y="4.2" width="1.4" height="1.4" fill="currentColor" stroke="none"/></g>`+ribs2));
  add("24", "往下顿一下", s(lidH+canR+ribs2, 2.1));
  add("25", "橡皮筋", s(lidH+`<g class="can"><path d="M7 7.2h10v12.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/></g>`+ribs2));
  add("26", "盖子隐去", s(lidLine+canR+ribs2, 1.9));
  add("27", "斜切", s(lidH+canR+`<g class="rib"><path d="M12 10.8v6.4"/></g>`));
  add("28", "盖子竖起", s(lidH+canR+`<g class="rib"><path d="M10.2 11v6M13.8 11v6"/></g>`, 1.85));
  add("29", "墨水填满", s(lidH+canR+`<rect class="ink" x="8.2" y="10.4" width="7.6" height="8.4" rx="1" fill="currentColor" stroke="none" opacity=".35"/>`+ribs2));
  add("30", "小纸飞入", s(lidLine+canR+`<g class="paper"><path d="M11 3.4h2v4h-2z" fill="currentColor" stroke="none" opacity=".85"/></g>`+ribs2));
  add("31", "提手一晃", s(`<g class="lid"><path d="M9.2 4.2h5.6"/><path d="M4.5 7h15"/></g>`+canR+ribs2, 2));
  add("32", "线变粗", s(lidH+canR+ribs2, 1.3));
  add("33", "桶缩小", s(lidH+`<g class="can"><path d="M8 7.1v12.3a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5V7.1"/></g>`+ribs2));
  add("34", "弹出", f(`<g class="lid"><rect x="8.5" y="3" width="7" height="2" rx="1"/><rect x="4" y="5.2" width="16" height="2.2" rx="1"/></g><g class="can"><path d="M7 8h10l-.9 12.2a1.6 1.6 0 0 1-1.6 1.4H9.5a1.6 1.6 0 0 1-1.6-1.4z"/></g>`));
  add("35", "盖子跳", s(lidH+canR+`<path d="M8 20.8h8"/>`+ribs2));
  add("36", "涟漪", s(lidH+canR+ribs2+`<circle class="ring" cx="12" cy="13" r="9" fill="none" stroke-width="1.3"/>`));
  add("37", "虚线绕", s(lidH+canR+ribs2+`<circle class="ring" cx="12" cy="13" r="10" fill="none" stroke-width="1.2" stroke-dasharray="3 3"/>`));
  add("38", "折一下", s(lidH+`<g class="can"><path d="M7.5 7.2h9v12.6h-9z"/></g>`+ribs2, 1.9));
  add("39", "盖章", f(`<g class="lid"><path d="M9 3h6l1 2h4v2H4V5h4z"/></g><g class="can"><path d="M7 8h10v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/><rect class="rib" x="10" y="10.5" width="1.4" height="7" rx=".4" fill="#fffdf8"/><rect class="rib" x="12.8" y="10.5" width="1.4" height="7" rx=".4" fill="#fffdf8"/></g>`));
  add("40", "融化", s(lidH+`<g class="can"><path d="M6.8 7.2h10.4c.2 4 .6 8.2.2 12.6H7.2c-.5-4.2-.2-8.4-.4-12.6z"/></g>`+ribs2));
  add("41", "眨一下", s(lidH+canR+`<g class="eye"><circle cx="10.2" cy="13.4" r=".9" fill="currentColor" stroke="none"/><circle cx="13.8" cy="13.4" r=".9" fill="currentColor" stroke="none"/></g>`));
  add("42", "拍盖", s(lidH+canR+ribs2, 2.3));
  add("43", "纸团进去", s(lidLine+canR+`<g class="paper"><path d="M11.2 4.2l.4 2.2 1.6-.6-.8 2.4 1.4 1.1-2.2.2-.6 2-1-1.8-2 .4 1.4-1.8z" fill="currentColor" stroke="none"/></g>`));
  add("44", "往上抽", s(lidH+canR+`<g class="rib"><path d="M10 11.6v5.2M14 11.6v5.2"/></g>`, 1.75));
  add("45", "从中裂开", s(lidH+canR+`<g class="rib"><path d="M10 11v6"/><path d="M14 11v6"/></g>`));
  add("46", "颜色加深", s(lidH+canR+ribs3, 2));
  add("47", "敲两下", s(lidH+canR+ribs2+`<path d="M9 20.9h6"/>`));
  add("48", "先抬再落", s(lidH+canR+`<g class="paper"><path d="M12 3.6v4.2"/></g>`+ribs2));
  add("49", "微微浮起", s(lidH+`<g class="can"><path d="M7 7.2h10l-1 12.6H8z"/></g>`+ribs2, 1.6));
  add("50", "圆盖探头", s(`<g class="lid"><rect x="8.4" y="3" width="7.2" height="2.2" rx="1.1" fill="currentColor" stroke="none"/><path d="M4.2 7.2h15.6"/></g>`+`<g class="can"><rect x="7" y="7.2" width="10" height="12.6" rx="3"/></g>`+ribs2));

  const card = icon => `<div class="who"><h2>冷启动</h2><span class="st">已做未测</span><span class="sp"></span><button type="button" class="ico" aria-label="删除">${icon}</button></div>
    <p class="lead">skill 怎么进机器、第一次怎么建图：安装、init、语言、层对层商量</p>
    <p class="hint">指针放上去看动效。这里只换图标。</p>`;
  document.getElementById("g-scroll").innerHTML = L.map(v =>
    `<article class="g-item" id="v${v.id}"><div class="g-num">${v.id} · ${v.name}</div><aside class="g-mock g-tr-mock g-tr-${v.id}">${card(v.icon)}</aside></article>`
  ).join("");
}
function bootAddActionGallery(){
  document.title = "新增这一行 · 50 版";
  const bar = document.querySelector("#design-gallery .g-bar");
  if(bar){
    bar.querySelector("b").textContent = "新增这一行 · 50 版";
    bar.querySelector(".hint").textContent = "往下滑动。标题、用途、记忆卡跟现在检查器一样，只有「新增 / 删除」这一行在换。看中了把编号发我，例如「新增 03」。不用点。";
  }
  const frozen = slot => `<h2>冷启动 <span class="st">已做未测</span></h2>
    <p class="lead">skill 怎么进机器、第一次怎么建图：安装、init、语言、层对层商量</p>
    <div class="slot">${slot}</div>
    <div class="note"><span class="add">记忆 ＋</span><p>npx/init/set-language 属于冷启动，不是 hook。</p></div>
    <div class="note"><span class="add">Idea ＋</span><p class="empty">还没有</p></div>
    <div class="note"><span class="add">Bug ＋</span><p class="empty">还没有</p></div>
    <div class="inh">继承的 5</div>`;
  const L = [];
  const add = (id, name, slot) => L.push({id, name, html: frozen(slot)});
  add("01", "现况双钮", `<div class="row"><span class="b">＋ 模块</span><span class="b">＋ 子节点</span><span class="q">删除</span></div>`);
  add("02", "一钮再选", `<span class="b">＋ 新增 ▾</span><div class="menu"><i class="on">模块</i><i>节点</i></div>`);
  add("03", "图上那个＋", `<span class="plus">＋</span><div class="pop"><i>模块</i><i>节点</i></div>`);
  add("04", "三个字链", `<a>模块</a><a>节点</a><a class="del">删除</a>`);
  add("05", "先说再选", `<p class="hint">在这个节点下面加：</p><a>模块</a><a>节点</a>`);
  add("06", "一个主按钮", `<div class="row"><span class="b">＋ 新增</span><span class="q">删除</span></div>`);
  add("07", "分段再添加", `<div class="row"><span class="seg"><i class="on">模块</i><i>节点</i></span><span class="b">添加</span></div>`);
  add("08", "标题旁小＋", `<span class="hint">加号在标题右边，这一行空着。</span>`);
  add("09", "让图上的＋干", `<p class="hint">要加模块或节点，去图上点 ＋。这里不放按钮。</p>`);
  add("10", "全宽一条", `<span class="b wide">＋ 新增模块或节点</span>`);
  add("11", "两张小卡", `<div class="cards"><i>模块<u>一块开工面</u></i><i>节点<u>一件具体的事</u></i></div>`);
  add("12", "两个图标", `<div class="row"><span class="ico">▣</span><span class="ico">○</span><span class="q">删除</span></div>`);
  add("13", "从底升起", `<div class="sheet"><i>新增模块</i><i>新增节点</i><i class="x">取消</i></div>`);
  add("14", "下拉选择", `<div class="sel"><span>新增…</span><span>▾</span></div>`);
  add("15", "两粒芯片", `<div class="row"><span class="chip">模块</span><span class="chip">节点</span><span class="chip x">删除</span></div>`);
  add("16", "检查器只删", `<span class="q">删除</span>`);
  add("17", "收进三点", `<span class="more">···</span>`);
  add("18", "滑块选种类", `<div class="row"><span class="slide"><b></b><i>模块</i><i>节点</i></span><span class="b">添加</span></div>`);
  add("19", "开关当模块", `<div class="row"><span class="b">＋ 添加</span><span class="tog">作为模块 <u></u></span></div>`);
  add("20", "虚线投放", `<div class="drop">＋ 放到这里<span>模块或节点，点了再选</span></div>`);
  add("21", "像记忆卡那样", `<div class="fake">新增 ＋</div>`);
  add("22", "两步", `<div class="step">① 选种类</div><div class="row"><span class="b">模块</span><span class="b">节点</span></div>`);
  add("23", "先起名", `<div class="ph">名称，回车后再选模块或节点</div>`);
  add("24", "一粒黄胶囊", `<span class="pill">＋ 新增</span>`);
  add("25", "无阴影双钮", `<div class="row"><span class="flat">＋ 模块</span><span class="flat">＋ 节点</span><span class="q">删除</span></div>`);
  add("26", "跟地图同一套", `<div class="row"><span class="b">＋</span><span class="hint">点开后选模块或节点</span></div>`);
  add("27", "底栏三格", `<div class="dock"><i>模块</i><i>节点</i><i>删除</i></div>`);
  add("28", "模块为主", `<div class="row"><span class="b">＋ 模块</span><span class="q">＋ 节点</span><span class="q">删除</span></div>`);
  add("29", "节点为主", `<div class="row"><span class="b">＋ 节点</span><span class="q">＋ 模块</span><span class="q">删除</span></div>`);
  add("30", "三等分", `<div class="tri"><i>模块</i><i>节点</i><i>删除</i></div>`);
  add("31", "小字新增", `<p class="hint">新增 · 模块 / 节点</p>`);
  add("32", "手写", `<div class="hand">加模块 / 加节点</div>`);
  add("33", "命令行", `<div class="term">$ add [--module|--node]</div>`);
  add("34", "报纸栏", `<div class="paper"><b>新增</b> 模块 · 节点 &nbsp;&nbsp; <b>删</b></div>`);
  add("35", "瑞士两个词", `<span class="swiss">模块</span><span class="swiss">节点</span>`);
  add("36", "右下圆钮", `<span class="fab">＋</span>`);
  add("37", "蓝字无框", `<a>＋ 模块</a> <a>＋ 节点</a> <a class="del">删除</a>`);
  add("38", "删除离远点", `<div class="row"><span class="b">＋ 新增</span></div><div class="row" style="margin-top:18px"><span class="q">删除这个节点</span></div>`);
  add("39", "先问一句", `<p class="ask">加模块，还是加节点？</p><div class="row"><span class="b">模块</span><span class="b">节点</span></div>`);
  add("40", "单选再确认", `<div class="rad"><i class="on">模块</i><i>节点</i></div>`);
  add("41", "页签", `<div class="tabs"><i class="on">模块</i><i>节点</i></div>`);
  add("42", "长句子", `<span class="b long">在「冷启动」下面加一个模块或节点</span>`);
  add("43", "极简", `<div class="row"><span class="dotplus">＋</span><span class="q">删除</span></div>`);
  add("44", "不分种类", `<span class="b">＋ 子项</span>`);
  add("45", "删前再问", `<div class="row"><span class="b">＋ 新增</span></div><div class="confirm">删除？ <span class="q">取消</span> <span class="q">删</span></div>`);
  add("46", "说清楚孩子", `<p class="kid">冷启动的孩子</p><div class="row"><span class="b">＋ 模块</span><span class="b">＋ 节点</span></div>`);
  add("47", "左右两栏", `<div class="cols"><i>模块</i><i>节点</i></div>`);
  add("48", "折叠新增", `<div class="fold">新增 ▾<span>模块 · 节点</span></div>`);
  add("49", "现况但合成", `<div class="row"><span class="b">＋ 模块或节点</span><span class="q">删除</span></div>`);
  add("50", "一个＋收掉删除", `<span class="b">＋</span>`);

  /* 08 把小加号画在标题上，slot 仍占位。 */
  const htmlFor = v => {
    let inner = v.html;
    if(v.id==="08") inner = inner.replace("<h2>冷启动", "<h2>冷启动 <span class=\"tiny\">＋</span>");
    return inner;
  };
  document.getElementById("g-scroll").innerHTML = L.map(v =>
    `<article class="g-item" id="v${v.id}"><div class="g-num">${v.id} · ${v.name}</div><aside class="g-mock g-add-mock g-add-${v.id}">${htmlFor(v)}</aside></article>`
  ).join("");
}
function bootDesignGallery(){
  if(window.__CG_GALLERY_KIND==="add"){
    bootAddActionGallery();
    return;
  }
  if(window.__CG_GALLERY_KIND==="trash"){
    bootTrashIconGallery();
    return;
  }
  if(window.__CG_GALLERY_KIND==="chip"){
    bootChipGallery();
    return;
  }
  document.title = "工作台风格 · 50 版";
  const barEl = document.querySelector("#design-gallery .g-bar");
  if(barEl){
    barEl.querySelector("b").textContent = "工作台风格 · 50 版";
    barEl.querySelector(".hint").textContent = "往下滑动。画布和右侧栏跟现在工作台一样，只有顶栏换风格。看中了把编号发我，例如「风格 17」。不用点。";
  }
  const card = `<span class="here">Context Guard <i class="caret">▾</i></span>`;
  const stage = `<div class="stage"><div class="map"><div class="root"><b>Context Guard</b><span>人与 Agent 共用的项目记忆，活在仓库里</span></div><div class="kids"><div class="mod"><b>工作台</b><span>人在浏览器看图、改记忆、确认提议</span></div><div class="mod"><b>冷启动</b><span>skill 怎么进机器、第一次怎么建图</span></div><div class="mod"><b>底层文件系统</b><span>会话、坏例、任务怎么写、怎么跳</span></div><div class="mod"><b>hook</b><span>当前开发进程的生命周期提醒</span></div><div class="mod"><b>CI/CD</b><span>以后怎么自动验；夹具挂在这里</span></div></div></div><aside class="insp"><div class="who"><h2>Context Guard</h2><span class="st">已做未测</span><span class="sp"></span><span class="trash" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g class="lid"><rect x="9" y="3.2" width="6" height="1.7" rx=".7" fill="currentColor" stroke="none"/><path d="M4.5 7.1h15"/></g><g class="can"><path d="M7 7.1v12.3a1.7 1.7 0 0 0 1.7 1.7h6.6a1.7 1.7 0 0 0 1.7-1.7V7.1"/></g><g class="rib"><path d="M10 11.2v6"/><path d="M14 11.2v6"/></g></svg></span></div><p class="add-hint">要加模块或节点，去图上点 ＋。这里不放按钮。</p><div class="note"><span class="add">记忆 ＋</span><p>第一层由人锁定：工作台、冷启动、底层文件系统、hook、CI/CD。</p><p>SKILL.md 合同挂在根上。</p></div><div class="note"><span class="add">Idea ＋</span><p class="empty">还没有</p></div><div class="note"><span class="add">Bug ＋</span><p class="empty">还没有</p></div></aside></div>`;
  const shell = bar => `<div class="bar">${bar}</div>${stage}`;
  const L = [];
  const add = (id, name, bar) => L.push({id, name, html: shell(bar)});

  add("01", "现况粗框",
    `${card}<span class="sp"></span><div class="tools"><span class="box dir"><i></i><span>左右</span><span>上下</span></span><span class="box">关系</span><span class="box sq">🔑</span><span class="box">🐞 Bug (1)</span><span class="box sq">⚙</span></div>`);
  add("02", "细线字钮",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("03", "纯文字",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span class="bug">Bug <b>1</b></span><span>设置</span></div>`);
  add("04", "静音圆标",
    `${card}<span class="sp"></span><div class="tools"><span class="ico">↕</span><span class="ico">⇄</span><span class="ico">🔑</span><span class="ico bug">1</span><span class="ico">⚙</span></div>`);
  add("05", "浮岛",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>🔑</span><span>Bug 1</span><span>⚙</span></div>`);
  add("06", "左右两岛",
    `<div class="island">${card}</div><div class="island r"><span>上下</span><span>关系</span><span>🔑</span><span>Bug 1</span><span>⚙</span></div>`);
  add("07", "两行",
    `<div class="r1">项目</div><div class="r2">${card}<div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div></div>`);
  add("08", "路径",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("09", "刊头",
    `${card}<div class="tools"><span>上下</span><span>关系</span><span>🔑</span><span>Bug</span><span>⚙</span></div>`);
  add("10", "IDE",
    `<span class="dots"><i></i><i></i><i></i></span>${card}<div class="tools"><span>TB</span><span>Rel</span><span>Auth</span><span>Bug</span><span>⚙</span></div>`);
  add("11", "报纸报头",
    `<div class="kicker">Project memory · Thursday</div>${card}<div class="row"><span>上下</span><span>关系 · 授权 · Bug 1 · 设置</span></div>`);
  add("12", "深色墨条",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span class="bug">Bug 1</span><span>设置</span></div>`);
  add("13", "浅托盘",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>🔑</span><span>Bug 1</span><span>⚙</span></div>`);
  add("14", "左边色签",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("15", "分段一条",
    `${card}<span class="sp"></span><div class="seg"><span>上下</span><span>关系</span><span>授权</span><span class="on">Bug 1</span><span>设置</span></div>`);
  add("16", "瑞士留白",
    `${card}<span class="sp"></span><div class="tools"><span>LAYOUT</span><span>REL</span><span>KEY</span><span>BUG</span><span>SET</span></div>`);
  add("17", "和纸红印",
    `<span class="seal">守</span>${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>虫 1</span><span>设</span></div>`);
  add("18", "毛玻璃",
    `${card}<span class="sp"></span><div class="tools"><span>↕</span><span>⇄</span><span>🔑</span><span>1</span><span>⚙</span></div>`);
  add("19", "线圈本",
    `<div class="rings"><i></i><i></i></div>${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("20", "地图图例",
    `<span class="leg">LEGEND</span>${card}<span class="sp"></span><div class="tools"><span class="sym"><i></i>上下</span><span>关系</span><span>🔑</span><span>Bug 1</span><span>⚙</span></div>`);
  add("21", "印章题名",
    `<span class="chop">守</span>${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("22", "终端条",
    `${card}<span class="sp"></span><div class="tools"><span>--tb</span><span>rel</span><span>auth</span><span>bug:1</span><span>cfg</span></div>`);
  add("23", "大标题导航",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug</span><span>设置</span></div>`);
  add("24", "文件名居中",
    `<span class="side">☰</span>${card}<div class="tools"><span>↕</span><span>⇄</span><span>🔑</span><span>1</span><span>⚙</span></div>`);
  add("25", "无边框",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("26", "深色紧凑",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span class="bug">Bug 1</span><span>设置</span></div>`);
  add("27", "衬线刊头",
    `${card}<span class="sp"></span><div class="tools"><span>Layout</span><span>Edges</span><span>Key</span><span>Bugs</span><span>More</span></div>`);
  add("28", "图标带小字",
    `${card}<span class="sp"></span><div class="tools"><span class="ic"><b>↕</b><u>上下</u></span><span class="ic"><b>⇄</b><u>关系</u></span><span class="ic"><b>🔑</b><u>授权</u></span><span class="ic"><b>🐞</b><u>Bug</u></span><span class="ic"><b>⚙</b><u>设置</u></span></div>`);
  add("29", "单胶囊",
    `${card}<span class="sp"></span><div class="cap"><span>上下</span><span>关系</span><span>授权</span><span class="on">Bug 1</span><span>设置</span></div>`);
  add("30", "顶上一根黄线",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>🔑</span><span>Bug 1</span><span>⚙</span></div>`);
  add("31", "折角纸",
    `<span class="fold"></span>${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("32", "蓝图",
    `${card}<span class="sp"></span><div class="tools"><span>TB</span><span>REL</span><span>KEY</span><span>BUG</span><span>SET</span></div>`);
  add("33", "展签",
    `<div><div class="k">Node map</div>${card}</div><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("34", "票根",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span></div><span class="sn">No. 0823</span>`);
  add("35", "中间跳转槽",
    `${card}<div class="jump">跳到模块…</div><div class="tools"><span>上下</span><span>关系</span><span>🔑</span><span>1</span><span>⚙</span></div>`);
  add("36", "状态当一句",
    `${card}<span class="sent">上下布局 · <span class="bad">1 个 Bug</span></span><div class="tools"><span>关系</span><span>授权</span><span>设置</span></div>`);
  add("37", "底下贴页签",
    `<div class="r1">${card}<span class="sp"></span><span>🔑</span><span>⚙</span></div><div class="tabs"><span>上下</span><span>关系</span><span class="on">Bug 1</span></div>`);
  add("38", "双细线古典",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("39", "软色片",
    `${card}<span class="sp"></span><div class="tools"><span class="chip">上下</span><span class="chip">关系</span><span class="chip">授权</span><span class="chip bug">Bug 1</span><span class="chip">设置</span></div>`);
  add("40", "几何小标",
    `<i class="mark"></i>${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("41", "罗盘布局",
    `<span class="comp">北<br>南</span>${card}<span class="sp"></span><div class="tools"><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("42", "微字大气",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("43", "巨大标题",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug</span><span>设置</span></div>`);
  add("44", "几乎空白",
    `${card}<span class="more">···</span>`);
  add("45", "左边书脊",
    `<span class="spine">CG</span>${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("46", "比例尺",
    `${card}<div class="rule"><span>左右</span><span class="on">上下</span></div><div class="tools"><span>关系</span><span>🔑</span><span>Bug 1</span><span>⚙</span></div>`);
  add("47", "手写题头",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("48", "淡彩分层",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("49", "工具收进菜单",
    `${card}<span class="sp"></span><div class="tools"><span class="menu">···</span></div>`);
  add("50", "一条金线",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);

  document.getElementById("g-scroll").innerHTML = L.map(v =>
    `<article class="g-item" id="v${v.id}"><div class="g-num">${v.id} · ${v.name}</div><aside class="g-mock g-chrome g-lay-${v.id}">${v.html}</aside></article>`
  ).join("");
}
async function boot(){
  if(window.__CG_GALLERY){
    bootDesignGallery();
    return;
  }
  const stored = readStoredUiLang();
  if(stored) uiLang = stored;
  applyStaticI18n();
  let WorkbenchSync;
  try { ({WorkbenchSync}=await import("./workbench-sync.mjs")); }
  catch(e){
    const notice=document.createElement("div"); notice.id="cg-sync"; notice.dataset.status="readonly";
    notice.textContent="只读预览：请运行 context-guard workbench --root <项目目录>，本页面不会保存地图。";
    notice.style.cssText="position:fixed;bottom:10px;left:10px;z-index:10000;background:white;padding:12px;border:1px solid";
    document.body.append(notice);
    await loadMapFromHttp();
    authUnlockAll();
    applyRelationDeepLink();
    renderAll(); fitView(); return;
  }
  workbenchSync=new WorkbenchSync({
    getRoot:()=>data,
    pending:()=>{ for(const id of ['nodes','links','currents']) document.getElementById(id)?.replaceChildren(); },
    apply:doc=>{ applyingServerMap=true; try{ applyMapDoc(doc); renderAll(); }finally{ applyingServerMap=false; } },
    setAccess:setWorkbenchAccess
  });
  const publishButton=document.getElementById("btn-publish-main");
  if(publishButton) publishButton.onclick=publishCloudMain;
  const connected=await workbenchSync.start();
  if(!connected){
    await loadMapFromHttp();
    if(!window.__CG_SERVER) authUnlockAll();
    applyingServerMap=true; renderAll(); applyingServerMap=false;
  }
  // A local server owns exactly one project. Switching demo repositories is preview-only.
  if(window.__CG_SERVER || window.__CG_CLOUD_READONLY){ document.getElementById("repo-menu").style.display="none"; }
  if(window.__CG_PREVIEW){
    closeOverlay();
    currentRepo().firstUseOpen = false;
  }
  const themeBanner = document.getElementById("theme-preview-banner");
  if(themeBanner && window.__CG_PREVIEW){
    themeBanner.textContent = "预览模块卡 #"+currentNodeTheme()+" · 还没写进默认工作台";
  }
  const phoneBanner = document.getElementById("phone-preview-banner");
  if(phoneBanner && window.__CG_PHONE_FORCE===false){
    phoneBanner.textContent = "电脑预览 · 强制宽屏布局";
  }
  syncThemePicks();
  if(window.__CG_PREVIEW || !window.__CG_SERVER) authUnlockAll();
  applyRelationDeepLink();
  renderAll();
  finishDrawerChrome();
  fitView();
  if(document.fonts && document.fonts.ready){
    document.fonts.ready.then(()=>{ syncChrome(); renderAll(); fitView(); }).catch(()=>{});
  }
  if(new URLSearchParams(location.search).has("settings")){
    const menu = document.getElementById("settings-menu");
    const btn = document.getElementById("btn-settings");
    if(menu) menu.classList.add("open");
    if(btn){ btn.classList.add("on"); btn.setAttribute("aria-expanded","true"); }
  }
}
const headerEl = document.querySelector("header.top");
if(window.ResizeObserver && headerEl){
  new ResizeObserver(()=>{ syncChrome(); if(typeof fitView==="function") fitView(); }).observe(headerEl);
}
finishDrawerChrome();
boot();
