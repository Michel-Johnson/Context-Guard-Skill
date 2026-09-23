// Adapted from Ready@d0771a1c8dc8086f49fbe924c2b5cbb621d0fd8b:
// platform/frontend/src/components/WorkingBlot.tsx and its atlas asset.
// Keep its original 48-frame, 2-second ink motion and 16-second hue cycle.
const FRAME_MS = [
  40, 40, 50, 40, 40, 40, 40, 40, 50, 40, 40, 40, 40, 40, 50, 40, 40, 40, 40, 40,
  50, 40, 40, 40, 40, 40, 50, 40, 40, 40, 40, 40, 50, 40, 40, 40, 40, 40, 50, 40,
  40, 40, 40, 40, 50, 40, 40, 40,
];
const TILE = 160;
const COLS = 8;
const HUE_PERIOD_MS = 16_000;
const HSV_S = 0.84;
const HSV_V = 0.74;
const motionMs = FRAME_MS.reduce((total, duration) => total + duration, 0);
const cumulative = [];
let elapsed = 0;
for (const duration of FRAME_MS) cumulative.push(elapsed += duration);
let atlasPromise;
let alphaFrames;

function frameAt(elapsed) {
  const time = ((elapsed % motionMs) + motionMs) % motionMs;
  return cumulative.findIndex(end => time < end);
}

function hsvToRgb(hue, saturation, value) {
  const channel = number => {
    const key = (number + hue / 60) % 6;
    return value - value * saturation * Math.max(Math.min(key, 4 - key, 1), 0);
  };
  return [Math.round(channel(5) * 255), Math.round(channel(3) * 255), Math.round(channel(1) * 255)];
}

function loadFrames(doc) {
  if (alphaFrames) return Promise.resolve(alphaFrames);
  atlasPromise ||= new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Coordinator working animation could not load'));
    image.src = new URL('./working-blot-atlas.png', import.meta.url).href;
  });
  return atlasPromise.then(image => {
    if (alphaFrames) return alphaFrames;
    const scratch = doc.createElement('canvas');
    scratch.width = scratch.height = TILE;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    if (!context) return [];
    alphaFrames = FRAME_MS.map((_, index) => {
      context.clearRect(0, 0, TILE, TILE);
      context.drawImage(image, (index % COLS) * TILE, Math.floor(index / COLS) * TILE, TILE, TILE, 0, 0, TILE, TILE);
      const pixels = context.getImageData(0, 0, TILE, TILE).data;
      const alpha = new Uint8Array(TILE * TILE);
      for (let pixel = 0; pixel < alpha.length; pixel++) alpha[pixel] = pixels[pixel * 4 + 3];
      return alpha;
    });
    return alphaFrames;
  });
}

export function createCoordinatorWorkingBlot(doc = document, onError = () => {}) {
  const canvas = doc.createElement('canvas');
  canvas.className = 'coordinator-working-blot';
  canvas.width = canvas.height = TILE;
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  let active = false, generation = 0, frame = 0;
  const pixels = context?.createImageData(TILE, TILE);

  const paint = (frames, elapsed, reduced) => {
    if (!context || !pixels) return;
    const alpha = frames[reduced ? 0 : frameAt(elapsed)];
    const [red, green, blue] = hsvToRgb(reduced ? 0 : ((elapsed / HUE_PERIOD_MS) % 1) * 360, HSV_S, HSV_V);
    for (let pixel = 0; pixel < alpha.length; pixel++) {
      const offset = pixel * 4;
      pixels.data[offset] = red;
      pixels.data[offset + 1] = green;
      pixels.data[offset + 2] = blue;
      pixels.data[offset + 3] = alpha[pixel];
    }
    context.putImageData(pixels, 0, 0);
  };
  const stop = () => {
    active = false;
    generation++;
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const start = onFirstFrame => {
    if (active || !context) return;
    active = true;
    const current = ++generation;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    void loadFrames(doc).then(frames => {
      if (!active || current !== generation || !frames.length) return;
      if (reduced) { paint(frames, 0, true); onFirstFrame?.(); return; }
      const started = performance.now();
      let first = true;
      const tick = now => {
        if (!active || current !== generation) return;
        paint(frames, now - started, false);
        if (first) { first = false; onFirstFrame?.(); }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }).catch(() => { if (active && current === generation) onError(); });
  };
  return { canvas, start, stop };
}
