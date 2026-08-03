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

interface PreparationCanvasJunctionReference {
  readonly junction: string;
}

type PreparationCanvasEdgeEndpoint = PreparationCanvasPort | PreparationCanvasJunctionReference;

export type PreparationCanvasEdgeActivation =
  "always" | "transform" | "preview" | "recovery" | PreparationCapabilityId;

export interface PreparationCanvasEdge {
  readonly id: string;
  readonly from: PreparationCanvasEdgeEndpoint;
  readonly to: PreparationCanvasEdgeEndpoint;
  readonly via: readonly PreparationCanvasPoint[];
  readonly activation: PreparationCanvasEdgeActivation;
  readonly signal: "primary" | "recovery";
}

export interface PreparationCanvasJunction {
  readonly id: string;
  readonly point: PreparationCanvasPoint;
  readonly activation: "always" | "transform";
  readonly kind: "branch" | "merge";
}

export interface PreparationCanvasNodeLayout {
  readonly rect: PreparationCanvasRect;
  readonly revealOrder: number;
  readonly elevation: number;
}

export type PreparationCanvasNodeLayouts = Readonly<
  Record<PreparationCanvasNodeId, PreparationCanvasNodeLayout>
>;

export interface PreparationCanvasGaugeArc {
  readonly start: number;
  readonly end: number;
}

export interface PreparationCanvasGauge {
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly tickCount: number;
  readonly tickLength: number;
  readonly majorEvery: number;
  readonly spinSeconds: number;
  readonly crosshair: boolean;
  readonly accentArcs: readonly PreparationCanvasGaugeArc[];
}

export type PreparationCanvasFieldId = "input" | "transform" | "verify" | "trace";

export interface PreparationCanvasField {
  readonly id: PreparationCanvasFieldId;
  readonly index: string;
  readonly kicker: string;
  readonly title: string;
  readonly rect: PreparationCanvasRect;
  readonly axis: "horizontal" | "vertical";
}

const nodes = {
  source: {
    rect: { x: 360, y: 960, width: 340, height: 190 },
    revealOrder: 0,
    elevation: 10,
  },
  scope: {
    rect: { x: 850, y: 850, width: 320, height: 210 },
    revealOrder: 1,
    elevation: 12,
  },
  geometry: {
    rect: { x: 1400, y: 380, width: 370, height: 210 },
    revealOrder: 3,
    elevation: 16,
  },
  encoding: {
    rect: { x: 1510, y: 840, width: 370, height: 210 },
    revealOrder: 4,
    elevation: 14,
  },
  identity: {
    rect: { x: 1400, y: 1300, width: 370, height: 210 },
    revealOrder: 5,
    elevation: 12,
  },
  preview: {
    rect: { x: 2250, y: 760, width: 370, height: 210 },
    revealOrder: 6,
    elevation: 17,
  },
  commit: {
    rect: { x: 2920, y: 510, width: 410, height: 220 },
    revealOrder: 7,
    elevation: 20,
  },
  recovery: {
    rect: { x: 2480, y: 1495, width: 620, height: 180 },
    revealOrder: 8,
    elevation: 9,
  },
} as const satisfies PreparationCanvasNodeLayouts;

const junctions: Readonly<Record<string, PreparationCanvasJunction>> = {
  branch: {
    id: "branch",
    point: { x: 1280, y: 955 },
    activation: "always",
    kind: "branch",
  },
  merge: {
    id: "merge",
    point: { x: 2140, y: 865 },
    activation: "transform",
    kind: "merge",
  },
};

