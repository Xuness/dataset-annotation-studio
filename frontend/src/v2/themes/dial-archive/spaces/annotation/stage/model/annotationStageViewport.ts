import { ANNOTATION_STAGE_LAYOUT } from "./annotationStageLayout";

export interface StageViewportSize {
  width: number;
  height: number;
}

export interface StageViewportTransform {
  x: number;
  y: number;
  scale: number;
}

export interface StageViewportPoint {
  x: number;
  y: number;
}

export function clampStageValue(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** 图片完整进入观察窗时的比例；极端长宽比也允许低于常规最小缩放值。 */
export function calculateStageViewportFitScale(
  viewport: StageViewportSize,
  image: StageViewportSize,
): number {
  const { fitInset, maxFitScale } = ANNOTATION_STAGE_LAYOUT.viewport;
  if (viewport.width <= 0 || viewport.height <= 0 || image.width <= 0 || image.height <= 0) {
    return 1;
  }
  const availableWidth = Math.max(1, viewport.width - fitInset * 2);
  const availableHeight = Math.max(1, viewport.height - fitInset * 2);
  return Math.min(maxFitScale, availableWidth / image.width, availableHeight / image.height);
}

/** 约束平移，避免放大后的图片完全离开观察窗。 */
export function clampStageViewportTransform(
  transform: StageViewportTransform,
  viewport: StageViewportSize,
  image: StageViewportSize,
): StageViewportTransform {
  const { edgeOverscroll, maxScale, minScale } = ANNOTATION_STAGE_LAYOUT.viewport;
  const fitScale = calculateStageViewportFitScale(viewport, image);
  const scale = clampStageValue(transform.scale, Math.min(minScale, fitScale), maxScale);
  const renderedWidth = image.width * scale;
  const renderedHeight = image.height * scale;
  const limitX =
    renderedWidth > viewport.width ? (renderedWidth - viewport.width) / 2 + edgeOverscroll : 0;
  const limitY =
    renderedHeight > viewport.height ? (renderedHeight - viewport.height) / 2 + edgeOverscroll : 0;
  return {
    x: clampStageValue(transform.x, -limitX, limitX),
    y: clampStageValue(transform.y, -limitY, limitY),
    scale,
  };
}

/** 以指针为锚点缩放，保证被观察的像素不会在滚轮输入时逃离指针。 */
export function zoomStageViewportAt(
  current: StageViewportTransform,
  requestedScale: number,
  anchor: StageViewportPoint,
  viewport: StageViewportSize,
  image: StageViewportSize,
): StageViewportTransform {
  const fitScale = calculateStageViewportFitScale(viewport, image);
  const scale = clampStageValue(
    requestedScale,
    Math.min(ANNOTATION_STAGE_LAYOUT.viewport.minScale, fitScale),
    ANNOTATION_STAGE_LAYOUT.viewport.maxScale,
  );
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  const imageX = (anchor.x - centerX - current.x) / current.scale;
  const imageY = (anchor.y - centerY - current.y) / current.scale;
  return clampStageViewportTransform(
    {
      x: anchor.x - centerX - imageX * scale,
      y: anchor.y - centerY - imageY * scale,
      scale,
    },
    viewport,
    image,
  );
}
