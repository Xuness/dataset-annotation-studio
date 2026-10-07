import { create } from "zustand";

interface UnsavedChangesState {
  dirtyScopes: Record<string, true>;
  sessionDirtyScopes: Record<string, true>;
  setSessionDirtyScope: (scope: string, dirty: boolean) => void;
  setDirtyScope: (scope: string, dirty: boolean) => void;
  clearDirtyScopes: () => void;
}

export const useUnsavedChangesStore = create<UnsavedChangesState>((set) => ({
  dirtyScopes: {},
  sessionDirtyScopes: {},
  setSessionDirtyScope: (scope, dirty) =>
    set((state) => {
      if (dirty)
        return state.sessionDirtyScopes[scope]
          ? state
          : { sessionDirtyScopes: { ...state.sessionDirtyScopes, [scope]: true } };
      if (!state.sessionDirtyScopes[scope]) return state;
      const remaining = { ...state.sessionDirtyScopes };
      delete remaining[scope];
      return { sessionDirtyScopes: remaining };
    }),
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
