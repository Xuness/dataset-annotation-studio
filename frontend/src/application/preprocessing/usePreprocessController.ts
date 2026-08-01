import { useCallback, useEffect, useMemo, useState } from "react";

import { useAssets } from "../../features/assets/hooks";
import {
  useImageProcessingBackends,
  usePreprocessExecutionPlan,
  usePreprocessOperations,
  usePreprocessingActions,
} from "../../features/preprocessing/hooks";
import { useWorkspace } from "../../features/workspaces/hooks";
import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";
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
  const imageBackends = useImageProcessingBackends();
  const actions = usePreprocessingActions(projectId);
  const operations = usePreprocessOperations(
    projectId,
    actions.execute.isPending || actions.undo.isPending,
  );
  const checkedAssetIds = useWorkspaceSelectionStore((state) => state.checkedAssetIds);
  const setActiveProject = useWorkspaceSelectionStore((state) => state.setActiveProject);
  const { form, selectedOperationId } = preprocessWorkbenchState.useValue(projectId);
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
    () => buildPreprocessRequest(form, checkedAssetIds),
    [checkedAssetIds, form],
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
    try {
      await actions.preview.mutateAsync(request);
      setPreviewFingerprint(requestFingerprint);
      setSelectedOperationId(null);
    } catch (reason) {
      setError(actionError(reason, "无法生成预览。"));
    }
  }, [actions.preview, request, requestFingerprint, setSelectedOperationId]);

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
    checkedCount: checkedAssetIds.length,
    preview: validPreview,
    previewPending: actions.preview.isPending || workspaceBusy,
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
