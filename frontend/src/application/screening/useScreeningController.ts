import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useAssetFolders,
  useAssetIds,
  useAssets,
  useCandidateActions,
  useCandidateSummary,
} from "../../features/assets/hooks";
import {
  useScreeningActions,
  useScreeningCapabilities,
  useScreeningItems,
  useScreeningOperations,
} from "../../features/screening/hooks";
import { useWorkspace } from "../../features/workspaces/hooks";
import type { CandidateUpdateRequest } from "../../shared/api/types";
import {
  folderSelectionsEqual,
  reconcileFolderSelection,
  toggleFolderSelection,
} from "../../shared/store/folderSelection";
import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";
import { actionError, type ConfirmInteraction } from "../interaction";
import {
  ACTIVE_SCREENING_STATUSES,
  buildScreeningCandidateHandoffQuery,
  buildScreeningItemQuery,
  buildScreeningRequest,
  checkedScreeningResultIds,
  clampScreeningThumbnailSize,
  reconcileSelectedScreeningOperationId,
  screeningResultsReady,
  screeningWorkbenchState,
  shouldCheckScreeningResult,
  type ScreeningFilterState,
  type ScreeningFormState,
} from "./screeningState";

interface UseScreeningControllerOptions {
  projectId: string;
  rescanPending: boolean;
  confirm: ConfirmInteraction;
}

