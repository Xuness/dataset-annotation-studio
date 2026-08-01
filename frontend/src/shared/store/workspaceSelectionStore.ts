import { create } from "zustand";

interface WorkspaceSelectionState {
  projectId: string | null;
  checkedAssetIds: string[];
  setActiveProject: (projectId: string | null) => void;
  toggleCheckedAsset: (assetId: string) => void;
  setAssetsChecked: (assetIds: string[], checked: boolean) => void;
  clearCheckedAssets: () => void;
}

export const useWorkspaceSelectionStore = create<WorkspaceSelectionState>((set) => ({
  projectId: null,
  checkedAssetIds: [],
  setActiveProject: (projectId) =>
    set((state) => (state.projectId === projectId ? state : { projectId, checkedAssetIds: [] })),
  toggleCheckedAsset: (assetId) =>
    set((state) => ({
      checkedAssetIds: state.checkedAssetIds.includes(assetId)
        ? state.checkedAssetIds.filter((id) => id !== assetId)
        : [...state.checkedAssetIds, assetId],
    })),
  setAssetsChecked: (assetIds, checked) =>
    set((state) => {
      if (!assetIds.length) return state;
      const next = new Set(state.checkedAssetIds);
      let changed = false;
      for (const assetId of assetIds) {
        if (checked && !next.has(assetId)) {
          next.add(assetId);
          changed = true;
        } else if (!checked && next.delete(assetId)) {
          changed = true;
        }
      }
      return changed ? { checkedAssetIds: [...next] } : state;
    }),
  clearCheckedAssets: () => set({ checkedAssetIds: [] }),
}));
