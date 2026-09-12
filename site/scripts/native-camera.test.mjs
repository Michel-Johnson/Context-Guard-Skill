import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { advanceCamera, cameraSettled, frameCamera, nativeHeight, nativeRasterScale, rasterizedCamera, stillCamera } from "../src/native-camera.ts";
import { workbenchCamera, settledWorkbenchCamera } from "../src/workbench-camera.ts";

test("工作台可见目标不触发重复缩放，字号和控件尺寸不改变组内倍率", () => {
  const initial = workbenchCamera(1024, 608, null);
  assert.equal(workbenchCamera(1024, 608, { x: 200, y: 200, width: 300, height: 100 }, initial), initial);
  const edge = { x: 1100, y: 80, width: 170, height: 40 };
  const focused = workbenchCamera(1024, 608, edge, initial);
  assert.ok(focused.scale > initial.scale && focused.scale <= initial.scale * 1.25);
  const next = workbenchCamera(1024, 608, { ...edge, y: 160, height: 80 }, focused);
  assert.equal(next.scale, focused.scale);
  assert.deepEqual(workbenchCamera(1024, 608, null, next), initial);
});

test("工作台运动保留亚像素精度，停稳后才对齐不同 DPR", () => {
  const target = { x: -40.31, y: -10.72, scale: 1.035 };
  const state = advanceCamera(stillCamera({ x: 0, y: 0, scale: .8 }), target, 16, 12);
  assert.notEqual(state.pose.x, Math.round(state.pose.x));
  for (const ratio of [1, 1.25, 2, 3]) {
    const aligned = settledWorkbenchCamera(target, ratio);
    assert.ok(Math.abs(aligned.x - target.x) <= .5 / ratio);
    assert.ok(Math.abs(aligned.y - target.y) <= .5 / ratio);
    assert.equal(aligned.scale, target.scale);
  }
});

test("工作台横竖窄屏的目标镜头保持有限值和源画布边界", () => {
  for (const [width, height] of [[280, 220], [600, 370], [1024, 608], [300, 620]]) {
    for (const focus of [null, { x: 900, y: 50, width: 350, height: 650 }, { x: 1180, y: 600, width: 80, height: 100 }]) {
      const pose = workbenchCamera(width, height, focus);
      assert.ok(Object.values(pose).every(Number.isFinite));
      assert.ok(pose.scale >= Math.min(width / 1280, height / 760));
      if (1280 * pose.scale >= width) assert.ok(pose.x <= 0 && pose.x >= width - 1280 * pose.scale);
      if (760 * pose.scale >= height) assert.ok(pose.y <= 0 && pose.y >= height - 760 * pose.scale);
    }
  }
});

test("客户端镜头始终在稳定的双倍栅格上缩小", () => {
  assert.equal(nativeRasterScale, 2);
  for (const pose of [
    frameCamera(930, 580, 1280, null),
    frameCamera(930, 580, 1280, { x: 800, y: 500, width: 440, height: 180 }),
  ]) {
    const raster = rasterizedCamera(pose);
    assert.ok(raster.scale < 1);
    assert.equal(raster.x * nativeRasterScale, pose.x);
    assert.equal(raster.y * nativeRasterScale, pose.y);
  }
});

const input = { x: 828, y: 650, width: 440, height: 118 };
const reply = { x: 832, y: 90, width: 432, height: 240 };
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const progress = (state, target, ms, step = 16, frequency = 10) => {
  for (let elapsed = 0; elapsed < ms; elapsed += step) state = advanceCamera(state, target, Math.min(step, ms - elapsed), frequency);
  return state;
};

