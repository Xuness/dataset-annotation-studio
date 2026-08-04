import type { CSSProperties } from "react";

import type { AnnotationWorkcellId } from "../../../../../../pages/spaces/spacePageModel";

/**
 * 素材施工场唯一的装饰几何事实源。
 *
 * 登记点阵、结构导线、仪器弧环、远景证据看板与胶片轨道步距都集中在这里；
 * SVG、TSX 和 CSS 变量只允许消费该模型派生的数据，不得各自镜像坐标。
 * 展台、控制台等单一消费者的框架布局仍由 CSS 网格负责。
 */

export interface StageRegistrationPoint {
  x: number;
  y: number;
  radius: number;
  opacity: number;
}

export interface StageRegistrationField {
  /** 纸面环境中的稀疏定位点 */
  ambient: readonly StageRegistrationPoint[];
  /** 靠近主要构件的测量点 */
  measure: readonly StageRegistrationPoint[];
  /** 沿素材流向聚集的登记点流 */
  flow: readonly StageRegistrationPoint[];
}

export interface StageRegistrationGuide {
  id: string;
  tone: "hairline" | "muted" | "signal";
  path: string;
}

export interface StageEvidenceSlot {
  id: string;
  leftPercent: number;
  topPercent: number;
  width: number;
  rotateY: number;
  rotateZ: number;
  translateZ: number;
  driftX: number;
  driftY: number;
  driftSeconds: number;
  driftDelay: number;
  code: string;
}

export interface StageWorkcellPlane {
  leftPercent: number;
  topPercent: number;
  width: number;
  height: number;
  /** 为投影后的视觉面与独立二维热区预留的容器外扩量。 */
  hitSlop: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  translateZ: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  idleX: number;
  idleY: number;
  idleSeconds: number;
  idleDelay: number;
}

export interface StageArcSegment {
  startDegrees: number;
  endDegrees: number;
}

