import { AlertCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { useExportController } from "../../../src/application/exports/useExportController";
import { useLegacyRescanWorkspace } from "../../legacy/hooks/useLegacyRescanWorkspace";
import { legacyAlert, legacyConfirm } from "../../legacy/legacyInteractions";
import { WorkspaceFrame } from "../../layouts/workspace/WorkspaceFrame";
import { Button } from "../../shared/ui/Button";
import { Spinner } from "../../shared/ui/Spinner";
import { ExportHistoryPanel } from "./components/ExportHistoryPanel";
import { ExportPreviewPanel } from "./components/ExportPreviewPanel";
import { ExportSettingsPanel } from "./components/ExportSettingsPanel";
import "./export.css";

export function ExportPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const rescan = useLegacyRescanWorkspace(projectId);
  const controller = useExportController({
    projectId,
    confirm: legacyConfirm,
    alert: legacyAlert,
  });
  const {
    workspace,
    form,
    patchForm,
    assetCount,
    candidateActive,
    checkedCount,
    folders,
    foldersError,
    foldersPending,
    preview,
    previewPending,
    exportPending,
    activeExport,
    error,
    operations,
    chooseFolder,
    previewAction,
    startExport,
    stop,
    resume,
    openFolder,
  } = controller;

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
        <p>正在打开导出工作台…</p>
      </div>
    );
  }

  return (
    <WorkspaceFrame
      workspace={workspace.data}
      projectId={projectId}
      active="export"
      rescanning={rescan.isPending}
      rescanDisabled={activeExport}
      onRescan={() => rescan.mutate()}
      bodyClassName="export-workspace-body"
      statusbar={
        <>
          <span>多通道导出 · TXT / JSON · 文件夹 / ZIP</span>
          <span className="workspace-statusbar__path">
            任务状态：.annotation-workspace/state.sqlite3
          </span>
        </>
      }
    >
      <ExportSettingsPanel
        form={form}
        assetCount={assetCount}
        candidateActive={candidateActive}
        checkedCount={checkedCount}
        folders={folders}
        foldersError={foldersError}
        foldersPending={foldersPending}
        preview={preview}
        previewPending={previewPending}
        exportPending={exportPending}
        activeExport={activeExport}
        error={error}
        onChange={patchForm}
        onChooseFolder={() => void chooseFolder()}
        onPreview={() => void previewAction()}
        onExport={() => void startExport()}
      />
      <ExportPreviewPanel preview={preview} />
      <ExportHistoryPanel
        operations={operations}
        actionPending={exportPending}
        onStop={(id) => void stop(id)}
        onResume={(id) => void resume(id)}
        onOpenFolder={(path) => void openFolder(path)}
      />
    </WorkspaceFrame>
  );
}
