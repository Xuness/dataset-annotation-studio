import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useAssetFolders,
  useAssetIds,
  useCandidateSummary,
  useInfiniteAssets,
} from "../../features/assets/hooks";
import { useUpdateWorkspace, useWorkspace } from "../../features/workspaces/hooks";
import type {
  AnnotationChannelTarget,
  AssetFilterStatus,
  CandidateScope,
} from "../../shared/api/types";
import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";
import type { AlertInteraction, ConfirmInteraction } from "../interaction";
import type { AnnotationBulkAction } from "../annotations/annotationBulk";
import {
  assetBrowserViewState,
  browserScopeKey,
  type WorkspaceBrowserMode,
} from "./assetBrowserState";
import { useAssetDeletionController } from "./useAssetDeletionController";
import {
  areAllAssetsChecked,
  CLOSED_ANNOTATION_DIALOG,
  CLOSED_TAG_BATCH_DIALOG,
  DEFAULT_EDITOR_TARGET,
  editorDiscardMessage,
  resolveKnownMatchingAssetIds,
  type EditorDirtyKind,
} from "./workspaceAssets";

interface UseWorkspaceAssetsControllerOptions {
  projectId: string;
  mode: WorkspaceBrowserMode;
  confirm: ConfirmInteraction;
  alert: AlertInteraction;
}

