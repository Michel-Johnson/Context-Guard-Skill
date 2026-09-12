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
      if (event.data.type === "error") finish(new Error(event.data.message));
      if (event.data.type === "step" && event.data.complete) {
        completed.add(event.data.scene.split(":")[0]);
        if (completed.size === 6) finish();
      }
    }
    addEventListener("message", receive);
  }));
  assert.deepEqual(completed.sort(), ["auth", "explore", "map", "memory", "proposals", "relations"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".site.reduce-motion").waitFor();
  await page.waitForTimeout(100);
  const reduced = await plane.evaluate(node => node.style.transform);
  await page.waitForTimeout(350);
  assert.equal(await plane.evaluate(node => node.style.transform), reduced, "Reduced motion must remain still");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ completed, paused: true, reduced: true, errors }));
} finally {
  await browser.close();
}
