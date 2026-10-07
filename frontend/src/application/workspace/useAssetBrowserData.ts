import { useMemo, useState } from "react";
import {
  useAssetFolders,
  useAssetIds,
  useCandidateSummary,
  useInfiniteAssets,
} from "../../features/assets/hooks";
import type { AssetQuery } from "../../features/assets/api";
import { useUpdateWorkspace, useWorkspace } from "../../features/workspaces/hooks";
import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";

export function useAssetBrowserData(project: string, query: AssetQuery) {
  const selection = useWorkspaceSelectionStore();
  const checked = selection.projectId === project ? selection.checkedAssetIds : [];
  const workspace = useWorkspace(project);
  const updateWorkspace = useUpdateWorkspace(project);
  const candidate = useCandidateSummary(project);
  const assets = useInfiniteAssets(project, query, 120, {});
  const matching = useAssetIds(project, query, true);
  const folders = useAssetFolders(project, true, query.candidateScope ?? "auto");
  const items = useMemo(
    () => assets.data?.pages.flatMap((page) => page.items) ?? [],
    [assets.data?.pages],
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const ids = matching.data?.ids ?? [];
  const checkedSet = new Set(checked);
  async function toggleAll() {
    setSelecting(true);
    setActionError(null);
    try {
      const fresh = await matching.refetch({ throwOnError: true });
      if (!fresh.data) throw new Error("无法读取当前筛选范围的素材 ID，未修改勾选。");
      const current = useWorkspaceSelectionStore.getState();
      if (current.projectId !== project) throw new Error("项目已切换，已取消全选操作。");
      const remove =
        fresh.data.ids.length > 0 &&
        fresh.data.ids.every((id) => current.checkedAssetIds.includes(id));
      current.setAssetsChecked(fresh.data.ids, !remove);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSelecting(false);
    }
  }
  async function updateRecursive(value: boolean) {
    setActionError(null);
    try {
      await updateWorkspace.mutateAsync({ recursive_scan: value });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    workspace,
    items,
    result: assets.data?.pages[0],
    assets,
    folders,
    candidate,
    checked,
    selecting,
    allSelected: ids.length > 0 && ids.every((id) => checkedSet.has(id)),
    error:
      actionError ??
      assets.error?.message ??
      folders.error?.message ??
      matching.error?.message ??
      candidate.error?.message ??
      null,
    toggleAll,
    updateRecursive,
    setChecked: (values: string[], enabled: boolean) => selection.setAssetsChecked(values, enabled),
    loadMore: () => {
      if (assets.hasNextPage && !assets.isFetchingNextPage) void assets.fetchNextPage();
    },
  };
}
