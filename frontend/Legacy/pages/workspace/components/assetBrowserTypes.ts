import type { ReactNode } from "react";
import type {
  AssetFilterStatus,
  AssetFolderSummary,
  AssetSummary,
  CandidateScope,
} from "../../../../src/shared/api/types";

type StatusFilter = AssetFilterStatus | null;

export interface AssetBrowserPanelProps {
  mode: "assets" | "review";
  projectId: string;
  assets: AssetSummary[];
  total: number;
  selectedAssetId: string | null;
  checkedAssetIds: string[];
  search: string;
  statusFilter: StatusFilter;
  statusCounts: Record<string, number>;
  folders: AssetFolderSummary[];
  selectedFolderPath: string;
  candidateScope: Extract<CandidateScope, "auto" | "all">;
  candidateActive: boolean;
  candidateCount: number;
  totalAssetCount: number;
  foldersLoading: boolean;
  recursive: boolean;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  selectAllPending: boolean;
  allMatchingSelected: boolean;
  error: string | null;
  bulkActionPending: boolean;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void;
  onFolderSelect: (path: string) => Promise<boolean>;
  onCandidateScopeChange: (scope: Extract<CandidateScope, "auto" | "all">) => Promise<boolean>;
  onSelect: (assetId: string) => Promise<boolean>;
  onSetChecked: (assetIds: string[], checked: boolean) => void;
  onToggleAll: () => void;
  onRecursiveChange: (value: boolean) => void;
  onLoadMore: () => void;
  scopeControls?: ReactNode;
  rowDetail?: (asset: AssetSummary) => ReactNode;
  actions: ReactNode;
  historyAction: ReactNode;
}
