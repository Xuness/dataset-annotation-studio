import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { useAssets } from "../../features/assets/hooks";
import {
  usePreprocessOperations,
  usePreprocessingActions,
} from "../../features/preprocessing/hooks";
import { useRescanWorkspace, useWorkspace } from "../../features/workspaces/hooks";
import type { PreprocessRequest } from "../../shared/api/types";
import { useAppStore } from "../../shared/store/appStore";
import { Spinner } from "../../shared/ui/Spinner";
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
};

export function PreprocessPage() {
  const { projectId = "" } = useParams();
  const workspace = useWorkspace(projectId);
  const assets = useAssets(projectId, { limit: 10_000 });
  const rescan = useRescanWorkspace(projectId);
  const operations = usePreprocessOperations(projectId);
  const actions = usePreprocessingActions(projectId);
  const checkedAssetIds = useAppStore((state) => state.checkedAssetIds);
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);

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
    }),
    [checkedAssetIds, form],
  );

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
    try {
      await actions.preview.mutateAsync(request);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法生成预览。 ");
    }
  }

  async function execute() {
    const previewData = actions.preview.data;
    if (!previewData || previewData.warning_count) return;
    if (
      !window.confirm(
        `对 ${previewData.changed_count} 张图片执行预处理？原文件会保存在当前项目的恢复区。`,
      )
    )
      return;
    setError(null);
    try {
      await actions.execute.mutateAsync(request);
      actions.preview.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "预处理失败。 ");
    }
  }

  return (
    <main className="workspace-page">
      <WorkspaceTopbar
        workspace={workspace.data}
        rescanning={rescan.isPending}
        onRescan={() => void rescan.mutateAsync()}
      />
      <div className="workspace-body preprocess-workspace-body">
        <NavigationRail projectId={projectId} active="preprocess" />
        <PreprocessSettingsPanel
          form={form}
          onChange={(update) => setForm((current) => ({ ...current, ...update }))}
          assetCount={assets.data?.total ?? 0}
          checkedCount={checkedAssetIds.length}
          preview={actions.preview.data}
          previewPending={actions.preview.isPending}
          executePending={actions.execute.isPending}
          error={error}
          onPreview={() => void preview()}
          onExecute={() => void execute()}
        />
        <PreprocessPreviewPanel preview={actions.preview.data} />
        <PreprocessHistoryPanel
          operations={operations.data ?? []}
          undoPending={actions.undo.isPending}
          onUndo={(id) => void actions.undo.mutateAsync(id)}
        />
      </div>
      <footer className="workspace-statusbar">
        <span>当前仅展示预处理后的有效版本</span>
        <span className="workspace-statusbar__path">恢复区：.annotation-workspace/recovery</span>
      </footer>
    </main>
  );
}
