import { useMemo } from "react";
import type { CropWorkbenchController } from "../../../src/application/cropping/useCropWorkbench";
import { sourceStatus } from "../../../src/application/cropping/workbenchState";
import {
  cropBrowserKey,
  cropBrowserState,
} from "../../../src/application/cropping/cropBrowserState";
import { useAssetBrowserData } from "../../../src/application/workspace/useAssetBrowserData";
import { AssetBrowserPanel } from "../workspace/components/AssetBrowserPanel";
import { CropSourceScope } from "./CropSourceScope";
import { cropStatusLabels } from "./cropLabels";
import "../workspace/workspace.css";

interface Props {
  projectId: string;
  controller: CropWorkbenchController;
}
export function CropSourceSidebar({ projectId, controller: c }: Props) {
  const key = cropBrowserKey(projectId, c.mode, c.browserMode);
  const view = cropBrowserState.useValue(key);
  const query = useMemo(
    () => ({
      search: view.search,
      status: view.statusFilter,
      folderPath: view.folderPath,
      candidateScope: view.candidateScope,
    }),
    [view.search, view.statusFilter, view.folderPath, view.candidateScope],
  );
  const b = useAssetBrowserData(projectId, query);
  function editedSelection() {
    cropBrowserState.patch(key, {
      overriddenEntry: c.focus ? `${c.focus}:${c.entry ?? ""}` : null,
    });
  }
  return (
    <div className="crop-source-sidebar" data-testid="crop-source-sidebar">
      <AssetBrowserPanel
        mode="assets"
        projectId={projectId}
        assets={b.items}
        total={b.result?.total ?? 0}
        selectedAssetId={c.state.activeId}
        checkedAssetIds={b.checked}
        search={view.search}
        statusFilter={view.statusFilter}
        statusCounts={b.result?.status_counts ?? {}}
        folders={b.folders.data?.items ?? []}
        selectedFolderPath={view.folderPath}
        candidateScope={view.candidateScope}
        candidateActive={Boolean(b.candidate.data?.active)}
        candidateCount={b.candidate.data?.candidate_count ?? 0}
        totalAssetCount={b.candidate.data?.total_assets ?? 0}
        foldersLoading={b.folders.isPending}
        recursive={b.workspace.data?.settings.recursive_scan ?? true}
        hasMore={Boolean(b.assets.hasNextPage)}
        loading={b.assets.isPending}
        loadingMore={b.assets.isFetchingNextPage}
        selectAllPending={b.selecting}
        allMatchingSelected={b.allSelected}
        error={b.error}
        bulkActionPending={c.busy}
        onSearchChange={(search) => {
          if (!c.busy) cropBrowserState.patch(key, { search });
        }}
        onStatusChange={(statusFilter) => {
          if (!c.busy) cropBrowserState.patch(key, { statusFilter });
        }}
        onFolderSelect={async (folderPath) => {
          if (c.busy) return false;
          cropBrowserState.patch(key, { folderPath });
          return true;
        }}
        onCandidateScopeChange={async (candidateScope) => {
          if (c.busy) return false;
          cropBrowserState.patch(key, { candidateScope, folderPath: "" });
          return true;
        }}
        onSelect={async (id) => {
          const asset = b.items.find((item) => item.id === id);
          if (!asset || c.busy) return false;
          c.browseSource(asset);
          return true;
        }}
        onSetChecked={(ids, checked) => {
          if (!c.busy) {
            editedSelection();
            b.setChecked(ids, checked);
          }
        }}
        onToggleAll={() => {
          if (!c.busy) {
            editedSelection();
            void b.toggleAll();
          }
        }}
        onRecursiveChange={(value) => {
          if (!c.busy) void b.updateRecursive(value);
        }}
        onLoadMore={b.loadMore}
        historyAction={null}
        actions={null}
        scopeControls={
          <CropSourceScope
            controller={c}
            checkedCount={b.checked.length}
            total={
              b.candidate.data?.active
                ? b.candidate.data.candidate_count
                : (b.candidate.data?.total_assets ?? 0)
            }
            folders={b.folders.data?.items ?? []}
          />
        }
        rowDetail={(asset) => {
          const draft = c.state.drafts[asset.id];
          return draft
            ? `${draft.regions.length} 个区域 · ${cropStatusLabels[sourceStatus(draft)]}${c.state.sourceIds.includes(asset.id) ? "" : " · 范围外"}`
            : "未加入裁剪范围";
        }}
      />
    </div>
  );
}
