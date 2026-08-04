import { describe, expect, test } from "vitest";

import {
  ANNOTATION_STAGE_LAYOUT,
  createStageArcPath,
  createStageRingTicks,
  createStageStarfield,
  createAnnotationStageStyle,
  formatStageByteSize,
  formatStageIndex,
} from "./annotationStageLayout";

describe("annotation stage layout", () => {
  test("starfield is deterministic across calls", () => {
    const first = createStageStarfield();
    const second = createStageStarfield();
    expect(first).toEqual(second);
    expect(first.far).toHaveLength(ANNOTATION_STAGE_LAYOUT.starfield.farCount);
    expect(first.band).toHaveLength(ANNOTATION_STAGE_LAYOUT.starfield.bandCount);
  });

  test("band stars gather around the material flow line", () => {
    const { band } = createStageStarfield();
    const { centerY, spread } = ANNOTATION_STAGE_LAYOUT.starfield.band;
    for (const star of band) {
      expect(Math.abs(star.y - centerY)).toBeLessThanOrEqual(spread + 0.5);
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
    expect(style["--dial-archive-stage-ground-major"]).toBe(
      `${ANNOTATION_STAGE_LAYOUT.ground.majorGrid}px`,
    );
    expect(style["--dial-archive-stage-film-step"]).toBe(
      `${ANNOTATION_STAGE_LAYOUT.filmstrip.itemWidth + ANNOTATION_STAGE_LAYOUT.filmstrip.gap}px`,
    );
    expect(style["--dial-archive-stage-instrument-cx"]).toBe(
      `${ANNOTATION_STAGE_LAYOUT.instrument.center.x}px`,
    );
    expect(style["--dial-archive-stage-walk-duration"]).toBe(
      `${ANNOTATION_STAGE_LAYOUT.motion.assetWalkDurationMs}ms`,
    );
  });
});
