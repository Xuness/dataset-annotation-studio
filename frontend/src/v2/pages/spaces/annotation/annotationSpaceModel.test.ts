import { describe, expect, test } from "vitest";

import type { AnnotationOverview, JobSummary } from "../../../../shared/api/types";
import {
  projectAnnotationCoverage,
  projectTranslationVariants,
  selectAnnotationOperation,
} from "./annotationSpaceModel";

function overview(): AnnotationOverview {
  return {
    asset_count: 10,
    channels: [
      {
        channel: "tags",
        active_document_count: 9,
        present_asset_count: 9,
        usable_asset_count: 7,
        stale_asset_count: 1,
        invalid_asset_count: 1,
        missing_asset_count: 1,
      },
      {
        channel: "translation",
        active_document_count: 4,
        present_asset_count: 3,
        usable_asset_count: 2,
        stale_asset_count: 1,
        invalid_asset_count: 0,
        missing_asset_count: 7,
      },
    ],
    translation_variants: [
      {
        language: "zh-CN",
        translation_source_kind: "description",
        translation_producer_kind: "llm",
        display_name: "中文描述",
        active_document_count: 3,
        present_asset_count: 3,
        usable_asset_count: 2,
        stale_asset_count: 1,
        invalid_asset_count: 0,
        missing_asset_count: 7,
      },
    ],
  };
}

function job(overrides: Partial<JobSummary> = {}): JobSummary {
  const base: JobSummary = {
    id: "job-1",
    kind: "annotation",
    status: "completed",
    scope: "all",
    execution_backend: "provider",
    execution_profile_id: "provider-1",
    execution_profile_name: "Primary Provider",
    provider_profile_id: "provider-1",
    provider_profile_name: "Primary Provider",
    model: "vision-model",
    output_channel: "description",
    overwrite_existing: false,
    system_preset_id: null,
    system_preset_name: null,
    use_tags_as_context: false,
    total: 10,
    pending: 0,
    running: 0,
    succeeded: 10,
    failed: 0,
    skipped: 0,
    candidate_results: 0,
    manually_accepted: 0,
    retry_limit: 2,
    target_language: null,
    translation_policy: null,
    translation_producer_kind: null,
    translation_source_kind: null,
    created_at: "2026-08-04T08:00:00Z",
    updated_at: "2026-08-04T08:01:00Z",
    completed_at: "2026-08-04T08:01:00Z",
  };
  return {
    ...base,
    ...overrides,
    target_language: overrides.target_language ?? base.target_language,
  };
}

describe("annotation space projections", () => {
  test("keeps the three production lanes stable when a channel has no documents", () => {
    const channels = projectAnnotationCoverage(overview());

    expect(channels.map((channel) => channel.id)).toEqual(["tags", "description", "translation"]);
    expect(channels[0]).toMatchObject({ coveragePercent: 70, missingAssetCount: 1 });
    expect(channels[1]).toMatchObject({ coveragePercent: 0, missingAssetCount: 10 });
  });

  test("preserves translation identity instead of merging language variants", () => {
    expect(projectTranslationVariants(overview())).toEqual([
      expect.objectContaining({
        id: "zh-CN:description:llm",
        language: "zh-CN",
        sourceKind: "description",
        producerKind: "llm",
        usableAssetCount: 2,
      }),
    ]);
  });

  test("prioritizes an active operation over a newer attention record", () => {
    const selected = selectAnnotationOperation([
      job({ id: "interrupted", status: "interrupted" }),
      job({
        id: "active",
        kind: "translation",
        status: "running",
        output_channel: "translation",
        target_language: "ja-JP",
        total: 20,
        pending: 11,
        running: 1,
        succeeded: 8,
      }),
    ]);

    expect(selected).toMatchObject({
      id: "active",
      lane: "translation",
      progressPercent: 40,
      completedItems: 8,
      active: true,
    });
  });
});
