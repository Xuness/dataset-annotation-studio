import { ImagePlus, Users } from "lucide-react";
import type { CharacterAssetsController } from "../../../src/application/characterAudits/useCharacterAssets";
import type { CharacterAuditContent } from "../../../src/application/characterAudits/characterAuditModel";
import { AssetBrowserPanel } from "../workspace/components/AssetBrowserPanel";
import { Button } from "../../shared/ui/Button";

export function CharacterAssetSidebar({
  browser: b,
  content: c,
}: {
  browser: CharacterAssetsController;
  content: CharacterAuditContent;
}) {
  const profile = c.form.profiles[b.state.configProfile];
  return (
    <AssetBrowserPanel
      mode="assets"
      projectId={c.projectId!}
      assets={b.items}
      total={b.result?.total ?? 0}
      selectedAssetId={b.state.selectedAssetId}
      checkedAssetIds={b.checked}
      search={b.state.search}
      statusFilter={b.state.statusFilter}
      statusCounts={b.result?.status_counts ?? {}}
      folders={b.folders.data?.items ?? []}
      selectedFolderPath={b.state.folderPath}
      candidateScope={b.state.candidateScope}
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
      onSearchChange={(search) => b.patch({ search })}
      onStatusChange={(statusFilter) => b.patch({ statusFilter })}
      onFolderSelect={async (folderPath) => {
        b.patch({ folderPath });
        return true;
      }}
      onCandidateScopeChange={async (candidateScope) => {
        b.patch({ candidateScope, folderPath: "" });
        return true;
      }}
      onSelect={b.select}
      onSetChecked={b.setChecked}
      onToggleAll={() => void b.toggleAll()}
      onRecursiveChange={(value) => void b.updateRecursive(value)}
      onLoadMore={b.loadMore}
      historyAction={null}
      actions={
        <>
          <Button
            icon={<ImagePlus size={13} />}
            data-testid="character-set-reference"
            disabled={c.busy || Boolean(c.operation) || !b.selected || !profile}
            onClick={() => {
              if (b.selected && profile)
                c.updateProfile(b.state.configProfile, {
                  ...profile,
                  reference_asset_id: b.selected.id,
                });
            }}
          >
            设为角色 {(c.operation ? c.profileIndex : b.state.configProfile) + 1} 参考图
          </Button>
          <Button
            icon={<Users size={13} />}
            data-testid="character-sidebar-membership"
            disabled={
              c.busy || Boolean(c.operation) || (c.form.scope === "selected" && !c.checkedCount)
            }
            onClick={() => void c.previewMembership()}
          >
            预览角色归属
          </Button>
        </>
      }
    />
  );
}
