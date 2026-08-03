import type {
  PreparationCanvasNodeId,
  PreparationCapabilityId,
} from "../../../../../pages/spaces/spacePageModel";

export interface PreparationCanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface PreparationCanvasSize {
  readonly width: number;
  readonly height: number;
}

export interface PreparationCanvasRect extends PreparationCanvasPoint, PreparationCanvasSize {}

type PreparationCanvasPortSide = "top" | "right" | "bottom" | "left";

interface PreparationCanvasPort {
  readonly node: PreparationCanvasNodeId;
  readonly side: PreparationCanvasPortSide;
  readonly offset?: number;
}

export type PreparationCanvasEdgeActivation =
  "always" | "preview" | "recovery" | PreparationCapabilityId;

export interface PreparationCanvasEdge {
  readonly id: string;
  readonly from: PreparationCanvasPort;
  readonly to: PreparationCanvasPort;
  readonly fromControl: PreparationCanvasPoint;
  readonly toControl: PreparationCanvasPoint;
  readonly activation: PreparationCanvasEdgeActivation;
  readonly signal: "primary" | "recovery";
}

export interface PreparationCanvasNodeLayout {
  readonly rect: PreparationCanvasRect;
}

export type PreparationCanvasNodeLayouts = Readonly<
  Record<PreparationCanvasNodeId, PreparationCanvasNodeLayout>
>;

const nodes = {
  source: { rect: { x: 150, y: 450, width: 300, height: 160 } },
  scope: { rect: { x: 550, y: 430, width: 280, height: 170 } },
  geometry: { rect: { x: 980, y: 190, width: 320, height: 170 } },
  encoding: { rect: { x: 1050, y: 470, width: 320, height: 170 } },
  identity: { rect: { x: 960, y: 760, width: 320, height: 170 } },
  preview: { rect: { x: 1620, y: 430, width: 320, height: 170 } },
  commit: { rect: { x: 2110, y: 360, width: 350, height: 180 } },
  recovery: { rect: { x: 1540, y: 900, width: 440, height: 130 } },
} as const satisfies PreparationCanvasNodeLayouts;

const edges = [
  {
    id: "source-scope",
    from: { node: "source", side: "right" },
    to: { node: "scope", side: "left", offset: 0.35 },
    fromControl: { x: 46, y: 0 },
    toControl: { x: -46, y: 0 },
    activation: "always",
    signal: "primary",
  },
  {
    id: "scope-geometry",
    from: { node: "scope", side: "right", offset: 0.41 },
    to: { node: "geometry", side: "left" },
    fromControl: { x: 72, y: 0 },
    toControl: { x: -118, y: 0 },
    activation: "geometry",
    signal: "primary",
  },
  {
    id: "scope-encoding",
    from: { node: "scope", side: "right", offset: 0.53 },
    to: { node: "encoding", side: "left" },
    fromControl: { x: 80, y: 0 },
    toControl: { x: -108, y: 0 },
    activation: "encoding",
    signal: "primary",
  },
  {
    id: "scope-identity",
    from: { node: "scope", side: "right", offset: 0.65 },
    to: { node: "identity", side: "left" },
    fromControl: { x: 72, y: 0 },
    toControl: { x: -108, y: 0 },
    activation: "identity",
    signal: "primary",
  },
  {
    id: "geometry-preview",
    from: { node: "geometry", side: "right" },
    to: { node: "preview", side: "left", offset: 0.41 },
    fromControl: { x: 150, y: 0 },
    toControl: { x: -168, y: 0 },
    activation: "geometry",
    signal: "primary",
  },
  {
    id: "encoding-preview",
    from: { node: "encoding", side: "right" },
    to: { node: "preview", side: "left", offset: 0.53 },
    fromControl: { x: 92, y: 0 },
    toControl: { x: -112, y: 0 },
    activation: "encoding",
    signal: "primary",
  },
  {
    id: "identity-preview",
    from: { node: "identity", side: "right" },
    to: { node: "preview", side: "left", offset: 0.65 },
    fromControl: { x: 188, y: 0 },
    toControl: { x: -190, y: 0 },
    activation: "identity",
    signal: "primary",
  },
  {
    id: "preview-commit",
    from: { node: "preview", side: "right" },
    to: { node: "commit", side: "left", offset: 0.47 },
    fromControl: { x: 70, y: 0 },
    toControl: { x: -84, y: 0 },
    activation: "preview",
    signal: "primary",
  },
  {
    id: "commit-recovery",
    from: { node: "commit", side: "bottom", offset: 0.43 },
    to: { node: "recovery", side: "right" },
    fromControl: { x: 120, y: 180 },
    toControl: { x: 270, y: 0 },
    activation: "recovery",
    signal: "recovery",
  },
  {
    id: "recovery-source",
    from: { node: "recovery", side: "left" },
    to: { node: "source", side: "bottom", offset: 0.45 },
    fromControl: { x: -460, y: 0 },
    toControl: { x: 480, y: 500 },
    activation: "recovery",
    signal: "recovery",
  },
] as const satisfies readonly PreparationCanvasEdge[];

