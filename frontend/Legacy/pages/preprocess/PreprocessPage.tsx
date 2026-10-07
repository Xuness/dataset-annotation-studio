import { AlertCircle, Crop, Images, SlidersHorizontal } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { usePreprocessController } from "../../../src/application/preprocessing/usePreprocessController";
import { useLegacyRescanWorkspace } from "../../legacy/hooks/useLegacyRescanWorkspace";
import { legacyConfirm } from "../../legacy/legacyInteractions";
import { CropWorkbench } from "../cropping/CropWorkbench";
import { cropScopeKey, cropWorkbenchState } from "../../../src/application/cropping/workbenchState";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const tool = searchParams.get("tool");
  const cropMode = tool === "crop" || tool === "crop-single";
  const mode = tool === "crop" ? "batch" : "single";
  const cropState = cropWorkbenchState.useValue(cropScopeKey(projectId, mode));
  const cropBusy = cropMode && cropState.phase !== "idle";
  function selectTool(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("tool", value);
    else next.delete("tool");
    setSearchParams(next);
  }
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
      bodyClassName={
        cropMode ? "preprocess-workspace-body crop-workspace-body" : "preprocess-workspace-body"
      }
      statusbar={
        <>
          <span>
            {cropMode ? "原图保留，裁剪结果作为独立素材" : "当前仅展示预处理后的有效版本"}
          </span>
          <span className="workspace-statusbar__path">恢复区：工具工作区 recovery</span>
        </>
      }
    >
      <div className="preprocess-content">
        <nav className="crop-mode-tabs" aria-label="图像处理工具">
          <Button
            icon={<SlidersHorizontal size={14} />}
            data-testid="preprocess-tab-standard"
            className={!cropMode ? "is-active" : ""}
            aria-current={!cropMode ? "page" : undefined}
            onClick={() => selectTool("")}
            disabled={filesChanging || cropBusy}
          >
            图像预处理
          </Button>
          <Button
            icon={<Crop size={14} />}
            data-testid="preprocess-tab-single"
            className={tool === "crop-single" ? "is-active" : ""}
            aria-current={tool === "crop-single" ? "page" : undefined}
            onClick={() => selectTool("crop-single")}
            disabled={filesChanging || cropBusy}
          >
            单图精细裁剪
          </Button>
          <Button
            icon={<Images size={14} />}
            data-testid="preprocess-tab-crop"
            className={tool === "crop" ? "is-active" : ""}
            aria-current={tool === "crop" ? "page" : undefined}
            onClick={() => selectTool("crop")}
            disabled={filesChanging || cropBusy}
          >
            批量裁剪
          </Button>
          <span className="crop-mode-note">裁剪生成副本，原图保持不变</span>
        </nav>
        {cropMode ? (
          <CropWorkbench
            key={mode}
            mode={mode}
            focusAssetId={searchParams.get("asset")}
            entry={searchParams.get("entry")}
            projectId={projectId}
            browserMode={searchParams.get("browser") === "review" ? "review" : "assets"}
          />
        ) : (
          <div className="preprocess-panels">
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
          </div>
        )}
      </div>
    </WorkspaceFrame>
  );
}
