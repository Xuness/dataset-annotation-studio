import { describe, expect, test } from "vitest";

import type {
  AnnotationBundle,
  AnnotationRevision,
  AssetAnnotationTrace,
  TranslationDocument,
} from "../../../../shared/api/types";
import {
  projectDossierDocuments,
  projectDossierMetadata,
  projectDossierProvenance,
  projectDossierProvenanceHistory,
  projectDossierRevisions,
  projectDossierTranslations,
} from "./annotationDossierModel";

describe("annotation dossier projection", () => {
  test("keeps metadata fields and the unmodified JSON evidence together", () => {
    const metadata = projectDossierMetadata({
      exists: true,
      path: "metadata/asset-1.json",
      fields: ["camera", "score"],
      value: { camera: { model: "X-T5" }, score: 0.94 },
      error: null,
    });

    expect(metadata.exists).toBe(true);
    expect(metadata.fields).toEqual([
      { id: "camera:0", label: "camera", value: '{ "model": "X-T5" }', kind: "OBJECT" },
      { id: "score:1", label: "score", value: "0.94", kind: "NUMBER" },
    ]);
    expect(metadata.raw).toContain('"camera"');
  });

  test("orders the real channel register and revision chain by identity and time", () => {
    const bundle: AnnotationBundle = {
      asset_id: "asset-1",
      documents: [
        {
          asset_id: "asset-1",
          availability_status: "usable",
          channel: "description",
          content: "A field recording",
          content_kind: "text",
          current_image_hash: null,
          display_name: "描述",
          document_id: null,
          exists: true,
          head_revision_id: null,
          image_content_hash: null,
          language: null,
          modified_at: null,
          path: "",
          review_status: null,
          reviewed_revision_id: null,
          source: "model_response",
          status: "valid",
          tagger_source: null,
          tags: [],
          translation_producer_kind: null,
          translation_source_kind: null,
          updated_at: "2026-08-05T10:00:00Z",
          validation: null,
          validation_status: null,
        },
        {
          asset_id: "asset-1",
          availability_status: "stale",
          channel: "tags",
          content: "",
          content_kind: "tags",
          current_image_hash: null,
          display_name: "Tags",
          document_id: null,
          exists: true,
          head_revision_id: null,
          image_content_hash: null,
          language: null,
          modified_at: null,
          path: "",
          review_status: null,
          reviewed_revision_id: null,
          source: null,
          status: "valid",
          tagger_source: null,
          tags: [{ category: null, confidence: null, name: "field", origin: "manual" }],
          translation_producer_kind: null,
          translation_source_kind: null,
          updated_at: null,
          validation: null,
          validation_status: null,
        },
      ],
    };
    const older: AnnotationRevision = {
      id: "rev-1",
      channel: "tags",
      content: "",
      created_at: "2026-08-04T10:00:00Z",
      document_id: null,
      image_content_hash: null,
      is_candidate: false,
      is_tombstone: false,
      language: null,
      source: "manual_edit",
      source_job_item_id: null,
      tags: [{ category: null, confidence: null, name: "field", origin: "manual" }],
      translation_producer_kind: null,
      translation_source_kind: null,
      validation_status: "valid",
    };
    const newer: AnnotationRevision = {
      id: "rev-2",
      channel: "description",
      content: "A newer field recording",
      created_at: "2026-08-05T10:00:00Z",
      document_id: null,
      image_content_hash: null,
      is_candidate: true,
      is_tombstone: false,
      language: null,
      source: "model_response",
      source_job_item_id: null,
      tags: [],
      translation_producer_kind: null,
      translation_source_kind: null,
      validation_status: "valid",
    };

    expect(projectDossierDocuments(bundle).map((document) => document.code)).toEqual([
      "TAG.01",
      "DSC.02",
    ]);
    expect(
      projectDossierRevisions([
        { channel: "tags", revisions: [older] },
        { channel: "description", revisions: [newer] },
      ]).map((revision) => revision.id),
    ).toEqual(["rev-2", "rev-1"]);
  });

  test("projects translation and generation evidence without inventing missing records", () => {
    const translation: TranslationDocument = {
      alignment_parts: [],
      alignment_status: "aligned",
      asset_id: "asset-1",
      content: "现场记录",
      current_dictionary_resolution_hash: null,
      current_source_hash: null,
      dictionary_override_count: 0,
      dictionary_resolution_hash: null,
      dictionary_sources: [],
      dictionary_unmatched_count: 0,
      exists: true,
      issue: null,
      language: "zh-CN",
      model: "gpt-test",
      modified_at: null,
      path: "",
      producer_kind: "llm",
      provider_profile_id: null,
      provider_profile_name: "primary",
      quality_issues: [],
      quality_status: "valid",
      resolved_source_channel: null,
      source_content: "A field recording",
      source_exists: true,
      source_hash: null,
      source_kind: "description",
      source_revision_id: null,
      source_tags: [],
      status: "current",
      translation_protocol_version: null,
      updated_at: "2026-08-05T10:03:00Z",
      validation_status: null,
    };
    const trace: AssetAnnotationTrace = {
      annotation_exists: true,
      annotation_source: "model_response",
      attempt_id: "attempt-1",
      attempt_number: 1,
      attempt_status: "succeeded",
      finished_at: "2026-08-05T10:03:00Z",
      item_id: "item-1",
      item_status: "succeeded",
      job_id: "job-1",
      job_kind: "annotation",
      job_status: "completed",
      matches_current_annotation: true,
      output_channel: "description",
      output_language: null,
      request: {
        parameters: {
          adapter_id: null,
          batch_size: null,
          categories: null,
          category_thresholds: null,
          device: null,
          execution_backend: "provider",
          installation_id: null,
          max_output_tokens: null,
          max_tags: null,
          model: "gpt-test",
          model_version: null,
          prompt_cache_strategy: null,
          provider_profile_name: "primary",
          provider_type: "openai_compatible",
          reasoning_effort: null,
          seed: null,
          selection_mode: null,
          service_tier: null,
          temperature: null,
          threshold: null,
          timeout_seconds: null,
          top_p: null,
        },
        source: "recorded",
        system_prompt: "system",
        user_prompt: "user",
      },
      response: {
        cache_read_tokens: null,
        cache_write_tokens: null,
        error_message: null,
        final_content: null,
        finish_reason: "stop",
        input_tokens: 100,
        output_tokens: 20,
        reasoning_content: null,
        reasoning_tokens: null,
      },
      started_at: "2026-08-05T10:02:00Z",
      translation_producer_kind: null,
      translation_source_kind: null,
    };

    expect(projectDossierTranslations([translation])[0]).toMatchObject({
      language: "zh-CN",
      statusLabel: "源版本一致",
      model: "gpt-test",
    });
    expect(projectDossierProvenance(trace)).toMatchObject({
      code: "LLM",
      current: true,
      source: "model_response",
      title: "LLM 描述",
    });
    expect(projectDossierProvenanceHistory([trace])).toHaveLength(1);
    expect(projectDossierProvenance(null)).toBeNull();
  });
});
