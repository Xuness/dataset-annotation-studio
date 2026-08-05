import type { CSSProperties } from "react";

import type { AnnotationLaneId } from "../../../../../../../pages/spaces/spacePageModel";
import type { SpatialCanvasRect } from "../../../../hooks/useSpatialCanvasMotion";

export interface ProductionPoint {
  readonly x: number;
  readonly y: number;
}

export interface ProductionNodeRect extends ProductionPoint {
  readonly width: number;
  readonly height: number;
  readonly elevation: number;
  readonly revealOrder: number;
}

export type ProductionNodeId = "source" | AnnotationLaneId | "terminal";

export interface ProductionFocusViewport {
  readonly width: number;
  readonly height: number;
  readonly inspectorWidth: number;
}

interface ProductionField {
  readonly id: string;
  readonly index: string;
  readonly kicker: string;
  readonly title: string;
  readonly reading: string;
  readonly rect: SpatialCanvasRect;
}

export const ANNOTATION_PRODUCTION_ROUTE_LAYOUT = {
  surface: { width: 4200, height: 2300 },
  viewBox: { width: 4200, height: 2300 },
  taskBounds: { x: 280, y: 300, width: 3140, height: 1440 },
  overviewBounds: { x: 180, y: 240, width: 3480, height: 1560 },
  camera: {
    initialScale: 0.68,
    minScale: 0.3,
    maxScale: 1.42,
    maxFitScale: 0.74,
    focusScale: 0.78,
    fitInset: 62,
    compactFitInset: 24,
    compactBreakpoint: 900,
    wheelZoomSensitivity: 0.00115,
    zoomStep: 0.1,
    keyboardPanStep: 46,
    keyboardPanStepFast: 104,
    focusDurationMs: 380,
  },
  minimap: {
    width: 190,
    height: 108,
    padding: 10,
    markerWidth: 10,
    markerHeight: 7,
  },
  source: { x: 850, y: 850, width: 320, height: 210, elevation: 12, revealOrder: 0 },
  lanes: {
    tags: { x: 1400, y: 380, width: 370, height: 210, elevation: 16, revealOrder: 1 },
    description: {
      x: 1510,
      y: 840,
      width: 370,
      height: 210,
      elevation: 14,
      revealOrder: 2,
    },
    translation: {
      x: 1400,
      y: 1300,
      width: 370,
      height: 210,
      elevation: 12,
      revealOrder: 3,
    },
  } satisfies Readonly<Record<AnnotationLaneId, ProductionNodeRect>>,
  terminal: {
    x: 2250,
    y: 760,
    width: 410,
    height: 220,
    elevation: 20,
    revealOrder: 4,
  },
  routes: {
    tags: [
      { x: 1170, y: 955 },
      { x: 1280, y: 955 },
      { x: 1280, y: 485 },
      { x: 1400, y: 485 },
      { x: 1770, y: 485 },
      { x: 2080, y: 485 },
      { x: 2080, y: 830 },
      { x: 2250, y: 830 },
    ],
    description: [
      { x: 1170, y: 955 },
      { x: 1280, y: 955 },
      { x: 1510, y: 945 },
      { x: 1880, y: 945 },
      { x: 2080, y: 945 },
      { x: 2080, y: 870 },
      { x: 2250, y: 870 },
    ],
    translation: [
      { x: 1170, y: 955 },
      { x: 1280, y: 955 },
      { x: 1280, y: 1405 },
      { x: 1400, y: 1405 },
      { x: 1770, y: 1405 },
      { x: 2080, y: 1405 },
      { x: 2080, y: 910 },
      { x: 2250, y: 910 },
    ],
  } satisfies Readonly<Record<AnnotationLaneId, readonly ProductionPoint[]>>,
  junctions: [
    { x: 1280, y: 955 },
    { x: 2080, y: 870 },
  ],
  fields: [
    {
      id: "source",
      index: "00",
      kicker: "RANGE INHERITANCE",
      title: "素材范围",
      reading: "FILM DOCK / CHECKED SET",
      rect: { x: 180, y: 500, width: 1080, height: 820 },
    },
    {
      id: "synthesis",
      index: "01",
      kicker: "PARALLEL PRODUCTION",
      title: "生成支路",
      reading: "TAGS / DESCRIPTION / TRANSLATION",
      rect: { x: 1240, y: 220, width: 1040, height: 1390 },
    },
    {
      id: "commit",
      index: "02",
      kicker: "VALIDATE AND COMMIT",
      title: "合流写入",
      reading: "SNAPSHOT / EXCEPTION / RESULT",
      rect: { x: 2180, y: 360, width: 1240, height: 880 },
    },
  ] satisfies readonly ProductionField[],
  decorRoutes: [
    [
      { x: 80, y: 330 },
      { x: 640, y: 330 },
      { x: 760, y: 450 },
      { x: 1120, y: 450 },
    ],
    [
      { x: 2320, y: 250 },
      { x: 3200, y: 250 },
      { x: 3340, y: 390 },
      { x: 3820, y: 390 },
    ],
    [
      { x: 220, y: 1840 },
      { x: 1180, y: 1840 },
      { x: 1300, y: 1960 },
      { x: 2140, y: 1960 },
    ],
  ] satisfies readonly (readonly ProductionPoint[])[],
  gauge: { cx: 2050, cy: 875, radius: 360, tickCount: 84, majorEvery: 7 },
} as const;

