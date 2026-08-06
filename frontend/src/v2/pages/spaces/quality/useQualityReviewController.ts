import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { imageUrl, thumbnailUrl } from "../../../../features/assets/api";
import { useInfiniteAssets } from "../../../../features/assets/hooks";
import {
  useAnnotationBundle,
  useReviewAnnotationChannel,
} from "../../../../features/annotations/hooks";
import { useWorkspace } from "../../../../features/workspaces/hooks";
import type { AnnotationLaneId, QualityFilterId, QualityReviewContent } from "../spacePageModel";
import { toAnnotationProject } from "../annotation/annotationSpaceModel";
import {
  projectQualityDocuments,
  projectQualityQueues,
  resolveQualityDocument,
  resolveQualityFocus,
  shouldContinueQualityAssetSearch,
  stepQualityAsset,
  toQualityAsset,
} from "./qualitySpaceModel";

const QUALITY_REVIEW_PAGE_SIZE = 120;

interface UseQualityReviewControllerOptions {
  projectId: string;
  requestedAssetId: string | null;
  filter: QualityFilterId;
  channel: AnnotationLaneId;
  onAssetIdChange(assetId: string | null): void;
  onChannelChange(channel: AnnotationLaneId): void;
  onReturnToQuality(
    assetId: string | null,
    filter: QualityFilterId,
    channel: AnnotationLaneId,
  ): void;
  onOpenAnnotation(assetId: string | null, channel: AnnotationLaneId): void;
  onOpenArchive(): void;
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function useQualityReviewController({
  projectId,
  requestedAssetId,
  filter,
  channel,
  onAssetIdChange,
  onChannelChange,
  onReturnToQuality,
  onOpenAnnotation,
  onOpenArchive,
}: UseQualityReviewControllerOptions): QualityReviewContent {
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const workspace = useWorkspace(projectId);
  const assets = useInfiniteAssets(
    projectId,
    { status: filter === "all" ? null : filter },
    QUALITY_REVIEW_PAGE_SIZE,
  );
  const pages = assets.data?.pages;
  const qualityAssets = useMemo(
    () =>
      (pages ?? []).flatMap((page) =>
        page.items.map((asset) =>
          toQualityAsset(
            asset,
            imageUrl(projectId, asset.id, asset.content_version),
            thumbnailUrl(projectId, asset.id, asset.content_version, 420),
          ),
        ),
      ),
    [pages, projectId],
  );
  const loadedAssetIds = useMemo(() => qualityAssets.map((asset) => asset.id), [qualityAssets]);
  const lastIndexRef = useRef(0);
  const pageLoadError = assets.isFetchNextPageError
    ? describeError(assets.error, "无法继续读取复核序列。")
    : null;
  const continueAssetSearch = shouldContinueQualityAssetSearch({
    requestedAssetId,
    loadedAssetIds,
    hasMore: Boolean(assets.hasNextPage),
    fetchingMore: assets.isFetchingNextPage,
    loadFailed: Boolean(pageLoadError),
  });
  const fetchNextPage = assets.fetchNextPage;

  useEffect(() => {
    if (continueAssetSearch) void fetchNextPage();
  }, [continueAssetSearch, fetchNextPage]);

  const focus = useMemo(
    () => resolveQualityFocus(qualityAssets, requestedAssetId, lastIndexRef.current),
    [qualityAssets, requestedAssetId],
  );
  if (focus.index >= 0) lastIndexRef.current = focus.index;
  const bundle = useAnnotationBundle(projectId, focus.asset?.id ?? null);
  const documents = useMemo(() => projectQualityDocuments(bundle.data), [bundle.data]);
  const activeDocument = useMemo(
    () => resolveQualityDocument(documents, channel),
    [channel, documents],
  );
  const review = useReviewAnnotationChannel(
    projectId,
    focus.asset?.id ?? "",
    channel,
    activeDocument?.language ?? "",
    activeDocument?.translationSourceKind === "tags" ? "tags" : "description",
    activeDocument?.translationProducerKind === "local_dictionary" ? "local_dictionary" : "llm",
  );

  useEffect(() => setActionMessage(null), [channel, focus.asset?.id]);

  const loadMore = useCallback(() => {
    if (!assets.hasNextPage || assets.isFetchingNextPage) return;
    void fetchNextPage();
  }, [assets.hasNextPage, assets.isFetchingNextPage, fetchNextPage]);

  const selectAsset = useCallback(
    (assetId: string) => {
      if (assetId === focus.asset?.id) return;
      onAssetIdChange(assetId);
    },
    [focus.asset?.id, onAssetIdChange],
  );

  const stepAsset = useCallback(
    (offset: number) => {
      const next = stepQualityAsset(qualityAssets, focus.index, offset);
      if (next && next.id !== focus.asset?.id) onAssetIdChange(next.id);
    },
    [focus.asset?.id, focus.index, onAssetIdChange, qualityAssets],
  );

  const reviewCurrent = useCallback(async () => {
    if (!activeDocument?.canReview || !activeDocument.headRevisionId || !focus.asset) return;
    setActionMessage(null);
    const next = qualityAssets[focus.index + 1] ?? qualityAssets[focus.index - 1] ?? focus.asset;
    try {
      await review.mutateAsync(activeDocument.headRevisionId);
      setActionMessage(`${activeDocument.displayName} 已关联当前版本。`);
      if (next.id !== focus.asset.id) onAssetIdChange(next.id);
    } catch (reason) {
      setActionMessage(describeError(reason, "复核当前证据失败。"));
    }
  }, [activeDocument, focus.asset, focus.index, onAssetIdChange, qualityAssets, review]);

  const requestedAssetLoaded = !requestedAssetId || loadedAssetIds.includes(requestedAssetId);
  const resolvingRequestedAsset =
    Boolean(requestedAssetId) &&
    !requestedAssetLoaded &&
    !pageLoadError &&
    (assets.isPending || assets.isFetchingNextPage || continueAssetSearch);
  const requestedAssetMissing =
    Boolean(requestedAssetId) &&
    !requestedAssetLoaded &&
    !resolvingRequestedAsset &&
    !pageLoadError;
  const pending =
    workspace.isPending ||
    assets.isPending ||
    resolvingRequestedAsset ||
    (Boolean(focus.asset) && bundle.isPending);
  const failed =
    workspace.isError ||
    (assets.isError && !assets.data) ||
    (bundle.isError && !bundle.data) ||
    requestedAssetMissing ||
    (Boolean(requestedAssetId) && !requestedAssetLoaded && Boolean(pageLoadError));
  const project = useMemo(() => toAnnotationProject(workspace.data), [workspace.data]);
  const message = workspace.isError
    ? describeError(workspace.error, "无法读取当前项目。")
    : assets.isError && !assets.data
      ? describeError(assets.error, "无法读取复核序列。")
      : bundle.isError && !bundle.data
        ? describeError(bundle.error, "无法读取当前对象证据。")
        : requestedAssetMissing
          ? "指定对象不在当前质量队列中，请返回质量入口重新定位。"
          : pageLoadError;

  return {
    kind: "quality-review",
    status: failed || (!pending && !project) ? "error" : pending ? "loading" : "ready",
    project,
    sequence: {
      assets: qualityAssets,
      totalCount: pages?.[0]?.total ?? 0,
      loadedCount: qualityAssets.length,
      fetchingMore: assets.isFetchingNextPage,
      hasMore: Boolean(assets.hasNextPage),
      loadError: pageLoadError,
      loadMore,
    },
    currentAsset: focus.asset,
    currentIndex: focus.index,
    filter,
    channel,
    queues: projectQualityQueues(pages?.[0]?.status_counts, project?.assetCount ?? 0),
    documents,
    activeDocument,
    reviewPending: review.isPending,
    actionMessage,
    message,
    selectAsset,
    stepAsset,
    selectChannel: onChannelChange,
    loadMore,
    reviewCurrent,
    returnToQuality: () => onReturnToQuality(focus.asset?.id ?? null, filter, channel),
    openAnnotation: () => onOpenAnnotation(focus.asset?.id ?? null, channel),
    openArchive: onOpenArchive,
  };
}

interface CreateNoContextQualityReviewOptions {
  filter: QualityFilterId;
  channel: AnnotationLaneId;
  onReturnToQuality(): void;
  onOpenArchive(): void;
}

export function createNoContextQualityReview({
  filter,
  channel,
  onReturnToQuality,
  onOpenArchive,
}: CreateNoContextQualityReviewOptions): QualityReviewContent {
  return {
    kind: "quality-review",
    status: "no-context",
    project: null,
    sequence: {
      assets: [],
      totalCount: 0,
      loadedCount: 0,
      fetchingMore: false,
      hasMore: false,
      loadError: null,
      loadMore: () => {},
    },
    currentAsset: null,
    currentIndex: -1,
    filter,
    channel,
    queues: projectQualityQueues(undefined),
    documents: [],
    activeDocument: null,
    reviewPending: false,
    actionMessage: null,
    message: null,
    selectAsset: () => {},
    stepAsset: () => {},
    selectChannel: () => {},
    loadMore: () => {},
    reviewCurrent: async () => {},
    returnToQuality: onReturnToQuality,
    openAnnotation: () => {},
    openArchive: onOpenArchive,
  };
}
