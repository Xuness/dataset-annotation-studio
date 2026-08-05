import { describe, expect, test } from "vitest";

import {
  ANNOTATION_PRODUCTION_ROUTE_LAYOUT,
  ANNOTATION_PRODUCTION_TOPOLOGY_BOUNDS,
  resolveProductionFocus,
} from "./annotationProductionLayout";

describe("annotation production camera layout", () => {
  test("fits the complete topology beside a fluid inspector on a 2560px display", () => {
    const viewport = { width: 2560, height: 1294, inspectorWidth: 819 };
    const target = resolveProductionFocus("description", viewport);
    const visibleWidth = viewport.width - viewport.inspectorWidth - 36;
    const halfWorldWidth = visibleWidth / target.scale / 2;
    const halfWorldHeight = viewport.height / target.scale / 2;
    const bounds = ANNOTATION_PRODUCTION_TOPOLOGY_BOUNDS;

    expect(target.scale).toBeGreaterThan(0.7);
    expect(target.center.x - halfWorldWidth).toBeLessThanOrEqual(bounds.x);
    expect(target.center.x + halfWorldWidth).toBeGreaterThanOrEqual(bounds.x + bounds.width);
    expect(target.center.y - halfWorldHeight).toBeLessThanOrEqual(bounds.y);
    expect(target.center.y + halfWorldHeight).toBeGreaterThanOrEqual(bounds.y + bounds.height);
  });

  test("retains the closer selected-route composition below the wide breakpoint", () => {
    const target = resolveProductionFocus("description", {
      width: 1366,
      height: 622,
      inspectorWidth: 560,
    });

    expect(target.scale).toBe(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.camera.focusScale);
    expect(target.center.x).toBe(2075);
    expect(target.center.y).toBe(907.5);
  });
});
