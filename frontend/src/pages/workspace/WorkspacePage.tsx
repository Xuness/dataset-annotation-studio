import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AlertCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { useAssetFolders, useAssetIds, useInfiniteAssets } from "../../features/assets/hooks";
import {
  useRescanWorkspace,
  useUpdateWorkspace,
  useWorkspace,
} from "../../features/workspaces/hooks";
import { WorkspaceFrame } from "../../layouts/workspace/WorkspaceFrame";
import type { AnnotationChannelTarget, AssetFilterStatus } from "../../shared/api/types";
import { useAppStore } from "../../shared/store/appStore";
import { assetBrowserViewState, browserScopeKey } from "./workspaceViewState";
import { Button } from "../../shared/ui/Button";
import { alertDialog, confirmDialog } from "../../shared/ui/dialogs";
import { Spinner } from "../../shared/ui/Spinner";
import {
  AnnotationBulkActionDialog,
  type AnnotationBulkAction,
} from "./components/AnnotationBulkActionDialog";
import { AssetDeletionDialog } from "./components/AssetDeletionDialog";
import { AssetBrowser } from "./components/AssetBrowser";
import { ImageStage } from "./components/ImageStage";
import { InspectorPanel } from "./components/InspectorPanel";
import { PaneResizeHandle } from "./components/PaneResizeHandle";
import {
  clamp,
  DEFAULT_WORKSPACE_LAYOUT,
  fitWorkspaceLayoutToWidth,
  useWorkspaceLayout,
  WORKSPACE_LAYOUT_LIMITS,
} from "./hooks/useWorkspaceLayout";
import { useAssetDestructiveActions } from "./hooks/useAssetDestructiveActions";
import "./workspace.css";

const AnnotationEditor = lazy(() =>
  import("./components/AnnotationEditor").then((module) => ({
    default: module.AnnotationEditor,
  })),
);

interface WorkspacePageProps {
  mode?: "assets" | "review";
}

interface AnnotationBulkDialogState {
  open: boolean;
  action: AnnotationBulkAction;
  assetIds: string[];
}

const DEFAULT_EDITOR_TARGET: AnnotationChannelTarget = {
  channel: "description",
  language: "",
};

const CLOSED_ANNOTATION_DIALOG: AnnotationBulkDialogState = {
  open: false,
  action: "review",
  assetIds: [],
};

