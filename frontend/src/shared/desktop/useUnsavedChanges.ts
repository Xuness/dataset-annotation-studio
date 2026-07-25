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
  const dirtyScopes = useAppStore((state) => state.dirtyScopes);
  const hasUnsavedChanges = Object.keys(dirtyScopes).length > 0;
  const hasUnsavedTagChanges = Object.keys(dirtyScopes).some((scope) =>
    scope.startsWith("annotation-tags:"),
  );
  const clearDirtyScopes = useAppStore((state) => state.clearDirtyScopes);

  const confirmDiscard = useCallback(
    async (message?: string) => {
      if (!hasUnsavedChanges) return true;
      const confirmed = await confirmDialog(
        message ??
          (hasUnsavedTagChanges ? "当前 Tags 修改尚未保存，离开会丢弃这些修改。" : DEFAULT_MESSAGE),
        {
          title: "尚未保存",
          tone: "danger",
          confirmLabel: "丢弃修改",
          cancelLabel: "继续编辑",
        },
      );
      if (!confirmed) return false;
      clearDirtyScopes();
      return true;
    },
    [clearDirtyScopes, hasUnsavedChanges, hasUnsavedTagChanges],
  );

  return { hasUnsavedChanges, confirmDiscard };
}
