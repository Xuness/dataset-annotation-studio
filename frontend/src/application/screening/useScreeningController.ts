import { useCallback, useEffect, useMemo, useState } from "react";

import { useAssetFolders, useAssetIds, useAssets } from "../../features/assets/hooks";
import {
  useScreeningActions,
  useScreeningCapabilities,
  useScreeningItems,
  useScreeningOperations,
} from "../../features/screening/hooks";
import { useWorkspace } from "../../features/workspaces/hooks";
import {
  folderSelectionsEqual,
  reconcileFolderSelection,
  toggleFolderSelection,
} from "../../shared/store/folderSelection";
import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";
import { actionError } from "../interaction";
import {
  ACTIVE_SCREENING_STATUSES,
  buildScreeningItemQuery,
  buildScreeningRequest,
  reconcileSelectedScreeningOperationId,
  screeningResultsReady,
  screeningWorkbenchState,
  type ScreeningFilterState,
  type ScreeningFormState,
} from "./screeningState";

interface UseScreeningControllerOptions {
  projectId: string;
  rescanPending: boolean;
}

export function useScreeningController({
  projectId,
  rescanPending,
}: UseScreeningControllerOptions) {
  const workspace = useWorkspace(projectId);
  const assets = useAssets(projectId, { limit: 1 });
  const folders = useAssetFolders(projectId);
  const capabilities = useScreeningCapabilities(projectId);
  const actions = useScreeningActions(projectId);
  const checkedAssetIds = useWorkspaceSelectionStore((state) => state.checkedAssetIds);
  const setActiveProject = useWorkspaceSelectionStore((state) => state.setActiveProject);
  const setAssetsChecked = useWorkspaceSelectionStore((state) => state.setAssetsChecked);
  const { form, filters, selectedOperationId, selectedAssetId, galleryDensity } =
    screeningWorkbenchState.useValue(projectId);
  const folderAssetIds = useAssetIds(
    projectId,
    { folderPaths: form.folderPaths },
    form.scope === "folder" && form.folderPaths.length > 0,
  );
  const allAssetIds = useAssetIds(projectId, {}, form.scope === "all");
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
  const resultsReady = screeningResultsReady(selectedOperation);
  const itemPages = useScreeningItems(projectId, selectedOperationId, itemQuery, resultsReady);
  const items = useMemo(
    () => (resultsReady ? (itemPages.data?.pages.flatMap((page) => page.items) ?? []) : []),
    [itemPages.data?.pages, resultsReady],
  );
  const itemTotal = resultsReady ? (itemPages.data?.pages[0]?.total ?? 0) : 0;
  const selectedItem = items.find((item) => item.asset_id === selectedAssetId) ?? null;

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
  const setGalleryDensity = useCallback(
    (density: "comfortable" | "compact") =>
      screeningWorkbenchState.patch(projectId, { galleryDensity: density }),
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
    } catch (reason) {
      setError(actionError(reason, "无法应用角色 LoRA 任务适配配置。"));
    }
  }, [actions.applyTaskProfile, form.profile, form.taskRules, selectedOperation]);

  const selectCurrentResult = useCallback(async () => {
    if (!selectedOperationId || !itemTotal) return;
    setError(null);
    try {
      const result = await actions.resolveAssetIds.mutateAsync({
        operationId: selectedOperationId,
        query: itemQuery,
      });
      setAssetsChecked(result.ids, true);
    } catch (reason) {
      setError(actionError(reason, "无法勾选当前筛选结果。"));
    }
  }, [actions.resolveAssetIds, itemQuery, itemTotal, selectedOperationId, setAssetsChecked]);

  return {
    workspace,
    capabilities,
    form,
    patchForm,
    filters,
    patchFilters,
    galleryDensity,
    setGalleryDensity,
    assetCount: assets.data?.total ?? workspace.data?.asset_count ?? 0,
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
    selectCurrentPending: actions.resolveAssetIds.isPending,
    createOperation,
    stopOperation,
    resumeOperation,
    applyTaskProfile,
    selectCurrentResult,
    workspaceBusy: rescanPending,
  };
}
