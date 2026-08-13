export interface ViewerPoint {
  x: number;
  y: number;
}

export interface ViewerSize {
  width: number;
  height: number;
}

export interface ViewerTransform {
  zoom: number;
  offset: ViewerPoint;
}

export const SCREENING_VIEWER_MIN_ZOOM = 0.25;
export const SCREENING_VIEWER_ZOOM_STEP = 1.2;

export function screeningViewerFitScale(
  viewport: ViewerSize,
  image: ViewerSize,
  padding = 64,
): number {
  if (viewport.width <= 0 || viewport.height <= 0 || image.width <= 0 || image.height <= 0) {
    return 1;
  }
  return Math.min(
    1,
    Math.max(1, viewport.width - padding) / image.width,
    Math.max(1, viewport.height - padding) / image.height,
  );
}

export function screeningViewerMaxZoom(fitScale: number): number {
  return Math.max(8, fitScale > 0 ? 1 / fitScale : 8);
}

export function clampScreeningViewerZoom(zoom: number, maxZoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(maxZoom, Math.max(SCREENING_VIEWER_MIN_ZOOM, zoom));
}

export function screeningViewerDisplaySize(
  image: ViewerSize,
  fitScale: number,
  zoom: number,
): ViewerSize {
  return {
    width: Math.max(1, image.width * fitScale * zoom),
    height: Math.max(1, image.height * fitScale * zoom),
  };
}

export function clampScreeningViewerOffset(
  offset: ViewerPoint,
  viewport: ViewerSize,
  image: ViewerSize,
  fitScale: number,
  zoom: number,
  edgeInset = 32,
): ViewerPoint {
  const display = screeningViewerDisplaySize(image, fitScale, zoom);
  const maxX = Math.max(0, (display.width - viewport.width) / 2 + edgeInset);
  const maxY = Math.max(0, (display.height - viewport.height) / 2 + edgeInset);
  return {
    x: maxX === 0 ? 0 : Math.min(maxX, Math.max(-maxX, offset.x)),
    y: maxY === 0 ? 0 : Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}

export function zoomScreeningViewerAt(
  transform: ViewerTransform,
  requestedZoom: number,
  anchor: ViewerPoint,
  viewport: ViewerSize,
  image: ViewerSize,
  fitScale: number,
): ViewerTransform {
  const zoom = clampScreeningViewerZoom(requestedZoom, screeningViewerMaxZoom(fitScale));
  const ratio = zoom / Math.max(SCREENING_VIEWER_MIN_ZOOM, transform.zoom);
  const offset = clampScreeningViewerOffset(
    {
      x: anchor.x - (anchor.x - transform.offset.x) * ratio,
      y: anchor.y - (anchor.y - transform.offset.y) * ratio,
    },
    viewport,
    image,
    fitScale,
    zoom,
  );
  return { zoom, offset };
}
