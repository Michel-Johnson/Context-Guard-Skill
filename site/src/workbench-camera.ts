import type { Box, Camera } from "./native-camera.ts";

export const workbenchWidth = 1280;
export const workbenchHeight = 760;

// 同一视口共用倍率；已在安全区内的控件不触发新的取景。
export function workbenchCamera(width: number, height: number, focus: Box | null, previous?: Camera): Camera {
  const base = Math.min(width / workbenchWidth, height / workbenchHeight);
  const overview = { x: (width - workbenchWidth * base) / 2, y: (height - workbenchHeight * base) / 2, scale: base };
  if (!focus) return overview;
  const margin = Math.min(32, width * .04);
  const zoom = Math.max(base, Math.min(1.12, base * 1.25));
  const validAxis = (offset: number, extent: number, size: number) => previous && (size * previous.scale <= extent
    ? Math.abs(offset - (extent - size * previous.scale) / 2) < .5
    : offset <= 0 && offset >= extent - size * previous.scale);
  if (previous && previous.scale >= base && previous.scale <= zoom &&
      validAxis(previous.x, width, workbenchWidth) && validAxis(previous.y, height, workbenchHeight) &&
      focus.x * previous.scale + previous.x >= margin &&
      focus.y * previous.scale + previous.y >= margin &&
      (focus.x + focus.width) * previous.scale + previous.x <= width - margin &&
      (focus.y + focus.height) * previous.scale + previous.y <= height - margin) return previous;
  const scale = Math.max(base, Math.min(zoom, (width - margin * 2) / focus.width, (height - margin * 2) / focus.height));
  const place = (extent: number, source: number, center: number) => source * scale <= extent
    ? (extent - source * scale) / 2
    : Math.min(0, Math.max(extent - source * scale, extent / 2 - center * scale));
  return { x: place(width, workbenchWidth, focus.x + focus.width / 2), y: place(height, workbenchHeight, focus.y + focus.height / 2), scale };
}

// 运动时保留亚像素轨迹；仅最终静止位置对齐设备像素。
export function settledWorkbenchCamera(pose: Camera, ratio: number): Camera {
  return { ...pose, x: Math.round(pose.x * ratio) / ratio, y: Math.round(pose.y * ratio) / ratio };
}