export function WorkspacePage({ mode = "assets" }: WorkspacePageProps) {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace(projectId);
  const rescan = useRescanWorkspace(projectId);
  const updateWorkspace = useUpdateWorkspace(projectId);
  const checkedAssetIds = useAppStore((state) => state.checkedAssetIds);
  const setAssetsChecked = useAppStore((state) => state.setAssetsChecked);
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const browserScope = browserScopeKey(projectId, mode);
  const { search, statusFilter, folderPath, selectedAssetId } =
    assetBrowserViewState.useValue(browserScope);
  const selectAsset = useCallback(
    (assetId: string | null) =>
      assetBrowserViewState.patch(browserScope, { selectedAssetId: assetId }),
    [browserScope],
  );
  const setSearch = useCallback(
    (value: string) => assetBrowserViewState.patch(browserScope, { search: value }),
    [browserScope],
  );
  const setStatusFilter = useCallback(
    (value: AssetFilterStatus | null) =>
      assetBrowserViewState.patch(browserScope, { statusFilter: value }),
    [browserScope],
  );
  const setFolderPath = useCallback(
    (value: string) => assetBrowserViewState.patch(browserScope, { folderPath: value }),
    [browserScope],
  );
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorDirtyKind, setEditorDirtyKind] = useState<"tags" | "annotation" | null>(null);
  const [editorTarget, setEditorTarget] = useState<AnnotationChannelTarget>(DEFAULT_EDITOR_TARGET);
  const [editorRevision, setEditorRevision] = useState(0);
  const [annotationDialog, setAnnotationDialog] =
    useState<AnnotationBulkDialogState>(CLOSED_ANNOTATION_DIALOG);
  const workspaceBodyRef = useRef<HTMLDivElement>(null);
  const mediaColumnRef = useRef<HTMLDivElement>(null);
  const { layout, setLayout } = useWorkspaceLayout(projectId);

  const assetQuery = useMemo(
    () => ({ search, status: statusFilter, folderPath }),
    [folderPath, search, statusFilter],
  );
  const assets = useInfiniteAssets(projectId, assetQuery);
  const matchingAssetIds = useAssetIds(projectId, assetQuery);
  const folders = useAssetFolders(projectId);
  const discardEditorDraft = useCallback(() => {
    setEditorDirty(false);
    setEditorDirtyKind(null);
    setEditorRevision((current) => current + 1);
  }, []);
  const updateEditorDirty = useCallback((dirty: boolean, kind: "tags" | "annotation" | null) => {
    setEditorDirty(dirty);
    setEditorDirtyKind(dirty ? kind : null);
  }, []);
  const assetActions = useAssetDestructiveActions({
    contextKey: `${projectId}:${mode}`,
    selectedAssetId,
    editorDirty,
    discardEditorDraft,
    selectAsset,
  });
  const assetItems = useMemo(
    () => assets.data?.pages.flatMap((page) => page.items) ?? [],
    [assets.data?.pages],
  );
  const assetResult = assets.data?.pages[0];
  const loadedMatchingAssetIds = useMemo(() => {
    if (!assetResult || assets.hasNextPage || assetItems.length !== assetResult.total) return null;
    return assetItems.map((asset) => asset.id);
  }, [assetItems, assetResult, assets.hasNextPage]);
  const knownMatchingAssetIds =
    matchingAssetIds.data &&
    !matchingAssetIds.isStale &&
    matchingAssetIds.data.total === assetResult?.total
      ? matchingAssetIds.data.ids
      : loadedMatchingAssetIds;
  const allMatchingSelected = useMemo(() => {
    if (!knownMatchingAssetIds?.length) return false;
    const checked = new Set(checkedAssetIds);
    return knownMatchingAssetIds.every((assetId) => checked.has(assetId));
  }, [checkedAssetIds, knownMatchingAssetIds]);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = assets;
  const loadMoreAssets = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    setActiveProject(projectId);
    setEditorDirty(false);
    setEditorDirtyKind(null);
    setEditorTarget(DEFAULT_EDITOR_TARGET);
    setEditorRevision(0);
    setAnnotationDialog(CLOSED_ANNOTATION_DIALOG);
  }, [mode, projectId, setActiveProject]);

  useEffect(() => {
    if (
      editorDirty ||
      !folders.data ||
      folders.data.items.some((folder) => folder.path === folderPath)
    ) {
      return;
    }
    setFolderPath("");
  }, [editorDirty, folderPath, folders.data, setFolderPath]);

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

  useEffect(() => {
    const items = assetItems;
    if (editorDirty || assets.isLoading) return;
    if (!items?.length) {
      if (selectedAssetId) selectAsset(null);
      return;
    }
    if (!selectedAssetId || !items.some((asset) => asset.id === selectedAssetId)) {
      selectAsset(items[0].id);
    }
  }, [assetItems, assets.isLoading, editorDirty, selectAsset, selectedAssetId]);

  const selectedAsset = assetItems.find((asset) => asset.id === selectedAssetId) ?? null;

  const requestSelectAsset = useCallback(
    async (assetId: string): Promise<boolean> => {
      if (!editorDirty) {
        selectAsset(assetId);
        return true;
      }
      const message =
        editorDirtyKind === "tags"
          ? "当前 Tags 修改尚未保存，切换图片会丢弃这些修改。"
          : "当前标注尚未保存，切换图片会丢弃未保存的修改。";
      const confirmed = await confirmDialog(message, {
        title: "尚未保存",
        tone: "danger",
        confirmLabel: "丢弃并切换",
        cancelLabel: "继续编辑",
      });
      if (!confirmed) return false;
      selectAsset(assetId);
      return true;
    },
    [editorDirty, editorDirtyKind, selectAsset],
  );

  const requestFolderSelect = useCallback(
    async (nextFolderPath: string): Promise<boolean> => {
      if (nextFolderPath === folderPath) return true;
      if (editorDirty) {
        const message =
          editorDirtyKind === "tags"
            ? "当前 Tags 修改尚未保存，切换目录会丢弃这些修改。"
            : "当前标注尚未保存，切换目录会丢弃未保存的修改。";
        const confirmed = await confirmDialog(message, {
          title: "尚未保存",
          tone: "danger",
          confirmLabel: "丢弃并切换",
          cancelLabel: "继续编辑",
        });
        if (!confirmed) return false;
        discardEditorDraft();
      }
      setFolderPath(nextFolderPath);
      return true;
    },
    [discardEditorDraft, editorDirty, editorDirtyKind, folderPath, setFolderPath],
  );

  const toggleAllMatchingAssets = useCallback(async () => {
    let assetIds = knownMatchingAssetIds;
    if (!assetIds) {
      const result = await matchingAssetIds.refetch();
      if (!result.data) {
        await alertDialog(
          result.error instanceof Error ? result.error.message : "读取全选范围失败，请稍后重试。",
          { title: "全选失败" },
        );
        return;
      }
      assetIds = result.data.ids;
    }

    const checked = new Set(useAppStore.getState().checkedAssetIds);
    const shouldCheck = !assetIds.length || !assetIds.every((assetId) => checked.has(assetId));
    setAssetsChecked(assetIds, shouldCheck);
  }, [knownMatchingAssetIds, matchingAssetIds, setAssetsChecked]);

  const openAnnotationDialog = useCallback((action: AnnotationBulkAction) => {
    const assetIds = [...useAppStore.getState().checkedAssetIds];
    if (!assetIds.length) return;
    setAnnotationDialog({ open: true, action, assetIds });
  }, []);

  const closeAnnotationDialog = useCallback(() => {
    setAnnotationDialog((current) => ({ ...current, open: false }));
  }, []);

  const blockedAnnotationTarget =
    editorDirty && selectedAssetId && annotationDialog.assetIds.includes(selectedAssetId)
      ? editorTarget
      : null;

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
        selectAllPending={matchingAssetIds.isFetching}
        allMatchingSelected={allMatchingSelected}
        error={!assets.data && assets.error instanceof Error ? assets.error.message : null}
        bulkActionPending={annotationDialog.open}
        onLoadMore={loadMoreAssets}
        recursive={workspace.data.settings.recursive_scan}
        onSearchChange={setSearch}
        onStatusChange={setStatusFilter}
        onFolderSelect={requestFolderSelect}
        onSelect={requestSelectAsset}
        onSetChecked={setAssetsChecked}
        onToggleAll={() => void toggleAllMatchingAssets()}
        onReviewCheckedAnnotations={() => openAnnotationDialog("review")}
        onDeleteCheckedAnnotations={() => openAnnotationDialog("delete")}
        onDeleteCheckedAssets={assetActions.openCheckedAssetDeletion}
        onOpenDeletionHistory={assetActions.openDeletionHistory}
        onRecursiveChange={(recursive_scan) =>
          updateWorkspace.mutate(
            { recursive_scan },
            {
              onError: (error) =>
                void alertDialog(
                  error instanceof Error ? error.message : "无法更新递归扫描设置。",
                  { title: "保存扫描设置失败" },
                ),
            },
          )
        }
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
        onDeleteAsset={assetActions.openAssetDeletion}
      />
      <AssetDeletionDialog
        projectId={projectId}
        open={assetActions.deletionDialog.open}
        assetIds={assetActions.deletionDialog.assetIds}
        initialView={assetActions.deletionDialog.initialView}
        beforeExecute={assetActions.beforeDeleteAssets}
        onDeleted={assetActions.handleAssetsDeleted}
        onClose={assetActions.closeDeletionDialog}
      />
      <AnnotationBulkActionDialog
        projectId={projectId}
        open={annotationDialog.open}
        action={annotationDialog.action}
        assetIds={annotationDialog.assetIds}
        blockedTarget={blockedAnnotationTarget}
        onClose={closeAnnotationDialog}
      />
    </WorkspaceFrame>
  );
}
