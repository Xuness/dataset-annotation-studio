import { useCallback, useEffect, useMemo, useRef } from "react";

import { imageUrl, thumbnailUrl } from "../../../../features/assets/api";
import { useInfiniteAssets } from "../../../../features/assets/hooks";
import { useAnnotationOverview } from "../../../../features/annotations/hooks";
import { useJob, useJobHistory } from "../../../../features/jobs/hooks";
import { useWorkspace } from "../../../../features/workspaces/hooks";
import { useWorkspaceSelectionStore } from "../../../../shared/store/workspaceSelectionStore";
import type {
  AnnotationLaneId,
  AnnotationStageContent,
  AnnotationWorkcellId,
} from "../spacePageModel";
import {
  projectAnnotationCoverage,
  selectAnnotationOperation,
  toAnnotationProject,
} from "./annotationSpaceModel";
import {
  resolveStageFocus,
  shouldContinueStageAssetSearch,
  stepStageIndex,
  toAnnotationStageAsset,
} from "./annotationStageModel";

const STAGE_PAGE_SIZE = 120;

interface UseAnnotationStageControllerOptions {
  projectId: string;
  requestedAssetId: string | null;
  requestedOperationId: string | null;
  initialWorkcell: AnnotationWorkcellId | null;
  initialLane: AnnotationLaneId | null;
  onAssetIdChange(assetId: string | null): void;
  onOpenWorkcell(workcell: AnnotationWorkcellId): void;
  onCloseWorkcell(): void;
  onReturnToSpace(): void;
  onOpenArchive(): void;
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function useAnnotationStageController({
  projectId,
  requestedAssetId,
  requestedOperationId,
  initialWorkcell,
  initialLane,
  onAssetIdChange,
  onOpenWorkcell,
  onCloseWorkcell,
  onReturnToSpace,
  onOpenArchive,
}: UseAnnotationStageControllerOptions): AnnotationStageContent {
  const workspace = useWorkspace(projectId);
  const assets = useInfiniteAssets(projectId, {}, STAGE_PAGE_SIZE);
  const overview = useAnnotationOverview(projectId);
  const jobs = useJobHistory(projectId, 20);
  const requestedJob = useJob(projectId, requestedOperationId, 1);
  const checkedAssetIds = useWorkspaceSelectionStore((state) => state.checkedAssetIds);
  const toggleCheckedAsset = useWorkspaceSelectionStore((state) => state.toggleCheckedAsset);
  const lastIndexRef = useRef(0);

  const project = useMemo(() => toAnnotationProject(workspace.data), [workspace.data]);
  const pages = assets.data?.pages;
  const stageAssets = useMemo(
    () =>
      (pages ?? []).flatMap((page) =>
        page.items.map((asset) =>
          toAnnotationStageAsset(
            asset,
            imageUrl(projectId, asset.id, asset.content_version),
            thumbnailUrl(projectId, asset.id, asset.content_version, 420),
          ),
        ),
      ),
    [pages, projectId],
  );
  const totalCount = pages?.[0]?.total ?? 0;
  const loadedAssetIds = useMemo(() => stageAssets.map((asset) => asset.id), [stageAssets]);
  const pageLoadError = assets.isFetchNextPageError
    ? describeError(assets.error, "无法继续读取素材序列。")
    : null;
  const continueAssetSearch = shouldContinueStageAssetSearch({
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
    () => resolveStageFocus(stageAssets, requestedAssetId, lastIndexRef.current),
    [requestedAssetId, stageAssets],
  );
  if (focus.index >= 0) lastIndexRef.current = focus.index;

  const channels = useMemo(() => projectAnnotationCoverage(overview.data), [overview.data]);
  const operation = useMemo(
    () =>
      selectAnnotationOperation(
        jobs.data?.pages.flat() ?? [],
        requestedOperationId,
        requestedJob.data ?? null,
      ),
    [jobs.data?.pages, requestedJob.data, requestedOperationId],
  );

  const loadMore = useCallback(() => {
    if (!assets.hasNextPage || assets.isFetchingNextPage) return;
    void fetchNextPage();
  }, [assets.hasNextPage, assets.isFetchingNextPage, fetchNextPage]);

  const selectAsset = useCallback(
    (assetId: string) => {
      if (stageAssets.some((asset) => asset.id === assetId)) onAssetIdChange(assetId);
    },
    [onAssetIdChange, stageAssets],
  );

  const stepAsset = useCallback(
    (offset: number) => {
      const next = stepStageIndex(stageAssets, focus.index, offset);
      if (next && next.id !== focus.asset?.id) onAssetIdChange(next.id);
    },
    [focus.asset?.id, focus.index, onAssetIdChange, stageAssets],
  );

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
  const corePending =
    workspace.isPending || assets.isPending || overview.isPending || resolvingRequestedAsset;
  const coreFailed =
    workspace.isError ||
    (assets.isError && !assets.data) ||
    overview.isError ||
    requestedAssetMissing ||
    (Boolean(requestedAssetId) && !requestedAssetLoaded && Boolean(pageLoadError));
  const message = workspace.isError
    ? describeError(workspace.error, "无法读取当前项目。")
    : assets.isError && !assets.data
      ? describeError(assets.error, "无法读取素材序列。")
      : overview.isError
        ? describeError(overview.error, "无法读取标注生产概览。")
        : !corePending && !project
          ? "当前项目上下文已经失效，请返回项目档案重新装载。"
          : requestedAssetMissing
            ? "指定素材已经不在当前项目中，请返回标注生产空间重新选择。"
            : requestedAssetId && !requestedAssetLoaded && pageLoadError
              ? pageLoadError
              : requestedOperationId && !operation && requestedJob.isError
                ? describeError(requestedJob.error, "无法读取指定生产任务。")
                : pageLoadError
                  ? pageLoadError
                  : jobs.isError && !requestedOperationId
                    ? describeError(jobs.error, "无法读取最近的生产任务。")
                    : null;

  return {
    kind: "annotation-stage",
    status: coreFailed || (!corePending && !project) ? "error" : corePending ? "loading" : "ready",
    project,
    sequence: {
      assets: stageAssets,
      totalCount,
      loadedCount: stageAssets.length,
      fetchingMore: assets.isFetchingNextPage,
      hasMore: Boolean(assets.hasNextPage),
      loadError: pageLoadError,
      loadMore,
    },
    currentAsset: focus.asset,
    currentIndex: focus.index,
    checkedAssetIds,
    channels,
    operation,
    initialWorkcell,
    initialLane,
    message,
    selectAsset,
    stepAsset,
    toggleAssetChecked: toggleCheckedAsset,
    openWorkcell: onOpenWorkcell,
    closeWorkcell: onCloseWorkcell,
    returnToSpace: onReturnToSpace,
    openArchive: onOpenArchive,
  };
}

interface CreateNoContextAnnotationStageOptions {
  onReturnToSpace(): void;
  onOpenArchive(): void;
}

export function createNoContextAnnotationStage({
  onReturnToSpace,
  onOpenArchive,
}: CreateNoContextAnnotationStageOptions): AnnotationStageContent {
  return {
    kind: "annotation-stage",
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
    checkedAssetIds: [],
    channels: [],
    operation: null,
    initialWorkcell: null,
    initialLane: null,
    message: null,
    selectAsset: () => {},
    stepAsset: () => {},
    toggleAssetChecked: () => {},
    openWorkcell: () => {},
    closeWorkcell: () => {},
    returnToSpace: onReturnToSpace,
    openArchive: onOpenArchive,
  };
}
