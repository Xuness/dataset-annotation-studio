import { create } from "zustand";

interface AppState {
  activeProjectId: string | null;
  selectedAssetId: string | null;
  checkedAssetIds: string[];
  dirtyScopes: Record<string, true>;
  setActiveProject: (projectId: string | null) => void;
  selectAsset: (assetId: string | null) => void;
  toggleCheckedAsset: (assetId: string) => void;
  setAssetsChecked: (assetIds: string[], checked: boolean) => void;
  clearCheckedAssets: () => void;
  setDirtyScope: (scope: string, dirty: boolean) => void;
  clearDirtyScopes: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeProjectId: null,
  selectedAssetId: null,
  checkedAssetIds: [],
  dirtyScopes: {},
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
  setDirtyScope: (scope, dirty) =>
    set((state) => {
      if (dirty) {
        if (state.dirtyScopes[scope]) return state;
        return { dirtyScopes: { ...state.dirtyScopes, [scope]: true } };
      }
      if (!state.dirtyScopes[scope]) return state;
      const next = { ...state.dirtyScopes };
      delete next[scope];
      return { dirtyScopes: next };
    }),
  clearDirtyScopes: () => set({ dirtyScopes: {} }),
}));
