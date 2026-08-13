import type { AssetFilterStatus, CandidateScope } from "../../shared/api/types";
import { createScopedViewState } from "../../shared/store/scopedViewState";

export type WorkspaceBrowserMode = "assets" | "review";

export function browserScopeKey(projectId: string, mode: WorkspaceBrowserMode): string {
  return `${projectId}:${mode}`;
}

export interface AssetBrowserView {
  search: string;
  statusFilter: AssetFilterStatus | null;
  folderPath: string;
  candidateScope: Extract<CandidateScope, "auto" | "all">;
  selectedAssetId: string | null;
}

export const assetBrowserViewState = createScopedViewState<AssetBrowserView>((scope) => ({
  search: "",
  statusFilter: scope.endsWith(":review") ? "needs_review" : null,
  folderPath: "",
  candidateScope: "auto",
  selectedAssetId: null,
}));
