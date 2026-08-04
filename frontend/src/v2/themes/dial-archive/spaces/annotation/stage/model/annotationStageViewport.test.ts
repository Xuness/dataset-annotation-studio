import { describe, expect, test } from "vitest";

import {
  calculateStageViewportFitScale,
  clampStageViewportTransform,
  zoomStageViewportAt,
} from "./annotationStageViewport";

describe("annotation stage specimen viewport", () => {
  test("fits an extreme panoramic asset inside a compact window", () => {
    const viewport = { width: 320, height: 180 };
    const image = { width: 16_000, height: 420 };
    const scale = calculateStageViewportFitScale(viewport, image);

    expect(scale).toBeCloseTo(284 / 16_000, 8);
    expect(image.width * scale).toBeLessThanOrEqual(284);
    expect(image.height * scale).toBeLessThanOrEqual(144);
  });

  test("keeps a magnified image within bounded panning limits", () => {
    const transform = clampStageViewportTransform(
      { x: 9_999, y: -9_999, scale: 2 },
      { width: 800, height: 500 },
      { width: 1_000, height: 800 },
    );

    expect(transform.x).toBe(626);
    expect(transform.y).toBe(-576);
    expect(transform.scale).toBe(2);
  });

  test("preserves the inspected pixel while zooming around the pointer", () => {
    const viewport = { width: 800, height: 500 };
    const image = { width: 1_600, height: 1_000 };
    const current = { x: 0, y: 0, scale: 0.5 };
    const anchor = { x: 600, y: 180 };
    const next = zoomStageViewportAt(current, 1, anchor, viewport, image);

    expect(next.x).toBe(-200);
    expect(next.y).toBe(70);
    expect(next.scale).toBe(1);
  });
});