export function useScreeningController({
  projectId,
  rescanPending,
  confirm,
}: UseScreeningControllerOptions) {
  const workspace = useWorkspace(projectId);
  const assets = useAssets(projectId, { candidateScope: "all", limit: 1 });
  const folders = useAssetFolders(projectId, true, "all");
  const capabilities = useScreeningCapabilities(projectId);
  const actions = useScreeningActions(projectId);
  const candidateSummary = useCandidateSummary(projectId);
  const candidateActions = useCandidateActions(projectId);
  const checkedAssetIds = useWorkspaceSelectionStore((state) => state.checkedAssetIds);
  const setActiveProject = useWorkspaceSelectionStore((state) => state.setActiveProject);
  const setAssetsChecked = useWorkspaceSelectionStore((state) => state.setAssetsChecked);
  const { form, filters, selectedOperationId, selectedAssetId, galleryThumbnailSize } =
    screeningWorkbenchState.useValue(projectId);
  const folderAssetIds = useAssetIds(
    projectId,
    { folderPaths: form.folderPaths, candidateScope: "all" },
    form.scope === "folder" && form.folderPaths.length > 0,
  );
  const allAssetIds = useAssetIds(projectId, { candidateScope: "all" }, form.scope === "all");
  const folderOptions = useMemo(
    () => folders.data?.items.filter((folder) => Boolean(folder.path)) ?? [],
    [folders.data?.items],
  );
  const folderCount = folderAssetIds.data?.total ?? 0;
  const folderLoading =
    folders.isPending ||
    (form.scope === "folder" && form.folderPaths.length > 0 && folderAssetIds.isFetching);
  const allAssetsLoading = form.scope === "all" && allAssetIds.isFetching;
  const [error, setError] = useState<string | null>(null);
  const [candidateMessage, setCandidateMessage] = useState<string | null>(null);
  const [resolvedSelectionScope, setResolvedSelectionScope] = useState<{
    key: string;
    ids: string[];
  } | null>(null);
  const [resolvedCandidateScope, setResolvedCandidateScope] = useState<{
    key: string;
    ids: string[];
  } | null>(null);

  const operations = useScreeningOperations(
    projectId,
    actions.create.isPending || actions.stop.isPending || actions.resume.isPending,
  );
  const selectedOperation =
    operations.data?.find((operation) => operation.id === selectedOperationId) ?? null;
  const activeOperation = operations.data?.find((operation) =>
    ACTIVE_SCREENING_STATUSES.has(operation.status),
  );
  const itemQuery = useMemo(() => buildScreeningItemQuery(filters), [filters]);
  const candidateHandoffQuery = useMemo(
    () => buildScreeningCandidateHandoffQuery(filters.showDuplicates),
    [filters.showDuplicates],
  );
  const selectionScopeKey = useMemo(
    () =>
      JSON.stringify([
        selectedOperationId,
        itemQuery.pool ?? null,
        itemQuery.rating ?? null,
        itemQuery.flag ?? null,
        Boolean(itemQuery.showDuplicates),
      ]),
    [
      itemQuery.flag,
      itemQuery.pool,
      itemQuery.rating,
      itemQuery.showDuplicates,
      selectedOperationId,
    ],
  );
  const resultsReady = screeningResultsReady(selectedOperation);
  const itemPages = useScreeningItems(projectId, selectedOperationId, itemQuery, resultsReady);
  const items = useMemo(
    () => (resultsReady ? (itemPages.data?.pages.flatMap((page) => page.items) ?? []) : []),
    [itemPages.data?.pages, resultsReady],
  );
  const itemTotal = resultsReady ? (itemPages.data?.pages[0]?.total ?? 0) : 0;
  const selectedItem = items.find((item) => item.asset_id === selectedAssetId) ?? null;
  const resolvedCurrentResultIds =
    resolvedSelectionScope?.key === selectionScopeKey ? resolvedSelectionScope.ids : null;
  const candidateScopeKey = `${selectedOperationId ?? ""}:${String(filters.showDuplicates)}`;
  const resolvedCandidateResultIds =
    resolvedCandidateScope?.key === candidateScopeKey ? resolvedCandidateScope.ids : null;
  const allCurrentResultsChecked = Boolean(
    resolvedCurrentResultIds?.length &&
    !shouldCheckScreeningResult(resolvedCurrentResultIds, checkedAssetIds),
  );

  const patchForm = useCallback(
    (update: Partial<ScreeningFormState>) =>
      screeningWorkbenchState.patch(projectId, (current) => ({
        form: { ...current.form, ...update },
      })),
    [projectId],
  );
  const patchFilters = useCallback(
    (update: Partial<ScreeningFilterState>) =>
      screeningWorkbenchState.patch(projectId, (current) => ({
        filters: { ...current.filters, ...update },
        selectedAssetId: null,
      })),
    [projectId],
  );
  const setSelectedOperationId = useCallback(
    (operationId: string | null) => {
      const operation = operations.data?.find((candidate) => candidate.id === operationId);
      const rules = operation?.task_profile_snapshot?.rules;
      screeningWorkbenchState.patch(projectId, (current) => ({
        selectedOperationId: operationId,
        selectedAssetId: null,
        ...(rules ? { form: { ...current.form, taskRules: rules } } : {}),
      }));
    },
    [operations.data, projectId],
  );
  const setSelectedAssetId = useCallback(
    (assetId: string | null) =>
      screeningWorkbenchState.patch(projectId, { selectedAssetId: assetId }),
    [projectId],
  );
  const setGalleryThumbnailSize = useCallback(
    (size: number) =>
      screeningWorkbenchState.patch(projectId, {
        galleryThumbnailSize: clampScreeningThumbnailSize(size),
      }),
    [projectId],
  );
  const toggleFolderPath = useCallback(
    (folderPath: string) =>
      patchForm({ folderPaths: toggleFolderSelection(form.folderPaths, folderPath) }),
    [form.folderPaths, patchForm],
  );

  useEffect(() => {
    setActiveProject(projectId);
    setError(null);
  }, [projectId, setActiveProject]);

  useEffect(() => {
    if (!folders.data) return;
    const reconciled = reconcileFolderSelection(
      form.folderPaths,
      folderOptions.map((folder) => folder.path),
    );
    if (!folderSelectionsEqual(form.folderPaths, reconciled)) {
      patchForm({ folderPaths: reconciled });
    }
  }, [folderOptions, folders.data, form.folderPaths, patchForm]);

  useEffect(() => {
    if (!operations.data) return;
    const next = reconcileSelectedScreeningOperationId(selectedOperationId, operations.data);
    if (next !== selectedOperationId) setSelectedOperationId(next);
  }, [operations.data, selectedOperationId, setSelectedOperationId]);

  const invalidSnapshot =
    Boolean(form.metadataSnapshotAtFallback.trim()) &&
    !Number.isFinite(Date.parse(form.metadataSnapshotAtFallback));
  const scopeReady =
    (form.scope === "all" && allAssetIds.isSuccess && (allAssetIds.data?.total ?? 0) > 0) ||
    (form.scope === "selected" && checkedAssetIds.length > 0) ||
    (form.scope === "folder" &&
      form.folderPaths.length > 0 &&
      folderAssetIds.isSuccess &&
      folderCount > 0);
  const scopeMessage =
    form.scope === "all" && allAssetIds.isError
      ? actionError(allAssetIds.error, "无法冻结当前项目的筛选范围。")
      : form.scope === "all" && allAssetIds.isSuccess && allAssetIds.data.total === 0
        ? "当前项目没有可筛选的图片。"
        : form.scope === "selected" && checkedAssetIds.length === 0
          ? "请先在素材页勾选需要筛选的图片。"
          : form.scope === "folder" && folders.isSuccess && folderOptions.length === 0
            ? "当前项目没有已索引的素材子文件夹。"
            : form.scope === "folder" && form.folderPaths.length === 0
              ? "请至少选择一个素材子文件夹。"
              : form.scope === "folder" && folderAssetIds.isError
                ? actionError(folderAssetIds.error, "无法读取所选文件夹范围。")
                : form.scope === "folder" && !folderLoading && folderCount === 0
                  ? "所选文件夹内没有可筛选的图片。"
                  : invalidSnapshot
                    ? "元数据快照回退时间无效。"
                    : null;

  const createOperation = useCallback(async () => {
    setError(null);
    if (!scopeReady || invalidSnapshot) {
      setError(scopeMessage ?? "当前筛选范围尚未就绪。");
      return;
    }
    try {
      const operation = await actions.create.mutateAsync(
        buildScreeningRequest(
          form,
          checkedAssetIds,
          folderAssetIds.data?.ids ?? [],
          allAssetIds.data?.ids ?? [],
        ),
      );
      setSelectedOperationId(operation.id);
    } catch (reason) {
      setError(actionError(reason, "无法启动初步筛选。"));
    }
  }, [
    actions.create,
    allAssetIds.data?.ids,
    checkedAssetIds,
    folderAssetIds.data?.ids,
    form,
    invalidSnapshot,
    scopeMessage,
    scopeReady,
    setSelectedOperationId,
  ]);

  const stopOperation = useCallback(async () => {
    if (!activeOperation) return;
    setError(null);
    try {
      await actions.stop.mutateAsync(activeOperation.id);
    } catch (reason) {
      setError(actionError(reason, "停止筛选失败。"));
    }
  }, [actions.stop, activeOperation]);

  const resumeOperation = useCallback(async () => {
    if (!selectedOperation) return;
    setError(null);
    try {
      await actions.resume.mutateAsync(selectedOperation.id);
    } catch (reason) {
      setError(actionError(reason, "继续筛选失败。"));
    }
  }, [actions.resume, selectedOperation]);

  const applyTaskProfile = useCallback(async () => {
    if (!selectedOperation || selectedOperation.status !== "completed") return;
    setError(null);
    try {
      await actions.applyTaskProfile.mutateAsync({
        operationId: selectedOperation.id,
        selection: {
          task_profile: form.profile,
          task_rules: form.taskRules,
        },
      });
      setResolvedSelectionScope(null);
    } catch (reason) {
      setError(actionError(reason, "无法应用角色 LoRA 任务适配配置。"));
    }
  }, [actions.applyTaskProfile, form.profile, form.taskRules, selectedOperation]);

  const resolveCurrentResultIds = useCallback(async (): Promise<string[]> => {
    if (!selectedOperationId || !itemTotal) return [];
    if (resolvedCurrentResultIds) return resolvedCurrentResultIds;
    const result = await actions.resolveCurrentAssetIds.mutateAsync({
      operationId: selectedOperationId,
      query: itemQuery,
    });
    setResolvedSelectionScope({ key: selectionScopeKey, ids: result.ids });
    return result.ids;
  }, [
    actions.resolveCurrentAssetIds,
    itemQuery,
    itemTotal,
    resolvedCurrentResultIds,
    selectedOperationId,
    selectionScopeKey,
  ]);

  const selectCurrentResult = useCallback(async () => {
    if (!selectedOperationId || !itemTotal) return;
    setError(null);
    try {
      const resultIds = await resolveCurrentResultIds();
      const shouldCheck = shouldCheckScreeningResult(
        resultIds,
        useWorkspaceSelectionStore.getState().checkedAssetIds,
      );
      setAssetsChecked(resultIds, shouldCheck);
    } catch (reason) {
      setError(actionError(reason, "无法切换当前筛选结果的勾选状态。"));
    }
  }, [itemTotal, resolveCurrentResultIds, selectedOperationId, setAssetsChecked]);

  const resolveCandidateResultIds = useCallback(async (): Promise<string[]> => {
    if (!selectedOperationId || !resultsReady) return [];
    if (resolvedCandidateResultIds) return resolvedCandidateResultIds;
    const result = await actions.resolveCandidateAssetIds.mutateAsync({
      operationId: selectedOperationId,
      query: candidateHandoffQuery,
    });
    setResolvedCandidateScope({ key: candidateScopeKey, ids: result.ids });
    return result.ids;
  }, [
    actions.resolveCandidateAssetIds,
    candidateHandoffQuery,
    candidateScopeKey,
    resolvedCandidateResultIds,
    resultsReady,
    selectedOperationId,
  ]);

  const updateCandidateSet = useCallback(
    async (action: CandidateUpdateRequest["action"]) => {
      setError(null);
      setCandidateMessage(null);
      try {
        let assetIds: string[] = [];
        if (action !== "clear") {
          const currentResultIds = await resolveCandidateResultIds();
          assetIds = checkedScreeningResultIds(
            currentResultIds,
            useWorkspaceSelectionStore.getState().checkedAssetIds,
          );
          if (!assetIds.length) {
            setError("当前筛选任务中没有可写入的已勾选图片；隐藏的重复图不会进入候选集。");
            return;
          }
        }

        if (action === "replace") {
          const accepted = await confirm({
            message: `用当前筛选任务中累计勾选的 ${assetIds.length} 张图片替换整个候选集？隐藏的重复图不会写入。`,
            title: "替换候选集",
            tone: "danger",
            confirmLabel: "替换",
          });
          if (!accepted) return;
        } else if (action === "remove") {
          const accepted = await confirm({
            message: `从候选集中移出当前筛选任务累计勾选的 ${assetIds.length} 张图片？候选集变空后，后续流程会恢复使用全部素材。`,
            title: "移出候选集",
            confirmLabel: "移出",
          });
          if (!accepted) return;
        } else if (action === "clear") {
          const accepted = await confirm({
            message: "清空候选集？清空后素材页和后续流程会恢复使用项目内全部图片。",
            title: "清空候选集",
            tone: "danger",
            confirmLabel: "清空",
          });
          if (!accepted) return;
        }

        const summary = await candidateActions.update.mutateAsync({
          action,
          asset_ids: assetIds,
          source_kind: action === "clear" ? "manual" : "screening",
          source_operation_id: action === "clear" ? null : selectedOperationId,
        });
        setCandidateMessage(
          summary.active
            ? `候选集已更新，本次处理 ${assetIds.length} 张，当前共 ${summary.candidate_count} 张；累计勾选已保留。`
            : "候选集已清空；累计勾选仍保留，素材页和后续流程已恢复全部素材范围。",
        );
      } catch (reason) {
        setError(actionError(reason, "无法更新候选集。"));
      }
    },
    [candidateActions.update, confirm, resolveCandidateResultIds, selectedOperationId],
  );

  return {
    workspace,
    capabilities,
    form,
    patchForm,
    filters,
    patchFilters,
    galleryThumbnailSize,
    setGalleryThumbnailSize,
    assetCount: assets.data?.total ?? workspace.data?.asset_count ?? 0,
    candidateSummary,
    candidateMessage,
    checkedAssetIds,
    setAssetsChecked,
    folderOptions,
    folderCount,
    folderLoading,
    toggleFolderPath,
    clearFolderPaths: () => patchForm({ folderPaths: [] }),
    scopeReady: scopeReady && !invalidSnapshot,
    scopeMessage,
    operations: operations.data ?? [],
    operationsPending: operations.isPending,
    selectedOperation,
    selectedOperationId,
    setSelectedOperationId,
    activeOperation,
    items,
    itemTotal,
    resultsReady,
    itemsPending: resultsReady && itemPages.isPending,
    itemsFetching: resultsReady && itemPages.isFetching,
    itemsError: itemPages.error instanceof Error ? itemPages.error.message : null,
    hasMoreItems: resultsReady && Boolean(itemPages.hasNextPage),
    loadMoreItems: () => {
      if (resultsReady) void itemPages.fetchNextPage();
    },
    selectedItem,
    selectedAssetId,
    setSelectedAssetId,
    error,
    createPending: actions.create.isPending || folderLoading || allAssetsLoading,
    stopPending: actions.stop.isPending,
    resumePending: actions.resume.isPending,
    applyTaskProfilePending: actions.applyTaskProfile.isPending,
    selectCurrentPending: actions.resolveCurrentAssetIds.isPending,
    candidateUpdatePending:
      actions.resolveCandidateAssetIds.isPending || candidateActions.update.isPending,
    allCurrentResultsChecked,
    createOperation,
    stopOperation,
    resumeOperation,
    applyTaskProfile,
    selectCurrentResult,
    updateCandidateSet,
    workspaceBusy: rescanPending,
  };
}
