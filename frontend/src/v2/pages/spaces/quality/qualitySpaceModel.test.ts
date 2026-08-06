import { describe, expect, test } from "vitest";

import type { AnnotationBundle, AnnotationDocument } from "../../../../shared/api/types";
import type { QualityAsset } from "../spacePageModel";
import {
  projectQualityDocuments,
  projectQualityQueues,
  resolveQualityDocument,
  resolveQualityFilter,
  resolveQualityFocus,
  shouldContinueQualityAssetSearch,
  stepQualityAsset,
} from "./qualitySpaceModel";

function qualityAsset(id: string): QualityAsset {
  return {
    id,
    filename: `${id}.png`,
    relativePath: `${id}.png`,
    width: 1024,
    height: 1024,
    byteSize: 100,
    suffix: ".png",
    imageUrl: `/image/${id}`,
    thumbnailUrl: `/thumbnail/${id}`,
    annotationStatus: "valid",
    channelStatuses: {},
  };
}

function annotationDocument(overrides: Partial<AnnotationDocument>): AnnotationDocument {
  return {
    asset_id: "asset-1",
    availability_status: "missing",
    channel: "description",
    content: "",
    content_kind: "text",
    current_image_hash: null,
    display_name: "描述",
    document_id: null,
    exists: false,
    head_revision_id: null,
    image_content_hash: null,
    language: null,
    modified_at: null,
    path: "",
    review_status: null,
    reviewed_revision_id: null,
    source: null,
    status: "missing",
    tagger_source: null,
    tags: [],
    translation_producer_kind: null,
    translation_source_kind: null,
    updated_at: null,
    validation: null,
    validation_status: null,
    ...overrides,
  };
}

describe("quality space model", () => {
  test("selects the review queue by default only when it contains work", () => {
    expect(resolveQualityFilter(null, { needs_review: 7 })).toBe("needs_review");
    expect(resolveQualityFilter(null, { needs_review: 0 })).toBe("all");
    expect(resolveQualityFilter("invalid", { needs_review: 7 })).toBe("invalid");
  });

  test("projects queues without conflating review and validation states", () => {
    const queues = projectQualityQueues(
      { all: 42, needs_review: 17, unreviewed: 15, stale: 2, invalid: 1 },
      40,
    );
    expect(queues.find((queue) => queue.id === "needs_review")?.count).toBe(17);
    expect(queues.find((queue) => queue.id === "invalid")?.count).toBe(1);
    expect(queues.find((queue) => queue.id === "all")?.count).toBe(42);
  });

  test("builds channel evidence and retains translation identity", () => {
    const bundle = {
      asset_id: "asset-1",
      documents: [
        annotationDocument({
          asset_id: "asset-1",
          availability_status: "usable",
          channel: "existing_annotation",
          content: "legacy",
          content_kind: "text",
          display_name: "旧标注",
          exists: true,
          path: "legacy.txt",
          status: "valid",
        }),
        annotationDocument({
          asset_id: "asset-1",
          availability_status: "usable",
          channel: "tags",
          content: "",
          content_kind: "tags",
          display_name: "Tags",
          document_id: "doc-tags",
          exists: true,
          head_revision_id: "rev-tags",
          path: "",
          review_status: "unreviewed",
          source: "local_tagger",
          status: "valid",
          tags: [{ name: "1girl", category: "general", confidence: 0.98, origin: "model" }],
          validation: { valid: true, status: "valid", tag_count: 1, issues: [] },
        }),
        annotationDocument({
          asset_id: "asset-1",
          availability_status: "stale",
          channel: "translation",
          content: "一名角色",
          content_kind: "text",
          display_name: "中文描述",
          document_id: "doc-translation",
          exists: true,
          head_revision_id: "rev-translation",
          path: "",
          review_status: "unreviewed",
          source: "model_response",
          status: "valid",
          language: "zh-CN",
          translation_source_kind: "description",
          translation_producer_kind: "llm",
        }),
      ],
    } satisfies AnnotationBundle;

    const documents = projectQualityDocuments(bundle);
    expect(documents).toHaveLength(2);
    expect(resolveQualityDocument(documents, "tags")?.tags[0].name).toBe("1girl");
    expect(resolveQualityDocument(documents, "translation")).toMatchObject({
      language: "zh-CN",
      translationSourceKind: "description",
      translationProducerKind: "llm",
      canReview: true,
    });
  });

  test("keeps a deep-linked object unresolved until its page is loaded", () => {
    const assets = [qualityAsset("a"), qualityAsset("b")];
    expect(resolveQualityFocus(assets, "c", 0)).toEqual({ asset: null, index: -1 });
    expect(
      shouldContinueQualityAssetSearch({
        requestedAssetId: "c",
        loadedAssetIds: ["a", "b"],
        hasMore: true,
        fetchingMore: false,
        loadFailed: false,
      }),
    ).toBe(true);
    expect(stepQualityAsset(assets, 0, 1)?.id).toBe("b");
  });
});