export const PREPARATION_CANVAS_LAYOUT = {
  surface: { width: 2600, height: 1200 },
  camera: {
    initialScale: 0.72,
    minScale: 0.38,
    maxScale: 1.35,
    maxFitScale: 0.82,
    focusScale: 0.82,
    compactBreakpoint: 900,
    fitInset: 72,
    compactFitInset: 28,
    zoomStep: 0.1,
    wheelZoomSensitivity: 0.0015,
    keyboardPanStep: 42,
    keyboardPanStepFast: 96,
    focusDurationMs: 420,
  },
  nodes,
  edges,
  decorPaths: [
    "M 80 160 C 380 80 560 220 790 128 S 1240 102 1440 180",
    "M 1370 1020 C 1600 850 1820 1070 2070 940 S 2390 890 2530 980",
    "M 330 1015 C 530 940 650 1030 820 982",
  ],
  backgroundFrames: [
    {
      id: "field-a",
      rect: { x: 620, y: 55, width: 780, height: 440 },
      clipPath: "polygon(0 0, 92% 0, 100% 20%, 100% 100%, 8% 100%, 0 80%)",
      opacity: 0.22,
    },
    {
      id: "field-b",
      rect: { x: 1280, y: 490, width: 920, height: 540 },
      clipPath: "polygon(8% 0, 100% 0, 100% 86%, 92% 100%, 0 100%, 0 14%)",
      opacity: 0.22,
    },
    {
      id: "field-c",
      rect: { x: 120, y: 640, width: 620, height: 410 },
      clipPath: null,
      opacity: 0.12,
    },
  ],
  landmarks: {
    ghostWord: { x: 88, y: 72 },
    contours: { x: 1700, y: 250, width: 630, height: 630 },
    fusionLabel: { x: 1390, y: 620, width: 310, height: 42 },
  },
  minimap: {
    width: 170,
    height: 78,
    padding: 10,
    markerWidth: 7,
    markerHeight: 5,
  },
} as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatCanvasNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function getPreparationCanvasNodeCenter(
  node: PreparationCanvasNodeId,
  layouts: PreparationCanvasNodeLayouts = PREPARATION_CANVAS_LAYOUT.nodes,
): PreparationCanvasPoint {
  const { rect } = layouts[node];
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

export function resolvePreparationCanvasPort(
  port: PreparationCanvasPort,
  layouts: PreparationCanvasNodeLayouts = PREPARATION_CANVAS_LAYOUT.nodes,
): PreparationCanvasPoint {
  const { rect } = layouts[port.node];
  const offset = clamp(port.offset ?? 0.5, 0, 1);
  if (port.side === "top") return { x: rect.x + rect.width * offset, y: rect.y };
  if (port.side === "right") {
    return { x: rect.x + rect.width, y: rect.y + rect.height * offset };
  }
  if (port.side === "bottom") {
    return { x: rect.x + rect.width * offset, y: rect.y + rect.height };
  }
  return { x: rect.x, y: rect.y + rect.height * offset };
}

export function createPreparationCanvasEdgePath(
  edge: PreparationCanvasEdge,
  layouts: PreparationCanvasNodeLayouts = PREPARATION_CANVAS_LAYOUT.nodes,
): string {
  const from = resolvePreparationCanvasPort(edge.from, layouts);
  const to = resolvePreparationCanvasPort(edge.to, layouts);
  const fromControl = {
    x: from.x + edge.fromControl.x,
    y: from.y + edge.fromControl.y,
  };
  const toControl = {
    x: to.x + edge.toControl.x,
    y: to.y + edge.toControl.y,
  };
  return `M ${formatCanvasNumber(from.x)} ${formatCanvasNumber(from.y)} C ${formatCanvasNumber(fromControl.x)} ${formatCanvasNumber(fromControl.y)} ${formatCanvasNumber(toControl.x)} ${formatCanvasNumber(toControl.y)} ${formatCanvasNumber(to.x)} ${formatCanvasNumber(to.y)}`;
}

export function projectPreparationCanvasPointToMinimap(
  point: PreparationCanvasPoint,
): PreparationCanvasPoint {
  const { surface, minimap } = PREPARATION_CANVAS_LAYOUT;
  const innerWidth = minimap.width - minimap.padding * 2;
  const innerHeight = minimap.height - minimap.padding * 2;
  return {
    x: minimap.padding + (clamp(point.x, 0, surface.width) / surface.width) * innerWidth,
    y: minimap.padding + (clamp(point.y, 0, surface.height) / surface.height) * innerHeight,
  };
}

export function projectPreparationCanvasRectToMinimap(
  rect: PreparationCanvasRect,
): PreparationCanvasRect {
  const { surface, minimap } = PREPARATION_CANVAS_LAYOUT;
  const topLeft = projectPreparationCanvasPointToMinimap(rect);
  const innerWidth = minimap.width - minimap.padding * 2;
  const innerHeight = minimap.height - minimap.padding * 2;
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: (Math.max(0, rect.width) / surface.width) * innerWidth,
    height: (Math.max(0, rect.height) / surface.height) * innerHeight,
  };
}