test("客户端保持 800px 原高；取景只有等比缩放，回复增长不改变倍率", () => {
  assert.equal(nativeHeight, 800);
  const css = readFileSync(new URL("../src/native-client.css", import.meta.url), "utf8");
  const viewport = readFileSync(new URL("../src/NativeViewport.tsx", import.meta.url), "utf8");
  assert.match(css, /\.native-client-frame\s*\{[^}]*height: 800px;/);
  assert.doesNotMatch(css + viewport, /--native-window-height/);
  assert.match(viewport, /width: sourceWidth, height: nativeHeight/);
  assert.match(viewport, /elapsed < timing\.replyCameraAt/);
  assert.match(viewport, /timing\.replyCameraFrequency/);
  for (const width of [280, 320, 620, 930, 1280]) {
    const height = Math.min(700, Math.max(350, width * .625));
    for (const { sourceWidth, pane } of [
      { sourceWidth: 640 },
      { sourceWidth: 1280 },
      { sourceWidth: 1280, pane: { x: 376, width: 768 } },
      { sourceWidth: 1040, pane: { x: 26, width: 988 } },
    ]) {
      const wide = frameCamera(width, height, sourceWidth, null);
      assert.ok(sourceWidth * wide.scale <= width + .01);
      assert.ok(nativeHeight * wide.scale <= height + .01);
      near((sourceWidth * wide.scale) / (nativeHeight * wide.scale), sourceWidth / 800);
      const typing = frameCamera(width, height, sourceWidth, input, pane);
      if (pane) {
        assert.ok(typing.x + pane.x * typing.scale >= -.01, "会话左侧不能被取景裁掉");
        assert.ok(typing.x + (pane.x + pane.width) * typing.scale <= width + .01, "会话右侧不能被取景裁掉");
      }
      for (const lines of [30, 240, 500]) {
        const reading = frameCamera(width, height, sourceWidth, { ...reply, height: lines }, pane);
        assert.equal(reading.scale, typing.scale);
        assert.equal(reading.x, typing.x);
      }
    }
  }
});

test("输入完成后停一秒，再用较慢速度移向回复", () => {
  const typing = frameCamera(930, 580, 1280, input);
  const reading = frameCamera(930, 580, 1280, reply);
  const start = stillCamera(typing);
  const regular = progress(start, reading, 700);
  const slower = progress(start, reading, 700, 16, 6);
  assert.ok(Math.abs(slower.pose.y - reading.y) > Math.abs(regular.pose.y - reading.y));
  assert.ok(cameraSettled(progress(slower, reading, 3000, 16, 6), reading));
});

test("发送后连续向上取景，无瞬移或越过目标", () => {
  const typing = frameCamera(930, 580, 1280, input);
  const reading = frameCamera(930, 580, 1280, reply);
  let state = stillCamera(typing);
  assert.ok(reading.y > typing.y);
  for (let i = 0; i < 120; i++) {
    const next = advanceCamera(state, reading, 1000 / 60);
    assert.ok(next.pose.y >= state.pose.y - .001);
    assert.ok(next.pose.y <= reading.y + .001);
    assert.ok(next.pose.y - state.pose.y < 40);
    assert.equal(next.pose.scale, typing.scale);
    state = next;
  }
  assert.ok(cameraSettled(state, reading));
});

test("换章归零与暂停不改变镜头；改变方向保留位置及速度", () => {
  const typing = frameCamera(930, 580, 1280, input);
  const reading = frameCamera(930, 580, 1280, reply);
  const moving = progress(stillCamera(typing), reading, 220);
  const boundary = advanceCamera(moving, typing, 0);
  assert.deepEqual(boundary, moving);
  for (let i = 0; i < 60; i++) assert.deepEqual(advanceCamera(boundary, typing, 0), moving);
  const resumed = advanceCamera(boundary, typing, 16);
  assert.ok(Math.abs(resumed.pose.y - moving.pose.y) < 35);
  assert.ok(cameraSettled(progress(resumed, typing, 2400), typing));
});

test("30/60/120Hz 取景轨迹按实际时间一致", () => {
  const target = frameCamera(930, 580, 1280, reply);
  const start = stillCamera(frameCamera(930, 580, 1280, input));
  const reference = progress(start, target, 400, 1000 / 120);
  for (const step of [1000 / 30, 1000 / 60, 80]) {
    const sampled = progress(start, target, 400, step);
    for (const key of ["x", "y", "scale"]) near(sampled.pose[key], reference.pose[key]);
  }
});

test("回复变长或滚动时接着跟随，停稳不漂移", () => {
  const short = frameCamera(930, 580, 1280, reply);
  const long = frameCamera(930, 580, 1280, { ...reply, height: 530 });
  const start = stillCamera(short);
  assert.deepEqual(advanceCamera(start, long, 0), start);
  const end = progress(start, long, 2400);
  assert.ok(cameraSettled(end, long));
  assert.deepEqual(progress(end, long, 5000), stillCamera(long));
});

test("全窗切换及反向切换从当前视角出发", () => {
  const focus = frameCamera(930, 580, 1280, input);
  const wide = frameCamera(930, 580, 1280, null);
  const middle = progress(stillCamera(focus), wide, 240);
  assert.ok(middle.pose.scale < focus.scale && middle.pose.scale > wide.scale);
  assert.deepEqual(advanceCamera(middle, focus, 0), middle);
  assert.ok(cameraSettled(progress(middle, focus, 2400), focus));
});
