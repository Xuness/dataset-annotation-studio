import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import type { ConfirmationRequest, ConfirmInteraction } from "../../../../application/interaction";
import { imageUrl, thumbnailUrl } from "../../../../features/assets/api";
import { useAssetFolders, useAssetIds, useInfiniteAssets } from "../../../../features/assets/hooks";
import { useAnnotationOverview } from "../../../../features/annotations/hooks";
import { useJob, useJobHistory } from "../../../../features/jobs/hooks";
import { useUpdateWorkspace, useWorkspace } from "../../../../features/workspaces/hooks";
import { useWorkspaceSelectionStore } from "../../../../shared/store/workspaceSelectionStore";
import {
  folderSelectionsEqual,
  reconcileFolderSelection,
  toggleFolderSelection,
} from "../../../../shared/store/folderSelection";
import type {
  AnnotationLaneId,
  AnnotationDossierSectionId,
  AnnotationEditChannelId,
  AnnotationStageFilterId,
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
  resolveStageRangeToggle,
  shouldContinueStageAssetSearch,
  stepStageIndex,
  toAnnotationStageAsset,
} from "./annotationStageModel";
import { annotationStageViewState } from "./annotationStageState";
import { useAnnotationDossierController } from "./useAnnotationDossierController";
import { useAnnotationBatchController } from "./useAnnotationBatchController";
import { useAnnotationEditController } from "./useAnnotationEditController";
import { useAnnotationProjectContextController } from "./useAnnotationProjectContextController";
import { useAnnotationProductionController } from "./useAnnotationProductionController";

const STAGE_PAGE_SIZE = 120;

interface UseAnnotationStageControllerOptions {
  projectId: string;
  requestedAssetId: string | null;
  requestedOperationId: string | null;
  activeWorkcell: AnnotationWorkcellId | null;
  requestedEditChannel: AnnotationEditChannelId | null;
  requestedDossierSection: AnnotationDossierSectionId | null;
  requestedProductionLane: AnnotationLaneId | null;
  onAssetIdChange(assetId: string | null): void;
  onOpenWorkcell(workcell: AnnotationWorkcellId): void;
  onCloseWorkcell(): void;
  onEditChannelChange(channel: AnnotationEditChannelId): void;
  onDossierSectionChange(section: AnnotationDossierSectionId): void;
  onProductionLaneChange(lane: AnnotationLaneId): void;
  onProductionOperationChange(operationId: string | null): void;
  onReturnToSpace(): void;
  onOpenArchive(): void;
  onOpenQuality(): void;
}

