import { describe, expect, test } from "vitest";

import type { WorkspaceSummary } from "../../../../shared/api/types";
import { toArchiveProjectRecord } from "./archiveProjectModel";

describe("archive project model", () => {
  test("projects the generated workspace contract without inventing display data", () => {
    const workspace: WorkspaceSummary = {
      project_id: "project-1",
      name: "Portraits",
      root_path: "D:\\datasets\\portraits",
      exists: true,
      asset_count: 42,
      annotated_count: 17,
      invalid_count: 2,
      created_at: "2026-08-01T10:00:00Z",
      last_opened_at: null,
      settings: {
        json_fields: [],
        recursive_scan: true,
        system_preset_id: null,
        use_tags_as_context: false,
        user_prompt: "",
        validation_mode: "tag_balance",
      },
    };

    expect(toArchiveProjectRecord(workspace)).toEqual({
      id: "project-1",
      name: "Portraits",
      rootPath: "D:\\datasets\\portraits",
      exists: true,
      assetCount: 42,
      annotatedCount: 17,
      invalidCount: 2,
      createdAt: "2026-08-01T10:00:00Z",
      lastOpenedAt: null,
    });
  });
});
