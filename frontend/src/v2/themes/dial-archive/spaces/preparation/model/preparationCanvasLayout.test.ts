import { describe, expect, test } from "vitest";

import { PREPARATION_CANVAS_NODE_IDS } from "../../../../../pages/spaces/spacePageModel";
import {
  PREPARATION_CANVAS_LAYOUT,
  createPreparationCanvasEdgePath,
  getPreparationCanvasNodeCenter,
  projectPreparationCanvasPointToMinimap,
  type PreparationCanvasNodeLayouts,
} from "./preparationCanvasLayout";

describe("dial archive preparation canvas layout", () => {
  test("defines every neutral node once and keeps it inside the surface", () => {
    expect(Object.keys(PREPARATION_CANVAS_LAYOUT.nodes)).toEqual([...PREPARATION_CANVAS_NODE_IDS]);
    for (const node of PREPARATION_CANVAS_NODE_IDS) {
      const { rect } = PREPARATION_CANVAS_LAYOUT.nodes[node];
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(PREPARATION_CANVAS_LAYOUT.surface.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(PREPARATION_CANVAS_LAYOUT.surface.height);
    }
  });

  test("derives connector endpoints and camera targets from node rectangles", () => {
    const edge = PREPARATION_CANVAS_LAYOUT.edges.find(({ id }) => id === "source-scope");
    expect(edge).toBeDefined();
    const originalPath = createPreparationCanvasEdgePath(edge!);
    const originalCenter = getPreparationCanvasNodeCenter("scope");
    const movedLayouts: PreparationCanvasNodeLayouts = {
      ...PREPARATION_CANVAS_LAYOUT.nodes,
      scope: {
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
    for (const edge of PREPARATION_CANVAS_LAYOUT.edges) {
      expect(edgeIds.has(edge.id)).toBe(false);
      edgeIds.add(edge.id);
      expect(PREPARATION_CANVAS_NODE_IDS).toContain(edge.from.node);
      expect(PREPARATION_CANVAS_NODE_IDS).toContain(edge.to.node);
      expect(createPreparationCanvasEdgePath(edge)).toMatch(/^M [-\d.]+ [-\d.]+ C /u);
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
