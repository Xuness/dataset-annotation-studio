import { create } from "zustand";

interface UnsavedChangesState {
  dirtyScopes: Record<string, true>;
  setDirtyScope: (scope: string, dirty: boolean) => void;
  clearDirtyScopes: () => void;
}

export const useUnsavedChangesStore = create<UnsavedChangesState>((set) => ({
  dirtyScopes: {},
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
