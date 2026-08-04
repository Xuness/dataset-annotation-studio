import { describe, expect, test } from "vitest";

import type { JobDetail } from "../../../../shared/api/types";
import type { AnnotationCoverageLane } from "../spacePageModel";
import {
  createProductionLaneReadings,
  productionBackendOptions,
  productionLaneForJob,
  projectProductionOperation,
} from "./annotationProductionModel";

function job(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    id: "job-1",
    kind: "annotation",
    status: "running",
    execution_backend: "local_tagger",
    execution_profile_id: "tagger-1",
    execution_profile_name: "WD Tagger",
    provider_profile_id: null,
    provider_profile_name: null,
    model: "wd-vit",
    system_preset_id: null,
    system_preset_name: null,
    use_tags_as_context: false,
    output_channel: "tags",
    scope: "selected",
    overwrite_existing: false,
    retry_limit: 3,
    total: 10,
    pending: 2,
    running: 1,
    succeeded: 6,
    failed: 1,
    skipped: 0,
    candidate_results: 0,
    manually_accepted: 0,
    target_language: null,
    translation_policy: null,
    translation_producer_kind: null,
    translation_source_kind: null,
    created_at: "2026-08-05T09:00:00Z",
    updated_at: "2026-08-05T09:02:00Z",
    completed_at: null,
    items: [],
    ...overrides,
  };
}

function coverage(id: AnnotationCoverageLane["id"], usable: number): AnnotationCoverageLane {
  return {
    id,
    activeDocumentCount: usable,
    presentAssetCount: usable,
    usableAssetCount: usable,
    staleAssetCount: 0,
    invalidAssetCount: 0,
    missingAssetCount: 10 - usable,
    coveragePercent: usable * 10,
  };
}

describe("annotation production projection", () => {
  test("maps backend contracts onto the three visual production lanes", () => {
    expect(productionLaneForJob(job())).toBe("tags");
    expect(
      productionLaneForJob(
        job({ kind: "annotation", execution_backend: "provider", output_channel: "description" }),
      ),
    ).toBe("description");
    expect(
      productionLaneForJob(
        job({ kind: "translation", execution_backend: "provider", output_channel: "translation" }),
      ),
    ).toBe("translation");
    expect(productionBackendOptions("translation").map((option) => option.id)).toEqual([
      "provider",
      "local_dictionary",
    ]);
  });

  test("keeps all lanes in the topology while marking the real running branch", () => {
    const lanes = createProductionLaneReadings(
      [coverage("tags", 7), coverage("description", 10), coverage("translation", 0)],
      job(),
    );

    expect(lanes.map((lane) => lane.id)).toEqual(["tags", "description", "translation"]);
    expect(lanes.find((lane) => lane.id === "tags")?.state).toBe("running");
    expect(lanes.find((lane) => lane.id === "description")?.state).toBe("ready");
    expect(lanes.find((lane) => lane.id === "translation")?.state).toBe("inactive");
  });

  test("projects truthful operation progress and exception evidence", () => {
    const operation = projectProductionOperation(job({ candidate_results: 1 }), [
      {
        id: "item-1",
        asset_id: "asset-1",
        relative_path: "images/asset-1.png",
        status: "failed",
        attempt_count: 2,
        last_error: "invalid output",
        manually_accepted: false,
        result_disposition: "candidate",
        validation_status: "invalid",
        attempts: [
          {
            id: "attempt-1",
            attempt_number: 2,
            status: "validation_failed",
            started_at: "2026-08-05T09:01:00Z",
            finished_at: "2026-08-05T09:01:20Z",
            response_content: "candidate content",
            error_message: null,
            finish_reason: "stop",
            input_tokens: 20,
            output_tokens: 10,
            reasoning_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
          },
        ],
      },
    ]);

    expect(operation.progressPercent).toBe(70);
    expect(operation.exceptionCount).toBe(2);
    expect(operation.exceptions[0]).toMatchObject({
      candidate: true,
      canAccept: true,
      diagnostic: "candidate content",
    });
  });
});
