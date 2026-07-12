import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { useAssets } from "../../features/assets/hooks";
import {
  useRescanWorkspace,
  useUpdateWorkspace,
  useWorkspace,
} from "../../features/workspaces/hooks";
import type { AnnotationStatus } from "../../shared/api/types";
import { useAppStore } from "../../shared/store/appStore";
import { Button } from "../../shared/ui/Button";
import { Spinner } from "../../shared/ui/Spinner";
import { AnnotationEditor } from "./components/AnnotationEditor";
import { AssetBrowser } from "./components/AssetBrowser";
import { ImageStage } from "./components/ImageStage";
import { InspectorPanel } from "./components/InspectorPanel";
import { NavigationRail } from "./components/NavigationRail";
import { WorkspaceTopbar } from "./components/WorkspaceTopbar";
import "./workspace.css";

export function WorkspacePage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace(projectId);
  const rescan = useRescanWorkspace(projectId);
  const updateWorkspace = useUpdateWorkspace(projectId);
  const selectedAssetId = useAppStore((state) => state.selectedAssetId);
  const selectAsset = useAppStore((state) => state.selectAsset);
  const checkedAssetIds = useAppStore((state) => state.checkedAssetIds);
  const toggleCheckedAsset = useAppStore((state) => state.toggleCheckedAsset);
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AnnotationStatus | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);

  const assetQuery = useMemo(
    () => ({ search, status: statusFilter, limit: 10_000 }),
    [search, statusFilter],
  );
  const assets = useAssets(projectId, assetQuery);

  useEffect(() => {
    setActiveProject(projectId);
  }, [projectId, setActiveProject]);

  useEffect(() => {
    const items = assets.data?.items;
    if (!items?.length) {
      if (selectedAssetId) selectAsset(null);
      return;
    }
    if (!selectedAssetId || !items.some((asset) => asset.id === selectedAssetId)) {
      selectAsset(items[0].id);
    }
  }, [assets.data?.items, selectAsset, selectedAssetId]);

  const selectedAsset = assets.data?.items.find((asset) => asset.id === selectedAssetId) ?? null;

  const requestSelectAsset = useCallback(
    (assetId: string) => {
      if (editorDirty && !window.confirm("当前标注尚未保存，仍要切换图片吗？")) return;
      selectAsset(assetId);
    },
    [editorDirty, selectAsset],
  );

  if (workspace.isLoading) {
    return (
      <div className="workspace-loading">
        <Spinner label="打开工作区" />
        <p>正在整理工作区…</p>
      </div>
    );
  }

  if (workspace.isError || !workspace.data) {
    return (
      <div className="workspace-loading workspace-loading--error">
        <AlertCircle size={28} />
        <p>{workspace.error instanceof Error ? workspace.error.message : "工作区不可用。"}</p>
        <Button onClick={() => navigate("/")}>返回项目首页</Button>
      </div>
    );
  }

  return (
    <main className="workspace-page">
      <WorkspaceTopbar
        workspace={workspace.data}
        rescanning={rescan.isPending}
        onRescan={() => void rescan.mutateAsync()}
      />
      <div className="workspace-body">
        <NavigationRail projectId={projectId} />
        <AssetBrowser
          projectId={projectId}
          assets={assets.data?.items ?? []}
          total={assets.data?.total ?? workspace.data.asset_count}
          selectedAssetId={selectedAssetId}
          checkedAssetIds={checkedAssetIds}
          search={search}
          statusFilter={statusFilter}
          statusCounts={assets.data?.status_counts ?? {}}
          recursive={workspace.data.settings.recursive_scan}
          onSearchChange={setSearch}
          onStatusChange={setStatusFilter}
          onSelect={requestSelectAsset}
          onToggleChecked={toggleCheckedAsset}
          onRecursiveChange={(recursive_scan) =>
            void updateWorkspace.mutateAsync({ recursive_scan })
          }
        />
        <div className="media-column">
          <ImageStage projectId={projectId} asset={selectedAsset} />
          <AnnotationEditor
            projectId={projectId}
            assetId={selectedAssetId}
            onDirtyChange={setEditorDirty}
          />
        </div>
        <InspectorPanel projectId={projectId} workspace={workspace.data} asset={selectedAsset} />
      </div>
      <footer className="workspace-statusbar">
        <span>{assets.data?.total ?? 0} 张图片</span>
        <span>已标注 {workspace.data.annotated_count}</span>
        <span>异常 {workspace.data.invalid_count}</span>
        <span className="workspace-statusbar__path">UTF-8 · 同名 .txt · 标签闭合轻量校验</span>
      </footer>
    </main>
  );
}
