import { describe, expect, test } from "vitest";

import {
  DIAL_NUMBER_REST_ANGLES,
  arcPath,
  dialNumberPoint,
  dialRotationForIndex,
  ringSectorPath,
} from "./dialGeometry";

describe("dial archive geometry", () => {
  test("maps the six linear spaces onto a deliberately wide 270 degree travel", () => {
    expect(Array.from({ length: 6 }, (_, index) => dialRotationForIndex(index))).toEqual([
      108, 54, 0, -54, -108, -162,
    ]);
    expect(dialRotationForIndex(5) - dialRotationForIndex(0)).toBe(-270);
  });

  test("keeps every channel number and the N/C slot on the number rail", () => {
    expect(DIAL_NUMBER_REST_ANGLES).toHaveLength(7);
    const [x, y] = dialNumberPoint(2, 0);
    expect(x).toBeCloseTo(500, 5);
    expect(y).toBeCloseTo(56, 5);
  });

  test("produces closed and open SVG geometry without DOM construction", () => {
    expect(arcPath(100, 0, 90)).toMatch(/^M .* A 100 100 0 0 1 /u);
    expect(ringSectorPath(80, 100, -20, 20)).toMatch(/ Z$/u);
    expect(() => dialRotationForIndex(6)).toThrow(RangeError);
  });
});
