import { describe, expect, test } from "vitest";

import {
  formatDialDegrees,
  integrateSpring,
  OUTER_DIAL_SPRING,
  springIsSettled,
  type SpringState,
} from "./dialMotion";

describe("dial archive spring model", () => {
  test("converges to a distant channel without sacrificing large-angle travel", () => {
    const state: SpringState = { position: 108, velocity: 0 };
    for (let frame = 0; frame < 240; frame += 1) {
      integrateSpring(state, -162, 1 / 60, OUTER_DIAL_SPRING);
    }

    expect(state.position).toBeCloseTo(-162, 1);
    expect(springIsSettled(state, -162)).toBe(true);
  });

  test("bounds velocity and renders fixed-width telemetry", () => {
    const state: SpringState = { position: 0, velocity: 0 };
    integrateSpring(state, 1000, 1 / 30, OUTER_DIAL_SPRING);
    expect(Math.abs(state.velocity)).toBeLessThanOrEqual(OUTER_DIAL_SPRING.maximumVelocity);
    expect(formatDialDegrees(7.25)).toBe("+007.3°");
    expect(formatDialDegrees(-54)).toBe("-054.0°");
  });
});
