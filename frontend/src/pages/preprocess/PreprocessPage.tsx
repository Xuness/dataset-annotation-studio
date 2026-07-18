import { useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { useAssets } from "../../features/assets/hooks";
import {
  usePreprocessOperations,
  usePreprocessingActions,
} from "../../features/preprocessing/hooks";
import { useRescanWorkspace, useWorkspace } from "../../features/workspaces/hooks";
import type { PreprocessExecutionOptions, PreprocessRequest } from "../../shared/api/types";
import { useAppStore } from "../../shared/store/appStore";
import { confirmDialog } from "../../shared/ui/dialogs";
import { Spinner } from "../../shared/ui/Spinner";
import { Button } from "../../shared/ui/Button";
import { NavigationRail } from "../workspace/components/NavigationRail";
import { WorkspaceTopbar } from "../workspace/components/WorkspaceTopbar";
import "../workspace/workspace.css";
import { PreprocessHistoryPanel } from "./components/PreprocessHistoryPanel";
import { PreprocessPreviewPanel } from "./components/PreprocessPreviewPanel";
import { PreprocessSettingsPanel } from "./components/PreprocessSettingsPanel";
import "./preprocess.css";
import type { PreprocessFormState } from "./types";

const initialForm: PreprocessFormState = {
  scope: "all",
  resizeEnabled: true,
  maxEdge: 2048,
  allowUpscale: false,
  convertEnabled: false,
  format: "webp",
  quality: 90,
  effort: 4,
  concurrencyMode: "auto",
  maxWorkers: 8,
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
  const operations = usePreprocessOperations(projectId);
  const actions = usePreprocessingActions(projectId);
  const checkedAssetIds = useAppStore((state) => state.checkedAssetIds);
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);

  useEffect(() => setActiveProject(projectId), [projectId, setActiveProject]);
  const request = useMemo<PreprocessRequest>(
    () => ({
      asset_ids: form.scope === "selected" ? checkedAssetIds : [],
      resize: form.resizeEnabled
        ? { max_edge: form.maxEdge, allow_upscale: form.allowUpscale }
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
  const execution = useMemo<PreprocessExecutionOptions>(
    () => ({
      max_workers: form.concurrencyMode === "manual" ? form.maxWorkers : null,
    }),
    [form.concurrencyMode, form.maxWorkers],
  );
  const requestFingerprint = useMemo(() => JSON.stringify(request), [request]);
  const validPreview = previewFingerprint === requestFingerprint ? actions.preview.data : undefined;
  const filesChanging = actions.execute.isPending || actions.undo.isPending;
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法生成预览。");
    }
  }

  async function execute() {
    const previewData = validPreview;
    if (!previewData || previewData.warning_count) return;
    const confirmed = await confirmDialog(
      `对 ${previewData.changed_count} 张图片执行预处理？原文件会保存在当前项目的恢复区。${request.rename ? "同名 .txt / .json 也会一起重命名。" : ""}`,
      { title: "执行预处理", confirmLabel: "执行" },
    );
    if (!confirmed) return;
    setError(null);
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
    <main className="workspace-page">
      <WorkspaceTopbar
        workspace={workspace.data}
        rescanning={workspaceBusy}
        onRescan={() => {
          if (!filesChanging) void rescan.mutateAsync();
        }}
      />
      <div className="workspace-body preprocess-workspace-body">
        <NavigationRail projectId={projectId} active="preprocess" />
        <PreprocessSettingsPanel
          form={form}
          onChange={(update) => setForm((current) => ({ ...current, ...update }))}
          assetCount={assets.data?.total ?? 0}
          checkedCount={checkedAssetIds.length}
          preview={validPreview}
          previewPending={actions.preview.isPending || workspaceBusy}
          executePending={workspaceBusy}
          error={error}
          onPreview={() => void preview()}
          onExecute={() => void execute()}
        />
        <PreprocessPreviewPanel preview={validPreview} />
        <PreprocessHistoryPanel
          operations={operations.data ?? []}
          undoPending={workspaceBusy}
          onUndo={(id) => void undo(id)}
        />
      </div>
      <footer className="workspace-statusbar">
        <span>当前仅展示预处理后的有效版本</span>
        <span className="workspace-statusbar__path">恢复区：.annotation-workspace/recovery</span>
      </footer>
    </main>
  );
}