const edges = [
  {
    id: "source-scope",
    from: { node: "source", side: "right", offset: 0.55 },
    to: { node: "scope", side: "left", offset: 0.65 },
    via: [{ x: 772, y: 1064.5 }],
    activation: "always",
    signal: "primary",
  },
  {
    id: "scope-branch",
    from: { node: "scope", side: "right", offset: 0.5 },
    to: { junction: "branch" },
    via: [{ x: 1230, y: 955 }],
    activation: "always",
    signal: "primary",
  },
  {
    id: "branch-geometry",
    from: { junction: "branch" },
    to: { node: "geometry", side: "left", offset: 0.5 },
    via: [
      { x: 1320, y: 955 },
      { x: 1320, y: 645 },
      { x: 1400, y: 565 },
    ],
    activation: "geometry",
    signal: "primary",
  },
  {
    id: "branch-encoding",
    from: { junction: "branch" },
    to: { node: "encoding", side: "left", offset: 0.5 },
    via: [
      { x: 1400, y: 955 },
      { x: 1410, y: 945 },
    ],
    activation: "encoding",
    signal: "primary",
  },
  {
    id: "branch-identity",
    from: { junction: "branch" },
    to: { node: "identity", side: "left", offset: 0.5 },
    via: [
      { x: 1320, y: 955 },
      { x: 1320, y: 1325 },
    ],
    activation: "identity",
    signal: "primary",
  },
  {
    id: "geometry-merge",
    from: { node: "geometry", side: "right", offset: 0.5 },
    to: { junction: "merge" },
    via: [
      { x: 1940, y: 485 },
      { x: 2020, y: 565 },
      { x: 2020, y: 745 },
    ],
    activation: "geometry",
    signal: "primary",
  },
  {
    id: "encoding-merge",
    from: { node: "encoding", side: "right", offset: 0.5 },
    to: { junction: "merge" },
    via: [
      { x: 1980, y: 945 },
      { x: 2060, y: 865 },
    ],
    activation: "encoding",
    signal: "primary",
  },
  {
    id: "identity-merge",
    from: { node: "identity", side: "right", offset: 0.5 },
    to: { junction: "merge" },
    via: [
      { x: 1940, y: 1405 },
      { x: 2020, y: 1325 },
      { x: 2020, y: 985 },
    ],
    activation: "identity",
    signal: "primary",
  },
  {
    id: "merge-preview",
    from: { junction: "merge" },
    to: { node: "preview", side: "left", offset: 0.5 },
    via: [{ x: 2200, y: 865 }],
    activation: "transform",
    signal: "primary",
  },
  {
    id: "preview-commit",
    from: { node: "preview", side: "right", offset: 0.5 },
    to: { node: "commit", side: "left", offset: 0.65 },
    via: [
      { x: 2700, y: 865 },
      { x: 2780, y: 785 },
      { x: 2780, y: 733 },
      { x: 2860, y: 653 },
    ],
    activation: "preview",
    signal: "primary",
  },
  {
    id: "commit-recovery",
    from: { node: "commit", side: "bottom", offset: 0.45 },
    to: { node: "recovery", side: "right", offset: 0.5 },
    via: [
      { x: 3184.5, y: 810 },
      { x: 3480, y: 810 },
      { x: 3480, y: 1405 },
      { x: 3300, y: 1585 },
    ],
    activation: "recovery",
    signal: "recovery",
  },
  {
    id: "recovery-source",
    from: { node: "recovery", side: "left", offset: 0.5 },
    to: { node: "source", side: "bottom", offset: 0.5 },
    via: [
      { x: 2350, y: 1585 },
      { x: 2270, y: 1665 },
      { x: 900, y: 1665 },
      { x: 820, y: 1585 },
      { x: 530, y: 1585 },
    ],
    activation: "recovery",
    signal: "recovery",
  },
] as const satisfies readonly PreparationCanvasEdge[];

