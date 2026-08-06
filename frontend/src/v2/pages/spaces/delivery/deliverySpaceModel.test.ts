import { describe, expect, test } from "vitest";

import { createInitialExportForm } from "../../../../application/exports/exportState";
import type { ExportOperation, ExportPreview } from "../../../../shared/api/types";
import {
  hasDeliveryDraft,
  projectDeliveryManifest,
  projectDeliveryOperations,
  selectDeliveryOperationSignals,
  toDeliveryPreview,
} from "./deliverySpaceModel";

function operation(overrides: Partial<ExportOperation> = {}): ExportOperation {
  return {
    id: "operation-12345678",
    allow_warnings: false,
    completed_at: null,
    completed_items: 4,
    configuration_snapshot: {
      channels: [{ channel: "tags", language: "", revision: "reviewed" }],
      formats: ["txt", "json"],
      packaging: "zip",
    },
    copied_bytes: 400,
    created_at: "2026-08-06T04:00:00Z",
    current_relative_path: "images/004.png",
    destination_path: "D:\\exports\\portrait-set",
    error_message: null,
    scope: "all",
    started_at: "2026-08-06T04:00:01Z",
    status: "running",
    total_bytes: 1000,
    total_items: 10,
    updated_at: "2026-08-06T04:00:02Z",
    warning_count: 2,
    ...overrides,
  };
}

describe("delivery space projections", () => {
  test("distinguishes the untouched default from a meaningful session draft", () => {
    const initial = createInitialExportForm();
    expect(hasDeliveryDraft(initial)).toBe(false);
    expect(hasDeliveryDraft({ ...initial, destinationPath: "D:\\exports\\set" })).toBe(true);
    expect(projectDeliveryManifest({ ...initial, scope: "selected" }, 82, 7).itemCount).toBe(7);
  });

  test("projects operation snapshots instead of borrowing the current draft", () => {
    const projected = projectDeliveryOperations([operation()])[0];
    expect(projected.statusLabel).toBe("正在写入");
    expect(projected.progressPercent).toBe(40);
    expect(projected.manifest).toMatchObject({
      source: "operation",
      formatLabel: "TXT + JSON",
      packagingLabel: "ZIP 压缩包",
      destinationLabel: "portrait-set",
    });
    expect(projected.manifest.selections[0]).toMatchObject({
      label: "Tags",
      revisionLabel: "已人工复核版本",
    });
  });

  test("prioritizes active work, then recoverable work, then the latest record", () => {
    const completed = operation({ id: "completed", status: "completed", completed_items: 10 });
    const stopped = operation({ id: "stopped", status: "stopped" });
    const active = operation({ id: "active", status: "running" });
    const signals = selectDeliveryOperationSignals(
      projectDeliveryOperations([completed, stopped, active]),
    );
    expect(signals.activeOperation?.id).toBe("active");
    expect(signals.recoverableOperation?.id).toBe("stopped");
    expect(signals.focusOperation?.id).toBe("active");
  });

  test("retains preflight blockers, warnings and concrete target outputs", () => {
    const preview: ExportPreview = {
      annotation_bytes: 200,
      blocking_issue_count: 1,
      blocking_issues: ["导出目录必须为空。"],
      empty_count: 0,
      encoding_error_count: 0,
      image_bytes: 800,
      invalid_count: 0,
      items: [
        {
          annotation_bytes: 20,
          annotation_status: "stale",
          asset_id: "asset-1",
          blocking_issue: null,
          channel_statuses: { tags: "stale" },
          image_bytes: 80,
          source_relative_path: "images/001.png",
          target_annotation_name: "001.txt",
          target_image_name: "001.png",
          target_outputs: ["tags/001.png", "tags/001.txt"],
          warning_code: "stale",
          warning_message: "标注来源已经变化。",
        },
      ],
      missing_count: 0,
      preview_token: "preview-token",
      reviewed_count: 4,
      stale_count: 1,
      total_items: 10,
      truncated: false,
      unreviewed_count: 5,
      usable_count: 9,
      warning_count: 1,
    };
    const projected = toDeliveryPreview(preview);
    expect(projected?.blockingIssues).toEqual(["导出目录必须为空。"]);
    expect(projected?.items[0]).toMatchObject({
      targetOutputs: ["tags/001.png", "tags/001.txt"],
      warningCode: "stale",
    });
  });
});
