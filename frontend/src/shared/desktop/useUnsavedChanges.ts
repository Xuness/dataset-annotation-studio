import { useCallback, useEffect } from "react";

import { useAppStore } from "../store/appStore";

const DEFAULT_MESSAGE = "当前还有尚未保存的修改，仍要离开吗？";

export function useUnsavedScope(scope: string, dirty: boolean): void {
  const setDirtyScope = useAppStore((state) => state.setDirtyScope);

  useEffect(() => {
    setDirtyScope(scope, dirty);
    return () => setDirtyScope(scope, false);
  }, [dirty, scope, setDirtyScope]);
}

export function useUnsavedChangesGuard() {
  const hasUnsavedChanges = useAppStore((state) => Object.keys(state.dirtyScopes).length > 0);
  const clearDirtyScopes = useAppStore((state) => state.clearDirtyScopes);

  const confirmDiscard = useCallback(
    (message = DEFAULT_MESSAGE) => {
      if (!hasUnsavedChanges) return true;
      if (!window.confirm(message)) return false;
      clearDirtyScopes();
      return true;
    },
    [clearDirtyScopes, hasUnsavedChanges],
  );

  return { hasUnsavedChanges, confirmDiscard };
}
