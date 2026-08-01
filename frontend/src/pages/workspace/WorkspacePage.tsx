import { lazy, Suspense, useEffect, useRef, type CSSProperties } from "react";
import { AlertCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { useWorkspaceAssetsController } from "../../application/workspace/useWorkspaceAssetsController";
import type { WorkspaceBrowserMode } from "../../application/workspace/assetBrowserState";
import { useLegacyRescanWorkspace } from "../../legacy/hooks/useLegacyRescanWorkspace";
import { legacyAlert, legacyConfirm } from "../../legacy/legacyInteractions";
import { WorkspaceFrame } from "../../layouts/workspace/WorkspaceFrame";
import { Button } from "../../shared/ui/Button";
import { Spinner } from "../../shared/ui/Spinner";
import { AnnotationBulkActionDialog } from "./components/AnnotationBulkActionDialog";
import { AssetBrowser } from "./components/AssetBrowser";
import { AssetDeletionDialog } from "./components/AssetDeletionDialog";
import { ImageStage } from "./components/ImageStage";
import { InspectorPanel } from "./components/InspectorPanel";
import { PaneResizeHandle } from "./components/PaneResizeHandle";
import { TagBatchEditDialog } from "./components/TagBatchEditDialog";
import {
  clamp,
  DEFAULT_WORKSPACE_LAYOUT,
  fitWorkspaceLayoutToWidth,
  useWorkspaceLayout,
  WORKSPACE_LAYOUT_LIMITS,
} from "./hooks/useWorkspaceLayout";
import "./workspace.css";

const AnnotationEditor = lazy(() =>
  import("./components/AnnotationEditor").then((module) => ({
    default: module.AnnotationEditor,
  })),
);

interface WorkspacePageProps {
  mode?: WorkspaceBrowserMode;
}

export function WorkspacePage({ mode = "assets" }: WorkspacePageProps) {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const rescan = useLegacyRescanWorkspace(projectId);
  const controller = useWorkspaceAssetsController({
    projectId,
    mode,
    confirm: legacyConfirm,
    alert: legacyAlert,
  });
  const {
    workspace,
    assets,
    folders,
    assetItems,
    assetResult,
    selectedAsset,
    selectedAssetId,
    checkedAssetIds,
    search,
    statusFilter,
    folderPath,
    editorRevision,
    annotationDialog,
    tagBatchDialog,
    blockedAnnotationTarget,
    blockedTagDraft,
    allMatchingSelected,
    selectAllPending,
    setAssetsChecked,
    setSearch,
    setStatusFilter,
    requestFolderSelect,
    requestSelectAsset,
    loadMoreAssets,
    toggleAllMatchingAssets,
    openAnnotationDialog,
    closeAnnotationDialog,
    openTagBatchDialog,
    closeTagBatchDialog,
    updateEditorDirty,
    setEditorTarget,
    updateRecursiveScan,
    assetDeletion,
  } = controller;
  const workspaceBodyRef = useRef<HTMLDivElement>(null);
  const mediaColumnRef = useRef<HTMLDivElement>(null);
  const { layout, setLayout } = useWorkspaceLayout(projectId);

  useEffect(() => {
    const body = workspaceBodyRef.current;
    if (!body) return;

    const fitLayout = () => {
      setLayout((current) => fitWorkspaceLayoutToWidth(current, body.clientWidth));
    };
    fitLayout();
    const observer = new ResizeObserver(fitLayout);
    observer.observe(body);
    return () => observer.disconnect();
  }, [setLayout, workspace.data]);

  const layoutStyle = {
    "--asset-pane-width": `${layout.assetPaneWidth}px`,
    "--inspector-pane-width": `${layout.inspectorPaneWidth}px`,
    "--image-pane-ratio": `${layout.imagePaneRatio}%`,
  } as CSSProperties;

  if (workspace.isLoading) {
    return (
      <div className="workspace-loading">
        <Spinner label="打开工作区" />
        <p>正在整理工作区…</p>
      </div>
    );
  }

  if (!workspace.data) {
    return (
      <div className="workspace-loading workspace-loading--error">
        <AlertCircle size={28} />
        <p>{workspace.error instanceof Error ? workspace.error.message : "工作区不可用。"}</p>
        <Button onClick={() => navigate("/")}>返回项目首页</Button>
      </div>
    );
  }

  return (
    <WorkspaceFrame
      bodyRef={workspaceBodyRef}
      bodyClassName="workspace-body--assets"
      bodyStyle={layoutStyle}
      workspace={workspace.data}
      projectId={projectId}
      active={mode}
      rescanning={rescan.isPending}
      onRescan={() => rescan.mutate()}
      statusbar={
        <>
          <span>
            {mode === "review" ? "审核" : "素材"} · {assetResult?.total ?? 0} 张图片
          </span>
          <span>已标注 {workspace.data.annotated_count}</span>
          <span>异常 {workspace.data.invalid_count}</span>
          <span className="workspace-statusbar__path">
            SQLite 主存储 · Tags / LLM 描述 / 译文独立修订 · 导出时物化
          </span>
        </>
      }
    >
      <AssetBrowser
        mode={mode}
        projectId={projectId}
        assets={assetItems}
        total={assetResult?.total ?? workspace.data.asset_count}
        selectedAssetId={selectedAssetId}
        checkedAssetIds={checkedAssetIds}
        search={search}
        statusFilter={statusFilter}
        statusCounts={assetResult?.status_counts ?? {}}
        folders={folders.data?.items ?? []}
        selectedFolderPath={folderPath}
        foldersLoading={folders.isLoading}
        hasMore={Boolean(assets.hasNextPage)}
        loading={assets.isLoading}
        loadingMore={assets.isFetchingNextPage}
        selectAllPending={selectAllPending}
        allMatchingSelected={allMatchingSelected}
        error={!assets.data && assets.error instanceof Error ? assets.error.message : null}
        bulkActionPending={annotationDialog.open || tagBatchDialog.open}
        onLoadMore={loadMoreAssets}
        recursive={workspace.data.settings.recursive_scan}
        onSearchChange={setSearch}
        onStatusChange={setStatusFilter}
        onFolderSelect={requestFolderSelect}
        onSelect={requestSelectAsset}
        onSetChecked={setAssetsChecked}
        onToggleAll={() => void toggleAllMatchingAssets()}
        onReviewCheckedAnnotations={() => openAnnotationDialog("review")}
        onEditCheckedTags={openTagBatchDialog}
        onDeleteCheckedAnnotations={() => openAnnotationDialog("delete")}
        onDeleteCheckedAssets={assetDeletion.openCheckedAssetDeletion}
        onOpenDeletionHistory={assetDeletion.openDeletionHistory}
        onRecursiveChange={updateRecursiveScan}
      />
      <PaneResizeHandle
        orientation="vertical"
        label="调整素材列表宽度"
        onResize={(delta) =>
          setLayout((current) => {
            const bodyWidth = workspaceBodyRef.current?.clientWidth ?? window.innerWidth;
            const available =
              bodyWidth -
              WORKSPACE_LAYOUT_LIMITS.navigationWidth -
              WORKSPACE_LAYOUT_LIMITS.resizeHandlesWidth -
              WORKSPACE_LAYOUT_LIMITS.mediaPaneMin -
              current.inspectorPaneWidth;
            return {
              ...current,
              assetPaneWidth: clamp(
                current.assetPaneWidth + delta,
                WORKSPACE_LAYOUT_LIMITS.assetPaneMin,
                Math.max(
                  WORKSPACE_LAYOUT_LIMITS.assetPaneMin,
                  Math.min(WORKSPACE_LAYOUT_LIMITS.assetPaneMax, available),
                ),
              ),
            };
          })
        }
        onReset={() =>
          setLayout((current) => ({
            ...current,
            assetPaneWidth: DEFAULT_WORKSPACE_LAYOUT.assetPaneWidth,
          }))
        }
      />
      <div className="media-column" ref={mediaColumnRef}>
        <ImageStage projectId={projectId} asset={selectedAsset} />
        <PaneResizeHandle
          orientation="horizontal"
          label="调整图片与标注区域高度"
          onResize={(delta) => {
            const height = mediaColumnRef.current?.clientHeight ?? 1;
            setLayout((current) => ({
              ...current,
              imagePaneRatio: clamp(
                current.imagePaneRatio + (delta / height) * 100,
                WORKSPACE_LAYOUT_LIMITS.imagePaneMin,
                WORKSPACE_LAYOUT_LIMITS.imagePaneMax,
              ),
            }));
          }}
          onReset={() =>
            setLayout((current) => ({
              ...current,
              imagePaneRatio: DEFAULT_WORKSPACE_LAYOUT.imagePaneRatio,
            }))
          }
        />
        <Suspense
          fallback={
            <section className="annotation-editor" data-surface-region="content">
              <Spinner label="加载标注编辑器" />
            </section>
          }
        >
          <AnnotationEditor
            key={`${projectId}:${mode}:${selectedAssetId ?? "no-asset"}:${editorRevision}`}
            projectId={projectId}
            assetId={selectedAssetId}
            onDirtyChange={updateEditorDirty}
            onActiveTargetChange={setEditorTarget}
          />
        </Suspense>
      </div>
      <PaneResizeHandle
        orientation="vertical"
        label="调整右侧面板宽度"
        onResize={(delta) =>
          setLayout((current) => {
            const bodyWidth = workspaceBodyRef.current?.clientWidth ?? window.innerWidth;
            const available =
              bodyWidth -
              WORKSPACE_LAYOUT_LIMITS.navigationWidth -
              WORKSPACE_LAYOUT_LIMITS.resizeHandlesWidth -
              WORKSPACE_LAYOUT_LIMITS.mediaPaneMin -
              current.assetPaneWidth;
            return {
              ...current,
              inspectorPaneWidth: clamp(
                current.inspectorPaneWidth - delta,
                WORKSPACE_LAYOUT_LIMITS.inspectorPaneMin,
                Math.max(
                  WORKSPACE_LAYOUT_LIMITS.inspectorPaneMin,
                  Math.min(WORKSPACE_LAYOUT_LIMITS.inspectorPaneMax, available),
                ),
              ),
            };
          })
        }
        onReset={() =>
          setLayout((current) => ({
            ...current,
            inspectorPaneWidth: DEFAULT_WORKSPACE_LAYOUT.inspectorPaneWidth,
          }))
        }
      />
      <InspectorPanel
        projectId={projectId}
        workspace={workspace.data}
        asset={selectedAsset}
        onDeleteAsset={assetDeletion.openAssetDeletion}
      />
      <AssetDeletionDialog
        projectId={projectId}
        open={assetDeletion.deletionDialog.open}
        assetIds={assetDeletion.deletionDialog.assetIds}
        initialView={assetDeletion.deletionDialog.initialView}
        beforeExecute={assetDeletion.beforeDeleteAssets}
        onDeleted={assetDeletion.handleAssetsDeleted}
        onClose={assetDeletion.closeDeletionDialog}
      />
      <AnnotationBulkActionDialog
        projectId={projectId}
        open={annotationDialog.open}
        action={annotationDialog.action}
        assetIds={annotationDialog.assetIds}
        blockedTarget={blockedAnnotationTarget}
        onClose={closeAnnotationDialog}
      />
      <TagBatchEditDialog
        projectId={projectId}
        open={tagBatchDialog.open}
        assetIds={tagBatchDialog.assetIds}
        blockedTagDraft={blockedTagDraft}
        onClose={closeTagBatchDialog}
      />
    </WorkspaceFrame>
  );
}
