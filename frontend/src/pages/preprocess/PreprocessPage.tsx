import { useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { useAssets } from "../../features/assets/hooks";
import {
  useImageProcessingBackends,
  usePreprocessExecutionPlan,
  usePreprocessOperations,
  usePreprocessingActions,
} from "../../features/preprocessing/hooks";
import { useRescanWorkspace, useWorkspace } from "../../features/workspaces/hooks";
import { WorkspaceFrame } from "../../layouts/workspace/WorkspaceFrame";
import type { PreprocessExecutionOptions, PreprocessRequest } from "../../shared/api/types";
import { useAppStore } from "../../shared/store/appStore";
import { confirmDialog } from "../../shared/ui/dialogs";
import { Spinner } from "../../shared/ui/Spinner";
import { Button } from "../../shared/ui/Button";
import { PreprocessHistoryPanel } from "./components/PreprocessHistoryPanel";
import { PreprocessOperationDetailPanel } from "./components/PreprocessOperationDetailPanel";
import { PreprocessPreviewPanel } from "./components/PreprocessPreviewPanel";
import { PreprocessSettingsPanel } from "./components/PreprocessSettingsPanel";
import { activePreprocessStatuses } from "./operationProgress";
import "./preprocess.css";
import type { PreprocessFormState } from "./types";

const initialForm: PreprocessFormState = {
  scope: "all",
  resizeEnabled: true,
  maxEdge: 2048,
  allowUpscale: false,
  resizeAlgorithm: "lanczos3",
  convertEnabled: false,
  format: "webp",
  quality: 90,
  effort: 4,
  executionMode: "auto",
  acceleratorId: "",
  concurrencyMode: "auto",
  maxWorkers: 8,
  batchMode: "auto",
  batchSize: 32,
  renameEnabled: false,
  renameTemplate: "image_{index}",
  renameStartIndex: 1,
  renamePadding: 6,
};

export function PreprocessPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace(projectId);
  const assets = useAssets(projectId, { limit: 1 });
  const rescan = useRescanWorkspace(projectId);
  const imageBackends = useImageProcessingBackends();
  const actions = usePreprocessingActions(projectId);
  const operations = usePreprocessOperations(
    projectId,
    actions.execute.isPending || actions.undo.isPending,
  );
  const checkedAssetIds = useAppStore((state) => state.checkedAssetIds);
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);

  useEffect(() => {
    setActiveProject(projectId);
    setForm({ ...initialForm });
    setError(null);
    setPreviewFingerprint(null);
    setSelectedOperationId(null);
  }, [projectId, setActiveProject]);
  useEffect(() => {
    if (!operations.data) return;
    setSelectedOperationId((current) => {
      if (current && operations.data.some((operation) => operation.id === current)) {
        return current;
      }
      return (
        operations.data.find((operation) => activePreprocessStatuses.has(operation.status))?.id ??
        null
      );
    });
  }, [operations.data]);
  const request = useMemo<PreprocessRequest>(
    () => ({
      asset_ids: form.scope === "selected" ? checkedAssetIds : [],
      resize: form.resizeEnabled
        ? {
            max_edge: form.maxEdge,
            allow_upscale: form.allowUpscale,
            algorithm: form.resizeAlgorithm,
          }
        : null,
      convert: form.convertEnabled
        ? { format: form.format, quality: form.quality, effort: form.effort }
        : null,
      rename: form.renameEnabled
        ? {
            template: form.renameTemplate,
            start_index: form.renameStartIndex,
            padding: form.renamePadding,
          }
        : null,
    }),
    [checkedAssetIds, form],
  );
  const resolvedAcceleratorId = useMemo(() => {
    if (form.executionMode !== "prefer_accelerator") return null;
    const usable = imageBackends.data?.backends.filter(
      (backend) => backend.id !== "cpu" && backend.status !== "unavailable",
    );
    return (
      usable?.find((backend) => backend.id === form.acceleratorId)?.id ?? usable?.[0]?.id ?? null
    );
  }, [form.acceleratorId, form.executionMode, imageBackends.data]);
  const execution = useMemo<PreprocessExecutionOptions>(
    () => ({
      mode: form.executionMode,
      accelerator_id: resolvedAcceleratorId,
      max_workers: form.concurrencyMode === "manual" ? form.maxWorkers : null,
      batch_size: form.batchMode === "manual" ? form.batchSize : null,
    }),
    [
      form.batchMode,
      form.batchSize,
      form.concurrencyMode,
      form.executionMode,
      form.maxWorkers,
      resolvedAcceleratorId,
    ],
  );
  const requestFingerprint = useMemo(
    () => JSON.stringify([projectId, request]),
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
    activePreprocessStatuses.has(operation.status),
  );
  const selectedOperation =
    operations.data?.find((operation) => operation.id === selectedOperationId) ?? null;
  const filesChanging =
    actions.execute.isPending || actions.undo.isPending || Boolean(activeOperation);
  const workspaceBusy = filesChanging || rescan.isPending;

  if (workspace.isError) {
    return (
      <div className="workspace-loading workspace-loading--error">
        <AlertCircle size={28} />
        <p>{workspace.error instanceof Error ? workspace.error.message : "工作区不可用。"}</p>
        <Button onClick={() => navigate("/")}>返回项目首页</Button>
      </div>
    );
  }

  if (!workspace.data) {
    return (
      <div className="workspace-loading">
        <Spinner />
        <p>正在打开预处理工作台…</p>
      </div>
    );
  }

  async function preview() {
    setError(null);
    setPreviewFingerprint(null);
    try {
      await actions.preview.mutateAsync(request);
      setPreviewFingerprint(requestFingerprint);
      setSelectedOperationId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法生成预览。");
    }
  }

  async function execute() {
    const previewData = validPreview;
    if (!previewData || previewData.warning_count) return;
    const confirmed = await confirmDialog(
      `对 ${previewData.changed_count} 张图片执行预处理？原文件会保存在当前项目的恢复区。${
        executionPlan.data
          ? `预计 ${executionPlan.data.route_counts.accelerated_full ?? 0} 项使用加速管线、${
              executionPlan.data.route_counts.accelerated_resize ?? 0
            } 项仅加速缩放、${executionPlan.data.route_counts.cpu ?? 0} 项使用 CPU。`
          : ""
      }${request.rename ? "原标注、所有语言译文和 .json 也会一起重命名。" : ""}`,
      { title: "执行预处理", confirmLabel: "执行" },
    );
    if (!confirmed) return;
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
      setError(reason instanceof Error ? reason.message : "预处理失败。");
    }
  }

  async function undo(operationId: string) {
    const confirmed = await confirmDialog(
      "撤销这次预处理并恢复原文件？撤销前会再次校验当前文件。",
      { title: "撤销预处理", tone: "danger", confirmLabel: "撤销并恢复" },
    );
    if (!confirmed) return;
    setError(null);
    try {
      await actions.undo.mutateAsync(operationId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "撤销预处理失败。");
    }
  }

  return (
    <WorkspaceFrame
      workspace={workspace.data}
      projectId={projectId}
      active="preprocess"
      rescanning={workspaceBusy}
      onRescan={() => {
        if (!filesChanging) rescan.mutate();
      }}
      bodyClassName="preprocess-workspace-body"
      statusbar={
        <>
          <span>当前仅展示预处理后的有效版本</span>
          <span className="workspace-statusbar__path">恢复区：.annotation-workspace/recovery</span>
        </>
      }
    >
      <PreprocessSettingsPanel
        form={form}
        onChange={(update) => setForm((current) => ({ ...current, ...update }))}
        assetCount={assets.data?.total ?? 0}
        checkedCount={checkedAssetIds.length}
        preview={validPreview}
        previewPending={actions.preview.isPending || workspaceBusy}
        executePending={workspaceBusy}
        error={error}
        backends={imageBackends.data}
        backendsPending={imageBackends.isPending}
        executionPlan={executionPlan.data}
        executionPlanPending={executionPlan.isFetching}
        onPreview={() => void preview()}
        onExecute={() => void execute()}
      />
      {selectedOperation ? (
        <PreprocessOperationDetailPanel
          operation={selectedOperation}
          onBack={() => setSelectedOperationId(null)}
        />
      ) : (
        <PreprocessPreviewPanel
          preview={validPreview}
          executionPlan={executionPlan.data}
          executionPlanPending={executionPlan.isFetching}
          executionPlanError={
            executionPlan.error instanceof Error ? executionPlan.error.message : null
          }
        />
      )}
      <PreprocessHistoryPanel
        operations={operations.data ?? []}
        selectedOperationId={selectedOperationId}
        undoPending={workspaceBusy}
        onSelect={setSelectedOperationId}
        onUndo={(id) => void undo(id)}
      />
    </WorkspaceFrame>
  );
}
