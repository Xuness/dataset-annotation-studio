import { describe, expect, test } from "vitest";

import { PREPARATION_CANVAS_LAYOUT } from "../../../../preparation/model/preparationCanvasLayout";
import {
  ANNOTATION_PRODUCTION_ROUTE_LAYOUT,
  PRODUCTION_CANVAS_NODE_IDS,
  getProductionNodeCenter,
  projectProductionCanvasPointToMinimap,
} from "./annotationProductionLayout";

describe("annotation production canvas parity", () => {
  test("uses the complete Space 02 canvas, camera, decoration, and evidence geometry", () => {
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.surface).toBe(PREPARATION_CANVAS_LAYOUT.surface);
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.taskBounds).toBe(
      PREPARATION_CANVAS_LAYOUT.taskBounds,
    );
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.camera).toBe(PREPARATION_CANVAS_LAYOUT.camera);
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.fields).toBe(PREPARATION_CANVAS_LAYOUT.fields);
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.decorRoutes).toBe(
      PREPARATION_CANVAS_LAYOUT.decorRoutes,
    );
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.backgroundFrames).toBe(
      PREPARATION_CANVAS_LAYOUT.backgroundFrames,
    );
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.gauges).toBe(PREPARATION_CANVAS_LAYOUT.gauges);
  });

  test("maps all eight production meanings onto the established Space 02 node slots", () => {
    expect(PRODUCTION_CANVAS_NODE_IDS).toHaveLength(8);
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.nodes.source).toBe(
      PREPARATION_CANVAS_LAYOUT.nodes.source,
    );
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.nodes.scope).toBe(
      PREPARATION_CANVAS_LAYOUT.nodes.scope,
    );
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.nodes.tags).toBe(
      PREPARATION_CANVAS_LAYOUT.nodes.geometry,
    );
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.nodes.description).toBe(
      PREPARATION_CANVAS_LAYOUT.nodes.encoding,
    );
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.nodes.translation).toBe(
      PREPARATION_CANVAS_LAYOUT.nodes.identity,
    );
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.nodes.validation).toBe(
      PREPARATION_CANVAS_LAYOUT.nodes.preview,
    );
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.nodes.terminal).toBe(
      PREPARATION_CANVAS_LAYOUT.nodes.commit,
    );
    expect(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.nodes.result).toBe(
      PREPARATION_CANVAS_LAYOUT.nodes.recovery,
    );
  });

  test("projects node readings through the same minimap geometry", () => {
    const center = getProductionNodeCenter("description");
    expect(center).toEqual({ x: 1695, y: 945 });
    expect(projectProductionCanvasPointToMinimap(center)).toEqual(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
  });
});
