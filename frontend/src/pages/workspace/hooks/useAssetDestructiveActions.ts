import { useCallback, useEffect, useState } from "react";

import { useAppStore } from "../../../shared/store/appStore";
import { confirmDialog } from "../../../shared/ui/dialogs";

interface UseAssetDestructiveActionsOptions {
  contextKey: string;
  selectedAssetId: string | null;
  editorDirty: boolean;
  discardEditorDraft: () => void;
  selectAsset: (assetId: string | null) => void;
}

interface AssetDeletionDialogState {
  open: boolean;
  assetIds: string[];
  initialView: "preview" | "history";
}

const CLOSED_DIALOG: AssetDeletionDialogState = {
  open: false,
  assetIds: [],
  initialView: "history",
};

export function useAssetDestructiveActions({
  contextKey,
  selectedAssetId,
  editorDirty,
  discardEditorDraft,
  selectAsset,
}: UseAssetDestructiveActionsOptions) {
  const setAssetsChecked = useAppStore((state) => state.setAssetsChecked);
  const [deletionDialog, setDeletionDialog] = useState<AssetDeletionDialogState>(CLOSED_DIALOG);

  useEffect(() => {
    setDeletionDialog(CLOSED_DIALOG);
  }, [contextKey]);

  const beforeDeleteAssets = useCallback(
    async (assetIds: string[]): Promise<boolean> => {
      if (!editorDirty || !selectedAssetId || !assetIds.includes(selectedAssetId)) return true;
      return confirmDialog(
        "当前图片的标注尚未保存。删除这张素材会丢弃编辑器中的修改，仍要继续吗？",
        {
          title: "未保存的标注",
          tone: "danger",
          confirmLabel: "丢弃并删除",
          cancelLabel: "继续编辑",
        },
      );
    },
    [editorDirty, selectedAssetId],
  );

  const handleAssetsDeleted = useCallback(
    (assetIds: string[]) => {
      setAssetsChecked(assetIds, false);
      if (selectedAssetId && assetIds.includes(selectedAssetId)) {
        discardEditorDraft();
        selectAsset(null);
      }
    },
    [discardEditorDraft, selectAsset, selectedAssetId, setAssetsChecked],
  );

  const openCheckedAssetDeletion = useCallback(() => {
    const assetIds = [...useAppStore.getState().checkedAssetIds];
    if (!assetIds.length) return;
    setDeletionDialog({ open: true, assetIds, initialView: "preview" });
  }, []);

  const openAssetDeletion = useCallback((assetId: string) => {
    setDeletionDialog({
      open: true,
      assetIds: [assetId],
      initialView: "preview",
    });
  }, []);

  const openDeletionHistory = useCallback(() => {
    setDeletionDialog({ open: true, assetIds: [], initialView: "history" });
  }, []);

  const closeDeletionDialog = useCallback(() => {
    setDeletionDialog((current) => ({ ...current, open: false }));
  }, []);

  return {
    deletionDialog,
    beforeDeleteAssets,
    handleAssetsDeleted,
    openCheckedAssetDeletion,
    openAssetDeletion,
    openDeletionHistory,
    closeDeletionDialog,
  };
}
