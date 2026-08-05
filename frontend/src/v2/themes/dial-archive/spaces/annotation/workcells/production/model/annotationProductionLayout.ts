import type { CSSProperties } from "react";

import type { AnnotationLaneId } from "../../../../../../../pages/spaces/spacePageModel";
import type { SpatialCanvasRect } from "../../../../hooks/useSpatialCanvasMotion";
import {
  PREPARATION_CANVAS_LAYOUT,
  projectPreparationCanvasPointToMinimap,
  projectPreparationCanvasRectToMinimap,
} from "../../../../preparation/model/preparationCanvasLayout";

type PreparationCanvasNodeId = keyof typeof PREPARATION_CANVAS_LAYOUT.nodes;

export type ProductionCanvasNodeId =
  "source" | "scope" | AnnotationLaneId | "validation" | "terminal" | "result";

/**
 * Production intentionally uses the exact Space 02 workbench geometry. The map
 * only changes the semantic identities carried by those established slots.
 */
const PRODUCTION_TO_PREPARATION_NODE = {
  source: "source",
  scope: "scope",
  tags: "geometry",
  description: "encoding",
  translation: "identity",
  validation: "preview",
  terminal: "commit",
  result: "recovery",
} as const satisfies Readonly<Record<ProductionCanvasNodeId, PreparationCanvasNodeId>>;

export const PRODUCTION_CANVAS_NODE_IDS = [
  "source",
  "scope",
  "tags",
  "description",
  "translation",
  "validation",
  "terminal",
  "result",
] as const satisfies readonly ProductionCanvasNodeId[];

export const ANNOTATION_PRODUCTION_ROUTE_LAYOUT = {
  surface: PREPARATION_CANVAS_LAYOUT.surface,
  taskBounds: PREPARATION_CANVAS_LAYOUT.taskBounds,
  overviewBounds: PREPARATION_CANVAS_LAYOUT.overviewBounds,
  camera: PREPARATION_CANVAS_LAYOUT.camera,
  fields: PREPARATION_CANVAS_LAYOUT.fields,
  decorRoutes: PREPARATION_CANVAS_LAYOUT.decorRoutes,
  backgroundFrames: PREPARATION_CANVAS_LAYOUT.backgroundFrames,
  landmarks: PREPARATION_CANVAS_LAYOUT.landmarks,
  gauges: PREPARATION_CANVAS_LAYOUT.gauges,
  grid: PREPARATION_CANVAS_LAYOUT.grid,
  minimap: PREPARATION_CANVAS_LAYOUT.minimap,
  edges: PREPARATION_CANVAS_LAYOUT.edges,
  junctions: PREPARATION_CANVAS_LAYOUT.junctions,
  nodes: Object.fromEntries(
    PRODUCTION_CANVAS_NODE_IDS.map((id) => [
      id,
      PREPARATION_CANVAS_LAYOUT.nodes[PRODUCTION_TO_PREPARATION_NODE[id]],
    ]),
  ) as Readonly<
    Record<
      ProductionCanvasNodeId,
      (typeof PREPARATION_CANVAS_LAYOUT.nodes)[PreparationCanvasNodeId]
    >
  >,
} as const;

export function isProductionLaneNode(id: ProductionCanvasNodeId): id is AnnotationLaneId {
  return id === "tags" || id === "description" || id === "translation";
}

export function productionNodeStyle(id: ProductionCanvasNodeId): CSSProperties {
  const { rect, elevation, revealOrder } = ANNOTATION_PRODUCTION_ROUTE_LAYOUT.nodes[id];
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    "--dial-archive-node-elevation": `${elevation}px`,
    "--dial-archive-node-order": revealOrder,
  } as CSSProperties;
}

export function getProductionNodeCenter(id: ProductionCanvasNodeId) {
  const { rect } = ANNOTATION_PRODUCTION_ROUTE_LAYOUT.nodes[id];
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

export function projectProductionCanvasRectToMinimap(rect: SpatialCanvasRect): SpatialCanvasRect {
  return projectPreparationCanvasRectToMinimap(rect);
}

export function projectProductionCanvasPointToMinimap(point: { x: number; y: number }) {
  return projectPreparationCanvasPointToMinimap(point);
}