export const PREPARATION_CANVAS_LAYOUT = {
  surface: { width: 4200, height: 2300 },
  taskBounds: { x: 280, y: 300, width: 3260, height: 1440 },
  overviewBounds: { x: 180, y: 240, width: 3480, height: 1560 },
  camera: {
    initialScale: 0.68,
    minScale: 0.3,
    maxScale: 1.42,
    maxFitScale: 0.74,
    focusScale: 0.78,
    compactBreakpoint: 900,
    fitInset: 62,
    compactFitInset: 24,
    zoomStep: 0.1,
    wheelZoomSensitivity: 0.00115,
    keyboardPanStep: 46,
    keyboardPanStepFast: 104,
    focusDurationMs: 380,
  },
  nodes,
  junctions,
  edges,
  fields: [
    {
      id: "input",
      index: "00",
      kicker: "SOURCE EVIDENCE",
      title: "INPUT / SCOPE",
      rect: { x: 180, y: 500, width: 1080, height: 820 },
      axis: "horizontal",
    },
    {
      id: "transform",
      index: "01",
      kicker: "PARALLEL PROCESS FIELD",
      title: "TRANSFORM ARRAY",
      rect: { x: 1240, y: 220, width: 1040, height: 1390 },
      axis: "vertical",
    },
    {
      id: "verify",
      index: "02",
      kicker: "CHANGE PROJECTION",
      title: "VERIFY / COMMIT",
      rect: { x: 2180, y: 360, width: 1240, height: 880 },
      axis: "horizontal",
    },
    {
      id: "trace",
      index: "03",
      kicker: "SOURCE VERSION TRACE",
      title: "RECOVERY LINE",
      rect: { x: 2040, y: 1380, width: 1460, height: 390 },
      axis: "horizontal",
    },
  ] satisfies readonly PreparationCanvasField[],
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
    [
      { x: 2860, y: 1920 },
      { x: 3500, y: 1920 },
      { x: 3640, y: 1780 },
      { x: 4060, y: 1780 },
    ],
  ],
  backgroundFrames: [
    {
      id: "source-evidence",
      code: "SOURCE / EVIDENCE",
      rect: { x: 190, y: 410, width: 910, height: 610 },
      clipPath: "polygon(0 0, 92% 0, 100% 12%, 100% 100%, 8% 100%, 0 88%)",
      opacity: 0.2,
    },
    {
      id: "geometry-evidence",
      code: "GEOMETRY / MEASURE",
      rect: { x: 1160, y: 180, width: 980, height: 610 },
      clipPath: "polygon(7% 0, 100% 0, 100% 86%, 93% 100%, 0 100%, 0 14%)",
      opacity: 0.14,
    },
    {
      id: "identity-evidence",
      code: "IDENTITY / TRACE",
      rect: { x: 1130, y: 1090, width: 980, height: 650 },
      clipPath: "polygon(0 0, 100% 0, 100% 90%, 90% 100%, 0 100%)",
      opacity: 0.11,
    },
    {
      id: "preview-evidence",
      code: "PREVIEW / DELTA",
      rect: { x: 2160, y: 340, width: 1090, height: 720 },
      clipPath: "polygon(0 0, 94% 0, 100% 9%, 100% 100%, 0 100%)",
      opacity: 0.16,
    },
    {
      id: "commit-evidence",
      code: "COMMIT / WRITE",
      rect: { x: 2920, y: 920, width: 880, height: 590 },
      clipPath: "polygon(9% 0, 100% 0, 100% 100%, 0 100%, 0 9%)",
      opacity: 0.1,
    },
  ],
  landmarks: {
    ghostWord: { x: 120, y: 180 },
    contours: { x: 1800, y: 420, width: 850, height: 850 },
    fusionLabel: { x: 1840, y: 1120, width: 460, height: 46 },
  },
  gauges: [
    {
      id: "gauge-fusion",
      cx: 2050,
      cy: 875,
      radius: 360,
      tickCount: 84,
      tickLength: 13,
      majorEvery: 7,
      spinSeconds: 88,
      crosshair: true,
      accentArcs: [
        { start: -54, end: -10 },
        { start: 118, end: 148 },
      ],
    },
    {
      id: "gauge-recovery",
      cx: 3310,
      cy: 1580,
      radius: 235,
      tickCount: 56,
      tickLength: 10,
      majorEvery: 7,
      spinSeconds: 68,
      crosshair: false,
      accentArcs: [{ start: 18, end: 84 }],
    },
  ],
  grid: {
    minor: 96,
    major: 480,
  },
  minimap: {
    width: 182,
    height: 82,
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

function isJunctionReference(
  endpoint: PreparationCanvasEdgeEndpoint,
): endpoint is PreparationCanvasJunctionReference {
  return "junction" in endpoint;
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

function resolvePreparationCanvasEndpoint(
  endpoint: PreparationCanvasEdgeEndpoint,
  layouts: PreparationCanvasNodeLayouts,
): PreparationCanvasPoint {
  if (!isJunctionReference(endpoint)) return resolvePreparationCanvasPort(endpoint, layouts);
  const junction = PREPARATION_CANVAS_LAYOUT.junctions[endpoint.junction];
  if (!junction) throw new Error(`Unknown preparation canvas junction: ${endpoint.junction}`);
  return junction.point;
}

export function getPreparationCanvasEdgePoints(
  edge: PreparationCanvasEdge,
  layouts: PreparationCanvasNodeLayouts = PREPARATION_CANVAS_LAYOUT.nodes,
): readonly PreparationCanvasPoint[] {
  return [
    resolvePreparationCanvasEndpoint(edge.from, layouts),
    ...edge.via,
    resolvePreparationCanvasEndpoint(edge.to, layouts),
  ];
}

export function createPreparationCanvasPolylinePath(
  points: readonly PreparationCanvasPoint[],
): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return [
    `M ${formatCanvasNumber(first.x)} ${formatCanvasNumber(first.y)}`,
    ...rest.map((point) => `L ${formatCanvasNumber(point.x)} ${formatCanvasNumber(point.y)}`),
  ].join(" ");
}

export function createPreparationCanvasEdgePath(
  edge: PreparationCanvasEdge,
  layouts: PreparationCanvasNodeLayouts = PREPARATION_CANVAS_LAYOUT.nodes,
): string {
  return createPreparationCanvasPolylinePath(getPreparationCanvasEdgePoints(edge, layouts));
}

export function projectPreparationCanvasPointToMinimap(
  point: PreparationCanvasPoint,
): PreparationCanvasPoint {
  const { overviewBounds, minimap } = PREPARATION_CANVAS_LAYOUT;
  const innerWidth = minimap.width - minimap.padding * 2;
  const innerHeight = minimap.height - minimap.padding * 2;
  const relativeX = clamp(point.x - overviewBounds.x, 0, overviewBounds.width);
  const relativeY = clamp(point.y - overviewBounds.y, 0, overviewBounds.height);
  return {
    x: minimap.padding + (relativeX / overviewBounds.width) * innerWidth,
    y: minimap.padding + (relativeY / overviewBounds.height) * innerHeight,
  };
}

export function projectPreparationCanvasRectToMinimap(
  rect: PreparationCanvasRect,
): PreparationCanvasRect {
  const { overviewBounds, minimap } = PREPARATION_CANVAS_LAYOUT;
  const topLeft = projectPreparationCanvasPointToMinimap(rect);
  const innerWidth = minimap.width - minimap.padding * 2;
  const innerHeight = minimap.height - minimap.padding * 2;
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: (Math.max(0, rect.width) / overviewBounds.width) * innerWidth,
    height: (Math.max(0, rect.height) / overviewBounds.height) * innerHeight,
  };
}
