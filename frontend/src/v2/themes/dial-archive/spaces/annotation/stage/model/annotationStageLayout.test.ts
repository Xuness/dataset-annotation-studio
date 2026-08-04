import { describe, expect, test } from "vitest";

import {
  ANNOTATION_STAGE_LAYOUT,
  createStageArcPath,
  createStageRingTicks,
  createStageRegistrationField,
  createAnnotationStageStyle,
  createStageWorkcellPlaneStyle,
  formatStageByteSize,
  formatStageIndex,
  resolveFilmstripTrackOffset,
} from "./annotationStageLayout";

describe("annotation stage layout", () => {
  test("registration field is deterministic across calls", () => {
    const first = createStageRegistrationField();
    const second = createStageRegistrationField();
    expect(first).toEqual(second);
    expect(first.ambient).toHaveLength(ANNOTATION_STAGE_LAYOUT.registrationField.ambientCount);
    expect(first.flow).toHaveLength(ANNOTATION_STAGE_LAYOUT.registrationField.flowCount);
  });

  test("registration points gather around the shaped material flow line", () => {
    const { flow } = createStageRegistrationField();
    const { centerY, spread, waveAmplitude, waveCycles } =
      ANNOTATION_STAGE_LAYOUT.registrationField.flow;
    const { width } = ANNOTATION_STAGE_LAYOUT.frame;
    for (const point of flow) {
      const progress = point.x / width;
      const flowCenter =
        centerY + Math.sin((progress * waveCycles + 0.12) * Math.PI * 2) * waveAmplitude;
      expect(Math.abs(point.y - flowCenter)).toBeLessThanOrEqual(spread + 0.5);
    }
  });

  test("background guides stay orthogonal instead of using soft curves", () => {
    for (const guide of ANNOTATION_STAGE_LAYOUT.registrationGuides) {
      expect(guide.path).not.toMatch(/[CQA]/);
    }
  });

  test("ring ticks respect the major cadence", () => {
    const ticks = createStageRingTicks();
    expect(ticks).toHaveLength(ANNOTATION_STAGE_LAYOUT.instrument.tickCount);
    expect(ticks.filter((tick) => tick.major)).toHaveLength(
      ANNOTATION_STAGE_LAYOUT.instrument.tickCount / ANNOTATION_STAGE_LAYOUT.instrument.majorEvery,
    );
  });

  test("arc paths are valid svg arcs", () => {
    for (const arc of ANNOTATION_STAGE_LAYOUT.instrument.arcs) {
      expect(createStageArcPath(arc)).toMatch(
        /^M [\d.-]+ [\d.-]+ A \d+ \d+ 0 [01] 1 [\d.-]+ [\d.-]+$/,
      );
    }
  });

  test("formats sequence indexes and byte sizes for the console", () => {
    expect(formatStageIndex(141)).toBe("0142");
    expect(formatStageIndex(-1)).toBe("————");
    expect(formatStageByteSize(512)).toBe("512 B");
    expect(formatStageByteSize(4_194_304)).toBe("4.00 MB");
    expect(formatStageByteSize(-1)).toBe("—");
  });

  test("projects shared geometry and motion facts into theme css variables", () => {
    const style = createAnnotationStageStyle();
    expect(style["--dial-archive-stage-perspective"]).toBe(
      `${ANNOTATION_STAGE_LAYOUT.scene.perspective}px`,
    );
    expect(style["--dial-archive-stage-axis-span"]).toBe(
      `${ANNOTATION_STAGE_LAYOUT.composition.axisPercent * 2}%`,
    );
    expect(style["--dial-archive-stage-film-step"]).toBe(
      `${ANNOTATION_STAGE_LAYOUT.filmstrip.itemWidth + ANNOTATION_STAGE_LAYOUT.filmstrip.gap}px`,
    );
    expect(style["--dial-archive-stage-film-fade"]).toBe(
      `${ANNOTATION_STAGE_LAYOUT.filmstrip.edgeFadePercent}%`,
    );
    expect(style["--dial-archive-stage-instrument-cx"]).toBe(
      `${ANNOTATION_STAGE_LAYOUT.instrument.center.x}px`,
    );
    expect(style["--dial-archive-stage-walk-duration"]).toBe(
      `${ANNOTATION_STAGE_LAYOUT.motion.assetWalkDurationMs}ms`,
    );
    expect(style["--dial-archive-stage-workcell-preview-duration"]).toBe(
      `${ANNOTATION_STAGE_LAYOUT.motion.workcellPreviewDurationMs}ms`,
    );
    expect(style["--dial-archive-stage-workcell-open-duration"]).toBe(
      `${ANNOTATION_STAGE_LAYOUT.motion.workcellOpenDurationMs}ms`,
    );
  });

  test("keeps every overview workcell on an explicit three-dimensional plane", () => {
    const planes = Object.values(ANNOTATION_STAGE_LAYOUT.workcells.planes);
    expect(planes).toHaveLength(3);
    expect(new Set(planes.map((plane) => plane.translateZ)).size).toBe(3);
    expect(planes.every((plane) => plane.translateZ < 0)).toBe(true);
    expect(planes.every((plane) => plane.width > plane.height)).toBe(true);
    expect(planes.every((plane) => plane.idleSeconds > 0)).toBe(true);
    expect(planes.every((plane) => Object.values(plane.hitSlop).every((value) => value > 0))).toBe(
      true,
    );
  });

  test("projects each workcell portal and expanded shell from one plane", () => {
    const style = createStageWorkcellPlaneStyle("edit");
    const plane = ANNOTATION_STAGE_LAYOUT.workcells.planes.edit;
    expect(style["--dial-archive-workcell-left"]).toBe(`${plane.leftPercent}%`);
    expect(style["--dial-archive-workcell-top"]).toBe(`${plane.topPercent}%`);
    expect(style["--dial-archive-workcell-z"]).toBe(`${plane.translateZ}px`);
    expect(style["--dial-archive-workcell-width"]).toBe(`${plane.width}px`);
    expect(style["--dial-archive-workcell-hit-top"]).toBe(`${plane.hitSlop.top}px`);
    expect(style["--dial-archive-workcell-hit-right"]).toBe(`${plane.hitSlop.right}px`);
    expect(style["--dial-archive-workcell-hit-bottom"]).toBe(`${plane.hitSlop.bottom}px`);
    expect(style["--dial-archive-workcell-hit-left"]).toBe(`${plane.hitSlop.left}px`);
  });

  test("keeps a visible film cell fixed and only minimally reveals an obscured cell", () => {
    const visible = resolveFilmstripTrackOffset({
      currentOffset: -324,
      viewportLeft: 0,
      viewportWidth: 1000,
      cellLeft: 410,
      cellRight: 558,
    });
    expect(visible).toBe(-324);

    const hiddenOnRight = resolveFilmstripTrackOffset({
      currentOffset: -324,
      viewportLeft: 0,
      viewportWidth: 1000,
      cellLeft: 860,
      cellRight: 1008,
    });
    expect(hiddenOnRight).toBe(-442);

    const hiddenOnLeft = resolveFilmstripTrackOffset({
      currentOffset: -324,
      viewportLeft: 0,
      viewportWidth: 1000,
      cellLeft: 52,
      cellRight: 200,
    });
    expect(hiddenOnLeft).toBe(-266);
  });
});
