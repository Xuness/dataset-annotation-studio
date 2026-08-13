import { AlertCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { usePreprocessController } from "../../../src/application/preprocessing/usePreprocessController";
import { useLegacyRescanWorkspace } from "../../legacy/hooks/useLegacyRescanWorkspace";
import { legacyConfirm } from "../../legacy/legacyInteractions";
import { WorkspaceFrame } from "../../layouts/workspace/WorkspaceFrame";
import { Button } from "../../shared/ui/Button";
import { Spinner } from "../../shared/ui/Spinner";
import { PreprocessHistoryPanel } from "./components/PreprocessHistoryPanel";
import { PreprocessOperationDetailPanel } from "./components/PreprocessOperationDetailPanel";
import { PreprocessPreviewPanel } from "./components/PreprocessPreviewPanel";
import { PreprocessSettingsPanel } from "./components/PreprocessSettingsPanel";
import "./preprocess.css";

export function PreprocessPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const rescan = useLegacyRescanWorkspace(projectId);
  const controller = usePreprocessController({
    projectId,
    rescanPending: rescan.isPending,
    confirm: legacyConfirm,
  });
  const {
    workspace,
    form,
    patchForm,
    assetCount,
    candidateActive,
    checkedCount,
    preview,
    previewPending,
    executePending,
    error,
    backends,
    backendsPending,
    executionPlan,
    executionPlanPending,
    executionPlanError,
    selectedOperation,
    selectedOperationId,
    setSelectedOperationId,
    operations,
    undoPending,
    filesChanging,
    workspaceBusy,
    previewAction,
    executeAction,
    undoAction,
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
        <p>正在打开预处理工作台…</p>
      </div>
    );
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
        onChange={patchForm}
        assetCount={assetCount}
        candidateActive={candidateActive}
        checkedCount={checkedCount}
        preview={preview}
        previewPending={previewPending}
        executePending={executePending}
        error={error}
        backends={backends}
        backendsPending={backendsPending}
        executionPlan={executionPlan}
        executionPlanPending={executionPlanPending}
        onPreview={() => void previewAction()}
        onExecute={() => void executeAction()}
      />
      {selectedOperation ? (
        <PreprocessOperationDetailPanel
          operation={selectedOperation}
          onBack={() => setSelectedOperationId(null)}
        />
      ) : (
        <PreprocessPreviewPanel
          preview={preview}
          executionPlan={executionPlan}
          executionPlanPending={executionPlanPending}
          executionPlanError={executionPlanError}
        />
      )}
      <PreprocessHistoryPanel
        operations={operations}
        selectedOperationId={selectedOperationId}
        undoPending={undoPending}
        onSelect={setSelectedOperationId}
        onUndo={(id) => void undoAction(id)}
      />
    </WorkspaceFrame>
  );
}
