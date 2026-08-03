import { describe, expect, test } from "vitest";

import type { PreprocessOperation } from "../../../../shared/api/types";
import {
  isPreparationCanvasNodeId,
  projectPreparationOperations,
  selectPreparationOperationSignals,
  toPreparationOperation,
} from "./preparationModel";

function operation(overrides: Partial<PreprocessOperation> = {}): PreprocessOperation {
  return {
    id: "operation-1",
    status: "running",
    item_count: 10,
    completed_items: 4,
    current_relative_path: "set/004.png",
    eta_seconds: 18,
    created_at: "2026-08-03T04:00:00Z",
    completed_at: null,
    undone_at: null,
    error_message: null,
    options: {
      asset_ids: [],
      resize: {
        max_edge: 2048,
        allow_upscale: false,
        algorithm: "lanczos3",
      },
      convert: null,
      rename: {
        template: "image_{index}",
        start_index: 1,
        padding: 6,
      },
    },
    execution: {
      mode: "auto",
      accelerator_id: null,
      max_workers: null,
      batch_size: null,
    },
    runtime: null,
    ...overrides,
  };
}

describe("preparation view projections", () => {
  test("keeps parallel capabilities on one truthful operation-wide progress signal", () => {
    const projected = toPreparationOperation(operation());

    expect(projected.capabilities).toEqual(["geometry", "identity"]);
    expect(projected.completedItems).toBe(4);
    expect(projected.itemCount).toBe(10);
    expect(projected.progressPercent).toBe(40);
    expect(projected.stageLabel).toContain("融合处理通道");
  });

  test("clamps inconsistent counters and reserves 100 percent for terminal success", () => {
    const running = toPreparationOperation(operation({ completed_items: 99, item_count: 10 }));
    const completed = toPreparationOperation(
      operation({ status: "completed", completed_items: 0, item_count: 0 }),
    );

    expect(running.completedItems).toBe(10);
    expect(running.progressPercent).toBe(99);
    expect(completed.progressPercent).toBe(100);
    expect(completed.determinate).toBe(true);
  });

  test("offers recovery only for the latest completed operation when no task is active", () => {
    const projected = projectPreparationOperations([
      operation({ id: "failed", status: "failed" }),
      operation({ id: "latest", status: "completed", completed_items: 10 }),
      operation({ id: "older", status: "completed", completed_items: 10 }),
    ]);
    const signals = selectPreparationOperationSignals(projected);

    expect(signals.recentOperation?.id).toBe("failed");
    expect(signals.recoverableOperation?.id).toBe("latest");
    expect(projected.find((item) => item.id === "older")?.canRecover).toBe(false);

    const whileActive = projectPreparationOperations([
      operation({ id: "active" }),
      operation({ id: "latest", status: "completed", completed_items: 10 }),
    ]);
    expect(selectPreparationOperationSignals(whileActive).recoverableOperation).toBeNull();
  });

  test("accepts only stable preparation canvas node identifiers", () => {
    expect(isPreparationCanvasNodeId("geometry")).toBe(true);
    expect(isPreparationCanvasNodeId("recovery")).toBe(true);
    expect(isPreparationCanvasNodeId("geometry/../../archive")).toBe(false);
    expect(isPreparationCanvasNodeId("unknown")).toBe(false);
  });
});