export const ANNOTATION_PRODUCTION_TOPOLOGY_BOUNDS = {
  x: 760,
  y: 290,
  width: 1990,
  height: 1310,
} as const;

const PRODUCTION_WIDE_FOCUS_BREAKPOINT = 1680;

function number(value: number): string {
  return String(Number(value.toFixed(2)));
}

function polylinePath(points: readonly ProductionPoint[]): string {
  const [first, ...rest] = points;
  return [
    `M ${number(first.x)} ${number(first.y)}`,
    ...rest.map((point) => `L ${number(point.x)} ${number(point.y)}`),
  ].join(" ");
}

export function productionRoutePath(lane: AnnotationLaneId): string {
  return polylinePath(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.routes[lane]);
}

export function productionDecorRoutePath(index: number): string {
  return polylinePath(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.decorRoutes[index]);
}

export function productionNodeStyle(rect: ProductionNodeRect): CSSProperties {
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    "--dial-archive-production-elevation": `${rect.elevation}px`,
    "--dial-archive-node-elevation": `${rect.elevation}px`,
    "--dial-archive-node-order": rect.revealOrder,
  } as CSSProperties;
}

export function getProductionNodeRect(id: ProductionNodeId): ProductionNodeRect {
  if (id === "source") return ANNOTATION_PRODUCTION_ROUTE_LAYOUT.source;
  if (id === "terminal") return ANNOTATION_PRODUCTION_ROUTE_LAYOUT.terminal;
  return ANNOTATION_PRODUCTION_ROUTE_LAYOUT.lanes[id];
}

export function getProductionNodeCenter(id: ProductionNodeId): ProductionPoint {
  const rect = getProductionNodeRect(id);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Keep the complete production topology in view on wide workstations while
 * retaining the closer selected-node composition on compact screens.
 */
export function resolveProductionFocus(
  id: ProductionNodeId,
  viewport: ProductionFocusViewport,
): { readonly center: ProductionPoint; readonly scale: number } {
  const camera = ANNOTATION_PRODUCTION_ROUTE_LAYOUT.camera;
  if (
    viewport.width >= PRODUCTION_WIDE_FOCUS_BREAKPOINT &&
    viewport.height > 0 &&
    viewport.inspectorWidth > 0
  ) {
    const visibleWidth = Math.max(640, viewport.width - viewport.inspectorWidth - 36);
    const inset = Math.min(96, Math.max(64, viewport.width * 0.035));
    const bounds = ANNOTATION_PRODUCTION_TOPOLOGY_BOUNDS;
    const scale = Math.min(
      camera.maxScale,
      Math.max(
        camera.minScale,
        Math.min(
          (visibleWidth - inset * 2) / bounds.width,
          (viewport.height - inset * 2) / bounds.height,
        ),
      ),
    );
    return {
      center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      scale,
    };
  }

  let center = getProductionNodeCenter(id);
  if (id !== "source" && id !== "terminal") {
    const terminalCenter = getProductionNodeCenter("terminal");
    center = {
      x: (center.x + terminalCenter.x) / 2,
      y: (center.y + terminalCenter.y) / 2,
    };
  }
  return { center, scale: camera.focusScale };
}

export function projectProductionCanvasRectToMinimap(rect: SpatialCanvasRect): SpatialCanvasRect {
  const { overviewBounds, minimap } = ANNOTATION_PRODUCTION_ROUTE_LAYOUT;
  const innerWidth = minimap.width - minimap.padding * 2;
  const innerHeight = minimap.height - minimap.padding * 2;
  return {
    x: minimap.padding + ((rect.x - overviewBounds.x) / overviewBounds.width) * innerWidth,
    y: minimap.padding + ((rect.y - overviewBounds.y) / overviewBounds.height) * innerHeight,
    width: (rect.width / overviewBounds.width) * innerWidth,
    height: (rect.height / overviewBounds.height) * innerHeight,
  };
}

export function projectProductionCanvasPointToMinimap(point: ProductionPoint): ProductionPoint {
  const projected = projectProductionCanvasRectToMinimap({
    x: point.x,
    y: point.y,
    width: 0,
    height: 0,
  });
  return { x: projected.x, y: projected.y };
}
