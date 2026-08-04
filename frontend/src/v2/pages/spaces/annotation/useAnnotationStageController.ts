import { useCallback, useMemo, useRef } from "react";

import { imageUrl, thumbnailUrl } from "../../../../features/assets/api";
import { useInfiniteAssets } from "../../../../features/assets/hooks";
import { useAnnotationOverview } from "../../../../features/annotations/hooks";
import { useJobHistory } from "../../../../features/jobs/hooks";
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
import { resolveStageFocus, stepStageIndex, toAnnotationStageAsset } from "./annotationStageModel";

const STAGE_PAGE_SIZE = 120;

interface UseAnnotationStageControllerOptions {
  projectId: string;
  requestedAssetId: string | null;
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

  const focus = useMemo(
    () => resolveStageFocus(stageAssets, requestedAssetId, lastIndexRef.current),
    [requestedAssetId, stageAssets],
  );
  if (focus.index >= 0) lastIndexRef.current = focus.index;

  const channels = useMemo(() => projectAnnotationCoverage(overview.data), [overview.data]);
  const operation = useMemo(
    () => selectAnnotationOperation(jobs.data?.pages.flat() ?? []),
    [jobs.data?.pages],
  );

  const fetchNextPage = assets.fetchNextPage;
  const loadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

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

  const corePending = workspace.isPending || assets.isPending || overview.isPending;
  const coreFailed = workspace.isError || assets.isError || overview.isError;
  const message = workspace.isError
    ? describeError(workspace.error, "无法读取当前项目。")
    : assets.isError
      ? describeError(assets.error, "无法读取素材序列。")
      : overview.isError
        ? describeError(overview.error, "无法读取标注生产概览。")
        : !corePending && !project
          ? "当前项目上下文已经失效，请返回项目档案重新装载。"
          : jobs.isError
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
