import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

// 复用产品 HTML，不复制设计、不重写按钮行为。发布时自动更新到同一提交的工作台。
const sourceUrl = new URL("../../prototype/workbench.html", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const styles = await readFile(new URL("../../prototype/workbench.css", import.meta.url), "utf8");
const fixtures = await readFile(new URL("../../prototype/workbench-fixtures.js", import.meta.url), "utf8");
const application = await readFile(new URL("../../prototype/workbench-app.js", import.meta.url), "utf8");
const mapMarker = "const CONTEXT_GUARD_MAP = ";
const markerStart = fixtures.indexOf(mapMarker);
const mapStart = markerStart + mapMarker.length;
const mapEnd = fixtures.indexOf("const CG_OWNS = ", mapStart);
if (markerStart < 0 || mapEnd < mapStart)
  throw new Error("产品地图声明已改变，请重新核对演示接入。");
const map = JSON.parse(fixtures.slice(mapStart, mapEnd).trim().replace(/;$/, ""));
const runtime = await readFile(
  new URL("../src/workbench-tour.js", import.meta.url),
  "utf8",
);
const english = JSON.parse(await readFile(new URL("../src/locales/en.json", import.meta.url), "utf8"));
const notesMarker = "const CONTEXT_GUARD_NOTES = `";
const notesMarkerStart = fixtures.indexOf(notesMarker);
const notesStart = notesMarkerStart + notesMarker.length;
const notesEnd = fixtures.indexOf("`;", notesStart);
if (notesMarkerStart < 0 || notesEnd < notesStart)
  throw new Error("产品架构说明已改变，请重新核对英文示例。");
// JS 模板字符串会将 CRLF 规范为 LF，翻译键也必须保持一致。
const originalNotes = fixtures.slice(notesStart, notesEnd).replace(/\r\n?/g, "\n");
english[originalNotes] = `# Context Guard architecture notes (prepared demo; no agent called)

This repository is the example. Agree on the first layer before going deeper. Development units are concrete functions and files in the workbench.

## First layer
Skill contract · Workbench · Skill files · CLI and hooks · Repository mapping · Session scope and proposals · Legacy test hub

## Workbench (prototype/workbench.html)
- renderNode draws module cards with a title and one-line purpose.
- visibleChildren shows one layer at a time. Work nodes have at most two branches; larger branches become modules. Curved lines join parents to children.
- The inspector supports inline editing and Memory, Idea and Bug records.
- Left–right and top–down layouts apply inside modules; the root hides this switch.
- Repository switching keeps map_bootstrap per project.
- The first-use overlay shows a prepared analysis, without calling an agent.
- .codex/context/map.json stores the live map and node memories; localStorage is only a cache. Proposals recurse into modules, keeping internal work units in an inbox.

## Mapping a repository
- Offer several first-layer groupings, then agree before discussing later layers.
- Use names and purposes that are immediately clear.
- Follow README, package boundaries, docs and runtime entry points, rather than making one card per file.
- Produce architecture.md notes and a live map.json with modules, memories and relationships.
- Avoid empty umbrella cards or flattening every file into one module.
- Later sessions open the existing map unless the user requests a fresh analysis.
`;

function assertTranslated(value) {
  if (typeof value === "string" && /\p{Script=Han}/u.test(value) && !english[value])
    throw new Error("Missing English demo translation: " + value);
  if (Array.isArray(value)) value.forEach(assertTranslated);
  else if (value && typeof value === "object") Object.values(value).forEach(assertTranslated);
}
assertTranslated(map);
const fixture = JSON.stringify(map).replace(/</g, "\\u003c");
const digest = createHash("sha256").update([source, styles, fixtures, application].join("\n")).digest("hex");
const fonts = [
  ["Comic Neue", "normal", 400, "comic-neue-400.ttf"],
  ["Comic Neue", "normal", 700, "comic-neue-700.ttf"],
  ["Libre Baskerville", "italic", 400, "libre-baskerville-italic.ttf"],
  ["Libre Baskerville", "normal", 400, "libre-baskerville-400.ttf"],
];
const fontCss = (
  await Promise.all(
    fonts.map(async ([family, style, weight, file]) => {
      const bytes = await readFile(
        new URL(`../assets/fonts/${file}`, import.meta.url),
      );
      return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url(data:font/ttf;base64,${bytes.toString("base64")}) format('truetype');}`;
    }),
  )
).join("\n");
const isolation = (language) => `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
<script>
// 页面运行在无同源权限的 iframe 中。只提供产品格式的内置示例，不读取实际项目。
window.__CG_TOUR_LANG__ = ${JSON.stringify(language)};
if (new URLSearchParams(location.search).has("embedded")) document.documentElement.classList.add("cg-embedded");
window.__CG_TOUR_EN__ = ${JSON.stringify(language === "en" ? english : {}).replace(/</g, "\\u003c")};
window.__CG_TOUR_TEXT__ = (text) => window.__CG_TOUR_EN__[text] || text;
window.__CG_TOUR_LOCALIZE__ = function(value) {
  if(typeof value === 'string') return window.__CG_TOUR_TEXT__(value);
  if(Array.isArray(value)) return value.map(window.__CG_TOUR_LOCALIZE__);
  if(value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,window.__CG_TOUR_LOCALIZE__(item)]));
  return value;
};
window.__CG_TOUR_MAP__ = ${fixture};
window.fetch = async function(input) {
  const path = String(input);
  if (path.endsWith('/preferences.json')) return new Response(JSON.stringify({record_language:window.__CG_TOUR_LANG__,display_language:window.__CG_TOUR_LANG__}));
  if (path.endsWith('/map.json')) return new Response(JSON.stringify({v:1,project:'context-guard',bootstrap:'ready',root:window.__CG_TOUR_MAP__}));
  if (path.endsWith('/l1-candidates.json')) return new Response(JSON.stringify({lenses:[{id:'surfaces',title:window.__CG_TOUR_TEXT__('按开工面切'),why:window.__CG_TOUR_TEXT__('来自工作台内置 Context Guard 地图的模块，仅作候选文件示例。'),candidates:window.__CG_TOUR_MAP__.children.map(n=>({id:n.id,title:n.title,purpose:n.purpose,owns:n.owns}))}]}));
  throw new Error(window.__CG_TOUR_LANG__ === 'en' ? 'This demo cannot access the network or local projects.' : '宣传演示不允许联网或访问真实项目');
};
Object.defineProperty(window,'showDirectoryPicker',{value:undefined});
Object.defineProperty(window,'showOpenFilePicker',{value:undefined});
const nativeInputClick=HTMLInputElement.prototype.click;
HTMLInputElement.prototype.click=function(){if(this.type!=='file') nativeInputClick.call(this);};
for(const event of ['drop','paste']) document.addEventListener(event,e=>{
  const transfer=e.dataTransfer||e.clipboardData;
  if(transfer && ([...transfer.files].length || [...transfer.items].some(x=>x.kind==='file'))){e.preventDefault();e.stopImmediatePropagation();}
},true);
</script>`;
const charset = /<meta charset=["']utf-8["']>/i;
const bootCall = /\bboot\(\);(?=\s*<\/script>\s*<\/body>)/;
const applicationBoot = /\bboot\(\);\s*$/;
const syncImport = 'try { ({WorkbenchSync}=await import("./workbench-sync.mjs")); attachmentModule=await import("./attachments.mjs"); }';
const styleLink = '<link rel="stylesheet" href="./workbench.css?v=rel-icon">';
const fixtureScript = '<script src="./workbench-fixtures.js?v=rel-icon"></script>';
const applicationScript = '<script src="./workbench-app.js?v=rel-icon"></script>';
if (!charset.test(source) || !source.includes("</body>") || !applicationBoot.test(application) || !application.includes(syncImport)
  || !source.includes(styleLink) || !source.includes(fixtureScript) || !source.includes(applicationScript))
  throw new Error("产品 HTML 结构已改变，请重新核对演示接入。");
const prepareData = `
// 只配置宣传示例数据，保留产品控件和行为；不展示其他项目的内置样例。
window.__CG_TOUR_MAP__ = window.__CG_TOUR_LOCALIZE__(clone(CONTEXT_GUARD_MAP));
// adoptTree 不覆盖根节点 purpose；先翻译初始示例，避免语言残留。
Object.assign(data, window.__CG_TOUR_LOCALIZE__(data));
uiLang = window.__CG_TOUR_LANG__;
for (const id of Object.keys(catalog)) {
  if (id !== 'context-guard') delete catalog[id];
  else catalog[id] = window.__CG_TOUR_LOCALIZE__(catalog[id]);
}
`;
function buildWorkbench(language) {
  let html = source
  .replace(/<link[^>]*https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, "")
  .replace(styleLink, `<style>${styles}</style>`)
  .replace(fixtureScript, `<script>${fixtures}</script>`)
  .replace(applicationScript, `<script>${application}</script>`)
  .replace(charset, (meta) => `${meta}\n${isolation(language)}<style>${fontCss}\n#cg-sync{display:none!important}html.cg-embedded .phone-preview-banner{display:none!important}</style>`)
  // GitHub Pages 演示始终使用内置数据；避免尝试加载不存在且被 CSP 禁止的本地同步模块。
  .replace(syncImport, 'try { throw new Error("static promotion preview"); }')
  // 仅记录产品已有初始化的返回值，导览不能再执行第二次 boot。
  .replace(bootCall, prepareData + "window.__CG_TOUR_BOOT__ = boot();")
  .replace("</body>", () => `<script>\n${runtime}\n</script>\n</body>`);
  if (language === "en") html = html
    .replace('<html lang="zh-CN">', '<html lang="en">')
    .replace('title="界面语言 / UI language"', 'title="UI language"')
    .replace('text:"绿场项目：只留下根节点。有了真实模块再往下长。"', 'text:' + JSON.stringify(english["绿场项目：只留下根节点。有了真实模块再往下长。"]));
  return html;
}
const output = new URL("../public/generated/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL("workbench.html", output), buildWorkbench("zh"));
await writeFile(new URL("workbench-en.html", output), buildWorkbench("en"));
const licenses = await Promise.all(
  ["comic-neue-OFL.txt", "libre-baskerville-OFL.txt"].map((file) =>
    readFile(new URL(`../assets/fonts/${file}`, import.meta.url), "utf8"),
  ),
);
await writeFile(new URL("font-licenses.txt", output), licenses.join("\n\n"));
await writeFile(
  new URL("source.json", output),
  JSON.stringify(
    {
      source: "prototype/workbench.html + workbench.css + workbench-fixtures.js + workbench-app.js",
      sha256: digest,
      changes: [
        "隔离真实 I/O，注入内置示例文件响应",
        "原工作台字体改为本地内嵌，保留字体与许可",
        "保留产品布局、CSS 和交互脚本；附加可暂停的光标、输入与镜头导览",
        "仅将原 boot 调用返回值交给导览，避免重复初始化",
        "复用原生英文界面，翻译 Context Guard 预设数据；宣传示例只保留当前项目",
        "英文产物翻译一条原生空项目记忆；正式产品源码未修改",
        "静态宣传页直接进入只读内置数据，不请求仅供本地工作台使用的同步模块",
      ],
    },
    null,
    2,
  ),
);
console.log(`Prepared actual workbench · source SHA256 ${digest}`);
