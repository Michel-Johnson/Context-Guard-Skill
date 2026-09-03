import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useMotionValueEvent, type MotionValue } from "motion/react";
import { usageTiming, type ConversationTiming } from "./app-usage";
import { advanceCamera, cameraSettled, frameCamera, nativeHeight, stillCamera, type Box, type CameraMotion } from "./native-camera";

export function NativeViewport({ children, clock, full, reduced = false, sourceWidth = 1280, focusPane, timing = usageTiming, turnKey = "" }: {
  children: ReactNode;
  clock: MotionValue<number>;
  full: boolean;
  reduced?: boolean;
  sourceWidth?: number;
  focusPane?: { x: number; width: number };
  timing?: ConversationTiming;
  turnKey?: string;
}) {
  const [width, setWidth] = useState(900);
  const height = Math.min(700, Math.max(width < 600 ? 220 : 350, width * .625));
  const viewport = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const boxes = useRef<{ composer: Box | null; reply: Box | null }>({ composer: null, reply: null });
  const camera = useRef<CameraMotion | null>(null);
  const previousClock = useRef(clock.get());
  const entered = useRef(false);
  const lastPaint = useRef("");
  const manual = useRef(false);

  function measure() {
    const frame = plane.current;
    const surface = viewport.current;
    if (!frame || !surface) return;
    if (surface.clientWidth) setWidth(surface.clientWidth);
    const origin = frame.getBoundingClientRect();
    const scale = origin.width / sourceWidth;
    if (!scale) return;
    const read = (selector: string): Box | null => {
      const element = frame.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: (rect.left - origin.left) / scale, y: (rect.top - origin.top) / scale,
        width: rect.width / scale, height: rect.height / scale };
    };
    const scroll = read(".native-chat-content");
    const reply = read("[data-current-turn]");
    // 聊天会真实滚动，只跟随滚动窗内可见的新一轮；不追逐已经滚出窗口的内容。
    const top = Math.max(reply?.y ?? 0, scroll?.y ?? 0);
    const bottom = Math.min((reply?.y ?? 0) + (reply?.height ?? 0), (scroll?.y ?? 0) + (scroll?.height ?? 0));
    boxes.current = {
      composer: read(".native-composer"),
      reply: reply && scroll && bottom > top ? { ...reply, y: top, height: bottom - top } : null,
    };
  }

  function frameFor(focus: Box | null) {
    const pose = frameCamera(width, height, sourceWidth, focus, focusPane);
    const ratio = window.devicePixelRatio || 1;
    // 仅对目标做像素对齐；不能在“移动/停稳”之间切换取整规则，否则另一轴也会轻晃。
    return { ...pose, x: Math.round(pose.x * ratio) / ratio, y: Math.round(pose.y * ratio) / ratio };
  }

  function targetFor(elapsed: number) {
    if (elapsed >= timing.cameraStart) entered.current = true;
    const focus = full || !entered.current ? null
      : elapsed < timing.replyCameraAt ? boxes.current.composer : boxes.current.reply ?? boxes.current.composer;
    return frameFor(focus);
  }

  function paint(elapsed: number, delta: number) {
    const target = targetFor(elapsed);
    const previous = camera.current ?? stillCamera(frameFor(null));
    const frequency = !full && elapsed >= timing.replyCameraAt ? timing.replyCameraFrequency : timing.cameraFrequency;
    const next = reduced ? stillCamera(target) : advanceCamera(previous, target, delta, frequency);
    camera.current = next;
    const settled = cameraSettled(next, target);
    // 停稳后吸附到目标，避免微小尾差持续触发布局/文字重绘。
    const pose = settled ? target : next.pose;
    const ratio = window.devicePixelRatio || 1;
    const x = Math.round(pose.x * ratio) / ratio;
    const y = Math.round(pose.y * ratio) / ratio;
    const paint = `${x}:${y}:${pose.scale}`;
    if (plane.current && paint !== lastPaint.current) {
      plane.current.style.zoom = String(pose.scale);
      plane.current.style.left = `${x / pose.scale}px`;
      plane.current.style.top = `${y / pose.scale}px`;
      plane.current.style.transform = "none";
      lastPaint.current = paint;
    }
    return settled;
  }

  const latest = useRef({ measure, paint });
  latest.current = { measure, paint };
  useMotionValueEvent(clock, "change", (elapsed) => {
    // 归零只改变目标，不改变当前位置；暂停和离屏时没有逻辑时间增量。
    const delta = Math.min(80, Math.max(0, elapsed - previousClock.current));
    previousClock.current = elapsed;
    if (!manual.current) paint(elapsed, delta);
  });

  useLayoutEffect(() => {
    const frame = plane.current;
    const surface = viewport.current;
    if (!frame || !surface) return;
    const update = () => { latest.current.measure(); latest.current.paint(clock.get(), 0); };
    const observer = new ResizeObserver(update);
    observer.observe(surface);
    for (const selector of [".native-composer", ".native-chat-flow", ".native-chat-content"]) {
      const element = frame.querySelector(selector);
      if (element) observer.observe(element);
    }
    const scroll = frame.querySelector(".native-chat-content");
    scroll?.addEventListener("scroll", update, { passive: true });
    update();
    return () => { observer.disconnect(); scroll?.removeEventListener("scroll", update); };
  }, [clock, sourceWidth, turnKey]);
  useLayoutEffect(() => { measure(); paint(clock.get(), 0); });

  // 视角切换独立于播放状态：故事继续时只接管镜头，故事已暂停时也能完成视角过渡。
  useEffect(() => {
    if (reduced || latest.current.paint(clock.get(), 0)) return;
    manual.current = true;
    let frame: number;
    let previous = performance.now();
    function tick(now: number) {
      const delta = document.hidden ? 0 : Math.min(64, now - previous);
      previous = now;
      if (latest.current.paint(clock.get(), delta)) manual.current = false;
      else frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); manual.current = false; };
  }, [full, width, height, sourceWidth, reduced, clock]);

  return <div className="native-viewport" ref={viewport} style={{ height }}>
    <div className="native-plane" ref={plane} style={{ width: sourceWidth, height: nativeHeight }}>
      {children}
    </div>
  </div>;
}