export function useWorkspaceAssetsController({
  projectId,
  mode,
  confirm,
  alert,
}: UseWorkspaceAssetsControllerOptions) {
  const workspace = useWorkspace(projectId);
  const updateWorkspace = useUpdateWorkspace(projectId);
  const checkedAssetIds = useWorkspaceSelectionStore((state) => state.checkedAssetIds);
  const setAssetsChecked = useWorkspaceSelectionStore((state) => state.setAssetsChecked);
  const setActiveProject = useWorkspaceSelectionStore((state) => state.setActiveProject);
  const browserScope = browserScopeKey(projectId, mode);
  const { search, statusFilter, folderPath, candidateScope, selectedAssetId } =
    assetBrowserViewState.useValue(browserScope);
  const candidateSummary = useCandidateSummary(projectId);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorDirtyKind, setEditorDirtyKind] = useState<EditorDirtyKind>(null);
  const [editorTarget, setEditorTarget] = useState<AnnotationChannelTarget>(DEFAULT_EDITOR_TARGET);
  const [editorRevision, setEditorRevision] = useState(0);
  const [annotationDialog, setAnnotationDialog] = useState(CLOSED_ANNOTATION_DIALOG);
  const [tagBatchDialog, setTagBatchDialog] = useState(CLOSED_TAG_BATCH_DIALOG);

  const selectAsset = useCallback(
    (assetId: string | null) =>
      assetBrowserViewState.patch(browserScope, { selectedAssetId: assetId }),
    [browserScope],
  );
  const setSearch = useCallback(
    (value: string) => assetBrowserViewState.patch(browserScope, { search: value }),
    [browserScope],
  );
  const setStatusFilter = useCallback(
    (value: AssetFilterStatus | null) =>
      assetBrowserViewState.patch(browserScope, { statusFilter: value }),
    [browserScope],
  );
  const setFolderPath = useCallback(
    (value: string) => assetBrowserViewState.patch(browserScope, { folderPath: value }),
    [browserScope],
  );
  const setCandidateScope = useCallback(
    (value: Extract<CandidateScope, "auto" | "all">) =>
      assetBrowserViewState.patch(browserScope, {
        candidateScope: value,
        folderPath: "",
        selectedAssetId: null,
      }),
    [browserScope],
  );

  const assetQuery = useMemo(
    () => ({ search, status: statusFilter, folderPath, candidateScope }),
    [candidateScope, folderPath, search, statusFilter],
  );
  const assets = useInfiniteAssets(projectId, assetQuery);
  const matchingAssetIds = useAssetIds(projectId, assetQuery);
  const folders = useAssetFolders(projectId, true, candidateScope);
  const discardEditorDraft = useCallback(() => {
    setEditorDirty(false);
    setEditorDirtyKind(null);
    setEditorRevision((current) => current + 1);
  }, []);
  const updateEditorDirty = useCallback((dirty: boolean, kind: EditorDirtyKind) => {
    setEditorDirty(dirty);
    setEditorDirtyKind(dirty ? kind : null);
  }, []);
  const assetDeletion = useAssetDeletionController({
    contextKey: `${projectId}:${mode}`,
    selectedAssetId,
    editorDirty,
    discardEditorDraft,
    selectAsset,
    confirm,
  });
  const assetItems = useMemo(
    () => assets.data?.pages.flatMap((page) => page.items) ?? [],
    [assets.data?.pages],
  );
  const assetResult = assets.data?.pages[0];
  const knownMatchingAssetIds = useMemo(
    () =>
      resolveKnownMatchingAssetIds({
        loadedAssets: assetItems,
        total: assetResult?.total,
        hasNextPage: Boolean(assets.hasNextPage),
        queriedIds: matchingAssetIds.data?.ids,
        queriedTotal: matchingAssetIds.data?.total,
        queriedIdsStale: matchingAssetIds.isStale,
      }),
    [
      assetItems,
      assetResult?.total,
      assets.hasNextPage,
      matchingAssetIds.data,
      matchingAssetIds.isStale,
    ],
  );
  const allMatchingSelected = useMemo(
    () => areAllAssetsChecked(knownMatchingAssetIds, checkedAssetIds),
    [checkedAssetIds, knownMatchingAssetIds],
  );

  const loadMoreAssets = useCallback(() => {
    if (assets.hasNextPage && !assets.isFetchingNextPage) void assets.fetchNextPage();
  }, [assets]);

  useEffect(() => {
    setActiveProject(projectId);
    setEditorDirty(false);
    setEditorDirtyKind(null);
    setEditorTarget(DEFAULT_EDITOR_TARGET);
    setEditorRevision(0);
    setAnnotationDialog(CLOSED_ANNOTATION_DIALOG);
    setTagBatchDialog(CLOSED_TAG_BATCH_DIALOG);
  }, [mode, projectId, setActiveProject]);

  useEffect(() => {
    if (
      editorDirty ||
      !folders.data ||
      folders.data.items.some((folder) => folder.path === folderPath)
    ) {
      return;
    }
    setFolderPath("");
  }, [editorDirty, folderPath, folders.data, setFolderPath]);

  useEffect(() => {
    if (editorDirty || assets.isLoading) return;
    if (!assetItems.length) {
      if (selectedAssetId) selectAsset(null);
      return;
    }
    if (!selectedAssetId || !assetItems.some((asset) => asset.id === selectedAssetId)) {
      selectAsset(assetItems[0].id);
    }
  }, [assetItems, assets.isLoading, editorDirty, selectAsset, selectedAssetId]);

  const selectedAsset = assetItems.find((asset) => asset.id === selectedAssetId) ?? null;

  const requestSelectAsset = useCallback(
    async (assetId: string): Promise<boolean> => {
      if (!editorDirty) {
        selectAsset(assetId);
        return true;
      }
      const accepted = await confirm({
        message: editorDiscardMessage(editorDirtyKind, "asset"),
        title: "尚未保存",
        tone: "danger",
        confirmLabel: "丢弃并切换",
        cancelLabel: "继续编辑",
      });
      if (!accepted) return false;
      selectAsset(assetId);
      return true;
    },
    [confirm, editorDirty, editorDirtyKind, selectAsset],
  );

  const requestFolderSelect = useCallback(
    async (nextFolderPath: string): Promise<boolean> => {
      if (nextFolderPath === folderPath) return true;
      if (editorDirty) {
        const accepted = await confirm({
          message: editorDiscardMessage(editorDirtyKind, "folder"),
          title: "尚未保存",
          tone: "danger",
          confirmLabel: "丢弃并切换",
          cancelLabel: "继续编辑",
        });
        if (!accepted) return false;
        discardEditorDraft();
      }
      setFolderPath(nextFolderPath);
      return true;
    },
    [confirm, discardEditorDraft, editorDirty, editorDirtyKind, folderPath, setFolderPath],
  );

  const requestCandidateScopeChange = useCallback(
    async (nextScope: Extract<CandidateScope, "auto" | "all">): Promise<boolean> => {
      if (nextScope === candidateScope) return true;
      if (editorDirty) {
        const accepted = await confirm({
          message: editorDiscardMessage(editorDirtyKind, "scope"),
          title: "尚未保存",
          tone: "danger",
          confirmLabel: "丢弃并切换",
          cancelLabel: "继续编辑",
        });
        if (!accepted) return false;
        discardEditorDraft();
      }
      setCandidateScope(nextScope);
      return true;
    },
    [candidateScope, confirm, discardEditorDraft, editorDirty, editorDirtyKind, setCandidateScope],
  );

  const toggleAllMatchingAssets = useCallback(async () => {
    let assetIds = knownMatchingAssetIds;
    if (!assetIds) {
      const result = await matchingAssetIds.refetch();
      if (!result.data) {
        await alert({
          message:
            result.error instanceof Error ? result.error.message : "读取全选范围失败，请稍后重试。",
          title: "全选失败",
        });
        return;
      }
      assetIds = result.data.ids;
    }

    const checked = new Set(useWorkspaceSelectionStore.getState().checkedAssetIds);
    const shouldCheck = !assetIds.length || !assetIds.every((assetId) => checked.has(assetId));
    setAssetsChecked(assetIds, shouldCheck);
  }, [alert, knownMatchingAssetIds, matchingAssetIds, setAssetsChecked]);

  const openAnnotationDialog = useCallback((action: AnnotationBulkAction) => {
    const assetIds = [...useWorkspaceSelectionStore.getState().checkedAssetIds];
    if (!assetIds.length) return;
    setAnnotationDialog({ open: true, action, assetIds });
  }, []);

  const closeAnnotationDialog = useCallback(() => {
    setAnnotationDialog((current) => ({ ...current, open: false }));
  }, []);

  const openTagBatchDialog = useCallback(() => {
    const assetIds = [...useWorkspaceSelectionStore.getState().checkedAssetIds];
    if (!assetIds.length) return;
    setTagBatchDialog({ open: true, assetIds });
  }, []);

  const closeTagBatchDialog = useCallback(() => {
    setTagBatchDialog((current) => ({ ...current, open: false }));
  }, []);

  const updateRecursiveScan = useCallback(
    (recursiveScan: boolean) =>
      updateWorkspace.mutate(
        { recursive_scan: recursiveScan },
        {
          onError: (error) =>
            void alert({
              message: error instanceof Error ? error.message : "无法更新递归扫描设置。",
              title: "保存扫描设置失败",
            }),
        },
      ),
    [alert, updateWorkspace],
  );

  const blockedAnnotationTarget =
    editorDirty && selectedAssetId && annotationDialog.assetIds.includes(selectedAssetId)
      ? editorTarget
      : null;
  const blockedTagDraft = Boolean(
    editorDirty &&
    editorDirtyKind === "tags" &&
    selectedAssetId &&
    tagBatchDialog.assetIds.includes(selectedAssetId),
  );

  return {
    workspace,
    assets,
    folders,
    assetItems,
    assetResult,
    selectedAsset,
    selectedAssetId,
    checkedAssetIds,
    search,
    statusFilter,
    folderPath,
    candidateScope,
    candidateSummary,
    editorRevision,
    annotationDialog,
    tagBatchDialog,
    blockedAnnotationTarget,
    blockedTagDraft,
    allMatchingSelected,
    selectAllPending: matchingAssetIds.isFetching,
    setAssetsChecked,
    setSearch,
    setStatusFilter,
    requestFolderSelect,
    requestCandidateScopeChange,
    requestSelectAsset,
    loadMoreAssets,
    toggleAllMatchingAssets,
    openAnnotationDialog,
    closeAnnotationDialog,
    openTagBatchDialog,
    closeTagBatchDialog,
    updateEditorDirty,
    setEditorTarget,
    updateRecursiveScan,
    assetDeletion,
  };
}
