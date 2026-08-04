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
}

export type ProductionNodeId = "source" | AnnotationLaneId | "terminal";

interface ProductionField {
  readonly id: string;
  readonly index: string;
  readonly kicker: string;
  readonly title: string;
  readonly reading: string;
  readonly rect: SpatialCanvasRect;
}

export const ANNOTATION_PRODUCTION_ROUTE_LAYOUT = {
  surface: { width: 2200, height: 1120 },
  viewBox: { width: 2200, height: 1120 },
  taskBounds: { x: 210, y: 115, width: 1715, height: 830 },
  overviewBounds: { x: 80, y: 45, width: 2040, height: 1020 },
  camera: {
    initialScale: 0.62,
    minScale: 0.32,
    maxScale: 1.34,
    maxFitScale: 0.86,
    focusScale: 0.72,
    fitInset: 66,
    compactFitInset: 28,
    compactBreakpoint: 1050,
    wheelZoomSensitivity: 0.0012,
    zoomStep: 0.12,
    keyboardPanStep: 34,
    keyboardPanStepFast: 94,
    focusDurationMs: 620,
  },
  minimap: {
    width: 190,
    height: 108,
    padding: 10,
    markerWidth: 10,
    markerHeight: 7,
  },
  source: { x: 250, y: 465, width: 240, height: 150, elevation: 12 },
  lanes: {
    tags: { x: 710, y: 165, width: 360, height: 210, elevation: 16 },
    description: { x: 760, y: 430, width: 380, height: 210, elevation: 19 },
    translation: { x: 690, y: 690, width: 360, height: 210, elevation: 14 },
  } satisfies Readonly<Record<AnnotationLaneId, ProductionNodeRect>>,
  terminal: { x: 1435, y: 390, width: 430, height: 290, elevation: 22 },
  routes: {
    tags: [
      { x: 490, y: 540 },
      { x: 600, y: 540 },
      { x: 600, y: 270 },
      { x: 710, y: 270 },
      { x: 1070, y: 270 },
      { x: 1240, y: 270 },
      { x: 1240, y: 455 },
      { x: 1435, y: 455 },
    ],
    description: [
      { x: 490, y: 540 },
      { x: 650, y: 540 },
      { x: 650, y: 535 },
      { x: 760, y: 535 },
      { x: 1140, y: 535 },
      { x: 1435, y: 535 },
    ],
    translation: [
      { x: 490, y: 540 },
      { x: 600, y: 540 },
      { x: 600, y: 795 },
      { x: 690, y: 795 },
      { x: 1050, y: 795 },
      { x: 1240, y: 795 },
      { x: 1240, y: 610 },
      { x: 1435, y: 610 },
    ],
  } satisfies Readonly<Record<AnnotationLaneId, readonly ProductionPoint[]>>,
  junctions: [
    { x: 600, y: 540 },
    { x: 1240, y: 535 },
  ],
  fields: [
    {
      id: "source",
      index: "00",
      kicker: "RANGE INHERITANCE",
      title: "素材范围",
      reading: "FILM DOCK / CHECKED SET",
      rect: { x: 180, y: 350, width: 370, height: 350 },
    },
    {
      id: "synthesis",
      index: "01",
      kicker: "PARALLEL PRODUCTION",
      title: "生成支路",
      reading: "TAGS / DESCRIPTION / TRANSLATION",
      rect: { x: 610, y: 92, width: 650, height: 870 },
    },
    {
      id: "commit",
      index: "02",
      kicker: "VALIDATE AND COMMIT",
      title: "合流写入",
      reading: "SNAPSHOT / EXCEPTION / RESULT",
      rect: { x: 1350, y: 275, width: 600, height: 540 },
    },
  ] satisfies readonly ProductionField[],
  decorRoutes: [
    [
      { x: 120, y: 920 },
      { x: 420, y: 920 },
      { x: 470, y: 970 },
      { x: 980, y: 970 },
    ],
    [
      { x: 1080, y: 105 },
      { x: 1620, y: 105 },
      { x: 1680, y: 165 },
      { x: 2060, y: 165 },
    ],
    [
      { x: 1280, y: 880 },
      { x: 1770, y: 880 },
      { x: 1810, y: 840 },
      { x: 2070, y: 840 },
    ],
  ] satisfies readonly (readonly ProductionPoint[])[],
  gauge: { cx: 1650, cy: 535, radius: 315, tickCount: 72, majorEvery: 6 },
} as const;

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
