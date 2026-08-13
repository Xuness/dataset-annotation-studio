import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useAssetFolders,
  useAssetIds,
  useAssets,
  useCandidateSummary,
} from "../../features/assets/hooks";
import {
  useImageProcessingBackends,
  usePreprocessExecutionPlan,
  usePreprocessOperations,
  usePreprocessingActions,
} from "../../features/preprocessing/hooks";
import { useWorkspace } from "../../features/workspaces/hooks";
import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";
import {
  folderSelectionsEqual,
  reconcileFolderSelection,
  toggleFolderSelection,
} from "../../shared/store/folderSelection";
import { actionError, type ConfirmInteraction } from "../interaction";
import {
  ACTIVE_PREPROCESS_STATUSES,
  buildPreprocessExecution,
  buildPreprocessRequest,
  preprocessRequestFingerprint,
  preprocessWorkbenchState,
  reconcileSelectedPreprocessOperationId,
  resolvePreprocessAcceleratorId,
  type PreprocessFormState,
} from "./preprocessState";

interface UsePreprocessControllerOptions {
  projectId: string;
  rescanPending: boolean;
  confirm: ConfirmInteraction;
}

export function usePreprocessController({
  projectId,
  rescanPending,
  confirm,
}: UsePreprocessControllerOptions) {
  const workspace = useWorkspace(projectId);
  const assets = useAssets(projectId, { limit: 1 });
  const candidateSummary = useCandidateSummary(projectId);
  const folders = useAssetFolders(projectId);
  const imageBackends = useImageProcessingBackends();
  const actions = usePreprocessingActions(projectId);
  const operations = usePreprocessOperations(
    projectId,
    actions.execute.isPending || actions.undo.isPending,
  );
  const checkedAssetIds = useWorkspaceSelectionStore((state) => state.checkedAssetIds);
  const setActiveProject = useWorkspaceSelectionStore((state) => state.setActiveProject);
  const { form, selectedOperationId } = preprocessWorkbenchState.useValue(projectId);
  const folderAssetIds = useAssetIds(
    projectId,
    { folderPaths: form.folderPaths },
    form.scope === "folder" && form.folderPaths.length > 0,
  );
  const folderOptions = useMemo(
    () => folders.data?.items.filter((folder) => Boolean(folder.path)) ?? [],
    [folders.data?.items],
  );
  const folderCount = folderAssetIds.data?.total ?? 0;
  const folderLoading =
    folders.isPending ||
    (form.scope === "folder" && form.folderPaths.length > 0 && folderAssetIds.isFetching);
  const scopeReady =
    form.scope === "all" ||
    (form.scope === "selected" && checkedAssetIds.length > 0) ||
    (form.scope === "folder" &&
      form.folderPaths.length > 0 &&
      folderAssetIds.isSuccess &&
      folderCount > 0);
  const scopeMessage =
    form.scope === "selected" && checkedAssetIds.length === 0
      ? "请先前往 03 素材施工场选择需要处理的素材。"
      : form.scope === "folder" && folders.isSuccess && folderOptions.length === 0
        ? "当前项目没有已索引的素材子文件夹。"
        : form.scope === "folder" && form.folderPaths.length === 0
          ? "请至少选择一个素材子文件夹。"
          : form.scope === "folder" && folderAssetIds.isError
            ? actionError(folderAssetIds.error, "无法读取所选子文件夹范围。")
            : form.scope === "folder" && !folderLoading && folderCount === 0
              ? "所选子文件夹范围中没有可处理的素材。"
              : null;
  const [error, setError] = useState<string | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);

  const patchForm = useCallback(
    (update: Partial<PreprocessFormState>) =>
      preprocessWorkbenchState.patch(projectId, (current) => ({
        form: { ...current.form, ...update },
      })),
    [projectId],
  );
  const setSelectedOperationId = useCallback(
    (operationId: string | null) =>
      preprocessWorkbenchState.patch(projectId, { selectedOperationId: operationId }),
    [projectId],
  );

  useEffect(() => {
    if (!folders.data) return;
    const reconciled = reconcileFolderSelection(
      form.folderPaths,
      folderOptions.map((folder) => folder.path),
    );
    if (folderSelectionsEqual(form.folderPaths, reconciled)) return;
    patchForm({ folderPaths: reconciled });
  }, [folderOptions, folders.data, form.folderPaths, patchForm]);

  const toggleFolderPath = useCallback(
    (folderPath: string) =>
      patchForm({ folderPaths: toggleFolderSelection(form.folderPaths, folderPath) }),
    [form.folderPaths, patchForm],
  );
  const clearFolderPaths = useCallback(() => patchForm({ folderPaths: [] }), [patchForm]);

  useEffect(() => {
    setActiveProject(projectId);
    setError(null);
    setPreviewFingerprint(null);
  }, [projectId, setActiveProject]);
  useEffect(() => {
    const operationItems = operations.data;
    if (!operationItems) return;
    preprocessWorkbenchState.patch(projectId, (current) => {
      const nextSelectedOperationId = reconcileSelectedPreprocessOperationId(
        current.selectedOperationId,
        operationItems,
      );
      return nextSelectedOperationId === current.selectedOperationId
        ? {}
        : { selectedOperationId: nextSelectedOperationId };
    });
  }, [operations.data, projectId]);

  const request = useMemo(
    () => buildPreprocessRequest(form, checkedAssetIds, folderAssetIds.data?.ids ?? []),
    [checkedAssetIds, folderAssetIds.data?.ids, form],
  );
  const resolvedAcceleratorId = useMemo(
    () => resolvePreprocessAcceleratorId(form, imageBackends.data),
    [form, imageBackends.data],
  );
  const execution = useMemo(
    () => buildPreprocessExecution(form, resolvedAcceleratorId),
    [form, resolvedAcceleratorId],
  );
  const requestFingerprint = useMemo(
    () => preprocessRequestFingerprint(projectId, request),
    [projectId, request],
  );
  const validPreview = previewFingerprint === requestFingerprint ? actions.preview.data : undefined;
  const executionPlan = usePreprocessExecutionPlan(
    projectId,
    request,
    validPreview?.preview_token,
    execution,
  );
  const activeOperation = operations.data?.find((operation) =>
    ACTIVE_PREPROCESS_STATUSES.has(operation.status),
  );
  const selectedOperation =
    operations.data?.find((operation) => operation.id === selectedOperationId) ?? null;
  const filesChanging =
    actions.execute.isPending || actions.undo.isPending || Boolean(activeOperation);
  const workspaceBusy = filesChanging || rescanPending;

  const preview = useCallback(async () => {
    setError(null);
    setPreviewFingerprint(null);
    if (!scopeReady) {
      setError(scopeMessage ?? "当前处理范围尚未就绪。");
      return;
    }
    try {
      await actions.preview.mutateAsync(request);
      setPreviewFingerprint(requestFingerprint);
      setSelectedOperationId(null);
    } catch (reason) {
      setError(actionError(reason, "无法生成预览。"));
    }
  }, [
    actions.preview,
    request,
    requestFingerprint,
    scopeMessage,
    scopeReady,
    setSelectedOperationId,
  ]);

  const execute = useCallback(async () => {
    const previewData = validPreview;
    if (!previewData || previewData.warning_count) return;
    const accepted = await confirm({
      message: `对 ${previewData.changed_count} 张图片执行预处理？原文件会保存在当前项目的恢复区。${
        executionPlan.data
          ? `预计 ${executionPlan.data.route_counts.accelerated_full ?? 0} 项使用加速管线、${
              executionPlan.data.route_counts.accelerated_resize ?? 0
            } 项仅加速缩放、${executionPlan.data.route_counts.cpu ?? 0} 项使用 CPU。`
          : ""
      }${request.rename ? "原标注、所有语言译文和 .json 也会一起重命名。" : ""}`,
      title: "执行预处理",
      confirmLabel: "执行",
    });
    if (!accepted) return;
    setError(null);
    setSelectedOperationId(null);
    try {
      await actions.execute.mutateAsync({
        request,
        previewToken: previewData.preview_token,
        execution,
      });
      actions.preview.reset();
      setPreviewFingerprint(null);
    } catch (reason) {
      setError(actionError(reason, "预处理失败。"));
    }
  }, [
    actions.execute,
    actions.preview,
    confirm,
    execution,
    executionPlan.data,
    request,
    setSelectedOperationId,
    validPreview,
  ]);

  const undo = useCallback(
    async (operationId: string) => {
      const accepted = await confirm({
        message: "撤销这次预处理并恢复原文件？撤销前会再次校验当前文件。",
        title: "撤销预处理",
        tone: "danger",
        confirmLabel: "撤销并恢复",
      });
      if (!accepted) return;
      setError(null);
      try {
        await actions.undo.mutateAsync(operationId);
      } catch (reason) {
        setError(actionError(reason, "撤销预处理失败。"));
      }
    },
    [actions.undo, confirm],
  );

  return {
    workspace,
    form,
    patchForm,
    assetCount: assets.data?.total ?? 0,
    candidateActive: Boolean(candidateSummary.data?.active),
    checkedCount: checkedAssetIds.length,
    folderOptions,
    folderCount,
    folderLoading,
    toggleFolderPath,
    clearFolderPaths,
    scopeReady,
    scopeMessage,
    preview: validPreview,
    previewPending:
      actions.preview.isPending || workspaceBusy || (form.scope === "folder" && folderLoading),
    executePending: workspaceBusy,
    error,
    backends: imageBackends.data,
    backendsPending: imageBackends.isPending,
    executionPlan: executionPlan.data,
    executionPlanPending: executionPlan.isFetching,
    executionPlanError: executionPlan.error instanceof Error ? executionPlan.error.message : null,
    selectedOperation,
    selectedOperationId,
    setSelectedOperationId,
    operations: operations.data ?? [],
    undoPending: workspaceBusy,
    filesChanging,
    workspaceBusy,
    previewAction: preview,
    executeAction: execute,
    undoAction: undo,
  };
}
