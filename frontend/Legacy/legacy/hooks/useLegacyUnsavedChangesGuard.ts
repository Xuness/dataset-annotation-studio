import { useCallback } from "react";

import { useUnsavedChangesStore } from "../../../src/shared/store/unsavedChangesStore";
import { confirmDialog } from "../../shared/ui/dialogs";

const DEFAULT_MESSAGE = "当前还有尚未保存的修改，离开会丢弃这些修改。";

export function useLegacyUnsavedChangesGuard() {
  const dirtyScopes = useUnsavedChangesStore((state) => state.dirtyScopes);
  const hasUnsavedChanges = Object.keys(dirtyScopes).length > 0;
  const hasUnsavedTagChanges = Object.keys(dirtyScopes).some((scope) =>
    scope.startsWith("annotation-tags:"),
  );
  const clearDirtyScopes = useUnsavedChangesStore((state) => state.clearDirtyScopes);

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
