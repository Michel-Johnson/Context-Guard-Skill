export const nativeHeight = 800;
export const nativeRasterScale = 1.35;
export type Box = { x: number; y: number; width: number; height: number };
export type Camera = { x: number; y: number; scale: number };
export type CameraMotion = { pose: Camera; velocity: Camera };

export function rasterizedCamera(pose: Camera): Camera {
  return {
    x: pose.x / nativeRasterScale,
    y: pose.y / nativeRasterScale,
    scale: pose.scale / nativeRasterScale,
  };
}

// 画布始终保持参考窗口的尺寸。取景只改变统一缩放和平移，不参与客户端布局。
export function frameCamera(width: number, height: number, sourceWidth: number, focus: Box | null, pane?: { x: number; width: number }): Camera {
  const paneWidth = pane?.width ?? (sourceWidth === 640 ? 640 : 464);
  const scale = focus ? Math.min(nativeRasterScale, width / (paneWidth + 24))
    : Math.min(width / sourceWidth, height / nativeHeight);
  const place = (size: number, extent: number, center: number) => size * scale <= extent
    ? (extent - size * scale) / 2
    : Math.min(0, Math.max(extent - size * scale, extent / 2 - center * scale));
  // 回复超过镜头高度时，保留最新一段；输入和回复共用倍率，避免随行数反复缩放。
  const visibleHeight = height / scale - 48;
  const centerY = focus ? focus.y + focus.height - Math.min(focus.height, visibleHeight) / 2 : nativeHeight / 2;
  return {
    scale,
    x: place(sourceWidth, width, (pane?.x ?? sourceWidth - paneWidth) + paneWidth / 2),
    y: place(nativeHeight, height, centerY),
  };
}

export const stillCamera = (pose: Camera): CameraMotion => ({ pose, velocity: { x: 0, y: 0, scale: 0 } });

export function cameraSettled(state: CameraMotion, target: Camera) {
  return (["x", "y", "scale"] as const).every((key) => {
    const units = key === "scale" ? nativeHeight : 1;
    return Math.abs(state.pose[key] - target[key]) * units < .02 && Math.abs(state.velocity[key]) * units < .1;
  });
}

// 临界阻尼保留位置和速度。新轮次、滚动或目标变化时不重启补间，也不会跳到预设起点。
export function advanceCamera(state: CameraMotion, target: Camera, delta: number, frequency = 10): CameraMotion {
  if (delta <= 0) return state;
  if (cameraSettled(state, target)) return stillCamera(target);
  const seconds = delta / 1000;
  const decay = Math.exp(-frequency * seconds);
  const pose = { ...state.pose };
  const velocity = { ...state.velocity };
  for (const key of ["x", "y", "scale"] as const) {
    const offset = state.pose[key] - target[key];
    const rate = state.velocity[key] + frequency * offset;
    pose[key] = target[key] + (offset + rate * seconds) * decay;
    velocity[key] = (state.velocity[key] - frequency * rate * seconds) * decay;
  }
  return { pose, velocity };
}
