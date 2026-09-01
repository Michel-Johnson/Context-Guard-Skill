import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useMotionValue, useMotionValueEvent } from "motion/react";
import { usageTiming } from "./app-usage";
import { observePlayback } from "./playback-probe";

// App 和连续故事共用时钟；React 只接收整秒状态，字符和镜头直接订阅时钟。
export function useUsagePlayer(reduced: boolean, {
  duration = usageTiming.end, enabled = true, selected = true, scene = "", onComplete, canAdvance,
  milestones = [usageTiming.command, usageTiming.sent, usageTiming.result],
}: { duration?: number; enabled?: boolean; selected?: boolean; scene?: string; onComplete?: () => void; canAdvance?: RefObject<boolean>; milestones?: readonly number[] } = {}) {
  const region = useRef<HTMLDivElement>(null);
  const clock = useMotionValue<number>(reduced ? duration : 0);
  const [elapsed, setElapsed] = useState(clock.get());
  const checkpoint = useRef(elapsed);
  const [playing, setPlaying] = useState(!reduced);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(!document.hidden);
  const completed = useRef(onComplete);
  completed.current = onComplete;
  const active = playing && selected && visible && foreground && !reduced;

  useEffect(() => {
    if (import.meta.env.MODE === "qa" && active && region.current) return observePlayback(region.current);
  }, [active]);

  useMotionValueEvent(clock, "change", (current) => {
    if (Math.floor(current / 1000) !== Math.floor(checkpoint.current / 1000)
      || [0, duration].includes(current)
      || milestones.some((at) => (current >= at) !== (checkpoint.current >= at))) {
      checkpoint.current = current;
      setElapsed(current);
    }
  });
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0 });
    if (region.current) observer.observe(region.current);
    const update = () => setForeground(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  useEffect(() => {
    if (reduced) { setPlaying(false); clock.set(duration); }
  }, [reduced, duration, clock]);
  useEffect(() => {
    if (!active || !enabled) return;
    let frame: number;
    let previous = performance.now();
    function tick(now: number) {
      if (canAdvance && !canAdvance.current) {
        previous = now;
        frame = requestAnimationFrame(tick);
        return;
      }
      const next = Math.min(clock.get() + Math.min(now - previous, 80), duration);
      previous = now;
      clock.set(next);
      if (next < duration) frame = requestAnimationFrame(tick);
      else if (completed.current) completed.current();
      else setPlaying(false);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, enabled, duration, scene, clock, canAdvance]);

  const pause = useCallback(() => setPlaying(false), []);
  const seek = useCallback((at: number, play = true) => {
    clock.set(reduced ? duration : Math.max(0, Math.min(duration, at)));
    setPlaying(play && !reduced);
  }, [clock, reduced, duration]);
  function toggle() {
    if (clock.get() >= duration) seek(0);
    else setPlaying((value) => !value);
  }
  return { region, clock, elapsed, playing, active, pause, seek, toggle, setPlaying };
}