export const ANNOTATION_STAGE_LAYOUT = {
  /** 编辑式画布的设计取景框；SVG 以 slice 模式铺满视口 */
  frame: { width: 1920, height: 1080 },
  composition: {
    /** 展台中心、胶片当前项与素材流带共享的视觉轴 */
    axisPercent: 39.5,
  },
  scene: {
    perspective: 1760,
    perspectiveOriginX: 45,
    perspectiveOriginY: 48,
    specimenZ: 88,
  },
  registrationField: {
    seed: 20260804,
    ambientCount: 58,
    measureCount: 42,
    flowCount: 92,
    flow: {
      centerY: 548,
      spread: 84,
      waveAmplitude: 42,
      waveCycles: 1.12,
    },
  },
  registrationGuides: [
    {
      id: "guide-primary",
      tone: "hairline",
      path: "M -120 728 H 286 L 338 676 H 706 L 754 628 H 1018",
    },
    {
      id: "guide-upper",
      tone: "muted",
      path: "M 1052 148 H 1474 L 1534 208 H 2040",
    },
    {
      id: "guide-lower",
      tone: "hairline",
      path: "M 44 958 H 326 L 378 906 H 746",
    },
    {
      id: "guide-signal",
      tone: "signal",
      path: "M 1574 468 H 1762 L 1800 506 H 1948",
    },
  ] as readonly StageRegistrationGuide[],
  camera: {
    maxOffsetX: 76,
    maxOffsetY: 44,
    dragThreshold: 4,
    resetDurationMs: 320,
    sceneDepth: 1,
    evidenceDepth: 0.46,
    ghostDepth: 0.2,
  },
  evidence: [
    {
      id: "ev-a",
      leftPercent: 3.2,
      topPercent: 60,
      width: 158,
      rotateY: 7,
      rotateZ: -1.2,
      translateZ: -360,
      driftX: 10,
      driftY: -6,
      driftSeconds: 24,
      driftDelay: -3,
      code: "REF.01",
    },
    {
      id: "ev-b",
      leftPercent: 56.5,
      topPercent: 7,
      width: 148,
      rotateY: -4,
      rotateZ: 0.7,
      translateZ: -430,
      driftX: -8,
      driftY: 5,
      driftSeconds: 28,
      driftDelay: -11,
      code: "REF.02",
    },
    {
      id: "ev-c",
      leftPercent: 88.2,
      topPercent: 55,
      width: 138,
      rotateY: -7,
      rotateZ: -0.6,
      translateZ: -390,
      driftX: -12,
      driftY: -4,
      driftSeconds: 26,
      driftDelay: -7,
      code: "REF.03",
    },
  ] as readonly StageEvidenceSlot[],
  instrument: {
    /** 展台仪器 SVG 的私有取景框，弧环围绕其中心 */
    viewBox: { width: 1080, height: 760 },
    center: { x: 540, y: 380 },
    ringRadius: 354,
    tickCount: 64,
    majorEvery: 8,
    tickLength: 9,
    arcs: [
      { startDegrees: -18, endDegrees: 58 },
      { startDegrees: 156, endDegrees: 218 },
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
    /** 与轨道两端 CSS 渐隐保持一致；当前项越界时只补位到这里。 */
    edgeFadePercent: 11,
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
    previewLift: 96,
    planes: {
      edit: {
        leftPercent: 71.5,
        topPercent: 61,
        width: 386,
        height: 152,
        hitSlop: { top: 24, right: 24, bottom: 24, left: 72 },
        translateZ: -142,
        rotateX: 0,
        rotateY: -5,
        rotateZ: -0.35,
        idleX: -5,
        idleY: -7,
        idleSeconds: 10.5,
        idleDelay: -2.4,
      },
      production: {
        leftPercent: 72.5,
        topPercent: 34,
        width: 348,
        height: 136,
        hitSlop: { top: 24, right: 24, bottom: 24, left: 112 },
        translateZ: -292,
        rotateX: -0.5,
        rotateY: -7,
        rotateZ: 0.55,
        idleX: 7,
        idleY: -5,
        idleSeconds: 13,
        idleDelay: -7.2,
      },
      dossier: {
        leftPercent: -3,
        topPercent: 7,
        width: 310,
        height: 148,
        hitSlop: { top: 24, right: 112, bottom: 40, left: 24 },
        translateZ: -226,
        rotateX: 0.5,
        rotateY: 5,
        rotateZ: -0.55,
        idleX: 5,
        idleY: 6,
        idleSeconds: 11.5,
        idleDelay: -5.5,
      },
    } satisfies Readonly<Record<"edit" | "production" | "dossier", StageWorkcellPlane>>,
  },
  motion: {
    assetWalkDurationMs: 280,
    filmstripDurationMs: 280,
    workcellPreviewDurationMs: 260,
    workcellOpenDurationMs: 820,
    workcellSwitchDurationMs: 640,
    workcellCloseDurationMs: 700,
  },
  /** 巨型序号的补零位数 */
  indexPadding: 4,
} as const;

export const ANNOTATION_STAGE_FILM_STEP =
  ANNOTATION_STAGE_LAYOUT.filmstrip.itemWidth + ANNOTATION_STAGE_LAYOUT.filmstrip.gap;

export type AnnotationStageStyle = CSSProperties &
  Record<`--dial-archive-stage-${string}`, string | number>;

export type StageWorkcellPlaneStyle = CSSProperties &
  Record<`--dial-archive-workcell-${string}`, string | number>;

/** 总览入口与四级展开壳层共用同一组空间坐标，避免转场起点漂移。 */
export function createStageWorkcellPlaneStyle(
  workcell: AnnotationWorkcellId,
): StageWorkcellPlaneStyle {
  const plane = ANNOTATION_STAGE_LAYOUT.workcells.planes[workcell];
  return {
    "--dial-archive-workcell-left": `${plane.leftPercent}%`,
    "--dial-archive-workcell-top": `${plane.topPercent}%`,
    "--dial-archive-workcell-width": `${plane.width}px`,
    "--dial-archive-workcell-height": `${plane.height}px`,
    "--dial-archive-workcell-hit-top": `${plane.hitSlop.top}px`,
    "--dial-archive-workcell-hit-right": `${plane.hitSlop.right}px`,
    "--dial-archive-workcell-hit-bottom": `${plane.hitSlop.bottom}px`,
    "--dial-archive-workcell-hit-left": `${plane.hitSlop.left}px`,
    "--dial-archive-workcell-z": `${plane.translateZ}px`,
    "--dial-archive-workcell-rx": `${plane.rotateX}deg`,
    "--dial-archive-workcell-ry": `${plane.rotateY}deg`,
    "--dial-archive-workcell-rz": `${plane.rotateZ}deg`,
    "--dial-archive-workcell-idle-x": `${plane.idleX}px`,
    "--dial-archive-workcell-idle-y": `${plane.idleY}px`,
    "--dial-archive-workcell-idle-duration": `${plane.idleSeconds}s`,
    "--dial-archive-workcell-idle-delay": `${plane.idleDelay}s`,
    "--dial-archive-workcell-preview-lift": `${ANNOTATION_STAGE_LAYOUT.workcells.previewLift}px`,
  };
}

/**
 * 将模型中的共享几何与关键动效节奏投影为 CSS 变量。
 * TSX、SVG、手势控制器与样式表由此消费同一份事实，避免坐标镜像。
 */
export function createAnnotationStageStyle(): AnnotationStageStyle {
  const { camera, composition, filmstrip, instrument, motion, scene, viewport } =
    ANNOTATION_STAGE_LAYOUT;
  return {
    "--dial-archive-stage-axis-wide": `${composition.axisPercent}%`,
    "--dial-archive-stage-axis-span": `${composition.axisPercent * 2}%`,
    "--dial-archive-stage-perspective": `${scene.perspective}px`,
    "--dial-archive-stage-perspective-origin": `${scene.perspectiveOriginX}% ${scene.perspectiveOriginY}%`,
    "--dial-archive-stage-specimen-z": `${scene.specimenZ}px`,
    "--dial-archive-stage-instrument-width": instrument.viewBox.width,
    "--dial-archive-stage-instrument-height": instrument.viewBox.height,
    "--dial-archive-stage-instrument-cx": `${instrument.center.x}px`,
    "--dial-archive-stage-instrument-cy": `${instrument.center.y}px`,
    "--dial-archive-stage-film-item-width": `${filmstrip.itemWidth}px`,
    "--dial-archive-stage-film-item-height": `${filmstrip.itemHeight}px`,
    "--dial-archive-stage-film-item-half": `${filmstrip.itemWidth / 2}px`,
    "--dial-archive-stage-film-step": `${ANNOTATION_STAGE_FILM_STEP}px`,
    "--dial-archive-stage-film-fade": `${filmstrip.edgeFadePercent}%`,
    "--dial-archive-stage-walk-duration": `${motion.assetWalkDurationMs}ms`,
    "--dial-archive-stage-film-duration": `${motion.filmstripDurationMs}ms`,
    "--dial-archive-stage-workcell-preview-duration": `${motion.workcellPreviewDurationMs}ms`,
    "--dial-archive-stage-workcell-open-duration": `${motion.workcellOpenDurationMs}ms`,
    "--dial-archive-stage-workcell-switch-duration": `${motion.workcellSwitchDurationMs}ms`,
    "--dial-archive-stage-workcell-close-duration": `${motion.workcellCloseDurationMs}ms`,
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

function createRegistrationPoints(
  random: () => number,
  count: number,
  project: (a: number, b: number) => { x: number; y: number },
  radiusRange: readonly [number, number],
  opacityRange: readonly [number, number],
): StageRegistrationPoint[] {
  const points: StageRegistrationPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const point = project(random(), random());
    points.push({
      x: Math.round(point.x * 10) / 10,
      y: Math.round(point.y * 10) / 10,
      radius:
        Math.round((radiusRange[0] + random() * (radiusRange[1] - radiusRange[0])) * 100) / 100,
      opacity:
        Math.round((opacityRange[0] + random() * (opacityRange[1] - opacityRange[0])) * 100) / 100,
    });
  }
  return points;
}

export function createStageRegistrationField(): StageRegistrationField {
  const { frame, registrationField } = ANNOTATION_STAGE_LAYOUT;
  const random = mulberry32(registrationField.seed);
  const fullFrame = (a: number, b: number) => ({ x: a * frame.width, y: b * frame.height });
  const flowFrame = (a: number, b: number) => {
    const x = a * frame.width;
    const wave = Math.sin((a * registrationField.flow.waveCycles + 0.12) * Math.PI * 2);
    const envelope = 0.42 + Math.sin(a * Math.PI) * 0.58;
    return {
      x,
      // 登记点沿素材流向聚散，保留起伏但不把纸面误读为星空。
      y:
        registrationField.flow.centerY +
        wave * registrationField.flow.waveAmplitude +
        (a + b - 1) * registrationField.flow.spread * envelope,
    };
  };
  return {
    ambient: createRegistrationPoints(
      random,
      registrationField.ambientCount,
      fullFrame,
      [0.45, 1.05],
      [0.12, 0.32],
    ),
    measure: createRegistrationPoints(
      random,
      registrationField.measureCount,
      fullFrame,
      [0.7, 1.45],
      [0.18, 0.42],
    ),
    flow: createRegistrationPoints(
      random,
      registrationField.flowCount,
      flowFrame,
      [0.45, 1.2],
      [0.16, 0.44],
    ),
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

export interface FilmstripVisibilityInput {
  currentOffset: number;
  viewportLeft: number;
  viewportWidth: number;
  cellLeft: number;
  cellRight: number;
}

/**
 * 让当前胶片保持在原位置；只有越过两端渐隐安全区时才做最短补位。
 * 返回值仍是轨道的 translateX 像素值，调用者无需维护第二套坐标。
 */
export function resolveFilmstripTrackOffset({
  currentOffset,
  viewportLeft,
  viewportWidth,
  cellLeft,
  cellRight,
}: FilmstripVisibilityInput): number {
  if (
    ![currentOffset, viewportLeft, viewportWidth, cellLeft, cellRight].every(Number.isFinite) ||
    viewportWidth <= 0 ||
    cellRight <= cellLeft
  ) {
    return currentOffset;
  }

  const edgeInset = (viewportWidth * ANNOTATION_STAGE_LAYOUT.filmstrip.edgeFadePercent) / 100;
  const safeLeft = viewportLeft + edgeInset;
  const safeRight = viewportLeft + viewportWidth - edgeInset;
  if (cellLeft < safeLeft) return currentOffset + (safeLeft - cellLeft);
  if (cellRight > safeRight) return currentOffset - (cellRight - safeRight);
  return currentOffset;
}
