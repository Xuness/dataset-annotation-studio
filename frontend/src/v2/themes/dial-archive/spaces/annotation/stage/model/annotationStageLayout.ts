import type { CSSProperties } from "react";

/**
 * 素材施工场唯一的装饰几何事实源。
 *
 * 星尘坐标、仪器弧环、远景证据看板与胶片轨道步距都集中在这里；
 * SVG、TSX 和 CSS 变量只允许消费该模型派生的数据，不得各自镜像坐标。
 * 展台、控制台等单一消费者的框架布局仍由 CSS 网格负责。
 */

export interface StageStar {
  x: number;
  y: number;
  radius: number;
  opacity: number;
}

export interface StageStarfield {
  /** 远景稀疏星层 */
  far: readonly StageStar[];
  /** 中景星层 */
  mid: readonly StageStar[];
  /** 沿素材流向加密的水平流带 */
  band: readonly StageStar[];
}

export interface StageEvidenceSlot {
  id: string;
  leftPercent: number;
  topPercent: number;
  width: number;
  rotateY: number;
  code: string;
}

export interface StageArcSegment {
  startDegrees: number;
  endDegrees: number;
}

export const ANNOTATION_STAGE_LAYOUT = {
  /** 星空画布的设计取景框；SVG 以 slice 模式铺满视口 */
  frame: { width: 1920, height: 1080 },
  composition: {
    /** 展台中心、胶片当前项与地面聚光共享的视觉轴 */
    axisPercent: 41,
  },
  starfield: {
    seed: 20260804,
    farCount: 116,
    midCount: 52,
    bandCount: 84,
    band: { centerY: 512, spread: 130 },
  },
  ground: {
    /** 展台下方透视地面的网格间距（平面空间） */
    majorGrid: 132,
    minorGrid: 33,
    tiltDegrees: 55,
  },
  camera: {
    maxOffsetX: 76,
    maxOffsetY: 44,
    dragThreshold: 4,
    resetDurationMs: 320,
    floorDepth: 1,
    evidenceDepth: 0.46,
    groundDepth: 0.28,
    ghostDepth: 0.2,
  },
  evidence: [
    { id: "ev-a", leftPercent: 3.4, topPercent: 11, width: 196, rotateY: 16, code: "BG.01" },
    { id: "ev-b", leftPercent: 9.2, topPercent: 55, width: 150, rotateY: 9, code: "BG.02" },
    { id: "ev-c", leftPercent: 60.5, topPercent: 5.5, width: 172, rotateY: -13, code: "BG.03" },
  ] as readonly StageEvidenceSlot[],
  instrument: {
    /** 展台仪器 SVG 的私有取景框，弧环围绕其中心 */
    viewBox: { width: 1080, height: 760 },
    center: { x: 540, y: 380 },
    ringRadius: 384,
    tickCount: 72,
    majorEvery: 6,
    tickLength: 9,
    arcs: [
      { startDegrees: -24, endDegrees: 78 },
      { startDegrees: 150, endDegrees: 208 },
    ] as readonly StageArcSegment[],
  },
  viewport: {
    fitInset: 18,
    minScale: 0.04,
    maxScale: 8,
    maxFitScale: 1,
    zoomStep: 0.16,
    wheelZoomSensitivity: 0.00155,
    dragThreshold: 4,
    edgeOverscroll: 26,
    settleDurationMs: 240,
    openDelayMs: 190,
  },
  filmstrip: {
    itemWidth: 148,
    itemHeight: 100,
    gap: 14,
    /** 当前项前后各渲染多少张（窗口化渲染） */
    windowRadius: 16,
    /** 距离已装载末尾多少张时请求下一页 */
    loadMoreThreshold: 32,
    wheelStepThreshold: 56,
    wheelIntentResetMs: 140,
  },
  console: {
    progressSlots: 6,
  },
  workcells: {
    depthShift: 13,
    depthScaleStep: 0.04,
  },
  motion: {
    assetWalkDurationMs: 280,
    filmstripDurationMs: 280,
  },
  /** 巨型序号的补零位数 */
  indexPadding: 4,
} as const;

export const ANNOTATION_STAGE_FILM_STEP =
  ANNOTATION_STAGE_LAYOUT.filmstrip.itemWidth + ANNOTATION_STAGE_LAYOUT.filmstrip.gap;

export type AnnotationStageStyle = CSSProperties &
  Record<`--dial-archive-stage-${string}`, string | number>;

/**
 * 将模型中的共享几何与关键动效节奏投影为 CSS 变量。
 * TSX、SVG、手势控制器与样式表由此消费同一份事实，避免坐标镜像。
 */
