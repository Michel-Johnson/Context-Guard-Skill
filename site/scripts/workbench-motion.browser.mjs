// 先安装仓库开发依赖并启动宣传页，再运行：
// node site/scripts/workbench-motion.browser.mjs http://127.0.0.1:4195/Context-Guard-Skill/
// 使用真实浏览器验证宿主/iframe 回执；不设依赖硬件的 FPS 通过阈值。
import assert from "node:assert/strict";
import { chromium } from "playwright";

if (!process.argv[2]) throw new Error("Provide the promotion site URL.");
const url = new URL(process.argv[2]);
url.searchParams.set("lang", "en");
url.hash = "workbench";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    window.tourEvents = [];
    addEventListener("message", event => {
      const frame = document.querySelector('[data-page="workbench"] iframe');
      if (frame && event.source === frame.contentWindow && event.data?.source === "cg-workbench-tour")
        window.tourEvents.push(event.data);
    });
  });
  await page.goto(url.href);
  const plane = page.locator('[data-page="workbench"] .tour-plane');
  const frame = plane.locator("iframe");
  assert.equal(await frame.getAttribute("sandbox"), "allow-scripts");
  await page.waitForFunction(() => {
    const plane = document.querySelector('[data-page="workbench"] .tour-plane');
    const stage = plane?.parentElement;
    return stage && new DOMMatrixReadOnly(getComputedStyle(plane).transform).a > stage.clientWidth / 1280 / 2 + .015;
  });
  await page.locator('[data-page="workbench"] .tour-play').click();
  const paused = await plane.evaluate(node => node.style.transform);
  await page.waitForTimeout(350);
  assert.equal(await plane.evaluate(node => node.style.transform), paused, "Paused camera must not drift");
  await page.locator('[data-page="workbench"] .tour-play').click();
  const completed = await page.evaluate(() => new Promise((resolve, reject) => {
    const frame = document.querySelector('[data-page="workbench"] iframe');
    const completed = new Set();
    const timer = setTimeout(() => finish(new Error("The six chapters did not complete within 90 seconds")), 90000);
    function finish(error) {
      clearTimeout(timer);
      removeEventListener("message", receive);
      if (error) reject(error);
      else resolve([...completed]);
    }
    function receive(event) {
      if (event.source !== frame.contentWindow || event.data?.source !== "cg-workbench-tour") return;
      if (event.data.type === "error") finish(new Error(event.data.scene + ": " + event.data.message));
      if (event.data.type === "step" && event.data.complete) {
        completed.add(event.data.scene.split(":")[0]);
        if (completed.size === 6) finish();
      }
    }
    addEventListener("message", receive);
  }));
  assert.deepEqual(completed.sort(), ["auth", "explore", "map", "memory", "proposals", "relations"]);
  const preparation = await page.evaluate(() => {
    const scenes = new Map();
    for (const event of window.tourEvents) {
      const state = scenes.get(event.scene) || { cameras: 0, prepared: false };
      if (event.type === "camera" && !state.prepared) state.cameras++;
      if (event.type === "prepared") state.prepared = true;
      scenes.set(event.scene, state);
    }
    return [...scenes.values()].filter(scene => scene.prepared).map(scene => scene.cameras);
  });
  assert.ok(preparation.length >= 6);
  assert.ok(preparation.every(count => count === 1), "Each chapter must publish only its final prepared camera");
  const select = async (label, chapter) => {
    await page.evaluate(() => { window.tourEvents = []; });
    const tab = page.getByRole("tab", { name: label, exact: true });
    if (await tab.getAttribute("aria-selected") === "true")
      await page.locator('[data-page="workbench"] .tour-replay').click();
    else await tab.click();
    await page.waitForFunction(chapter => window.tourEvents.some(event =>
      event.type === "prepared" && event.scene.startsWith(chapter + ":")), chapter);
    await page.locator('[data-page="workbench"] .tour-play').click();
  };
  // 从其他章进入记忆页，暂停首帧，再手动切关系页；地图及产品内层视角不能硬重置。
  await select("Project map", "explore");
  await select("Memory & ideas", "memory");
  const inner = await (await frame.elementHandle()).contentFrame();
  await inner.evaluate(() => {
    window.chapterState = { data, selectedId, viewRootId, view: { ...view } };
  });
  await select("Relationships", "relations");
  const continuity = await inner.evaluate(() => ({
    data: window.chapterState.data === data,
    selection: window.chapterState.selectedId === selectedId,
    root: window.chapterState.viewRootId === viewRootId,
    view: JSON.stringify(window.chapterState.view) === JSON.stringify(view),
  }));
  assert.ok(Object.values(continuity).every(Boolean), "Memory → relationships must retain the live map and inner viewport: " + JSON.stringify(continuity));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".site.reduce-motion").waitFor();
  await page.waitForTimeout(100);
  const reduced = await plane.evaluate(node => node.style.transform);
  await page.waitForTimeout(350);
  assert.equal(await plane.evaluate(node => node.style.transform), reduced, "Reduced motion must remain still");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ completed, preparation, continuity, paused: true, reduced: true, errors }));
} finally {
  await browser.close();
}
