// 截屏框选的选区数学：全部为纯函数，便于单测。
// 视口坐标（CSS px）→ 截图物理像素坐标的换算依赖 image/viewport 的比例，
// 不直接用 scaleFactor，避免浏览器缩放或窗口未铺满时出现偏移。

export type DragPoints = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

export type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function normalizeSelectionRect(points: DragPoints): SelectionRect {
  const x = Math.min(points.startX, points.endX);
  const y = Math.min(points.startY, points.endY);
  return {
    x,
    y,
    width: Math.abs(points.endX - points.startX),
    height: Math.abs(points.endY - points.startY),
  };
}

/** 过小的框视为误触（单击/抖动），不弹出提问窗。 */
export function isSelectionMeaningful(rect: SelectionRect, minSize = 4): boolean {
  return rect.width >= minSize && rect.height >= minSize;
}

/** 视口 CSS 像素选区 → 截图物理像素选区，四舍五入并夹紧到图像边界内。 */
export function toImageSelection(
  rect: SelectionRect,
  viewport: { width: number; height: number },
  image: { width: number; height: number },
): SelectionRect {
  const ratioX = viewport.width > 0 ? image.width / viewport.width : 1;
  const ratioY = viewport.height > 0 ? image.height / viewport.height : 1;
  const x = Math.max(0, Math.min(image.width - 1, Math.round(rect.x * ratioX)));
  const y = Math.max(0, Math.min(image.height - 1, Math.round(rect.y * ratioY)));
  const width = Math.max(1, Math.min(image.width - x, Math.round(rect.width * ratioX)));
  const height = Math.max(1, Math.min(image.height - y, Math.round(rect.height * ratioY)));
  return { x, y, width, height };
}
