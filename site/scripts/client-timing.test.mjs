import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { clients, getClients, installCommand, invocationPrompt } from "../src/clients.ts";
import { conversationTiming, typedText, getUsages } from "../src/app-usage.ts";
import { getFirstUseStory } from "../src/first-use-story.ts";

test("四客户端安装映射有效，Codex的两个入口使用同一平台", () => {
  assert.deepEqual(clients.map(c => c.label), ["Codex App", "Codex CLI", "Cursor", "Claude Code"]);
  for (const client of clients) assert.match(installCommand(client.id), /--platform (codex|cursor|claude)$/);
  assert.equal(installCommand("codex-app"), installCommand("codex-cli"));
});

test("中英文四客户端在发送前打完命令和正文，反馈在章末前完整", () => {
  for (const language of ["zh", "en"]) for (const client of getClients(language)) {
    for (const usage of [...getUsages(language), ...getFirstUseStory(language).turns]) {
      const t = conversationTiming(usage, client);
      const at = t.sent - 1;
      const text = usage.continuation ? typedText(usage.request, at, t.typing, t.textInterval)
        : typedText(client.invocation, at, t.command, t.commandInterval)
          + typedText(invocationPrompt(client, usage.request).slice(client.invocation.length), at, t.typing, t.textInterval);
      assert.equal(text, usage.continuation ? usage.request : invocationPrompt(client, usage.request), client.id);
      assert.equal(typedText(usage.response, t.result, t.response, t.textInterval), usage.response);
      assert.equal(t.replyCameraAt - t.inputComplete, 1000, client.id);
      assert.ok(t.sent < t.replyCameraAt && t.replyCameraAt < t.reading, client.id);
      assert.ok(t.end - t.result >= 600);
      assert.ok(t.selected < t.typing && t.typing < t.sent && t.sent < t.response && t.result < t.end);
    }
  }
});

test("英文流程完整翻译并在示例用户确认后设置英语，不改变中文剧本", () => {
  const english = getFirstUseStory("en");
  const chinese = getFirstUseStory("zh");
  assert.doesNotMatch(JSON.stringify([getClients("en"), getUsages("en"), english]), /\p{Script=Han}/u);
  assert.match(english.turns[0].response, /English or Chinese/);
  assert.equal(english.turns[1].request, "Use English for the records.");
  assert.match(english.turns[1].activity[0].text, /--language en$/);
  assert.match(chinese.turns[1].activity[0].text, /--language zh$/);
  assert.equal(chinese.turns[1].request, "用中文记录。");
  assert.deepEqual(english.chapters.map(c => c.id), chinese.chapters.map(c => c.id));
});

test("Cursor在客户端窗口内接续工作台，其他入口仍可打开独立工作台页", () => {
  const story = getFirstUseStory("zh");
  assert.deepEqual(story.chapters.map(chapter => chapter.id), ["invoke", "language", "prepare"]);
  assert.ok(story.chapters.every(chapter => chapter.kind === "app"));
  const journeySource = readFileSync(new URL("../src/FirstUseJourney.tsx", import.meta.url), "utf8");
  assert.match(journeySource, /const \[cursorWorkbench, setCursorWorkbench\] = useState\(false\)/);
  assert.match(journeySource, /client\.id === "cursor"[\s\S]*setCursorWorkbench\(true\)[\s\S]*return/);
  assert.match(journeySource, /workspace=\{workspace\}/);
  assert.match(journeySource, /<TourStage chapter="map"/);
  assert.match(journeySource, /setCursorWorkbench\(false\)/);
  assert.match(journeySource, /onOpenDemo\("map"\)/);
  assert.match(journeySource, /state\.position\.index === chapters\.length - 1\)\s*openWorkbench\(\)/);
  assert.doesNotMatch(journeySource, /client-demo-progress/);
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /const pageIds = \["home", "workbench", "clients", "memory", "debug", "install"\]/);
  assert.ok(appSource.indexOf('<Page id="workbench"') < appSource.indexOf('<Page id="clients"'));
  assert.ok(appSource.indexOf('href="#workbench" aria-current') < appSource.indexOf('href="#clients" aria-current'));
  assert.match(appSource, /className="hero-demo-link" href="#workbench"/);
  assert.match(appSource, /goToPage\(chapter === "debug" \? "debug" : "workbench"\)/);
  assert.doesNotMatch(appSource, /page-position/);
});