interface PendingConfirmation {
  request: ConfirmationRequest;
  resolve(accepted: boolean): void;
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function useAnnotationStageController({
  projectId,
  requestedAssetId,
  requestedOperationId,
  activeWorkcell,
  requestedEditChannel,
  requestedDossierSection,
  requestedProductionLane,
  onAssetIdChange,
  onOpenWorkcell,
  onCloseWorkcell,
  onEditChannelChange,
  onDossierSectionChange,
  onProductionLaneChange,
  onProductionOperationChange,
  onReturnToSpace,
  onOpenArchive,
  onOpenQuality,
}: UseAnnotationStageControllerOptions): AnnotationStageContent {
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AnnotationStageFilterId>("all");
  const [scopeError, setScopeError] = useState<string | null>(null);
  const confirmationRef = useRef<PendingConfirmation | null>(null);
  const rangeAnchorRef = useRef<string | null>(null);
  const workspace = useWorkspace(projectId);
  const updateWorkspace = useUpdateWorkspace(projectId);
  const folderLibrary = useAssetFolders(projectId);
  const { folderPaths } = annotationStageViewState.useValue(projectId);
  const deferredSearch = useDeferredValue(search.trim());
  const assetQuery = useMemo(
    () => ({
      search: deferredSearch || undefined,
      status: filter === "all" ? null : filter,
      folderPaths: folderPaths.length ? folderPaths : undefined,
    }),
    [deferredSearch, filter, folderPaths],
  );
  const assets = useInfiniteAssets(projectId, assetQuery, STAGE_PAGE_SIZE);
  const filteredAssetIds = useAssetIds(projectId, assetQuery);
  const overview = useAnnotationOverview(projectId);
  const jobs = useJobHistory(projectId, 20);
  const requestedJob = useJob(projectId, requestedOperationId, 1);
  const checkedAssetIds = useWorkspaceSelectionStore((state) => state.checkedAssetIds);
  const toggleCheckedAsset = useWorkspaceSelectionStore((state) => state.toggleCheckedAsset);
  const setAssetsChecked = useWorkspaceSelectionStore((state) => state.setAssetsChecked);
  const clearCheckedAssets = useWorkspaceSelectionStore((state) => state.clearCheckedAssets);
  const lastIndexRef = useRef(0);

  const confirm = useCallback<ConfirmInteraction>((request) => {
    confirmationRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const pending = { request, resolve };
      confirmationRef.current = pending;
      setPendingConfirmation(pending);
    });
  }, []);

  const resolveConfirmation = useCallback((accepted: boolean) => {
    const pending = confirmationRef.current;
    if (!pending) return;
    confirmationRef.current = null;
    setPendingConfirmation(null);
    pending.resolve(accepted);
  }, []);

  useEffect(
    () => () => {
      confirmationRef.current?.resolve(false);
      confirmationRef.current = null;
    },
    [],
  );

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
  const folderOptions = useMemo(
    () =>
      folderLibrary.data?.items
        .filter((folder) => Boolean(folder.path))
        .map((folder) => ({
          id: folder.path,
          label: folder.name,
          detail: folder.path,
          count: folder.descendant_asset_count,
        })) ?? [],
    [folderLibrary.data?.items],
  );

  useEffect(() => {
    if (!folderLibrary.data) return;
    const reconciled = reconcileFolderSelection(
      folderPaths,
      folderLibrary.data.items.map((folder) => folder.path),
    );
    if (folderSelectionsEqual(folderPaths, reconciled)) return;
    annotationStageViewState.patch(projectId, { folderPaths: reconciled });
  }, [folderLibrary.data, folderPaths, projectId]);
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

  const editController = useAnnotationEditController({
    projectId,
    assetId: focus.asset?.id ?? null,
    requestedChannel: requestedEditChannel,
    confirm,
    onChannelChange: onEditChannelChange,
  });
  const editContent = editController.content;
  const discardEditImmediately = editController.discardImmediately;

  const projectContextController = useAnnotationProjectContextController({
    projectId,
    workspace: workspace.data ?? null,
    assetId: focus.asset?.id ?? null,
    enabled: activeWorkcell === "production",
    previewEnabled: activeWorkcell === "production",
  });
  const projectContext = projectContextController.content;
  const discardContextImmediately = projectContextController.discardImmediately;

  const runWithDraftGuard = useCallback(
    async (action: () => void, title: string, message: string) => {
      const hasUnsavedEdit = activeWorkcell === "edit" && editContent.dirty;
      const hasUnsavedContext = activeWorkcell === "production" && projectContext.dirty;
      if (hasUnsavedEdit || hasUnsavedContext) {
        const accepted = await confirm({
          title,
          message,
          tone: "danger",
          confirmLabel: "放弃并继续",
          cancelLabel: "继续编辑",
        });
        if (!accepted) return;
        discardEditImmediately();
        discardContextImmediately();
      }
      action();
    },
    [
      activeWorkcell,
      confirm,
      discardContextImmediately,
      discardEditImmediately,
      editContent.dirty,
      projectContext.dirty,
    ],
  );

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
  const production = useAnnotationProductionController({
    projectId,
    workspace: workspace.data ?? null,
    checkedAssetIds,
    channels,
    requestedLane: requestedProductionLane,
    requestedOperationId,
    enabled: activeWorkcell === "production",
    onLaneChange: onProductionLaneChange,
    onOperationChange: onProductionOperationChange,
  });
  const dossier = useAnnotationDossierController({
    projectId,
    assetId: focus.asset?.id ?? null,
    enabled: activeWorkcell === "dossier",
    onOpenJob: onProductionOperationChange,
    onOpenArchive,
    onOpenQuality,
  });
  const effectiveBatchAssetIds = useMemo(
    () => (checkedAssetIds.length ? checkedAssetIds : focus.asset ? [focus.asset.id] : []),
    [checkedAssetIds, focus.asset],
  );
  const blockedTarget = useMemo(() => {
    if (!editContent.dirty || !focus.asset || !effectiveBatchAssetIds.includes(focus.asset.id)) {
      return null;
    }
    if (editContent.channel === "translation") {
      return {
        channel: "translation" as const,
        language: editContent.translation.language,
        translation_source_kind: editContent.translation.sourceKind,
        translation_producer_kind: editContent.translation.producerKind,
      };
    }
    return { channel: editContent.channel, language: "" };
  }, [editContent, effectiveBatchAssetIds, focus.asset]);
  const batch = useAnnotationBatchController({
    projectId,
    open: activeWorkcell === null,
    assetIds: effectiveBatchAssetIds,
    blockedTagDraft: Boolean(
      editContent.tagsDirty && focus.asset && effectiveBatchAssetIds.includes(focus.asset.id),
    ),
    blockedTarget,
    confirm,
  });

  const loadMore = useCallback(() => {
    if (!assets.hasNextPage || assets.isFetchingNextPage) return;
    void fetchNextPage();
  }, [assets.hasNextPage, assets.isFetchingNextPage, fetchNextPage]);

  const selectAsset = useCallback(
    (assetId: string) => {
      if (!stageAssets.some((asset) => asset.id === assetId) || assetId === focus.asset?.id) return;
      void runWithDraftGuard(
        () => onAssetIdChange(assetId),
        "切换编辑对象",
        "当前标注有尚未保存的修改。确定放弃后切换素材吗？",
      );
    },
    [focus.asset?.id, onAssetIdChange, runWithDraftGuard, stageAssets],
  );

  const stepAsset = useCallback(
    (offset: number) => {
      const next = stepStageIndex(stageAssets, focus.index, offset);
      if (!next || next.id === focus.asset?.id) return;
      void runWithDraftGuard(
        () => onAssetIdChange(next.id),
        "切换编辑对象",
        "当前标注有尚未保存的修改。确定放弃后切换素材吗？",
      );
    },
    [focus.asset?.id, focus.index, onAssetIdChange, runWithDraftGuard, stageAssets],
  );

  const toggleAssetChecked = useCallback(
    (assetId: string) => {
      rangeAnchorRef.current = assetId;
      toggleCheckedAsset(assetId);
    },
    [toggleCheckedAsset],
  );

  const toggleRangeTo = useCallback(
    (assetId: string) => {
      const anchorId = rangeAnchorRef.current ?? focus.asset?.id ?? assetId;
      const range = resolveStageRangeToggle(loadedAssetIds, anchorId, assetId, checkedAssetIds);
      if (!range) return;
      setAssetsChecked(range.assetIds, range.checked);
      rangeAnchorRef.current = assetId;
    },
    [checkedAssetIds, focus.asset?.id, loadedAssetIds, setAssetsChecked],
  );

  const updateScope = useCallback(
    (action: () => void) => {
      void runWithDraftGuard(
        () => {
          action();
          setScopeError(null);
          rangeAnchorRef.current = null;
          if (requestedAssetId) onAssetIdChange(null);
        },
        "切换素材范围",
        "当前标注或项目上下文有尚未保存的修改。确定放弃后切换素材范围吗？",
      );
    },
    [onAssetIdChange, requestedAssetId, runWithDraftGuard],
  );

  const selectAllFiltered = useCallback(async () => {
    setScopeError(null);
    try {
      const result = await filteredAssetIds.refetch();
      if (result.error) throw result.error;
      setAssetsChecked(result.data?.ids ?? [], true);
    } catch (reason) {
      setScopeError(describeError(reason, "无法选择当前筛选范围。"));
    }
  }, [filteredAssetIds, setAssetsChecked]);

  const toggleFolderPath = useCallback(
    (folderPath: string) =>
      updateScope(() =>
        annotationStageViewState.patch(projectId, (current) => ({
          folderPaths: toggleFolderSelection(current.folderPaths, folderPath),
        })),
      ),
    [projectId, updateScope],
  );

  const clearFolderPaths = useCallback(
    () => updateScope(() => annotationStageViewState.patch(projectId, { folderPaths: [] })),
    [projectId, updateScope],
  );

  const changeRecursiveScan = useCallback(
    (recursiveScan: boolean) => {
      if (updateWorkspace.isPending || workspace.data?.settings.recursive_scan === recursiveScan) {
        return;
      }
      updateScope(() => {
        updateWorkspace.mutate(
          { recursive_scan: recursiveScan },
          {
            onError: (reason) =>
              setScopeError(describeError(reason, "无法更新素材子文件夹扫描方式。")),
          },
        );
      });
    },
    [updateScope, updateWorkspace, workspace.data?.settings.recursive_scan],
  );

  const openWorkcell = useCallback(
    (workcell: AnnotationWorkcellId) => {
      if (workcell === activeWorkcell) return;
      void runWithDraftGuard(
        () => onOpenWorkcell(workcell),
        "切换标注工作间",
        "当前标注有尚未保存的修改。确定放弃后进入其他工作间吗？",
      );
    },
    [activeWorkcell, onOpenWorkcell, runWithDraftGuard],
  );

  const closeWorkcell = useCallback(() => {
    void runWithDraftGuard(
      onCloseWorkcell,
      "返回素材施工场",
      "当前标注有尚未保存的修改。确定放弃后返回吗？",
    );
  }, [onCloseWorkcell, runWithDraftGuard]);

  const returnToSpace = useCallback(() => {
    void runWithDraftGuard(
      onReturnToSpace,
      "离开素材施工场",
      "当前标注有尚未保存的修改。确定放弃后离开吗？",
    );
  }, [onReturnToSpace, runWithDraftGuard]);

  const openArchive = useCallback(() => {
    void runWithDraftGuard(
      onOpenArchive,
      "打开项目档案",
      "当前标注有尚未保存的修改。确定放弃后离开吗？",
    );
  }, [onOpenArchive, runWithDraftGuard]);

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
    scope: {
      search,
      filter,
      filters: [
        { id: "all", label: "全部素材", code: "ALL" },
        { id: "missing", label: "缺少标注", code: "MISS" },
        { id: "stale", label: "来源过期", code: "STAL" },
        { id: "invalid", label: "校验异常", code: "INVD" },
        { id: "failed", label: "任务失败", code: "FAIL" },
      ],
      folderPaths,
      folderOptions,
      folderLoading: folderLibrary.isPending,
      recursiveScan: workspace.data?.settings.recursive_scan ?? false,
      recursivePending: updateWorkspace.isPending,
      selectingAll: filteredAssetIds.isFetching,
      actionError: scopeError,
      setSearch: (value) => updateScope(() => setSearch(value)),
      setFilter: (value) => updateScope(() => setFilter(value)),
      toggleFolderPath,
      clearFolderPaths,
      setRecursiveScan: changeRecursiveScan,
      toggleRangeTo,
      clearChecked: clearCheckedAssets,
      selectAllFiltered,
    },
    currentAsset: focus.asset,
    currentIndex: focus.index,
    checkedAssetIds,
    channels,
    operation,
    activeWorkcell,
    overview: { batch },
    editWorkcell: {
      channel: editContent.channel,
      editor: editContent,
    },
    productionWorkcell: {
      production,
      projectContext,
      requestPreview: projectContextController.preview,
    },
    dossierWorkcell: {
      section: requestedDossierSection ?? "channels",
      dossier,
    },
    confirmation: pendingConfirmation
      ? {
          title: pendingConfirmation.request.title ?? "确认操作",
          message: pendingConfirmation.request.message,
          tone: pendingConfirmation.request.tone ?? "default",
          confirmLabel: pendingConfirmation.request.confirmLabel ?? "确认",
          cancelLabel: pendingConfirmation.request.cancelLabel ?? "取消",
        }
      : null,
    message,
    selectAsset,
    stepAsset,
    toggleAssetChecked,
    selectDossierSection: onDossierSectionChange,
    openWorkcell,
    closeWorkcell,
    selectEditChannel: (channel) => void editContent.selectChannel(channel),
    resolveConfirmation,
    returnToSpace,
    openArchive,
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
    scope: {
      search: "",
      filter: "all",
      filters: [],
      folderPaths: [],
      folderOptions: [],
      folderLoading: false,
      recursiveScan: false,
      recursivePending: false,
      selectingAll: false,
      actionError: null,
      setSearch: () => {},
      setFilter: () => {},
      toggleFolderPath: () => {},
      clearFolderPaths: () => {},
      setRecursiveScan: () => {},
      toggleRangeTo: () => {},
      clearChecked: () => {},
      selectAllFiltered: async () => {},
    },
    currentAsset: null,
    currentIndex: -1,
    checkedAssetIds: [],
    channels: [],
    operation: null,
    activeWorkcell: null,
    overview: { batch: null },
    editWorkcell: { channel: "tags", editor: null },
    productionWorkcell: {
      production: null,
      projectContext: null,
      requestPreview: null,
    },
    dossierWorkcell: { section: "channels", dossier: null },
    confirmation: null,
    message: null,
    selectAsset: () => {},
    stepAsset: () => {},
    toggleAssetChecked: () => {},
    selectDossierSection: () => {},
    openWorkcell: () => {},
    closeWorkcell: () => {},
    selectEditChannel: () => {},
    resolveConfirmation: () => {},
    returnToSpace: onReturnToSpace,
    openArchive: onOpenArchive,
  };
}
