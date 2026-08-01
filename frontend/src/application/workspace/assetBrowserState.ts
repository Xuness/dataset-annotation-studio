import type { AssetFilterStatus } from "../../shared/api/types";
import { createScopedViewState } from "../../shared/store/scopedViewState";

export type WorkspaceBrowserMode = "assets" | "review";

export function browserScopeKey(projectId: string, mode: WorkspaceBrowserMode): string {
  return `${projectId}:${mode}`;
}

export interface AssetBrowserView {
  search: string;
  statusFilter: AssetFilterStatus | null;
  folderPath: string;
  selectedAssetId: string | null;
}

export const assetBrowserViewState = createScopedViewState<AssetBrowserView>((scope) => ({
  search: "",
  statusFilter: scope.endsWith(":review") ? "needs_review" : null,
  folderPath: "",
  selectedAssetId: null,
}));
