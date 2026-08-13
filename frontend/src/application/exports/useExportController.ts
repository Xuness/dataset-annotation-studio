import { useCallback, useEffect, useMemo, useState } from "react";

import { useAssets, useCandidateSummary } from "../../features/assets/hooks";
import { useExportActions, useExportOperations } from "../../features/exports/hooks";
import { useWorkspace } from "../../features/workspaces/hooks";
import { openLocalFolder } from "../../shared/desktop/openLocalFolder";
import { pickExportFolder } from "../../shared/desktop/pickFolder";
import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";
import { actionError, type AlertInteraction, type ConfirmInteraction } from "../interaction";
import {
  buildExportRequest,
  exportRequestFingerprint,
  exportWorkbenchState,
  hasActiveExport,
  type ExportFormState,
} from "./exportState";

interface UseExportControllerOptions {
  projectId: string;
  confirm: ConfirmInteraction;
  alert: AlertInteraction;
}

export function useExportController({ projectId, confirm, alert }: UseExportControllerOptions) {
  const workspace = useWorkspace(projectId);
  const assets = useAssets(projectId, { limit: 1 });
  const candidateSummary = useCandidateSummary(projectId);
  const operations = useExportOperations(projectId);
  const actions = useExportActions(projectId);
  const checkedAssetIds = useWorkspaceSelectionStore((state) => state.checkedAssetIds);
  const setActiveProject = useWorkspaceSelectionStore((state) => state.setActiveProject);
  const { form } = exportWorkbenchState.useValue(projectId);
  const [error, setError] = useState<string | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);

  const patchForm = useCallback(
    (update: Partial<ExportFormState>) =>
      exportWorkbenchState.patch(projectId, (current) => ({
        form: { ...current.form, ...update },
      })),
    [projectId],
  );

  useEffect(() => {
    setActiveProject(projectId);
    setError(null);
    setPreviewFingerprint(null);
  }, [projectId, setActiveProject]);

  const request = useMemo(() => buildExportRequest(form, checkedAssetIds), [checkedAssetIds, form]);
  const requestFingerprint = useMemo(
    () => exportRequestFingerprint(projectId, request),
    [projectId, request],
  );
  const validPreview = previewFingerprint === requestFingerprint ? actions.preview.data : undefined;
  const activeExport = hasActiveExport(operations.data);
  const actionPending =
    actions.create.isPending || actions.stop.isPending || actions.resume.isPending;

  const chooseFolder = useCallback(async () => {
    setError(null);
    try {
      const selected = await pickExportFolder();
      if (selected) patchForm({ destinationPath: selected });
    } catch (reason) {
      setError(actionError(reason, "无法选择导出目录。"));
    }
  }, [patchForm]);

  const preview = useCallback(async () => {
    setError(null);
    setPreviewFingerprint(null);
    try {
      await actions.preview.mutateAsync(request);
      setPreviewFingerprint(requestFingerprint);
    } catch (reason) {
      setError(actionError(reason, "无法校验导出范围。"));
    }
  }, [actions.preview, request, requestFingerprint]);

  const resetPreview = useCallback(() => {
    actions.preview.reset();
    setPreviewFingerprint(null);
  }, [actions.preview]);

  const startExport = useCallback(async () => {
    const previewData = validPreview;
    if (!previewData || previewData.blocking_issue_count) return;
    let allowWarnings = false;
    if (previewData.warning_count) {
      const accepted = await confirm({
        message: [
          `所选 ${previewData.total_items} 张图片中发现 ${previewData.warning_count} 个标注警告：`,
          `未标注 ${previewData.missing_count}，空内容 ${previewData.empty_count}，`,
          `已过期 ${previewData.stale_count}，`,
          `结构异常 ${previewData.invalid_count}，编码异常 ${previewData.encoding_error_count}。`,
          "继续后会严格使用当前预览冻结的数据库修订；缺失通道不会生成对应标注文件。",
        ].join("\n"),
        title: "发现标注问题",
        tone: "danger",
        confirmLabel: "忽略警告并导出",
        cancelLabel: "返回检查",
      });
      if (!accepted) return;
      allowWarnings = true;
    } else {
      const accepted = await confirm({
        message:
          form.packaging === "zip"
            ? `将 ${previewData.total_items} 张图片及所选标注通道打包为 ZIP 压缩包？`
            : `将 ${previewData.total_items} 张图片及所选标注通道物化到导出目录？`,
        title: "开始导出",
        confirmLabel: "开始导出",
      });
      if (!accepted) return;
    }

    setError(null);
    try {
      await actions.create.mutateAsync({
        request,
        previewToken: previewData.preview_token,
        allowWarnings,
      });
      actions.preview.reset();
      setPreviewFingerprint(null);
    } catch (reason) {
      setError(actionError(reason, "无法创建导出任务。"));
    }
  }, [actions.create, actions.preview, confirm, form.packaging, request, validPreview]);

  const stop = useCallback(
    async (operationId: string) => {
      const operation = operations.data?.find((candidate) => candidate.id === operationId);
      const packaging = operation?.configuration_snapshot.packaging ?? "directory";
      const accepted = await confirm({
        message:
          packaging === "zip"
            ? "停止后未完成的临时压缩包会删除；继续任务时会从头重新打包。"
            : "停止后已完成的输出文件会保留在导出目录中，之后可以继续任务。",
        title: "停止导出",
        confirmLabel: "停止",
      });
      if (!accepted) return;
      setError(null);
      try {
        await actions.stop.mutateAsync(operationId);
      } catch (reason) {
        setError(actionError(reason, "无法停止导出任务。"));
      }
    },
    [actions.stop, confirm, operations.data],
  );

  const resume = useCallback(
    async (operationId: string) => {
      setError(null);
      try {
        await actions.resume.mutateAsync(operationId);
      } catch (reason) {
        setError(actionError(reason, "无法继续导出任务。"));
      }
    },
    [actions.resume],
  );

  const openFolder = useCallback(
    async (path: string) => {
      try {
        await openLocalFolder(path);
      } catch (reason) {
        await alert({
          message: actionError(reason, "无法打开导出目录。"),
          title: "打开目录失败",
        });
      }
    },
    [alert],
  );

  return {
    workspace,
    form,
    patchForm,
    assetCount: assets.data?.total ?? workspace.data?.asset_count ?? 0,
    candidateActive: Boolean(candidateSummary.data?.active),
    checkedCount: checkedAssetIds.length,
    preview: validPreview,
    previewPending: actions.preview.isPending,
    exportPending: actionPending,
    activeExport,
    error,
    operations: operations.data ?? [],
    operationsPending: operations.isPending,
    operationsError: operations.error,
    chooseFolder,
    previewAction: preview,
    resetPreview,
    startExport,
    stop,
    resume,
    openFolder,
  };
}
