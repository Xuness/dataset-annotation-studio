import { AlertCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { useScreeningController } from "../../../src/application/screening/useScreeningController";
import { useLegacyRescanWorkspace } from "../../legacy/hooks/useLegacyRescanWorkspace";
import { WorkspaceFrame } from "../../layouts/workspace/WorkspaceFrame";
import { Button } from "../../shared/ui/Button";
import { Spinner } from "../../shared/ui/Spinner";
import { ScreeningInspectorPanel } from "./components/ScreeningInspectorPanel";
import { ScreeningResultGallery } from "./components/ScreeningResultGallery";
import { ScreeningRunHistory } from "./components/ScreeningRunHistory";
import { ScreeningSetupPanel } from "./components/ScreeningSetupPanel";
import "./screening.css";

export function ScreeningPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const rescan = useLegacyRescanWorkspace(projectId);
  const controller = useScreeningController({ projectId, rescanPending: rescan.isPending });

  if (controller.workspace.isLoading) {
    return (
      <div className="workspace-loading">
        <Spinner label="打开筛选工作台" />
        <p>正在准备筛选工作台…</p>
      </div>
    );
  }

  if (!controller.workspace.data) {
    return (
      <div className="workspace-loading workspace-loading--error">
        <AlertCircle size={28} />
        <p>
          {controller.workspace.error instanceof Error
            ? controller.workspace.error.message
            : "工作区不可用。"}
        </p>
        <Button onClick={() => navigate("/")}>返回项目首页</Button>
      </div>
    );
  }

  return (
    <WorkspaceFrame
      workspace={controller.workspace.data}
      projectId={projectId}
      active="screening"
      rescanning={controller.workspaceBusy}
      rescanDisabled={Boolean(controller.activeOperation)}
      onRescan={() => {
        if (!controller.activeOperation) rescan.mutate();
      }}
      bodyClassName="screening-workspace-body"
      statusbar={
        <>
          <span>筛选 · 当前任务内部按 Rating 排名</span>
          <span>{controller.selectedOperation?.total_items ?? 0} 张任务图片</span>
          <span>工作台已勾选 {controller.checkedAssetIds.length}</span>
          <span className="workspace-statusbar__path">
            Batch-only · 不读取 Danbooru 全站归档 · 不改写素材
          </span>
        </>
      }
    >
      <aside className="screening-control-column" data-surface-region="primary-sidebar">
        <ScreeningSetupPanel
          form={controller.form}
          capabilities={controller.capabilities.data}
          capabilitiesPending={controller.capabilities.isPending}
          capabilitiesError={
            controller.capabilities.error instanceof Error
              ? controller.capabilities.error.message
              : null
          }
          assetCount={controller.assetCount}
          checkedCount={controller.checkedAssetIds.length}
          folderOptions={controller.folderOptions}
          folderCount={controller.folderCount}
          folderLoading={controller.folderLoading}
          scopeReady={controller.scopeReady}
          scopeMessage={controller.scopeMessage}
          error={controller.error}
          activeOperation={controller.activeOperation}
          selectedOperation={controller.selectedOperation}
          createPending={controller.createPending}
          stopPending={controller.stopPending}
          resumePending={controller.resumePending}
          applyTaskProfilePending={controller.applyTaskProfilePending}
          onChange={controller.patchForm}
          onToggleFolder={controller.toggleFolderPath}
          onClearFolders={controller.clearFolderPaths}
          onCreate={() => void controller.createOperation()}
          onStop={() => void controller.stopOperation()}
          onResume={() => void controller.resumeOperation()}
          onApplyTaskProfile={() => void controller.applyTaskProfile()}
        />
        <ScreeningRunHistory
          operations={controller.operations}
          selectedOperationId={controller.selectedOperationId}
          pending={controller.operationsPending}
          onSelect={controller.setSelectedOperationId}
        />
      </aside>
      <ScreeningResultGallery
        projectId={projectId}
        operationId={controller.selectedOperationId ?? "screening"}
        items={controller.items}
        total={controller.itemTotal}
        filters={controller.filters}
        thumbnailSize={controller.galleryThumbnailSize}
        selectedAssetId={controller.selectedAssetId}
        checkedAssetIds={controller.checkedAssetIds}
        loading={controller.itemsPending}
        fetching={controller.itemsFetching}
        processing={Boolean(controller.selectedOperation) && !controller.resultsReady}
        error={controller.itemsError}
        hasMore={controller.hasMoreItems}
        selectCurrentPending={controller.selectCurrentPending}
        allCurrentResultsChecked={controller.allCurrentResultsChecked}
        onChangeFilters={controller.patchFilters}
        onThumbnailSizeChange={controller.setGalleryThumbnailSize}
        onSelectAsset={controller.setSelectedAssetId}
        onSetChecked={controller.setAssetsChecked}
        onLoadMore={controller.loadMoreItems}
        onSelectCurrent={() => void controller.selectCurrentResult()}
      />
      <ScreeningInspectorPanel
        projectId={projectId}
        operation={controller.selectedOperation}
        item={controller.selectedItem}
      />
    </WorkspaceFrame>
  );
}