test("首页使用真实双语工作台宣传图并移除重复辅助项", () => {
  const visualSource = readFileSync(new URL("../src/HeroWorkbenchVisual.tsx", import.meta.url), "utf8");
  assert.match(visualSource, /sourceWidth = 1440/);
  assert.match(visualSource, /sourceHeight = 900/);
  assert.match(visualSource, /workbench-en\.html/);
  assert.match(visualSource, /workbench\.html/);
  assert.match(visualSource, /\?embedded=1&phone=0&hero=1/);
  assert.match(visualSource, /type: "scene"[\s\S]*chapter: "map"/);
  assert.match(visualSource, /IntersectionObserver/);
  const prepareSource = readFileSync(new URL("./prepare-workbench.mjs", import.meta.url), "utf8");
  assert.match(prepareSource, /cg-embedded/);
  assert.match(prepareSource, /cg-embedded \.phone-preview-banner\{display:none!important\}/);
  const workbenchSource = readFileSync(new URL("../src/Workbench.tsx", import.meta.url), "utf8");
  assert.match(workbenchSource, /matchMedia\("\(max-width: 820px\)"\)/);
  assert.match(workbenchSource, /embedded=1&phone=\$\{phoneMode \? 1 : 0\}/);

  const navigationSource = readFileSync(new URL("../src/UsageNavigation.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(navigationSource, /client-precondition|使用前提/);
});

test("工作台和客户端镜头按最高倍率预栅格化，缩放过程不放大低清画面", () => {
  const stageSource = readFileSync(new URL("../src/stage.css", import.meta.url), "utf8");
  const planeRule = stageSource.match(/\.tour-plane\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(planeRule, /will-change\s*:\s*transform/);
  assert.doesNotMatch(planeRule, /transition/);

  const workbenchSource = readFileSync(new URL("../src/Workbench.tsx", import.meta.url), "utf8");
  assert.match(workbenchSource, /const deviceScale = window\.devicePixelRatio \|\| 1/);
  assert.match(workbenchSource, /Math\.round\(x \* deviceScale\) \/ deviceScale/);
  assert.match(workbenchSource, /Math\.round\(y \* deviceScale\) \/ deviceScale/);
  assert.match(workbenchSource, /const rasterScale = Math\.max\(base, width < 600 \? 1 : 1\.12\)/);
  assert.match(workbenchSource, /node\.style\.zoom = String\(rasterScale\)/);
  assert.match(workbenchSource, /pose\.scale \/ rasterScale/);
  assert.doesNotMatch(workbenchSource, /bakedScale|cameraTimer/);
  assert.doesNotMatch(workbenchSource, /requestAnimationFrame\(animate\)/);

  const viewportSource = readFileSync(new URL("../src/NativeViewport.tsx", import.meta.url), "utf8");
  assert.match(viewportSource, /rasterizedCamera\(pose\)/);
  assert.match(viewportSource, /zoom: nativeRasterScale/);
});

test("工作台六个章节完成后自动顺序循环，减少动态时不自动切换", () => {
  const workbenchSource = readFileSync(new URL("../src/Workbench.tsx", import.meta.url), "utf8");
  assert.match(workbenchSource, /const advanceChapter = useCallback\(\(\) => \{/);
  assert.match(workbenchSource, /if \(reduced \|\| !completionEnabled\.current\) return/);
  assert.match(workbenchSource, /completionEnabled\.current = false/);
  assert.match(workbenchSource, /chapters\[\(current \+ 1\) % chapters\.length\]/);
  assert.match(workbenchSource, /if \(chapter === selected\) return/);
  assert.match(workbenchSource, /onClick=\{\(\) => selectChapter\(item\.id\)\}/);
  assert.match(workbenchSource, /onComplete=\{advanceChapter\}/);
  assert.match(workbenchSource, /onPrepared=\{\(\) => \{ completionEnabled\.current = true; \}\}/);
  assert.match(workbenchSource, /\(controlled\?\.onComplete \?\? onCompleteRef\.current\)\?\.\(\)/);

  const tourSource = readFileSync(new URL("../src/workbench-tour.js", import.meta.url), "utf8");
  assert.match(tourSource, /if \(document\.querySelector\("#nav-crumbs a"\)\) await click\("#nav-crumbs a", true\)/);
  assert.match(tourSource, /send\("prepared"\);\s*send\("step", \{ step: first, complete: false \}\)/);
});

test("文字逐字增长，不产生半个Unicode字符", () => {
  const text = "A中文😀B";
  for (let i = 0; i <= 5; i++) assert.equal(typedText(text, i * 24, 0), Array.from(text).slice(0, i).join(""));
});
