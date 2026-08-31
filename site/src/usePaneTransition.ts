import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMotionValue } from "motion/react";

export const blendDuration = 480;
export const easeBlend = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

// 两个画面始终保留。只改变上层透明度，暂停、等待载入、反向切换都保留当前位置。
export function usePaneTransition(target: 0 | 1, active: boolean, ready: boolean, reduced: boolean) {
  const mix = useMotionValue<number>(0);
  const tween = useRef({ from: 0, to: 0, elapsed: 0 });
  const [settledAt, setSettledAt] = useState<number | null>(0);
  useLayoutEffect(() => {
    tween.current = { from: mix.get(), to: target, elapsed: 0 };
    setSettledAt(mix.get() === target ? target : null);
  }, [target, mix]);
  useEffect(() => {
    if (!ready) return;
    if (reduced) { mix.set(target); setSettledAt(target); return; }
    if (!active || mix.get() === target) return;
    let frame: number;
    let previous = performance.now();
    function tick(now: number) {
      const state = tween.current;
      state.elapsed += Math.min(64, Math.max(0, now - previous));
      previous = now;
      const progress = easeBlend(state.elapsed / blendDuration);
      mix.set(state.from + (state.to - state.from) * progress);
      if (state.elapsed < blendDuration) frame = requestAnimationFrame(tick);
      else setSettledAt(state.to);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active, ready, reduced, mix]);
  return { mix, settled: settledAt === target && ready };
}