export function createAnnotationStageStyle(): AnnotationStageStyle {
  const { camera, composition, filmstrip, ground, instrument, motion, viewport } =
    ANNOTATION_STAGE_LAYOUT;
  return {
    "--dial-archive-stage-axis-wide": `${composition.axisPercent}%`,
    "--dial-archive-stage-ground-major": `${ground.majorGrid}px`,
    "--dial-archive-stage-ground-minor": `${ground.minorGrid}px`,
    "--dial-archive-stage-ground-tilt": `${ground.tiltDegrees}deg`,
    "--dial-archive-stage-instrument-width": instrument.viewBox.width,
    "--dial-archive-stage-instrument-height": instrument.viewBox.height,
    "--dial-archive-stage-instrument-cx": `${instrument.center.x}px`,
    "--dial-archive-stage-instrument-cy": `${instrument.center.y}px`,
    "--dial-archive-stage-film-item-width": `${filmstrip.itemWidth}px`,
    "--dial-archive-stage-film-item-height": `${filmstrip.itemHeight}px`,
    "--dial-archive-stage-film-item-half": `${filmstrip.itemWidth / 2}px`,
    "--dial-archive-stage-film-step": `${ANNOTATION_STAGE_FILM_STEP}px`,
    "--dial-archive-stage-walk-duration": `${motion.assetWalkDurationMs}ms`,
    "--dial-archive-stage-film-duration": `${motion.filmstripDurationMs}ms`,
    "--dial-archive-stage-viewport-settle-duration": `${viewport.settleDurationMs}ms`,
    "--dial-archive-stage-camera-reset-duration": `${camera.resetDurationMs}ms`,
  };
}

/** 确定性伪随机（mulberry32）：星尘坐标必须可复现，不进入运行时随机 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createStars(
  random: () => number,
  count: number,
  project: (a: number, b: number) => { x: number; y: number },
  radiusRange: readonly [number, number],
  opacityRange: readonly [number, number],
): StageStar[] {
  const stars: StageStar[] = [];
  for (let index = 0; index < count; index += 1) {
    const point = project(random(), random());
    stars.push({
      x: Math.round(point.x * 10) / 10,
      y: Math.round(point.y * 10) / 10,
      radius:
        Math.round((radiusRange[0] + random() * (radiusRange[1] - radiusRange[0])) * 100) / 100,
      opacity:
        Math.round((opacityRange[0] + random() * (opacityRange[1] - opacityRange[0])) * 100) / 100,
    });
  }
  return stars;
}

export function createStageStarfield(): StageStarfield {
  const { frame, starfield } = ANNOTATION_STAGE_LAYOUT;
  const random = mulberry32(starfield.seed);
  const fullFrame = (a: number, b: number) => ({ x: a * frame.width, y: b * frame.height });
  const bandFrame = (a: number, b: number) => ({
    x: a * frame.width,
    // 两个均匀样本求和近似三角分布，向流带中心聚拢
    y: starfield.band.centerY + (a + b - 1) * starfield.band.spread,
  });
  return {
    far: createStars(random, starfield.farCount, fullFrame, [0.5, 1.3], [0.14, 0.5]),
    mid: createStars(random, starfield.midCount, fullFrame, [0.9, 2.1], [0.24, 0.66]),
    band: createStars(random, starfield.bandCount, bandFrame, [0.4, 1.5], [0.2, 0.62]),
  };
}

function polarPoint(cx: number, cy: number, radius: number, degrees: number) {
  const angle = ((degrees - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

export function createStageArcPath(segment: StageArcSegment): string {
  const { center, ringRadius } = ANNOTATION_STAGE_LAYOUT.instrument;
  const from = polarPoint(center.x, center.y, ringRadius, segment.startDegrees);
  const to = polarPoint(center.x, center.y, ringRadius, segment.endDegrees);
  const largeArc = segment.endDegrees - segment.startDegrees > 180 ? 1 : 0;
  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${ringRadius} ${ringRadius} 0 ${largeArc} 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
}

export interface StageTick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  major: boolean;
}

export function createStageRingTicks(): StageTick[] {
  const { center, ringRadius, tickCount, majorEvery, tickLength } =
    ANNOTATION_STAGE_LAYOUT.instrument;
  const ticks: StageTick[] = [];
  for (let index = 0; index < tickCount; index += 1) {
    const major = index % majorEvery === 0;
    const degrees = (index / tickCount) * 360;
    const inner = polarPoint(
      center.x,
      center.y,
      ringRadius - (major ? tickLength * 1.9 : tickLength),
      degrees,
    );
    const outer = polarPoint(center.x, center.y, ringRadius, degrees);
    ticks.push({
      x1: Math.round(inner.x * 100) / 100,
      y1: Math.round(inner.y * 100) / 100,
      x2: Math.round(outer.x * 100) / 100,
      y2: Math.round(outer.y * 100) / 100,
      major,
    });
  }
  return ticks;
}

export function formatStageIndex(index: number): string {
  if (index < 0) return "—".repeat(ANNOTATION_STAGE_LAYOUT.indexPadding);
  return String(index + 1).padStart(ANNOTATION_STAGE_LAYOUT.indexPadding, "0");
}

export function formatStageByteSize(byteSize: number): string {
  if (!Number.isFinite(byteSize) || byteSize < 0) return "—";
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(2)} MB`;
}
