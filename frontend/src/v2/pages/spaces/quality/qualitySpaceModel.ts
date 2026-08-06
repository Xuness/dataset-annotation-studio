import type {
  AnnotationBundle,
  AnnotationDocument,
  AssetSummary,
} from "../../../../shared/api/types";
import { annotationRevisionSourceLabel } from "../annotation/annotationEditModel";
import { toAnnotationStageAsset } from "../annotation/annotationStageModel";
import {
  ANNOTATION_LANE_IDS,
  QUALITY_FILTER_IDS,
  QUALITY_QUEUE_PRESENTATION,
  type AnnotationLaneId,
  type QualityAsset,
  type QualityFilterId,
  type QualityQueueSummary,
  type QualityReviewDocument,
} from "../spacePageModel";

export function isQualityFilterId(value: unknown): value is QualityFilterId {
  return QUALITY_FILTER_IDS.includes(value as QualityFilterId);
}

export function resolveQualityFilter(
  requested: QualityFilterId | null,
  statusCounts: Readonly<Record<string, number>> | undefined,
): QualityFilterId {
  if (requested) return requested;
  return (statusCounts?.needs_review ?? 0) > 0 ? "needs_review" : "all";
}

export function projectQualityQueues(
  statusCounts: Readonly<Record<string, number>> | undefined,
  totalCount = 0,
): readonly QualityQueueSummary[] {
  return QUALITY_FILTER_IDS.map((id) => ({
    id,
    ...QUALITY_QUEUE_PRESENTATION[id],
    count: id === "all" ? (statusCounts?.all ?? totalCount) : (statusCounts?.[id] ?? 0),
  }));
}

export function toQualityAsset(
  asset: AssetSummary,
  imageUrl: string,
  thumbnailUrl: string,
): QualityAsset {
  return toAnnotationStageAsset(asset, imageUrl, thumbnailUrl);
}

function qualityDocumentId(document: AnnotationDocument): string {
  return (
    document.document_id ??
    [
      document.channel,
      document.language ?? "",
      document.translation_source_kind ?? "",
      document.translation_producer_kind ?? "",
    ].join(":")
  );
}

function sourceDetail(document: AnnotationDocument): string | null {
  if (document.channel !== "translation") return null;
  return [document.language, document.translation_source_kind, document.translation_producer_kind]
    .filter(Boolean)
    .join(" · ");
}

export function projectQualityDocuments(
  bundle: AnnotationBundle | undefined,
): readonly QualityReviewDocument[] {
  return (bundle?.documents ?? [])
    .filter((document) => ANNOTATION_LANE_IDS.includes(document.channel as AnnotationLaneId))
    .map((document) => ({
      id: qualityDocumentId(document),
      channel: document.channel as AnnotationLaneId,
      displayName: document.display_name,
      contentKind: document.content_kind,
      content: document.content,
      tags: (document.tags ?? []).map((tag) => ({
        name: tag.name,
        category: tag.category ?? null,
        confidence: tag.confidence ?? null,
      })),
      availabilityStatus: document.availability_status,
      reviewStatus: document.review_status ?? null,
      validationStatus: document.validation_status ?? document.validation?.status ?? null,
      validationIssues: (document.validation?.issues ?? []).map((issue) => issue.message),
      sourceLabel: document.source
        ? annotationRevisionSourceLabel(document.source)
        : "来源尚未登记",
      sourceDetail: sourceDetail(document),
      headRevisionId: document.head_revision_id ?? null,
      reviewedRevisionId: document.reviewed_revision_id ?? null,
      updatedAt: document.updated_at ?? document.modified_at ?? null,
      language: document.language ?? null,
      translationSourceKind: document.translation_source_kind ?? null,
      translationProducerKind: document.translation_producer_kind ?? null,
      canReview:
        Boolean(document.exists && document.head_revision_id) &&
        document.review_status !== "reviewed",
    }));
}

export function resolveQualityDocument(
  documents: readonly QualityReviewDocument[],
  channel: AnnotationLaneId,
): QualityReviewDocument | null {
  return documents.find((document) => document.channel === channel) ?? null;
}

interface ResolvedQualityFocus {
  asset: QualityAsset | null;
  index: number;
}

export function resolveQualityFocus(
  assets: readonly QualityAsset[],
  requestedAssetId: string | null,
  previousIndex: number,
): ResolvedQualityFocus {
  if (assets.length === 0) return { asset: null, index: -1 };
  if (requestedAssetId) {
    const index = assets.findIndex((asset) => asset.id === requestedAssetId);
    return index >= 0 ? { asset: assets[index], index } : { asset: null, index: -1 };
  }
  const index = Math.min(Math.max(previousIndex, 0), assets.length - 1);
  return { asset: assets[index], index };
}

interface QualityAssetSearchState {
  requestedAssetId: string | null;
  loadedAssetIds: readonly string[];
  hasMore: boolean;
  fetchingMore: boolean;
  loadFailed: boolean;
}

export function shouldContinueQualityAssetSearch({
  requestedAssetId,
  loadedAssetIds,
  hasMore,
  fetchingMore,
  loadFailed,
}: QualityAssetSearchState): boolean {
  if (!requestedAssetId || !hasMore || fetchingMore || loadFailed) return false;
  return !loadedAssetIds.includes(requestedAssetId);
}

export function stepQualityAsset(
  assets: readonly QualityAsset[],
  currentIndex: number,
  offset: number,
): QualityAsset | null {
  if (assets.length === 0) return null;
  const base = currentIndex >= 0 ? currentIndex : 0;
  const next = Math.min(Math.max(base + offset, 0), assets.length - 1);
  return assets[next] ?? null;
}
