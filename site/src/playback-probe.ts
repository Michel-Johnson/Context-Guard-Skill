// 仅 --mode qa 构建启用；正式构建由常量分支消除，不显示额外页面文字。
export function observePlayback(element: HTMLElement) {
  const started = performance.now();
  let previous = performance.now();
  let frames = 0;
  let total = 0;
  let maximum = 0;
  let slow = 0;
  let longTasks = 0;
  let longFrames = 0;
  let maximumBlockingMs = 0;
  const frameBins = new Uint32Array(2001);
  const longestGaps: { gapMs: number; atMs: number; phase: string; visibility: string }[] = [];
  const longestFrames: { durationMs: number; blockingMs: number; renderMs: number; layoutMs: number; atMs: number }[] = [];
  const supported = PerformanceObserver.supportedEntryTypes;
  let id = 0;
  function percentile(fraction: number) {
    let count = 0;
    for (let ms = 0; ms < frameBins.length; ms++) {
      count += frameBins[ms];
      if (count >= frames * fraction) return ms;
    }
    return 0;
  }
  const publish = () => { element.dataset.playbackSample = JSON.stringify({
    frames, averageMs: frames ? total / frames : 0, maximumMs: maximum, over50ms: slow,
    p95Ms: percentile(.95), p99Ms: percentile(.99), longTasks, longFrames, maximumBlockingMs,
    longTaskSupported: supported.includes("longtask"), longFrameSupported: supported.includes("long-animation-frame"),
    longestGaps, longestFrames,
  }); };
  const collect = (entries: PerformanceEntry[]) => {
    for (const entry of entries) {
      if (entry.entryType === "longtask") longTasks++;
      else {
        const frame = entry as PerformanceEntry & { blockingDuration: number; renderStart: number; styleAndLayoutStart: number };
        longFrames++;
        maximumBlockingMs = Math.max(maximumBlockingMs, frame.blockingDuration);
        const end = frame.startTime + frame.duration;
        longestFrames.push({ durationMs: frame.duration, blockingMs: frame.blockingDuration,
          renderMs: frame.renderStart ? end - frame.renderStart : 0,
          layoutMs: frame.styleAndLayoutStart ? end - frame.styleAndLayoutStart : 0, atMs: frame.startTime - started });
        longestFrames.sort((a, b) => b.durationMs - a.durationMs);
        longestFrames.length = Math.min(longestFrames.length, 10);
      }
    }
  };
  const observer = new PerformanceObserver((list) => collect(list.getEntries()));
  for (const type of ["longtask", "long-animation-frame"]) if (supported.includes(type)) observer.observe({ type });
  function tick(now: number) {
    const gap = now - previous;
    previous = now;
    frames++;
    total += gap;
    frameBins[Math.min(2000, Math.ceil(gap))]++;
    maximum = Math.max(maximum, gap);
    if (gap > 50) slow++;
    if (gap > 100) {
      longestGaps.push({ gapMs: gap, atMs: now - started,
        phase: element.querySelector(".journey-caption")?.textContent ?? "独立场景", visibility: document.visibilityState });
      longestGaps.sort((a, b) => b.gapMs - a.gapMs);
      longestGaps.length = Math.min(longestGaps.length, 10);
    }
    if (frames % 60 === 0) publish();
    id = requestAnimationFrame(tick);
  }
  id = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(id); collect(observer.takeRecords()); observer.disconnect(); publish(); };
}
