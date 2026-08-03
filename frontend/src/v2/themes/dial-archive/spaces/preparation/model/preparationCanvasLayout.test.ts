import { describe, expect, test } from "vitest";

import { PREPARATION_CANVAS_NODE_IDS } from "../../../../../pages/spaces/spacePageModel";
import {
  PREPARATION_CANVAS_LAYOUT,
  createPreparationCanvasEdgePath,
  getPreparationCanvasEdgePoints,
  getPreparationCanvasNodeCenter,
  projectPreparationCanvasPointToMinimap,
  type PreparationCanvasNodeLayouts,
} from "./preparationCanvasLayout";

describe("dial archive preparation canvas layout", () => {
  test("defines every neutral node once and keeps it inside the surface", () => {
    expect(Object.keys(PREPARATION_CANVAS_LAYOUT.nodes)).toEqual([...PREPARATION_CANVAS_NODE_IDS]);
    const revealOrders = new Set<number>();
    for (const node of PREPARATION_CANVAS_NODE_IDS) {
      const { rect, revealOrder } = PREPARATION_CANVAS_LAYOUT.nodes[node];
      revealOrders.add(revealOrder);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(PREPARATION_CANVAS_LAYOUT.surface.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(PREPARATION_CANVAS_LAYOUT.surface.height);
      expect(rect.x).toBeGreaterThanOrEqual(PREPARATION_CANVAS_LAYOUT.taskBounds.x);
      expect(rect.y).toBeGreaterThanOrEqual(PREPARATION_CANVAS_LAYOUT.taskBounds.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(
        PREPARATION_CANVAS_LAYOUT.taskBounds.x + PREPARATION_CANVAS_LAYOUT.taskBounds.width,
      );
      expect(rect.y + rect.height).toBeLessThanOrEqual(
        PREPARATION_CANVAS_LAYOUT.taskBounds.y + PREPARATION_CANVAS_LAYOUT.taskBounds.height,
      );
    }
    expect(revealOrders.size).toBe(PREPARATION_CANVAS_NODE_IDS.length);
  });

  test("derives connector endpoints and camera targets from node rectangles", () => {
    const edge = PREPARATION_CANVAS_LAYOUT.edges.find(({ id }) => id === "source-scope");
    expect(edge).toBeDefined();
    const originalPath = createPreparationCanvasEdgePath(edge!);
    const originalCenter = getPreparationCanvasNodeCenter("scope");
    const movedLayouts: PreparationCanvasNodeLayouts = {
      ...PREPARATION_CANVAS_LAYOUT.nodes,
      scope: {
        ...PREPARATION_CANVAS_LAYOUT.nodes.scope,
        rect: {
          ...PREPARATION_CANVAS_LAYOUT.nodes.scope.rect,
          x: PREPARATION_CANVAS_LAYOUT.nodes.scope.rect.x + 120,
        },
      },
    };

    expect(createPreparationCanvasEdgePath(edge!, movedLayouts)).not.toBe(originalPath);
    expect(getPreparationCanvasNodeCenter("scope", movedLayouts)).toEqual({
      x: originalCenter.x + 120,
      y: originalCenter.y,
    });
  });

  test("keeps topology references and minimap projections valid", () => {
    const edgeIds = new Set<string>();
    const junctionIds = new Set(Object.keys(PREPARATION_CANVAS_LAYOUT.junctions));
    for (const edge of PREPARATION_CANVAS_LAYOUT.edges) {
      expect(edgeIds.has(edge.id)).toBe(false);
      edgeIds.add(edge.id);
      for (const endpoint of [edge.from, edge.to]) {
        if ("node" in endpoint) expect(PREPARATION_CANVAS_NODE_IDS).toContain(endpoint.node);
        else expect(junctionIds.has(endpoint.junction)).toBe(true);
      }
      expect(createPreparationCanvasEdgePath(edge)).toMatch(/^M [-\d.]+ [-\d.]+ L /u);
      expect(createPreparationCanvasEdgePath(edge)).not.toMatch(/[CQA]/u);

      const points = getPreparationCanvasEdgePoints(edge);
      for (let index = 1; index < points.length; index += 1) {
        const deltaX = Math.abs(points[index].x - points[index - 1].x);
        const deltaY = Math.abs(points[index].y - points[index - 1].y);
        expect(deltaX + deltaY).toBeGreaterThan(0);
        expect(deltaX === 0 || deltaY === 0 || Math.abs(deltaX - deltaY) < 0.01).toBe(true);
      }
    }

    for (const node of PREPARATION_CANVAS_NODE_IDS) {
      const point = projectPreparationCanvasPointToMinimap(getPreparationCanvasNodeCenter(node));
      expect(point.x).toBeGreaterThanOrEqual(PREPARATION_CANVAS_LAYOUT.minimap.padding);
      expect(point.y).toBeGreaterThanOrEqual(PREPARATION_CANVAS_LAYOUT.minimap.padding);
      expect(point.x).toBeLessThanOrEqual(
        PREPARATION_CANVAS_LAYOUT.minimap.width - PREPARATION_CANVAS_LAYOUT.minimap.padding,
      );
      expect(point.y).toBeLessThanOrEqual(
        PREPARATION_CANVAS_LAYOUT.minimap.height - PREPARATION_CANVAS_LAYOUT.minimap.padding,
      );
    }
  });
});
