import { useCallback, useEffect } from "react";

import { useAppStore } from "../store/appStore";
import { confirmDialog } from "../ui/dialogs";

const DEFAULT_MESSAGE = "当前还有尚未保存的修改，离开会丢弃这些修改。";

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
    async (message = DEFAULT_MESSAGE) => {
      if (!hasUnsavedChanges) return true;
      const confirmed = await confirmDialog(message, {
        title: "尚未保存",
        tone: "danger",
        confirmLabel: "丢弃修改",
        cancelLabel: "继续编辑",
      });
      if (!confirmed) return false;
      clearDirtyScopes();
      return true;
    },
    [clearDirtyScopes, hasUnsavedChanges],
  );

  return { hasUnsavedChanges, confirmDiscard };
}
