import { useCallback, useEffect, useMemo, useRef } from "react";

import { imageUrl, thumbnailUrl } from "../../../../features/assets/api";
import { useInfiniteAssets } from "../../../../features/assets/hooks";
import { useAnnotationOverview } from "../../../../features/annotations/hooks";
import { useWorkspace } from "../../../../features/workspaces/hooks";
import { useWorkspaceSelectionStore } from "../../../../shared/store/workspaceSelectionStore";
import type { AnnotationLaneId, QualityFilterId, QualitySpaceContent } from "../spacePageModel";
import {
  projectAnnotationCoverage,
  projectTranslationVariants,
  toAnnotationProject,
} from "../annotation/annotationSpaceModel";
import {
  projectQualityQueues,
  resolveQualityFocus,
  shouldContinueQualityAssetSearch,
  toQualityAsset,
} from "./qualitySpaceModel";

const QUALITY_PAGE_SIZE = 120;

interface UseQualitySpaceControllerOptions {
  projectId: string;
  requestedAssetId: string | null;
  requestedFilter: QualityFilterId | null;
  requestedChannel: AnnotationLaneId | null;
  onAssetIdChange(assetId: string): void;
  onFilterChange(filter: QualityFilterId): void;
  onChannelChange(channel: AnnotationLaneId): void;
  onOpenReview(assetId: string | null, filter: QualityFilterId, channel: AnnotationLaneId): void;
  onOpenAnnotation(assetId: string | null, channel: AnnotationLaneId): void;
  onOpenArchive(): void;
  onOpenDelivery(): void;
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function useQualitySpaceController({
  projectId,
  requestedAssetId,
  requestedFilter,
  requestedChannel,
  onAssetIdChange,
  onFilterChange,
  onChannelChange,
  onOpenReview,
  onOpenAnnotation,
  onOpenArchive,
  onOpenDelivery,
}: UseQualitySpaceControllerOptions): QualitySpaceContent {
  const filter: QualityFilterId = requestedFilter ?? (requestedAssetId ? "all" : "needs_review");
  const channel: AnnotationLaneId = requestedChannel ?? "tags";
  const workspace = useWorkspace(projectId);
  const assets = useInfiniteAssets(
    projectId,
    { status: filter === "all" ? null : filter },
    QUALITY_PAGE_SIZE,
  );
  const overview = useAnnotationOverview(projectId);
  const checkedAssetIds = useWorkspaceSelectionStore((state) => state.checkedAssetIds);
  const lastIndexRef = useRef(0);
  const project = useMemo(() => toAnnotationProject(workspace.data), [workspace.data]);
  const pages = assets.data?.pages;
  const qualityAssets = useMemo(
    () =>
      (pages ?? []).flatMap((page) =>
        page.items.map((asset) =>
          toQualityAsset(
            asset,
            imageUrl(projectId, asset.id, asset.content_version),
            thumbnailUrl(projectId, asset.id, asset.content_version, 520),
          ),
        ),
      ),
    [pages, projectId],
  );
  const totalCount = pages?.[0]?.total ?? 0;
  const statusCounts = pages?.[0]?.status_counts ?? {};
  const loadedAssetIds = useMemo(() => qualityAssets.map((asset) => asset.id), [qualityAssets]);
  const pageLoadError = assets.isFetchNextPageError
    ? describeError(assets.error, "无法继续读取质量队列。")
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

  const loadMore = useCallback(() => {
    if (!assets.hasNextPage || assets.isFetchingNextPage) return;
    void fetchNextPage();
  }, [assets.hasNextPage, assets.isFetchingNextPage, fetchNextPage]);

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
    workspace.isPending || assets.isPending || overview.isPending || resolvingRequestedAsset;
  const failed =
    workspace.isError ||
    (assets.isError && !assets.data) ||
    overview.isError ||
    requestedAssetMissing ||
    (Boolean(requestedAssetId) && !requestedAssetLoaded && Boolean(pageLoadError));
  const message = workspace.isError
    ? describeError(workspace.error, "无法读取当前项目。")
    : assets.isError && !assets.data
      ? describeError(assets.error, "无法读取质量队列。")
      : overview.isError
        ? describeError(overview.error, "无法读取通道证据概览。")
        : !pending && !project
          ? "当前项目上下文已经失效，请返回项目档案重新装载。"
          : requestedAssetMissing
            ? "指定对象不在当前质量队列中，请切换队列或返回质量入口。"
            : requestedAssetId && !requestedAssetLoaded && pageLoadError
              ? pageLoadError
              : pageLoadError;

  return {
    kind: "quality",
    status: failed || (!pending && !project) ? "error" : pending ? "loading" : "ready",
    project,
    focusAsset: focus.asset,
    focusIndex: focus.index,
    samples: qualityAssets,
    totalCount,
    loadedCount: qualityAssets.length,
    fetchingMore: assets.isFetchingNextPage,
    hasMore: Boolean(assets.hasNextPage),
    filter,
    channel,
    queues: projectQualityQueues(statusCounts, project?.assetCount ?? totalCount),
    channels: projectAnnotationCoverage(overview.data),
    translationVariants: projectTranslationVariants(overview.data),
    checkedCount: checkedAssetIds.length,
    statusCounts,
    message,
    selectAsset: (assetId) => onAssetIdChange(assetId),
    selectFilter: onFilterChange,
    selectChannel: onChannelChange,
    loadMore,
    openReview: (assetId = focus.asset?.id, nextChannel = channel) =>
      onOpenReview(assetId ?? null, filter, nextChannel),
    openAnnotation: (assetId = focus.asset?.id, nextChannel = channel) =>
      onOpenAnnotation(assetId ?? null, nextChannel),
    openArchive: onOpenArchive,
    openDelivery: onOpenDelivery,
  };
}

interface CreateNoContextQualitySpaceOptions {
  onOpenArchive(): void;
}

export function createNoContextQualitySpace({
  onOpenArchive,
}: CreateNoContextQualitySpaceOptions): QualitySpaceContent {
  return {
    kind: "quality",
    status: "no-context",
    project: null,
    focusAsset: null,
    focusIndex: -1,
    samples: [],
    totalCount: 0,
    loadedCount: 0,
    fetchingMore: false,
    hasMore: false,
    filter: "needs_review",
    channel: "tags",
    queues: projectQualityQueues(undefined),
    channels: [],
    translationVariants: [],
    checkedCount: 0,
    statusCounts: {},
    message: null,
    selectAsset: () => {},
    selectFilter: () => {},
    selectChannel: () => {},
    loadMore: () => {},
    openReview: () => {},
    openAnnotation: () => {},
    openArchive: onOpenArchive,
    openDelivery: () => {},
  };
}
