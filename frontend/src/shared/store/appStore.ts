import { create } from "zustand";

interface AppState {
  activeProjectId: string | null;
  selectedAssetId: string | null;
  checkedAssetIds: string[];
  setActiveProject: (projectId: string | null) => void;
  selectAsset: (assetId: string | null) => void;
  toggleCheckedAsset: (assetId: string) => void;
  clearCheckedAssets: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeProjectId: null,
  selectedAssetId: null,
  checkedAssetIds: [],
  setActiveProject: (activeProjectId) =>
    set((state) =>
      state.activeProjectId === activeProjectId
        ? state
        : { activeProjectId, selectedAssetId: null, checkedAssetIds: [] },
    ),
  selectAsset: (selectedAssetId) => set({ selectedAssetId }),
  toggleCheckedAsset: (assetId) =>
    set((state) => ({
      checkedAssetIds: state.checkedAssetIds.includes(assetId)
        ? state.checkedAssetIds.filter((id) => id !== assetId)
        : [...state.checkedAssetIds, assetId],
    })),
  clearCheckedAssets: () => set({ checkedAssetIds: [] }),
}));
